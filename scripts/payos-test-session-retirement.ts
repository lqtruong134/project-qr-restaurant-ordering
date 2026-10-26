import { createHash } from 'node:crypto';
import { mkdir, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../packages/database/src/index.js';
import { canonicalArchiveJson } from '../apps/api/src/modules/payments/test-case-archive.service.js';
import { archiveUuid } from './payos-test-archive-data.js';
import {
  privateDirectory,
  readPrivate,
  durableWrite,
  syncDirectory,
  requireExternalArchive,
  validatePayosArchiveBackup,
} from './payos-test-case-archive.js';
import {
  inspectRetirement,
  applyRetirement,
  validateRetirementPlan,
  retirementProfiles,
  type RetirementPlan,
} from './payos-test-session-retirement-data.js';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
type Options = {
  apply: boolean;
  restaurantId: string;
  output?: string;
  from?: string;
  confirm?: string;
  operatorId?: string;
  reason?: string;
  backup?: string;
  backupHash?: string;
  sessions?: string;
  noActiveGuests: boolean;
  ack: boolean;
};
export function parseRetirementArgs(args: string[]) {
  const o: Options = { apply: false, restaurantId: '', noActiveGuests: false, ack: false },
    seen = new Set<string>();
  const flags: Record<string, keyof Options> = {
    '--restaurant-id': 'restaurantId',
    '--output': 'output',
    '--from': 'from',
    '--confirm': 'confirm',
    '--operator-id': 'operatorId',
    '--reason': 'reason',
    '--backup': 'backup',
    '--confirm-backup': 'backupHash',
    '--confirm-sessions': 'sessions',
  };
  for (let i = 0; i < args.length; i++) {
    const f = args[i]!;
    if (seen.has(f)) throw Error('RETIRE_DUPLICATE_ARGUMENT');
    seen.add(f);
    if (f === '--apply') o.apply = true;
    else if (f === '--dry-run') continue;
    else if (f === '--confirm-no-active-guests') o.noActiveGuests = true;
    else if (f === '--ack-real-test-funds') o.ack = true;
    else if (flags[f] && args[i + 1] && !args[i + 1]!.startsWith('--'))
      Object.assign(o, { [flags[f]!]: args[++i] });
    else throw Error('RETIRE_INVALID_ARGUMENT');
  }
  archiveUuid(o.restaurantId);
  if (o.apply) {
    if (
      seen.has('--dry-run') ||
      o.output ||
      !o.from ||
      !isAbsolute(o.from) ||
      !hex.test(o.confirm ?? '') ||
      !o.operatorId ||
      !o.reason ||
      o.reason.trim().length < 20 ||
      o.reason.length > 1000 ||
      !o.backup ||
      !isAbsolute(o.backup) ||
      !hex.test(o.backupHash ?? '') ||
      !o.noActiveGuests ||
      !o.ack ||
      o.sessions !== retirementProfiles.map((v) => v.session).join(',')
    )
      throw Error('RETIRE_EXPLICIT_CONFIRMATIONS_REQUIRED');
    archiveUuid(o.operatorId);
  } else if (
    !o.output ||
    !isAbsolute(o.output) ||
    Object.keys(flags).some((f) => !['--restaurant-id', '--output'].includes(f) && seen.has(f)) ||
    o.noActiveGuests ||
    o.ack
  )
    throw Error('RETIRE_DRY_RUN_OUTPUT_REQUIRED');
  return o;
}
export async function writeRetirementBundle(path: string, plan: RetirementPlan) {
  validateRetirementPlan(plan, plan.planHash);
  requireExternalArchive(path);
  const root = resolve(path),
    parent = dirname(root);
  if ((await realpath(parent)) !== parent) throw Error('RETIRE_OUTPUT_PARENT_SYMLINK');
  await mkdir(root, { mode: 0o700 });
  const bytes = canonicalArchiveJson(plan) + '\n';
  if (Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw Error('RETIRE_PLAN_TOO_LARGE');
  await durableWrite(join(root, 'plan.json'), bytes);
  const manifest = {
    format: 'payos-test-retirement-bundle-v1',
    createdAt: new Date().toISOString(),
    restaurantId: plan.restaurantId,
    planHash: plan.planHash,
    sha256: sha(bytes),
    size: Buffer.byteLength(bytes),
  };
  const data = canonicalArchiveJson(manifest) + '\n';
  await durableWrite(join(root, 'manifest.json'), data);
  await syncDirectory(root);
  await syncDirectory(parent);
  return { bundleHash: sha(data), manifest };
}
export async function readRetirementBundle(path: string) {
  requireExternalArchive(path);
  const root = await privateDirectory(path);
  if ((await readdir(root)).sort().join(',') !== 'manifest.json,plan.json')
    throw Error('RETIRE_UNEXPECTED_BUNDLE_FILES');
  const bytes = await readPrivate(join(root, 'manifest.json'), 65536),
    manifest = JSON.parse(bytes.toString());
  const data = await readPrivate(join(root, 'plan.json'));
  if (
    manifest.format !== 'payos-test-retirement-bundle-v1' ||
    manifest.size !== data.length ||
    manifest.sha256 !== sha(data) ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw Error('RETIRE_BUNDLE_CHECKSUM');
  const plan = JSON.parse(data.toString()) as RetirementPlan;
  validateRetirementPlan(plan, manifest.planHash);
  if (plan.restaurantId !== manifest.restaurantId) throw Error('RETIRE_BUNDLE_TENANT');
  return { plan, manifest, bundleHash: sha(bytes) };
}
export async function runRetirement(args: string[], env: NodeJS.ProcessEnv) {
  const o = parseRetirementArgs(args);
  if (!env.RESTAURANT_ID || archiveUuid(env.RESTAURANT_ID) !== o.restaurantId || !env.DATABASE_URL)
    throw Error('RETIRE_EXPLICIT_DATABASE_AND_TENANT_REQUIRED');
  const db = createDatabase(env.DATABASE_URL);
  try {
    if (!o.apply) {
      const c = await db.pool.connect();
      let plan: RetirementPlan;
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await c.query("SET LOCAL statement_timeout='45s'");
        plan = await inspectRetirement(c, o.restaurantId);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      const bundle = await writeRetirementBundle(o.output!, plan!);
      return {
        dryRun: true as const,
        databaseReadOnly: true,
        migrationReady: plan!.migrationReady,
        planHash: plan!.planHash,
        bundleHash: bundle.bundleHash,
        providerContacted: false,
        allocatorAccessed: false,
        cases: plan!.cases.map((v) => ({
          table: v.table,
          blockers: v.blockerCounts,
          financialBefore: v.financial,
          financialAfter: v.financial,
          caseReportsToCancel: v.voidedCaseId ? 1 : 0,
          supportRequestsToCancel: v.supportIds.length,
          testAlertsToResolve: v.shortfallAlertIds.length,
          participantsToLeave: v.activeParticipantIds.length,
          sessionAfter: 'CLOSED',
          closeReason: 'ARCHIVED_TEST_RETIRED',
          tableAfter: 'NEEDS_CLEANING',
          realFundsUnsettled: '5000',
        })),
      };
    }
    const bundle = await readRetirementBundle(o.from!);
    validateRetirementPlan(bundle.plan, o.confirm!);
    if (bundle.plan.restaurantId !== o.restaurantId) throw Error('RETIRE_BUNDLE_TENANT');
    const backupHash = await validatePayosArchiveBackup(
      o.backup!,
      o.backupHash!,
      bundle.manifest.createdAt,
    );
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await applyRetirement(c, bundle.plan, {
        operatorId: o.operatorId!,
        reason: o.reason!,
        bundleHash: bundle.bundleHash,
        backupHash,
        noActiveGuests: o.noActiveGuests,
        realFundsAcknowledged: o.ack,
      });
      if ((await readRetirementBundle(o.from!)).bundleHash !== bundle.bundleHash)
        throw Error('RETIRE_BUNDLE_CHANGED_DURING_APPLY');
      await c.query('COMMIT');
      return {
        dryRun: false as const,
        ...result,
        financiallySettled: false,
        ledgerChanged: false,
        archivedEvidenceChanged: false,
        allocatorAccessed: false,
        tableStatus: 'NEEDS_CLEANING',
      };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  } finally {
    await db.close();
  }
}
const help = `payos-test-session-retirement — exact A01/A02 UUIDs only\nDefault: --restaurant-id UUID --output NEW_PRIVATE_DIRECTORY [--dry-run]\nApply: --apply --restaurant-id UUID --from BUNDLE --confirm PLAN_SHA256 --operator-id UUID --reason TEXT --backup VERIFIED_BACKUP --confirm-backup MANIFEST_SHA256 --confirm-sessions ${retirementProfiles.map((v) => v.session).join(',')} --confirm-no-active-guests --ack-real-test-funds\nNo provider, secret loader, financial recalculation, allocator access, write-off or automatic restart. Requires migration 41 for apply.\n`;
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).join(' ') === '--help') console.log(help);
  else
    runRetirement(process.argv.slice(2), process.env)
      .then((v) => console.log(JSON.stringify(v)))
      .catch((e: unknown) => {
        const m = e instanceof Error ? e.message : '';
        console.error(
          /^(RETIRE_|ARCHIVE_)[A-Z0-9_]+(?::[A-Za-z0-9_:]+)?$/.test(m)
            ? m
            : 'RETIRE_REFUSED_DATABASE_OR_PRIVATE_FILES_CHECK',
        );
        process.exitCode = 1;
      });
}
