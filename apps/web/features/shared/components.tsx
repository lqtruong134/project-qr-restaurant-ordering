'use client';
import { useState, type FormEvent } from 'react';
import { getAuthenticated } from '../../lib/api-client';
export type Row = { id: string; [key: string]: string | number | boolean | null };
export type Product = Row & {
  name: string;
  code: string;
  base_price: string;
  version: number;
  is_active: boolean;
  availability_status: string;
};
export type Item = Row & {
  product_name_snapshot: string;
  quantity: number;
  status: string;
  unit_price_snapshot: string;
};
export type Order = {
  created_at?: string;
  id: string;
  session_id: string;
  table_code: string;
  status: string;
  total_amount: string;
  items: Item[];
};
export type Field = {
  key: string;
  label: string;
  type?: string;
  value?: string | number;
  options?: { value: string; label: string }[];
  optional?: boolean;
  min?: number;
  max?: number;
  step?: string;
};
export const vnd = (value: unknown) => {
  try {
    return BigInt(String(value ?? 0)).toLocaleString('vi-VN') + ' đ';
  } catch {
    return '—';
  }
};
const labels: Record<string, string> = {
  NEW: 'Mới',
  PENDING_ADMIN_REVIEW: 'Chờ quản trị xem xét',
  IN_RECOVERY: 'Đang thu hồi',
  WRITTEN_OFF: 'Đã ghi nhận tổn thất',
  RECOVERED: 'Đã thu hồi',
  ACKNOWLEDGED: 'Đã tiếp nhận',
  RESOLVED: 'Đã hoàn tất',
  PENDING_REVIEW: 'Chờ nhân viên duyệt',
  SUBMITTED: 'Chờ bếp nhận',
  ACCEPTED: 'Bếp đã nhận',
  IN_PROGRESS: 'Đang thực hiện',
  IN_PREPARATION: 'Đang chế biến',
  READY: 'Chờ mang ra',
  SERVED: 'Đã phục vụ',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy',
  ACTIVE: 'Đang hoạt động',
  DISABLED: 'Đã vô hiệu hóa',
  INACTIVE: 'Đã khóa tài khoản',
  AVAILABLE: 'Sẵn sàng',
  OCCUPIED: 'Đang có khách',
  NEEDS_CLEANING: 'Chờ dọn',
  CREATED: 'Chờ thanh toán',
  PENDING: 'Chờ xử lý',
  SUCCEEDED: 'Thành công',
  EXPIRED: 'Hết hạn',
  OPEN: 'Đang mở',
  RESOLVED_CASH: 'Đã hoàn tiền mặt',
  RESOLVED_TRANSFER: 'Đã hoàn chuyển khoản',
  ASSISTANCE: 'Cần hỗ trợ',
  WATER: 'Thêm nước',
  UTENSILS: 'Thêm dụng cụ',
  BILL: 'Yêu cầu tính tiền',
  OTHER: 'Hỗ trợ khác',
};
export const label = (value: unknown) => labels[String(value)] ?? String(value ?? '');
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  guest = false,
): Promise<T> {
  const response =
    method === 'GET' && !guest
      ? await getAuthenticated(path)
      : await fetch('/api' + path, {
          method,
          headers: {
            'X-CSRF-Protection': '1',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.userMessage ?? 'Không thực hiện được yêu cầu.', response.status);
  return data as T;
}
export function EntryForm({
  title,
  fields,
  submit,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  submit?: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await onSubmit(Object.fromEntries(new FormData(form).entries()) as Record<string, string>);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa kết nối được máy chủ.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="core-form" onSubmit={save}>
      <h3>{title}</h3>
      <div className="core-fields">
        {fields.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.options ? (
              <select name={f.key} required={!f.optional} defaultValue={f.value}>
                {f.options.length === 0 && <option value="">Chưa có dữ liệu</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={f.key}
                type={f.type ?? 'text'}
                defaultValue={f.value}
                required={!f.optional}
                min={f.min}
                max={f.max}
                step={f.step}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
              />
            )}
          </label>
        ))}
      </div>
      <button className="primary-button" disabled={busy}>
        {busy ? 'Đang lưu…' : (submit ?? 'Lưu')}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {done && <p role="status">Đã lưu thành công.</p>}
    </form>
  );
}
export function Action({
  children,
  run,
  confirm,
}: {
  children: React.ReactNode;
  run: () => Promise<void>;
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <span className="core-action">
      <button
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError('');
          try {
            await run();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Đang xử lý…' : children}
      </button>
      {error && (
        <span role="alert" className="form-error">
          {error}
        </span>
      )}
    </span>
  );
}
export const options = (rows: Row[], field = 'name') =>
  rows.map((r) => ({ value: r.id, label: String(r[field] ?? r.code ?? r.id) }));
