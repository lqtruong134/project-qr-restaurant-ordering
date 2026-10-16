import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { reportRange } from '../admin/report-range.js';
import { withItemRefundHistory } from '../payments/refund-history.service.js';
import { assignmentQuery, attendanceSummary } from '../workforce/workforce.service.js';
import { object, reject, transaction, uuid } from './core-persistence.js';

const receiptSql = `SELECT g.*,l.name AS location_name,u.display_name AS creator_name,
 concat_ws(' ',g.receipt_no,g.external_reference,g.supplier_name_snapshot,l.name,u.display_name) AS _search,
 g.created_at AS _date,g.created_at AS _end,g.status AS _state,g.location_id AS _scope
 FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id JOIN app_user u ON u.id=g.created_by WHERE l.restaurant_id=$1`;
const movementSql = `SELECT m.*,i.name AS ingredient_name,i.code AS ingredient_code,v.code AS unit,l.name AS location_name,u.display_name AS actor_name,g.receipt_no,
 concat_ws(' ',i.name,i.code,l.name,u.display_name,m.reason,g.receipt_no,g.external_reference) AS _search,
 m.occurred_at AS _date,m.occurred_at AS _end,m.movement_type AS _state,m.location_id AS _scope
 FROM inventory_movement m JOIN ingredient i ON i.id=m.ingredient_id JOIN unit_of_measure v ON v.id=i.base_unit_id
 JOIN stock_location l ON l.id=m.location_id LEFT JOIN app_user u ON u.id=m.created_by LEFT JOIN goods_receipt g ON g.id=m.goods_receipt_id WHERE l.restaurant_id=$1`;
const attendanceSql =
  assignmentQuery.replace(
    'SELECT a.*,',
    `SELECT a.*,
 concat_ws(' ',u.display_name,u.username,s.name,d.name,t.review_note) AS _search,
 a.starts_at AS _date,a.ends_at-interval '1 microsecond' AS _end,a.user_id AS _scope,
 CASE WHEN a.status='CANCELLED' THEN 'cancelled' WHEN t.status='APPROVED' THEN 'approved'
 WHEN t.checked_in_at IS NOT NULL AND t.checked_out_at IS NULL AND now()<=a.ends_at+s.clock_out_late_minutes*interval '1 minute' THEN 'active'
 WHEN a.ends_at<=now() THEN 'pending' ELSE 'scheduled' END AS _state,`,
  ) + ' WHERE a.restaurant_id=$1';
const payrollSql = `SELECT p.*,count(DISTINCT s.id)::int AS employee_count,COALESCE(sum(l.amount),0)::text AS total_amount,
 concat_ws(' ',p.period_start,p.period_end,string_agg(DISTINCT s.employee_name_snapshot,' '),string_agg(DISTINCT s.username_snapshot,' ')) AS _search,
 (p.period_start::timestamp AT TIME ZONE r.timezone) AS _date,
 (p.period_end::timestamp AT TIME ZONE r.timezone)-interval '1 microsecond' AS _end,p.status AS _state,NULL::uuid AS _scope
 FROM payroll_run p JOIN restaurant r ON r.id=p.restaurant_id LEFT JOIN payroll_slip s ON s.payroll_run_id=p.id LEFT JOIN payroll_line l ON l.payroll_slip_id=s.id
 WHERE p.restaurant_id=$1 GROUP BY p.id,r.timezone`;
const ratesSql = `SELECT p.*,u.username,u.display_name,a.display_name AS actor_name,
 concat_ws(' ',u.username,u.display_name,p.reason,a.display_name) AS _search,
 p.effective_from AS _date,p.effective_from AS _end,'rate'::text AS _state,p.user_id AS _scope
 FROM employee_pay_rate p JOIN app_user u ON u.id=p.user_id LEFT JOIN app_user a ON a.id=p.created_by WHERE p.restaurant_id=$1`;
const closedSql = `SELECT s.id,s.receipt_number,s.opened_at,s.closed_at,s.close_reason,t.code AS table_code,
 COALESCE(s.receipt_snapshot->'account'->>'charge_total',a.charge_total::text,'0') AS total_amount,a.paid_total,a.refunded_total,a.outstanding_amount,u.display_name AS closed_by_name,
 concat_ws(' ',s.id,s.receipt_number,t.code,u.display_name) AS _search,
 s.closed_at AS _date,s.closed_at AS _end,s.close_reason AS _state,t.area_id AS _scope
 FROM table_session s JOIN dining_table t ON t.id=s.table_id LEFT JOIN session_financial_account a ON a.session_id=s.id
 LEFT JOIN app_user u ON u.id=s.closed_by WHERE t.restaurant_id=$1 AND s.session_status='CLOSED'`;

