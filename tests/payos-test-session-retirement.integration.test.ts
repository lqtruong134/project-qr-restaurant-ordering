import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { PayosService } from '../apps/api/src/modules/payments/payos.service.js';
import { archiveHash } from '../apps/api/src/modules/payments/test-case-archive.service.js';
import {
  inspectPayosTestCases,
  applyPayosTestArchive,
} from '../scripts/payos-test-archive-data.js';
import {
  inspectRetirement,
  applyRetirement,
  retirementProfiles,
  validateRetirementPlan,
  type RetirementPlan,
} from '../scripts/payos-test-session-retirement-data.js';
import {
  parseRetirementArgs,
  writeRetirementBundle,
  readRetirementBundle,
  runRetirement,
} from '../scripts/payos-test-session-retirement.js';
import { config, FakeProvider, signature } from './helpers/payos-provider-fixture.js';

vi.setConfig({ testTimeout: 30000 });
const name = 'thesis_retirement_' + randomBytes(6).toString('hex'),
  directory = mkdtempSync(join(tmpdir(), 'payos-retirement-'));
const password = randomBytes(24).toString('hex'),
  provider = new FakeProvider(),
  headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const previous = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  MENU_UPLOAD_DIR: process.env.MENU_UPLOAD_DIR,
  PAYMENT_PROOF_DIR: process.env.PAYMENT_PROOF_DIR,
};
const reason =
  'Kết thúc hai phiên thử có tiền thật, hủy báo cáo thiếu tiền tạo nhầm; không ghi thu, hoàn hoặc xóa nợ.';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
let host: Database,
  db: Database,
  app: ReturnType<typeof buildApp>,
  service: PayosService,
  url: string,
  adminId: string,
  staffId: string,
  plan: RetirementPlan,
  preflight: RetirementPlan,
  otherSid: string,
  productId: string,
  bundleHash: string,
  backupHash: string;
const cookies: Record<string, string> = {},
  oldCodes: Record<string, string> = {},
  oldCredentials: Record<string, string> = {};
let approvedBundleDir = join(directory, 'plan'),
  approvedBackupDir = join(directory, 'backup');
const bundleDir = join(directory, 'plan'),
  backupDir = join(directory, 'backup');
async function request(path: string, payload?: Record<string, unknown>, user = 'pv001') {
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
  user = 'pv001',
): Promise<T> {
  const r = await request(path, payload, user);
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function inspect() {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return await inspectRetirement(c, restaurantId);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
async function apply(
  value = plan,
  actor = adminId,
  options: Partial<Parameters<typeof applyRetirement>[2]> = {},
) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const r = await applyRetirement(c, value, {
      operatorId: actor,
      reason,
      bundleHash,
      backupHash,
      noActiveGuests: true,
      realFundsAcknowledged: true,
      ...options,
    });
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function refuseMutation(sql: string, params: unknown[], message: RegExp) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql, params);
    await expect(inspectRetirement(c, restaurantId)).rejects.toThrow(message);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
async function financialSnapshot() {
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
    'session_financial_account',
    'financial_charge',
    'order_batch',
    'order_item',
    'inventory_movement',
    'inventory_reservation',
    'payos_test_case_archive',
    'payos_test_archive_event',
    'table_qr_token',
  ])
    result[table] = (
      await db.pool.query('SELECT to_jsonb(r)::text AS exact FROM ' + table + ' r ORDER BY id')
    ).rows;
  return result;
}
const allocatorHash = () =>
  archiveHash(
    readdirSync(join(config.orderCodeStore!, '..'))
      .sort()
      .map((n) => [n, sha(readFileSync(join(config.orderCodeStore!, '..', n)))]),
  );
