'use client';
import { useState, type ReactNode } from 'react';
import { Icon } from '../shared/primitives';
import type { Row } from '../shared/components';
export const decimalInput = (value: unknown) =>
  String(value ?? '').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');

export const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 6 });
export const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' đ';
export const movementLabels: Record<string, string> = {
  RECEIPT: 'Nhập kho',
  CONSUMPTION: 'Chế biến món',
  WASTE: 'Xuất hủy',
  ADJUSTMENT_IN: 'Kiểm kê tăng',
  ADJUSTMENT_OUT: 'Kiểm kê giảm',
};
export const receiptLabels: Record<string, string> = {
  DRAFT: 'Chờ nhập kho',
  APPROVED: 'Đã nhập kho',
  CANCELLED: 'Đã hủy nháp',
};
export function stockStatus(balance: Row, ingredient?: Row) {
  const available = Number(balance.available_qty);
  if (available <= 0) return { key: 'empty', title: 'Hết khả dụng' };
  if (Number(ingredient?.min_stock ?? 0) > 0 && available <= Number(ingredient?.min_stock))
    return { key: 'low', title: 'Cần bổ sung' };
  return { key: 'ready', title: 'Có thể dùng' };
}
export function Badge({ kind = 'ready', children }: { kind?: string; children: ReactNode }) {
  return (
    <span className="inv-badge" data-kind={kind}>
      {children}
    </span>
  );
}
export function PanelHeading({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="inv-panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <div className="inv-actions">{children}</div>
    </div>
  );
}
export function Paginated<T>({
  items,
  children,
  size = 12,
}: {
  items: T[];
  children: (page: T[]) => ReactNode;
  size?: number;
}) {
  const [index, setIndex] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size)),
    current = Math.min(index, pages - 1);
  return (
    <>
      {children(items.slice(current * size, (current + 1) * size))}
      <div className="inv-pagination">
        <span>
          {items.length
            ? `${current * size + 1}–${Math.min((current + 1) * size, items.length)} / ${items.length}`
            : '0 kết quả'}
        </span>
        <div>
          <button
            className="secondary-button"
            aria-label="Trang trước"
            disabled={current === 0}
            onClick={() => setIndex(current - 1)}
          >
            ‹
          </button>
          <span>
            Trang {current + 1} / {pages}
          </span>
          <button
            className="secondary-button"
            aria-label="Trang sau"
            disabled={current === pages - 1}
            onClick={() => setIndex(current + 1)}
          >
            ›
          </button>
        </div>
      </div>
    </>
  );
}
export function CreateButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="primary-button" onClick={onClick}>
      <Icon name="plus" size={18} />
      {children}
    </button>
  );
}
