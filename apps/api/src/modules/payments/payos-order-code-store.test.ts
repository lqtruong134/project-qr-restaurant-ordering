import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseOrderCodeStoreArgs,
  readOrderCodeDatabaseFloor,
  openOrderCodeStoreRuntime,
  runOrderCodeStoreCli,
} from '../../../../../scripts/payos-order-code-store.js';
import { allocatePayosOrderCode } from './payos-order-code.js';

const roots: string[] = [];
const channelId = 'synthetic-cli-private-client-canary';
const args = (value = '1000') => [
  'initialize',
  '--high-water=' + value,
  '--confirm-channel-history',
];
function fixture(floor: unknown = '1000', queryFailure?: string) {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (queryFailure && sql.includes(queryFailure))
        throw Error('postgresql://private-password@private-host/client-account-canary');
      if (sql.startsWith('SELECT COALESCE')) return { rows: [{ floor }] };
      return { rows: [] };
    },
    release: vi.fn(),
  };
  const runtime = {
    pool: { connect: vi.fn(async () => client) },
    channelId,
    storePath: '/synthetic-private/order-code-store.sqlite',
    close: vi.fn(async () => {}),
  };
  const lines: string[] = [];
  const output = {
    log: vi.fn((message: string) => {
      lines.push(message);
    }),
    error: vi.fn((message: string) => {
      lines.push(message);
    }),
  };
  return { runtime, client, calls, lines, output };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    expect(basename(root)).toMatch(/^payos-order-cli-/);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('explicit payOS order-code store initialization CLI', () => {
  it('requires initialize, an exact safe integer and channel-history confirmation, never infers the high-water mark', () => {
    expect(parseOrderCodeStoreArgs(args('0'))).toEqual({ action: 'initialize', highWaterMark: 0n });
    expect(parseOrderCodeStoreArgs(args(String(Number.MAX_SAFE_INTEGER)))).toEqual({
      action: 'initialize',
      highWaterMark: BigInt(Number.MAX_SAFE_INTEGER),
    });
    for (const input of [
      [],
      ['initialize'],
      ['initialize', '--confirm-channel-history'],
      ['initialize', '--high-water=1000'],
      args('-1'),
      args('01'),
      args('1.1'),
      args('1e3'),
      args('9007199254740992'),
      args('9'.repeat(100)),
      [...args(), '--force'],
      ['reset', '--high-water=0', '--confirm-channel-history'],
      ['--help', ...args()],
      ['initialize', '--database-url=private', '--confirm-channel-history'],
    ])
      expect(() => parseOrderCodeStoreArgs(input)).toThrow();
  });
  it('help and invalid arguments never open a database or call initialization', async () => {
    const f = fixture();
    const open = vi.fn(async () => f.runtime),
      initialize = vi.fn();
    expect(await runOrderCodeStoreCli(['--help'], { open, initialize, output: f.output })).toBe(0);
    expect(f.lines.join('\n')).toContain('genuinely unused channel');
    expect(f.lines.join('\n')).toContain('No environment files are loaded');
    expect(await runOrderCodeStoreCli([], { open, initialize, output: f.output })).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });
  it('reads the current maximum inside READ ONLY, rolls back, releases and never executes application writes', async () => {
    const f = fixture();
    expect(await readOrderCodeDatabaseFloor(f.runtime.pool)).toBe(1000n);
    expect(f.calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.calls.at(-1)).toBe('ROLLBACK');
    expect(f.calls.filter((sql) => sql.startsWith('SELECT'))).toEqual([
      'SELECT COALESCE(max(order_code),0)::text AS floor FROM payos_payment_request',
    ]);
    expect(
      f.calls.every((sql) => /^(BEGIN .*READ ONLY|SET LOCAL |SELECT |ROLLBACK$)/.test(sql)),
    ).toBe(true);
    expect(f.calls.join('\n')).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|nextval|setval)\b/i,
    );
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it('refuses a chosen high-water mark below the current database floor and closes before any initializer call', async () => {
    const f = fixture('1001'),
      initialize = vi.fn();
    expect(
      await runOrderCodeStoreCli(args('1000'), {
        open: async () => f.runtime,
        initialize,
        output: f.output,
      }),
    ).toBe(1);
    expect(initialize).not.toHaveBeenCalled();
    expect(f.runtime.close).toHaveBeenCalledOnce();
    expect(JSON.parse(f.lines[0]!).error).toBe('HIGH_WATER_BELOW_DATABASE_FLOOR');
  });
  it('initializes only the explicit supplied high-water mark after closing the read-only database', async () => {
    const f = fixture('10');
    const initialize = vi.fn((input) => {
      expect(f.runtime.close).toHaveBeenCalledOnce();
      expect(input).toEqual({
        storePath: f.runtime.storePath,
        channelId,
        highWaterMark: 1000n,
      });
    });
    expect(
      await runOrderCodeStoreCli(args(), {
        open: async () => f.runtime,
        initialize,
        output: f.output,
      }),
    ).toBe(0);
    expect(initialize).toHaveBeenCalledOnce();
    expect(JSON.parse(f.lines[0]!)).toMatchObject({
      channelHistoryAttestedByOperator: true,
      externalHistoryVerifiedByTool: false,
      providerContacted: false,
      applicationDatabaseChanged: false,
      allocatorStoreWritten: true,
    });
    expect(f.lines.join('')).not.toContain(channelId);
    expect(f.lines.join('')).not.toContain(f.runtime.storePath);
  });
  it('rejects malformed DB floors or failed reads without creating or initializing a store', async () => {
    for (const floor of [null, -1, '-1', '1.5', '9007199254740992', 'not-a-number']) {
      const f = fixture(floor),
        initialize = vi.fn();
      expect(
        await runOrderCodeStoreCli(args(), {
          open: async () => f.runtime,
          initialize,
          output: f.output,
        }),
      ).toBe(1);
      expect(initialize).not.toHaveBeenCalled();
      expect(f.client.release).toHaveBeenCalledOnce();
      expect(f.runtime.close).toHaveBeenCalledOnce();
      expect(JSON.parse(f.lines[0]!).error).toBe('READ_ONLY_DATABASE_FLOOR_FAILED');
    }
  });
  it('rolls back and safely redacts driver errors instead of echoing URL, account or credentials', async () => {
    const f = fixture('1000', 'SELECT COALESCE'),
      initialize = vi.fn();
    expect(
      await runOrderCodeStoreCli(args(), {
        open: async () => f.runtime,
        initialize,
        output: f.output,
      }),
    ).toBe(1);
    expect(initialize).not.toHaveBeenCalled();
    expect(f.calls.at(-1)).toBe('ROLLBACK');
    expect(f.client.release).toHaveBeenCalledOnce();
    expect(f.runtime.close).toHaveBeenCalledOnce();
    for (const privateValue of [
      'postgresql://',
      'private-password',
      'private-host',
      'client-account-canary',
    ])
      expect(f.lines.join('')).not.toContain(privateValue);
  });
  it('database close failure prevents store initialization and emits no raw error', async () => {
    const f = fixture(),
      initialize = vi.fn();
    f.runtime.close = vi.fn(async () => {
      throw Error(channelId + f.runtime.storePath);
    });
    expect(
      await runOrderCodeStoreCli(args(), {
        open: async () => f.runtime,
        initialize,
        output: f.output,
      }),
    ).toBe(1);
    expect(initialize).not.toHaveBeenCalled();
    expect(f.lines.join('')).not.toContain(channelId);
    expect(f.lines.join('')).not.toContain(f.runtime.storePath);
  });
  it('requires explicit DB/client/absolute store configuration without loading env files or opening the provider', async () => {
    const complete = {
      DATABASE_URL: 'synthetic-never-connected',
      PAYOS_CLIENT_ID: channelId,
      PAYOS_ORDER_CODE_STORE: '/synthetic-private/allocator.sqlite',
    };
    for (const env of [
      {},
      { ...complete, DATABASE_URL: '' },
      { ...complete, PAYOS_CLIENT_ID: '' },
      { ...complete, PAYOS_CLIENT_ID: ' trailing-space ' },
      { ...complete, PAYOS_ORDER_CODE_STORE: '' },
      { ...complete, PAYOS_ORDER_CODE_STORE: 'relative.sqlite' },
    ])
      await expect(openOrderCodeStoreRuntime(env)).rejects.toThrow(
        'INITIALIZATION_CONFIGURATION_REQUIRED',
      );
  });
  it('uses the real initializer monotonically and privately in an isolated temporary store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'payos-order-cli-'));
    roots.push(root);
    const f = fixture('1000');
    f.runtime.storePath = join(root, 'private', 'order-codes.sqlite');
    expect(existsSync(f.runtime.storePath)).toBe(false);
    expect(
      await runOrderCodeStoreCli(args('1500'), {
        open: async () => f.runtime,
        output: f.output,
      }),
    ).toBe(0);
    expect(allocatePayosOrderCode({ storePath: f.runtime.storePath, channelId, now: 0 })).toBe(
      1501,
    );
    expect(
      await runOrderCodeStoreCli(args('1000'), {
        open: async () => f.runtime,
        output: f.output,
      }),
    ).toBe(0);
    expect(allocatePayosOrderCode({ storePath: f.runtime.storePath, channelId, now: 0 })).toBe(
      1502,
    );
    expect(readFileSync(f.runtime.storePath).includes(Buffer.from(channelId))).toBe(false);
  });
  it('direct --help runs without any environment config and cannot silently initialize', () => {
    const cli = fileURLToPath(
      new URL('../../../../../scripts/payos-order-code-store.ts', import.meta.url),
    );
    const output = execFileSync(process.execPath, ['--import', 'tsx', cli, '--help'], {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
      timeout: 10000,
    });
    expect(output).toContain('explicit operator initialization only');
    expect(output).toContain('--confirm-channel-history');
  });
});
