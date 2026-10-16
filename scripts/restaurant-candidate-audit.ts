import { writeFileSync } from 'node:fs';
import { createDatabase } from '../packages/database/src/index.js';
import { restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerCatalog } from '../apps/api/src/modules/catalog/catalog.routes.js';
import { registerAdminOverview } from '../apps/api/src/modules/admin/overview.routes.js';
import { registerAdminReports } from '../apps/api/src/modules/admin/reports.routes.js';
import { registerHistory } from '../apps/api/src/modules/shared/history.routes.js';
import { registerInventory } from '../apps/api/src/modules/inventory/inventory.routes.js';
import { registerOrders } from '../apps/api/src/modules/orders/orders.routes.js';
import { registerOrderExceptions } from '../apps/api/src/modules/orders/exception.routes.js';
import { registerWorkforce } from '../apps/api/src/modules/workforce/workforce.routes.js';
import { registerPayroll } from '../apps/api/src/modules/workforce/payroll.routes.js';
import { registerFinance } from '../apps/api/src/modules/payments/payments.routes.js';
import type { Identity } from '../apps/api/src/modules/auth/types.js';

const candidate = process.argv[2] ?? 'qr_restaurant_unified_20261012_v2',
  url = new URL(process.env.DATABASE_URL!);
if (!/^qr_restaurant_unified_20261012_v[1-9]\d*$/.test(candidate))
  throw new Error('Explicit unified candidate audit only.');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Local candidate audit only.');
url.pathname = '/' + candidate;
url.searchParams.set('options', '-c default_transaction_read_only=on');
const db = createDatabase(url.toString()),
  app = buildApp(db),
  report: Record<string, unknown> = {
    candidate,
    readOnly: true,
    capturedAt: new Date().toISOString(),
  };
