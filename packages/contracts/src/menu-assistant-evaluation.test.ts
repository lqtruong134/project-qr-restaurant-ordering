import { describe, expect, it } from 'vitest';
import {
  assistantSystemPolicy,
  type AssistantDecision,
  type AssistantMenuProduct,
  type AssistantProviderInput,
} from './menu-assistant.js';
import {
  canonicalAssistantPrompt,
  checkAssistantCandidate,
  evaluateAssistantPredictions,
  parseAssistantExample,
  parseAssistantProviderInput,
  validateAssistantDatasets,
} from './menu-assistant-evaluation.js';

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const unknownId = '10000000-0000-4000-8000-000000000099';
const product = (id = firstId, price = '25000'): AssistantMenuProduct => ({
  productId: id,
  code: id === firstId ? 'SYNTHETIC-1' : 'SYNTHETIC-2',
  name: 'Món thử tổng hợp',
  description: 'Chỉ dùng cho kiểm thử.',
  categoryCode: 'MON-CHINH',
  categoryName: 'Cơm',
  unitPrice: price,
  productKind: 'DISH',
  version: 1,
  available: true,
  ingredients: ['Gạo'],
  components: [],
});
const input = (): AssistantProviderInput => ({
  request: { message: 'Tư vấn bữa ăn', people: 2, budgetAmount: '100000' },
  context: {
    menu: [product(), product(secondId, '30000')],
    catalogTruncated: false,
    currency: 'VND',
    priceIncludesVat: true,
    semanticMetadata: 'UNREVIEWED',
  },
});
const recommend = (id = firstId, quantity = 2): AssistantDecision => ({
  kind: 'RECOMMEND',
  products: [{ productId: id, quantity, reasonCode: 'BUDGET_FIT' }],
  clarificationFields: [],
});
const rawExample = (id: string, request = input(), expected = recommend()) => ({
  id,
  groupId: 'group-' + id,
  scenario: 'budget_fit',
  source: 'CURATED_SYNTHETIC',
  messages: [
    { role: 'system', content: assistantSystemPolicy },
    { role: 'user', content: JSON.stringify(request) },
    { role: 'assistant', content: JSON.stringify(expected) },
  ],
});
const example = (id: string, request = input(), expected = recommend()) =>
  parseAssistantExample(rawExample(id, request, expected));

