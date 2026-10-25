import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import {
  archiveHash,
  canonicalArchiveJson,
} from '../apps/api/src/modules/payments/test-case-archive.service.js';
import { assertBankReferenceAvailable } from '../apps/api/src/modules/payments/bank-receipt-posting.js';
import {
  inspectPayosTestCases,
  applyPayosTestArchive,
  validateArchivePlan,
  type ArchivePlan,
} from '../scripts/payos-test-archive-data.js';
import {
  parsePayosArchiveArgs,
  runPayosTestArchive,
  validatePayosArchiveBundle,
  validatePayosArchiveBackup,
  writePayosArchiveBundle,
} from '../scripts/payos-test-case-archive.js';
import { config, FakeProvider, signature } from './helpers/payos-provider-fixture.js';
import type { WebhookData } from '../apps/api/src/modules/payments/payos-adapter.js';

// The fixture hashes/fsyncs all 19,073 historical events; keep a bounded I/O budget per file.
vi.setConfig({ testTimeout: 30000 });

const name = 'thesis_payos_archive_' + randomBytes(6).toString('hex');
const directory = mkdtempSync(join(tmpdir(), 'payos-test-archive-'));
const proofDir = join(directory, 'proofs'),
  bundleDir = join(directory, 'archive'),
  backupDir = join(directory, 'backup');
const previous = {
  MENU_UPLOAD_DIR: process.env.MENU_UPLOAD_DIR,
  PAYMENT_PROOF_DIR: process.env.PAYMENT_PROOF_DIR,
  AUTH_SECRET: process.env.AUTH_SECRET,
};
const password = randomBytes(24).toString('hex'),
  provider = new FakeProvider();
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookies: Record<string, string> = {};
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
let host: Database,
  db: Database,
  app: ReturnType<typeof buildApp>,
  service: PayosService,
  url: string,
  staffId: string,
  adminId: string,
  plan: ArchivePlan,
  bundleHash: string,
  backupHash: string;
type Case = {
  id: string;
  sid: string;
  tableId: string;
  code: number;
  q: Record<string, unknown>;
  requestId: string;
};
const cases: Case[] = [];
let other: Case;
const reason =
  'Lưu trữ hai khoản thử có tiền thật đã được chủ dự án xác nhận, không ghi thu hoặc hoàn tiền.';
