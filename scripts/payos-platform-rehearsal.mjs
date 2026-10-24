import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupRuntimeFiles, restoreRuntimeFiles } from '../deploy/runtime-files.mjs';
import { hashFile, restoreIntoEmptyTarget, validateRestoreBundle } from './deploy.mjs';

// Synthetic-only tool. It never loads .env, starts/stops containers, accesses a
// merchant, or accepts a caller-chosen database/backup/volume path.
export function parseRehearsalArgs(args) {
  if (
    args.length !== 3 ||
    args[0] !== '--isolated-rehearsal' ||
    args[1] !== '--container' ||
    !/^qtruongres-payos-(receipt|platform)-lab-[0-9]{8}$/.test(args[2] ?? '')
  )
    throw Error('ISOLATED_REHEARSAL_ARGUMENTS_REQUIRED');
  return { container: args[2] };
}
export function validateRehearsalTarget(connectionString, inventory) {
  const url = new URL(connectionString);
  const port = inventory?.ports?.['5432/tcp'];
  if (
    url.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username !== 'isolated_test' ||
    url.password !== 'isolated_platform_test_only' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash ||
    !/^payos-(receipt-m2|platform-rehearsal)-[0-9]{8}$/.test(
      inventory?.labels?.['codex.task'] ?? '',
    ) ||
    !Array.isArray(inventory.mounts) ||
    inventory.mounts.some((m) => m.Type !== 'tmpfs') ||
    !inventory.tmpfs?.['/var/lib/postgresql'] ||
    !Array.isArray(port) ||
    port.length !== 1 ||
    port[0].HostIp !== '127.0.0.1' ||
    port[0].HostPort !== url.port
  )
    throw Error('ISOLATED_REHEARSAL_TARGET_REQUIRED');
  return url;
}
function docker(args, input) {
  const result = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60000,
  });
  if (result.error || result.status !== 0) throw Error('ISOLATED_REHEARSAL_DOCKER_FAILED');
  return result.stdout;
}
async function snapshot(db) {
  const tables = (
    await db.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    )
  ).rows;
  const hash = createHash('sha256'),
    counts = {};
  for (const { tablename } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw Error('UNEXPECTED_FIXTURE_TABLE');
    const rows = (
      await db.pool.query(
        `SELECT to_jsonb(t) AS value FROM "${tablename}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    counts[tablename] = rows.length;
    hash.update(tablename + '\0' + JSON.stringify(rows) + '\n');
  }
  return { hash: hash.digest('hex'), counts };
}
export async function runPlatformRehearsal(args, connectionString) {
  const { container } = parseRehearsalArgs(args);
  if (process.platform !== 'linux') throw Error('RUN_ISOLATED_REHEARSAL_IN_LINUX');
  const format =
    '{"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"ports":{{json .NetworkSettings.Ports}}}';
  const inventory = JSON.parse(docker(['inspect', '--format', format, container]).toString());
  const url = validateRehearsalTarget(connectionString, inventory);
  const { createDatabase } = await import('../packages/database/src/index.ts');
  const { one, session, transaction } =
    await import('../apps/api/src/modules/shared/core-persistence.ts');
  const { bankReceiverDigest, postPayosReceipt } =
    await import('../apps/api/src/modules/payments/bank-receipt-posting.ts');
  const { initializePayosOrderCodeStore, allocatePayosOrderCode } =
    await import('../apps/api/src/modules/payments/payos-order-code.ts');
  const root = await mkdtemp(join(tmpdir(), 'qtruongres-platform-rehearsal-'));
  await chmod(root, 0o700);
  const host = createDatabase(url.toString()),
    opened = [],
    created = [];
  const suffix = randomBytes(6).toString('hex');
  const names = ['source', 'restored', 'failure'].map(
    (part) => 'thesis_platform_' + part + '_' + suffix,
  );
  const pg = (database, command, args, input) =>
    docker(
      [
        'exec',
        ...(input ? ['-i'] : []),
        container,
        command,
        '-U',
        'isolated_test',
        '--dbname',
        database,
        ...args,
      ],
      input,
    );
  try {
    for (const name of names) {
      assert.match(name, /^thesis_platform_(source|restored|failure)_[a-f0-9]{12}$/);
      await host.pool.query('CREATE DATABASE ' + name);
      created.push(name);
      const dbUrl = new URL(url);
      dbUrl.pathname = '/' + name;
      opened.push(createDatabase(dbUrl.toString()));
    }
    const [source, restored, failure] = opened;
    for (const folder of (await readdir('packages/database/prisma/migrations'))
      .filter((x) => /^\d/.test(x))
      .sort())
      await source.pool.query(
        await readFile('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
      );
    const runtime = join(root, 'runtime'),
      target = join(root, 'restored-runtime'),
      failedRuntime = join(root, 'failure-runtime');
    await mkdir(join(runtime, 'payment-proofs'), { recursive: true, mode: 0o700 });
    await mkdir(target, { mode: 0o700 });
    await mkdir(failedRuntime, { mode: 0o700 });
    const proofBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const filename = randomUUID() + '.png',
      proofHash = createHash('sha256').update(proofBytes).digest('hex');
    await writeFile(join(runtime, 'payment-proofs', filename), proofBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    const storePath = join(runtime, 'payos-state', 'order-codes.sqlite'),
      channelId = 'isolated-platform-rehearsal-channel';
    initializePayosOrderCodeStore({ storePath, channelId, highWaterMark: 100000n });
    const firstCode = allocatePayosOrderCode({ storePath, channelId, now: 1 });
    const fixture = await transaction(source, async (c) => {
      const restaurant = await one(
        c,
        `INSERT INTO restaurant(name) VALUES('Synthetic backup rehearsal') RETURNING id`,
      );
      const actor = await one(
        c,
        `INSERT INTO app_user(restaurant_id,username,password_hash,display_name) VALUES($1,'lab-admin','synthetic-unused','Lab') RETURNING id`,
        [restaurant.id],
      );
      const area = await one(
        c,
        `INSERT INTO dining_area(restaurant_id,code,name) VALUES($1,'LAB','Lab') RETURNING id`,
        [restaurant.id],
      );
      const table = await one(
        c,
        `INSERT INTO dining_table(restaurant_id,area_id,code,name,capacity) VALUES($1,$2,'A1','Lab',4) RETURNING id`,
        [restaurant.id, area.id],
      );
      const s = await one(c, `INSERT INTO table_session(table_id) VALUES($1) RETURNING id`, [
        table.id,
      ]);
      const guest = await one(
        c,
        `INSERT INTO session_participant(session_id,guest_id,display_name,credential_hash) VALUES($1,gen_random_uuid(),'Synthetic guest',$2) RETURNING id`,
        [s.id, randomBytes(32).toString('hex')],
      );
      const assistance = await one(
        c,
        `INSERT INTO support_request(session_id,participant_id,request_type) VALUES($1,$2,'BILL') RETURNING id`,
        [s.id, guest.id],
      );
      await c.query(
        `INSERT INTO payment_assistance_submission(participant_id,request_id,request_hash,support_request_id) VALUES($1,$2,$3,$4)`,
        [
          guest.id,
          randomUUID(),
          createHash('sha256')
            .update(JSON.stringify({ method: null }))
            .digest('hex'),
          assistance.id,
        ],
      );
      await c.query(
        `INSERT INTO financial_charge(session_id,charge_type,amount) VALUES($1,'ADJUSTMENT',20000)`,
        [s.id],
      );
      const pi = await one(
        c,
        `INSERT INTO payment_intent(session_id,method,provider,amount,client_request_id,expires_at) VALUES($1,'ONLINE','PAYOS',10000,$2,now()+interval '15 minutes') RETURNING *`,
        [s.id, randomUUID()],
      );
      await c.query(
        `INSERT INTO payos_payment_request(payment_intent_id,created_by,order_code,status,provider_status,request_payload,account_number,payment_link_id)
        VALUES($1,$2,$3,'PENDING','PENDING',$4,'1234567890123','synthetic-rehearsal-link')`,
        [
          pi.id,
          actor.id,
          firstCode.toString(),
          JSON.stringify({ amount: 10000, orderCode: Number(firstCode) }),
        ],
      );
      await session(c, s.id, restaurant.id);
      const reference = 'synthetic-' + randomUUID(),
        receiverDigest = bankReceiverDigest('970422', '1234567890');
      const result = await postPayosReceipt(c, {
        pi,
        restaurantId: restaurant.id,
        reference,
        amount: '10000',
        metadata: { orderCode: firstCode.toString(), paymentLinkId: 'synthetic-rehearsal-link' },
        verificationSource: 'BANK_ADMIN_VERIFIED',
        actorId: actor.id,
        receiverDigest,
      });
      const proof = await one(
        c,
        `INSERT INTO payment_bank_proof(restaurant_id,payment_intent_id,uploaded_by,filename,sha256,mime,byte_size) VALUES($1,$2,$3,$4,$5,'image/png',$6) RETURNING id`,
        [restaurant.id, pi.id, actor.id, filename, proofHash, proofBytes.length],
      );
      const preview = await one(
        c,
        `INSERT INTO payment_bank_preview(token_hash,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,reason,snapshot,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,10000,now(),'Synthetic independent bank statement',$7,now()+interval '2 minutes') RETURNING id`,
        [
          randomBytes(32).toString('hex'),
          restaurant.id,
          pi.id,
          actor.id,
          proof.id,
          reference,
          JSON.stringify({ receiverDigest }),
        ],
      );
      await c.query(
        'UPDATE payment_bank_preview SET confirmed_at=now(),receipt_id=$2 WHERE id=$1',
        [preview.id, result.receiptId],
      );
      await c.query(
        `INSERT INTO payment_bank_evidence(preview_id,receipt_id,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,receiver_digest)
        SELECT id,receipt_id,restaurant_id,payment_intent_id,actor_id,proof_id,bank_reference,amount,bank_transaction_at,$2 FROM payment_bank_preview WHERE id=$1`,
        [preview.id, receiverDigest],
      );
      await c.query(`UPDATE payment_intent SET status='SUCCEEDED' WHERE id=$1`, [pi.id]);
      await c.query(`UPDATE payos_payment_request SET status='PAID' WHERE payment_intent_id=$1`, [
        pi.id,
      ]);
      return { sessionId: s.id, receiptId: result.receiptId };
    });
    const before = await snapshot(source),
      dump = pg(names[0], 'pg_dump', ['--format=custom', '--no-owner', '--no-privileges']);
    const bundle = join(root, 'bundle');
    await mkdir(bundle, { mode: 0o700 });
    await writeFile(join(bundle, 'database.dump'), dump, { flag: 'wx', mode: 0o600 });
    const archive = join(bundle, 'runtime-files.jsonl'),
      stream = createWriteStream(archive, { flags: 'wx', mode: 0o600 });
    await backupRuntimeFiles(runtime, stream);
    stream.end();
    await once(stream, 'finish');
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        format: 'qtruongres-backup-v1',
        project: 'qtruongres',
        postgresMajor: 18,
        files: {
          'database.dump': await hashFile(join(bundle, 'database.dump')),
          'runtime-files.jsonl': await hashFile(archive),
        },
      }),
      { flag: 'wx', mode: 0o600 },
    );
    const verified = await validateRestoreBundle(bundle);
    const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
    function context(database, runtimeRoot, failFiles = false) {
      return {
        running: () => [],
        compose: (args) => assert.deepEqual(args, ['up', '-d', '--wait', 'postgres']),
        pg: (command, args, options = {}) =>
          pg(database, command, args, options.inputFile ? dump : undefined).toString(),
        fileHelper: (action) => {
          if (failFiles && action === 'restore') throw Error('SYNTHETIC_FILES_FAILURE');
          const code =
            "const m=await import(process.argv[1]);if(process.argv[2]==='check-empty')await m.assertRuntimeEmpty(process.argv[3]);else await m.restoreRuntimeFiles(process.argv[3],process.argv[4]);";
          const result = spawnSync(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              code,
              pathToFileURL(resolve('deploy/runtime-files.mjs')).href,
              action,
              runtimeRoot,
              archive,
            ],
            { env: childEnv, timeout: 30000 },
          );
          if (result.error || result.status !== 0) throw Error('ISOLATED_RUNTIME_RESTORE_FAILED');
        },
      };
    }
    await restoreIntoEmptyTarget(context(names[1], target), verified);
    const after = await snapshot(restored);
    assert.deepEqual(after, before);
    const proof = await restored.pool.query(
      'SELECT sha256 FROM payment_bank_proof WHERE filename=$1',
      [filename],
    );
    assert.equal(
      proof.rows[0].sha256,
      createHash('sha256')
        .update(await readFile(join(target, 'payment-proofs', filename)))
        .digest('hex'),
    );
    assert.equal((await lstat(join(target, 'payment-proofs', filename))).mode & 0o777, 0o600);
    assert.equal((await lstat(join(target, 'payment-proofs'))).mode & 0o777, 0o700);
    for (const file of ['database.dump', 'runtime-files.jsonl', 'manifest.json'])
      assert.equal((await lstat(join(bundle, file))).mode & 0o777, 0o600);
    const balance = (
      await restored.pool.query(
        'SELECT paid_total,outstanding_amount,refund_due_amount FROM session_financial_account WHERE session_id=$1',
        [fixture.sessionId],
      )
    ).rows[0];
    assert.deepEqual(balance, {
      paid_total: '10000',
      outstanding_amount: '10000',
      refund_due_amount: '0',
    });
    await assert.rejects(
      restoreIntoEmptyTarget(context(names[0], runtime), verified),
      /user objects/,
    );
    await assert.rejects(
      restoreIntoEmptyTarget(context(names[2], failedRuntime, true), verified),
      /partially restored/,
    );
    assert.deepEqual(await snapshot(failure), before);
    assert.deepEqual(await readdir(failedRuntime), []);
    const newerCode = allocatePayosOrderCode({ storePath, channelId, now: 1 });
    assert.ok(newerCode > firstCode);
    await assert.rejects(restoreRuntimeFiles(runtime, archive), /empty/);
    const stillNewer = allocatePayosOrderCode({ storePath, channelId, now: 1 });
    assert.ok(stillNewer > newerCode);
    const restoredStore = join(target, 'payos-state', 'order-codes.sqlite');
    // An old backup is NOT authoritative. The synthetic live store proves this
    // upper bound; real recovery requires independently preserved channel history.
    initializePayosOrderCodeStore({
      storePath: restoredStore,
      channelId,
      highWaterMark: BigInt(stillNewer),
    });
    assert.ok(allocatePayosOrderCode({ storePath: restoredStore, channelId, now: 1 }) > stillNewer);
    const tampered = join(root, 'tampered');
    await mkdir(tampered, { mode: 0o700 });
    for (const name of ['database.dump', 'runtime-files.jsonl', 'manifest.json'])
      await writeFile(join(tampered, name), await readFile(join(bundle, name)), {
        flag: 'wx',
        mode: 0o600,
      });
    await writeFile(
      join(tampered, 'database.dump'),
      Buffer.concat([dump, Buffer.from('corruption')]),
    );
    await assert.rejects(validateRestoreBundle(tampered), /checksum/);
    const client = await restored.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await assert.rejects(client.query('UPDATE payment_bank_evidence SET amount=amount'), {
        code: '25006',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    return {
      format: 'payos-platform-isolated-rehearsal-v1',
      passed: true,
      syntheticOnly: true,
      providerContacted: false,
      productionAccessed: false,
      restoredTableCount: Object.keys(before.counts).length,
      bankEvidencePreserved: before.counts.payment_bank_evidence,
      assistanceRetryKeysPreserved: before.counts.payment_assistance_submission,
      canonicalClaimsPreserved: before.counts.bank_receipt_claim,
      proofHashAndPrivatePermissionsVerified: true,
      financialProjectionMatched: true,
      nonemptyRestoreRefused: true,
      partialFailureKeepsWritersStopped: true,
      corruptedBundleRefused: true,
      archiveReadOnlyVerified: true,
      allocatorRollbackSafetyVerified: true,
    };
  } finally {
    for (const db of opened) await db.close();
    for (const name of created) await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPlatformRehearsal(process.argv.slice(2), process.env.DATABASE_URL)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          failureLocation:
            String(error.stack ?? '').match(/payos-platform-rehearsal[.]mjs:[0-9]+:[0-9]+/g) ?? [],
        }),
      );
      console.error(
        'ISOLATED_PLATFORM_REHEARSAL_FAILED: check explicit lab arguments, synthetic URL and lab state.',
      );
      process.exitCode = 1;
    });
}
