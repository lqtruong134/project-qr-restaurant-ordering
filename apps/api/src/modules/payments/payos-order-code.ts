import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const applicationId = 0x5152504f;
const formatVersion = 1;
type StoreInput = { storePath: string; channelId: string };
export type PayosOrderCodeAllocation = StoreInput & { databaseFloor?: bigint; now?: number };
export type PayosOrderCodeInitialization = StoreInput & { highWaterMark: bigint };

export class PayosOrderCodeError extends Error {
  constructor(
    readonly code:
      | 'PAYOS_ORDER_CODE_INVALID_INPUT'
      | 'PAYOS_ORDER_CODE_STORE_UNAVAILABLE'
      | 'PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED'
      | 'PAYOS_ORDER_CODE_RANGE_EXHAUSTED',
  ) {
    super(code);
    this.name = 'PayosOrderCodeError';
  }
}
function fail(code: PayosOrderCodeError['code']): never {
  throw new PayosOrderCodeError(code);
}
function integer(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > maximum)
    fail('PAYOS_ORDER_CODE_INVALID_INPUT');
  return value;
}
function target(input: StoreInput) {
  if (
    typeof input.storePath !== 'string' ||
    !input.storePath.trim() ||
    input.storePath.includes('\0') ||
    input.storePath === ':memory:' ||
    input.storePath.startsWith('file:') ||
    typeof input.channelId !== 'string' ||
    !input.channelId.trim() ||
    input.channelId.length > 200
  )
    fail('PAYOS_ORDER_CODE_INVALID_INPUT');
  return {
    path: resolve(input.storePath),
    channel: createHash('sha256').update(input.channelId).digest('hex'),
  };
}
function privateDirectory(path: string) {
  const stat = lstatSync(dirname(path));
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700)
    fail('PAYOS_ORDER_CODE_STORE_UNAVAILABLE');
}
function privateFile(path: string) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size === 0
  )
    fail('PAYOS_ORDER_CODE_STORE_UNAVAILABLE');
}
function connect(path: string, initializing = false) {
  const db = new DatabaseSync(path, {
    timeout: 5000,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    readBigInts: true,
  });
  try {
    if (!initializing) verifyFormat(db);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function verifyFormat(db: DatabaseSync) {
  const application = db.prepare('PRAGMA application_id').get();
  const version = db.prepare('PRAGMA user_version').get();
  if (
    application?.application_id !== BigInt(applicationId) ||
    version?.user_version !== BigInt(formatVersion)
  )
    fail('PAYOS_ORDER_CODE_STORE_UNAVAILABLE');
}
function syncDirectory(path: string) {
  const fd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function safe(error: unknown): never {
  if (error instanceof PayosOrderCodeError) throw error;
  throw new PayosOrderCodeError('PAYOS_ORDER_CODE_STORE_UNAVAILABLE');
}

/** Explicit operator bootstrap only. The supplied high-water mark must be the
 * maximum ever issued for this merchant channel, recovered from durable history
 * when necessary; zero is only safe for a genuinely unused channel. An existing
 * channel is never lowered. Do not call this automatically when the store is lost.
 * All deployments using one channel must share this same durable local filesystem.
 */
export function initializePayosOrderCodeStore(input: PayosOrderCodeInitialization): void {
  let db: DatabaseSync | undefined;
  let begun = false;
  try {
    const { path, channel } = target(input);
    const floor = integer(input.highWaterMark);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    privateDirectory(path);
    let created = false;
    try {
      const fd = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        fchmodSync(fd, 0o600);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      created = true;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        throw error;
    }
    if (!created) privateFile(path);
    db = connect(path, created);
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    if (created) {
      db.exec(`PRAGMA application_id=${applicationId}; PRAGMA user_version=${formatVersion};
        CREATE TABLE channel_high_water (
          channel_hash TEXT PRIMARY KEY CHECK(length(channel_hash)=64),
          last_code INTEGER NOT NULL CHECK(last_code BETWEEN 0 AND 9007199254740991)
        ) STRICT;`);
    } else verifyFormat(db);
    db.prepare(
      `INSERT INTO channel_high_water(channel_hash,last_code) VALUES(?,?)
      ON CONFLICT(channel_hash) DO UPDATE SET last_code=max(last_code,excluded.last_code)`,
    ).run(channel, floor);
    db.exec('COMMIT');
    begun = false;
    db.close();
    db = undefined;
    syncDirectory(path);
  } catch (error) {
    return safe(error);
  } finally {
    if (db) {
      if (begun) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* Fail closed; never reset the file. */
        }
      }
      try {
        db.close();
      } catch {
        /* Never expose storage details. */
      }
    }
  }
}

/** Reserve outside the application DB before issuing a provider order code.
 * A failed/rolled-back application transaction may leave gaps, never reuse.
 * Missing stores/channels fail closed instead of recreating history after reset.
 */
export function allocatePayosOrderCode(input: PayosOrderCodeAllocation): number {
  let db: DatabaseSync | undefined;
  let begun = false;
  try {
    const { path, channel } = target(input);
    const floor = integer(input.databaseFloor ?? 0n);
    const now = input.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) fail('PAYOS_ORDER_CODE_INVALID_INPUT');
    try {
      privateDirectory(path);
      privateFile(path);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        fail('PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED');
      throw error;
    }
    db = connect(path);
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    verifyFormat(db);
    const row = db
      .prepare('SELECT last_code FROM channel_high_water WHERE channel_hash=?')
      .get(channel);
    if (!row) fail('PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED');
    const previous = integer(row.last_code);
    const clockFloor = BigInt(now);
    const next = [previous + 1n, floor + 1n, clockFloor].reduce((a, b) => (a > b ? a : b));
    if (next > maximum) fail('PAYOS_ORDER_CODE_RANGE_EXHAUSTED');
    db.prepare('UPDATE channel_high_water SET last_code=? WHERE channel_hash=?').run(next, channel);
    db.exec('COMMIT');
    begun = false;
    db.close();
    db = undefined;
    syncDirectory(path);
    return Number(next);
  } catch (error) {
    return safe(error);
  } finally {
    if (db) {
      if (begun) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* Fail closed; never reset the file. */
        }
      }
      try {
        db.close();
      } catch {
        /* Never expose storage details. */
      }
    }
  }
}