async function fullTargetAuditHash() {
  return archiveHash(
    (
      await db.pool.query(
        'SELECT to_jsonb(e)::text AS exact FROM business_audit_event e WHERE resource_id=ANY($1::uuid[]) ORDER BY id',
        [retirementProfiles.map((v) => v.intent)],
      )
    ).rows,
  );
}
function backupFixture(path = backupDir) {
  mkdirSync(path, { mode: 0o700 });
  const files = {
    'database.dump': Buffer.from(
      'Synthetic validator fixture; actual pg_dump/restore rehearsed separately.',
    ),
    'runtime-files.jsonl': Buffer.from('{"format":"qtruongres-files-v1"}\n'),
  };
  for (const [n, v] of Object.entries(files)) writeFileSync(join(path, n), v, { mode: 0o600 });
  const manifest = {
    format: 'qtruongres-backup-v1',
    project: 'qtruongres',
    postgresMajor: 18,
    createdAt: new Date().toISOString(),
    files: Object.fromEntries(
      Object.entries(files).map(([n, v]) => [n, { sha256: sha(v), size: v.length }]),
    ),
  };
  const data = JSON.stringify(manifest);
  writeFileSync(join(path, 'manifest.json'), data, { mode: 0o600 });
  return sha(data);
}

beforeAll(async () => {
  const supplied = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(supplied.hostname))
    throw Error('Explicit loopback lab required');
  host = createDatabase(supplied.toString());
  await host.pool.query('CREATE DATABASE ' + name);
  supplied.pathname = '/' + name;
  url = supplied.toString();
  db = createDatabase(url);
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((v) => /^\d/.test(v) && v < '202610260001')
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  process.env.AUTH_SECRET = 'synthetic-retirement-only-'.repeat(5);
  process.env.MENU_UPLOAD_DIR = join(directory, 'menu');
  process.env.PAYMENT_PROOF_DIR = join(directory, 'proofs');
  mkdirSync(process.env.PAYMENT_PROOF_DIR, { mode: 0o700 });
  await seed(db, password, { includeWorkforce: false });
  adminId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'quyettruong05' } }))
    .id;
  staffId = (await db.prisma.app_user.findFirstOrThrow({ where: { username: 'pv001' } })).id;
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'z'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId, false, { config, provider });
  service = new PayosService(db, restaurantId, { config, provider });
  for (const user of ['pv001', 'quyettruong05']) {
    const r = await app.inject({
      url: '/auth/login',
      method: 'POST',
      headers,
      payload: { username: user, password },
    });
    expect(r.statusCode, r.body).toBe(200);
    cookies[user] = r.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
  const cat = await db.prisma.menu_category.findFirstOrThrow();
  productId = String(
    (
      await api(
        '/core/products',
        {
          code: 'RETIRE-' + randomUUID().slice(0, 8),
          name: 'Synthetic retirement dish',
          categoryId: cat.id,
          price: '20000',
          stockManaged: false,
        },
        'quyettruong05',
      )
    ).id,
  );
  for (const [i, p] of retirementProfiles.entries()) {
    const table = await db.prisma.dining_table.findFirstOrThrow({
      where: { restaurant_id: restaurantId, code: p.table },
    });
    await db.pool.query(
      "INSERT INTO table_session(id,table_id,verification_status) VALUES($1,$2,'VERIFIED')",
      [p.session, table.id],
    );
    await db.pool.query("UPDATE dining_table SET table_status='OCCUPIED' WHERE id=$1", [table.id]);
    const opened = await api<{ accessCode: string }>('/core/sessions/' + p.session + '/verify', {});
    oldCodes[p.session] = opened.accessCode;
    const cred = randomBytes(24).toString('hex');
    oldCredentials[p.session] = cred;
    await db.pool.query(
      "INSERT INTO session_participant(session_id,guest_id,credential_hash,display_name) VALUES($1,$2,$3,'Synthetic test guest')",
      [p.session, randomUUID(), sha(cred)],
    );
    await api('/core/sessions/' + p.session + '/orders', {
      requestId: randomUUID(),
      lines: [{ productId, quantity: 1 }],
    });
    await db.pool.query(
      "UPDATE order_item SET status='SERVED',served_at=now() WHERE order_batch_id IN(SELECT id FROM order_batch WHERE session_id=$1)",
      [p.session],
    );
    await db.pool.query("UPDATE order_batch SET status='COMPLETED' WHERE session_id=$1", [
      p.session,
    ]);
    await db.pool.query(
      "UPDATE outbox_event SET status='PUBLISHED',published_at=now() WHERE order_batch_id IN(SELECT id FROM order_batch WHERE session_id=$1)",
      [p.session],
    );
    const alert = (
      await db.pool.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'OTHER','WARNING') RETURNING id",
        [p.session, table.id],
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO payment_intent(id,session_id,method,provider,amount,status,client_request_id,expires_at) VALUES($1,$2,'ONLINE','PAYOS',5000,'REQUIRES_RECONCILIATION',$3,now()+interval '1 day')",
      [p.intent, p.session, randomUUID()],
    );
    const code = 1790000000100 + i,
      link = randomUUID().replaceAll('-', ''),
      reference = 'RETIRE-' + i;
    await db.pool.query(
      "INSERT INTO payos_payment_request(payment_intent_id,created_by,order_code,payment_link_id,status,provider_status,request_payload,paid_amount,reconciliation_status,alert_id) VALUES($1,$2,$3,$4,'REQUIRES_RECONCILIATION','PAID',jsonb_build_object('amount',5000),5000,'OPEN',$5)",
      [p.intent, staffId, code, link, alert.id],
    );
    await db.pool.query(
      "INSERT INTO idempotency_record(scope,idempotency_key,request_hash,resource_type,expires_at,actor_type,actor_user_id,payment_intent_id,status,response_snapshot) VALUES('RETIRE_FIXTURE',$1,'synthetic','PAYMENT_INTENT',now()+interval '1 day','USER',$2,$3,'SUCCEEDED','{}')",
      [randomUUID(), staffId, p.intent],
    );
    const data = {
      restaurantId,
      orderCode: code,
      amount: 5000,
      paymentLinkId: link,
      currency: 'VND',
      code: '00',
      reference,
    };
    await db.pool.query(
      "INSERT INTO payment_webhook_event(provider,provider_event_id,payload_hash,payload_snapshot,signature_valid,processing_status) VALUES('PAYOS',$1,$2,$3,true,'REJECTED')",
      [reference, archiveHash(data), JSON.stringify(data)],
    );
    if (i === 0) {
      const filename = randomUUID() + '.png',
        bytes = Buffer.from('Synthetic proof, no bank or person');
      writeFileSync(join(process.env.PAYMENT_PROOF_DIR, filename), bytes, { mode: 0o600 });
      await db.pool.query('UPDATE payment_intent SET proof=$2 WHERE id=$1', [
        p.intent,
        JSON.stringify({ name: filename, sha256: sha(bytes), mime: 'image/png' }),
      ]);
    }
    await db.pool.query(
      "INSERT INTO business_audit_event(restaurant_id,actor_type,action,resource_type,resource_id,reason,details) SELECT $1,'SYSTEM','PAYOS_PROVIDER_REPORTED','PAYMENT_INTENT',$2,'Synthetic historical repeated facts','{}' FROM generate_series(1,$3)",
      [restaurantId, p.intent, i === 0 ? 8789 : 10284],
    );
  }
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const archive = await inspectPayosTestCases(c, restaurantId);
    await applyPayosTestArchive(c, archive, {
      operatorId: adminId,
      reason,
      bundleHash: 'a'.repeat(64),
      backupHash: 'b'.repeat(64),
    });
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  const second = retirementProfiles[1];
  await api('/core/sessions/' + second.session + '/outstanding', {
    reason: 'LEFT_WITHOUT_PAYING',
    notes: 'Synthetic mistaken test action',
  });
  for (const p of retirementProfiles)
    await db.pool.query("INSERT INTO support_request(session_id,request_type) VALUES($1,'BILL')", [
      p.session,
    ]);
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const t = await api(
    '/core/tables',
    { code: 'RETIRE-OTHER', name: 'Other normal table', areaId: area.id, capacity: 4 },
    'quyettruong05',
  );
  otherSid = String((await api('/core/tables/' + t.id + '/open', {})).id);
  await api('/core/sessions/' + otherSid + '/orders', {
    requestId: randomUUID(),
    lines: [{ productId, quantity: 1 }],
  });
  const otherIntent = await service.create(otherSid, staffId, {
    requestId: randomUUID(),
    amount: '5000',
  });
  await db.pool.query("UPDATE payment_intent SET status='REQUIRES_RECONCILIATION' WHERE id=$1", [
    otherIntent.id,
  ]);
  await db.pool.query(
    "UPDATE payos_payment_request SET reconciliation_status='OPEN',next_poll_at=now()+interval '1 day' WHERE payment_intent_id=$1",
    [otherIntent.id],
  );
  preflight = await inspect();
}, 120000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(name).toMatch(/^thesis_retirement_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
  }
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  expect(directory.startsWith(join(tmpdir(), 'payos-retirement-'))).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}, 60000);

