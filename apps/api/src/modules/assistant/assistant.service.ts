import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
import {
  assistantToolDefinitions,
  assistantToolNames,
  parseAssistantDecision,
  type AssistantCapabilities,
  type AssistantDecision,
  type AssistantRequest,
  type AssistantResponse,
} from '@thesis/contracts';
import { readAssistantIdentity } from './assistant-context.js';
import { createAssistantReadTools } from './assistant-tools.js';
import {
  mockAssistantProvider,
  readMenuAssistantConfig,
  validAssistantConfig,
  type MenuAssistantOptions,
} from './assistant-provider.js';
const maxProviderBytes = 32768;
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
    decision: AssistantDecision | null = null,
  ): AssistantResponse {
    return {
      contractVersion: 2,
      mode: config.mode,
      status,
      code,
      message,
      advisoryOnly: true,
      decision,
      checkedAt: new Date(now()).toISOString(),
    };
  }
  const unavailable = (code = 'ASSISTANT_UNAVAILABLE') =>
    response(
      'UNAVAILABLE',
      code,
      'Trợ lý hiện chưa sẵn sàng. Bạn vẫn có thể xem và chọn món trong thực đơn.',
    );
  const capabilities: AssistantCapabilities = {
    contractVersion: 2,
    mode: config.mode,
    enabled: !!provider,
    advisoryOnly: true,
    semanticMetadata: 'UNREVIEWED',
    maxPeople: 20,
    maxProducts: 6,
    supportsAllergySafetyConfirmation: false,
    readTools: assistantToolNames,
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
      const release = reserveSlot(participantId, request.ip);
      if (!release) return unavailable('ASSISTANT_RATE_LIMITED');
      const controller = new AbortController();
      const runtime = createAssistantReadTools(db, request, restaurant, {
        signal: controller.signal,
        timeoutMs: config.timeoutMs,
      });
      const work = Promise.resolve()
        .then(() =>
          provider.suggest(
            structuredClone({
              request: input,
              context: {
                currency: 'VND',
                priceIncludesVat: true,
                pricingBasis: 'MENU_BEFORE_DISCOUNTS',
                semanticMetadata: 'UNREVIEWED',
              },
              tools: assistantToolDefinitions,
            }),
            { signal: controller.signal, tools: runtime.tools },
          ),
        )
        .finally(() => runtime.close());
      // A provider ignoring abort retains its admission slot until it settles.
      // Its data tools are revoked immediately at the deadline below.
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
              runtime.close();
              resolve(timedOut);
            }, config.timeoutMs);
          }),
        ]);
      } catch {
        raw = timedOut;
      } finally {
        if (timer) clearTimeout(timer);
        runtime.close();
      }
      // Authentication is a security boundary, independent of recommendation quality.
      await readAssistantIdentity(db, request, restaurant);
      if (raw === timedOut) return unavailable();
      let decision: AssistantDecision;
      try {
        // Serialize once to detach provider-owned objects and bound transport output.
        // Parsing validates structure only; advisory claims are never corrected here.
        const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > maxProviderBytes)
          return unavailable('INVALID_PROVIDER_OUTPUT');
        decision = parseAssistantDecision(encoded);
      } catch {
        return unavailable('INVALID_PROVIDER_OUTPUT');
      }
      return response(
        'AVAILABLE',
        'ADVISORY_RESULT',
        'Đã nhận kết quả tư vấn tham khảo.',
        decision,
      );
    },
  };
}
