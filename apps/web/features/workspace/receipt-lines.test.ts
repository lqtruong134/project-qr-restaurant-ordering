import { it, expect } from 'vitest';
import { receiptLines, itemReceiptNote } from './receipt-lines';
import type { Row } from '../shared/components';
const row = (extra: Partial<Row>): Row => ({
  id: 'dish',
  product_name_snapshot: 'Bò nướng',
  quantity: 2,
  unit_price_snapshot: '159000',
  amount: '318000',
  order_item_id: 'item',
  status: 'ACTIVE',
  item_status: 'SERVED',
  ...extra,
});
it('zeroes a reversed charge in the same row without changing the original unit price or exposing internal notes', () => {
  const lines = receiptLines({
    charges: [
      row({
        status: 'REVERSED',
        item_status: 'CANCELLED',
        cancel_reason_code: 'KITCHEN_ERROR',
        finance_reason: 'Lỗi chế biến: ghi chú nội bộ dài',
      }),
    ],
  });
  expect(lines[0]).toMatchObject({
    amount: '0',
    unitPrice: '159000',
    group: 'adjusted',
    note: 'Nhà hàng hủy - Không tính tiền',
  });
  expect(JSON.stringify(lines)).not.toContain('ghi chú nội bộ');
});
it('keeps a late customer cancellation payable and groups adjusted dishes after normal dishes', () => {
  const lines = receiptLines({
    charges: [
      row({ id: 'cancel', item_status: 'CANCELLED', cancel_reason_code: 'CUSTOMER_CHANGED_MIND' }),
      row({ id: 'normal', order_item_id: 'normal' }),
    ],
  });
  expect(lines.map((l) => l.id)).toEqual(['normal', 'cancel']);
  expect(lines[1]).toMatchObject({ amount: '318000', note: 'Khách yêu cầu hủy - Vẫn tính tiền' });
  expect(lines.reduce((sum, l) => sum + BigInt(String(l.amount)), 0n)).toBe(636000n);
});
it('deduplicates charge, waived and cancelled representations while retaining free dishes and cancellations without charge', () => {
  const lines = receiptLines({
    charges: [row({ status: 'REVERSED' })],
    waivedItems: [row({ id: 'item' })],
    cancelledItems: [
      row({ id: 'item' }),
      row({ id: 'early', item_status: 'CANCELLED', cancel_reason_code: 'CUSTOMER_CHANGED_MIND' }),
    ],
    complimentaryItems: [row({ id: 'gift', unit_price_snapshot: '0' })],
  });
  expect(lines).toHaveLength(3);
  expect(lines.map((l) => l.group)).toEqual(['gift', 'adjusted', 'adjusted']);
  expect(lines.every((l) => l.amount === '0')).toBe(true);
});
it('reads a legacy frozen receipt without altering it or guessing an unknown cancellation source', () => {
  const bill = {
    charges: [
      row({
        status: 'REVERSED',
        item_status: 'CANCELLED',
        finance_reason: 'Lỗi chế biến của nhà hàng: món bị cháy',
      }),
    ],
  };
  const before = JSON.stringify(bill);
  expect(receiptLines(bill)[0]?.note).toContain('Nhà hàng hủy');
  expect(JSON.stringify(bill)).toBe(before);
  expect(
    itemReceiptNote(row({ item_status: 'CANCELLED', cancel_reason: 'Thông tin cũ' }), true),
  ).toBe('Món đã hủy - Không tính tiền');
});

it('keeps the temporary charge while a kitchen issue awaits a decision, without labelling it as an approved customer cancellation', () => {
  const line = receiptLines({
    charges: [
      row({ item_status: 'CANCELLED', cancel_reason_code: 'KITCHEN_ERROR', awaiting_admin: true }),
    ],
  })[0];
  expect(line).toMatchObject({ amount: '318000', note: 'Bếp dừng - Chờ duyệt tiền' });
});

it('uses the server allocation after a promotion for payment and preserves the original menu price', () => {
  const lines = receiptLines({
    charges: [
      row({
        amount: '49000',
        net_amount: '44100',
        discount_amount: '4900',
        unit_price_snapshot: '49000',
        quantity: 1,
      }),
    ],
  });
  expect(lines[0]).toMatchObject({
    unitPrice: '49000',
    amount: '44100',
    discountAmount: '4900',
    grossAmount: '49000',
  });
});

it('removes both the payable amount and allocated promotion from a reversed charge', () => {
  const line = receiptLines({
    charges: [row({ status: 'REVERSED', net_amount: '44100', discount_amount: '4900' })],
  })[0];
  expect(line).toMatchObject({ amount: '0', grossAmount: '0', discountAmount: '0' });
});
