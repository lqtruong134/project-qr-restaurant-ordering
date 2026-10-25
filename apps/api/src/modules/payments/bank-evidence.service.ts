import { requireOperationalPayosIntent } from './test-case-archive.service.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Database } from '@thesis/database';
import type {
  BankEvidenceContext,
  BankEvidenceFacts,
  BankEvidencePreview,
  BankEvidenceProof,
  BankEvidenceConfirmation,
} from '@thesis/contracts';
import {
  one,
  reject,
  session,
  transaction,
  text,
  uuid,
  money,
  type Connection,
} from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
import { finishPaymentRequests } from './payment-requests.routes.js';
import { trustedPayosPrimary } from './payos-adapter.js';
import {
  assertBankReferenceAvailable,
  bankReceiverDigest,
  postPayosReceipt,
} from './bank-receipt-posting.js';
import type { PayosService } from './payos.service.js';

const POLICY = 'BANK_ADMIN_VERIFIED_V1';
const proofRoot = () => resolve(process.env.PAYMENT_PROOF_DIR ?? '../../var/payment-proofs');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const timestamp = (value: unknown) =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();
type Row = Awaited<ReturnType<typeof one>>;
type EvidenceInput = {
  proofId: string;
  reference: string;
  amount: string;
  bankTransactionAt: string;
  reason: string;
};

export function parseBankEvidenceInput(body: Record<string, unknown>): EvidenceInput {
  if (body.attested !== true)
    reject('Cần xác nhận đã đối chiếu trực tiếp sao kê hoặc ứng dụng ngân hàng nhà hàng.', 400);
  const reference = text(body.reference, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(reference))
    reject('Mã giao dịch ngân hàng không hợp lệ.', 400);
  const rawTime = text(body.bankTransactionAt, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(rawTime) ||
    !Number.isFinite(Date.parse(rawTime))
  )
    reject('Thời điểm ngân hàng cần đầy đủ ngày, giờ và múi giờ.', 400);
  return {
    proofId: uuid(body.proofId),
    reference,
    amount: money(body.amount),
    bankTransactionAt: new Date(rawTime).toISOString(),
    reason: text(body.reason, 500),
  };
}

export class BankEvidenceService {
  constructor(
    readonly db: Database,
    readonly restaurant: string,
    readonly payos: PayosService,
  ) {}

  private async admin(c: Connection, actor: string) {
    const result = await c.query(
      `SELECT u.id FROM app_user u
       JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
       JOIN role r ON r.id=ur.role_id AND r.code='ADMIN'
       JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id
       WHERE u.id=$1 AND u.restaurant_id=$2 AND u.status='ACTIVE' AND p.code='admin.workspace'
       FOR SHARE OF u,ur,rp,p`,
      [actor, this.restaurant],
    );
    if (!result.rowCount) reject('Chỉ quản trị còn quyền mới được xác minh ngân hàng.', 403);
  }

