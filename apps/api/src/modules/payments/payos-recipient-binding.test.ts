import { describe, expect, it } from 'vitest';
import { readPayosConfig, trustedPayosPrimary, type PayosConfig } from './payos-adapter.js';
import { readPayosQrRecipient, recipientMatchesWithEvidence } from './payos-normalization.js';

const clientId = 'synthetic-mb-hotfix-client';
const restaurantId = '10000000-0000-4000-8000-000000000001';
const primary = '0123456789';
const anchor = '1000000000001';
const linkId = 'synthetic-mb-hotfix-link';
const binding = () => ({
  clientId,
  restaurantId,
  bankBin: '970422',
  accountNumber: primary,
});
const config = (): PayosConfig => ({
  enabled: true,
  clientId,
  recipientBinding: binding(),
});
function tlv(tag: string, value: string) {
  return tag + String(Buffer.byteLength(value, 'utf8')).padStart(2, '0') + value;
}
function qr(accountNumber = anchor, bankBin = '970422', guid = 'A000000727') {
  return (
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', tlv('00', guid) + tlv('01', tlv('00', bankBin) + tlv('01', accountNumber))) +
    tlv('53', '704') +
    tlv('58', 'VN') +
    tlv('59', 'Nhà hàng Việt') +
    tlv('63', '0000')
  );
}
function trusted(value: PayosConfig = config(), currentRestaurant = restaurantId) {
  return trustedPayosPrimary(value, currentRestaurant, anchor, qr(), linkId, linkId);
}

