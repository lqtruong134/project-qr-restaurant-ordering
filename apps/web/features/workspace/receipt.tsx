import { vnd, type Row } from '../shared/components';
export type Bill = {
  session: Row;
  account: Row;
  charges: Row[];
  intents: Row[];
  payments: Row[];
  refunds: Row[];
  store: Row;
  generatedAt: string;
  closedBy: { display_name: string; username: string } | null;
};
export const billTime = (value: unknown, timezone = 'Asia/Ho_Chi_Minh') =>
  value ? new Date(String(value)).toLocaleString('vi-VN', { timeZone: timezone }) : 'Đang phục vụ';
export default function Receipt({ bill, visible }: { bill: Bill; visible: boolean }) {
  const closed = bill.session.session_status === 'CLOSED',
    zone = String(bill.store.timezone ?? 'Asia/Ho_Chi_Minh');
  const receipts = bill.payments.filter((p) => p.status === 'SUCCEEDED');
  return (
    <section
      className={'receipt-sheet' + (visible ? ' receipt-visible' : '')}
      aria-label="Phiếu thanh toán"
    >
      <header className="receipt-store">
        <h2>{String(bill.store.name)}</h2>
        <p>{String(bill.store.address ?? '')}</p>
        <h3>{closed ? 'PHIẾU THANH TOÁN' : 'PHIẾU TẠM TÍNH'}</h3>
      </header>
      <div className="receipt-meta">
        <span>
          Số phiếu:{' '}
          <strong>{String(bill.session.receipt_number ?? 'TT-' + bill.session.id)}</strong>
        </span>
        <span>
          Bàn: <strong>{String(bill.session.table_code)}</strong>
        </span>
        <span>
          Giờ vào: <strong>{billTime(bill.session.opened_at, zone)}</strong>
        </span>
        <span>
          Giờ ra: <strong>{billTime(bill.session.closed_at, zone)}</strong>
        </span>
        <span>
          {closed ? 'Chốt lúc' : 'Tạm tính lúc'}:{' '}
          {billTime(bill.session.closed_at ?? bill.generatedAt, zone)}
        </span>
        {bill.closedBy && (
          <span>
            Nhân viên chốt: {bill.closedBy.display_name} · {bill.closedBy.username}
          </span>
        )}
      </div>
      <div className="receipt-table">
        <div className="receipt-row receipt-row-head">
          <span>Món / khoản thu</span>
          <span>SL</span>
          <span>Đơn giá</span>
          <span>Thành tiền</span>
        </div>
        {bill.charges
          .filter((c) => c.status === 'ACTIVE')
          .map((c) => (
            <div className="receipt-row" key={c.id}>
              <span>{String(c.product_name_snapshot ?? 'Khoản thu')}</span>
              <span>{String(c.quantity ?? 1)}</span>
              <span>{vnd(c.unit_price_snapshot ?? c.amount)}</span>
              <strong>{vnd(c.amount)}</strong>
            </div>
          ))}
      </div>
      <div className="receipt-totals">
        <div>
          <span>Tổng phải thanh toán</span>
          <strong>{vnd(bill.account.charge_total)}</strong>
        </div>
        <div>
          <span>Đã thu</span>
          <strong>{vnd(bill.account.paid_total)}</strong>
        </div>
        {BigInt(String(bill.account.refunded_total ?? 0)) > 0n && (
          <div>
            <span>Đã hoàn lại khách</span>
            <strong>{vnd(bill.account.refunded_total)}</strong>
          </div>
        )}
        <div>
          <span>Còn phải thu</span>
          <strong>{vnd(bill.account.outstanding_amount)}</strong>
        </div>
        {BigInt(String(bill.account.refund_due_amount)) > 0n && (
          <div>
            <span>Còn phải hoàn khách</span>
            <strong>{vnd(bill.account.refund_due_amount)}</strong>
          </div>
        )}
      </div>
      <div className="receipt-payments">
        <strong>Các lần thanh toán</strong>
        {!receipts.length && <p>Chưa thu tiền</p>}
        {receipts.map((p) => {
          const meta = p.metadata as unknown as { cashReceived?: string; changeGiven?: string };
          return (
            <div className="receipt-payment-entry" key={p.id}>
              <p>
                {p.method === 'CASH'
                  ? 'Tiền mặt'
                  : p.method === 'BANK_TRANSFER'
                    ? 'Chuyển khoản đã xác nhận'
                    : 'Thanh toán'}{' '}
                · {vnd(p.amount)}
              </p>
              <small>
                {billTime(p.confirmed_at ?? p.created_at, zone)} ·{' '}
                {String(p.confirmed_by_name ?? '')} {String(p.confirmed_by_username ?? '')}
              </small>
              {p.method === 'CASH' && meta?.cashReceived && (
                <small>
                  Khách đưa {vnd(meta.cashReceived)} · Trả lại {vnd(meta.changeGiven)}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <footer className="receipt-footer">
        {bill.session.close_reason === 'OUTSTANDING_WRITTEN_OFF' && (
          <p>Phiên đóng theo hồ sơ thiếu tiền; không phải đã thu đủ.</p>
        )}
        <p>Cảm ơn quý khách và hẹn gặp lại!</p>
        <small>
          Phiếu nội bộ, không phải hóa đơn thuế. Số tiền theo giá món đã ghi nhận; chưa áp dụng
          thuế/phí riêng.
        </small>
      </footer>
    </section>
  );
}
