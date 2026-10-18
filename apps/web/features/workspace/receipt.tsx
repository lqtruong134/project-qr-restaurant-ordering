import type { BillingSummary } from '@thesis/contracts';
import {
  paymentMethodLabel,
  type PaymentCapabilities,
  type PaymentIntent,
} from '../shared/online-payment';
import { BillingTotals } from '../shared/billing-totals';
import { taxLabel } from '../shared/billing-summary';
import { SessionReference } from '../shared/session-reference';
import { vnd, type Row } from '../shared/components';
import { paymentSummary } from '../shared/payment-summary';
import { PaymentBreakdown } from '../shared/payment-breakdown';
import { CashHistory } from './payment-handover';
import { receiptLines } from './receipt-lines';
import { ComboContents } from '../shared/combo-contents';
export type CloseReadiness = {
  canClose: boolean;
  blockers: {
    code: string;
    title: string;
    detail: string;
    tab: 'orders' | 'payments' | 'tasks';
    count: number;
  }[];
};
export type Bill = {
  billing?: BillingSummary;
  closure?: CloseReadiness;
  completion?: {
    pendingChange: Row[];
    receiptKey: string;
    receiptRequired: boolean;
    receiptDelivery: {
      details: { delivery: string; layout: string };
      created_at: string;
      confirmed_by_name: string;
    } | null;
  };
  refundWorkflow?: { approvedAmount: string; awaitingApprovalAmount: string; reviewAmount: string };
  refundContext?: { reason: string; decisions: Row[] } | null;
  participants?: Row[];
  paymentRequests?: Row[];
  session: Row;
  account: Row;
  charges: Row[];
  intents: PaymentIntent[];
  paymentCapabilities?: PaymentCapabilities;
  payments: Row[];
  refunds: Row[];
  complimentaryItems?: Row[];
  waivedItems?: Row[];
  cancelledItems?: Row[];
  refundTransactions?: Row[];
  store: Row;
  generatedAt: string;
  closedBy: { display_name: string; username: string } | null;
};
export const billTime = (value: unknown, timezone = 'Asia/Ho_Chi_Minh') =>
  value ? new Date(String(value)).toLocaleString('vi-VN', { timeZone: timezone }) : 'Đang phục vụ';
