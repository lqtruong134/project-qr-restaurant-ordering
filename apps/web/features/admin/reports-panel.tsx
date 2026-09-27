'use client';
import { useState } from 'react';
import Receipt, { type Bill } from '../workspace/receipt';
import { Modal } from '../shared/primitives';
import { OrderExceptions } from './order-exceptions';
import type { AdminData, SaveAdmin } from './admin-types';
import { Action, api, EntryForm, vnd, label, type Row } from '../shared/components';
export default function ReportsPanel({
  data,
  save,
}: {
  data: Pick<AdminData, 'reports' | 'outstanding'>;
  save: SaveAdmin;
}) {
  const [detail, setDetail] = useState<{ bill: Bill; exceptions: Row[] } | null>(null);
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
      {detail && (
        <Modal title="Chi tiết đối soát phiên bàn" wide close={() => setDetail(null)}>
          <Receipt bill={detail.bill} visible />
          <h3>Lịch sử xử lý ngoại lệ</h3>
          {detail.exceptions.length ? (
            detail.exceptions.map((e, i) => (
              <p key={i}>
                {String(e.reason)} · {String(e.display_name)} ·{' '}
                {new Date(String(e.created_at)).toLocaleString('vi-VN')}
              </p>
            ))
          ) : (
            <p>Không có xử lý ngoại lệ.</p>
          )}
        </Modal>
      )}
      <OrderExceptions />
      <details className="core-card" open>
        <summary>Đối chiếu theo từng phiên bàn · toàn bộ lịch sử</summary>
        <p>
          Còn phải thu = khoản phải thu − tiền đã thu + tiền đã hoàn − tổn thất đã chấp nhận. Số âm
          thể hiện còn tiền cần hoàn. Tiền khách đưa và tiền thừa không cộng vào doanh số.
        </p>
        <div className="core-scroll">
          <table>
            <thead>
              <tr>
                <th>Bàn / phiếu</th>
                <th>Phải thu</th>
                <th>Đã thu</th>
                <th>Đã hoàn</th>
                <th>Đã miễn/hủy</th>
                <th>Write-off</th>
                <th>Tổn thất nguyên liệu</th>
                <th>Số dư đối chiếu</th>
              </tr>
            </thead>
            <tbody>
              {(data.reports.reconciliation ?? []).map((row) => (
                <tr key={row.id}>
                  <td>
                    {String(row.table_code)}
                    <br />
                    {String(row.receipt_number ?? row.id.slice(0, 8))}
                    <Action
                      run={async () =>
                        setDetail(
                          await api<{ bill: Bill; exceptions: Row[] }>(
                            '/core/reports/sessions/' + row.id,
                          ),
                        )
                      }
                    >
                      Xem đối soát
                    </Action>
                  </td>
                  {[
                    'payable',
                    'collected',
                    'refunded',
                    'reversed',
                    'written_off',
                    'stock_loss',
                  ].map((key) => (
                    <td key={key}>{vnd(row[key])}</td>
                  ))}
                  <td>
                    {vnd(
                      BigInt(String(row.payable)) -
                        BigInt(String(row.collected)) +
                        BigInt(String(row.refunded)) -
                        BigInt(String(row.written_off)),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
                  submit="Chấp nhận tổn thất (Write-off)"
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
