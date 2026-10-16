import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId, refreshRestaurantCatalog } from '../packages/database/src/seed.js';
import {
  restaurantCategories,
  restaurantCategorySortOrder,
  restaurantProductCategoryCodes,
  restaurantIngredients as demoIngredients,
  restaurantMenu as demoMenu,
  restaurantCombos,
} from '../packages/database/src/restaurant-data.js';
import { readMenuImage } from '../packages/database/src/menu-images.js';
import { menuMedia } from '../packages/database/src/menu-media.js';

let host: Database, db: Database;
const databaseName = 'thesis_catalog_refresh_' + randomBytes(6).toString('hex');
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  host = createDatabase(url.toString());
  await host.pool.query('CREATE DATABASE ' + databaseName);
  url.pathname = '/' + databaseName;
  db = createDatabase(url.toString());
  for (const folder of readdirSync('packages/database/prisma/migrations')
    .filter((name) => /^\d/.test(name))
    .sort())
    await db.pool.query(
      readFileSync('packages/database/prisma/migrations/' + folder + '/migration.sql', 'utf8'),
    );
  await seed(db, randomBytes(24).toString('hex'));
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_catalog_refresh_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);

it('fresh catalogue has consistent serving descriptions and a stocked recipe for every dish', async () => {
  expect(await db.prisma.product.count()).toBe(demoMenu.length + restaurantCombos.length);
  expect(await db.prisma.ingredient.count()).toBe(demoIngredients.length);
  expect(await db.prisma.inventory_balance.count()).toBe(demoIngredients.length);
  expect(await db.prisma.product.count({ where: { image_url: { not: null } } })).toBe(
    Object.keys(menuMedia).length,
  );
  for (const [code, image_url] of Object.entries(menuMedia)) {
    expect(
      (await readMenuImage(image_url.slice('/api/menu-images/'.length))).bytes.length,
      image_url,
    ).toBeGreaterThan(0);
    expect((await db.prisma.product.findFirstOrThrow({ where: { code } })).image_url).toBe(
      image_url,
    );
  }
  expect(
    (
      await db.prisma.menu_category.findUniqueOrThrow({
        where: { restaurant_id_code: { restaurant_id: restaurantId, code: 'MON-NUONG' } },
      })
    ).name,
  ).toBe('Món mặn');
  const recipe = await db.pool.query(`
    SELECT p.code,count(i.id)::int AS lines,bool_and(b.available_qty>=i.quantity) AS stocked
    FROM product p JOIN recipe_bom r ON r.product_id=p.id AND r.status='ACTIVE'
    JOIN recipe_bom_item i ON i.recipe_bom_id=r.id
    JOIN inventory_balance b ON b.ingredient_id=i.ingredient_id
    GROUP BY p.code ORDER BY p.code`);
  expect(recipe.rows).toHaveLength(demoMenu.length + restaurantCombos.length);
  expect(recipe.rows.every((row) => row.lines > 0 && row.stocked)).toBe(true);
  expect(
    demoMenu.every((dish) =>
      /cuốn|phần|đĩa|tô|tộ|thố|nồi|ly|chén|hũ|chai|trái|mâm|viên/.test(dish.description),
    ),
  ).toBe(true);
});

