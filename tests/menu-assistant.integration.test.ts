import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import {
  registerMenuAssistant,
  type AssistantProvider,
  type MenuAssistantOptions,
} from '../apps/api/src/modules/assistant/assistant.routes.js';
import type {
  AssistantDecision,
  AssistantProviderInput,
} from '../packages/contracts/src/menu-assistant.js';

const databaseName = 'thesis_assistant_' + randomBytes(6).toString('hex');
const tenant = randomUUID(),
  otherTenant = randomUUID();
const token = randomBytes(32).toString('hex');
const headers = {
  origin: 'http://localhost:3100',
  'x-csrf-protection': '1',
  cookie: 'guest=' + token,
};
const body = { message: 'Gợi ý vài món trong thực đơn', people: 2, budgetAmount: '100000' };
const config = {
  mode: 'CUSTOM' as const,
  timeoutMs: 1000,
  rateLimit: 60,
  windowMs: 60000,
  maxInFlight: 4,
};
let host: Database,
  db: Database,
  participant: string,
  session: string,
  dish: string,
  second: string;
let ingredient: string, location: string, drink: string;
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function app(options: MenuAssistantOptions = {}, restaurant = tenant) {
  const result = buildApp(db);
  await registerAuth(result, db, {
    secret: 'a'.repeat(96),
    restaurantId: restaurant,
    origins: [headers.origin],
    secure: false,
  });
  registerMenuAssistant(result, db, restaurant, options);
  apps.push(result);
  return result;
}
function decision(
  lines: AssistantDecision['products'] = [
    { productId: dish, quantity: 1, reasonCode: 'BUDGET_FIT' as const },
  ],
): AssistantDecision {
  return { kind: 'RECOMMEND', products: lines, clarificationFields: [] };
}
async function custom(
  suggest: AssistantProvider['suggest'] = async () => decision(),
  options: Partial<typeof config> = {},
) {
  return app({ config: { ...config, ...options }, provider: { suggest } });
}
async function recommend(application: Awaited<ReturnType<typeof buildApp>>, input: unknown = body) {
  return application.inject({
    method: 'POST',
    url: '/guest/menu-assistant/recommendations',
    headers,
    payload: input as Record<string, unknown>,
  });
}
beforeAll(async () => {
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
  await db.prisma.restaurant.create({ data: { id: tenant, name: 'Isolated assistant fixture' } });
  await db.prisma.restaurant.create({ data: { id: otherTenant, name: 'Other isolated tenant' } });
  const area = await db.prisma.dining_area.create({
    data: { restaurant_id: tenant, code: 'A', name: 'A' },
  });
  const table = await db.prisma.dining_table.create({
    data: { restaurant_id: tenant, area_id: area.id, code: 'T', name: 'T', capacity: 4 },
  });
  session = (await db.prisma.table_session.create({ data: { table_id: table.id } })).id;
  participant = (
    await db.prisma.session_participant.create({
      data: {
        session_id: session,
        guest_id: randomUUID(),
        credential_hash: createHash('sha256').update(token).digest('hex'),
        display_name: 'Private guest',
        last_seen_at: new Date('2026-01-01T00:00:00Z'),
      },
    })
  ).id;
  const category = await db.prisma.menu_category.create({
    data: { restaurant_id: tenant, code: 'MON-CHINH', name: 'Món chính' },
  });
  const drinks = await db.prisma.menu_category.create({
    data: { restaurant_id: tenant, code: 'DO-UONG', name: 'Đồ uống' },
  });
  const unit = await db.prisma.unit_of_measure.create({
    data: { code: 'KG', name: 'kg', dimension: 'MASS', decimal_scale: 6 },
  });
  ingredient = (
    await db.prisma.ingredient.create({
      data: { restaurant_id: tenant, code: 'ONLY', name: 'Nguyên liệu thử', base_unit_id: unit.id },
    })
  ).id;
  location = (
    await db.prisma.stock_location.create({ data: { restaurant_id: tenant, code: 'K', name: 'K' } })
  ).id;
  await db.prisma.inventory_balance.create({
    data: {
      location_id: location,
      ingredient_id: ingredient,
      on_hand_qty: '100',
      available_qty: '100',
    },
  });
  for (const [code, price] of [
    ['A', 18000n],
    ['B', 22000n],
  ] as const) {
    const product = await db.prisma.product.create({
      data: {
        restaurant_id: tenant,
        category_id: category.id,
        code,
        name: 'Món thử ' + code,
        description: 'Mô tả từ database',
        base_price: price,
      },
    });
    const bom = await db.prisma.recipe_bom.create({
      data: { product_id: product.id, version_no: 1, yield_quantity: '1', status: 'ACTIVE' },
    });
    await db.prisma.recipe_bom_item.create({
      data: {
        recipe_bom_id: bom.id,
        ingredient_id: ingredient,
        quantity: '0.6',
        waste_percent: '0',
      },
    });
    if (code === 'A') dish = product.id;
    else second = product.id;
  }
  drink = (
    await db.prisma.product.create({
      data: {
        restaurant_id: tenant,
        category_id: drinks.id,
        code: 'D',
        name: 'Nước thử',
        base_price: 5000n,
        stock_managed: false,
      },
    })
  ).id;
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
    "UPDATE product SET is_active=true,availability_status='AVAILABLE',base_price=CASE code WHEN 'A' THEN 18000 WHEN 'B' THEN 22000 ELSE 5000 END WHERE restaurant_id=$1",
    [tenant],
  );
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=100,reserved_qty=0,available_qty=100 WHERE ingredient_id=$1',
    [ingredient],
  );
});
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});
afterAll(async () => {
  if (db) await db.close();
  if (host) {
    expect(databaseName).toMatch(/^thesis_assistant_[a-f0-9]+$/);
    await host.pool.query('DROP DATABASE ' + databaseName + ' WITH (FORCE)');
    await host.close();
  }
}, 60000);
it('keeps OFF optional, authenticated and cheap with no model/provider calls', async () => {
  const provider = vi.fn(async () => decision());
  const application = await app({
    config: { ...config, mode: 'OFF' },
    provider: { suggest: provider },
  });
  expect(
    (await application.inject({ url: '/guest/menu-assistant/capabilities', headers })).json(),
  ).toMatchObject({
    mode: 'OFF',
    enabled: false,
    supportsAllergySafetyConfirmation: false,
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    mode: 'OFF',
    products: [],
  });
  expect(provider).not.toHaveBeenCalled();
  expect((await application.inject('/guest/menu-assistant/capabilities')).statusCode).toBe(401);
});
it('requires CSRF and rejects malformed, extra, oversized or whitespace requests', async () => {
  const application = await custom();
  const csrf = await application.inject({
    method: 'POST',
    url: '/guest/menu-assistant/recommendations',
    headers: { cookie: headers.cookie },
    payload: body,
  });
  expect(csrf.statusCode).toBe(403);
  for (const input of [
    { ...body, people: 0 },
    { ...body, budgetAmount: '1e4' },
    { ...body, price: '1' },
    { ...body, message: '  ' },
    { ...body, message: 'x'.repeat(1001) },
  ])
    expect((await recommend(application, input)).statusCode).toBe(400);
});
it('bypasses the provider for missing details and unreviewed safety/preferences', async () => {
  const suggest = vi.fn(async () => decision()),
    application = await custom(suggest);
  expect((await recommend(application, { message: 'Gợi ý món' })).json()).toMatchObject({
    status: 'CLARIFICATION',
    clarificationFields: ['PEOPLE', 'BUDGET'],
  });
  for (const input of [
    { ...body, preferences: { allergies: ['sữa'] } },
    { ...body, message: 'Tôi dị ứng hải sản' },
    { ...body, preferences: { diet: 'VEGETARIAN' } },
  ])
    expect((await recommend(application, input)).json()).toMatchObject({
      status: 'STAFF_REQUIRED',
      products: [],
    });
  expect(suggest).not.toHaveBeenCalled();
});
it('returns server-generated names, reasons, current prices and no private context', async () => {
  let captured: AssistantProviderInput | undefined;
  const application = await custom(async (input) => {
    captured = input;
    return decision();
  });
  const result = (await recommend(application)).json();
  expect(result).toMatchObject({
    status: 'RECOMMENDATIONS',
    totalAmount: '18000',
    products: [
      { productId: dish, name: 'Món thử A', quantity: 1, unitPrice: '18000', lineTotal: '18000' },
    ],
  });
  expect(result.warnings.join(' ')).toMatch(/dị ứng/);
  expect(JSON.stringify(captured)).not.toMatch(
    /Private guest|credential|sessionId|session_id|unit_cost|available_qty|last_seen|payment/,
  );
  expect(captured!.context.menu.find((p) => p.productId === dish)!.ingredients).toEqual([
    'Nguyên liệu thử',
  ]);
});
it.each([
  ['malformed JSON', () => '{'],
  ['arbitrary prose', () => 'Bạn nên gọi món A'],
  [
    'unknown ID',
    () => decision([{ productId: randomUUID(), quantity: 1, reasonCode: 'BUDGET_FIT' }]),
  ],
  [
    'duplicate case-insensitive ID',
    () => ({
      ...decision(),
      products: [
        { productId: dish, quantity: 1, reasonCode: 'BUDGET_FIT' },
        { productId: dish.toUpperCase(), quantity: 1, reasonCode: 'BUDGET_FIT' },
      ],
    }),
  ],
  [
    'invented price',
    () => ({ ...decision(), products: [{ ...decision().products[0], price: '1' }] }),
  ],
  ['invented message', () => ({ ...decision(), message: 'FREE' })],
  [
    'negative quantity',
    () => decision([{ productId: dish, quantity: -1, reasonCode: 'BUDGET_FIT' }]),
  ],
  [
    'wrong reason',
    () => decision([{ productId: dish, quantity: 1, reasonCode: 'REQUESTED_DRINK' }]),
  ],
  [
    'already-known clarification',
    () => ({ kind: 'CLARIFY', products: [], clarificationFields: ['BUDGET'] }),
  ],
])('fails closed for provider output: %s', async (_name, output) => {
  const application = await custom(async () => output());
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    products: [],
  });
});
it('normalizes uppercase IDs after validating uniqueness', async () => {
  const application = await custom(async () =>
    decision([{ productId: dish.toUpperCase(), quantity: 1, reasonCode: 'BUDGET_FIT' }]),
  );
  expect((await recommend(application)).json()).toMatchObject({
    status: 'RECOMMENDATIONS',
    products: [{ productId: dish }],
  });
});
it('requires a requested category in the final proposal and matches reason codes', async () => {
  const application = await custom();
  expect(
    (await recommend(application, { ...body, preferences: { include: ['DRINK'] } })).json(),
  ).toMatchObject({ status: 'UNAVAILABLE', products: [] });
  const valid = await custom(async () =>
    decision([{ productId: drink, quantity: 1, reasonCode: 'REQUESTED_DRINK' }]),
  );
  expect(
    (await recommend(valid, { ...body, preferences: { include: ['DRINK'] } })).json(),
  ).toMatchObject({ status: 'RECOMMENDATIONS' });
  const wrong = await custom(async () =>
    decision([{ productId: dish, quantity: 1, reasonCode: 'REQUESTED_DRINK' }]),
  );
  expect(
    (await recommend(wrong, { ...body, preferences: { include: ['DRINK'] } })).json(),
  ).toMatchObject({ status: 'UNAVAILABLE' });
});
it('refreshes price after inference and refuses an increased price above budget', async () => {
  const application = await custom(async () => {
    await db.pool.query('UPDATE product SET base_price=110000 WHERE id=$1', [dish]);
    return decision();
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'BUDGET_EXCEEDED',
    products: [],
  });
});
it('uses an updated affordable database price in its cards', async () => {
  const application = await custom(async () => {
    await db.pool.query('UPDATE product SET base_price=19000 WHERE id=$1', [dish]);
    return decision();
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'RECOMMENDATIONS',
    totalAmount: '19000',
    products: [{ unitPrice: '19000' }],
  });
});
it.each(['INACTIVE', 'UNAVAILABLE', 'STOCK'] as const)(
  'rechecks catalog %s after inference',
  async (kind) => {
    const application = await custom(async () => {
      if (kind === 'INACTIVE')
        await db.pool.query('UPDATE product SET is_active=false WHERE id=$1', [dish]);
      if (kind === 'UNAVAILABLE')
        await db.pool.query("UPDATE product SET availability_status='UNAVAILABLE' WHERE id=$1", [
          dish,
        ]);
      if (kind === 'STOCK')
        await db.pool.query(
          'UPDATE inventory_balance SET on_hand_qty=0,available_qty=0 WHERE ingredient_id=$1',
          [ingredient],
        );
      return decision();
    });
    expect((await recommend(application)).json()).toMatchObject({
      status: 'UNAVAILABLE',
      products: [],
    });
  },
);
it('checks requested quantity together and aggregates shared ingredients without reserving', async () => {
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=1,available_qty=1 WHERE ingredient_id=$1',
    [ingredient],
  );
  const quantity = await custom(async () =>
    decision([{ productId: dish, quantity: 2, reasonCode: 'BUDGET_FIT' }]),
  );
  expect((await recommend(quantity)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'STOCK_CHANGED',
  });
  const shared = await custom(async () =>
    decision([
      { productId: dish, quantity: 1, reasonCode: 'BUDGET_FIT' },
      { productId: second, quantity: 1, reasonCode: 'BUDGET_FIT' },
    ]),
  );
  expect((await recommend(shared)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'STOCK_CHANGED',
  });
  expect(
    (
      await db.prisma.inventory_balance.findFirstOrThrow({ where: { ingredient_id: ingredient } })
    ).reserved_qty.toString(),
  ).toBe('0');
});
it.each(['LEFT', 'BLOCKED', 'CLOSED'] as const)(
  'rechecks guest %s after inference',
  async (state) => {
    const application = await custom(async () => {
      if (state === 'CLOSED')
        await db.pool.query(
          "UPDATE table_session SET session_status='CLOSED',closed_at=now() WHERE id=$1",
          [session],
        );
      else
        await db.pool.query('UPDATE session_participant SET status=$2 WHERE id=$1', [
          participant,
          state,
        ]);
      return decision();
    });
    expect((await recommend(application)).statusCode).toBe(state === 'CLOSED' ? 401 : 403);
  },
);
it('rejects cross-tenant credentials and malformed guest cookies before provider', async () => {
  const suggest = vi.fn(async () => decision()),
    application = await app({ config, provider: { suggest } }, otherTenant);
  expect((await recommend(application)).statusCode).toBe(401);
  const correct = await custom(suggest);
  expect(
    (
      await correct.inject({
        method: 'POST',
        url: '/guest/menu-assistant/recommendations',
        headers: { ...headers, cookie: 'guest=' + 'x'.repeat(129) },
        payload: body,
      })
    ).statusCode,
  ).toBe(401);
  expect(suggest).not.toHaveBeenCalled();
});
it('aborts deadlines, hides provider failures and bounds abandoned work', async () => {
  let signal: AbortSignal | undefined;
  const application = await custom(
    async (_input, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
    { timeoutMs: 10, maxInFlight: 1 },
  );
  expect((await recommend(application)).json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect(signal!.aborted).toBe(true);
  expect((await recommend(application)).json()).toMatchObject({ code: 'ASSISTANT_RATE_LIMITED' });
  const failure = await custom(async () => {
    throw Error('PRIVATE_PROVIDER_ERROR');
  });
  const response = await recommend(failure);
  expect(response.json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect(response.body).not.toContain('PRIVATE_PROVIDER_ERROR');
});
it('limits participant/IP requests before loading another provider input', async () => {
  const suggest = vi.fn(async () => decision()),
    application = await custom(suggest, { rateLimit: 1 });
  expect((await recommend(application)).json()).toMatchObject({ status: 'RECOMMENDATIONS' });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'ASSISTANT_RATE_LIMITED',
  });
  expect(suggest).toHaveBeenCalledTimes(1);
});
it('MOCK is explicit and CUSTOM without a provider remains unavailable', async () => {
  const mock = await app({ config: { ...config, mode: 'MOCK' } });
  expect((await recommend(mock)).json()).toMatchObject({ status: 'RECOMMENDATIONS', mode: 'MOCK' });
  const absent = await app({ config });
  expect((await recommend(absent)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'PROVIDER_UNAVAILABLE',
  });
});
it('performs no business writes, including guest last_seen or expired-block updates', async () => {
  await db.pool.query(
    "UPDATE session_participant SET status='BLOCKED',blocked_until=now()-interval '1 minute' WHERE id=$1",
    [participant],
  );
  async function snapshot() {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'session_participant',
      'table_session',
      'cart_item',
      'order_batch',
      'order_item',
      'inventory_balance',
      'inventory_reservation',
      'inventory_movement',
      'financial_charge',
      'payment_transaction',
      'support_request',
      'business_audit_event',
      'outbox_event',
    ])
      rows[table] = (await db.pool.query('SELECT * FROM ' + table + ' ORDER BY id')).rows;
    return JSON.stringify(rows);
  }
  const application = await custom(),
    before = await snapshot();
  expect((await recommend(application)).json()).toMatchObject({ status: 'RECOMMENDATIONS' });
  expect(await snapshot()).toBe(before);
});

