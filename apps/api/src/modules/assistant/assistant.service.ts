import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
import {
  assistantCategoryIncludes,
  assistantNeedsStaff,
  parseAssistantDecision,
  type AssistantCapabilities,
  type AssistantClarificationField,
  type AssistantDecision,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantReasonCode,
} from '@thesis/contracts';
import {
  readAssistantBasketStock,
  readAssistantIdentity,
  readAssistantSnapshot,
} from './assistant-context.js';
import {
  mockAssistantProvider,
  readMenuAssistantConfig,
  validAssistantConfig,
  type MenuAssistantOptions,
} from './assistant-provider.js';
const reasons: Record<AssistantReasonCode, string> = {
  BUDGET_FIT: 'Giá hiện tại nằm trong ngân sách đã nhập.',
  MENU_VARIETY: 'Một lựa chọn khác trong thực đơn hiện tại.',
  REQUESTED_VEGETABLE: 'Thuộc nhóm rau và đậu hũ bạn yêu cầu.',
  REQUESTED_DRINK: 'Thuộc nhóm đồ uống bạn yêu cầu.',
  REQUESTED_DESSERT: 'Thuộc nhóm tráng miệng bạn yêu cầu.',
};
export function createMenuAssistant(
  db: Database,
  restaurant: string,
  options: MenuAssistantOptions = {},
) {
  const config = options.config ? validAssistantConfig(options.config) : readMenuAssistantConfig();
  const provider =
    config.mode === 'MOCK'
      ? mockAssistantProvider
      : config.mode === 'CUSTOM'
        ? options.provider
        : undefined;
  const now = options.now ?? Date.now;
  const attempts = new Map<string, { count: number; until: number }>();
  const active = new Set<string>();
  let inFlight = 0;
  function reserveSlot(participantId: string, ip: string) {
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const keys = ['guest:' + participantId, 'ip:' + ip];
    if (
      active.has(participantId) ||
      inFlight >= config.maxInFlight ||
      attempts.size > 2046 ||
      keys.some((key) => (attempts.get(key)?.count ?? 0) >= config.rateLimit)
    )
      return null;
    for (const key of keys) {
      const old = attempts.get(key);
      attempts.set(key, {
        count: (old?.count ?? 0) + 1,
        until: old?.until ?? time + config.windowMs,
      });
    }
    active.add(participantId);
    inFlight++;
    let released = false;
    return () => {
      if (!released) {
        active.delete(participantId);
        inFlight--;
        released = true;
      }
    };
  }
  function response(
    status: AssistantResponse['status'],
    code: string,
    message: string,
    fields: AssistantClarificationField[] = [],
  ): AssistantResponse {
    return {
      contractVersion: 1,
      mode: config.mode,
      status,
      code,
      message,
      clarificationFields: fields,
      products: [],
      totalAmount: '0',
      currency: 'VND',
      priceIncludesVat: true,
      pricingBasis: 'MENU_BEFORE_DISCOUNTS',
      checkedAt: new Date(now()).toISOString(),
      warnings: [],
    };
  }
  const unavailable = (code = 'ASSISTANT_UNAVAILABLE') =>
    response(
      'UNAVAILABLE',
      code,
      'Trợ lý hiện chưa sẵn sàng. Bạn vẫn có thể xem và chọn món trong thực đơn.',
    );
  const capabilities: AssistantCapabilities = {
    contractVersion: 1,
    mode: config.mode,
    enabled: !!provider,
    semanticMetadata: 'UNREVIEWED',
    maxPeople: 20,
    maxProducts: 6,
    supportsAllergySafetyConfirmation: false,
  };
  return {
    unavailable,
    async capabilities(request: FastifyRequest) {
      await readAssistantIdentity(db, request, restaurant);
      return capabilities;
    },
    async recommend(request: FastifyRequest, input: AssistantRequest): Promise<AssistantResponse> {
      const participantId = await readAssistantIdentity(db, request, restaurant);
      if (!provider)
        return unavailable(config.mode === 'OFF' ? 'ASSISTANT_DISABLED' : 'PROVIDER_UNAVAILABLE');
      if (assistantNeedsStaff(input))
        return response(
          'STAFF_REQUIRED',
          'UNREVIEWED_PREFERENCES',
          'Thông tin khẩu phần, chế độ ăn, độ cay và dị ứng chưa được xác minh. Vui lòng hỏi nhân viên để chọn món phù hợp.',
        );
      const missing: AssistantClarificationField[] = [];
      if (input.people === undefined) missing.push('PEOPLE');
      if (input.budgetAmount === undefined) missing.push('BUDGET');
      if (missing.length)
        return response(
          'CLARIFICATION',
          'MISSING_DETAILS',
          'Bạn hãy nhập số người và tổng ngân sách dự kiến cho các món được gợi ý.',
          missing,
        );
      const release = reserveSlot(participantId, request.ip);
      if (!release) return unavailable('ASSISTANT_RATE_LIMITED');
      let initial;
      try {
        initial = await readAssistantSnapshot(db, request, restaurant);
      } catch (error) {
        release();
        throw error;
      }
      const controller = new AbortController();
      // Providers ignoring abort retain their slot until settled, bounding orphaned work.
      const work = Promise.resolve().then(() =>
        provider.suggest(structuredClone({ request: input, context: initial.context }), {
          signal: controller.signal,
        }),
      );
      void work.then(release, release);
      const timedOut = Symbol('timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let raw: unknown;
      try {
        raw = await Promise.race([
          work,
          new Promise<typeof timedOut>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(timedOut);
            }, config.timeoutMs);
          }),
        ]);
      } catch {
        raw = timedOut;
      } finally {
        if (timer) clearTimeout(timer);
      }
      // Authenticate again after inference before returning any menu or decisions.
      await readAssistantIdentity(db, request, restaurant);
      if (raw === timedOut) return unavailable();
      let decision: AssistantDecision;
      try {
        decision = parseAssistantDecision(raw);
      } catch {
        return unavailable('INVALID_PROVIDER_OUTPUT');
      }
      if (decision.kind === 'REFER_STAFF')
        return response(
          'STAFF_REQUIRED',
          'STAFF_REQUIRED',
          'Vui lòng hỏi nhân viên để xác nhận thông tin và chọn món phù hợp.',
        );
      if (decision.kind === 'NO_MATCH')
        return response(
          'NO_MATCH',
          'NO_MATCH',
          'Chưa tìm được đề xuất phù hợp với yêu cầu và ngân sách hiện tại.',
        );
      if (decision.kind === 'CLARIFY') {
        if (decision.clarificationFields.some((f) => f !== 'PREFERENCES'))
          return unavailable('INVALID_PROVIDER_OUTPUT');
        return response(
          'CLARIFICATION',
          'PREFERENCES_REQUIRED',
          'Bạn có thể bổ sung nhóm món muốn dùng để trợ lý tìm lựa chọn phù hợp.',
          ['PREFERENCES'],
        );
      }
      const fresh = await readAssistantSnapshot(db, request, restaurant);
      const allowed = new Set(
        initial.context.menu.filter((p) => p.available).map((p) => p.productId),
      );
      const menu = new Map(fresh.context.menu.map((p) => [p.productId, p]));
      const products: AssistantResponse['products'] = [];
      let total = 0n;
      for (const line of decision.products) {
        const id = line.productId.toLowerCase(),
          product = menu.get(id);
        if (!allowed.has(id) || !product || !product.available) return unavailable('MENU_CHANGED');
        const include = (
          {
            REQUESTED_VEGETABLE: 'VEGETABLE',
            REQUESTED_DRINK: 'DRINK',
            REQUESTED_DESSERT: 'DESSERT',
          } as const
        )[line.reasonCode as 'REQUESTED_VEGETABLE' | 'REQUESTED_DRINK' | 'REQUESTED_DESSERT'];
        if (
          include &&
          (!input.preferences?.include?.includes(include) ||
            !assistantCategoryIncludes(product, include))
        )
          return unavailable('INVALID_PROVIDER_OUTPUT');
        const amount = BigInt(product.unitPrice) * BigInt(line.quantity);
        total += amount;
        products.push({
          productId: id,
          code: product.code,
          name: product.name,
          description: product.description,
          imageUrl: fresh.images.get(id) ?? null,
          productKind: product.productKind,
          version: product.version,
          quantity: line.quantity,
          unitPrice: product.unitPrice,
          lineTotal: amount.toString(),
          reason: reasons[line.reasonCode],
        });
      }
      if (total > BigInt(input.budgetAmount!)) return unavailable('BUDGET_EXCEEDED');
      if (
        (input.preferences?.include ?? []).some(
          (include) =>
            !products.some((line) => assistantCategoryIncludes(menu.get(line.productId)!, include)),
        )
      )
        return unavailable('INVALID_PROVIDER_OUTPUT');
      if (!(await readAssistantBasketStock(db, request, restaurant, products)))
        return unavailable('STOCK_CHANGED');
      const result = response(
        'RECOMMENDATIONS',
        'RECOMMENDATIONS',
        config.mode === 'MOCK'
          ? 'Đề xuất mô phỏng từ thực đơn hiện tại để bạn tham khảo.'
          : 'Các món dưới đây là gợi ý từ thực đơn hiện tại để bạn tham khảo.',
      );
      result.products = products;
      result.totalAmount = total.toString();
      result.warnings = [
        'Giá thực đơn đã gồm VAT, chưa áp dụng giảm giá.',
        'Tên nguyên liệu trong công thức không xác nhận an toàn dị ứng; vui lòng hỏi nhân viên.',
        'Số lượng gợi ý không xác nhận đủ khẩu phần cho cả nhóm.',
        'Giá và tồn món được kiểm tra lại khi bạn thêm và gửi món; gợi ý không giữ kho.',
        ...(fresh.context.catalogTruncated ? ['Trợ lý chỉ xem một phần thực đơn hiện tại.'] : []),
      ];
      return result;
    },
  };
}
