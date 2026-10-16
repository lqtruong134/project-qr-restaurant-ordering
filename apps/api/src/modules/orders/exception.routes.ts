import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  one,
  session,
  transaction,
  idParam,
  object,
  reject,
  history,
  event,
} from '../shared/core-persistence.js';
import { aggregateBatch } from './item-lifecycle.service.js';
import { reverseItemCharge } from '../finance/ledger.service.js';
import { parseReason } from './reasons.js';
import { orderReasons, type OrderReasonCode } from '@thesis/contracts';
import { recordItemAudit, resolveItemIssue } from './issue.routes.js';
export function registerOrderExceptions(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get(
    '/core/order-exceptions',
    { config },
    async (r) =>
      (
        await db.pool.query(
          `WITH candidates AS (SELECT i.*,t.code AS table_code,b.session_id,upper(left(b.session_id::text,8)) AS session_code,s.session_status,
    report.id AS report_id,report.created_at AS reported_at,report.reason AS reported_reason,
    report.details->>'reasonCode' AS reported_reason_code,report.details->>'note' AS reported_note,
    reporter.display_name AS reported_by_name,
    EXISTS(SELECT 1 FROM business_audit_event n JOIN operational_alert na ON na.id=(n.details->>'alertId')::uuid
      WHERE n.resource_id=i.id AND n.action='KITCHEN_ISSUE_GUEST_NOTICE' AND na.status='RESOLVED') AS guest_notified,
    EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=i.id AND e.action='LATE_CANCEL') AS late_cancelled,
    COALESCE((SELECT sum(f.amount-f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS charged_amount,
    COALESCE((SELECT sum(f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS discount_amount,
    EXISTS(SELECT 1 FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE') AS has_charge,
    EXISTS(SELECT 1 FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=i.id AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED') AS reported_issue
    FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id
    LEFT JOIN LATERAL (SELECT e.* FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid
      WHERE e.resource_id=i.id AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED' ORDER BY e.created_at DESC,e.id DESC LIMIT 1) report ON true
    LEFT JOIN app_user reporter ON reporter.id=report.actor_id
    WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' AND i.status IN ('IN_PREPARATION','READY','SERVED','CANCELLED')),
    ranked AS (SELECT *,row_number() OVER (PARTITION BY reported_issue ORDER BY created_at DESC,id) AS history_rank FROM candidates)
    SELECT * FROM ranked WHERE reported_issue OR (NOT $2 AND history_rank<=200)
    ORDER BY reported_issue DESC,reported_at ASC NULLS LAST,created_at DESC,id`,
          [restaurant, object(r.query).pending === 'true'],
        )
      ).rows,
  );
  for (const action of ['late-cancel', 'waive'])
    app.post('/core/items/:id/' + action, { config }, async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          body = object(r.body),
          actor = { type: 'USER' as const, id: r.identity!.id };
        const source = await one(
          c,
          'SELECT b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
          [id],
        );
        const s = await session(c, source.session_id, restaurant, false);
        if (s.session_status !== 'ACTIVE' || s.receipt_snapshot)
          reject('Phiên bàn đã chốt. Không thể hủy món hoặc miễn tiền sau khi kết thúc phiên.');
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        let reason: ReturnType<typeof parseReason>;
        if (body.useReportedReason === true) {
          if (action !== 'late-cancel')
            reject('Chỉ duyệt báo cáo bếp bằng thao tác xử lý món.', 400);
          const report = await one(
            c,
            "SELECT e.*,a.status AS alert_status FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=$1 AND e.restaurant_id=$2 AND e.action='KITCHEN_ISSUE_REPORTED' ORDER BY e.created_at DESC,e.id DESC LIMIT 1",
            [id, restaurant],
          );
          if (body.expectedReportId !== report.id)
            reject('Báo cáo đã thay đổi. Hãy tải lại trước khi duyệt.');
          const code = report.details.reasonCode as OrderReasonCode;
          if (!Object.hasOwn(orderReasons, code) || !orderReasons[code].fault)
            reject('Báo cáo không có lý do lỗi nhà hàng hợp lệ.');
          if (report.alert_status === 'RESOLVED') {
            const applied = await c.query(
              "SELECT id FROM business_audit_event WHERE resource_id=$1 AND action='RESTAURANT_FAULT_CONFIRMED' AND details->>'reportId'=$2",
              [id, report.id],
            );
            if (applied.rowCount) return { status: 'ok', alreadyProcessed: true };
            reject('Báo cáo đã được quyết định bằng thao tác khác.');
          }
          reason = { code, note: report.details.note ?? '', fault: true, text: report.reason };
        } else reason = parseReason(body, action === 'waive' ? 'ADMIN_WAIVE' : 'ADMIN_LATE');
        const previous = (
          await c.query(
            "SELECT details FROM business_audit_event WHERE resource_id=$1 AND action='LATE_CANCEL' ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        ).rows[0];
        const pending = (
          await c.query(
            "SELECT e.id FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=$1 AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED'",
            [id],
          )
        ).rowCount;
        if (action === 'late-cancel') {
          if (
            item.status === 'CANCELLED' &&
            !pending &&
            item.cancel_reason_code === reason.code &&
            item.cancel_reason === reason.text
          )
            return { status: 'ok', alreadyProcessed: true };
          if (
            !['IN_PREPARATION', 'READY', 'SERVED'].includes(item.status) &&
            !(item.status === 'CANCELLED' && pending)
          )
            reject('Chỉ xử lý món đã bắt đầu chế biến hoặc sự cố đang chờ quản trị.');
          if (
            reason.fault &&
            (item.status === 'SERVED' || previous?.details.previousStatus === 'SERVED')
          )
            reject('Món đã phục vụ: dùng quyết định miễn tiền để xử lý khiếu nại.');
          await c.query(
            "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancel_reason_code=$3,cancelled_by_type='USER',cancelled_by_user_id=$4,version=version+1 WHERE id=$1",
            [id, reason.text, reason.code, actor.id],
          );
          if (item.status !== 'CANCELLED') {
            await history(c, item.order_batch_id, id, item.status, 'CANCELLED', actor, reason.text);
            await aggregateBatch(c, item.order_batch_id, actor);
            const loss = await one(
              c,
              'SELECT COALESCE(sum(cogs_value),0)::text AS amount FROM order_item_ingredient_snapshot WHERE order_item_id=$1',
              [id],
            );
            await recordItemAudit(c, restaurant, actor.id, id, 'LATE_CANCEL', reason.text, {
              previousStatus: item.status,
              consumedCost: loss.amount,
              chargeRetained: !reason.fault,
              reasonCode: reason.code,
            });
          }
          if (reason.fault) {
            const result = await reverseItemCharge(c, id, s.id);
            await recordItemAudit(
              c,
              restaurant,
              actor.id,
              id,
              'RESTAURANT_FAULT_CONFIRMED',
              reason.text,
              {
                reasonCode: reason.code,
                amount: result.amount,
                chargeRetained: false,
                ...(body.useReportedReason === true ? { reportId: body.expectedReportId } : {}),
              },
            );
          } else if (pending)
            await recordItemAudit(
              c,
              restaurant,
              actor.id,
              id,
              'RESTAURANT_FAULT_DECLINED',
              reason.text,
              { reasonCode: reason.code, chargeRetained: true },
            );
          await resolveItemIssue(c, id, actor.id, reason.text, restaurant);
        } else {
          if (!previous && !['IN_PREPARATION', 'READY', 'SERVED'].includes(item.status))
            reject('Miễn tiền áp dụng cho món đã chế biến hoặc đã hủy muộn.');
          const result = await reverseItemCharge(c, id, s.id);
          if (!result.reversed) reject('Khoản thu đã được miễn hoặc không phát sinh.');
          await recordItemAudit(c, restaurant, actor.id, id, 'WAIVE_ITEM', reason.text, {
            amount: result.amount,
            reasonCode: reason.code,
          });
          await resolveItemIssue(c, id, actor.id, reason.text, restaurant);
        }
        await event(
          c,
          item.order_batch_id,
          action === 'waive' ? 'ITEM_WAIVED' : 'ITEM_LATE_CANCELLED',
        );
        return { status: 'ok', chargeRetained: action === 'late-cancel' && !reason.fault };
      }),
    );
}