it('defaults to read-only planning and requires exact full UUID confirmations, no bypass flags', () => {
  expect(
    parseRetirementArgs(['--restaurant-id', restaurantId, '--output', '/tmp/new-private']).apply,
  ).toBe(false);
  for (const flag of ['--apply', '--force', '--reset', '--delete', '--ack-real-test-funds'])
    expect(() =>
      parseRetirementArgs(['--restaurant-id', restaurantId, '--output', '/tmp/new-private', flag]),
    ).toThrow();
  expect(() =>
    parseRetirementArgs(['--restaurant-id', 'ffc78214', '--output', '/tmp/new']),
  ).toThrow();
});
it('preflights schema 40 without writes and reports real blockers and historical balances', async () => {
  expect(preflight.migrationReady).toBe(false);
  expect(
    preflight.cases.map((v) => [
      v.table,
      v.financial.charge_total,
      v.financial.paid_total,
      v.financial.outstanding_amount,
    ]),
  ).toEqual([
    ['A01', 20000, 0, 20000],
    ['A02', 20000, 0, 20000],
  ]);
  expect(preflight.cases[1]!.blockerCounts.map((v) => v.code)).toContain('OUTSTANDING_CASE');
  expect(
    preflight.cases.every((v) =>
      v.blockerCounts.some((b) => b.code === 'PAYMENT_REQUIRES_RECONCILIATION'),
    ),
  ).toBe(true);
  await expect(
    apply(preflight, adminId, { bundleHash: 'a'.repeat(64), backupHash: 'b'.repeat(64) }),
  ).rejects.toThrow('MIGRATION_41_REQUIRED_REPLAN');
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM table_session WHERE id=ANY($1::uuid[]) AND session_status='ACTIVE'",
        [retirementProfiles.map((v) => v.session)],
      )
    ).rows[0].n,
  ).toBe(2);
});
it('applies only additive migration 41 and produces a new checksummed private plan', async () => {
  await db.pool.query(
    readFileSync(
      'packages/database/prisma/migrations/202610260001_retire_archived_test_sessions/migration.sql',
      'utf8',
    ),
  );
  plan = await inspect();
  expect(plan.migrationReady).toBe(true);
  expect(plan.planHash).not.toBe(preflight.planHash);
  validateRetirementPlan(plan, plan.planHash);
  bundleHash = (await writeRetirementBundle(bundleDir, plan)).bundleHash;
  backupHash = backupFixture();
  expect((await readRetirementBundle(bundleDir)).bundleHash).toBe(bundleHash);
  expect(statSync(bundleDir).mode & 0o777).toBe(0o700);
  expect(statSync(join(bundleDir, 'plan.json')).mode & 0o777).toBe(0o600);
  expect(plan.foreignKeys.some((v) => v.child === 'payos_test_session_retirement')).toBe(true);
  expect(plan.records.business_audit_event!.length).toBeGreaterThan(19073);
});
it('dry-run CLI leaves all financial and archive rows byte-for-byte intact', async () => {
  const before = await financialSnapshot();
  const output = await runRetirement(
    ['--restaurant-id', restaurantId, '--output', join(directory, 'dry')],
    { DATABASE_URL: url, RESTAURANT_ID: restaurantId },
  );
  expect(output.dryRun).toBe(true);
  expect(await financialSnapshot()).toEqual(before);
});
it('refuses tampered private plan bytes', async () => {
  const p = join(directory, 'tampered');
  await writeRetirementBundle(p, plan);
  const file = join(p, 'plan.json');
  writeFileSync(file, readFileSync(file, 'utf8') + ' ', { mode: 0o600 });
  await expect(readRetirementBundle(p)).rejects.toThrow('CHECKSUM');
});
it('refuses a different tenant without writes', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await expect(inspectRetirement(c, randomUUID())).rejects.toThrow('TABLE_OR_TENANT');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('refuses a different session/table UUID in a self-rehashed plan', async () => {
  const changed = structuredClone(plan);
  changed.cases[0]!.sessionId = otherSid;
  const { planHash: _, ...body } = changed;
  void _;
  changed.planHash = archiveHash(body);
  await expect(apply(changed)).rejects.toThrow('PLAN_HASH_OR_SCOPE');
});
it('refuses staff, missing occupancy attestation or real-funds acknowledgement', async () => {
  await expect(apply(plan, staffId)).rejects.toThrow('ACTIVE_TENANT_ADMIN_REQUIRED');
  await expect(apply(plan, adminId, { noActiveGuests: false })).rejects.toThrow(
    'EXPLICIT_CONFIRMATIONS',
  );
  await expect(apply(plan, adminId, { realFundsAcknowledged: false })).rejects.toThrow(
    'EXPLICIT_CONFIRMATIONS',
  );
});
it('refuses an actual kitchen/order task instead of marking it served', async () => {
  await refuseMutation(
    "UPDATE order_item SET status='IN_PREPARATION' WHERE order_batch_id IN(SELECT id FROM order_batch WHERE session_id=$1)",
    [retirementProfiles[0].session],
    /ORDER_WORK_REMAINS/,
  );
});
it('refuses a real support task instead of cancelling it', async () => {
  await refuseMutation(
    "INSERT INTO support_request(session_id,request_type) VALUES($1,'ASSISTANCE')",
    [retirementProfiles[0].session],
    /REAL_SUPPORT_WORK/,
  );
});
it('refuses new incidents, refunds and changed historical balances', async () => {
  await refuseMutation(
    "INSERT INTO refund_case(session_id,amount,reason) VALUES($1,5000,'Synthetic unresolved refund')",
    [retirementProfiles[0].session],
    /UNRESOLVED_DEPENDENCY:refund_case/,
  );
  await refuseMutation(
    "INSERT INTO payment_intent(session_id,method,amount,client_request_id,expires_at) VALUES($1,'CASH',3000,$2,now()+interval '1 day')",
    [retirementProfiles[0].session, randomUUID()],
    /FINANCIAL_PROTECTION/,
  );
  await refuseMutation(
    "INSERT INTO operational_alert(session_id,table_id,alert_type,severity) VALUES($1,$2,'RISK_REVIEW','CRITICAL')",
    [plan.cases[0]!.sessionId, plan.cases[0]!.tableId],
    /OTHER_ALERTS/,
  );
  await refuseMutation(
    'UPDATE session_financial_account SET outstanding_amount=1 WHERE session_id=$1',
    [retirementProfiles[0].session],
    /LEDGER_ACCOUNT_DIFFERS/,
  );
  await refuseMutation(
    "UPDATE outstanding_balance_case SET status='IN_RECOVERY' WHERE session_id=$1",
    [retirementProfiles[1].session],
    /OUTSTANDING_CASE/,
  );
});
it('refuses a populated unknown FK dependency', async () => {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'CREATE TABLE unknown_retirement_work(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid REFERENCES table_session(id))',
    );
    await c.query('INSERT INTO unknown_retirement_work(session_id) VALUES($1)', [
      retirementProfiles[0].session,
    ]);
    await expect(inspectRetirement(c, restaurantId)).rejects.toThrow(
      'UNREVIEWED_DEPENDENCY:unknown_retirement_work',
    );
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('refuses pre-image drift between plan and apply', async () => {
  await db.pool.query(
    "UPDATE support_request SET content='changed after review' WHERE session_id=$1 AND request_type='BILL'",
    [retirementProfiles[0].session],
  );
  await expect(apply()).rejects.toThrow('DATABASE_PREIMAGE_DRIFT');
  plan = await inspect();
  const root = join(directory, 'fresh');
  bundleHash = (await writeRetirementBundle(root, plan)).bundleHash;
  approvedBundleDir = root;
  approvedBackupDir = join(directory, 'fresh-backup');
  backupHash = backupFixture(approvedBackupDir);
});
it('rolls back A01 too when A02 fails during the same transaction', async () => {
  await db.pool.query(
    `CREATE FUNCTION retirement_lab_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id='300659c7-5fea-4a77-a976-94551b078738' THEN RAISE EXCEPTION 'synthetic second case failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER retirement_lab_fail BEFORE INSERT ON payos_test_session_retirement FOR EACH ROW EXECUTE FUNCTION retirement_lab_fail();`,
  );
  const before = await financialSnapshot();
  await expect(apply()).rejects.toThrow('synthetic second case failure');
  expect(await financialSnapshot()).toEqual(before);
  expect(
    (await db.pool.query('SELECT count(*)::int n FROM payos_test_session_retirement')).rows[0].n,
  ).toBe(0);
  await db.pool.query(
    'DROP TRIGGER retirement_lab_fail ON payos_test_session_retirement;DROP FUNCTION retirement_lab_fail()',
  );
});
it('does not weaken ordinary close guards for a different unpaid/reconciliation session', async () => {
  const r = await request('/core/sessions/' + otherSid + '/close', {});
  expect(r.statusCode).toBe(409);
  expect(r.body).toContain('Giao dịch cần đối soát');
});
it('retires exactly two sessions atomically, preserves finance, archive, audit and allocator; cancels only the mistaken report', async () => {
  const before = await financialSnapshot(),
    audit = await fullTargetAuditHash(),
    allocator = allocatorHash();
  const other = (
    await db.pool.query('SELECT to_jsonb(s) AS value FROM table_session s WHERE id=$1', [otherSid])
  ).rows[0];
  const args = [
    '--apply',
    '--restaurant-id',
    restaurantId,
    '--from',
    approvedBundleDir,
    '--confirm',
    plan.planHash,
    '--operator-id',
    adminId,
    '--reason',
    reason,
    '--backup',
    approvedBackupDir,
    '--confirm-backup',
    backupHash,
    '--confirm-sessions',
    retirementProfiles.map((v) => v.session).join(','),
    '--confirm-no-active-guests',
    '--ack-real-test-funds',
  ];
  const results = await Promise.allSettled([
    runRetirement(args, { DATABASE_URL: url, RESTAURANT_ID: restaurantId }),
    runRetirement(args, { DATABASE_URL: url, RESTAURANT_ID: restaurantId }),
  ]);
  const completed = results.flatMap((v) => (v.status === 'fulfilled' ? [v.value] : []));
  expect(completed.filter((v) => !v.dryRun && v.alreadyProcessed === false)).toHaveLength(1);
  expect(completed.every((v) => !v.dryRun && v.retired === 2 && v.ledgerChanged === false)).toBe(
    true,
  );
  expect(await financialSnapshot()).toEqual(before);
  expect(await fullTargetAuditHash()).toBe(audit);
  expect(allocatorHash()).toBe(allocator);
  expect(
    (
      await db.pool.query('SELECT to_jsonb(s) AS value FROM table_session s WHERE id=$1', [
        otherSid,
      ])
    ).rows[0],
  ).toEqual(other);
  const sessions = (
    await db.pool.query(
      'SELECT session_status,close_reason,financial_status FROM table_session WHERE id=ANY($1::uuid[]) ORDER BY id',
      [retirementProfiles.map((v) => v.session)],
    )
  ).rows;
  expect(
    sessions.every(
      (v) => v.session_status === 'CLOSED' && v.close_reason === 'ARCHIVED_TEST_RETIRED',
    ),
  ).toBe(true);
  expect(sessions.map((v) => v.financial_status)).toContain('OUTSTANDING_EXCEPTION');
  const report = (
    await db.pool.query('SELECT * FROM outstanding_balance_case WHERE session_id=$1', [
      retirementProfiles[1].session,
    ])
  ).rows[0];
  expect(report.status).toBe('CANCELLED');
  expect(String(report.outstanding_amount)).toBe('20000');
  expect(report.notes).toContain('không xóa nợ');
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM business_audit_event WHERE action='WRITE_OFF_BALANCE'",
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM business_audit_event WHERE action='RETIRE_ARCHIVED_TEST_SESSION'",
      )
    ).rows[0].n,
  ).toBe(2);
});
it('retry is a no-op and cannot replace confirmation or financial history', async () => {
  const before = await financialSnapshot();
  expect(await apply()).toEqual({ alreadyProcessed: true, retired: 2 });
  expect(await financialSnapshot()).toEqual(before);
  await expect(apply(plan, adminId, { backupHash: 'c'.repeat(64) })).rejects.toThrow(
    'EXISTING_RETIREMENT_DIFFERS',
  );
});
it('database guards forbid fake settlement, reopening, modifying/deleting retirement markers', async () => {
  for (const sql of [
    "UPDATE table_session SET session_status='ACTIVE',closed_at=NULL WHERE id=$1",
    "UPDATE table_session SET financial_status='SETTLED' WHERE id=$1",
    "UPDATE payos_test_session_retirement SET reason='changed' WHERE session_id=$1",
    'DELETE FROM payos_test_session_retirement WHERE session_id=$1',
  ])
    await expect(db.pool.query(sql, [retirementProfiles[1].session])).rejects.toThrow();
});
it('historical bill reads preserve account bytes and expose technical close reason; archive remains unsettled', async () => {
  const before = await financialSnapshot();
  for (const p of retirementProfiles) {
    const bill = await api<{ session: Record<string, unknown>; account: Record<string, unknown> }>(
      '/core/sessions/' + p.session + '/bill',
    );
    expect(bill.session.close_reason).toBe('ARCHIVED_TEST_RETIRED');
    expect(String(bill.account.outstanding_amount)).toBe('20000');
  }
  const rows = await api<Record<string, unknown>[]>(
    '/core/admin/payment-test-archives',
    undefined,
    'quyettruong05',
  );
  expect(rows).toHaveLength(2);
  expect(
    rows.every(
      (v) => v.session_retired_at && v.financially_resolved === false && v.posting_blocked === true,
    ),
  ).toBe(true);
  expect(await financialSnapshot()).toEqual(before);
});
it('requires cleaning, creates two fresh sessions/codes, retains physical QR and rejects old guest access', async () => {
  const qr = (
    await db.pool.query('SELECT to_jsonb(q)::text AS exact FROM table_qr_token q ORDER BY id')
  ).rows;
  for (const v of plan.cases) {
    expect((await request('/core/tables/' + v.tableId + '/open', {})).statusCode).toBe(409);
    await api('/core/tables/' + v.tableId + '/clean', {});
    const next = await api<{ id: string; accessCode: string }>(
      '/core/tables/' + v.tableId + '/open',
      {},
    );
    expect(next.id).not.toBe(v.sessionId);
    expect(next.accessCode).toMatch(/^\d{4}$/);
    expect(next.accessCode).not.toBe(oldCodes[v.sessionId]);
    const alerts = await api<Record<string, unknown>[]>('/core/alerts');
    expect(alerts.some((a) => a.session_id === v.sessionId)).toBe(false);
  }
  expect(
    (await db.pool.query('SELECT to_jsonb(q)::text AS exact FROM table_qr_token q ORDER BY id'))
      .rows,
  ).toEqual(qr);
  for (const p of retirementProfiles) {
    const r = await app.inject({
      url: '/guest/state',
      headers: { cookie: 'guest=' + oldCredentials[p.session] },
    });
    expect(r.statusCode).toBe(401);
  }
});
it('late signed webhook replay remains archived, never pays a new session, and is idempotent', async () => {
  const before = await financialSnapshot();
  for (const v of plan.cases) {
    const a = (
      await db.pool.query('SELECT * FROM payos_test_case_archive WHERE id=$1', [v.archiveId])
    ).rows[0];
    const data = {
      orderCode: Number(a.order_code),
      amount: 5000,
      reference: a.bank_reference,
      paymentLinkId: a.payment_link_id,
      currency: 'VND',
      code: '00',
      desc: 'Success',
      description: 'Synthetic old test',
      accountNumber: '12345678',
      transactionDateTime: new Date().toISOString(),
    };
    const body = { code: '00', success: true, data, signature: signature(data) };
    for (let n = 0; n < 2; n++) {
      const r = await app.inject({
        url: '/payments/webhooks/payos',
        method: 'POST',
        payload: body,
      });
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM payos_test_archive_event WHERE archive_id=$1 AND event_kind='WEBHOOK_REPLAY'",
          [v.archiveId],
        )
      ).rows[0].n,
    ).toBe(1);
  }
  const after = await financialSnapshot();
  delete before.payos_test_archive_event;
  delete after.payos_test_archive_event;
  expect(after).toEqual(before);
  expect((await db.pool.query('SELECT count(*)::int n FROM payment_transaction')).rows[0].n).toBe(
    0,
  );
  await service.maintain();
  expect((await db.pool.query('SELECT count(*)::int n FROM payment_transaction')).rows[0].n).toBe(
    0,
  );
});
it('concurrent retries after tables are reused cannot close or dirty the new sessions', async () => {
  const before = (
    await db.pool.query(
      'SELECT to_jsonb(s)::text exact FROM table_session s WHERE id<>ALL($1::uuid[]) ORDER BY id',
      [retirementProfiles.map((v) => v.session)],
    )
  ).rows;
  const result = await Promise.allSettled([apply(), apply()]);
  expect(result.some((v) => v.status === 'fulfilled')).toBe(true);
  expect(
    (
      await db.pool.query(
        'SELECT to_jsonb(s)::text exact FROM table_session s WHERE id<>ALL($1::uuid[]) ORDER BY id',
        [retirementProfiles.map((v) => v.session)],
      )
    ).rows,
  ).toEqual(before);
  expect((await apply()).alreadyProcessed).toBe(true);
});

