import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  integer,
  money,
  object,
  one,
  reject,
  text,
  uuid,
  type Connection,
} from '../shared/core-persistence.js';
import { readPolicy } from '../risk/policy.service.js';
import {
  date,
  assertOpenPeriod,
  assertAssignmentAvailable,
  employee,
  workforceTransaction,
} from './workforce.service.js';

export async function workforceAudit(
  c: Connection,
  restaurant: string,
  actor: string,
  action: string,
  type: string,
  id: string,
  reason: string,
  details: unknown,
) {
  await c.query(
    'INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [restaurant, actor, action, type, id, reason, JSON.stringify(details)],
  );
}
export function registerTemplates(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { config: { permission: 'admin.workspace' } };
  const tx = <T>(fn: Parameters<typeof workforceTransaction<T>>[2]) =>
    workforceTransaction(db, restaurant, fn);
  const fields = async (c: Connection, input: unknown) => {
    const b = object(input),
      start = text(b.startTime),
      end = text(b.endTime);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end))
      reject('Giờ ca cần có dạng giờ:phút hợp lệ.', 400);
    if (
      typeof b.endsNextDay !== 'boolean' ||
      typeof b.hasBreak !== 'boolean' ||
      typeof b.useShiftRate !== 'boolean'
    )
      reject('Chọn rõ ca qua đêm, thời gian nghỉ và cách dùng đơn giá.', 400);
    const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    const duration = minutes(end) - minutes(start) + (b.endsNextDay ? 1440 : 0);
    const unpaid = b.hasBreak ? integer(b.breakMinutes, 1, 240) : 0;
    const { policy } = await readPolicy(c, restaurant);
    if (
      duration <= unpaid ||
      duration > Number(policy.SHIFT_MAX_MINUTES) ||
      unpaid > Number(policy.SHIFT_MAX_BREAK_MINUTES)
    )
      reject('Thời lượng ca phải lớn hơn giờ nghỉ và nằm trong giới hạn nhà hàng.', 400);
    const rate = b.useShiftRate ? money(b.hourlyRate) : null;
    if (rate !== null && (BigInt(rate) < 1000n || BigInt(rate) > 10000000n))
      reject('Đơn giá giờ từ 1.000 đến 10.000.000 đồng.', 400);
    return [
      text(b.code, 64),
      text(b.name, 120),
      start,
      end,
      b.endsNextDay,
      unpaid,
      rate,
      integer(b.sortOrder ?? 0, 0, 10000),
    ];
  };
  app.post('/core/workforce/templates', admin, async (r) =>
    tx(async (c) => {
      const values = await fields(c, r.body);
      const t = await one(
        c,
        'INSERT INTO shift_template(restaurant_id,code,name,start_time,end_time,ends_next_day,break_minutes,hourly_rate_override,sort_order,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        [restaurant, ...values, r.identity!.id],
      );
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        'CREATE_SHIFT_TEMPLATE',
        'SHIFT_TEMPLATE',
        t.id,
        'Tạo mẫu ca dùng chung',
        t,
      );
      return t;
    }),
  );
  app.patch('/core/workforce/templates/:id', admin, async (r) =>
    tx(async (c) => {
      const old = await one(
        c,
        'SELECT * FROM shift_template WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [idParam(r), restaurant],
      );
      const b = object(r.body);
      if (integer(b.version, 1, 2147483647) !== old.version)
        reject('Mẫu ca đã được cập nhật ở nơi khác. Làm mới và kiểm tra lại trước khi sửa.');
      const values = await fields(c, b),
        reason = text(b.reason, 500);
      if (typeof b.isActive !== 'boolean') reject('Trạng thái mẫu ca không hợp lệ.', 400);
      const t = await one(
        c,
        'UPDATE shift_template SET code=$3,name=$4,start_time=$5,end_time=$6,ends_next_day=$7,break_minutes=$8,hourly_rate_override=$9,sort_order=$10,is_active=$11,version=version+1,updated_at=now() WHERE id=$1 AND restaurant_id=$2 RETURNING *',
        [old.id, restaurant, ...values, b.isActive],
      );
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        b.isActive ? 'UPDATE_SHIFT_TEMPLATE' : 'DISABLE_SHIFT_TEMPLATE',
        'SHIFT_TEMPLATE',
        t.id,
        reason,
        { before: old, after: t },
      );
      return t;
    }),
  );
  app.post('/core/workforce/schedule', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        from = date(b.from),
        to = date(b.to);
      if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 30)
        reject('Chọn khoảng lịch từ 1 đến 31 ngày.', 400);
      if (!Array.isArray(b.templateIds) || b.templateIds.length < 1 || b.templateIds.length > 20)
        reject('Chọn từ 1 đến 20 mẫu ca.', 400);
      const ids = [...new Set(b.templateIds.map(uuid))];
      const templates = (
        await c.query(
          'SELECT * FROM shift_template WHERE restaurant_id=$1 AND id=ANY($2::uuid[]) AND is_active ORDER BY sort_order,id FOR UPDATE',
          [restaurant, ids],
        )
      ).rows;
      if (templates.length !== ids.length)
        reject('Có mẫu ca đã ngừng dùng hoặc không thuộc nhà hàng. Kiểm tra lại lịch.');
      const calendar = await one(c, 'SELECT timezone FROM restaurant WHERE id=$1', [restaurant]);
      const { policy } = await readPolicy(c, restaurant);
      const shifts = [];
      const counts = {
        createdShifts: 0,
        existingShifts: 0,
        createdAssignments: 0,
        existingAssignments: 0,
      };
      for (
        let day = from;
        day <= to;
        day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
      )
        for (const t of templates) {
          const times = await one(
            c,
            'SELECT ($1::date+$2::time) AT TIME ZONE $5 AS start, (($1::date+CASE WHEN $4::boolean THEN 1 ELSE 0 END)+$3::time) AT TIME ZONE $5 AS finish',
            [day, t.start_time, t.end_time, t.ends_next_day, calendar.timezone],
          );
          await assertOpenPeriod(c, restaurant, times.start);
          const old = (
            await c.query(
              'SELECT *,scheduled_date::text AS scheduled_date FROM work_shift WHERE template_id=$1 AND scheduled_date=$2',
              [t.id, day],
            )
          ).rows[0];
          if (old) {
            shifts.push(old);
            counts.existingShifts++;
            continue;
          }
          const duration =
            (new Date(times.finish).getTime() - new Date(times.start).getTime()) / 60000;
          if (
            duration <= Number(t.break_minutes) ||
            duration > Number(policy.SHIFT_MAX_MINUTES) ||
            Number(t.break_minutes) > Number(policy.SHIFT_MAX_BREAK_MINUTES)
          )
            reject(
              `Mẫu ca “${t.name}” có thời lượng hoặc giờ nghỉ vượt cấu hình nhà hàng hiện tại. Kiểm tra mẫu ca trước khi lập lịch mới.`,
              400,
            );
          const shift = await one(
            c,
            'INSERT INTO work_shift(restaurant_id,code,name,starts_at,ends_at,break_minutes,created_by,template_id,scheduled_date,template_version,hourly_rate_override,attendance_grace_minutes,clock_in_early_minutes,clock_out_late_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *,scheduled_date::text AS scheduled_date',
            [
              restaurant,
              day + '-' + t.id,
              t.name,
              times.start,
              times.finish,
              t.break_minutes,
              r.identity!.id,
              t.id,
              day,
              t.version,
              t.hourly_rate_override,
              policy.ATTENDANCE_GRACE_MINUTES,
              policy.CLOCK_IN_EARLY_MINUTES,
              policy.CLOCK_OUT_LATE_MINUTES,
            ],
          );
          await workforceAudit(
            c,
            restaurant,
            r.identity!.id,
            'SCHEDULE_SHIFT',
            'WORK_SHIFT',
            shift.id,
            'Lập lịch từ mẫu ca',
            { templateId: t.id, templateVersion: t.version, date: day },
          );
          shifts.push(shift);
          counts.createdShifts++;
        }
      const assignments = [];
      if (b.userIds !== undefined) {
        if (!Array.isArray(b.userIds) || b.userIds.length > 50)
          reject('Chọn tối đa 50 nhân viên.', 400);
        const users = [...new Set(b.userIds.map(uuid))],
          area = b.areaId ? uuid(b.areaId) : null;
        if (area)
          await one(
            c,
            'SELECT id FROM dining_area WHERE id=$1 AND restaurant_id=$2 AND is_active',
            [area, restaurant],
          );
        for (const id of users) {
          const user = await employee(c, id, restaurant);
          for (const shift of shifts) {
            const prior = (
              await c.query(
                "SELECT * FROM shift_assignment WHERE shift_id=$1 AND user_id=$2 AND status='ASSIGNED'",
                [shift.id, id],
              )
            ).rows[0];
            if (prior) {
              assignments.push(prior);
              counts.existingAssignments++;
              continue;
            }
            await assertAssignmentAvailable(c, restaurant, user, shift, true);
            const a = await one(
              c,
              'INSERT INTO shift_assignment(restaurant_id,shift_id,user_id,area_id,starts_at,ends_at,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
              [restaurant, shift.id, id, area, shift.starts_at, shift.ends_at, r.identity!.id],
            );
            await workforceAudit(
              c,
              restaurant,
              r.identity!.id,
              'ASSIGN_SHIFT',
              'SHIFT_ASSIGNMENT',
              a.id,
              'Phân ca theo mẫu',
              { shiftId: shift.id, userId: id },
            );
            assignments.push(a);
            counts.createdAssignments++;
          }
        }
      }
      return { shifts, assignments, counts };
    }),
  );
}
