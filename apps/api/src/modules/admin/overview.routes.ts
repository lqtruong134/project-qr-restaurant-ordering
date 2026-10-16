import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { reject } from '../shared/core-persistence.js';

// One read-only statement provides a consistent snapshot; no balance recalculation or writes.
export function registerAdminOverview(app: FastifyInstance, db: Database, restaurant: string) {
  app.get<{ Querystring: { period?: string } }>(
    '/core/admin/overview/statistics',
    { config: { permission: 'admin.workspace' } },
    async (request) => {
      const period = request.query.period ?? 'week';
      if (!['today', 'week', 'month'].includes(period))
        reject('Chọn Hôm nay, 7 ngày qua hoặc Tháng này để xem thống kê.', 400);
      const result = await db.pool.query(
        `WITH clock AS (
          SELECT timezone,now() AS updated,(now() AT TIME ZONE timezone) AS local_now
          FROM restaurant WHERE id=$1
        ), selected AS (
          SELECT *,CASE $2 WHEN 'today' THEN local_now::date
            WHEN 'week' THEN local_now::date-6
            ELSE date_trunc('month',local_now)::date END AS start_day FROM clock
        ), timeframe AS (
          SELECT *,local_now::date-start_day+1 AS days,
            start_day::timestamp AT TIME ZONE timezone AS start_at,
            (start_day-(local_now::date-start_day+1))::timestamp AT TIME ZONE timezone AS previous_start,
            (local_now-(local_now::date-start_day+1)*interval '1 day') AT TIME ZONE timezone AS previous_end
          FROM selected
        ), sessions AS (
          SELECT s.* FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1
        ), events AS (
          SELECT COALESCE(p.confirmed_at,p.created_at) AS at,'collected' AS kind,p.amount
            FROM payment_transaction p JOIN sessions s ON s.id=p.session_id
            WHERE p.status='SUCCEEDED'
          UNION ALL SELECT COALESCE(r.processed_at,r.created_at),'refunded',r.amount
            FROM refund_transaction r JOIN refund_case f ON f.id=r.refund_case_id
            JOIN sessions s ON s.id=f.session_id WHERE r.status='SUCCEEDED'
          UNION ALL SELECT b.submitted_at,'orders',1::bigint
            FROM order_batch b JOIN sessions s ON s.id=b.session_id WHERE b.submitted_at IS NOT NULL
          UNION ALL SELECT opened_at,'sessions',1::bigint FROM sessions
        ), scoped AS (
          SELECT e.*,CASE WHEN e.at>=w.start_at THEN 'current' ELSE 'previous' END AS phase,
            date_trunc(CASE WHEN $2='today' THEN 'hour' ELSE 'day' END,e.at AT TIME ZONE w.timezone) AS bucket
          FROM events e CROSS JOIN timeframe w
          WHERE (e.at>=w.start_at AND e.at<=w.updated)
            OR (e.at>=w.previous_start AND e.at<=w.previous_end)
        ), totals AS (
          SELECT phase,
            COALESCE(sum(amount) FILTER(WHERE kind='collected'),0) AS collected,
            COALESCE(sum(amount) FILTER(WHERE kind='refunded'),0) AS refunded,
            COALESCE(sum(amount) FILTER(WHERE kind='orders'),0)::int AS orders,
            COALESCE(sum(amount) FILTER(WHERE kind='sessions'),0)::int AS sessions
          FROM scoped GROUP BY phase
        ), buckets AS (
          SELECT generate_series(w.start_day::timestamp,
            date_trunc(CASE WHEN $2='today' THEN 'hour' ELSE 'day' END,w.local_now),
            CASE WHEN $2='today' THEN interval '1 hour' ELSE interval '1 day' END) AS bucket
          FROM timeframe w
        ), trend AS (
          SELECT b.bucket,to_char(b.bucket,CASE WHEN $2='today' THEN 'HH24:MI' ELSE 'DD/MM' END) AS label,
            COALESCE(sum(e.amount) FILTER(WHERE e.kind='collected'),0)::text AS collected,
            COALESCE(sum(e.amount) FILTER(WHERE e.kind='refunded'),0)::text AS refunded,
            COALESCE(sum(e.amount) FILTER(WHERE e.kind='orders'),0)::int AS orders,
            COALESCE(sum(e.amount) FILTER(WHERE e.kind='sessions'),0)::int AS sessions
          FROM buckets b LEFT JOIN scoped e ON e.bucket=b.bucket AND e.phase='current' GROUP BY b.bucket
        ), products AS (
          SELECT i.product_id,i.product_name_snapshot AS name,sum(i.quantity)::text AS quantity,
            sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END)::text AS amount
          FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN sessions s ON s.id=b.session_id
          LEFT JOIN financial_charge f ON f.order_item_id=i.id AND f.charge_type='ITEM' CROSS JOIN timeframe w
          WHERE i.status='SERVED' AND i.served_at>=w.start_at AND i.served_at<=w.updated
          GROUP BY i.product_id,i.product_name_snapshot
          ORDER BY sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END) DESC,i.product_name_snapshot LIMIT 5
        )
        SELECT json_build_object(
          'period',$2::text,'updatedAt',w.updated,'timezone',w.timezone,
          'startDay',w.start_day::text,'endDay',w.local_now::date::text,
          'previousStartDay',(w.start_day-w.days)::text,
          'previousEndDay',(w.local_now::date-w.days)::text,
          'granularity',CASE WHEN $2='today' THEN 'hour' ELSE 'day' END,
          'current',(SELECT json_build_object('collected',COALESCE(t.collected,0)::text,
            'refunded',COALESCE(t.refunded,0)::text,'net',COALESCE(t.collected-t.refunded,0)::text,
            'orders',COALESCE(t.orders,0),'sessions',COALESCE(t.sessions,0)) FROM (SELECT 1) x LEFT JOIN totals t ON t.phase='current'),
          'previous',(SELECT json_build_object('collected',COALESCE(t.collected,0)::text,
            'refunded',COALESCE(t.refunded,0)::text,'net',COALESCE(t.collected-t.refunded,0)::text,
            'orders',COALESCE(t.orders,0),'sessions',COALESCE(t.sessions,0)) FROM (SELECT 1) x LEFT JOIN totals t ON t.phase='previous'),
          'series',COALESCE((SELECT json_agg(trend ORDER BY bucket) FROM trend),'[]'::json),
          'topSales',COALESCE((SELECT json_agg(products) FROM products),'[]'::json)
        ) AS statistics FROM timeframe w`,
        [restaurant, period],
      );
      return result.rows[0].statistics;
    },
  );
  app.get('/core/admin/overview', { config: { permission: 'admin.workspace' } }, async () => {
    const result = await db.pool.query(
      `
      WITH scope AS (
        SELECT id, timezone, (now() AT TIME ZONE timezone)::date AS day FROM restaurant WHERE id=$1
      ), current_sessions AS (
        SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id
        WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE'
      ), active_tables AS (
        SELECT t.* FROM dining_table t JOIN dining_area a ON a.id=t.area_id
        WHERE t.restaurant_id=$1 AND t.is_active AND a.is_active
      ), people_in AS (
        SELECT DISTINCT a.user_id FROM shift_assignment a JOIN attendance_record n ON n.assignment_id=a.id
        WHERE a.restaurant_id=$1 AND a.status='ASSIGNED' AND n.checked_in_at<=now()
        AND n.checked_out_at IS NULL AND n.status<>'APPROVED'
      ), stock AS (
        SELECT i.id, i.name, i.min_stock, COALESCE(sum(b.available_qty) FILTER (WHERE l.is_active),0) AS available
        FROM ingredient i LEFT JOIN inventory_balance b ON b.ingredient_id=i.id
        LEFT JOIN stock_location l ON l.id=b.location_id AND l.restaurant_id=$1
        WHERE i.restaurant_id=$1 AND i.is_active GROUP BY i.id
      ), sales AS (
        SELECT i.product_id,i.product_name_snapshot AS name,sum(i.quantity)::text AS quantity,
          sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END)::text AS amount
        FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id
        JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id CROSS JOIN scope p
        LEFT JOIN financial_charge f ON f.order_item_id=i.id AND f.charge_type='ITEM'
        WHERE t.restaurant_id=$1 AND i.status='SERVED'
        AND i.served_at>=p.day::timestamp AT TIME ZONE p.timezone
        AND i.served_at<(p.day+1)::timestamp AT TIME ZONE p.timezone
        GROUP BY i.product_id,i.product_name_snapshot ORDER BY sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END) DESC,i.product_name_snapshot LIMIT 5
      )
      SELECT json_build_object(
        'updatedAt',now(),'day',p.day::text,'timezone',p.timezone,
        'tables',(SELECT json_build_object('total',count(*),'occupied',count(*) FILTER(WHERE table_status='OCCUPIED'),
          'cleaning',count(*) FILTER(WHERE table_status='NEEDS_CLEANING'),'available',count(*) FILTER(WHERE table_status='AVAILABLE')) FROM active_tables),
        'participants',(SELECT count(*) FROM session_participant WHERE status='ACTIVE' AND session_id IN(SELECT id FROM current_sessions)),
        'support',(SELECT json_build_object('new',count(*) FILTER(WHERE status='NEW'),'inProgress',count(*) FILTER(WHERE status='ACKNOWLEDGED'))
          FROM support_request WHERE (session_id IN(SELECT id FROM current_sessions) OR table_id IN(SELECT id FROM active_tables)) AND status IN('NEW','ACKNOWLEDGED')),
        'workforce',json_build_object('clockedIn',(SELECT count(*) FROM people_in),
          'scheduledToday',(SELECT count(DISTINCT user_id) FROM shift_assignment WHERE restaurant_id=$1 AND status='ASSIGNED'
            AND starts_at<(p.day+1)::timestamp AT TIME ZONE p.timezone AND ends_at>p.day::timestamp AT TIME ZONE p.timezone),
          'pendingAttendance',(SELECT count(*) FROM shift_assignment a LEFT JOIN attendance_record n ON n.assignment_id=a.id
            WHERE a.restaurant_id=$1 AND a.status='ASSIGNED' AND a.ends_at<=now() AND COALESCE(n.status,'')<>'APPROVED')),
        'finance',(SELECT json_build_object('payable',COALESCE(sum(charge_total),0)::text,'collected',COALESCE(sum(paid_total),0)::text,
          'refunded',COALESCE(sum(refunded_total),0)::text,'outstanding',COALESCE(sum(outstanding_amount),0)::text,
          'refundDue',COALESCE(sum(refund_due_amount),0)::text) FROM session_financial_account WHERE session_id IN(SELECT id FROM current_sessions)),
        'inventory',json_build_object('unavailable',(SELECT count(*) FROM stock WHERE available<=0),
          'low',(SELECT count(*) FROM stock WHERE available>0 AND available<min_stock),
          'draftReceipts',(SELECT count(*) FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE l.restaurant_id=$1 AND g.status='DRAFT')),
        'topSales',COALESCE((SELECT json_agg(sales) FROM sales),'[]'::json)
      ) AS snapshot FROM scope p`,
      [restaurant],
    );
    return result.rows[0].snapshot;
  });
}
