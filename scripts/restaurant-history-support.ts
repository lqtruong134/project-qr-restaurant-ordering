import { createHash } from 'node:crypto';
import type { Connection } from '../apps/api/src/modules/shared/core-persistence.js';
export type HistoryRow = Record<string, unknown>;
export type HistoryDutyRoster = { morning: string[]; evening: string[]; off: string[] };
/** Pass one role's IDs in username order. Both generators must use the same ordering. */
export function historyDutyRoster(userIds: readonly string[], day: string): HistoryDutyRoster {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || userIds.length < 3)
    throw new Error('Historical coverage needs at least three people per operational role.');
  const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
  const off = userIds.filter((_, index) => index % 7 === weekday);
  const working = userIds.filter((_, index) => index % 7 !== weekday);
  const boundary = Math.ceil(working.length / 2);
  return { morning: working.slice(0, boundary), evening: working.slice(boundary), off };
}
export const SCALE = 1000000n;
export function scaled(value: unknown): bigint {
  const text = String(value);
  if (!/^-?\d+(\.\d{1,6})?$/.test(text)) throw new Error('Invalid base-unit decimal: ' + text);
  const negative = text.startsWith('-'),
    [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  return (BigInt(whole!) * SCALE + BigInt(fraction.padEnd(6, '0'))) * (negative ? -1n : 1n);
}
export function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return (
    (value < 0n ? '-' : '') + absolute / SCALE + '.' + String(absolute % SCALE).padStart(6, '0')
  );
}
export const roundedCost = (quantity: bigint, unitCost: bigint) =>
  (quantity * unitCost + (SCALE * SCALE) / 2n) / (SCALE * SCALE);
