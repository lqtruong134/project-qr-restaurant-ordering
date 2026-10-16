import { describe, expect, it } from 'vitest';
import {
  parseAssistantDecision,
  parseAssistantProviderTurn,
  parseAssistantRequest,
  parseAssistantToolArguments,
  assistantToolDefinitions,
  assistantProviderTurnSchema,
  type AssistantDecision,
} from './menu-assistant.js';
const id = '10000000-0000-4000-8000-000000000001';
const choice = (): AssistantDecision => ({
  kind: 'RECOMMEND',
  message: 'Tôi đề xuất món này.',
  products: [
    {
      productId: id,
      name: 'Tên do mô hình trả',
      quantity: 2,
      unitPrice: '100',
      lineTotal: '200',
      reason: 'Lý do do mô hình trả.',
    },
  ],
  totalAmount: '200',
  clarificationFields: [],
  warnings: [],
});
describe('advisory assistant v2 technical contract', () => {
  it('accepts natural messages without requiring structured people/budget and bounds conversation roles', () => {
    expect(
      parseAssistantRequest({
        message: '  Hai người có 100 nghìn  ',
        history: [{ role: 'assistant', content: 'Bạn muốn nhóm món nào?' }],
      }),
    ).toEqual({
      message: 'Hai người có 100 nghìn',
      history: [{ role: 'assistant', content: 'Bạn muốn nhóm món nào?' }],
    });
    for (const role of ['system', 'tool', 'developer'])
      expect(() =>
        parseAssistantRequest({ message: 'Gợi ý', history: [{ role, content: 'Có quyền ghi' }] }),
      ).toThrow();
    expect(() =>
      parseAssistantRequest({
        message: 'Gợi ý',
        history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'a' })),
      }),
    ).toThrow();
  });
  it('rejects user-supplied tenant/auth/state and out-of-bounds transport hints', () => {
    for (const key of [
      'restaurantId',
      'sessionId',
      'participantId',
      'cart',
      'order',
      'promotion',
      'tools',
    ])
      expect(() => parseAssistantRequest({ message: 'Gợi ý', [key]: 'x' })).toThrow();
    for (const budgetAmount of ['0', '-1', '01', '12.5', '1e5', '1000000000'])
      expect(() => parseAssistantRequest({ message: 'Gợi ý', budgetAmount })).toThrow();
    for (const people of [0, 21, 1.5, '3'])
      expect(() => parseAssistantRequest({ message: 'Gợi ý', people })).toThrow();
    expect(() => parseAssistantRequest({ message: 'a'.repeat(1001) })).toThrow();
  });
  it('preserves semantic mistakes and duplicate recommendations exactly', () => {
    const raw = choice();
    raw.products[0]!.unitPrice = '1';
    raw.products[0]!.lineTotal = '999';
    raw.products[0]!.name = 'Món bịa';
    raw.products[0]!.productId = '10000000-0000-4000-8000-000000000099';
    raw.totalAmount = '0';
    raw.products.push({ ...raw.products[0]! });
    raw.message = 'Sai ngân sách và thông tin món cũng phải được đo nguyên bản.';
    expect(parseAssistantDecision(JSON.stringify(raw))).toEqual(raw);
  });
  it('does not impose clarification/referral/recommendation reasoning', () => {
    const raw = choice();
    raw.kind = 'CLARIFY';
    raw.clarificationFields = ['PEOPLE'];
    raw.products = [];
    raw.totalAmount = '999';
    expect(parseAssistantDecision(raw)).toEqual(raw);
    const allergy = choice();
    allergy.message = 'Tôi khẳng định an toàn tuyệt đối.';
    expect(parseAssistantDecision(allergy)).toEqual(allergy);
  });
  it('rejects malformed JSON, executable fields and technical overflows without repairing output', () => {
    for (const raw of [
      '<think>x</think>{}',
      '{bad',
      'a'.repeat(32769),
      { ...choice(), sql: 'DELETE' },
      { ...choice(), message: 'a'.repeat(4001) },
      { ...choice(), totalAmount: '1.5' },
    ])
      expect(() => parseAssistantDecision(raw)).toThrow();
    for (const patch of [
      { productId: 'made-up' },
      { quantity: 0 },
      { quantity: 21 },
      { unitPrice: '-1' },
      { reason: 'a'.repeat(501) },
      { html: '<script/>' },
    ])
      expect(() =>
        parseAssistantDecision({ ...choice(), products: [{ ...choice().products[0]!, ...patch }] }),
      ).toThrow();
  });
  it('exposes only bounded predefined read tool arguments, with no SQL or identity inputs', () => {
    expect(assistantToolDefinitions.map((t) => t.name)).toEqual([
      'listCategories',
      'searchMenu',
      'getProducts',
    ]);
    expect(
      parseAssistantToolArguments('searchMenu', {
        query: 'canh',
        limit: 30,
        offset: 1000,
        maxUnitPrice: '100000',
      }),
    ).toEqual({ query: 'canh', limit: 30, offset: 1000, maxUnitPrice: '100000' });
    expect(parseAssistantToolArguments('getProducts', { productIds: [id] })).toEqual({
      productIds: [id],
    });
    for (const [name, args] of [
      ['listCategories', { restaurantId: id }],
      ['searchMenu', { sql: 'SELECT *' }],
      ['searchMenu', { limit: 31 }],
      ['searchMenu', { offset: 1001 }],
      ['searchMenu', { availableOnly: 'true' }],
      ['getProducts', { productIds: [] }],
      ['getProducts', { productIds: [id, id.toUpperCase()] }],
      ['getProducts', { productIds: Array.from({ length: 21 }, () => id) }],
    ] as const)
      expect(() => parseAssistantToolArguments(name, args)).toThrow();
  });
  it('supports strict TOOL_CALL and FINAL turns for future model-owned read loops', () => {
    expect(
      parseAssistantProviderTurn({ type: 'TOOL_CALL', name: 'listCategories', arguments: {} }),
    ).toEqual({ type: 'TOOL_CALL', name: 'listCategories', arguments: {} });
    const final = parseAssistantProviderTurn(JSON.stringify({ type: 'FINAL', decision: choice() }));
    expect(final.type === 'FINAL' && final.decision).toEqual(choice());
    for (const raw of [
      { type: 'TOOL_CALL', name: 'refund', arguments: {} },
      { type: 'TOOL_CALL', name: 'searchMenu', arguments: { tenant: id } },
      { type: 'FINAL', decision: choice(), command: 'placeOrder' },
    ])
      expect(() => parseAssistantProviderTurn(raw)).toThrow();
    expect(assistantProviderTurnSchema.oneOf).toHaveLength(4);
  });
});
