'use client';
import { useState } from 'react';
import { EntryForm, type Row } from '../shared/components';
import { Modal } from '../shared/primitives';
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
        <Modal title={String(balance.ingredient_name)} close={() => setOpen(false)}>
          <p>
            Kho {String(balance.location_name)} · Đơn vị {String(balance.unit)}. Hiện có{' '}
            {String(balance.on_hand_qty)}, đang giữ {String(balance.reserved_qty)}.
          </p>
          <p>
            Kiểm kê: nhập tổng thực đếm, gồm cả phần dành cho món chưa nấu. Xuất hủy: nhập lượng
            nguyên liệu hỏng cần loại bỏ. Không dùng cho món đã tiêu hao khi nấu.
          </p>
          <EntryForm
            title="Ghi nhận điều chỉnh"
            submit="Ghi nhận vào sổ kho"
            fields={[
              {
                key: 'mode',
                label: 'Loại ghi nhận',
                options: [
                  { value: 'COUNT', label: 'Kiểm kê — tổng thực đếm' },
                  { value: 'WASTE', label: 'Xuất hủy — lượng hỏng' },
                ],
              },
              {
                key: 'quantity',
                label: 'Số lượng theo đơn vị cơ sở',
                type: 'number',
                min: 0,
                step: '0.000001',
              },
              { key: 'reason', label: 'Lý do / biên bản kiểm kê hoặc hư hỏng' },
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
        </Modal>
      )}
    </>
  );
}
