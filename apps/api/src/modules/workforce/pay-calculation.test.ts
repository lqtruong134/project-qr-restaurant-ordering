import { describe, it, expect } from 'vitest';
import {
  calculatePay,
  type PaidPeriod,
  type CalendarDay,
  type PayPolicy,
} from './pay-calculation.js';
const policy: PayPolicy = {
  id: 'policy',
  effectiveFrom: '2025-01-01',
  nightPremiumPercent: 30,
  overtimeWeekdayPercent: 150,
  restDayPercent: 200,
  holidayPercent: 300,
};
const at = (date: string, time: string) => `${date}T${time}:00+07:00`;
const p = (date: string, start: string, end: string, kind: PaidPeriod['kind'] = 'REGULAR') => ({
  startsAt: at(date, start),
  endsAt: at(date, end),
  kind,
});
const calculate = (
  periods: PaidPeriod[],
  calendar: CalendarDay[] = [],
  hourlyRate = '40000',
  policies = [policy],
) =>
  calculatePay({
    timezone: 'Asia/Ho_Chi_Minh',
    userId: 'cook',
    periods,
    policies,
    rates: [{ id: 'rate', effectiveFrom: '2025-01-01T00:00:00+07:00', hourlyRate }],
    calendar,
  });
describe('classified hourly pay with immutable calculation evidence', () => {
  it('retains personal wage differences for the same night shift', () => {
    const periods = [
      {
        startsAt: at('2025-02-01', '22:00'),
        endsAt: at('2025-02-02', '02:00'),
        kind: 'REGULAR' as const,
      },
    ];
    expect(calculate(periods).amount).toBe('208000');
    expect(calculate(periods, [], '80000').amount).toBe('416000');
  });
  it('separates normal and night portions at 22:00 and 06:00', () => {
    expect(calculate([p('2025-02-01', '20:00', '23:00')]).components).toMatchObject({
      regularMinutes: 180,
      nightMinutes: 60,
      baseAmount: '120000',
      nightAmount: '12000',
      totalAmount: '132000',
    });
    expect(
      calculate([p('2025-02-01', '05:00', '07:00')]).snapshot.segments.map((s) => s.totalPercent),
    ).toEqual([130, 100]);
  });
  it('does not assume Sunday is every employee’s weekly rest day', () => {
    expect(calculate([p('2025-02-02', '10:00', '12:00')]).amount).toBe('80000');
    const rest: CalendarDay = {
      id: 'rest',
      date: '2025-02-02',
      kind: 'WEEKLY_REST',
      userId: 'cook',
      name: 'Nghỉ tuần',
    };
    expect(calculate([p('2025-02-02', '10:00', '12:00')], [rest]).amount).toBe('160000');
    expect(calculate([p('2025-02-02', '22:00', '23:00')], [rest]).amount).toBe('108000');
    expect(
      calculate([p('2025-02-02', '10:00', '12:00')], [{ ...rest, userId: 'other' }]).amount,
    ).toBe('80000');
  });
  it('uses 200% weekday overtime at night, or 210% after daytime overtime', () => {
    expect(calculate([p('2025-02-03', '22:00', '23:00', 'OVERTIME')]).amount).toBe('80000');
    const result = calculate([
      p('2025-02-03', '17:00', '18:00', 'OVERTIME'),
      p('2025-02-03', '22:00', '23:00', 'OVERTIME'),
    ]);
    expect(result.amount).toBe('144000');
    expect(result.snapshot.segments.map((s) => s.totalPercent)).toEqual([150, 210]);
  });
  it('does not retroactively apply later daytime overtime to the early-morning night period', () => {
    const result = calculate([
      p('2025-02-03', '00:00', '01:00', 'OVERTIME'),
      p('2025-02-03', '08:00', '09:00', 'OVERTIME'),
      p('2025-02-03', '22:00', '23:00', 'OVERTIME'),
    ]);
    expect(result.snapshot.segments.map((s) => s.totalPercent)).toEqual([200, 150, 210]);
    expect(result.amount).toBe('224000');
  });
  it('prioritizes holidays over weekly rest and separates midnight holiday boundaries', () => {
    const holiday: CalendarDay = {
      id: 'holiday',
      date: '2025-02-04',
      kind: 'HOLIDAY',
      userId: null,
      name: 'Ngày lễ',
    };
    const result = calculate(
      [{ startsAt: at('2025-02-03', '22:00'), endsAt: at('2025-02-04', '02:00'), kind: 'REGULAR' }],
      [holiday, { ...holiday, id: 'rest', kind: 'WEEKLY_REST', userId: 'cook' }],
    );
    expect(result.amount).toBe('416000');
    expect(result.snapshot.segments.map((s) => s.totalPercent)).toEqual([130, 390]);
  });
  it('excludes explicitly omitted breaks from the night premium', () => {
    const result = calculate([
      p('2025-02-05', '20:00', '22:00'),
      p('2025-02-05', '22:30', '23:00'),
    ]);
    expect(result.components).toMatchObject({
      regularMinutes: 150,
      nightMinutes: 30,
      totalAmount: '106000',
    });
  });
  it('keeps holiday pay entitlement separate from money for work on a holiday', () => {
    const holiday: CalendarDay = {
      id: 'holiday',
      date: '2025-02-06',
      kind: 'HOLIDAY',
      userId: null,
      name: 'Ngày lễ',
    };
    const result = calculate(
      [p('2025-02-06', '09:00', '17:00'), p('2025-02-06', '09:00', '17:00', 'PAID_HOLIDAY')],
      [holiday],
    );
    expect(result.components).toMatchObject({
      holidayMinutes: 480,
      paidHolidayMinutes: 480,
      baseAmount: '320000',
      holidayAmount: '640000',
      paidHolidayAmount: '320000',
      totalAmount: '1280000',
    });
    expect(() => calculate([p('2025-02-07', '09:00', '17:00', 'PAID_HOLIDAY')])).toThrow('ngày lễ');
  });
  it('applies effective dated policies and personal rates during an overnight shift', () => {
    const result = calculatePay({
      timezone: 'Asia/Ho_Chi_Minh',
      userId: 'cook',
      periods: [
        { startsAt: at('2025-02-07', '23:00'), endsAt: at('2025-02-08', '01:00'), kind: 'REGULAR' },
      ],
      policies: [
        policy,
        { ...policy, id: 'policy2', effectiveFrom: '2025-02-08', nightPremiumPercent: 40 },
      ],
      rates: [
        { id: 'rate', effectiveFrom: '2025-01-01T00:00:00+07:00', hourlyRate: '40000' },
        { id: 'raise', effectiveFrom: at('2025-02-08', '00:00'), hourlyRate: '50000' },
      ],
      calendar: [],
    });
    expect(result.amount).toBe('122000');
    expect(result.snapshot.segments.map((s) => [s.hourlyRate, s.policyId])).toEqual([
      ['40000', 'policy'],
      ['50000', 'policy2'],
    ]);
  });
  it('rounds once and reconciles all segments and component buckets', () => {
    const result = calculate(
      [p('2025-02-09', '21:59', '22:01'), p('2025-02-09', '23:00', '23:01', 'OVERTIME')],
      [],
      '40001',
      [{ ...policy, overtimeWeekdayPercent: 151 }],
    );
    const c = result.components;
    expect(
      BigInt(c.baseAmount) +
        BigInt(c.nightAmount) +
        BigInt(c.overtimeAmount) +
        BigInt(c.restDayAmount) +
        BigInt(c.holidayAmount) +
        BigInt(c.paidHolidayAmount),
    ).toBe(BigInt(result.amount));
    expect(result.snapshot.segments.reduce((sum, s) => sum + BigInt(s.amount), 0n)).toBe(
      BigInt(result.amount),
    );
  });
  it('fails when a paid interval has no policy or personal pay rate', () => {
    expect(() => calculate([p('2024-12-01', '09:00', '10:00')])).toThrow('Chưa có chính sách');
  });
});
