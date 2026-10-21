import { supportRetrySeconds } from '../sessions/table-access.service.js';
import type { Connection } from '../shared/core-persistence.js';
import { one, reject, session } from '../shared/core-persistence.js';

// Lock users before session/request. Account changes use the same user lock.
export async function serviceStaff(c: Connection, ids: string[], restaurant: string) {
  for (const id of [...new Set(ids)].sort()) {
    const rows = await c.query(
      `SELECT u.id FROM app_user u WHERE u.id=$1 AND u.restaurant_id=$2
       AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM user_role ur
         JOIN role_permission rp ON rp.role_id=ur.role_id
         JOIN permission p ON p.id=rp.permission_id
         WHERE ur.user_id=u.id AND ur.revoked_at IS NULL AND p.code='staff.workspace')
       FOR SHARE OF u`,
      [id, restaurant],
    );
    if (!rows.rowCount)
      reject('Nhân viên phải đang hoạt động và có quyền phục vụ tại nhà hàng.', 403);
  }
}
export async function lockSupport(c: Connection, id: string, restaurant: string) {
  const ref = await one(
    c,
    `SELECT x.session_id,x.table_id FROM support_request x
    LEFT JOIN table_session s ON s.id=x.session_id JOIN dining_table t ON t.id=COALESCE(s.table_id,x.table_id)
    WHERE x.id=$1 AND t.restaurant_id=$2`,
    [id, restaurant],
  );
  if (ref.session_id) await session(c, ref.session_id, restaurant);
  else await one(c, 'SELECT id FROM dining_table WHERE id=$1 FOR UPDATE', [ref.table_id]);
  return one(c, 'SELECT * FROM support_request WHERE id=$1 FOR UPDATE', [id]);
}
export function requireOwner(x: Record<string, unknown>, user: string) {
  if (x.status !== 'ACKNOWLEDGED') reject('Yêu cầu không còn ở trạng thái đang xử lý.');
  if (x.acknowledged_by !== user)
    reject('Chỉ nhân viên đang phụ trách được thực hiện thao tác này.', 403);
}
export async function supportEvent(
  c: Connection,
  request: Record<string, unknown>,
  type: string,
  actorId: string | null,
  details: Record<string, unknown> = {},
  reason = 'Cập nhật hỗ trợ tại bàn',
) {
  const payload = {
    requestId: request.id,
    sessionId: request.session_id,
    participantId: request.participant_id,
    actorId,
    ...details,
  };
  await c.query(
    `INSERT INTO outbox_event(aggregate_type,support_request_id,event_type,payload)
    VALUES('SUPPORT_REQUEST',$1,$2,$3)`,
    [request.id, type, JSON.stringify(payload)],
  );
  if (actorId)
    await c.query(
      `INSERT INTO business_audit_event
    (restaurant_id,actor_id,action,resource_type,resource_id,reason,details)
    VALUES(core_tenant('support_request',$1),$2,$3,'SUPPORT_REQUEST',$1,$4,$5)`,
      [request.id, actorId, type, reason, JSON.stringify(payload)],
    );
}
export async function cancelPending(
  c: Connection,
  request: Record<string, unknown>,
  actor: string,
  reason: string,
) {
  const rows = await c.query(
    `UPDATE support_request_handoff SET status='CANCELLED',
    responded_at=clock_timestamp(),responded_by=$2,response_reason=$3
    WHERE support_request_id=$1 AND status='PENDING' RETURNING *`,
    [request.id, actor, reason],
  );
  for (const h of rows.rows)
    await supportEvent(
      c,
      request,
      'SUPPORT_HANDOFF_CANCELLED',
      actor,
      { handoffId: h.id, fromStaffId: h.from_staff_id, toStaffId: h.to_staff_id },
      reason,
    );
}
export const supportSelect = `SELECT x.id,x.session_id,x.participant_id,COALESCE(s.table_id,x.table_id) AS table_id,x.request_type,x.payment_method,x.content,x.status,x.acknowledged_by,x.resolved_by,x.created_at,x.updated_at,x.acknowledged_at,x.resolved_at,x.replaces_request_id,t.code AS table_code,a.name AS area_name,
  COALESCE(p.display_name,x.visitor_name) AS display_name,u.display_name AS acknowledged_by_name,
  h.id AS pending_handoff_id,h.to_staff_id AS pending_to_staff_id,
  h.reason AS pending_reason,h.requested_at AS pending_requested_at,
  target.display_name AS pending_to_name,
  last_h.id AS latest_handoff_id,last_h.status AS latest_handoff_status,last_h.response_reason AS latest_response_reason,
  EXISTS(SELECT 1 FROM shift_assignment sa JOIN attendance_record ar ON ar.assignment_id=sa.id
    WHERE sa.user_id=$2 AND sa.restaurant_id=t.restaurant_id AND sa.status='ASSIGNED'
    AND sa.starts_at<=now() AND sa.ends_at>now() AND ar.checked_in_at IS NOT NULL
    AND ar.checked_out_at IS NULL AND (sa.area_id IS NULL OR sa.area_id=t.area_id)) AS area_priority
  FROM support_request x LEFT JOIN table_session s ON s.id=x.session_id
  JOIN dining_table t ON t.id=COALESCE(s.table_id,x.table_id) JOIN dining_area a ON a.id=t.area_id
  LEFT JOIN session_participant p ON p.id=x.participant_id
  LEFT JOIN app_user u ON u.id=x.acknowledged_by
  LEFT JOIN support_request_handoff h ON h.support_request_id=x.id AND h.status='PENDING'
  LEFT JOIN app_user target ON target.id=h.to_staff_id
  LEFT JOIN LATERAL(SELECT id,status,response_reason FROM support_request_handoff
    WHERE support_request_id=x.id ORDER BY requested_at DESC,id DESC LIMIT 1) last_h ON true`;