async function request(path: string, payload?: Record<string, unknown>, user = 'quyettruong05') {
  return app.inject({
    url: path,
    method: payload === undefined ? 'GET' : 'POST',
    headers: { ...headers, cookie: cookies[user] ?? '' },
    payload,
  });
}
async function api<T = Record<string, unknown>>(
  path: string,
  payload?: Record<string, unknown>,
  user = 'quyettruong05',
): Promise<T> {
  const r = await request(path, payload, user);
  expect(r.statusCode, path + ' ' + r.body).toBe(200);
  return r.json();
}
async function inspect(restore = false, restaurant = restaurantId) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return await inspectPayosTestCases(c, restaurant, false, restore);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
async function apply(value = plan, actor = adminId, hash = bundleHash) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const result = await applyPayosTestArchive(c, value, {
      operatorId: actor,
      reason,
      bundleHash: hash,
      backupHash,
    });
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function fixture(tableCode?: string, prefix?: string): Promise<Case> {
  let tableId: string, sid: string;
  if (tableCode) {
    tableId = (
      await db.prisma.dining_table.findFirstOrThrow({
        where: { restaurant_id: restaurantId, code: tableCode },
      })
    ).id;
    sid = prefix + '-0000-4000-8000-000000000001';
    await db.pool.query(
      "INSERT INTO table_session(id,table_id,verification_status) VALUES($1,$2,'VERIFIED')",
      [sid, tableId],
    );
  } else {
    const area = await db.prisma.dining_area.findFirstOrThrow();
    const t = await api<{ id: string }>('/core/tables', {
      code: 'ARCH-' + randomUUID().slice(0, 8),
      name: 'Archive unrelated fixture',
      areaId: area.id,
      capacity: 4,
    });
    tableId = t.id;
    sid = (await api<{ id: string }>('/core/tables/' + tableId + '/open', {}, 'pv001')).id;
  }
  const cat = await db.prisma.menu_category.findFirstOrThrow();
  const product = await api<{ id: string }>('/core/products', {
    code: 'ARCH-' + randomUUID().slice(0, 8),
    name: 'Archive fixture dish',
    categoryId: cat.id,
    price: '20000',
    stockManaged: false,
  });
  await api(
    '/core/sessions/' + sid + '/orders',
    { requestId: randomUUID(), lines: [{ productId: product.id, quantity: 1 }] },
    'pv001',
  );
  const requestId = randomUUID(),
    intent = await service.create(sid, staffId, { requestId, amount: '5000' });
  // This fixture also hosts the real 5-second maintenance loop. Non-target intents
  // must not become due merely because coverage takes longer than a 30-second poll.
  // Archive targets are explicitly made due below; worker behavior has its own tests.
  await db.pool.query(
    "UPDATE payos_payment_request SET next_poll_at=now()+interval '1 day' WHERE payment_intent_id=$1",
    [intent.id],
  );
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [
      intent.id,
    ])
  ).rows[0];
  return { id: String(intent.id), sid, tableId, code: Number(q.order_code), q, requestId };
}
function event(f: Case, fields: Partial<WebhookData> = {}) {
  const data: WebhookData = {
    orderCode: f.code,
    amount: 5000,
    reference: 'ARCHIVE-' + f.code,
    paymentLinkId: String(f.q.payment_link_id),
    currency: 'VND',
    code: '00',
    desc: 'Thành công',
    description: 'Synthetic archive payment',
    accountNumber: '12345678',
    transactionDateTime: new Date().toISOString(),
    ...fields,
  };
  return { code: '00', success: true, data, signature: signature(data) };
}
async function snapshotRows() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'payment_intent',
    'payos_payment_request',
    'payment_webhook_event',
    'idempotency_record',
    'payment_bank_proof',
    'payment_bank_preview',
    'payment_bank_evidence',
    'payment_transaction',
    'payment_allocation',
    'refund_case',
    'refund_transaction',
    'bank_receipt_claim',
    'operational_alert',
    'order_batch',
    'order_item',
    'table_session',
    'session_financial_account',
    'financial_charge',
  ])
    result[table] = (
      await db.pool.query('SELECT to_jsonb(r) AS row FROM ' + table + ' r ORDER BY id')
    ).rows.map((r) => r.row);
  return result;
}
async function snapshot() {
  return archiveHash(await snapshotRows());
}
function allocatorSnapshot() {
  const path = config.orderCodeStore!;
  return archiveHash(
    readdirSync(join(path, '..'))
      .sort()
      .map((n) => [n, sha(readFileSync(join(path, '..', n)))]),
  );
}
function makeBackup(path: string, createdAt = new Date().toISOString()) {
  mkdirSync(path, { mode: 0o700 });
  const files = {
    'database.dump': Buffer.from(
      'Synthetic backup-validator fixture; actual pg_dump restore is rehearsed separately.',
    ),
    'runtime-files.jsonl': Buffer.from('{"format":"qtruongres-files-v1"}\n'),
  };
  for (const [n, v] of Object.entries(files)) writeFileSync(join(path, n), v, { mode: 0o600 });
  const manifest = {
    format: 'qtruongres-backup-v1',
    project: 'qtruongres',
    postgresMajor: 18,
    createdAt,
    files: Object.fromEntries(
      Object.entries(files).map(([n, v]) => [n, { sha256: sha(v), size: v.length }]),
    ),
  };
  const bytes = JSON.stringify(manifest);
  writeFileSync(join(path, 'manifest.json'), bytes, { mode: 0o600 });
  return sha(bytes);
}
beforeAll(async () => {
  const supplied = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(supplied.hostname))
    throw Error('Explicit isolated loopback test database required.');
  host = createDatabase(supplied.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  supplied.pathname = '/' + name;
  url = supplied.toString();
  db = createDatabase(url);
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((v) => /^\d/.test(v))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  mkdirSync(proofDir, { mode: 0o700 });
  process.env.MENU_UPLOAD_DIR = join(directory, 'menu');
  process.env.PAYMENT_PROOF_DIR = proofDir;
  process.env.AUTH_SECRET = 'synthetic-archive-qr-secret-'.repeat(4);
  await seed(db, password, { includeWorkforce: false });
  staffId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } })).id;
  adminId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } }))
    .id;
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'a'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId, false, { config, provider });
  service = new PayosService(db, restaurantId, { config, provider });
  for (const user of ['quyettruong05', 'pv001']) {
    const r = await app.inject({
      url: '/auth/login',
      method: 'POST',
      headers,
      payload: { username: user, password },
    });
    expect(r.statusCode, r.body).toBe(200);
    cookies[user] = r.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
  for (const [table, prefix, count] of [
    ['A01', 'ffc78214', 8789],
    ['A02', '300659c7', 10284],
  ] as const) {
    const f = await fixture(table, prefix);
    cases.push(f);
    const alert = (
      await db.pool.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
        [f.sid, f.tableId],
      )
    ).rows[0];
    await db.pool.query("UPDATE payment_intent SET status='REQUIRES_RECONCILIATION' WHERE id=$1", [
      f.id,
    ]);
    await db.pool.query(
      "UPDATE payos_payment_request SET status='REQUIRES_RECONCILIATION',provider_status='PAID',paid_amount=5000,reconciliation_status='OPEN',reconciliation_reason='Tiền payOS đến khi khoản thu đã hủy hoặc hết hạn.',alert_id=$2,next_poll_at=now()-interval '1 day' WHERE payment_intent_id=$1",
      [f.id, alert.id],
    );
    const data = event(f).data;
    await db.pool.query(
      "INSERT INTO payment_webhook_event(provider,provider_event_id,payload_hash,payload_snapshot,signature_valid,processing_status) VALUES('PAYOS',$1,$2,$3,true,'REJECTED')",
      [data.reference, archiveHash(data), JSON.stringify({ ...data, restaurantId })],
    );
    if (table === 'A01') {
      const filename = randomUUID() + '.png',
        bytes = Buffer.from('synthetic-private-bank-proof-not-a-real-person');
      writeFileSync(join(proofDir, filename), bytes, { mode: 0o600 });
      await db.pool.query('UPDATE payment_intent SET proof=$2 WHERE id=$1', [
        f.id,
        JSON.stringify({
          name: filename,
          sha256: sha(bytes),
          mime: 'image/png',
          uploadedBy: adminId,
          uploadedAt: new Date().toISOString(),
        }),
      ]);
    }
    await db.pool.query(
      "INSERT INTO business_audit_event(restaurant_id,actor_type,action,resource_type,resource_id,reason,details) SELECT $1,'SYSTEM','PAYOS_PROVIDER_REPORTED','PAYMENT_INTENT',$2,'Repeated synthetic signed provider snapshot',$3::jsonb || jsonb_build_object('syntheticExactCounter',9007199254740993123::bigint) FROM generate_series(1,$4-(SELECT count(*)::int FROM business_audit_event WHERE resource_id=$2))",
      [
        restaurantId,
        f.id,
        JSON.stringify({
          orderCode: String(f.code),
          paymentLinkId: f.q.payment_link_id,
          bankReportedAmount: '5000',
        }),
        count,
      ],
    );
  }
  other = await fixture();
  plan = await inspect();
}, 120000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(name).toMatch(/^thesis_payos_archive_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(directory.startsWith(join(tmpdir(), 'payos-test-archive-'))).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}, 60000);

