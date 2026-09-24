import type { Prisma } from '../generated/prisma/client.js';

/** Illustrative rates and seven days of shifts only. Never fabricate attendance or salary payments. */
export async function seedWorkforce(tx: Prisma.TransactionClient, restaurantId: string) {
  const admin = await tx.app_user.findFirstOrThrow({
    where: { restaurant_id: restaurantId, username: 'quyettruong05' },
  });
  if (
    await tx.work_shift.findFirst({
      where: { restaurant_id: restaurantId, code: { startsWith: 'DEMO-CA-' } },
    })
  )
    return;
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const people = await tx.app_user.findMany({
    where: {
      restaurant_id: restaurantId,
      username: { in: ['pv001', 'pv002', 'pv003', 'pv004', 'bep001', 'bep002', 'bep003'] },
      status: 'ACTIVE',
    },
  });
  const area = await tx.dining_area.findFirst({
    where: { restaurant_id: restaurantId, code: 'TRONG-NHA' },
  });
  for (const u of people) {
    if (!(await tx.employee_pay_rate.findFirst({ where: { user_id: u.id } })))
      await tx.employee_pay_rate.create({
        data: {
          restaurant_id: restaurantId,
          user_id: u.id,
          effective_from: new Date(today + 'T00:00:00+07:00'),
          hourly_rate: u.username.startsWith('bep') ? 45000n : 35000n,
          reason: 'Đơn giá minh họa cho dữ liệu demo; quản trị điều chỉnh theo thỏa thuận thực tế.',
          created_by: admin.id,
        },
      });
  }
  for (let d = 0; d < 7; d++) {
    const day = new Date(Date.parse(today + 'T00:00:00Z') + d * 86400000)
      .toISOString()
      .slice(0, 10);
    for (const evening of [false, true]) {
      const starts_at = new Date(day + (evening ? 'T15:00:00+07:00' : 'T09:00:00+07:00'));
      const ends_at = new Date(day + (evening ? 'T23:00:00+07:00' : 'T15:00:00+07:00'));
      const shift = await tx.work_shift.create({
        data: {
          restaurant_id: restaurantId,
          code: 'DEMO-CA-' + day + (evening ? '-CHIEU' : '-SANG'),
          name: evening ? 'Ca chiều tối' : 'Ca sáng trưa',
          starts_at,
          ends_at,
          break_minutes: 30,
          created_by: admin.id,
        },
      });
      for (const u of people.filter(
        (u) => ['pv003', 'pv004', 'bep003'].includes(u.username) === evening,
      )) {
        // Do not overwrite or overlap a manager's pre-existing schedule.
        if (
          await tx.shift_assignment.findFirst({
            where: {
              user_id: u.id,
              status: 'ASSIGNED',
              starts_at: { lt: ends_at },
              ends_at: { gt: starts_at },
            },
          })
        )
          continue;
        await tx.shift_assignment.create({
          data: {
            restaurant_id: restaurantId,
            shift_id: shift.id,
            user_id: u.id,
            area_id: u.username.startsWith('pv') ? area?.id : null,
            starts_at,
            ends_at,
            assigned_by: admin.id,
          },
        });
      }
    }
  }
}
