import type { Connection } from '../apps/api/src/modules/shared/core-persistence.js';
import { archiveHash } from '../apps/api/src/modules/payments/test-case-archive.service.js';
import { closeReadiness } from '../apps/api/src/modules/dining/close-readiness.js';
import { archiveUuid } from './payos-test-archive-data.js';

export const retirementProfiles = [
  {
    table: 'A01',
    session: 'ffc78214-13d4-4fd3-adae-dd78d01affd5',
    intent: 'f728d24c-6d31-4c07-89a0-d658832ded69',
    cases: 0,
  },
  {
    table: 'A02',
    session: '300659c7-5fea-4a77-a976-94551b078738',
    intent: '85f9d699-e6de-48f1-ad0e-d77ada9423d3',
    cases: 1,
  },
] as const;
type Row = Record<string, unknown>;
type Captured = { row: Row; exact: string };
type Records = Record<string, Captured[]>;
export type RetirementPlan = {
  format: 'payos-test-session-retirement-v1';
  restaurantId: string;
  databaseIdentity: Row;
  foreignKeys: Row[];
  migrationReady: boolean;
  records: Records;
  cases: {
    table: string;
    sessionId: string;
    intentId: string;
    tableId: string;
    archiveId: string;
    voidedCaseId: string | null;
    blockerCounts: { code: string; count: number }[];
    supportIds: string[];
    shortfallAlertIds: string[];
    activeParticipantIds: string[];
    financial: Row;
  }[];
  snapshotHash: string;
  planHash: string;
};
function fail(field: string): never {
  throw Error('RETIRE_REFUSED:' + field);
}
const identifier = (v: string) => (/^[a-z_][a-z0-9_]*$/.test(v) ? '"' + v + '"' : fail('SCHEMA'));
const reviewedChildren = new Set([
  'payos_test_case_archive',
  'payos_test_archive_event',
  'session_cart',
  'cart_item',
  'session_participant',
  'order_batch',
  'order_item',
  'order_status_history',
  'financial_charge',
  'session_financial_account',
  'payment_intent',
  'payos_payment_request',
  'payment_transaction',
  'payment_allocation',
  'refund_case',
  'refund_transaction',
  'operational_alert',
  'outstanding_balance_case',
  'support_request',
  'support_request_handoff',
  'outbox_event',
  'idempotency_record',
  'payment_bank_proof',
  'payment_bank_preview',
  'payment_bank_evidence',
  'bank_receipt_claim',
  'payment_webhook_event',
  'payment_assistance_submission',
  'session_promotion',
  'promotion_request',
  'table_transfer_history',
  'payos_test_session_retirement',
  'order_review',
  'order_risk_assessment',
  'order_item_ingredient_snapshot',
  'inventory_reservation',
  'inventory_movement',
]);
async function capture(c: Connection, table: string, where: string, params: unknown[]) {
  const result = (
    await c.query(
      `SELECT to_jsonb(r) AS row,to_jsonb(r)::text AS exact FROM ${identifier(table)} r WHERE ${where}`,
      params,
    )
  ).rows as Captured[];
  // Keep the same canonical ordering as merge, independent of database collation
  // and of whether the child has an UUID id or a composite primary key.
  return result.sort((a, b) =>
    String(a.row.id ?? a.exact).localeCompare(String(b.row.id ?? b.exact)),
  );
}
function merge(records: Records, table: string, values: Captured[]) {
  const data = new Map((records[table] ?? []).map((v) => [String(v.row.id ?? v.exact), v]));
  const added = values.filter((v) => !data.has(String(v.row.id ?? v.exact)));
  for (const v of values) data.set(v.row.id ? archiveUuid(v.row.id) : v.exact, v);
  records[table] = [...data.values()].sort((a, b) =>
    String(a.row.id ?? a.exact).localeCompare(String(b.row.id ?? b.exact)),
  );
  return added;
}
const values = (records: Records, table: string) => (records[table] ?? []).map((v) => v.row);
export function validateRetirementPlan(plan: RetirementPlan, hash: string) {
  archiveUuid(plan.restaurantId);
  const { planHash, ...body } = plan;
  if (
    plan.format !== 'payos-test-session-retirement-v1' ||
    planHash !== hash ||
    !/^[a-f0-9]{64}$/.test(hash) ||
    archiveHash(body) !== hash ||
    plan.cases.length !== 2 ||
    plan.cases.some(
      (v, i) =>
        v.sessionId !== retirementProfiles[i]!.session ||
        v.intentId !== retirementProfiles[i]!.intent ||
        v.table !== retirementProfiles[i]!.table,
    )
  )
    fail('PLAN_HASH_OR_SCOPE');
}

