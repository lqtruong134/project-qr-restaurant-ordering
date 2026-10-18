import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { reject } from '../shared/core-persistence.js';
import { reportRange } from './report-range.js';

const args = `args AS (SELECT $1::uuid AS restaurant,$2::date AS first_day,$3::date AS last_day,
  $4::text AS timezone,$5::text AS search,$6::text AS filter,$7::text AS sort,
  $8::int AS size,$9::int AS offset,$10::text AS bucket,$11::text AS status)`;
const dates = (column: string) => `${column}>=a.first_day::timestamp AT TIME ZONE a.timezone
  AND ${column}<(a.last_day+1)::timestamp AT TIME ZONE a.timezone`;
const search = (column: string) => `strpos(lower(${column}),lower(a.search))>0`;
const jsonRows = `(SELECT COALESCE(json_agg(p),'[]'::json) FROM page_rows p)`;
const timeline = (primary: string, secondary: string) => `buckets AS (
  SELECT generate_series(date_trunc(a.bucket,a.first_day::timestamp),date_trunc(a.bucket,a.last_day::timestamp+interval '23 hours'),
    CASE a.bucket WHEN 'hour' THEN interval '1 hour' WHEN 'day' THEN interval '1 day' ELSE interval '1 month' END) AS at FROM args a
), trend AS (
  SELECT b.at,to_char(b.at,CASE a.bucket WHEN 'hour' THEN 'HH24:MI' WHEN 'day' THEN 'DD/MM' ELSE 'MM/YYYY' END) AS label,
    COALESCE(sum(${primary}),0)::text AS primary,COALESCE(sum(${secondary}),0)::text AS secondary
  FROM buckets b CROSS JOIN args a LEFT JOIN filtered f ON date_trunc(a.bucket,f.at AT TIME ZONE a.timezone)=b.at
  GROUP BY b.at,a.bucket
)`;
const series = `(SELECT COALESCE(json_agg(t ORDER BY at),'[]'::json) FROM trend t)`;

