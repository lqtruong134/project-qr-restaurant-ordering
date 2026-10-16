import { menuMedia, menuPromotionMedia } from '../packages/database/src/menu-media.js';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { seed, restaurantId } from '../packages/database/src/seed.js';
import { addRestaurantMenuExtensions } from '../packages/database/src/menu-extensions.js';
import { refreshRestaurantSetMenu } from '../packages/database/src/set-menu-refresh.js';
import {
  demoIngredients,
  menuExtensionCodes,
  restaurantCombos,
} from '../packages/database/src/demo-data.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { restaurantPolicy } from '../packages/contracts/src/index.js';
import { withTableCode } from './table-code-fixture.js';
import { orderedComboContents } from '../apps/api/src/modules/catalog/combo.service.js';

let host: Database, db: Database, app: ReturnType<typeof buildApp>, imageRoot: string;
const originalImageRoot = process.env.MENU_UPLOAD_DIR;
const databaseName = 'thesis_combo_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const headers = { origin: 'http://localhost:3100', 'x-csrf-protection': '1' };
const cookies: Record<string, string> = {};
type Method = 'GET' | 'POST' | 'PATCH';
async function request(
  path: string,
  body?: unknown,
  user = 'quyettruong05',
  method: Method = body === undefined ? 'GET' : 'POST',
) {
  if (path === '/guest/join') body = await withTableCode(app, db, cookies.pv001!, headers, body);
  return app.inject({
    method,
    url: path,
    headers: { ...headers, cookie: cookies[user] ?? user },
    payload: body as Record<string, unknown>,
  });
}
async function ok(path: string, body?: unknown, user?: string, method?: Method) {
  const response = await request(path, body, user, method);
  expect(response.statusCode, path + ' ' + response.body).toBe(200);
  return response.json();
}
beforeAll(async () => {
  imageRoot = await mkdtemp(join(tmpdir(), 'qr-combo-api-'));
  process.env.MENU_UPLOAD_DIR = imageRoot;
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
  await seed(db, password);
  app = buildApp(db);
  await registerAuth(app, db, {
    secret: 'c'.repeat(96),
    restaurantId,
    origins: [headers.origin],
    secure: false,
    loginLimit: 100,
  });
  registerModules(app, db, restaurantId);
  for (const user of ['quyettruong05', 'pv001', 'bep001']) {
    const response = await request('/auth/login', { username: user, password }, '');
    expect(response.statusCode).toBe(200);
    cookies[user] = response.cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ');
  }
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_combo_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
  if (imageRoot) await rm(imageRoot, { recursive: true, force: true });
  if (originalImageRoot === undefined) delete process.env.MENU_UPLOAD_DIR;
  else process.env.MENU_UPLOAD_DIR = originalImageRoot;
}, 60000);
async function product(code: string) {
  return (await ok('/core/catalog')).products.find((row: { code: string }) => row.code === code);
}
async function patch(row: Record<string, unknown>, fields: Record<string, unknown>) {
  return ok(
    '/core/products/' + row.id,
    {
      name: row.name,
      price: String(row.base_price),
      version: row.version,
      active: row.is_active,
      availability: row.configured_availability_status ?? row.availability_status,
      ...fields,
    },
    undefined,
    'PATCH',
  );
}
async function table() {
  const area = await db.prisma.dining_area.findFirstOrThrow();
  const row = await ok('/core/tables', {
    code: randomUUID(),
    name: 'Bàn combo',
    areaId: area.id,
    capacity: 4,
  });
  const session = await ok('/core/tables/' + row.id + '/open', {}, 'pv001');
  return { row, session };
}
async function order(sid: string, pid: string, quantity = 1) {
  const batch = await ok(
    '/core/sessions/' + sid + '/orders',
    { requestId: randomUUID(), lines: [{ productId: pid, quantity }] },
    'pv001',
  );
  const item = await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } });
  return { batch, item };
}
async function trackedDishes(amountA = '0.1', amountB = '0.2', stock = '10') {
  const inv = await ok('/core/inventory');
  const ingredient = await ok('/core/ingredients', {
    code: 'COMBO-' + randomUUID().slice(0, 8),
    name: 'Nguyên liệu combo',
    unitId: inv.units.find((row: { code: string }) => row.code === 'KG').id,
  });
  const receipt = await ok('/core/receipts', {
    locationId: inv.locations[0].id,
    supplier: 'Kho nguyên liệu',
    lines: [{ ingredientId: ingredient.id, quantity: stock, unitCost: '50000' }],
  });
  await ok('/core/receipts/' + receipt.id + '/approve', { expectedVersion: receipt.version });
  const category = (await ok('/core/catalog')).categories[0];
  const dishes = [];
  for (const amount of [amountA, amountB]) {
    const dish = await ok('/core/products', {
      categoryId: category.id,
      code: randomUUID(),
      name: 'Món combo ' + amount,
      price: '45000',
    });
    await ok('/core/products/' + dish.id + '/bom', {
      yield: '1',
      lines: [{ ingredientId: ingredient.id, quantity: amount, waste: '0' }],
    });
    dishes.push(dish);
  }
  const combo = await ok('/core/products', {
    categoryId: category.id,
    code: randomUUID(),
    name: 'Combo hai món',
    price: '79000',
    productKind: 'COMBO',
    components: dishes.map((dish) => ({ productId: dish.id, quantity: 1 })),
  });
  return { ingredient, dishes, combo };
}

