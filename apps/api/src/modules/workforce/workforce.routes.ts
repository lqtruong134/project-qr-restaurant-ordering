import type { FastifyInstance } from 'fastify';
import { registerTemplates, workforceAudit } from './templates.routes.js';
import { readPolicy } from '../risk/policy.service.js';
import { registerPaySettings } from './pay.routes.js';
import { policyActive, previewPay } from './pay.service.js';
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
  attendanceSummary,
  assertAssignmentAvailable,
  assertOpenPeriod,
  assignmentQuery,
  date,
  employee,
  timestamp,
  workforceTransaction,
} from './workforce.service.js';

export function registerWorkforce(app: FastifyInstance, db: Database, restaurant: string) {
  registerTemplates(app, db, restaurant);
  registerPaySettings(app, db, restaurant);
  const admin = { config: { permission: 'admin.workspace' } },
    self = { config: { authenticated: true } };
  const tx = <T>(fn: Parameters<typeof workforceTransaction<T>>[2]) =>
    workforceTransaction(db, restaurant, fn);
  app.get('/core/workforce', admin, async (r) => {
    const q = object(r.query);
    const from = q.from === undefined ? null : date(q.from),
      to = q.to === undefined ? null : date(q.to);
    if (
      (from === null) !== (to === null) ||
      (from && to && (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 30))
    )
      reject('Chọn khoảng lịch từ 1 đến 31 ngày.', 400);
    const range = from && to;
    const shiftRange = ` AND ends_at>($2::date::timestamp AT TIME ZONE (SELECT timezone FROM restaurant WHERE id=$1)) AND starts_at<(($3::date+1)::timestamp AT TIME ZONE (SELECT timezone FROM restaurant WHERE id=$1))`;
    const assignmentRange = shiftRange
      .replaceAll('ends_at', 'a.ends_at')
      .replaceAll('starts_at', 'a.starts_at');
    const values = range ? [restaurant, from, to] : [restaurant];
    const [shifts, assignments, rates, templates] = await Promise.all([
      db.pool.query(
        'SELECT *,scheduled_date::text AS scheduled_date FROM work_shift WHERE restaurant_id=$1' +
          (range ? shiftRange : '') +
          ' ORDER BY starts_at DESC' +
          (range ? '' : ' LIMIT 500'),
        values,
      ),
      db.pool.query(
        assignmentQuery +
          ' WHERE a.restaurant_id=$1' +
          (range ? assignmentRange : '') +
          ' ORDER BY a.starts_at DESC,u.username' +
          (range ? '' : ' LIMIT 1000'),
        values,
      ),
      db.pool.query(
        'SELECT p.*,u.username,u.display_name FROM employee_pay_rate p JOIN app_user u ON u.id=p.user_id WHERE p.restaurant_id=$1 ORDER BY p.effective_from DESC LIMIT 1000',
        [restaurant],
      ),
      db.pool.query(
        'SELECT t.*,(SELECT count(*)::int FROM work_shift s WHERE s.template_id=t.id) AS scheduled_count FROM shift_template t WHERE t.restaurant_id=$1 ORDER BY t.sort_order,t.name',
        [restaurant],
      ),
    ]);
    return {
      templates: templates.rows,
      shifts: shifts.rows,
      assignments: assignments.rows.map((a) => attendanceSummary(a)),
      rates: rates.rows,
    };
  });
  app.get('/core/workforce/me', self, async (r) => {
    if (r.identity!.role === 'ADMIN') return { assignments: [] };
    const q = object(r.query),
      from = q.from === undefined ? null : date(q.from),
      to = q.to === undefined ? null : date(q.to);
    if (
      (from === null) !== (to === null) ||
      (from && to && (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 30))
    )
      reject('Chọn khoảng lịch từ 1 đến 31 ngày.', 400);
    const range = from && to;
    const currentAssignments = range
      ? (
          await db.pool.query(
            assignmentQuery +
              ` WHERE a.restaurant_id=$1 AND a.user_id=$2 AND a.status='ASSIGNED' AND COALESCE(t.status,'RECORDED')<>'APPROVED' AND t.checked_out_at IS NULL AND (t.checked_in_at IS NOT NULL OR a.ends_at>=now()) ORDER BY CASE WHEN t.checked_in_at IS NOT NULL THEN 0 ELSE 1 END,a.starts_at LIMIT 1`,
            [restaurant, r.identity!.id],
          )
        ).rows.map((a) => attendanceSummary(a))
      : [];
    return {
      currentAssignments,
      assignments: (
        await db.pool.query(
          assignmentQuery +
            ' WHERE a.restaurant_id=$1 AND a.user_id=$2' +
            (range
              ? ` AND a.ends_at>($3::date::timestamp AT TIME ZONE (SELECT timezone FROM restaurant WHERE id=$1)) AND a.starts_at<(($4::date+1)::timestamp AT TIME ZONE (SELECT timezone FROM restaurant WHERE id=$1))`
              : '') +
            ' ORDER BY a.starts_at DESC' +
            (range ? '' : ' LIMIT 200'),
          range ? [restaurant, r.identity!.id, from, to] : [restaurant, r.identity!.id],
        )
      ).rows.map((a) => attendanceSummary(a)),
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
        'INSERT INTO work_shift(restaurant_id,code,name,starts_at,ends_at,break_minutes,created_by,attendance_grace_minutes,clock_in_early_minutes,clock_out_late_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        [
          restaurant,
          text(b.code, 64),
          text(b.name, 120),
          start,
          end,
          breakMinutes,
          r.identity!.id,
          policy.ATTENDANCE_GRACE_MINUTES,
          policy.CLOCK_IN_EARLY_MINUTES,
          policy.CLOCK_OUT_LATE_MINUTES,
        ],
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
      await assertAssignmentAvailable(c, restaurant, user, shift);
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
          'SELECT a.*,s.clock_in_early_minutes,s.clock_out_late_minutes FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id WHERE a.id=$1 AND a.restaurant_id=$2 AND a.user_id=$3 FOR UPDATE OF a',
          [idParam(r), restaurant, r.identity!.id],
        );
        if (a.status !== 'ASSIGNED') reject('Phân công đã hủy.');
        await assertOpenPeriod(c, restaurant, a.starts_at);
        const now = Date.now(),
          start = new Date(a.starts_at).getTime(),
          end = new Date(a.ends_at).getTime();
        const previous = (
          await c.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id])
        ).rows[0];
        if (action === 'check-in' && previous?.checked_in_at) return previous;
        if (action === 'check-out' && previous?.checked_out_at) return previous;
        if (previous?.status === 'APPROVED')
          reject('Giờ công đã được duyệt; không thể bổ sung dấu chấm công gốc.');
        if (action === 'check-in') {
          const open = await c.query(
            "SELECT t.id FROM attendance_record t JOIN shift_assignment x ON x.id=t.assignment_id WHERE x.user_id=$1 AND t.status='RECORDED' AND t.checked_in_at IS NOT NULL AND t.checked_out_at IS NULL AND x.id<>$2",
            [a.user_id, a.id],
          );
          if (open.rowCount)
            reject('Bạn còn ca chưa ghi nhận ra. Hãy ra ca hoặc nhờ quản trị xử lý công trước.');
          if (now < start - Number(a.clock_in_early_minutes) * 60000 || now > end)
            reject('Chưa đến cửa sổ vào ca hoặc ca đã kết thúc.');
          return one(
            c,
            'INSERT INTO attendance_record(restaurant_id,assignment_id,checked_in_at) VALUES($1,$2,clock_timestamp()) RETURNING *',
            [restaurant, a.id],
          );
        }
        if (now > end + Number(a.clock_out_late_minutes) * 60000)
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
      if (Date.parse(from) % 60000)
        reject('Ngày hiệu lực đơn giá cần giờ:phút, không nhập giây.', 400);
      if (BigInt(rate) < 1000n || BigInt(rate) > 10000000n)
        reject('Đơn giá giờ từ 1.000 đến 10.000.000 đồng.', 400);
      if (
        (
          await c.query(
            "SELECT t.id FROM attendance_record t JOIN shift_assignment a ON a.id=t.assignment_id WHERE a.user_id=$1 AND t.status='APPROVED' AND (a.ends_at>$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(t.paid_periods,'[]'::jsonb)) p WHERE (p->>'endsAt')::timestamptz>$2))",
            [user.id, from],
          )
        ).rowCount
      )
        reject(
          'Không thay đổi đơn giá hồi tố cho ca đã duyệt công. Hãy chọn ngày hiệu lực mới hơn.',
        );
      const created = await one(
        c,
        'INSERT INTO employee_pay_rate(restaurant_id,user_id,effective_from,hourly_rate,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [restaurant, user.id, from, rate, text(b.reason, 500), r.identity!.id],
      );
      await workforceAudit(
        c,
        restaurant,
        r.identity!.id,
        'SET_PAY_RATE',
        'EMPLOYEE_PAY_RATE',
        created.id,
        text(b.reason, 500),
        created,
      );
      return created;
    }),
  );
  app.post('/core/workforce/assignments/:id/pay-preview', admin, async (r) =>
    tx(async (c) => {
      const a = await one(
        c,
        'SELECT a.*,s.break_minutes,s.attendance_grace_minutes,s.clock_out_late_minutes FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id WHERE a.id=$1 AND a.restaurant_id=$2 FOR UPDATE OF a',
        [idParam(r), restaurant],
      );
      if (a.status !== 'ASSIGNED' || new Date(a.ends_at).getTime() > Date.now())
        reject('Chỉ kiểm tra công sau khi ca kết thúc.');
      if (!(await policyActive(c, restaurant, a.starts_at)))
        reject('Ca này thuộc cách tính công cũ; chưa áp dụng chính sách mới.', 400);
      await assertOpenPeriod(c, restaurant, a.starts_at);
      const prior = (
        await c.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id])
      ).rows[0];
      if (prior?.status === 'APPROVED')
        return {
          approvedMinutes: prior.approved_minutes,
          hourlyRate: String(prior.hourly_rate_snapshot),
          amount: String(prior.amount),
          payComponents: prior.pay_components,
          paySnapshot: prior.pay_snapshot,
          paidPeriods: prior.paid_periods,
        };
      return previewPay(c, restaurant, a, prior, object(r.body));
    }),
  );
  app.post('/core/workforce/assignments/:id/approve', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        a = await one(
          c,
          'SELECT a.*,s.break_minutes,s.hourly_rate_override,s.attendance_grace_minutes,s.clock_out_late_minutes FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id WHERE a.id=$1 AND a.restaurant_id=$2 FOR UPDATE OF a',
          [idParam(r), restaurant],
        );
      if (a.status !== 'ASSIGNED' || new Date(a.ends_at).getTime() > Date.now())
        reject('Chỉ duyệt công sau khi ca kết thúc.');
      await assertOpenPeriod(c, restaurant, a.starts_at);
      const policyPrior = (
        await c.query('SELECT * FROM attendance_record WHERE assignment_id=$1', [a.id])
      ).rows[0];
      if (
        policyPrior?.pay_snapshot ||
        (policyPrior?.status !== 'APPROVED' && (await policyActive(c, restaurant, a.starts_at)))
      ) {
        if (policyPrior?.status === 'APPROVED') {
          if (
            b.expectedAmount !== undefined &&
            money(b.expectedAmount, true) !== String(policyPrior.amount)
          )
            reject('Căn cứ tiền công vừa thay đổi. Tính lại tiền dự kiến trước khi duyệt.');
          const requestedMinutes = integer(b.minutes, 0, 960);
          const requestedOutcome =
            b.outcome === undefined
              ? requestedMinutes === 0
                ? 'ABSENT'
                : 'MISSED_CLOCK'
              : text(b.outcome);
          const requestedMode =
            b.approvalMode === undefined
              ? requestedMinutes === 0
                ? 'ZERO'
                : 'EXCEPTION'
              : text(b.approvalMode);
          const incoming = b.paidPeriods === undefined ? policyPrior.paid_periods : b.paidPeriods;
          const normalize = (input: unknown) =>
            Array.isArray(input)
              ? input
                  .map((p) => {
                    const row = object(p);
                    return {
                      startsAt: timestamp(row.startsAt),
                      endsAt: timestamp(row.endsAt),
                      kind: row.kind,
                    };
                  })
                  .sort(
                    (x, y) =>
                      x.startsAt.localeCompare(y.startsAt) ||
                      String(x.kind).localeCompare(String(y.kind)),
                  )
              : input;
          if (
            policyPrior.approved_minutes === requestedMinutes &&
            policyPrior.outcome === requestedOutcome &&
            policyPrior.review_note === text(b.note, 500) &&
            policyPrior.approval_mode === requestedMode &&
            JSON.stringify(normalize(incoming)) ===
              JSON.stringify(normalize(policyPrior.paid_periods))
          )
            return policyPrior;
          reject('Giờ công đã được duyệt; không được ghi đè.');
        }
        const calculated = await previewPay(c, restaurant, a, policyPrior, b);
        if (b.expectedAmount !== undefined && money(b.expectedAmount, true) !== calculated.amount)
          reject('Căn cứ tiền công vừa thay đổi. Tính lại tiền dự kiến trước khi duyệt.');
        await workforceAudit(
          c,
          restaurant,
          r.identity!.id,
          'APPROVE_ATTENDANCE',
          'SHIFT_ASSIGNMENT',
          a.id,
          calculated.note,
          {
            ...calculated,
            originalPunches: { in: policyPrior?.checked_in_at, out: policyPrior?.checked_out_at },
          },
        );
        await c.query(
          'INSERT INTO attendance_record(restaurant_id,assignment_id) VALUES($1,$2) ON CONFLICT(assignment_id) DO NOTHING',
          [restaurant, a.id],
        );
        return one(
          c,
          "UPDATE attendance_record SET status='APPROVED',approved_minutes=$2,hourly_rate_snapshot=$3,amount=$4,approved_by=$5,approved_at=now(),review_note=$6,outcome=$7,approval_mode=$8,rate_source='EMPLOYEE',pay_components=$9,pay_snapshot=$10,paid_periods=$11 WHERE assignment_id=$1 AND status='RECORDED' RETURNING *",
          [
            a.id,
            calculated.approvedMinutes,
            calculated.hourlyRate,
            calculated.amount,
            r.identity!.id,
            calculated.note,
            calculated.outcome,
            calculated.approvalMode,
            JSON.stringify(calculated.payComponents),
            JSON.stringify(calculated.paySnapshot),
            JSON.stringify(calculated.paidPeriods),
          ],
        );
      }
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
      const summary = attendanceSummary({ ...a, ...prior });
      const mode =
        b.approvalMode === undefined
          ? minutes === 0
            ? 'ZERO'
            : 'EXCEPTION'
          : text(b.approvalMode);
      if (!['FULL', 'ACTUAL', 'ZERO', 'EXCEPTION'].includes(mode))
        reject('Chọn cách tính công hợp lệ.', 400);
      if (mode === 'FULL' && minutes !== summary.scheduled_minutes)
        reject('Tính đủ ca phải bằng công chuẩn.', 400);
      if (
        mode === 'ACTUAL' &&
        (!prior?.checked_in_at || !prior?.checked_out_at || minutes !== summary.actual_minutes)
      )
        reject('Tính thời gian thực tế cần đủ dấu chấm công và đúng công trong lịch.', 400);
      if (mode === 'ZERO' && minutes !== 0) reject('Không tính công cần 0 giờ công.', 400);
      const limit =
        mode === 'FULL'
          ? summary.scheduled_minutes
          : outcome === 'WORKED'
            ? summary.actual_minutes
            : summary.scheduled_minutes;
      if (minutes > limit && b.approveExtra !== true)
        reject(
          'Số phút vượt thời gian trong ca. Cần xác nhận duyệt giờ ngoại lệ và ghi rõ lý do.',
          400,
        );
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'APPROVE_ATTENDANCE','SHIFT_ASSIGNMENT',$3,$4,$5)",
        [
          restaurant,
          r.identity!.id,
          a.id,
          note,
          JSON.stringify({
            minutes,
            outcome,
            suggestedMinutes: summary.suggested_minutes,
            scheduledMinutes: summary.scheduled_minutes,
            extraApproved: minutes > limit,
            approvalMode: mode,
            classification: summary.classification,
            originalPunches: { in: prior?.checked_in_at, out: prior?.checked_out_at },
            rateSource: a.hourly_rate_override !== null ? 'SHIFT' : 'EMPLOYEE',
          }),
        ],
      );
      const rate =
        a.hourly_rate_override !== null
          ? { hourly_rate: a.hourly_rate_override }
          : await one(
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
        "UPDATE attendance_record SET status='APPROVED',approved_minutes=$2,hourly_rate_snapshot=$3,amount=$4,approved_by=$5,approved_at=now(),review_note=$6,outcome=$7,approval_mode=$8,rate_source=$9 WHERE assignment_id=$1 AND status='RECORDED' RETURNING *",
        [
          a.id,
          minutes,
          rate.hourly_rate,
          ((BigInt(minutes) * BigInt(rate.hourly_rate) + 30n) / 60n).toString(),
          r.identity!.id,
          note,
          outcome,
          mode,
          a.hourly_rate_override !== null ? 'SHIFT' : 'EMPLOYEE',
        ],
      );
    }),
  );
}
