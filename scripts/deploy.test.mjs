import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildImages,
  validateProjectName,
  buildChildEnvironment,
  validateDockerExecutable,
  requireNoMigration,
  restoreIntoEmptyTarget,
  parseOptions,
  parseEnvironment,
  validateEnvironment,
  resolveProductionEnv,
  requireStopped,
  validateRestoreBundle,
  hashFile,
} from './deploy.mjs';
import {
  restoreRuntimeStream,
  FILE_ARCHIVE_FORMAT,
  backupRuntimeFiles,
  validateRuntimeArchive,
  restoreRuntimeFiles,
  validateRuntimePath,
  assertRuntimeEmpty,
} from '../deploy/runtime-files.mjs';

const name = '12345678-1234-4234-8234-123456789abc.png';
const env = () => ({
  POSTGRES_USER: 'qtruongres',
  POSTGRES_DB: 'qtruongres',
  POSTGRES_PASSWORD: 'a'.repeat(48),
  AUTH_SECRET: 'b'.repeat(96),
  RESTAURANT_ID: '10000000-0000-4000-8000-000000000001',
  DATABASE_URL: 'postgresql://qtruongres:' + 'a'.repeat(48) + '@postgres:5432/qtruongres',
  PUBLIC_APP_URL: 'https://qtruongres.example',
  MENU_ASSISTANT_MODE: 'OFF',
  PAYOS_ENABLED: 'false',
});
async function temporary(work) {
  const root = await mkdtemp(join(tmpdir(), 'qtruongres-ops-test-'));
  try {
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function entry(path, bytes = Buffer.from('image bytes')) {
  return {
    path,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64'),
  };
}
async function archive(file, entries) {
  await writeFile(
    file,
    [
      JSON.stringify({ format: FILE_ARCHIVE_FORMAT }),
      ...entries.map((row) => JSON.stringify(row)),
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}
async function fileBackup(root, destination) {
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  try {
    await backupRuntimeFiles(root, output);
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    throw error;
  }
}
test('operation parser requires explicit restore source and rejects unknown options', () => {
  assert.equal(parseOptions(['backup']).envFile, 'deploy/.env.production');
  assert.equal(parseOptions(['restore', '--from', '/private/backup']).from, '/private/backup');
  assert.throws(() => parseOptions(['restore']));
  assert.throws(() => parseOptions(['restore', '--from']));
  assert.throws(() => parseOptions(['reset']));
  assert.throws(() => parseOptions(['start', '--overwrite']));
});
test('production env accepts literal configuration, rejects duplicate/interpolated entries', () => {
  assert.deepEqual(
    parseEnvironment(
      '# comment\nPUBLIC_APP_URL="https://qtruongres.example"\nPAYOS_ENABLED=false\n',
    ),
    { PUBLIC_APP_URL: 'https://qtruongres.example', PAYOS_ENABLED: 'false' },
  );
  assert.throws(() => parseEnvironment('AUTH_SECRET=a\nAUTH_SECRET=b'));
  assert.throws(() => parseEnvironment('DATABASE_URL=${DATABASE_URL}'));
  assert.throws(() => parseEnvironment('not an env line'));
});
test('configuration enforces HTTPS, private postgres, preserved strong key and AI off', () => {
  assert.deepEqual(validateEnvironment(env()), {
    port: 8088,
    publicOrigin: 'https://qtruongres.example',
    projectName: 'qtruongres',
  });
  for (const change of [
    { PUBLIC_APP_URL: 'http://qtruongres.example' },
    { PUBLIC_APP_URL: 'https://qtruongres.example/path' },
    { DATABASE_URL: env().DATABASE_URL.replace('@postgres:', '@public.example:') },
    { POSTGRES_PASSWORD: 'wrong' },
    { AUTH_SECRET: 'CHANGE_ME' },
    { MENU_ASSISTANT_MODE: 'MOCK' },
    { PAYOS_ENABLED: 'true' },
    { QTRUONGRES_CADDY_PORT: '5432;bad' },
  ])
    assert.throws(() => validateEnvironment({ ...env(), ...change }));
});
test('env loader refuses development .env and symlinks without reading their contents', async () =>
  temporary(async (root) => {
    await writeFile(join(root, '.env'), 'PRIVATE DEVELOPMENT VALUE');
    await assert.rejects(resolveProductionEnv('.env', root));
    await symlink(join(root, '.env'), join(root, 'linked-production'));
    await assert.rejects(resolveProductionEnv('linked-production', root));
    await writeFile(join(root, 'production.env'), 'SAFE=1');
    assert.equal(await resolveProductionEnv('production.env', root), join(root, 'production.env'));
  }));
test('restore requires stopped application writers and controlled migration jobs', () => {
  requireStopped(['postgres', 'cloudflared']);
  for (const service of ['api', 'web', 'caddy', 'migrate'])
    assert.throws(() => requireStopped(['postgres', service]));
});
test('archive path allowlist excludes secrets, traversal, absolute paths and nested stores', () => {
  assert.equal(validateRuntimePath('menu-images/' + name), 'menu-images/' + name);
  for (const path of [
    '../.env',
    '/etc/passwd',
    'payment-proofs/../../.env',
    'menu-images/sub/' + name,
    'menu-images/.env',
    'credentials/' + name,
    'menu-images\\' + name,
  ])
    assert.throws(() => validateRuntimePath(path));
});
test('menu images and private proofs roundtrip through bounded file archive without extra resources', async () =>
  temporary(async (root) => {
    const source = join(root, 'source'),
      target = join(root, 'target');
    await mkdir(join(source, 'menu-images'), { recursive: true });
    await mkdir(join(source, 'payment-proofs'));
    await mkdir(target);
    await writeFile(join(source, 'menu-images', name), 'menu bytes');
    await writeFile(join(source, 'payment-proofs', name), 'private proof bytes');
    await writeFile(join(source, '.env'), 'MUST NOT BE ARCHIVED');
    const file = join(root, 'runtime.jsonl');
    await fileBackup(source, file);
    assert.deepEqual(await validateRuntimeArchive(file), { files: 2 });
    assert.ok(!(await readFile(file, 'utf8')).includes('MUST NOT BE ARCHIVED'));
    assert.deepEqual(await restoreRuntimeFiles(target, file), { files: 2 });
    assert.equal(
      await readFile(join(target, 'payment-proofs', name), 'utf8'),
      'private proof bytes',
    );
    assert.deepEqual((await readdir(target)).sort(), ['menu-images', 'payment-proofs']);
    await assert.rejects(restoreRuntimeFiles(target, file), /empty/);
    assert.equal(await readFile(join(target, 'menu-images', name), 'utf8'), 'menu bytes');
  }));
test('archive validation rejects corruption, duplicates and unsafe paths before any target write', async () =>
  temporary(async (root) => {
    const target = join(root, 'target');
    await mkdir(target);
    const good = entry('menu-images/' + name),
      file = join(root, 'archive.jsonl');
    for (const entries of [
      [{ ...good, path: '../.env' }],
      [good, good],
      [{ ...good, sha256: '0'.repeat(64) }],
      [{ ...good, size: good.size + 1 }],
      [{ ...good, data: good.data + '=' }],
      [{ ...good, extra: 'secret' }],
      [{ ...good, size: 2 * 1024 * 1024 + 1 }],
    ]) {
      await archive(file, entries);
      await assert.rejects(restoreRuntimeFiles(target, file));
      assert.deepEqual(await readdir(target), []);
    }
  }));
test('runtime restore and backup refuse symlink stores/files rather than follow them', async () =>
  temporary(async (root) => {
    const external = join(root, 'external'),
      target = join(root, 'target');
    await mkdir(external);
    await mkdir(target);
    await symlink(external, join(target, 'menu-images'));
    await assert.rejects(assertRuntimeEmpty(target));
    await rm(join(target, 'menu-images'));
    await mkdir(join(target, 'menu-images'));
    await writeFile(join(external, name), 'private external data');
    await symlink(join(external, name), join(target, 'menu-images', name));
    await assert.rejects(fileBackup(target, join(root, 'bad-backup.jsonl')));
  }));
test('bundle manifest requires both exact payloads, valid checksums and safe regular files', async () =>
  temporary(async (root) => {
    const database = join(root, 'database.dump'),
      runtime = join(root, 'runtime-files.jsonl');
    await writeFile(database, 'PGDMP isolated test placeholder', { mode: 0o600 });
    await archive(runtime, [entry('payment-proofs/' + name)]);
    const manifest = {
      format: 'qtruongres-backup-v1',
      project: 'qtruongres',
      postgresMajor: 18,
      files: {
        'database.dump': await hashFile(database),
        'runtime-files.jsonl': await hashFile(runtime),
      },
    };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.equal((await validateRestoreBundle(root)).root, root);
    await writeFile(database, 'changed');
    await assert.rejects(validateRestoreBundle(root), /checksum/);
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({ ...manifest, project: 'development' }),
    );
    await assert.rejects(validateRestoreBundle(root), /Unsupported/);
    await chmod(join(root, 'manifest.json'), 0o600);
  }));

test('validated production values override inherited settings and remove all ambient Compose controls', () => {
  const child = buildChildEnvironment(
    {
      PATH: '/bin',
      HOME: '/home/operator',
      DOCKER_CONTEXT: 'local-context',
      COMPOSE_FILE: 'dev.yaml',
      COMPOSE_PROFILES: 'tunnel',
      COMPOSE_PROJECT_NAME: 'dev',
      DATABASE_URL: 'ambient-dev-url',
      POSTGRES_PASSWORD: 'ambient',
      PAYOS_ENABLED: 'true',
      MENU_ASSISTANT_MODE: 'CUSTOM',
      APP_ORIGINS: 'http://unexpected',
    },
    env(),
  );
  assert.equal(child.DATABASE_URL, env().DATABASE_URL);
  assert.equal(child.POSTGRES_PASSWORD, env().POSTGRES_PASSWORD);
  assert.equal(child.PAYOS_ENABLED, 'false');
  assert.equal(child.MENU_ASSISTANT_MODE, 'OFF');
  assert.equal(child.PATH, '/bin');
  assert.equal(child.HOME, '/home/operator');
  assert.equal(child.DOCKER_CONTEXT, 'local-context');
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME', 'APP_ORIGINS'])
    assert.equal(child[key], undefined);
  assert.throws(() => buildChildEnvironment({}, { ...env(), COMPOSE_PROFILES: 'tunnel' }));
  assert.equal(
    validateDockerExecutable('C:\\Program Files\\Docker\\docker.exe'),
    'C:\\Program Files\\Docker\\docker.exe',
  );
  assert.throws(() => validateDockerExecutable('docker --context remote'));
  assert.throws(() => validateDockerExecutable('docker -H tcp://remote'));
});
test('backup guard refuses an active one-shot migration', () => {
  requireNoMigration(['postgres', 'api']);
  assert.throws(() => requireNoMigration(['postgres', 'migrate']), /migration/);
});
test('stream restore uses private data-root scratch and cleans it on successful or malformed input', async () =>
  temporary(async (root) => {
    const target = join(root, 'target');
    await mkdir(target);
    const archiveText = [
      JSON.stringify({ format: FILE_ARCHIVE_FORMAT }),
      JSON.stringify(entry('menu-images/' + name)),
      '',
    ].join('\n');
    assert.deepEqual(await restoreRuntimeStream(target, Readable.from([archiveText])), {
      files: 1,
    });
    assert.deepEqual((await readdir(target)).sort(), ['menu-images', 'payment-proofs']);
    await assert.rejects(restoreRuntimeStream(target, Readable.from(['not valid JSON'])));
    assert.deepEqual((await readdir(target)).sort(), ['menu-images', 'payment-proofs']);
  }));
test('restore orchestration never imports into running or nonempty targets', async () => {
  const calls = [];
  const ctx = {
    running: () => ['api'],
    compose: (args) => calls.push(['compose', args]),
    pg: (command, args) => {
      calls.push([command, args]);
      return '1';
    },
    fileHelper: (action) => calls.push(['files', action]),
  };
  await assert.rejects(restoreIntoEmptyTarget(ctx, { root: '/private/fixture' }), /Stop/);
  assert.deepEqual(calls, []);
  ctx.running = () => ['postgres'];
  await assert.rejects(restoreIntoEmptyTarget(ctx, { root: '/private/fixture' }), /user objects/);
  assert.ok(!calls.some(([command]) => command === 'pg_restore' || command === 'files'));
  assert.match(calls.find(([command]) => command === 'psql')[1].join(' '), /pg_catalog\.pg_proc/);
  assert.match(calls.find(([command]) => command === 'psql')[1].join(' '), /pg_catalog\.pg_type/);
});
test('DB/files restore failure is explicit and never starts writers or overwrites an existing target', async () => {
  const calls = [];
  const ctx = {
    running: () => ['postgres'],
    compose: (args) => calls.push(['compose', args]),
    pg: (command, args) => {
      calls.push([command, args]);
      return '0';
    },
    fileHelper: (action) => {
      calls.push(['files', action]);
      if (action === 'restore') throw Error('isolated file failure');
    },
  };
  await assert.rejects(
    restoreIntoEmptyTarget(ctx, { root: '/private/fixture' }),
    /may be partially restored/,
  );
  const restore = calls.find(
    ([command, args]) => command === 'pg_restore' && args.includes('--single-transaction'),
  );
  assert.ok(restore);
  assert.ok(restore[1].includes('--exit-on-error'));
  assert.ok(
    !calls.some(
      ([command, args]) =>
        command === 'compose' &&
        args.some((arg) => ['start', 'down', '--force-recreate'].includes(arg)),
    ),
  );
});
test('isolated deployment project names cannot target the development stack', () => {
  assert.equal(validateProjectName(), 'qtruongres');
  assert.equal(
    validateProjectName('qtruongres-rehearsal-20261016'),
    'qtruongres-rehearsal-20261016',
  );
  for (const value of [
    'qr-ordering-thesis',
    'postgres',
    'qtruongres-',
    '../qtruongres',
    'qtruongres;bad',
    'qtruongres-' + 'a'.repeat(42),
  ])
    assert.throws(() => validateProjectName(value));
  assert.equal(
    validateEnvironment({ ...env(), QTRUONGRES_PROJECT_NAME: 'qtruongres-isolated' }).projectName,
    'qtruongres-isolated',
  );
});
test('production image builds run sequentially instead of competing for VM memory', () => {
  const calls = [];
  buildImages({ compose: (args) => calls.push(args) });
  assert.deepEqual(calls, [
    ['--profile', 'maintenance', 'build', 'api'],
    ['--profile', 'maintenance', 'build', 'migrate'],
    ['--profile', 'maintenance', 'build', 'web'],
    ['--profile', 'maintenance', 'build', 'caddy'],
  ]);
});

test('Docker Desktop plugin discovery keeps standard Windows installation roots without application overrides', () => {
  const child = buildChildEnvironment(
    {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramW6432: 'C:\\Program Files',
      COMPOSE_FILE: 'development.yaml',
      DATABASE_URL: 'development',
    },
    env(),
  );
  assert.equal(child.ProgramFiles, 'C:\\Program Files');
  assert.equal(child['ProgramFiles(x86)'], 'C:\\Program Files (x86)');
  assert.equal(child.ProgramW6432, 'C:\\Program Files');
  assert.equal(child.COMPOSE_FILE, undefined);
  assert.equal(child.DATABASE_URL, env().DATABASE_URL);
});

test('production dependency steps share a persistent store and bounded network policy without weakening install security', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const expectedMount = 'type=cache,id=qtruongres-pnpm-v12,target=/pnpm/store,sharing=locked';
  const mounts = [];
  for (const [kind, expectedSteps] of [
    ['api', 2],
    ['web', 1],
  ]) {
    const source = await readFile(
      new URL('../deploy/docker/Dockerfile.' + kind, import.meta.url),
      'utf8',
    );
    const instructions = source.replace(/\\\r?\n\s*/g, ' ').split('\n');
    const steps = instructions.filter(
      (line) => /^RUN /.test(line) && /pnpm .*\b(install|deploy)\b/.test(line),
    );
    assert.equal(
      steps.length,
      expectedSteps,
      kind + ' must include install and any deploy download',
    );
    assert.ok(
      source.includes('pnpm@' + manifest.packageManager.split('@')[1]),
      kind + ' keeps the project package manager pin',
    );
    assert.ok(
      source.includes(' AS dependencies'),
      kind + ' supports a dependency-only validation target',
    );
    for (const step of steps) {
      assert.ok(
        step.includes('--mount=' + expectedMount),
        kind + ' shares the trusted builder cache',
      );
      assert.ok(
        step.includes('--store-dir=/pnpm/store'),
        kind + ' actually uses the mounted store',
      );
      assert.ok(step.includes('--frozen-lockfile'), kind + ' never rewrites the lockfile');
      assert.ok(
        step.includes('pnpm_config_package_import_method=copy'),
        kind + ' materializes dependencies outside the cache',
      );
      const setting = (name) =>
        Number(step.match(new RegExp('pnpm_config_' + name + '=(\\d+)'))?.[1]);
      assert.ok(setting('network_concurrency') >= 1 && setting('network_concurrency') <= 4);
      assert.ok(setting('fetch_timeout') >= 180000 && setting('fetch_timeout') <= 300000);
      assert.ok(setting('fetch_retries') >= 2 && setting('fetch_retries') <= 4);
      assert.ok(setting('fetch_retry_factor') >= 1 && setting('fetch_retry_factor') <= 2);
      assert.ok(setting('fetch_retry_mintimeout') >= 1000);
      assert.ok(setting('fetch_retry_maxtimeout') >= setting('fetch_retry_mintimeout'));
      assert.ok(setting('fetch_retry_maxtimeout') <= 60000);
      assert.doesNotMatch(
        step,
        /--(no-frozen-lockfile|ignore-scripts|ignore-manifest-check|offline)(?:\s|$)/,
      );
      assert.doesNotMatch(
        step,
        /(?:strict_ssl|verify_store_integrity|strict_store_pkg_content_check)=false/,
      );
      mounts.push(expectedMount);
    }
    assert.doesNotMatch(
      source,
      /NODE_TLS_REJECT_UNAUTHORIZED|dangerouslyAllowAllBuilds|strict-ssl=false/,
    );
  }
  assert.equal(mounts.length, 3);
});

test('maintenance migrations gain read/traverse access in the build stage without application write access', async () => {
  const source = await readFile(
    new URL('../deploy/docker/Dockerfile.api', import.meta.url),
    'utf8',
  );
  const dockerfile = source.replace(/\r\n/g, '\n');
  const build = dockerfile
    .split('FROM dependencies AS source\n')[1]
    ?.split('FROM source AS maintenance')[0];
  assert.ok(build, 'permissions are established before the maintenance image');
  const instructions = build.replace(/\\\r?\n\s*/g, ' ').split('\n');
  const permissions = instructions.find((line) => /^RUN chmod /.test(line));
  assert.ok(permissions, 'normalize copied permissions during the build');
  for (const parent of [
    '/workspace',
    '/workspace/packages',
    '/workspace/packages/database',
    '/workspace/packages/database/prisma',
  ]) {
    assert.ok(
      permissions.split(' && ')[0].split(/\s+/).includes(parent),
      parent + ' is traversable',
    );
  }
  assert.match(permissions, /chmod 0755 /);
  assert.match(
    permissions,
    /find packages\/database\/prisma\/migrations -type d -exec chmod 0755 \{\} \+/,
  );
  assert.match(
    permissions,
    /find packages\/database\/prisma\/migrations -type f -exec chmod 0644 \{\} \+/,
  );
  assert.doesNotMatch(permissions, /(?:0777|chmod.*(?:a\+w|o\+w)|chown)/);
  const maintenance = dockerfile
    .split('FROM source AS maintenance\n')[1]
    ?.split('FROM source AS production-dependencies')[0];
  assert.match(maintenance, /USER 10001:10001/);
});

test('API runtime code is group-readable and root-owned after every artifact copy', async () => {
  const source = await readFile(
    new URL('../deploy/docker/Dockerfile.api', import.meta.url),
    'utf8',
  );
  const runtime = source.replace(/\r\n/g, '\n').split(' AS runtime\n')[1];
  const instructions = runtime.replace(/\\\r?\n\s*/g, ' ').split('\n');
  const copies = instructions.filter((line) => line.startsWith('COPY '));
  assert.equal(
    copies.length,
    5,
    'cover deploy output plus generated client/resources/config/runtime helper',
  );
  for (const copy of copies) assert.match(copy, /^COPY --chown=0:10001 --from=/);
  const permissions = instructions.find((line) => /^RUN chown 0:10001 \/app /.test(line));
  assert.match(permissions, /chmod -R u=rwX,g=rX,o= \/app$/);
  assert.ok(instructions.lastIndexOf(copies.at(-1)) < instructions.indexOf(permissions));
  assert.deepEqual(
    instructions.filter((line) => line.startsWith('USER ')),
    ['USER 10001:10001'],
  );
  assert.ok(instructions.indexOf(permissions) < instructions.indexOf('USER 10001:10001'));
  assert.doesNotMatch(runtime, /chmod\s+(?:-R\s+)?0?777\b/);
  const compose = await readFile(new URL('../compose.production.yaml', import.meta.url), 'utf8');
  const api = compose.replace(/\r\n/g, '\n').split('\n  api:\n')[1]?.split('\n  web:\n')[0];
  assert.match(api, /read_only: true/);
  assert.match(api, /cap_drop: \[ALL\]/);
  assert.match(api, /no-new-privileges:true/);
});

// Run against a locally built candidate: QTRUONGRES_API_TEST_IMAGE=<image> pnpm test:deploy
test(
  'API runtime image reads its full dependency tree and imports boot modules as UID 10001',
  {
    skip: !process.env.QTRUONGRES_API_TEST_IMAGE,
    timeout: 90000,
  },
  () => {
    const image = process.env.QTRUONGRES_API_TEST_IMAGE;
    assert.match(image, /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/);
    const result = spawnSync(
      'docker',
      [
        'run',
        '--pull=never',
        '--rm',
        '-i',
        '--network',
        'none',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--entrypoint',
        'node',
        image,
        '--import',
        'tsx',
        '--input-type=module',
      ],
      {
        encoding: 'utf8',
        timeout: 80000,
        input: `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import path from 'node:path';
      assert.equal(process.getuid(), 10001);
      assert.equal(process.getgid(), 10001);
      let files = 0;
      let directories = 0;
      function walk(dir) {
        const stat = fs.statSync(dir);
        assert.equal(stat.uid, 0, dir + ' remains root-owned');
        assert.equal(stat.gid, 10001, dir + ' is accessible to the app group');
        assert.equal(stat.mode & 0o027, 0, dir + ' grants no group write or other access');
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK);
        directories++;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) {
            const target = fs.realpathSync(file);
            assert.ok(target.startsWith('/app/'), file + ' resolves inside the packaged app');
            fs.accessSync(target, fs.constants.R_OK);
          } else if (entry.isDirectory()) walk(file);
          else {
            assert.ok(entry.isFile(), file);
            const info = fs.statSync(file);
            assert.equal(info.uid, 0, file);
            assert.equal(info.gid, 10001, file);
            assert.equal(info.mode & 0o027, 0, file + ' is not writable by the app');
            fs.readFileSync(file);
            files++;
          }
        }
      }
      walk('/app');
      for (const name of ['@thesis/contracts', '@thesis/database', 'fastify', '@fastify/cookie', '@payos/node', 'jose', './src/auth.ts', './src/config.ts', './src/modules/index.ts', './deploy/runtime-files.mjs']) await import(name);
      const { hash, verify } = await import('@thesis/database');
      const encoded = await hash('runtime permission smoke');
      assert.ok(await verify(encoded, 'runtime permission smoke'));
      const { buildApp } = await import('./src/app.ts');
      const app = buildApp({ ping: async () => {} });
      try {
        assert.equal((await app.inject({ url: '/health/live' })).statusCode, 200);
        assert.equal((await app.inject({ url: '/health/ready' })).statusCode, 200);
      } finally { await app.close(); }
      console.log(JSON.stringify({ uid: process.getuid(), gid: process.getgid(), files, directories, imports: 'passed', nativeAddon: 'passed', fastifyHealth: 'passed' }));
    `,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.uid, 10001);
    assert.equal(summary.gid, 10001);
    assert.ok(summary.files > 0);
    console.log('API runtime permissions smoke: ' + JSON.stringify(summary));
  },
);
