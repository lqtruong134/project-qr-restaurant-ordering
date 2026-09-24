import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDatabase } from '../packages/database/src/index.js';
const host = createDatabase(process.env.DATABASE_URL!);
const name = 'thesis_browser_' + randomBytes(8).toString('hex');
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  SEED_PASSWORD: randomBytes(24).toString('hex'),
  WEB_PORT: '13100',
  API_PORT: '14100',
  API_BASE_URL: 'http://127.0.0.1:14100',
  APP_ORIGINS: 'http://127.0.0.1:13100,http://localhost:13100',
  CI: '1',
  NEXT_DIST_DIR: '.next-e2e',
};
function run(args: string[]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Browser verification command failed');
}
try {
  await host.pool.query('CREATE DATABASE ' + name);
  run(['db:migrate']);
  run(['db:seed:core']);
  run(['exec', 'playwright', 'test', ...process.argv.slice(2)]);
} catch {
  process.exitCode = 1;
} finally {
  await host.pool.query('DROP DATABASE ' + name + ' WITH (FORCE)');
  await host.close();
}