/** No mutation, no provider/allocator access and no financial recalculation. */
export async function inspectRetirement(
  c: Connection,
  restaurantId: string,
): Promise<RetirementPlan> {
  archiveUuid(restaurantId);
  await c.query("SET LOCAL TIME ZONE 'UTC'");
  const databaseIdentity = (
    await c.query(`SELECT current_database() AS database,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
    inet_server_addr()::text AS server_address,inet_server_port() AS server_port`)
  ).rows[0];
  const migrationReady = Boolean(
    (await c.query("SELECT to_regclass('public.payos_test_session_retirement') AS name")).rows[0]
      .name,
  );
  if (
    migrationReady &&
    (
      await c.query(
        'SELECT 1 FROM payos_test_session_retirement WHERE session_id=ANY($1::uuid[])',
        [retirementProfiles.map((v) => v.session)],
      )
    ).rowCount
  )
    fail('ALREADY_RETIRED_USE_ORIGINAL_PLAN_FOR_RETRY');
  const foreignKeys = (
    await c.query(`SELECT child.relname AS child,parent.relname AS parent,
    (SELECT array_agg(a.attname::text ORDER BY x.n) FROM unnest(f.conkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=x.attnum) AS columns,
    (SELECT array_agg(a.attname::text ORDER BY x.n) FROM unnest(f.confkey) WITH ORDINALITY x(attnum,n) JOIN pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=x.attnum) AS parent_columns,
    pg_get_constraintdef(f.oid) AS definition FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid
    JOIN pg_class parent ON parent.oid=f.confrelid JOIN pg_namespace n ON n.oid=child.relnamespace
    WHERE f.contype='f' AND n.nspname='public' ORDER BY child.relname,pg_get_constraintdef(f.oid)`)
  ).rows as Row[];
  const records: Records = {};
  const pending: { table: string; rows: Captured[] }[] = [];
  const add = (table: string, rows: Captured[]) => {
    const fresh = merge(records, table, rows);
    if (fresh.length) pending.push({ table, rows: fresh });
  };
  const cases: RetirementPlan['cases'] = [];
  for (const profile of retirementProfiles) {
    const session = await capture(c, 'table_session', 'r.id=$1', [profile.session]);
    const s = session[0]?.row;
    if (
      !s ||
      s.session_status !== 'ACTIVE' ||
      s.risk_status !== 'NORMAL' ||
      s.receipt_snapshot ||
      s.receipt_number ||
      s.closed_at
    )
      fail(profile.table + ':ACTIVE_SESSION');
    const table = await capture(c, 'dining_table', 'r.id=$1 AND r.restaurant_id=$2', [
      s.table_id,
      restaurantId,
    ]);
    const t = table[0]?.row;
    if (!t || t.code !== profile.table || t.table_status !== 'OCCUPIED' || !t.is_active)
      fail(profile.table + ':TABLE_OR_TENANT');
    const archive = await capture(
      c,
      'payos_test_case_archive',
      'r.session_id=$1 AND r.payment_intent_id=$2 AND r.restaurant_id=$3',
      [profile.session, profile.intent, restaurantId],
    );
    const a = archive[0]?.row;
    if (
      archive.length !== 1 ||
      !a ||
      a.visible_in_operations ||
      a.table_id !== t.id ||
      a.table_code !== profile.table ||
      String(a.amount) !== '5000'
    )
      fail(profile.table + ':ARCHIVE_MARKER');
    const p = (await c.query('SELECT * FROM payment_intent WHERE session_id=$1', [s.id])).rows;
    const q = (
      await c.query('SELECT * FROM payos_payment_request WHERE id=$1', [a.payos_request_id])
    ).rows[0];
    if (
      p.length !== 1 ||
      p[0].id !== profile.intent ||
      p[0].status !== 'REQUIRES_RECONCILIATION' ||
      p[0].provider !== 'PAYOS' ||
      p[0].method !== 'ONLINE' ||
      String(p[0].amount) !== '5000' ||
      p[0].currency !== 'VND' ||
      !q ||
      q.payment_intent_id !== profile.intent ||
      q.status !== 'REQUIRES_RECONCILIATION' ||
      q.provider_status !== 'PAID' ||
      q.reconciliation_status !== 'OPEN' ||
      String(q.paid_amount) !== '5000' ||
      String(q.order_code) !== String(a.order_code) ||
      q.payment_link_id !== a.payment_link_id ||
      q.alert_id !== a.alert_id ||
      (q.lease_until && new Date(q.lease_until).getTime() > Date.now())
    )
      fail(profile.table + ':FINANCIAL_PROTECTION');
    add('table_session', session);
    merge(records, 'dining_table', table);
    add('payos_test_case_archive', archive);
    cases.push({
      table: profile.table,
      sessionId: profile.session,
      intentId: profile.intent,
      tableId: String(t.id),
      archiveId: String(a.id),
      voidedCaseId: null,
      blockerCounts: [],
      supportIds: [],
      shortfallAlertIds: [],
      activeParticipantIds: [],
      financial: {},
    });
  }
  // Walk every populated inbound FK, including child-of-child records. Unknown
  // dependencies must be reviewed rather than silently left outside the plan.
  while (pending.length) {
    const next = pending.shift()!;
    for (const fk of foreignKeys.filter((v) => v.parent === next.table)) {
      const columns = fk.columns as string[],
        parents = fk.parent_columns as string[];
      for (const parent of next.rows) {
        const rows = await capture(
          c,
          String(fk.child),
          columns.map((v, i) => 'r.' + identifier(v) + '=$' + (i + 1)).join(' AND '),
          parents.map((v) => parent.row[v]),
        );
        if (rows.length && !reviewedChildren.has(String(fk.child)))
          fail('UNREVIEWED_DEPENDENCY:' + String(fk.child));
        add(String(fk.child), rows);
      }
    }
  }
  const resourceIds = [
    ...new Set(
      Object.values(records).flatMap((v) => v.filter((r) => r.row.id).map((r) => String(r.row.id))),
    ),
  ];
  merge(
    records,
    'business_audit_event',
    await capture(
      c,
      'business_audit_event',
      `r.restaurant_id=$1 AND (r.resource_id=ANY($2::uuid[]) OR r.details->>'sessionId'=ANY($3::text[]))`,
      [restaurantId, resourceIds, retirementProfiles.map((v) => v.session)],
    ),
  );
  merge(
    records,
    'table_qr_token',
    await capture(c, 'table_qr_token', 'r.table_id=ANY($1::uuid[])', [cases.map((v) => v.tableId)]),
  );
  for (const v of cases) {
    const profile = retirementProfiles.find((p) => p.session === v.sessionId)!;
    const own = (table: string) =>
      values(records, table).filter((r) => r.session_id === v.sessionId);
    const account = own('session_financial_account');
    if (
      account.length !== 1 ||
      ['paid_total', 'refunded_total', 'refund_due_amount', 'reserved_payment_amount'].some(
        (k) => String(account[0]![k]) !== '0',
      )
    )
      fail(v.table + ':ACCOUNT');
    v.financial = account[0]!;
    for (const table of [
      'payment_transaction',
      'refund_case',
      'payment_allocation',
      'bank_receipt_claim',
      'payment_bank_preview',
      'payment_bank_evidence',
      'payment_assistance_submission',
      'table_transfer_history',
    ])
      if (values(records, table).length) fail('UNRESOLVED_DEPENDENCY:' + table);
    if (values(records, 'support_request_handoff').some((r) => r.status === 'PENDING'))
      fail('SUPPORT_HANDOFF_PENDING');
    if (values(records, 'outbox_event').some((r) => r.status !== 'PUBLISHED'))
      fail('OUTBOX_WORK_REMAINS');
    if (values(records, 'inventory_reservation').some((r) => r.status === 'RESERVED'))
      fail('STOCK_WORK_REMAINS');
    if (
      values(records, 'order_review').some(
        (r) => !['APPROVED', 'REJECTED', 'EXPIRED'].includes(String(r.status)),
      )
    )
      fail('ORDER_REVIEW_REMAINS');
    const sums = (
      await c.query(
        "SELECT COALESCE(sum(amount-discount_amount),0)::text AS total FROM financial_charge WHERE session_id=$1 AND status='ACTIVE'",
        [v.sessionId],
      )
    ).rows[0];
    if (
      sums.total !== String(account[0]!.charge_total) ||
      sums.total !== String(account[0]!.outstanding_amount)
    )
      fail(v.table + ':LEDGER_ACCOUNT_DIFFERS');
    if (values(records, 'cart_item').length) fail('CART_NOT_EMPTY');
    if (
      own('order_batch').some(
        (r) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(String(r.status)),
      ) ||
      values(records, 'order_item').some(
        (r) => !['SERVED', 'CANCELLED', 'REJECTED', 'UNAVAILABLE'].includes(String(r.status)),
      )
    )
      fail('ORDER_WORK_REMAINS');
    if (
      own('promotion_request').some(
        (r) => !['APPROVED', 'REJECTED', 'CANCELLED'].includes(String(r.status)),
      )
    )
      fail('PROMOTION_REVIEW_REMAINS');
    const pendingSupport = own('support_request').filter((r) =>
      ['NEW', 'ACKNOWLEDGED'].includes(String(r.status)),
    );
    if (
      pendingSupport.length > 10 ||
      pendingSupport.some((r) => !['BILL', 'ACCESS_CODE'].includes(String(r.request_type)))
    )
      fail(v.table + ':REAL_SUPPORT_WORK');
    v.supportIds = pendingSupport.map((r) => String(r.id));
    const outstanding = own('outstanding_balance_case');
    if (
      outstanding.length !== profile.cases ||
      outstanding.some(
        (r) =>
          r.status !== 'PENDING_ADMIN_REVIEW' ||
          String(r.paid_total) !== '0' ||
          String(r.outstanding_amount) !== String(account[0]!.outstanding_amount) ||
          String(r.invoice_total) !== String(account[0]!.charge_total),
      )
    )
      fail(v.table + ':OUTSTANDING_CASE');
    v.voidedCaseId = outstanding.length ? String(outstanding[0]!.id) : null;
    const archived = values(records, 'payos_test_case_archive').find((r) => r.id === v.archiveId)!;
    const shortfall = own('operational_alert').filter(
      (r) => r.id !== archived.alert_id && r.status !== 'RESOLVED',
    );
    if (
      shortfall.length !== profile.cases ||
      shortfall.some(
        (r) =>
          r.alert_type !== 'PAYMENT_SHORTFALL' ||
          String(r.outstanding_amount) !== String(account[0]!.outstanding_amount),
      )
    )
      fail(v.table + ':OTHER_ALERTS');
    v.shortfallAlertIds = shortfall.map((r) => String(r.id));
    v.activeParticipantIds = own('session_participant')
      .filter((r) => r.status !== 'LEFT')
      .map((r) => String(r.id));
    const readiness = await closeReadiness(c, v.sessionId, account[0]!);
    v.blockerCounts = readiness.blockers.map((r) => ({ code: r.code, count: r.count }));
    const allowed = new Set([
      'UNPAID',
      'PAYMENT_REQUIRES_RECONCILIATION',
      'ALERT_OTHER',
      'ALERT_PAYMENT_SHORTFALL',
      'OUTSTANDING_CASE',
      'SUPPORT_BILL_NEW',
      'SUPPORT_BILL_ACKNOWLEDGED',
      'SUPPORT_ACCESS_CODE_NEW',
      'SUPPORT_ACCESS_CODE_ACKNOWLEDGED',
    ]);
    if (v.blockerCounts.some((b) => !allowed.has(b.code)))
      fail(v.table + ':UNREVIEWED_CLOSE_BLOCKER');
  }
  const snapshotHash = archiveHash({ records, foreignKeys, databaseIdentity, migrationReady });
  const body = {
    format: 'payos-test-session-retirement-v1' as const,
    restaurantId,
    databaseIdentity,
    foreignKeys,
    migrationReady,
    records,
    cases,
    snapshotHash,
  };
  return { ...body, planHash: archiveHash(body) };
}

