'use client';
import type { AdminData, SaveAdmin } from './admin-types';
import { EntryForm, vnd, label } from '../shared/components';
export default function ReportsPanel({
  data,
  save,
}: {
  data: Pick<AdminData, 'reports' | 'outstanding'>;
  save: SaveAdmin;
}) {
  return (
    <>
      <h2>Doanh số món đã phục vụ</h2>
      <div className="core-scroll">
        <table>
          <thead>
            <tr>
              <th>Món</th>
              <th>Số lượng</th>
              <th>Doanh số</th>
              <th>Giá vốn nguyên liệu</th>
            </tr>
          </thead>
          <tbody>
            {data.reports.sales.map((r, i) => (
              <tr key={i}>
                <td>{String(r.product_name_snapshot)}</td>
                <td>{String(r.quantity)}</td>
                <td>{vnd(r.sales)}</td>
                <td>{vnd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Tiền đã thu</h2>
      {data.reports.payments.map((r, i) => (
        <p key={i}>
          {r.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}: {vnd(r.amount)}
        </p>
      ))}
      <h2>Hồ sơ thiếu tiền</h2>
      {data.outstanding.map((r) => (
        <details key={r.id} className="core-card">
          <summary>
            {String(r.table_code ?? 'Bàn')} · {vnd(r.outstanding_amount)} · {label(r.status)}
          </summary>
          <p>{String(r.notes ?? '')}</p>
          {['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(r.status)) && (
            <EntryForm
              title="Ghi nhận không thu hồi được"
              fields={[{ key: 'reason', label: 'Lý do xử lý' }]}
              submit="Chốt tổn thất và đóng phiên"
              onSubmit={(v) => save('/core/outstanding/' + r.id + '/write-off', v)}
            />
          )}
        </details>
      ))}
    </>
  );
}
