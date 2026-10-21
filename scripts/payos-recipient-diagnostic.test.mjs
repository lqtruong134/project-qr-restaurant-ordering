import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PayOS } from '../apps/api/node_modules/@payos/node/lib/index.js';
import { officialPayosProvider } from '../apps/api/src/modules/payments/payos-adapter.ts';
import * as normalization from '../apps/api/src/modules/payments/payos-normalization.ts';
import {
  parseTarget,
  qrAccount,
  recipientReport,
  proofChecks,
  diagnose,
  runDiagnostic,
} from './payos-recipient-diagnostic.mjs';

const restaurant = 'synthetic-restaurant';
const target = { table: 'A10', session: '48A135F3' };
const row = () => ({
  order_code: '123',
  payment_link_id: 'private-link',
  account_number: '000123',
  qr_code: 'private-qr',
  status: 'REQUIRES_RECONCILIATION',
  intent_status: 'PENDING',
  provider_status: 'PAID',
  paid_amount: '10000',
  amount: '10000',
  recorded: '0',
  applied: '0',
  reconciliation_status: 'OPEN',
});
const bank = () => ({
  reference: 'private-reference',
  amount: 10000,
  accountNumber: 'private-primary',
  virtualAccountNumber: null,
  counterAccountName: 'PRIVATE CUSTOMER',
  description: 'PRIVATE DESCRIPTION',
});
const link = () => ({
  id: 'private-link',
  orderCode: 123,
  amount: 10000,
  amountPaid: 10000,
  amountRemaining: 0,
  status: 'PAID',
  transactions: [bank()],
});
const event = () => ({
  provider_event_id: 'private-reference',
  signature_valid: true,
  processing_status: 'REJECTED',
  payload_snapshot: {
    restaurantId: restaurant,
    orderCode: 123,
    paymentLinkId: 'private-link',
    currency: 'VND',
    code: '00',
    recipientEvidenceVersion: 2,
    amount: 10000,
    recipientAccountNumber: 'private-primary',
    recipientVirtualAccountNumber: '000123',
  },
});
function lab({
  sessions = [{ id: 'private-session' }],
  rows = [row()],
  events = [event()],
  get = async () => link(),
} = {}) {
  const calls = [],
    gets = [];
  let released = false,
    closed = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^(BEGIN .*READ ONLY|SET LOCAL |ROLLBACK$)/.test(sql)) return { rows: [] };
      if (sql.includes('SELECT s.id FROM table_session')) return { rows: sessions };
      if (sql.includes('SELECT q.order_code')) return { rows };
      if (sql.includes('SELECT provider_event_id')) return { rows: events };
      throw Error('Unexpected SQL');
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { connect: async () => client },
    normalization,
    restaurant,
    get: async (code) => {
      gets.push(code);
      return get(code);
    },
    close: async () => {
      closed = true;
    },
    calls,
    gets,
    released: () => released,
    closed: () => closed,
  };
}
test('only an explicit, bounded table/session target is accepted before opening runtime', async () => {
  assert.deepEqual(parseTarget(['--table', 'A10', '--session', '48a135f3']), target);
  for (const args of [
    [],
    ['--table', '*', '--session', '48A135F3'],
    ['--table', 'A10', '--session', '48A135F3', '--write'],
    ['--table', 'A10', '--session', '48A1'],
  ]) {
    let opened = false;
    assert.equal(
      await runDiagnostic(
        args,
        async () => {
          opened = true;
        },
        { error() {} },
      ),
      1,
    );
    assert.equal(opened, false);
  }
});
test('VietQR extraction is bounded and never treats malformed QR as an anchor', () => {
  const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;
  const qr =
    tlv('00', '01') +
    tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', '970422') + tlv('01', '000123')));
  assert.equal(qrAccount(qr), '000123');
  for (const input of [null, {}, '380501010', 'x'.repeat(5000)])
    assert.equal(qrAccount(input), null);
});
for (const [label, expected, get, proof, decision] of [
  ['missing create anchor', '', {}, undefined, 'MISSING_CREATE_ANCHOR'],
  [
    'explicit GET VA conflicts despite primary match',
    '000123',
    { accountNumber: '000123', virtualAccountNumber: '999999' },
    undefined,
    'GET_EXPLICIT_VA_DIFFERS_FROM_CREATE',
  ],
  [
    'explicit webhook VA conflicts despite primary match',
    '000123',
    { accountNumber: '000123' },
    { accountNumber: '000123', virtualAccountNumber: '999999' },
    'WEBHOOK_EXPLICIT_VA_DIFFERS_FROM_CREATE',
  ],
  [
    'missing eligible webhook',
    '000123',
    bank(),
    undefined,
    'GET_PRIMARY_DIFFERS_NO_ELIGIBLE_WEBHOOK',
  ],
  [
    'different primaries',
    '000123',
    bank(),
    { accountNumber: 'other-primary', virtualAccountNumber: '000123' },
    'GET_WEBHOOK_PRIMARY_ACCOUNTS_DIFFER',
  ],
  [
    'proof does not identify expected VA',
    '000123',
    bank(),
    { accountNumber: 'private-primary' },
    'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE',
  ],
]) {
  test('diagnoses existing gate: ' + label, () => {
    const result = recipientReport(expected, get, proof, normalization);
    assert.equal(result.matched, false);
    assert.equal(result.decision, decision);
  });
}
test('valid direct and webhook-bridged matches use the existing helper unchanged', () => {
  assert.equal(
    recipientReport('000123', { accountNumber: '000123' }, undefined, normalization).matched,
    true,
  );
  const result = recipientReport(
    '000123',
    bank(),
    {
      accountNumber: 'private-primary',
      virtualAccountNumber: '000123',
    },
    normalization,
  );
  assert.equal(result.matched, true);
  assert.equal(result.decision, 'MATCH_VIA_VERIFIED_WEBHOOK');
  assert.equal(result.equals.create_webhookVirtual, true);
  assert.equal(result.equals.getAccount_webhookAccount, true);
  const numeric = recipientReport('000123', { accountNumber: 123 }, undefined, normalization);
  assert.deepEqual(numeric.getAccount, {
    type: 'number',
    present: false,
    normalizedLength: 0,
    trimmed: false,
  });
  assert.equal(numeric.matched, false);
});
test('every production webhook eligibility predicate must match, including old proof version', () => {
  const good = event();
  assert.ok(Object.values(proofChecks(good, row(), bank(), link(), restaurant)).every(Boolean));
  for (const [key, value] of [
    ['restaurantId', 'foreign-tenant'],
    ['orderCode', 124],
    ['paymentLinkId', 'other-link'],
    ['currency', 'USD'],
    ['code', '01'],
    ['recipientEvidenceVersion', undefined],
    ['amount', 9999],
  ]) {
    const bad = event();
    bad.payload_snapshot[key] = value;
    assert.equal(
      Object.values(proofChecks(bad, row(), bank(), link(), restaurant)).every(Boolean),
      false,
    );
  }
  for (const patch of [{ signature_valid: false }, { provider_event_id: 'wrong-reference' }])
    assert.equal(
      Object.values(proofChecks({ ...good, ...patch }, row(), bank(), link(), restaurant)).every(
        Boolean,
      ),
      false,
    );
});
test('diagnostic performs only bounded SELECTs in READ ONLY, one signed GET, and rolls back', async () => {
  const runtime = lab();
  const result = await diagnose(runtime, target, restaurant);
  assert.equal(result.readOnly, true);
  assert.equal(result.requests[0].transactions[0].recipient.matched, true);
  assert.ok(Object.values(result.requests[0].get.checks).every(Boolean));
  assert.deepEqual(runtime.gets, [123]);
  assert.equal(runtime.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(runtime.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(
    runtime.calls.every(({ sql }) => /^(BEGIN .*READ ONLY|SET LOCAL |SELECT |ROLLBACK$)/.test(sql)),
  );
  assert.equal(runtime.released(), true);
  const json = JSON.stringify(result);
  for (const secret of [
    '000123',
    'private-primary',
    'private-reference',
    'private-link',
    'private-session',
    'private-qr',
    'PRIVATE CUSTOMER',
    'PRIVATE DESCRIPTION',
    restaurant,
  ])
    assert.equal(json.includes(secret), false, secret);
});
test('legacy and wrong-order webhook snapshots are described but never used as proof', async () => {
  const legacy = event();
  delete legacy.payload_snapshot.recipientEvidenceVersion;
  const wrongOrder = event();
  wrongOrder.payload_snapshot.orderCode = 124;
  const result = await diagnose(lab({ events: [legacy, wrongOrder] }), target, restaurant);
  const transaction = result.requests[0].transactions[0];
  assert.equal(transaction.recipient.matched, false);
  assert.equal(transaction.recipient.decision, 'GET_PRIMARY_DIFFERS_NO_ELIGIBLE_WEBHOOK');
  assert.ok(transaction.webhookCandidates.every((candidate) => !candidate.eligible));
});
test('zero or ambiguous session stops without a provider request, always releases and rolls back', async () => {
  for (const sessions of [[], [{ id: 'one' }, { id: 'two' }]]) {
    const runtime = lab({ sessions });
    await assert.rejects(diagnose(runtime, target, restaurant));
    assert.deepEqual(runtime.gets, []);
    assert.equal(runtime.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(runtime.released(), true);
  }
});
test('provider or SQL errors cannot leak credentials/PII and always close the connection', async () => {
  const secret = 'credential-account-name-token-db-url-canary';
  const providerFailure = lab({
    get: async () => {
      throw new Error(secret);
    },
  });
  const sqlFailure = lab();
  const connect = sqlFailure.pool.connect;
  sqlFailure.pool.connect = async () => {
    const client = await connect();
    const query = client.query;
    client.query = async (sql, params) => {
      if (sql.includes('SELECT q.order_code')) throw new Error(secret);
      return query(sql, params);
    };
    return client;
  };
  for (const runtime of [providerFailure, sqlFailure]) {
    const lines = [];
    const code = await runDiagnostic(
      ['--table', 'A10', '--session', '48A135F3'],
      async () => runtime,
      { log: (value) => lines.push(value), error: (value) => lines.push(value) },
    );
    assert.equal(code, 1);
    assert.equal(runtime.closed(), true);
    assert.equal(runtime.released(), true);
    assert.equal(runtime.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).error, 'READ_OR_SIGNED_GET_FAILED');
    assert.equal(lines.join('').includes(secret), false);
  }
});
test('official adapter diagnostic GET verifies HMAC and refuses a tampered response without HTTP mutations', async () => {
  const key = randomBytes(32).toString('hex');
  const config = {
    enabled: true,
    clientId: 'synthetic-client',
    apiKey: 'synthetic-api',
    checksumKey: key,
  };
  const sdk = new PayOS({ ...config, logLevel: 'off' });
  const data = link();
  const signature = await sdk.crypto.createSignatureFromObj(data, key);
  const calls = [];
  let tampered = false;
  const provider = officialPayosProvider(config, async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(
      JSON.stringify({
        code: '00',
        desc: 'success',
        data,
        signature: tampered ? '0'.repeat(64) : signature,
      }),
      { status: 200 },
    );
  });
  assert.equal((await provider.get(123)).status, 'PAID');
  tampered = true;
  await assert.rejects(provider.get(123));
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) =>
        call.method === 'GET' &&
        call.url === 'https://api-merchant.payos.vn/v2/payment-requests/123',
    ),
  );
});

