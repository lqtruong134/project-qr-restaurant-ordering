import { payosBankReportedJoin } from './payment-reported-funds.js';
import { payosResolutionReadiness } from './payos-resolution.js';
import type { Database } from '@thesis/database';
import type { FastifyBaseLogger } from 'fastify';
import {
  payosErrorCategory,
  normalizePayosAccount,
  recipientMatchesWithEvidence,
  sameRecipient,
  type PayosRecipient,
} from './payos-normalization.js';
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
import { payosIntentFundsJoin, readRefundSourceBudgets } from './refund-budget.service.js';
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
  trustedPayosPrimary,
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
  bank_reported_amount?: string;
  recorded_amount?: string;
  allocated_amount?: string;
  refunded_amount?: string;
  unapplied_amount?: string;
  reconciliation_status?: string | null;
  reconciliation_reason?: string | null;
};
type IntentRow = { id: string; session_id: string };
const safeError =
  'Chưa đối chiếu được với payOS. Khoản thu vẫn được giữ chỗ; hãy kiểm tra lại trước khi thu bằng cách khác.';
const terminal = ['PAID', 'CANCELLED', 'EXPIRED', 'FAILED'];
// These cases may recover only after every current identity/history/allocation
// check passes. Overpaid, invalidated, closed-session or unallocated funds still
// force reconciliation independently of the old text.
const recoverableReasons = [
  'Tài khoản nhận tiền payOS không khớp kênh đã tạo.',
  'Chưa có bằng chứng tài khoản nhận từ lúc tạo link payOS.',
  'Thông báo payOS chưa khớp giao dịch ngân hàng.',
  'Thông tin link payOS không khớp khoản thu.',
  'Lịch sử payOS không khớp giao dịch đã ghi nhận.',
  'Tiền payOS cần đối soát hoặc hoàn phần vượt.',
];
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
    bankReportedAmount: String(row.bank_reported_amount ?? row.paid_amount ?? '0'),
    recordedAmount: String(row.recorded_amount ?? '0'),
    appliedAmount: String(row.allocated_amount ?? '0'),
    refundedAmount: String(row.refunded_amount ?? '0'),
    unallocatedAmount: String(row.unapplied_amount ?? '0'),
    remainingAmount: (amount > paid ? amount - paid : 0n).toString(),
  };
}
export async function readPaymentIntents(c: Connection, sid: string) {
  const rows = (
    await c.query(
      `SELECT p.*,CASE WHEN q.id IS NULL THEN NULL ELSE to_jsonb(q) || jsonb_build_object(
          'bank_reported_amount',GREATEST(q.paid_amount,COALESCE(reported.amount,0))::text,
          'recorded_amount',COALESCE(funds.recorded_amount,0)::text,
          'allocated_amount',COALESCE(funds.allocated_amount,0)::text,
          'refunded_amount',COALESCE(funds.refunded_amount,0)::text,
          'unapplied_amount',COALESCE(funds.unapplied_amount,0)::text
        ) END AS online_data
        FROM payment_intent p LEFT JOIN payos_payment_request q ON q.payment_intent_id=p.id
        ${payosIntentFundsJoin}
        ${payosBankReportedJoin}
        WHERE p.session_id=$1 ORDER BY p.created_at DESC,p.id`,
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
  if (alert) {
    const previous = (await c.query('SELECT status FROM operational_alert WHERE id=$1', [alert]))
      .rows[0];
    // A later distinct money exception gets a new alert; retain the resolved one as history.
    if (previous?.status === 'RESOLVED') alert = null;
  }
  if (!alert)
    alert = (
      await one(
        c,
        `INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'OTHER','WARNING',$3) RETURNING id`,
        [pi.session_id, table.table_id, q.paid_amount ?? 0],
      )
    ).id;
  await c.query(
    `UPDATE payos_payment_request SET status='REQUIRES_RECONCILIATION',reconciliation_status='OPEN',reconciliation_reason=$2,alert_id=$3,last_error=$2,resolved_by=NULL,resolved_at=NULL WHERE id=$1`,
    [q.id, reason, alert],
  );
  await c.query(
    `UPDATE payment_intent SET status='REQUIRES_RECONCILIATION',version=version+1
      WHERE id=$1 AND status<>'REQUIRES_RECONCILIATION'`,
    [pi.id],
  );
  if (alert)
    await c.query('UPDATE operational_alert SET outstanding_amount=$2 WHERE id=$1', [
      alert,
      q.paid_amount ?? 0,
    ]);
  if (q.reconciliation_status === 'OPEN' && q.reconciliation_reason === reason) return;
  await audit(c, restaurant, null, pi.id, 'PAYOS_RECONCILIATION_REQUIRED', reason, {
    sessionId: pi.session_id,
    orderCode: String(q.order_code),
    alertId: alert,
  });
}

export class PayosService {
  readonly config;
  readonly capabilities;
  readonly provider: PayosProvider | undefined;
  private logger?: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  setLogger(logger: Pick<FastifyBaseLogger, 'info' | 'warn'>) {
    this.logger = logger;
  }
  private observe(
    stage: string,
    fields: Record<string, string | number | boolean | null | undefined> = {},
    warning = false,
  ) {
    this.logger?.[warning ? 'warn' : 'info'](
      { provider: 'PAYOS', stage, ...fields },
      'Online payment processing',
    );
  }
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
      await session(c, ref.session_id, this.restaurant, false);
      const pi = await one(c, "SELECT * FROM payment_intent WHERE id=$1 AND provider='PAYOS'", [
        id,
      ]);
      if (pi.support_request_id) {
        const request = await one(
          c,
          "SELECT status,acknowledged_by FROM support_request WHERE id=$1 AND session_id=$2 AND request_type='BILL' FOR UPDATE",
          [pi.support_request_id, pi.session_id],
        );
        if (!['NEW', 'ACKNOWLEDGED'].includes(request.status)) {
          // Automatic payment completion must not invalidate its collector's read-only recovery.
          if (request.acknowledged_by !== actor)
            reject('Yêu cầu thu tiền thuộc nhân viên khác.', 403);
        } else await requireCollectionOwner(c, pi.session_id, pi.support_request_id, actor);
      } else await requireCollectionOwner(c, pi.session_id, null, actor);
    });
    const result = await this.process(id, true, false);
    if (result === 'BUSY')
      reject('payOS đang được đối chiếu. Dữ liệu sẽ tự cập nhật; vui lòng thử lại sau ít giây.');
    if (result === 'FAILED') reject(safeError, 503);
    if (result === 'WAITING')
      reject('payOS đang cập nhật giao dịch. Hệ thống sẽ tự kiểm tra lại.', 503);
    return this.view(id);
  }
  async refreshForAdmin(id: string, actor: string) {
    this.requireProvider();
    await transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, ref.session_id, this.restaurant, false);
      await one(c, "SELECT id FROM payment_intent WHERE id=$1 AND provider='PAYOS'", [id]);
      await audit(
        c,
        this.restaurant,
        actor,
        id,
        'PAYOS_ADMIN_REFRESH_REQUESTED',
        'Quản trị yêu cầu đối chiếu lại bằng chứng payOS',
        { sessionId: ref.session_id },
      );
    });
    const result = await this.process(id, true, false);
    if (result === 'BUSY')
      reject('Khoản thanh toán đang được hệ thống kiểm tra. Vui lòng chờ ít giây.');
    if (result === 'FAILED' || result === 'WAITING') reject(safeError, 503);
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
      const lease = await one(
        c,
        "UPDATE payos_payment_request SET lease_until=now()+interval '60 seconds',next_poll_at=now()+interval '30 seconds' WHERE id=$1 RETURNING lease_until::text AS lease_token",
        [q.id],
      );
      return { ...q, lease_token: lease.lease_token };
    });
  }
  async process(id: string, force: boolean, allowCreate = true) {
    const started = Date.now();
    const provider = this.requireProvider(),
      q = await this.claim(id, force);
    if (!q) {
      this.observe(force ? 'REFRESH_BUSY' : 'POLL_SKIPPED', { paymentIntentId: id });
      return force ? 'BUSY' : 'SKIPPED';
    }
    this.observe('PROVIDER_CHECK', { paymentIntentId: id, orderCode: String(q.order_code) });
    try {
      let link: PaymentLink | undefined, created: CreatePaymentLinkResponse | undefined;
      if (!q.payment_link_id) {
        try {
          link = await provider.get(Number(q.order_code));
        } catch (error) {
          if (!provider.isNotFound(error)) throw error;
        }
        if (
          allowCreate &&
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
            !normalizePayosAccount(created.accountNumber) ||
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
            const storedRecipient = normalizePayosAccount(attached.account_number);
            if (
              storedRecipient &&
              storedRecipient !== normalizePayosAccount(created!.accountNumber)
            )
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
        if (
          !link &&
          !allowCreate &&
          !q.cancel_requested &&
          new Date(q.expires_at).getTime() > Date.now()
        )
          throw Error('PAYOS_LINK_NOT_READY');
        if (!link) {
          // A confirmed missing provider order is safe to release; an unknown network outcome is not.
          await transaction(this.db, async (c) => {
            await session(c, q.session_id, this.restaurant, false);
            const latest = await one(
              c,
              `SELECT q.*,q.lease_until::text AS lease_token,p.status AS intent_status
               FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id
               WHERE q.id=$1 FOR UPDATE OF q`,
              [q.id],
            );
            // The GET can have raced a verified webhook. An old not-found answer
            // must never release money or overwrite a newly attached/paid link.
            if (
              latest.lease_token !== q.lease_token ||
              latest.payment_link_id ||
              BigInt(latest.paid_amount) > 0n ||
              latest.intent_status === 'SUCCEEDED' ||
              terminal.includes(latest.provider_status) ||
              latest.reconciliation_status === 'OPEN'
            )
              return;
            const status = latest.cancel_requested ? 'CANCELLED' : 'EXPIRED';
            await c.query(
              'UPDATE payos_payment_request SET status=$2,provider_status=$2,last_error=NULL WHERE id=$1',
              [q.id, status],
            );
            await c.query(
              "UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1 AND status<>'SUCCEEDED'",
              [id, status],
            );
            await c.query(
              "UPDATE session_promotion SET expires_at=now() WHERE session_id=$1 AND status='RESERVED'",
              [q.session_id],
            );
            await recalculate(c, q.session_id);
          });
          return 'UPDATED';
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
      const applied = await this.applyLink(id, link);
      this.observe('PROVIDER_CHECKED', {
        paymentIntentId: id,
        orderCode: String(q.order_code),
        result: applied.status,
        latencyMs: Date.now() - started,
      });
      return applied.status === 'AWAITING_PROVIDER' ? 'WAITING' : 'UPDATED';
    } catch (error) {
      this.observe(
        'PROVIDER_ERROR',
        {
          paymentIntentId: id,
          orderCode: String(q.order_code),
          category: payosErrorCategory(error),
          latencyMs: Date.now() - started,
        },
        true,
      );
      await transaction(this.db, async (c) => {
        await session(c, q.session_id, this.restaurant, false);
        await c.query(
          `UPDATE payos_payment_request SET status=CASE WHEN reconciliation_status='OPEN' THEN 'REQUIRES_RECONCILIATION' WHEN provider_status IN ('PAID','CANCELLED','EXPIRED','FAILED') THEN status WHEN cancel_requested THEN 'CANCEL_PENDING' ELSE 'ERROR' END,last_error=CASE WHEN provider_status IN ('PAID','CANCELLED','EXPIRED','FAILED') THEN last_error ELSE $2 END,next_poll_at=now()+interval '30 seconds' WHERE id=$1 AND lease_until=$3::timestamptz`,
          [q.id, safeError, q.lease_token],
        );
        await recalculate(c, q.session_id);
      });
      return 'FAILED';
    } finally {
      // A webhook never releases a worker's lease. Only the exact claim that
      // obtained it can release it, including stale/mismatched snapshot paths.
      await this.db.pool.query(
        'UPDATE payos_payment_request SET lease_until=NULL WHERE id=$1 AND lease_until=$2::timestamptz',
        [q.id, q.lease_token],
      );
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
    let recordedCount = 0;
    const result = await transaction(this.db, async (c) => {
      const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      const s = await session(c, ref.session_id, this.restaurant, false);
      const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      const q = await one(
        c,
        'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
        [id],
      );
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
      const webhookBank = webhook
        ? link.transactions.find((bank) => bank.reference === webhook.reference)
        : undefined;
      if (
        webhook &&
        (webhook.paymentLinkId !== link.id ||
          webhook.orderCode !== link.orderCode ||
          webhook.currency !== 'VND' ||
          (webhookBank &&
            (webhookBank.amount !== webhook.amount || !sameRecipient(webhookBank, webhook))))
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
      if (webhook && !webhookBank) {
        // A verified webhook can precede the provider's GET snapshot. Keep it
        // retryable and schedule a read, rather than poisoning the intent forever.
        await c.query('UPDATE payos_payment_request SET next_poll_at=now() WHERE id=$1', [q.id]);
        return { status: 'AWAITING_PROVIDER' };
      }
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
        ((terminal.includes(q.provider_status) && !terminal.includes(link.status)) ||
          (q.provider_status === 'PAID' && pi.status === 'SUCCEEDED' && link.status !== 'PAID')) &&
        BigInt(q.paid_amount) === actual
      )
        return { status: 'STALE_IGNORED' };
      if (link.status === 'PAID' && actual === 0n) {
        // A status label alone cannot settle a bill. Wait for signed bank facts
        // without releasing the reservation or claiming that money was received.
        await c.query(
          `UPDATE payos_payment_request SET status=CASE WHEN reconciliation_status='OPEN'
            THEN 'REQUIRES_RECONCILIATION' ELSE 'PROCESSING' END,
            next_poll_at=now()+interval '5 seconds' WHERE id=$1`,
          [q.id],
        );
        return { status: 'AWAITING_PROVIDER' };
      }
      await c.query(
        `UPDATE payos_payment_request SET payment_link_id=$2,checkout_url=COALESCE(checkout_url,$3),
          provider_status=$4,paid_amount=$5,next_poll_at=now()+interval '30 seconds' WHERE id=$1`,
        [q.id, link.id, checkout(link.id), link.status, actual.toString()],
      );
      await audit(
        c,
        this.restaurant,
        null,
        id,
        'PAYOS_PROVIDER_REPORTED',
        'payOS đã báo dữ liệu giao dịch có chữ ký hợp lệ',
        {
          orderCode: String(q.order_code),
          paymentLinkId: link.id,
          bankReportedAmount: actual.toString(),
          providerStatus: link.status,
          references: link.transactions.map((bank) => bank.reference),
        },
      );
      const expectedRecipient = normalizePayosAccount(q.account_number);
      if (actual > 0n && !expectedRecipient) {
        // GET/webhook transaction recipients cannot establish their own expected
        // destination. A separately verified create response must anchor it.
        await reconciliation(
          c,
          this.restaurant,
          pi,
          { ...q, paid_amount: actual.toString() },
          'Chưa có bằng chứng tài khoản nhận từ lúc tạo link payOS.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      const corroboration = new Map<string, PayosRecipient>();
      if (link.transactions.length) {
        const proofs = (
          await c.query(
            `SELECT provider_event_id,payload_snapshot FROM payment_webhook_event
            WHERE provider='PAYOS' AND signature_valid AND provider_event_id=ANY($1::text[])
              AND payload_snapshot->>'restaurantId'=$2 AND payload_snapshot->>'orderCode'=$3
              AND payload_snapshot->>'paymentLinkId'=$4 AND payload_snapshot->>'currency'='VND'
              AND payload_snapshot->>'code'='00' AND payload_snapshot->>'recipientEvidenceVersion'='2'`,
            [
              link.transactions.map((bank) => bank.reference),
              this.restaurant,
              String(q.order_code),
              link.id,
            ],
          )
        ).rows;
        for (const proof of proofs) {
          const bank = link.transactions.find(
            (entry) => entry.reference === proof.provider_event_id,
          );
          if (bank && String(bank.amount) === String(proof.payload_snapshot.amount))
            corroboration.set(bank.reference, {
              accountNumber: proof.payload_snapshot.recipientAccountNumber,
              virtualAccountNumber: proof.payload_snapshot.recipientVirtualAccountNumber,
            });
        }
      }
      if (webhook && webhookBank) corroboration.set(webhook.reference, webhook);
      const trustedPrimary = expectedRecipient
        ? trustedPayosPrimary(
            this.config,
            this.restaurant,
            expectedRecipient,
            q.qr_code,
            q.payment_link_id,
            link.id,
          )
        : undefined;
      if (
        expectedRecipient &&
        link.transactions.some(
          (bank) =>
            !recipientMatchesWithEvidence(
              expectedRecipient,
              bank,
              corroboration.get(bank.reference),
              trustedPrimary,
            ),
        )
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          { ...q, paid_amount: actual.toString() },
          'Tài khoản nhận tiền payOS không khớp kênh đã tạo.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      // A delayed identity recovery must not mistake retry time for receipt time.
      // Only a pre-existing signed-GET audit observed before expiry can bridge
      // this one guard; never infer a timezone from provider display timestamps.
      const recoverableIdentityCase =
        q.reconciliation_status === 'OPEN' &&
        recoverableReasons.includes(q.reconciliation_reason) &&
        oldQuarantine.length === 0;
      let timelyIdentityReceipt = false;
      if (
        q.reconciliation_reason === 'Tài khoản nhận tiền payOS không khớp kênh đã tạo.' &&
        recoverableIdentityCase &&
        pi.status === 'REQUIRES_RECONCILIATION' &&
        s.session_status === 'ACTIVE' &&
        !q.cancel_requested &&
        prior.length === 0 &&
        actual > 0n &&
        actual <= BigInt(pi.amount) &&
        new Date(pi.expires_at).getTime() <= Date.now()
      ) {
        const evidence = await c.query(
          `SELECT 1 FROM business_audit_event e
           WHERE e.restaurant_id=$1 AND e.resource_id=$2 AND e.resource_type='PAYMENT_INTENT'
             AND e.action='PAYOS_PROVIDER_REPORTED'
             AND e.created_at >= $3::timestamptz AND e.created_at < $4::timestamptz
             AND e.details->>'orderCode'=$5 AND e.details->>'paymentLinkId'=$6
             AND e.details->>'bankReportedAmount'=$7
             AND e.details->'references' @> $8::jsonb AND e.details->'references' <@ $8::jsonb
           LIMIT 1`,
          [
            this.restaurant,
            id,
            pi.created_at,
            pi.expires_at,
            String(q.order_code),
            link.id,
            actual.toString(),
            JSON.stringify([...seen]),
          ],
        );
        timelyIdentityReceipt = evidence.rows.length === 1;
      }
      const quoteInvalidatedAtReceipt =
        q.cancel_requested ||
        ['CANCELLED', 'EXPIRED'].includes(pi.status) ||
        (new Date(pi.expires_at).getTime() <= Date.now() && !timelyIdentityReceipt);

      const late =
        (!['CREATED', 'PENDING', 'SUCCEEDED'].includes(pi.status) && !recoverableIdentityCase) ||
        quoteInvalidatedAtReceipt;
      const hasNewMoney = link.transactions.some(
        (bank) =>
          ![...prior, ...oldQuarantine].some(
            (previous: Record<string, unknown>) => previous.reference === bank.reference,
          ),
      );
      const usesPrimaryBridge =
        expectedRecipient &&
        trustedPrimary &&
        link.transactions.some(
          (bank) =>
            !recipientMatchesWithEvidence(
              expectedRecipient,
              bank,
              corroboration.get(bank.reference),
            ),
        );
      if (
        usesPrimaryBridge &&
        hasNewMoney &&
        (quoteInvalidatedAtReceipt || s.session_status !== 'ACTIVE')
      ) {
        await reconciliation(
          c,
          this.restaurant,
          pi,
          { ...q, paid_amount: actual.toString() },
          s.session_status !== 'ACTIVE'
            ? 'Tiền payOS đến sau khi phiên đã đóng; cần hoàn ngoài phiếu đã chốt.'
            : 'Tiền payOS đến khi khoản thu đã hủy hoặc hết hạn.',
        );
        return { status: 'REQUIRES_RECONCILIATION' };
      }
      await audit(
        c,
        this.restaurant,
        null,
        id,
        'PAYOS_PROVIDER_VERIFIED',
        'Đã kiểm tra dữ liệu giao dịch do payOS ký',
        {
          orderCode: String(q.order_code),
          paymentLinkId: link.id,
          bankReportedAmount: actual.toString(),
          providerStatus: link.status,
          references: link.transactions.map((bank) => bank.reference),
        },
      );

      // A signed replay still reports the original gross bank receipt after an
      // actual refund. It must not reopen an admin-resolved overpayment forever.
      if (q.reconciliation_status === 'RESOLVED' && !hasNewMoney) return { status: 'PROCESSED' };
      await c.query(
        `UPDATE payos_payment_request SET payment_link_id=$2,checkout_url=COALESCE(checkout_url,$3),provider_status=$4,paid_amount=$5,last_error=NULL,next_poll_at=now()+interval '30 seconds' WHERE id=$1`,
        [q.id, link.id, checkout(link.id), link.status, actual.toString()],
      );
      let anomaly =
        (q.reconciliation_status === 'OPEN' && !recoverableIdentityCase) ||
        (late && hasNewMoney && actual > 0n) ||
        actual > BigInt(pi.amount);
      const quarantine = Array.isArray(q.quarantined_transactions)
        ? q.quarantined_transactions
        : [];
      for (const reference of [...seen].sort())
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'PAYOS:' + reference,
        ]);
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
          await this.completeBankEvent(c, String(q.order_code), link.id, bank, existing.id);
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
              quoteInvalidatedAtReceipt,
            }),
          ],
        );
        recordedCount++;
        await this.completeBankEvent(c, String(q.order_code), link.id, bank, payment.id);
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
      if (recoverableIdentityCase && !anomaly) {
        const sources = await readRefundSourceBudgets(c, pi.session_id, null, null, id);
        const recorded = sources.reduce((sum, source) => sum + BigInt(source.amount), 0n);
        const applied = sources.reduce((sum, source) => sum + BigInt(source.allocated_amount), 0n);
        const returned = sources.reduce((sum, source) => sum + BigInt(source.refunded_amount), 0n);
        const originalApplied = sources.reduce(
          (sum, source) => sum + BigInt(source.original_allocated_amount),
          0n,
        );
        const currentAccount =
          s.session_status === 'ACTIVE' ? await recalculate(c, pi.session_id) : null;
        // Old receipts skip the insert/allocation loop. Revalidate their current
        // source budgets before clearing any former identity or generic exception.
        if (
          recorded !== actual ||
          recorded - returned !== applied ||
          sources.some((source) => BigInt(source.refundable_amount) > 0n) ||
          BigInt(currentAccount?.refund_due_amount ?? '0') > 0n ||
          (link.status === 'PAID' && originalApplied < BigInt(pi.amount))
        )
          anomaly = true;
      }
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
            : link.status === 'PROCESSING' ||
                (actual === BigInt(pi.amount) && !terminal.includes(link.status))
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
            anomaly = true;
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
      if (!anomaly && recoverableIdentityCase) {
        await c.query(
          `UPDATE payos_payment_request SET reconciliation_status=NULL,resolved_by=NULL,
            resolved_at=now(),last_error=NULL WHERE id=$1`,
          [q.id],
        );
        if (q.alert_id)
          await c.query(
            `UPDATE operational_alert SET status='RESOLVED',resolved_by=NULL,resolved_at=now(),
            resolution_note='Hệ thống đã xác minh lại đầy đủ bằng chứng payOS và ghi nhận đúng khoản thu.'
            WHERE id=$1`,
            [q.alert_id],
          );
        await audit(
          c,
          this.restaurant,
          null,
          id,
          'PAYOS_VERIFICATION_RECOVERED',
          'Tự động khôi phục khoản thu sau khi xác minh đầy đủ bằng chứng payOS',
          {
            sessionId: pi.session_id,
            previousReason: q.reconciliation_reason,
            bankReportedAmount: actual.toString(),
            references: link.transactions.map((bank) => bank.reference),
          },
        );
      }
      if (terminal.includes(link.status))
        await c.query(
          "UPDATE session_promotion SET expires_at=now() WHERE session_id=$1 AND status='RESERVED'",
          [pi.session_id],
        );
      if (webhookEventId && webhook) {
        const payment = (
          await c.query(
            "SELECT id FROM payment_transaction WHERE provider='PAYOS' AND provider_transaction_id=$1 AND payment_intent_id=$2 AND amount=$3",
            [webhook.reference, id, String(webhook.amount)],
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
    const outcome = {
      paymentIntentId: id,
      orderCode: String(link.orderCode),
      result: result.status,
      paidAmount: actual.toString(),
      providerStatus: link.status,
      recordedCount,
    };
    if (recordedCount > 0) this.observe('RECORDED', outcome);
    this.observe(recordedCount > 0 ? 'ACCOUNT_UPDATED' : 'SNAPSHOT_APPLIED', outcome);
    return result;
  }
  private async completeBankEvent(
    c: Connection,
    orderCode: string,
    linkId: string,
    bank: PaymentLink['transactions'][number],
    paymentId: string,
  ) {
    await c.query(
      `UPDATE payment_webhook_event SET processing_status='PROCESSED',processed_at=now(),payment_transaction_id=$1
       WHERE provider='PAYOS' AND provider_event_id=$2 AND signature_valid
       AND processing_status IN ('RECEIVED','UNMATCHED','REJECTED')
       AND payload_snapshot->>'currency'='VND' AND payload_snapshot->>'code'='00'
       AND payload_snapshot->>'orderCode'=$3 AND payload_snapshot->>'paymentLinkId'=$4 AND payload_snapshot->>'amount'=$5`,
      [paymentId, bank.reference, orderCode, linkId, String(bank.amount)],
    );
  }
  async webhook(body: unknown) {
    const provider = this.requireProvider();
    const started = Date.now();
    this.observe('RECEIVED');
    let data: WebhookData;
    try {
      data = await provider.verify(body);
    } catch {
      this.observe('REJECTED', { category: 'INVALID_SIGNATURE' }, true);
      reject('Chữ ký payOS không hợp lệ.', 400);
    }
    if (!Number.isSafeInteger(data.orderCode) || data.orderCode < 0)
      reject('Mã thông báo payOS không hợp lệ.', 400);
    num(data.amount);
    text(data.reference, 160);
    text(data.paymentLinkId, 160);
    this.observe('VERIFIED', { orderCode: String(data.orderCode) });
    const minimal = {
      orderCode: data.orderCode,
      amount: data.amount,
      reference: data.reference,
      paymentLinkId: data.paymentLinkId,
      currency: data.currency,
      code: data.code,
    };
    const recipientProof = {
      recipientEvidenceVersion: 2,
      recipientAccountNumber: normalizePayosAccount(data.accountNumber),
      recipientVirtualAccountNumber: normalizePayosAccount(data.virtualAccountNumber),
    };
    const hash = digest(JSON.stringify({ ...minimal, ...recipientProof }));
    const legacyHash = digest(JSON.stringify(minimal));
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
        if (old.payload_hash !== hash) {
          // Old snapshots omitted recipients. Only a newly signature-verified
          // replay with identical original bank facts may upgrade that evidence.
          if (
            old.payload_hash !== legacyHash ||
            !old.signature_valid ||
            old.payload_snapshot?.restaurantId !== this.restaurant
          )
            reject('Tham chiếu payOS có dữ liệu không khớp.');
          await c.query(
            `INSERT INTO business_audit_event(restaurant_id,action,resource_type,resource_id,reason,details,actor_type)
             VALUES($1,'PAYOS_WEBHOOK_EVIDENCE_UPGRADED','PAYMENT_WEBHOOK_EVENT',$2,
               'Bổ sung tài khoản nhận từ lần gửi lại đã xác minh chữ ký',$3,'SYSTEM')`,
            [
              this.restaurant,
              old.id,
              JSON.stringify({
                previousPayloadHash: old.payload_hash,
                previousSnapshot: old.payload_snapshot,
                verifiedPayloadHash: hash,
              }),
            ],
          );
          return one(
            c,
            'UPDATE payment_webhook_event SET payload_hash=$2,payload_snapshot=$3 WHERE id=$1 RETURNING *',
            [
              old.id,
              hash,
              JSON.stringify({ ...minimal, ...recipientProof, restaurantId: this.restaurant }),
            ],
          );
        }
        return old;
      }
      return one(
        c,
        `INSERT INTO payment_webhook_event(provider,provider_event_id,provider_transaction_id,payload_hash,payload_snapshot,signature_valid) VALUES('PAYOS',$1,$1,$2,$3,true) RETURNING *`,
        [
          data.reference,
          hash,
          JSON.stringify({ ...minimal, ...recipientProof, restaurantId: this.restaurant }),
        ],
      );
    });
    if (event.processing_status === 'PROCESSED') {
      this.observe('DUPLICATE', { orderCode: String(data.orderCode) });
      return { status: 'PROCESSED' };
    }
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
      this.observe('UNMATCHED', { orderCode: String(data.orderCode) }, true);
      return { status: 'UNMATCHED' };
    }
    this.observe('MATCHED', {
      paymentIntentId: ref.id,
      orderCode: String(data.orderCode),
      amount: String(data.amount),
    });
    if (
      data.currency !== 'VND' ||
      data.code !== '00' ||
      (ref.payment_link_id && ref.payment_link_id !== data.paymentLinkId)
    ) {
      await this.db.pool.query(
        "UPDATE payment_webhook_event SET processing_status='REJECTED',processed_at=now() WHERE id=$1",
        [event.id],
      );
      this.observe(
        'REJECTED',
        {
          paymentIntentId: ref.id,
          orderCode: String(data.orderCode),
          category: 'METADATA_MISMATCH',
        },
        true,
      );
      return { status: 'REJECTED' };
    }
    let link: PaymentLink;
    try {
      link = await provider.get(Number(data.orderCode));
    } catch (error) {
      this.observe(
        'RETRY_REQUIRED',
        {
          paymentIntentId: ref.id,
          orderCode: String(data.orderCode),
          category: payosErrorCategory(error),
        },
        true,
      );
      reject('Chưa đối chiếu được payOS; webhook cần gửi lại.', 503);
    }
    const result = await this.applyLink(ref.id, link, data, event.id);
    if (result.status === 'AWAITING_PROVIDER') {
      this.observe(
        'RETRY_REQUIRED',
        { paymentIntentId: ref.id, orderCode: String(data.orderCode), category: 'SNAPSHOT_LAG' },
        true,
      );
      reject('payOS đang cập nhật giao dịch; webhook cần gửi lại.', 503);
    }
    await transaction(this.db, async (c) => {
      const payment = (
        await c.query(
          "SELECT id FROM payment_transaction WHERE provider='PAYOS' AND provider_transaction_id=$1 AND payment_intent_id=$2 AND amount=$3",
          [data.reference, ref.id, String(data.amount)],
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
    this.observe('WEBHOOK_COMPLETED', {
      paymentIntentId: ref.id,
      orderCode: String(data.orderCode),
      result: result.status,
      latencyMs: Date.now() - started,
    });
    return result;
  }
  async maintain() {
    if (!this.provider || !this.capabilities.online) return;
    const rows = (
      await this.db.pool.query(
        `SELECT p.id FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND q.next_poll_at<=now() AND (q.status IN ('CREATE_PENDING','PENDING','PROCESSING','UNDERPAID','CANCEL_PENDING') OR (q.status='ERROR' AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED')) OR (q.reconciliation_status='OPEN' AND (
            COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED') OR
            (q.reconciliation_reason=ANY($2::text[]) AND q.paid_amount<=p.amount
              AND jsonb_array_length(q.quarantined_transactions)=0)
          ))) ORDER BY q.next_poll_at LIMIT 10`,
        [this.restaurant, recoverableReasons],
      )
    ).rows;
    for (const row of rows) await this.process(row.id, false);
  }
  async cases() {
    const rows = (
      await this.db.pool.query(
        `WITH recent_history AS (
         SELECT history_q.id
         FROM payos_payment_request history_q
         JOIN payment_intent history_p ON history_p.id=history_q.payment_intent_id
         JOIN table_session history_s ON history_s.id=history_p.session_id
         JOIN dining_table history_t ON history_t.id=history_s.table_id
         WHERE history_t.restaurant_id=$1 AND
           (history_q.reconciliation_status='RESOLVED' OR
             (history_q.reconciliation_status IS NULL AND history_q.resolved_at IS NOT NULL))
         ORDER BY history_q.updated_at DESC,history_q.id DESC LIMIT 100
       )
       SELECT p.id,p.id AS payment_intent_id,p.session_id,t.code AS table_code,s.session_status,
        p.amount::text,q.paid_amount::text,
        COALESCE(funds.recorded_amount,0)::text AS recorded_amount,
        COALESCE(funds.allocated_amount,0)::text AS allocated_amount,
        COALESCE(funds.original_allocated_amount,0)::text AS original_allocated_amount,
        COALESCE(funds.refunded_amount,0)::text AS refunded_amount,
        COALESCE(funds.unapplied_amount,0)::text AS unapplied_amount,
        COALESCE(fa.refund_due_amount,0)::text AS refund_due_amount,
        COALESCE((SELECT sum((x->>'amount')::bigint)
          FROM jsonb_array_elements(q.quarantined_transactions) x),0)::text AS quarantined_amount,
        COALESCE(q.provider_status,q.status) AS provider_status,q.last_error,q.updated_at,
        q.reconciliation_reason AS reason,COALESCE(q.reconciliation_status,'RESOLVED') AS status,
        q.reconciliation_status AS active_reconciliation_status,q.resolved_at,
        verified.created_at AS verified_at,
        COALESCE(reported.details->'references',verified.details->'references','[]'::jsonb) AS provider_references,
        acknowledged.created_at AS acknowledged_at,acknowledged.display_name AS acknowledged_by_name,
        CASE WHEN q.resolved_at IS NOT NULL THEN COALESCE(recovered.reason,q.reconciliation_reason)
          ELSE NULL END AS resolution_note,
        (q.cancel_requested OR p.status IN ('CANCELLED','EXPIRED') OR EXISTS(
          SELECT 1 FROM payment_transaction receipt WHERE receipt.payment_intent_id=p.id
          AND receipt.status='SUCCEEDED' AND receipt.metadata->>'quoteInvalidatedAtReceipt'='true'
        )) AS quote_invalidated_at_receipt
       FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id
       JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id
       LEFT JOIN session_financial_account fa ON fa.session_id=p.session_id
       ${payosIntentFundsJoin}
       LEFT JOIN LATERAL (
         SELECT e.created_at,e.details FROM business_audit_event e
         WHERE e.restaurant_id=$1 AND e.resource_id=p.id AND e.action='PAYOS_PROVIDER_VERIFIED'
           AND e.created_at>=COALESCE((SELECT max(opened.created_at) FROM business_audit_event opened
             WHERE opened.resource_id=p.id AND opened.restaurant_id=$1
               AND opened.action='PAYOS_RECONCILIATION_REQUIRED'),p.created_at)
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) verified ON true
       LEFT JOIN LATERAL (
         SELECT e.created_at,e.details FROM business_audit_event e
         WHERE e.restaurant_id=$1 AND e.resource_id=p.id
           AND e.action IN ('PAYOS_PROVIDER_REPORTED','PAYOS_PROVIDER_VERIFIED')
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) reported ON true
       LEFT JOIN LATERAL (
         SELECT e.created_at,u.display_name FROM business_audit_event e
         LEFT JOIN app_user u ON u.id=e.actor_id AND u.restaurant_id=e.restaurant_id
         WHERE e.restaurant_id=$1 AND e.resource_id=p.id
           AND e.action='PAYOS_RECONCILIATION_ACKNOWLEDGED'
           AND e.created_at>=COALESCE((SELECT max(opened.created_at) FROM business_audit_event opened
             WHERE opened.resource_id=p.id AND opened.restaurant_id=$1
               AND opened.action='PAYOS_RECONCILIATION_REQUIRED'),p.created_at)
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) acknowledged ON true
       LEFT JOIN LATERAL (
         SELECT e.reason FROM business_audit_event e
         WHERE e.restaurant_id=$1 AND e.resource_id=p.id AND e.action='PAYOS_VERIFICATION_RECOVERED'
           AND e.created_at>=q.resolved_at
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1
       ) recovered ON true
       WHERE t.restaurant_id=$1 AND
         (q.reconciliation_status='OPEN' OR q.id IN (SELECT id FROM recent_history))
       ORDER BY (q.reconciliation_status='OPEN') DESC NULLS LAST,q.updated_at DESC,q.id DESC`,
        [this.restaurant],
      )
    ).rows;
    return rows.map((row) => {
      const readiness = payosResolutionReadiness({
        sessionStatus: row.session_status,
        providerStatus: row.provider_status,
        requestedAmount: row.amount,
        bankReportedAmount: row.paid_amount,
        quarantinedAmount: row.quarantined_amount,
        recordedAmount: row.recorded_amount,
        allocatedAmount: row.allocated_amount,
        originalAllocatedAmount: row.original_allocated_amount,
        refundedAmount: row.refunded_amount,
        unappliedAmount: row.unapplied_amount,
        sessionRefundDue: row.refund_due_amount,
        quoteInvalidatedAtReceipt: row.quote_invalidated_at_receipt === true,
        verified: row.verified_at !== null,
        open: row.active_reconciliation_status === 'OPEN',
      });
      const {
        active_reconciliation_status: _active,
        original_allocated_amount: _original,
        quote_invalidated_at_receipt: _invalidated,
        ...view
      } = row;
      void _active;
      void _original;
      void _invalidated;
      return {
        ...view,
        verified_at: row.verified_at ? new Date(row.verified_at).toISOString() : null,
        acknowledged_at: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
        resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        provider_references: Array.isArray(row.provider_references) ? row.provider_references : [],
        can_resolve: readiness.canResolve,
        resolution_blockers: readiness.blockers,
        can_return_externally: false,
      };
    });
  }
  async resolve(id: string, actor: string, b: Record<string, unknown>) {
    if (b.resolution === 'RETURNED_EXTERNALLY')
      reject(
        'Chưa có bằng chứng hoàn tiền đã xác minh từ ngân hàng. Mã giao dịch nhập tay không đủ để đóng hồ sơ.',
      );
    const reason =
      b.reason == null || b.reason === ''
        ? 'Hoàn tất đối soát theo bằng chứng payOS và số liệu tài chính đã xác minh.'
        : text(b.reason, 300);
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
        reject(
          'payOS chưa xác nhận khoản thanh toán đã kết thúc. Hãy kiểm tra lại; khoản đang chờ không thể đóng hồ sơ.',
        );
      const quarantine = q.quarantined_transactions.reduce(
        (sum: bigint, x: { amount: string }) => sum + BigInt(x.amount),
        0n,
      );
      const captured = BigInt(
        (
          await one(
            c,
            "SELECT COALESCE(sum(amount),0)::text AS amount FROM payment_transaction WHERE payment_intent_id=$1 AND provider='PAYOS' AND status='SUCCEEDED'",
            [id],
          )
        ).amount,
      );
      const sources = (await readRefundSourceBudgets(c, pi.session_id, null, null, id)).filter(
        (source) => source.provider === 'PAYOS',
      );
      const sourceDue = sources.reduce((sum, source) => sum + BigInt(source.refundable_amount), 0n);
      const readinessAccount =
        s.session_status === 'ACTIVE'
          ? await recalculate(c, pi.session_id)
          : (
              await c.query(
                'SELECT refund_due_amount::text FROM session_financial_account WHERE session_id=$1',
                [pi.session_id],
              )
            ).rows[0];
      const checked = await one(
        c,
        `SELECT
        EXISTS(SELECT 1 FROM business_audit_event e WHERE e.restaurant_id=$2 AND e.resource_id=$1
          AND e.action='PAYOS_PROVIDER_VERIFIED'
          AND e.created_at>=COALESCE((SELECT max(opened.created_at) FROM business_audit_event opened
            WHERE opened.resource_id=$1 AND opened.restaurant_id=$2
              AND opened.action='PAYOS_RECONCILIATION_REQUIRED'),'epoch'::timestamptz)) AS verified,
        EXISTS(SELECT 1 FROM payment_transaction receipt WHERE receipt.payment_intent_id=$1
          AND receipt.status='SUCCEEDED' AND receipt.metadata->>'quoteInvalidatedAtReceipt'='true') AS invalidated`,
        [id, this.restaurant],
      );
      const readiness = payosResolutionReadiness({
        sessionStatus: s.session_status,
        providerStatus: q.provider_status,
        requestedAmount: String(pi.amount),
        bankReportedAmount: String(q.paid_amount),
        quarantinedAmount: quarantine.toString(),
        recordedAmount: captured.toString(),
        allocatedAmount: sources
          .reduce((sum, source) => sum + BigInt(source.allocated_amount), 0n)
          .toString(),
        originalAllocatedAmount: sources
          .reduce((sum, source) => sum + BigInt(source.original_allocated_amount), 0n)
          .toString(),
        refundedAmount: sources
          .reduce((sum, source) => sum + BigInt(source.refunded_amount), 0n)
          .toString(),
        unappliedAmount: sourceDue.toString(),
        sessionRefundDue: String(readinessAccount?.refund_due_amount ?? '0'),
        quoteInvalidatedAtReceipt:
          checked.invalidated || q.cancel_requested || ['CANCELLED', 'EXPIRED'].includes(pi.status),
        verified: checked.verified === true,
        open: q.reconciliation_status === 'OPEN',
      });
      if (!readiness.canResolve) reject(readiness.blockers.join(' '));
      if (sourceDue > 0n)
        reject(
          'Hoàn thực tế phần tiền chưa phân bổ của đúng giao dịch payOS trước khi đóng đối soát.',
        );
      if (
        sources.some(
          (source) =>
            BigInt(source.amount) - BigInt(source.refunded_amount) !==
            BigInt(source.allocated_amount),
        )
      )
        reject(
          'Sổ tiền payOS sau hoàn chưa khớp phân bổ. Kiểm tra nguồn hoàn trước khi đóng đối soát.',
        );
      let reference: string | null = null;
      let fulfilledQuote = false;
      let cancelledQuote = false;
      if (s.session_status !== 'ACTIVE' || quarantine > 0n) {
        if (b.resolution !== 'RETURNED_EXTERNALLY' || quarantine <= 0n)
          reject('Tiền đến sau đóng phiên phải được hoàn ngoài phiếu đã chốt.');
        reference = text(b.reference, 120);
      } else {
        if (b.resolution !== 'RECONCILED')
          reject('Chọn xác nhận đã đối soát khoản tại phiên đang mở.', 400);
        if (
          captured !== BigInt(q.paid_amount) ||
          (q.provider_status === 'PAID' && captured < BigInt(pi.amount))
        )
          reject(
            'Tiền payOS chưa khớp sổ thu. Kiểm tra trạng thái và giao dịch trước khi đóng đối soát.',
          );
        const originalApplied = sources.reduce(
          (sum, source) => sum + BigInt(source.original_allocated_amount),
          0n,
        );
        fulfilledQuote = originalApplied >= BigInt(pi.amount);
        if (q.provider_status === 'PAID' && !fulfilledQuote) {
          const invalidated = await one(
            c,
            `SELECT EXISTS(SELECT 1 FROM payment_transaction t
              WHERE t.payment_intent_id=$1 AND t.provider='PAYOS' AND t.status='SUCCEEDED'
                AND (t.metadata->>'quoteInvalidatedAtReceipt'='true'
                  OR t.confirmed_at >= $2::timestamptz)) AS before_receipt`,
            [id, pi.expires_at],
          );
          if (!invalidated.before_receipt)
            reject(
              'Khoản thu chưa được phân bổ đủ cho phạm vi đã yêu cầu; không thể xác nhận đã thanh toán.',
            );
          // A canceled/expired quote can be closed after actual returns without
          // claiming that its original, now invalid scope was fully paid.
          cancelledQuote = true;
        }
        const account = await recalculate(c, pi.session_id);
        if (BigInt(account.refund_due_amount) > 0n)
          reject('Hoàn tất phiếu hoàn tiền cho khách trước khi đóng đối soát.');
      }
      // Externally returned, quarantined funds never become a successful bill payment.
      const onlineStatus =
        cancelledQuote || (reference && captured < BigInt(pi.amount))
          ? 'CANCELLED'
          : q.provider_status;
      const intentStatus = onlineStatus === 'PAID' ? 'SUCCEEDED' : onlineStatus;
      await c.query(
        `UPDATE payos_payment_request SET reconciliation_status='RESOLVED',resolved_by=$2,resolved_at=now(),reconciliation_reason=$3,last_error=NULL,status=$4 WHERE id=$1`,
        [q.id, actor, reason, onlineStatus],
      );
      await c.query(`UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1`, [
        id,
        intentStatus,
      ]);
      if (!reference && fulfilledQuote) {
        const settled = await recalculate(c, pi.session_id);
        await finishPaymentRequests(
          c,
          pi.session_id,
          pi.support_request_id,
          null,
          BigInt(settled.outstanding_amount) === 0n,
        );
      }
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