const result = async (sql: string) => (await db.pool.query(sql)).rows;
try {
  report.connection = (
    await result(
      "SELECT current_database() AS database,current_setting('default_transaction_read_only') AS read_only",
    )
  )[0];
  const coverage = await result(
    "SELECT p.code,p.product_kind,p.name,count(i.id)::int AS ordered_lines,COALESCE(sum(i.quantity),0)::int AS quantity,count(i.id)FILTER(WHERE i.status='SERVED')::int AS served_lines,count(i.id)FILTER(WHERE i.status IN ('CANCELLED','UNAVAILABLE'))::int AS stopped_lines FROM product p LEFT JOIN order_item i ON i.product_id=p.id GROUP BY p.id ORDER BY p.code",
  );
  report.salesCoverage = {
    totalProducts: coverage.length,
    uncoveredCodes: coverage.filter((row) => !row.ordered_lines).map((row) => row.code),
    minimumOrderedLines: Math.min(...coverage.map((row) => row.ordered_lines)),
    products: coverage,
  };
  report.money = (
    await result(
      "SELECT (SELECT sum(amount)::text FROM payment_transaction WHERE status='SUCCEEDED') AS paid_to_bill,(SELECT sum((metadata->>'cashReceived')::bigint)::text FROM payment_transaction WHERE method='CASH' AND status='SUCCEEDED') AS cash_customer_handed,(SELECT sum(amount)::text FROM payment_transaction WHERE method='CASH' AND status='SUCCEEDED') AS cash_applied,(SELECT sum((metadata->>'changeGiven')::bigint)::text FROM payment_transaction WHERE method='CASH' AND status='SUCCEEDED') AS cash_change,(SELECT sum(amount)::text FROM payment_transaction WHERE method='BANK_TRANSFER' AND status='SUCCEEDED') AS bank_applied,(SELECT sum(amount)::text FROM refund_transaction WHERE status='SUCCEEDED') AS refunded,(SELECT sum(amount)::text FROM refund_transaction WHERE method='CASH' AND status='SUCCEEDED') AS refunded_cash,(SELECT sum(amount)::text FROM refund_transaction WHERE method='BANK_TRANSFER' AND status='SUCCEEDED') AS refunded_transfer,(SELECT sum(amount)::text FROM financial_charge WHERE status='ACTIVE') AS current_charges",
    )
  )[0];
  const checks: Record<string, string> = {
    recipePlans:
      'SELECT count(*)::int AS violations FROM order_item_ingredient_snapshot x JOIN order_item i ON i.id=x.order_item_id JOIN recipe_bom b ON b.id=x.recipe_bom_id LEFT JOIN recipe_bom_item r ON r.recipe_bom_id=b.id AND r.ingredient_id=x.ingredient_id WHERE r.id IS NULL OR x.planned_qty<>ceil(r.quantity*i.quantity/b.yield_quantity*(1+r.waste_percent/100)*1000000)/1000000',
    itemTimeline:
      'SELECT count(*)::int AS violations FROM order_item WHERE (received_at IS NOT NULL AND received_at<created_at) OR (preparation_started_at IS NOT NULL AND (received_at IS NULL OR preparation_started_at<received_at)) OR (ready_at IS NOT NULL AND (preparation_started_at IS NULL OR ready_at<preparation_started_at)) OR (served_at IS NOT NULL AND (ready_at IS NULL OR served_at<ready_at))',
    guestOwnership:
      "SELECT count(*)::int AS violations FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id JOIN session_participant p ON p.id=i.owner_participant_id WHERE b.created_by_type='GUEST' AND (p.id<>b.created_by_participant_id OR p.session_id<>b.session_id OR p.joined_at>b.created_at OR p.accepted_policy_at>b.created_at)",
    cancellationActor:
      "SELECT count(*)::int AS violations FROM order_item i JOIN user_role ur ON ur.user_id=i.cancelled_by_user_id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE (i.status='UNAVAILABLE' AND r.code<>'KITCHEN') OR (i.status='CANCELLED' AND i.cancel_reason_code='CUSTOMER_CHANGED_MIND' AND r.code<>'STAFF')",
    servedActors:
      "SELECT count(*)::int AS violations FROM order_status_history h JOIN user_role ur ON ur.user_id=h.actor_user_id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE h.order_item_id IS NOT NULL AND ((h.new_status IN ('ACCEPTED','IN_PREPARATION','READY') AND r.code<>'KITCHEN') OR (h.new_status='SERVED' AND r.code<>'STAFF'))",
    reviewChargeTiming:
      "SELECT count(*)::int AS violations FROM financial_charge f JOIN order_item i ON i.id=f.order_item_id JOIN order_review r ON r.order_batch_id=i.order_batch_id WHERE r.status='APPROVED' AND f.created_at<r.decided_at",
    productCreatedAfterSale:
      'SELECT count(*)::int AS violations FROM order_item i JOIN product p ON p.id=i.product_id WHERE p.created_at>i.created_at',
    ingredientCreatedAfterPlan:
      'SELECT count(*)::int AS violations FROM order_item_ingredient_snapshot x JOIN ingredient i ON i.id=x.ingredient_id WHERE i.created_at>x.created_at',
    roleGrantedAfterAction:
      'SELECT count(*)::int AS violations FROM order_status_history h JOIN user_role ur ON ur.user_id=h.actor_user_id AND ur.revoked_at IS NULL WHERE ur.assigned_at>h.changed_at',
  };
  report.additionalChecks = {};
  for (const [name, sql] of Object.entries(checks))
    (report.additionalChecks as Record<string, unknown>)[name] = (await result(sql))[0].violations;
  const masters: Record<string, number> = {};
  for (const table of [
    'restaurant',
    'app_user',
    'dining_area',
    'dining_table',
    'menu_category',
    'product',
    'ingredient',
    'stock_location',
    'recipe_bom',
    'recipe_bom_item',
    'role',
    'permission',
    'role_permission',
    'user_role',
    'workforce_pay_policy',
  ])
    masters[table] = Number(
      (
        await result(
          'SELECT count(*)::int AS n FROM ' +
            table +
            " WHERE created_at>'2026-08-01T00:00:00+07:00'::timestamptz",
        )
      )[0].n,
    );
  report.masterCreatedAfterBaseline = masters;
  report.visibleSuspiciousLabels = await result(
    "SELECT kind,code,label FROM (SELECT 'product' AS kind,code,name||' '||COALESCE(description,'') AS label FROM product UNION ALL SELECT 'ingredient',code,name FROM ingredient UNION ALL SELECT 'shift_template',code,name FROM shift_template UNION ALL SELECT 'employee',username,display_name FROM app_user UNION ALL SELECT 'work_shift',id::text,name FROM work_shift) x WHERE label~*'(^|[^[:alnum:]])(demo|sample|AI)([^[:alnum:]]|$)|dữ liệu mẫu|mẫu thử'",
  );
  const people = (
    await db.pool.query(
      "SELECT u.id,u.display_name,u.auth_version,r.code AS role,array_agg(p.code) AS permissions FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id JOIN role_permission rp ON rp.role_id=r.id JOIN permission p ON p.id=rp.permission_id WHERE u.restaurant_id=$1 AND u.status='ACTIVE' GROUP BY u.id,r.code ORDER BY u.username",
      [restaurantId],
    )
  ).rows;
  const identities = new Map(
    people.map((row) => [
      row.role,
      {
        id: row.id,
        displayName: row.display_name,
        role: row.role,
        permissions: row.permissions,
        version: row.auth_version,
      } as Identity,
    ]),
  );
  app.addHook('preHandler', async (request, reply) => {
    const identity = identities.get(String(request.headers['x-audit-role'] ?? 'ADMIN'));
    if (!identity) return reply.code(401).send({ errorCode: 'AUDIT_IDENTITY_REQUIRED' });
    request.identity = identity;
    const permission = request.routeOptions.config.permission;
    if (
      permission &&
      !(Array.isArray(permission) ? permission : [permission]).some((value) =>
        identity.permissions.includes(String(value)),
      )
    )
      return reply.code(403).send({ errorCode: 'AUDIT_PERMISSION_DENIED' });
  });
  registerCatalog(app, db, restaurantId);
  registerAdminOverview(app, db, restaurantId);
  registerAdminReports(app, db, restaurantId);
  registerHistory(app, db, restaurantId);
  registerInventory(app, db, restaurantId);
  registerOrders(app, db, restaurantId);
  registerOrderExceptions(app, db, restaurantId);
  registerWorkforce(app, db, restaurantId);
  registerPayroll(app, db, restaurantId);
  registerFinance(app, db, restaurantId);
  const sid = (await result('SELECT id FROM table_session ORDER BY closed_at DESC LIMIT 1'))[0].id;
  const routes: [string, string][] = [
    ['ADMIN', '/core/catalog'],
    ['ADMIN', '/core/inventory'],
    ['ADMIN', '/core/admin/overview'],
    ['ADMIN', '/core/admin/overview/statistics?period=month'],
    ['ADMIN', '/core/admin/reports?view=sales&period=all'],
    ['ADMIN', '/core/admin/reports?view=payments&period=all'],
    ['ADMIN', '/core/order-exceptions'],
    ['ADMIN', '/core/history/order-active?period=all'],
    ['ADMIN', '/core/history/order-cancelled?period=all'],
    ['ADMIN', '/core/history/order-unavailable?period=all'],
    ['ADMIN', '/core/history/movements?period=all'],
    ['ADMIN', '/core/workforce?from=2026-09-01&to=2026-09-30'],
    ['ADMIN', '/core/payroll'],
    ['STAFF', '/core/orders'],
    ['STAFF', '/core/history/closed-bills?period=all'],
    ['STAFF', '/core/workforce/me?from=2026-09-01&to=2026-09-30'],
    ['STAFF', '/core/payroll/me'],
    ['KITCHEN', '/core/kitchen'],
  ];
  const api = [];
  for (const [role, path] of routes) {
    const start = Date.now(),
      response = await app.inject({ method: 'GET', url: path, headers: { 'x-audit-role': role } });
    api.push({
      role,
      path,
      status: response.statusCode,
      bytes: Buffer.byteLength(response.body),
      milliseconds: Date.now() - start,
      ...(response.statusCode >= 400 ? { errorCode: response.json().errorCode } : {}),
    });
  }
  // This GET takes a row lock through session(), which PostgreSQL forbids on a
  // read-only connection. A CLOSED frozen bill never enters recalculate(); use
  // an ordinary candidate connection for this one inspected read-only route.
  const rowLockedUrl = new URL(url);
  rowLockedUrl.searchParams.delete('options');
  const rowLockedDb = createDatabase(rowLockedUrl.toString()),
    rowLockedApp = buildApp(rowLockedDb);
  try {
    const frozen = (
      await rowLockedDb.pool.query(
        'SELECT session_status,receipt_snapshot IS NOT NULL AS frozen FROM table_session WHERE id=$1',
        [sid],
      )
    ).rows[0];
    if (frozen.session_status !== 'CLOSED' || !frozen.frozen)
      throw new Error('Only a closed, frozen bill can be checked with a row lock.');
    const fingerprintSql =
      'SELECT md5(row_to_json(s)::text) AS session,md5(row_to_json(a)::text) AS account,(SELECT count(*) FROM business_audit_event) AS audit_count,(SELECT md5(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text) FROM app_user u) AS authentication_hash FROM table_session s JOIN session_financial_account a ON a.session_id=s.id WHERE s.id=$1';
    const before = (await rowLockedDb.pool.query(fingerprintSql, [sid])).rows[0];
    rowLockedApp.addHook('preHandler', async (request) => {
      request.identity = identities.get('ADMIN')!;
    });
    registerFinance(rowLockedApp, rowLockedDb, restaurantId);
    const start = Date.now(),
      path = '/core/reports/sessions/' + sid,
      response = await rowLockedApp.inject({ method: 'GET', url: path });
    const after = (await rowLockedDb.pool.query(fingerprintSql, [sid])).rows[0];
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Closed report changed frozen financial state or authentication rows.');
    api.push({
      role: 'ADMIN',
      path,
      status: response.statusCode,
      bytes: Buffer.byteLength(response.body),
      milliseconds: Date.now() - start,
      readMode: 'FROZEN_SNAPSHOT_WITH_ROW_LOCK',
      stateUnchanged: true,
      ...(response.statusCode >= 400 ? { errorCode: response.json().errorCode } : {}),
    });
  } finally {
    await rowLockedApp.close();
    await rowLockedDb.close();
  }
  report.apiReadOnly = api;
  writeFileSync(
    'var/data/' + candidate + '-independent-audit.json',
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      { ...report, salesCoverage: { ...(report.salesCoverage as object), products: undefined } },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await db.close();
}
