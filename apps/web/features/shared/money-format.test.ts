import { describe, expect, it } from 'vitest';
import { formatMoneyInput, parseMoneyInput } from './money-format';
describe('VND amount entry', () => {
  it('accepts whole đồng and common copied thousands separators without rounding', () => {
    for (const input of ['1234567', '1.234.567', '1,234,567', '1 234 567'])
      expect(parseMoneyInput(input)).toBe('1234567');
    expect(formatMoneyInput('1234567')).toBe('1.234.567');
    expect(parseMoneyInput('')).toBe('');
    expect(parseMoneyInput('000')).toBe('0');
    expect(parseMoneyInput('9007199254740993')).toBe('9007199254740993');
  });
  it('rejects negative, fractional, exponent and malformed pasted amounts', () => {
    for (const input of ['-100', '1e5', '1,5', '1.23.456', '50k', '+100', '1,234.567'])
      expect(parseMoneyInput(input)).toBeNull();
  });
});
