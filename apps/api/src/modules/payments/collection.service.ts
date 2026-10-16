import { consumePromotion, reservePromotionForIntent } from '../finance/pricing.service.js';
import { readPolicy } from '../risk/policy.service.js';
import {
  money,
  one,
  reject,
  session,
  text,
  uuid,
  type Connection,
  type Actor,
} from '../shared/core-persistence.js';
import { idempotent } from '../shared/idempotency.js';
import { recalculate } from '../finance/ledger.service.js';
import { requireCollectionOwner, finishPaymentRequests } from './payment-requests.routes.js';
export async function createIntent(
  c: Connection,
  sid: string,
  restaurant: string,
  actor: Actor,
  b: Record<string, unknown>,
) {
  await session(c, sid, restaurant);
  if (actor.type !== 'USER') reject('Chỉ nhân viên được bắt đầu thu tiền tại bàn.', 403);
  const key = text(b.requestId, 100);
  return idempotent(c, actor, 'payment:' + sid, key, b, 'PAYMENT_INTENT', async () => {
    const method = text(b.method);
    if (
      !['CASH', 'BANK_TRANSFER', 'ONLINE'].includes(method) ||
      (method === 'ONLINE' && actor.type !== 'USER')
    )
      reject('Phương thức thanh toán không hợp lệ.', 400);
    const uncertain = await c.query(
      "SELECT q.id FROM payos_payment_request q JOIN payment_intent p ON p.id=q.payment_intent_id WHERE p.session_id=$1 AND ((q.status IN ('CREATE_PENDING','ERROR','CANCEL_PENDING') AND COALESCE(q.provider_status,'') NOT IN ('CANCELLED','EXPIRED','PAID','FAILED')) OR q.reconciliation_status='OPEN' OR (p.status IN ('CANCELLED','EXPIRED') AND COALESCE(q.provider_status,'') NOT IN ('CANCELLED','EXPIRED','PAID','FAILED'))) LIMIT 1",
      [sid],
    );
    if (uncertain.rowCount)
      reject(
        'Khoản online đang chờ đối chiếu hoặc hủy. Kiểm tra payOS trước khi tạo khoản thu mới.',
      );
    await c.query(
      "UPDATE payment_intent SET status='EXPIRED',version=version+1 WHERE session_id=$1 AND status IN ('CREATED','PENDING') AND expires_at<=now() AND provider IS DISTINCT FROM 'PAYOS'",
      [sid],
    );
    const a = await recalculate(c, sid),
      amount = money(b.amount);
    if (BigInt(amount) > BigInt(a.outstanding_amount) - BigInt(a.reserved_payment_amount))
      reject('Số tiền vượt số dư chưa được đặt thanh toán.');
    const scope = b.collectionScope ?? 'TABLE';
    if (
      !['TABLE', 'PARTICIPANT'].includes(String(scope)) ||
      (actor.type === 'GUEST' && scope !== 'TABLE')
    )
      reject('Phạm vi thu tiền không hợp lệ.', 400);
    const payer =
      actor.type === 'GUEST' ? actor.id : scope === 'PARTICIPANT' ? uuid(b.participantId) : null;
    if (payer)
      await one(c, 'SELECT id FROM session_participant WHERE id=$1 AND session_id=$2', [
        payer,
        sid,
      ]);
    const supportId = b.supportRequestId === undefined ? null : uuid(b.supportRequestId);
    if (supportId && actor.type !== 'USER') reject('Chỉ nhân viên xử lý lời gọi thu tiền.', 403);
    if (actor.type === 'USER') await requireCollectionOwner(c, sid, supportId, actor.id);
    if (scope === 'PARTICIPANT') {
      const own = await one(
        c,
        `SELECT COALESCE(sum(f.amount-f.discount_amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0)),0)::text AS due
        FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id WHERE f.session_id=$1 AND f.status='ACTIVE' AND i.owner_participant_id=$2`,
        [sid, payer],
      );
      const reserved = await one(
        c,
        "SELECT COALESCE(sum(greatest(p.amount-COALESCE((SELECT sum(t.amount) FROM payment_transaction t WHERE t.payment_intent_id=p.id AND t.status='SUCCEEDED'),0),0)),0)::text AS amount FROM payment_intent p WHERE p.session_id=$1 AND p.payer_participant_id=$2 AND p.collection_scope='PARTICIPANT' AND ((p.status IN ('CREATED','PENDING') AND (p.expires_at>now() OR p.provider='PAYOS')) OR (p.status='REQUIRES_RECONCILIATION' AND EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id AND COALESCE(q.provider_status,'') NOT IN ('PAID','CANCELLED','EXPIRED','FAILED'))))",
        [sid, payer],
      );
      if (BigInt(amount) > BigInt(own.due) - BigInt(reserved.amount))
        reject('Số tiền vượt phần món của khách còn chưa thanh toán.');
    }
    const { policy } = await readPolicy(c, restaurant);
    const result = await one(
      c,
      `INSERT INTO payment_intent(session_id,payer_participant_id,method,amount,currency,client_request_id,expires_at,collection_scope,support_request_id) VALUES($1,$2,$3,$4,'VND',$5,now()+$6::int*interval '1 minute',$7,$8) RETURNING *`,
      [sid, payer, method, amount, key, Number(policy.PAYMENT_TTL_MINUTES), scope, supportId],
    );
    await reservePromotionForIntent(c, sid, result.expires_at);
    await recalculate(c, sid);
    return result;
  });
}

