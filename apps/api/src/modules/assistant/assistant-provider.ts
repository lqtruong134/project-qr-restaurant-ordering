import type {
  AssistantDecision,
  AssistantMode,
  AssistantProviderInput,
  AssistantTools,
} from '@thesis/contracts';
import { assistantCategoryIncludes } from '@thesis/contracts';
export interface AssistantProvider {
  suggest(
    input: AssistantProviderInput,
    options: { signal: AbortSignal; tools: AssistantTools },
  ): Promise<unknown>;
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
/** Explicit fixture of the AI domain, including its own dialogue and tool use.
 * This is not a language model or evidence of recommendation quality.
 */
export const mockAssistantProvider: AssistantProvider = {
  async suggest({ request }, { tools }) {
    const empty = (kind: AssistantDecision['kind'], message: string): AssistantDecision => ({
      kind,
      message,
      products: [],
      totalAmount: '0',
      clarificationFields: [],
      warnings: [],
    });
    const normalized = request.message
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, ' ');
    const preferences = request.preferences;
    if (
      /\b(di ung|allerg\w*|chay|vegetarian|vegan|khong cay|tranh|avoid|without)\b/.test(
        normalized,
      ) ||
      preferences?.allergies?.length ||
      preferences?.avoidIngredients?.length ||
      preferences?.diet ||
      preferences?.spice ||
      preferences?.proteins?.length ||
      preferences?.mealStyle
    )
      return empty(
        'REFER_STAFF',
        'Thông tin chế độ ăn và dị ứng chưa được xác minh đầy đủ. Vui lòng hỏi nhân viên; tên nguyên liệu không xác nhận món an toàn dị ứng.',
      );
    const missing: AssistantDecision['clarificationFields'] = [];
    if (request.people === undefined) missing.push('PEOPLE');
    if (request.budgetAmount === undefined) missing.push('BUDGET');
    if (missing.length)
      return {
        ...empty(
          'CLARIFY',
          'Bạn dự kiến dùng cho bao nhiêu người và tổng ngân sách khoảng bao nhiêu?',
        ),
        clarificationFields: missing,
      };
    const result = await tools.call('searchMenu', {
      availableOnly: true,
      maxUnitPrice: request.budgetAmount,
      limit: 30,
    });
    if (!('products' in result)) throw new Error('Unexpected read tool result');
    const choices: AssistantDecision['products'] = [];
    let remaining = BigInt(request.budgetAmount!);
    const available = result.products
      .filter((p) => p.available)
      .sort((a, b) =>
        BigInt(a.unitPrice) < BigInt(b.unitPrice)
          ? -1
          : BigInt(a.unitPrice) > BigInt(b.unitPrice)
            ? 1
            : a.productId.localeCompare(b.productId),
      );
    const add = (product: (typeof available)[number], reason: string) => {
      choices.push({
        productId: product.productId,
        name: product.name,
        quantity: 1,
        unitPrice: product.unitPrice,
        lineTotal: product.unitPrice,
        reason,
      });
      remaining -= BigInt(product.unitPrice);
    };
    for (const include of preferences?.include ?? []) {
      const product = available.find(
        (p) =>
          assistantCategoryIncludes(p, include) &&
          !choices.some((c) => c.productId === p.productId) &&
          BigInt(p.unitPrice) <= remaining,
      );
      if (!product) return empty('NO_MATCH', 'Chưa tìm được lựa chọn trong dữ liệu vừa đọc.');
      add(product, 'Một món thuộc nhóm bạn yêu cầu.');
    }
    const ordinary = available.filter(
      (p) => !['DO-UONG', 'TRANG-MIENG', 'RAU-DAU-HU'].includes(p.categoryCode),
    );
    for (const product of [...ordinary, ...available]) {
      if (
        choices.length >=
        Math.min(6, Math.max(request.people!, (preferences?.include?.length ?? 0) + 1))
      )
        break;
      if (
        choices.some((c) => c.productId === product.productId) ||
        BigInt(product.unitPrice) > remaining
      )
        continue;
      add(product, 'Lựa chọn tham khảo theo ngân sách và giá vừa đọc.');
    }
    if (!choices.length) return empty('NO_MATCH', 'Chưa tìm được lựa chọn trong dữ liệu vừa đọc.');
    return {
      kind: 'RECOMMEND',
      message: 'Đề xuất của provider mô phỏng, chưa phải kết quả từ mô hình AI.',
      products: choices,
      totalAmount: (BigInt(request.budgetAmount!) - remaining).toString(),
      clarificationFields: [],
      warnings: [
        'Giá thực đơn đã gồm VAT, chưa áp dụng giảm giá; gợi ý không giữ kho.',
        'Thông tin công thức chưa xác nhận an toàn dị ứng; vui lòng hỏi nhân viên.',
        'Số lượng gợi ý chưa xác nhận đủ khẩu phần cho cả nhóm.',
        ...(result.truncated ? ['Provider mô phỏng chỉ đọc một trang thực đơn.'] : []),
      ],
    } satisfies AssistantDecision;
  },
};