const salesSql = `WITH ${args}, base AS (
  SELECT i.product_id,i.product_name_snapshot AS name,i.quantity,i.served_at AS at,
    p.category_id,COALESCE(mc.name,'Chưa phân loại') AS category,
    CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END AS sales,
    CASE WHEN f.status='ACTIVE' THEN f.amount ELSE 0 END AS subtotal,
    CASE WHEN f.status='ACTIVE' THEN f.discount_amount ELSE 0 END AS discount,
    CASE WHEN f.status='ACTIVE' THEN COALESCE(f.tax_amount,0) ELSE 0 END AS vat,
    (f.status='ACTIVE' AND f.amount>0 AND f.tax_snapshot IS NULL) AS legacy_tax,
    COALESCE((SELECT sum(s.cogs_value) FROM order_item_ingredient_snapshot s WHERE s.order_item_id=i.id),0) AS cost
  FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id
  JOIN dining_table t ON t.id=s.table_id LEFT JOIN product p ON p.id=i.product_id LEFT JOIN menu_category mc ON mc.id=p.category_id
  LEFT JOIN financial_charge f ON f.order_item_id=i.id AND f.charge_type='ITEM' CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND i.status='SERVED' AND ${dates('i.served_at')}
), filtered AS (SELECT b.* FROM base b CROSS JOIN args a WHERE ${search('b.name')}
  AND (a.filter='' OR b.category_id::text=a.filter OR (a.filter='uncategorized' AND b.category_id IS NULL))), grouped AS (
  SELECT md5(product_id::text||name) AS id,product_id,name,category,
    sum(quantity)::text AS quantity,sum(sales)::text AS sales,sum(cost)::text AS cost,
    sum(subtotal)::text AS subtotal,sum(discount)::text AS "discountAmount",sum(vat)::text AS vat,
    COALESCE(bool_or(legacy_tax),false) AS "legacyTaxUnavailable",
    CASE WHEN bool_or(legacy_tax) THEN NULL ELSE (sum(sales)-sum(vat))::text END AS "beforeVatSales",
    CASE WHEN bool_or(legacy_tax) THEN NULL ELSE (sum(sales)-sum(vat)-sum(cost))::text END AS margin
  FROM filtered GROUP BY product_id,name,category
), page_rows AS (
  SELECT g.* FROM grouped g CROSS JOIN args a ORDER BY
    CASE WHEN a.sort='name' THEN g.name END,
    CASE WHEN a.sort='quantity' THEN g.quantity::numeric ELSE g.sales::numeric END DESC,g.name,g.id
  LIMIT $8 OFFSET $9
), ${timeline('f.sales', 'f.cost')}
SELECT json_build_object('rows',${jsonRows},'total',(SELECT count(*) FROM grouped),
  'summary',(SELECT json_build_object('sales',COALESCE(sum(sales::numeric),0)::text,'cost',COALESCE(sum(cost::numeric),0)::text,
    'margin',CASE WHEN bool_or("legacyTaxUnavailable") THEN NULL ELSE COALESCE(sum(margin::numeric),0)::text END,
    'subtotal',COALESCE(sum(subtotal::numeric),0)::text,'discountAmount',COALESCE(sum("discountAmount"::numeric),0)::text,
    'vat',COALESCE(sum(vat::numeric),0)::text,'legacyTaxUnavailable',COALESCE(bool_or("legacyTaxUnavailable"),false),
    'beforeVatSales',CASE WHEN bool_or("legacyTaxUnavailable") THEN NULL ELSE COALESCE(sum("beforeVatSales"::numeric),0)::text END,
    'quantity',COALESCE(sum(quantity::numeric),0)::text) FROM grouped),
  'options',(SELECT COALESCE(json_agg(x ORDER BY name),'[]'::json) FROM (SELECT DISTINCT category_id::text AS id,category AS name FROM base) x),
  'series',${series},'breakdown',(SELECT COALESCE(json_agg(x),'[]'::json) FROM
    (SELECT name,sales AS value FROM grouped ORDER BY sales::numeric DESC,name LIMIT 5) x)) AS report`;

const paymentsSql = `WITH ${args}, base AS (
  SELECT p.id,p.session_id,t.code AS table_code,s.receipt_number,p.method,p.amount,COALESCE(p.confirmed_at,p.created_at) AS at,
    'PAYMENT'::text AS kind,u.display_name AS actor
  FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id
  LEFT JOIN app_user u ON u.id=p.confirmed_by CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND p.status='SUCCEEDED' AND ${dates('COALESCE(p.confirmed_at,p.created_at)')}
  UNION ALL SELECT r.id,f.session_id,t.code,s.receipt_number,r.method,r.amount,COALESCE(r.processed_at,r.created_at),
    'REFUND',u.display_name FROM refund_transaction r JOIN refund_case f ON f.id=r.refund_case_id
  JOIN table_session s ON s.id=f.session_id JOIN dining_table t ON t.id=s.table_id LEFT JOIN app_user u ON u.id=r.processed_by CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND r.status='SUCCEEDED' AND ${dates('COALESCE(r.processed_at,r.created_at)')}
), filtered AS (SELECT b.* FROM base b CROSS JOIN args a
  WHERE ${search("concat_ws(' ',b.table_code,b.receipt_number,b.actor,b.id::text)")}
    AND (a.filter='' OR b.method=a.filter) AND (a.status='' OR b.kind=a.status)),
page_rows AS (SELECT f.id,f.session_id,f.table_code,f.receipt_number,f.method,f.amount::text,f.at,f.kind,f.actor
  FROM filtered f CROSS JOIN args a ORDER BY CASE WHEN a.sort='oldest' THEN f.at END ASC,
    CASE WHEN a.sort='amount' THEN f.amount END DESC,f.at DESC,f.id LIMIT $8 OFFSET $9),
${timeline("CASE WHEN f.kind='PAYMENT' THEN f.amount ELSE 0 END", "CASE WHEN f.kind='REFUND' THEN f.amount ELSE 0 END")}
SELECT json_build_object('rows',${jsonRows},'total',(SELECT count(*) FROM filtered),
  'summary',(SELECT json_build_object('collected',COALESCE(sum(amount) FILTER(WHERE kind='PAYMENT'),0)::text,
    'refunded',COALESCE(sum(amount) FILTER(WHERE kind='REFUND'),0)::text,
    'net',(COALESCE(sum(amount) FILTER(WHERE kind='PAYMENT'),0)-COALESCE(sum(amount) FILTER(WHERE kind='REFUND'),0))::text,
    'transactions',count(*)) FROM filtered),'series',${series},
  'breakdown',(SELECT COALESCE(json_agg(x ORDER BY value::numeric DESC),'[]'::json) FROM
    (SELECT method AS name,sum(amount)::text AS value FROM filtered WHERE kind='PAYMENT' GROUP BY method) x)) AS report`;