export async function supportHistory(c: Connection, id: string, restaurant: string) {
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const request = await one(c, `${supportSelect} WHERE x.id=$3 AND t.restaurant_id=$1`, [
    restaurant,
    null,
    id,
  ]);
  const handoffs = (
    await c.query(
      `SELECT h.*,f.display_name AS from_name,t.display_name AS to_name,
    r.display_name AS responded_by_name FROM support_request_handoff h
    JOIN app_user f ON f.id=h.from_staff_id JOIN app_user t ON t.id=h.to_staff_id
    LEFT JOIN app_user r ON r.id=h.responded_by WHERE h.support_request_id=$1 ORDER BY h.requested_at,h.id`,
      [id],
    )
  ).rows;
  const audit = (
    await c.query(
      `SELECT e.id,e.action,e.reason,e.created_at,u.display_name AS actor_name
    FROM business_audit_event e JOIN app_user u ON u.id=e.actor_id
    WHERE e.restaurant_id=$1 AND e.resource_type='SUPPORT_REQUEST' AND e.resource_id=$2
    UNION ALL
    SELECT e.id,e.event_type AS action,CASE e.event_type
      WHEN 'SUPPORT_REQUEST_CREATED' THEN 'Khách gửi yêu cầu hỗ trợ tại bàn.'
      WHEN 'SUPPORT_REQUEST_REPLACED' THEN 'Khách gọi lại sau thời gian chờ; yêu cầu mới trở về việc chung.'
      ELSE 'Yêu cầu cấp mã hết thời gian chờ hoặc lượt khách đã kết thúc.' END AS reason,
      e.created_at,CASE WHEN e.event_type='SUPPORT_REQUEST_EXPIRED' THEN 'Hệ thống' ELSE 'Khách tại bàn' END AS actor_name
    FROM outbox_event e WHERE e.support_request_id=$2 AND core_tenant('outbox_event',e.id)=$1
      AND e.event_type IN ('SUPPORT_REQUEST_CREATED','SUPPORT_REQUEST_REPLACED','SUPPORT_REQUEST_EXPIRED')
    ORDER BY created_at,id`,
      [restaurant, id],
    )
  ).rows;
  return { request, handoffs, audit };
}

export function supportRetryAt(x: Record<string, unknown>) {
  return new Date(
    Math.max(Date.parse(String(x.created_at)), Date.parse(String(x.acknowledged_at)) || 0) +
      (x.status === 'ACKNOWLEDGED' ? 180 : supportRetrySeconds) * 1000,
  ).toISOString();
}
export async function cancelForRetry(
  c: Connection,
  x: Record<string, unknown>,
  participantId: string | null,
) {
  // Close pending handoffs in the sender's name as required by the ownership constraint;
  // the event explicitly records that the customer requested replacement, not a staff decision.
  await c.query(
    `UPDATE support_request_handoff SET status='CANCELLED',responded_at=clock_timestamp(),
    responded_by=from_staff_id,response_reason='Khách gọi lại; yêu cầu đã được thay thế.' WHERE support_request_id=$1 AND status='PENDING'`,
    [x.id],
  );
  await c.query("UPDATE support_request SET status='CANCELLED' WHERE id=$1", [x.id]);
  await supportEvent(c, x, 'SUPPORT_REQUEST_REPLACED', null, {
    requestedByParticipantId: participantId,
    previousOwnerId: x.acknowledged_by,
  });
}
