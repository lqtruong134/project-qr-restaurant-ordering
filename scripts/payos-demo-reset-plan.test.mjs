import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResetPlanArgs, inventoryResetPlan, runResetPlan } from './payos-demo-reset-plan.mjs';

const restaurantId = '10000000-0000-4000-8000-000000000001';
const args = ['--dry-run', '--target-label', 'review-before-fresh-db'];
const inventory = () => ({
  total_intents: '5',
  protected_payos_unknown_intents: '3',
  protected_financial_record_intents: '1',
  unknown_retain_intents: '1',
  payos_requests: '3',
  open_payos_reconciliations: '1',
  bank_reported_without_ledger_intents: '1',
});
const finance = () => ({
  sessions: '3',
  unclosed_sessions: '1',
  closed_receipts: '2',
  order_batches: '8',
  order_items: '17',
  proof_records: '1',
  operational_alerts: '3',
  financial_accounts: '3',
  receipt_rows: '4',
  payos_receipt_rows: '2',
  recorded_payos_receipt_rows: '1',
  allocation_rows: '4',
  refund_cases: '1',
  refund_rows: '1',
});
const events = () => ({ scoped_payos_events: '4', unscoped_payos_events: '1' });
function fixture({ change = {}, failure } = {}) {
  const calls = [];
  let released = false,
    closed = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (failure && sql.includes(failure)) throw Error('PRIVATE_ACCOUNT_TOKEN_DATABASE_URL');
      assert.ok(/^(BEGIN .*READ ONLY|SET LOCAL\s|SELECT\b|WITH\b|ROLLBACK$)/.test(sql.trimStart()));
      assert.equal(
        /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|CALL|DO)\b/i.test(sql),
        false,
      );
      if (/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes('transaction_timestamp()'))
        return { rows: [{ snapshot_at: '2026-10-22T00:00:00Z', scope_exists: true }] };
      if (sql.includes('intent_flags'))
        return {
          rows: [
            {
              ...inventory(),
              ...change,
              account_number: 'DO_NOT_PRINT_ACCOUNT',
              private_reference: 'DO_NOT_PRINT_REFERENCE',
            },
          ],
        };
      if (sql.includes('refund_rows')) return { rows: [finance()] };
      if (sql.includes('scoped_payos_events')) return { rows: [events()] };
      throw Error('Unexpected inventory SQL');
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client },
    restaurantId,
    close: async () => {
      closed = true;
    },
    calls,
    released: () => released,
    closed: () => closed,
  };
}
test('parser requires an explicit dry run and cannot accept execution/reset options or a secret URL', () => {
  assert.deepEqual(parseResetPlanArgs(args), { targetLabel: 'review-before-fresh-db' });
  for (const input of [
    [],
    ['--execute'],
    ['--dry-run'],
    ['--dry-run', '--target-label', 'postgresql://secret'],
    [...args, '--approve', 'anything'],
    ['--reset', '--target-label', 'candidate'],
  ])
    assert.throws(() => parseResetPlanArgs(input));
});
test('target validation happens before runtime or database connection is opened', async () => {
  let opened = false;
  const lines = [];
  assert.equal(
    await runResetPlan(
      ['--execute'],
      async () => {
        opened = true;
      },
      {
        error: (value) => lines.push(value),
      },
    ),
    1,
  );
  assert.equal(opened, false);
  assert.equal(JSON.parse(lines[0]).destructiveResetAuthorized, false);
  await assert.rejects(
    inventoryResetPlan(
      {
        connect() {
          assert.fail();
        },
      },
      'invalid',
      {
        targetLabel: 'review-before-fresh-db',
      },
    ),
  );
});
test('all queries are readonly, tenant scoped, bounded by timeouts and rollback/release', async () => {
  const db = fixture();
  const result = await inventoryResetPlan(db.pool, restaurantId, parseResetPlanArgs(args));
  assert.equal(db.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(db.calls.some(({ sql }) => sql === "SET LOCAL statement_timeout = '5s'"));
  assert.ok(db.calls.some(({ sql }) => sql === "SET LOCAL lock_timeout = '1s'"));
  for (const call of db.calls.filter(({ params }) => params))
    assert.deepEqual(call.params, [restaurantId]);
  assert.equal(db.released(), true);
  assert.equal(result.readOnly, true);
  assert.equal(result.providerContacted, false);
});
test('any payOS attempt/provider evidence is protected UNKNOWN, never automatically demo', async () => {
  const result = await inventoryResetPlan(fixture().pool, restaurantId, parseResetPlanArgs(args));
  assert.equal(result.counts.protected_payos_unknown_intents, '3');
  assert.equal(result.counts.protected_financial_record_intents, '1');
  assert.equal(result.counts.unknown_retain_intents, '1');
  assert.equal(result.counts.bank_reported_without_ledger_intents, '1');
  assert.equal(result.counts.closed_receipts, '2');
  assert.equal(result.counts.order_batches, '8');
  assert.equal(result.counts.order_items, '17');
  assert.equal(result.counts.proof_records, '1');
  assert.equal(result.counts.operational_alerts, '3');
  assert.equal(result.counts.unscoped_payos_events, '1');
  assert.equal(result.automaticDemoDeleteEligibleCount, '0');
  assert.equal(result.executionSupported, false);
  assert.equal(result.destructiveResetAuthorized, false);
  assert.equal(result.productionClassificationVerified, false);
  assert.ok(result.blockers.includes('NO_RECORD_IS_AUTOMATICALLY_PROVEN_DEMO'));
});
test('output is counts/booleans/fixed statuses, without PII, accounts, references, credentials or raw IDs', async () => {
  const result = await inventoryResetPlan(fixture().pool, restaurantId, parseResetPlanArgs(args));
  const text = JSON.stringify(result);
  for (const privateValue of [
    restaurantId,
    'DO_NOT_PRINT_ACCOUNT',
    'DO_NOT_PRINT_REFERENCE',
    'PRIVATE_ACCOUNT_TOKEN_DATABASE_URL',
  ])
    assert.equal(text.includes(privateValue), false);
  assert.match(result.planHash, /^[a-f0-9]{64}$/);
});
test('plan hash is a review receipt that changes with target or inventory, never approval to reset', async () => {
  const first = await inventoryResetPlan(fixture().pool, restaurantId, parseResetPlanArgs(args));
  const second = await inventoryResetPlan(fixture().pool, restaurantId, {
    targetLabel: 'different-review',
  });
  const changed = await inventoryResetPlan(
    fixture({ change: { payos_requests: '4' } }).pool,
    restaurantId,
    parseResetPlanArgs(args),
  );
  assert.notEqual(first.planHash, second.planHash);
  assert.notEqual(first.planHash, changed.planHash);
  assert.equal(first.requiresExplicitHumanApproval, true);
  assert.equal(first.requiresVerifiedBackupAndRestore, true);
  assert.equal(first.requiresOrderCodeAndLateWebhookRoutingReview, true);
});
test('inconsistent or untrusted count values fail closed, rollback and never grant reset', async () => {
  for (const change of [
    { total_intents: '6' },
    { payos_requests: '-1' },
    { payos_requests: '0001' },
    { protected_payos_unknown_intents: 'PRIVATE_ACCOUNT_TOKEN_DATABASE_URL' },
  ]) {
    const db = fixture({ change });
    await assert.rejects(inventoryResetPlan(db.pool, restaurantId, parseResetPlanArgs(args)));
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released(), true);
  }
});
test('SQL/connection failures are redacted and release/close remains mandatory', async () => {
  const db = fixture({ failure: 'intent_flags' }),
    lines = [];
  assert.equal(
    await runResetPlan(args, async () => db, {
      log: () => assert.fail(),
      error: (value) => lines.push(value),
    }),
    1,
  );
  assert.equal(db.released(), true);
  assert.equal(db.closed(), true);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(lines.join('').includes('PRIVATE_ACCOUNT_TOKEN_DATABASE_URL'), false);
  assert.equal(JSON.parse(lines[0]).error, 'READ_ONLY_PLAN_FAILED');
});
test('successful CLI runner closes database and only emits the dry-run plan', async () => {
  const db = fixture(),
    lines = [];
  assert.equal(
    await runResetPlan(args, async () => db, {
      log: (value) => lines.push(value),
      error: () => assert.fail(),
    }),
    0,
  );
  assert.equal(db.closed(), true);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).executionSupported, false);
});