  private async state(c: Connection, id: string, actor: string) {
    await this.admin(c, actor);
    const ref = await one(
      c,
      `SELECT p.session_id FROM payment_intent p JOIN table_session s ON s.id=p.session_id
       JOIN dining_table t ON t.id=s.table_id WHERE p.id=$1 AND t.restaurant_id=$2`,
      [id, this.restaurant],
    );
    const s = await session(c, ref.session_id, this.restaurant, false);
    await requireOperationalPayosIntent(c, this.restaurant, id);
    const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
    const q = await one(
      c,
      'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
      [id],
    );
    if (pi.provider !== 'PAYOS' || pi.method !== 'ONLINE')
      reject('Khoản thu không thuộc payOS.', 400);
    const account = await one(c, 'SELECT * FROM session_financial_account WHERE session_id=$1', [
      s.id,
    ]);
    const funds = await one(
      c,
      `SELECT COALESCE(sum(p.amount),0)::text AS recorded,
        COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount) FROM payment_allocation a
          JOIN payment_transaction p ON p.id=a.payment_transaction_id JOIN financial_charge f ON f.id=a.financial_charge_id
          WHERE p.payment_intent_id=$1 AND p.status='SUCCEEDED' AND f.status='ACTIVE'),0)::text AS applied
       FROM payment_transaction p WHERE p.payment_intent_id=$1 AND p.status='SUCCEEDED'`,
      [id],
    );
    const scoped = await one(
      c,
      `SELECT COALESCE(sum(greatest(f.amount-f.discount_amount-
      COALESCE((SELECT sum(a.allocated_amount-a.reversed_amount) FROM payment_allocation a
        JOIN payment_transaction p ON p.id=a.payment_transaction_id WHERE a.financial_charge_id=f.id AND p.status='SUCCEEDED'),0),0)),0)::text AS amount
      FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE' AND
      ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM order_item i WHERE i.id=f.order_item_id AND i.owner_participant_id=$2))`,
      [s.id, pi.collection_scope === 'PARTICIPANT' ? pi.payer_participant_id : null],
    );
    const reports = (
      await c.query(
        `SELECT details,created_at FROM business_audit_event WHERE restaurant_id=$1 AND resource_id=$2
       AND action='PAYOS_PROVIDER_REPORTED' ORDER BY created_at DESC,id DESC LIMIT 100`,
        [this.restaurant, id],
      )
    ).rows;
    // A verified webhook may arrive before GET catches up. Keep its exact
    // identity/amount visible to ADMIN; a different typed reference cannot hide it.
    const webhookFacts = (
      await c.query(
        `SELECT provider_event_id,payload_snapshot,created_at
      FROM payment_webhook_event WHERE provider='PAYOS' AND signature_valid
        AND payload_snapshot->>'restaurantId'=$1 AND payload_snapshot->>'orderCode'=$2
        AND payload_snapshot->>'paymentLinkId'=$3 AND payload_snapshot->>'currency'='VND'
        AND payload_snapshot->>'code'='00' AND payload_snapshot->>'recipientEvidenceVersion'='2'
      ORDER BY created_at DESC,id DESC LIMIT 200`,
        [this.restaurant, String(q.order_code), q.payment_link_id],
      )
    ).rows;
    for (const event of webhookFacts)
      reports.push({
        created_at: event.created_at,
        details: {
          orderCode: String(q.order_code),
          paymentLinkId: q.payment_link_id,
          references: [event.provider_event_id],
          receiptFacts: [
            { reference: event.provider_event_id, amount: String(event.payload_snapshot.amount) },
          ],
          bankReportedAmount: String(event.payload_snapshot.amount),
        },
      });
    const receiver = trustedPayosPrimary(
      this.payos.config,
      this.restaurant,
      q.account_number,
      q.qr_code,
      q.payment_link_id,
      q.payment_link_id,
    );
    const blockers: string[] = [];
    if (!receiver)
      blockers.push('Chưa cấu hình và xác minh tài khoản MB nhận của đúng kênh payOS.');
    if (
      !q.payment_link_id ||
      !q.account_number ||
      String(q.request_payload?.orderCode) !== String(q.order_code) ||
      String(q.request_payload?.amount) !== String(pi.amount)
    )
      blockers.push('Thiếu hoặc sai định danh bất biến từ lúc tạo khoản thu payOS.');
    if (s.session_status !== 'ACTIVE')
      blockers.push('Phiên đã đóng; cần xử lý ngoại lệ riêng, không thay đổi hóa đơn đã chốt.');
    if (q.cancel_requested || ['CANCELLED', 'EXPIRED', 'FAILED'].includes(pi.status))
      blockers.push('Khoản thu đã hủy hoặc vô hiệu; không được phân bổ bằng xác nhận ngân hàng.');
    const remaining =
      BigInt(pi.amount) > BigInt(funds.recorded) ? BigInt(pi.amount) - BigInt(funds.recorded) : 0n;
    if (!remaining) blockers.push('Khoản thu đã ghi nhận đủ; không tạo thêm giao dịch.');
    if (BigInt(account.outstanding_amount) === 0n) blockers.push('Hóa đơn không còn tiền cần thu.');
    const facts: BankEvidenceFacts = {
      intentId: id,
      sessionId: s.id,
      sessionCode: s.id.replaceAll('-', '').slice(-8).toUpperCase(),
      tableCode: s.table_code,
      sessionStatus: s.session_status,
      intentStatus: pi.status,
      providerStatus: q.provider_status,
      orderCode: String(q.order_code),
      paymentLinkId: q.payment_link_id,
      quoteAmount: String(pi.amount),
      bankReportedAmount: String(q.paid_amount),
      recordedAmount: funds.recorded,
      appliedAmount: funds.applied,
      outstandingAmount: String(account.outstanding_amount),
      remainingQuoteAmount: remaining.toString(),
      receiverBank: receiver ? 'MB Bank' : null,
      receiverAccountMasked: receiver ? '•••• ' + receiver.slice(-4) : null,
      providerReferences: [
        ...new Set(
          reports.flatMap((r: Row) =>
            Array.isArray(r.details?.references)
              ? r.details.references.filter((x: unknown) => typeof x === 'string')
              : [],
          ),
        ),
      ] as string[],
      createdAt: timestamp(pi.created_at),
      expiresAt: timestamp(pi.expires_at),
      canVerify: !blockers.length,
      blockers,
    };
    return {
      s,
      pi,
      q,
      account,
      funds,
      scopedAmount: scoped.amount as string,
      reports,
      receiver,
      facts,
    };
  }