export default function Receipt({
  id,
  bill,
  visible,
  layout = 'standard',
}: {
  id?: string;
  bill: Bill;
  visible: boolean;
  layout?: 'standard' | 'detailed';
}) {
  const closed = bill.session.session_status === 'CLOSED',
    zone = String(bill.store.timezone ?? 'Asia/Ho_Chi_Minh');
  const totals = paymentSummary(bill.account);
  const receipts = bill.payments.filter((p) => p.status === 'SUCCEEDED');
  const lines = receiptLines(bill);
  const owners =
    layout === 'detailed' ? [...new Set(lines.map((l) => l.ownerId ?? 'common'))] : ['all'];
  return (
    <section
      id={id}
      className={'receipt-sheet' + (visible ? ' receipt-visible' : '')}
      aria-label="Phiếu thanh toán"
    >
      <header className="receipt-store">
        <h2>{String(bill.store.name)}</h2>
        <p>{String(bill.store.address ?? '')}</p>
        {bill.store.phone && <p>Điện thoại: {String(bill.store.phone)}</p>}
        {bill.store.tax_code && <p>MST: {String(bill.store.tax_code)}</p>}
        <h3>{closed ? 'PHIẾU THANH TOÁN' : 'PHIẾU TẠM TÍNH'}</h3>
      </header>
      <div className="receipt-meta">
        {bill.session.receipt_number && (
          <span>
            Số phiếu: <strong>{String(bill.session.receipt_number)}</strong>
          </span>
        )}
        <span>
          Bàn: <strong>{String(bill.session.table_code)}</strong>
          <SessionReference id={bill.session.id} />
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
            Nhân viên chốt: {bill.closedBy.display_name} - {bill.closedBy.username}
          </span>
        )}
      </div>
      <div className="receipt-table">
        <div className="receipt-row receipt-row-head">
          <span>Món / khoản thu</span>
          <span>SL</span>
          <span>Đơn giá</span>
          <span>
            {bill.billing && BigInt(bill.billing.discountAmount) > 0n ? 'Sau giảm' : 'Thành tiền'}
          </span>
        </div>
        {!lines.length && <p className="receipt-empty">Chưa có món tính tiền.</p>}
        {owners.map((owner) => {
          const selected =
            owner === 'all' ? lines : lines.filter((l) => (l.ownerId ?? 'common') === owner);
          return (
            <div className="receipt-owner-group" key={owner}>
              {layout === 'detailed' && (
                <h4>
                  {owner === 'common'
                    ? 'Món chung / nhân viên gọi hộ'
                    : (selected[0]?.ownerName ?? 'Khách chưa có tên')}
                </h4>
              )}
              {(['normal', 'gift', 'adjusted'] as const).map((group) => (
                <div key={group}>
                  {group !== 'normal' && selected.some((l) => l.group === group) && (
                    <h4 className="receipt-group-title">
                      {group === 'gift' ? 'Món tặng' : 'Món hủy / không tính tiền'}
                    </h4>
                  )}
                  {selected
                    .filter((l) => l.group === group)
                    .map((line) => (
                      <div className="receipt-row" key={line.id}>
                        <span>
                          {line.name}
                          <ComboContents components={line.components} />
                          {BigInt(String(line.discountAmount ?? 0)) > 0n && (
                            <small className="receipt-line-discount">
                              Khuyến mãi −{vnd(line.discountAmount)}
                            </small>
                          )}
                          {line.taxTreatment && line.taxTreatment !== 'LEGACY' && (
                            <small className="receipt-short-note">
                              {taxLabel(line.taxTreatment, line.vatRatePercent)}
                            </small>
                          )}
                          {line.note && <small className="receipt-short-note">{line.note}</small>}
                        </span>
                        <span>{String(line.quantity)}</span>
                        <span>{vnd(line.unitPrice)}</span>
                        <strong>{vnd(line.amount)}</strong>
                      </div>
                    ))}
                </div>
              ))}
              {layout === 'detailed' && (
                <p className="receipt-owner-total">
                  <span>Tiền nhóm này sau khuyến mãi</span>
                  <strong>
                    {vnd(selected.reduce((sum, l) => sum + BigInt(String(l.amount)), 0n))}
                  </strong>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <BillingTotals billing={bill.billing} account={bill.account} receipt />
      <div className="receipt-totals">
        {(totals.unappliedHeld > 0n || totals.refundedTotal > 0n) && (
          <div>
            <span>Đã nhận (trước hoàn)</span>
            <strong>{vnd(totals.collectedTotal)}</strong>
          </div>
        )}
        <div>
          <span>Đã tính vào tiền món</span>
          <strong>{vnd(totals.appliedTotal)}</strong>
        </div>
        <div>
          <span>Còn phải thanh toán</span>
          <strong>{vnd(bill.account.outstanding_amount)}</strong>
        </div>
        {BigInt(String(bill.account.refund_due_amount)) > 0n && (
          <div>
            <span>Cần hoàn lại khách</span>
            <strong>{vnd(bill.account.refund_due_amount)}</strong>
          </div>
        )}
      </div>
      {totals.refundedTotal > 0n && (
        <p className="receipt-short-note">Đã trừ các khoản thực tế hoàn lại khách.</p>
      )}
      <section className="receipt-money-breakdown" aria-label="Đối chiếu thanh toán">
        <h4>Đối chiếu tiền khách đã đưa</h4>
        <PaymentBreakdown account={bill.account} payments={bill.payments} compact />
      </section>
      <div className="receipt-payments">
        <strong>Các lần nhận tiền</strong>
        {!receipts.length && <p>Chưa thu tiền</p>}
        {receipts.map((p) => {
          return (
            <div className="receipt-payment-entry" key={p.id}>
              <p>
                {paymentMethodLabel(p.method)} - Đã nhận {vnd(p.amount)}
              </p>
              <small>
                {billTime(p.confirmed_at ?? p.created_at, zone)} -{' '}
                {p.method === 'ONLINE' ? 'Hệ thống xác nhận' : String(p.confirmed_by_name ?? '')}{' '}
                {p.method === 'ONLINE' ? '' : String(p.confirmed_by_username ?? '')}
              </small>
              <CashHistory payment={p} />
            </div>
          );
        })}
      </div>
      {(bill.refundTransactions ?? []).length > 0 && (
        <div className="receipt-payments">
          <strong>Các lần hoàn lại khách</strong>
          {bill.refundTransactions!.map((t) => (
            <div className="receipt-payment-entry" key={t.id}>
              <p>
                {t.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'} - {vnd(t.amount)}
              </p>
              <small>
                {billTime(t.processed_at, zone)} - {String(t.processed_by_name ?? '')}
              </small>
              {t.reference && <small>Mã giao dịch: {String(t.reference)}</small>}
            </div>
          ))}
        </div>
      )}
      <footer className="receipt-footer">
        {bill.session.close_reason === 'OUTSTANDING_WRITTEN_OFF' && (
          <p>Phiên đóng theo hồ sơ thiếu tiền; không phải đã thu đủ.</p>
        )}
        <p>Cảm ơn quý khách và hẹn gặp lại!</p>
        <small>Phiếu thanh toán nội bộ, không thay thế hóa đơn điện tử.</small>
      </footer>
    </section>
  );
}
