'use client';
import { AdminHelp } from './admin-help';
import { useState } from 'react';
import { EntryForm, type Row } from '../shared/components';
import { Modal } from '../shared/primitives';
import { quantity } from './inventory-ui';
import type { SaveAdmin } from './admin-types';
export function StockAdjustment({ balance, save }: { balance: Row; save: SaveAdmin }) {
  const [open, setOpen] = useState(false),
    [requestId, setRequestId] = useState('');
  return (
    <>
      <button
        className="secondary-button"
        onClick={() => {
          setRequestId(crypto.randomUUID());
          setOpen(true);
        }}
      >
        Kiểm kê / xuất hủy
      </button>
      {open && (
        <Modal
          title={'Kiểm kê / xuất hủy - ' + String(balance.ingredient_name)}
          wide
          close={() => setOpen(false)}
        >
          <div className="inv-dialog inv-stock-adjustment">
            <AdminHelp topic="inventory" />
            <p>
              Kho {String(balance.location_name)} - Đơn vị {String(balance.unit)}. Hiện có{' '}
              {quantity(balance.on_hand_qty)}, giữ cho món {quantity(balance.reserved_qty)}.
            </p>
            <p>
              Kiểm kê: nhập tổng thực đếm, gồm cả phần dành cho món chưa nấu. Xuất hủy: nhập lượng
              nguyên liệu hỏng cần loại bỏ. Không dùng cho món đã tiêu hao khi nấu.
            </p>
            <EntryForm
              title="Ghi nhận điều chỉnh"
              confirm={(v) =>
                `${v.mode === 'COUNT' ? 'Ghi kiểm kê tổng thực đếm' : 'Xuất hủy lượng nguyên liệu'} ${v.quantity} ${String(balance.unit)} tại ${String(balance.location_name)}? Sổ kho sẽ ghi giao dịch mới; các thay đổi đã ghi nhận được giữ trong lịch sử.`
              }
              submit="Điều chỉnh tồn"
              successMessage="Đã ghi nhận điều chỉnh tồn kho."
              confirmLabel="Xác nhận điều chỉnh tồn"
              fields={[
                {
                  key: 'mode',
                  label: 'Loại ghi nhận',
                  options: [
                    { value: 'COUNT', label: 'Kiểm kê - tổng thực đếm' },
                    { value: 'WASTE', label: 'Xuất hủy - lượng hỏng' },
                  ],
                },
                {
                  key: 'quantity',
                  label: 'Số lượng (' + String(balance.unit) + ')',
                  type: 'number',
                  min: 0,
                  step: '0.000001',
                },
                {
                  key: 'reason',
                  label: 'Lý do / biên bản kiểm kê hoặc hư hỏng',
                  type: 'textarea',
                  maxLength: 500,
                },
              ]}
              onSubmit={async (v) => {
                await save('/core/inventory/adjustments', {
                  ...v,
                  balanceId: balance.id,
                  expectedVersion: balance.version,
                  requestId,
                });
                setOpen(false);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
