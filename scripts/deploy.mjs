import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, closeSync, openSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeArchive } from '../deploy/runtime-files.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const project = 'qtruongres';
const commands = [
  'validate',
  'build',
  'start',
  'stop',
  'status',
  'logs',
  'migrate',
  'health',
  'backup',
  'restore',
  'update',
];
const writers = ['api', 'web', 'caddy'];
export function parseOptions(argv) {
  const command = argv[0];
  if (!commands.includes(command))
    throw Error(
      'Use: deploy.mjs ' +
        commands.join('|') +
        ' [--env-file PATH] [--backup-dir PATH] [--from BACKUP] [--follow]',
    );
  const options = {
    command,
    envFile: 'deploy/.env.production',
    backupDir: 'var/backups/qtruongres',
    from: undefined,
    follow: false,
  };
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--follow') options.follow = true;
    else if (
      ['--env-file', '--backup-dir', '--from'].includes(flag) &&
      argv[index + 1] &&
      !argv[index + 1].startsWith('--')
    ) {
      const key = { '--env-file': 'envFile', '--backup-dir': 'backupDir', '--from': 'from' }[flag];
      options[key] = argv[++index];
    } else throw Error('Unknown or missing deployment option.');
  }
  if (command === 'restore' && !options.from)
    throw Error('Restore requires --from BACKUP_DIRECTORY.');
  return options;
}
export function parseEnvironment(text) {
  const result = {};
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1]))
      throw Error('Invalid or duplicate production environment entry.');
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (value.includes('${') || value.includes('\0') || /[\r\n]/.test(value))
      throw Error('Use literal production environment values without interpolation.');
    result[match[1]] = value;
  }
  return result;
}
export function validateProjectName(value = 'qtruongres') {
  if (typeof value !== 'string' || !/^qtruongres(?:-[a-z0-9][a-z0-9-]{0,40})?$/.test(value))
    throw Error('Project name must be qtruongres or a constrained qtruongres- rehearsal name.');
  return value;
}
export function validateEnvironment(env) {
  for (const name of ['POSTGRES_USER', 'POSTGRES_DB'])
    if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(env[name] ?? ''))
      throw Error('Configure valid ' + name + '.');
  for (const name of ['POSTGRES_PASSWORD', 'AUTH_SECRET'])
    if (!(env[name]?.length >= 32) || /CHANGE_ME|REPLACE|[<>]/i.test(env[name]))
      throw Error(
        'Configure a private strong ' +
          name +
          '; preserve AUTH_SECRET when importing existing data.',
      );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      env.RESTAURANT_ID ?? '',
    )
  )
    throw Error('Configure RESTAURANT_ID to match the imported restaurant.');
  let url, database;
  try {
    url = new URL(env.PUBLIC_APP_URL);
    database = new URL(env.DATABASE_URL);
  } catch {
    throw Error('Configure PUBLIC_APP_URL and DATABASE_URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('PUBLIC_APP_URL must be an HTTPS origin.');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    database.hostname !== 'postgres' ||
    (database.port && database.port !== '5432') ||
    decodeURIComponent(database.username) !== env.POSTGRES_USER ||
    decodeURIComponent(database.password) !== env.POSTGRES_PASSWORD ||
    decodeURIComponent(database.pathname.slice(1)) !== env.POSTGRES_DB
  )
    throw Error(
      'DATABASE_URL must match the private postgres service and configured database credentials.',
    );
  if ((env.MENU_ASSISTANT_MODE ?? 'OFF') !== 'OFF')
    throw Error('Keep MENU_ASSISTANT_MODE=OFF for this deployment stage.');
  if (!['true', 'false'].includes(env.PAYOS_ENABLED ?? 'false'))
    throw Error('PAYOS_ENABLED must be true or false.');
  if (env.PAYOS_ENABLED === 'true') {
    for (const name of ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'])
      if (!env[name]) throw Error('Configure payOS privately before enabling it.');
    for (const name of ['PAYOS_RETURN_URL', 'PAYOS_CANCEL_URL', 'PAYOS_WEBHOOK_URL']) {
      let callback;
      try {
        callback = new URL(env[name]);
      } catch {
        throw Error('Configure HTTPS payOS callback URLs.');
      }
      if (
        callback.protocol !== 'https:' ||
        callback.origin !== url.origin ||
        callback.username ||
        callback.password
      )
        throw Error('payOS callbacks must use the public HTTPS origin.');
    }
  }
  const port = Number(env.QTRUONGRES_CADDY_PORT ?? 8088);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error('QTRUONGRES_CADDY_PORT must be 1024..65535.');
  return {
    port,
    publicOrigin: url.origin,
    projectName: validateProjectName(env.QTRUONGRES_PROJECT_NAME),
  };
}
export async function resolveProductionEnv(file, root = repository) {
  const absolute = resolve(root, file);
  if (absolute === resolve(root, '.env') || (await realpath(absolute)) === resolve(root, '.env'))
    throw Error('Refusing to read the development .env; use a separate production file.');
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw Error('Production env must be a regular private file.');
  return absolute;
}
export async function hashFile(file) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}
export async function validateRestoreBundle(directory) {
  const root = resolve(directory);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(root)) !== root)
    throw Error('Backup must be a real directory.');
  const manifestFile = join(root, 'manifest.json');
  const manifestInfo = await lstat(manifestFile);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 16384)
    throw Error('Invalid backup manifest.');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  } catch {
    throw Error('Invalid backup manifest JSON.');
  }
  if (
    manifest.format !== 'qtruongres-backup-v1' ||
    manifest.project !== project ||
    manifest.postgresMajor !== 18 ||
    Object.keys(manifest.files ?? {})
      .sort()
      .join(',') !== 'database.dump,runtime-files.jsonl'
  )
    throw Error('Unsupported backup manifest.');
  for (const name of ['database.dump', 'runtime-files.jsonl']) {
    const file = join(root, name),
      info = await lstat(file),
      expected = manifest.files[name];
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !expected ||
      !Number.isSafeInteger(expected.size) ||
      expected.size < 1 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    )
      throw Error('Invalid backup payload.');
    const actual = await hashFile(file);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256)
      throw Error('Backup checksum mismatch; restore refused.');
  }
  await validateRuntimeArchive(join(root, 'runtime-files.jsonl'));
  return { root, manifest };
}
export function buildChildEnvironment(parent, production) {
  const allowed = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TEMP',
    'TMP',
    'TMPDIR',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    // Docker Desktop discovers CLI plugins under these standard Windows install roots.
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'DOCKER_BIN',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
    'DOCKER_API_VERSION',
    'DOCKER_BUILDKIT',
    'BUILDKIT_PROGRESS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]);
  const child = Object.fromEntries(
    Object.entries(parent).filter(([name]) => allowed.has(name.toUpperCase())),
  );
  for (const name of Object.keys(production))
    if (name.startsWith('COMPOSE_'))
      throw Error('Compose control variables are managed by the deployment CLI.');
  return { ...child, PAYOS_ENABLED: 'false', MENU_ASSISTANT_MODE: 'OFF', ...production };
}
export function validateDockerExecutable(value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\0\r\n]/.test(value) ||
    /\s--?[A-Za-z]/.test(value)
  )
    throw Error('DOCKER_BIN must be one executable path without command flags.');
  return value;
}
export function requireNoMigration(running) {
  if (running.includes('migrate')) throw Error('Wait for the active migration job before backup.');
}
export const emptyDatabaseQuery = `SELECT count(*) FROM (
  SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
  UNION ALL SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
  UNION ALL SELECT t.oid FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
  UNION ALL SELECT c.oid FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
  UNION ALL SELECT n.oid FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','public') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
  UNION ALL SELECT e.oid FROM pg_catalog.pg_extension e WHERE e.extname<>'plpgsql'
) AS existing_objects`;

