import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  hiddenAccount,
  runPrivateComparison,
  invokeComparison,
} from './payos-recipient-compare.mjs';

const args = ['--table', 'A10', '--session', '48A135F3'];
const account = '0123456789';
const report = () => ({
  format: 'payos-private-mb-comparison-v1',
  readOnly: true,
  requests: [
    {
      signedGetVerified: true,
      providerPaid: true,
      getChecksAllMatch: true,
      createMatchesQrAccount: true,
      quoteExpiredNow: true,
      cancelRequested: false,
      transactions: [
        {
          getMatchesEnteredMb: true,
          eligibleWebhookMatchesEnteredMb: true,
          eligibleWebhookPresent: true,
          getAndWebhookSamePrimary: true,
          getVirtualAbsent: true,
          webhookVirtualAbsent: true,
          currentRecipientAccepted: false,
          currentDecision: 'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE',
        },
      ],
    },
  ],
});
test('private input is hidden, has no history, and restores terminal raw mode', async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    modes = [],
    displayed = [];
  input.isTTY = output.isTTY = true;
  input.setRawMode = (value) => modes.push(value);
  output.on('data', (data) => displayed.push(String(data)));
  const pending = hiddenAccount(input, output);
  input.write(account + '\r');
  assert.equal(await pending, account);
  assert.equal(displayed.join('').includes(account), false);
  assert.deepEqual(modes, [true, false]);
});
test('Ctrl+C restores the terminal and never exposes the partially typed account', async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    modes = [],
    displayed = [];
  input.isTTY = output.isTTY = true;
  input.setRawMode = (value) => modes.push(value);
  output.on('data', (data) => displayed.push(String(data)));
  const pending = hiddenAccount(input, output);
  input.write(account.slice(0, 5));
  input.write('\x03');
  await assert.rejects(pending);
  assert.equal(displayed.join('').includes(account.slice(0, 5)), false);
  assert.deepEqual(modes, [true, false]);
});
test('noninteractive input is rejected instead of accepting an account from a pipe or shell argument', async () => {
  await assert.rejects(hiddenAccount(new PassThrough(), new PassThrough()));
  let asked = false,
    invoked = false;
  assert.equal(
    await runPrivateComparison([...args, account], {
      read: async () => {
        asked = true;
        return account;
      },
      invoke: async () => {
        invoked = true;
      },
      output: { error() {} },
    }),
    1,
  );
  assert.equal(asked, false);
  assert.equal(invoked, false);
});
test('docker receives only static argv and private stdin, without env overrides, shell or files', async () => {
  const target = { table: 'A10', session: '48A135F3' };
  let written;
  const result = await invokeComparison(
    { account, target, script: 'static tool source' },
    (command, argv, options, done) => {
      assert.equal(command, 'docker');
      assert.equal(argv.join(' ').includes(account), false);
      assert.equal(JSON.stringify(options).includes(account), false);
      assert.equal(options.shell, undefined);
      assert.equal(options.env, undefined);
      assert.ok(argv.includes('exec'));
      assert.ok(argv.includes('-e'));
      queueMicrotask(() => done(null, 'safe result'));
      return {
        stdin: {
          on() {},
          end(value) {
            written = JSON.parse(value);
          },
        },
      };
    },
  );
  assert.equal(result, 'safe result');
  assert.deepEqual(written, { account, target, script: 'static tool source' });
});
test('only booleans and fixed statuses survive the parent output allowlist', async () => {
  const data = report();
  data.requests[0].apiKey = account;
  data.requests[0].transactions[0].privateAccount = account;
  data.requests[0].transactions[0].getVirtualAbsent = account;
  const lines = [];
  const code = await runPrivateComparison(args, {
    read: async () => account,
    source: async () => 'static tool source',
    invoke: async (payload) => {
      assert.equal(payload.account, account);
      return JSON.stringify(data);
    },
    output: { log: (value) => lines.push(value), error: () => assert.fail() },
  });
  assert.equal(code, 0);
  const output = JSON.parse(lines[0]);
  assert.equal(output.requests[0].transactions[0].getMatchesEnteredMb, true);
  assert.equal(output.requests[0].transactions[0].getVirtualAbsent, null);
  assert.equal(output.requests[0].quoteExpiredNow, true);
  assert.equal(output.paymentAuthorizationChanged, false);
  assert.equal(lines.join('').includes(account), false);
});
test('container errors, corrupted JSON and untrusted decision strings never echo private data', async () => {
  for (const invoke of [
    async () => {
      throw Error(account + '-key-token-database-url');
    },
    async () => account,
    async () => {
      const data = report();
      data.requests[0].transactions[0].currentDecision = account;
      return JSON.stringify(data);
    },
  ]) {
    const lines = [];
    await runPrivateComparison(args, {
      read: async () => account,
      source: async () => '',
      invoke,
      output: { log: (value) => lines.push(value), error: (value) => lines.push(value) },
    });
    assert.equal(lines.join('').includes(account), false);
  }
});
test('invalid private account never starts Docker', async () => {
  let invoked = false;
  assert.equal(
    await runPrivateComparison(args, {
      read: async () => 'invalid',
      invoke: async () => {
        invoked = true;
      },
      output: { error() {} },
    }),
    1,
  );
  assert.equal(invoked, false);
});