export function deterministicUuid(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function randomSource(seed: string) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function historyTimestamp(day: string, minutes: number) {
  return new Date(Date.parse(day + 'T00:00:00+07:00') + minutes * 60000).toISOString();
}
export async function insertHistoryRows(c: Connection, table: string, rows: HistoryRow[]) {
  if (!rows.length) return;
  if (!/^[a-z_]+$/.test(table)) throw new Error('Unsafe history table name.');
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (fields.some((field) => !/^[a-z_]+$/.test(field)))
    throw new Error('Unsafe history column name.');
  const columns = fields.map((field) => '"' + field + '"').join(',');
  for (let offset = 0; offset < rows.length; offset += 1000)
    await c.query(
      `INSERT INTO ${table}(${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,
      [JSON.stringify(rows.slice(offset, offset + 1000))],
    );
}

/** Same accounting equations as the domain ledger, independently checked after import. */
export async function validateRestaurantHistory(
  c: Connection,
  restaurantId: string,
  cutoff: Date,
  progress?: (message: string) => void,
) {
  const sessionScope =
    'SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1::uuid';
  const checks: Record<string, string> = {
    itemAmounts: `SELECT count(*) AS n FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id IN (${sessionScope}) AND (i.line_total<>i.unit_price_snapshot*i.quantity OR NOT EXISTS(SELECT 1 FROM financial_charge f WHERE f.order_item_id=i.id AND f.amount=i.line_total))`,
    batchAmounts: `SELECT count(*) AS n FROM order_batch b WHERE b.session_id IN (${sessionScope}) AND (b.total_amount<>b.subtotal OR b.subtotal<>(SELECT COALESCE(sum(line_total),0) FROM order_item WHERE order_batch_id=b.id))`,
    approvedChargeChronology: `SELECT count(*) AS n FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id JOIN order_review r ON r.order_batch_id=i.order_batch_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id IN (${sessionScope}) AND r.status='APPROVED' AND (r.decided_at IS NULL OR f.created_at IS DISTINCT FROM r.decided_at)`,
    receiptSnapshots: `SELECT count(*) AS n FROM table_session s JOIN session_financial_account a ON a.session_id=s.id WHERE s.id IN (${sessionScope}) AND s.session_status='CLOSED' AND (s.receipt_snapshot IS NULL OR s.receipt_snapshot->'session'->>'table_code' IS NULL OR (s.receipt_snapshot->'account'->>'charge_total')::bigint IS DISTINCT FROM a.charge_total OR (s.receipt_snapshot->'account'->>'paid_total')::bigint IS DISTINCT FROM a.paid_total OR (s.receipt_snapshot->'account'->>'refunded_total')::bigint IS DISTINCT FROM a.refunded_total OR NOT EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=s.id AND e.action='RECEIPT_PROVIDED' AND e.created_at<=s.closed_at))`,
    refundCaseAmounts: `SELECT count(*) AS n FROM refund_case f WHERE f.session_id IN (${sessionScope}) AND ((SELECT COALESCE(sum(amount),0) FROM refund_transaction WHERE refund_case_id=f.id AND status='SUCCEEDED')<>f.amount OR NOT EXISTS(SELECT 1 FROM payment_allocation a JOIN financial_charge ch ON ch.id=a.financial_charge_id WHERE a.id=f.source_allocation_id AND a.payment_transaction_id=f.source_payment_transaction_id AND ch.order_item_id=f.order_item_id AND a.reversed_amount>=f.amount))`,
    lingeringReservations: `SELECT count(*) AS n FROM inventory_reservation r JOIN order_item i ON i.id=r.order_item_id JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id WHERE s.id IN (${sessionScope}) AND s.session_status='CLOSED' AND r.status IN ('ACTIVE','PROVISIONAL')`,
    unsettledClosedSessions: `SELECT count(*) AS n FROM table_session s JOIN session_financial_account a ON a.session_id=s.id WHERE s.id IN (${sessionScope}) AND s.session_status='CLOSED' AND (a.outstanding_amount<>0 OR a.refund_due_amount<>0 OR s.financial_status<>'SETTLED' OR s.closed_at IS NULL)`,
    financialTotals: `SELECT count(*) AS n FROM session_financial_account a WHERE a.session_id IN (${sessionScope}) AND (a.charge_total<>(SELECT COALESCE(sum(amount),0) FROM financial_charge WHERE session_id=a.session_id AND status='ACTIVE') OR a.paid_total<>(SELECT COALESCE(sum(amount),0) FROM payment_transaction WHERE session_id=a.session_id AND status='SUCCEEDED') OR a.refunded_total<>(SELECT COALESCE(sum(t.amount),0) FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=a.session_id AND t.status='SUCCEEDED'))`,
    allocations: `SELECT count(*) AS n FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) AND (SELECT COALESCE(sum(allocated_amount),0) FROM payment_allocation WHERE payment_transaction_id=p.id)>p.amount`,
    unpaidActiveCharges: `SELECT count(*) AS n FROM financial_charge f WHERE f.session_id IN (${sessionScope}) AND f.status='ACTIVE' AND f.amount<>(SELECT COALESCE(sum(allocated_amount-reversed_amount),0) FROM payment_allocation WHERE financial_charge_id=f.id)`,
    refundSourceLimits: `SELECT count(*) AS n FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) AND (SELECT COALESCE(sum(amount),0) FROM refund_case WHERE source_payment_transaction_id=p.id AND status<>'CANCELLED')>p.amount`,
    refundApprovals: `SELECT count(*) AS n FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id IN (${sessionScope}) AND t.status='SUCCEEDED' AND (NOT EXISTS(SELECT 1 FROM business_audit_event e JOIN user_role ur ON ur.user_id=e.actor_id JOIN role r ON r.id=ur.role_id WHERE e.resource_id=f.id AND e.action='REFUND_APPROVED' AND e.details->>'amount'=f.amount::text AND e.details->>'paymentId'=f.source_payment_transaction_id::text AND r.code='ADMIN' AND e.created_at<=t.processed_at) OR NOT EXISTS(SELECT 1 FROM user_role ur JOIN role r ON r.id=ur.role_id WHERE ur.user_id=t.processed_by AND r.code='STAFF'))`,
    cashArithmetic: `SELECT count(*) AS n FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) AND p.method='CASH' AND (p.metadata->>'cashReceived')::bigint-p.amount<>(p.metadata->>'changeGiven')::bigint`,
    cashChangeUnconfirmed: `SELECT count(*) AS n FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) AND p.method='CASH' AND (p.metadata->>'changeGiven')::bigint>0 AND NOT EXISTS(SELECT 1 FROM business_audit_event e WHERE e.resource_id=p.id AND e.action='CASH_CHANGE_RETURNED')`,
    unfinishedClosedOrders: `SELECT count(*) AS n FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id WHERE s.id IN (${sessionScope}) AND s.session_status='CLOSED' AND (i.status NOT IN ('SERVED','CANCELLED','UNAVAILABLE','REJECTED') OR b.status NOT IN ('COMPLETED','CANCELLED','REJECTED'))`,
    recipeTimelines: `SELECT count(*) AS n FROM order_item_ingredient_snapshot x JOIN recipe_bom r ON r.id=x.recipe_bom_id JOIN order_item i ON i.id=x.order_item_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id IN (${sessionScope}) AND (r.effective_from>i.created_at OR (r.effective_to IS NOT NULL AND r.effective_to<=i.created_at))`,
    recipePartsChronology: `SELECT count(*) AS n FROM order_item_ingredient_snapshot x JOIN recipe_bom r ON r.id=x.recipe_bom_id JOIN recipe_bom_item p ON p.recipe_bom_id=r.id AND p.ingredient_id=x.ingredient_id JOIN order_item i ON i.id=x.order_item_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id IN (${sessionScope}) AND (r.created_at>x.created_at OR p.created_at>x.created_at)`,
    ingredientSnapshots: `WITH consumed AS (SELECT m.order_item_id,m.ingredient_id,sum(m.quantity) AS quantity FROM inventory_movement m JOIN stock_location l ON l.id=m.location_id WHERE l.restaurant_id=$1::uuid AND m.movement_type='CONSUMPTION' GROUP BY m.order_item_id,m.ingredient_id) SELECT count(*) AS n FROM order_item_ingredient_snapshot x JOIN order_item i ON i.id=x.order_item_id JOIN order_batch b ON b.id=i.order_batch_id LEFT JOIN consumed m ON m.order_item_id=i.id AND m.ingredient_id=x.ingredient_id WHERE b.session_id IN (${sessionScope}) AND (x.consumed_qty<>-COALESCE(m.quantity,0) OR x.cogs_value<>round(x.consumed_qty*x.unit_cost_snapshot)::bigint OR (i.status IN ('CANCELLED','UNAVAILABLE') AND i.preparation_started_at IS NULL AND x.consumed_qty<>0))`,
    inventoryBalances: `WITH movements AS (SELECT m.location_id,m.ingredient_id,sum(m.quantity) AS quantity FROM inventory_movement m JOIN stock_location l ON l.id=m.location_id WHERE l.restaurant_id=$1::uuid GROUP BY m.location_id,m.ingredient_id), reservations AS (SELECT r.location_id,r.ingredient_id,sum(r.quantity) AS quantity FROM inventory_reservation r JOIN stock_location l ON l.id=r.location_id WHERE l.restaurant_id=$1::uuid AND r.status IN ('ACTIVE','PROVISIONAL') GROUP BY r.location_id,r.ingredient_id) SELECT count(*) AS n FROM inventory_balance b JOIN stock_location l ON l.id=b.location_id LEFT JOIN movements m ON m.location_id=b.location_id AND m.ingredient_id=b.ingredient_id LEFT JOIN reservations r ON r.location_id=b.location_id AND r.ingredient_id=b.ingredient_id WHERE l.restaurant_id=$1::uuid AND (b.on_hand_qty<>COALESCE(m.quantity,0) OR b.reserved_qty<>COALESCE(r.quantity,0) OR b.available_qty<>b.on_hand_qty-b.reserved_qty OR b.on_hand_qty<0)`,
    stockWentNegative: `SELECT count(*) AS n FROM (SELECT sum(m.quantity) OVER(PARTITION BY m.location_id,m.ingredient_id ORDER BY m.occurred_at,m.created_at,m.id) AS balance FROM inventory_movement m JOIN stock_location l ON l.id=m.location_id WHERE l.restaurant_id=$1::uuid) x WHERE balance<0`,
    overlappingTables: `SELECT count(*) AS n FROM (SELECT opened_at,lag(closed_at) OVER(PARTITION BY table_id ORDER BY opened_at,id) AS prior_close FROM table_session WHERE id IN (${sessionScope})) x WHERE prior_close>opened_at`,
    futureEvents: `SELECT count(*) AS n FROM (SELECT opened_at AS at FROM table_session WHERE id IN (${sessionScope}) UNION ALL SELECT closed_at FROM table_session WHERE id IN (${sessionScope}) UNION ALL SELECT p.confirmed_at FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) UNION ALL SELECT m.occurred_at FROM inventory_movement m JOIN stock_location l ON l.id=m.location_id WHERE l.restaurant_id=$1::uuid) x WHERE at>$2::timestamptz`,
    roleAssignmentChronology: `WITH events AS (SELECT h.actor_user_id AS actor,h.changed_at AS at FROM order_status_history h JOIN order_batch b ON b.id=h.order_batch_id WHERE b.session_id IN (${sessionScope}) UNION ALL SELECT p.confirmed_by,p.confirmed_at FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) UNION ALL SELECT t.processed_by,t.processed_at FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id IN (${sessionScope}) UNION ALL SELECT s.closed_by,s.closed_at FROM table_session s WHERE s.id IN (${sessionScope}) UNION ALL SELECT r.resolved_by,r.resolved_at FROM support_request r WHERE r.session_id IN (${sessionScope}) UNION ALL SELECT e.actor_id,e.created_at FROM business_audit_event e WHERE e.restaurant_id=$1::uuid), first_action AS (SELECT actor,min(at) AS at FROM events WHERE actor IS NOT NULL GROUP BY actor) SELECT count(*) AS n FROM first_action a WHERE NOT EXISTS(SELECT 1 FROM user_role ur JOIN role r ON r.id=ur.role_id JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id WHERE ur.user_id=a.actor AND ur.assigned_at<=a.at AND ur.created_at<=a.at AND (ur.revoked_at IS NULL OR ur.revoked_at>a.at) AND r.created_at<=a.at AND rp.created_at<=a.at AND p.created_at<=a.at)`,
    payPolicyChronology: `WITH work AS (SELECT min(opened_at) AS at FROM table_session WHERE id IN (${sessionScope}) UNION ALL SELECT a.starts_at FROM shift_assignment a WHERE a.restaurant_id=$1::uuid) SELECT count(*) AS n FROM work w JOIN restaurant r ON r.id=$1::uuid WHERE w.at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workforce_pay_policy p WHERE p.restaurant_id=r.id AND p.effective_from<=(w.at AT TIME ZONE r.timezone)::date AND p.created_at<=w.at)`,
  };
  const result: Record<string, number> = {};
  for (const [name, sql] of Object.entries(checks)) {
    const started = Date.now();
    try {
      result[name] = Number(
        (
          await c.query(
            Object.assign(
              {
                text: sql,
                values:
                  name === 'futureEvents' ? [restaurantId, cutoff.toISOString()] : [restaurantId],
              },
              { query_timeout: 180000 },
            ),
          )
        ).rows[0].n,
      );
      progress?.(`Validated ${name}: ${result[name]} violations in ${Date.now() - started} ms.`);
    } catch (error) {
      throw new Error(
        `History validation ${name} failed after ${Date.now() - started} ms: ${error instanceof Error ? error.message.split('\n')[0] : 'database rejected query'}`,
      );
    }
  }
  const people = (
    await c.query(
      "SELECT u.id,r.code FROM app_user u JOIN user_role ur ON ur.user_id=u.id JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND u.status='ACTIVE' AND r.code IN ('STAFF','KITCHEN') ORDER BY u.username",
      [restaurantId],
    )
  ).rows;
  const idsByRole = new Map(
    ['STAFF', 'KITCHEN'].map((role) => [
      role,
      people.filter((person) => person.code === role).map((person) => String(person.id)),
    ]),
  );
  const roleById = new Map(people.map((person) => [String(person.id), String(person.code)]));
  const duties = new Map<string, HistoryDutyRoster>();
  const events = (
    await c.query(
      Object.assign(
        {
          text: `SELECT DISTINCT actor, (at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day, extract(hour FROM at AT TIME ZONE 'Asia/Ho_Chi_Minh')*60+extract(minute FROM at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS minute FROM (SELECT h.actor_user_id AS actor,h.changed_at AS at FROM order_status_history h JOIN order_batch b ON b.id=h.order_batch_id WHERE b.session_id IN (${sessionScope}) UNION ALL SELECT p.confirmed_by,p.confirmed_at FROM payment_transaction p WHERE p.session_id IN (${sessionScope}) UNION ALL SELECT t.processed_by,t.processed_at FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id IN (${sessionScope}) UNION ALL SELECT s.closed_by,s.closed_at FROM table_session s WHERE s.id IN (${sessionScope}) UNION ALL SELECT r.resolved_by,r.resolved_at FROM support_request r WHERE r.session_id IN (${sessionScope})) x WHERE actor IS NOT NULL`,
          values: [restaurantId],
        },
        { query_timeout: 180000 },
      ),
    )
  ).rows;
  result.offDutyActions = 0;
  for (const event of events) {
    const role = roleById.get(String(event.actor));
    if (!role) continue;
    const key = event.day + ':' + role;
    let roster = duties.get(key);
    if (!roster) {
      roster = historyDutyRoster(idsByRole.get(role)!, event.day);
      duties.set(key, roster);
    }
    const minute = Number(event.minute),
      morning =
        roster.morning.includes(String(event.actor)) &&
        minute >= 420 &&
        minute <= 960 &&
        !(minute >= 540 && minute < 600),
      evening =
        roster.evening.includes(String(event.actor)) &&
        minute >= 900 &&
        minute <= 1380 &&
        !(minute >= 960 && minute < 1020);
    if (!morning && !evening) result.offDutyActions++;
  }
  progress?.(`Validated offDutyActions: ${result.offDutyActions} violations.`);
  return result;
}