it('all 91 seeded products use the reviewed categories; canh, hot pots, rice, noodles and vegetables are distinct', async () => {
  const categories = await db.prisma.menu_category.findMany({ orderBy: { sort_order: 'asc' } });
  expect(categories.map((category) => category.name)).toEqual([
    'Combo',
    'Khai vị & gỏi',
    'Bánh & cuốn',
    'Cơm',
    'Bún, phở & mì',
    'Món mặn',
    'Rau & đậu hũ',
    'Canh',
    'Lẩu',
    'Tráng miệng',
    'Thức uống',
  ]);
  const products = await db.prisma.product.findMany({ include: { menu_category: true } });
  expect(products).toHaveLength(91);
  expect(Object.keys(restaurantProductCategoryCodes).sort()).toEqual(
    products.map((product) => product.code).sort(),
  );
  for (const product of products)
    expect(product.menu_category.code, product.code).toBe(
      restaurantProductCategoryCodes[product.code],
    );
  const grouped = Object.fromEntries(
    categories.map((category) => [
      category.code,
      products.filter((product) => product.category_id === category.id).length,
    ]),
  );
  expect(grouped).toEqual({
    COMBO: 5,
    'KHAI-VI': 8,
    'BANH-CUON': 3,
    'MON-CHINH': 8,
    'BUN-PHO-MI': 7,
    'MON-NUONG': 19,
    'RAU-DAU-HU': 3,
    CANH: 11,
    'CANH-LAU': 5,
    'TRANG-MIENG': 13,
    'DO-UONG': 9,
  });
  for (const product of products.filter((row) => row.name.startsWith('Canh ')))
    expect(product.menu_category.name, product.code).toBe('Canh');
  for (const product of products.filter((row) => row.name.startsWith('Lẩu ')))
    expect(product.menu_category.name, product.code).toBe('Lẩu');
  for (const product of products.filter((row) => row.name.startsWith('Cơm ')))
    expect(product.menu_category.name, product.code).toBe('Cơm');
  expect(products.find((row) => row.code === 'LAU-11')?.menu_category.name).toBe('Canh');
  expect(products.find((row) => row.code === 'CHINH-09')?.menu_category.name).toBe('Bánh & cuốn');
  for (const code of ['KHAI-04', 'KHAI-08', 'KHAI-09'])
    expect(products.find((row) => row.code === code)?.menu_category.name, code).toBe(
      'Rau & đậu hũ',
    );
  expect(products.find((row) => row.code === 'KHAI-10')?.menu_category.name).toBe('Món mặn');
  expect(products.find((row) => row.code === 'KHAI-07')?.menu_category.name).toBe('Khai vị & gỏi');
});

it('legacy category IDs retain positions 0–6 and a second seed preserves IDs, assignments and operational data', async () => {
  const expectedLegacy = [
    'KHAI-VI',
    'MON-CHINH',
    'MON-NUONG',
    'CANH-LAU',
    'DO-UONG',
    'TRANG-MIENG',
    'COMBO',
  ];
  expect(restaurantCategories.slice(0, 7).map(([code]) => code)).toEqual(expectedLegacy);
  const before = await db.prisma.menu_category.findMany({ orderBy: { code: 'asc' } });
  for (const [index, code] of expectedLegacy.entries())
    expect(before.find((category) => category.code === code)?.id, code).toBe(
      '10000000-0000-4000-8000-' + String(50 + index).padStart(12, '0'),
    );
  for (const [code] of restaurantCategories)
    expect(before.find((category) => category.code === code)?.sort_order, code).toBe(
      restaurantCategorySortOrder(code),
    );
  const productIdsBefore = await db.prisma.product.findMany({
    select: { id: true, code: true, category_id: true, version: true },
    orderBy: { code: 'asc' },
  });
  const protectedBefore = await protectedSnapshot();
  await seed(db, randomBytes(24).toString('hex'), { includeWorkforce: false });
  expect(await db.prisma.menu_category.findMany({ orderBy: { code: 'asc' } })).toEqual(before);
  expect(
    await db.prisma.product.findMany({
      select: { id: true, code: true, category_id: true, version: true },
      orderBy: { code: 'asc' },
    }),
  ).toEqual(productIdsBefore);
  expect(await protectedSnapshot()).toEqual(protectedBefore);
});
// Hash comparison keeps credentials and other sensitive fields out of test output.
async function protectedSnapshot() {
  const fields: Record<string, string[]> = {
    restaurant: ['address', 'updated_at'],
    menu_category: ['name', 'description', 'updated_at'],
    product: ['description', 'image_url', 'version', 'updated_at'],
    app_user: [],
    user_role: [],
    role_permission: [],
    dining_area: [],
    dining_table: [],
    inventory_balance: [],
    inventory_movement: [],
    goods_receipt: [],
    goods_receipt_item: [],
    ingredient: [],
    recipe_bom: [],
    recipe_bom_item: [],
    table_session: [],
    order_item: [],
    payment_transaction: [],
    refund_transaction: [],
    employee_pay_rate: [],
    work_shift: [],
    shift_template: [],
    shift_assignment: [],
    attendance_record: [],
    payroll_run: [],
    payroll_slip: [],
    payroll_line: [],
    payroll_payment: [],
  };
  const result: Record<string, string> = {};
  for (const [table, excluded] of Object.entries(fields)) {
    const expression = 'to_jsonb(t)' + excluded.map((field) => " - '" + field + "'").join('');
    const digest = await db.pool.query(
      `SELECT md5(COALESCE(jsonb_agg(${expression} ORDER BY ${expression}), '[]'::jsonb)::text) AS value FROM ${table} t`,
    );
    result[table] = digest.rows[0].value;
  }
  return result;
}

