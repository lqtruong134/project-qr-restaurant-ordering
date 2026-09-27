import type { FastifyInstance } from 'fastify';
import { readPolicy } from '../risk/policy.service.js';
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
} from '../shared/core-persistence.js';
import {
  assertOpenPeriod,
  assignmentQuery,
  employee,
  timestamp,
  workforceTransaction,
} from './workforce.service.js';

export function registerWorkforce(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { config: { permission: 'admin.workspace' } },
    self = { config: { authenticated: true } };
  const tx = <T>(fn: Parameters<typeof workforceTransaction<T>>[2]) =>
    workforceTransaction(db, restaurant, fn);
  app.get('/core/workforce', admin, async () => {
    const [shifts, assignments, rates] = await Promise.all([
      db.pool.query(
        'SELECT * FROM work_shift WHERE restaurant_id=$1 ORDER BY starts_at DESC LIMIT 500',
        [restaurant],
      ),
      db.pool.query(
        assignmentQuery +
          ' WHERE a.restaurant_id=$1 ORDER BY a.starts_at DESC,u.username LIMIT 1000',
        [restaurant],
      ),
      db.pool.query(
        'SELECT p.*,u.username,u.display_name FROM employee_pay_rate p JOIN app_user u ON u.id=p.user_id WHERE p.restaurant_id=$1 ORDER BY p.effective_from DESC LIMIT 1000',
        [restaurant],
      ),
    ]);
    return { shifts: shifts.rows, assignments: assignments.rows, rates: rates.rows };
  });
  app.get('/core/workforce/me', self, async (r) => {
    if (r.identity!.role === 'ADMIN') return { assignments: [] };
    return {
      assignments: (
        await db.pool.query(
          assignmentQuery +
            ' WHERE a.restaurant_id=$1 AND a.user_id=$2 ORDER BY a.starts_at DESC LIMIT 200',
          [restaurant, r.identity!.id],
        )
      ).rows,
    };
  });
  app.post('/core/workforce/shifts', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        start = timestamp(b.startsAt),
        end = timestamp(b.endsAt),
        breakMinutes = integer(b.breakMinutes, 0, 240);
      const { policy } = await readPolicy(c, restaurant);
      const duration = (Date.parse(end) - Date.parse(start)) / 60000;
      if (
        duration <= breakMinutes ||
        duration > Number(policy.SHIFT_MAX_MINUTES) ||
        breakMinutes > Number(policy.SHIFT_MAX_BREAK_MINUTES)
      )
        reject('Thời lượng ca hoặc giờ nghỉ vượt cấu hình nhà hàng.', 400);
      await assertOpenPeriod(c, restaurant, start);
      return one(
        c,
        'INSERT INTO work_shift(restaurant_id,code,name,starts_at,ends_at,break_minutes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [restaurant, text(b.code, 64), text(b.name, 120), start, end, breakMinutes, r.identity!.id],
      );
    }),
  );
  app.post('/core/workforce/assignments', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        user = await employee(c, uuid(b.userId), restaurant);
      const shift = await one(c, 'SELECT * FROM work_shift WHERE id=$1 AND restaurant_id=$2', [
        uuid(b.shiftId),
        restaurant,
      ]);
      await assertOpenPeriod(c, restaurant, shift.starts_at);
      const area = b.areaId ? uuid(b.areaId) : null;
      if (area)
        await one(c, 'SELECT id FROM dining_area WHERE id=$1 AND restaurant_id=$2 AND is_active', [
          area,
          restaurant,
        ]);
      if (
        (
          await c.query(
            "SELECT id FROM shift_assignment WHERE user_id=$1 AND status='ASSIGNED' AND starts_at<$3 AND ends_at>$2",
            [user.id, shift.starts_at, shift.ends_at],
          )
        ).rowCount
      )
        reject('Nhân viên đã có ca làm trùng giờ.');
      return one(
        c,
        'INSERT INTO shift_assignment(restaurant_id,shift_id,user_id,area_id,starts_at,ends_at,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [restaurant, shift.id, user.id, area, shift.starts_at, shift.ends_at, r.identity!.id],
      );
    }),
  );
  app.post('/core/workforce/assignments/:id/cancel', admin, async (r) =>
    tx(async (c) => {
      const a = await one(
        c,
        'SELECT * FROM shift_assignment WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [idParam(r), restaurant],
      );
      await assertOpenPeriod(c, restaurant, a.starts_at);
      if (
        a.status !== 'ASSIGNED' ||
        (await c.query('SELECT id FROM attendance_record WHERE assignment_id=$1', [a.id])).rowCount
      )
        reject('Không thể hủy phân công đã chấm công hoặc đã hủy.');
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason) VALUES($1,$2,'CANCEL_ASSIGNMENT','SHIFT_ASSIGNMENT',$3,$4)",
        [restaurant, r.identity!.id, a.id, text(object(r.body).reason, 500)],
      );
      return one(
        c,
        "UPDATE shift_assignment SET status='CANCELLED',cancellation_reason=$2 WHERE id=$1 RETURNING *",
        [a.id, text(object(r.body).reason, 500)],
      );
    }),
  );
  for (const action of ['check-in', 'check-out'])
    app.post('/core/workforce/assignments/:id/' + action, self, async (r) =>
      tx(async (c) => {
        const a = await one(
          c,
          'SELECT * FROM shift_assignment WHERE id=$1 AND restaurant_id=$2 AND user_id=$3 FOR UPDATE',
          [idParam(r), restaurant, r.identity!.id],
        );
        if (a.status !== 'ASSIGNED') reject('Phân công đã hủy.');
        await assertOpenPeriod(c, restaurant, a.starts_at);
        const now = Date.now(),
          start = new Date(a.starts_at).getTime(),
          end = new Date(a.ends_at).getTime();
        const { policy } = await readPolicy(c, restaurant);
        const previous = (
          await c.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id])
        ).rows[0];
        if (action === 'check-in' && previous?.checked_in_at) return previous;
        if (action === 'check-out' && previous?.checked_out_at) return previous;
        if (action === 'check-in') {
          if (now < start - Number(policy.CLOCK_IN_EARLY_MINUTES) * 60000 || now > end)
            reject('Chưa đến cửa sổ vào ca hoặc ca đã kết thúc.');
          return one(
            c,
            'INSERT INTO attendance_record(restaurant_id,assignment_id,checked_in_at) VALUES($1,$2,clock_timestamp()) RETURNING *',
            [restaurant, a.id],
          );
        }
        if (now > end + Number(policy.CLOCK_OUT_LATE_MINUTES) * 60000)
          reject('Đã quá hạn tự ghi nhận ra ca. Hãy liên hệ quản trị để duyệt công.');
        return one(
          c,
          "UPDATE attendance_record SET checked_out_at=clock_timestamp() WHERE assignment_id=$1 AND checked_in_at IS NOT NULL AND checked_out_at IS NULL AND status='RECORDED' RETURNING *",
          [a.id],
        );
      }),
    );
  app.post('/core/workforce/pay-rates', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        user = await employee(c, uuid(b.userId), restaurant),
        from = timestamp(b.effectiveFrom),
        rate = money(b.hourlyRate);
      if (BigInt(rate) < 1000n || BigInt(rate) > 10000000n)
        reject('Đơn giá giờ từ 1.000 đến 10.000.000 đồng.', 400);
      if (
        (
          await c.query(
            "SELECT t.id FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE a.user_id=$1 AND a.starts_at>=$2 AND t.status='APPROVED'",
            [user.id, from],
          )
        ).rowCount
      )
        reject(
          'Không thay đổi đơn giá hồi tố cho ca đã duyệt công. Hãy chọn ngày hiệu lực mới hơn.',
        );
      return one(
        c,
        'INSERT INTO employee_pay_rate(restaurant_id,user_id,effective_from,hourly_rate,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [restaurant, user.id, from, rate, text(b.reason, 500), r.identity!.id],
      );
    }),
  );
  app.post('/core/workforce/assignments/:id/approve', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        a = await one(
          c,
          'SELECT a.*,s.break_minutes FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id WHERE a.id=$1 AND a.restaurant_id=$2 FOR UPDATE OF a',
          [idParam(r), restaurant],
        );
      if (a.status !== 'ASSIGNED' || new Date(a.ends_at).getTime() > Date.now())
        reject('Chỉ duyệt công sau khi ca kết thúc.');
      await assertOpenPeriod(c, restaurant, a.starts_at);
      const minutes = integer(b.minutes, 0, 960),
        note = text(b.note, 500);
      const outcome =
        b.outcome === undefined ? (minutes === 0 ? 'ABSENT' : 'MISSED_CLOCK') : text(b.outcome);
      if (!['WORKED', 'ABSENT', 'LEAVE', 'MISSED_CLOCK'].includes(outcome))
        reject('Chọn loại giờ công hợp lệ.', 400);
      if (
        (['ABSENT', 'LEAVE'].includes(outcome) && minutes !== 0) ||
        (['WORKED', 'MISSED_CLOCK'].includes(outcome) && minutes === 0)
      )
        reject('Vắng/nghỉ cần 0 phút; làm việc hoặc bổ sung chấm công cần số phút lớn hơn 0.', 400);
      const prior = (
        await c.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id])
      ).rows[0];
      if (prior?.status === 'APPROVED') {
        if (
          prior.approved_minutes === minutes &&
          prior.outcome === outcome &&
          prior.review_note === note
        )
          return prior;
        reject('Giờ công đã được duyệt; không được ghi đè.');
      }
      if (outcome === 'WORKED' && (!prior?.checked_in_at || !prior?.checked_out_at))
        reject('Thiếu giờ vào/ra. Chọn bổ sung chấm công và ghi rõ lý do.', 400);
      const rate = await one(
        c,
        'SELECT hourly_rate FROM employee_pay_rate WHERE user_id=$1 AND effective_from<=$2 ORDER BY effective_from DESC LIMIT 1',
        [a.user_id, a.starts_at],
      );
      await c.query(
        'INSERT INTO attendance_record(restaurant_id,assignment_id) VALUES($1,$2) ON CONFLICT(assignment_id) DO NOTHING',
        [restaurant, a.id],
      );
      return one(
        c,
        "UPDATE attendance_record SET status='APPROVED',approved_minutes=$2,hourly_rate_snapshot=$3,amount=$4,approved_by=$5,approved_at=now(),review_note=$6,outcome=$7 WHERE assignment_id=$1 AND status='RECORDED' RETURNING *",
        [
          a.id,
          minutes,
          rate.hourly_rate,
          ((BigInt(minutes) * BigInt(rate.hourly_rate) + 30n) / 60n).toString(),
          r.identity!.id,
          note,
          outcome,
        ],
      );
    }),
  );
}
