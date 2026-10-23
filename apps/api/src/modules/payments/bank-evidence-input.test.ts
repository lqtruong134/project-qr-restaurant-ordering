import { describe, expect, it } from 'vitest';
import { parseBankEvidenceInput } from './bank-evidence.service.js';
const input = {
  proofId: '11111111-1111-4111-8111-111111111111',
  reference: 'MB-REFERENCE-001',
  amount: '10000',
  bankTransactionAt: '2026-10-23T10:20:30+07:00',
  reason: 'Đối chiếu trực tiếp giao dịch tiền vào trên ngân hàng nhà hàng.',
  attested: true,
};
describe('independent bank statement input', () => {
  it('normalizes an explicit timezone and integer VND without granting posting authority', () => {
    expect(parseBankEvidenceInput(input)).toEqual({
      proofId: input.proofId,
      reference: input.reference,
      amount: '10000',
      bankTransactionAt: '2026-10-23T03:20:30.000Z',
      reason: input.reason,
    });
  });
  it.each([false, undefined, 'true'])(
    'requires an explicit independent bank attestation (%s)',
    (attested) => {
      expect(() => parseBankEvidenceInput({ ...input, attested })).toThrow(/đối chiếu trực tiếp/);
    },
  );
  it.each(['2026-10-23 10:20:30', '2026-10-23T10:20:30', 'invalid'])(
    'rejects ambiguous bank time %s',
    (bankTransactionAt) => {
      expect(() => parseBankEvidenceInput({ ...input, bankTransactionAt })).toThrow(/múi giờ/);
    },
  );
  it.each(['0', '-10000', '10000.5', 10000])('rejects invalid amount %s', (amount) => {
    expect(() => parseBankEvidenceInput({ ...input, amount })).toThrow();
  });
  it.each(['MB\nREF', 'REF WITH SPACE', '<script>', ''])(
    'rejects an invalid exact reference %s',
    (reference) => {
      expect(() => parseBankEvidenceInput({ ...input, reference })).toThrow();
    },
  );
  it('requires a server generated proof identifier and a substantive reason', () => {
    expect(() => parseBankEvidenceInput({ ...input, proofId: '../../statement.png' })).toThrow();
    expect(() => parseBankEvidenceInput({ ...input, reason: ' ' })).toThrow();
  });
});
