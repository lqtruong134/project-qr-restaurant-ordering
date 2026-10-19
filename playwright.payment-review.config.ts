import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Deliberately independent of playwright.config.ts and scripts/run.mjs: neither .env nor a live API is used.
const root = fileURLToPath(new URL('.', import.meta.url));
const web = join(root, 'apps', 'web');
const baseURL = 'http://127.0.0.1:3334';
let database: URL;
try {
  const value = process.env.PAYMENT_REVIEW_DATABASE_URL;
  if (!value || value.length > 4096) throw new Error();
  database = new URL(value);
} catch {
  throw new Error(
    'Set PAYMENT_REVIEW_DATABASE_URL explicitly to a disposable loopback PostgreSQL test server.',
  );
}
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
  database.pathname.length <= 1 ||
  database.search ||
  database.hash
)
  throw new Error(
    'PAYMENT_REVIEW_DATABASE_URL must name a loopback PostgreSQL test database without URL query overrides.',
  );
// Next reads these files automatically in its own working directory. Refuse them rather than loading private settings.
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
  if (existsSync(join(web, name)))
    throw new Error(
      'Payment review requires apps/web without local .env files; use a clean test checkout.',
    );

for (const key of Object.keys(process.env))
  if (key.startsWith('PAYOS_') || key.startsWith('MENU_ASSISTANT_')) delete process.env[key];
Object.assign(process.env, {
  DATABASE_URL: database.href,
  AUTH_SECRET: randomBytes(64).toString('hex'),
  PAYOS_ENABLED: 'false',
  MENU_ASSISTANT_MODE: 'OFF',
  NODE_OPTIONS: '',
});
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default defineConfig({
  testDir: './tests/browser',
  testMatch: [
    'payment-experience.spec.ts',
    'payment-admin.spec.ts',
    'payos-live-flow.spec.ts',
    'payos-ui.spec.ts',
  ],
  outputDir: './test-results/payment-review',
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `"${process.execPath}" "${join(web, 'node_modules', 'next', 'dist', 'bin', 'next')}" dev --hostname 127.0.0.1 --port 3334`,
    cwd: web,
    env: {
      ...childEnvironment,
      NODE_ENV: 'development',
      NEXT_DIST_DIR: '.next-payment-review',
      API_BASE_URL: 'http://127.0.0.1:9',
      PUBLIC_APP_URL: baseURL,
    },
    url: baseURL,
    timeout: 120000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
});
