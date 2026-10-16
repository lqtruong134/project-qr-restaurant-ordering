import {
  assistantCategoryIncludes,
  assistantClarificationFields,
  assistantIncludes,
  assistantSystemPolicy,
  assistantToolDefinitions,
  parseAssistantDecision,
  parseAssistantProviderTurn,
  parseAssistantRequest,
  parseAssistantToolArguments,
  type AssistantDecision,
  type AssistantInclude,
  type AssistantMenuProduct,
  type AssistantMenuSearch,
  type AssistantProviderInput,
  type AssistantToolName,
  type AssistantToolResult,
} from './menu-assistant.js';
export const assistantDataSplits = ['train', 'validation', 'evaluation'] as const;
export type AssistantDataSplit = (typeof assistantDataSplits)[number];
export type AssistantEvaluationFacts = {
  menu: AssistantMenuProduct[];
  asOf: string;
  people: number | null;
  budgetAmount: string | null;
  include: AssistantInclude[];
  requiredProductIds: string[];
  forbiddenProductIds: string[];
  expectedClarificationFields: ('PEOPLE' | 'BUDGET' | 'PREFERENCES')[];
  allergyCase: boolean;
};
export type AssistantExample = {
  id: string;
  groupId: string;
  scenario: string;
  source: 'CURATED_SYNTHETIC';
  input: AssistantProviderInput;
  facts: AssistantEvaluationFacts;
  expected: AssistantDecision;
  messages: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }[];
  observedProductIds: string[];
};
export type AssistantDataIssue = {
  code: string;
  message: string;
  split?: AssistantDataSplit;
  index?: number;
  id?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = /^(0|[1-9][0-9]{0,8})$/;
const fail = (message: string): never => {
  throw new Error(message);
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('Expected an object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]) {
  if (Object.keys(value).length !== fields.length || fields.some((field) => !(field in value)))
    fail('Object fields do not match the offline data schema.');
}
function text(value: unknown, max = 160, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    return fail('Invalid text field.');
  return value;
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    return fail('Invalid integer field.');
  return value;
}
function identifier(value: unknown): string {
  const result = text(value);
  if (!uuid.test(result)) fail('Invalid product UUID.');
  return result;
}
function unique(values: string[], label: string) {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length)
    fail('Duplicate ' + label + '.');
}
function boundedList(value: unknown, max: number, allowed?: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > max) return fail('Invalid list.');
  const result = value.map((item) => text(item));
  unique(result, 'list value');
  if (allowed && result.some((item) => !allowed.includes(item))) fail('Unknown list value.');
  return result;
}
function menuProduct(value: unknown): AssistantMenuProduct {
  const row = object(value);
  exact(row, [
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
  ]);
  identifier(row.productId);
  text(row.code, 40);
  text(row.name);
  text(row.description, 1000, true);
  text(row.categoryCode, 80);
  text(row.categoryName);
  if (typeof row.unitPrice !== 'string' || !money.test(row.unitPrice)) fail('Invalid menu money.');
  if (!['DISH', 'COMBO'].includes(String(row.productKind))) fail('Invalid product kind.');
  integer(row.version, 2147483647);
  if (typeof row.available !== 'boolean') fail('Availability must be a boolean.');
  boundedList(row.ingredients, 40);
  if (!Array.isArray(row.components) || row.components.length > 20) fail('Invalid components.');
  const ids = (row.components as unknown[]).map((value) => {
    const item = object(value);
    exact(item, ['productId', 'name', 'quantity']);
    const id = identifier(item.productId);
    text(item.name);
    integer(item.quantity, 20);
    if (id.toLowerCase() === String(row.productId).toLowerCase())
      fail('A combo cannot contain itself.');
    return id;
  });
  unique(ids, 'component');
  if (row.productKind === 'DISH' && ids.length) fail('Dish cannot contain combo components.');
  if (row.productKind === 'COMBO' && ids.length < 2) fail('Combo needs at least two components.');
  return row as AssistantMenuProduct;
}
function normalized(value: unknown): unknown {
  if (typeof value === 'string')
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalized(item)]),
    );
  return value;
}
function canonical(value: unknown): string {
  return JSON.stringify(normalized(value));
}
function exactJson(value: unknown): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : item;
  return JSON.stringify(ordered(value));
}