export function requireStopped(running) {
  if (writers.some((service) => running.includes(service)) || running.includes('migrate'))
    throw Error('Stop api/web/caddy and migration jobs before restore or migration.');
}
function redact(text, env) {
  let result = String(text ?? '');
  for (const [name, value] of Object.entries(env))
    if (/(PASSWORD|SECRET|TOKEN|API_KEY|CHECKSUM_KEY|DATABASE_URL)/.test(name) && value.length >= 8)
      result = result.replaceAll(value, '[REDACTED]');
  return result;
}
async function context(options) {
  const envFile = await resolveProductionEnv(options.envFile);
  const env = parseEnvironment(await readFile(envFile, 'utf8'));
  const config = validateEnvironment(env);
  const docker = validateDockerExecutable(process.env.DOCKER_BIN || 'docker');
  const childEnvironment = buildChildEnvironment(process.env, env);
  const envArgument = relative(repository, envFile) || '.';
  const base = [
    'compose',
    '--project-name',
    config.projectName,
    '--env-file',
    envArgument,
    '-f',
    'compose.production.yaml',
  ];
  function run(executable, args, io = {}) {
    let input, output;
    try {
      if (io.inputFile) input = openSync(io.inputFile, 'r');
      if (io.outputFile) output = openSync(io.outputFile, 'wx', 0o600);
      const result = spawnSync(executable, args, {
        cwd: repository,
        env: childEnvironment,
        stdio: [input ?? 'ignore', output ?? 'pipe', 'pipe'],
        encoding: output ? undefined : 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      const stdout = output ? '' : redact(result.stdout, env);
      const stderr = redact(result.stderr, env);
      if (!io.quiet && stdout) process.stdout.write(stdout);
      if (result.error || result.status !== 0) {
        if (stderr) process.stderr.write(stderr);
        throw Error(
          'Deployment command failed; inspect private logs and current service/data state before retrying.',
        );
      }
      return stdout;
    } finally {
      if (input !== undefined) closeSync(input);
      if (output !== undefined) closeSync(output);
    }
  }
  const compose = (args, io) => run(docker, [...base, ...args], io);
  compose(['config', '--quiet'], { quiet: true });
  const running = () =>
    compose(['ps', '--all', '--status', 'running', '--services'], { quiet: true })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const pg = (command, args = [], io) =>
    compose(
      [
        'exec',
        '-T',
        'postgres',
        command,
        '--no-password',
        '--username',
        env.POSTGRES_USER,
        '--dbname',
        env.POSTGRES_DB,
        ...args,
      ],
      io,
    );
  const fileHelper = (action, io) =>
    compose(
      [
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--entrypoint',
        'node',
        'api',
        '/app/deploy/runtime-files.mjs',
        action,
      ],
      io,
    );
  async function logs(follow) {
    const child = spawn(
      docker,
      [...base, 'logs', '--tail', '100', ...(follow ? ['--follow'] : [])],
      { cwd: repository, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const done = new Promise((resolveExit, reject) => {
      child.once('error', () => reject(Error('Unable to start Docker logs.')));
      child.once('close', (status) =>
        status === 0 ? resolveExit() : reject(Error('Docker logs stopped.')),
      );
    });
    async function print(stream, target) {
      for await (const line of createInterface({ input: stream, crlfDelay: Infinity }))
        target.write(redact(line, env) + '\n');
    }
    await Promise.all([
      done,
      print(child.stdout, process.stdout),
      print(child.stderr, process.stderr),
    ]);
  }
  return { env, config, compose, running, pg, fileHelper, run, logs };
}
async function backup(ctx, options, stopped = false) {
  const running = ctx.running();
  requireNoMigration(running);
  const previous = stopped ? [] : running.filter((service) => writers.includes(service));
  if (previous.length) {
    console.log('Brief maintenance: stopping app writers for a consistent database/files backup.');
    ctx.compose(['stop', '--timeout', '30', ...previous]);
  }
  let destination;
  try {
    ctx.compose(['up', '-d', '--wait', 'postgres']);
    const base = resolve(repository, options.backupDir);
    await mkdir(base, { recursive: true, mode: 0o700 });
    destination = join(
      base,
      new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex'),
    );
    await mkdir(destination, { mode: 0o700 });
    await chmod(destination, 0o700);
    ctx.pg('pg_dump', ['--format=custom', '--no-owner', '--no-privileges'], {
      outputFile: join(destination, 'database.dump'),
    });
    ctx.fileHelper('backup', { outputFile: join(destination, 'runtime-files.jsonl') });
    await validateRuntimeArchive(join(destination, 'runtime-files.jsonl'));
    const commit = ctx.run('git', ['rev-parse', 'HEAD'], { quiet: true }).trim();
    const manifest = {
      format: 'qtruongres-backup-v1',
      project,
      sourceProject: ctx.config.projectName,
      postgresMajor: 18,
      createdAt: new Date().toISOString(),
      gitCommit: commit,
      files: {
        'database.dump': await hashFile(join(destination, 'database.dump')),
        'runtime-files.jsonl': await hashFile(join(destination, 'runtime-files.jsonl')),
      },
    };
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log('Private backup complete: ' + destination);
    console.log(
      'Database/files remain sensitive. Infrastructure credentials are excluded; preserve AUTH_SECRET separately.',
    );
    return destination;
  } catch (error) {
    if (destination)
      console.error(
        'Incomplete backup kept for diagnosis, without a valid completed manifest: ' + destination,
      );
    throw error;
  } finally {
    if (previous.length) ctx.compose(['start', ...previous]);
  }
}
async function health(ctx) {
  ctx.pg('psql', ['-At', '--command', 'SELECT 1'], { quiet: true });
  for (const path of ['/', '/api/health/live', '/api/health/ready']) {
    const result = await fetch('http://127.0.0.1:' + ctx.config.port + path, {
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    });
    if (result.status !== 200)
      throw Error('Health failed through the local reverse proxy: ' + path);
    if (path !== '/' && (await result.json()).service !== 'api')
      throw Error('Reverse proxy did not reach API health.');
  }
  console.log('Web, API live/ready, PostgreSQL and local reverse proxy are healthy.');
}
export function buildImages(ctx) {
  // Keep Next.js and dependency builds from competing for the laptop VM's memory.
  for (const service of ['api', 'migrate', 'web', 'caddy'])
    ctx.compose(['--profile', 'maintenance', 'build', service]);
}
async function migrate(ctx) {
  requireStopped(ctx.running());
  ctx.compose(['up', '-d', '--wait', 'postgres']);
  ctx.compose(['--profile', 'maintenance', 'run', '--rm', 'migrate']);
}
export async function restoreIntoEmptyTarget(ctx, bundle) {
  requireStopped(ctx.running());
  ctx.compose(['up', '-d', '--wait', 'postgres']);
  const objects = ctx.pg('psql', ['-At', '--command', emptyDatabaseQuery], { quiet: true }).trim();
  if (objects !== '0')
    throw Error(
      'Restore refused: target database has user objects. No overwrite option is provided.',
    );
  ctx.fileHelper('check-empty');
  ctx.pg('pg_restore', ['--list'], { inputFile: join(bundle.root, 'database.dump'), quiet: true });
  console.log('Restoring trusted private backup into empty target; writers will remain stopped.');
  try {
    ctx.pg(
      'pg_restore',
      ['--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges'],
      { inputFile: join(bundle.root, 'database.dump') },
    );
    ctx.fileHelper('restore', { inputFile: join(bundle.root, 'runtime-files.jsonl') });
  } catch {
    throw Error(
      'Restore failed; writers remain stopped. Database and files are separate resources and may be partially restored. Do not overwrite or retry a nonempty target: inspect private backup/logs and recover into fresh empty volumes.',
    );
  }
  console.log(
    'Restore complete. Preserve source AUTH_SECRET privately, then run start and health.',
  );
}
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const ctx = await context(options);
  if (options.command === 'validate')
    console.log('Production environment and compose syntax are valid; no secret values displayed.');
  else if (options.command === 'build') buildImages(ctx);
  else if (options.command === 'start')
    ctx.compose(['up', '-d', '--wait', 'postgres', 'api', 'web', 'caddy']);
  else if (options.command === 'stop') ctx.compose(['stop', '--timeout', '30']);
  else if (options.command === 'status') ctx.compose(['ps', '--all']);
  else if (options.command === 'logs') {
    // Docker logs may contain private operational details; do not publish them unreviewed.
    await ctx.logs(options.follow);
  } else if (options.command === 'migrate') await migrate(ctx);
  else if (options.command === 'health') await health(ctx);
  else if (options.command === 'backup') await backup(ctx, options);
  else if (options.command === 'restore') {
    const bundle = await validateRestoreBundle(resolve(repository, options.from));
    await restoreIntoEmptyTarget(ctx, bundle);
  } else if (options.command === 'update') {
    if (ctx.run('git', ['status', '--porcelain'], { quiet: true }).trim())
      throw Error('Update requires a clean working tree.');
    const previous = ctx.running().filter((service) => writers.includes(service));
    if (previous.length) ctx.compose(['stop', '--timeout', '30', ...previous]);
    try {
      await backup(ctx, options, true);
      ctx.run('git', ['pull', '--ff-only']);
      buildImages(ctx);
      await migrate(ctx);
      ctx.compose(['up', '-d', '--wait', 'postgres', 'api', 'web', 'caddy']);
      await health(ctx);
    } catch (error) {
      ctx.compose(['stop', '--timeout', '30', ...writers]);
      console.error(
        'Update stopped safely. App writers remain stopped; inspect the private backup and migration state before recovery.',
      );
      throw error;
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
