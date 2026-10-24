import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  initializePayosOrderCodeStore,
  PayosOrderCodeError,
  type PayosOrderCodeInitialization,
} from '../apps/api/src/modules/payments/payos-order-code.js';

const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const safeCodes = new Set([
  'INVALID_INITIALIZATION_ARGUMENTS',
  'INITIALIZATION_CONFIGURATION_REQUIRED',
  'READ_ONLY_DATABASE_FLOOR_FAILED',
  'HIGH_WATER_BELOW_DATABASE_FLOOR',
  'PAYOS_ORDER_CODE_INVALID_INPUT',
  'PAYOS_ORDER_CODE_STORE_UNAVAILABLE',
  'PAYOS_ORDER_CODE_STORE_NOT_INITIALIZED',
  'PAYOS_ORDER_CODE_RANGE_EXHAUSTED',
]);
class OrderCodeStoreCliError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OrderCodeStoreCliError';
  }
}
type ReadOnlyClient = {
  query(sql: string): Promise<{ rows: { floor?: unknown }[] }>;
  release(): void;
};
type Runtime = {
  pool: { connect(): Promise<ReadOnlyClient> };
  channelId: string;
  storePath: string;
  close(): Promise<void>;
};
type Output = { log(message: string): void; error(message: string): void };
type Options = { action: 'help' } | { action: 'initialize'; highWaterMark: bigint };

export function parseOrderCodeStoreArgs(args: readonly string[]): Options {
  if (args.length === 1 && args[0] === '--help') return { action: 'help' };
  if (
    args.length !== 3 ||
    args[0] !== 'initialize' ||
    args[2] !== '--confirm-channel-history' ||
    !/^--high-water=(0|[1-9][0-9]{0,15})$/.test(args[1] ?? '')
  )
    throw new OrderCodeStoreCliError('INVALID_INITIALIZATION_ARGUMENTS');
  const highWaterMark = BigInt(args[1]!.slice('--high-water='.length));
  if (highWaterMark > maximum) throw new OrderCodeStoreCliError('INVALID_INITIALIZATION_ARGUMENTS');
  return { action: 'initialize', highWaterMark };
}

export async function readOrderCodeDatabaseFloor(pool: Runtime['pool']): Promise<bigint> {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    // Current DB can prove only a lower bound, never the merchant's full
    // provider/archive history. Include all rows because legacy channel metadata
    // may be absent; a conservative higher floor is safer than reuse.
    const rows = (
      await client.query(
        'SELECT COALESCE(max(order_code),0)::text AS floor FROM payos_payment_request',
      )
    ).rows;
    const value = rows[0]?.floor;
    if (
      rows.length !== 1 ||
      typeof value !== 'string' ||
      !/^(0|[1-9][0-9]{0,15})$/.test(value) ||
      BigInt(value) > maximum
    )
      throw new OrderCodeStoreCliError('READ_ONLY_DATABASE_FLOOR_FAILED');
    return BigInt(value);
  } finally {
    try {
      if (started) await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
export async function openOrderCodeStoreRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Runtime> {
  const databaseUrl = env.DATABASE_URL;
  const channelId = env.PAYOS_CLIENT_ID;
  const storePath = env.PAYOS_ORDER_CODE_STORE;
  if (
    !databaseUrl?.trim() ||
    !channelId ||
    channelId !== channelId.trim() ||
    channelId.length > 200 ||
    !storePath ||
    storePath !== storePath.trim() ||
    !isAbsolute(storePath) ||
    storePath.includes('\0')
  )
    throw new OrderCodeStoreCliError('INITIALIZATION_CONFIGURATION_REQUIRED');
  // Deliberately no provider SDK, server, worker, dotenv or process.loadEnvFile.
  const { createDatabase } = await import('../packages/database/src/index.js');
  const db = createDatabase(databaseUrl);
  return {
    pool: db.pool,
    channelId,
    storePath,
    close: () => db.close(),
  };
}
export async function runOrderCodeStoreCli(
  args: readonly string[],
  {
    open = () => openOrderCodeStoreRuntime(),
    initialize = initializePayosOrderCodeStore,
    output = console,
  }: {
    open?: () => Promise<Runtime>;
    initialize?: (input: PayosOrderCodeInitialization) => void;
    output?: Output;
  } = {},
): Promise<number> {
  try {
    const options = parseOrderCodeStoreArgs(args);
    if (options.action === 'help') {
      output.log(
        [
          'payOS order-code store: explicit operator initialization only.',
          'Usage: node --import tsx scripts/payos-order-code-store.ts initialize --high-water=VALUE --confirm-channel-history',
          'Requires existing DATABASE_URL, PAYOS_CLIENT_ID and an absolute PAYOS_ORDER_CODE_STORE.',
          'VALUE must be the verified maximum ever issued/reserved across durable state, archives and provider history for this channel.',
          'Use 0 ONLY for a genuinely unused channel. An empty/new application DB does not establish that the channel is unused.',
          'Fence old writers and verify archive/provider history before confirming. This tool cannot independently verify external history.',
          'The application DB is checked READ ONLY; no provider request, migration, reset or application DB write is performed.',
          'Initialization writes the private allocator store. An existing namespace is never lowered.',
          'No environment files are loaded automatically. --help opens no DB and writes no store.',
        ].join('\n'),
      );
      return 0;
    }
    const runtime = await open();
    let floor: bigint;
    try {
      try {
        floor = await readOrderCodeDatabaseFloor(runtime.pool);
      } catch {
        throw new OrderCodeStoreCliError('READ_ONLY_DATABASE_FLOOR_FAILED');
      }
    } finally {
      // Do not initialize while the read-only check is unresolved or closing
      // failed. Never keep an application DB transaction open during store I/O.
      await runtime.close();
    }
    if (options.highWaterMark < floor)
      throw new OrderCodeStoreCliError('HIGH_WATER_BELOW_DATABASE_FLOOR');
    initialize({
      storePath: runtime.storePath,
      channelId: runtime.channelId,
      highWaterMark: options.highWaterMark,
    });
    output.log(
      JSON.stringify({
        format: 'payos-order-code-store-initialization-v1',
        status: 'INITIALIZED_OR_MONOTONICALLY_RETAINED',
        databaseFloorChecked: true,
        channelHistoryAttestedByOperator: true,
        externalHistoryVerifiedByTool: false,
        applicationDatabaseChanged: false,
        providerContacted: false,
        allocatorStoreWritten: true,
      }),
    );
    return 0;
  } catch (error) {
    const code =
      (error instanceof OrderCodeStoreCliError || error instanceof PayosOrderCodeError) &&
      safeCodes.has(error.code)
        ? error.code
        : 'ORDER_CODE_STORE_INITIALIZATION_FAILED';
    // Never serialize driver/storage exceptions, URLs, paths, client IDs or env.
    output.error(
      JSON.stringify({
        format: 'payos-order-code-store-initialization-v1',
        error: code,
        applicationDatabaseChanged: false,
        providerContacted: false,
      }),
    );
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runOrderCodeStoreCli(process.argv.slice(2));
}
