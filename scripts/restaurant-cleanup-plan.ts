import type { Database } from '../packages/database/src/index.js';

export type CanonicalRestaurantKeys = {
  productCodes: readonly string[];
  ingredientCodes: readonly string[];
  usernames: readonly string[];
  tableCodes: readonly string[];
  categoryCodes: readonly string[];
  areaCodes: readonly string[];
  locationCodes: readonly string[];
  shiftTemplateCodes: readonly string[];
};
export type CleanupTablePlan = {
  table: string;
  classification: 'HISTORY' | 'REBUILD_DERIVED' | 'REMOVE_NONCANONICAL_MASTER' | 'PRESERVE';
  scopedRows: number;
  removeRows: number;
  predicate: string;
  parameters: unknown[];
  immutable: boolean;
};

const sessions =
  'SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1::uuid';
const batches = `SELECT b.id FROM order_batch b WHERE b.session_id IN (${sessions})`;
const items = `SELECT i.id FROM order_item i WHERE i.order_batch_id IN (${batches})`;
const users = 'SELECT u.id FROM app_user u WHERE u.restaurant_id=$1::uuid';
const products = 'SELECT p.id FROM product p WHERE p.restaurant_id=$1::uuid';
const ingredients = 'SELECT i.id FROM ingredient i WHERE i.restaurant_id=$1::uuid';
const locations = 'SELECT l.id FROM stock_location l WHERE l.restaurant_id=$1::uuid';
const payments = `SELECT p.id FROM payment_transaction p WHERE p.session_id IN (${sessions})`;
const refunds = `SELECT f.id FROM refund_case f WHERE f.session_id IN (${sessions})`;
const receipts = `SELECT g.id FROM goods_receipt g WHERE g.location_id IN (${locations})`;
const support = `SELECT r.id FROM support_request r WHERE r.session_id IN (${sessions}) OR r.table_id IN (SELECT id FROM dining_table WHERE restaurant_id=$1::uuid)`;
const shifts = 'SELECT id FROM work_shift WHERE restaurant_id=$1::uuid';
const runs = 'SELECT id FROM payroll_run WHERE restaurant_id=$1::uuid';
const slips = `SELECT id FROM payroll_slip WHERE payroll_run_id IN (${runs})`;