const reconciliationSql = `WITH ${args}, sessions AS (
  SELECT s.id,s.receipt_number,t.code AS table_code,s.opened_at AS at,s.closed_at,s.session_status,
    CASE WHEN s.session_status<>'ACTIVE' THEN s.receipt_snapshot END AS receipt_snapshot
  FROM table_session s JOIN dining_table t ON t.id=s.table_id CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND ${dates('s.opened_at')}
    AND ${search("concat_ws(' ',t.code,s.receipt_number,s.id::text)")}
), balances AS (
  SELECT s.*,
    COALESCE((s.receipt_snapshot#>>'{account,charge_total}')::numeric,
      (SELECT sum(amount-discount_amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS payable,
    COALESCE((SELECT sum(amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS subtotal,
    COALESCE((SELECT sum(discount_amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS "discountAmount",
    COALESCE((SELECT sum(tax_amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS vat,
    EXISTS(SELECT 1 FROM financial_charge WHERE session_id=s.id AND status='ACTIVE' AND amount>0 AND tax_snapshot IS NULL) AS "legacyTaxUnavailable",
    COALESCE((s.receipt_snapshot#>>'{account,paid_total}')::numeric,
      (SELECT sum(amount) FROM payment_transaction WHERE session_id=s.id AND status='SUCCEEDED'),0)::text AS collected,
    COALESCE((s.receipt_snapshot#>>'{account,refunded_total}')::numeric,
      (SELECT sum(rt.amount) FROM refund_transaction rt JOIN refund_case f ON f.id=rt.refund_case_id WHERE f.session_id=s.id AND rt.status='SUCCEEDED'),0)::text AS refunded,
    COALESCE((s.receipt_snapshot#>>'{account,outstanding_amount}')::numeric,
      (SELECT sum(greatest(f.amount-f.discount_amount-COALESCE((SELECT sum(x.allocated_amount-x.reversed_amount)
        FROM payment_allocation x JOIN payment_transaction p ON p.id=x.payment_transaction_id
        WHERE x.financial_charge_id=f.id AND p.status='SUCCEEDED'),0),0))
       FROM financial_charge f WHERE f.session_id=s.id AND f.status='ACTIVE'),0) AS raw_outstanding,
    COALESCE((s.receipt_snapshot#>>'{account,refund_due_amount}')::numeric,
      (SELECT sum(greatest(p.amount-COALESCE((SELECT sum(rt.amount) FROM refund_transaction rt
        JOIN refund_case f ON f.id=rt.refund_case_id WHERE f.source_payment_transaction_id=p.id AND rt.status='SUCCEEDED'),0)
        -COALESCE((SELECT sum(x.allocated_amount-x.reversed_amount) FROM payment_allocation x
          JOIN financial_charge f ON f.id=x.financial_charge_id WHERE x.payment_transaction_id=p.id AND f.status='ACTIVE'),0),0))
       FROM payment_transaction p WHERE p.session_id=s.id AND p.status='SUCCEEDED'),0) AS refund_due,
    COALESCE((SELECT sum(outstanding_amount) FROM outstanding_balance_case WHERE session_id=s.id AND status='WRITTEN_OFF'),0)::text AS written_off,
    COALESCE((SELECT sum(amount-discount_amount) FROM financial_charge WHERE session_id=s.id AND status='REVERSED'),0)::text AS reversed,
    COALESCE((SELECT sum((e.details->>'consumedCost')::bigint) FROM business_audit_event e JOIN order_item i ON i.id=e.resource_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=s.id AND e.action='LATE_CANCEL'),0)::text AS stock_loss
  FROM sessions s
), amounts AS (
  SELECT *,greatest(raw_outstanding-written_off::numeric,0) AS outstanding,
    greatest(payable::numeric-raw_outstanding,0) AS applied,
    (payable::numeric-collected::numeric+refunded::numeric-written_off::numeric) AS balance
  FROM balances
), filtered AS (SELECT b.* FROM amounts b CROSS JOIN args a WHERE a.filter=''
  OR (a.filter='due' AND b.outstanding>0) OR (a.filter='refund' AND b.refund_due>0)
  OR (a.filter='balanced' AND b.outstanding=0 AND b.refund_due=0)),
page_rows AS (SELECT f.id,f.receipt_number,f.table_code,f.at,f.closed_at,f.session_status,f.payable,f.collected,f.refunded,
  f.written_off,f.reversed,f.stock_loss,f.subtotal,f."discountAmount",f.vat,f."legacyTaxUnavailable",
  f.outstanding::text,f.refund_due::text AS "refundDue",f.applied::text AS "appliedAmount",
  f.balance::text AS "financialBalance",f.balance::text FROM filtered f CROSS JOIN args a
  ORDER BY CASE WHEN a.sort='oldest' THEN f.at END ASC,
    CASE WHEN a.sort='balance' THEN greatest(f.outstanding,f.refund_due) END DESC,
    f.at DESC,f.id LIMIT $8 OFFSET $9)
SELECT json_build_object('rows',${jsonRows},'total',(SELECT count(*) FROM filtered),
  'summary',(SELECT json_build_object('sessions',count(*),
    'balanced',count(*) FILTER(WHERE outstanding=0 AND refund_due=0),
    'outstanding',COALESCE(sum(outstanding),0)::text,'refundDue',COALESCE(sum(refund_due),0)::text,
    'appliedAmount',COALESCE(sum(applied),0)::text,
    'financialBalance',COALESCE(sum(balance),0)::text) FROM filtered)) AS report`;

