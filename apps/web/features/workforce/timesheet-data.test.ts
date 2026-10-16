import { it, expect } from 'vitest';
import {
  canApproveStandard,
  cellLabel,
  csv,
  monthRange,
  monthRows,
  totals,
} from './timesheet-data';

it('uses all calendar days, including leap February, and never includes the previous-month overnight start', () => {
  expect(monthRange('2026-09').days).toHaveLength(30);
  expect(monthRange('2024-02').days).toHaveLength(29);
  expect(monthRange('2026-12').to).toBe('2026-12-31');
  expect(() => monthRange('2026-13')).toThrow();
  expect(
    monthRows(
      [
        { id: 'a', starts_at: '2026-08-31T22:00:00+07:00', status: 'ASSIGNED' },
        { id: 'b', starts_at: '2026-09-30T22:00:00+07:00', status: 'ASSIGNED' },
        { id: 'c', starts_at: '2026-09-02T08:00:00+07:00', status: 'CANCELLED' },
      ],
      '2026-09',
    ).map((a) => a.id),
  ).toEqual(['b']);
});
it('counts approved pay only, keeps zero leave/absence distinct and adds multiple shifts per day', () => {
  const rows = [
    {
      id: 'test',
      attendance_status: 'APPROVED',
      approved_minutes: 240,
      amount: '140000',
      outcome: 'WORKED',
    },
    {
      id: 'test',
      attendance_status: 'APPROVED',
      approved_minutes: 180,
      amount: '120000',
      outcome: 'WORKED',
    },
    {
      id: 'test',
      attendance_status: 'APPROVED',
      approved_minutes: 0,
      amount: '0',
      outcome: 'LEAVE',
    },
    {
      id: 'test',
      attendance_status: 'APPROVED',
      approved_minutes: 0,
      amount: '0',
      outcome: 'ABSENT',
    },
  ];
  expect(totals(rows)).toMatchObject({
    minutes: 420,
    amount: 260000n,
    approved: 4,
    leave: 1,
    absent: 1,
  });
  expect(cellLabel(rows)).toBe('7:00 - N - V');
});
it('bulk standard approval excludes active, missing, zero evidence, no-rate and already-approved ca', () => {
  const a = {
    id: 'test',
    status: 'ASSIGNED',
    classification: 'NORMAL',
    ends_at: '2026-01-01T10:00:00Z',
    actual_minutes: 240,
    effective_hourly_rate: '35000',
  };
  expect(canApproveStandard(a)).toBe(true);
  expect(canApproveStandard({ ...a, pay_policy_active: true, break_minutes: 0 })).toBe(true);
  expect(canApproveStandard({ ...a, pay_policy_active: true, break_minutes: 60 })).toBe(false);
  expect(canApproveStandard({ ...a, pay_policy_active: false, break_minutes: 60 })).toBe(true);
  for (const patch of [
    { classification: 'ACTIVE' },
    { requires_exception: true },
    { actual_minutes: 0 },
    { effective_hourly_rate: null },
    { id: 'test', attendance_status: 'APPROVED' },
    { status: 'CANCELLED' },
  ] as Record<string, string | number | boolean | null>[])
    expect(canApproveStandard({ ...a, ...patch })).toBe(false);
});
it('CSV protects spreadsheet formula cells and correctly quotes names/commas/newlines', () => {
  const result = csv([['=1+1', 'a,"b"', 'line\nbreak', 240]]);
  expect(result).toBe('\ufeff"\'=1+1","a,""b""","line\nbreak","240"');
});
