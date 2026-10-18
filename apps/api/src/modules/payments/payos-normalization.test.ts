import { createHmac } from 'node:crypto';
import type { Database } from '@thesis/database';
import { connectorSignature, ingestConnector } from './webhooks.routes.js';
import { describe, expect, it, vi } from 'vitest';
import { officialPayosProvider, type PayosConfig, type PaymentLink } from './payos-adapter.js';
import {
  normalizePayosLink,
  payosErrorCategory,
  recipientMatches,
  sameRecipient,
} from './payos-normalization.js';

const config: PayosConfig = {
  enabled: true,
  clientId: 'synthetic-unit-client',
  apiKey: 'synthetic-unit-key',
  checksumKey: 'synthetic-unit-checksum-no-merchant-access',
};
function signature(data: Record<string, unknown>) {
  return createHmac('sha256', config.checksumKey!)
    .update(
      Object.keys(data)
        .sort()
        .filter((key) => data[key] !== undefined)
        .map((key) => {
          let value = data[key];
          if (Array.isArray(value))
            value = JSON.stringify(
              value.map((item) =>
                Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))),
              ),
            );
          return (
            key +
            '=' +
            ([null, undefined, 'null', 'undefined'].includes(value as never) ? '' : String(value))
          );
        })
        .join('&'),
    )
    .digest('hex');
}
function link(transactions: unknown, amountPaid = 0) {
  return {
    id: 'synthetic-link',
    orderCode: 12345678,
    amount: 5000,
    amountPaid,
    amountRemaining: Math.max(5000 - amountPaid, 0),
    status: 'PENDING',
    createdAt: '2026-10-17T01:00:00Z',
    transactions,
    cancellationReason: null,
    canceledAt: null,
  } as PaymentLink;
}

describe('payOS verified response normalization', () => {
  it('verifies the original signed empty-object transaction list before normalizing it', async () => {
    const data = link({});
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            code: '00',
            desc: 'success',
            data,
            signature: signature(data as unknown as Record<string, unknown>),
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = officialPayosProvider(config, fetcher);
    const result = await provider.get(data.orderCode);
    expect(result.transactions).toEqual([]);
    expect(data.transactions).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not normalize a response before checking its integrity', async () => {
    const data = link({});
    const provider = officialPayosProvider(
      config,
      async () =>
        new Response(
          JSON.stringify({
            code: '00',
            data: { ...data, transactions: [] },
            signature: signature(data as unknown as Record<string, unknown>),
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(provider.get(data.orderCode)).rejects.toThrow();
  });
  it.each([null, { unexpected: true }, { 0: { amount: 5000 } }])(
    'does not invent transactions from an unsupported list (%j)',
    (transactions) => {
      const data = link(transactions);
      expect(normalizePayosLink(data)).toBe(data);
    },
  );
  it('never drops a missing transaction list for a positive bank amount', () => {
    const data = link({}, 5000);
    expect(normalizePayosLink(data)).toBe(data);
  });
  it('leaves valid transaction arrays and bank amounts unchanged', () => {
    const data = link([{ reference: 'unit-bank', amount: 5000 }], 5000);
    expect(normalizePayosLink(data)).toBe(data);
    expect(normalizePayosLink(data).amountPaid).toBe(5000);
  });
});

describe('payOS recipient identity', () => {
  it('matches the exact virtual account when provider primary-account representations differ', () => {
    expect(
      sameRecipient(
        { accountNumber: 'merchant-primary', virtualAccountNumber: '000123' },
        { accountNumber: '000123', virtualAccountNumber: null },
      ),
    ).toBe(true);
    expect(
      recipientMatches('000123', {
        accountNumber: 'merchant-primary',
        virtualAccountNumber: '000123',
      }),
    ).toBe(true);
  });
  it('does not match unrelated accounts, prefixes or numeric equivalents', () => {
    expect(sameRecipient({ accountNumber: '000123' }, { accountNumber: '123' })).toBe(false);
    expect(recipientMatches('000123', { accountNumber: '0001234' })).toBe(false);
    expect(recipientMatches('000123', { accountNumber: 123 })).toBe(false);
  });
  it.each([null, undefined, '', ' ', 'null', 'undefined'])(
    'ignores absent recipient values (%j)',
    (value) => {
      expect(sameRecipient({ accountNumber: value }, { accountNumber: value })).toBe(false);
    },
  );
  it('preserves signed webhook fields and only normalizes identity comparisons after SDK verification', async () => {
    const data = {
      orderCode: 12345678,
      amount: 5000,
      description: 'Synthetic payment',
      accountNumber: 'null',
      virtualAccountNumber: '000123',
      reference: 'unit-signed-reference',
      transactionDateTime: '2026-10-17 08:00:00',
      currency: 'VND',
      paymentLinkId: 'synthetic-link',
      code: '00',
      desc: 'success',
    };
    const provider = officialPayosProvider(config, async () => {
      throw Error('Network forbidden');
    });
    const signed = { code: '00', success: true, data, signature: signature(data) };
    const verified = await provider.verify(signed);
    expect(verified.accountNumber).toBe('null');
    expect(sameRecipient(verified, { accountNumber: '000123' })).toBe(true);
    await expect(
      provider.verify({ ...signed, data: { ...data, virtualAccountNumber: '999999' } }),
    ).rejects.toThrow();
  });
});

describe('payOS safe error categories', () => {
  it('allows only technical categories instead of provider error text or payloads', () => {
    const privateError = Object.assign(new Error('private-provider-token-must-not-appear'), {
      raw: 'private-bank-payload',
    });
    expect(payosErrorCategory(privateError)).toBe('UNAVAILABLE');
    expect(payosErrorCategory({ status: 429, message: 'private' })).toBe('RATE_LIMITED');
    expect(payosErrorCategory({ status: 401, message: 'private' })).toBe('PROVIDER_AUTH');
    expect(
      payosErrorCategory(
        Object.assign(new Error('private'), { name: 'APIConnectionTimeoutError' }),
      ),
    ).toBe('TIMEOUT');
    expect(payosErrorCategory(new Error('PAYOS_INVALID_RESPONSE'))).toBe('INVALID_RESPONSE');
  });
});

describe('payOS confirmation boundary', () => {
  it.each(['PAYOS', 'payos', ' PAYOS '])(
    'never accepts the generic connector as %s',
    async (provider) => {
      const query = vi.fn();
      const db = { pool: { query } } as unknown as Database;
      const event = {
        eventId: 'synthetic-event',
        transactionId: 'synthetic-bank-reference',
        intentId: 'b15ef2ad-38c2-4a42-bd05-b91896b8a513',
        amount: '5000',
        currency: 'VND' as const,
        timestamp: Date.now(),
      };
      const secret = 'synthetic-connector-secret-with-no-merchant-access';
      await expect(
        ingestConnector(
          db,
          'synthetic-restaurant',
          provider,
          secret,
          event,
          connectorSignature(event, secret),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(query).not.toHaveBeenCalled();
    },
  );
});
