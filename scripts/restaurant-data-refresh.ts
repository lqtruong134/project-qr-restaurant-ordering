import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { seedWorkforce } from '../packages/database/src/workforce-seed.js';
import {
  restaurantMenu,
  restaurantIngredients,
  restaurantCombos,
} from '../packages/database/src/restaurant-data.js';
import { riskDefaults } from '../apps/api/src/modules/risk/policy.service.js';
import { generateRestaurantHistory, validateRestaurantHistory } from './restaurant-history.js';
import { insertHistoryRows, type HistoryRow } from './restaurant-history-support.js';

const SOURCE = 'qr_restaurant_ordering',
  BASELINE = new Date('2026-08-01T00:00:00+07:00');
type RefreshManifest = {
  schemaVersion: 1;
  synthetic: true;
  sourceDatabase: string;
  candidateDatabase: string;
  restaurantId: string;
  stage: string;
  createdAt: string;
  cutoff: string;
  datasetKey: string;
  randomSeed?: string;
  backupBytes: number;
  backupSha256: string;
  preservedAdminCount?: number;
  preservedQrCount?: number;
  preparation?: Record<string, unknown>;
  history?: Record<string, unknown>;
  workforce?: Record<string, unknown>;
  plannedWorkforce?: { from: string; through: string; generatedAt: string };
  verification?: Record<string, unknown>;
};
type RefreshOptions = {
  mode: 'prepare' | 'history' | 'verify';
  candidate: string;
  resume?: boolean;
  workforceReady?: boolean;
  cutoff?: Date;
  manifestPath?: string;
  progress?: (message: string) => void;
};
function writeManifest(path: string, value: RefreshManifest) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
function urls(candidate: string) {
  const source = new URL(process.env.DATABASE_URL!);
  if (
    decodeURIComponent(source.pathname.slice(1)) !== SOURCE ||
    !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)
  )
    throw new Error(
      'Refresh requires the exact local source database; remote and other databases are refused.',
    );
  if (!/^qr_restaurant_unified_20261012_v[1-9]\d*$/.test(candidate))
    throw new Error('Use a distinct, explicit unified candidate name.');
  const target = new URL(source),
    maintenance = new URL(source);
  target.pathname = '/' + candidate;
  maintenance.pathname = '/postgres';
  return {
    source: source.toString(),
    target: target.toString(),
    maintenance: maintenance.toString(),
  };
}
function cutoff(now: Date) {
  const last = new Date('2026-10-12T23:59:59+07:00');
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid cutoff.');
  return new Date(Math.min(now.getTime(), Date.now(), last.getTime()));
}
async function sourceRows(db: Database) {
  const restaurants = (await db.pool.query('SELECT * FROM restaurant')).rows;
  if (restaurants.length !== 1 || restaurants[0].id !== restaurantId)
    throw new Error('The source must contain the expected single restaurant.');
  const admins = (
    await db.pool.query(
      "SELECT DISTINCT u.* FROM app_user u JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 AND r.code='ADMIN' ORDER BY u.username",
      [restaurantId],
    )
  ).rows;
  if (admins.length !== 2)
    throw new Error('Expected exactly the two reviewed administrator accounts.');
  const qr = (
    await db.pool.query(
      'SELECT q.*,t.code AS table_code FROM table_qr_token q JOIN dining_table t ON t.id=q.table_id WHERE t.restaurant_id=$1 ORDER BY t.code,q.version_no',
      [restaurantId],
    )
  ).rows;
  return {
    profile: restaurants[0] as HistoryRow,
    admins: admins as HistoryRow[],
    qr: qr as HistoryRow[],
  };
}
async function preserved(source: Database, target: Database) {
  const state = await sourceRows(source);
  let securityPreserved = true;
  for (const user of state.admins) {
    const row = (await target.pool.query('SELECT * FROM app_user WHERE id=$1', [user.id])).rows[0];
    for (const field of [
      'id',
      'restaurant_id',
      'username',
      'password_hash',
      'display_name',
      'status',
      'staff_code',
      'auth_version',
      'refresh_token_hash',
    ])
      if (!row || row[field] !== user[field]) securityPreserved = false;
    if (row && String(row.refresh_expires_at) !== String(user.refresh_expires_at))
      securityPreserved = false;
  }
  const profile = (await target.pool.query('SELECT * FROM restaurant WHERE id=$1', [restaurantId]))
    .rows[0];
  const profilePreserved =
    !!profile &&
    ['name', 'address', 'currency', 'timezone', 'status'].every(
      (field) => profile[field] === state.profile[field],
    );
  let qrPreserved = true,
    matched = 0;
  for (const old of state.qr) {
    const table = (
      await target.pool.query('SELECT id FROM dining_table WHERE restaurant_id=$1 AND code=$2', [
        restaurantId,
        old.table_code,
      ])
    ).rows[0];
    if (!table) continue;
    const row = (
      await target.pool.query('SELECT * FROM table_qr_token WHERE id=$1 AND table_id=$2', [
        old.id,
        table.id,
      ])
    ).rows[0];
    if (
      !row ||
      row.token_hash !== old.token_hash ||
      row.token_ciphertext !== old.token_ciphertext ||
      row.version_no !== old.version_no ||
      row.status !== old.status
    )
      qrPreserved = false;
    else matched++;
  }
  return {
    administratorCount: state.admins.length,
    administratorSecurityPreserved: securityPreserved,
    restaurantProfilePreserved: profilePreserved,
    qrPreserved,
    preservedQrCount: matched,
  };
}
async function baseline(target: Database, admins: HistoryRow[], qr: HistoryRow[]) {
  await seed(target, process.env.SEED_PASSWORD!, { startsAt: BASELINE, includeWorkforce: false });
  const c = await target.pool.connect();
  try {
    await c.query('BEGIN');
    const adminRole = (await c.query("SELECT id FROM role WHERE code='ADMIN'")).rows[0];
    for (const user of admins)
      await c.query(
        'INSERT INTO user_role(user_id,role_id,assigned_at,created_at) SELECT $1,$2,$3,$3 WHERE NOT EXISTS(SELECT 1 FROM user_role WHERE user_id=$1 AND revoked_at IS NULL)',
        [user.id, adminRole.id, BASELINE.toISOString()],
      );
    const tableRows = (
        await c.query('SELECT id,code FROM dining_table WHERE restaurant_id=$1', [restaurantId])
      ).rows,
      byCode = new Map(tableRows.map((table) => [table.code, table.id]));
    const tokenRows: HistoryRow[] = [];
    for (const token of qr) {
      const table = byCode.get(token.table_code);
      if (!table) continue;
      if (table !== token.table_id)
        throw new Error('Canonical table identity changed; old QR links cannot be safely copied.');
      const { table_code: _code, ...row } = token;
      void _code;
      tokenRows.push(row);
    }
    const existing = new Set(
      (await c.query('SELECT id FROM table_qr_token')).rows.map((row) => row.id),
    );
    await insertHistoryRows(
      c,
      'table_qr_token',
      tokenRows.filter((row) => !existing.has(row.id)),
    );
    const admin = admins.find((row) => row.username === 'quyettruong05') ?? admins[0]!;
    for (const [key, value] of Object.entries(riskDefaults))
      await c.query(
        'INSERT INTO risk_policy_config(restaurant_id,config_key,value_type,value_json,version_no,effective_from,changed_by,created_at) VALUES($1,$2,$3,$4::jsonb,1,$5,$6,$5) ON CONFLICT(restaurant_id,config_key,version_no) DO NOTHING',
        [
          restaurantId,
          key,
          typeof value === 'boolean' ? 'BOOLEAN' : 'NUMBER',
          JSON.stringify(value),
          BASELINE.toISOString(),
          admin.id,
        ],
      );
    for (const table of [
      'restaurant',
      'app_user',
      'dining_area',
      'dining_table',
      'menu_category',
      'product',
      'ingredient',
      'stock_location',
      'menu_promotion',
    ])
      await c.query(`UPDATE ${table} SET created_at=$1 WHERE created_at>$1`, [
        BASELINE.toISOString(),
      ]);
    await c.query('COMMIT');
    return { preservedQrCount: tokenRows.length };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
async function counts(db: Database) {
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  ).rows;
  const result: Record<string, number> = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table.tablename)) throw new Error('Unexpected table identifier.');
    result[table.tablename] = Number(
      (await db.pool.query('SELECT count(*) AS n FROM ' + table.tablename)).rows[0].n,
    );
  }
  return result;
}
export async function refreshRestaurantCandidate(options: RefreshOptions) {
  const connection = urls(options.candidate),
    path = resolve(options.manifestPath ?? 'var/data/' + options.candidate + '.json'),
    backup = resolve('var/backups/unification-20261012/database.dump'),
    auditPath = resolve('var/data/restaurant-audit-before-20261012.json');
  if (
    !existsSync(backup) ||
    !existsSync(auditPath) ||
    !existsSync('var/backups/unification-20261012/images-before.tar.gz')
  )
    throw new Error('Reviewed database, image backup and source audit are required.');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  if (
    audit.connection?.database !== SOURCE ||
    audit.restaurantCount !== 1 ||
    audit.restaurantId !== restaurantId
  )
    throw new Error('Source audit does not match this replacement.');
  const backupData = readFileSync(backup);
  if (backupData.length < 100000) throw new Error('Database backup is unexpectedly small.');
  const source = createDatabase(connection.source),
    maintenance = createDatabase(connection.maintenance);
  let target: Database | undefined;
  try {
    await sourceRows(source);
    let manifest: RefreshManifest | undefined = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : undefined;
    if (
      manifest &&
      (manifest.candidateDatabase !== options.candidate ||
        manifest.sourceDatabase !== SOURCE ||
        manifest.restaurantId !== restaurantId)
    )
      throw new Error('Candidate manifest identity mismatch.');
    const exists = !!(
      await maintenance.pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [
        options.candidate,
      ])
    ).rows[0];
    if (options.mode === 'prepare') {
      if (exists && !options.resume)
        throw new Error(
          'Candidate exists; review its manifest and explicitly resume, or select a new v2 name.',
        );
      if (exists && !manifest)
        throw new Error(
          'Existing candidate has no trusted preparation manifest; it will not be wiped.',
        );
      if (!exists) {
        if (manifest)
          throw new Error(
            'Manifest exists but candidate is absent; select a fresh candidate name.',
          );
        await maintenance.pool.query('CREATE DATABASE ' + options.candidate);
        manifest = {
          schemaVersion: 1,
          synthetic: true,
          sourceDatabase: SOURCE,
          candidateDatabase: options.candidate,
          restaurantId,
          stage: 'CREATED',
          createdAt: new Date().toISOString(),
          cutoff: cutoff(options.cutoff ?? new Date()).toISOString(),
          datasetKey: options.candidate + '-history-v1',
          // Stable scenario selection across repaired candidates; UUID namespaces
          // remain candidate-specific so no operational records are shared.
          randomSeed: 'qr_restaurant_unified_20261012_v1-history-v1',
          backupBytes: backupData.length,
          backupSha256: createHash('sha256').update(backupData).digest('hex'),
        };
        writeManifest(path, manifest);
        options.progress?.('Created candidate ' + options.candidate);
      }
      if (manifest!.stage === 'CREATED') {
        try {
          execFileSync(
            process.execPath,
            [resolve('packages/database/node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
            {
              cwd: resolve('packages/database'),
              env: { ...process.env, DATABASE_URL: connection.target },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
        } catch {
          throw new Error(
            'Candidate migration deployment failed; inspect the candidate safely before resuming.',
          );
        }
        manifest!.stage = 'MIGRATED';
        writeManifest(path, manifest!);
        options.progress?.('Applied candidate migrations.');
      }
      target = createDatabase(connection.target);
      const preservedSource = await sourceRows(source);
      if (manifest!.stage === 'MIGRATED') {
        const c = await target.pool.connect();
        try {
          await c.query('BEGIN');
          await insertHistoryRows(c, 'restaurant', [preservedSource.profile]);
          await insertHistoryRows(c, 'app_user', preservedSource.admins);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        } finally {
          c.release();
        }
        manifest!.stage = 'COPIED';
        manifest!.preservedAdminCount = preservedSource.admins.length;
        writeManifest(path, manifest!);
      }
      if (manifest!.stage === 'COPIED') {
        const seeded = await baseline(target, preservedSource.admins, preservedSource.qr);
        manifest!.preservedQrCount = seeded.preservedQrCount;
        manifest!.stage = 'PREPARED';
        manifest!.preparation = {
          counts: await counts(target),
          ...(await preserved(source, target)),
        };
        writeManifest(path, manifest!);
        options.progress?.('Prepared canonical catalogue, administrator accounts, QR and policy.');
      }
      return {
        candidate: options.candidate,
        stage: manifest!.stage,
        preparation: manifest!.preparation,
        manifestPath: path,
      };
    }
    if (!exists || !manifest) throw new Error('Prepare an explicit candidate first.');
    target = createDatabase(connection.target);
    if (options.mode === 'history') {
      if (!['PREPARED', 'ORDER_HISTORY', 'WORKFORCE_HISTORY', 'VERIFIED'].includes(manifest.stage))
        throw new Error('Candidate preparation has not completed.');
      if (manifest.stage === 'PREPARED') {
        const result = await generateRestaurantHistory(target, {
          restaurantId,
          from: '2026-08-01',
          through: '2026-10-12',
          now: new Date(manifest.cutoff),
          datasetKey: manifest.datasetKey,
          seed: manifest.randomSeed ?? manifest.datasetKey,
          apply: true,
          manifestPath: 'var/data/' + options.candidate + '-orders.json',
          progress: options.progress,
        });
        manifest.history = result as unknown as Record<string, unknown>;
        manifest.stage = 'ORDER_HISTORY';
        writeManifest(path, manifest);
      }
      if (manifest.stage === 'ORDER_HISTORY') {
        const workforceFile = resolve('scripts/restaurant-workforce-history.ts');
        if (!existsSync(workforceFile) || !options.workforceReady)
          return {
            candidate: options.candidate,
            stage: manifest.stage,
            history: manifest.history,
            workforcePending: true,
          };
        const module = await import(
          fileURLToPath(new URL('./restaurant-workforce-history.ts', import.meta.url))
        );
        const workforce = await module.generateWorkforceHistory(target, {
          restaurantId,
          from: '2026-08-01',
          through: '2026-10-12',
          now: new Date(manifest.cutoff),
          datasetKey: manifest.datasetKey,
          apply: true,
          progress: options.progress,
        });
        if (!workforce.applied && !workforce.alreadyApplied)
          throw new Error(
            'Workforce import did not apply a verified dataset; candidate remains at ORDER_HISTORY.',
          );
        manifest.workforce = workforce;
        manifest.stage = 'WORKFORCE_HISTORY';
        writeManifest(path, manifest);
      }
      if (manifest.stage === 'WORKFORCE_HISTORY' && !manifest.plannedWorkforce) {
        const now = new Date(),
          from = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10),
          through = new Date(Date.parse(from + 'T12:00:00Z') + 13 * 86400000)
            .toISOString()
            .slice(0, 10);
        await target.prisma.$transaction(
          (tx) => seedWorkforce(tx, restaurantId, { startDay: from, dayCount: 14, now }),
          { timeout: 60000 },
        );
        manifest.plannedWorkforce = { from, through, generatedAt: now.toISOString() };
        writeManifest(path, manifest);
        options.progress?.(
          `Planned current and upcoming shifts from ${from} through ${through}; no attendance or pay records created.`,
        );
      }
      return {
        candidate: options.candidate,
        stage: manifest.stage,
        history: manifest.history,
        workforce: manifest.workforce,
        plannedWorkforce: manifest.plannedWorkforce,
      };
    }
    // These photos were added after preparation. Fill only the reviewed empty canonical slots.
    const media = await import('../packages/database/src/menu-media.js');
    await media.importMenuMedia();
    let photoSlotsFilled = 0;
    for (const code of ['CHINH-17', 'CHINH-18', 'NUONG-11']) {
      const dish = restaurantMenu.find((row) => row.code === code),
        image = media.menuMedia[code];
      if (dish && image)
        photoSlotsFilled +=
          (
            await target.pool.query(
              'UPDATE product SET image_url=$1 WHERE restaurant_id=$2 AND code=$3 AND name=$4 AND image_url IS NULL',
              [image, restaurantId, code, dish.name],
            )
          ).rowCount ?? 0;
    }
    const c = await target.pool.connect();
    let invariants: Record<string, number>;
    let workforceInvariants: Record<string, number> = { workforceNotImported: 1 };
    try {
      invariants = await validateRestaurantHistory(c, restaurantId, new Date(manifest.cutoff));
      if (manifest.workforce) {
        const module = await import(
          fileURLToPath(new URL('./restaurant-workforce-history.ts', import.meta.url))
        );
        workforceInvariants = await module.validateWorkforceHistory(
          c,
          restaurantId,
          '2026-08-01',
          manifest.cutoff,
        );
      }
    } finally {
      c.release();
    }
    const retention = await preserved(source, target),
      allCounts = await counts(target),
      productCodes = (await target.pool.query('SELECT code FROM product ORDER BY code')).rows.map(
        (row) => String(row.code),
      ),
      canonicalProducts = [
        ...restaurantMenu.map((row) => row.code),
        ...restaurantCombos.map((row) => row.code),
      ].sort(),
      ingredientCodes = (
        await target.pool.query('SELECT code FROM ingredient ORDER BY code')
      ).rows.map((row) => String(row.code)),
      canonicalIngredients = restaurantIngredients.map((row) => row[0]).sort();
    const masterMatches =
        JSON.stringify(productCodes) === JSON.stringify(canonicalProducts) &&
        JSON.stringify(ingredientCodes) === JSON.stringify(canonicalIngredients),
      inactive = Number(
        (
          await target.pool.query(
            "SELECT count(*) AS n FROM product WHERE NOT is_active OR availability_status<>'AVAILABLE'",
          )
        ).rows[0].n,
      ),
      missingBalance = Number(
        (
          await target.pool.query(
            'SELECT count(*) AS n FROM ingredient i WHERE NOT EXISTS(SELECT 1 FROM inventory_balance b WHERE b.ingredient_id=i.id AND b.on_hand_qty>0 AND b.reserved_qty=0)',
          )
        ).rows[0].n,
      );
    const effectiveUnavailable = Number(
      (
        await target.pool.query(
          'SELECT count(*) AS n FROM product p WHERE p.restaurant_id=$1 AND NOT product_catalog_available(p.id,$1)',
          [restaurantId],
        )
      ).rows[0].n,
    );
    const futureAttendance = Number(
      (
        await target.pool.query(
          'SELECT count(*) AS n FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE a.restaurant_id=$1 AND a.starts_at>$2::timestamptz',
          [restaurantId, manifest.cutoff],
        )
      ).rows[0].n,
    );
    const verified =
      Object.values(invariants).every((n) => n === 0) &&
      Object.values(workforceInvariants).every((n) => n === 0) &&
      retention.administratorSecurityPreserved &&
      retention.restaurantProfilePreserved &&
      retention.qrPreserved &&
      masterMatches &&
      inactive === 0 &&
      missingBalance === 0 &&
      effectiveUnavailable === 0 &&
      futureAttendance === 0 &&
      (allCounts.table_session ?? 0) >= 3500 &&
      (allCounts.order_item ?? 0) >= 25000 &&
      !!manifest.workforce;
    manifest.verification = {
      verified,
      invariants,
      workforceInvariants,
      retention,
      masterMatches,
      inactiveProducts: inactive,
      missingPositiveBalances: missingBalance,
      effectiveUnavailableProducts: effectiveUnavailable,
      futureAttendance,
      counts: allCounts,
      verifiedAt: new Date().toISOString(),
      photoSlotsFilled,
    };
    if (verified) manifest.stage = 'VERIFIED';
    writeManifest(path, manifest);
    return { candidate: options.candidate, stage: manifest.stage, ...manifest.verification };
  } finally {
    if (target) await target.close();
    await maintenance.close();
    await source.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modes = ['prepare', 'history', 'verify'].filter((mode) =>
    process.argv.includes('--' + mode),
  );
  if (modes.length !== 1)
    throw new Error('Select exactly one of --prepare, --history or --verify.');
  const argument = (name: string, fallback: string) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
  };
  try {
    const result = await refreshRestaurantCandidate({
      mode: modes[0] as RefreshOptions['mode'],
      candidate: argument('--candidate', 'qr_restaurant_unified_20261012_v1'),
      resume: process.argv.includes('--resume'),
      workforceReady: process.argv.includes('--with-workforce'),
      cutoff: new Date(argument('--cutoff', new Date().toISOString())),
      progress: (message) => console.log(message),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Never print PostgreSQL row detail, Prisma argument dumps or connection URLs.
    const code =
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'PREPARATION_ERROR';
    console.error(
      JSON.stringify({
        code,
        message:
          error instanceof Error
            ? error.message.split('\n')[0]?.slice(0, 220)
            : 'Candidate operation failed.',
        liveDatabaseChanged: false,
      }),
    );
    process.exitCode = 1;
  }
}