export async function confirmPayment(
  c: Connection,
  id: string,
  restaurant: string,
  actor: string,
  b: Record<string, unknown>,
) {
  const e = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
  await session(c, e.session_id, restaurant);
  const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
  if (!['CASH', 'BANK_TRANSFER'].includes(pi.method))
    reject('Thanh toán online chỉ được xác nhận từ nhà cung cấp.', 403);
  if (pi.status === 'SUCCEEDED')
    return one(
      c,
      "SELECT * FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'",
      [id],
    );
  if (
    !['CREATED', 'PENDING'].includes(pi.status) ||
    new Date(pi.expires_at).getTime() <= Date.now()
  )
    reject('Yêu cầu thanh toán đã hết hạn hoặc đã được xử lý.');
  const amount = money(b.amount);
  if (amount !== pi.amount) reject('Số tiền xác nhận phải khớp yêu cầu thanh toán.');
  await requireCollectionOwner(c, pi.session_id, pi.support_request_id, actor);
  const reference = pi.method === 'BANK_TRANSFER' && b.reference ? text(b.reference, 120) : null;
  const proof = pi.method === 'BANK_TRANSFER' ? pi.proof : null;
  if (pi.method === 'BANK_TRANSFER' && !reference && !proof)
    reject('Nhập mã giao dịch hoặc tải ảnh chứng từ.', 400);
  if (proof) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      restaurant + ':proof:' + proof.sha256,
    ]);
    const duplicate = await c.query(
      "SELECT p.id FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.status='SUCCEEDED' AND p.metadata->'proof'->>'sha256'=$2",
      [restaurant, proof.sha256],
    );
    if (duplicate.rowCount)
      reject('Ảnh chứng từ này đã dùng cho giao dịch khác. Hãy đối chiếu lại tiền thực nhận.');
  }
  if (reference) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      restaurant + ':bank:' + reference,
    ]);
    const duplicate = await c.query(
      "SELECT p.id FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.method='BANK_TRANSFER' AND p.status='SUCCEEDED' AND p.metadata->>'reference'=$2",
      [restaurant, reference],
    );
    if (duplicate.rowCount) reject('Mã chuyển khoản đã được xác nhận cho một giao dịch khác.');
  }
  const cashReceived = pi.method === 'CASH' ? money(b.receivedAmount ?? amount) : null;
  if (cashReceived !== null && BigInt(cashReceived) < BigInt(amount))
    reject('Tiền khách đưa chưa đủ số tiền xác nhận.', 400);
  const changeGiven =
    cashReceived === null ? null : (BigInt(cashReceived) - BigInt(amount)).toString();
  const a = await recalculate(c, pi.session_id);
  if (BigInt(amount) > BigInt(a.outstanding_amount))
    reject('Số dư đã thay đổi. Vui lòng lập yêu cầu mới.');
  const payment = await one(
    c,
    `INSERT INTO payment_transaction(payment_intent_id,session_id,method,amount,currency,status,confirmed_by,confirmed_at,metadata) VALUES($1,$2,$3,$4,'VND','SUCCEEDED',$5,now(),$6) RETURNING *`,
    [
      id,
      pi.session_id,
      pi.method,
      amount,
      actor,
      JSON.stringify({
        reference,
        cashHandlingVersion: 1,
        cashReceived,
        changeGiven,
        proof,
        collectionScope: pi.collection_scope,
        payerParticipantId: pi.payer_participant_id,
      }),
    ],
  );
  const charges = (
    await c.query(
      `SELECT f.*,f.amount-f.discount_amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0) AS remaining FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE' AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM order_item i WHERE i.id=f.order_item_id AND i.owner_participant_id=$2)) ORDER BY f.created_at,f.id FOR UPDATE`,
      [pi.session_id, pi.collection_scope === 'PARTICIPANT' ? pi.payer_participant_id : null],
    )
  ).rows;
  let left = BigInt(amount);
  for (const charge of charges) {
    if (left === 0n) break;
    const available = BigInt(charge.remaining);
    if (available <= 0n) continue;
    const part = left < available ? left : available;
    await c.query(
      'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,$3)',
      [payment.id, charge.id, part.toString()],
    );
    left -= part;
  }
  if (left !== 0n) reject('Không thể phân bổ đủ tiền vào khoản phải thu.');
  await c.query("UPDATE payment_intent SET status='SUCCEEDED',version=version+1 WHERE id=$1", [id]);
  await c.query(
    `INSERT INTO outbox_event(aggregate_type,payment_transaction_id,event_type,payload) VALUES('PAYMENT_TRANSACTION',$1,'PAYMENT_CONFIRMED',jsonb_build_object('sessionId',$2::text))`,
    [payment.id, pi.session_id],
  );
  await consumePromotion(c, pi.session_id);
  const settled = await recalculate(c, pi.session_id);
  await finishPaymentRequests(
    c,
    pi.session_id,
    pi.support_request_id,
    actor,
    BigInt(settled.outstanding_amount) === 0n,
  );
  return payment;
}