/** Read-only plan. Applying destructive maintenance belongs to the backed-up restore controller. */
export async function planRestaurantCleanup(
  db: Database,
  restaurantId: string,
  protectedAdminUserId: string,
  keep: CanonicalRestaurantKeys,
) {
  if (
    Object.entries(keep).some(
      ([name, codes]) => !Array.isArray(codes) || (name !== 'shiftTemplateCodes' && !codes.length),
    )
  )
    throw new Error('Canonical master lists must be explicit and non-empty.');
  const admin = await db.prisma.app_user.findUniqueOrThrow({ where: { id: protectedAdminUserId } });
  if (admin.restaurant_id !== restaurantId)
    throw new Error('Protected administrator belongs to another restaurant.');
  const specs: [string, string, boolean][] = [
    ['support_request_handoff', `support_request_id IN (${support})`, false],
    [
      'outbox_event',
      `order_batch_id IN (${batches}) OR payment_transaction_id IN (${payments}) OR support_request_id IN (${support})`,
      false,
    ],
    [
      'idempotency_record',
      `actor_user_id IN (${users}) OR actor_participant_id IN (SELECT id FROM session_participant WHERE session_id IN (${sessions}))`,
      false,
    ],
    ['order_status_history', `order_batch_id IN (${batches})`, true],
    ['order_risk_assessment', `order_batch_id IN (${batches})`, true],
    ['order_review', `order_batch_id IN (${batches})`, true],
    ['payment_webhook_event', `payment_transaction_id IN (${payments})`, true],
    ['refund_transaction', `refund_case_id IN (${refunds})`, true],
    ['refund_case', `session_id IN (${sessions})`, true],
    ['payment_allocation', `payment_transaction_id IN (${payments})`, true],
    ['payment_transaction', `session_id IN (${sessions})`, true],
    ['payment_intent', `session_id IN (${sessions})`, true],
    ['outstanding_balance_case', `session_id IN (${sessions})`, true],
    ['financial_charge', `session_id IN (${sessions})`, true],
    ['order_item_ingredient_snapshot', `order_item_id IN (${items})`, true],
    ['inventory_reservation', `order_item_id IN (${items})`, false],
    [
      'inventory_movement',
      `location_id IN (${locations}) OR ingredient_id IN (${ingredients})`,
      true,
    ],
    ['goods_receipt_item', `receipt_id IN (${receipts})`, true],
    ['goods_receipt', `location_id IN (${locations})`, true],
    ['order_item', `order_batch_id IN (${batches})`, true],
    ['order_batch', `session_id IN (${sessions})`, true],
    [
      'cart_item',
      `cart_id IN (SELECT id FROM session_cart WHERE session_id IN (${sessions}))`,
      false,
    ],
    ['session_cart', `session_id IN (${sessions})`, false],
    ['support_request', `id IN (${support})`, false],
    [
      'operational_alert',
      `session_id IN (${sessions}) OR table_id IN (SELECT id FROM dining_table WHERE restaurant_id=$1::uuid)`,
      false,
    ],
    ['table_transfer_history', 'restaurant_id=$1::uuid', false],
    ['session_financial_account', `session_id IN (${sessions})`, false],
    ['session_participant', `session_id IN (${sessions})`, false],
    ['table_session', `id IN (${sessions})`, false],
    ['payroll_payment', `payroll_slip_id IN (${slips})`, false],
    ['payroll_line', `payroll_slip_id IN (${slips})`, false],
    ['payroll_slip', `payroll_run_id IN (${runs})`, false],
    ['payroll_run', 'restaurant_id=$1::uuid', false],
    [
      'attendance_record',
      `assignment_id IN (SELECT id FROM shift_assignment WHERE shift_id IN (${shifts}))`,
      false,
    ],
    ['shift_assignment', `shift_id IN (${shifts})`, false],
    ['work_shift', 'restaurant_id=$1::uuid', false],
    ['employee_pay_rate', `user_id IN (${users})`, false],
    ['workforce_calendar_day', 'restaurant_id=$1::uuid', false],
    ['workforce_pay_policy', 'restaurant_id=$1::uuid', false],
    ['business_audit_event', 'restaurant_id=$1::uuid', false],
    ['table_access_limit', 'restaurant_id=$1::uuid', false],
  ];
  const tables: CleanupTablePlan[] = [];
  const count = async (table: string, predicate: string, parameters: unknown[]) =>
    Number(
      (await db.pool.query(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`, parameters))
        .rows[0].n,
    );
  for (const [table, predicate, immutable] of specs) {
    const scopedRows = await count(table, predicate, [restaurantId]);
    tables.push({
      table,
      classification: 'HISTORY',
      scopedRows,
      removeRows: scopedRows,
      predicate,
      parameters: [restaurantId],
      immutable,
    });
  }
  for (const [table, predicate] of [
    ['inventory_balance', `ingredient_id IN (${ingredients})`],
    [
      'recipe_bom_item',
      `recipe_bom_id IN (SELECT id FROM recipe_bom WHERE product_id IN (${products}))`,
    ],
    ['recipe_bom', `product_id IN (${products})`],
    ['product_combo_item', `combo_product_id IN (${products})`],
    ['table_qr_token', 'table_id IN (SELECT id FROM dining_table WHERE restaurant_id=$1::uuid)'],
  ]) {
    const scopedRows = await count(table!, predicate!, [restaurantId]);
    tables.push({
      table: table!,
      classification: 'REBUILD_DERIVED',
      scopedRows,
      removeRows: scopedRows,
      predicate: predicate!,
      parameters: [restaurantId],
      immutable: false,
    });
  }
  for (const [table, key, codes] of [
    ['product', 'code', keep.productCodes],
    ['ingredient', 'code', keep.ingredientCodes],
    ['dining_table', 'code', keep.tableCodes],
    ['menu_category', 'code', keep.categoryCodes],
    ['dining_area', 'code', keep.areaCodes],
    ['stock_location', 'code', keep.locationCodes],
    ['shift_template', 'code', keep.shiftTemplateCodes],
    ['app_user', 'username', keep.usernames],
  ] as const) {
    const predicate =
      `restaurant_id=$1::uuid AND NOT (${key}=ANY($2::text[]))` +
      (table === 'app_user' ? ' AND id<>$3::uuid' : '');
    const parameters: unknown[] =
      table === 'app_user'
        ? [restaurantId, [...codes], protectedAdminUserId]
        : [restaurantId, [...codes]];
    tables.push({
      table,
      classification: 'REMOVE_NONCANONICAL_MASTER',
      scopedRows: await count(table, 'restaurant_id=$1::uuid', [restaurantId]),
      removeRows: await count(table, predicate, parameters),
      predicate,
      parameters,
      immutable: false,
    });
  }
  for (const table of [
    'role',
    'permission',
    'role_permission',
    'unit_of_measure',
    'restaurant',
    'risk_policy_config',
  ])
    tables.push({
      table,
      classification: 'PRESERVE',
      scopedRows: 0,
      removeRows: 0,
      predicate: 'false',
      parameters: [],
      immutable: false,
    });
  const membershipPredicate =
    'user_id IN (SELECT id FROM app_user WHERE restaurant_id=$1::uuid AND NOT (username=ANY($2::text[])) AND id<>$3::uuid)';
  tables.push({
    table: 'user_role',
    classification: 'REMOVE_NONCANONICAL_MASTER',
    scopedRows: await count('user_role', `user_id IN (${users})`, [restaurantId]),
    removeRows: await count('user_role', membershipPredicate, [
      restaurantId,
      [...keep.usernames],
      protectedAdminUserId,
    ]),
    predicate: membershipPredicate,
    parameters: [restaurantId, [...keep.usernames], protectedAdminUserId],
    immutable: false,
  });
  if (
    (await db.pool.query("SELECT to_regclass('public.menu_promotion') AS table_name")).rows[0]
      ?.table_name
  )
    tables.push({
      table: 'menu_promotion',
      classification: 'PRESERVE',
      scopedRows: await count('menu_promotion', 'restaurant_id=$1::uuid', [restaurantId]),
      removeRows: 0,
      predicate: 'false',
      parameters: [],
      immutable: false,
    });
  return {
    restaurantId,
    protectedAdminUserId,
    dryRun: true,
    requiresBackedUpMaintenance: true,
    note: 'Predicates are tenant-scoped; history guards are retained. This helper executes no delete or truncate.',
    tables,
  };
}
