import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  object,
  one,
  reject,
  text,
  transaction,
  uuid,
} from '../shared/core-persistence.js';
import {
  cancelPending,
  lockSupport,
  requireOwner,
  serviceStaff,
  supportEvent,
  supportHistory,
  supportSelect,
} from './support.service.js';

export function registerSupport(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'staff.workspace' };
  app.get(
    '/core/support',
    { config },
    async (r) =>
      (
        await db.pool.query(
          `${supportSelect} WHERE t.restaurant_id=$1 AND x.status IN ('NEW','ACKNOWLEDGED')
     ORDER BY (x.status='NEW') DESC,x.created_at,x.id`,
          [restaurant, r.identity!.id],
        )
      ).rows,
  );
  app.get('/core/support/:id/history', { config }, (r) =>
    transaction(db, (c) => supportHistory(c, idParam(r), restaurant)),
  );
  app.get(
    '/core/admin/support',
    { config: { permission: 'admin.workspace' } },
    async (r) =>
      (
        await db.pool.query(
          `${supportSelect} WHERE t.restaurant_id=$1
     ORDER BY (x.status IN ('NEW','ACKNOWLEDGED')) DESC,x.created_at DESC LIMIT 100`,
          [restaurant, r.identity!.id],
        )
      ).rows,
  );
  app.get('/core/admin/support/:id/history', { config: { permission: 'admin.workspace' } }, (r) =>
    transaction(db, (c) => supportHistory(c, idParam(r), restaurant)),
  );

  for (const action of ['claim', 'resolve'])
    app.post('/core/support/:id/' + action, { config }, (r) =>
      transaction(db, async (c) => {
        const actor = r.identity!.id;
        await serviceStaff(c, [actor], restaurant);
        const x = await lockSupport(c, idParam(r), restaurant);
        if (action === 'claim') {
          if (x.status !== 'NEW') reject('Yêu cầu đã được nhân viên khác tiếp nhận.');
          const updated = await one(
            c,
            `UPDATE support_request SET status='ACKNOWLEDGED',
          acknowledged_by=$2,acknowledged_at=clock_timestamp() WHERE id=$1 RETURNING *`,
            [x.id, actor],
          );
          await supportEvent(c, updated, 'SUPPORT_REQUEST_CLAIMED', actor);
          return updated;
        }
        requireOwner(x, actor);
        if (
          x.request_type === 'ACCESS_CODE' &&
          (!x.session_id ||
            !(
              await one(c, 'SELECT access_code_ciphertext FROM table_session WHERE id=$1', [
                x.session_id,
              ])
            ).access_code_ciphertext)
        )
          reject('Cấp mã tại bàn trước khi xác nhận đã đọc mã cho khách.');
        const reason = x.request_type === 'BILL' ? text(object(r.body).reason, 500) : null;
        if (
          x.request_type === 'BILL' &&
          (
            await c.query(
              "SELECT id FROM payment_intent WHERE support_request_id=$1 AND status IN ('CREATED','PENDING') AND expires_at>now()",
              [x.id],
            )
          ).rowCount
        )
          reject(
            'Còn khoản thu đang chờ. Ghi nhận tiền hoặc hủy khoản thu trước khi kết thúc lời gọi.',
          );
        await cancelPending(c, x, actor, reason ?? 'Người phụ trách đã hoàn tất hỗ trợ.');
        const updated = await one(
          c,
          `UPDATE support_request SET status='RESOLVED',
        resolved_by=$2,resolved_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [x.id, actor],
        );
        await supportEvent(
          c,
          updated,
          'SUPPORT_REQUEST_RESOLVED',
          actor,
          x.request_type === 'BILL' ? { paymentRecorded: false } : {},
          reason ?? undefined,
        );
        return updated;
      }),
    );

  app.get('/core/support-assignees', { config }, async (r) => {
    const query = object(r.query),
      id = query.requestId ? uuid(query.requestId) : null;
    if (
      id &&
      !(
        await db.pool.query(
          "SELECT id FROM support_request WHERE id=$1 AND core_tenant('support_request',id)=$2",
          [id, restaurant],
        )
      ).rowCount
    )
      reject('Không tìm thấy yêu cầu hỗ trợ.', 404);
    return (
      await db.pool.query(
        `SELECT u.id,u.username,u.display_name,
      COALESCE(live.checked_in,false) AS on_duty,COALESCE(live.same_area,false) AS same_area,
      live.area_name,COALESCE(live.scheduled,false) AS scheduled
      FROM app_user u LEFT JOIN LATERAL (
        SELECT ar.checked_in_at IS NOT NULL AND ar.checked_out_at IS NULL AS checked_in,
          sa.area_id IS NULL OR sa.area_id=t.area_id AS same_area,a.name AS area_name,true AS scheduled
        FROM shift_assignment sa LEFT JOIN attendance_record ar ON ar.assignment_id=sa.id
        LEFT JOIN dining_area a ON a.id=sa.area_id
        LEFT JOIN support_request x ON x.id=$2
        LEFT JOIN table_session s ON s.id=x.session_id LEFT JOIN dining_table t ON t.id=COALESCE(s.table_id,x.table_id)
        WHERE sa.user_id=u.id AND sa.restaurant_id=$1 AND sa.status='ASSIGNED'
        AND sa.starts_at<=now() AND sa.ends_at>now()
        ORDER BY (ar.checked_in_at IS NOT NULL AND ar.checked_out_at IS NULL) DESC NULLS LAST,
          (sa.area_id IS NULL OR sa.area_id=t.area_id) DESC NULLS LAST LIMIT 1
      ) live ON true WHERE u.restaurant_id=$1 AND u.status='ACTIVE'
      AND EXISTS(SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id=ur.role_id
        JOIN permission p ON p.id=rp.permission_id WHERE ur.user_id=u.id
        AND ur.revoked_at IS NULL AND p.code='staff.workspace')
      ORDER BY COALESCE(live.checked_in,false) DESC,COALESCE(live.same_area,false) DESC,
        COALESCE(live.scheduled,false) DESC,u.display_name`,
        [restaurant, id],
      )
    ).rows;
  });
  // Existing URL now requests acceptance; it never transfers ownership immediately.
  app.post('/core/support/:id/reassign', { config }, (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        target = uuid(b.userId),
        reason = text(b.reason, 500),
        actor = r.identity!.id;
      if (target === actor) reject('Chọn một đồng nghiệp khác.', 400);
      await serviceStaff(c, [actor, target], restaurant);
      const x = await lockSupport(c, idParam(r), restaurant);
      requireOwner(x, actor);
      if (
        (
          await c.query(
            `SELECT id FROM support_request_handoff WHERE support_request_id=$1 AND status='PENDING'`,
            [x.id],
          )
        ).rowCount
      )
        reject('Yêu cầu đang có một bàn giao chờ phản hồi.');
      const h = await one(
        c,
        `INSERT INTO support_request_handoff(support_request_id,from_staff_id,to_staff_id,reason)
      VALUES($1,$2,$3,$4) RETURNING *`,
        [x.id, actor, target, reason],
      );
      await supportEvent(
        c,
        x,
        'SUPPORT_HANDOFF_REQUESTED',
        actor,
        { handoffId: h.id, fromStaffId: actor, toStaffId: target },
        reason,
      );
      return h;
    }),
  );
  for (const action of ['accept', 'decline', 'cancel'])
    app.post('/core/support/:id/handoffs/:handoffId/' + action, { config }, (r) =>
      transaction(db, async (c) => {
        const actor = r.identity!.id;
        await serviceStaff(c, [actor], restaurant);
        const x = await lockSupport(c, idParam(r), restaurant);
        const h = await one(
          c,
          `SELECT * FROM support_request_handoff
        WHERE id=$1 AND support_request_id=$2 FOR UPDATE`,
          [uuid(object(r.params).handoffId), x.id],
        );
        if ((action === 'cancel' ? h.from_staff_id : h.to_staff_id) !== actor)
          reject(
            action === 'cancel'
              ? 'Chỉ người gửi được rút bàn giao.'
              : 'Chỉ người được chỉ định được phản hồi bàn giao.',
            403,
          );
        if (
          h.status !== 'PENDING' ||
          x.status !== 'ACKNOWLEDGED' ||
          x.acknowledged_by !== h.from_staff_id
        )
          reject('Bàn giao đã kết thúc hoặc yêu cầu đã đổi người phụ trách. Vui lòng tải lại.');
        const reason =
          action === 'accept'
            ? 'Đồng ý nhận trách nhiệm hỗ trợ.'
            : text(object(r.body).reason, 500);
        const status =
          action === 'accept' ? 'ACCEPTED' : action === 'decline' ? 'DECLINED' : 'CANCELLED';
        const updated = await one(
          c,
          `UPDATE support_request_handoff SET status=$2,
        responded_at=clock_timestamp(),responded_by=$3,response_reason=$4 WHERE id=$1 RETURNING *`,
          [h.id, status, actor, reason],
        );
        if (action === 'accept')
          await c.query('UPDATE support_request SET acknowledged_by=$2 WHERE id=$1', [x.id, actor]);
        await supportEvent(
          c,
          x,
          'SUPPORT_HANDOFF_' + status,
          actor,
          { handoffId: h.id, fromStaffId: h.from_staff_id, toStaffId: h.to_staff_id },
          reason,
        );
        return updated;
      }),
    );
}
