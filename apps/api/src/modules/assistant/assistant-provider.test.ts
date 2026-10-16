import { describe, expect, it } from 'vitest';
import type { AssistantProviderInput, AssistantMenuProduct } from '@thesis/contracts';
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
describe('deterministic mock fixture', () => {
  function input(menu: AssistantMenuProduct[], budgetAmount = '50000'): AssistantProviderInput {
    return {
      request: { message: 'Gợi ý món', people: 2, budgetAmount },
      context: {
        menu,
        currency: 'VND',
        priceIncludesVat: true,
        semanticMetadata: 'UNREVIEWED',
        catalogTruncated: false,
      },
    };
  }
  const signal = new AbortController().signal;
  it('uses current prices and excludes unavailable products', async () => {
    const request = input([product('A', '20000'), { ...product('B', '1'), available: false }]);
    expect(await mockAssistantProvider.suggest(request, { signal })).toEqual({
      kind: 'RECOMMEND',
      products: [{ productId: 'A', quantity: 1, reasonCode: 'BUDGET_FIT' }],
      clarificationFields: [],
    });
  });
  it('covers requested categories only when affordable', async () => {
    const request = input([product('A', '20000'), product('B', '10000', 'DO-UONG')]);
    request.request.preferences = { include: ['DRINK'] };
    const result = await mockAssistantProvider.suggest(request, { signal });
    expect(result).toMatchObject({
      kind: 'RECOMMEND',
      products: expect.arrayContaining([
        { productId: 'B', quantity: 1, reasonCode: 'REQUESTED_DRINK' },
      ]),
    });
    request.request.budgetAmount = '5000';
    expect(await mockAssistantProvider.suggest(request, { signal })).toMatchObject({
      kind: 'NO_MATCH',
    });
  });
  it('returns no match when menu is empty or all prices exceed budget', async () => {
    expect(await mockAssistantProvider.suggest(input([]), { signal })).toMatchObject({
      kind: 'NO_MATCH',
    });
    expect(
      await mockAssistantProvider.suggest(input([product('A', '999999999')]), { signal }),
    ).toMatchObject({ kind: 'NO_MATCH' });
  });
});
