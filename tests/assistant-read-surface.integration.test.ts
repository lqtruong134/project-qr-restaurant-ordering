import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import type {
  AssistantMenuProduct,
  AssistantToolName,
  AssistantToolResult,
} from '../packages/contracts/src/menu-assistant.js';
import {
  readAssistantIdentity,
  readOnlyAssistantTransaction,
} from '../apps/api/src/modules/assistant/assistant-context.js';
import { createAssistantReadTools } from '../apps/api/src/modules/assistant/assistant-tools.js';

type RequestContext = Parameters<typeof createAssistantReadTools>[1];

const databaseName = 'thesis_assistant_read_' + randomBytes(6).toString('hex');
const tenant = randomUUID(),
  otherTenant = randomUUID();
const credential = randomBytes(32).toString('hex');
const request = { cookies: { guest: credential } } as unknown as RequestContext;
let host: Database, db: Database;
let session: string, participant: string, category: string, hiddenCategory: string;
let dish: string, drink: string, combo: string, otherDish: string;
let ingredient: string, balance: string;
function runtime(options: Partial<Parameters<typeof createAssistantReadTools>[3]> = {}) {
  return createAssistantReadTools(db, request, tenant, {
    signal: new AbortController().signal,
    timeoutMs: 5000,
    ...options,
  });
}
function productResult(result: AssistantToolResult): AssistantMenuProduct[] {
  if (!('products' in result)) throw new Error('Expected product result');
  return result.products;
}
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
  await db.prisma.restaurant.create({ data: { id: tenant, name: 'Read surface fixture' } });
  await db.prisma.restaurant.create({ data: { id: otherTenant, name: 'Other tenant fixture' } });
  const area = await db.prisma.dining_area.create({
    data: { restaurant_id: tenant, code: 'A', name: 'A' },
  });
  const table = await db.prisma.dining_table.create({
    data: {
      restaurant_id: tenant,
      area_id: area.id,
      code: 'T',
      name: 'Private table',
      capacity: 4,
    },
  });
  session = (await db.prisma.table_session.create({ data: { table_id: table.id } })).id;
  participant = (
    await db.prisma.session_participant.create({
      data: {
        session_id: session,
        guest_id: randomUUID(),
        credential_hash: createHash('sha256').update(credential).digest('hex'),
        display_name: 'Private customer name',
        last_seen_at: new Date('2026-01-01T00:00:00Z'),
      },
    })
  ).id;
  category = (
    await db.prisma.menu_category.create({
      data: { restaurant_id: tenant, code: 'MON-CHINH', name: 'Món chính' },
    })
  ).id;
  hiddenCategory = (
    await db.prisma.menu_category.create({
      data: { restaurant_id: tenant, code: 'HIDDEN', name: 'Not published', is_active: false },
    })
  ).id;
  const otherCategory = await db.prisma.menu_category.create({
    data: { restaurant_id: otherTenant, code: 'OTHER', name: 'Other tenant category' },
  });
  otherDish = (
    await db.prisma.product.create({
      data: {
        restaurant_id: otherTenant,
        category_id: otherCategory.id,
        code: 'OTHER',
        name: 'Other tenant confidential dish',
        base_price: 1n,
        stock_managed: false,
      },
    })
  ).id;
  const unit = await db.prisma.unit_of_measure.create({
    data: { code: 'KG', name: 'Kilogram', dimension: 'MASS', decimal_scale: 6 },
  });
  ingredient = (
    await db.prisma.ingredient.create({
      data: {
        restaurant_id: tenant,
        code: 'CHICKEN',
        name: 'Thịt gà',
        base_unit_id: unit.id,
        min_stock: '5',
      },
    })
  ).id;
  const location = await db.prisma.stock_location.create({
    data: { restaurant_id: tenant, code: 'K', name: 'Private stock location' },
  });
  balance = (
    await db.prisma.inventory_balance.create({
      data: {
        location_id: location.id,
        ingredient_id: ingredient,
        on_hand_qty: '10',
        available_qty: '10',
        avg_cost: '80000',
      },
    })
  ).id;
  dish = (
    await db.prisma.product.create({
      data: {
        restaurant_id: tenant,
        category_id: category,
        code: 'CHICKEN',
        name: 'Gà kho gừng',
        description: 'Món ăn dùng với cơm',
        base_price: 65000n,
      },
    })
  ).id;
  const recipe = await db.prisma.recipe_bom.create({
    data: { product_id: dish, version_no: 1, yield_quantity: '1', status: 'ACTIVE' },
  });
  await db.prisma.recipe_bom_item.create({
    data: { recipe_bom_id: recipe.id, ingredient_id: ingredient, quantity: '0.2' },
  });
  drink = (
    await db.prisma.product.create({
      data: {
        restaurant_id: tenant,
        category_id: category,
        code: 'TEA',
        name: 'Trà đá',
        base_price: 5000n,
        stock_managed: false,
      },
    })
  ).id;
  // Combo completeness is deferred; construct the published bundle in a single fixture transaction.
  const connection = await db.pool.connect();
  try {
    await connection.query('BEGIN');
    combo = (
      await connection.query(
        `INSERT INTO product(restaurant_id,category_id,code,name,base_price,stock_managed,product_kind)
        VALUES($1,$2,'COMBO','Combo gà và trà',69000,false,'COMBO') RETURNING id`,
        [tenant, category],
      )
    ).rows[0].id;
    await connection.query(
      `INSERT INTO product_combo_item(combo_product_id,component_product_id,quantity,sort_order)
      VALUES($1,$2,1,0),($1,$3,2,1)`,
      [combo, dish, drink],
    );
    await connection.query('SELECT refresh_product_combo_recipe($1)', [combo]);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
  await db.prisma.product.create({
    data: {
      restaurant_id: tenant,
      category_id: hiddenCategory,
      code: 'HIDDEN',
      name: 'Unpublished dish',
      base_price: 1n,
      stock_managed: false,
    },
  });
  await db.pool.query('CREATE TABLE assistant_write_probe(id integer PRIMARY KEY,value text)');
  await db.pool.query("INSERT INTO assistant_write_probe VALUES(1,'unchanged')");
}, 60000);
beforeEach(async () => {
  await db.pool.query(
    "UPDATE session_participant SET status='ACTIVE',blocked_until=NULL WHERE id=$1",
    [participant],
  );
  await db.pool.query(
    "UPDATE table_session SET session_status='ACTIVE',closed_at=NULL WHERE id=$1",
    [session],
  );
  await db.pool.query(
    "UPDATE product SET is_active=true,availability_status='AVAILABLE',base_price=65000,version=1 WHERE id=$1",
    [dish],
  );
  await db.pool.query('UPDATE menu_category SET is_active=true WHERE id=$1', [category]);
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=10,reserved_qty=0,available_qty=10 WHERE id=$1',
    [balance],
  );
});
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_assistant_read_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);
it('exposes only a frozen predefined tool dispatcher and exact public fields', async () => {
  const scope = runtime();
  expect(Object.keys(scope.tools)).toEqual(['call']);
  expect(Object.isFrozen(scope.tools)).toBe(true);
  for (const property of ['query', 'pool', 'prisma', 'execute', 'transaction', 'connectionString'])
    expect((scope.tools as unknown as Record<string, unknown>)[property]).toBeUndefined();
  const categories = await scope.tools.call('listCategories', {});
  expect(Object.keys(categories).sort()).toEqual(['asOf', 'categories', 'truncated']);
  expect(categories).toMatchObject({ categories: [{ code: 'MON-CHINH', name: 'Món chính' }] });
  const result = await scope.tools.call('getProducts', { productIds: [dish, combo] });
  expect(Object.keys(result).sort()).toEqual(['asOf', 'products', 'truncated']);
  expect(new Date(result.asOf).toISOString()).toBe(result.asOf);
  const products = productResult(result);
  expect(products).toHaveLength(2);
  expect(Object.keys(products[0]!).sort()).toEqual(
    [
      'productId',
      'code',
      'name',
      'description',
      'categoryCode',
      'categoryName',
      'unitPrice',
      'productKind',
      'version',
      'available',
      'ingredients',
      'components',
    ].sort(),
  );
  expect(products.find((product) => product.productId === dish)).toMatchObject({
    unitPrice: '65000',
    ingredients: ['Thịt gà'],
    available: true,
  });
  expect(products.find((product) => product.productId === combo)?.components).toEqual([
    { productId: dish, name: 'Gà kho gừng', quantity: 1 },
    { productId: drink, name: 'Trà đá', quantity: 2 },
  ]);
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    credential,
    participant,
    session,
    'Private customer name',
    'Private stock location',
  ])
    expect(serialized).not.toContain(privateValue);
  for (const privateField of [
    'password_hash',
    'credential_hash',
    'avg_cost',
    'on_hand_qty',
    'reserved_qty',
    'available_qty',
    'min_stock',
    'waste_percent',
    'yield_quantity',
    'restaurant_id',
  ])
    expect(serialized).not.toContain(privateField);
  scope.close();
});
it('keeps categories, products, recipes and combo details within the authenticated tenant', async () => {
  const scope = runtime();
  expect(productResult(await scope.tools.call('getProducts', { productIds: [otherDish] }))).toEqual(
    [],
  );
  const result = await scope.tools.call('searchMenu', {});
  expect(
    productResult(result)
      .map((product) => product.productId)
      .sort(),
  ).toEqual([dish, drink, combo].sort());
  expect(JSON.stringify(result)).not.toContain('Other tenant');
  expect(JSON.stringify(result)).not.toContain('Unpublished');
  const foreign = createAssistantReadTools(db, request, otherTenant, {
    signal: new AbortController().signal,
  });
  await expect(foreign.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_READ_UNAVAILABLE',
  });
  scope.close();
  foreign.close();
});
it('rejects SQL/write capabilities and extra tenant or sensitive query arguments', async () => {
  const scope = runtime();
  for (const name of ['query', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'])
    await expect(scope.tools.call(name as AssistantToolName, {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL',
    });
  for (const args of [
    { sql: 'SELECT password_hash FROM app_user' },
    { restaurantId: otherTenant },
    { fields: ['password_hash'] },
  ])
    await expect(scope.tools.call('searchMenu', args)).rejects.toMatchObject({
      code: 'INVALID_TOOL_ARGUMENTS',
    });
  expect(
    productResult(await scope.tools.call('searchMenu', { query: "'; DROP TABLE product; --" })),
  ).toEqual([]);
  expect((await db.pool.query('SELECT count(*)::int AS count FROM product')).rows[0].count).toBe(5);
  scope.close();
});
it('rechecks guest/session status on every read without updating guest last-seen or business records', async () => {
  const scope = runtime();
  const participantBefore = (
    await db.pool.query('SELECT * FROM session_participant WHERE id=$1', [participant])
  ).rows;
  const inventoryBefore = (
    await db.pool.query('SELECT * FROM inventory_balance WHERE id=$1', [balance])
  ).rows;
  await scope.tools.call('searchMenu', {});
  await scope.tools.call('getProducts', { productIds: [dish] });
  expect(
    (await db.pool.query('SELECT * FROM session_participant WHERE id=$1', [participant])).rows,
  ).toEqual(participantBefore);
  expect(
    (await db.pool.query('SELECT * FROM inventory_balance WHERE id=$1', [balance])).rows,
  ).toEqual(inventoryBefore);
  for (const table of [
    'cart_item',
    'order_item',
    'inventory_reservation',
    'payment_transaction',
    'refund_transaction',
  ])
    expect((await db.pool.query('SELECT count(*)::int AS count FROM ' + table)).rows[0].count).toBe(
      0,
    );
  await db.pool.query("UPDATE session_participant SET status='LEFT' WHERE id=$1", [participant]);
  await expect(scope.tools.call('getProducts', { productIds: [dish] })).rejects.toMatchObject({
    code: 'TOOL_READ_UNAVAILABLE',
  });
  scope.close();
});
it('denies reads from a closed session or missing guest credential', async () => {
  await db.pool.query(
    "UPDATE table_session SET session_status='CLOSED',closed_at=now() WHERE id=$1",
    [session],
  );
  await expect(readAssistantIdentity(db, request, tenant)).rejects.toMatchObject({
    statusCode: 401,
  });
  const scope = runtime();
  await expect(scope.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_READ_UNAVAILABLE',
  });
  const anonymous = createAssistantReadTools(
    db,
    { cookies: {} } as unknown as RequestContext,
    tenant,
    { signal: new AbortController().signal },
  );
  await expect(anonymous.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_READ_UNAVAILABLE',
  });
  scope.close();
  anonymous.close();
});
it('lets the AI actively read changed prices, versions and public availability on subsequent calls', async () => {
  const scope = runtime();
  expect(
    productResult(await scope.tools.call('getProducts', { productIds: [dish] }))[0],
  ).toMatchObject({ unitPrice: '65000', version: 1, available: true });
  await db.pool.query('UPDATE product SET base_price=70000,version=2 WHERE id=$1', [dish]);
  expect(
    productResult(await scope.tools.call('getProducts', { productIds: [dish] }))[0],
  ).toMatchObject({ unitPrice: '70000', version: 2, available: true });
  await db.pool.query('UPDATE inventory_balance SET on_hand_qty=0,available_qty=0 WHERE id=$1', [
    balance,
  ]);
  expect(
    productResult(await scope.tools.call('getProducts', { productIds: [dish, combo] })).every(
      (product) => !product.available,
    ),
  ).toBe(true);
  expect(
    productResult(await scope.tools.call('searchMenu', { availableOnly: true })).map(
      (product) => product.productId,
    ),
  ).toEqual([drink]);
  scope.close();
});
it('bounds filter pages and reports truncation while preserving public query behavior', async () => {
  const scope = runtime();
  const first = await scope.tools.call('searchMenu', { categoryCode: 'MON-CHINH', limit: 1 });
  expect(productResult(first)).toHaveLength(1);
  expect(first.truncated).toBe(true);
  const next = await scope.tools.call('searchMenu', {
    categoryCode: 'MON-CHINH',
    limit: 1,
    offset: 1,
  });
  expect(productResult(next)[0]?.productId).not.toBe(productResult(first)[0]?.productId);
  expect(
    productResult(
      await scope.tools.call('searchMenu', {
        query: 'Gà kho',
        minUnitPrice: '60000',
        maxUnitPrice: '66000',
        productKind: 'DISH',
      }),
    ),
  ).toHaveLength(1);
  for (const args of [
    { limit: 31 },
    { offset: 1001 },
    { productKind: 'SECRET' },
    { minUnitPrice: '1;DROP' },
  ])
    await expect(scope.tools.call('searchMenu', args)).rejects.toMatchObject({
      code: 'INVALID_TOOL_ARGUMENTS',
    });
  await expect(
    scope.tools.call('getProducts', { productIds: Array.from({ length: 21 }, () => randomUUID()) }),
  ).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGUMENTS' });
  scope.close();
});
it('denies every persistent write and DDL verb inside the private read-only transaction helper', async () => {
  const commands = [
    "INSERT INTO assistant_write_probe VALUES(2,'forbidden')",
    "UPDATE assistant_write_probe SET value='forbidden' WHERE id=1",
    'DELETE FROM assistant_write_probe WHERE id=1',
    'CREATE TABLE assistant_forbidden(id integer)',
    'CREATE TEMP TABLE assistant_forbidden_temp(id integer)',
    'ALTER TABLE assistant_write_probe ADD COLUMN forbidden text',
    'DROP TABLE assistant_write_probe',
  ];
  for (const command of commands)
    await expect(
      readOnlyAssistantTransaction(db, (connection) => connection.query(command)),
    ).rejects.toMatchObject({ code: '25006' });
  expect((await db.pool.query('SELECT * FROM assistant_write_probe')).rows).toEqual([
    { id: 1, value: 'unchanged' },
  ]);
  expect(
    (await db.pool.query("SELECT to_regclass('assistant_forbidden') AS object")).rows[0].object,
  ).toBeNull();
  expect(
    await readOnlyAssistantTransaction(
      db,
      async (connection) =>
        (await connection.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
    ),
  ).toBe('on');
});
it('revokes retained tools on close, abort and deadline, including reads already in flight', async () => {
  const scope = runtime();
  const pending = scope.tools.call('listCategories', {});
  scope.close();
  await expect(pending).rejects.toMatchObject({ code: 'TOOLS_CLOSED' });
  await expect(scope.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOLS_CLOSED',
  });
  const controller = new AbortController();
  const aborted = runtime({ signal: controller.signal });
  const pendingAborted = aborted.tools.call('listCategories', {});
  controller.abort();
  await expect(pendingAborted).rejects.toMatchObject({ code: 'TOOLS_CLOSED' });
  const expired = runtime({ timeoutMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await expect(expired.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOLS_CLOSED',
  });
  aborted.close();
  expired.close();
});
it('bounds request call count, simultaneous database reads, and per-result/total bytes', async () => {
  const limited = runtime({ maxCalls: 1 });
  await limited.tools.call('listCategories', {});
  await expect(limited.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_CALL_LIMIT',
  });
  const concurrent = runtime();
  const results = await Promise.allSettled([
    concurrent.tools.call('listCategories', {}),
    concurrent.tools.call('listCategories', {}),
    concurrent.tools.call('listCategories', {}),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'TOOL_CONCURRENCY_LIMIT' },
  });
  const bytes = runtime({ maxResultBytes: 1 });
  await expect(bytes.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_RESULT_LIMIT',
  });
  const measure = runtime();
  const size = Buffer.byteLength(
    JSON.stringify(await measure.tools.call('listCategories', {})),
    'utf8',
  );
  const total = runtime({ maxTotalBytes: size * 2 - 1 });
  await total.tools.call('listCategories', {});
  await expect(total.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_RESULT_LIMIT',
  });
  for (const scope of [limited, concurrent, bytes, measure, total]) scope.close();
});