const lookupSql = `SELECT i.*,t.code AS table_code,b.session_id,upper(left(b.session_id::text,8)) AS session_code,
 s.session_status,s.closed_at AS session_closed_at,s.receipt_number,
 cancellation.changed_at AS cancelled_at,cancellation.actor_type AS cancelled_actor_type,
 COALESCE(canceller.display_name,cancel_guest.display_name) AS cancelled_by_name,
 decision.action AS decision_action,decision.created_at AS decision_at,decision.reason AS decision_reason,
 decider.display_name AS decision_by_name,
 COALESCE((SELECT sum(f.amount-f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS charged_amount,
    COALESCE((SELECT sum(f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS discount_amount,
    EXISTS(SELECT 1 FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE') AS has_charge,
 EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=i.id AND e.action='LATE_CANCEL') AS late_cancelled,
 false AS reported_issue,concat_ws(' ',t.code,i.product_name_snapshot,b.session_id,i.cancel_reason,decision.reason,decider.display_name,canceller.display_name,cancel_guest.display_name) AS _search,
 i.created_at AS _date,i.created_at AS _end,i.status AS _state,t.area_id AS _scope
 FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id
 LEFT JOIN LATERAL (SELECT h.* FROM order_status_history h WHERE h.order_item_id=i.id AND h.new_status='CANCELLED' ORDER BY h.changed_at DESC,h.id DESC LIMIT 1) cancellation ON true
 LEFT JOIN app_user canceller ON canceller.id=cancellation.actor_user_id
 LEFT JOIN session_participant cancel_guest ON cancel_guest.id=cancellation.actor_participant_id
 LEFT JOIN LATERAL (SELECT e.* FROM business_audit_event e WHERE e.resource_id=i.id AND e.restaurant_id=$1
   AND e.action IN ('CANCEL_ITEM','LATE_CANCEL','RESTAURANT_FAULT_CONFIRMED','RESTAURANT_FAULT_DECLINED','WAIVE_ITEM')
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1) decision ON true
 LEFT JOIN app_user decider ON decider.id=decision.actor_id
 WHERE t.restaurant_id=$1 AND NOT EXISTS(SELECT 1 FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=i.id AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED')`;

const cancelledSql = lookupSql.replace(
  'i.created_at AS _date,i.created_at AS _end',
  'COALESCE(decision.created_at,cancellation.changed_at,i.created_at) AS _date,COALESCE(decision.created_at,cancellation.changed_at,i.created_at) AS _end',
);

// Stock inspection remains traceable after the table is closed; the item charge was already removed.
const unavailableSql = `SELECT i.*,t.code AS table_code,b.session_id,upper(left(b.session_id::text,8)) AS session_code,s.session_status,s.closed_at AS session_closed_at,s.receipt_number,true AS stock_inspection,
 report.id AS report_id,report.created_at AS reported_at,report.reason AS reported_reason,
 report.details->>'reasonCode' AS reported_reason_code,reporter.display_name AS reported_by_name,
 alert.status AS stock_check_status,checked.created_at AS stock_checked_at,
 checker.display_name AS stock_checked_by_name,checked.reason AS stock_check_note,
 COALESCE((SELECT sum(f.amount-f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS charged_amount,
    COALESCE((SELECT sum(f.discount_amount) FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE'),0)::text AS discount_amount,
    EXISTS(SELECT 1 FROM financial_charge f WHERE f.order_item_id=i.id AND f.status='ACTIVE') AS has_charge,
 EXISTS(SELECT 1 FROM business_audit_event n JOIN operational_alert a ON a.id=(n.details->>'alertId')::uuid
   WHERE n.resource_id=i.id AND n.action='KITCHEN_ISSUE_GUEST_NOTICE' AND a.status='RESOLVED') AS guest_notified,
 account.refund_due_amount,
 concat_ws(' ',t.code,i.product_name_snapshot,b.session_id,i.cancel_reason,report.reason,reporter.display_name,checked.reason,checker.display_name) AS _search,
 COALESCE(report.created_at,i.created_at) AS _date,COALESCE(report.created_at,i.created_at) AS _end,
 COALESCE(alert.status,'UNAVAILABLE') AS _state,t.area_id AS _scope
 FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id
 JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id
 LEFT JOIN session_financial_account account ON account.session_id=s.id
 LEFT JOIN LATERAL (SELECT e.* FROM business_audit_event e
   WHERE e.resource_id=i.id AND e.restaurant_id=$1 AND e.action='KITCHEN_UNAVAILABLE_REPORTED'
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1) report ON true
 LEFT JOIN operational_alert alert ON alert.id=(report.details->>'alertId')::uuid
 LEFT JOIN app_user reporter ON reporter.id=report.actor_id
 LEFT JOIN LATERAL (SELECT e.* FROM business_audit_event e
   WHERE e.resource_id=i.id AND e.restaurant_id=$1 AND e.action='KITCHEN_STOCK_CHECKED'
     AND e.details->>'alertId'=alert.id::text ORDER BY e.created_at DESC,e.id DESC LIMIT 1) checked ON true
 LEFT JOIN app_user checker ON checker.id=checked.actor_id
 WHERE t.restaurant_id=$1 AND i.status='UNAVAILABLE'`;

