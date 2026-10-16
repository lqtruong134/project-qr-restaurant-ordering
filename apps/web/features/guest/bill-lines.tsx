import type { BillingSummary } from '@thesis/contracts';
import { billingLine, payableItemAmount, taxLabel } from '../shared/billing-summary';
import { vnd, label, type Row } from '../shared/components';
import { itemReceiptNote } from '../workspace/receipt-lines';
import { OrderedComboContents } from './order-combo';
export function GuestBillLines({
  items,
  mine = false,
  billing,
}: {
  items: Row[];
  mine?: boolean;
  billing?: BillingSummary;
}) {
  if (!items.length) return <p>{mine ? 'Bạn chưa gửi món nào.' : 'Bàn chưa gửi món nào.'}</p>;
  const normal = items.filter(
    (i) =>
      i.charge_status !== 'REVERSED' &&
      !['CANCELLED', 'UNAVAILABLE', 'REJECTED'].includes(String(i.item_status)),
  );
  const adjusted = items.filter((i) => !normal.includes(i));
  return (
    <section className="guest-bill-lines" aria-label="Chi tiết tiền món">
      <h3>Chi tiết tiền món</h3>
      <div className="compact-bill-head compact-bill-row">
        <span>Món</span>
        <span>Số lượng</span>
        <span>Đơn giá</span>
        <span>Thành tiền</span>
      </div>
      {[normal, adjusted].map((group, index) => (
        <div key={index}>
          {index === 1 && group.length > 0 && (
            <h4 className="receipt-group-title">Món hủy / không tính tiền</h4>
          )}
          {group.map((item) => {
            const charged = item.charge_status === 'ACTIVE',
              amount = charged ? payableItemAmount(item, billing) : 0n;
            const pricing = billingLine(billing, item);
            return (
              <article className="guest-bill-item" key={String(item.item_id)}>
                <div className="compact-bill-row">
                  <span>
                    <strong>{String(item.product_name_snapshot)}</strong>
                    {item.product_kind_snapshot === 'COMBO' && (
                      <OrderedComboContents value={item.combo_components_snapshot} />
                    )}
                    {pricing && BigInt(pricing.discountAmount) > 0n && (
                      <small className="receipt-line-discount">
                        Khuyến mãi −{vnd(pricing.discountAmount)}
                      </small>
                    )}
                    {pricing && pricing.taxTreatment !== 'LEGACY' && (
                      <small>
                        {taxLabel(pricing.taxTreatment, pricing.vatRatePercent)}
                        {pricing.taxTreatment === 'TAXABLE' ? ' đã gồm trong giá' : ''}
                      </small>
                    )}
                    {!mine && (
                      <small>
                        {item.owner_name
                          ? 'Món của ' + String(item.owner_name)
                          : 'Món chung - Nhân viên gọi hộ'}
                      </small>
                    )}
                    <small>
                      {item.awaiting_admin === true
                        ? 'Đã dừng phục vụ'
                        : index === 1
                          ? itemReceiptNote(item, !charged)
                          : label(item.item_status)}
                    </small>
                  </span>
                  <span data-label="Số lượng">
                    {String(item.quantity)}
                    {item.product_kind_snapshot === 'COMBO' ? ' combo' : ''}
                  </span>
                  <span data-label="Đơn giá">
                    {vnd(item.unit_price_snapshot)}
                    {item.product_kind_snapshot === 'COMBO' ? ' / combo' : ''}
                  </span>
                  <strong data-label="Thành tiền">{vnd(amount)}</strong>
                </div>
                {item.awaiting_admin === true ? (
                  <p className="small-note">
                    Nhà hàng đang kiểm tra món đã dừng và số tiền cần trả. Nhân viên sẽ đến bàn trao
                    đổi với bạn.
                  </p>
                ) : !charged &&
                  index === 0 &&
                  BigInt(String(item.unit_price_snapshot ?? 0)) > 0n ? (
                  <p className="small-note">
                    Chưa tính tiền món này
                    {item.status === 'PENDING_REVIEW' ? ' - Chờ nhân viên xác nhận' : ''}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}
