import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  money,
  object,
  one,
  reject,
  text,
  uuid,
  type Connection,
} from '../shared/core-persistence.js';
import { date, workforceTransaction } from './workforce.service.js';

async function eligible(c: Connection, run: Record<string, unknown>) {
  return (
    await c.query(
      `      SELECT a.id AS assignment_id,t.id AS attendance_id,a.user_id,s.name AS shift_name,t.*,u.username,u.display_name
    FROM shift_assignment a JOIN work_shift s ON s.id=a.shift_id JOIN app_user u ON u.id=a.user_id
    JOIN restaurant r ON r.id=a.restaurant_id LEFT JOIN attendance_record t ON t.assignment_id=a.id
    WHERE a.restaurant_id=$1 AND a.status='ASSIGNED'
    AND (a.starts_at AT TIME ZONE r.timezone)::date >= $2::date
    AND (a.starts_at AT TIME ZONE r.timezone)::date < $3::date ORDER BY a.starts_at`,
      [run.restaurant_id, run.period_start, run.period_end],
    )
  ).rows;
}
const slipsSql = `SELECT s.*,COALESCE(sum(l.amount),0)::text AS total_amount FROM payroll_slip s
 LEFT JOIN payroll_line l ON l.payroll_slip_id=s.id`;
export function registerPayroll(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { config: { permission: 'admin.workspace' } },
    self = { config: { authenticated: true } };
  const tx = <T>(fn: Parameters<typeof workforceTransaction<T>>[2]) =>
    workforceTransaction(db, restaurant, fn);
  app.get(
    '/core/payroll',
    admin,
    async () =>
      (
        await db.pool.query(
          `SELECT p.*,COALESCE(sum(l.amount),0)::text AS total_amount,count(DISTINCT s.id)::int AS employee_count
    FROM payroll_run p LEFT JOIN payroll_slip s ON s.payroll_run_id=p.id LEFT JOIN payroll_line l ON l.payroll_slip_id=s.id
    WHERE p.restaurant_id=$1 GROUP BY p.id ORDER BY p.period_start DESC LIMIT 100`,
          [restaurant],
        )
      ).rows,
  );
  app.get('/core/payroll/me', self, async (r) => {
    if (r.identity!.role === 'ADMIN') return { slips: [], runs: [], lines: [] };
    const slips = (
      await db.pool.query(
        slipsSql +
          ` JOIN payroll_run p ON p.id=s.payroll_run_id WHERE s.restaurant_id=$1 AND s.user_id=$2 AND p.status<>'DRAFT'
      GROUP BY s.id ORDER BY s.created_at DESC`,
        [restaurant, r.identity!.id],
      )
    ).rows;
    const runs = (
      await db.pool.query(
        "SELECT DISTINCT p.* FROM payroll_run p JOIN payroll_slip s ON s.payroll_run_id=p.id WHERE s.user_id=$1 AND p.restaurant_id=$2 AND p.status<>'DRAFT'",
        [r.identity!.id, restaurant],
      )
    ).rows;
    const lines = (
      await db.pool.query(
        "SELECT l.* FROM payroll_line l JOIN payroll_slip s ON s.id=l.payroll_slip_id JOIN payroll_run p ON p.id=s.payroll_run_id WHERE s.user_id=$1 AND s.restaurant_id=$2 AND p.status<>'DRAFT' ORDER BY l.created_at",
        [r.identity!.id, restaurant],
      )
    ).rows;
    return { slips, runs, lines };
  });
  app.get('/core/payroll/:id', admin, async (r) =>
    tx(async (c) => {
      const run = await one(c, 'SELECT * FROM payroll_run WHERE id=$1 AND restaurant_id=$2', [
        idParam(r),
        restaurant,
      ]);
      const slips = (
        await c.query(
          slipsSql + ' WHERE s.payroll_run_id=$1 GROUP BY s.id ORDER BY s.username_snapshot',
          [run.id],
        )
      ).rows;
      const lines = (
        await c.query(
          'SELECT l.* FROM payroll_line l JOIN payroll_slip s ON s.id=l.payroll_slip_id WHERE s.payroll_run_id=$1 ORDER BY l.created_at',
          [run.id],
        )
      ).rows;
      return { run, slips, lines };
    }),
  );
  app.post('/core/payroll', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        start = date(b.periodStart),
        end = date(b.periodEnd);
      const current = await one(
        c,
        'SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM restaurant WHERE id=$1',
        [restaurant],
      );
      if (
        end <= start ||
        end > current.today ||
        (Date.parse(end) - Date.parse(start)) / 86400000 > 62
      )
        reject(
          'Kỳ lương phải đã kết thúc, dài từ 1 đến 62 ngày. Ngày kết thúc không tính vào kỳ.',
          400,
        );
      const run = await one(
        c,
        'INSERT INTO payroll_run(restaurant_id,period_start,period_end,created_by) VALUES($1,$2,$3,$4) RETURNING *',
        [restaurant, start, end, r.identity!.id],
      );
      const rows = await eligible(c, run);
      if (!rows.length) reject('Kỳ này chưa có ca làm được phân công.');
      if (rows.some((t) => t.status !== 'APPROVED'))
        reject(
          'Còn ca chưa duyệt công trong kỳ. Duyệt cả ca vắng với 0 phút hoặc hủy phân công chưa chấm công.',
        );
      for (const a of rows) {
        const existing = (
          await c.query('SELECT * FROM payroll_slip WHERE payroll_run_id=$1 AND user_id=$2', [
            run.id,
            a.user_id,
          ])
        ).rows[0];
        const slip =
          existing ??
          (await one(
            c,
            `INSERT INTO payroll_slip(restaurant_id,payroll_run_id,user_id,employee_name_snapshot,username_snapshot)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [restaurant, run.id, a.user_id, a.display_name, a.username],
          ));
        await c.query(
          `INSERT INTO payroll_line(restaurant_id,payroll_slip_id,attendance_id,line_type,description,minutes,hourly_rate_snapshot,amount,created_by)
        VALUES($1,$2,$3,'WORK',$4,$5,$6,$7,$8)`,
          [
            restaurant,
            slip.id,
            a.attendance_id,
            'Công ca ' + a.shift_name,
            a.approved_minutes,
            a.hourly_rate_snapshot,
            a.amount,
            r.identity!.id,
          ],
        );
      }
      return run;
    }),
  );
  app.post('/core/payroll/:id/adjustments', admin, async (r) =>
    tx(async (c) => {
      const b = object(r.body),
        run = await one(
          c,
          "SELECT * FROM payroll_run WHERE id=$1 AND restaurant_id=$2 AND status='DRAFT' FOR UPDATE",
          [idParam(r), restaurant],
        );
      const slip = await one(c, 'SELECT id FROM payroll_slip WHERE id=$1 AND payroll_run_id=$2', [
        uuid(b.slipId),
        run.id,
      ]);
      const type = text(b.type),
        amount = money(b.amount);
      if (!['BONUS', 'DEDUCTION'].includes(type)) reject('Loại điều chỉnh không hợp lệ.', 400);
      return one(
        c,
        'INSERT INTO payroll_line(restaurant_id,payroll_slip_id,line_type,description,amount,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          restaurant,
          slip.id,
          type,
          text(b.description, 500),
          type === 'DEDUCTION' ? '-' + amount : amount,
          r.identity!.id,
        ],
      );
    }),
  );
  app.post('/core/payroll/:id/finalize', admin, async (r) =>
    tx(async (c) => {
      const run = await one(
        c,
        "SELECT * FROM payroll_run WHERE id=$1 AND restaurant_id=$2 AND status='DRAFT' FOR UPDATE",
        [idParam(r), restaurant],
      );
      const rows = await eligible(c, run);
      if (!rows.length || rows.some((t) => t.status !== 'APPROVED'))
        reject('Kỳ này còn ca chưa duyệt công.');
      const captured = (
        await c.query(
          'SELECT l.attendance_id FROM payroll_line l JOIN payroll_slip s ON s.id=l.payroll_slip_id WHERE s.payroll_run_id=$1 AND l.attendance_id IS NOT NULL',
          [run.id],
        )
      ).rows;
      if (
        rows.length !== captured.length ||
        rows.some((t) => !captured.some((l) => l.attendance_id === t.id))
      )
        reject('Giờ công đã thay đổi. Xóa bản nháp rồi lập lại kỳ lương.');
      const totals = (
        await c.query(slipsSql + ' WHERE s.payroll_run_id=$1 GROUP BY s.id', [run.id])
      ).rows;
      if (totals.some((t) => BigInt(t.total_amount) < 0n))
        reject('Khoản khấu trừ không được làm lương thực nhận âm.');
      return one(
        c,
        "UPDATE payroll_run SET status='FINALIZED',finalized_by=$2,finalized_at=now() WHERE id=$1 RETURNING *",
        [run.id, r.identity!.id],
      );
    }),
  );
  app.post('/core/payroll/:id/paid', admin, async (r) =>
    tx((c) =>
      one(
        c,
        "UPDATE payroll_run SET status='PAID',paid_by=$3,paid_at=now(),payment_reference=$4 WHERE id=$1 AND restaurant_id=$2 AND status='FINALIZED' RETURNING *",
        [idParam(r), restaurant, r.identity!.id, text(object(r.body).reference, 300)],
      ),
    ),
  );
  app.delete('/core/payroll/:id', admin, async (r) =>
    tx(async (c) => {
      const p = await one(
        c,
        "SELECT id FROM payroll_run WHERE id=$1 AND restaurant_id=$2 AND status='DRAFT' FOR UPDATE",
        [idParam(r), restaurant],
      );
      await c.query(
        'DELETE FROM payroll_line WHERE payroll_slip_id IN (SELECT id FROM payroll_slip WHERE payroll_run_id=$1)',
        [p.id],
      );
      await c.query('DELETE FROM payroll_slip WHERE payroll_run_id=$1', [p.id]);
      await c.query('DELETE FROM payroll_run WHERE id=$1', [p.id]);
      return { status: 'ok' };
    }),
  );
}