it('does not allow an injected provider to mutate trusted request or allowed catalog IDs', async () => {
  const unknown = randomUUID();
  const application = await custom(async (input) => {
    input.request.budgetAmount = '999999999';
    input.context.menu.push({ ...input.context.menu[0]!, productId: unknown });
    return decision([{ productId: dish, quantity: 10, reasonCode: 'BUDGET_FIT' }]);
  });
  expect((await recommend(application, { ...body, budgetAmount: '20000' })).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'BUDGET_EXCEEDED',
  });
});
it('releases the provider admission slot when failed work has settled', async () => {
  // A provider failure followed by a valid call proves errors do not strand settled work.
  let calls = 0;
  const application = await custom(
    async () => {
      if (++calls === 1) throw Error('private failure');
      return decision();
    },
    { maxInFlight: 1 },
  );
  expect((await recommend(application)).json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect((await recommend(application)).json()).toMatchObject({ status: 'RECOMMENDATIONS' });
});

it.each(['Gợi ý món chay cho hai người', 'Tôi dị   ứng tôm', 'Tránh đậu phộng và sữa'])(
  'refers ordinary unreviewed dietary wording without calling a provider: %s',
  async (message) => {
    const suggest = vi.fn(async () => decision());
    const application = await custom(suggest);
    expect((await recommend(application, { ...body, message })).json()).toMatchObject({
      status: 'STAFF_REQUIRED',
      products: [],
    });
    expect(suggest).not.toHaveBeenCalled();
  },
);
it('rejects a provider selection unavailable in its supplied context even when reopened during inference', async () => {
  await db.prisma.product.update({
    where: { id: dish },
    data: { availability_status: 'UNAVAILABLE' },
  });
  const application = await custom(async (input) => {
    expect(input.context.menu.find((p) => p.productId === dish)?.available).toBe(false);
    await db.prisma.product.update({
      where: { id: dish },
      data: { availability_status: 'AVAILABLE' },
    });
    return decision();
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'MENU_CHANGED',
    products: [],
  });
});