  private proofView(proof: Row, id: string): BankEvidenceProof {
    return {
      id: proof.id,
      mime: proof.mime,
      sha256: proof.sha256,
      byteSize: proof.byte_size,
      uploadedAt: timestamp(proof.created_at),
      proofUrl: `/api/core/admin/payment-reconciliation/${id}/bank-evidence/proof/${proof.id}`,
    };
  }
  async context(id: string, actor: string): Promise<BankEvidenceContext> {
    return transaction(this.db, async (c) => {
      const { facts } = await this.state(c, id, actor);
      const proofs = (
        await c.query(
          'SELECT * FROM payment_bank_proof WHERE payment_intent_id=$1 AND restaurant_id=$2 AND uploaded_by=$3 ORDER BY created_at DESC LIMIT 20',
          [id, this.restaurant, actor],
        )
      ).rows;
      const history = (
        await c.query(
          'SELECT receipt_id,bank_reference,amount::text,created_at,proof_id FROM payment_bank_evidence WHERE payment_intent_id=$1 AND restaurant_id=$2 ORDER BY created_at DESC',
          [id, this.restaurant],
        )
      ).rows;
      return {
        facts,
        proofs: proofs.map((p) => this.proofView(p, id)),
        history: history.map((e) => ({
          receiptId: e.receipt_id,
          proofId: e.proof_id,
          reference: e.bank_reference,
          amount: e.amount,
          confirmedAt: timestamp(e.created_at),
        })),
      };
    });
  }
  private async proof(c: Connection, id: string, proofId: string, actor: string) {
    const p = await one(
      c,
      'SELECT * FROM payment_bank_proof WHERE id=$1 AND payment_intent_id=$2 AND restaurant_id=$3 AND uploaded_by=$4',
      [proofId, id, this.restaurant, actor],
    );
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(p.filename)) reject('Chứng từ không hợp lệ.');
    let bytes: Buffer;
    try {
      const file = await open(
        join(proofRoot(), p.filename),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== p.byte_size || info.size > 2 * 1024 * 1024)
          reject('Chứng từ đã thay đổi.');
        bytes = await file.readFile();
      } finally {
        await file.close();
      }
    } catch {
      reject('Không đọc được chứng từ ngân hàng đã lưu.', 409);
    }
    if (hash(bytes) !== p.sha256) reject('Nội dung chứng từ không khớp bản đã tải lên.');
    return { p, bytes };
  }
  async upload(id: string, actor: string, data: unknown): Promise<BankEvidenceProof> {
    if (
      typeof data !== 'string' ||
      !data.length ||
      data.length > 2800000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      reject('Chọn ảnh PNG, JPEG hoặc WebP tối đa 2 MB.', 400);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.toString('base64') !== data || bytes.length > 2 * 1024 * 1024)
      reject('Ảnh không hợp lệ hoặc vượt 2 MB.', 400);
    const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'jpg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : null;
    if (!ext) reject('Chỉ nhận ảnh PNG, JPEG hoặc WebP.', 400);
    let written: string | undefined;
    try {
      return await transaction(this.db, async (c) => {
        await this.state(c, id, actor);
        const filename = randomUUID() + '.' + ext;
        await mkdir(proofRoot(), { recursive: true, mode: 0o700 });
        written = join(proofRoot(), filename);
        const file = await open(written, 'wx', 0o600);
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
        const p = await one(
          c,
          `INSERT INTO payment_bank_proof(restaurant_id,payment_intent_id,uploaded_by,filename,sha256,mime,byte_size)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            this.restaurant,
            id,
            actor,
            filename,
            hash(bytes),
            ext === 'jpg' ? 'image/jpeg' : 'image/' + ext,
            bytes.length,
          ],
        );
        return this.proofView(p, id);
      });
    } catch (error) {
      if (written) await unlink(written).catch(() => {});
      throw error;
    }
  }
  async readProof(id: string, proofId: string, actor: string) {
    return transaction(this.db, async (c) => {
      await this.admin(c, actor);
      const p = await one(
        c,
        'SELECT uploaded_by FROM payment_bank_proof WHERE id=$1 AND payment_intent_id=$2 AND restaurant_id=$3',
        [proofId, id, this.restaurant],
      );
      await this.state(c, id, actor);
      return this.proof(c, id, proofId, p.uploaded_by);
    });
  }

  private fingerprint(state: Awaited<ReturnType<BankEvidenceService['state']>>) {
    const { pi, q, facts, receiver } = state;
    return hash(
      JSON.stringify({
        policy: POLICY,
        version: pi.version,
        status: pi.status,
        session: facts.sessionStatus,
        orderCode: facts.orderCode,
        link: facts.paymentLinkId,
        quote: pi.amount,
        cancel: q.cancel_requested,
        providerStatus: q.provider_status,
        reported: q.paid_amount,
        recorded: facts.recordedAmount,
        applied: facts.appliedAmount,
        outstanding: facts.outstandingAmount,
        scoped: state.scopedAmount,
        receiver: receiver ? bankReceiverDigest('970422', receiver) : null,
      }),
    );
  }
  private async inputBlockers(
    c: Connection,
    state: Awaited<ReturnType<BankEvidenceService['state']>>,
    input: EvidenceInput,
    actor: string,
  ) {
    const blockers = [...state.facts.blockers];
    const at = Date.parse(input.bankTransactionAt),
      created = Date.parse(state.facts.createdAt),
      expires = Date.parse(state.facts.expiresAt);
    if (at < created || at > expires || at > Date.now())
      blockers.push('Thời điểm thực nhận không nằm trong thời hạn khoản thu.');
    if (Date.now() > expires) {
      const timely = state.reports.some(
        (r: Row) =>
          new Date(r.created_at).getTime() <= expires &&
          r.details?.references?.includes(input.reference) &&
          String(r.details?.orderCode) === state.facts.orderCode &&
          r.details?.paymentLinkId === state.facts.paymentLinkId &&
          ((r.details?.receiptFacts ?? []).some(
            (receipt: Row) =>
              receipt.reference === input.reference && String(receipt.amount) === input.amount,
          ) ||
            (r.details?.references?.length === 1 &&
              String(r.details?.bankReportedAmount) === input.amount)),
      );
      if (!timely)
        blockers.push(
          'Khoản thu đã quá hạn và thiếu bằng chứng provider ghi nhận kịp thời; giờ nhập tay không đủ để phục hồi.',
        );
    }
    if (
      state.facts.providerReferences.length &&
      !state.facts.providerReferences.includes(input.reference)
    )
      blockers.push('Mã giao dịch khác dữ liệu payOS đã báo; cần điều tra ngoại lệ.');
    const event = (
      await c.query(
        `SELECT payload_snapshot FROM payment_webhook_event WHERE provider='PAYOS' AND signature_valid
      AND provider_event_id=$1 AND payload_snapshot->>'restaurantId'=$2 AND payload_snapshot->>'orderCode'=$3
      AND payload_snapshot->>'paymentLinkId'=$4`,
        [input.reference, this.restaurant, state.facts.orderCode, state.facts.paymentLinkId],
      )
    ).rows[0];
    if (event && String(event.payload_snapshot.amount) !== input.amount)
      blockers.push('Số tiền không khớp giao dịch provider đã xác minh chữ ký.');
    const latest = state.reports.find((r: Row) => r.details?.references?.includes(input.reference));
    if (latest) {
      const receipt = latest.details?.receiptFacts?.find(
        (row: Row) => row.reference === input.reference,
      );
      const knownAmount =
        receipt?.amount ??
        (latest.details?.references?.length === 1
          ? latest.details.bankReportedAmount
          : event?.payload_snapshot.amount);
      if (knownAmount === undefined || String(knownAmount) !== input.amount)
        blockers.push(
          'Thiếu bằng chứng số tiền chính xác của mã giao dịch hoặc số tiền khác dữ liệu provider.',
        );
    }
    const checkedProof = await this.proof(c, state.pi.id, input.proofId, actor);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      this.restaurant + ':proof:' + checkedProof.p.sha256,
    ]);
    if (state.receiver) {
      try {
        await assertBankReferenceAvailable(c, {
          restaurantId: this.restaurant,
          reference: input.reference,
          receiverDigest: bankReceiverDigest('970422', state.receiver),
          paymentIntentId: state.pi.id,
          amount: input.amount,
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'publicMessage' in error &&
          typeof error.publicMessage === 'string'
        )
          blockers.push(error.publicMessage);
        else throw error;
      }
    }
    const duplicate = (
      await c.query(
        `SELECT p.id,p.payment_intent_id,p.amount::text FROM payment_transaction p
      JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id
      WHERE p.status='SUCCEEDED' AND ((p.provider='PAYOS' AND p.provider_transaction_id=$1)
        OR (p.method='BANK_TRANSFER' AND p.metadata->>'reference'=$1 AND t.restaurant_id=$2)) LIMIT 1`,
        [input.reference, this.restaurant],
      )
    ).rows[0];
    if (duplicate)
      blockers.push('Mã giao dịch đã được ghi sổ; không được xác nhận thành khoản tiền mới.');
    const proofReuse = (
      await c.query(
        `SELECT e.id FROM payment_bank_evidence e JOIN payment_bank_proof p ON p.id=e.proof_id
       JOIN payment_bank_proof selected ON selected.id=$1 WHERE p.sha256=selected.sha256 AND e.restaurant_id=$2`,
        [input.proofId, this.restaurant],
      )
    ).rowCount;
    if (proofReuse) blockers.push('Chứng từ này đã dùng cho lần xác nhận ngân hàng khác.');
    const otherTransferProof = (
      await c.query(
        `SELECT p.id FROM payment_transaction p
      JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id
      WHERE t.restaurant_id=$1 AND p.status='SUCCEEDED' AND p.method='BANK_TRANSFER'
        AND p.metadata->'proof'->>'sha256'=$2 LIMIT 1`,
        [this.restaurant, checkedProof.p.sha256],
      )
    ).rowCount;
    if (otherTransferProof)
      blockers.push('Chứng từ đã dùng cho khoản chuyển khoản ghi sổ trước đó.');
    await this.proof(c, state.pi.id, input.proofId, actor);
    return blockers;
  }
  async preview(
    id: string,
    actor: string,
    body: Record<string, unknown>,
  ): Promise<BankEvidencePreview> {
    const input = parseBankEvidenceInput(body);
    // Refresh must use the authenticated provider pipeline. A failed refresh is
    // recorded honestly; the independent bank path never fakes provider success.
    await transaction(this.db, async (c) => {
      await this.state(c, id, actor);
    });
    let refreshResult = 'SUCCESS';
    try {
      await this.payos.refreshForAdmin(id, actor);
    } catch {
      refreshResult = 'UNAVAILABLE';
    }
    return transaction(this.db, async (c) => {
      const state = await this.state(c, id, actor);
      await c.query(
        `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details,actor_type)
       VALUES($1,$2,'BANK_EVIDENCE_PROVIDER_REFRESH','PAYMENT_INTENT',$3,'Đối chiếu provider trước khi xem trước chứng từ ngân hàng',$4,'USER')`,
        [this.restaurant, actor, id, JSON.stringify({ result: refreshResult, policy: POLICY })],
      );
      const blockers = await this.inputBlockers(c, state, input, actor);
      const amount = BigInt(input.amount),
        outstanding = BigInt(state.facts.outstandingAmount);
      const limit = [
        amount,
        BigInt(state.facts.remainingQuoteAmount),
        BigInt(state.scopedAmount),
        outstanding,
      ].reduce((a, b) => (a < b ? a : b));
      const impact = {
        recordedDelta: input.amount,
        allocatedDelta: limit.toString(),
        unallocatedDelta: (amount - limit).toString(),
        outstandingAfter: (outstanding - limit).toString(),
      };
      if (blockers.length)
        return {
          token: null,
          expiresAt: null,
          canConfirm: false,
          blockers,
          facts: state.facts,
          impact,
        };
      const token = randomBytes(32).toString('base64url'),
        expiresAt = new Date(Date.now() + 120000).toISOString();
      const { p } = await this.proof(c, id, input.proofId, actor);
      await c.query(
        `INSERT INTO payment_bank_preview(token_hash,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,reason,snapshot,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          hash(token),
          this.restaurant,
          id,
          actor,
          input.proofId,
          input.reference,
          input.amount,
          input.bankTransactionAt,
          input.reason,
          JSON.stringify({
            policy: POLICY,
            fingerprint: this.fingerprint(state),
            impact,
            proofHash: p.sha256,
            receiverDigest: bankReceiverDigest('970422', state.receiver!),
          }),
          expiresAt,
        ],
      );
      return { token, expiresAt, canConfirm: true, blockers: [], facts: state.facts, impact };
    });
  }
  async confirm(
    id: string,
    actor: string,
    body: Record<string, unknown>,
  ): Promise<BankEvidenceConfirmation> {
    if (body.attested !== true) reject('Cần xác nhận cuối đã đối chiếu trực tiếp ngân hàng.', 400);
    const token = text(body.token, 100);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) reject('Phiếu xem trước không hợp lệ.', 400);
    return transaction(this.db, async (c) => {
      const state = await this.state(c, id, actor);
      const preview = await one(
        c,
        'SELECT * FROM payment_bank_preview WHERE token_hash=$1 AND restaurant_id=$2 AND payment_intent_id=$3 AND actor_id=$4 FOR UPDATE',
        [hash(token), this.restaurant, id, actor],
      );
      if (preview.confirmed_at && preview.receipt_id)
        return {
          receiptId: preview.receipt_id,
          alreadyProcessed: true,
          verificationSource: 'BANK_ADMIN_VERIFIED',
        };
      if (new Date(preview.expires_at).getTime() <= Date.now())
        reject('Phiếu xem trước đã hết hạn. Hãy đối chiếu lại.');
      if (
        preview.snapshot.policy !== POLICY ||
        preview.snapshot.fingerprint !== this.fingerprint(state)
      )
        reject('Số dư hoặc khoản thu đã thay đổi. Hãy tạo bản xem trước mới.');
      const input: EvidenceInput = {
        proofId: preview.proof_id,
        reference: preview.bank_reference,
        amount: String(preview.amount),
        bankTransactionAt: timestamp(preview.bank_transaction_at),
        reason: preview.reason,
      };
      const blockers = await this.inputBlockers(c, state, input, actor);
      if (blockers.length) reject(blockers[0]!);
      const { p } = await this.proof(c, id, input.proofId, actor);
      if (
        p.sha256 !== preview.snapshot.proofHash ||
        bankReceiverDigest('970422', state.receiver!) !== preview.snapshot.receiverDigest
      )
        reject('Chứng từ hoặc tài khoản nhận đã thay đổi.');
      const posted = await postPayosReceipt(c, {
        pi: state.pi,
        restaurantId: this.restaurant,
        reference: input.reference,
        amount: input.amount,
        verificationSource: 'BANK_ADMIN_VERIFIED',
        actorId: actor,
        receiverDigest: preview.snapshot.receiverDigest,
        metadata: {
          orderCode: state.facts.orderCode,
          paymentLinkId: state.facts.paymentLinkId,
          collectionScope: state.pi.collection_scope,
          payerParticipantId: state.pi.payer_participant_id,
          bankTransactionAt: input.bankTransactionAt,
          bankEvidencePreviewId: preview.id,
          policy: POLICY,
          proofHash: p.sha256,
        },
      });
      if (
        posted.appliedAmount !== preview.snapshot.impact?.allocatedDelta ||
        (BigInt(input.amount) - BigInt(posted.appliedAmount)).toString() !==
          preview.snapshot.impact?.unallocatedDelta
      )
        reject('Không thể phân bổ đúng phạm vi đã xem trước; giao dịch được hủy toàn bộ.');
      await c.query(
        'UPDATE payment_bank_preview SET confirmed_at=now(),receipt_id=$2 WHERE id=$1',
        [preview.id, posted.receiptId],
      );
      await c.query(
        `INSERT INTO payment_bank_evidence(preview_id,receipt_id,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,receiver_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          preview.id,
          posted.receiptId,
          this.restaurant,
          id,
          actor,
          input.proofId,
          input.reference,
          input.amount,
          input.bankTransactionAt,
          preview.snapshot.receiverDigest,
        ],
      );
      const total = await one(
        c,
        "SELECT COALESCE(sum(amount),0)::text AS amount FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'",
        [id],
      );
      const fulfilled = BigInt(total.amount) >= BigInt(state.pi.amount);
      const unpostedProviderReferences = (
        await c.query(
          `SELECT reference FROM unnest($1::text[]) reference WHERE NOT EXISTS(
          SELECT 1 FROM payment_transaction p WHERE p.payment_intent_id=$2 AND p.provider='PAYOS'
            AND p.provider_transaction_id=reference AND p.status='SUCCEEDED')`,
          [state.facts.providerReferences, id],
        )
      ).rowCount;
      const hasException =
        posted.anomaly ||
        BigInt(state.q.paid_amount) > BigInt(total.amount) ||
        (Array.isArray(state.q.quarantined_transactions) &&
          state.q.quarantined_transactions.length > 0) ||
        !!unpostedProviderReferences;
      await c.query('UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1', [
        id,
        hasException ? 'REQUIRES_RECONCILIATION' : fulfilled ? 'SUCCEEDED' : 'PENDING',
      ]);
      // Local settlement and provider facts are deliberately separate. Continue
      // provider polling so a later signed webhook can attach corroboration.
      if (hasException) {
        let alertId = state.q.alert_id;
        if (
          alertId &&
          (await c.query('SELECT status FROM operational_alert WHERE id=$1', [alertId])).rows[0]
            ?.status === 'RESOLVED'
        )
          alertId = null;
        const exceptionReason = posted.anomaly
          ? 'Tiền ngân hàng đã xác minh còn phần chưa phân bổ; cần hoàn từ giao dịch gốc.'
          : (state.q.reconciliation_reason ??
            'Còn giao dịch ngân hàng chưa được đối chiếu đầy đủ.');
        const unallocated = (BigInt(input.amount) - BigInt(posted.appliedAmount)).toString();
        if (!alertId)
          alertId = (
            await one(
              c,
              `INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount)
          VALUES($1,$2,'OTHER','WARNING',$3) RETURNING id`,
              [state.pi.session_id, state.s.table_id, unallocated],
            )
          ).id;
        else
          await c.query(
            "UPDATE operational_alert SET outstanding_amount=$2 WHERE id=$1 AND status<>'RESOLVED'",
            [alertId, unallocated],
          );
        await c.query(
          `UPDATE payos_payment_request SET status='REQUIRES_RECONCILIATION',
          reconciliation_status='OPEN',reconciliation_reason=$2,last_error=$2,alert_id=$3,
          next_poll_at=now()+interval '30 seconds' WHERE payment_intent_id=$1`,
          [id, exceptionReason, alertId],
        );
      } else {
        await c.query(
          `UPDATE payos_payment_request SET status=$2,last_error=NULL,next_poll_at=now()+interval '30 seconds',
          reconciliation_status=NULL,reconciliation_reason='Quản trị đã đối chiếu tiền thực nhận từ ngân hàng.',resolved_by=$3,resolved_at=now() WHERE payment_intent_id=$1`,
          [id, fulfilled ? 'PAID' : 'UNDERPAID', actor],
        );
        if (state.q.alert_id)
          await c.query(
            "UPDATE operational_alert SET status='RESOLVED',resolved_at=now(),resolved_by=$2 WHERE id=$1 AND status<>'RESOLVED'",
            [state.q.alert_id, actor],
          );
      }
      const account = await recalculate(c, state.pi.session_id);
      if (fulfilled)
        await finishPaymentRequests(
          c,
          state.pi.session_id,
          state.pi.support_request_id,
          null,
          BigInt(account.outstanding_amount) === 0n,
        );
      await c.query(
        `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details,actor_type)
        VALUES($1,$2,'BANK_PAYMENT_ADMIN_VERIFIED','PAYMENT_INTENT',$3,$4,$5,'USER')`,
        [
          this.restaurant,
          actor,
          id,
          input.reason,
          JSON.stringify({
            receiptId: posted.receiptId,
            reference: input.reference,
            amount: input.amount,
            proofId: p.id,
            proofHash: p.sha256,
            policy: POLICY,
            verificationSource: 'BANK_ADMIN_VERIFIED',
            providerStatus: state.q.provider_status,
          }),
        ],
      );
      return {
        receiptId: posted.receiptId,
        alreadyProcessed: !posted.created,
        verificationSource: 'BANK_ADMIN_VERIFIED',
      };
    });
  }
}
