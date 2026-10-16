import type { AssistantDecision, AssistantMode, AssistantProviderInput } from '@thesis/contracts';
import { assistantCategoryIncludes } from '@thesis/contracts';
export interface AssistantProvider {
  suggest(input: AssistantProviderInput, options: { signal: AbortSignal }): Promise<unknown>;
}
export type MenuAssistantConfig = {
  mode: AssistantMode;
  timeoutMs: number;
  rateLimit: number;
  windowMs: number;
  maxInFlight: number;
};
export type MenuAssistantOptions = {
  config?: MenuAssistantConfig;
  provider?: AssistantProvider;
  now?: () => number;
};
const defaults: MenuAssistantConfig = {
  mode: 'OFF',
  timeoutMs: 8000,
  rateLimit: 6,
  windowMs: 60000,
  maxInFlight: 4,
};
export function validAssistantConfig(value: MenuAssistantConfig): MenuAssistantConfig {
  return ['OFF', 'MOCK', 'CUSTOM'].includes(value.mode) &&
    [
      [value.timeoutMs, 10, 30000],
      [value.rateLimit, 1, 60],
      [value.windowMs, 1000, 3600000],
      [value.maxInFlight, 1, 20],
    ].every(([n, min, max]) => Number.isInteger(n) && n! >= min! && n! <= max!)
    ? { ...value }
    : { ...defaults };
}
/** Optional invalid assistant settings fail closed without affecting core API startup. */
export function readMenuAssistantConfig(env: NodeJS.ProcessEnv = process.env): MenuAssistantConfig {
  return validAssistantConfig({
    mode: (env.MENU_ASSISTANT_MODE ?? 'OFF') as AssistantMode,
    timeoutMs: Number(env.MENU_ASSISTANT_TIMEOUT_MS ?? defaults.timeoutMs),
    rateLimit: Number(env.MENU_ASSISTANT_RATE_LIMIT ?? defaults.rateLimit),
    windowMs: Number(env.MENU_ASSISTANT_WINDOW_MS ?? defaults.windowMs),
    maxInFlight: Number(env.MENU_ASSISTANT_MAX_IN_FLIGHT ?? defaults.maxInFlight),
  });
}
/** Explicit deterministic fixture. This is not a model or a quality evaluation. */
export const mockAssistantProvider: AssistantProvider = {
  async suggest({ request, context }) {
    const choices: AssistantDecision['products'] = [];
    let remaining = BigInt(request.budgetAmount!);
    const available = context.menu
      .filter((p) => p.available)
      .sort((a, b) =>
        BigInt(a.unitPrice) < BigInt(b.unitPrice)
          ? -1
          : BigInt(a.unitPrice) > BigInt(b.unitPrice)
            ? 1
            : a.productId.localeCompare(b.productId),
      );
    for (const include of request.preferences?.include ?? []) {
      const product = available.find(
        (p) =>
          assistantCategoryIncludes(p, include) &&
          !choices.some((c) => c.productId === p.productId) &&
          BigInt(p.unitPrice) <= remaining,
      );
      if (!product) return { kind: 'NO_MATCH', products: [], clarificationFields: [] };
      choices.push({
        productId: product.productId,
        quantity: 1,
        reasonCode: (
          {
            VEGETABLE: 'REQUESTED_VEGETABLE',
            DRINK: 'REQUESTED_DRINK',
            DESSERT: 'REQUESTED_DESSERT',
          } as const
        )[include],
      });
      remaining -= BigInt(product.unitPrice);
    }
    const ordinary = available.filter(
      (p) => !['DO-UONG', 'TRANG-MIENG', 'RAU-DAU-HU'].includes(p.categoryCode),
    );
    for (const product of [...ordinary, ...available]) {
      if (
        choices.length >=
        Math.min(6, Math.max(request.people!, (request.preferences?.include?.length ?? 0) + 1))
      )
        break;
      if (
        choices.some((c) => c.productId === product.productId) ||
        BigInt(product.unitPrice) > remaining
      )
        continue;
      choices.push({ productId: product.productId, quantity: 1, reasonCode: 'BUDGET_FIT' });
      remaining -= BigInt(product.unitPrice);
    }
    return {
      kind: choices.length ? 'RECOMMEND' : 'NO_MATCH',
      products: choices,
      clarificationFields: [],
    };
  },
};
