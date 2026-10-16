import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createDatabase, type Database } from '../packages/database/src/index.js';
import { buildApp } from '../apps/api/src/app.js';
import { registerGuest } from '../apps/api/src/modules/sessions/guest.routes.js';
import { registerOrders } from '../apps/api/src/modules/orders/orders.routes.js';
import { registerAuth } from '../apps/api/src/auth.js';
import {
  registerMenuAssistant,
  type AssistantProvider,
  type MenuAssistantOptions,
} from '../apps/api/src/modules/assistant/assistant.routes.js';
import type {
  AssistantDecision,
  AssistantProviderInput,
  AssistantTools,
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
let host: Database, db: Database, participant: string, session: string, dish: string;
let ingredient: string, location: string;
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function app(options: MenuAssistantOptions = {}, restaurant = tenant, core = false) {
  const result = buildApp(db);
  await registerAuth(result, db, {
    secret: 'a'.repeat(96),
    restaurantId: restaurant,
    origins: [headers.origin],
    secure: false,
  });
  registerMenuAssistant(result, db, restaurant, options);
  if (core) {
    registerGuest(result, db, restaurant, false);
    registerOrders(result, db, restaurant);
  }
  apps.push(result);
  return result;
}
function decision(
  lines: AssistantDecision['products'] = [
    {
      productId: dish,
      name: 'AI proposed dish',
      quantity: 1,
      unitPrice: '18000',
      lineTotal: '18000',
      reason: 'AI explanation',
    },
  ],
): AssistantDecision {
  return {
    kind: 'RECOMMEND',
    message: 'AI message',
    products: lines,
    totalAmount: '18000',
    clarificationFields: [],
    warnings: ['AI warning'],
  };
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
  await db.prisma.session_cart.create({ data: { session_id: session } });
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
  }
  await db.prisma.product.create({
    data: {
      restaurant_id: tenant,
      category_id: drinks.id,
      code: 'D',
      name: 'Nước thử',
      base_price: 5000n,
      stock_managed: false,
    },
  });
}, 60000);
beforeEach(async () => {
  await db.pool.query(
    "UPDATE session_participant SET status='ACTIVE',blocked_until=NULL WHERE id=$1",
    [participant],
  );
  await db.pool.query(
    "UPDATE table_session SET session_status='ACTIVE',closed_at=NULL,verification_status='VERIFIED' WHERE id=$1",
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
  const suggest = vi.fn(async () => decision());
  const application = await app({ config: { ...config, mode: 'OFF' }, provider: { suggest } });
  expect(
    (await application.inject({ url: '/guest/menu-assistant/capabilities', headers })).json(),
  ).toMatchObject({
    contractVersion: 2,
    mode: 'OFF',
    enabled: false,
    advisoryOnly: true,
    supportsAllergySafetyConfirmation: false,
    readTools: ['listCategories', 'searchMenu', 'getProducts'],
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    mode: 'OFF',
    decision: null,
  });
  expect(suggest).not.toHaveBeenCalled();
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
    { ...body, history: [{ role: 'system', content: 'untrusted' }] },
  ])
    expect((await recommend(application, input)).statusCode).toBe(400);
});
it('passes natural-language requests, unreviewed preferences and conversation to the provider', async () => {
  const inputs: AssistantProviderInput[] = [];
  const raw: AssistantDecision = {
    kind: 'CLARIFY',
    message: 'AI asks for missing information in its own wording.',
    products: [],
    totalAmount: '0',
    clarificationFields: ['PEOPLE', 'BUDGET'],
    warnings: [],
  };
  const application = await custom(async (input) => {
    inputs.push(input);
    return raw;
  });
  const request = {
    message: 'Ba nguoi, hai tram nghin, khong an cay',
    preferences: { spice: 'NOT_SPICY' },
    history: [
      { role: 'user', content: 'Toi muon an trua' },
      { role: 'assistant', content: 'Ban thich mon gi?' },
    ],
  };
  expect((await recommend(application, request)).json()).toMatchObject({
    status: 'AVAILABLE',
    decision: raw,
  });
  expect(inputs[0]?.request).toEqual(request);
  expect(inputs[0]?.context).toEqual({
    currency: 'VND',
    priceIncludesVat: true,
    pricingBasis: 'MENU_BEFORE_DISCOUNTS',
    semanticMetadata: 'UNREVIEWED',
  });
  expect(inputs[0]?.tools.map((tool) => tool.name)).toEqual([
    'listCategories',
    'searchMenu',
    'getProducts',
  ]);
  expect(JSON.stringify(inputs)).not.toMatch(
    /Private guest|credential|sessionId|session_id|unit_cost|available_qty|last_seen|payment/,
  );
  expect(inputs[0]?.context).not.toHaveProperty('menu');
});
it('lets the provider actively read current menu and return its own explanation unchanged', async () => {
  const raw = decision();
  let retained: AssistantTools | undefined;
  const application = await custom(async (_input, { tools }) => {
    retained = tools;
    expect(Object.keys(tools)).toEqual(['call']);
    const read = await tools.call('getProducts', { productIds: [dish] });
    expect(read).toMatchObject({
      products: [{ productId: dish, unitPrice: '18000', ingredients: ['Nguyên liệu thử'] }],
    });
    return raw;
  });
  const result = (await recommend(application)).json();
  expect(result).toMatchObject({
    contractVersion: 2,
    status: 'AVAILABLE',
    advisoryOnly: true,
    decision: raw,
  });
  expect(result.decision).toEqual(raw);
  await expect(retained!.call('searchMenu', {})).rejects.toMatchObject({ code: 'TOOLS_CLOSED' });
});
it.each([
  ['malformed JSON', () => '{'],
  ['arbitrary prose', () => 'Ban nen goi mon A'],
  ['oversized bytes', () => 'x'.repeat(32769)],
  ['extra executable field', () => ({ ...decision(), sql: 'DELETE FROM product' })],
  [
    'invalid identifier syntax',
    () => ({ ...decision(), products: [{ ...decision().products[0]!, productId: 'not-a-uuid' }] }),
  ],
  [
    'negative quantity',
    () => ({ ...decision(), products: [{ ...decision().products[0]!, quantity: -1 }] }),
  ],
  ['wrong money type', () => ({ ...decision(), totalAmount: 18000 })],
])('handles technically malformed provider output safely: %s', async (_name, output) => {
  const application = await custom(async () => output());
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'INVALID_PROVIDER_OUTPUT',
    decision: null,
  });
});
it('preserves exact Unicode, whitespace, ID case and duplicate model claims', async () => {
  const raw = decision();
  raw.message = '  Gợi ý riêng: bữa trưa 🍲\nKhông chuẩn hóa lời tư vấn.  '.normalize('NFD');
  raw.products[0]!.name = '  Món Việt 🥗  '.normalize('NFD');
  raw.products[0]!.productId = dish.toUpperCase();
  raw.products[0]!.reason = '  Lý do do AI viết.  ';
  raw.products.push({ ...raw.products[0]! });
  const application = await custom(async () => JSON.stringify(raw));
  expect((await recommend(application)).json().decision).toEqual(raw);
});
it('preserves hallucinated identifiers, names, advisory prices, totals and preference mistakes', async () => {
  const raw = decision([
    {
      productId: randomUUID().toUpperCase(),
      name: 'A dish invented by the provider',
      quantity: 20,
      unitPrice: '999999',
      lineTotal: '1',
      reason: 'Wrongly claims to be a requested drink',
    },
    {
      productId: dish,
      name: 'Wrong name for a real dish',
      quantity: 2,
      unitPrice: '1',
      lineTotal: '777',
      reason: 'Provider explanation, not a server template',
    },
  ]);
  raw.totalAmount = '999999999';
  raw.message = 'Raw recommendation remains measurable.';
  const application = await custom(async () => raw);
  const result = (
    await recommend(application, {
      ...body,
      budgetAmount: '100',
      preferences: { include: ['DRINK'] },
    })
  ).json();
  expect(result.status).toBe('AVAILABLE');
  expect(result.decision).toEqual(raw);
});
it('does not rewrite model claims after menu price or availability changes during inference', async () => {
  const raw = decision();
  const application = await custom(async (_input, { tools }) => {
    await tools.call('getProducts', { productIds: [dish] });
    await db.pool.query(
      "UPDATE product SET base_price=19000,availability_status='UNAVAILABLE',is_active=false WHERE id=$1",
      [dish],
    );
    await db.pool.query(
      'UPDATE inventory_balance SET on_hand_qty=0,available_qty=0 WHERE ingredient_id=$1',
      [ingredient],
    );
    return raw;
  });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'AVAILABLE',
    decision: raw,
  });
});
it('preserves an over-stock or over-budget proposal instead of rebuilding it', async () => {
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=1,available_qty=1 WHERE ingredient_id=$1',
    [ingredient],
  );
  const raw = decision([{ ...decision().products[0]!, quantity: 20, lineTotal: '360000' }]);
  const application = await custom(async () => raw);
  expect((await recommend(application, { ...body, budgetAmount: '1000' })).json().decision).toEqual(
    raw,
  );
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
it('aborts deadlines, revokes tools, hides failures and bounds abandoned work', async () => {
  let signal: AbortSignal | undefined;
  let retained: AssistantTools | undefined;
  let settle: ((value: unknown) => void) | undefined;
  const application = await custom(
    async (_input, options) => {
      signal = options.signal;
      retained = options.tools;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    { timeoutMs: 10, maxInFlight: 1 },
  );
  expect((await recommend(application)).json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect(signal!.aborted).toBe(true);
  await expect(retained!.call('searchMenu', {})).rejects.toMatchObject({ code: 'TOOLS_CLOSED' });
  expect((await recommend(application)).json()).toMatchObject({ code: 'ASSISTANT_RATE_LIMITED' });
  settle!(decision());
  const failure = await custom(async () => {
    throw Error('PRIVATE_PROVIDER_ERROR');
  });
  const response = await recommend(failure);
  expect(response.json()).toMatchObject({ status: 'UNAVAILABLE', decision: null });
  expect(response.body).not.toContain('PRIVATE_PROVIDER_ERROR');
});
it('limits participant/IP requests before starting another provider', async () => {
  const suggest = vi.fn(async () => decision()),
    application = await custom(suggest, { rateLimit: 1 });
  expect((await recommend(application)).json()).toMatchObject({ status: 'AVAILABLE' });
  expect((await recommend(application)).json()).toMatchObject({
    status: 'UNAVAILABLE',
    code: 'ASSISTANT_RATE_LIMITED',
  });
  expect(suggest).toHaveBeenCalledTimes(1);
});
it('MOCK owns its reads and dialogue; CUSTOM without provider remains unavailable', async () => {
  const mock = await app({ config: { ...config, mode: 'MOCK' } });
  expect((await recommend(mock)).json()).toMatchObject({
    status: 'AVAILABLE',
    mode: 'MOCK',
    decision: { kind: 'RECOMMEND' },
  });
  expect((await recommend(mock, { message: 'Goi y mon' })).json()).toMatchObject({
    status: 'AVAILABLE',
    decision: { kind: 'CLARIFY', clarificationFields: ['PEOPLE', 'BUDGET'] },
  });
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
  const application = await custom(async (_input, { tools }) => {
    await tools.call('searchMenu', {});
    return decision();
  });
  const before = await snapshot();
  expect((await recommend(application)).json()).toMatchObject({ status: 'AVAILABLE' });
  expect(await snapshot()).toBe(before);
});
it('detaches trusted requests and returned raw objects from provider mutation', async () => {
  const raw = decision();
  const application = await custom(async (input) => {
    input.request.budgetAmount = '999999999';
    return raw;
  });
  const sent = { ...body };
  const result = (await recommend(application, sent)).json();
  expect(sent).toEqual(body);
  expect(result.decision).toEqual(raw);
  raw.products[0]!.name = 'Changed after the response';
  expect(result.decision.products[0].name).toBe('AI proposed dish');
});
it('releases admission when failed provider work has settled', async () => {
  let calls = 0;
  const application = await custom(
    async () => {
      if (++calls === 1) throw Error('private failure');
      return decision();
    },
    { maxInFlight: 1 },
  );
  expect((await recommend(application)).json()).toMatchObject({ status: 'UNAVAILABLE' });
  expect((await recommend(application)).json()).toMatchObject({ status: 'AVAILABLE' });
});
it.each(['Gợi ý món chay cho hai người', 'Tôi dị   ứng tôm', 'Tránh đậu phộng và sữa'])(
  'leaves dietary and allergy dialogue to the provider: %s',
  async (message) => {
    const raw: AssistantDecision = {
      kind: 'REFER_STAFF',
      message: 'Provider: dữ liệu chưa xác nhận dị ứng; vui lòng hỏi nhân viên.',
      products: [],
      totalAmount: '0',
      clarificationFields: [],
      warnings: [],
    };
    const suggest = vi.fn(async () => raw),
      application = await custom(suggest);
    expect((await recommend(application, { ...body, message })).json()).toMatchObject({
      status: 'AVAILABLE',
      decision: raw,
    });
    expect(suggest).toHaveBeenCalledTimes(1);
  },
);
it('keeps menu, cart, order and payment reads independent of AI failure and core actions authoritative', async () => {
  const raw = decision([{ ...decision().products[0]!, unitPrice: '1', lineTotal: '1' }]);
  let fail = false;
  const application = await app(
    {
      config,
      provider: {
        suggest: async () => {
          if (fail) throw Error('provider unavailable');
          return raw;
        },
      },
    },
    tenant,
    true,
  );
  const core = (
    url: string,
    payload?: Record<string, unknown>,
    method: 'GET' | 'POST' | 'PATCH' = payload ? 'POST' : 'GET',
  ) => application.inject({ method, url, headers, payload });
  const currentCart = async () =>
    (await db.pool.query('SELECT * FROM session_cart WHERE session_id=$1', [session])).rows[0]!;
  expect((await recommend(application)).json().decision).toEqual(raw);
  const unknown = await core('/guest/cart', {
    productId: randomUUID(),
    quantity: 1,
    cartVersion: (await currentCart()).cart_version,
  });
  expect(unknown.statusCode).toBe(404);
  const added = await core('/guest/cart', {
    productId: dish,
    quantity: 2,
    cartVersion: (await currentCart()).cart_version,
  });
  expect(added.statusCode).toBe(200);
  const item = added.json();
  expect(String(item.unit_price_preview)).toBe('18000');
  await db.pool.query('UPDATE product SET base_price=19000 WHERE id=$1', [dish]);
  const submit = async () =>
    core('/guest/orders', {
      requestId: randomUUID(),
      cartVersion: (await currentCart()).cart_version,
      itemIds: [item.id],
    });
  expect((await submit()).statusCode).toBe(409);
  const updated = await core(
    '/guest/cart/' + item.id,
    { quantity: 2, cartVersion: (await currentCart()).cart_version },
    'PATCH',
  );
  expect(updated.statusCode).toBe(200);
  expect(String(updated.json().unit_price_preview)).toBe('19000');
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=1,available_qty=1 WHERE ingredient_id=$1',
    [ingredient],
  );
  expect((await submit()).statusCode).toBe(409);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM order_batch')).rows[0]?.n).toBe(0);
  fail = true;
  expect((await recommend(application)).json()).toMatchObject({ status: 'UNAVAILABLE' });
  const state = await core('/guest/state');
  expect(state.statusCode).toBe(200);
  expect(state.json().products.some((p: { id: string }) => p.id === dish)).toBe(true);
  expect(state.json().payments).toEqual([]);
  await db.pool.query(
    'UPDATE inventory_balance SET on_hand_qty=100,available_qty=100 WHERE ingredient_id=$1',
    [ingredient],
  );
  expect((await submit()).statusCode).toBe(200);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM order_batch')).rows[0]?.n).toBe(1);
});
