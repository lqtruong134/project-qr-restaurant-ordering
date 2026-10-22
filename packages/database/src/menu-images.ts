import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MENU_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const imageNamePattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$/;

export class MenuImageError extends Error {}

/** Relative overrides are rooted at the repository, never the caller's working directory. */
export function menuImageRoot(configured = process.env.MENU_UPLOAD_DIR): string {
  return resolve(repositoryRoot, configured?.trim() || 'var/menu-images');
}

export function inspectMenuImage(bytes: Uint8Array) {
  if (!bytes.length) throw new MenuImageError('Ảnh không có nội dung.');
  if (bytes.length > MENU_IMAGE_MAX_BYTES) throw new MenuImageError('Ảnh tối đa 2 MB.');
  const data = Buffer.from(bytes);
  const extension = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : data[0] === 255 && data[1] === 216 && data[2] === 255
      ? 'jpg'
      : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (!extension) throw new MenuImageError('Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
  return { extension, mimeType: extension === 'jpg' ? 'image/jpeg' : 'image/' + extension };
}

export function decodeMenuImage(data: unknown): Buffer {
  if (
    typeof data !== 'string' ||
    !data.length ||
    data.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new MenuImageError('Ảnh không hợp lệ; chọn PNG, JPEG hoặc WebP tối đa 2 MB.');
  const bytes = Buffer.from(data, 'base64');
  inspectMenuImage(bytes);
  return bytes;
}

/** Content-derived UUIDs keep URLs immutable and make repeated bootstrap imports idempotent. */
export function menuImageName(bytes: Uint8Array): string {
  const { extension } = inspectMenuImage(bytes);
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32).split('');
  hex[12] = '8';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}.${extension}`;
}

export function menuImageUrl(name: string): string {
  if (!imageNamePattern.test(name)) throw new MenuImageError('Không tìm thấy ảnh.');
  return '/api/menu-images/' + name;
}

export async function storeMenuImage(bytes: Uint8Array, options: { root?: string } = {}) {
  const info = inspectMenuImage(bytes);
  const dimensions = menuImageDimensions(bytes);
  const name = menuImageName(bytes);
  const root = options.root ?? menuImageRoot();
  await mkdir(root, { recursive: true });
  const temporary = join(root, '.menu-image-' + randomUUID() + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await writeFile(handle, bytes);
    } finally {
      await handle.close();
    }
    // Publish the completed inode atomically without replacing an immutable URL.
    // A concurrent writer can only observe a complete final file, never a partial write.
    try {
      await link(temporary, join(root, name));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const current = await readFile(join(root, name));
      if (!current.equals(Buffer.from(bytes)))
        throw new MenuImageError('Tên ảnh đã tồn tại với nội dung khác.');
    }
  } finally {
    await unlink(temporary);
  }
  return { ...info, ...dimensions, name, imageUrl: menuImageUrl(name), byteLength: bytes.length };
}

export async function readMenuImage(name: string, options: { root?: string } = {}) {
  menuImageUrl(name);
  const bytes = await readFile(join(options.root ?? menuImageRoot(), name));
  const info = inspectMenuImage(bytes);
  if (!name.endsWith('.' + info.extension)) throw new MenuImageError('Không tìm thấy ảnh.');
  return { bytes, mimeType: info.mimeType, ...menuImageDimensions(bytes) };
}

/** New product image writes may only reference a real file in the shared menu store. */
export async function validateMenuImageUrl(
  url: unknown,
  options: { root?: string } = {},
): Promise<string | null> {
  if (url === null) return null;
  if (typeof url !== 'string' || url.length > 2000)
    throw new MenuImageError('Địa chỉ ảnh không hợp lệ.');
  const value = url.trim();
  if (!value) return null;
  const prefix = '/api/menu-images/';
  const name = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  if (!imageNamePattern.test(name))
    throw new MenuImageError('Chọn ảnh đã tải lên trong kho ảnh món.');
  try {
    await readMenuImage(name, options);
  } catch (error) {
    if (
      error instanceof MenuImageError ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    )
      throw new MenuImageError('Không tìm thấy ảnh món. Vui lòng tải ảnh lên lại.');
    throw error;
  }
  return menuImageUrl(name);
}

/** Read dimensions from supported image headers, without trusting values supplied by the browser. */
export function menuImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(bytes),
    format = inspectMenuImage(b).extension;
  let width = 0,
    height = 0;
  if (format === 'png' && b.length >= 24) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (format === 'webp' && b.length >= 25) {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && b.length >= 30) {
      width = b.readUIntLE(24, 3) + 1;
      height = b.readUIntLE(27, 3) + 1;
    } else if (
      chunk === 'VP8 ' &&
      b.length >= 30 &&
      b[23] === 0x9d &&
      b[24] === 0x01 &&
      b[25] === 0x2a
    ) {
      width = b.readUInt16LE(26) & 0x3fff;
      height = b.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (format === 'jpg') {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset] !== 0xff) break;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
      )
        continue;
      if (offset + 2 > b.length) break;
      const size = b.readUInt16BE(offset);
      if (size < 2 || offset + size > b.length) break;
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        size >= 7
      ) {
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (width < 1 || height < 1 || width > 20000 || height > 20000)
    throw new MenuImageError('Không đọc được kích thước ảnh. Vui lòng chọn ảnh khác.');
  return { width, height };
}
