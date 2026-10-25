import type { Connection } from '../apps/api/src/modules/shared/core-persistence.js';
import {
  archiveHash,
  appendArchiveEvidence,
} from '../apps/api/src/modules/payments/test-case-archive.service.js';
import { lockBankReferences } from '../apps/api/src/modules/payments/bank-receipt-posting.js';

export const archiveProfiles = [
  { table: 'A01', prefix: 'ffc78214', amount: '5000', auditCount: 8789, proofCount: 1 },
  { table: 'A02', prefix: '300659c7', amount: '5000', auditCount: 10284, proofCount: 0 },
] as const;
export type ArchiveRow = Record<string, unknown>;
export type ArchiveProof = { name: string; sha256: string; mime: string };
export type ArchiveCase = {
  tableCode: string;
  sessionId: string;
  tableId: string;
  intentId: string;
  payosId: string;
  webhookId: string;
  alertId: string;
  orderCode: string;
  linkId: string;
  bankReference: string;
  amount: string;
  auditCount: number;
  rows: Record<string, ArchiveRow[]>;
  auditStatistics: ArchiveRow[];
  proofs: ArchiveProof[];
};
export type ArchivePlan = {
  format: 'payos-test-case-archive-plan-v1';
  action: 'ARCHIVE' | 'RESTORE_VISIBILITY';
  restaurantId: string;
  databaseIdentity: ArchiveRow;
  foreignKeys: ArchiveRow[];
  cases: ArchiveCase[];
  archives: ArchiveRow[];
  archiveEvents: ArchiveRow[];
  snapshotHash: string;
  planHash: string;
};
const allowedChildren = new Set([
  'bank_receipt_claim',
  'idempotency_record',
  'outbox_event',
  'payment_allocation',
  'payment_bank_evidence',
  'payment_bank_preview',
  'payment_bank_proof',
  'payment_transaction',
  'payment_webhook_event',
  'payos_payment_request',
  'refund_case',
  'payos_test_case_archive',
  'payos_test_archive_event',
]);
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function archiveUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw Error('ARCHIVE_INVALID_FULL_UUID');
  return value;
}
function fail(field: string): never {
  throw Error('ARCHIVE_SCOPE_MISMATCH:' + field);
}
const identifier = (v: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(v)) throw Error('ARCHIVE_UNSUPPORTED_SCHEMA');
  return '"' + v + '"';
};
async function rows(c: Connection, table: string, where: string, values: unknown[]) {
  return (
    await c.query(
      `SELECT to_jsonb(r) AS row,to_jsonb(r)::text AS exact_json FROM ${identifier(table)} r WHERE ${where} ORDER BY r.id`,
      values,
    )
  ).rows.map((r) => ({ ...r.row, __archive_exact_json: r.exact_json }) as ArchiveRow);
}
function addRows(target: Record<string, ArchiveRow[]>, table: string, values: ArchiveRow[]) {
  const combined = new Map((target[table] ?? []).map((r) => [String(r.id), r]));
  for (const row of values) combined.set(archiveUuid(row.id), row);
  target[table] = [...combined.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
const excludedAudit = "action NOT IN ('PAYOS_TEST_CASE_ARCHIVED','PAYOS_TEST_VISIBILITY_RESTORED')";

/** Caller owns a READ ONLY repeatable-read transaction, or session locks for apply. */
export async function inspectPayosTestCases(
  c: Connection,
  restaurantId: string,
  lock = false,
  restore = false,
): Promise<ArchivePlan> {
  archiveUuid(restaurantId);
  await c.query("SET LOCAL TIME ZONE 'UTC'");
  const databaseIdentity = (
    await c.query(`SELECT current_database() AS database,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
    inet_server_addr()::text AS server_address,inet_server_port() AS server_port`)
  ).rows[0];
  const heads = [];
  for (const profile of archiveProfiles) {
    const matches = (
      await c.query(
        `SELECT s.id AS session_id,t.id AS table_id,p.id AS intent_id,q.id AS payos_id
      FROM dining_table t JOIN table_session s ON s.table_id=t.id
      JOIN payment_intent p ON p.session_id=s.id JOIN payos_payment_request q ON q.payment_intent_id=p.id
      WHERE t.restaurant_id=$1 AND t.code=$2 AND left(s.id::text,8)=$3`,
        [restaurantId, profile.table, profile.prefix],
      )
    ).rows;
    if (matches.length !== 1) fail(profile.table + ':EXACTLY_ONE_INTENT_REQUIRED');
    for (const key of ['session_id', 'table_id', 'intent_id', 'payos_id'])
      archiveUuid(matches[0][key]);
    heads.push(matches[0]);
  }
  if (lock) {
    await c.query('SELECT id FROM table_session WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      heads.map((h) => h.session_id),
    ]);
    await c.query('SELECT id FROM payment_intent WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      heads.map((h) => h.intent_id),
    ]);
    await c.query(
      'SELECT id FROM payos_payment_request WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [heads.map((h) => h.payos_id)],
    );
  }
  const foreignKeys = (
    await c.query(
      `SELECT child.relname AS child,parent.relname AS parent,
    (SELECT array_agg(a.attname::text ORDER BY x.n) FROM unnest(f.conkey) WITH ORDINALITY x(attnum,n)
      JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=x.attnum) AS columns,
    (SELECT array_agg(a.attname::text ORDER BY x.n) FROM unnest(f.confkey) WITH ORDINALITY x(attnum,n)
      JOIN pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=x.attnum) AS parent_columns,
    pg_get_constraintdef(f.oid) AS definition
    FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_class parent ON parent.oid=f.confrelid
    JOIN pg_namespace n ON n.oid=child.relnamespace WHERE f.contype='f' AND n.nspname='public'
    AND parent.relname=ANY($1::text[]) ORDER BY child.relname,pg_get_constraintdef(f.oid)`,
      [
        [
          'payment_intent',
          'payos_payment_request',
          'payment_transaction',
          'payment_webhook_event',
          'operational_alert',
          'payment_bank_proof',
          'payment_bank_preview',
          'bank_receipt_claim',
          'idempotency_record',
        ],
      ],
    )
  ).rows as ArchiveRow[];
  const cases: ArchiveCase[] = [];
  for (const [i, profile] of archiveProfiles.entries()) {
    const h = heads[i],
      data: Record<string, ArchiveRow[]> = {};
    data.payment_intent = await rows(c, 'payment_intent', 'r.id=$1', [h.intent_id]);
    data.payos_payment_request = await rows(c, 'payos_payment_request', 'r.id=$1', [h.payos_id]);
    const p = data.payment_intent[0],
      q = data.payos_payment_request[0];
    if (!p || !q) fail(profile.table + ':MISSING_ROWS');
    if (
      p.provider !== 'PAYOS' ||
      p.method !== 'ONLINE' ||
      String(p.amount) !== '5000' ||
      p.currency !== 'VND' ||
      p.status !== 'REQUIRES_RECONCILIATION'
    )
      fail(profile.table + ':INTENT');
    if (
      q.provider_status !== 'PAID' ||
      q.reconciliation_status !== 'OPEN' ||
      String(q.paid_amount) !== '5000' ||
      q.status !== 'REQUIRES_RECONCILIATION'
    )
      fail(profile.table + ':PROVIDER_STATE');
    if (q.lease_until && Date.parse(String(q.lease_until)) > Date.now())
      fail(profile.table + ':ACTIVE_WORKER_LEASE');
    if (!q.payment_link_id || !q.alert_id) fail(profile.table + ':MISSING_IDENTITY');
    const alertId = archiveUuid(q.alert_id);
    data.operational_alert = await rows(c, 'operational_alert', 'r.id=$1', [alertId]);
    const alert = data.operational_alert[0];
    if (
      !alert ||
      data.operational_alert.length !== 1 ||
      alert.session_id !== h.session_id ||
      alert.table_id !== h.table_id ||
      alert.status === 'RESOLVED'
    )
      fail(profile.table + ':ALERT');
    data.payment_webhook_event = await rows(
      c,
      'payment_webhook_event',
      "r.provider='PAYOS' AND r.payload_snapshot->>'orderCode'=$1",
      [String(q.order_code)],
    );
    if (data.payment_webhook_event.length !== 1) fail(profile.table + ':WEBHOOK_COUNT');
    const w = data.payment_webhook_event[0];
    if (!w) fail(profile.table + ':MISSING_WEBHOOK');
    const payload = w.payload_snapshot as ArchiveRow;
    if (
      !w.signature_valid ||
      w.payment_transaction_id !== null ||
      payload.restaurantId !== restaurantId ||
      payload.paymentLinkId !== q.payment_link_id ||
      String(payload.amount) !== '5000' ||
      payload.currency !== 'VND' ||
      payload.code !== '00' ||
      payload.reference !== w.provider_event_id
    )
      fail(profile.table + ':WEBHOOK_IDENTITY');
    const reference = String(w.provider_event_id);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(reference))
      fail(profile.table + ':BANK_REFERENCE');
    data.idempotency_record = await rows(c, 'idempotency_record', 'r.payment_intent_id=$1', [
      h.intent_id,
    ]);
    data.payment_transaction = await rows(c, 'payment_transaction', 'r.payment_intent_id=$1', [
      h.intent_id,
    ]);
    data.payment_bank_proof = await rows(c, 'payment_bank_proof', 'r.payment_intent_id=$1', [
      h.intent_id,
    ]);
    // Walk every real FK inbound to the payment roots; reject unreviewed nonempty dependencies.
    for (let pass = 0; pass < 3; pass++)
      for (const fk of foreignKeys) {
        const child = String(fk.child),
          parent = String(fk.parent),
          columns = fk.columns as string[],
          parentColumns = fk.parent_columns as string[];
        if (['payos_test_case_archive', 'payos_test_archive_event'].includes(child)) continue;
        if (columns.length !== 1 || parentColumns.join(',') !== 'id')
          throw Error('ARCHIVE_UNSUPPORTED_FOREIGN_KEY');
        const ids = (data[parent] ?? []).map((r) => r.id);
        if (!ids.length) continue;
        const found = await rows(c, child, `r.${identifier(columns[0]!)}=ANY($1::uuid[])`, [ids]);
        if (found.length && !allowedChildren.has(child))
          throw Error('ARCHIVE_UNREVIEWED_FOREIGN_KEY:' + child);
        addRows(data, child, found);
      }
    if (data.idempotency_record.length !== 1 || data.payos_payment_request.length !== 1)
      fail(profile.table + ':IDEMPOTENCY_COUNT');
    for (const table of [
      'payment_transaction',
      'payment_allocation',
      'refund_case',
      'bank_receipt_claim',
      'payment_bank_preview',
      'payment_bank_evidence',
      'outbox_event',
    ])
      if ((data[table] ?? []).length) fail(profile.table + ':UNEXPECTED_' + table);
    const outbox = await rows(
      c,
      'outbox_event',
      "r.payload->>'paymentIntentId'=$1 OR r.payload->>'intentId'=$1 OR r.payload->>'payosRequestId'=$2",
      [h.intent_id, h.payos_id],
    );
    if (outbox.length) fail(profile.table + ':UNREVIEWED_OUTBOX');
    const shared = (
      await c.query(
        `SELECT count(*)::int AS n FROM payment_transaction p WHERE
      (p.provider='PAYOS' AND p.provider_transaction_id=$1) OR
      (p.method='BANK_TRANSFER' AND p.metadata->>'reference'=$1 AND core_tenant('table_session',p.session_id)=$2)`,
        [reference, restaurantId],
      )
    ).rows[0];
    if (shared.n !== 0) fail(profile.table + ':BANK_REFERENCE_ALREADY_POSTED');
    data.business_audit_event = await rows(
      c,
      'business_audit_event',
      `r.restaurant_id=$1 AND r.resource_id=$2 AND ${excludedAudit}`,
      [restaurantId, h.intent_id],
    );
    if (data.business_audit_event.length !== profile.auditCount)
      fail(profile.table + ':AUDIT_COUNT');
    // Retain related resource audits too, without treating them as the expected intent count.
    data.related_business_audit_event = await rows(
      c,
      'business_audit_event',
      'r.restaurant_id=$1 AND r.resource_id=ANY($2::uuid[])',
      [restaurantId, [h.payos_id, w.id, alertId, ...data.payment_bank_proof.map((r) => r.id)]],
    );
    data.session_financial_account = await rows(c, 'session_financial_account', 'r.session_id=$1', [
      h.session_id,
    ]);
    data.financial_charge = await rows(c, 'financial_charge', 'r.session_id=$1', [h.session_id]);
    // Minimal context, no guest credential, QR token, account password or app secret.
    data.session_context = (
      await c.query(
        'SELECT to_jsonb(v) AS row,to_jsonb(v)::text AS exact_json FROM (SELECT id,table_id,session_status,opened_at,closed_at,receipt_number FROM table_session WHERE id=$1) v',
        [h.session_id],
      )
    ).rows.map((r) => ({ ...r.row, __archive_exact_json: r.exact_json }));
    const proofs: ArchiveProof[] = data.payment_bank_proof.map((r) => ({
      name: String(r.filename),
      sha256: String(r.sha256),
      mime: String(r.mime),
    }));
    if (p.proof !== null) {
      const v = p.proof as ArchiveRow;
      if (!v || typeof v !== 'object') fail(profile.table + ':PROOF');
      proofs.push({ name: String(v.name), sha256: String(v.sha256), mime: String(v.mime) });
    }
    if (
      proofs.length !== profile.proofCount ||
      new Set(proofs.map((v) => v.name)).size !== proofs.length
    )
      fail(profile.table + ':PROOF_COUNT');
    const auditStatistics = (
      await c.query(
        `SELECT action,count(*)::text AS events,min(created_at)::text AS first_at,max(created_at)::text AS last_at,
      count(DISTINCT details)::text AS distinct_fact_snapshots FROM business_audit_event
      WHERE restaurant_id=$1 AND resource_id=$2 AND ${excludedAudit} GROUP BY action ORDER BY action`,
        [restaurantId, h.intent_id],
      )
    ).rows;
    cases.push({
      tableCode: profile.table,
      sessionId: h.session_id,
      tableId: h.table_id,
      intentId: h.intent_id,
      payosId: h.payos_id,
      webhookId: archiveUuid(w.id),
      alertId,
      orderCode: String(q.order_code),
      linkId: String(q.payment_link_id),
      bankReference: reference,
      amount: '5000',
      auditCount: profile.auditCount,
      rows: data,
      auditStatistics,
      proofs,
    });
  }
  const archives = await rows(c, 'payos_test_case_archive', 'r.payment_intent_id=ANY($1::uuid[])', [
    heads.map((h) => h.intent_id),
  ]);
  const archiveEvents = await rows(c, 'payos_test_archive_event', 'r.archive_id=ANY($1::uuid[])', [
    archives.map((a) => a.id),
  ]);
  if (restore && archives.length !== 2) fail('RESTORE_REQUIRES_BOTH_ARCHIVES');
  const value = {
    format: 'payos-test-case-archive-plan-v1' as const,
    action: restore ? ('RESTORE_VISIBILITY' as const) : ('ARCHIVE' as const),
    restaurantId,
    databaseIdentity,
    foreignKeys,
    cases,
    archives,
    archiveEvents,
    snapshotHash: archiveHash(cases),
  };
  return { ...value, planHash: archiveHash(value) };
}

