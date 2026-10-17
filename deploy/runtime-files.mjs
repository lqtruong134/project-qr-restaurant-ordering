import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILE_ARCHIVE_FORMAT = 'qtruongres-files-v1';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const maxFiles = 10000;
const maxLineBytes = 3 * 1024 * 1024;
const stores = ['menu-images', 'payment-proofs'];
const allowedPath =
  /^(menu-images|payment-proofs)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$/;
export function validateRuntimePath(value) {
  if (typeof value !== 'string' || !allowedPath.test(value))
    throw Error('Invalid runtime archive path.');
  return value;
}
function exactKeys(value, names) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...names].sort().join(',')
  )
    throw Error('Invalid runtime archive structure.');
}
async function* lines(file) {
  let pending = '',
    bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > MAX_ARCHIVE_BYTES) throw Error('Runtime archive exceeds 1 GiB.');
    pending += chunk.toString('utf8');
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (Buffer.byteLength(line) > maxLineBytes || !line)
        throw Error('Invalid runtime archive line.');
      yield line;
    }
    if (Buffer.byteLength(pending) > maxLineBytes)
      throw Error('Runtime archive line is too large.');
  }
  if (pending) yield pending;
}
function parseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw Error('Invalid runtime archive JSON.');
  }
}
function record(line) {
  const row = parseJson(line);
  exactKeys(row, ['path', 'size', 'sha256', 'data']);
  validateRuntimePath(row.path);
  if (
    !Number.isSafeInteger(row.size) ||
    row.size < 1 ||
    row.size > MAX_FILE_BYTES ||
    typeof row.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    typeof row.data !== 'string' ||
    row.data.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(row.data)
  )
    throw Error('Invalid runtime file entry.');
  const bytes = Buffer.from(row.data, 'base64');
  if (
    bytes.length !== row.size ||
    bytes.toString('base64') !== row.data ||
    createHash('sha256').update(bytes).digest('hex') !== row.sha256
  )
    throw Error('Runtime file checksum or size mismatch.');
  return { row, bytes };
}
export async function validateRuntimeArchive(file) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_ARCHIVE_BYTES)
    throw Error('Invalid runtime archive file.');
  let header = false,
    count = 0;
  const seen = new Set();
  for await (const line of lines(file)) {
    if (!header) {
      const value = parseJson(line);
      exactKeys(value, ['format']);
      if (value.format !== FILE_ARCHIVE_FORMAT) throw Error('Unknown runtime archive version.');
      header = true;
      continue;
    }
    const { row } = record(line);
    if (++count > maxFiles || seen.has(row.path))
      throw Error('Duplicate or excessive runtime file entries.');
    seen.add(row.path);
  }
  if (!header) throw Error('Missing runtime archive header.');
  return { files: count };
}
async function safeRoot(root) {
  const absolute = resolve(root);
  const metadata = await lstat(absolute);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(absolute)) !== absolute ||
    dirname(absolute) === absolute
  )
    throw Error('Runtime root must be a real non-root directory.');
  return absolute;
}
async function storeState(root, store) {
  const path = join(root, store);
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('Runtime store is not a safe directory.');
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
export async function assertRuntimeEmpty(root) {
  const absolute = await safeRoot(root);
  for (const store of stores)
    if ((await storeState(absolute, store)).length)
      throw Error('Restore requires empty runtime stores.');
}
async function output(stream, line) {
  if (!stream.write(line + '\n')) await once(stream, 'drain');
}
export async function backupRuntimeFiles(root, stream) {
  const absolute = await safeRoot(root);
  await output(stream, JSON.stringify({ format: FILE_ARCHIVE_FORMAT }));
  let files = 0,
    total = 0;
  for (const store of stores) {
    const entries = (await storeState(absolute, store)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = validateRuntimePath(store + '/' + entry.name);
      const target = join(absolute, path);
      const info = await lstat(target);
      if (
        !entry.isFile() ||
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size < 1 ||
        info.size > MAX_FILE_BYTES ||
        ++files > maxFiles
      )
        throw Error('Unsupported runtime file; backup stopped.');
      const chunks = [];
      let size = 0;
      for await (const chunk of createReadStream(target)) {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) throw Error('Runtime file exceeds 2 MiB.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const line = JSON.stringify({
        path,
        size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data: bytes.toString('base64'),
      });
      total += Buffer.byteLength(line) + 1;
      if (total > MAX_ARCHIVE_BYTES) throw Error('Runtime archive exceeds 1 GiB.');
      await output(stream, line);
    }
  }
  return { files };
}
export async function restoreRuntimeFiles(root, file) {
  await validateRuntimeArchive(file);
  const absolute = await safeRoot(root);
  await assertRuntimeEmpty(absolute);
  const written = [];
  try {
    for (const store of stores)
      await mkdir(join(absolute, store), { recursive: true, mode: 0o700 });
    let header = false;
    for await (const line of lines(file)) {
      if (!header) {
        header = true;
        continue;
      }
      const { row, bytes } = record(line);
      const target = join(absolute, row.path);
      const handle = await open(target, 'wx', 0o600);
      written.push(target);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    }
    return { files: written.length };
  } catch (error) {
    for (const target of written) await unlink(target).catch(() => {});
    throw error;
  }
}
export async function restoreRuntimeStream(root, input) {
  const temporary = await mkdtemp(join(await safeRoot(root), '.restore-'));
  const archive = join(temporary, randomUUID() + '.jsonl');
  try {
    let count = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        count += chunk.length;
        callback(count > MAX_ARCHIVE_BYTES ? Error('Runtime archive exceeds 1 GiB.') : null, chunk);
      },
    });
    await pipeline(input, limiter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
    return await restoreRuntimeFiles(root, archive);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const action = process.argv[2],
    root = '/data';
  if (action === 'backup') await backupRuntimeFiles(root, process.stdout);
  else if (action === 'check-empty') {
    await assertRuntimeEmpty(root);
    console.log('Runtime stores are empty.');
  } else if (action === 'restore') {
    console.log(JSON.stringify(await restoreRuntimeStream(root, process.stdin)));
  } else throw Error('Use backup, check-empty or restore.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Runtime file operation failed; check archive, permissions and empty target.');
    process.exitCode = 1;
  });
}
