import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { idParam, integer, object, one, reject, text, uuid } from '../shared/core-persistence.js';
import { date, employee, workforceTransaction } from './workforce.service.js';
import { workforceAudit } from './templates.routes.js';
import {
  assertCalendarEditable,
  calendarColumns,
  paySettings,
  policyColumns,
} from './pay.service.js';

export function registerPaySettings(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { config: { permission: 'admin.workspace' } };
  const tx = <T>(fn: Parameters<typeof workforceTransaction<T>>[2]) =>
    workforceTransaction(db, restaurant, fn);
  app.get('/core/workforce/pay-settings', admin, async () => tx((c) => paySettings(c, restaurant)));
  app.post('/core/workforce/pay-policies', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        from = date(b.effectiveFrom),
        night = integer(b.nightPremiumPercent ?? 30, 30, 300),
        ot = integer(b.overtimeWeekdayPercent ?? 150, 150, 1000),
        rest = integer(b.restDayPercent ?? 200, 200, 1000),
        holiday = integer(b.holidayPercent ?? 300, 300, 1000);
      const last = (
        await c.query(
          'SELECT effective_from::text AS date FROM workforce_pay_policy WHERE restaurant_id=$1 ORDER BY effective_from DESC LIMIT 1',
          [restaurant],
        )
      ).rows[0];
      if (last && from <= last.date)
        reject('Chính sách được lưu theo lịch sử. Chọn ngày hiệu lực sau chính sách gần nhất.');
      const current = await one(
        c,
        'SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM restaurant WHERE id=$1',
        [restaurant],
      );
      if (from < '2000-01-01' || Date.parse(from) > Date.parse(current.today) + 5 * 366 * 86400000)
        reject('Ngày hiệu lực nằm ngoài phạm vi quản lý.', 400);
      const approved = await c.query(
        "SELECT t.id FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id JOIN restaurant r ON r.id=a.restaurant_id WHERE a.restaurant_id=$1 AND t.status='APPROVED' AND (a.ends_at > ($2::date::timestamp AT TIME ZONE r.timezone) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(t.paid_periods,'[]'::jsonb)) p WHERE (p->>'endsAt')::timestamptz > ($2::date::timestamp AT TIME ZONE r.timezone))) LIMIT 1",
        [restaurant, from],
      );
      if (approved.rowCount)
        reject(
          'Ngày hiệu lực ảnh hưởng công đã duyệt. Chọn ngày mới hơn để giữ nguyên lịch sử tiền lương.',
        );
      const closed = await c.query(
        "SELECT id FROM payroll_run WHERE restaurant_id=$1 AND status<>'DRAFT' AND period_end>$2::date LIMIT 1",
        [restaurant, from],
      );
      if (closed.rowCount) reject('Ngày hiệu lực ảnh hưởng kỳ lương đã chốt.');
      const row = await one(
        c,
        `INSERT INTO workforce_pay_policy(restaurant_id,effective_from,night_premium_percent,overtime_weekday_percent,rest_day_percent,holiday_percent,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${policyColumns}`,
        [restaurant, from, night, ot, rest, holiday, r.identity!.id],
      );
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        'SET_WORKFORCE_PAY_POLICY',
        'WORKFORCE_PAY_POLICY',
        row.id,
        'Ban hành chính sách tính công theo đơn giá nhân viên',
        row,
      );
      return row;
    }),
  );
  app.post('/core/workforce/calendar', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        day = date(b.date),
        kind = text(b.kind),
        name = text(b.name, 120);
      if (!['HOLIDAY', 'WEEKLY_REST'].includes(kind))
        reject('Chọn ngày lễ hoặc ngày nghỉ hằng tuần.', 400);
      const userId = kind === 'WEEKLY_REST' ? uuid(b.userId) : null;
      if (kind === 'HOLIDAY' && b.userId) reject('Ngày lễ áp dụng chung cho nhà hàng.', 400);
      if (userId) await employee(c, userId, restaurant);
      const current = await one(
        c,
        'SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM restaurant WHERE id=$1',
        [restaurant],
      );
      if (day < '2000-01-01' || Date.parse(day) > Date.parse(current.today) + 5 * 366 * 86400000)
        reject('Ngày nằm ngoài phạm vi quản lý.', 400);
      await assertCalendarEditable(c, restaurant, day, userId);
      const duplicate = (
        await c.query(
          'SELECT id FROM workforce_calendar_day WHERE restaurant_id=$1 AND date=$2 AND kind=$3 AND user_id IS NOT DISTINCT FROM $4::uuid',
          [restaurant, day, kind, userId],
        )
      ).rows[0];
      if (duplicate) reject('Ngày lễ hoặc ngày nghỉ này đã được khai báo.');
      const row = await one(
        c,
        'INSERT INTO workforce_calendar_day(restaurant_id,date,kind,user_id,name,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,date::text AS date,kind,user_id,name,created_at',
        [restaurant, day, kind, userId, name, r.identity!.id],
      );
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        'ADD_PAY_CALENDAR',
        'WORKFORCE_CALENDAR_DAY',
        row.id,
        'Khai báo lịch ngày lễ hoặc ngày nghỉ',
        row,
      );
      return row;
    }),
  );
  app.delete('/core/workforce/calendar/:id', admin, async (r) =>
    tx(async (c) => {
      const row = await one(
        c,
        `SELECT ${calendarColumns} FROM workforce_calendar_day d LEFT JOIN app_user u ON u.id=d.user_id WHERE d.id=$1 AND d.restaurant_id=$2 FOR UPDATE OF d`,
        [idParam(r), restaurant],
      );
      await assertCalendarEditable(c, restaurant, row.date, row.user_id);
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        'REMOVE_PAY_CALENDAR',
        'WORKFORCE_CALENDAR_DAY',
        row.id,
        'Gỡ ngày chưa dùng trong công được duyệt',
        row,
      );
      await c.query('DELETE FROM workforce_calendar_day WHERE id=$1', [row.id]);
      return { status: 'ok' };
    }),
  );
}
