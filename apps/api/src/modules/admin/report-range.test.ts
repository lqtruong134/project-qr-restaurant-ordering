import { describe, expect, it } from 'vitest';
import { reportRange } from './report-range.js';
describe('restaurant-local report calendar', () => {
  it('uses the supplied restaurant day and Monday as the first day of a week', () => {
    expect(reportRange('today', '2026-10-05')).toMatchObject({
      startDay: '2026-10-05',
      endDay: '2026-10-05',
      granularity: 'hour',
    });
    expect(reportRange('week', '2026-10-04').startDay).toBe('2026-09-28');
    expect(reportRange('week', '2026-10-05').startDay).toBe('2026-10-05');
    expect(reportRange('month', '2026-10-05').startDay).toBe('2026-10-01');
  });
  it('handles leap days, year boundaries and complete historical months', () => {
    expect(reportRange('custom', '2026-10-05', '2024-02-29', '2024-03-01').granularity).toBe('day');
    expect(reportRange('week', '2027-01-01').startDay).toBe('2026-12-28');
    expect(reportRange('all', '2026-10-05', undefined, undefined, '2024-01-01').granularity).toBe(
      'month',
    );
  });
  it('rejects impossible, reversed, missing and overly broad custom dates', () => {
    for (const range of [
      ['2026-02-29', '2026-03-01'],
      ['2026-10-06', '2026-10-05'],
      ['', '2026-10-05'],
      ['2024-01-01', '2026-10-05'],
    ])
      expect(() => reportRange('custom', '2026-10-05', range[0], range[1])).toThrow(RangeError);
    expect(() => reportRange('unknown', '2026-10-05')).toThrow(RangeError);
  });
});