export async function applyRetirement(
  c: Connection,
  plan: RetirementPlan,
  confirmation: {
    operatorId: string;
    reason: string;
    bundleHash: string;
    backupHash: string;
    noActiveGuests: boolean;
    realFundsAcknowledged: boolean;
  },
) {
  validateRetirementPlan(plan, plan.planHash);
  archiveUuid(confirmation.operatorId);
  if (
    !confirmation.noActiveGuests ||
    !confirmation.realFundsAcknowledged ||
    confirmation.reason.trim().length < 20 ||
    confirmation.reason.length > 1000 ||
    !/^[a-f0-9]{64}$/.test(confirmation.bundleHash) ||
    !/^[a-f0-9]{64}$/.test(confirmation.backupHash)
  )
    fail('EXPLICIT_CONFIRMATIONS');
  await c.query("SET LOCAL lock_timeout='5s'");
  await c.query("SET LOCAL statement_timeout='45s'");
  const ids = retirementProfiles.map((v) => v.session);
  await c.query(
    'SELECT id FROM table_session WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE NOWAIT',
    [ids],
  );
  await c.query(
    'SELECT id FROM dining_table WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE NOWAIT',
    [plan.cases.map((v) => v.tableId)],
  );
  const admin = await c.query(
    `SELECT u.id FROM app_user u WHERE u.id=$1 AND u.restaurant_id=$2 AND u.status='ACTIVE'
    AND EXISTS(SELECT 1 FROM user_role ur JOIN role r ON r.id=ur.role_id WHERE ur.user_id=u.id AND ur.revoked_at IS NULL AND r.code='ADMIN') FOR SHARE`,
    [confirmation.operatorId, plan.restaurantId],
  );
  if (admin.rowCount !== 1) fail('ACTIVE_TENANT_ADMIN_REQUIRED');
  if (!plan.migrationReady) fail('MIGRATION_41_REQUIRED_REPLAN');
  const existing = (
    await c.query(
      'SELECT * FROM payos_test_session_retirement WHERE session_id=ANY($1::uuid[]) ORDER BY session_id',
      [ids],
    )
  ).rows;
  if (existing.length) {
    if (
      existing.length !== 2 ||
      existing.some(
        (r) =>
          r.restaurant_id !== plan.restaurantId ||
          r.plan_hash !== plan.planHash ||
          r.bundle_hash !== confirmation.bundleHash ||
          r.backup_manifest_hash !== confirmation.backupHash ||
          r.retired_by !== confirmation.operatorId ||
          r.reason !== confirmation.reason,
      )
    )
      fail('EXISTING_RETIREMENT_DIFFERS');
    const closed = await c.query(
      "SELECT id FROM table_session WHERE id=ANY($1::uuid[]) AND session_status='CLOSED' AND close_reason='ARCHIVED_TEST_RETIRED'",
      [ids],
    );
    if (closed.rowCount !== 2) fail('INCOMPLETE_RETIREMENT');
    return { alreadyProcessed: true, retired: 2 };
  }
  for (const table of Object.keys(plan.records).sort()) {
    const ids = plan.records[table]!.map((v) => v.row.id);
    if (
      ids.length &&
      ![
        'business_audit_event',
        'payos_test_archive_event',
        'table_session',
        'dining_table',
      ].includes(table)
    )
      await c.query(
        'SELECT r.* FROM ' +
          identifier(table) +
          ' r WHERE to_jsonb(r)=ANY($1::jsonb[]) ORDER BY COALESCE(to_jsonb(r)->>$$id$$,to_jsonb(r)::text) FOR UPDATE NOWAIT',
        [plan.records[table]!.map((v) => v.exact)],
      );
  }
  const current = await inspectRetirement(c, plan.restaurantId);
  if (current.planHash !== plan.planHash) fail('DATABASE_PREIMAGE_DRIFT');
  for (const v of plan.cases) {
    const marker = (
      await c.query(
        `INSERT INTO payos_test_session_retirement(restaurant_id,session_id,archive_id,table_id,voided_case_id,financial_snapshot,before_snapshot_hash,plan_hash,bundle_hash,backup_manifest_hash,retired_by,reason)
      SELECT $1,$2,$3,$4,$5,to_jsonb(f),$6,$7,$8,$9,$10,$11 FROM session_financial_account f WHERE f.session_id=$2 RETURNING *`,
        [
          plan.restaurantId,
          v.sessionId,
          v.archiveId,
          v.tableId,
          v.voidedCaseId,
          plan.snapshotHash,
          plan.planHash,
          confirmation.bundleHash,
          confirmation.backupHash,
          confirmation.operatorId,
          confirmation.reason,
        ],
      )
    ).rows[0];
    if (!marker) fail('MISSING_ACCOUNT');
    if (v.voidedCaseId)
      await c.query(
        `UPDATE outstanding_balance_case SET status='CANCELLED',admin_owner=$2,notes=COALESCE(notes,'')||E'\n'||$3 WHERE id=$1`,
        [
          v.voidedCaseId,
          confirmation.operatorId,
          'Hủy báo cáo thử nhầm; không xóa nợ hoặc ghi nhận tổn thất. ' + confirmation.reason,
        ],
      );
    if (v.shortfallAlertIds.length)
      await c.query(
        `UPDATE operational_alert SET status='RESOLVED',resolved_at=$2,resolved_by=$3,resolution_note=$4 WHERE id=ANY($1::uuid[])`,
        [
          v.shortfallAlertIds,
          marker.retired_at,
          confirmation.operatorId,
          'Kết thúc cảnh báo từ báo cáo thử nhầm; tiền và công nợ giữ nguyên. ' +
            confirmation.reason,
        ],
      );
    if (v.supportIds.length)
      await c.query(
        "UPDATE support_request SET status='CANCELLED',resolved_at=$2,resolved_by=$3 WHERE id=ANY($1::uuid[])",
        [v.supportIds, marker.retired_at, confirmation.operatorId],
      );
    await c.query(
      "UPDATE session_participant SET status='LEFT' WHERE session_id=$1 AND status<>'LEFT'",
      [v.sessionId],
    );
    await c.query(
      "UPDATE table_session s SET session_status='CLOSED',close_reason='ARCHIVED_TEST_RETIRED',closed_at=r.retired_at,closed_by=$2,version=s.version+1 FROM payos_test_session_retirement r WHERE s.id=$1 AND r.session_id=s.id",
      [v.sessionId, confirmation.operatorId],
    );
    await c.query(
      "UPDATE dining_table SET table_status='NEEDS_CLEANING',version=version+1 WHERE id=$1",
      [v.tableId],
    );
    await c.query(
      `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details)
      VALUES($1,$2,'RETIRE_ARCHIVED_TEST_SESSION','TABLE_SESSION',$3,$4,$5)`,
      [
        plan.restaurantId,
        confirmation.operatorId,
        v.sessionId,
        confirmation.reason,
        JSON.stringify({
          retirementId: marker.id,
          archiveId: v.archiveId,
          planHash: plan.planHash,
          financialBefore: v.financial,
          financialAfter: v.financial,
          realFundsUnsettled: '5000',
          voidedTestReportId: v.voidedCaseId,
          cancelledSupportIds: v.supportIds,
          resolvedTestAlertIds: v.shortfallAlertIds,
          leftParticipantIds: v.activeParticipantIds,
          noActiveGuestsAttested: true,
          settled: false,
          writtenOff: false,
          refunded: false,
        }),
      ],
    );
  }
  const mutable = new Set([
    'table_session',
    'dining_table',
    'session_participant',
    'support_request',
    'outstanding_balance_case',
    'operational_alert',
    'business_audit_event',
  ]);
  for (const [table, rows] of Object.entries(plan.records)) {
    if (mutable.has(table) || !rows.length) continue;
    const after = await capture(c, table, 'to_jsonb(r)=ANY($1::jsonb[])', [
      rows.map((v) => v.exact),
    ]);
    if (archiveHash(after) !== archiveHash(rows)) fail('PROTECTED_POSTIMAGE_CHANGED:' + table);
  }
  // Archive alerts are among operational_alert but must remain byte-for-byte fixed.
  const frozen = plan.records.operational_alert!.filter((r) =>
    plan.cases.some((v) =>
      plan.records.payos_test_case_archive!.some(
        (a) => a.row.id === v.archiveId && a.row.alert_id === r.row.id,
      ),
    ),
  );
  if (
    archiveHash(
      await capture(c, 'operational_alert', 'r.id=ANY($1::uuid[])', [frozen.map((r) => r.row.id)]),
    ) !== archiveHash(frozen)
  )
    fail('ARCHIVE_ALERT_CHANGED');
  return { alreadyProcessed: false, retired: 2 };
}
