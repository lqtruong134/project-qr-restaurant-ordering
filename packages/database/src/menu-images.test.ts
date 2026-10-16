import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MENU_IMAGE_MAX_BYTES,
  decodeMenuImage,
  inspectMenuImage,
  menuImageDimensions,
  menuImageName,
  menuImageRoot,
  readMenuImage,
  storeMenuImage,
  validateMenuImageUrl,
} from './menu-images';
import { importMenuMedia, menuMedia, menuPromotionMedia } from './menu-media';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=',
  'base64',
);
const roots: string[] = [];
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'qr-menu-images-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('one immutable menu-image store for bootstrap and administrative uploads', () => {
  it('accepts the supported formats and rejects invalid or oversized input', () => {
    expect(inspectMenuImage(png)).toEqual({ extension: 'png', mimeType: 'image/png' });
    expect(inspectMenuImage(Buffer.from([255, 216, 255, 224]))).toEqual({
      extension: 'jpg',
      mimeType: 'image/jpeg',
    });
    expect(inspectMenuImage(Buffer.from('RIFF0000WEBPpayload'))).toEqual({
      extension: 'webp',
      mimeType: 'image/webp',
    });
    expect(() => inspectMenuImage(Buffer.from('<svg></svg>'))).toThrow(
      'Chỉ nhận ảnh PNG, JPEG hoặc WebP.',
    );
    expect(() => inspectMenuImage(Buffer.alloc(MENU_IMAGE_MAX_BYTES + 1))).toThrow(
      'Ảnh tối đa 2 MB.',
    );
    expect(() => decodeMenuImage('data:image/png;base64,' + png.toString('base64'))).toThrow(
      'Ảnh không hợp lệ',
    );
    expect(decodeMenuImage(png.toString('base64'))).toEqual(png);
  });

  it('derives image dimensions from file data instead of trusting browser input', () => {
    expect(menuImageDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(() => menuImageDimensions(Buffer.from([255, 216, 255, 224]))).toThrow(
      'Không đọc được kích thước ảnh.',
    );
  });

  it('keeps the storage root stable when an API, seed or script has a different cwd', async () => {
    const script = `import { menuImageRoot } from ${JSON.stringify(new URL('./menu-images.ts', import.meta.url).href)}; process.stdout.write(menuImageRoot());`;
    const loader = fileURLToPath(
      new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url),
    );
    const temporary = await temporaryRoot();
    const current = execFileSync(
      process.execPath,
      ['--import', loader, '--input-type=module', '--eval', script],
      { cwd: temporary, encoding: 'utf8' },
    );
    expect(current).toBe(menuImageRoot());
    expect(menuImageRoot('var/menu-images')).toBe(menuImageRoot(''));
    expect(menuImageRoot(temporary)).toBe(temporary);
  });

  it('reuses a content-derived UUID on repeat imports and changes the URL for new bytes', async () => {
    const root = await temporaryRoot();
    const [first, second] = await Promise.all([
      storeMenuImage(png, { root }),
      storeMenuImage(png, { root }),
    ]);
    expect(first.imageUrl).toMatch(/^\/api\/menu-images\/[a-f0-9-]{36}\.png$/);
    expect(second.imageUrl).toBe(first.imageUrl);
    expect(await readdir(root)).toEqual([first.name]);
    expect((await readMenuImage(first.name, { root })).bytes).toEqual(png);
    const replacement = await storeMenuImage(Buffer.concat([png, Buffer.from('replacement')]), {
      root,
    });
    expect(replacement.imageUrl).not.toBe(first.imageUrl);
    expect(await readFile(join(root, first.name))).toEqual(png);
  });

  it('does not overwrite an existing file with conflicting content', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, menuImageName(png)), 'different bytes');
    await expect(storeMenuImage(png, { root })).rejects.toThrow(
      'Tên ảnh đã tồn tại với nội dung khác.',
    );
    expect((await readFile(join(root, menuImageName(png)))).toString()).toBe('different bytes');
  });

  it('rejects traversal and reads existing administrative UUID file names', async () => {
    const root = await temporaryRoot();
    await expect(readMenuImage('../outside.png', { root })).rejects.toThrow('Không tìm thấy ảnh.');
    const oldName = '12345678-1234-4234-8234-123456789abc.png';
    await writeFile(join(root, oldName), png);
    expect((await readMenuImage(oldName, { root })).mimeType).toBe('image/png');
  });

  it('only accepts uploaded product URLs that point to valid existing shared files', async () => {
    const root = await temporaryRoot();
    const stored = await storeMenuImage(png, { root });
    expect(await validateMenuImageUrl(stored.imageUrl, { root })).toBe(stored.imageUrl);
    expect(await validateMenuImageUrl(null, { root })).toBeNull();
    expect(await validateMenuImageUrl('  ', { root })).toBeNull();
    await expect(validateMenuImageUrl('/images/menu/chinh-01.webp', { root })).rejects.toThrow(
      'Chọn ảnh đã tải lên',
    );
    await expect(validateMenuImageUrl('https://example.com/food.webp', { root })).rejects.toThrow(
      'Chọn ảnh đã tải lên',
    );
    await expect(validateMenuImageUrl(stored.imageUrl + '?v=2', { root })).rejects.toThrow(
      'Chọn ảnh đã tải lên',
    );
    await expect(
      validateMenuImageUrl('/api/menu-images/12345678-1234-4234-8234-123456789abc.png', { root }),
    ).rejects.toThrow('Không tìm thấy ảnh món.');
  });

  it('reproduces initial dish and promotion images in the same store on a fresh install', async () => {
    const root = await temporaryRoot();
    const first = await importMenuMedia({ root });
    const repeated = await importMenuMedia({ root });
    expect(first.count).toBeGreaterThan(0);
    expect(repeated.count).toBe(first.count);
    expect(await readdir(root)).toHaveLength(first.count);
    for (const url of [...Object.values(menuMedia), ...Object.values(menuPromotionMedia)]) {
      expect(url).toMatch(/^\/api\/menu-images\/[a-f0-9-]{36}\.(png|jpg|webp)$/);
      expect((await readMenuImage(url.split('/').pop()!, { root })).bytes.length).toBeGreaterThan(
        0,
      );
    }
  });
});
