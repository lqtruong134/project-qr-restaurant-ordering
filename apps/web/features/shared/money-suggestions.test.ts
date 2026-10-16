import { it, expect } from 'vitest';
import { moneySuggestions } from './money-suggestions';
it('offers explicit VND scales for short numbers without changing entered money', () => {
  expect(moneySuggestions('5')).toEqual(['5000', '50000', '500000']);
  expect(moneySuggestions('50')).toEqual(['50000', '500000', '5000000']);
});
it('respects collection and cash tender bounds and omits already complete amounts', () => {
  expect(moneySuggestions('5', '1', '75000')).toEqual(['5000', '50000']);
  expect(moneySuggestions('5', '49000')).toEqual(['50000', '500000']);
  expect(moneySuggestions('50000')).toEqual([]);
  expect(moneySuggestions('0')).toEqual([]);
  expect(moneySuggestions('-5')).toEqual([]);
});
