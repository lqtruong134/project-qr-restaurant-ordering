import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createDatabase } from '../packages/database/src/index.js';
import { canonicalArchiveJson } from '../apps/api/src/modules/payments/test-case-archive.service.js';
import {
  inspectPayosTestCases,
  applyPayosTestArchive,
  validateArchivePlan,
  archiveUuid,
  type ArchivePlan,
} from './payos-test-archive-data.js';
import { validateRestoreBundle } from './deploy.mjs';

type Options = {
  apply: boolean;
  restore: boolean;
  restaurantId: string;
  output?: string;
  from?: string;
  confirm?: string;
  operatorId?: string;
  reason?: string;
  proofDir: string;
  backup?: string;
  backupHash?: string;
  ack: boolean;
};
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const fileName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|webp)$/;
export function parsePayosArchiveArgs(args: string[], env: NodeJS.ProcessEnv = {}): Options {
  const result: Options = {
    apply: false,
    restore: false,
    restaurantId: '',
    proofDir: env.PAYMENT_PROOF_DIR ?? '',
    ack: false,
  };
  const values: Record<string, keyof Options> = {
    '--restaurant-id': 'restaurantId',
    '--output': 'output',
    '--from': 'from',
    '--confirm': 'confirm',
    '--operator-id': 'operatorId',
    '--reason': 'reason',
    '--proof-dir': 'proofDir',
    '--backup': 'backup',
    '--confirm-backup': 'backupHash',
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw Error('ARCHIVE_DUPLICATE_ARGUMENT');
    seen.add(flag);
    if (flag === '--apply') result.apply = true;
    else if (flag === '--restore-visibility') result.restore = true;
    else if (flag === '--ack-real-test-funds') result.ack = true;
    else if (flag === '--dry-run') continue;
    else if (values[flag] && args[i + 1] && !args[i + 1]!.startsWith('--'))
      Object.assign(result, { [values[flag]!]: args[++i] });
    else throw Error('ARCHIVE_INVALID_ARGUMENTS');
  }
  archiveUuid(result.restaurantId);
  if (!result.proofDir || !isAbsolute(result.proofDir))
    throw Error('ARCHIVE_PRIVATE_PROOF_DIRECTORY_REQUIRED');
  if (result.apply) {
    if (
      seen.has('--dry-run') ||
      result.output ||
      !result.from ||
      !isAbsolute(result.from) ||
      !hex.test(result.confirm ?? '') ||
      !result.operatorId ||
      !result.ack ||
      !result.reason ||
      result.reason.trim().length < 20 ||
      result.reason.length > 1000 ||
      !result.backup ||
      !isAbsolute(result.backup) ||
      !hex.test(result.backupHash ?? '')
    )
      throw Error('ARCHIVE_EXPLICIT_CONFIRMATIONS_REQUIRED');
    archiveUuid(result.operatorId);
  } else if (
    !result.output ||
    !isAbsolute(result.output) ||
    result.from ||
    result.confirm ||
    result.operatorId ||
    result.backup ||
    result.backupHash ||
    result.ack ||
    result.reason
  )
    throw Error('ARCHIVE_DRY_RUN_OUTPUT_REQUIRED');
  return result;
}
async function privateDirectory(path: string) {
  const full = resolve(path),
    s = await lstat(full);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (s.mode & 0o077) !== 0 ||
    (await realpath(full)) !== full
  )
    throw Error('ARCHIVE_PRIVATE_DIRECTORY_REQUIRED');
  return full;
}
async function readPrivate(path: string, max = 64 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat();
    if (!s.isFile() || (s.mode & 0o077) !== 0 || s.size > max)
      throw Error('ARCHIVE_INVALID_PRIVATE_FILE');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function durableWrite(path: string, data: Buffer | string) {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path: string) {
  const h = await open(path, constants.O_RDONLY);
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
async function readProofs(plan: ArchivePlan, root: string) {
  // Existing runtime directories may be 0755/0750. Proof bytes must remain private;
  // do not chmod a production volume just to read and archive its immutable files.
  const path = resolve(root),
    directory = await lstat(path);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o022) !== 0 ||
    (await realpath(path)) !== path
  )
    throw Error('ARCHIVE_UNTRUSTED_PROOF_SOURCE');
  const proofs = new Map<string, Buffer>();
  for (const v of plan.cases)
    for (const p of v.proofs) {
      if (
        !fileName.test(p.name) ||
        !hex.test(p.sha256) ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(p.mime) ||
        proofs.has(p.name)
      )
        throw Error('ARCHIVE_INVALID_PROOF_DESCRIPTOR');
      const bytes = await readPrivate(join(path, p.name), 2 * 1024 * 1024);
      if (bytes.length === 0 || sha(bytes) !== p.sha256)
        throw Error('ARCHIVE_PROOF_CHECKSUM_MISMATCH');
      proofs.set(p.name, bytes);
    }
  return proofs;
}
type BundleManifest = {
  format: string;
  restaurantId: string;
  planHash: string;
  createdAt: string;
  files: Record<string, { sha256: string; size: number }>;
};
function requireExternalArchive(path: string) {
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const rel = relative(repository, resolve(path));
  if (
    !rel ||
    (!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel))
  )
    throw Error('ARCHIVE_OUTSIDE_REPOSITORY_REQUIRED');
}
export async function writePayosArchiveBundle(path: string, plan: ArchivePlan, proofDir: string) {
  validateArchivePlan(plan, plan.planHash);
  requireExternalArchive(path);
  const output = resolve(path),
    parent = resolve(dirname(output));
  if ((await realpath(parent)) !== parent) throw Error('ARCHIVE_OUTPUT_PARENT_SYMLINK');
  const proofs = await readProofs(plan, proofDir);
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, 'proofs'), { mode: 0o700 });
  const files: BundleManifest['files'] = {};
  const planBytes = canonicalArchiveJson(plan) + '\n';
  if (Buffer.byteLength(planBytes) > 64 * 1024 * 1024) throw Error('ARCHIVE_BUNDLE_TOO_LARGE');
  await durableWrite(join(output, 'plan.json'), planBytes);
  files['plan.json'] = { sha256: sha(planBytes), size: Buffer.byteLength(planBytes) };
  for (const [name, bytes] of proofs) {
    await durableWrite(join(output, 'proofs', name), bytes);
    files['proofs/' + name] = { sha256: sha(bytes), size: bytes.length };
  }
  const manifest: BundleManifest = {
    format: 'payos-test-case-archive-bundle-v1',
    restaurantId: plan.restaurantId,
    planHash: plan.planHash,
    createdAt: new Date().toISOString(),
    files,
  };
  const bytes = canonicalArchiveJson(manifest) + '\n';
  await durableWrite(join(output, 'manifest.json'), bytes);
  await syncDirectory(join(output, 'proofs'));
  await syncDirectory(output);
  await syncDirectory(parent);
  return { bundleHash: sha(bytes), manifest };
}
export async function validatePayosArchiveBundle(path: string) {
  requireExternalArchive(path);
  const root = await privateDirectory(path),
    bytes = await readPrivate(join(root, 'manifest.json'), 65536);
  const manifest = JSON.parse(bytes.toString()) as BundleManifest;
  if (
    manifest.format !== 'payos-test-case-archive-bundle-v1' ||
    !hex.test(manifest.planHash) ||
    !manifest.files?.['plan.json'] ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw Error('ARCHIVE_INVALID_BUNDLE');
  const names = Object.keys(manifest.files).sort();
  if (names.some((n) => n !== 'plan.json' && !/^proofs\//.test(n)))
    throw Error('ARCHIVE_INVALID_BUNDLE_PATH');
  for (const name of names) {
    if (name !== 'plan.json' && !fileName.test(name.slice(7)))
      throw Error('ARCHIVE_INVALID_BUNDLE_PATH');
    const data = await readPrivate(join(root, name)),
      expected = manifest.files[name]!;
    if (
      !hex.test(expected.sha256) ||
      data.length !== expected.size ||
      sha(data) !== expected.sha256
    )
      throw Error('ARCHIVE_BUNDLE_CHECKSUM_MISMATCH');
  }
  const rootNames = (await readdir(root)).sort();
  if (rootNames.join(',') !== 'manifest.json,plan.json,proofs')
    throw Error('ARCHIVE_UNEXPECTED_BUNDLE_FILES');
  await privateDirectory(join(root, 'proofs'));
  if (
    (await readdir(join(root, 'proofs'))).sort().join(',') !==
    names
      .filter((n) => n.startsWith('proofs/'))
      .map((n) => n.slice(7))
      .sort()
      .join(',')
  )
    throw Error('ARCHIVE_UNEXPECTED_PROOF_FILES');
  const plan = JSON.parse((await readPrivate(join(root, 'plan.json'))).toString()) as ArchivePlan;
  validateArchivePlan(plan, manifest.planHash);
  if (
    plan.restaurantId !== manifest.restaurantId ||
    names.filter((n) => n.startsWith('proofs/')).length !==
      plan.cases.flatMap((v) => v.proofs).length
  )
    throw Error('ARCHIVE_BUNDLE_SCOPE_MISMATCH');
  for (const v of plan.cases)
    for (const p of v.proofs)
      if (manifest.files['proofs/' + p.name]?.sha256 !== p.sha256)
        throw Error('ARCHIVE_PROOF_MANIFEST_MISMATCH');
  return { root, plan, manifest, bundleHash: sha(bytes) };
}
export async function validatePayosArchiveBackup(
  path: string,
  confirmation: string,
  notBefore: string,
) {
  const root = await privateDirectory(path),
    bytes = await readPrivate(join(root, 'manifest.json'), 16384);
  if (!hex.test(confirmation) || sha(bytes) !== confirmation)
    throw Error('ARCHIVE_BACKUP_CONFIRMATION_MISMATCH');
  for (const name of ['database.dump', 'runtime-files.jsonl']) {
    const s = await lstat(join(root, name));
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
      throw Error('ARCHIVE_INVALID_PRIVATE_BACKUP_FILE');
  }
  const checked = await validateRestoreBundle(root);
  const created = Date.parse(checked.manifest.createdAt);
  if (!Number.isFinite(created) || created < Date.parse(notBefore) || created > Date.now() + 60000)
    throw Error('ARCHIVE_FRESH_FENCED_BACKUP_REQUIRED');
  return sha(bytes);
}
export async function runPayosTestArchive(args: string[], env: NodeJS.ProcessEnv) {
  const options = parsePayosArchiveArgs(args, env);
  if (!env.RESTAURANT_ID || archiveUuid(env.RESTAURANT_ID) !== options.restaurantId)
    throw Error('ARCHIVE_RESTAURANT_CONFIG_MISMATCH');
  if (!env.DATABASE_URL) throw Error('ARCHIVE_DATABASE_URL_REQUIRED');
  const db = createDatabase(env.DATABASE_URL);
  try {
    if (!options.apply) {
      const c = await db.pool.connect();
      let plan: ArchivePlan;
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await c.query("SET LOCAL statement_timeout='30s'");
        plan = await inspectPayosTestCases(c, options.restaurantId, false, options.restore);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      const output = await writePayosArchiveBundle(options.output!, plan!, options.proofDir);
      return {
        dryRun: true,
        databaseReadOnly: true,
        providerContacted: false,
        allocatorAccessed: false,
        action: plan!.action,
        planHash: plan!.planHash,
        caseSnapshotHash: plan!.snapshotHash,
        bundleHash: output.bundleHash,
        cases: plan!.cases.map((v) => ({
          table: v.tableCode,
          amount: v.amount,
          auditEvents: v.auditCount,
          proofFiles: v.proofs.length,
        })),
        requiresOperatorApproval: true,
      };
    }
    const bundle = await validatePayosArchiveBundle(options.from!);
    if (
      bundle.plan.restaurantId !== options.restaurantId ||
      (bundle.plan.action === 'RESTORE_VISIBILITY') !== options.restore
    )
      throw Error('ARCHIVE_ACTION_OR_RESTAURANT_MISMATCH');
    validateArchivePlan(bundle.plan, options.confirm!);
    const backupHash = await validatePayosArchiveBackup(
      options.backup!,
      options.backupHash!,
      bundle.manifest.createdAt,
    );
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await readProofs(bundle.plan, options.proofDir);
      const result = await applyPayosTestArchive(c, bundle.plan, {
        operatorId: options.operatorId!,
        reason: options.reason!,
        bundleHash: bundle.bundleHash,
        backupHash,
      });
      // Recheck the durable private archive before committing either marker.
      const final = await validatePayosArchiveBundle(options.from!);
      if (final.bundleHash !== bundle.bundleHash)
        throw Error('ARCHIVE_BUNDLE_CHANGED_DURING_APPLY');
      await c.query('COMMIT');
      return {
        dryRun: false,
        ...result,
        action: bundle.plan.action,
        financiallyResolved: false,
        postingBlocked: true,
        originalRecordsDeleted: 0,
        ledgerChanged: false,
        allocatorAccessed: false,
      };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  } finally {
    await db.close();
  }
}
const help = `payos-test-case-archive (A01/ffc78214 + A02/300659c7 only)\nDefault: --restaurant-id UUID --proof-dir ABS --output NEW_PRIVATE_DIRECTORY [--dry-run] [--restore-visibility]\nApply: --apply --restaurant-id UUID --proof-dir ABS --from BUNDLE --confirm PLAN_SHA256 --operator-id UUID --reason TEXT --ack-real-test-funds --backup VERIFIED_BACKUP --confirm-backup MANIFEST_SHA256 [--restore-visibility]\nNo reset/delete, provider call, secret loader or order-code allocator operation. Visibility rollback NEVER enables posting.\n`;
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).join(' ') === '--help') console.log(help);
  else
    runPayosTestArchive(process.argv.slice(2), process.env)
      .then((value) => console.log(JSON.stringify(value)))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        console.error(
          /^ARCHIVE_[A-Z0-9_]+(?::[A-Za-z0-9_:]+)?$/.test(message)
            ? message
            : 'ARCHIVE_REFUSED_DATABASE_OR_PRIVATE_FILES_CHECK',
        );
        process.exitCode = 1;
      });
}
