import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const issues = [];
const localSecrets = existsSync('.env')
  ? readFileSync('.env', 'utf8').split('\n').filter(line => /^(POSTGRES_PASSWORD|AUTH_SECRET|SEED_PASSWORD)=/.test(line)).map(line => line.slice(line.indexOf('=') + 1)).filter(value => value.length > 16)
  : [];
for (const file of files) {
  if (/(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example')) issues.push(file);
  const data = readFileSync(file, 'utf8');
  if (localSecrets.some(secret => data.includes(secret))) issues.push(file);
  if (/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(data) || /gh[pousr]_[A-Za-z0-9]{36,}/.test(data)) issues.push(file);
}
if (issues.length) { console.error('Potential secret files:', [...new Set(issues)].join(', ')); process.exit(1); }
console.log('Basic secret check passed. Review staged diff before committing; this is not a full security audit.');
