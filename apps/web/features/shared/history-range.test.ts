import { expect, it } from 'vitest';
import { historyDay, historyBounds, historyMatches, type HistoryQuery } from './history-range';
const query: HistoryQuery = {
  period: 'all',
  from: '2026-10-01',
  to: '2026-10-06',
  q: '',
  status: 'all',
};
it('uses restaurant midnight, Monday and month start for history periods', () => {
  expect(historyDay('2026-10-05T17:00:00Z')).toBe('2026-10-06');
  expect(historyDay('2026-10-05T16:59:59Z')).toBe('2026-10-05');
  expect(historyBounds({ ...query, period: 'week' }, '2026-10-06')).toEqual({
    from: '2026-10-05',
    to: '2026-10-06',
  });
  expect(historyBounds({ ...query, period: 'month' }, '2026-10-06')).toEqual({
    from: '2026-10-01',
    to: '2026-10-06',
  });
  expect(historyMatches('2026-10-05T17:00:00Z', { ...query, period: 'today' }, '2026-10-06')).toBe(
    true,
  );
  expect(historyMatches('2026-10-06T17:00:00Z', { ...query, period: 'today' }, '2026-10-06')).toBe(
    false,
  );
});
it('validates calendar dates, reversed and oversized windows, and overlapping periods', () => {
  expect(() => historyBounds({ ...query, period: 'custom', from: '2026-02-29' })).toThrow();
  expect(() => historyBounds({ ...query, period: 'custom', to: '2026-09-30' })).toThrow();
  expect(() => historyBounds({ ...query, period: 'custom', from: '2024-01-01' })).toThrow();
  expect(
    historyMatches('2026-09-01', { ...query, period: 'custom' }, undefined, '2026-10-03', true),
  ).toBe(true);
  expect(
    historyMatches('2026-09-01', { ...query, period: 'custom' }, undefined, '2026-09-30', true),
  ).toBe(false);
  expect(historyBounds(query)).toEqual({ from: '', to: '' });
});
