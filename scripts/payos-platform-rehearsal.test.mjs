import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseRehearsalArgs, validateRehearsalTarget } from './payos-platform-rehearsal.mjs';

const container = 'qtruongres-payos-platform-lab-20261023';
const args = ['--isolated-rehearsal', '--container', container];
const url = 'postgresql://isolated_test:isolated_platform_test_only@127.0.0.1:64374/postgres';
const inventory = () => ({
  labels: { 'codex.task': 'payos-platform-rehearsal-20261023' },
  mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql' }],
  tmpfs: { '/var/lib/postgresql': 'rw,nosuid,size=768m' },
  ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '64374' }] },
});
test('rehearsal parser accepts only explicit synthetic lab mode and generated lab namespace', () => {
  assert.deepEqual(parseRehearsalArgs(args), { container });
  for (const invalid of [
    [],
    ['--execute'],
    ['--isolated-rehearsal', '--container', 'qtruongres-postgres-1'],
    [...args, '--from', '/private/production'],
    [...args, '--database', 'production'],
    ['--isolated-rehearsal', '--container', 'qtruongres-payos-platform-lab-20261023;exec'],
  ])
    assert.throws(() => parseRehearsalArgs(invalid), /ARGUMENTS_REQUIRED/);
});
test('rehearsal target requires loopback synthetic URL matching actual labeled tmpfs container', () => {
  assert.equal(validateRehearsalTarget(url, inventory()).port, '64374');
  for (const unsafe of [
    url.replace('127.0.0.1', 'production.example'),
    url.replace('isolated_test:', 'admin:'),
    url.replace('isolated_platform_test_only', 'private-bank-password'),
    url.replace('/postgres', '/qtruongres'),
    url + '?options=anything',
    url.replace(':64374', ':5432'),
  ])
    assert.throws(() => validateRehearsalTarget(unsafe, inventory()), /TARGET_REQUIRED/);
});
test('rehearsal target rejects production/missing labels, durable/bind volumes and public ports', () => {
  for (const change of [
    { labels: {} },
    { labels: { 'codex.task': 'production' } },
    { mounts: [{ Type: 'volume' }] },
    { mounts: [{ Type: 'bind' }] },
    { tmpfs: {} },
    { ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '64374' }] } },
    {
      ports: {
        '5432/tcp': [
          { HostIp: '127.0.0.1', HostPort: '64374' },
          { HostIp: '::', HostPort: '64374' },
        ],
      },
    },
  ])
    assert.throws(
      () => validateRehearsalTarget(url, { ...inventory(), ...change }),
      /TARGET_REQUIRED/,
    );
});
test('invalid rehearsal CLI fails before Docker/database access and never prints supplied private settings', () => {
  const marker = 'PRIVATE_REHEARSAL_URL_MUST_NOT_APPEAR';
  const child = spawnSync(process.execPath, ['scripts/payos-platform-rehearsal.mjs', '--execute'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: marker },
    timeout: 10000,
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /ISOLATED_PLATFORM_REHEARSAL_FAILED/);
  assert.equal(child.stderr.includes(marker), false);
});
