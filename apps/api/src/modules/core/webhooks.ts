import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { digest, money, object, one, reject, session, text, transaction, uuid } from './common.js';
import { recalculate } from './orders.js';
// Contract for a trusted payment connector, NOT a VNPay/MoMo signature format.
// A provider-specific adapter must verify its provider and normalize to this contract.
export type ConnectorEvent = {
  eventId: string;
  transactionId: string;
  intentId: string;
  amount: string;
  currency: 'VND';
  timestamp: number;
};
export function connectorMessage(e: ConnectorEvent) {
  return JSON.stringify([
    e.eventId,
    e.transactionId,
    e.intentId,
    e.amount,
    e.currency,
    e.timestamp,
  ]);
}
export function connectorSignature(e: ConnectorEvent, secret: string) {
  return createHmac('sha256', secret).update(connectorMessage(e)).digest('hex');
}
export async function ingestConnector(
  db: Database,
  restaurant: string,
  provider: string,
  secret: string,
  body: unknown,
  signature: unknown,
) {
  const b = object(body);
  const e: ConnectorEvent = {
    eventId: text(b.eventId, 160),
    transactionId: text(b.transactionId, 160),
    intentId: uuid(b.intentId),
    amount: money(b.amount),
    currency: 'VND',
    timestamp: Number(b.timestamp),
  };
  if (
    b.currency !== 'VND' ||
    !Number.isSafeInteger(e.timestamp) ||
    Math.abs(Date.now() - e.timestamp) > 300000
  )
    reject('Thông báo thanh toán không hợp lệ.', 400);
  if (
    secret.length < 32 ||
    typeof signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(connectorSignature(e, secret), 'hex'),
    )
  )
    reject('Chữ ký thông báo không hợp lệ.', 401);
  const hash = digest(
    JSON.stringify([e.eventId, e.transactionId, e.intentId, e.amount, e.currency]),
  );
  return transaction(db, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      provider + ':' + e.eventId,
    ]);
    const old = (
      await c.query(
        'SELECT * FROM payment_webhook_event WHERE provider=$1 AND provider_event_id=$2',
        [provider, e.eventId],
      )
    ).rows[0];
    if (old) {
      if (old.payload_hash !== hash) reject('Mã thông báo đã dùng với nội dung khác.');
      return { status: old.processing_status };
    }
    const record = await one(
      c,
      'INSERT INTO payment_webhook_event(provider,provider_event_id,provider_transaction_id,payload_hash,payload_snapshot,signature_valid) VALUES($1,$2,$3,$4,$5,true) RETURNING id',
      [provider, e.eventId, e.transactionId, hash, JSON.stringify(e)],
    );
    const pi = (
      await c.query(
        `SELECT p.* FROM payment_intent p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.id=$1 AND t.restaurant_id=$2 AND p.method='ONLINE' AND p.provider=$3`,
        [e.intentId, restaurant, provider],
      )
    ).rows[0];
    if (!pi) {
      await c.query(
        "UPDATE payment_webhook_event SET processing_status='UNMATCHED',processed_at=now() WHERE id=$1",
        [record.id],
      );
      return { status: 'UNMATCHED' };
    }
    const s = await session(c, pi.session_id, restaurant, false);
    const locked = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [pi.id]);
    if (e.amount !== locked.amount || e.currency !== locked.currency) {
      await c.query(
        "UPDATE payment_webhook_event SET processing_status='REJECTED',processed_at=now() WHERE id=$1",
        [record.id],
      );
      return { status: 'REJECTED' };
    }
    const existing = (
      await c.query(
        'SELECT * FROM payment_transaction WHERE provider=$1 AND provider_transaction_id=$2',
        [provider, e.transactionId],
      )
    ).rows[0];
    if (existing) {
      if (existing.payment_intent_id !== pi.id || existing.amount !== e.amount)
        reject('Mã giao dịch đã được ghi nhận cho yêu cầu khác.');
      await c.query(
        "UPDATE payment_webhook_event SET processing_status='PROCESSED',processed_at=now(),payment_transaction_id=$2 WHERE id=$1",
        [record.id, existing.id],
      );
      return { status: 'PROCESSED' };
    }
    const captured = await c.query(
      "SELECT id FROM payment_transaction WHERE payment_intent_id=$1 AND status='SUCCEEDED'",
      [pi.id],
    );
    if (captured.rowCount) {
      await c.query(
        "UPDATE payment_webhook_event SET processing_status='FAILED',processed_at=now() WHERE id=$1",
        [record.id],
      );
      await c.query(
        "UPDATE payment_intent SET status='REQUIRES_RECONCILIATION',version=version+1 WHERE id=$1",
        [pi.id],
      );
      return { status: 'FAILED' };
    }
    const payment = await one(
      c,
      "INSERT INTO payment_transaction(payment_intent_id,session_id,method,amount,currency,status,provider,provider_transaction_id,confirmed_at) VALUES($1,$2,'ONLINE',$3,'VND','SUCCEEDED',$4,$5,now()) RETURNING *",
      [pi.id, pi.session_id, e.amount, provider, e.transactionId],
    );
    const charges = (
      await c.query(
        `SELECT f.*,f.amount-COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0) AS remaining FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE' ORDER BY f.created_at,f.id FOR UPDATE`,
        [pi.session_id],
      )
    ).rows;
    let left = BigInt(e.amount);
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
    const late =
      !['CREATED', 'PENDING'].includes(locked.status) ||
      new Date(locked.expires_at).getTime() <= Date.now() ||
      s.session_status !== 'ACTIVE';
    await c.query('UPDATE payment_intent SET status=$2,version=version+1 WHERE id=$1', [
      pi.id,
      late || left > 0n ? 'REQUIRES_RECONCILIATION' : 'SUCCEEDED',
    ]);
    await c.query(
      "UPDATE payment_webhook_event SET processing_status='PROCESSED',processed_at=now(),payment_transaction_id=$2 WHERE id=$1",
      [record.id, payment.id],
    );
    await c.query(
      "INSERT INTO outbox_event(aggregate_type,payment_transaction_id,event_type,payload) VALUES('PAYMENT_TRANSACTION',$1,'PAYMENT_RECEIVED',$2)",
      [payment.id, JSON.stringify({ sessionId: pi.session_id })],
    );
    const account = await recalculate(c, pi.session_id);
    if (late || left > 0n)
      await c.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'OTHER','WARNING',$3)",
        [pi.session_id, s.table_id, account.refund_due_amount],
      );
    return { status: 'PROCESSED' };
  });
}
export function registerWebhooks(app: FastifyInstance, db: Database, restaurant: string) {
  app.post(
    '/payments/webhooks/connector',
    { config: { public: true, externalWebhook: true } },
    async (r, reply) => {
      const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '',
        provider = process.env.PAYMENT_CONNECTOR_NAME ?? '';
      if (secret.length < 32 || !provider)
        return reply.code(503).send({
          errorCode: 'PAYMENT_CONNECTOR_UNAVAILABLE',
          userMessage: 'Chưa cấu hình bộ kết nối thanh toán.',
        });
      return ingestConnector(
        db,
        restaurant,
        provider,
        secret,
        r.body,
        r.headers['x-payment-signature'],
      );
    },
  );
  app.get(
    '/core/payment-events',
    { config: { permission: 'admin.workspace' } },
    async () =>
      (
        await db.pool.query(
          `SELECT w.id,w.provider,w.provider_event_id,w.processing_status,w.received_at FROM payment_webhook_event w WHERE w.payment_transaction_id IS NOT NULL AND core_tenant('payment_transaction',w.payment_transaction_id)=$1 ORDER BY w.received_at DESC LIMIT 100`,
          [restaurant],
        )
      ).rows,
  );
}