export function validateArchivePlan(plan: ArchivePlan, confirmation: string) {
  archiveUuid(plan.restaurantId);
  const { planHash, ...body } = plan;
  if (
    plan.format !== 'payos-test-case-archive-plan-v1' ||
    !['ARCHIVE', 'RESTORE_VISIBILITY'].includes(plan.action) ||
    !/^[a-f0-9]{64}$/.test(planHash) ||
    confirmation !== planHash ||
    archiveHash(body) !== planHash ||
    archiveHash(plan.cases) !== plan.snapshotHash ||
    plan.cases.length !== 2
  )
    throw Error('ARCHIVE_PLAN_CHECKSUM_MISMATCH');
  for (const [i, profile] of archiveProfiles.entries()) {
    const v = plan.cases[i];
    if (!v) fail('PLAN_PROFILE');
    if (
      v.tableCode !== profile.table ||
      !archiveUuid(v.sessionId).startsWith(profile.prefix) ||
      v.amount !== '5000' ||
      v.auditCount !== profile.auditCount
    )
      fail('PLAN_PROFILE');
    for (const id of [v.tableId, v.intentId, v.payosId, v.webhookId, v.alertId]) archiveUuid(id);
  }
}

/** No file writes or provider/allocator calls; caller validates durable archive/backup before beginning. */
export async function applyPayosTestArchive(
  c: Connection,
  plan: ArchivePlan,
  input: { operatorId: string; reason: string; bundleHash: string; backupHash: string },
) {
  validateArchivePlan(plan, plan.planHash);
  archiveUuid(input.operatorId);
  if (
    input.reason.trim().length < 20 ||
    input.reason.length > 1000 ||
    !(/^[a-f0-9]{64}$/.test(input.bundleHash) && /^[a-f0-9]{64}$/.test(input.backupHash))
  )
    throw Error('ARCHIVE_INVALID_CONFIRMATION');
  await c.query("SET LOCAL lock_timeout='3s'");
  await c.query("SET LOCAL statement_timeout='30s'");
  const current = await inspectPayosTestCases(
    c,
    plan.restaurantId,
    true,
    plan.action === 'RESTORE_VISIBILITY',
  );
  if (
    archiveHash(current.databaseIdentity) !== archiveHash(plan.databaseIdentity) ||
    archiveHash(current.foreignKeys) !== archiveHash(plan.foreignKeys) ||
    current.snapshotHash !== plan.snapshotHash
  )
    throw Error('ARCHIVE_DATABASE_DRIFT');
  await lockBankReferences(
    c,
    plan.cases.map((v) => ({ restaurantId: plan.restaurantId, reference: v.bankReference })),
  );
  const admin = await c.query(
    `SELECT u.id FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id
    WHERE u.id=$1 AND u.restaurant_id=$2 AND u.status='ACTIVE' AND r.code='ADMIN' FOR SHARE OF u,ur`,
    [input.operatorId, plan.restaurantId],
  );
  if (!admin.rowCount) throw Error('ARCHIVE_ADMIN_REQUIRED');
  if (plan.action === 'ARCHIVE' && current.archives.length) {
    if (
      current.archives.length !== 2 ||
      current.archives.some(
        (a) =>
          a.plan_hash !== plan.planHash ||
          a.bundle_hash !== input.bundleHash ||
          a.backup_manifest_hash !== input.backupHash ||
          a.visible_in_operations,
      )
    )
      throw Error('ARCHIVE_ALREADY_EXISTS_DIFFERENT_PLAN');
    return { alreadyProcessed: true, archived: 2 };
  }
  if (
    plan.action === 'RESTORE_VISIBILITY' &&
    (archiveHash(current.archives) !== archiveHash(plan.archives) ||
      archiveHash(current.archiveEvents) !== archiveHash(plan.archiveEvents))
  )
    throw Error('ARCHIVE_VISIBILITY_DRIFT');
  for (const v of plan.cases) {
    let id: string;
    if (plan.action === 'ARCHIVE') {
      const r = await c.query(
        `INSERT INTO payos_test_case_archive(restaurant_id,session_id,table_id,table_code,payment_intent_id,payos_request_id,webhook_id,alert_id,
        order_code,payment_link_id,bank_reference,amount,original_audit_count,plan_hash,snapshot_hash,bundle_hash,backup_manifest_hash,reason,archived_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,5000,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          plan.restaurantId,
          v.sessionId,
          v.tableId,
          v.tableCode,
          v.intentId,
          v.payosId,
          v.webhookId,
          v.alertId,
          v.orderCode,
          v.linkId,
          v.bankReference,
          v.auditCount,
          plan.planHash,
          plan.snapshotHash,
          input.bundleHash,
          input.backupHash,
          input.reason,
          input.operatorId,
        ],
      );
      id = r.rows[0].id;
    } else {
      const archive = current.archives.find((a) => a.payment_intent_id === v.intentId)!;
      if (archive.visible_in_operations) throw Error('ARCHIVE_VISIBILITY_ALREADY_RESTORED');
      id = String(archive.id);
      await c.query(
        `UPDATE payos_test_case_archive SET visible_in_operations=true,visibility_restored_by=$2,
        visibility_restored_at=clock_timestamp(),visibility_restore_reason=$3 WHERE id=$1`,
        [id, input.operatorId, input.reason],
      );
    }
    const action =
      plan.action === 'ARCHIVE' ? 'PAYOS_TEST_CASE_ARCHIVED' : 'PAYOS_TEST_VISIBILITY_RESTORED';
    await c.query(
      `INSERT INTO business_audit_event(restaurant_id,actor_id,actor_type,action,resource_type,resource_id,reason,details)
      VALUES($1,$2,'USER',$3,'PAYMENT_INTENT',$4,$5,$6)`,
      [
        plan.restaurantId,
        input.operatorId,
        action,
        v.intentId,
        input.reason,
        JSON.stringify({
          archiveId: id,
          planHash: plan.planHash,
          snapshotHash: plan.snapshotHash,
          bundleHash: input.bundleHash,
          backupManifestHash: input.backupHash,
          financiallyResolved: false,
          postingBlocked: true,
        }),
      ],
    );
    await appendArchiveEvidence(
      c,
      id,
      plan.action === 'ARCHIVE' ? 'ARCHIVED' : 'VISIBILITY_RESTORED',
      {
        operatorId: input.operatorId,
        planHash: plan.planHash,
        reason: input.reason,
        financiallyResolved: false,
        postingBlocked: true,
      },
    );
  }
  return { alreadyProcessed: false, archived: 2 };
}
