import { expect } from 'vitest';
import type { buildApp } from '../apps/api/src/app.js';
export async function completePaymentHandover(
  app: ReturnType<typeof buildApp>,
  cookie: string,
  headers: Record<string, string>,
  sid: string,
) {
  async function call(url: string, payload?: Record<string, unknown>) {
    const r = await app.inject({
      url,
      method: payload ? 'POST' : 'GET',
      headers: { ...headers, cookie },
      payload,
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  }
  let bill = await call('/core/sessions/' + sid + '/bill');
  for (const p of bill.completion?.pendingChange ?? [])
    await call('/core/payment-transactions/' + p.id + '/change-returned', {});
  bill = await call('/core/sessions/' + sid + '/bill');
  if (bill.completion?.receiptRequired && !bill.completion.receiptDelivery)
    await call('/core/sessions/' + sid + '/receipt-provided', {
      delivery: 'PRINTED',
      layout: 'standard',
      billKey: bill.completion.receiptKey,
    });
}
