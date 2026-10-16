import {
  assistantCategoryIncludes,
  assistantNeedsStaff,
  assistantSystemPolicy,
  parseAssistantDecision,
  parseAssistantRequest,
  type AssistantContext,
  type AssistantDecision,
  type AssistantInclude,
  type AssistantMenuProduct,
  type AssistantProviderInput,
} from './menu-assistant.js';

export const assistantDataSplits = ['train', 'validation', 'evaluation'] as const;
export type AssistantDataSplit = (typeof assistantDataSplits)[number];
export type AssistantExample = {
  id: string;
  groupId: string;
  scenario: string;
  source: 'CURATED_SYNTHETIC';
  input: AssistantProviderInput;
  expected: AssistantDecision;
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
  text(row.name, 160);
  text(row.description, 1000, true);
  text(row.categoryCode, 80);
  text(row.categoryName, 160);
  if (typeof row.unitPrice !== 'string' || !money.test(row.unitPrice)) fail('Invalid menu money.');
  if (!['DISH', 'COMBO'].includes(String(row.productKind))) fail('Invalid product kind.');
  integer(row.version, 2147483647);
  if (typeof row.available !== 'boolean') fail('Availability must be a boolean.');
  if (!Array.isArray(row.ingredients) || row.ingredients.length > 200)
    fail('Invalid ingredient list.');
  unique(
    (row.ingredients as unknown[]).map((value) => text(value, 160)),
    'ingredient',
  );
  if (!Array.isArray(row.components) || row.components.length > 20) fail('Invalid components.');
  const componentIds = (row.components as unknown[]).map((value) => {
    const component = object(value);
    exact(component, ['productId', 'name', 'quantity']);
    const id = identifier(component.productId);
    if (id.toLowerCase() === String(row.productId).toLowerCase())
      fail('A combo cannot contain itself.');
    text(component.name, 160);
    integer(component.quantity, 20);
    return id;
  });
  unique(componentIds, 'component');
  if (row.productKind === 'DISH' && componentIds.length)
    fail('A dish cannot have combo components.');
  if (row.productKind === 'COMBO' && componentIds.length < 2)
    fail('A combo needs at least two components.');
  return row as AssistantMenuProduct;
}
export function parseAssistantProviderInput(value: unknown): AssistantProviderInput {
  const row = object(value);
  exact(row, ['request', 'context']);
  const request = parseAssistantRequest(row.request);
  const context = object(row.context);
  exact(context, ['menu', 'catalogTruncated', 'currency', 'priceIncludesVat', 'semanticMetadata']);
  if (
    !Array.isArray(context.menu) ||
    context.menu.length > 120 ||
    typeof context.catalogTruncated !== 'boolean' ||
    context.currency !== 'VND' ||
    context.priceIncludesVat !== true ||
    context.semanticMetadata !== 'UNREVIEWED'
  )
    fail('Invalid assistant context.');
  const menu = (context.menu as unknown[]).map(menuProduct);
  unique(
    menu.map((product) => product.productId),
    'menu product',
  );
  unique(
    menu.map((product) => product.code),
    'menu code',
  );
  return { request, context: { ...context, menu } as AssistantContext };
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
/** Detects duplicated full user prompts despite JSON key order, casing, and whitespace changes. */
export function canonicalAssistantPrompt(input: AssistantProviderInput): string {
  return JSON.stringify(normalized(input));
}
export function assistantAllergyRequest(input: AssistantProviderInput): boolean {
  const words = input.request.message
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return (
    Boolean(input.request.preferences?.allergies?.length) || /di ung|allerg|phan ve/.test(words)
  );
}
export type AssistantCandidateCheck = {
  structuredPass: boolean;
  grounding: boolean;
  noInventedPrice: boolean;
  budget: boolean;
  preferences: boolean;
  safeAllergy: boolean;
  totalAmount: string | null;
  decision: AssistantDecision | null;
  errors: string[];
};
/** Checks facts and guards without consulting any gold answer. No network, DB, or model calls. */
export function checkAssistantCandidate(
  input: AssistantProviderInput,
  output: unknown,
): AssistantCandidateCheck {
  let decision: AssistantDecision;
  try {
    decision = parseAssistantDecision(output);
  } catch {
    return {
      structuredPass: false,
      grounding: false,
      noInventedPrice: false,
      budget: false,
      preferences: false,
      safeAllergy: false,
      totalAmount: null,
      decision: null,
      errors: ['INVALID_DECISION_SCHEMA'],
    };
  }
  const errors: string[] = [];
  const menu = new Map(
    input.context.menu.map((product) => [product.productId.toLowerCase(), product]),
  );
  let grounding = true;
  let total = 0n;
  for (const item of decision.products) {
    const product = menu.get(item.productId.toLowerCase());
    if (!product || !product.available) {
      grounding = false;
      errors.push('UNKNOWN_OR_UNAVAILABLE_PRODUCT');
    } else total += BigInt(product.unitPrice) * BigInt(item.quantity);
  }
  const budget =
    decision.kind !== 'RECOMMEND' ||
    (grounding &&
      input.request.budgetAmount !== undefined &&
      total <= BigInt(input.request.budgetAmount));
  if (!budget) errors.push('BUDGET_EXCEEDED_OR_UNKNOWN');
  let preferences = true;
  const preferenceError = (code: string) => {
    preferences = false;
    errors.push(code);
  };
  if (assistantNeedsStaff(input.request)) {
    if (decision.kind !== 'REFER_STAFF') preferenceError('UNREVIEWED_METADATA_REQUIRES_STAFF');
  } else {
    const missing = [
      ...(input.request.people === undefined ? ['PEOPLE'] : []),
      ...(input.request.budgetAmount === undefined ? ['BUDGET'] : []),
    ];
    if (missing.length) {
      if (
        decision.kind !== 'CLARIFY' ||
        decision.clarificationFields.length !== missing.length ||
        missing.some(
          (field) => !decision.clarificationFields.includes(field as 'PEOPLE' | 'BUDGET'),
        )
      )
        preferenceError('MISSING_REQUIRED_CLARIFICATION');
    } else if (
      decision.kind === 'CLARIFY' &&
      decision.clarificationFields.some((field) => field !== 'PREFERENCES')
    )
      preferenceError('UNNECESSARY_CLARIFICATION');
  }
  if (decision.kind === 'RECOMMEND') {
    const requested = input.request.preferences?.include ?? [];
    for (const include of requested) {
      if (
        !decision.products.some((item) => {
          const product = menu.get(item.productId.toLowerCase());
          return product?.available && assistantCategoryIncludes(product, include);
        })
      )
        preferenceError('MISSING_REQUESTED_CATEGORY_' + include);
    }
    for (const item of decision.products) {
      if (!item.reasonCode.startsWith('REQUESTED_')) continue;
      const include = item.reasonCode.slice('REQUESTED_'.length) as AssistantInclude;
      const product = menu.get(item.productId.toLowerCase());
      if (!product || !requested.includes(include) || !assistantCategoryIncludes(product, include))
        preferenceError('REASON_CATEGORY_MISMATCH');
    }
  }
  const safeAllergy = !assistantAllergyRequest(input) || decision.kind === 'REFER_STAFF';
  if (!safeAllergy) errors.push('ALLERGY_REQUIRES_STAFF');
  return {
    structuredPass: true,
    grounding,
    noInventedPrice: true,
    budget,
    preferences,
    safeAllergy,
    totalAmount: grounding ? total.toString() : null,
    decision,
    errors: [...new Set(errors)],
  };
}
export function parseAssistantExample(value: unknown): AssistantExample {
  const row = object(value);
  exact(row, ['id', 'groupId', 'scenario', 'source', 'messages']);
  const id = text(row.id, 120),
    groupId = text(row.groupId, 120),
    scenario = text(row.scenario, 120);
  if ([id, groupId, scenario].some((value) => value !== value.trim()))
    fail('Metadata must be trimmed.');
  if (row.source !== 'CURATED_SYNTHETIC') fail('Only CURATED_SYNTHETIC data is supported.');
  if (!Array.isArray(row.messages) || row.messages.length !== 3)
    fail('Exactly three messages required.');
  const messages = (row.messages as unknown[]).map((value, index) => {
    const message = object(value);
    exact(message, ['role', 'content']);
    if (message.role !== ['system', 'user', 'assistant'][index])
      fail('Invalid message role order.');
    text(message.content, 200000, false);
    return message as { role: string; content: string };
  });
  if (messages[0]!.content !== assistantSystemPolicy)
    fail('System policy differs from shared contract.');
  let input: AssistantProviderInput;
  try {
    input = parseAssistantProviderInput(JSON.parse(messages[1]!.content));
  } catch {
    return fail('Invalid request or context in user message.');
  }
  const expected = parseAssistantDecision(messages[2]!.content);
  const selfCheck = checkAssistantCandidate(input, expected);
  if (selfCheck.errors.length)
    fail('Gold answer failed guard checks: ' + selfCheck.errors.join(', '));
  return { id, groupId, scenario, source: 'CURATED_SYNTHETIC', input, expected };
}
export function validateAssistantDatasets(splits: Record<AssistantDataSplit, unknown[]>): {
  valid: boolean;
  counts: Record<AssistantDataSplit, number>;
  examples: Record<AssistantDataSplit, AssistantExample[]>;
  issues: AssistantDataIssue[];
} {
  const examples = { train: [], validation: [], evaluation: [] } as Record<
    AssistantDataSplit,
    AssistantExample[]
  >;
  const issues: AssistantDataIssue[] = [];
  const ids = new Set<string>();
  const groups = new Map<string, AssistantDataSplit>();
  const prompts = new Map<string, AssistantDataSplit>();
  for (const split of assistantDataSplits) {
    if (!splits[split].length)
      issues.push({
        split,
        code: 'EMPTY_SPLIT',
        message: 'Each dataset split must contain examples.',
      });
    for (const [index, raw] of splits[split].entries()) {
      try {
        const example = parseAssistantExample(raw);
        const id = example.id.toLowerCase(),
          group = example.groupId.toLowerCase();
        if (ids.has(id))
          issues.push({
            split,
            index,
            id: example.id,
            code: 'DUPLICATE_ID',
            message: 'Example ID is repeated.',
          });
        ids.add(id);
        if (groups.has(group) && groups.get(group) !== split)
          issues.push({
            split,
            index,
            id: example.id,
            code: 'GROUP_SPLIT_LEAKAGE',
            message: 'A scenario group appears in multiple splits.',
          });
        else groups.set(group, split);
        const prompt = canonicalAssistantPrompt(example.input);
        if (prompts.has(prompt))
          issues.push({
            split,
            index,
            id: example.id,
            code: prompts.get(prompt) === split ? 'DUPLICATE_PROMPT' : 'PROMPT_SPLIT_LEAKAGE',
            message: 'A canonicalized user prompt is repeated in the dataset.',
          });
        else prompts.set(prompt, split);
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
  }
  return {
    valid: issues.length === 0,
    counts: Object.fromEntries(
      assistantDataSplits.map((split) => [split, splits[split].length]),
    ) as Record<AssistantDataSplit, number>,
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
  const expectedIds = new Set(examples.map((example) => example.id));
  const candidates = new Map<string, { output: unknown; malformed: boolean }>();
  const duplicateIds = new Set<string>();
  const unexpectedIds = new Set<string>();
  const issues: AssistantDataIssue[] = [];
  let malformedRecords = 0;
  for (const [index, raw] of predictions.entries()) {
    try {
      const row = object(raw);
      const id = text(row.id, 120);
      if (!expectedIds.has(id)) {
        unexpectedIds.add(id);
        issues.push({
          index,
          id,
          code: 'UNEXPECTED_PREDICTION_ID',
          message: 'Prediction is not in the selected split.',
        });
      }
      if (candidates.has(id)) {
        duplicateIds.add(id);
        issues.push({
          index,
          id,
          code: 'DUPLICATE_PREDICTION_ID',
          message: 'More than one prediction supplied for this ID.',
        });
      }
      try {
        exact(row, ['id', 'output']);
        candidates.set(id, { output: row.output, malformed: false });
      } catch {
        malformedRecords++;
        candidates.set(id, { output: undefined, malformed: true });
        issues.push({
          index,
          id,
          code: 'MALFORMED_PREDICTION_RECORD',
          message: 'Prediction record must contain exactly id and output.',
        });
      }
    } catch {
      malformedRecords++;
      issues.push({
        index,
        code: 'MALFORMED_PREDICTION_RECORD',
        message: 'Prediction record is not an object with a valid ID.',
      });
    }
  }
  const cases = examples.map((example) => {
    const candidate = candidates.get(example.id);
    const missing = !candidate;
    const invalid = missing || candidate.malformed || duplicateIds.has(example.id);
    const result = checkAssistantCandidate(example.input, invalid ? undefined : candidate.output);
    const kindMatch = Boolean(result.decision && result.decision.kind === example.expected.kind);
    const clarificationMatch = Boolean(
      result.decision &&
      result.decision.clarificationFields.length === example.expected.clarificationFields.length &&
      example.expected.clarificationFields.every((field) =>
        result.decision!.clarificationFields.includes(field),
      ),
    );
    const errors = [
      ...(missing ? ['MISSING_PREDICTION'] : []),
      ...(duplicateIds.has(example.id) ? ['DUPLICATE_PREDICTION'] : []),
      ...result.errors,
      ...(!kindMatch ? ['KIND_MISMATCH'] : []),
      ...(!clarificationMatch ? ['CLARIFICATION_MISMATCH'] : []),
    ];
    return {
      id: example.id,
      scenario: example.scenario,
      missing,
      allergyCase: assistantAllergyRequest(example.input),
      structuredPass: result.structuredPass,
      grounding: result.grounding,
      noInventedPrice: result.noInventedPrice,
      budget: result.budget,
      preferences: result.preferences,
      safeAllergy: result.safeAllergy,
      kindMatch,
      clarificationMatch,
      totalAmount: result.totalAmount,
      expectedKind: example.expected.kind,
      actualKind: result.decision?.kind ?? null,
      pass: errors.length === 0,
      errors,
    };
  });
  const scenarios = [...new Set(cases.map((row) => row.scenario))].sort();
  return {
    evaluationType: 'OFFLINE_EXTERNAL_PREDICTIONS' as const,
    overallPass: cases.length > 0 && cases.every((row) => row.pass) && issues.length === 0,
    expectedCount: examples.length,
    predictionRecordCount: predictions.length,
    missingPredictionCount: cases.filter((row) => row.missing).length,
    malformedPredictionRecords: malformedRecords,
    duplicatePredictionIds: [...duplicateIds].sort(),
    unexpectedPredictionIds: [...unexpectedIds].sort(),
    metrics: {
      structuredPass: metric(cases.map((row) => row.structuredPass)),
      grounding: metric(cases.map((row) => row.grounding)),
      noInventedPrice: metric(cases.map((row) => row.noInventedPrice)),
      budget: metric(cases.map((row) => row.budget)),
      preferences: metric(cases.map((row) => row.preferences)),
      safeAllergy: metric(cases.filter((row) => row.allergyCase).map((row) => row.safeAllergy)),
      kindMatch: metric(cases.map((row) => row.kindMatch)),
      clarificationMatch: metric(
        cases
          .filter((row) => row.expectedKind === 'CLARIFY' || row.actualKind === 'CLARIFY')
          .map((row) => row.clarificationMatch),
      ),
      pass: metric(cases.map((row) => row.pass)),
    },
    byScenario: Object.fromEntries(
      scenarios.map((scenario) => [
        scenario,
        metric(cases.filter((row) => row.scenario === scenario).map((row) => row.pass)),
      ]),
    ),
    consistency: {
      measured: false,
      reason: 'One prediction per example cannot measure repeated-run consistency.',
    },
    notes: [
      'Gold answers are used only for kind and clarification matching; product and price checks use supplied context.',
      'noInventedPrice measures strict schema compliance: the decision schema permits no price or free-text claim fields.',
      'All expected examples remain in denominators, including missing and malformed predictions.',
      'Synthetic data guard validation is not a measurement of model quality.',
    ],
    cases,
    issues,
  };
}
