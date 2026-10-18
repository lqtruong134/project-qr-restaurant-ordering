'use client';
import { HistoryList } from '../shared/history-filters';
import { vnd, type Row } from '../shared/components';
import { restaurantDateTime } from '../shared/restaurant-time';
import { paymentSummary } from '../shared/payment-summary';

export function GuestRefundSummary({
  account,
  transactions = [],
}: {
  account: Row;
  transactions?: Row[];
}) {
  const { refundedTotal: refunded, refundDue: due, appliedTotal } = paymentSummary(account);
  if (refunded === 0n && due === 0n) return null;
  return (
    <section
      className={'guest-refund-summary' + (due > 0n ? ' is-pending' : ' is-complete')}
      aria-label="Thông tin hoàn tiền"
    >
      <h2>
        {due > 0n
          ? refunded > 0n
            ? 'Đã hoàn một phần - Còn tiền chờ hoàn'
            : 'Cả bàn còn tiền chờ hoàn'
          : 'Đã hoàn tất các khoản cần hoàn'}
      </h2>
      <p>
        Khoản này có thể do chuyển dư hoặc do món được điều chỉnh. Tiền thối được ghi riêng trong
        chi tiết thanh toán.
      </p>
      <div className="refund-summary-grid">
        <div>
          <span>Đã hoàn lại khách</span>
          <strong>{vnd(refunded)}</strong>
        </div>
        <div>
          <span>Còn chờ hoàn lại khách</span>
          <strong>{vnd(due)}</strong>
        </div>
        <div>
          <span>Đã tính vào tiền món</span>
          <strong>{vnd(appliedTotal)}</strong>
        </div>
      </div>
      {transactions.length > 0 && (
        <>
          <h3>Các lần nhà hàng đã hoàn tiền</h3>
          <HistoryList
            showTimeFilter={false}
            items={transactions}
            date={(t) => t.processed_at}
            search={(t) => [t.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản', t.amount].join(' ')}
            state={(t) => String(t.method)}
            statuses={[
              { value: 'CASH', label: 'Tiền mặt' },
              { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
            ]}
            placeholder="Tìm số tiền hoặc hình thức hoàn…"
            empty="Không tìm thấy lần hoàn tiền phù hợp"
          >
            {(rows) => (
              <ul className="guest-refund-history">
                {rows.map((t) => (
                  <li key={t.id}>
                    <span>
                      {t.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}
                      <small>{restaurantDateTime(t.processed_at)}</small>
                    </span>
                    <strong>{vnd(t.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </HistoryList>
        </>
      )}
      {due > 0n && (
        <p>Khoản còn chờ hoàn chưa được trả lại. Vui lòng liên hệ nhân viên để nhận tiền.</p>
      )}
    </section>
  );
}