it('retired archive cannot be restored into the operational exception queue', async () => {
  await expect(
    db.pool.query(
      'UPDATE payos_test_case_archive SET visible_in_operations=true,visibility_restored_by=$2,visibility_restored_at=clock_timestamp(),visibility_restore_reason=$3 WHERE session_id=$1',
      [retirementProfiles[0].session, adminId, reason],
    ),
  ).rejects.toThrow();
  expect(
    (
      await db.pool.query(
        'SELECT visible_in_operations FROM payos_test_case_archive WHERE session_id=$1',
        [retirementProfiles[0].session],
      )
    ).rows[0].visible_in_operations,
  ).toBe(false);
});
it('new session accepts and allocates a valid synthetic payOS receipt once; old references stay isolated', async () => {
  const sid = (
    await db.pool.query(
      "SELECT id FROM table_session WHERE table_id=$1 AND session_status='ACTIVE'",
      [plan.cases[0]!.tableId],
    )
  ).rows[0].id;
  await api('/core/sessions/' + sid + '/orders', {
    requestId: randomUUID(),
    lines: [{ productId, quantity: 1 }],
  });
  const intent = await service.create(sid, staffId, { requestId: randomUUID(), amount: '1000' });
  const q = (
    await db.pool.query('SELECT * FROM payos_payment_request WHERE payment_intent_id=$1', [
      intent.id,
    ])
  ).rows[0];
  const tx = provider.add(Number(q.order_code), 1000, 'NEW-SESSION-RECEIPT');
  tx.transactionDateTime = new Date().toISOString();
  await service.refresh(String(intent.id), staffId);
  await service.refresh(String(intent.id), staffId);
  const receipts = (
    await db.pool.query('SELECT id,amount FROM payment_transaction WHERE session_id=$1', [sid])
  ).rows;
  expect(receipts).toHaveLength(1);
  expect(String(receipts[0].amount)).toBe('1000');
  const account = (
    await db.pool.query('SELECT * FROM session_financial_account WHERE session_id=$1', [sid])
  ).rows[0];
  expect(String(account.paid_total)).toBe('1000');
  expect(String(account.outstanding_amount)).toBe('19000');
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int n FROM payment_transaction WHERE session_id=ANY($1::uuid[])',
        [retirementProfiles.map((v) => v.session)],
      )
    ).rows[0].n,
  ).toBe(0);
});
