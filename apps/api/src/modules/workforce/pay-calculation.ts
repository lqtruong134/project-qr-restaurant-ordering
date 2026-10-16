export type PaidPeriod = {
  startsAt: string;
  endsAt: string;
  kind: 'REGULAR' | 'OVERTIME' | 'PAID_HOLIDAY';
};
export type PayPolicy = {
  id: string;
  effectiveFrom: string;
  nightPremiumPercent: number;
  overtimeWeekdayPercent: number;
  restDayPercent: number;
  holidayPercent: number;
};
export type PayRate = { id: string; effectiveFrom: string; hourlyRate: string };
export type CalendarDay = {
  id: string;
  date: string;
  kind: 'HOLIDAY' | 'WEEKLY_REST';
  userId: string | null;
  name: string;
};
export type PayComponents = {
  regularMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  restDayMinutes: number;
  paidHolidayMinutes: number;
  baseAmount: string;
  nightAmount: string;
  overtimeAmount: string;
  restDayAmount: string;
  holidayAmount: string;
  paidHolidayAmount: string;
  totalAmount: string;
};
export type PaySegment = {
  startsAt: string;
  endsAt: string;
  minutes: number;
  kind: PaidPeriod['kind'];
  dayKind: 'WEEKDAY' | 'WEEKLY_REST' | 'HOLIDAY';
  isNight: boolean;
  hourlyRate: string;
  policyId: string;
  rateId: string;
  calendarId: string | null;
  totalPercent: number;
  amount: string;
};

const clockFormats = new Map<string, Intl.DateTimeFormat>();
export function localClock(time: number | string, timezone: string) {
  let format = clockFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    clockFormats.set(timezone, format);
  }
  const parts = format.formatToParts(new Date(time));
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
export const isNightMinute = (minute: number) => minute >= 22 * 60 || minute < 6 * 60;

/** Allocate rounding residuals once, so each displayed component reconciles to the approved VND total. */
function allocate(values: bigint[]) {
  const denominator = 30000n;
  const total = (values.reduce((sum, value) => sum + value, 0n) + denominator / 2n) / denominator;
  const rounded = values.map((value) => value / denominator);
  let remainder = Number(total - rounded.reduce((sum, value) => sum + value, 0n));
  const order = values
    .map((value, index) => ({ index, fraction: value % denominator }))
    .sort((a, b) =>
      a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1,
    );
  for (const { index } of order) {
    if (!remainder) break;
    rounded[index] = rounded[index]! + 1n;
    remainder--;
  }
  return { total: total.toString(), amounts: rounded.map(String) };
}

