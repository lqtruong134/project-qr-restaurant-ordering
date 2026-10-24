import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  allocatePayosOrderCode,
  initializePayosOrderCodeStore,
  PayosOrderCodeError,
} from './payos-order-code.js';

const roots: string[] = [];
const channelId = 'synthetic-payos-order-channel';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'payos-order-code-'));
  roots.push(root);
  return { root, storePath: join(root, 'private', 'order-codes.sqlite'), channelId };
}
function initialize(input: ReturnType<typeof fixture>, highWaterMark = 0n) {
  initializePayosOrderCodeStore({ ...input, highWaterMark });
}
function code(run: () => unknown) {
  try {
    run();
    throw Error('Expected allocator failure');
  } catch (error) {
    expect(error).toBeInstanceOf(PayosOrderCodeError);
    return (error as PayosOrderCodeError).code;
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    // These are only this test's own random, explicitly bounded temporary folders.
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    expect(basename(root)).toMatch(/^payos-order-code-/);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('durable payOS order-code allocator', () => {
  it('persists reservations across connections and application DB resets, including clock rollback', () => {
    const input = fixture();
    initialize(input);
    const first = allocatePayosOrderCode({ ...input, now: 1800000000000 });
    expect(first).toBe(1800000000000);
    expect(allocatePayosOrderCode({ ...input, now: 1800000000000 })).toBe(first + 1);
    expect(allocatePayosOrderCode({ ...input, now: 1, databaseFloor: 0n })).toBe(first + 2);
    expect(allocatePayosOrderCode({ ...input, now: 0 })).toBe(first + 3);
  });
  it('respects an archived high-water mark and a higher legacy database floor without lowering either', () => {
    const input = fixture();
    initialize(input, 2000000000000n);
    expect(allocatePayosOrderCode({ ...input, now: 1 })).toBe(2000000000001);
    expect(allocatePayosOrderCode({ ...input, now: 1, databaseFloor: 3000000000000n })).toBe(
      3000000000001,
    );
    initialize(input, 1n);
    expect(allocatePayosOrderCode({ ...input, now: 1 })).toBe(3000000000002);
    initialize(input, 4000000000000n);
    expect(allocatePayosOrderCode({ ...input, now: 1 })).toBe(4000000000001);
  });
  it('requires explicit initialization and never recreates lost history or an unknown channel', () => {
    const input = fixture();
    expect(code(() => allocatePayosOrderCode({ ...input, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED',
    );
    expect(existsSync(input.storePath)).toBe(false);
    initialize(input);
    expect(
      code(() => allocatePayosOrderCode({ ...input, channelId: 'another-unused-channel', now: 1 })),
    ).toBe('PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED');
    rmSync(input.storePath);
    expect(code(() => allocatePayosOrderCode({ ...input, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED',
    );
    expect(existsSync(input.storePath)).toBe(false);
  });
  it('scopes state by a hashed merchant channel without storing the raw identifier', () => {
    const input = fixture();
    initialize(input, 1000n);
    initializePayosOrderCodeStore({
      ...input,
      channelId: 'synthetic-second-channel',
      highWaterMark: 2000n,
    });
    expect(allocatePayosOrderCode({ ...input, now: 1 })).toBe(1001);
    expect(
      allocatePayosOrderCode({ ...input, channelId: 'synthetic-second-channel', now: 1 }),
    ).toBe(2001);
    const bytes = readFileSync(input.storePath);
    expect(bytes.includes(Buffer.from(channelId))).toBe(false);
    expect(bytes.includes(Buffer.from(createHash('sha256').update(channelId).digest('hex')))).toBe(
      true,
    );
  });
  it('bounds the public number exactly and rolls back unsuccessful reservations', () => {
    const input = fixture();
    initialize(input, BigInt(Number.MAX_SAFE_INTEGER) - 1n);
    expect(allocatePayosOrderCode({ ...input, now: 0 })).toBe(Number.MAX_SAFE_INTEGER);
    expect(code(() => allocatePayosOrderCode({ ...input, now: 0 }))).toBe(
      'PAYOS_ORDER_CODE_RANGE_EXHAUSTED',
    );
    const second = fixture();
    initialize(second);
    expect(
      code(() =>
        allocatePayosOrderCode({
          ...second,
          now: 0,
          databaseFloor: BigInt(Number.MAX_SAFE_INTEGER),
        }),
      ),
    ).toBe('PAYOS_ORDER_CODE_RANGE_EXHAUSTED');
    expect(allocatePayosOrderCode({ ...second, now: 0 })).toBe(1);
  });
  it('does not overwrite a corrupt or empty existing store and emits no path/channel/data', () => {
    for (const content of ['not-a-sqlite-store-sensitive-canary', '']) {
      const input = fixture();
      initialize(input);
      writeFileSync(input.storePath, content, { mode: 0o600 });
      for (const operation of [
        () => allocatePayosOrderCode({ ...input, now: 0 }),
        () => initializePayosOrderCodeStore({ ...input, highWaterMark: 0n }),
      ]) {
        expect(code(operation)).toBe('PAYOS_ORDER_CODE_STORE_UNAVAILABLE');
        try {
          operation();
        } catch (error) {
          expect(String(error)).not.toContain(input.storePath);
          expect(String(error)).not.toContain(channelId);
          expect(String(error)).not.toContain('sensitive-canary');
        }
      }
      expect(readFileSync(input.storePath, 'utf8')).toBe(content);
    }
  });
  it('creates a private directory/file and refuses unsafe permissions or symlinks', () => {
    const input = fixture();
    initialize(input);
    expect(lstatSync(dirname(input.storePath)).mode & 0o777).toBe(0o700);
    expect(lstatSync(input.storePath).mode & 0o777).toBe(0o600);
    chmodSync(input.storePath, 0o400);
    expect(code(() => allocatePayosOrderCode({ ...input, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
    );
    chmodSync(input.storePath, 0o600);
    const alias = join(dirname(input.storePath), 'alias.sqlite');
    symlinkSync(input.storePath, alias);
    expect(code(() => allocatePayosOrderCode({ ...input, storePath: alias, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
    );
    chmodSync(dirname(input.storePath), 0o755);
    expect(code(() => allocatePayosOrderCode({ ...input, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
    );
    expect(lstatSync(dirname(input.storePath)).mode & 0o777).toBe(0o755);
  });
  it('refuses a different SQLite database or format version without resetting data', () => {
    const input = fixture();
    initialize(input);
    const foreign = new DatabaseSync(input.storePath);
    foreign.exec(
      'PRAGMA application_id=123; CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES(123);',
    );
    foreign.close();
    const before = readFileSync(input.storePath);
    expect(code(() => allocatePayosOrderCode({ ...input, now: 1 }))).toBe(
      'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
    );
    expect(code(() => initializePayosOrderCodeStore({ ...input, highWaterMark: 0n }))).toBe(
      'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
    );
    expect(readFileSync(input.storePath)).toEqual(before);
  });
  it('rejects invalid allocation input without opening or creating a store', () => {
    const input = fixture();
    for (const patch of [
      { now: NaN },
      { now: -1 },
      { now: 1.5 },
      { databaseFloor: -1n },
      { databaseFloor: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { storePath: ':memory:' },
      { storePath: 'file:unsafe.sqlite' },
      { channelId: '' },
    ])
      expect(code(() => allocatePayosOrderCode({ ...input, ...patch }))).toBe(
        'PAYOS_ORDER_CODE_INVALID_INPUT',
      );
    expect(existsSync(input.storePath)).toBe(false);
  });
  it('serializes independent worker processes using the same durable store', async () => {
    const input = fixture();
    initialize(input);
    const modulePath = fileURLToPath(new URL('./payos-order-code.ts', import.meta.url));
    const source = `const {allocatePayosOrderCode}=await import(${JSON.stringify(new URL('file://' + modulePath).href)});
      const values=[];for(let i=0;i<24;i++) values.push(allocatePayosOrderCode({storePath:process.argv[1],channelId:process.argv[2],now:1}));
      console.log(JSON.stringify(values));`;
    const run = promisify(execFile);
    const outputs = await Promise.all(
      Array.from({ length: 4 }, () =>
        run(
          process.execPath,
          [
            '--import',
            import.meta.resolve('tsx'),
            '--input-type=module',
            '-e',
            source,
            input.storePath,
            channelId,
          ],
          {
            env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1', NODE_NO_WARNINGS: '1' },
            timeout: 20000,
          },
        ),
      ),
    );
    const codes = outputs
      .flatMap((output) => JSON.parse(output.stdout) as number[])
      .sort((a, b) => a - b);
    expect(new Set(codes).size).toBe(96);
    expect(codes).toEqual(Array.from({ length: 96 }, (_, i) => i + 1));
    expect(allocatePayosOrderCode({ ...input, now: 0 })).toBe(97);
  }, 30000);
});
