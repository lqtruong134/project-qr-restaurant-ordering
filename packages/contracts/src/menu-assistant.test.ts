import { describe, expect, it } from 'vitest';
import {
  assistantCategoryIncludes,
  assistantNeedsStaff,
  parseAssistantDecision,
  parseAssistantRequest,
} from './menu-assistant';
const id = '10000000-0000-4000-8000-000000000001';
const choice = () => ({
  kind: 'RECOMMEND',
  products: [{ productId: id, quantity: 1, reasonCode: 'BUDGET_FIT' }],
  clarificationFields: [],
});
describe('menu assistant version 1 contract', () => {
  it('keeps VND exact and trims the question without accepting client identity or mutable state', () => {
    expect(
      parseAssistantRequest({
        message: '  Gợi ý cho bữa trưa  ',
        people: 3,
        budgetAmount: '500000',
      }),
    ).toEqual({ message: 'Gợi ý cho bữa trưa', people: 3, budgetAmount: '500000' });
    for (const key of [
      'restaurantId',
      'sessionId',
      'participantId',
      'price',
      'cart',
      'order',
      'promotion',
    ])
      expect(() => parseAssistantRequest({ message: 'Gợi ý', [key]: 'untrusted' })).toThrow();
  });
  it.each(['', '0', '-1', '01', '12.5', '1e5', '1000000000', 'Infinity'])(
    'rejects invalid VND budget %s',
    (budgetAmount) => {
      expect(() => parseAssistantRequest({ message: 'Gợi ý', budgetAmount })).toThrow();
    },
  );
  it.each([0, 21, 1.5, '3', null])('rejects invalid people count %s', (people) => {
    expect(() => parseAssistantRequest({ message: 'Gợi ý', people })).toThrow();
  });
  it('bounds text, preference arrays and known fields', () => {
    for (const value of [
      { message: ' ' },
      { message: 'a'.repeat(1001) },
      { message: 'Gợi ý', preferences: { allergies: Array(11).fill('a') } },
      { message: 'Gợi ý', preferences: { include: ['DRINK', 'DRINK'] } },
      { message: 'Gợi ý', preferences: { trustAllergenFree: true } },
    ])
      expect(() => parseAssistantRequest(value)).toThrow();
  });
  it('accepts strict JSON and never treats text or reasoning as executable output', () => {
    expect(parseAssistantDecision(JSON.stringify(choice()))).toEqual(choice());
    for (const value of [
      '```json\n' + JSON.stringify(choice()) + '\n```',
      '<think>reasoning</think>' + JSON.stringify(choice()),
      'not json',
      'a'.repeat(16001),
      { ...choice(), message: 'Giá tôi tự đặt là 1 đồng' },
    ])
      expect(() => parseAssistantDecision(value)).toThrow();
  });
  it('rejects prices, names, arbitrary reasons, duplicates, invented IDs and unsafe quantities in provider output', () => {
    const item = choice().products[0]!;
    for (const products of [
      [{ ...item, price: '1' }],
      [{ ...item, name: 'Món khác' }],
      [{ ...item, reason: 'An toàn tuyệt đối' }],
      [item, { ...item, productId: id.toUpperCase() }],
      [{ ...item, productId: 'made-up' }],
      [{ ...item, quantity: 0 }],
      [{ ...item, quantity: 21 }],
      [{ ...item, reasonCode: 'ALLERGY_SAFE' }],
    ])
      expect(() => parseAssistantDecision({ ...choice(), products })).toThrow();
  });
  it('enforces response intent and clarification cardinality', () => {
    expect(
      parseAssistantDecision({
        kind: 'CLARIFY',
        products: [],
        clarificationFields: ['PEOPLE', 'BUDGET'],
      }).kind,
    ).toBe('CLARIFY');
    for (const value of [
      { kind: 'RECOMMEND', products: [], clarificationFields: [] },
      { ...choice(), clarificationFields: ['BUDGET'] },
      { kind: 'CLARIFY', products: [], clarificationFields: [] },
      { ...choice(), kind: 'REFER_STAFF' },
      { kind: 'NO_MATCH', products: [], clarificationFields: ['PEOPLE'] },
    ])
      expect(() => parseAssistantDecision(value)).toThrow();
  });
  it('refers unverified diet, spice, portion and allergy requests instead of inferring from BOM', () => {
    const preferences = [
      { diet: 'VEGETARIAN' },
      { spice: 'NOT_SPICY' },
      { proteins: ['BEEF'] },
      { allergies: ['đậu phộng'] },
      { avoidIngredients: ['nước mắm'] },
      { mealStyle: 'SHARED' },
    ];
    for (const p of preferences)
      expect(assistantNeedsStaff(parseAssistantRequest({ message: 'Gợi ý', preferences: p }))).toBe(
        true,
      );
    for (const message of [
      'Tôi bị dị ứng tôm',
      'Tôi dị   ứng tôm',
      'Gợi ý món chay cho hai người',
      'Tránh đậu phộng và sữa',
      'Món không dùng nước mắm',
      'TÔI BỊ DỊ ỨNG SỮA',
      'Không ăn cay',
      'I have a peanut allergy',
      'Món ăn chay',
      'Một bữa ăn nhẹ',
    ])
      expect(assistantNeedsStaff({ message })).toBe(true);
    expect(
      assistantNeedsStaff({
        message: 'Ba người ngân sách 500 nghìn',
        preferences: { include: ['VEGETABLE'] },
      }),
    ).toBe(false);
  });
  it('matches positive course requests through runtime category identity, not product code prefixes', () => {
    expect(assistantCategoryIncludes({ categoryCode: 'RAU-DAU-HU' }, 'VEGETABLE')).toBe(true);
    expect(assistantCategoryIncludes({ categoryCode: 'DO-UONG' }, 'DRINK')).toBe(true);
    expect(assistantCategoryIncludes({ categoryCode: 'TRANG-MIENG' }, 'DESSERT')).toBe(true);
    expect(assistantCategoryIncludes({ categoryCode: 'CANH' }, 'VEGETABLE')).toBe(false);
  });
});