test('streamed stdin entry rejects invalid targets without loading runtime or environment files', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-', '--table', 'bad', '--session', '48A135F3'],
    {
      input: readFileSync(new URL('./payos-recipient-diagnostic.mjs', import.meta.url), 'utf8'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
      timeout: 5000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error, 'INVALID_TARGET');
});

test('real-case shape: CREATE/QR 13 digits and equal GET/webhook 10 digits without VA remain blocked', async () => {
  const request = row();
  request.account_number = '1000000000001';
  request.expires_at = '2020-01-01T00:00:00Z';
  request.cancel_requested = false;
  const snapshot = event();
  snapshot.payload_snapshot.recipientAccountNumber = '2000000002';
  snapshot.payload_snapshot.recipientVirtualAccountNumber = null;
  const response = link();
  response.transactions[0].accountNumber = '2000000002';
  const matches = [];
  const runtime = lab({ rows: [request], events: [snapshot], get: async () => response });
  runtime.compareAccount = (value) => {
    matches.push(value);
    const normalized = normalization.normalizePayosAccount(value);
    return normalized === null ? null : normalized === '2000000002';
  };
  const result = await diagnose(runtime, target, restaurant);
  const recipient = result.requests[0].transactions[0];
  assert.equal(recipient.recipient.getAccount.normalizedLength, 10);
  assert.equal(result.requests[0].createAccount.normalizedLength, 13);
  assert.equal(result.requests[0].stored.quoteExpiredNow, true);
  assert.equal(result.requests[0].stored.cancelRequested, false);
  assert.equal(recipient.recipient.decision, 'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE');
  assert.equal(recipient.recipient.matched, false);
  assert.deepEqual(recipient.privateAccountMatches, { get: true, webhook: true });
  assert.deepEqual(matches, ['2000000002', '2000000002']);
  for (const actual of ['1000000000001', '2000000002'])
    assert.equal(JSON.stringify(result).includes(actual), false);
  // An independently supplied DIFFERENT account of the SAME length must fail.
  runtime.compareAccount = (value) => normalization.normalizePayosAccount(value) === '3000000003';
  const mismatch = await diagnose(runtime, target, restaurant);
  assert.deepEqual(mismatch.requests[0].transactions[0].privateAccountMatches, {
    get: false,
    webhook: false,
  });
});
test('legacy diagnostic success entry still works without a private comparison callback', async () => {
  const runtime = lab(),
    output = [];
  const code = await runDiagnostic(
    ['--table', 'A10', '--session', '48A135F3'],
    async () => runtime,
    { log: (value) => output.push(value), error: () => assert.fail() },
  );
  assert.equal(code, 0);
  assert.equal(runtime.closed(), true);
  assert.equal(runtime.released(), true);
  const transaction = JSON.parse(output[0]).requests[0].transactions[0];
  assert.equal(transaction.privateAccountMatches, undefined);
});