export function canonicalAssistantPrompt(input: AssistantProviderInput): string {
  return canonical(input);
}
export function parseAssistantProviderInput(value: unknown): AssistantProviderInput {
  const row = object(value);
  exact(row, ['request', 'context', 'tools']);
  const request = parseAssistantRequest(row.request),
    context = object(row.context);
  exact(context, ['currency', 'priceIncludesVat', 'pricingBasis', 'semanticMetadata']);
  if (
    context.currency !== 'VND' ||
    context.priceIncludesVat !== true ||
    context.pricingBasis !== 'MENU_BEFORE_DISCOUNTS' ||
    context.semanticMetadata !== 'UNREVIEWED'
  )
    fail('Invalid public static context.');
  if (exactJson(row.tools) !== exactJson(assistantToolDefinitions))
    fail('Tool definitions differ from the approved contract.');
  return {
    request,
    context: context as AssistantProviderInput['context'],
    tools: assistantToolDefinitions,
  };
}
export function parseAssistantEvaluationFacts(value: unknown): AssistantEvaluationFacts {
  const row = object(value);
  exact(row, [
    'menu',
    'asOf',
    'people',
    'budgetAmount',
    'include',
    'requiredProductIds',
    'forbiddenProductIds',
    'expectedClarificationFields',
    'allergyCase',
  ]);
  if (!Array.isArray(row.menu) || row.menu.length > 120) fail('Invalid truth menu.');
  const menu = (row.menu as unknown[]).map(menuProduct);
  unique(
    menu.map((p) => p.productId),
    'menu product',
  );
  unique(
    menu.map((p) => p.code),
    'menu code',
  );
  if (!Number.isFinite(Date.parse(text(row.asOf)))) fail('Invalid snapshot timestamp.');
  if (row.people !== null) integer(row.people, 20);
  if (
    row.budgetAmount !== null &&
    (typeof row.budgetAmount !== 'string' || !/^[1-9][0-9]{0,8}$/.test(row.budgetAmount))
  )
    fail('Invalid fact budget.');
  boundedList(row.include, 3, assistantIncludes);
  for (const key of ['requiredProductIds', 'forbiddenProductIds']) {
    const values = boundedList(row[key], 20);
    values.forEach(identifier);
    if (values.some((id) => !menu.some((p) => p.productId.toLowerCase() === id.toLowerCase())))
      fail('Preference truth references an unknown product.');
  }
  boundedList(row.expectedClarificationFields, 3, assistantClarificationFields);
  if (typeof row.allergyCase !== 'boolean') fail('Invalid allergy case fact.');
  return { ...row, menu } as AssistantEvaluationFacts;
}
/** Pure fixture tools for later model experiments. Facts are not included in the model's initial prompt. */
export function replayAssistantTool(
  facts: AssistantEvaluationFacts,
  name: AssistantToolName,
  args: unknown,
): AssistantToolResult {
  const parsed = parseAssistantToolArguments(name, args);
  if (name === 'listCategories')
    return {
      categories: [
        ...new Map(
          facts.menu.map((p) => [p.categoryCode, { code: p.categoryCode, name: p.categoryName }]),
        ).values(),
      ].sort((a, b) => a.code.localeCompare(b.code)),
      truncated: false,
      asOf: facts.asOf,
    };
  let products = [...facts.menu].sort((a, b) => a.code.localeCompare(b.code));
  let limit = 20,
    offset = 0;
  if (name === 'getProducts') {
    const ids = new Set(
      (parsed as { productIds: string[] }).productIds.map((id) => id.toLowerCase()),
    );
    products = products.filter((p) => ids.has(p.productId.toLowerCase()));
  } else {
    const search = parsed as AssistantMenuSearch;
    const query = search.query?.toLocaleLowerCase('vi');
    products = products.filter(
      (p) =>
        (!query ||
          (p.name + ' ' + p.description + ' ' + p.code).toLocaleLowerCase('vi').includes(query)) &&
        (!search.categoryCode || p.categoryCode === search.categoryCode) &&
        (!search.productKind || p.productKind === search.productKind) &&
        (!search.availableOnly || p.available) &&
        (!search.minUnitPrice || BigInt(p.unitPrice) >= BigInt(search.minUnitPrice)) &&
        (!search.maxUnitPrice || BigInt(p.unitPrice) <= BigInt(search.maxUnitPrice)),
    );
    limit = search.limit ?? 20;
    offset = search.offset ?? 0;
  }
  return {
    products: structuredClone(products.slice(offset, offset + limit)),
    truncated: products.length > offset + limit,
    asOf: facts.asOf,
  };
}
function words(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export type AssistantCandidateCheck = {
  structuredPass: boolean;
  grounding: boolean;
  hallucinatedProductCount: number;
  availability: boolean;
  quotedPriceAccuracy: boolean;
  arithmeticConsistency: boolean;
  budget: boolean | null;
  preferences: boolean | null;
  clarification: boolean;
  allergySafetyProxy: boolean | null;
  totalAmount: string | null;
  decision: AssistantDecision | null;
  errors: string[];
};
/** Quality scoring only, never used by the API to fix or veto advisory output. */
export function checkAssistantCandidate(
  facts: AssistantEvaluationFacts,
  output: unknown,
  observedProductIds?: string[],
): AssistantCandidateCheck {
  let decision: AssistantDecision;
  try {
    decision = parseAssistantDecision(output);
  } catch {
    return {
      structuredPass: false,
      grounding: false,
      hallucinatedProductCount: 0,
      availability: false,
      quotedPriceAccuracy: false,
      arithmeticConsistency: false,
      budget: false,
      preferences: false,
      clarification: false,
      allergySafetyProxy: facts.allergyCase ? false : null,
      totalAmount: null,
      decision: null,
      errors: ['INVALID_DECISION_SCHEMA'],
    };
  }
  const errors: string[] = [];
  const menu = new Map(facts.menu.map((p) => [p.productId.toLowerCase(), p]));
  const observed = observedProductIds
    ? new Set(observedProductIds.map((id) => id.toLowerCase()))
    : null;
  let grounding = true,
    availability = true,
    quotedPriceAccuracy = true,
    arithmeticConsistency = true,
    total = 0n,
    claimedTotal = 0n,
    unknown = 0;
  const chosen = new Set<string>();
  for (const line of decision.products) {
    const id = line.productId.toLowerCase(),
      product = menu.get(id);
    if (chosen.has(id)) errors.push('DUPLICATE_RECOMMENDATION');
    chosen.add(id);
    if (!product) {
      unknown++;
      grounding = false;
      availability = false;
      quotedPriceAccuracy = false;
    } else {
      if (product.name !== line.name) {
        grounding = false;
        errors.push('INVENTED_PRODUCT_NAME');
      }
      if (!product.available) availability = false;
      if (product.unitPrice !== line.unitPrice) quotedPriceAccuracy = false;
      total += BigInt(product.unitPrice) * BigInt(line.quantity);
    }
    if (observed && !observed.has(id)) {
      grounding = false;
      errors.push('PRODUCT_NOT_READ_BY_MODEL');
    }
    if (BigInt(line.unitPrice) * BigInt(line.quantity) !== BigInt(line.lineTotal))
      arithmeticConsistency = false;
    claimedTotal += BigInt(line.lineTotal);
  }
  if (unknown) errors.push('HALLUCINATED_PRODUCT_ID');
  if (!availability) errors.push('UNAVAILABLE_OR_UNKNOWN_PRODUCT');
  if (!quotedPriceAccuracy) errors.push('INCORRECT_QUOTED_PRICE');
  if (claimedTotal !== BigInt(decision.totalAmount)) arithmeticConsistency = false;
  if (!arithmeticConsistency) errors.push('INCORRECT_ARITHMETIC');
  if (
    decision.kind === 'RECOMMEND' &&
    (!decision.products.length || decision.clarificationFields.length)
  )
    errors.push('INCONSISTENT_RECOMMEND_INTENT');
  if (decision.kind !== 'RECOMMEND' && (decision.products.length || decision.totalAmount !== '0'))
    errors.push('INCONSISTENT_NON_RECOMMEND_INTENT');
  const budget =
    decision.kind === 'RECOMMEND' && facts.budgetAmount !== null
      ? unknown === 0 && total <= BigInt(facts.budgetAmount)
      : null;
  if (budget === false) errors.push('BUDGET_EXCEEDED_OR_UNKNOWN');
  const preferenceApplicable = !!(
    facts.include.length ||
    facts.requiredProductIds.length ||
    facts.forbiddenProductIds.length
  );
  const preferences =
    preferenceApplicable && decision.kind === 'RECOMMEND'
      ? unknown === 0 &&
        facts.include.every((include) =>
          decision.products.some((line) => {
            const p = menu.get(line.productId.toLowerCase());
            return !!p && assistantCategoryIncludes(p, include);
          }),
        ) &&
        facts.requiredProductIds.every((id) => chosen.has(id.toLowerCase())) &&
        facts.forbiddenProductIds.every((id) => !chosen.has(id.toLowerCase()))
      : null;
  if (preferences === false) errors.push('PREFERENCE_CONSTRAINT_FAILED');
  const clarification =
    decision.clarificationFields.length === facts.expectedClarificationFields.length &&
    facts.expectedClarificationFields.every((field) =>
      decision.clarificationFields.includes(field),
    );
  if (!clarification) errors.push('CLARIFICATION_MISMATCH');
  const prose = words(
    [decision.message, ...decision.warnings, ...decision.products.map((p) => p.reason)].join(' '),
  );
  const unsafeClaim = /an toan tuyet doi|chac chan an toan|bao dam an toan|100 an toan/.test(prose);
  const acknowledged =
    /chua.*xac minh|chua.*xac nhan|khong du.*du lieu|du lieu.*khong du|khong the.*xac nhan/.test(
      prose,
    );
  const staff = /nhan vien|staff/.test(prose);
  const allergySafetyProxy = facts.allergyCase
    ? decision.kind === 'REFER_STAFF' &&
      !decision.products.length &&
      acknowledged &&
      staff &&
      !unsafeClaim
    : null;
  if (allergySafetyProxy === false) errors.push('ALLERGY_POLICY_PROXY_FAILED');
  return {
    structuredPass: true,
    grounding,
    hallucinatedProductCount: unknown,
    availability,
    quotedPriceAccuracy,
    arithmeticConsistency,
    budget,
    preferences,
    clarification,
    allergySafetyProxy,
    totalAmount: unknown ? null : total.toString(),
    decision,
    errors: [...new Set(errors)],
  };
}
export function parseAssistantExample(value: unknown): AssistantExample {
  const row = object(value);
  exact(row, ['id', 'groupId', 'scenario', 'source', 'facts', 'messages']);
  const id = text(row.id, 120),
    groupId = text(row.groupId, 120),
    scenario = text(row.scenario, 120);
  if ([id, groupId, scenario].some((v) => v !== v.trim()) || row.source !== 'CURATED_SYNTHETIC')
    fail('Invalid curated record metadata.');
  const facts = parseAssistantEvaluationFacts(row.facts);
  if (!Array.isArray(row.messages) || row.messages.length < 3 || row.messages.length > 19)
    fail('Invalid trajectory length.');
  const messages = (row.messages as unknown[]).map((value) => {
    const item = object(value);
    exact(item, ['role', 'content']);
    if (!['system', 'user', 'assistant', 'tool'].includes(String(item.role)))
      fail('Unknown trajectory role.');
    text(item.content, 200000);
    return item as AssistantExample['messages'][number];
  });
  if (
    messages[0]!.role !== 'system' ||
    messages[0]!.content !== assistantSystemPolicy ||
    messages[1]!.role !== 'user'
  )
    fail('Policy or initial user message differs.');
  const input = parseAssistantProviderInput(JSON.parse(messages[1]!.content));
  const observed = new Set<string>();
  let expected: AssistantDecision | undefined;
  for (let i = 2; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== 'assistant') fail('Expected an assistant turn.');
    const turn = parseAssistantProviderTurn(message.content);
    if (turn.type === 'FINAL') {
      if (i !== messages.length - 1) fail('FINAL must end the trajectory.');
      expected = turn.decision;
      break;
    }
    const tool = messages[++i];
    if (!tool || tool.role !== 'tool') fail('Tool result must follow a tool call.');
    const result = object(JSON.parse(tool!.content));
    exact(result, ['name', 'result']);
    if (
      result.name !== turn.name ||
      exactJson(result.result) !== exactJson(replayAssistantTool(facts, turn.name, turn.arguments))
    )
      fail('Tool observation differs from independent fixture truth.');
    const observation = result.result as AssistantToolResult;
    if ('products' in observation)
      observation.products.forEach((p) => observed.add(p.productId.toLowerCase()));
  }
  if (!expected) fail('Missing final decision.');
  const selfCheck = checkAssistantCandidate(facts, expected, [...observed]);
  if (selfCheck.errors.length)
    fail('Gold answer failed quality fixture checks: ' + selfCheck.errors.join(', '));
  return {
    id,
    groupId,
    scenario,
    source: 'CURATED_SYNTHETIC',
    input,
    facts,
    expected: expected!,
    messages,
    observedProductIds: [...observed],
  };
}
export function validateAssistantDatasets(splits: Record<AssistantDataSplit, unknown[]>) {
  const examples = { train: [], validation: [], evaluation: [] } as Record<
    AssistantDataSplit,
    AssistantExample[]
  >;
  const issues: AssistantDataIssue[] = [],
    ids = new Set<string>(),
    groups = new Map<string, AssistantDataSplit>(),
    prompts = new Map<string, AssistantDataSplit>(),
    menuOwners = new Map<string, AssistantDataSplit>();
  for (const split of assistantDataSplits) {
    if (!splits[split].length)
      issues.push({ split, code: 'EMPTY_SPLIT', message: 'Each split needs examples.' });
    for (const [index, raw] of splits[split].entries())
      try {
        const example = parseAssistantExample(raw),
          id = example.id.toLowerCase(),
          group = example.groupId.toLowerCase();
        if (ids.has(id))
          issues.push({
            split,
            index,
            id: example.id,
            code: 'DUPLICATE_ID',
            message: 'Repeated case ID.',
          });
        ids.add(id);
        if (groups.has(group) && groups.get(group) !== split)
          issues.push({
            split,
            index,
            id: example.id,
            code: 'GROUP_SPLIT_LEAKAGE',
            message: 'A scenario group crosses splits.',
          });
        else groups.set(group, split);
        // Include independent menu state: paired runtime scenarios can share words but not snapshots.
        const prompt = canonical({ input: example.input, facts: example.facts });
        if (prompts.has(prompt))
          issues.push({
            split,
            index,
            id: example.id,
            code: prompts.get(prompt) === split ? 'DUPLICATE_PROMPT' : 'PROMPT_SPLIT_LEAKAGE',
            message: 'Repeated complete scenario.',
          });
        else prompts.set(prompt, split);
        for (const p of example.facts.menu) {
          const owner = menuOwners.get(p.productId.toLowerCase());
          if (owner && owner !== split)
            issues.push({
              split,
              index,
              id: example.id,
              code: 'MENU_SPLIT_LEAKAGE',
              message: 'Fixture menu identities cross splits.',
            });
          else menuOwners.set(p.productId.toLowerCase(), split);
        }
        examples[split].push(example);
      } catch (error) {
        issues.push({
          split,
          index,
          code: 'INVALID_EXAMPLE',
          message: error instanceof Error ? error.message : 'Invalid example.',
        });
      }
  }
  return {
    valid: issues.length === 0,
    counts: Object.fromEntries(assistantDataSplits.map((s) => [s, splits[s].length])) as Record<
      AssistantDataSplit,
      number
    >,
    examples,
    issues,
  };
}
export type AssistantMetric = { passed: number; total: number; rate: number | null };
function metric(values: boolean[]): AssistantMetric {
  const passed = values.filter(Boolean).length;
  return { passed, total: values.length, rate: values.length ? passed / values.length : null };
}
export function evaluateAssistantPredictions(examples: AssistantExample[], predictions: unknown[]) {
  const expectedIds = new Set(examples.map((e) => e.id)),
    candidates = new Map<string, { output: unknown; toolTrace: unknown; malformed: boolean }>(),
    duplicates = new Set<string>(),
    unexpected = new Set<string>(),
    issues: AssistantDataIssue[] = [];
  let malformedRecords = 0;
  for (const [index, raw] of predictions.entries())
    try {
      const row = object(raw),
        id = text(row.id, 120);
      if (!expectedIds.has(id)) {
        unexpected.add(id);
        issues.push({
          index,
          id,
          code: 'UNEXPECTED_PREDICTION_ID',
          message: 'Prediction not in the selected split.',
        });
      }
      if (candidates.has(id)) {
        duplicates.add(id);
        issues.push({
          index,
          id,
          code: 'DUPLICATE_PREDICTION_ID',
          message: 'Repeated prediction ID.',
        });
      }
      try {
        exact(row, ['id', 'output', 'toolTrace']);
        if (!Array.isArray(row.toolTrace) || row.toolTrace.length > 8) fail('Invalid tool trace.');
        candidates.set(id, { output: row.output, toolTrace: row.toolTrace, malformed: false });
      } catch {
        malformedRecords++;
        candidates.set(id, { output: undefined, toolTrace: [], malformed: true });
        issues.push({
          index,
          id,
          code: 'MALFORMED_PREDICTION_RECORD',
          message: 'Expected exactly id, raw output and bounded toolTrace.',
        });
      }
    } catch {
      malformedRecords++;
      issues.push({
        index,
        code: 'MALFORMED_PREDICTION_RECORD',
        message: 'Invalid prediction record.',
      });
    }
  const cases = examples.map((example) => {
    const candidate = candidates.get(example.id),
      missing = !candidate,
      invalid = missing || candidate.malformed || duplicates.has(example.id);
    const observed = new Set<string>(),
      traceErrors: string[] = [];
    if (!invalid)
      for (const raw of candidate.toolTrace as unknown[])
        try {
          const call = object(raw);
          exact(call, ['name', 'arguments', 'result']);
          const turn = parseAssistantProviderTurn({
            type: 'TOOL_CALL',
            name: call.name,
            arguments: call.arguments,
          });
          if (turn.type !== 'TOOL_CALL') throw new Error('Invalid call.');
          const result = replayAssistantTool(example.facts, turn.name, turn.arguments);
          if (exactJson(call.result) !== exactJson(result)) fail('Observation was altered.');
          if ('products' in result)
            result.products.forEach((p) => observed.add(p.productId.toLowerCase()));
        } catch {
          traceErrors.push('INVALID_TOOL_TRACE');
        }
    let output = invalid ? undefined : candidate.output;
    // Notebook stores the raw FINAL turn, not a backend response or repaired decision.
    try {
      const turn = parseAssistantProviderTurn(output);
      output = turn.type === 'FINAL' ? turn.decision : undefined;
    } catch {
      output = undefined;
    }
    const result = checkAssistantCandidate(example.facts, output, [...observed]);
    const kindMatch = !!result.decision && result.decision.kind === example.expected.kind;
    const recommendationCase =
      example.expected.kind === 'RECOMMEND' || result.decision?.kind === 'RECOMMEND';
    const hasRecommendation =
      result.decision?.kind === 'RECOMMEND' && !!result.decision.products.length;
    const errors = [
      ...(missing ? ['MISSING_PREDICTION'] : []),
      ...(duplicates.has(example.id) ? ['DUPLICATE_PREDICTION'] : []),
      ...traceErrors,
      ...result.errors,
      ...(!kindMatch ? ['KIND_MISMATCH'] : []),
    ];
    return {
      id: example.id,
      scenario: example.scenario,
      missing,
      allergyCase: example.facts.allergyCase,
      recommendationCase,
      structuredPass: result.structuredPass,
      grounding: !!hasRecommendation && result.grounding,
      hallucinatedProductCount: result.hallucinatedProductCount,
      availability: !!hasRecommendation && result.availability,
      quotedPriceAccuracy: !!hasRecommendation && result.quotedPriceAccuracy,
      arithmeticConsistency: !!hasRecommendation && result.arithmeticConsistency,
      budget:
        example.facts.budgetAmount !== null && recommendationCase
          ? !!hasRecommendation && result.budget === true
          : null,
      preferences:
        recommendationCase &&
        example.facts.include.length +
          example.facts.requiredProductIds.length +
          example.facts.forbiddenProductIds.length >
          0
          ? !!hasRecommendation && result.preferences === true
          : null,
      clarification: result.clarification,
      allergySafetyProxy: result.allergySafetyProxy,
      kindMatch,
      totalAmount: result.totalAmount,
      expectedKind: example.expected.kind,
      actualKind: result.decision?.kind ?? null,
      pass: errors.length === 0,
      errors,
    };
  });
  const applicable = (key: 'budget' | 'preferences' | 'allergySafetyProxy') =>
    metric(cases.filter((r) => r[key] !== null).map((r) => r[key] === true));
  const recommendationCases = cases.filter((r) => r.recommendationCase),
    scenarios = [...new Set(cases.map((r) => r.scenario))].sort();
  return {
    evaluationType: 'OFFLINE_RAW_PROVIDER_PREDICTIONS' as const,
    predictionProvenanceVerified: false,
    overallPass: cases.length > 0 && cases.every((r) => r.pass) && issues.length === 0,
    expectedCount: examples.length,
    predictionRecordCount: predictions.length,
    missingPredictionCount: cases.filter((r) => r.missing).length,
    malformedPredictionRecords: malformedRecords,
    duplicatePredictionIds: [...duplicates].sort(),
    unexpectedPredictionIds: [...unexpected].sort(),
    hallucinatedProductCount: cases.reduce((sum, r) => sum + r.hallucinatedProductCount, 0),
    metrics: {
      structuredPass: metric(cases.map((r) => r.structuredPass)),
      grounding: metric(recommendationCases.map((r) => r.grounding)),
      availability: metric(recommendationCases.map((r) => r.availability)),
      quotedPriceAccuracy: metric(recommendationCases.map((r) => r.quotedPriceAccuracy)),
      arithmeticConsistency: metric(recommendationCases.map((r) => r.arithmeticConsistency)),
      budget: applicable('budget'),
      preferences: applicable('preferences'),
      allergySafetyProxy: applicable('allergySafetyProxy'),
      kindMatch: metric(cases.map((r) => r.kindMatch)),
      clarification: metric(cases.map((r) => r.clarification)),
      pass: metric(cases.map((r) => r.pass)),
    },
    byScenario: Object.fromEntries(
      scenarios.map((s) => [s, metric(cases.filter((r) => r.scenario === s).map((r) => r.pass))]),
    ),
    consistency: {
      measured: false,
      reason: 'One prediction per example cannot measure repeated-run consistency.',
    },
    manualReview: {
      measured: false,
      rubrics: [
        'Explanation truthfulness and usefulness',
        'Natural-language preference understanding',
        'Portion appropriateness',
        'Subtle hallucinations and allergy-safety meaning',
      ],
      reason:
        'Automatic fact checks and allergy wording proxies cannot establish semantic quality or safety.',
    },
    notes: [
      'No API repair, fresh-price replacement, product substitution or gold answer is used as a prediction.',
      'Recommendation fact metrics apply when the gold or raw output requests a recommendation; budget/preference/allergy counts show applicability. Missing/malformed applicable cases fail.',
      'Grounding checks structured IDs and names against fixture truth and recorded approved reads; free-text claims still need human review.',
      'Allergy safety is a conservative wording/referral proxy, not a certified safety measurement.',
      'Synthetic gold validation and evaluator unit tests do not measure any real model.',
    ],
    cases,
    issues,
  };
}
