import type { BillingSummary } from '@thesis/contracts';
import { billingLine } from '../shared/billing-summary';
import { orderReasons } from '@thesis/contracts';
import type { Row } from '../shared/components';
export type ReceiptLine = {
  id: string;
  ownerId?: string;
  ownerName?: string;
  name: string;
  quantity: unknown;
  unitPrice: unknown;
  amount: unknown;
  grossAmount?: unknown;
  discountAmount?: unknown;
  taxTreatment?: string;
  vatRatePercent?: number | null;
  note: string;
  group: 'normal' | 'adjusted' | 'gift';
  components?: unknown;
};
export function itemReceiptNote(item: Row, zero: boolean) {
  if (item.awaiting_admin === true) return 'Bếp dừng - Chờ duyệt tiền';
  let code = String(item.finance_reason_code ?? item.cancel_reason_code ?? '');
  if (!code) {
    // Older frozen receipts only have the human-readable reason. Do not expose its internal note.
    const text = String(item.finance_reason ?? item.cancel_reason ?? item.item_reason ?? '');
    code =
      Object.entries(orderReasons).find(([, reason]) => text.startsWith(reason.label))?.[0] ??
      (text.startsWith('Hết nguyên liệu trước chế biến') ? 'OUT_OF_STOCK' : '');
  }
  if (item.item_status === 'REJECTED') return 'Không phục vụ - Không tính tiền';
  const cancelled = item.item_status === 'CANCELLED' || item.item_status === 'UNAVAILABLE';
  const cause = [
    'KITCHEN_ERROR',
    'QUALITY_ISSUE',
    'WRONG_ITEM',
    'OUT_OF_STOCK',
    'INGREDIENT_QUALITY',
    'EQUIPMENT_FAILURE',
  ].includes(code)
    ? 'Nhà hàng'
    : code === 'CUSTOMER_CHANGED_MIND'
      ? 'Khách yêu cầu'
      : '';
  if (cancelled)
    return [cause ? cause + ' hủy' : 'Món đã hủy', zero ? 'Không tính tiền' : 'Vẫn tính tiền'].join(
      ' - ',
    );
  return zero ? 'Miễn tiền' + (cause ? ' - ' + cause : '') : '';
}
export function receiptLines(bill: {
  billing?: BillingSummary;
  charges: Row[];
  complimentaryItems?: Row[];
  waivedItems?: Row[];
  cancelledItems?: Row[];
}): ReceiptLine[] {
  const included = new Set(bill.charges.map((c) => c.order_item_id).filter(Boolean));
  const lines: ReceiptLine[] = bill.charges.map((c) => {
    const zero = c.status === 'REVERSED',
      adjusted = zero || c.item_status === 'CANCELLED';
    const quoted = billingLine(bill.billing, c);
    return {
      id: c.id,
      ownerId: c.owner_participant_id ? String(c.owner_participant_id) : undefined,
      ownerName: c.owner_name ? String(c.owner_name) : undefined,
      name: String(c.product_name_snapshot ?? 'Khoản thu'),
      components: c.combo_components_snapshot,
      quantity: c.quantity ?? 1,
      unitPrice: c.unit_price_snapshot ?? c.amount,
      amount: zero ? '0' : (quoted?.payableAmount ?? c.net_amount ?? c.amount),
      grossAmount: zero ? '0' : (quoted?.grossAmount ?? c.amount),
      discountAmount: zero ? '0' : (quoted?.discountAmount ?? c.discount_amount ?? '0'),
      taxTreatment: quoted?.taxTreatment,
      vatRatePercent: quoted?.vatRatePercent,
      note: adjusted ? itemReceiptNote(c, zero) : '',
      group: adjusted ? 'adjusted' : 'normal',
    };
  });
  for (const [items, group] of [
    [bill.complimentaryItems ?? [], 'gift'],
    [bill.waivedItems ?? [], 'adjusted'],
    [bill.cancelledItems ?? [], 'adjusted'],
  ] as const)
    for (const i of items) {
      if (included.has(i.id)) continue;
      included.add(i.id);
      lines.push({
        id: i.id,
        ownerId: i.owner_participant_id ? String(i.owner_participant_id) : undefined,
        ownerName: i.owner_name ? String(i.owner_name) : undefined,
        name: String(i.product_name_snapshot),
        components: i.combo_components_snapshot,
        quantity: i.quantity,
        unitPrice: i.unit_price_snapshot ?? '0',
        amount: '0',
        note: group === 'gift' ? 'Món tặng' : itemReceiptNote(i, true),
        group,
      });
    }
  return lines.sort(
    (a, b) =>
      ({ normal: 0, gift: 1, adjusted: 2 })[a.group] - { normal: 0, gift: 1, adjusted: 2 }[b.group],
  );
}