const outstandingSql = `WITH ${args}, filtered AS (
  SELECT o.id,o.session_id,t.code AS table_code,o.created_at AS at,o.status,o.notes,o.invoice_total::text,
    o.paid_total::text,o.outstanding_amount::text FROM outstanding_balance_case o JOIN dining_table t ON t.id=o.table_id CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND ${dates('o.created_at')} AND (a.filter='' OR o.status=a.filter)
    AND ${search("concat_ws(' ',t.code,o.notes,o.session_id::text)")}
), page_rows AS (SELECT f.* FROM filtered f CROSS JOIN args a ORDER BY CASE WHEN a.sort='oldest' THEN f.at END ASC,
  CASE WHEN a.sort='amount' THEN f.outstanding_amount::numeric END DESC,f.at DESC,f.id LIMIT $8 OFFSET $9)
SELECT json_build_object('rows',${jsonRows},'total',(SELECT count(*) FROM filtered),
  'summary',(SELECT json_build_object('cases',count(*),'open',count(*) FILTER(WHERE status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY')),
    'outstanding',COALESCE(sum(outstanding_amount::numeric) FILTER(WHERE status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY')),0)::text,
    'writtenOff',COALESCE(sum(outstanding_amount::numeric) FILTER(WHERE status='WRITTEN_OFF'),0)::text) FROM filtered)) AS report`;

