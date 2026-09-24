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
  const totalSales = data.reports.sales.reduce(
    (sum, row) => sum + BigInt(String(row.sales ?? 0)),
    0n,
  );
  const totalCost = data.reports.sales.reduce(
    (sum, row) => sum + BigInt(String(row.cost ?? 0)),
    0n,
  );
  const totalPayments = data.reports.payments.reduce(
    (sum, row) => sum + BigInt(String(row.amount ?? 0)),
    0n,
  );
  return (
    <>
      <section className="core-card report-receipt-header">
        <strong>{String(data.reports.store.name)}</strong>
        <span>{String(data.reports.store.address || 'Chưa cập nhật địa chỉ')}</span>
        <small>Báo cáo doanh số & đối soát thanh toán · Đơn vị tiền tệ: VND</small>
      </section>
      <div className="stats-grid report-summary">
        <article className="stat-card">
          <div>
            <span className="stat-label">Doanh số</span>
            <strong>{vnd(totalSales)}</strong>
            <small>Tổng món đã phục vụ</small>
          </div>
        </article>
        <article className="stat-card">
          <div>
            <span className="stat-label">Giá vốn</span>
            <strong>{vnd(totalCost)}</strong>
            <small>Chi phí nguyên liệu ghi nhận</small>
          </div>
        </article>
        <article className="stat-card">
          <div>
            <span className="stat-label">Đã thu</span>
            <strong>{vnd(totalPayments)}</strong>
            <small>Giao dịch thành công</small>
          </div>
        </article>
        <article className="stat-card">
          <div>
            <span className="stat-label">Cần xử lý</span>
            <strong>{data.outstanding.length}</strong>
            <small>Hồ sơ thiếu tiền đang mở</small>
          </div>
        </article>
      </div>
      <details className="core-card report-section" open>
        <summary>
          <strong>1. Doanh số theo món</strong>
          <small>Chi tiết sản lượng, doanh thu và giá vốn</small>
        </summary>
        <div className="core-scroll">
          <table>
            <thead>
              <tr>
                <th>Món</th>
                <th>Số lượng</th>
                <th>Doanh số</th>
                <th>Giá vốn</th>
                <th>Lãi gộp</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.sales.map((r, i) => (
                <tr key={i}>
                  <td>
                    <strong>{String(r.product_name_snapshot)}</strong>
                  </td>
                  <td>{String(r.quantity)}</td>
                  <td>{vnd(r.sales)}</td>
                  <td>{vnd(r.cost)}</td>
                  <td>{vnd(BigInt(String(r.sales ?? 0)) - BigInt(String(r.cost ?? 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="core-card report-section" open>
        <summary>
          <strong>2. Thanh toán đã thu</strong>
          <small>Đối soát theo phương thức</small>
        </summary>
        <div className="payment-method-grid">
          {data.reports.payments.map((r, i) => (
            <div className="payment-method" key={i}>
              <span>{r.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}</span>
              <strong>{vnd(r.amount)}</strong>
            </div>
          ))}
          {!data.reports.payments.length && <p>Chưa có giao dịch thành công.</p>}
        </div>
      </details>
      <details className="core-card report-section" open>
        <summary>
          <strong>3. Hồ sơ thiếu tiền & rủi ro tài chính</strong>
          <small>Chỉ chủ quán xử lý và chốt tổn thất</small>
        </summary>
        {data.outstanding.length ? (
          data.outstanding.map((r) => (
            <div className="risk-record" key={r.id}>
              <div>
                <strong>{String(r.table_code ?? 'Bàn')}</strong>
                <span>
                  {vnd(r.outstanding_amount)} · {label(r.status)}
                </span>
                <small>{String(r.notes ?? 'Chưa có ghi chú')}</small>
              </div>
              {['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(r.status)) && (
                <EntryForm
                  title="Chốt xử lý"
                  fields={[{ key: 'reason', label: 'Lý do xử lý' }]}
                  submit="Đóng hồ sơ"
                  onSubmit={(v) => save('/core/outstanding/' + r.id + '/write-off', v)}
                />
              )}
            </div>
          ))
        ) : (
          <p>Không có hồ sơ thiếu tiền đang mở.</p>
        )}
      </details>
    </>
  );
}
