import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  guest,
  digest,
  uuid,
  object,
  one,
  reject,
  text,
  transaction,
  type Connection,
} from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
import { cancelPending, supportEvent } from '../support/support.service.js';

export function registerPaymentRequests(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  onlineAvailable = false,
) {
  app.post('/guest/payment-requests', { config: { public: true } }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        body = object(r.body),
        method = body.method == null ? null : text(body.method),
        requestId = body.requestId == null ? null : uuid(body.requestId),
        requestHash = digest(JSON.stringify({ method }));
      // Keep older clients compatible; choosing a method is no longer required to call staff.
      if (method !== null && !['CASH', 'BANK_TRANSFER', 'ONLINE'].includes(method))
        reject('Hình thức thanh toán không hợp lệ.', 400);
      if (method === 'ONLINE' && !onlineAvailable)
        reject('Thanh toán online chưa được cấu hình.', 400);
      // guest() holds the session lock. Replay survives completion and also records aliases
      // when a second submission reuses the same active request.
      if (requestId) {
        const previous = (
          await c.query(
            'SELECT support_request_id,request_hash FROM payment_assistance_submission WHERE participant_id=$1 AND request_id=$2',
            [p.id, requestId],
          )
        ).rows[0];
        if (previous) {
          if (previous.request_hash !== requestHash)
            reject('Mã gửi lại đã dùng cho nội dung khác.');
          return {
            ...(await one(c, 'SELECT * FROM support_request WHERE id=$1 AND participant_id=$2', [
              previous.support_request_id,
              p.id,
            ])),
            reused: true,
          };
        }
      }
      const account = await recalculate(c, p.session_id);
      if (BigInt(account.outstanding_amount) <= 0n)
        reject('Bàn hiện không còn khoản cần thanh toán.');
      const existing = (
        await c.query(
          "SELECT * FROM support_request WHERE session_id=$1 AND participant_id=$2 AND request_type='BILL' AND status IN ('NEW','ACKNOWLEDGED') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
          [p.session_id, p.id],
        )
      ).rows[0];
      const request = existing
        ? existing.payment_method || method === null
          ? existing
          : await one(c, 'UPDATE support_request SET payment_method=$2 WHERE id=$1 RETURNING *', [
              existing.id,
              method,
            ])
        : await one(
            c,
            "INSERT INTO support_request(session_id,participant_id,request_type,payment_method) VALUES($1,$2,'BILL',$3) RETURNING *",
            [p.session_id, p.id, method],
          );
      if (requestId)
        await c.query(
          'INSERT INTO payment_assistance_submission(participant_id,request_id,request_hash,support_request_id) VALUES($1,$2,$3,$4)',
          [p.id, requestId, requestHash, request.id],
        );
      if (!existing || (!existing.payment_method && method !== null))
        await supportEvent(c, request, 'PAYMENT_ASSISTANCE_REQUESTED', null, { method });
      return { ...request, reused: !!existing };
    }),
  );
}
export async function claimPaymentRequest(c: Connection, id: string, sid: string, actor: string) {
  const x = await one(c, 'SELECT * FROM support_request WHERE id=$1 AND session_id=$2 FOR UPDATE', [
    id,
    sid,
  ]);
  if (x.request_type !== 'BILL' || !['NEW', 'ACKNOWLEDGED'].includes(x.status))
    reject('Lời gọi thu tiền đã thay đổi hoặc hoàn tất.');
  if (x.status === 'ACKNOWLEDGED' && x.acknowledged_by !== actor)
    reject('Nhân viên khác đang phụ trách. Hãy bàn giao trước khi thu tiền.', 403);
  if (x.status === 'NEW') reject('Nhận việc trước khi đến bàn thu tiền.');
  return x;
}
export async function finishPaymentRequests(
  c: Connection,
  sid: string,
  id: string | null,
  actor: string | null,
  settled: boolean,
) {
  const requests = (
    await c.query(
      "SELECT * FROM support_request WHERE session_id=$1 AND request_type='BILL' AND status IN ('NEW','ACKNOWLEDGED') AND ($3 OR id=$2) ORDER BY id FOR UPDATE",
      [sid, id, settled],
    )
  ).rows;
  for (const request of requests) {
    if (actor) await cancelPending(c, request, actor, 'Khoản thanh toán đã được ghi nhận.');
    else
      await c.query(
        "UPDATE support_request_handoff SET status='CANCELLED',responded_at=clock_timestamp(),responded_by=NULL,response_actor_type='SYSTEM',response_reason='Khoản thanh toán đã được ghi nhận.' WHERE support_request_id=$1 AND status='PENDING'",
        [request.id],
      );
    const linked = request.id === id;
    const updated = await one(
      c,
      "UPDATE support_request SET status=$3,resolved_by=$2,resolved_at=clock_timestamp(),resolution_actor_type=CASE WHEN $2::uuid IS NULL THEN 'SYSTEM' ELSE 'USER' END WHERE id=$1 RETURNING *",
      [request.id, actor, linked ? 'RESOLVED' : 'CANCELLED'],
    );
    await supportEvent(
      c,
      updated,
      linked ? 'SUPPORT_REQUEST_RESOLVED' : 'SUPPORT_REQUEST_CANCELLED',
      actor,
      { paymentRecorded: true, wholeTableSettled: settled },
      linked
        ? 'Đã nhận và ghi nhận tiền thanh toán.'
        : 'Bàn đã thanh toán đủ; không còn cần thu tiền cho lời gọi này.',
    );
  }
}

export async function requireCollectionOwner(
  c: Connection,
  sid: string,
  id: string | null,
  actor: string,
) {
  if (id) return claimPaymentRequest(c, id, sid, actor);
  const active = await c.query(
    "SELECT id FROM support_request WHERE session_id=$1 AND request_type='BILL' AND status IN ('NEW','ACKNOWLEDGED') ORDER BY id FOR UPDATE",
    [sid],
  );
  if (active.rowCount)
    reject('Bàn có lời gọi thu tiền đang mở. Nhận việc và chọn đúng lời gọi trước khi thu tiền.');
}
