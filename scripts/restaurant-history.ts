import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { readPolicy } from '../apps/api/src/modules/risk/policy.service.js';
import { readBill } from '../apps/api/src/modules/payments/receipt.service.js';
import { receiptKey } from '../apps/api/src/modules/payments/completion.service.js';
import { closeReadiness } from '../apps/api/src/modules/dining/close-readiness.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { type Connection } from '../apps/api/src/modules/shared/core-persistence.js';
import {
  SCALE,
  decimal,
  deterministicUuid,
  historyDutyRoster,
  historyTimestamp,
  insertHistoryRows,
  randomSource,
  roundedCost,
  scaled,
  validateRestaurantHistory,
  type HistoryRow,
} from './restaurant-history-support.js';
export { historyDutyRoster, validateRestaurantHistory } from './restaurant-history-support.js';

export type RestaurantHistoryOptions = {
  restaurantId: string;
  from: string;
  through: string;
  now: Date;
  datasetKey: string;
  seed?: string;
  minSessions?: number;
  maxSessions?: number;
  apply?: boolean;
  manifestPath?: string;
  progress?: (message: string) => void;
};
type RecipeLine = { ingredient_id: string; quantity: string; waste_percent: string };
type HistoryProduct = {
  id: string;
  code: string;
  name: string;
  base_price: string;
  product_kind: string;
  stock_managed: boolean;
  category: string;
  recipe_id: string;
  yield: string;
  effective_from: Date;
  lines: RecipeLine[];
  components: { product_id: string; code: string; name: string; quantity: number }[];
};
type Balance = {
  id: string;
  ingredient_id: string;
  location_id: string;
  code: string;
  name: string;
  unit_id: string;
  cost: bigint;
  initial: bigint;
  current: bigint;
  minimum: bigint;
};
type Actor = { id: string; display_name: string };
type Scenario =
  | 'STANDARD'
  | 'PARTIAL'
  | 'PREPAID_CANCEL'
  | 'PREPAID_WAIVE'
  | 'WAIVE'
  | 'GUEST_CANCEL'
  | 'KITCHEN_UNAVAILABLE';
const names = [
  'Minh Anh',
  'Thanh Hà',
  'Quốc Bảo',
  'Khánh Linh',
  'Ngọc Lan',
  'Hoàng Nam',
  'Bảo Ngọc',
  'Thùy Dương',
  'Gia Huy',
  'Quỳnh Chi',
  'Mai Phương',
  'Tuấn Kiệt',
  'Hải Yến',
  'Thảo Vy',
  'Anh Khoa',
  'Hồng Nhung',
  'Thanh Trúc',
  'Đức Minh',
  'Thu Hương',
  'Nhật Long',
  'Trúc Anh',
  'Phương Thảo',
  'Quang Huy',
  'Tú Uyên',
];
const surnames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Võ', 'Đặng', 'Đỗ', 'Bùi', 'Huỳnh', 'Phan'];
const insertOrder = [
  'table_session',
  'session_participant',
  'session_cart',
  'support_request',
  'support_request_handoff',
  'order_batch',
  'order_item',
  'order_status_history',
  'order_risk_assessment',
  'order_review',
  'idempotency_record',
  'financial_charge',
  'payment_intent',
  'payment_transaction',
  'payment_allocation',
  'refund_case',
  'refund_transaction',
  'outstanding_balance_case',
  'operational_alert',
  'table_transfer_history',
  'inventory_reservation',
  'order_item_ingredient_snapshot',
  'inventory_movement',
  'business_audit_event',
  'outbox_event',
];