export function calculatePay(input: {
  timezone: string;
  userId: string;
  periods: PaidPeriod[];
  policies: PayPolicy[];
  rates: PayRate[];
  calendar: CalendarDay[];
  daytimeOvertimeStarts?: string[];
}) {
  const { timezone, userId, periods, policies, rates, calendar } = input;
  const firstDaytimeOvertime = new Map<string, number>();
  const recordDaytimeOvertime = (ms: number) => {
    const clock = localClock(ms, timezone);
    if (!isNightMinute(clock.minute))
      firstDaytimeOvertime.set(
        clock.date,
        Math.min(firstDaytimeOvertime.get(clock.date) ?? Infinity, ms),
      );
  };
  for (const start of input.daytimeOvertimeStarts ?? []) recordDaytimeOvertime(Date.parse(start));
  for (const p of periods.filter((p) => p.kind === 'OVERTIME')) {
    for (let ms = Date.parse(p.startsAt); ms < Date.parse(p.endsAt); ms += 60000) {
      recordDaytimeOvertime(ms);
    }
  }
  const minutes = {
    regularMinutes: 0,
    nightMinutes: 0,
    overtimeMinutes: 0,
    holidayMinutes: 0,
    restDayMinutes: 0,
    paidHolidayMinutes: 0,
  };
  const buckets = {
    baseAmount: 0n,
    nightAmount: 0n,
    overtimeAmount: 0n,
    restDayAmount: 0n,
    holidayAmount: 0n,
    paidHolidayAmount: 0n,
  };
  const segments: PaySegment[] = [],
    numerators: bigint[] = [];
  const usedPolicies = new Map<string, PayPolicy>(),
    usedRates = new Map<string, PayRate>(),
    usedCalendar = new Map<string, CalendarDay>();
  const usedDaytimeOvertime = new Set<string>();
  const orderedPolicies = [...policies].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const orderedRates = [...rates].sort(
    (a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom),
  );
  for (const period of [...periods].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.kind.localeCompare(b.kind),
  )) {
    for (let ms = Date.parse(period.startsAt); ms < Date.parse(period.endsAt); ms += 60000) {
      const clock = localClock(ms, timezone),
        policy = orderedPolicies.find((p) => p.effectiveFrom <= clock.date),
        rate = orderedRates.find((r) => Date.parse(r.effectiveFrom) <= ms);
      if (!policy || !rate)
        throw new Error('Chưa có chính sách hoặc đơn giá nhân viên cho khoảng công này.');
      usedPolicies.set(policy.id, policy);
      usedRates.set(rate.id, rate);
      const holiday = calendar.find((d) => d.date === clock.date && d.kind === 'HOLIDAY');
      const rest = calendar.find(
        (d) => d.date === clock.date && d.kind === 'WEEKLY_REST' && d.userId === userId,
      );
      const day = holiday ?? rest,
        dayKind = day?.kind ?? 'WEEKDAY';
      if (day) usedCalendar.set(day.id, day);
      const entitlement = period.kind === 'PAID_HOLIDAY',
        night = !entitlement && isNightMinute(clock.minute);
      if (entitlement && !holiday)
        throw new Error('Nghỉ lễ hưởng lương chỉ áp dụng cho ngày lễ đã khai báo.');
      const extra = period.kind === 'OVERTIME' || dayKind !== 'WEEKDAY';
      const dayPercent =
        dayKind === 'HOLIDAY'
          ? policy.holidayPercent
          : dayKind === 'WEEKLY_REST'
            ? policy.restDayPercent
            : period.kind === 'OVERTIME'
              ? policy.overtimeWeekdayPercent
              : 100;
      const dayBasis =
        dayKind === 'HOLIDAY'
          ? policy.holidayPercent
          : dayKind === 'WEEKLY_REST'
            ? policy.restDayPercent
            : (firstDaytimeOvertime.get(clock.date) ?? Infinity) < ms
              ? policy.overtimeWeekdayPercent
              : 100;
      if (
        night &&
        extra &&
        dayKind === 'WEEKDAY' &&
        (firstDaytimeOvertime.get(clock.date) ?? Infinity) < ms
      )
        usedDaytimeOvertime.add(clock.date);
      // Article 57: overtime at night adds 30% of base and 20% of that day's daytime rate.
      const nightPercent = night ? policy.nightPremiumPercent + (extra ? dayBasis * 0.2 : 0) : 0;
      const totalPercent = entitlement ? 100 : dayPercent + nightPercent;
      const base = BigInt(rate.hourlyRate);
      if (entitlement) {
        minutes.paidHolidayMinutes++;
        buckets.paidHolidayAmount += base * 500n;
      } else {
        if (period.kind === 'REGULAR') minutes.regularMinutes++;
        if (extra) minutes.overtimeMinutes++;
        if (night) minutes.nightMinutes++;
        if (dayKind === 'HOLIDAY') minutes.holidayMinutes++;
        if (dayKind === 'WEEKLY_REST') minutes.restDayMinutes++;
        buckets.baseAmount += base * 500n;
        if (night)
          buckets.nightAmount +=
            base * BigInt(policy.nightPremiumPercent * 5 + (extra ? dayBasis : 0));
        const premiumKey =
          dayKind === 'HOLIDAY'
            ? 'holidayAmount'
            : dayKind === 'WEEKLY_REST'
              ? 'restDayAmount'
              : 'overtimeAmount';
        buckets[premiumKey] += base * BigInt((dayPercent - 100) * 5);
      }
      const previous = segments.at(-1),
        numerator =
          base *
          BigInt(
            entitlement
              ? 500
              : dayPercent * 5 +
                  (night ? policy.nightPremiumPercent * 5 + (extra ? dayBasis : 0) : 0),
          );
      const startsAt = new Date(ms).toISOString(),
        endsAt = new Date(ms + 60000).toISOString();
      if (
        previous &&
        previous.endsAt === startsAt &&
        previous.kind === period.kind &&
        previous.dayKind === dayKind &&
        previous.isNight === night &&
        previous.policyId === policy.id &&
        previous.rateId === rate.id &&
        previous.calendarId === (day?.id ?? null) &&
        previous.totalPercent === totalPercent &&
        localClock(previous.startsAt, timezone).date === clock.date
      ) {
        previous.endsAt = endsAt;
        previous.minutes++;
        numerators[numerators.length - 1] = numerators[numerators.length - 1]! + numerator;
      } else {
        segments.push({
          startsAt,
          endsAt,
          minutes: 1,
          kind: period.kind,
          dayKind,
          isNight: night,
          hourlyRate: rate.hourlyRate,
          policyId: policy.id,
          rateId: rate.id,
          calendarId: day?.id ?? null,
          totalPercent,
          amount: '0',
        });
        numerators.push(numerator);
      }
    }
  }
  const segmentAmounts = allocate(numerators);
  segments.forEach((s, i) => {
    s.amount = segmentAmounts.amounts[i]!;
  });
  const keys = Object.keys(buckets) as (keyof typeof buckets)[],
    result = allocate(keys.map((k) => buckets[k]));
  const components = {
    ...minutes,
    ...Object.fromEntries(keys.map((key, index) => [key, result.amounts[index]])),
    totalAmount: result.total,
  } as PayComponents;
  return {
    amount: result.total,
    components,
    snapshot: {
      version: 1,
      timezone,
      periods,
      segments,
      policies: [...usedPolicies.values()],
      rates: [...usedRates.values()],
      calendar: [...usedCalendar.values()],
      daytimeOvertimeStarts: [...usedDaytimeOvertime]
        .sort()
        .map((date) => new Date(firstDaytimeOvertime.get(date)!).toISOString()),
      components,
    },
  };
}
