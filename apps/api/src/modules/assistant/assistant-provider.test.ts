import { describe, expect, it, vi } from 'vitest';
import type {
  AssistantProviderInput,
  AssistantMenuProduct,
  AssistantTools,
} from '@thesis/contracts';
import { assistantToolDefinitions } from '@thesis/contracts';
import {
  readMenuAssistantConfig,
  mockAssistantProvider,
  validAssistantConfig,
} from './assistant-provider.js';
const product = (id: string, price: string, categoryCode = 'MON-CHINH'): AssistantMenuProduct => ({
  productId: id,
  code: id,
  name: 'Món thử',
  description: '',
  categoryCode,
  categoryName: '',
  unitPrice: price,
  productKind: 'DISH',
  version: 1,
  available: true,
  ingredients: [],
  components: [],
});
describe('assistant optional provider configuration', () => {
  it('defaults to OFF without credentials or network configuration', () => {
    expect(readMenuAssistantConfig({})).toEqual({
      mode: 'OFF',
      timeoutMs: 8000,
      rateLimit: 6,
      windowMs: 60000,
      maxInFlight: 4,
    });
  });
  it.each([
    { MENU_ASSISTANT_MODE: 'OLLAMA' },
    { MENU_ASSISTANT_TIMEOUT_MS: 'NaN' },
    { MENU_ASSISTANT_TIMEOUT_MS: '30001' },
    { MENU_ASSISTANT_RATE_LIMIT: '0' },
    { MENU_ASSISTANT_WINDOW_MS: '999' },
    { MENU_ASSISTANT_MAX_IN_FLIGHT: '21' },
  ])('fails closed for invalid optional settings %j', (env) => {
    expect(readMenuAssistantConfig(env).mode).toBe('OFF');
  });
  it('permits explicit MOCK and injected CUSTOM modes', () => {
    expect(readMenuAssistantConfig({ MENU_ASSISTANT_MODE: 'MOCK' }).mode).toBe('MOCK');
    expect(readMenuAssistantConfig({ MENU_ASSISTANT_MODE: 'CUSTOM' }).mode).toBe('CUSTOM');
    expect(validAssistantConfig({ ...readMenuAssistantConfig({}), mode: 'MOCK' }).mode).toBe(
      'MOCK',
    );
  });
});
describe('deterministic advisory provider fixture', () => {
  function input(budgetAmount = '50000'): AssistantProviderInput {
    return {
      request: { message: 'Gợi ý món', people: 2, budgetAmount },
      context: {
        currency: 'VND',
        priceIncludesVat: true,
        pricingBasis: 'MENU_BEFORE_DISCOUNTS',
        semanticMetadata: 'UNREVIEWED',
      },
      tools: assistantToolDefinitions,
    };
  }
  const signal = new AbortController().signal;
  const toolsFor = (menu: AssistantMenuProduct[]) => {
    const call = vi.fn(async () => ({
      products: menu,
      truncated: false,
      asOf: '2026-10-16T00:00:00Z',
    }));
    return { tools: { call } satisfies AssistantTools, call };
  };
  it('actively reads current prices and chooses available products inside the provider', async () => {
    const { tools, call } = toolsFor([
      product('A', '20000'),
      { ...product('B', '1'), available: false },
    ]);
    const result = await mockAssistantProvider.suggest(input(), { signal, tools });
    expect(call).toHaveBeenCalledWith('searchMenu', {
      availableOnly: true,
      maxUnitPrice: '50000',
      limit: 30,
    });
    expect(result).toMatchObject({
      kind: 'RECOMMEND',
      products: [{ productId: 'A', unitPrice: '20000', quantity: 1 }],
      totalAmount: '20000',
      clarificationFields: [],
    });
  });
  it('covers requested categories only when affordable as fixture behavior', async () => {
    const { tools } = toolsFor([product('A', '20000'), product('B', '10000', 'DO-UONG')]);
    const request = input();
    request.request.preferences = { include: ['DRINK'] };
    expect(await mockAssistantProvider.suggest(request, { signal, tools })).toMatchObject({
      kind: 'RECOMMEND',
      products: expect.arrayContaining([expect.objectContaining({ productId: 'B' })]),
    });
    request.request.budgetAmount = '5000';
    expect(await mockAssistantProvider.suggest(request, { signal, tools })).toMatchObject({
      kind: 'NO_MATCH',
    });
  });
  it('owns clarification rather than requiring API preprocessing', async () => {
    const { tools, call } = toolsFor([]);
    const request = input();
    request.request = { message: 'Gợi ý món' };
    expect(await mockAssistantProvider.suggest(request, { signal, tools })).toMatchObject({
      kind: 'CLARIFY',
      clarificationFields: ['PEOPLE', 'BUDGET'],
    });
    expect(call).not.toHaveBeenCalled();
  });
  it('does not claim allergy safety when semantic metadata is unreviewed', async () => {
    const { tools, call } = toolsFor([]);
    const request = input();
    request.request.preferences = { allergies: ['sữa'] };
    expect(await mockAssistantProvider.suggest(request, { signal, tools })).toMatchObject({
      kind: 'REFER_STAFF',
      products: [],
    });
    expect(call).not.toHaveBeenCalled();
  });
  it('returns no match when menu is empty or all prices exceed budget', async () => {
    expect(
      await mockAssistantProvider.suggest(input(), { signal, tools: toolsFor([]).tools }),
    ).toMatchObject({ kind: 'NO_MATCH' });
    expect(
      await mockAssistantProvider.suggest(input(), {
        signal,
        tools: toolsFor([product('A', '999999999')]).tools,
      }),
    ).toMatchObject({ kind: 'NO_MATCH' });
  });
});
