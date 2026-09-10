import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (!existsSync('.env')) { console.error('Run pnpm setup first.'); process.exit(1); }
process.loadEnvFile('.env');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
const mode = process.argv[2];
if (mode === 'db-up') run('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '90']);
else if (mode === 'db-down') run('docker', ['compose', 'down']);
else if (mode === 'db-check') run('pnpm', ['exec', 'tsx', 'scripts/db-check.ts']);
else if (mode === 'integration') run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts']);
else if (mode === 'dev') {
  const children = [
    spawn('pnpm', ['--filter', '@thesis/api', 'dev'], { stdio: 'inherit', detached: true }),
    spawn('pnpm', ['--filter', '@thesis/web', 'dev', '--port', process.env.WEB_PORT ?? '3000'], { stdio: 'inherit', detached: true }),
  ];
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
    process.exitCode = code;
  }
  process.once('SIGINT', () => stop(0)); process.once('SIGTERM', () => stop(0));
  for (const child of children) {
    child.once('error', () => stop(1));
    child.once('exit', code => { if (!stopping) stop(code ?? 1); });
  }
} else { console.error('Unknown command'); process.exit(1); }
