import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env already exists; preserved.');
} else {
  const secret = randomBytes(24).toString('hex');
  writeFileSync('.env', readFileSync('.env.example', 'utf8').replaceAll('CHANGE_ME', secret), { mode: 0o600, flag: 'wx' });
  console.log('Created private local .env. Next: pnpm db:up && pnpm dev');
}