describe('offline menu assistant data guards', () => {
  it('validates strict curated records without claiming model quality', () => {
    const result = validateAssistantDatasets({
      train: [rawExample('train-1')],
      validation: [
        rawExample('validation-1', {
          ...input(),
          request: { ...input().request, message: 'Yêu cầu phần validation' },
        }),
      ],
      evaluation: [
        rawExample('evaluation-1', {
          ...input(),
          request: { ...input().request, message: 'Yêu cầu phần evaluation' },
        }),
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.counts).toEqual({ train: 1, validation: 1, evaluation: 1 });
    expect(result.examples.train[0]!.source).toBe('CURATED_SYNTHETIC');
  });

  it('rejects empty splits and repeated prompts within the same split', () => {
    const result = validateAssistantDatasets({
      train: [rawExample('one'), rawExample('two')],
      validation: [],
      evaluation: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['EMPTY_SPLIT', 'DUPLICATE_PROMPT']),
    );
  });

  it('allows preference clarification but never repeats already supplied people or budget', () => {
    const clarify: AssistantDecision = {
      kind: 'CLARIFY',
      products: [],
      clarificationFields: ['PREFERENCES'],
    };
    expect(checkAssistantCandidate(input(), clarify).preferences).toBe(true);
    expect(
      checkAssistantCandidate(input(), {
        ...clarify,
        clarificationFields: ['PEOPLE'],
      }).preferences,
    ).toBe(false);
  });

  it('checks UUIDs, money, availability, context fields, and duplicate menu products', () => {
    for (const mutate of [
      (row: AssistantProviderInput) => {
        row.context.menu[0]!.productId = 'not-a-uuid';
      },
      (row: AssistantProviderInput) => {
        row.context.menu[0]!.unitPrice = '25.50';
      },
      (row: AssistantProviderInput) => {
        row.context.menu[0]!.available = 'true' as unknown as boolean;
      },
      (row: AssistantProviderInput) => {
        Object.assign(row.context, { invented: true });
      },
      (row: AssistantProviderInput) => {
        row.context.menu.push(product());
      },
    ]) {
      const row = input();
      mutate(row);
      expect(() => parseAssistantProviderInput(row)).toThrow();
    }
  });

  it('rejects unavailable or invented product IDs and duplicate recommendations', () => {
    expect(checkAssistantCandidate(input(), recommend(unknownId)).grounding).toBe(false);
    const unavailable = input();
    unavailable.context.menu[0]!.available = false;
    expect(checkAssistantCandidate(unavailable, recommend()).grounding).toBe(false);
    const duplicate = recommend();
    duplicate.products.push({ ...duplicate.products[0]! });
    expect(checkAssistantCandidate(input(), duplicate).structuredPass).toBe(false);
  });

  it('rejects invented prices and other extra output fields instead of trusting them', () => {
    const wrongPrice = recommend();
    Object.assign(wrongPrice.products[0]!, { unitPrice: '1' });
    const result = checkAssistantCandidate(input(), wrongPrice);
    expect(result.structuredPass).toBe(false);
    expect(result.noInventedPrice).toBe(false);
    expect(
      checkAssistantCandidate(input(), { ...recommend(), totalAmount: '1' }).structuredPass,
    ).toBe(false);
  });

  it('uses exact deterministic integer arithmetic at the budget boundary', () => {
    const row = input();
    row.context.menu[0]!.unitPrice = '333333333';
    row.request.budgetAmount = '999999999';
    const first = checkAssistantCandidate(row, recommend(firstId, 3));
    expect(first.totalAmount).toBe('999999999');
    expect(first.budget).toBe(true);
    expect(checkAssistantCandidate(row, recommend(firstId, 3))).toEqual(first);
    row.request.budgetAmount = '999999998';
    expect(checkAssistantCandidate(row, recommend(firstId, 3)).budget).toBe(false);
  });

  it('clarifies exactly the missing people and budget, with the staff guard taking priority', () => {
    const row = input();
    delete row.request.people;
    delete row.request.budgetAmount;
    const clarify: AssistantDecision = {
      kind: 'CLARIFY',
      products: [],
      clarificationFields: ['BUDGET', 'PEOPLE'],
    };
    expect(checkAssistantCandidate(row, clarify).preferences).toBe(true);
    expect(
      checkAssistantCandidate(row, { ...clarify, clarificationFields: ['PEOPLE'] }).preferences,
    ).toBe(false);
    row.request.preferences = { allergies: ['Đậu phộng'] };
    expect(checkAssistantCandidate(row, clarify).preferences).toBe(false);
    expect(
      checkAssistantCandidate(row, { kind: 'REFER_STAFF', products: [], clarificationFields: [] })
        .errors,
    ).toEqual([]);
    expect(checkAssistantCandidate(row, recommend()).safeAllergy).toBe(false);
  });

  it('requires positive category matches and checks requested reason codes', () => {
    const row = input();
    row.request.preferences = { include: ['VEGETABLE'] };
    const wrongCategory = checkAssistantCandidate(row, recommend());
    expect(wrongCategory.preferences).toBe(false);
    row.context.menu[0]!.categoryCode = 'RAU-DAU-HU';
    const decision = recommend();
    decision.products[0]!.reasonCode = 'REQUESTED_VEGETABLE';
    expect(checkAssistantCandidate(row, decision).preferences).toBe(true);
    decision.products[0]!.reasonCode = 'REQUESTED_DRINK';
    expect(checkAssistantCandidate(row, decision).errors).toContain('REASON_CATEGORY_MISMATCH');
    row.request.preferences.include = ['VEGETABLE', 'DESSERT'];
    expect(checkAssistantCandidate(row, recommend()).errors).toContain(
      'MISSING_REQUESTED_CATEGORY_DESSERT',
    );
  });

  it('refers every unreviewed diet, spice, protein, style, and avoidance request to staff', () => {
    for (const preferences of [
      { diet: 'VEGETARIAN' as const },
      { spice: 'NOT_SPICY' as const },
      { proteins: ['SEAFOOD' as const] },
      { mealStyle: 'LIGHT' as const },
      { mealStyle: 'SHARED' as const },
      { avoidIngredients: ['Tỏi'] },
    ]) {
      const row = input();
      row.request.preferences = preferences;
      expect(checkAssistantCandidate(row, recommend()).preferences).toBe(false);
      expect(
        checkAssistantCandidate(row, { kind: 'REFER_STAFF', products: [], clarificationFields: [] })
          .errors,
      ).toEqual([]);
    }
  });

  it('rejects invalid gold answers and noncurated or policy-modified records', () => {
    expect(() =>
      parseAssistantExample(rawExample('over-budget', input(), recommend(firstId, 5))),
    ).toThrow('Gold answer failed');
    expect(() =>
      parseAssistantExample({ ...rawExample('wrong-source'), source: 'MODEL_GENERATED' }),
    ).toThrow();
    const changed = rawExample('changed-policy');
    changed.messages[0]!.content = 'Different policy';
    expect(() => parseAssistantExample(changed)).toThrow();
  });

  it('detects ID, group, and canonicalized full prompt leakage across splits', () => {
    const train = rawExample('first');
    const validation = rawExample('second');
    validation.groupId = train.groupId;
    const sameIdDifferentPrompt = rawExample('first');
    const altered = input();
    altered.request.message = 'Một yêu cầu khác';
    sameIdDifferentPrompt.messages[1]!.content = JSON.stringify(altered);
    const result = validateAssistantDatasets({
      train: [train],
      validation: [validation],
      evaluation: [sameIdDifferentPrompt],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_ID', 'GROUP_SPLIT_LEAKAGE', 'PROMPT_SPLIT_LEAKAGE']),
    );
    const reordered = {
      context: input().context,
      request: { budgetAmount: '100000', people: 2, message: '  TƯ VẤN   BỮA ĂN  ' },
    };
    expect(canonicalAssistantPrompt(reordered)).toBe(canonicalAssistantPrompt(input()));
  });
});

describe('external prediction evaluation', () => {
  it('checks menu facts independently of gold product choices', () => {
    const report = evaluateAssistantPredictions(
      [example('one')],
      [{ id: 'one', output: JSON.stringify(recommend(secondId)) }],
    );
    expect(report.overallPass).toBe(true);
    expect(report.cases[0]!.totalAmount).toBe('60000');
    expect(report.consistency.measured).toBe(false);
  });

  it('counts missing predictions as failures in every full-split denominator', () => {
    const report = evaluateAssistantPredictions(
      [example('one'), example('two')],
      [{ id: 'one', output: recommend() }],
    );
    expect(report.overallPass).toBe(false);
    expect(report.missingPredictionCount).toBe(1);
    expect(report.metrics.structuredPass).toEqual({ passed: 1, total: 2, rate: 0.5 });
    expect(report.metrics.pass).toEqual({ passed: 1, total: 2, rate: 0.5 });
    expect(report.cases[1]!.errors).toContain('MISSING_PREDICTION');
  });

  it('rejects duplicate and unexpected IDs, and handles malformed records without crashing', () => {
    const report = evaluateAssistantPredictions(
      [example('one'), example('two')],
      [
        { id: 'one', output: recommend() },
        { id: 'one', output: recommend() },
        { id: 'two', output: '{not JSON' },
        { id: 'unexpected', output: recommend() },
        null,
        { id: 'two', rawResponse: '{}' },
      ],
    );
    expect(report.overallPass).toBe(false);
    expect(report.duplicatePredictionIds).toContain('one');
    expect(report.unexpectedPredictionIds).toEqual(['unexpected']);
    expect(report.malformedPredictionRecords).toBe(2);
    expect(report.metrics.structuredPass).toEqual({ passed: 0, total: 2, rate: 0 });
    expect(report.cases[0]!.errors).toContain('DUPLICATE_PREDICTION');
  });

  it('does not confuse schema and grounding success with intent or clarification correctness', () => {
    const row = input();
    delete row.request.people;
    const gold: AssistantDecision = {
      kind: 'CLARIFY',
      products: [],
      clarificationFields: ['PEOPLE'],
    };
    const report = evaluateAssistantPredictions(
      [example('clarify', row, gold)],
      [{ id: 'clarify', output: { kind: 'NO_MATCH', products: [], clarificationFields: [] } }],
    );
    expect(report.metrics.structuredPass.rate).toBe(1);
    expect(report.metrics.kindMatch.rate).toBe(0);
    expect(report.metrics.clarificationMatch.rate).toBe(0);
    expect(report.metrics.preferences.rate).toBe(0);
    expect(report.overallPass).toBe(false);
  });

  it('keeps missing allergy predictions in the applicable allergy denominator', () => {
    const row = input();
    row.request.preferences = { allergies: ['Sữa'] };
    const gold: AssistantDecision = { kind: 'REFER_STAFF', products: [], clarificationFields: [] };
    const report = evaluateAssistantPredictions([example('allergy', row, gold)], []);
    expect(report.metrics.safeAllergy).toEqual({ passed: 0, total: 1, rate: 0 });
    expect(report.overallPass).toBe(false);
  });
});

it('counts whitespace-normalized allergy wording in safety metrics', () => {
  const data = input();
  data.request.message = 'Tôi dị   ứng tôm';
  const safe = { kind: 'REFER_STAFF' as const, products: [], clarificationFields: [] };
  const record = example('allergy-whitespace', data, safe);
  const result = evaluateAssistantPredictions([record], [{ id: record.id, output: recommend() }]);
  expect(result.metrics.safeAllergy).toEqual({ passed: 0, total: 1, rate: 0 });
  expect(result.overallPass).toBe(false);
});
