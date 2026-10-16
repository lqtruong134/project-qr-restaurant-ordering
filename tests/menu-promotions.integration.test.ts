import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { seedMenuPromotions } from '../packages/database/src/menu-promotions.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';

const databaseName = 'thesis_promotions_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
let host: Database, db: Database, app: ReturnType<typeof buildApp>, imageRoot: string;
const originalImageRoot = process.env.MENU_UPLOAD_DIR;
const cookies: Record<string, string> = {};
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const request = (
  path: string,
  body?: unknown,
  user = 'quyettruong05',
  method: Method = body === undefined ? 'GET' : 'POST',
) =>
  app.inject({
    method,
    url: path,
    headers: { ...headers, cookie: cookies[user] ?? '' },
    payload: body as Record<string, unknown>,
  });
const ok = async (path: string, body?: unknown, method?: Method) => {
  const response = await request(path, body, undefined, method);
  expect(response.statusCode, path + ' ' + response.body).toBe(200);
  return response.json();
};
beforeAll(async () => {
  imageRoot = await mkdtemp(join(tmpdir(), 'qr-promotion-api-'));
  process.env.MENU_UPLOAD_DIR = imageRoot;
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((n) => /^\d/.test(n))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  await seed(db, password);
  await seedMenuPromotions(db, restaurantId);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'p'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const username of ['quyettruong05', 'pv001']) {
    const response = await request('/auth/login', { username, password }, '');
    expect(response.statusCode).toBe(200);
    cookies[username] = response.cookies.map((c) => c.name + '=' + c.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_promotions_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
  if (imageRoot) await rm(imageRoot, { recursive: true, force: true });
  if (originalImageRoot === undefined) delete process.env.MENU_UPLOAD_DIR;
  else process.env.MENU_UPLOAD_DIR = originalImageRoot;
}, 60000);
const upload = async () =>
  (
    await ok('/core/menu-images', {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=',
    })
  ).imageUrl as string;
const createDish = async (name: string) => {
  const catalog = await ok('/core/catalog');
  return ok('/core/products', {
    categoryId: catalog.categories[0].id,
    code: randomUUID(),
    name,
    price: '35000',
    stockManaged: false,
  });
};
const editDish = async (product: Record<string, unknown>, fields: Record<string, unknown>) =>
  ok(
    '/core/products/' + product.id,
    {
      name: product.name,
      price: String(product.base_price),
      active: product.is_active,
      availability: product.availability_status,
      version: product.version,
      ...fields,
    },
    'PATCH',
  );

it('installs default banners as ordinary editable records and restricts their management to admin', async () => {
  const rows = await ok('/core/menu-promotions');
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.image_url).toMatch(/^[/]api[/]menu-images[/][a-f0-9-]{36}[.]webp$/);
    expect(row.matches_current_menu).toBe(true);
    expect(row.image_width).toBeGreaterThan(0);
    expect(row.image_height).toBeGreaterThan(0);
  }
  expect((await request('/core/menu-promotions', undefined, 'pv001')).statusCode).toBe(403);
  expect(
    (
      await request(
        '/core/menu-promotions',
        { productId: rows[0].product_id, imageUrl: rows[0].image_url },
        'pv001',
      )
    ).statusCode,
  ).toBe(403);
});

