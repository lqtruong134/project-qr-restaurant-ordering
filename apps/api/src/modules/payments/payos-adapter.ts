import {
  PayOS,
  APIError,
  type CreatePaymentLinkRequest,
  type CreatePaymentLinkResponse,
  type PaymentLink,
  type Webhook,
  type WebhookData,
} from '@payos/node';
import { timingSafeEqual } from 'node:crypto';
import type { PaymentCapabilities } from '@thesis/contracts';

export type PayosConfig = {
  enabled: boolean;
  clientId?: string;
  apiKey?: string;
  checksumKey?: string;
  returnUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
};
export interface PayosProvider {
  create(body: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResponse>;
  get(code: number): Promise<PaymentLink>;
  cancel(code: number, reason: string): Promise<PaymentLink>;
  verify(body: unknown): Promise<WebhookData>;
  isNotFound(error: unknown): boolean;
}
export type PayosOptions = { config?: PayosConfig; provider?: PayosProvider };
export function readPayosConfig(env: NodeJS.ProcessEnv = process.env): PayosConfig {
  const enabled = env.PAYOS_ENABLED === 'true';
  const result = {
    enabled,
    clientId: env.PAYOS_CLIENT_ID,
    apiKey: env.PAYOS_API_KEY,
    checksumKey: env.PAYOS_CHECKSUM_KEY,
    returnUrl: env.PAYOS_RETURN_URL,
    cancelUrl: env.PAYOS_CANCEL_URL,
    webhookUrl: env.PAYOS_WEBHOOK_URL,
  };
  if (!enabled) return result;
  for (const key of ['returnUrl', 'cancelUrl'] as const) {
    try {
      const url = new URL(result[key] ?? '');
      if (
        url.username ||
        url.password ||
        !['http:', 'https:'].includes(url.protocol) ||
        (env.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        throw Error();
    } catch {
      throw Error(
        'Configure valid PAYOS_RETURN_URL and PAYOS_CANCEL_URL; production requires HTTPS.',
      );
    }
  }
  if (result.webhookUrl) {
    const url = new URL(result.webhookUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw Error('PAYOS_WEBHOOK_URL must use public HTTPS.');
  }
  return result;
}
export function payosCapabilities(config = readPayosConfig()): PaymentCapabilities {
  const online =
    config.enabled &&
    !!config.clientId &&
    !!config.apiKey &&
    !!config.checksumKey &&
    !!config.returnUrl &&
    !!config.cancelUrl;
  return online
    ? { online: true }
    : {
        online: false,
        reason:
          'Thanh toán online chưa được cấu hình. Vui lòng chọn tiền mặt hoặc chuyển khoản tại bàn.',
      };
}
export function officialPayosProvider(
  config: PayosConfig,
  fetcher: typeof fetch = fetch,
): PayosProvider {
  const strictFetch: typeof fetch = async (input, init) => {
    const response = await fetcher(input, init);
    if (response.ok) {
      const envelope = (await response.clone().json()) as {
        code?: unknown;
        data?: unknown;
        signature?: unknown;
      };
      if (envelope.code === '00' && envelope.data) {
        if (typeof envelope.signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(envelope.signature))
          throw Error('PAYOS_INVALID_RESPONSE');
        const expected = await client.crypto.createSignatureFromObj(
          envelope.data,
          config.checksumKey!,
        );
        if (
          !expected ||
          !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(envelope.signature, 'hex'))
        )
          throw Error('PAYOS_INVALID_RESPONSE');
      }
    }
    return response;
  };
  const client = new PayOS({
    clientId: config.clientId,
    apiKey: config.apiKey,
    checksumKey: config.checksumKey,
    logLevel: 'off',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    timeout: 8000,
    maxRetries: 0,
    fetch: strictFetch,
  });
  return {
    create: (body) => client.paymentRequests.create(body),
    get: (code) => client.paymentRequests.get(code),
    cancel: (code, reason) => client.paymentRequests.cancel(code, reason),
    verify: (body) => client.webhooks.verify(body as Webhook),
    isNotFound: (error) => error instanceof APIError && error.code === '101',
  };
}

export type {
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLink,
  WebhookData,
} from '@payos/node';

export async function registerPayosWebhook(config: PayosConfig) {
  if (!config.webhookUrl || new URL(config.webhookUrl).protocol !== 'https:')
    throw Error('PAYOS_WEBHOOK_URL must use public HTTPS.');
  const client = new PayOS({
    clientId: config.clientId,
    apiKey: config.apiKey,
    checksumKey: config.checksumKey,
    logLevel: 'off',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    timeout: 8000,
    maxRetries: 0,
  });
  const result = await client.webhooks.confirm(config.webhookUrl);
  return { webhookUrl: result.webhookUrl };
}