it('adds poster dishes across categories and units with audited opening stock only for new ingredients, preserving legacy records', async () => {
  const dishCodes = menuExtensionCodes.filter((code) => !['CHINH-09', 'CHINH-10'].includes(code));
  const comboCodes = ['COMBO-04', 'COMBO-05'];
  const ingredientCodes = [
    'RICESTICKY',
    'NORI',
    'PORKBELLY',
    'MAMRUOC',
    'OYSTERSAUCE',
    'SHALLOT',
    'GINGER',
    'STRAWBERRY',
    'BOKCHOY',
    'GALANGAL',
  ];
  let fixtureRound = 0;
  async function removePosterFixture() {
    await db.prisma.$transaction(async (tx) => {
      const rows = await tx.product.findMany({
        where: { code: { in: [...dishCodes, ...comboCodes] } },
      });
      const ids = rows.map((row) => row.id);
      const recipes = await tx.recipe_bom.findMany({ where: { product_id: { in: ids } } });
      await tx.recipe_bom_item.deleteMany({
        where: { recipe_bom_id: { in: recipes.map((row) => row.id) } },
      });
      await tx.recipe_bom.deleteMany({ where: { product_id: { in: ids } } });
      await tx.product_combo_item.deleteMany({ where: { combo_product_id: { in: ids } } });
      await tx.product.deleteMany({ where: { id: { in: ids } } });
      const ingredients = await tx.ingredient.findMany({
        where: { code: { in: ingredientCodes } },
      });
      // Simulate a catalogue that lacks these codes, without deleting immutable approved receipts.
      // Existing ingredient rows, receipt lines and balances remain protected by the snapshot.
      for (const ingredient of ingredients)
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { code: `BEFORE-${fixtureRound}-${ingredient.code}` },
        });
      fixtureRound++;
    });
  }
  await removePosterFixture();
  await db.prisma.product.updateMany({
    where: { code: 'NUONG-01' },
    data: { base_price: 187000n, image_url: '/uploads/own-beef.webp' },
  });
  const oldProducts = await db.prisma.product.findMany({ orderBy: { id: 'asc' } });
  const oldRecipes = await db.prisma.recipe_bom.findMany({ orderBy: { id: 'asc' } });
  const oldBalances = await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } });
  const oldMovements = await db.prisma.inventory_movement.findMany({ orderBy: { id: 'asc' } });
  async function operationalDigest() {
    const result: Record<string, string> = {};
    for (const name of [
      'app_user',
      'employee_pay_rate',
      'shift_assignment',
      'attendance_record',
      'table_session',
      'order_item',
      'payment_transaction',
      'refund_transaction',
      'payroll_line',
    ])
      result[name] = (
        await db.pool.query(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS digest FROM ${name} t`,
        )
      ).rows[0].digest;
    return result;
  }
  const baseline = await operationalDigest();
  const preview = await addRestaurantMenuExtensions(db, false, true);
  expect(preview).toMatchObject({
    applied: false,
    products: dishCodes,
    combos: comboCodes,
    ingredients: ingredientCodes,
  });
  expect(await db.prisma.product.findMany({ orderBy: { id: 'asc' } })).toEqual(oldProducts);
  expect(await db.prisma.inventory_balance.findMany({ orderBy: { id: 'asc' } })).toEqual(
    oldBalances,
  );
  // Omitting opening stock creates empty balances; a rerun must not fill or overwrite them.
  await addRestaurantMenuExtensions(db, true, false);
  const emptyBalances = await db.prisma.inventory_balance.findMany({
    where: { ingredient: { code: { in: ingredientCodes } } },
    orderBy: { id: 'asc' },
  });
  expect(emptyBalances).toHaveLength(10);
  expect(
    emptyBalances.every(
      (row) => row.on_hand_qty.toString() === '0' && row.avg_cost.toString() === '0',
    ),
  ).toBe(true);
  expect((await product('COMBO-04')).availability_status).toBe('UNAVAILABLE');
  await addRestaurantMenuExtensions(db, true, true);
  expect(
    await db.prisma.inventory_balance.findMany({
      where: { id: { in: emptyBalances.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(emptyBalances);
  await removePosterFixture();
  await addRestaurantMenuExtensions(db, true, true);
  const created = await db.prisma.ingredient.findMany({ where: { code: { in: ingredientCodes } } });
  const movements = await db.prisma.inventory_movement.findMany({
    where: { ingredient_id: { in: created.map((row) => row.id) } },
  });
  expect(movements).toHaveLength(10);
  for (const ingredient of created) {
    const definition = demoIngredients.find((row) => row[0] === ingredient.code)!;
    const balance = await db.prisma.inventory_balance.findFirstOrThrow({
      where: { ingredient_id: ingredient.id },
    });
    const movement = movements.find((row) => row.ingredient_id === ingredient.id)!;
    expect(Number(balance.on_hand_qty)).toBe(definition[3]);
    expect(Number(balance.avg_cost)).toBe(definition[4]);
    expect(movement).toMatchObject({
      movement_type: 'ADJUSTMENT_IN',
      source_type: 'MANUAL',
      reason: 'Tồn đầu kỳ theo kế hoạch thực đơn bổ sung',
      request_key: `MENU-EXTENSION-${ingredient.code}-OPENING`,
    });
    expect(movement.value).toBe(BigInt(Math.round(definition[3] * definition[4])));
    expect(
      await db.prisma.unit_of_measure.findUniqueOrThrow({ where: { id: ingredient.base_unit_id } }),
    ).toMatchObject({ code: definition[2] });
  }
  expect(
    await db.prisma.product.findMany({
      where: { id: { in: oldProducts.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldProducts);
  expect(
    await db.prisma.recipe_bom.findMany({
      where: { id: { in: oldRecipes.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldRecipes);
  expect(
    await db.prisma.inventory_balance.findMany({
      where: { id: { in: oldBalances.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldBalances);
  expect(
    await db.prisma.inventory_movement.findMany({
      where: { id: { in: oldMovements.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldMovements);
  expect(await operationalDigest()).toEqual(baseline);
  const combo = await product('COMBO-04');
  await patch(combo, { price: '507000' });
  expect(await addRestaurantMenuExtensions(db, true, true)).toMatchObject({
    products: [],
    ingredients: [],
    combos: [],
  });
  expect((await product('COMBO-04')).base_price).toBe('507000');
  expect(
    await db.prisma.inventory_movement.count({
      where: { ingredient_id: { in: created.map((row) => row.id) } },
    }),
  ).toBe(10);
  await patch(await product('COMBO-04'), { price: '499000' });
});

it('poster bundles have matching prices, fixed contents and summed recipes including both strawberry teas', async () => {
  const weekend = await product('COMBO-04'),
    lunch = await product('COMBO-05');
  expect(weekend).toMatchObject({
    base_price: '499000',
    regular_price: '526000',
    availability_status: 'AVAILABLE',
  });
  expect(lunch).toMatchObject({
    base_price: '69000',
    regular_price: '100000',
    availability_status: 'AVAILABLE',
  });
  expect(
    weekend.components.map((row: { code: string; quantity: number }) => [
      row.code,
      Number(row.quantity),
    ]),
  ).toEqual([
    ['LAU-09', 1],
    ['CHINH-13', 1],
    ['DRINK-09', 2],
  ]);
  expect(
    lunch.components.map((row: { code: string; quantity: number }) => [
      row.code,
      Number(row.quantity),
    ]),
  ).toEqual([
    ['CHINH-14', 1],
    ['NUONG-10', 1],
    ['KHAI-10', 1],
    ['KHAI-09', 1],
    ['LAU-10', 1],
    ['DESSERT-09', 1],
  ]);
  const recipe = await db.pool.query(
    "SELECT g.code,i.quantity::text FROM recipe_bom r JOIN recipe_bom_item i ON i.recipe_bom_id=r.id JOIN ingredient g ON g.id=i.ingredient_id WHERE r.product_id=$1 AND r.status='ACTIVE'",
    [weekend.id],
  );
  const amounts = new Map(recipe.rows.map((row) => [row.code, Number(row.quantity)]));
  expect(amounts.get('STRAWBERRY')).toBe(0.1);
  expect(amounts.get('GARLIC')).toBe(0.015);
  expect(amounts.get('LEMON')).toBe(0.03);
  expect(amounts.get('PORKBELLY')).toBe(0.25);
  expect(amounts.has('WATER')).toBe(false);
  expect(await product('CHINH-11')).toMatchObject({ base_price: '18000' });
  expect(await product('CHINH-12')).toMatchObject({ base_price: '149000' });
  expect(await product('NUONG-09')).toMatchObject({ base_price: '89000' });
});

it('ordering two weekend combos reserves four teas and cancel-before-preparation releases every reservation with a frozen bill line', async () => {
  const combo = await product('COMBO-04'),
    t = await table();
  const { item } = await order(t.session.id, combo.id, 2);
  const ingredient = await db.prisma.ingredient.findFirstOrThrow({ where: { code: 'STRAWBERRY' } });
  const reservation = await db.prisma.inventory_reservation.findFirstOrThrow({
    where: { ingredient_id: ingredient.id, order_item_id: item.id },
  });
  expect(reservation.quantity.toString()).toBe('0.2');
  expect(await db.prisma.order_item.count({ where: { order_batch_id: item.order_batch_id } })).toBe(
    1,
  );
  expect(item.combo_components_snapshot).toHaveLength(3);
  let bill = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(bill.account.charge_total).toBe('998000');
  await ok('/core/items/' + item.id + '/accept', {}, 'bep001');
  await ok('/core/items/' + item.id + '/unavailable', { reasonCode: 'OUT_OF_STOCK' }, 'bep001');
  expect(
    await db.prisma.inventory_reservation.count({
      where: { order_item_id: item.id, status: { in: ['PROVISIONAL', 'COMMITTED'] } },
    }),
  ).toBe(0);
  expect(
    (
      await db.prisma.inventory_balance.findFirstOrThrow({
        where: { ingredient_id: ingredient.id },
      })
    ).on_hand_qty.toString(),
  ).toBe('3');
  bill = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(bill.account.charge_total).toBe('0');
  expect(bill.cancelledItems[0].combo_components_snapshot).toEqual(item.combo_components_snapshot);
  // Restore only the test catalogue state after the kitchen's temporary selling block.
  await patch(await product('COMBO-04'), { availability: 'AVAILABLE' });
});

const imageFixture =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGxkAAAAASUVORK5CYII=';
async function uploadTestImage() {
  return (await ok('/core/menu-images', { data: imageFixture })).imageUrl as string;
}

it('uses the same image store for bootstrap photos and admin uploads and rejects broken product image links', async () => {
  const row = await product('CHINH-01');
  const imageUrl = await uploadTestImage();
  expect(imageUrl).toMatch(/^\/api\/menu-images\/[a-f0-9-]{36}\.png$/);
  const fetched = await request(imageUrl.replace(/^\/api/, ''));
  expect(fetched.statusCode).toBe(200);
  expect(fetched.headers['content-type']).toContain('image/png');
  expect(fetched.rawPayload).toEqual(Buffer.from(imageFixture, 'base64'));
  const changed = await patch(row, { imageUrl });
  expect(changed.image_url).toBe(imageUrl);
  for (const badUrl of [
    '/images/menu/chinh-01.webp',
    'https://example.com/food.webp',
    '/api/menu-images/' + randomUUID() + '.png',
  ]) {
    const result = await request(
      '/core/products/' + changed.id,
      {
        name: changed.name,
        price: String(changed.base_price),
        version: changed.version,
        active: changed.is_active,
        availability: changed.availability_status,
        imageUrl: badUrl,
      },
      undefined,
      'PATCH',
    );
    expect(result.statusCode).toBe(400);
    expect((await product('CHINH-01')).image_url).toBe(imageUrl);
  }
  const cleared = await patch(await product('CHINH-01'), { imageUrl: null });
  expect(cleared.image_url).toBeNull();
  await patch(await product('CHINH-01'), { imageUrl: row.image_url });
});

async function previousSetFixture() {
  const codes = ['CHINH-14', 'KHAI-09', 'LAU-10', 'DESSERT-09'];
  const members = await Promise.all(codes.map(product));
  await patch(await product('COMBO-05'), {
    name: 'Set cơm gà',
    price: '69000',
    description:
      'Cho 1 người: 1 phần cơm gà kho gừng, 1 phần rau cải xào tỏi, 1 chén canh rau củ và 1 phần trái cây.',
    imageUrl: menuPromotionMedia['COMBO-05'],
    active: true,
    availability: 'AVAILABLE',
    components: members.map((row) => ({ productId: row.id, quantity: 1 })),
  });
  return product('COMBO-05');
}

it('upgrades only the exact earlier set template, preserves already ordered four-part snapshots and money, and reruns without changes', async () => {
  expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
    status: 'ALREADY_ALIGNED',
    applied: false,
  });
  const previous = await previousSetFixture(),
    t = await table();
  const { item } = await order(t.session.id, previous.id);
  expect(item.combo_components_snapshot).toHaveLength(4);
  const snapshots = await db.prisma.order_item_ingredient_snapshot.findMany({
    where: { order_item_id: item.id },
    orderBy: { id: 'asc' },
  });
  const reservations = await db.prisma.inventory_reservation.findMany({
    where: { order_item_id: item.id },
    orderBy: { id: 'asc' },
  });
  const billBefore = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  const accountBefore = await db.prisma.session_financial_account.findUniqueOrThrow({
    where: { session_id: t.session.id },
  });
  const auditCount = await db.prisma.business_audit_event.count({
    where: { action: 'REFRESH_RESTAURANT_SET_MENU' },
  });
  expect(await refreshRestaurantSetMenu(db)).toMatchObject({
    status: 'MATCHED_OLD_TEMPLATE',
    applied: false,
  });
  expect((await product('COMBO-05')).version).toBe(previous.version);
  expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
    status: 'UPDATED',
    applied: true,
    version: previous.version + 1,
  });
  const updated = await product('COMBO-05');
  expect(updated).toMatchObject({
    name: 'Set cơm 69k',
    base_price: '69000',
    regular_price: '100000',
  });
  expect(updated.components).toHaveLength(6);
  expect(await db.prisma.order_item.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
  expect(
    await db.prisma.order_item_ingredient_snapshot.findMany({
      where: { order_item_id: item.id },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(snapshots);
  expect(
    await db.prisma.inventory_reservation.findMany({
      where: { order_item_id: item.id },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(reservations);
  expect(
    await db.prisma.session_financial_account.findUniqueOrThrow({
      where: { session_id: t.session.id },
    }),
  ).toEqual(accountBefore);
  const billAfter = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(billAfter.account.charge_total).toBe(billBefore.account.charge_total);
  expect(billAfter.account.paid_total).toBe(billBefore.account.paid_total);
  expect(billAfter.account.refunded_total).toBe(billBefore.account.refunded_total);
  expect(billAfter.charges).toEqual(billBefore.charges);
  const recipe = await db.pool.query(
    "SELECT g.code,i.quantity::text FROM recipe_bom r JOIN recipe_bom_item i ON i.recipe_bom_id=r.id JOIN ingredient g ON g.id=i.ingredient_id WHERE r.product_id=$1 AND r.status='ACTIVE'",
    [updated.id],
  );
  const quantities = new Map(recipe.rows.map((row) => [row.code, Number(row.quantity)]));
  expect(quantities.get('EGG')).toBe(1);
  expect(quantities.get('PORKBELLY')).toBe(0.06);
  const versions = await db.prisma.recipe_bom.count({ where: { product_id: updated.id } });
  expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
    status: 'ALREADY_ALIGNED',
    applied: false,
  });
  expect(await db.prisma.recipe_bom.count({ where: { product_id: updated.id } })).toBe(versions);
  expect(
    await db.prisma.business_audit_event.count({
      where: { action: 'REFRESH_RESTAURANT_SET_MENU' },
    }),
  ).toBe(auditCount + 1);
});

it('skips a customized earlier set when its name, description, price, photo, selling state or component portions differ', async () => {
  for (const fields of [
    { name: 'Set cơm nhà hàng' },
    { description: 'Phần cơm riêng đã điều chỉnh' },
    { price: '75000' },
    { imageUrl: await uploadTestImage() },
    { active: false },
    { availability: 'UNAVAILABLE' },
  ]) {
    const previous = await previousSetFixture();
    await patch(previous, fields);
    const before = await db.prisma.product.findUniqueOrThrow({ where: { id: previous.id } });
    const recipeCount = await db.prisma.recipe_bom.count({ where: { product_id: previous.id } });
    expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
      status: 'CUSTOMIZED',
      applied: false,
    });
    expect(await db.prisma.product.findUniqueOrThrow({ where: { id: previous.id } })).toEqual(
      before,
    );
    expect(await db.prisma.recipe_bom.count({ where: { product_id: previous.id } })).toBe(
      recipeCount,
    );
  }
  const previous = await previousSetFixture();
  await patch(previous, {
    components: previous.components.map((row: { product_id: string }, index: number) => ({
      productId: row.product_id,
      quantity: index === 0 ? 2 : 1,
    })),
  });
  expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
    status: 'CUSTOMIZED',
    applied: false,
  });
  await previousSetFixture();
  expect(await refreshRestaurantSetMenu(db, true)).toMatchObject({
    status: 'UPDATED',
    applied: true,
  });
});

it('seeds real fixed contents, lower bundle prices and aggregated recipes; reruns preserve custom prices and stock', async () => {
  const catalog = await ok('/core/catalog');
  const combos = catalog.products.filter(
    (row: { product_kind: string }) => row.product_kind === 'COMBO',
  );
  expect(combos).toHaveLength(restaurantCombos.length);
  expect(combos.map((row: { code: string }) => row.code).sort()).toEqual(
    restaurantCombos.map((combo) => combo.code).sort(),
  );
  for (const combo of combos) {
    expect(combo.components.length).toBeGreaterThanOrEqual(2);
    expect(BigInt(combo.base_price)).toBeLessThan(BigInt(combo.regular_price));
    expect(combo.availability_status).toBe('AVAILABLE');
    const duplicate = await db.pool.query(
      "SELECT ingredient_id FROM recipe_bom_item WHERE recipe_bom_id=(SELECT id FROM recipe_bom WHERE product_id=$1 AND status='ACTIVE') GROUP BY ingredient_id HAVING count(*)>1",
      [combo.id],
    );
    expect(duplicate.rows).toEqual([]);
  }
  const before = await db.pool.query(
    'SELECT id,on_hand_qty,reserved_qty,available_qty FROM inventory_balance ORDER BY id',
  );
  await patch(combos[0], { price: '123000' });
  await seed(db, password);
  expect((await product(combos[0].code)).base_price).toBe('123000');
  expect(
    (
      await db.pool.query(
        'SELECT id,on_hand_qty,reserved_qty,available_qty FROM inventory_balance ORDER BY id',
      )
    ).rows,
  ).toEqual(before.rows);
  expect(await addRestaurantMenuExtensions(db, false, true)).toMatchObject({
    applied: false,
    products: [],
    ingredients: [],
    combos: [],
  });
  await addRestaurantMenuExtensions(db, true, true);
  expect((await product(combos[0].code)).base_price).toBe('123000');
  expect(
    (
      await db.pool.query(
        'SELECT id,on_hand_qty,reserved_qty,available_qty FROM inventory_balance ORDER BY id',
      )
    ).rows,
  ).toEqual(before.rows);
});

it('adds only missing dishes and combos while preserving current users, prices, recipes, stock and movements', async () => {
  const missingCodes = ['CHINH-09', 'CHINH-10', 'COMBO-03'];
  await db.prisma.$transaction(async (tx) => {
    const rows = await tx.product.findMany({ where: { code: { in: missingCodes } } });
    const ids = rows.map((row) => row.id);
    const recipes = await tx.recipe_bom.findMany({ where: { product_id: { in: ids } } });
    await tx.recipe_bom_item.deleteMany({
      where: { recipe_bom_id: { in: recipes.map((row) => row.id) } },
    });
    await tx.recipe_bom.deleteMany({ where: { product_id: { in: ids } } });
    await tx.product_combo_item.deleteMany({ where: { combo_product_id: { in: ids } } });
    await tx.product.deleteMany({ where: { id: { in: ids } } });
  });
  async function digest(tableName: string) {
    return (
      await db.pool.query(
        `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS digest FROM ${tableName} t`,
      )
    ).rows[0].digest;
  }
  const tables = [
    'app_user',
    'employee_pay_rate',
    'shift_assignment',
    'attendance_record',
    'inventory_balance',
    'inventory_movement',
  ];
  const before = await Promise.all(tables.map(digest));
  const oldProducts = await db.prisma.product.findMany({ orderBy: { id: 'asc' } });
  const oldRecipes = await db.prisma.recipe_bom.findMany({ orderBy: { id: 'asc' } });
  expect(await addRestaurantMenuExtensions(db, false, true)).toMatchObject({
    applied: false,
    products: ['CHINH-09', 'CHINH-10'],
    combos: ['COMBO-03'],
    ingredients: [],
  });
  expect(await db.prisma.product.findMany({ orderBy: { id: 'asc' } })).toEqual(oldProducts);
  await addRestaurantMenuExtensions(db, true, true);
  expect(await Promise.all(tables.map(digest))).toEqual(before);
  expect(
    await db.prisma.product.findMany({
      where: { id: { in: oldProducts.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldProducts);
  expect(
    await db.prisma.recipe_bom.findMany({
      where: { id: { in: oldRecipes.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    }),
  ).toEqual(oldRecipes);
  for (const code of missingCodes)
    expect((await product(code)).availability_status).toBe('AVAILABLE');
  expect((await product('CHINH-09')).image_url).toBe(menuMedia['CHINH-09']);
  expect((await product('CHINH-10')).image_url).toBe(menuMedia['CHINH-10']);
  expect((await addRestaurantMenuExtensions(db, true, true)).products).toEqual([]);
  expect(await Promise.all(tables.map(digest))).toEqual(before);
});

it('rejects empty, duplicate, nested, disabled and cross-restaurant members and restricts configuration to admin', async () => {
  const a = await product('KHAI-01'),
    b = await product('KHAI-02'),
    combo = await product('COMBO-02');
  const base = {
    code: randomUUID(),
    name: 'Combo kiểm tra',
    price: '79000',
    categoryId: a.category_id,
    productKind: 'COMBO',
  };
  for (const components of [
    [],
    [{ productId: a.id, quantity: 1 }],
    [
      { productId: a.id, quantity: 1 },
      { productId: a.id, quantity: 2 },
    ],
    [
      { productId: a.id, quantity: 1 },
      { productId: combo.id, quantity: 1 },
    ],
    [
      { productId: a.id, quantity: 0 },
      { productId: b.id, quantity: 1 },
    ],
  ])
    expect((await request('/core/products', { ...base, components })).statusCode).toBe(400);
  expect(
    (
      await request(
        '/core/products',
        {
          ...base,
          components: [
            { productId: a.id, quantity: 1 },
            { productId: b.id, quantity: 1 },
          ],
        },
        'pv001',
      )
    ).statusCode,
  ).toBe(403);
  await patch(b, { active: false });
  expect(
    (
      await request('/core/products', {
        ...base,
        components: [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ],
      })
    ).statusCode,
  ).toBe(400);
  await patch(await product('KHAI-02'), { active: true, availability: 'AVAILABLE' });
  const otherRestaurant = await db.prisma.restaurant.create({ data: { name: 'Nhà hàng khác' } });
  const category = await db.prisma.menu_category.create({
    data: { restaurant_id: otherRestaurant.id, code: 'KHAI', name: 'Khai vị' },
  });
  const foreign = await db.prisma.product.create({
    data: {
      restaurant_id: otherRestaurant.id,
      category_id: category.id,
      code: 'FOREIGN',
      name: 'Món khác',
      base_price: 45000n,
    },
  });
  expect(
    (
      await request('/core/products', {
        ...base,
        components: [
          { productId: a.id, quantity: 1 },
          { productId: foreign.id, quantity: 1 },
        ],
      })
    ).statusCode,
  ).toBe(400);
  expect(await db.prisma.product.count({ where: { code: base.code } })).toBe(0);
});

it('prevents kind conversion, self-inclusion and manual editing of a derived combo recipe', async () => {
  const combo = await product('COMBO-02'),
    a = await product('KHAI-01');
  const body = {
    name: combo.name,
    price: combo.base_price,
    active: true,
    availability: 'AVAILABLE',
    version: combo.version,
  };
  expect(
    (
      await request(
        '/core/products/' + combo.id,
        { ...body, productKind: 'DISH' },
        undefined,
        'PATCH',
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        '/core/products/' + combo.id,
        {
          ...body,
          components: [
            { productId: combo.id, quantity: 1 },
            { productId: a.id, quantity: 1 },
          ],
        },
        undefined,
        'PATCH',
      )
    ).statusCode,
  ).toBe(400);
  const ingredient = await db.prisma.ingredient.findFirstOrThrow();
  expect(
    (
      await request('/core/products/' + combo.id + '/bom', {
        lines: [{ ingredientId: ingredient.id, quantity: '1' }],
      })
    ).statusCode,
  ).toBe(400);
  await expect(
    db.pool.query("UPDATE product SET product_kind='DISH' WHERE id=$1", [combo.id]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('merges shared ingredients, reserves for every combo and consumes once when the whole bundle starts preparation', async () => {
  const { ingredient, combo } = await trackedDishes(),
    t = await table();
  const { batch, item } = await order(t.session.id, combo.id, 2);
  expect(item.product_kind_snapshot).toBe('COMBO');
  expect(item.combo_components_snapshot).toHaveLength(2);
  const reservations = await db.prisma.inventory_reservation.findMany({
    where: { order_item_id: item.id },
  });
  expect(reservations).toHaveLength(1);
  expect(reservations[0]!.quantity.toString()).toBe('0.6');
  const before = await db.prisma.inventory_balance.findFirstOrThrow({
    where: { ingredient_id: ingredient.id },
  });
  expect(before.on_hand_qty.toString()).toBe('10');
  expect(before.reserved_qty.toString()).toBe('0.6');
  expect(
    (await ok('/core/kitchen', undefined, 'bep001')).find(
      (row: { id: string }) => row.id === batch.id,
    ).items[0].combo_components_snapshot,
  ).toEqual(item.combo_components_snapshot);
  await ok('/core/items/' + item.id + '/accept', {}, 'bep001');
  await ok('/core/items/' + item.id + '/prepare', {}, 'bep001');
  const after = await db.prisma.inventory_balance.findFirstOrThrow({
    where: { ingredient_id: ingredient.id },
  });
  expect(after.on_hand_qty.toString()).toBe('9.4');
  expect(after.reserved_qty.toString()).toBe('0');
  const snapshot = await db.prisma.order_item_ingredient_snapshot.findFirstOrThrow({
    where: { order_item_id: item.id },
  });
  expect(snapshot.consumed_qty.toString()).toBe('0.6');
  expect(snapshot.cogs_value).toBe(30000n);
  await ok('/core/items/' + item.id + '/ready', {}, 'bep001');
  await ok('/core/items/' + item.id + '/serve', {}, 'pv001');
  const bill = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(bill.account.charge_total).toBe('158000');
  expect(bill.charges[0].combo_components_snapshot).toEqual(item.combo_components_snapshot);
});

it('blocks a combo when separate portions fit the stock but the shared aggregate does not, rolling back every reservation', async () => {
  const { ingredient, dishes, combo } = await trackedDishes('0.1', '0.1', '0.15'),
    t = await table();
  expect((await product(dishes[0].code)).availability_status).toBe('AVAILABLE');
  expect((await product(dishes[1].code)).availability_status).toBe('AVAILABLE');
  expect((await product(combo.code)).availability_status).toBe('UNAVAILABLE');
  const response = await request(
    '/core/sessions/' + t.session.id + '/orders',
    { requestId: randomUUID(), lines: [{ productId: combo.id, quantity: 1 }] },
    'pv001',
  );
  expect(response.statusCode).toBe(409);
  expect(await db.prisma.order_batch.count({ where: { session_id: t.session.id } })).toBe(0);
  const balance = await db.prisma.inventory_balance.findFirstOrThrow({
    where: { ingredient_id: ingredient.id },
  });
  expect(balance.reserved_qty.toString()).toBe('0');
  expect(balance.available_qty.toString()).toBe('0.15');
});

it('stops catalogue and new orders when a component is unavailable or its category is disabled', async () => {
  const a = await product('DRINK-01'),
    combo = await product('COMBO-02'),
    t = await table();
  await patch(a, { availability: 'UNAVAILABLE' });
  expect((await product(combo.code)).availability_status).toBe('UNAVAILABLE');
  expect(
    (
      await request(
        '/core/sessions/' + t.session.id + '/orders',
        { requestId: randomUUID(), lines: [{ productId: combo.id, quantity: 1 }] },
        'pv001',
      )
    ).statusCode,
  ).toBe(409);
  await patch(await product('DRINK-01'), { availability: 'AVAILABLE' });
  await db.prisma.menu_category.update({
    where: { id: a.category_id },
    data: { is_active: false },
  });
  try {
    expect((await product(combo.code)).availability_status).toBe('UNAVAILABLE');
    expect(
      (
        await request(
          '/core/sessions/' + t.session.id + '/orders',
          { requestId: randomUUID(), lines: [{ productId: combo.id, quantity: 1 }] },
          'pv001',
        )
      ).statusCode,
    ).toBe(409);
  } finally {
    await db.prisma.menu_category.update({
      where: { id: a.category_id },
      data: { is_active: true },
    });
  }
});

it('keeps the configured selling state separate from stock availability when admin changes images', async () => {
  const { ingredient, dishes, combo } = await trackedDishes('0.2', '0.2', '0.15');
  for (const row of [...dishes, combo]) {
    const unavailable = await product(row.code);
    expect(unavailable.availability_status).toBe('UNAVAILABLE');
    expect(unavailable.configured_availability_status).toBe('AVAILABLE');
    await patch(unavailable, { imageUrl: menuMedia['CHINH-01'] });
    expect(
      (await db.prisma.product.findUniqueOrThrow({ where: { id: row.id } })).availability_status,
    ).toBe('AVAILABLE');
    expect((await product(row.code)).availability_status).toBe('UNAVAILABLE');
  }
  const inv = await ok('/core/inventory');
  const receipt = await ok('/core/receipts', {
    locationId: inv.locations[0].id,
    supplier: 'Bổ sung nguyên liệu sau kiểm tra',
    lines: [{ ingredientId: ingredient.id, quantity: '1', unitCost: '50000' }],
  });
  await ok('/core/receipts/' + receipt.id + '/approve', { expectedVersion: receipt.version });
  for (const row of [...dishes, combo])
    expect(await product(row.code)).toMatchObject({
      availability_status: 'AVAILABLE',
      configured_availability_status: 'AVAILABLE',
    });
});

it('rejects an order during a concurrent component disable without creating charges or reservations', async () => {
  const { ingredient, dishes, combo } = await trackedDishes(),
    t = await table();
  const writer = await db.pool.connect();
  try {
    await writer.query('BEGIN');
    await writer.query("UPDATE product SET availability_status='UNAVAILABLE' WHERE id=$1", [
      dishes[0].id,
    ]);
    const response = await request(
      '/core/sessions/' + t.session.id + '/orders',
      {
        requestId: randomUUID(),
        lines: [{ productId: combo.id, quantity: 1 }],
      },
      'pv001',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().userMessage).toContain('tải lại');
    await writer.query('COMMIT');
    expect(
      (
        await request(
          '/core/sessions/' + t.session.id + '/orders',
          {
            requestId: randomUUID(),
            lines: [{ productId: combo.id, quantity: 1 }],
          },
          'pv001',
        )
      ).statusCode,
    ).toBe(409);
    expect(await db.prisma.order_batch.count({ where: { session_id: t.session.id } })).toBe(0);
    expect(await db.prisma.financial_charge.count({ where: { session_id: t.session.id } })).toBe(0);
    expect(
      (
        await db.prisma.inventory_balance.findFirstOrThrow({
          where: { ingredient_id: ingredient.id },
        })
      ).reserved_qty.toString(),
    ).toBe('0');
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
  }
});

it('avoids the parent-child lock cycle during concurrent recipe refresh and retries with consistent snapshots', async () => {
  const { dishes, combo } = await trackedDishes();
  const reader = await db.pool.connect(),
    writer = await db.pool.connect();
  let refresh: Promise<unknown> | undefined;
  try {
    await reader.query('BEGIN');
    await reader.query('SELECT id FROM product WHERE id=$1 FOR SHARE', [combo.id]);
    await writer.query('BEGIN');
    await writer.query('SELECT id FROM product WHERE id=$1 FOR UPDATE', [dishes[0].id]);
    // This writer now needs the parent while the order reader holds it.
    refresh = writer.query('SELECT refresh_product_combo_recipe($1)', [combo.id]);
    await expect(orderedComboContents(reader, combo)).rejects.toMatchObject({ code: '55P03' });
    await reader.query('ROLLBACK');
    await refresh;
    await writer.query('COMMIT');
    await reader.query('BEGIN');
    await reader.query('SELECT id FROM product WHERE id=$1 FOR SHARE', [combo.id]);
    expect(await orderedComboContents(reader, combo)).toHaveLength(2);
    await reader.query('COMMIT');
  } finally {
    await reader.query('ROLLBACK');
    if (refresh) await refresh.catch(() => undefined);
    await writer.query('ROLLBACK');
    reader.release();
    writer.release();
  }
});

it('publishes a new aggregated recipe after a component change while ordered contents and ingredient snapshots stay unchanged', async () => {
  const { ingredient, dishes, combo } = await trackedDishes(),
    t = await table();
  const first = await order(t.session.id, combo.id);
  const old = await db.prisma.order_item_ingredient_snapshot.findFirstOrThrow({
    where: { order_item_id: first.item.id },
  });
  await ok('/core/products/' + dishes[0].id + '/bom', {
    yield: '1',
    lines: [{ ingredientId: ingredient.id, quantity: '0.4', waste: '0' }],
  });
  expect(
    (
      await db.prisma.order_item_ingredient_snapshot.findUniqueOrThrow({ where: { id: old.id } })
    ).planned_qty.toString(),
  ).toBe('0.3');
  const second = await order(t.session.id, combo.id);
  const changed = await db.prisma.order_item_ingredient_snapshot.findFirstOrThrow({
    where: { order_item_id: second.item.id },
  });
  expect(changed.planned_qty.toString()).toBe('0.6');
  expect(changed.recipe_bom_id).not.toBe(old.recipe_bom_id);
  await patch(await product(combo.code), {
    name: 'Tên combo mới',
    components: [
      { productId: dishes[0].id, quantity: 2 },
      { productId: dishes[1].id, quantity: 1 },
    ],
  });
  const stale = await request(
    '/core/sessions/' + t.session.id + '/orders',
    {
      requestId: randomUUID(),
      lines: [{ productId: combo.id, quantity: 1, productVersion: combo.version }],
    },
    'pv001',
  );
  expect(stale.statusCode).toBe(409);
  expect(stale.json().userMessage).toContain('Combo đã thay đổi');
  expect(
    await db.prisma.order_item.count({ where: { order_batch: { session_id: t.session.id } } }),
  ).toBe(2);
  const saved = await db.prisma.order_item.findUniqueOrThrow({ where: { id: first.item.id } });
  expect(saved.product_name_snapshot).toBe('Combo hai món');
  expect(saved.combo_components_snapshot).toEqual(first.item.combo_components_snapshot);
  await expect(
    db.pool.query("UPDATE order_item SET combo_components_snapshot='[]'::jsonb WHERE id=$1", [
      saved.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await ok('/core/items/' + first.item.id + '/accept', {}, 'bep001');
  await ok('/core/items/' + first.item.id + '/prepare', {}, 'bep001');
  expect(
    (
      await db.prisma.inventory_balance.findFirstOrThrow({
        where: { ingredient_id: ingredient.id },
      })
    ).on_hand_qty.toString(),
  ).toBe('9.7');
});

it('shows fixed contents in a guest cart and rejects sending a silently changed combo at the same price', async () => {
  const { combo, dishes } = await trackedDishes(),
    t = await table();
  const qr = await ok('/core/tables/' + t.row.id + '/qr', {});
  const joined = await request(
    '/guest/join',
    {
      token: qr.joinPath.split('#')[1],
      name: 'Khách combo',
      acceptedPolicyVersion: restaurantPolicy.version,
    },
    '',
  );
  expect(joined.statusCode).toBe(200);
  const cookie = joined.cookies.map((row) => row.name + '=' + row.value).join('; ');
  const state = await ok('/guest/state', undefined, cookie);
  const cart = await ok(
    '/guest/cart',
    { productId: combo.id, quantity: 1, cartVersion: state.cart.cart_version },
    cookie,
  );
  let next = await ok('/guest/state', undefined, cookie);
  expect(next.items.find((row: { id: string }) => row.id === cart.id)).toMatchObject({
    product_kind: 'COMBO',
    available: true,
    components: [
      { name: dishes[0].name, quantity: 1 },
      { name: dishes[1].name, quantity: 1 },
    ],
  });
  await patch(await product(combo.code), {
    components: [
      { productId: dishes[0].id, quantity: 2 },
      { productId: dishes[1].id, quantity: 1 },
    ],
  });
  const response = await request(
    '/guest/orders',
    { requestId: randomUUID(), cartVersion: next.cart.cart_version, itemIds: [cart.id] },
    cookie,
  );
  expect(response.statusCode).toBe(409);
  expect(response.json().userMessage).toContain('Combo đã thay đổi');
  next = await ok('/guest/state', undefined, cookie);
  await ok(
    '/guest/cart/' + cart.id,
    { quantity: 1, cartVersion: next.cart.cart_version },
    cookie,
    'PATCH',
  );
  next = await ok('/guest/state', undefined, cookie);
  const batch = await ok(
    '/guest/orders',
    { requestId: randomUUID(), cartVersion: next.cart.cart_version, itemIds: [cart.id] },
    cookie,
  );
  expect(
    (await db.prisma.order_item.findFirstOrThrow({ where: { order_batch_id: batch.id } }))
      .combo_components_snapshot,
  ).toMatchObject([{ quantity: 2 }, { quantity: 1 }]);
});

it('refunds the whole prepaid combo only after admin approval and lets staff complete the approved payment', async () => {
  const { ingredient, combo } = await trackedDishes(),
    t = await table();
  const { item } = await order(t.session.id, combo.id);
  const intent = await ok(
    '/core/sessions/' + t.session.id + '/payments',
    { requestId: randomUUID(), method: 'CASH', amount: '79000' },
    'pv001',
  );
  const payment = await ok(
    '/core/payments/' + intent.id + '/confirm',
    { amount: '79000', receivedAmount: '100000' },
    'pv001',
  );
  await ok('/core/items/' + item.id + '/accept', {}, 'bep001');
  await ok('/core/items/' + item.id + '/unavailable', { reasonCode: 'OUT_OF_STOCK' }, 'bep001');
  const balance = await db.prisma.inventory_balance.findFirstOrThrow({
    where: { ingredient_id: ingredient.id },
  });
  expect(balance.on_hand_qty.toString()).toBe('10');
  expect(balance.reserved_qty.toString()).toBe('0');
  let bill = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(bill.account.refund_due_amount).toBe('79000');
  expect(bill.refunds).toEqual([]);
  expect(bill.cancelledItems[0].combo_components_snapshot).toEqual(item.combo_components_snapshot);
  expect(
    (
      await request(
        '/core/sessions/' + t.session.id + '/refunds',
        {
          paymentId: payment.id,
          amount: '79000',
          reason: 'Hoàn tiền combo do hết nguyên liệu',
          requestId: randomUUID(),
        },
        'pv001',
      )
    ).statusCode,
  ).toBe(403);
  const notice = (
    await db.pool.query(
      "SELECT details->>'alertId' AS id FROM business_audit_event WHERE resource_id=$1 AND action='KITCHEN_ISSUE_GUEST_NOTICE'",
      [item.id],
    )
  ).rows[0];
  await ok('/core/alerts/' + notice.id + '/guest-notified', {}, 'pv001');
  const refund = await ok('/core/sessions/' + t.session.id + '/refunds', {
    paymentId: payment.id,
    amount: '79000',
    reason: 'Hoàn tiền combo do hết nguyên liệu',
    requestId: randomUUID(),
  });
  expect(refund.approved_at).toBeTruthy();
  expect(
    (
      await request('/core/refunds/' + refund.id + '/complete', {
        requestId: randomUUID(),
        method: 'CASH',
        amount: '79000',
      })
    ).statusCode,
  ).toBe(403);
  await ok(
    '/core/refunds/' + refund.id + '/complete',
    { requestId: randomUUID(), method: 'CASH', amount: '79000' },
    'pv001',
  );
  bill = await ok('/core/sessions/' + t.session.id + '/bill', undefined, 'pv001');
  expect(bill.account.refund_due_amount).toBe('0');
  expect(bill.account.refunded_total).toBe('79000');
  expect(bill.payments[0].amount).toBe('79000');
  expect(bill.payments[0].change_amount).toBe('21000');
});
