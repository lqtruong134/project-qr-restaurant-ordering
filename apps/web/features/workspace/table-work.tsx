'use client';
import { type Order, type Row } from '../shared/components';
import { Icon } from '../shared/primitives';
import { restaurantTime } from '../shared/restaurant-time';
export type TableJob = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  time: string;
  tab: string;
  icon: string;
  request?: Row;
  alert?: Row;
};
export function tableWork(table: Row, orders: Order[], support: Row[], alerts: Row[]): TableJob[] {
  const sid = table.session_id,
    jobs: TableJob[] = [];
  if (table.table_status === 'NEEDS_CLEANING')
    jobs.push({
      id: 'clean:' + table.id,
      kind: 'clean',
      title: 'Dọn bàn để đón khách mới',
      detail: 'Dọn dụng cụ, vệ sinh bàn và kiểm tra trước khi báo sẵn sàng.',
      time: String(table.cleaning_since ?? ''),
      tab: 'clean',
      icon: 'check',
    });
  for (const s of support.filter((s) => (sid && s.session_id === sid) || s.table_id === table.id))
    jobs.push({
      id: s.id,
      request: s,
      kind: s.request_type === 'BILL' ? 'payment' : 'support',
      title:
        s.request_type === 'BILL'
          ? 'Khách gọi thu tiền'
          : s.request_type === 'ACCESS_CODE'
            ? 'Cấp mã tham gia bàn'
            : 'Khách cần hỗ trợ',
      detail:
        String(s.display_name ?? 'Khách') +
        ' - ' +
        (s.request_type === 'BILL'
          ? !s.payment_method
            ? 'Chọn hình thức tại bàn'
            : s.payment_method === 'CASH'
              ? 'Tiền mặt'
              : 'Chuyển khoản'
          : String(s.content ?? s.request_type)),
      time: String(s.created_at),
      tab: s.request_type === 'BILL' ? 'payments' : 'tasks',
      icon: s.request_type === 'BILL' ? 'receipt' : 'bell',
    });
  for (const a of alerts.filter(
    (a) =>
      !a.requires_admin &&
      ((sid && a.session_id === sid) || (a.session_id === null && a.table_id === table.id)),
  ))
    jobs.push({
      id: a.id,
      alert: a,
      kind: a.alert_type === 'REFUND_REQUIRED' ? 'refund' : 'issue',
      title: a.guest_notice
        ? 'Cần đến trao đổi với khách'
        : a.alert_type === 'REFUND_REQUIRED'
          ? 'Cần hoàn tiền khách'
          : 'Cảnh báo tại bàn',
      detail: String(a.item_name ?? a.resolution_note ?? a.alert_type),
      time: String(a.created_at),
      tab: a.alert_type === 'REFUND_REQUIRED' ? 'payments' : 'tasks',
      icon: 'warning',
    });
  for (const o of orders.filter((o) => o.session_id === sid)) {
    const ready = o.items.filter((i) => i.status === 'READY');
    if (ready.length)
      jobs.push({
        id: o.id,
        kind: 'serve',
        title: ready.length + ' món chờ mang ra',
        detail: ready.map((i) => i.product_name_snapshot).join(', '),
        time: String(ready[0]?.ready_at ?? o.created_at ?? ''),
        tab: 'orders',
        icon: 'chef',
      });
    if (o.status === 'PENDING_REVIEW')
      jobs.push({
        id: o.id,
        kind: 'review',
        title: 'Lượt gọi chờ duyệt',
        detail: 'Kiểm tra trước khi chuyển bếp',
        time: o.created_at ?? '',
        tab: 'orders',
        icon: 'menu',
      });
  }
  if (
    Number(table.pending_payments) > 0 &&
    !support.some((s) => s.session_id === sid && s.request_type === 'BILL')
  )
    jobs.push({
      id: 'legacy-payment',
      kind: 'payment',
      title: 'Khoản thu chờ xác nhận',
      detail: Number(table.pending_payments) + ' khoản cần kiểm tra',
      time: String(table.latest_payment_at ?? table.opened_at ?? ''),
      tab: 'payments',
      icon: 'receipt',
    });
  if (table.verification_status === 'UNVERIFIED')
    jobs.push({
      id: 'verification',
      kind: 'verification',
      title: 'Xác minh khách tại bàn',
      detail: 'Đối chiếu khách đang ngồi đúng bàn',
      time: String(table.opened_at ?? ''),
      tab: 'tasks',
      icon: 'users',
    });
  return jobs.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
}
export function requestOwner(s: Row, userId: string) {
  return s.status === 'NEW'
    ? 'Chưa có người nhận'
    : s.acknowledged_by === userId
      ? 'Bạn đang phụ trách'
      : String(s.acknowledged_by_name ?? 'Đồng nghiệp') + ' đang phụ trách';
}
export function TableTasks({
  jobs,
  open,
  userId,
  showEmpty = true,
}: {
  jobs: TableJob[];
  open: (tab: string) => void;
  userId: string;
  showEmpty?: boolean;
}) {
  return (
    <div className="table-task-list" aria-label="Công việc tại bàn, mới nhất trước">
      {jobs.length ? (
        jobs.map((j) => (
          <button
            type="button"
            className={'table-job task-' + j.kind}
            key={j.id}
            onClick={() => open(j.tab)}
          >
            <Icon name={j.icon} />
            <span>
              <strong>{j.title}</strong>
              <small>{j.detail}</small>
              {j.request && (
                <small className="table-job-owner">{requestOwner(j.request, userId)}</small>
              )}
            </span>
            <time>
              {j.time ? restaurantTime(j.time, { hour: '2-digit', minute: '2-digit' }) : ''}
            </time>
            <Icon name="arrow" size={16} />
          </button>
        ))
      ) : showEmpty ? (
        <p className="table-all-clear">Không còn công việc cần nhân viên xử lý tại bàn.</p>
      ) : null}
    </div>
  );
}