describe('payOS trusted MB recipient binding', () => {
  it('reads an explicit backend binding and preserves the full account including leading zeroes', () => {
    const result = readPayosConfig({
      PAYOS_ENABLED: 'true',
      PAYOS_CLIENT_ID: clientId,
      PAYOS_RETURN_URL: 'https://restaurant.invalid/payment/return',
      PAYOS_CANCEL_URL: 'https://restaurant.invalid/payment/cancel',
      PAYOS_RECIPIENT_BINDING: JSON.stringify(binding()),
    });
    expect(result.recipientBinding).toEqual(binding());
    expect(result.recipientBinding?.accountNumber).toBe(primary);
  });

  it('leaves the bridge unconfigured when the optional binding is missing or blank', () => {
    for (const value of [undefined, '', '  ']) {
      expect(readPayosConfig({ PAYOS_RECIPIENT_BINDING: value }).recipientBinding).toBeUndefined();
    }
  });

  it('fails closed for malformed, incomplete or unsupported backend binding data', () => {
    for (const value of [
      '{',
      'null',
      '[]',
      '{}',
      JSON.stringify({ ...binding(), clientId: '' }),
      JSON.stringify({ ...binding(), restaurantId: '' }),
      JSON.stringify({ ...binding(), bankBin: '970436' }),
      JSON.stringify({ ...binding(), accountNumber: 1234567890 }),
      JSON.stringify({ ...binding(), accountNumber: '12345' }),
      JSON.stringify({ ...binding(), accountNumber: 'x'.repeat(10) }),
      JSON.stringify({ ...binding(), accountNumber: '1'.repeat(35) }),
    ]) {
      expect(() => readPayosConfig({ PAYOS_RECIPIENT_BINDING: value })).toThrow(
        'Invalid PAYOS_RECIPIENT_BINDING',
      );
    }
  });

  it('does not expose private binding contents in configuration errors', () => {
    const canary = 'synthetic-private-account-and-key-never-log';
    expect(() =>
      readPayosConfig({
        PAYOS_RECIPIENT_BINDING: JSON.stringify({ ...binding(), accountNumber: canary }),
      }),
    ).toThrowError(
      /^Invalid PAYOS_RECIPIENT_BINDING; configure the linked MB account privately\.$/,
    );
  });

  it('parses the domestic VietQR recipient using byte lengths without treating a QR as a mapping', () => {
    expect(readPayosQrRecipient(qr())).toEqual({ bankBin: '970422', accountNumber: anchor });
    expect(readPayosQrRecipient(qr(primary))).toEqual({
      bankBin: '970422',
      accountNumber: primary,
    });
  });

  it('rejects malformed, oversized, duplicate-tag and unrelated QR structures', () => {
    for (const value of [
      null,
      {},
      'FAKE_QR',
      'x'.repeat(4097),
      tlv('38', tlv('00', 'A000000727') + tlv('00', 'A000000727')),
      qr(anchor, '970422', 'UNRELATED'),
      qr('not-an-account'),
      qr(anchor, 'ABCDEF'),
    ]) {
      expect(readPayosQrRecipient(value)).toBeNull();
    }
  });

  it('resolves a primary only for the exact configured client, restaurant, MB QR anchor and stored link', () => {
    expect(trusted()).toBe(primary);
  });

  it('does not resolve trusted primary when disabled or unconfigured', () => {
    expect(trusted({ ...config(), enabled: false })).toBeUndefined();
    expect(trusted({ ...config(), recipientBinding: undefined })).toBeUndefined();
    expect(trusted({ ...config(), clientId: undefined })).toBeUndefined();
  });

  it('does not reuse an account binding across clients or restaurants', () => {
    expect(trusted({ ...config(), clientId: 'another-channel' })).toBeUndefined();
    expect(trusted(config(), 'another-restaurant')).toBeUndefined();
    expect(
      trusted({ ...config(), recipientBinding: { ...binding(), clientId: 'another-channel' } }),
    ).toBeUndefined();
  });

  it('rejects a different bank, a different CREATE anchor or missing QR before enabling the bridge', () => {
    expect(
      trusted({ ...config(), recipientBinding: { ...binding(), bankBin: '970436' } }),
    ).toBeUndefined();
    for (const value of [undefined, qr(anchor, '970436'), qr('2000000000002')]) {
      expect(
        trustedPayosPrimary(config(), restaurantId, anchor, value, linkId, linkId),
      ).toBeUndefined();
    }
  });

  it('requires an independently stored exact payment link instead of allowing GET to establish it', () => {
    for (const stored of [undefined, null, '', 'other-link']) {
      expect(
        trustedPayosPrimary(config(), restaurantId, anchor, qr(), stored, linkId),
      ).toBeUndefined();
    }
  });

  it('bridges CREATE 13 digits to equal GET/webhook 10 digits only with scoped backend trust', () => {
    const bank = { accountNumber: primary, virtualAccountNumber: null };
    const webhook = { accountNumber: primary, virtualAccountNumber: null };
    expect(recipientMatchesWithEvidence(anchor, bank, webhook)).toBe(false);
    expect(recipientMatchesWithEvidence(anchor, bank, webhook, trusted())).toBe(true);
  });

  it('does not accept an unconfigured account or a same-length foreign account', () => {
    const bank = { accountNumber: primary };
    expect(recipientMatchesWithEvidence(anchor, bank, bank)).toBe(false);
    expect(recipientMatchesWithEvidence(anchor, bank, bank, '9999999999')).toBe(false);
    const foreign = { accountNumber: '9999999999' };
    expect(recipientMatchesWithEvidence(anchor, foreign, foreign, primary)).toBe(false);
    expect(recipientMatchesWithEvidence(anchor, bank, undefined, trusted())).toBe(true);
    expect(recipientMatchesWithEvidence(anchor, bank, undefined)).toBe(false);
    expect(recipientMatchesWithEvidence('', bank, bank, primary)).toBe(false);
  });

  it('accepts a primary-only verified GET without a webhook only after the exact channel binding passes', () => {
    const bank = { accountNumber: primary, virtualAccountNumber: null };
    expect(recipientMatchesWithEvidence(anchor, bank, undefined, trusted())).toBe(true);
    for (const value of [
      { ...config(), enabled: false },
      { ...config(), clientId: 'another-channel' },
      { ...config(), recipientBinding: undefined },
      { ...config(), recipientBinding: { ...binding(), restaurantId: 'another-restaurant' } },
      { ...config(), recipientBinding: { ...binding(), bankBin: '970436' } },
    ]) {
      expect(recipientMatchesWithEvidence(anchor, bank, undefined, trusted(value))).toBe(false);
    }
    expect(
      recipientMatchesWithEvidence(anchor, { accountNumber: '9999999999' }, undefined, trusted()),
    ).toBe(false);
  });

  it('does not treat malformed virtual accounts as an absent VA when the webhook is missing', () => {
    for (const virtualAccountNumber of [123, true, {}, [], '9999999999999']) {
      expect(
        recipientMatchesWithEvidence(
          anchor,
          { accountNumber: primary, virtualAccountNumber },
          undefined,
          trusted(),
        ),
      ).toBe(false);
    }
  });
  it('never repairs an explicitly conflicting VA with a configured primary', () => {
    const ordinary = { accountNumber: primary, virtualAccountNumber: null };
    const conflicting = { accountNumber: primary, virtualAccountNumber: '2000000000002' };
    expect(recipientMatchesWithEvidence(anchor, conflicting, ordinary, primary)).toBe(false);
    expect(recipientMatchesWithEvidence(anchor, ordinary, conflicting, primary)).toBe(false);
    expect(recipientMatchesWithEvidence(anchor, conflicting, conflicting, primary)).toBe(false);
  });

  it('does not coerce numeric accounts, remove leading zeroes or bridge different primary accounts', () => {
    const bank = { accountNumber: primary };
    for (const malformed of [123, true, {}, []]) {
      expect(
        recipientMatchesWithEvidence(
          anchor,
          { ...bank, virtualAccountNumber: malformed },
          bank,
          primary,
        ),
      ).toBe(false);
      expect(
        recipientMatchesWithEvidence(
          anchor,
          bank,
          { ...bank, virtualAccountNumber: malformed },
          primary,
        ),
      ).toBe(false);
    }
    for (const proof of [
      { accountNumber: 123456789 },
      { accountNumber: '123456789' },
      { accountNumber: '9999999999' },
    ]) {
      expect(recipientMatchesWithEvidence(anchor, bank, proof, primary)).toBe(false);
    }
    expect(recipientMatchesWithEvidence(anchor, { accountNumber: 123456789 }, bank, primary)).toBe(
      false,
    );
  });

  it('preserves direct account and exact VA matching without requiring the new binding', () => {
    expect(
      recipientMatchesWithEvidence(primary, { accountNumber: primary }, { accountNumber: primary }),
    ).toBe(true);
    expect(
      recipientMatchesWithEvidence(
        anchor,
        { accountNumber: primary, virtualAccountNumber: anchor },
        { accountNumber: primary, virtualAccountNumber: anchor },
      ),
    ).toBe(true);
    expect(
      recipientMatchesWithEvidence(
        anchor,
        { accountNumber: primary, virtualAccountNumber: null },
        { accountNumber: primary, virtualAccountNumber: anchor },
      ),
    ).toBe(true);
  });
});