const supportSql = `WITH ${args}, filtered AS (
  SELECT x.id,x.session_id,t.code AS table_code,x.request_type,x.status,x.content,x.created_at AS at,
    u.display_name AS acknowledged_by_name FROM support_request x LEFT JOIN table_session s ON s.id=x.session_id
  JOIN dining_table t ON t.id=COALESCE(s.table_id,x.table_id) LEFT JOIN app_user u ON u.id=x.acknowledged_by CROSS JOIN args a
  WHERE t.restaurant_id=a.restaurant AND ${dates('x.created_at')}
    AND (a.filter='' OR x.request_type=a.filter) AND (a.status='' OR x.status=a.status)
    AND ${search("concat_ws(' ',t.code,x.content,u.display_name,x.session_id::text)")}
), page_rows AS (SELECT f.* FROM filtered f CROSS JOIN args a ORDER BY CASE WHEN a.sort='oldest' THEN f.at END ASC,f.at DESC,f.id LIMIT $8 OFFSET $9)
SELECT json_build_object('rows',${jsonRows},'total',(SELECT count(*) FROM filtered),
  'summary',(SELECT json_build_object('requests',count(*),'new',count(*) FILTER(WHERE status='NEW'),
    'inProgress',count(*) FILTER(WHERE status='ACKNOWLEDGED'),'done',count(*) FILTER(WHERE status='RESOLVED')) FROM filtered)) AS report`;

const queries: Record<string, string> = {
  sales: salesSql,
  payments: paymentsSql,
  reconciliation: reconciliationSql,
  outstanding: outstandingSql,
  support: supportSql,
};
type Query = {
  view?: string;
  period?: string;
  start?: string;
  end?: string;
  search?: string;
  filter?: string;
  status?: string;
  sort?: string;
  page?: string;
};
export function registerAdminReports(app: FastifyInstance, db: Database, restaurant: string) {
  app.get<{ Querystring: Query }>(
    '/core/admin/reports',
    { config: { permission: 'admin.workspace' } },
    async (r) => {
      const q = r.query,
        view = q.view ?? 'sales',
        page = Number(q.page ?? 1);
      if (!Object.hasOwn(queries, view) || !Number.isInteger(page) || page < 1 || page > 100000)
        reject('Chọn loại báo cáo và trang hợp lệ.', 400);
      if (
        [q.search, q.filter, q.status, q.sort].some(
          (value) => value !== undefined && (typeof value !== 'string' || value.length > 100),
        )
      )
        reject('Bộ lọc báo cáo không hợp lệ.', 400);
      if (q.sort && !['newest', 'oldest', 'amount', 'quantity', 'name', 'balance'].includes(q.sort))
        reject('Chọn cách sắp xếp hợp lệ.', 400);
      const c = await db.pool.connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const store = (
          await c.query(
            `SELECT r.name,r.address,r.timezone,now() AS updated,
        (now() AT TIME ZONE r.timezone)::date::text AS day,
        COALESCE((SELECT min(s.opened_at AT TIME ZONE r.timezone)::date FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=r.id),
          (now() AT TIME ZONE r.timezone)::date)::text AS earliest FROM restaurant r WHERE r.id=$1`,
            [restaurant],
          )
        ).rows[0];
        let range;
        try {
          range = reportRange(q.period ?? 'month', store.day, q.start, q.end, store.earliest);
        } catch (error) {
          reject(error instanceof Error ? error.message : 'Chọn kỳ báo cáo hợp lệ.', 400);
        }
        const result = await c.query(queries[view]!, [
          restaurant,
          range!.startDay,
          range!.endDay,
          store.timezone,
          q.search?.trim() ?? '',
          q.filter ?? '',
          q.sort ?? 'newest',
          10,
          (page - 1) * 10,
          range!.granularity,
          q.status ?? '',
        ]);
        await c.query('COMMIT');
        return {
          ...result.rows[0].report,
          page,
          pageSize: 10,
          store: { name: store.name, address: store.address },
          scope: { ...range!, timezone: store.timezone, updatedAt: store.updated },
        };
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    },
  );
}
