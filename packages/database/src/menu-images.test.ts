import { afterEach, describe, expect, it, vi } from 'vitest';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

// Hold a real write after its first bytes. This tests visibility at the actual
// filesystem boundary without timing sleeps or relying on scheduler luck.
function pauseFirstImageWrite() {
  let signalPartial!: () => void;
  let releaseWrite!: () => void;
  const partial = new Promise<void>((resolve) => {
    signalPartial = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const original = filesystem.writeFile;
  let paused = false;
  const spy = vi.spyOn(filesystem, 'writeFile').mockImplementation(async (file, data, options) => {
    if (!paused && data instanceof Uint8Array && Buffer.from(data).equals(png)) {
      paused = true;
      const bytes = Buffer.from(data),
        middle = Math.ceil(bytes.length / 2);
      await original(file, bytes.subarray(0, middle), options);
      signalPartial();
      await proceed;
      if (typeof file === 'string') await original(file, bytes.subarray(middle), { flag: 'a' });
      else await original(file, bytes.subarray(middle), options);
    } else await original(file, data, options);
  });
  syncBuiltinESMExports();
  return {
    partial,
    release: releaseWrite,
    restore() {
      spy.mockRestore();
      syncBuiltinESMExports();
    },
  };
}

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
    expect((await stat(join(root, first.name))).mode & 0o777).toBe(0o600);
    const replacement = await storeMenuImage(Buffer.concat([png, Buffer.from('replacement')]), {
      root,
    });
    expect(replacement.imageUrl).not.toBe(first.imageUrl);
    expect(await readFile(join(root, first.name))).toEqual(png);
  });

  it('publishes no final image name until all bytes have been written', async () => {
    const root = await temporaryRoot();
    const pause = pauseFirstImageWrite();
    const pending = storeMenuImage(png, { root });
    void pending.catch(() => {});
    try {
      await pause.partial;
      await expect(readMenuImage(menuImageName(png), { root })).rejects.toMatchObject({
        code: 'ENOENT',
      });
      pause.release();
      const stored = await pending;
      expect((await readMenuImage(stored.name, { root })).bytes).toEqual(png);
      expect(await readdir(root)).toEqual([stored.name]);
    } finally {
      pause.release();
      await pending.catch(() => {});
      pause.restore();
    }
  });

  it('accepts an identical concurrent writer while the first write is paused midway', async () => {
    const root = await temporaryRoot();
    const pause = pauseFirstImageWrite();
    const first = storeMenuImage(png, { root });
    void first.catch(() => {});
    let second: ReturnType<typeof storeMenuImage> | undefined;
    try {
      await pause.partial;
      second = storeMenuImage(png, { root });
      await expect(second).resolves.toMatchObject({ name: menuImageName(png) });
      // The second writer has published; readers still must never see the first writer's partial bytes.
      expect((await readMenuImage(menuImageName(png), { root })).bytes).toEqual(png);
      pause.release();
      expect((await first).name).toBe((await second).name);
      expect(await readdir(root)).toEqual([menuImageName(png)]);
    } finally {
      pause.release();
      await Promise.allSettled(second ? [first, second] : [first]);
      pause.restore();
    }
  });

  it('does not overwrite an existing file with conflicting content', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, menuImageName(png)), 'different bytes');
    await expect(storeMenuImage(png, { root })).rejects.toThrow(
      'Tên ảnh đã tồn tại với nội dung khác.',
    );
    expect((await readFile(join(root, menuImageName(png)))).toString()).toBe('different bytes');
    expect(await readdir(root)).toEqual([menuImageName(png)]);
  });

  it.each(['write', 'publish'] as const)(
    'cleans private staging files after a %s failure',
    async (phase) => {
      const root = await temporaryRoot();
      const failure = Object.assign(new Error('Synthetic menu storage failure'), { code: 'EIO' });
      const original = filesystem.writeFile;
      const spy =
        phase === 'write'
          ? vi
              .spyOn(filesystem, 'writeFile')
              .mockImplementationOnce(async (file, _data, options) => {
                await original(file, png.subarray(0, 8), options);
                throw failure;
              })
          : vi.spyOn(filesystem, 'link').mockRejectedValueOnce(failure);
      syncBuiltinESMExports();
      try {
        await expect(storeMenuImage(png, { root })).rejects.toBe(failure);
        expect(await readdir(root)).toEqual([]);
      } finally {
        spy.mockRestore();
        syncBuiltinESMExports();
      }
    },
  );

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