test('container bootstrap executes the streamed tool with synthetic modules, no real DB/provider, and exact account comparison', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const { containerComparison } = await import('./payos-recipient-compare.mjs');
  const root = await mkdtemp(join(tmpdir(), 'payos-private-fixture-'));
  try {
    await mkdir(join(root, 'src/modules/payments'), { recursive: true });
    await mkdir(join(root, 'node_modules/@thesis/database'), { recursive: true });
    const get = {
      id: 'fixture-link',
      orderCode: 123,
      amount: 10000,
      amountPaid: 10000,
      amountRemaining: 0,
      status: 'PAID',
      transactions: [
        {
          reference: 'fixture-reference',
          amount: 10000,
          accountNumber: account,
          virtualAccountNumber: null,
        },
      ],
    };
    await writeFile(
      join(root, 'src/modules/payments/payos-adapter.ts'),
      'export const readPayosConfig=()=>({}); export const payosCapabilities=()=>({online:true});' +
        'export const officialPayosProvider=()=>({get:async()=>(' +
        JSON.stringify(get) +
        ')});',
    );
    const normalization = pathToFileURL(
      new URL('../apps/api/src/modules/payments/payos-normalization.ts', import.meta.url).pathname,
    ).href;
    await writeFile(
      join(root, 'src/modules/payments/payos-normalization.ts'),
      'export * from ' + JSON.stringify(normalization) + ';',
    );
    await writeFile(
      join(root, 'node_modules/@thesis/database/package.json'),
      JSON.stringify({ name: '@thesis/database', type: 'module', exports: './index.js' }),
    );
    const request = {
      order_code: '123',
      payment_link_id: 'fixture-link',
      account_number: '1000000000001',
      status: 'REQUIRES_RECONCILIATION',
      intent_status: 'PENDING',
      provider_status: 'PAID',
      paid_amount: '10000',
      amount: '10000',
      recorded: '0',
      applied: '0',
      reconciliation_status: 'OPEN',
      expires_at: '2020-01-01T00:00:00Z',
      cancel_requested: false,
    };
    const proof = {
      provider_event_id: 'fixture-reference',
      signature_valid: true,
      processing_status: 'REJECTED',
      payload_snapshot: {
        restaurantId: 'fixture-restaurant',
        orderCode: 123,
        paymentLinkId: 'fixture-link',
        currency: 'VND',
        code: '00',
        recipientEvidenceVersion: 2,
        amount: 10000,
        recipientAccountNumber: account,
        recipientVirtualAccountNumber: null,
      },
    };
    await writeFile(
      join(root, 'node_modules/@thesis/database/index.js'),
      `
      export function createDatabase(){
        let rolledBack=false,released=false;
        const client={async query(sql){
          if(sql.startsWith('BEGIN ')){if(!sql.endsWith('READ ONLY'))throw Error();return {rows:[]};}
          if(sql.startsWith('SET LOCAL '))return {rows:[]};
          if(sql==='ROLLBACK'){rolledBack=true;return {rows:[]};}
          if(sql.startsWith('SELECT s.id'))return {rows:[{id:'fixture-session'}]};
          if(sql.startsWith('SELECT q.order_code'))return {rows:[${JSON.stringify(request)}]};
          if(sql.startsWith('SELECT provider_event_id'))return {rows:[${JSON.stringify(proof)}]};
          throw Error('Unexpected SQL');
        },release(){released=true;}};
        return {pool:{connect:async()=>client},close:async()=>{if(!rolledBack||!released)throw Error();}};
      }`,
    );
    const script = await readFile(
      new URL('./payos-recipient-diagnostic.mjs', import.meta.url),
      'utf8',
    );
    for (const entered of [account, '9999999999']) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          '--input-type=module',
          '-e',
          '(' + containerComparison.toString() + ')()',
        ],
        {
          cwd: root,
          input: JSON.stringify({
            account: entered,
            target: { table: 'A10', session: '48A135F3' },
            script,
          }),
          encoding: 'utf8',
          timeout: 10000,
          env: {
            PATH: process.env.PATH,
            DATABASE_URL: 'synthetic-never-connected',
            RESTAURANT_ID: 'fixture-restaurant',
          },
        },
      );
      assert.equal(
        result.status,
        0,
        'synthetic bootstrap must succeed without revealing raw stderr',
      );
      const output = JSON.parse(result.stdout);
      const transaction = output.requests[0].transactions[0];
      assert.equal(transaction.getMatchesEnteredMb, entered === account);
      assert.equal(transaction.eligibleWebhookMatchesEnteredMb, entered === account);
      assert.equal(transaction.currentRecipientAccepted, false);
      assert.equal(transaction.currentDecision, 'WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE');
      assert.equal(output.requests[0].quoteExpiredNow, true);
      for (const privateValue of [
        account,
        entered,
        '1000000000001',
        'fixture-reference',
        'fixture-link',
      ])
        assert.equal(result.stdout.includes(privateValue), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