function checkOptions(options: RestaurantHistoryOptions) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(options.from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(options.through) ||
    options.from > options.through ||
    Number.isNaN(options.now.getTime())
  )
    throw new Error('Invalid history date interval.');
  if (!/^[a-z0-9_-]{6,100}$/.test(options.datasetKey))
    throw new Error('Use a stable technical dataset key.');
  if (Date.parse(options.from + 'T00:00:00+07:00') > options.now.getTime())
    throw new Error('History cannot start in the future.');
  const min = options.minSessions ?? 40,
    max = options.maxSessions ?? 70;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 100)
    throw new Error('Invalid daily session volume.');
}
async function buildHistoryPlan(c: Connection, options: RestaurantHistoryOptions) {
  checkOptions(options);
  const random = randomSource(options.seed ?? options.datasetKey),
    integer = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const uid = (key: string) => deterministicUuid(options.datasetKey + ':' + key);
  const rows: Record<string, HistoryRow[]> = {},
    add = (table: string, row: HistoryRow) => {
      if (table === 'inventory_movement' || table === 'order_item_ingredient_snapshot')
        delete row.updated_at;
      if (table === 'operational_alert') row.outstanding_amount ??= '0';
      (rows[table] ??= []).push(row);
      return row;
    };
  const stamp = (id: string, at: string, extra: HistoryRow): HistoryRow => ({
    id,
    created_at: at,
    updated_at: at,
    ...extra,
  });
  const actors = (
    await c.query(
      "SELECT u.id,u.display_name,r.code FROM app_user u JOIN user_role ur ON ur.user_id=u.id JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND u.status='ACTIVE' ORDER BY u.username",
      [options.restaurantId],
    )
  ).rows;
  const staff: Actor[] = actors.filter((row) => row.code === 'STAFF'),
    kitchen: Actor[] = actors.filter((row) => row.code === 'KITCHEN');
  const admin = actors.find((row) => row.code === 'ADMIN');
  const tables = (
    await c.query(
      'SELECT id,code,name,capacity,area_id FROM dining_table WHERE restaurant_id=$1 AND is_active ORDER BY code',
      [options.restaurantId],
    )
  ).rows;
  if (!staff.length || !kitchen.length || !admin || !tables.length)
    throw new Error('Canonical active staff, kitchen, admin and dining tables are required.');
  const balances: Balance[] = (
    await c.query(
      'SELECT b.*,i.code,i.name,i.base_unit_id,i.min_stock FROM inventory_balance b JOIN ingredient i ON i.id=b.ingredient_id JOIN stock_location l ON l.id=b.location_id WHERE i.restaurant_id=$1 AND l.restaurant_id=$1 AND i.is_active AND l.is_active ORDER BY i.code,b.location_id',
      [options.restaurantId],
    )
  ).rows.map((row) => ({
    id: row.id,
    ingredient_id: row.ingredient_id,
    location_id: row.location_id,
    code: row.code,
    name: row.name,
    unit_id: row.base_unit_id,
    cost: scaled(row.avg_cost),
    initial: scaled(row.on_hand_qty),
    current: scaled(row.on_hand_qty),
    minimum: scaled(row.min_stock),
  }));
  if (balances.some((balance) => balance.cost <= 0n))
    throw new Error('Baseline ingredients need a positive unit cost.');
  const balanceByIngredient = new Map(balances.map((balance) => [balance.ingredient_id, balance]));
  const products: HistoryProduct[] = (
    await c.query(
      `SELECT p.id,p.code,p.name,p.base_price::text,p.product_kind,p.stock_managed,m.code AS category,r.id AS recipe_id,r.yield_quantity::text AS yield,r.effective_from,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ingredient_id',i.ingredient_id,'quantity',i.quantity::text,'waste_percent',i.waste_percent::text) ORDER BY i.ingredient_id) FROM recipe_bom_item i WHERE i.recipe_bom_id=r.id),'[]'::jsonb) AS lines,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',d.id,'code',d.code,'name',d.name,'quantity',x.quantity) ORDER BY x.sort_order) FROM product_combo_item x JOIN product d ON d.id=x.component_product_id WHERE x.combo_product_id=p.id),'[]'::jsonb) AS components
    FROM product p JOIN menu_category m ON m.id=p.category_id LEFT JOIN recipe_bom r ON r.product_id=p.id AND r.status='ACTIVE'
    WHERE p.restaurant_id=$1 AND p.is_active AND m.is_active AND p.availability_status='AVAILABLE' AND p.base_price>0 ORDER BY p.code`,
      [options.restaurantId],
    )
  ).rows;
  if (
    products.length < 6 ||
    products.some(
      (p) =>
        p.stock_managed &&
        (!p.recipe_id ||
          !p.lines.length ||
          Date.parse(String(p.effective_from)) > Date.parse(options.from + 'T10:00:00+07:00')),
    )
  )
    throw new Error('Canonical recipes must exist and be effective at the history baseline.');
  for (const product of products)
    for (const line of product.lines)
      if (!balanceByIngredient.has(line.ingredient_id))
        throw new Error('Missing inventory balance for recipe ' + product.code);
  const policy = await readPolicy(c, options.restaurantId);
  const audit = (
    key: string,
    actor: string,
    action: string,
    kind: string,
    id: string,
    at: string,
    reason: string,
    details: HistoryRow = {},
  ) =>
    add('business_audit_event', {
      id: uid('audit:' + key),
      restaurant_id: options.restaurantId,
      actor_id: actor,
      action,
      resource_type: kind,
      resource_id: id,
      reason,
      details: { ...details, datasetKey: options.datasetKey },
      created_at: at,
    });
  const history = (
    key: string,
    batch: string,
    item: string | null,
    from: string | null,
    to: string,
    actor: string,
    at: string,
    guest = false,
  ) =>
    add('order_status_history', {
      id: uid('history:' + key),
      order_batch_id: batch,
      order_item_id: item,
      old_status: from,
      new_status: to,
      actor_type: guest ? 'GUEST' : 'USER',
      actor_user_id: guest ? null : actor,
      actor_participant_id: guest ? actor : null,
      changed_at: at,
      created_at: at,
    });
  const scenarioCounts: Record<string, number> = {},
    dayCounts: Record<string, number> = {};
  let ordinal = 0,
    dayIndex = 0;
  for (
    let day = options.from;
    day <= options.through;
    day = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10), dayIndex++
  ) {
    const dayStart = Date.parse(historyTimestamp(day, 0));
    if (dayStart >= options.now.getTime()) break;
    const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
    const nominal = integer(options.minSessions ?? 40, options.maxSessions ?? 70),
      count = Math.min(
        options.maxSessions ?? 70,
        nominal + ([0, 6].includes(weekday) ? 6 : 0) + (day.endsWith('-09-02') ? 8 : 0),
      );
    const lunchtime = Math.round(count * 0.46),
      nextFree = new Map<string, number>();
    const staffDuty = historyDutyRoster(
        staff.map((actor) => actor.id),
        day,
      ),
      kitchenDuty = historyDutyRoster(
        kitchen.map((actor) => actor.id),
        day,
      );
    const dayConsumption = new Map<string, bigint>();
    const pickProduct = (line: number) => {
      const buckets = [
        'KHAI-VI',
        'MON-CHINH',
        'DO-UONG',
        'MON-NUONG',
        'CANH-LAU',
        'TRANG-MIENG',
        'BANH-CUON',
        'BUN-PHO-MI',
        'RAU-DAU-HU',
        'CANH',
      ];
      // Rotate the meal sequence so newly separated categories all participate.
      const bucket = buckets[(line + completedToday) % buckets.length];
      const combos = products.filter((p) => p.product_kind === 'COMBO');
      if (line === 1 && combos.length && random() < 0.18)
        return combos[integer(0, combos.length - 1)]!;
      const subset = products.filter((p) => p.category === bucket);
      const candidates = subset.length ? subset : products;
      return candidates[integer(0, candidates.length - 1)]!;
    };
    let completedToday = 0;
    for (let n = 0; n < count; n++) {
      const table = tables[n % tables.length]!,
        base = n < lunchtime ? 660 : 1020;
      const candidate = dayStart + (base + ((n % tables.length) % 8) * 5 + integer(0, 15)) * 60000;
      const opened = Math.max(candidate, nextFree.get(table.id) ?? 0),
        duration = integer(75, 115),
        closed = opened + duration * 60000;
      if (closed > options.now.getTime() || closed > dayStart + 23 * 60 * 60000) continue;
      nextFree.set(table.id, closed + 15 * 60000);
      completedToday++;
      ordinal++;
      const key = day + ':' + n,
        sid = uid('session:' + key),
        at = (minute: number) => new Date(opened + minute * 60000).toISOString(),
        closeAt = new Date(closed).toISOString();
      const shift = (opened - dayStart) / 60000 < 900 ? 'morning' : 'evening',
        dutyStaff = staffDuty[shift],
        dutyKitchen = kitchenDuty[shift];
      const waiter = staff.find((actor) => actor.id === dutyStaff[n % dutyStaff.length])!,
        chef = kitchen.find((actor) => actor.id === dutyKitchen[n % dutyKitchen.length])!,
        party = integer(1, Math.min(6, Number(table.capacity)));
      const firstNeedsReview = Boolean(policy.policy.FIRST_ORDER_REVIEW_ENABLED) && random() < 0.12;
      const sample = random(),
        scenario: Scenario =
          sample < 0.08
            ? 'PREPAID_CANCEL'
            : sample < 0.12
              ? 'PREPAID_WAIVE'
              : sample < 0.19
                ? 'PARTIAL'
                : sample < 0.24
                  ? 'WAIVE'
                  : sample < 0.28
                    ? 'GUEST_CANCEL'
                    : sample < 0.32
                      ? 'KITCHEN_UNAVAILABLE'
                      : 'STANDARD';
      scenarioCounts[scenario] = (scenarioCounts[scenario] ?? 0) + 1;
      const guests = Array.from({ length: party }, (_, g) => {
        const pid = uid('participant:' + key + ':' + g);
        add(
          'session_participant',
          stamp(pid, at(g), {
            session_id: sid,
            guest_id: uid('guest:' + key + ':' + g),
            display_name:
              surnames[integer(0, surnames.length - 1)] + ' ' + names[integer(0, names.length - 1)],
            credential_hash: createHash('sha256')
              .update(options.datasetKey + pid)
              .digest('hex'),
            status: 'LEFT',
            joined_at: at(g),
            last_seen_at: closeAt,
            accepted_policy_version: restaurantPolicy.version,
            accepted_policy_at: at(g),
            updated_at: closeAt,
          }),
        );
        return pid;
      });
      add(
        'table_session',
        stamp(sid, at(0), {
          table_id: table.id,
          session_status: 'CLOSED',
          verification_status: 'VERIFIED',
          opened_at: at(0),
          verified_at: at(firstNeedsReview ? 4 : 1),
          verified_by: waiter.id,
          closed_at: closeAt,
          closed_by: waiter.id,
          close_reason: 'Khách đã thanh toán và nhận phiếu',
          financial_status: 'SETTLED',
          risk_status: 'NORMAL',
          receipt_number: 'PT-' + day.replaceAll('-', '') + '-' + String(ordinal).padStart(8, '0'),
          updated_at: closeAt,
        }),
      );
      add(
        'session_cart',
        stamp(uid('cart:' + key), at(0), { session_id: sid, cart_version: 3, updated_at: at(14) }),
      );
      const numberOfLines = integer(6, 10),
        batchItems: HistoryRow[] = [],
        charges: HistoryRow[] = [];
      let gross = 0n,
        reversed = 0n,
        faulty: HistoryRow | undefined,
        faultAt = '';
      for (let b = 0; b < 2; b++) {
        const bid = uid('batch:' + key + ':' + b),
          owner = guests[b % guests.length]!,
          offset = b ? 14 : 2;
        const length = b === 0 ? Math.ceil(numberOfLines / 2) : Math.floor(numberOfLines / 2);
        const batchCharges: HistoryRow[] = [];
        let subtotal = 0n;
        for (let j = 0; j < length; j++) {
          const index = b === 0 ? j : Math.ceil(numberOfLines / 2) + j,
            product = pickProduct(index),
            quantity =
              product.product_kind === 'COMBO' || ['CANH-LAU', 'CANH'].includes(product.category)
                ? 1
                : integer(1, Math.min(2, party)),
            amount = BigInt(product.base_price) * BigInt(quantity);
          const iid = uid('item:' + key + ':' + index),
            isFault =
              index === numberOfLines - 1 && scenario !== 'STANDARD' && scenario !== 'PARTIAL';
          const release =
              isFault &&
              ['PREPAID_CANCEL', 'GUEST_CANCEL', 'KITCHEN_UNAVAILABLE'].includes(scenario),
            waive = isFault && ['WAIVE', 'PREPAID_WAIVE'].includes(scenario);
          const status = release
              ? scenario === 'GUEST_CANCEL'
                ? 'CANCELLED'
                : 'UNAVAILABLE'
              : 'SERVED',
            itemAt = at(offset),
            prepared = release ? null : at(offset + 10),
            served = release ? null : at(offset + 32),
            issueAt = at(offset + (waive ? 40 : 24));
          const item = add(
            'order_item',
            stamp(iid, itemAt, {
              order_batch_id: bid,
              owner_participant_id: owner,
              product_id: product.id,
              product_name_snapshot: product.name,
              quantity,
              unit_price_snapshot: product.base_price,
              line_total: amount.toString(),
              note: random() < 0.08 ? 'Phục vụ nóng' : null,
              status,
              stock_managed_snapshot: product.stock_managed,
              product_kind_snapshot: product.product_kind,
              combo_components_snapshot: product.components,
              received_at: release && scenario === 'GUEST_CANCEL' ? null : at(offset + 5),
              preparation_started_at: prepared,
              ready_at: release ? null : at(offset + 27),
              served_at: served,
              cancel_reason: release
                ? scenario === 'GUEST_CANCEL'
                  ? 'Khách đổi món trước khi bếp nhận'
                  : 'Thiết bị bếp gặp sự cố, món chưa chế biến'
                : null,
              cancel_reason_code: release
                ? scenario === 'GUEST_CANCEL'
                  ? 'CUSTOMER_CHANGED_MIND'
                  : 'EQUIPMENT_FAILURE'
                : null,
              cancelled_by_type: release ? 'USER' : null,
              cancelled_by_user_id: release
                ? scenario === 'GUEST_CANCEL'
                  ? waiter.id
                  : chef.id
                : null,
              cancelled_by_participant_id: null,
              updated_at: release || waive ? issueAt : served,
              version: release ? 3 : 5,
            }),
          );
          batchItems.push(item);
          subtotal += amount;
          gross += amount;
          const charge = add(
            'financial_charge',
            stamp(uid('charge:' + iid), itemAt, {
              session_id: sid,
              order_item_id: iid,
              charge_type: 'ITEM',
              amount: amount.toString(),
              status: release || waive ? 'REVERSED' : 'ACTIVE',
              reversed_at: release || waive ? issueAt : null,
              updated_at: release || waive ? issueAt : itemAt,
            }),
          );
          charges.push(charge);
          batchCharges.push(charge);
          history(iid + ':submitted', bid, iid, null, 'SUBMITTED', owner, itemAt, true);
          if (!release || scenario !== 'GUEST_CANCEL')
            history(iid + ':accepted', bid, iid, 'SUBMITTED', 'ACCEPTED', chef.id, at(offset + 5));
          if (release)
            history(
              iid + ':released',
              bid,
              iid,
              scenario === 'GUEST_CANCEL' ? 'SUBMITTED' : 'ACCEPTED',
              status,
              scenario === 'GUEST_CANCEL' ? waiter.id : chef.id,
              issueAt,
            );
          else {
            history(iid + ':prepare', bid, iid, 'ACCEPTED', 'IN_PREPARATION', chef.id, prepared!);
            history(iid + ':ready', bid, iid, 'IN_PREPARATION', 'READY', chef.id, at(offset + 27));
            history(iid + ':served', bid, iid, 'READY', 'SERVED', waiter.id, served!);
          }
          if (product.stock_managed)
            for (const line of product.lines) {
              const balance = balanceByIngredient.get(line.ingredient_id)!;
              const numerator =
                  scaled(line.quantity) *
                  BigInt(quantity) *
                  (100n * SCALE + scaled(line.waste_percent)),
                denominator = scaled(product.yield) * 100n,
                needed = (numerator + denominator - 1n) / denominator;
              const cost = roundedCost(needed, balance.cost);
              add(
                'inventory_reservation',
                stamp(uid('reservation:' + iid + ':' + line.ingredient_id), itemAt, {
                  order_item_id: iid,
                  ingredient_id: line.ingredient_id,
                  location_id: balance.location_id,
                  reservation_type: 'CONFIRMED',
                  quantity: decimal(needed),
                  status: release ? 'RELEASED' : 'CONSUMED',
                  updated_at: release ? issueAt : prepared,
                }),
              );
              add(
                'order_item_ingredient_snapshot',
                stamp(uid('ingredient:' + iid + ':' + line.ingredient_id), itemAt, {
                  order_item_id: iid,
                  recipe_bom_id: product.recipe_id,
                  ingredient_id: line.ingredient_id,
                  planned_qty: decimal(needed),
                  consumed_qty: decimal(release ? 0n : needed),
                  unit_cost_snapshot: decimal(balance.cost),
                  cogs_value: release ? '0' : cost.toString(),
                  updated_at: release ? issueAt : prepared,
                }),
              );
              if (!release) {
                add(
                  'inventory_movement',
                  stamp(uid('consume:' + iid + ':' + line.ingredient_id), prepared!, {
                    location_id: balance.location_id,
                    ingredient_id: line.ingredient_id,
                    movement_type: 'CONSUMPTION',
                    quantity: decimal(-needed),
                    unit_cost: decimal(balance.cost),
                    value: (-cost).toString(),
                    source_type: 'ORDER_ITEM',
                    created_by: chef.id,
                    order_item_id: iid,
                    occurred_at: prepared,
                  }),
                );
                dayConsumption.set(balance.id, (dayConsumption.get(balance.id) ?? 0n) + needed);
              }
            }
          if (isFault) {
            faulty = item;
            faultAt = issueAt;
            reversed += amount;
            if (waive)
              audit(
                iid,
                admin.id,
                'WAIVE_ITEM',
                'ORDER_ITEM',
                iid,
                issueAt,
                'Miễn tiền món do khách phản ánh chất lượng',
                { reasonCode: 'QUALITY_ISSUE', sessionId: sid, amount: amount.toString() },
              );
            else if (scenario === 'GUEST_CANCEL')
              audit(
                iid,
                waiter.id,
                'CANCEL_ITEM',
                'ORDER_ITEM',
                iid,
                issueAt,
                'Khách đổi món trước chế biến',
                { reasonCode: 'CUSTOMER_CHANGED_MIND', previousStatus: 'SUBMITTED' },
              );
            else {
              const alert = uid('alert:' + iid),
                notice = uid('notice:' + iid);
              add(
                'operational_alert',
                stamp(alert, issueAt, {
                  session_id: sid,
                  table_id: table.id,
                  alert_type: 'OTHER',
                  severity: 'WARNING',
                  status: 'RESOLVED',
                  acknowledged_by: admin.id,
                  resolved_by: admin.id,
                  resolved_at: at(offset + 29),
                  resolution_note: 'Đã kiểm tra thiết bị bếp và khả năng phục vụ',
                  updated_at: at(offset + 29),
                }),
              );
              add(
                'operational_alert',
                stamp(notice, issueAt, {
                  session_id: sid,
                  table_id: table.id,
                  alert_type: 'OTHER',
                  severity: 'INFO',
                  status: 'RESOLVED',
                  acknowledged_by: waiter.id,
                  resolved_by: waiter.id,
                  resolved_at: at(offset + 26),
                  resolution_note: 'Đã trao đổi với khách tại bàn',
                  updated_at: at(offset + 26),
                }),
              );
              audit(
                iid + ':report',
                chef.id,
                'KITCHEN_UNAVAILABLE_REPORTED',
                'ORDER_ITEM',
                iid,
                issueAt,
                'Thiết bị bếp gặp sự cố',
                { alertId: alert, reasonCode: 'EQUIPMENT_FAILURE' },
              );
              audit(
                iid + ':notice',
                chef.id,
                'KITCHEN_ISSUE_GUEST_NOTICE',
                'ORDER_ITEM',
                iid,
                issueAt,
                'Nhân viên cần thông báo khách',
                { alertId: notice },
              );
              audit(
                iid + ':notified',
                waiter.id,
                'KITCHEN_GUEST_NOTIFIED',
                'ORDER_ITEM',
                iid,
                at(offset + 26),
                'Đã báo khách tại bàn',
                { alertId: notice },
              );
              audit(
                iid + ':review',
                admin.id,
                'KITCHEN_UNAVAILABLE_REVIEWED',
                'ORDER_ITEM',
                iid,
                at(offset + 29),
                'Đã kiểm tra thiết bị và hoàn tất xử lý',
                { alertId: alert },
              );
            }
          }
        }
        const reasonCodes: string[] = [];
        const batchQuantity = batchItems
          .filter((item) => item.order_batch_id === bid)
          .reduce(
            (sum, item) =>
              sum +
              Number(item.quantity) *
                Math.max(
                  1,
                  (item.combo_components_snapshot as { quantity: number }[]).reduce(
                    (units, member) => units + member.quantity,
                    0,
                  ),
                ),
            0,
          );
        if (b === 0 && firstNeedsReview) reasonCodes.push('FIRST_UNVERIFIED_ORDER');
        if (batchQuantity >= Number(policy.policy.ORDER_TOTAL_QTY_REVIEW))
          reasonCodes.push('QUANTITY');
        if (subtotal >= BigInt(String(policy.policy.ORDER_AMOUNT_REVIEW_VND)))
          reasonCodes.push('ORDER_AMOUNT');
        if (gross >= BigInt(String(policy.policy.SESSION_AMOUNT_REVIEW_VND)))
          reasonCodes.push('SESSION_AMOUNT');
        const reviewed = reasonCodes.length > 0;
        // Reviewed orders acquire charges only when the employee approves them,
        // matching approveReview() rather than the initial provisional request.
        const chargedAt = at(offset + (reviewed ? 2 : 0));
        for (const charge of batchCharges) {
          charge.created_at = chargedAt;
          if (charge.status === 'ACTIVE') charge.updated_at = chargedAt;
        }
        add(
          'order_batch',
          stamp(bid, at(offset), {
            session_id: sid,
            created_by_type: 'GUEST',
            created_by_participant_id: owner,
            client_request_id: uid('request:' + bid),
            status: 'COMPLETED',
            subtotal: subtotal.toString(),
            total_amount: subtotal.toString(),
            risk_decision: reviewed ? 'REVIEW' : 'ALLOW',
            config_version: policy.version,
            submitted_at: at(offset),
            accepted_at: at(offset + 5),
            updated_at: at(offset + 54),
            version: 5,
          }),
        );
        add('order_risk_assessment', {
          id: uid('risk:' + bid),
          order_batch_id: bid,
          decision: reviewed ? 'REVIEW' : 'ALLOW',
          metric_snapshot: { quantity: batchQuantity, amount: subtotal.toString() },
          reason_codes: reasonCodes,
          config_version: policy.version,
          config_snapshot: policy.policy,
          evaluated_at: at(offset),
          created_at: at(offset),
        });
        if (reviewed)
          add(
            'order_review',
            stamp(uid('review:' + bid), at(offset), {
              order_batch_id: bid,
              status: 'APPROVED',
              requested_at: at(offset),
              expires_at: at(offset + Number(policy.policy.REVIEW_TTL_MINUTES)),
              reviewer_id: waiter.id,
              decided_at: at(offset + 2),
              decision_reason: 'Đã xác nhận món khách gọi tại bàn',
              updated_at: at(offset + 2),
              version: 2,
            }),
          );
        history(
          bid + ':submitted',
          bid,
          null,
          null,
          reviewed ? 'PENDING_REVIEW' : 'SUBMITTED',
          owner,
          at(offset),
          true,
        );
        if (reviewed)
          history(
            bid + ':approved',
            bid,
            null,
            'PENDING_REVIEW',
            'SUBMITTED',
            waiter.id,
            at(offset + 2),
          );
        history(bid + ':accepted', bid, null, 'SUBMITTED', 'ACCEPTED', chef.id, at(offset + 5));
        history(bid + ':progress', bid, null, 'ACCEPTED', 'IN_PROGRESS', chef.id, at(offset + 10));
        history(
          bid + ':complete',
          bid,
          null,
          'IN_PROGRESS',
          'COMPLETED',
          waiter.id,
          at(offset + 54),
        );
        add(
          'idempotency_record',
          stamp(uid('idem:' + bid), at(offset), {
            scope: 'order:' + sid,
            idempotency_key: uid('request:' + bid),
            request_hash: createHash('sha256').update(bid).digest('hex'),
            resource_type: 'ORDER_BATCH',
            response_snapshot: { id: bid, status: 'SUBMITTED' },
            expires_at: at(offset + 480),
            actor_type: 'GUEST',
            actor_participant_id: owner,
            order_batch_id: bid,
            status: 'SUCCEEDED',
          }),
        );
        for (const [e, minute] of [
          [reviewed ? 'ORDER_REVIEW_REQUESTED' : 'ORDER_SUBMITTED', offset],
          ['ITEM_ACCEPTED', offset + 5],
          ['ITEM_IN_PREPARATION', offset + 10],
          ['ITEM_READY', offset + 27],
          ['ITEM_SERVED', offset + 32],
        ] as const)
          add(
            'outbox_event',
            stamp(uid('outbox:' + bid + ':' + e), at(minute), {
              aggregate_type: 'ORDER_BATCH',
              order_batch_id: bid,
              event_type: e,
              payload: { orderBatchId: bid, sessionId: sid },
              status: 'PUBLISHED',
              attempts: 1,
              available_at: at(minute),
              published_at: at(minute + 0.05),
            }),
          );
        if (reviewed)
          add(
            'outbox_event',
            stamp(uid('outbox:' + bid + ':approved'), at(offset + 2), {
              aggregate_type: 'ORDER_BATCH',
              order_batch_id: bid,
              event_type: 'ORDER_SUBMITTED',
              payload: { orderBatchId: bid, sessionId: sid },
              status: 'PUBLISHED',
              attempts: 1,
              available_at: at(offset + 2),
              published_at: at(offset + 2.05),
            }),
          );
      }
      const prepaid = scenario.startsWith('PREPAID'),
        invoice = gross - reversed,
        totalPaid = prepaid ? gross : invoice;
      const portions =
        scenario === 'PARTIAL'
          ? [
              (totalPaid * BigInt(integer(35, 65))) / 100n,
              totalPaid - (totalPaid * BigInt(50)) / 100n,
            ]
          : [totalPaid];
      if (portions.length === 2) portions[1] = totalPaid - portions[0]!;
      const allocationByCharge = new Map<string, { id: string; payment: string }>(),
        allocated = new Map<string, bigint>();
      let sourcePayment = '';
      for (const [p, amount] of portions.entries()) {
        if (amount <= 0n) continue;
        const pay = uid('payment:' + key + ':' + p),
          intent = uid('intent:' + key + ':' + p),
          method =
            scenario === 'PARTIAL'
              ? p === 0
                ? 'CASH'
                : 'BANK_TRANSFER'
              : random() < 0.62
                ? 'CASH'
                : 'BANK_TRANSFER',
          when = prepaid ? 18 : duration - (p === 0 && portions.length === 2 ? 20 : 8),
          paidAt = at(when),
          cash =
            method === 'CASH'
              ? ((amount + 99999n) / 100000n) * 100000n + (random() < 0.18 ? 100000n : 0n)
              : null,
          change = cash === null ? null : cash - amount;
        if (!sourcePayment) sourcePayment = pay;
        add(
          'payment_intent',
          stamp(intent, at(when - 2), {
            session_id: sid,
            payer_participant_id: guests[p % guests.length],
            method,
            amount: amount.toString(),
            status: 'SUCCEEDED',
            client_request_id: uid('pay-request:' + pay),
            expires_at: at(when + 15),
            collection_scope: 'TABLE',
            updated_at: paidAt,
            version: 2,
          }),
        );
        add(
          'payment_transaction',
          stamp(pay, paidAt, {
            payment_intent_id: intent,
            session_id: sid,
            method,
            amount: amount.toString(),
            status: 'SUCCEEDED',
            confirmed_by: waiter.id,
            confirmed_at: paidAt,
            metadata: {
              reference:
                method === 'BANK_TRANSFER'
                  ? 'CK-' +
                    day.replaceAll('-', '') +
                    '-' +
                    String(ordinal).padStart(6, '0') +
                    '-' +
                    p
                  : null,
              cashHandlingVersion: 1,
              cashReceived: cash?.toString() ?? null,
              changeGiven: change?.toString() ?? null,
              proof: null,
              collectionScope: 'TABLE',
              payerParticipantId: guests[p % guests.length],
              synthetic: true,
              datasetKey: options.datasetKey,
            },
          }),
        );
        let remaining = amount;
        for (const charge of charges) {
          if (!prepaid && charge.status !== 'ACTIVE') continue;
          const prior = allocated.get(String(charge.id)) ?? 0n,
            available = BigInt(String(charge.amount)) - prior,
            take = remaining < available ? remaining : available;
          if (take <= 0n) continue;
          const aid = uid('allocation:' + pay + ':' + charge.id);
          add(
            'payment_allocation',
            stamp(aid, paidAt, {
              payment_transaction_id: pay,
              financial_charge_id: charge.id,
              allocated_amount: take.toString(),
              reversed_amount: prepaid && charge.status === 'REVERSED' ? take.toString() : '0',
              updated_at: prepaid && charge.status === 'REVERSED' ? faultAt : paidAt,
            }),
          );
          allocated.set(String(charge.id), prior + take);
          allocationByCharge.set(String(charge.id), { id: aid, payment: pay });
          remaining -= take;
          if (!remaining) break;
        }
        if (remaining !== 0n) throw new Error('Payment allocation does not cover invoice.');
        if (change && change > 0n)
          audit(
            pay,
            waiter.id,
            'CASH_CHANGE_RETURNED',
            'PAYMENT_TRANSACTION',
            pay,
            at(when + 1),
            'Đã trả tiền thối cho khách',
            { sessionId: sid, changeAmount: change.toString() },
          );
        add(
          'outbox_event',
          stamp(uid('outbox:' + pay), paidAt, {
            aggregate_type: 'PAYMENT_TRANSACTION',
            payment_transaction_id: pay,
            event_type: 'PAYMENT_SUCCEEDED',
            payload: { paymentTransactionId: pay, sessionId: sid },
            status: 'PUBLISHED',
            attempts: 1,
            available_at: paidAt,
            published_at: at(when + 0.1),
          }),
        );
      }
      if (prepaid && reversed > 0n && faulty) {
        const charge = charges.find((row) => row.order_item_id === faulty!.id)!,
          allocation = allocationByCharge.get(String(charge.id))!,
          f = uid('refund:' + key),
          created = new Date(Date.parse(faultAt) + 60000).toISOString(),
          approved = new Date(Date.parse(faultAt) + 180000).toISOString(),
          processed = new Date(Date.parse(faultAt) + 360000).toISOString(),
          method = scenario === 'PREPAID_WAIVE' ? 'BANK_TRANSFER' : 'CASH';
        add(
          'refund_case',
          stamp(f, created, {
            session_id: sid,
            order_item_id: faulty.id,
            source_payment_transaction_id: sourcePayment,
            source_allocation_id: allocation.id,
            amount: reversed.toString(),
            reason:
              scenario === 'PREPAID_CANCEL'
                ? 'Hoàn tiền món dừng trước chế biến'
                : 'Hoàn tiền món do phản ánh chất lượng',
            status: method === 'CASH' ? 'RESOLVED_CASH' : 'RESOLVED_TRANSFER',
            resolution_method: method,
            assigned_staff_id: waiter.id,
            request_key: uid('refund-key:' + key),
            updated_at: processed,
          }),
        );
        audit(
          f,
          admin.id,
          'REFUND_APPROVED',
          'REFUND_CASE',
          f,
          approved,
          'Quản trị duyệt phiếu hoàn tiền',
          {
            sessionId: sid,
            paymentId: sourcePayment,
            amount: reversed.toString(),
            associationVersion: 1,
            relatedItemIds: [faulty.id],
          },
        );
        add(
          'refund_transaction',
          stamp(uid('refund-payment:' + key), processed, {
            refund_case_id: f,
            method,
            amount: reversed.toString(),
            reference:
              method === 'BANK_TRANSFER' ? 'HT-' + day.replaceAll('-', '') + '-' + ordinal : null,
            status: 'SUCCEEDED',
            processed_by: waiter.id,
            processed_at: processed,
            request_key: uid('refund-complete:' + key),
          }),
        );
        audit(
          f + ':complete',
          waiter.id,
          'REFUND_COMPLETED',
          'REFUND_CASE',
          f,
          processed,
          'Nhân viên xác nhận đã hoàn tiền',
          { sessionId: sid, amount: reversed.toString() },
        );
        add(
          'operational_alert',
          stamp(uid('refund-alert:' + key), created, {
            session_id: sid,
            table_id: table.id,
            alert_type: 'REFUND_REQUIRED',
            severity: 'WARNING',
            status: 'RESOLVED',
            outstanding_amount: '0',
            acknowledged_by: waiter.id,
            resolved_by: waiter.id,
            resolved_at: processed,
            resolution_note: 'Đã hoàn đủ tiền cho khách',
            updated_at: processed,
          }),
        );
      }
      if (scenario === 'PARTIAL' && random() < 0.25)
        add(
          'outstanding_balance_case',
          stamp(uid('shortfall:' + key), at(duration - 18), {
            session_id: sid,
            table_id: table.id,
            invoice_total: invoice.toString(),
            paid_total: invoice.toString(),
            outstanding_amount: '0',
            reason_code: 'OTHER',
            status: 'RECOVERED',
            reported_by: waiter.id,
            admin_owner: admin.id,
            notes: 'Đã thu phần còn lại trước khi kết thúc bàn',
            updated_at: at(duration - 7),
          }),
        );
      if (random() < 0.32) {
        const help = uid('support:' + key),
          handoff = random() < 0.2 && dutyStaff.length > 1,
          other = staff.find((actor) => actor.id === dutyStaff[(n + 1) % dutyStaff.length])!;
        add(
          'support_request',
          stamp(help, at(20), {
            session_id: sid,
            participant_id: guests[0],
            request_type: ['WATER', 'UTENSILS', 'ASSISTANCE'][integer(0, 2)],
            content: 'Khách cần hỗ trợ tại bàn',
            status: 'RESOLVED',
            acknowledged_by: handoff ? other.id : waiter.id,
            resolved_by: handoff ? other.id : waiter.id,
            acknowledged_at: at(21),
            resolved_at: at(27),
            updated_at: at(27),
          }),
        );
        if (handoff)
          add('support_request_handoff', {
            id: uid('handoff:' + key),
            support_request_id: help,
            from_staff_id: waiter.id,
            to_staff_id: other.id,
            reason: 'Đồng nghiệp tiếp nhận hỗ trợ tại bàn',
            status: 'ACCEPTED',
            requested_at: at(22),
            responded_at: at(23),
            responded_by: other.id,
          });
      }
      if (n === 0 && tables.length > 1 && random() < 0.25) {
        const prior = tables[tables.length - 1]!;
        add('table_transfer_history', {
          id: uid('transfer:' + key),
          restaurant_id: options.restaurantId,
          session_id: sid,
          from_table_id: prior.id,
          to_table_id: table.id,
          transferred_by: waiter.id,
          reason: 'Khách chuyển sang vị trí thuận tiện hơn',
          transferred_at: at(8),
        });
        audit(
          sid + ':transfer',
          waiter.id,
          'TABLE_TRANSFERRED',
          'TABLE_SESSION',
          sid,
          at(8),
          'Đã chuyển bàn theo yêu cầu khách',
          { fromTableId: prior.id, toTableId: table.id },
        );
      }
      audit(
        sid + ':closed',
        waiter.id,
        'SESSION_CLOSED',
        'TABLE_SESSION',
        sid,
        closeAt,
        'Đã thanh toán, giao phiếu và kết thúc bàn',
        { sessionId: sid },
      );
    }
    if (!completedToday) continue;
    dayCounts[day] = completedToday;
    const receiptsByLocation = new Map<string, HistoryRow>();
    for (const balance of balances) {
      const needed = dayConsumption.get(balance.id) ?? 0n,
        target = needed * 2n + balance.minimum,
        order = target > balance.current ? target - balance.current : 0n;
      if (order > 0n) {
        let receipt = receiptsByLocation.get(balance.location_id);
        if (!receipt) {
          receipt = {
            id: uid('receipt:' + day + ':' + balance.location_id),
            location_id: balance.location_id,
            receipt_no: 'PN-' + day.replaceAll('-', '') + '-' + balance.location_id.slice(0, 6),
            status: 'DRAFT',
            received_at: historyTimestamp(day, 540),
            total_value: '0',
            created_by: admin.id,
            approved_by: admin.id,
            supplier_name_snapshot: 'Nhà cung cấp nguyên liệu theo nhóm kho',
            created_at: historyTimestamp(day, 525),
            updated_at: historyTimestamp(day, 540),
          };
          receiptsByLocation.set(balance.location_id, receipt);
          add('goods_receipt', receipt);
        }
        const value = roundedCost(order, balance.cost);
        receipt.total_value = (BigInt(String(receipt.total_value)) + value).toString();
        add(
          'goods_receipt_item',
          stamp(uid('receipt-line:' + day + ':' + balance.id), historyTimestamp(day, 525), {
            receipt_id: receipt.id,
            ingredient_id: balance.ingredient_id,
            quantity: decimal(order),
            unit_id: balance.unit_id,
            base_quantity: decimal(order),
            unit_cost: decimal(balance.cost),
            lot_no: 'LO-' + day.replaceAll('-', ''),
          }),
        );
        add(
          'inventory_movement',
          stamp(uid('received:' + day + ':' + balance.id), historyTimestamp(day, 540), {
            location_id: balance.location_id,
            ingredient_id: balance.ingredient_id,
            movement_type: 'RECEIPT',
            quantity: decimal(order),
            unit_cost: decimal(balance.cost),
            value: value.toString(),
            source_type: 'GOODS_RECEIPT',
            created_by: admin.id,
            goods_receipt_id: receipt.id,
            occurred_at: historyTimestamp(day, 540),
          }),
        );
        balance.current += order;
      }
      balance.current -= needed;
      if (balance.current < 0n) throw new Error('Planned inventory went negative.');
      if (dayIndex % 7 === 3 && integer(0, 19) === 0) {
        const waste = balance.current / 200n;
        if (waste > 0n) {
          const before = balance.current + needed,
            mode = dayIndex % 14 === 3 ? 'WASTE' : 'COUNT';
          const movementId = uid('waste:' + day + ':' + balance.id),
            reason =
              mode === 'WASTE'
                ? 'Xuất hủy phần nguyên liệu hư hỏng sau kiểm tra chất lượng'
                : 'Điều chỉnh chênh lệch tồn theo biên bản kiểm kê';
          balance.current -= waste;
          const when = historyTimestamp(day, 9 * 60 + 15);
          add(
            'inventory_movement',
            stamp(movementId, when, {
              location_id: balance.location_id,
              ingredient_id: balance.ingredient_id,
              movement_type: mode === 'WASTE' ? 'WASTE' : 'ADJUSTMENT_OUT',
              quantity: decimal(-waste),
              unit_cost: decimal(balance.cost),
              value: (-roundedCost(waste, balance.cost)).toString(),
              source_type: 'MANUAL',
              created_by: admin.id,
              request_key: mode + '-' + day + '-' + balance.code,
              reason,
              occurred_at: when,
            }),
          );
          audit(
            balance.id + ':count:' + day,
            admin.id,
            'ADJUST_STOCK',
            'INVENTORY_MOVEMENT',
            movementId,
            when,
            reason,
            {
              balanceId: balance.id,
              mode,
              locationId: balance.location_id,
              quantity: decimal(mode === 'WASTE' ? waste : before - waste),
              before: decimal(before),
              delta: decimal(-waste),
            },
          );
        }
      }
    }
    for (const receipt of receiptsByLocation.values())
      audit(
        String(receipt.id) + ':approved',
        admin.id,
        'APPROVE_RECEIPT',
        'GOODS_RECEIPT',
        String(receipt.id),
        historyTimestamp(day, 540),
        'Kiểm tra hàng và duyệt nhập kho',
        { locationId: receipt.location_id, totalValue: receipt.total_value },
      );
  }
  const counts = Object.fromEntries(
    Object.entries(rows).map(([table, list]) => [table, list.length]),
  );
  const catalogFingerprint = createHash('sha256').update(JSON.stringify(products)).digest('hex');
  const manifest = {
    schemaVersion: 1,
    synthetic: true,
    purpose:
      'Development, demonstration and evaluation; not evidence of real customers, cash receipts or bank transfers.',
    datasetKey: options.datasetKey,
    seed: options.seed ?? options.datasetKey,
    restaurantId: options.restaurantId,
    from: options.from,
    through: options.through,
    cutoff: options.now.toISOString(),
    catalogFingerprint,
    counts,
    dayCounts,
    scenarioCounts,
    transientTablesLeftEmpty: ['cart_item', 'payment_webhook_event', 'table_access_limit'],
    baseline: {
      products: products.length,
      ingredients: balances.length,
      tables: tables.length,
      staff: staff.length,
      kitchen: kitchen.length,
    },
  };
  return { rows, balances, manifest, sessions: rows.table_session ?? [], admin };
}

