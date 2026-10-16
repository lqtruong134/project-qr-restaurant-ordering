import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import manifest from '../resources/menu-images/manifest.json' with { type: 'json' };
import { menuImageName, menuImageRoot, menuImageUrl, storeMenuImage } from './menu-images.js';

const resourceRoot = fileURLToPath(new URL('../resources/menu-images/', import.meta.url));
const urls = (entries: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(entries).map(([key, name]) => [key, menuImageUrl(name)]));

/** Bootstrap data only; product.image_url is the single image source used by the UI. */
export const menuMedia = urls(manifest.products);
export const menuPromotionMedia = urls(manifest.promotions);
export const menuImageMigration = urls(manifest.legacyUrls);

/** Install packaged images into the same runtime store used by administrative uploads. No DB writes. */
export async function importMenuMedia(options: { root?: string } = {}) {
  const root = options.root ?? menuImageRoot();
  const names = new Set([
    ...Object.values(manifest.products),
    ...Object.values(manifest.promotions),
    ...Object.values(manifest.legacyUrls),
  ]);
  for (const name of names) {
    menuImageUrl(name);
    const bytes = await readFile(join(resourceRoot, name));
    if (menuImageName(bytes) !== name) throw new Error('Ảnh khởi tạo không khớp manifest: ' + name);
    await storeMenuImage(bytes, { root });
  }
  return { root, count: names.size, products: menuMedia, promotions: menuPromotionMedia };
}