it('allows a newly created product banner, derives file dimensions and hides stale printed prices without blocking the hide action', async () => {
  const product = await createDish('Món mới quản trị thêm'),
    imageUrl = await upload();
  const promotion = await ok('/core/menu-promotions', {
    productId: product.id,
    imageUrl,
    presentation: 'POSTER',
    expectedPrice: '35000',
    eyebrow: 'Món mới',
    sortOrder: 5,
  });
  expect(promotion).toMatchObject({
    image_url: imageUrl,
    image_width: 1,
    image_height: 1,
    expected_price: '35000',
    expected_components: [],
  });
  expect(
    (
      await request(
        '/core/menu-promotions/' + promotion.id,
        { version: promotion.version, expectedPrice: '50000' },
        undefined,
        'PATCH',
      )
    ).statusCode,
  ).toBe(400);
  const changed = await editDish(product, { price: '40000' });
  let rows = await ok('/core/menu-promotions');
  expect(
    rows.find((r: Record<string, unknown>) => r.id === promotion.id).matches_current_menu,
  ).toBe(false);
  const hidden = await ok(
    '/core/menu-promotions/' + promotion.id,
    { version: promotion.version, isActive: false },
    'PATCH',
  );
  expect(hidden.is_active).toBe(false);
  expect(
    (
      await request(
        '/core/menu-promotions/' + promotion.id,
        { version: promotion.version, isActive: true },
        undefined,
        'PATCH',
      )
    ).statusCode,
  ).toBe(409);
  const aligned = await ok(
    '/core/menu-promotions/' + promotion.id,
    { version: hidden.version, expectedPrice: '40000', refreshChecks: true, isActive: true },
    'PATCH',
  );
  expect(aligned.expected_price).toBe('40000');
  rows = await ok('/core/menu-promotions');
  expect(
    rows.find((r: Record<string, unknown>) => r.id === promotion.id).matches_current_menu,
  ).toBe(true);
  for (const invalid of [
    '/images/menu/chinh-01.webp',
    'https://example.com/menu.webp',
    '/api/menu-images/' + randomUUID() + '.png',
  ])
    expect(
      (
        await request(
          '/core/menu-promotions/' + aligned.id,
          { version: aligned.version, imageUrl: invalid },
          undefined,
          'PATCH',
        )
      ).statusCode,
    ).toBe(400);
  expect(changed.base_price).toBe('40000');
});

it('captures actual combo components and hides the banner after a portion changes until admin confirms the updated image', async () => {
  const [a, b] = await Promise.all([
      createDish('Món thành phần A'),
      createDish('Món thành phần B'),
    ]),
    catalog = await ok('/core/catalog');
  let combo = await ok('/core/products', {
    categoryId: catalog.categories.find((c: Record<string, unknown>) => c.code === 'COMBO').id,
    code: randomUUID(),
    name: 'Combo mới',
    price: '69000',
    productKind: 'COMBO',
    components: [
      { productId: a.id, quantity: 1 },
      { productId: b.id, quantity: 1 },
    ],
  });
  const promotion = await ok('/core/menu-promotions', {
    productId: combo.id,
    imageUrl: await upload(),
    presentation: 'POSTER',
    expectedPrice: null,
  });
  expect(promotion.expected_components).toHaveLength(2);
  combo = await editDish(combo, {
    components: [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 1 },
    ],
  });
  expect(
    (await ok('/core/menu-promotions')).find((r: Record<string, unknown>) => r.id === promotion.id)
      .matches_current_menu,
  ).toBe(false);
  await ok(
    '/core/menu-promotions/' + promotion.id,
    { version: promotion.version, refreshChecks: true },
    'PATCH',
  );
  expect(
    (await ok('/core/menu-promotions')).find((r: Record<string, unknown>) => r.id === promotion.id)
      .matches_current_menu,
  ).toBe(true);
  expect(combo.product_kind).toBe('COMBO');
});

it('preserves administrative edits and deletions on reseed and allows adding the same product again explicitly', async () => {
  const rows = await ok('/core/menu-promotions'),
    original = rows.find((r: Record<string, unknown>) => r.product_code === 'CHINH-11');
  const edited = await ok(
    '/core/menu-promotions/' + original.id,
    {
      version: original.version,
      eyebrow: 'Giới thiệu do quản trị sửa',
      sortOrder: 42,
      isActive: false,
    },
    'PATCH',
  );
  await seedMenuPromotions(db, restaurantId);
  expect(
    (await ok('/core/menu-promotions')).find((r: Record<string, unknown>) => r.id === original.id),
  ).toMatchObject({ eyebrow: 'Giới thiệu do quản trị sửa', sort_order: 42, is_active: false });
  await ok('/core/menu-promotions/' + original.id, { version: edited.version }, 'DELETE');
  await seedMenuPromotions(db, restaurantId);
  expect(
    (await ok('/core/menu-promotions')).some((r: Record<string, unknown>) => r.id === original.id),
  ).toBe(false);
  const added = await ok('/core/menu-promotions', {
    productId: original.product_id,
    imageUrl: original.image_url,
    presentation: 'POSTER',
    expectedPrice: original.expected_price,
    isActive: true,
    refreshChecks: true,
  });
  expect(added.id).toBe(original.id);
  expect(
    (await ok('/core/menu-promotions')).some((r: Record<string, unknown>) => r.id === original.id),
  ).toBe(true);
});