it('preview is read-only; applying presentation refresh preserves custom prices, uploads, renamed dishes and all operational data', async () => {
  await db.prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      address: 'Khu trung tâm Cần Thơ · nhà hàng mô phỏng phục vụ luận văn',
    },
  });
  const key = (code: string) => ({ restaurant_id_code: { restaurant_id: restaurantId, code } });
  await db.prisma.menu_category.update({
    where: key('MON-NUONG'),
    data: {
      name: 'Món nướng',
      description: 'Thơm lừng từ căn bếp',
    },
  });
  await db.prisma.product.update({
    where: key('KHAI-01'),
    data: {
      description: 'Mô tả cũ',
      image_url: '/menu/starter.svg',
      base_price: 123456n,
      is_active: false,
    },
  });
  await db.prisma.product.update({
    where: key('KHAI-02'),
    data: {
      description: 'Mô tả cũ',
      image_url: '/uploads/nha-hang/cha-gio.webp',
    },
  });
  await db.prisma.product.update({
    where: key('KHAI-03'),
    data: {
      name: 'Gỏi gà miền Tây',
      description: 'Mô tả riêng của nhà hàng',
      image_url: null,
    },
  });
  await db.prisma.product.update({ where: key('COMBO-01'), data: { image_url: null } });
  const balance = await db.prisma.inventory_balance.findFirstOrThrow();
  await db.prisma.inventory_balance.update({
    where: { id: balance.id },
    data: {
      on_hand_qty: { increment: 1 },
      available_qty: { increment: 1 },
      version: { increment: 1 },
    },
  });
  const protectedBefore = await protectedSnapshot();
  const productsBefore = await db.prisma.product.findMany({ orderBy: { code: 'asc' } });
  const auditBefore = await db.prisma.business_audit_event.count();
  const preview = await refreshRestaurantCatalog(db);
  expect(preview.applied).toBe(false);
  expect(preview.changes).toHaveLength(5);
  expect(preview.skippedCustomizedProductCodes).toEqual(['KHAI-03']);
  expect(await db.prisma.product.findMany({ orderBy: { code: 'asc' } })).toEqual(productsBefore);
  expect(await db.prisma.business_audit_event.count()).toBe(auditBefore);
  const applied = await refreshRestaurantCatalog(db, true);
  expect(applied.changes).toEqual(preview.changes);
  expect(await protectedSnapshot()).toEqual(protectedBefore);
  expect((await db.prisma.product.findUniqueOrThrow({ where: key('KHAI-01') })).image_url).toBe(
    menuMedia['KHAI-01'],
  );
  expect((await db.prisma.product.findUniqueOrThrow({ where: key('COMBO-01') })).image_url).toBe(
    menuMedia['COMBO-01'],
  );
  expect((await db.prisma.product.findUniqueOrThrow({ where: key('KHAI-02') })).image_url).toBe(
    '/uploads/nha-hang/cha-gio.webp',
  );
  expect((await db.prisma.product.findUniqueOrThrow({ where: key('KHAI-03') })).description).toBe(
    'Mô tả riêng của nhà hàng',
  );
  expect(
    (await db.prisma.product.findUniqueOrThrow({ where: key('KHAI-03') })).image_url,
  ).toBeNull();
  expect(await db.prisma.business_audit_event.count()).toBe(auditBefore + 1);
});

it('repeating the refresh creates no further changes or audit entries', async () => {
  const count = await db.prisma.business_audit_event.count();
  expect((await refreshRestaurantCatalog(db, true)).changes).toEqual([]);
  expect(await db.prisma.business_audit_event.count()).toBe(count);
});