export async function generateRestaurantHistory(db: Database, options: RestaurantHistoryOptions) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='170s'");
    await c.query('SELECT pg_advisory_xact_lock(450046)');
    const existing = (
      await c.query(
        "SELECT details FROM business_audit_event WHERE restaurant_id=$1 AND action='GENERATE_RESTAURANT_HISTORY' AND details->>'datasetKey'=$2",
        [options.restaurantId, options.datasetKey],
      )
    ).rows[0];
    if (existing) {
      await c.query('ROLLBACK');
      return { applied: false, alreadyApplied: true, manifest: existing.details.manifest };
    }
    const plan = await buildHistoryPlan(c, options);
    options.progress?.(
      `Planned ${plan.sessions.length} sessions and ${plan.manifest.counts.order_item ?? 0} item lines.`,
    );
    if (!options.apply) {
      await c.query('ROLLBACK');
      return { applied: false, alreadyApplied: false, manifest: plan.manifest };
    }
    const existingSessions = (
      await c.query(
        'SELECT count(*) AS n FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1',
        [options.restaurantId],
      )
    ).rows[0];
    if (Number(existingSessions.n))
      throw new Error(
        'History import requires an empty canonical candidate; existing operational sessions are never replaced or appended.',
      );
    const collision = (
      await c.query(
        'SELECT count(*) AS n FROM table_session WHERE receipt_number=ANY($1::text[])',
        [plan.sessions.map((row) => row.receipt_number)],
      )
    ).rows[0];
    if (Number(collision.n))
      throw new Error('Receipt-number collision: use an empty canonical target.');
    await insertHistoryRows(c, 'goods_receipt', plan.rows.goods_receipt ?? []);
    await insertHistoryRows(c, 'goods_receipt_item', plan.rows.goods_receipt_item ?? []);
    await c.query("UPDATE goods_receipt SET status='APPROVED' WHERE id=ANY($1::uuid[])", [
      (plan.rows.goods_receipt ?? []).map((row) => row.id),
    ]);
    for (const table of insertOrder) {
      await insertHistoryRows(c, table, plan.rows[table] ?? []);
      options.progress?.(`Inserted ${table}: ${plan.rows[table]?.length ?? 0}.`);
    }
    for (const balance of plan.balances)
      await c.query(
        'UPDATE inventory_balance SET on_hand_qty=$2::numeric,reserved_qty=0,available_qty=$2::numeric,version=version+1 WHERE id=$1',
        [balance.id, decimal(balance.current)],
      );
    // Populate fresh candidate statistics before correlated ledger checks and receipt queries.
    for (const table of [
      'table_session',
      'order_batch',
      'order_item',
      'financial_charge',
      'payment_transaction',
      'payment_allocation',
      'refund_case',
      'refund_transaction',
      'inventory_reservation',
      'order_item_ingredient_snapshot',
      'inventory_movement',
      'business_audit_event',
      'order_status_history',
    ])
      await c.query(Object.assign({ text: `ANALYZE ${table}` }, { query_timeout: 180000 }));
    options.progress?.('Analyzed candidate ledger and inventory statistics.');
    let frozen = 0;
    for (const session of plan.sessions) {
      const id = String(session.id),
        closed = String(session.closed_at);
      const billSession = (
        await c.query(
          'SELECT s.*,t.code AS table_code,t.name AS table_name FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=$1',
          [id],
        )
      ).rows[0];
      const bill = await readBill(c, billSession, options.restaurantId);
      if (!('account' in bill))
        throw new Error('Expected an unfrozen bill in the empty candidate.');
      const ready = await closeReadiness(c, id, bill.account);
      if (!ready.canClose && ready.blockers.some((blocker) => blocker.code !== 'RECEIPT'))
        throw new Error(
          'Closed historical session has blockers: ' + JSON.stringify(ready.blockers),
        );
      const key = await receiptKey(c, id);
      await c.query(
        "INSERT INTO business_audit_event(id,restaurant_id,actor_id,action,resource_type,resource_id,reason,details,created_at) VALUES($1,$2,$3,'RECEIPT_PROVIDED','TABLE_SESSION',$4,'Đã giao phiếu thanh toán cho khách',$5::jsonb,$6)",
        [
          deterministicUuid(options.datasetKey + ':provided:' + id),
          options.restaurantId,
          session.closed_by,
          id,
          JSON.stringify({ billKey: key, sessionId: id, datasetKey: options.datasetKey }),
          closed,
        ],
      );
      const finalBill = await readBill(c, billSession, options.restaurantId);
      if (!('generatedAt' in finalBill))
        throw new Error('Receipt became frozen before import completed.');
      finalBill.generatedAt = closed;
      await c.query('UPDATE table_session SET receipt_snapshot=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(finalBill),
      ]);
      frozen++;
      if (frozen % 100 === 0)
        options.progress?.(`Frozen ${frozen}/${plan.sessions.length} receipts.`);
    }
    const checks = await validateRestaurantHistory(
      c,
      options.restaurantId,
      options.now,
      options.progress,
    );
    if (Object.values(checks).some((n) => n !== 0))
      throw new Error('History invariants failed: ' + JSON.stringify(checks));
    await c.query(
      "INSERT INTO business_audit_event(id,restaurant_id,actor_id,action,resource_type,resource_id,reason,details,created_at) VALUES($1,$2,$3,'GENERATE_RESTAURANT_HISTORY','RESTAURANT',$2,'Khởi tạo bộ lịch sử theo cấu hình kỹ thuật',$4::jsonb,$5)",
      [
        deterministicUuid(options.datasetKey + ':manifest'),
        options.restaurantId,
        plan.admin.id,
        JSON.stringify({
          datasetKey: options.datasetKey,
          synthetic: true,
          manifest: plan.manifest,
          checks,
        }),
        options.now.toISOString(),
      ],
    );
    await c.query('COMMIT');
    if (options.manifestPath) {
      const destination = resolve(options.manifestPath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, JSON.stringify({ ...plan.manifest, checks }, null, 2) + '\n');
    }
    return { applied: true, alreadyApplied: false, manifest: plan.manifest, checks };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name: string, fallback: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
  };
  const db = createDatabase(process.env.DATABASE_URL!);
  try {
    console.log(
      JSON.stringify(
        await generateRestaurantHistory(db, {
          restaurantId: option('--restaurant-id', '10000000-0000-4000-8000-000000000001'),
          from: option('--from', '2026-08-01'),
          through: option('--through', '2026-10-12'),
          now: new Date(option('--now', new Date().toISOString())),
          datasetKey: option('--dataset-key', 'qt-history-20260801-20261012-v1'),
          apply: process.argv.includes('--apply'),
          manifestPath: option('--manifest', 'var/data/restaurant-history.json'),
          progress: (message) => console.log(message),
        }),
        null,
        2,
      ),
    );
  } finally {
    await db.close();
  }
}
