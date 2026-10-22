import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePayosOrderCodeStore } from '../../apps/api/src/modules/payments/payos-order-code.js';
const orderCodeDirectory = mkdtempSync(join(tmpdir(), 'payos-fixture-order-codes-'));
const orderCodeStore = join(orderCodeDirectory, 'order-codes.sqlite');
// Explicit bootstrap of a synthetic channel only; never read a merchant env file.
initializePayosOrderCodeStore({
  storePath: orderCodeStore,
  channelId: 'isolated-test-client',
  highWaterMark: 0n,
});
process.once('exit', () => rmSync(orderCodeDirectory, { recursive: true, force: true }));
import {
  officialPayosProvider,
  type CreatePaymentLinkRequest,
  type CreatePaymentLinkResponse,
  type PaymentLink,
} from '../../apps/api/src/modules/payments/payos-adapter.js';
import type {
  PayosProvider,
  PayosConfig,
} from '../../apps/api/src/modules/payments/payos-adapter.js';
export const config: PayosConfig = {
  enabled: true,
  orderCodeStore,
  clientId: 'isolated-test-client',
  apiKey: 'isolated-test-api',
  checksumKey: randomBytes(32).toString('hex'),
  returnUrl: 'http://localhost:3100/payment/return',
  cancelUrl: 'http://localhost:3100/payment/cancel',
};
const verifier = officialPayosProvider(config, async () => {
  throw Error('Real network disabled in payment fixtures');
});
export const signature = (data: object) =>
  createHmac('sha256', config.checksumKey!)
    .update(
      Object.entries(data)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => key + '=' + String(value ?? ''))
        .join('&'),
    )
    .digest('hex');
const notFound = Error('FAKE_RESOURCE_NOT_FOUND');
export class FakeProvider implements PayosProvider {
  links = new Map<number, PaymentLink>();
  creates = 0;
  gets = 0;
  cancels = 0;
  failGet = false;
  failCancel = false;
  loseCreateResponse = false;
  async create(body: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResponse> {
    this.creates++;
    const id = randomUUID().replaceAll('-', '');
    this.links.set(body.orderCode, {
      id,
      orderCode: body.orderCode,
      amount: body.amount,
      amountPaid: 0,
      amountRemaining: body.amount,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      transactions: [],
      cancellationReason: null,
      canceledAt: null,
    });
    if (this.loseCreateResponse) {
      this.loseCreateResponse = false;
      throw Error('FAKE_SECRET_MUST_NOT_LEAK');
    }
    return {
      bin: '970422',
      accountNumber: '12345678',
      accountName: 'TEST RESTAURANT',
      amount: body.amount,
      description: body.description,
      orderCode: body.orderCode,
      currency: 'VND',
      paymentLinkId: id,
      status: 'PENDING',
      checkoutUrl: 'https://pay.payos.vn/web/' + id,
      qrCode: 'FAKE_QR_' + id,
    };
  }
  async get(orderCode: number) {
    this.gets++;
    if (this.failGet) throw Error('FAKE_SECRET_MUST_NOT_LEAK');
    const row = this.links.get(orderCode);
    if (!row) throw notFound;
    return structuredClone(row);
  }
  async cancel(orderCode: number, reason: string) {
    this.cancels++;
    if (this.failCancel) throw Error('FAKE_SECRET_MUST_NOT_LEAK');
    const link = this.links.get(orderCode)!;
    if (link.status !== 'PAID') {
      link.status = 'CANCELLED';
      link.cancellationReason = reason;
      link.canceledAt = new Date().toISOString();
    }
    return structuredClone(link);
  }
  verify = (body: unknown) => verifier.verify(body);
  isNotFound = (error: unknown) => error === notFound;
  add(orderCode: number, amount: number, reference = randomUUID()) {
    const link = this.links.get(orderCode)!;
    link.transactions.push({
      reference,
      amount,
      accountNumber: '12345678',
      description: 'QR TEST',
      transactionDateTime: '2026-10-14 10:30:00',
      virtualAccountName: null,
      virtualAccountNumber: null,
      counterAccountBankId: null,
      counterAccountBankName: null,
      counterAccountName: null,
      counterAccountNumber: null,
    });
    link.amountPaid += amount;
    link.amountRemaining = Math.max(link.amount - link.amountPaid, 0);
    link.status = link.amountRemaining ? 'UNDERPAID' : 'PAID';
    return link.transactions.at(-1)!;
  }
}