export function registerHistory(app: FastifyInstance, db: Database, restaurant: string) {
  for (const [kind, sql, permission] of [
    [
      'order-active',
      lookupSql +
        " AND s.session_status='ACTIVE' AND i.status IN ('IN_PREPARATION','READY','SERVED')",
      'admin.workspace',
    ],
    ['order-cancelled', cancelledSql + " AND i.status='CANCELLED'", 'admin.workspace'],
    ['order-unavailable', unavailableSql, 'admin.workspace'],
    ['receipts', receiptSql, 'admin.workspace'],
    ['movements', movementSql, 'admin.workspace'],
    ['attendance', attendanceSql, 'admin.workspace'],
    ['payroll', payrollSql, 'admin.workspace'],
    ['rates', ratesSql, 'admin.workspace'],
    ['closed-bills', closedSql, 'staff.workspace'],
    [
      'my-attendance',
      attendanceSql.replace(
        "WHEN a.ends_at<=now() THEN 'pending'",
        "WHEN a.ends_at<=now() OR t.checked_out_at IS NOT NULL THEN 'pending'",
      ) +
        " AND a.user_id=$7 AND (a.status='CANCELLED' OR a.ends_at<=now() OR t.checked_out_at IS NOT NULL)",
      'self',
    ],
  ] as const) {
    app.get(
      '/core/history/' + kind,
      { config: permission === 'self' ? { authenticated: true } : { permission } },
      async (r) =>
        transaction(db, async (c) => {
          await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          const q = object(r.query),
            period = String(q.period ?? 'all'),
            search = String(q.q ?? '').trim();
          if (search.length > 160) reject('Tìm kiếm tối đa 160 ký tự.', 400);
          const page = Number(q.page ?? 0);
          if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
            reject('Trang không hợp lệ.', 400);
          const calendar = (
            await c.query(
              'SELECT timezone,(now() AT TIME ZONE timezone)::date::text AS today FROM restaurant WHERE id=$1',
              [restaurant],
            )
          ).rows[0];
          let range;
          try {
            range = reportRange(
              period,
              calendar.today,
              q.from ? String(q.from) : undefined,
              q.to ? String(q.to) : undefined,
            );
          } catch (e) {
            reject((e as Error).message, 400);
          }
          const values: unknown[] = [
            restaurant,
            '%' + search.replace(/[\\%_]/g, '\\$&') + '%',
            String(q.status ?? 'all'),
            period === 'all' ? null : range.startDay,
            period === 'all' ? null : range.endDay,
            q.scope && q.scope !== 'all' ? uuid(q.scope) : null,
          ];
          if (kind === 'my-attendance') values.push(r.identity!.id);
          if (kind === 'order-unavailable' && q.itemId !== undefined) values.push(uuid(q.itemId));
          const category = String(q.category ?? 'all');
          if (kind.includes('attendance') && !['all', 'normal', 'exceptions'].includes(category))
            reject('Phân loại công không hợp lệ.', 400);
          const exceptional = `(h.checked_in_at IS NULL OR h.checked_out_at IS NULL OR h.checked_in_at>h.starts_at+h.attendance_grace_minutes*interval '1 minute' OR h.checked_out_at<h.ends_at-h.attendance_grace_minutes*interval '1 minute' OR greatest(0,floor(extract(epoch FROM h.starts_at-h.checked_in_at)/60))+greatest(0,floor(extract(epoch FROM h.checked_out_at-h.ends_at)/60))>h.attendance_grace_minutes OR least(h.checked_out_at,h.ends_at)<=greatest(h.checked_in_at,h.starts_at))`;
          const extra =
            kind === 'order-unavailable' && q.itemId !== undefined
              ? ' AND h.id=$7'
              : kind.includes('attendance') && category !== 'all'
                ? ` AND h.status='ASSIGNED' AND h.ends_at<=now() AND COALESCE(h.attendance_status,'RECORDED')<>'APPROVED' AND ${category === 'normal' ? 'NOT ' : ''}${exceptional}`
                : '';
          const where = ` FROM (${sql}) h WHERE (_search ILIKE $2 ESCAPE '\\') AND ($3='all' OR _state=$3)
        AND ($4::date IS NULL OR _end>=($4::date::timestamp AT TIME ZONE '${calendar.timezone.replaceAll("'", "''")}'))
        AND ($5::date IS NULL OR _date<(($5::date+1)::timestamp AT TIME ZONE '${calendar.timezone.replaceAll("'", "''")}'))
        AND ($6::uuid IS NULL OR _scope=$6)${extra}`;
          const total = Number(
            (await c.query('SELECT count(*)::int AS total' + where, values)).rows[0].total,
          );
          const current = Math.min(page, Math.max(0, Math.ceil(total / 12) - 1));
          const rows = (
            await c.query(
              'SELECT h.*' +
                where +
                ` ORDER BY _date DESC,id DESC LIMIT 12 OFFSET $${values.length + 1}`,
              [...values, current * 12],
            )
          ).rows;
          return {
            rows: kind?.includes('attendance')
              ? rows.map((a) => attendanceSummary(a))
              : ['order-unavailable', 'order-cancelled', 'order-active'].includes(kind)
                ? await withItemRefundHistory(c, rows)
                : rows,
            total,
            page: current,
            pageSize: 12,
            timezone: calendar.timezone,
            range: period === 'all' ? null : range,
          };
        }),
    );
  }
}
