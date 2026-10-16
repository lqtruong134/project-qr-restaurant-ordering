import type { Database } from '@thesis/database';
import type { OnlinePaymentView } from '@thesis/contracts';
import type {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLink,
  WebhookData,
} from '@payos/node';
import { createIntent } from './collection.service.js';
import { requireCollectionOwner, finishPaymentRequests } from './payment-requests.routes.js';
import { recalculate } from '../finance/ledger.service.js';
import { consumePromotion } from '../finance/pricing.service.js';
import {
  digest,
  one,
  reject,
  session,
  text,
  transaction,
  type Connection,
} from '../shared/core-persistence.js';
import {
  officialPayosProvider,
  payosCapabilities,
  readPayosConfig,
  type PayosOptions,
  type PayosProvider,
} from './payos-adapter.js';

type PayosRow = {
  id: string;
  payment_intent_id: string;
  order_code: string;
  request_payload: CreatePaymentLinkRequest;
  status: OnlinePaymentView['status'];
  paid_amount: string;
  checkout_url: string | null;
  qr_code: string | null;
  last_error: string | null;
  alert_id: string | null;
};
type IntentRow = { id: string; session_id: string };
const safeError =
  'Chưa đối chiếu được với payOS. Khoản thu vẫn được giữ chỗ; hãy kiểm tra lại trước khi thu bằng cách khác.';