it('reserves shared pool headroom across separate requests and releases it after close or auth failure', async () => {
  const first = runtime(),
    second = runtime(),
    third = runtime();
  const pendingFirst = first.tools.call('listCategories', {});
  const pendingSecond = second.tools.call('listCategories', {});
  await expect(third.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_READ_BUSY',
  });
  first.close();
  const settled = await Promise.allSettled([pendingFirst, pendingSecond]);
  expect(settled[0]).toMatchObject({ status: 'rejected', reason: { code: 'TOOLS_CLOSED' } });
  expect(settled[1]).toMatchObject({ status: 'fulfilled' });
  await expect(third.tools.call('listCategories', {})).resolves.toHaveProperty('categories');
  const wrongTenant = createAssistantReadTools(db, request, otherTenant, {
    signal: new AbortController().signal,
  });
  await expect(wrongTenant.tools.call('listCategories', {})).rejects.toMatchObject({
    code: 'TOOL_READ_UNAVAILABLE',
  });
  const following = await Promise.allSettled([
    second.tools.call('listCategories', {}),
    third.tools.call('listCategories', {}),
  ]);
  expect(following.every((result) => result.status === 'fulfilled')).toBe(true);
  for (const scope of [first, second, third, wrongTenant]) scope.close();
});

it('copies validated arguments before awaiting database work so caller mutation cannot bypass page limits', async () => {
  const scope = runtime();
  const args = { limit: 1, offset: 0 };
  const pending = scope.tools.call('searchMenu', args);
  args.limit = 1000000;
  args.offset = 1000000;
  const result = await pending;
  expect(productResult(result)).toHaveLength(1);
  expect(result.truncated).toBe(true);
  let reads = 0;
  const changing = Object.defineProperty({}, 'limit', {
    enumerable: true,
    get() {
      return ++reads <= 2 ? 1 : 1000000;
    },
  });
  expect(productResult(await scope.tools.call('searchMenu', changing))).toHaveLength(1);
  expect(reads).toBe(1);
  scope.close();
});
