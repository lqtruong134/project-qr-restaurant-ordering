import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Planning only: no provider SDK, reset executor, environment-file loader or
// payment server is imported. Every database operation is inside READ ONLY.
export function parseResetPlanArgs(args) {
  if (
    args.length !== 3 ||
    args[0] !== '--dry-run' ||
    args[1] !== '--target-label' ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(args[2] ?? '')
  )
    throw Error('INVALID_DRY_RUN_ARGUMENTS');
  return { targetLabel: args[2] };
}
const inventorySql = `
WITH scoped_sessions AS (
  SELECT s.id FROM table_session s JOIN dining_table t ON t.id=s.table_id
  WHERE t.restaurant_id=$1
), intent_flags AS (
  SELECT p.id,
    (p.provider='PAYOS' OR p.method='ONLINE' OR p.provider_reference IS NOT NULL
      OR EXISTS(SELECT 1 FROM payos_payment_request q WHERE q.payment_intent_id=p.id)
      OR EXISTS(SELECT 1 FROM payment_transaction t
        WHERE t.payment_intent_id=p.id AND t.provider='PAYOS')) AS payos_or_external_attempt,
    EXISTS(SELECT 1 FROM payment_transaction t WHERE t.payment_intent_id=p.id) AS has_receipt
  FROM payment_intent p JOIN scoped_sessions s ON s.id=p.session_id
)
SELECT count(*)::text AS total_intents,
  count(*) FILTER(WHERE payos_or_external_attempt)::text AS protected_payos_unknown_intents,
  count(*) FILTER(WHERE NOT COALESCE(payos_or_external_attempt,false) AND has_receipt)::text
    AS protected_financial_record_intents,
  count(*) FILTER(WHERE NOT COALESCE(payos_or_external_attempt,false) AND NOT has_receipt)::text
    AS unknown_retain_intents,
  (SELECT count(*)::text FROM payos_payment_request q JOIN intent_flags p ON p.id=q.payment_intent_id)
    AS payos_requests,
  (SELECT count(*)::text FROM payos_payment_request q JOIN intent_flags p ON p.id=q.payment_intent_id
    WHERE q.reconciliation_status='OPEN') AS open_payos_reconciliations,
  (SELECT count(*)::text FROM payos_payment_request q JOIN intent_flags p ON p.id=q.payment_intent_id
    WHERE q.paid_amount>COALESCE((SELECT sum(t.amount) FROM payment_transaction t
      WHERE t.payment_intent_id=p.id AND t.provider='PAYOS' AND t.status='SUCCEEDED'),0))
    AS bank_reported_without_ledger_intents
FROM intent_flags`;
const financeSql = `
WITH scoped_sessions AS (
  SELECT s.id,s.session_status,s.receipt_number FROM table_session s JOIN dining_table t ON t.id=s.table_id
  WHERE t.restaurant_id=$1
), receipts AS (
  SELECT t.id,t.provider,t.status FROM payment_transaction t JOIN scoped_sessions s ON s.id=t.session_id
), refunds AS (
  SELECT r.id FROM refund_case r JOIN scoped_sessions s ON s.id=r.session_id
)
SELECT count(*)::text AS sessions,
  count(*) FILTER(WHERE session_status NOT IN ('CLOSED','CANCELLED'))::text AS unclosed_sessions,
  count(*) FILTER(WHERE receipt_number IS NOT NULL)::text AS closed_receipts,
  (SELECT count(*)::text FROM order_batch b JOIN scoped_sessions s ON s.id=b.session_id)
    AS order_batches,
  (SELECT count(*)::text FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id
    JOIN scoped_sessions s ON s.id=b.session_id) AS order_items,
  (SELECT count(*)::text FROM payment_intent p JOIN scoped_sessions s ON s.id=p.session_id
    WHERE p.proof IS NOT NULL AND p.proof <> 'null'::jsonb) AS proof_records,
  (SELECT count(*)::text FROM payment_bank_proof p WHERE p.restaurant_id=$1)
    AS admin_bank_proof_records,
  (SELECT count(*)::text FROM payment_bank_preview p WHERE p.restaurant_id=$1)
    AS bank_preview_records,
  (SELECT count(*)::text FROM payment_bank_evidence e WHERE e.restaurant_id=$1)
    AS bank_evidence_records,
  (SELECT count(*)::text FROM bank_receipt_claim c WHERE c.restaurant_id=$1)
    AS bank_receipt_claims,
  (SELECT count(*)::text FROM operational_alert a JOIN dining_table t ON t.id=a.table_id
    WHERE t.restaurant_id=$1) AS operational_alerts,
  (SELECT count(*)::text FROM session_financial_account a
    JOIN scoped_sessions s ON s.id=a.session_id) AS financial_accounts,
  (SELECT count(*)::text FROM receipts) AS receipt_rows,
  (SELECT count(*)::text FROM receipts WHERE provider='PAYOS') AS payos_receipt_rows,
  (SELECT count(*)::text FROM receipts WHERE provider='PAYOS' AND status='SUCCEEDED')
    AS recorded_payos_receipt_rows,
  (SELECT count(*)::text FROM payment_allocation a JOIN receipts t ON t.id=a.payment_transaction_id)
    AS allocation_rows,
  (SELECT count(*)::text FROM refunds) AS refund_cases,
  (SELECT count(*)::text FROM refund_transaction t JOIN refunds r ON r.id=t.refund_case_id)
    AS refund_rows
FROM scoped_sessions`;
const webhookSql = `
SELECT
  count(*) FILTER(WHERE payload_snapshot->>'restaurantId'=$1::text OR EXISTS(
    SELECT 1 FROM payment_transaction p JOIN table_session s ON s.id=p.session_id
    JOIN dining_table t ON t.id=s.table_id
    WHERE p.id=e.payment_transaction_id AND t.restaurant_id=$1::uuid))::text AS scoped_payos_events,
  count(*) FILTER(WHERE NULLIF(payload_snapshot->>'restaurantId','') IS NULL
    AND payment_transaction_id IS NULL)::text AS unscoped_payos_events
FROM payment_webhook_event e WHERE provider='PAYOS'`;
const fields = [
  'total_intents',
  'protected_payos_unknown_intents',
  'protected_financial_record_intents',
  'unknown_retain_intents',
  'payos_requests',
  'open_payos_reconciliations',
  'bank_reported_without_ledger_intents',
  'sessions',
  'unclosed_sessions',
  'closed_receipts',
  'order_batches',
  'order_items',
  'proof_records',
  'admin_bank_proof_records',
  'bank_preview_records',
  'bank_evidence_records',
  'bank_receipt_claims',
  'operational_alerts',
  'financial_accounts',
  'receipt_rows',
  'payos_receipt_rows',
  'recorded_payos_receipt_rows',
  'allocation_rows',
  'refund_cases',
  'refund_rows',
  'scoped_payos_events',
  'unscoped_payos_events',
];
function count(value) {
  const normalized = String(value);
  if (!/^(0|[1-9][0-9]{0,18})$/.test(normalized)) throw Error('INVALID_AGGREGATE');
  return normalized;
}
export async function inventoryResetPlan(pool, restaurantId, options) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      restaurantId ?? '',
    )
  )
    throw Error('INVALID_RESTAURANT_SCOPE');
  const target = parseResetPlanArgs(['--dry-run', '--target-label', options?.targetLabel]);
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const snapshot = (
      await client.query(
        'SELECT transaction_timestamp()::text AS snapshot_at, EXISTS(SELECT 1 FROM restaurant WHERE id=$1) AS scope_exists',
        [restaurantId],
      )
    ).rows[0];
    if (snapshot?.scope_exists !== true) throw Error('RESTAURANT_SCOPE_NOT_FOUND');
    const snapshotAt = new Date(snapshot.snapshot_at).toISOString();
    const rows = [
      (await client.query(inventorySql, [restaurantId])).rows[0],
      (await client.query(financeSql, [restaurantId])).rows[0],
      (await client.query(webhookSql, [restaurantId])).rows[0],
    ];
    const merged = Object.assign({}, ...rows);
    const counts = Object.fromEntries(fields.map((name) => [name, count(merged[name])]));
    if (
      BigInt(counts.total_intents) !==
      BigInt(counts.protected_payos_unknown_intents) +
        BigInt(counts.protected_financial_record_intents) +
        BigInt(counts.unknown_retain_intents)
    )
      throw Error('INCONSISTENT_CLASSIFICATION');
    const plan = {
      format: 'payos-demo-reset-plan-v1',
      targetLabel: target.targetLabel,
      dryRun: true,
      readOnly: true,
      providerContacted: false,
      executionSupported: false,
      productionClassificationVerified: false,
      recommendation: 'FRESH_DATABASE_WITH_READ_ONLY_ARCHIVE',
      classificationPolicy:
        'ALL_PAYOS_OR_EXTERNAL_ATTEMPTS_PROTECTED_UNKNOWN_ALL_OTHER_ROWS_RETAIN',
      counts,
      automaticDemoDeleteEligibleCount: '0',
      destructiveResetAuthorized: false,
      requiresExplicitHumanApproval: true,
      requiresVerifiedBackupAndRestore: true,
      requiresOrderCodeAndLateWebhookRoutingReview: true,
      blockers: [
        'NO_RECORD_IS_AUTOMATICALLY_PROVEN_DEMO',
        'BACKUP_RESTORE_NOT_VERIFIED_BY_THIS_TOOL',
        'ORDER_CODE_AND_ARCHIVE_ROUTING_NOT_VERIFIED_BY_THIS_TOOL',
        'NO_RESET_EXECUTOR_IS_IMPLEMENTED',
      ],
    };
    // A review receipt only, NOT an execution token or a row-level manifest.
    // Include the private scope and server snapshot time without exposing either.
    const planHash = createHash('sha256')
      .update(JSON.stringify({ restaurantId, snapshotAt, plan }))
      .digest('hex');
    return { ...plan, planHash };
  } finally {
    try {
      if (started) await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
export async function runResetPlan(args, runtime, output = console) {
  try {
    const options = parseResetPlanArgs(args);
    const { pool, restaurantId, close } = await runtime();
    let plan;
    try {
      plan = await inventoryResetPlan(pool, restaurantId, options);
    } finally {
      await close();
    }
    output.log(JSON.stringify(plan, null, 2));
    return 0;
  } catch {
    // Never print SQL/driver errors, env values, connection URLs or SDK payloads.
    output.error(
      JSON.stringify({
        format: 'payos-demo-reset-plan-v1',
        error: 'READ_ONLY_PLAN_FAILED',
        dryRun: true,
        executionSupported: false,
        destructiveResetAuthorized: false,
      }),
    );
    return 1;
  }
}
if (
  process.argv[1] === '-' ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  process.exitCode = await runResetPlan(process.argv.slice(2), async () => {
    if (!process.env.DATABASE_URL || !process.env.RESTAURANT_ID) throw Error();
    const require = createRequire(pathToFileURL(process.cwd() + '/package.json'));
    const { createDatabase } = await import(
      pathToFileURL(require.resolve('@thesis/database')).href
    );
    const db = createDatabase(process.env.DATABASE_URL);
    return { pool: db.pool, restaurantId: process.env.RESTAURANT_ID, close: () => db.close() };
  });
}