const terminal = ['PAID', 'CANCELLED', 'EXPIRED', 'FAILED'];
const num = (value: unknown) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100000000000
  )
    reject('Dữ liệu thanh toán từ nhà cung cấp không hợp lệ.', 400);
  return value;
};
const code = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    reject('Mã thanh toán từ nhà cung cấp không hợp lệ.', 400);
  return value;
};
const checkout = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) reject('Mã link thanh toán không hợp lệ.', 400);
  return 'https://pay.payos.vn/web/' + id;
};
function validCheckout(value: unknown) {
  if (typeof value !== 'string') reject('Link thanh toán từ nhà cung cấp không hợp lệ.', 400);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'pay.payos.vn' || url.username || url.password)
    reject('Link thanh toán từ nhà cung cấp không hợp lệ.', 400);
  return value;
}
export function onlineView(row: PayosRow, expiresAt: unknown): OnlinePaymentView {
  const amount = BigInt(row.request_payload.amount),
    paid = BigInt(row.paid_amount ?? 0);
  return {
    provider: 'PAYOS',
    status: row.status,
    orderCode: String(row.order_code),
    checkoutUrl: row.checkout_url ?? null,
    qrCode: row.qr_code ?? null,
    expiresAt: new Date(String(expiresAt)).toISOString(),
    lastError: row.last_error ?? null,
    paidAmount: paid.toString(),
    remainingAmount: (amount > paid ? amount - paid : 0n).toString(),
  };
}
export async function readPaymentIntents(c: Connection, sid: string) {
  const rows = (
    await c.query(
      `SELECT p.*,to_jsonb(q) AS online_data FROM payment_intent p LEFT JOIN payos_payment_request q ON q.payment_intent_id=p.id WHERE p.session_id=$1 ORDER BY p.created_at DESC,p.id`,
      [sid],
    )
  ).rows;
  return rows.map(({ online_data, ...intent }) => ({
    ...intent,
    online: online_data ? onlineView(online_data, intent.expires_at) : null,
  }));
}
async function audit(
  c: Connection,
  restaurant: string,
  actor: string | null,
  id: string,
  action: string,
  reason: string,
  details: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details,actor_type) VALUES($1,$2,$3,'PAYMENT_INTENT',$4,$5,$6,CASE WHEN $2::uuid IS NULL THEN 'SYSTEM' ELSE 'USER' END)`,
    [restaurant, actor, action, id, reason, JSON.stringify(details)],
  );
}
async function reconciliation(
  c: Connection,
  restaurant: string,
  pi: IntentRow,
  q: PayosRow,
  reason: string,
) {
  const table = await one(c, 'SELECT table_id FROM table_session WHERE id=$1', [pi.session_id]);
  let alert = q.alert_id;
  if (!alert)
    alert = (
      await one(
        c,
        `INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'OTHER','WARNING',$3) RETURNING id`,
        [pi.session_id, table.table_id, q.paid_amount ?? 0],
      )
    ).id;
  await c.query(
    `UPDATE payos_payment_request SET status='REQUIRES_RECONCILIATION',reconciliation_status='OPEN',reconciliation_reason=$2,alert_id=$3,last_error=$2 WHERE id=$1`,
    [q.id, reason, alert],
  );
  await c.query(
    `UPDATE payment_intent SET status='REQUIRES_RECONCILIATION',version=version+1 WHERE id=$1`,
    [pi.id],
  );
  await audit(c, restaurant, null, pi.id, 'PAYOS_RECONCILIATION_REQUIRED', reason, {
    sessionId: pi.session_id,
    orderCode: String(q.order_code),
  });
}

export class PayosService {
  readonly config;
  readonly capabilities;
  readonly provider: PayosProvider | undefined;
  constructor(
    readonly db: Database,
    readonly restaurant: string,
    options: PayosOptions = {},
  ) {
    this.config = options.config ?? readPayosConfig();
    this.capabilities = payosCapabilities(this.config);
    this.provider =
      options.provider ??
      (this.capabilities.online ? officialPayosProvider(this.config) : undefined);
  }
  requireProvider() {
    if (!this.provider || !this.capabilities.online)
      reject(this.capabilities.reason ?? 'Chưa cấu hình payOS.', 503);
    return this.provider;
  }
  async view(id: string) {
    return transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, ref.session_id, this.restaurant, false);
      const rows = await readPaymentIntents(c, ref.session_id);
      return rows.find((p) => p.id === id)!;
    });
  }
  async create(sid: string, actor: string, b: Record<string, unknown>) {
    this.requireProvider();
    const id = await transaction(this.db, async (c) => {
      const pi = await createIntent(
        c,
        sid,
        this.restaurant,
        { type: 'USER', id: actor },
        { ...b, method: 'ONLINE' },
      );
      const current = await one(c, 'SELECT * FROM payment_intent WHERE id=$1', [pi.id]);
      const old = (
        await c.query('SELECT id FROM payos_payment_request WHERE payment_intent_id=$1', [pi.id])
      ).rows[0];
      if (old) return String(pi.id);
      await c.query("UPDATE payment_intent SET provider='PAYOS' WHERE id=$1", [pi.id]);
      const order = (await one(c, "SELECT nextval('payos_order_code_seq')::text AS code")).code;
      const request: CreatePaymentLinkRequest = {
        orderCode: Number(order),
        amount: Number(current.amount),
        description: 'QR' + String(order).slice(-7),
        returnUrl: this.config.returnUrl!,
        cancelUrl: this.config.cancelUrl!,
        expiredAt: Math.floor(new Date(current.expires_at).getTime() / 1000),
      };
      await c.query(
        'INSERT INTO payos_payment_request(payment_intent_id,created_by,order_code,request_payload) VALUES($1,$2,$3,$4)',
        [pi.id, actor, order, JSON.stringify(request)],
      );
      await c.query(
        "UPDATE session_promotion SET expires_at='9999-12-31 00:00:00+00' WHERE session_id=$1 AND status='RESERVED'",
        [sid],
      );
      await audit(
        c,
        this.restaurant,
        actor,
        pi.id,
        'PAYOS_PAYMENT_STARTED',
        'Bắt đầu thu tiền online',
        { sessionId: sid, amount: current.amount, collectionScope: current.collection_scope },
      );
      return String(pi.id);
    });
    await this.process(id, true);
    return this.view(id);
  }
  async refresh(id: string, actor: string) {
    this.requireProvider();
    await transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, ref.session_id, this.restaurant);
      const pi = await one(c, "SELECT * FROM payment_intent WHERE id=$1 AND provider='PAYOS'", [
        id,
      ]);
      await requireCollectionOwner(c, pi.session_id, pi.support_request_id, actor);
    });
    await this.process(id, true);
    return this.view(id);
  }
  async cancel(id: string, actor: string) {
    this.requireProvider();
    await transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, ref.session_id, this.restaurant);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      await requireCollectionOwner(c, pi.session_id, pi.support_request_id, actor);
      const q = await one(
        c,
        'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
        [id],
      );
      if (pi.status === 'SUCCEEDED' || q.status === 'PAID')
        reject('Khoản online đã thanh toán; xử lý hoàn tiền theo phiếu quản trị.');
      if (['CANCELLED', 'EXPIRED'].includes(q.status) && terminal.includes(q.provider_status))
        return;
      await c.query(
        "UPDATE payos_payment_request SET status='CANCEL_PENDING',cancel_requested=true,next_poll_at=now() WHERE id=$1",
        [q.id],
      );
      await audit(
        c,
        this.restaurant,
        actor,
        id,
        'PAYOS_CANCELLATION_REQUESTED',
        'Yêu cầu hủy khoản online',
        { sessionId: pi.session_id },
      );
    });
    await this.process(id, true);
    return this.view(id);
  }
  async claim(id: string, force: boolean) {
    return transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, ref.session_id, this.restaurant, false);
      const q = await one(
        c,
        `SELECT q.*,p.session_id,p.amount,p.status AS intent_status,p.expires_at FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE p.id=$1 FOR UPDATE OF q`,
        [id],
      );
      if (q.lease_until && new Date(q.lease_until).getTime() > Date.now()) return null;
      if (!force && new Date(q.next_poll_at).getTime() > Date.now()) return null;
      await c.query(
        "UPDATE payos_payment_request SET lease_until=now()+interval '60 seconds',next_poll_at=now()+interval '30 seconds' WHERE id=$1",
        [q.id],
      );
      return q;
    });
  }
  async process(id: string, force: boolean) {
    const provider = this.requireProvider(),
      q = await this.claim(id, force);
    if (!q) return;
    try {
      let link: PaymentLink | undefined, created: CreatePaymentLinkResponse | undefined;
      if (!q.payment_link_id) {
        try {
          link = await provider.get(Number(q.order_code));
        } catch (error) {
          if (!provider.isNotFound(error)) throw error;
        }
        if (
          !link &&
          !q.cancel_requested &&
          ['CREATED', 'PENDING'].includes(q.intent_status) &&
          new Date(q.expires_at).getTime() > Date.now()
        ) {
          created = await provider.create(q.request_payload as CreatePaymentLinkRequest);
          if (
            code(created.orderCode) !== Number(q.order_code) ||
            num(created.amount) !== Number(q.amount) ||
            created.currency !== 'VND' ||
            !created.accountNumber ||
            !created.qrCode
          )
            throw Error('PAYOS_METADATA_MISMATCH');
          validCheckout(created.checkoutUrl);
          await transaction(this.db, async (c) => {
            await session(c, q.session_id, this.restaurant, false);
            const attached = await one(
              c,
              'SELECT * FROM payos_payment_request WHERE id=$1 FOR UPDATE',
              [q.id],
            );
            // A webhook may have confirmed money while create was still in flight.
            if (attached.payment_link_id && attached.payment_link_id !== created!.paymentLinkId)
              throw Error('PAYOS_METADATA_MISMATCH');
            await c.query(
              `UPDATE payos_payment_request SET payment_link_id=$2,account_number=$3,checkout_url=$4,qr_code=$5,provider_status=COALESCE(provider_status,$6),status=CASE WHEN provider_status IS NULL THEN 'PENDING' ELSE status END,last_error=CASE WHEN reconciliation_status='OPEN' THEN last_error ELSE NULL END WHERE id=$1`,
              [
                q.id,
                created!.paymentLinkId,
                created!.accountNumber,
                created!.checkoutUrl,
                created!.qrCode,
                created!.status,
              ],
            );
            await c.query(
              "UPDATE payment_intent SET status='PENDING',provider_reference=$2,version=version+1 WHERE id=$1 AND status='CREATED'",
              [id, created!.paymentLinkId],
            );
          });
          link = await provider.get(Number(q.order_code));
        }
        if (!link) {
          // A confirmed missing provider order is safe to release; an unknown network outcome is not.
          await transaction(this.db, async (c) => {
            await session(c, q.session_id, this.restaurant, false);
            await c.query(
              'UPDATE payos_payment_request SET status=$2,provider_status=$2,lease_until=NULL,last_error=NULL WHERE id=$1',
              [q.id, q.cancel_requested ? 'CANCELLED' : 'EXPIRED'],
            );
            await c.query(
              "UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1 AND status<>'SUCCEEDED'",
              [id, q.cancel_requested ? 'CANCELLED' : 'EXPIRED'],
            );
            await c.query(
              "UPDATE session_promotion SET expires_at=now() WHERE session_id=$1 AND status='RESERVED'",
              [q.session_id],
            );
            await recalculate(c, q.session_id);
          });
          return;
        }
      } else link = await provider.get(Number(q.order_code));
      const current = (
        await this.db.pool.query(
          'SELECT q.*,p.status AS intent_status,p.expires_at FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE q.id=$1',
          [q.id],
        )
      ).rows[0];
      const needsCancel =
        current.cancel_requested ||
        ['CANCELLED', 'EXPIRED'].includes(current.intent_status) ||
        new Date(current.expires_at).getTime() <= Date.now();
      if (needsCancel && !terminal.includes(link.status))
        link = await provider.cancel(
          Number(q.order_code),
          'Khoản thu đã hủy hoặc hết hạn tại nhà hàng',
        );
      await this.applyLink(id, link);
    } catch {
      await transaction(this.db, async (c) => {
        await session(c, q.session_id, this.restaurant, false);
        await c.query(
          `UPDATE payos_payment_request SET status=CASE WHEN reconciliation_status='OPEN' THEN 'REQUIRES_RECONCILIATION' WHEN provider_status IN ('PAID','CANCELLED','EXPIRED','FAILED') THEN status WHEN cancel_requested THEN 'CANCEL_PENDING' ELSE 'ERROR' END,last_error=CASE WHEN provider_status IN ('PAID','CANCELLED','EXPIRED','FAILED') THEN last_error ELSE $2 END,lease_until=NULL,next_poll_at=now()+interval '30 seconds' WHERE id=$1`,
          [q.id, safeError],
        );
        await recalculate(c, q.session_id);
      });
    }
  }
  async applyLink(id: string, link: PaymentLink, webhook?: WebhookData, webhookEventId?: string) {
    code(link.orderCode);
    num(link.amount);
    num(link.amountPaid);
    num(link.amountRemaining);
    if (
      !Array.isArray(link.transactions) ||
      !['PENDING', 'CANCELLED', 'UNDERPAID', 'PAID', 'EXPIRED', 'PROCESSING', 'FAILED'].includes(
        link.status,
      )
    )
      reject('Trạng thái payOS không hợp lệ.', 400);
    const seen = new Set<string>();
    let actual = 0n;
    for (const t of link.transactions) {
      num(t.amount);
      if (t.amount === 0) reject('Giao dịch ngân hàng phải có số tiền dương.', 400);
      text(t.reference, 160);
      if (seen.has(t.reference)) reject('Giao dịch payOS bị trùng tham chiếu.', 400);
      seen.add(t.reference);
      actual += BigInt(t.amount);
    }
    if (
      actual !== BigInt(link.amountPaid) ||
      BigInt(link.amountRemaining) !==
        (BigInt(link.amount) > actual ? BigInt(link.amount) - actual : 0n)
    )
      reject('Số tiền payOS chưa đối chiếu được.', 400);
    return transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      const s = await session(c, ref.session_id, this.restaurant, false);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      const q = await one(
        c,
        'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
        [id],
      );
      if (BigInt(q.paid_amount) > actual) return { status: 'STALE_IGNORED' };
      const prior = (
        await c.query(
          "SELECT provider_transaction_id AS reference,amount::text FROM payment_transaction WHERE payment_intent_id=$1 AND provider='PAYOS' AND status='SUCCEEDED'",
          [id],
        )
      ).rows;
      const oldQuarantine = Array.isArray(q.quarantined_transactions)
        ? q.quarantined_transactions
        : [];
      if (
        [...prior, ...oldQuarantine].some(
          (previous: Record<string, unknown>) =>
            !link.transactions.some(
              (t) =>
                t.reference === previous.reference && String(t.amount) === String(previous.amount),
            ),
        )
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          q,
          'Lịch sử payOS không khớp giao dịch đã ghi nhận.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      if (
        terminal.includes(q.provider_status) &&
        !terminal.includes(link.status) &&
        BigInt(q.paid_amount) === actual
      )
        return { status: 'STALE_IGNORED' };
      if (
        Number(q.order_code) !== link.orderCode ||
        BigInt(pi.amount) !== BigInt(link.amount) ||
        (q.payment_link_id && q.payment_link_id !== link.id)
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          q,
          'Thông tin link payOS không khớp khoản thu.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      if (
        webhook &&
        (webhook.paymentLinkId !== link.id ||
          webhook.orderCode !== link.orderCode ||
          webhook.currency !== 'VND' ||
          !link.transactions.some(
            (t) =>
              t.reference === webhook.reference &&
              t.amount === webhook.amount &&
              t.accountNumber === webhook.accountNumber,
          ))
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          q,
          'Thông báo payOS chưa khớp giao dịch ngân hàng.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      if (
        q.account_number &&
        link.transactions.some(
          (t) =>
            t.accountNumber !== q.account_number && t.virtualAccountNumber !== q.account_number,
        )
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          q,
          'Tài khoản nhận tiền payOS không khớp kênh đã tạo.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      const late =
        !['CREATED', 'PENDING', 'SUCCEEDED'].includes(pi.status) ||
        new Date(pi.expires_at).getTime() <= Date.now() ||
        q.cancel_requested;
      await c.query(
        `UPDATE payos_payment_request SET payment_link_id=$2,checkout_url=COALESCE(checkout_url,$3),provider_status=$4,paid_amount=$5,lease_until=NULL,last_error=NULL,next_poll_at=now()+interval '30 seconds' WHERE id=$1`,
        [q.id, link.id, checkout(link.id), link.status, actual.toString()],
      );
      let anomaly =
        q.reconciliation_status === 'OPEN' || (late && actual > 0n) || actual > BigInt(pi.amount);
      const quarantine = Array.isArray(q.quarantined_transactions)
        ? q.quarantined_transactions
        : [];
      for (const bank of link.transactions) {
        const existing = (
          await c.query(
            "SELECT * FROM payment_transaction WHERE provider='PAYOS' AND provider_transaction_id=$1",
            [bank.reference],
          )
        ).rows[0];
        if (existing) {
          if (
            existing.payment_intent_id !== id ||
            BigInt(existing.amount) !== BigInt(bank.amount)
          ) {
            await reconciliation(
              c,
              this.restaurant,
              pi,
              q,
              'Tham chiếu ngân hàng đã dùng cho khoản thu khác.',
            );
            return { status: 'REQUIRES_RECONCILIATION' };
          }
          continue;
        }
        if (quarantine.some((x: Record<string, unknown>) => x.reference === bank.reference))
          continue;
        if (s.session_status !== 'ACTIVE') {
          quarantine.push({
            reference: bank.reference,
            amount: String(bank.amount),
            at: bank.transactionDateTime,
          });
          anomaly = true;
          continue;
        }
        const account = await recalculate(c, pi.session_id);
        const captured = await one(
          c,
          "SELECT COALESCE(sum(amount),0)::text AS amount FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'",
          [id],
        );
        const remaining =
          BigInt(pi.amount) > BigInt(captured.amount)
            ? BigInt(pi.amount) - BigInt(captured.amount)
            : 0n;
        const payment = await one(
          c,
          `INSERT INTO payment_transaction(payment_intent_id,session_id,method,provider,provider_transaction_id,amount,status,confirmed_at,metadata) VALUES($1,$2,'ONLINE','PAYOS',$3,$4,'SUCCEEDED',now(),$5) RETURNING *`,
          [
            id,
            pi.session_id,
            bank.reference,
            String(bank.amount),
            JSON.stringify({
              orderCode: String(q.order_code),
              paymentLinkId: link.id,
              collectionScope: pi.collection_scope,
              payerParticipantId: pi.payer_participant_id,
              bankTransactionAt: bank.transactionDateTime,
            }),
          ],
        );
        let left = BigInt(bank.amount);
        const safeLimit = left < remaining ? left : remaining;
        left =
          safeLimit < BigInt(account.outstanding_amount)
            ? safeLimit
            : BigInt(account.outstanding_amount);
        const allocatedTarget = left;
        const charges = (
          await c.query(
            `SELECT f.id,f.amount-f.discount_amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0) AS remaining FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE' AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM order_item i WHERE i.id=f.order_item_id AND i.owner_participant_id=$2)) ORDER BY f.created_at,f.id FOR UPDATE`,
            [pi.session_id, pi.collection_scope === 'PARTICIPANT' ? pi.payer_participant_id : null],
          )
        ).rows;
        for (const charge of charges) {
          if (!left) break;
          const available = BigInt(charge.remaining);
          if (available <= 0n) continue;
          const part = left < available ? left : available;
          await c.query(
            'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,$3)',
            [payment.id, charge.id, part.toString()],
          );
          left -= part;
        }
        if (left > 0n || allocatedTarget < BigInt(bank.amount)) anomaly = true;
        await consumePromotion(c, pi.session_id);
        await recalculate(c, pi.session_id);
        await c.query(
          `INSERT INTO outbox_event(aggregate_type,payment_transaction_id,event_type,payload) VALUES('PAYMENT_TRANSACTION',$1,'PAYMENT_RECEIVED',$2)`,
          [payment.id, JSON.stringify({ sessionId: pi.session_id, provider: 'PAYOS' })],
        );
        await audit(
          c,
          this.restaurant,
          null,
          id,
          'PAYOS_BANK_PAYMENT_RECEIVED',
          'payOS xác nhận tiền đã vào tài khoản',
          {
            sessionId: pi.session_id,
            paymentId: payment.id,
            amount: payment.amount,
            reference: bank.reference,
          },
        );
      }
      await c.query('UPDATE payos_payment_request SET quarantined_transactions=$2 WHERE id=$1', [
        q.id,
        JSON.stringify(quarantine),
      ]);
      if (anomaly) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          { ...q, paid_amount: actual.toString() },
          s.session_status !== 'ACTIVE'
            ? 'Tiền payOS đến sau khi phiên đã đóng; cần hoàn ngoài phiếu đã chốt.'
            : late
              ? 'Tiền payOS đến khi khoản thu đã hủy hoặc hết hạn.'
              : 'Tiền payOS cần đối soát hoặc hoàn phần vượt.',
        );
      } else {
        const fulfilled = actual === BigInt(pi.amount) && link.status === 'PAID';
        const finalState = fulfilled
          ? 'SUCCEEDED'
          : terminal.includes(link.status)
            ? link.status === 'CANCELLED'
              ? 'CANCELLED'
              : link.status === 'FAILED'
                ? 'FAILED'
                : link.status === 'EXPIRED'
                  ? 'EXPIRED'
                  : 'PENDING'
            : 'PENDING';
        await c.query(
          'UPDATE payment_intent SET status=$2,provider_reference=$3,version=version+1 WHERE id=$1',
          [id, finalState, link.id],
        );
        await c.query('UPDATE payos_payment_request SET status=$2 WHERE id=$1', [
          q.id,
          fulfilled
            ? 'PAID'
            : link.status === 'PROCESSING'
              ? 'PROCESSING'
              : actual > 0n && !terminal.includes(link.status)
                ? 'UNDERPAID'
                : link.status,
        ]);
        if (s.session_status === 'ACTIVE') {
          const settled = await recalculate(c, pi.session_id);
          if (fulfilled)
            await finishPaymentRequests(
              c,
              pi.session_id,
              pi.support_request_id,
              null,
              BigInt(settled.outstanding_amount) === 0n,
            );
          if (terminal.includes(link.status) && actual > 0n && !fulfilled) {
            await reconciliation(
              c,
              this.restaurant,
              pi,
              q,
              'Khoản online kết thúc khi khách chưa chuyển đủ; cần đối chiếu phần đã nhận.',
            );
          }
        }
      }
      if (terminal.includes(link.status))
        await c.query(
          "UPDATE session_promotion SET expires_at=now() WHERE session_id=$1 AND status='RESERVED'",
          [pi.session_id],
        );
      if (webhookEventId && webhook) {
        const payment = (
          await c.query(
            "SELECT id FROM payment_transaction WHERE provider='PAYOS' AND provider_transaction_id=$1",
            [webhook.reference],
          )
        ).rows[0];
        await c.query(
          'UPDATE payment_webhook_event SET processing_status=$2,processed_at=now(),payment_transaction_id=$3 WHERE id=$1',
          [
            webhookEventId,
            payment ? 'PROCESSED' : anomaly ? 'REJECTED' : 'UNMATCHED',
            payment?.id ?? null,
          ],
        );
      }
      return { status: anomaly ? 'REQUIRES_RECONCILIATION' : 'PROCESSED' };
    });
  }
  async webhook(body: unknown) {
    const provider = this.requireProvider();
    let data: WebhookData;
    try {
      data = await provider.verify(body);
    } catch {
      reject('Chữ ký payOS không hợp lệ.', 400);
    }
    if (!Number.isSafeInteger(data.orderCode) || data.orderCode < 0)
      reject('Mã thông báo payOS không hợp lệ.', 400);
    num(data.amount);
    text(data.reference, 160);
    text(data.paymentLinkId, 160);
    const minimal = {
      orderCode: data.orderCode,
      amount: data.amount,
      reference: data.reference,
      paymentLinkId: data.paymentLinkId,
      currency: data.currency,
      code: data.code,
    };
    const hash = digest(JSON.stringify(minimal));
    const event = await transaction(this.db, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'PAYOS:' + data.reference,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM payment_webhook_event WHERE provider='PAYOS' AND provider_event_id=$1",
          [data.reference],
        )
      ).rows[0];
      if (old) {
        if (old.payload_hash !== hash) reject('Tham chiếu payOS có dữ liệu không khớp.');
        return old;
      }
      return one(
        c,
        `INSERT INTO payment_webhook_event(provider,provider_event_id,provider_transaction_id,payload_hash,payload_snapshot,signature_valid) VALUES('PAYOS',$1,$1,$2,$3,true) RETURNING *`,
        [data.reference, hash, JSON.stringify({ ...minimal, restaurantId: this.restaurant })],
      );
    });
    if (event.processing_status === 'PROCESSED') return { status: 'PROCESSED' };
    const ref = (
      await this.db.pool.query(
        `SELECT p.id,q.payment_link_id FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE q.order_code=$1 AND t.restaurant_id=$2`,
        [data.orderCode, this.restaurant],
      )
    ).rows[0];
    if (!ref) {
      await this.db.pool.query(
        "UPDATE payment_webhook_event SET processing_status='UNMATCHED',processed_at=now() WHERE id=$1",
        [event.id],
      );
      return { status: 'UNMATCHED' };
    }
    if (
      data.currency !== 'VND' ||
      data.code !== '00' ||
      (ref.payment_link_id && ref.payment_link_id !== data.paymentLinkId)
    ) {
      await this.db.pool.query(
        "UPDATE payment_webhook_event SET processing_status='REJECTED',processed_at=now() WHERE id=$1",
        [event.id],
      );
      return { status: 'REJECTED' };
    }
    let link: PaymentLink;
    try {
      link = await provider.get(Number(data.orderCode));
    } catch {
      reject('Chưa đối chiếu được payOS; webhook cần gửi lại.', 503);
    }
    const result = await this.applyLink(ref.id, link, data, event.id);
    await transaction(this.db, async (c) => {
      const payment = (
        await c.query(
          "SELECT id FROM payment_transaction WHERE provider='PAYOS' AND provider_transaction_id=$1",
          [data.reference],
        )
      ).rows[0];
      await c.query(
        'UPDATE payment_webhook_event SET processing_status=$2,processed_at=now(),payment_transaction_id=$3 WHERE id=$1',
        [
          event.id,
          payment
            ? 'PROCESSED'
            : result.status === 'REQUIRES_RECONCILIATION'
              ? 'REJECTED'
              : 'UNMATCHED',
          payment?.id ?? null,
        ],
      );
    });
    return result;
  }
  async maintain() {
    if (!this.provider || !this.capabilities.online) return;
    const rows = (
      await this.db.pool.query(
        `SELECT p.id FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND q.next_poll_at<=now() AND (q.status IN ('CREATE_PENDING','PENDING','PROCESSING','UNDERPAID','CANCEL_PENDING') OR (q.status='ERROR' AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED')) OR (q.reconciliation_status='OPEN' AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED'))) ORDER BY q.next_poll_at LIMIT 10`,
        [this.restaurant],
      )
    ).rows;
    for (const row of rows) await this.process(row.id, false);
  }
  async cases() {
    return (
      await this.db.pool.query(
        `SELECT p.id,p.session_id,t.code AS table_code,s.session_status,p.amount::text,q.paid_amount::text,COALESCE((SELECT sum((x->>'amount')::bigint) FROM jsonb_array_elements(q.quarantined_transactions) x),0)::text AS quarantined_amount,COALESCE(q.provider_status,q.status) AS provider_status,q.last_error,q.updated_at,q.reconciliation_reason AS reason,q.reconciliation_status AS status FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND q.reconciliation_status IS NOT NULL ORDER BY q.updated_at DESC LIMIT 100`,
        [this.restaurant],
      )
    ).rows;
  }
  async resolve(id: string, actor: string, b: Record<string, unknown>) {
    const reason = text(b.reason, 300);
    return transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      const s = await session(c, ref.session_id, this.restaurant, false);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      const q = await one(
        c,
        'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
        [id],
      );
      if (q.reconciliation_status === 'RESOLVED') return { status: 'ok', alreadyProcessed: true };
      if (q.reconciliation_status !== 'OPEN') reject('Khoản này không có hồ sơ đối soát đang mở.');
      if (!terminal.includes(q.provider_status))
        reject('Đối chiếu trạng thái payOS kết thúc trước khi đóng đối soát.');
      const quarantine = q.quarantined_transactions.reduce(
        (sum: bigint, x: { amount: string }) => sum + BigInt(x.amount),
        0n,
      );
      let reference: string | null = null;
      if (s.session_status !== 'ACTIVE' || quarantine > 0n) {
        if (b.resolution !== 'RETURNED_EXTERNALLY' || quarantine <= 0n)
          reject('Tiền đến sau đóng phiên phải được hoàn ngoài phiếu đã chốt.');
        reference = text(b.reference, 120);
      } else {
        if (b.resolution !== 'RECONCILED')
          reject('Chọn xác nhận đã đối soát khoản tại phiên đang mở.', 400);
        const account = await recalculate(c, pi.session_id);
        if (BigInt(account.refund_due_amount) > 0n)
          reject('Hoàn tất phiếu hoàn tiền cho khách trước khi đóng đối soát.');
      }
      await c.query(
        `UPDATE payos_payment_request SET reconciliation_status='RESOLVED',resolved_by=$2,resolved_at=now(),reconciliation_reason=$3,last_error=NULL WHERE id=$1`,
        [q.id, actor, reason],
      );
      await c.query(`UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1`, [
        id,
        q.provider_status === 'PAID'
          ? 'SUCCEEDED'
          : q.provider_status === 'CANCELLED'
            ? 'CANCELLED'
            : q.provider_status === 'EXPIRED'
              ? 'EXPIRED'
              : 'FAILED',
      ]);
      if (q.alert_id)
        await c.query(
          "UPDATE operational_alert SET status='RESOLVED',resolved_by=$2,resolved_at=now(),resolution_note=$3 WHERE id=$1",
          [q.alert_id, actor, reason],
        );
      await audit(
        c,
        this.restaurant,
        actor,
        id,
        reference ? 'PAYOS_RETURNED_EXTERNALLY' : 'PAYOS_RECONCILED',
        reason,
        {
          sessionId: pi.session_id,
          resolution: b.resolution,
          reference,
          quarantinedAmount: quarantine.toString(),
        },
      );
      return { status: 'ok' };
    });
  }
}
