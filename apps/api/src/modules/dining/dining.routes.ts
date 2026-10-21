import { issueTableCode } from '../sessions/table-access.service.js';
import { parseReason } from '../orders/reasons.js';
import { registerDishNotices } from './dish-notice.routes.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  object,
  one,
  reject,
  session,
  text,
  transaction,
} from '../shared/core-persistence.js';
import { freezeReceipt } from '../payments/receipt.service.js';
import { refundApprovalJoin } from '../payments/refund-approval.service.js';
import { recalculate } from '../finance/ledger.service.js';
import { closeReadiness } from './close-readiness.js';
import { cancelBatch } from '../orders/cancellation.service.js';
export function registerOperations(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'staff.workspace' };
  registerDishNotices(app, db, restaurant);
  app.post('/core/tables/:id/open', { config }, async (r) =>
    transaction(db, async (c) => {
      const t = await one(
        c,
        'SELECT t.* FROM dining_table t JOIN dining_area a ON a.id=t.area_id WHERE t.id=$1 AND t.restaurant_id=$2 AND t.is_active AND a.is_active FOR UPDATE OF t',
        [idParam(r), restaurant],
      );
      if (t.table_status !== 'AVAILABLE') reject('Bàn chưa sẵn sàng mở phiên.');
      return issueTableCode(c, t, r.identity!.id);
    }),
  );
  app.post('/core/sessions/:id/verify', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant);
      const t = await one(c, 'SELECT * FROM dining_table WHERE id=$1 FOR UPDATE', [s.table_id]);
      return issueTableCode(c, t, r.identity!.id);
    }),
  );
  app.post('/core/orders/:id/cancel', { config }, async (r) =>
    transaction(db, (c) =>
      cancelBatch(
        c,
        idParam(r),
        restaurant,
        { type: 'USER', id: r.identity!.id },
        parseReason(object(r.body), 'STAFF_CANCEL').text,
        parseReason(object(r.body), 'STAFF_CANCEL').code,
      ),
    ),
  );
  app.post('/core/sessions/:id/close', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant),
        a = await recalculate(c, s.id);
      const readiness = await closeReadiness(c, s.id, a);
      if (!readiness.canClose)
        throw Object.assign(new Error('Chưa thể kết thúc bàn.'), {
          statusCode: 409,
          publicMessage:
            'Chưa thể kết thúc bàn: ' + readiness.blockers.map((b) => b.title).join('; ') + '.',
          publicDetails: readiness,
        });
      await c.query(
        "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='SETTLED',version=version+1 WHERE id=$1",
        [s.id],
      );
      await c.query("UPDATE session_participant SET status='LEFT' WHERE session_id=$1", [s.id]);
      await c.query(
        "UPDATE dining_table SET table_status='NEEDS_CLEANING',version=version+1 WHERE id=$1",
        [s.table_id],
      );
      await freezeReceipt(c, s.id, restaurant, r.identity!.id);
      return { status: 'ok' };
    }),
  );
  app.post('/core/tables/:id/clean', { config }, async (r) =>
    transaction(db, (c) =>
      one(
        c,
        "UPDATE dining_table SET table_status='AVAILABLE',version=version+1 WHERE id=$1 AND restaurant_id=$2 AND table_status='NEEDS_CLEANING' AND NOT EXISTS(SELECT 1 FROM table_session WHERE table_id=$1 AND session_status='ACTIVE') RETURNING *",
        [idParam(r), restaurant],
      ),
    ),
  );
  app.get(
    '/core/alerts',
    { config: { permission: ['staff.workspace', 'admin.workspace'] } },
    async (r) =>
      db.pool
        .query(
          `SELECT a.*,COALESCE(report.action IN ('KITCHEN_ISSUE_REPORTED','KITCHEN_UNAVAILABLE_REPORTED'),false)
    OR EXISTS(SELECT 1 FROM payos_payment_request pq WHERE pq.alert_id=a.id)
    OR (a.alert_type='REFUND_REQUIRED' AND least(COALESCE(account.refund_due_amount,0),COALESCE(refund_work.approved_amount,0))<=0) AS requires_admin,
  EXISTS(SELECT 1 FROM payos_payment_request pq WHERE pq.alert_id=a.id) AS payment_reconciliation,
  report.action='KITCHEN_UNAVAILABLE_REPORTED' AS stock_inspection,report.resource_id AS item_id,report.details->>'productId' AS product_id,
  report.action='KITCHEN_ISSUE_GUEST_NOTICE' AS guest_notice,
  item.product_name_snapshot AS item_name,item.quantity AS item_quantity,
  report.reason AS issue_reason,report.details->>'reasonCode' AS issue_reason_code,
  (SELECT u.display_name FROM app_user u WHERE u.id=report.actor_id) AS reported_by_name,
  COALESCE(current_table.code,t.code) AS table_code,t.code AS original_table_code,
  COALESCE(current_table.name,t.name) AS table_name,
  account.refund_due_amount,
  least(COALESCE(account.refund_due_amount,0),COALESCE(refund_work.approved_amount,0))::text AS approved_refund_amount,
  greatest(COALESCE(account.refund_due_amount,0)-COALESCE(refund_work.approved_amount,0),0)::text AS refund_review_amount
  FROM operational_alert a JOIN dining_table t ON t.id=a.table_id
  LEFT JOIN table_session current_session ON current_session.id=a.session_id
  LEFT JOIN dining_table current_table ON current_table.id=current_session.table_id
  LEFT JOIN session_financial_account account ON account.session_id=a.session_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(greatest(f.amount-COALESCE((SELECT sum(rt.amount) FROM refund_transaction rt
      WHERE rt.refund_case_id=f.id AND rt.status='SUCCEEDED'),0),0)),0) AS approved_amount
    FROM refund_case f ${refundApprovalJoin}
    WHERE f.session_id=a.session_id AND f.status IN ('OPEN','IN_PROGRESS') AND approval.approved_at IS NOT NULL
  ) refund_work ON a.alert_type='REFUND_REQUIRED'
  LEFT JOIN LATERAL (SELECT e.* FROM business_audit_event e WHERE e.action IN ('KITCHEN_ISSUE_REPORTED','KITCHEN_ISSUE_GUEST_NOTICE','KITCHEN_UNAVAILABLE_REPORTED')
    AND e.details->>'alertId'=a.id::text ORDER BY e.created_at DESC,e.id DESC LIMIT 1) report ON true
  LEFT JOIN order_item item ON item.id=report.resource_id
  WHERE t.restaurant_id=$1 AND a.status<>'RESOLVED'
    AND (a.alert_type<>'REFUND_REQUIRED' OR (COALESCE(account.refund_due_amount,0)>0
      AND ($2 OR least(COALESCE(account.refund_due_amount,0),COALESCE(refund_work.approved_amount,0))>0)))
  ORDER BY a.created_at`,
          [restaurant, r.identity!.permissions.includes('admin.workspace')],
        )
        .then((v) => v.rows),
  );
  app.post('/core/alerts/:id/acknowledge', { config }, async (r) =>
    transaction(db, async (c) => {
      const payment = await c.query(
        'SELECT q.id FROM payos_payment_request q JOIN operational_alert a ON a.id=q.alert_id JOIN dining_table t ON t.id=a.table_id WHERE a.id=$1 AND t.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      if (payment.rowCount)
        reject('Ngoại lệ online do quản trị xử lý trong Trung tâm ngoại lệ thanh toán.', 403);
      return one(
        c,
        "UPDATE operational_alert a SET status='ACKNOWLEDGED',acknowledged_by=$3 WHERE id=$1 AND status IN ('NEW','ESCALATED') AND table_id IN (SELECT id FROM dining_table WHERE restaurant_id=$2) RETURNING *",
        [idParam(r), restaurant, r.identity!.id],
      );
    }),
  );
  app.post('/core/alerts/:id/resolve', { config }, async (r) =>
    transaction(db, async (c) => {
      const a = await one(
        c,
        'SELECT a.* FROM operational_alert a JOIN dining_table t ON t.id=a.table_id WHERE a.id=$1 AND t.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      const payment = await c.query('SELECT id FROM payos_payment_request WHERE alert_id=$1', [
        a.id,
      ]);
      if (payment.rowCount)
        reject(
          'Không đóng cảnh báo thanh toán qua việc tại bàn. Quản trị cần xử lý đúng tiền trong Trung tâm ngoại lệ.',
          403,
        );
      const notice = await c.query(
        "SELECT id FROM business_audit_event WHERE action='KITCHEN_ISSUE_GUEST_NOTICE' AND details->>'alertId'=$1",
        [a.id],
      );
      if (notice.rowCount)
        reject('Dùng xác nhận đã trao đổi với khách để hoàn tất việc tại bàn.', 403);
      const pendingKitchen = await c.query(
        "SELECT id FROM business_audit_event WHERE action IN ('KITCHEN_ISSUE_REPORTED','KITCHEN_UNAVAILABLE_REPORTED') AND details->>'alertId'=$1",
        [a.id],
      );
      if (pendingKitchen.rowCount)
        reject('Sự cố món cần quản trị quyết định; nhân viên không tự đóng cảnh báo này.', 403);
      if (a.session_id) {
        await session(c, a.session_id, restaurant, false);
        const balance = await recalculate(c, a.session_id);
        if (a.alert_type === 'REFUND_REQUIRED' && BigInt(balance.refund_due_amount) > 0n)
          reject('Vẫn còn số tiền cần hoàn.');
        if (a.alert_type === 'PAYMENT_SHORTFALL' && BigInt(balance.outstanding_amount) > 0n) {
          const resolved = await c.query(
            "SELECT id FROM outstanding_balance_case WHERE session_id=$1 AND status='WRITTEN_OFF'",
            [a.session_id],
          );
          if (!resolved.rowCount) reject('Hồ sơ thiếu tiền chưa được xử lý.');
        }
      }
      return one(
        c,
        "UPDATE operational_alert SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution_note=$3 WHERE id=$1 AND status='ACKNOWLEDGED' RETURNING *",
        [a.id, r.identity!.id, text(object(r.body).reason, 500)],
      );
    }),
  );
  app.post('/core/sessions/:id/outstanding', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant),
        b = object(r.body),
        a = await recalculate(c, s.id);
      if (BigInt(a.outstanding_amount) <= 0n) reject('Phiên không có dư nợ.');
      const result = await one(
        c,
        'INSERT INTO outstanding_balance_case(session_id,table_id,invoice_total,paid_total,outstanding_amount,reason_code,reported_by,notes,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [
          s.id,
          s.table_id,
          a.charge_total,
          a.paid_total,
          a.outstanding_amount,
          text(b.reason, 100),
          r.identity!.id,
          text(b.notes, 500),
          b.evidence ? text(b.evidence, 300) : null,
        ],
      );
      await c.query(
        "UPDATE table_session SET financial_status='OUTSTANDING_EXCEPTION' WHERE id=$1",
        [s.id],
      );
      await c.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'PAYMENT_SHORTFALL','CRITICAL',$3)",
        [s.id, s.table_id, a.outstanding_amount],
      );
      return result;
    }),
  );
  app.get('/core/outstanding', { config: { permission: 'admin.workspace' } }, async () =>
    db.pool
      .query(
        'SELECT o.*,t.code AS table_code FROM outstanding_balance_case o JOIN dining_table t ON t.id=o.table_id WHERE t.restaurant_id=$1 ORDER BY o.created_at DESC',
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.post(
    '/core/outstanding/:id/write-off',
    { config: { permission: 'admin.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          b = object(r.body),
          e = await one(c, 'SELECT session_id FROM outstanding_balance_case WHERE id=$1', [id]);
        const s = await session(c, e.session_id, restaurant);
        const o = await one(c, 'SELECT * FROM outstanding_balance_case WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        if (!['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(o.status))
          reject('Hồ sơ không còn chờ xử lý.');
        const a = await recalculate(c, s.id);
        const readiness = await closeReadiness(c, s.id, a);
        const blockers = readiness.blockers.filter(
          (blocker) =>
            !['UNPAID', 'OUTSTANDING_CASE', 'ALERT_PAYMENT_SHORTFALL'].includes(blocker.code),
        );
        if (blockers.length)
          throw Object.assign(new Error('Unresolved work before write-off'), {
            statusCode: 409,
            publicMessage: blockers.map((blocker) => blocker.title).join('; ') + '.',
            publicDetails: { canClose: false, blockers },
          });
        if (BigInt(a.refund_due_amount) > 0n || BigInt(a.outstanding_amount) === 0n)
          reject('Số dư đã thay đổi, cần kiểm tra lại hồ sơ.');
        await c.query(
          "UPDATE outstanding_balance_case SET status='WRITTEN_OFF',admin_owner=$2,notes=COALESCE(notes,'')||E'\n'||$3 WHERE id=$1",
          [id, r.identity!.id, text(b.reason, 500)],
        );
        await c.query(
          `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details)
           VALUES($1,$2,'WRITE_OFF_BALANCE','OUTSTANDING_BALANCE_CASE',$3,$4,$5)`,
          [
            restaurant,
            r.identity!.id,
            id,
            text(b.reason, 500),
            JSON.stringify({
              reportedAmount: o.outstanding_amount,
              writtenOffAmount: a.outstanding_amount,
              sessionId: s.id,
            }),
          ],
        );
        await c.query(
          `UPDATE operational_alert SET status='RESOLVED',resolved_at=now(),resolved_by=$2,resolution_note=$3
           WHERE session_id=$1 AND alert_type='PAYMENT_SHORTFALL' AND status<>'RESOLVED'`,
          [s.id, r.identity!.id, 'Quản trị ghi nhận không thu hồi: ' + text(b.reason, 500)],
        );
        await c.query(
          "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='OUTSTANDING_WRITTEN_OFF',version=version+1 WHERE id=$1",
          [s.id],
        );
        await c.query("UPDATE session_participant SET status='LEFT' WHERE session_id=$1", [s.id]);
        await c.query(
          "UPDATE dining_table SET table_status='NEEDS_CLEANING',version=version+1 WHERE id=$1",
          [s.table_id],
        );
        await freezeReceipt(c, s.id, restaurant, r.identity!.id);
        return { status: 'ok' };
      }),
  );
  app.post(
    '/core/outstanding/:id/recovered',
    { config: { permission: 'admin.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          b = object(r.body),
          e = await one(c, 'SELECT session_id FROM outstanding_balance_case WHERE id=$1', [id]);
        await session(c, e.session_id, restaurant);
        const a = await recalculate(c, e.session_id);
        if (BigInt(a.outstanding_amount) > 0n || BigInt(a.refund_due_amount) > 0n)
          reject('Phiên chưa cân đối đủ tiền.');
        const result = await one(
          c,
          "UPDATE outstanding_balance_case SET status='RECOVERED',admin_owner=$2,notes=COALESCE(notes,'')||E'\n'||$3 WHERE id=$1 AND status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY','PARTIALLY_RECOVERED') RETURNING *",
          [id, r.identity!.id, text(b.reason, 500)],
        );
        await c.query("UPDATE table_session SET financial_status='SETTLED' WHERE id=$1", [
          e.session_id,
        ]);
        return result;
      }),
  );
}
