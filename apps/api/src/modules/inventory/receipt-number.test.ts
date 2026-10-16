import { expect, it } from 'vitest';
import { receiptNumber } from './receipt-number.js';
it('keeps the complete sequence above six digits and does not depend on the calendar', () => {
  expect(receiptNumber('1')).toBe('PN-000001');
  expect(receiptNumber('1000001')).toBe('PN-1000001');
  expect(receiptNumber('9223372036854775807')).toBe('PN-9223372036854775807');
  expect(() => receiptNumber('0')).toThrow();
});
