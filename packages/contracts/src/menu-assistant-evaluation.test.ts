import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseAssistantDecision,
  parseAssistantProviderTurn,
  type AssistantDecision,
} from './menu-assistant.js';
import {
  checkAssistantCandidate,
  evaluateAssistantPredictions,
  parseAssistantExample,
  parseAssistantProviderInput,
  replayAssistantTool,
  validateAssistantDatasets,
  type AssistantExample,
} from './menu-assistant-evaluation.js';
const rows = (split: string): unknown[] =>
  readFileSync('ai/menu-assistant/data/' + split + '.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
const example = (index = 0) => parseAssistantExample(rows('evaluation')[index]);
const output = (e: AssistantExample, decision: AssistantDecision = e.expected) => ({
  id: e.id,
  output: JSON.stringify({ type: 'FINAL', decision }),
  toolTrace: e.messages.flatMap((m, i) => {
    if (m.role !== 'assistant') return [];
    const turn = parseAssistantProviderTurn(m.content);
    if (turn.type !== 'TOOL_CALL') return [];
    return [
      {
        name: turn.name,
        arguments: turn.arguments,
        result: JSON.parse(e.messages[i + 1]!.content).result,
      },
    ];
  }),
});
describe('v2 curated tool trajectories', () => {
  it('validates36 separated curated scenarios without measuring a model', () => {
    const result = validateAssistantDatasets({
      train: rows('train'),
      validation: rows('validation'),
      evaluation: rows('evaluation'),
    });
    expect(result.valid).toBe(true);
    expect(result.counts).toEqual({ train: 24, validation: 6, evaluation: 6 });
    const natural = result.examples.train[0]!;
    expect(natural.input.request.people).toBeUndefined();
    expect(natural.facts.people).toBe(2);
    expect(natural.input.context).not.toHaveProperty('menu');
    expect(result.examples.train.some((e) => e.input.request.history?.length)).toBe(true);
  });
  it('rejects prefed/private context, changed tools and fabricated tool observations', () => {
    const e = example();
    expect(() =>
      parseAssistantProviderInput({
        ...e.input,
        context: { ...e.input.context, menu: e.facts.menu },
      }),
    ).toThrow();
    expect(() =>
      parseAssistantProviderInput({ ...e.input, tools: [{ name: 'sql', parameters: {} }] }),
    ).toThrow();
    const raw = structuredClone(rows('evaluation')[0]) as {
      messages: { role: string; content: string }[];
    };
    const tool = raw.messages.find((m) => m.role === 'tool')!;
    const value = JSON.parse(tool.content);
    value.result.products[0].unitPrice = '1';
    tool.content = JSON.stringify(value);
    expect(() => parseAssistantExample(raw)).toThrow('independent fixture truth');
  });
  it('rejects changed policy and private product fields', () => {
    const raw = structuredClone(rows('evaluation')[0]) as {
      facts: { menu: Record<string, unknown>[] };
      messages: { content: string }[];
    };
    raw.facts.menu[0]!.costPrice = '1';
    expect(() => parseAssistantExample(raw)).toThrow();
    const policy = structuredClone(rows('evaluation')[0]) as { messages: { content: string }[] };
    policy.messages[0]!.content = 'Changed';
    expect(() => parseAssistantExample(policy)).toThrow();
  });
  it('detects repeated IDs/groups/prompts/menu families across splits', () => {
    const first = rows('train')[0],
      copy = structuredClone(first) as Record<string, unknown>;
    copy.id = 'other';
    const result = validateAssistantDatasets({
      train: [first],
      validation: [copy],
      evaluation: [],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'EMPTY_SPLIT',
        'GROUP_SPLIT_LEAKAGE',
        'PROMPT_SPLIT_LEAKAGE',
        'MENU_SPLIT_LEAKAGE',
      ]),
    );
  });
  it('replays only approved read filters with timestamped public values', () => {
    const e = example(),
      result = replayAssistantTool(e.facts, 'searchMenu', {
        categoryCode: 'RAU-DAU-HU',
        availableOnly: true,
        limit: 1,
      });
    expect('products' in result && result.products).toHaveLength(1);
    expect(result.asOf).toBe(e.facts.asOf);
    expect(() => replayAssistantTool(e.facts, 'searchMenu', { sql: 'SELECT *' })).toThrow();
  });
});
describe('raw external prediction quality checks', () => {
  it('scores a terminal raw model turn and keeps semantic review unmeasured', () => {
    const e = example(1),
      result = evaluateAssistantPredictions([e], [output(e)]);
    expect(result.overallPass).toBe(true);
    expect(result.metrics.quotedPriceAccuracy.rate).toBe(1);
    expect(result.manualReview.measured).toBe(false);
    expect(result.consistency.measured).toBe(false);
    expect(result.predictionProvenanceVerified).toBe(false);
  });
  it('preserves wrong claims at runtime and exposes hallucinations/prices/totals/budget offline', () => {
    const e = example(),
      raw = structuredClone(e.expected),
      line = raw.products[0]!;
    line.name = 'Tên bịa';
    line.unitPrice = '1';
    line.lineTotal = '1';
    line.quantity = 20;
    raw.totalAmount = '1';
    expect(parseAssistantDecision(raw)).toEqual(raw);
    const report = evaluateAssistantPredictions([e], [output(e, raw)]);
    expect(report.overallPass).toBe(false);
    expect(report.cases[0]!.grounding).toBe(false);
    expect(report.cases[0]!.quotedPriceAccuracy).toBe(false);
    expect(report.cases[0]!.arithmeticConsistency).toBe(false);
    expect(report.cases[0]!.budget).toBe(false);
    line.productId = '10000000-0000-4000-8000-000000000099';
    expect(evaluateAssistantPredictions([e], [output(e, raw)]).hallucinatedProductCount).toBe(1);
  });
  it('separates existing unavailable products from hallucinated IDs', () => {
    const e = example(),
      raw = structuredClone(e.expected),
      p = e.facts.menu.find((p) => !p.available)!;
    raw.products = [
      {
        productId: p.productId,
        name: p.name,
        quantity: 1,
        unitPrice: p.unitPrice,
        lineTotal: p.unitPrice,
        reason: 'Một gợi ý.',
      },
    ];
    raw.totalAmount = p.unitPrice;
    const result = checkAssistantCandidate(e.facts, raw);
    expect(result.grounding).toBe(true);
    expect(result.availability).toBe(false);
    expect(result.hallucinatedProductCount).toBe(0);
  });
  it('requires actual read evidence rather than accepting fixture knowledge as observation', () => {
    const e = example(),
      prediction = output(e);
    prediction.toolTrace = [];
    const report = evaluateAssistantPredictions([e], [prediction]);
    expect(report.overallPass).toBe(false);
    expect(report.cases[0]!.errors).toContain('PRODUCT_NOT_READ_BY_MODEL');
  });
  it('does not silently repair duplicate choices or preference violations', () => {
    const e = example(),
      raw = structuredClone(e.expected);
    raw.products = raw.products.filter(
      (line) =>
        !e.facts.menu.some(
          (p) => p.productId === line.productId && p.categoryCode === 'RAU-DAU-HU',
        ),
    );
    raw.products.push({ ...raw.products[0]! });
    const result = checkAssistantCandidate(e.facts, raw, e.observedProductIds);
    expect(result.preferences).toBe(false);
    expect(result.errors).toContain('DUPLICATE_RECOMMENDATION');
    expect(parseAssistantDecision(raw)).toEqual(raw);
  });
  it('counts missing/malformed cases with explicit applicable denominators', () => {
    const examples = rows('evaluation').map(parseAssistantExample),
      report = evaluateAssistantPredictions(examples, []);
    expect(report.expectedCount).toBe(6);
    expect(report.missingPredictionCount).toBe(6);
    expect(report.metrics.structuredPass).toEqual({ passed: 0, total: 6, rate: 0 });
    expect(report.metrics.grounding).toEqual({ passed: 0, total: 2, rate: 0 });
    expect(report.metrics.arithmeticConsistency).toEqual({ passed: 0, total: 2, rate: 0 });
    expect(report.metrics.allergySafetyProxy).toEqual({ passed: 0, total: 1, rate: 0 });
  });
  it('rejects duplicate/unexpected IDs, malformed model turns and invented read observations', () => {
    const e = example(),
      prediction = output(e),
      report = evaluateAssistantPredictions(
        [e],
        [prediction, prediction, { id: 'unexpected', output: '{bad', toolTrace: [] }, null],
      );
    expect(report.overallPass).toBe(false);
    expect(report.duplicatePredictionIds).toEqual([e.id]);
    expect(report.unexpectedPredictionIds).toEqual(['unexpected']);
    expect(report.malformedPredictionRecords).toBe(1);
    expect(
      evaluateAssistantPredictions([e], [{ id: e.id, output: e.expected, toolTrace: [] }]).metrics
        .structuredPass.rate,
    ).toBe(0);
    const bad = output(e);
    bad.toolTrace[0]!.result.asOf = '2020-01-01T00:00:00Z';
    expect(evaluateAssistantPredictions([e], [bad]).cases[0]!.errors).toContain(
      'INVALID_TOOL_TRACE',
    );
  });
  it('uses a limited allergy wording/referral proxy, never a safety certification', () => {
    const e = example(4),
      valid = evaluateAssistantPredictions([e], [output(e)]);
    expect(valid.metrics.allergySafetyProxy.rate).toBe(1);
    expect(valid.manualReview.rubrics).toContain(
      'Subtle hallucinations and allergy-safety meaning',
    );
    const raw = structuredClone(e.expected);
    raw.message = 'An toàn tuyệt đối 100%, không cần hỏi ai.';
    expect(parseAssistantDecision(raw)).toEqual(raw);
    expect(
      evaluateAssistantPredictions([e], [output(e, raw)]).metrics.allergySafetyProxy.rate,
    ).toBe(0);
  });
  it('checks clarification against natural-language facts rather than missing structured hints', () => {
    const e = example();
    expect(e.input.request.people).toBeUndefined();
    expect(e.input.request.budgetAmount).toBeUndefined();
    expect(evaluateAssistantPredictions([e], [output(e)]).metrics.clarification.rate).toBe(1);
    const raw = structuredClone(e.expected);
    raw.kind = 'CLARIFY';
    raw.products = [];
    raw.totalAmount = '0';
    raw.clarificationFields = ['PEOPLE', 'BUDGET'];
    expect(evaluateAssistantPredictions([e], [output(e, raw)]).metrics.clarification.rate).toBe(0);
  });
});
