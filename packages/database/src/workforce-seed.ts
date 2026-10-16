import type { Prisma } from '../generated/prisma/client.js';

export const workforceTemplates = [
  { code: 'CA-SANG', name: 'Ca sáng', start: '07:00', end: '16:00', break: 60, next: false },
  { code: 'CA-CHIEU', name: 'Ca chiều', start: '14:00', end: '20:00', break: 30, next: false },
  { code: 'CA-TOI', name: 'Ca tối', start: '15:00', end: '23:00', break: 60, next: false },
  { code: 'CA-DEM', name: 'Ca đêm', start: '22:00', end: '02:00', break: 0, next: true },
] as const;

/** Agreed restaurant rates; premiums are applied by the effective-dated pay policy. */
export function restaurantHourlyRate(username: string): bigint {
  if (username === 'bep001') return 65000n;
  if (username === 'pv001') return 45000n;
  return username.startsWith('bep') ? 42000n : 35000n;
}

const addDay = (day: string, n: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const instant = (day: string, time: string) => new Date(day + 'T' + time + ':00+07:00');

export type WorkforceSeedOptions = { startDay?: string; dayCount?: number; now?: Date };

/** Bootstrap creates configuration and current/upcoming shifts, never punches, approvals or salary payments. */
export async function seedWorkforce(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  options: WorkforceSeedOptions = {},
) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || now.getTime() > Date.now())
    throw new Error('Thời điểm lập lịch phải hợp lệ và không nằm trong tương lai.');
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const startDay = options.startDay ?? today,
    dayCount = options.dayCount ?? 14;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDay) ||
    !Number.isFinite(Date.parse(startDay + 'T00:00:00Z')) ||
    new Date(startDay + 'T00:00:00Z').toISOString().slice(0, 10) !== startDay ||
    startDay < today ||
    !Number.isInteger(dayCount) ||
    dayCount < 1 ||
    dayCount > 31
  )
    throw new Error('Chọn ngày bắt đầu từ hôm nay và từ 1 đến 31 ngày phân ca.');
  const admin = await tx.app_user.findFirstOrThrow({
    where: { restaurant_id: restaurantId, username: 'quyettruong05' },
  });
  const people = await tx.$queryRawUnsafe<{ id: string; username: string; role: string }[]>(
    `SELECT DISTINCT u.id,u.username,r.code AS role FROM app_user u
     JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL
     JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1::uuid AND u.status='ACTIVE'
     AND r.code IN ('STAFF','KITCHEN') ORDER BY u.username`,
    restaurantId,
  );
  const templates = [];
  for (const [i, d] of workforceTemplates.entries()) {
    templates.push(
      await tx.shift_template.upsert({
        where: { restaurant_id_code: { restaurant_id: restaurantId, code: d.code } },
        update: {},
        create: {
          restaurant_id: restaurantId,
          code: d.code,
          name: d.name,
          start_time: new Date('1970-01-01T' + d.start + ':00Z'),
          end_time: new Date('1970-01-01T' + d.end + ':00Z'),
          ends_next_day: d.next,
          break_minutes: d.break,
          hourly_rate_override: null,
          sort_order: i,
          created_by: admin.id,
        },
      }),
    );
  }
  const effectiveFrom = new Date('2026-08-01T00:00:00+07:00');
  for (const person of people)
    if (!(await tx.employee_pay_rate.findFirst({ where: { user_id: person.id } })))
      await tx.employee_pay_rate.create({
        data: {
          restaurant_id: restaurantId,
          user_id: person.id,
          effective_from: effectiveFrom,
          hourly_rate: restaurantHourlyRate(person.username),
          reason:
            person.username === 'bep001'
              ? 'Đơn giá giờ bếp trưởng.'
              : person.username === 'pv001'
                ? 'Đơn giá giờ trưởng nhóm phục vụ.'
                : 'Đơn giá giờ nhân viên.',
          created_by: admin.id,
        },
      });
  await tx.workforce_pay_policy.upsert({
    where: {
      restaurant_id_effective_from: {
        restaurant_id: restaurantId,
        effective_from: new Date('2026-08-01'),
      },
    },
    update: {},
    create: {
      restaurant_id: restaurantId,
      effective_from: new Date('2026-08-01'),
      created_by: admin.id,
    },
  });
  const area = await tx.dining_area.findFirst({
    where: { restaurant_id: restaurantId, code: 'TRONG-NHA' },
  });
  for (let offset = 0; offset < dayCount; offset++) {
    const day = addDay(startDay, offset),
      weekday = new Date(day + 'T00:00:00Z').getUTCDay();
    for (const role of ['STAFF', 'KITCHEN']) {
      const off = people.filter((p) => p.role === role).filter((_, i) => i % 7 === weekday);
      for (const person of off)
        if (
          !(await tx.workforce_calendar_day.findFirst({
            where: {
              restaurant_id: restaurantId,
              date: new Date(day),
              kind: 'WEEKLY_REST',
              user_id: person.id,
            },
          }))
        )
          await tx.workforce_calendar_day.create({
            data: {
              restaurant_id: restaurantId,
              date: new Date(day),
              kind: 'WEEKLY_REST',
              user_id: person.id,
              name: 'Ngày nghỉ hằng tuần theo lịch phân ca',
              created_by: admin.id,
            },
          });
    }
    for (const templateIndex of [0, 2]) {
      const d = workforceTemplates[templateIndex]!,
        template = templates[templateIndex]!;
      const start = instant(day, d.start),
        end = instant(day, d.end);
      if (end.getTime() <= now.getTime()) continue;
      const shift = await tx.work_shift.upsert({
        where: {
          template_id_scheduled_date: { template_id: template.id, scheduled_date: new Date(day) },
        },
        update: {},
        create: {
          restaurant_id: restaurantId,
          code: day + '-' + d.code,
          name: d.name,
          starts_at: start,
          ends_at: end,
          break_minutes: d.break,
          template_id: template.id,
          scheduled_date: new Date(day),
          template_version: template.version,
          hourly_rate_override: null,
          created_by: admin.id,
        },
      });
      for (const role of ['STAFF', 'KITCHEN']) {
        const working = people.filter((p) => p.role === role).filter((_, i) => i % 7 !== weekday);
        const boundary = Math.ceil(working.length / 2);
        const selected = templateIndex === 0 ? working.slice(0, boundary) : working.slice(boundary);
        for (const person of selected) {
          const existing = await tx.shift_assignment.findUnique({
            where: { shift_id_user_id: { shift_id: shift.id, user_id: person.id } },
          });
          if (existing) continue;
          const overlaps = await tx.shift_assignment.count({
            where: {
              user_id: person.id,
              restaurant_id: restaurantId,
              status: 'ASSIGNED',
              starts_at: { lt: end },
              ends_at: { gt: start },
            },
          });
          if (overlaps) continue;
          await tx.shift_assignment.create({
            data: {
              restaurant_id: restaurantId,
              shift_id: shift.id,
              user_id: person.id,
              area_id: role === 'STAFF' ? area?.id : null,
              starts_at: start,
              ends_at: end,
              assigned_by: admin.id,
            },
          });
        }
      }
    }
  }
}