it('canonical hashes are stable for PostgreSQL JSON key order, optional fields and bigint', () => {
  expect(canonicalArchiveJson({ b: undefined, a: [undefined, 4n] })).toBe('{"a":[null,"4"]}');
  expect(archiveHash({ b: 2, a: 1 })).toBe(archiveHash({ a: 1, b: 2 }));
});
it('defaults to dry-run and refuses prefix-only UUID, delete/force/reset and missing confirmations', () => {
  const args = [
    '--restaurant-id',
    restaurantId,
    '--proof-dir',
    proofDir,
    '--output',
    join(directory, 'dry'),
  ];
  expect(parsePayosArchiveArgs(args).apply).toBe(false);
  for (const more of [
    ['--apply'],
    ['--force'],
    ['--delete'],
    ['--reset'],
    ['--confirm', 'a'.repeat(64)],
  ])
    expect(() => parsePayosArchiveArgs([...args, ...more])).toThrow(/ARCHIVE_/);
  expect(() =>
    parsePayosArchiveArgs([
      '--restaurant-id',
      'ffc78214',
      '--proof-dir',
      proofDir,
      '--output',
      '/tmp/private',
    ]),
  ).toThrow('ARCHIVE_INVALID_FULL_UUID');
});
it('captures exact complete UUIDs, all 19073 audit events, inbound FKs and diagnostic fact counts', () => {
  expect(
    plan.cases.map((v) => [v.tableCode, v.auditCount, v.rows.business_audit_event!.length]),
  ).toEqual([
    ['A01', 8789, 8789],
    ['A02', 10284, 10284],
  ]);
  for (const v of plan.cases) {
    expect(v.sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(v.rows.idempotency_record).toHaveLength(1);
    expect(v.rows.payment_webhook_event).toHaveLength(1);
    expect(
      v.auditStatistics.some(
        (r) =>
          r.action === 'PAYOS_PROVIDER_REPORTED' &&
          r.distinct_fact_snapshots === '2' &&
          Number(r.events) > 8700,
      ),
    ).toBe(true);
  }
  expect(plan.foreignKeys.some((v) => v.child === 'payment_transaction')).toBe(true);
  expect(plan.cases[0]!.proofs).toHaveLength(1);
  expect(plan.cases[1]!.proofs).toHaveLength(0);
});
it('keeps exact SQL JSON evidence rather than rounding bigint or microsecond data through JavaScript', () => {
  const original = plan.cases[0]!.rows.business_audit_event!.find((v) =>
    String(v.__archive_exact_json).includes('9007199254740993123'),
  );
  expect(original).toBeDefined();
  const changed = {
    ...original,
    __archive_exact_json: String(original!.__archive_exact_json).replace(
      '9007199254740993123',
      '9007199254740993124',
    ),
  };
  expect(archiveHash(changed)).not.toBe(archiveHash(original));
});
it('rejects a different restaurant or changed full UUID/checksum without writes', async () => {
  const before = await snapshot();
  await expect(inspect(false, randomUUID())).rejects.toThrow('EXACTLY_ONE_INTENT_REQUIRED');
  const edited = structuredClone(plan);
  edited.cases[0]!.intentId = randomUUID();
  expect(() => validateArchivePlan(edited, plan.planHash)).toThrow(
    'ARCHIVE_PLAN_CHECKSUM_MISMATCH',
  );
  expect(await snapshot()).toBe(before);
});
it.each([
  ['amount', 'UPDATE payos_payment_request SET paid_amount=5001 WHERE payment_intent_id=$1'],
  [
    'state',
    "UPDATE payos_payment_request SET provider_status='PENDING' WHERE payment_intent_id=$1",
  ],
  [
    'lease',
    "UPDATE payos_payment_request SET lease_until=now()+interval '1 minute' WHERE payment_intent_id=$1",
  ],
  [
    'audit',
    "INSERT INTO business_audit_event(restaurant_id,actor_type,action,resource_type,resource_id,reason,details) SELECT t.restaurant_id,'SYSTEM','SYNTHETIC_DRIFT','PAYMENT_INTENT',p.id,'Synthetic drift must refuse execution','{}' FROM payment_intent p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.id=$1",
  ],
  [
    'idempotency',
    "INSERT INTO idempotency_record(scope,idempotency_key,request_hash,resource_type,actor_type,payment_intent_id,expires_at) VALUES('archive-test','unexpected','synthetic','PAYMENT_INTENT','SYSTEM',$1,now()+interval '1 day')",
  ],
  [
    'receipt',
    "INSERT INTO payment_transaction(payment_intent_id,session_id,method,provider,provider_transaction_id,amount,status,confirmed_at) SELECT id,session_id,'ONLINE','PAYOS','unexpected-receipt',5000,'SUCCEEDED',now() FROM payment_intent WHERE id=$1",
  ],
])('refuses unexpected %s drift and rolls back both archives', async (_label, sql) => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql, [cases[0]!.id]);
    await expect(
      applyPayosTestArchive(c, plan, {
        operatorId: adminId,
        reason,
        bundleHash: 'a'.repeat(64),
        backupHash: 'b'.repeat(64),
      }),
    ).rejects.toThrow(/ARCHIVE_/);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payos_test_case_archive')).rows[0].n,
  ).toBe(0);
});
it('rejects an unknown populated FK and a different pre-image even if visible state looks unchanged', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'CREATE TABLE archive_unreviewed_child(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intent_id uuid REFERENCES payment_intent(id))',
    );
    await c.query('INSERT INTO archive_unreviewed_child(intent_id) VALUES($1)', [cases[0]!.id]);
    await expect(inspectPayosTestCases(c, restaurantId, true)).rejects.toThrow(
      'ARCHIVE_UNREVIEWED_FOREIGN_KEY',
    );
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  const c2 = await db.pool.connect();
  try {
    await c2.query('BEGIN');
    await c2.query(
      "UPDATE payos_payment_request SET next_poll_at=next_poll_at+interval '1 second' WHERE payment_intent_id=$1",
      [cases[0]!.id],
    );
    await expect(
      applyPayosTestArchive(c2, plan, {
        operatorId: adminId,
        reason,
        bundleHash: 'a'.repeat(64),
        backupHash: 'b'.repeat(64),
      }),
    ).rejects.toThrow('ARCHIVE_DATABASE_DRIFT');
  } finally {
    await c2.query('ROLLBACK');
    c2.release();
  }
});
it('writes a private checksum archive in default read-only mode without changing originals or allocator', async () => {
  const before = await snapshot(),
    allocator = allocatorSnapshot();
  const result = await runPayosTestArchive(
    ['--restaurant-id', restaurantId, '--proof-dir', proofDir, '--output', bundleDir],
    { DATABASE_URL: url, RESTAURANT_ID: restaurantId },
  );
  expect(result).toMatchObject({
    dryRun: true,
    databaseReadOnly: true,
    providerContacted: false,
    allocatorAccessed: false,
  });
  const bundle = await validatePayosArchiveBundle(bundleDir);
  expect(bundle.plan.planHash).toBe(plan.planHash);
  bundleHash = bundle.bundleHash;
  expect(statSync(bundleDir).mode & 0o077).toBe(0);
  expect(statSync(join(bundleDir, 'plan.json')).mode & 0o077).toBe(0);
  expect(await snapshot()).toBe(before);
  expect(allocatorSnapshot()).toBe(allocator);
  backupHash = makeBackup(backupDir);
}, 30000);
it('refuses archive tampering, unsafe permissions, symlink proofs and wrong backup checksum', async () => {
  // Every corruption experiment owns its files; no asynchronous failure can poison another test's archive.
  const tamper = join(directory, 'tamper-bundle');
  await writePayosArchiveBundle(tamper, plan, proofDir);
  const file = join(tamper, 'plan.json'),
    bytes = readFileSync(file);
  writeFileSync(file, Buffer.concat([bytes, Buffer.from(' ')]));
  await expect(validatePayosArchiveBundle(tamper)).rejects.toThrow(
    'ARCHIVE_BUNDLE_CHECKSUM_MISMATCH',
  );
  writeFileSync(file, bytes);
  chmodSync(file, 0o644);
  await expect(validatePayosArchiveBundle(tamper)).rejects.toThrow('ARCHIVE_INVALID_PRIVATE_FILE');
  const symlinks = join(directory, 'symlink-source');
  mkdirSync(symlinks, { mode: 0o700 });
  const proof = plan.cases[0]!.proofs[0]!;
  symlinkSync(join(proofDir, proof.name), join(symlinks, proof.name));
  await expect(
    writePayosArchiveBundle(join(directory, 'unsafe-proof'), plan, symlinks),
  ).rejects.toThrow();
  await expect(
    validatePayosArchiveBackup(backupDir, 'f'.repeat(64), new Date(0).toISOString()),
  ).rejects.toThrow('ARCHIVE_BACKUP_CONFIRMATION_MISMATCH');
  const corrupt = join(directory, 'corrupt-backup'),
    hash = makeBackup(corrupt);
  writeFileSync(join(corrupt, 'database.dump'), 'tampered');
  await expect(
    validatePayosArchiveBackup(corrupt, hash, new Date(0).toISOString()),
  ).rejects.toThrow('Backup checksum mismatch');
});
it('reads private proof bytes from the existing 0755 runtime directory without changing its permissions', async () => {
  const destination = join(directory, 'runtime-mode-bundle');
  try {
    chmodSync(proofDir, 0o755);
    await writePayosArchiveBundle(destination, plan, proofDir);
    expect(statSync(proofDir).mode & 0o777).toBe(0o755);
    expect(statSync(join(destination, 'proofs', plan.cases[0]!.proofs[0]!.name)).mode & 0o077).toBe(
      0,
    );
    chmodSync(proofDir, 0o770);
    await expect(
      writePayosArchiveBundle(join(directory, 'group-writable-proof'), plan, proofDir),
    ).rejects.toThrow('ARCHIVE_UNTRUSTED_PROOF_SOURCE');
  } finally {
    chmodSync(proofDir, 0o700);
  }
});
it('refuses a stale backup and an unauthorized operator before either marker is created', async () => {
  const stale = join(directory, 'stale-backup'),
    hash = makeBackup(stale, new Date(0).toISOString());
  await expect(validatePayosArchiveBackup(stale, hash, new Date().toISOString())).rejects.toThrow(
    'ARCHIVE_FRESH_FENCED_BACKUP_REQUIRED',
  );
  await expect(apply(plan, staffId)).rejects.toThrow('ARCHIVE_ADMIN_REQUIRED');
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payos_test_case_archive')).rows[0].n,
  ).toBe(0);
});
it('supports the existing M2 bank-proof table without losing the legacy proof or committing a partial archive', async () => {
  const c = await db.pool.connect();
  const descriptor = plan.cases[0]!.proofs[0]!;
  try {
    await c.query('BEGIN');
    await c.query('UPDATE payment_intent SET proof=NULL WHERE id=$1', [cases[0]!.id]);
    await c.query(
      'INSERT INTO payment_bank_proof(restaurant_id,payment_intent_id,uploaded_by,filename,sha256,mime,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        restaurantId,
        cases[0]!.id,
        adminId,
        descriptor.name,
        descriptor.sha256,
        descriptor.mime,
        readFileSync(join(proofDir, descriptor.name)).length,
      ],
    );
    const next = await inspectPayosTestCases(c, restaurantId, true);
    expect(next.cases[0]!.rows.payment_bank_proof).toHaveLength(1);
    expect(next.cases[0]!.proofs).toEqual([descriptor]);
    await applyPayosTestArchive(c, next, {
      operatorId: adminId,
      reason,
      bundleHash: 'a'.repeat(64),
      backupHash: 'b'.repeat(64),
    });
    expect(
      (await c.query('SELECT count(*)::int AS n FROM payos_test_case_archive')).rows[0].n,
    ).toBe(2);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payos_test_case_archive')).rows[0].n,
  ).toBe(0);
  expect((await inspect()).snapshotHash).toBe(plan.snapshotHash);
});
it('keeps the real worker active but schedules unrelated polling explicitly for fenced archive assertions', async () => {
  const targetHash = (await inspect()).snapshotHash;
  const before = (
    await db.pool.query('SELECT version FROM session_financial_account WHERE session_id=$1', [
      other.sid,
    ])
  ).rows[0].version;
  await db.pool.query(
    "UPDATE payos_payment_request SET next_poll_at=now()-interval '1 day' WHERE payment_intent_id=$1",
    [other.id],
  );
  await service.maintain();
  await expect
    .poll(
      async () =>
        (
          await db.pool.query('SELECT version FROM session_financial_account WHERE session_id=$1', [
            other.sid,
          ])
        ).rows[0].version,
    )
    .toBeGreaterThan(before);
  // The scheduled application worker may have won the same lease. Wait for its
  // release as well, before asserting a fenced whole-database pre-image.
  await expect
    .poll(
      async () =>
        (
          await db.pool.query(
            'SELECT lease_until FROM payos_payment_request WHERE payment_intent_id=$1',
            [other.id],
          )
        ).rows[0].lease_until,
    )
    .toBeNull();
  expect((await inspect()).snapshotHash).toBe(targetHash);
  await db.pool.query(
    "UPDATE payos_payment_request SET next_poll_at=now()+interval '1 day' WHERE payment_intent_id=$1",
    [other.id],
  );
});
it('archives exactly two cases once under concurrent execution, retaining all original rows and balances', async () => {
  const beforeRows = await snapshotRows(),
    before = archiveHash(beforeRows),
    allocator = allocatorSnapshot(),
    audit = (await db.pool.query('SELECT count(*)::int AS n FROM business_audit_event')).rows[0].n;
  const locked = await db.pool.connect();
  const late = await db.pool.connect();
  let first: Awaited<ReturnType<typeof apply>>;
  let lateResult: unknown;
  let second: ReturnType<typeof apply>;
  try {
    await locked.query('BEGIN');
    first = await applyPayosTestArchive(locked, plan, {
      operatorId: adminId,
      reason,
      bundleHash,
      backupHash,
    });
    const latePid = (await late.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending = late
      .query(
        "INSERT INTO payment_webhook_event(provider,provider_event_id,payload_hash,payload_snapshot,signature_valid) VALUES('PAYOS','LATE-ARCHIVE-INSERT',$1,$2,true)",
        [
          'a'.repeat(64),
          JSON.stringify({
            ...event(cases[0]!).data,
            restaurantId,
            reference: 'LATE-ARCHIVE-INSERT',
          }),
        ],
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      if (
        (await db.pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS waiting', [latePid]))
          .rows[0].waiting
      ) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    second = apply();
    await locked.query('COMMIT');
    lateResult = await pending;
  } catch (e) {
    await locked.query('ROLLBACK');
    throw e;
  } finally {
    locked.release();
    late.release();
  }
  expect(lateResult).toBeInstanceOf(Error);
  expect((lateResult as Error).message).toContain('Archived test webhook belongs in archive inbox');
  const results = [first, await second!];
  expect(results.map((v) => v.alreadyProcessed).sort()).toEqual([false, true]);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payos_test_case_archive')).rows[0].n,
  ).toBe(2);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payos_test_archive_event')).rows[0].n,
  ).toBe(2);
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM business_audit_event')).rows[0].n,
  ).toBe(audit + 2);
  const afterRows = await snapshotRows();
  expect(afterRows).toEqual(beforeRows);
  expect(archiveHash(afterRows)).toBe(before);
  expect(allocatorSnapshot()).toBe(allocator);
}, 30000);
it('is idempotent through the operator CLI and rejects a changed confirmed plan', async () => {
  const result = await runPayosTestArchive(
    [
      '--apply',
      '--restaurant-id',
      restaurantId,
      '--proof-dir',
      proofDir,
      '--from',
      bundleDir,
      '--confirm',
      plan.planHash,
      '--operator-id',
      adminId,
      '--reason',
      reason,
      '--ack-real-test-funds',
      '--backup',
      backupDir,
      '--confirm-backup',
      backupHash,
    ],
    { DATABASE_URL: url, RESTAURANT_ID: restaurantId },
  );
  expect(result).toMatchObject({
    alreadyProcessed: true,
    originalRecordsDeleted: 0,
    ledgerChanged: false,
    allocatorAccessed: false,
  });
  await expect(apply(plan, adminId, 'c'.repeat(64))).rejects.toThrow(
    'ARCHIVE_ALREADY_EXISTS_DIFFERENT_PLAN',
  );
}, 30000);
it('removes only archived alerts/cases and pending counts, with ADMIN-only archive access and unchanged bill debt', async () => {
  const listed = await api<Record<string, unknown>[]>('/core/admin/payment-reconciliation');
  expect(listed.some((v) => cases.some((f) => v.payment_intent_id === f.id || v.id === f.id))).toBe(
    false,
  );
  const alerts = await api<Record<string, unknown>[]>('/core/alerts');
  expect(alerts.some((v) => cases.some((f) => v.session_id === f.sid))).toBe(false);
  const tables = await api<Record<string, unknown>[]>('/core/tables', undefined, 'pv001');
  for (const f of cases)
    expect(tables.find((t) => t.id === f.tableId)?.pending_online_payments).toBe(0);
  const archived = await api<Record<string, unknown>[]>('/core/admin/payment-test-archives');
  expect(archived).toHaveLength(2);
  for (const v of archived)
    expect(v).toMatchObject({
      financially_resolved: false,
      posting_blocked: true,
      recorded_amount: '0',
    });
  const text = JSON.stringify(archived);
  expect(text).not.toContain('bank_reference');
  expect(text).not.toContain('payload_snapshot');
  expect((await request('/core/admin/payment-test-archives', undefined, 'pv001')).statusCode).toBe(
    403,
  );
  for (const f of cases) {
    const account = (
      await db.pool.query(
        'SELECT outstanding_amount::text,paid_total::text FROM session_financial_account WHERE session_id=$1',
        [f.sid],
      )
    ).rows[0];
    expect(account).toEqual({ outstanding_amount: '20000', paid_total: '0' });
  }
});
it('blocks refresh, resolution, bank evidence and old idempotency replay without contacting payOS', async () => {
  const gets = provider.gets,
    creates = provider.creates,
    before = await snapshot();
  for (const f of cases) {
    await expect(service.refreshForAdmin(f.id, adminId)).rejects.toThrow('đã được lưu trữ');
    await expect(service.refresh(f.id, staffId)).rejects.toThrow('đã được lưu trữ');
    await expect(
      service.resolve(f.id, adminId, { resolution: 'RECONCILED', reason }),
    ).rejects.toThrow('đã được lưu trữ');
    await expect(
      service.create(f.sid, staffId, { requestId: f.requestId, amount: '5000' }),
    ).rejects.toThrow('đã được lưu trữ');
    expect(
      (await request('/core/admin/payment-reconciliation/' + f.id + '/bank-evidence')).statusCode,
    ).toBe(409);
  }
  expect(provider.gets).toBe(gets);
  expect(provider.creates).toBe(creates);
  expect(await snapshot()).toBe(before);
});
it('acknowledges repeated signed archived webhooks only after one durable evidence row, never posts money', async () => {
  const before = await snapshot(),
    gets = provider.gets;
  for (const f of cases) {
    const body = event(f);
    const results = await Promise.all([
      service.webhook(body),
      service.webhook(body),
      service.webhook(body),
    ]);
    for (const result of results)
      expect(result).toMatchObject({ status: 'ARCHIVED_TEST', financiallyResolved: false });
  }
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM payos_test_archive_event WHERE event_kind='WEBHOOK_REPLAY'",
      )
    ).rows[0].n,
  ).toBe(2);
  expect(provider.gets).toBe(gets);
  expect(await snapshot()).toBe(before);
});
it('rejects invalid signatures and retains contradictory signed evidence in a separate review inbox', async () => {
  const f = cases[0]!,
    before = await snapshot();
  const bad = event(f);
  bad.signature = '0'.repeat(64);
  await expect(service.webhook(bad)).rejects.toThrow();
  for (const fields of [
    { paymentLinkId: randomUUID() },
    { reference: 'DIFFERENT-ARCHIVED-REF' },
    { amount: 6000 },
  ])
    expect(await service.webhook(event(f, fields))).toMatchObject({
      status: 'ARCHIVED_REVIEW_REQUIRED',
      financiallyResolved: false,
    });
  const row = (await api<Record<string, unknown>[]>('/core/admin/payment-test-archives')).find(
    (v) => v.payment_intent_id === f.id,
  );
  expect(row?.unexpected_webhooks).toBe(3);
  expect(await snapshot()).toBe(before);
});
it('quarantines a signed wrong-order replay by its archived reference instead of reopening the normal inbox', async () => {
  const before = await snapshot(),
    gets = provider.gets;
  const body = event(cases[0]!, { orderCode: other.code });
  expect(await service.webhook(body)).toMatchObject({ status: 'ARCHIVED_REVIEW_REQUIRED' });
  expect(await service.webhook(body)).toMatchObject({ status: 'ARCHIVED_REVIEW_REQUIRED' });
  expect(provider.gets).toBe(gets);
  expect(await snapshot()).toBe(before);
  const archived = await api<Record<string, unknown>[]>('/core/admin/payment-test-archives');
  expect(archived.find((v) => v.payment_intent_id === cases[0]!.id)?.unexpected_webhooks).toBe(4);
});
it('excludes archived cases from worker retry and captures an already-in-flight verified provider result without posting', async () => {
  const before = await snapshot();
  await db.pool.query(
    "UPDATE payos_payment_request SET next_poll_at=now()+interval '1 day' WHERE payment_intent_id=$1",
    [other.id],
  );
  const gets = provider.gets;
  await service.maintain();
  expect(provider.gets).toBe(gets);
  const f = cases[0]!,
    link = provider.links.get(f.code)!;
  provider.add(f.code, 5000, 'ARCHIVE-' + f.code);
  const result = await service.applyLink(f.id, structuredClone(link));
  expect(result.status).toBe('ARCHIVED_TEST');
  expect(
    (await db.pool.query('SELECT count(*)::int AS n FROM payment_transaction')).rows[0].n,
  ).toBe(0);
  // Only the unrelated worker schedule above changed; archive originals remain frozen.
  const again = await inspect();
  expect(again.snapshotHash).toBe(plan.snapshotHash);
  expect(before).not.toBe('');
});
it.each([
  ["UPDATE payment_intent SET status='SUCCEEDED' WHERE id=$1"],
  [
    "UPDATE payos_payment_request SET reconciliation_status='RESOLVED',resolved_by=$2,resolved_at=now() WHERE payment_intent_id=$1",
  ],
  [
    "UPDATE operational_alert SET status='RESOLVED' WHERE id=(SELECT alert_id FROM payos_payment_request WHERE payment_intent_id=$1)",
  ],
  [
    "UPDATE payment_webhook_event SET processing_status='PROCESSED' WHERE id=(SELECT webhook_id FROM payos_test_case_archive WHERE payment_intent_id=$1)",
  ],
  ["UPDATE idempotency_record SET response_snapshot='{}' WHERE payment_intent_id=$1"],
  [
    "INSERT INTO payment_transaction(payment_intent_id,session_id,method,provider,provider_transaction_id,amount,status,confirmed_at) SELECT id,session_id,'ONLINE','PAYOS','new-for-archived',5000,'SUCCEEDED',now() FROM payment_intent WHERE id=$1",
  ],
  [
    "INSERT INTO business_audit_event(restaurant_id,actor_type,action,resource_type,resource_id,reason,details) VALUES((SELECT restaurant_id FROM payos_test_case_archive WHERE payment_intent_id=$1),'SYSTEM','RETRY_OLD','PAYMENT_INTENT',$1,'Old worker must not add audit spam','{}')",
  ],
  ['DELETE FROM payment_intent WHERE id=$1'],
  ['DELETE FROM idempotency_record WHERE payment_intent_id=$1'],
  ['DELETE FROM payos_test_case_archive WHERE payment_intent_id=$1'],
])('database guards reject old-code mutation: %s', async (sql) => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await expect(
      c.query(sql, [cases[0]!.id, ...(sql.includes('$2') ? [adminId] : [])]),
    ).rejects.toThrow();
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('blocks reassignment of an archived bank reference to another intent at service and DB layers', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await expect(
      assertBankReferenceAvailable(c, {
        restaurantId,
        reference: plan.cases[0]!.bankReference,
        paymentIntentId: other.id,
        amount: '5000',
      }),
    ).rejects.toThrow('đã lưu trữ');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  for (const method of ['ONLINE', 'BANK_TRANSFER']) {
    const c2 = await db.pool.connect();
    try {
      await c2.query('BEGIN');
      await expect(
        c2.query(
          "INSERT INTO payment_transaction(payment_intent_id,session_id,method,provider,provider_transaction_id,amount,status,confirmed_at,metadata) VALUES($1,$2,$3,$4,$5,5000,'SUCCEEDED',now(),$6)",
          [
            other.id,
            other.sid,
            method,
            method === 'ONLINE' ? 'PAYOS' : null,
            plan.cases[0]!.bankReference,
            JSON.stringify({ reference: plan.cases[0]!.bankReference }),
          ],
        ),
      ).rejects.toThrow('Archived test bank receipt');
    } finally {
      await c2.query('ROLLBACK');
      c2.release();
    }
  }
});
it('still verifies and allocates an unrelated new payment once, with duplicate webhook idempotency', async () => {
  const bank = provider.add(other.code, 5000, 'UNRELATED-NEW-REFERENCE');
  bank.transactionDateTime = new Date().toISOString();
  const body = event(other, {
    reference: bank.reference,
    transactionDateTime: bank.transactionDateTime,
  });
  await service.webhook(body);
  await service.webhook(body);
  const money = (
    await db.pool.query(
      'SELECT count(*)::int AS n,COALESCE(sum(amount),0)::text AS amount FROM payment_transaction WHERE payment_intent_id=$1',
      [other.id],
    )
  ).rows[0];
  expect(money).toEqual({ n: 1, amount: '5000' });
  const bill = await api<{ account: Record<string, unknown> }>(
    '/core/sessions/' + other.sid + '/bill',
  );
  expect(bill.account).toMatchObject({ paid_total: '5000', outstanding_amount: '15000' });
  expect((await inspect()).snapshotHash).toBe(plan.snapshotHash);
});
it('deduplicates repeated provider facts while retaining the first evidence timestamp and new changed facts', async () => {
  const f = await fixture();
  const bank = provider.add(f.code, 5000, 'DEDUP-AUDIT-REFERENCE');
  bank.accountNumber = '99999999';
  bank.transactionDateTime = new Date().toISOString();
  for (let i = 0; i < 5; i++) await service.applyLink(f.id, await provider.get(f.code));
  const first = (
    await db.pool.query(
      "SELECT id,created_at,details FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_PROVIDER_REPORTED' ORDER BY created_at,id",
      [f.id],
    )
  ).rows;
  // One initial snapshot and one after opening the reconciliation cohort; further identical polling is silent.
  expect(first.length).toBeLessThanOrEqual(2);
  expect(first.length).toBeGreaterThan(0);
  for (let i = 0; i < 5; i++) await service.applyLink(f.id, await provider.get(f.code));
  expect(
    (
      await db.pool.query(
        "SELECT id,created_at,details FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_PROVIDER_REPORTED' ORDER BY created_at,id",
        [f.id],
      )
    ).rows,
  ).toEqual(first);
  provider.add(f.code, 1000, 'DEDUP-NEW-FACT').transactionDateTime = new Date().toISOString();
  await service.applyLink(f.id, await provider.get(f.code));
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_PROVIDER_REPORTED'",
        [f.id],
      )
    ).rows[0].n,
  ).toBe(first.length + 1);
});
it('refuses visibility rollback if signed archive inbox evidence changed after its dry-run', async () => {
  const value = await inspect(true),
    c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      "INSERT INTO payos_test_archive_event(archive_id,event_kind,payload_hash,payload_snapshot) VALUES((SELECT id FROM payos_test_case_archive WHERE payment_intent_id=$1),'PROVIDER_RESULT',$2,'{\"syntheticDrift\":true}')",
      [cases[0]!.id, 'd'.repeat(64)],
    );
    await expect(
      applyPayosTestArchive(c, value, { operatorId: adminId, reason, bundleHash, backupHash }),
    ).rejects.toThrow('ARCHIVE_VISIBILITY_DRIFT');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('visibility rollback restores review queues while keeping real-money evidence and the posting tombstone intact', async () => {
  const originals = (await inspect()).cases.map((v) =>
      archiveHash({ ...v, rows: { ...v.rows, session_financial_account: [] } }),
    ),
    value = await inspect(true),
    dir = join(directory, 'visibility');
  const bundle = await writePayosArchiveBundle(dir, value, proofDir);
  await apply(value, adminId, bundle.bundleHash);
  const listed = await api<Record<string, unknown>[]>('/core/admin/payment-reconciliation');
  for (const f of cases)
    expect(listed.some((v) => v.payment_intent_id === f.id || v.id === f.id)).toBe(true);
  for (const f of cases)
    await expect(service.refreshForAdmin(f.id, adminId)).rejects.toThrow('đã được lưu trữ');
  expect(
    (await inspect()).cases.map((v) =>
      archiveHash({ ...v, rows: { ...v.rows, session_financial_account: [] } }),
    ),
  ).toEqual(originals);
  for (const f of cases)
    expect(
      (
        await db.pool.query(
          'SELECT outstanding_amount::text,paid_total::text FROM session_financial_account WHERE session_id=$1',
          [f.sid],
        )
      ).rows[0],
    ).toEqual({ outstanding_amount: '20000', paid_total: '0' });
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS n FROM payos_test_case_archive WHERE visible_in_operations',
      )
    ).rows[0].n,
  ).toBe(2);
  expect((await validatePayosArchiveBundle(bundleDir)).bundleHash).toBe(bundleHash);
}, 30000);
