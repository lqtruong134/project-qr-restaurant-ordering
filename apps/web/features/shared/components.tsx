'use client';
import type { MenuPromotion } from '@thesis/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { requestApi } from '../../lib/api-client';
import { Modal, Icon } from './primitives';
import { notifySuccess } from './operation-notice';
export type Row = { id: string; [key: string]: string | number | boolean | null };
export type ComboComponent = {
  image_promotion?: MenuPromotion | null;
  product_id: string;
  code: string;
  name: string;
  quantity: number;
  image_url?: string | null;
  unit_price?: string;
  available?: boolean;
};
export type Product = {
  image_promotion?: MenuPromotion | null;
  id: string;
  [key: string]: unknown;
  name: string;
  code: string;
  base_price: string;
  version: number;
  is_active: boolean;
  availability_status: string;
  configured_availability_status?: string;
  category_id?: string;
  description?: string | null;
  image_url?: string | null;
  stock_managed?: boolean;
  is_complimentary?: boolean;
  product_kind?: 'DISH' | 'COMBO';
  components?: ComboComponent[];
  regular_price?: string;
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
  area_name?: string;
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
  maxLength?: number;
  showWhen?: { key: string; value: string };
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
  UNAVAILABLE: 'Không thể phục vụ',
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
  signal?: AbortSignal,
): Promise<T> {
  void guest; // All methods and both guest/internal screens share the same error boundary.
  const response = await requestApi(path, {
    method,
    signal,
    ...(method === 'GET' ? { cache: 'no-store' as const } : {}),
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
  confirm,
  notice,
  confirmLabel,
  confirmTitle,
  successMessage,
}: {
  title: string;
  fields: Field[];
  submit?: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  confirm?: string | ((values: Record<string, string>) => string | undefined);
  notice?: React.ReactNode;
  confirmLabel?: string;
  confirmTitle?: string;
  successMessage?: string | false;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields
        .filter((f) => f.options)
        .map((f) => [f.key, String(f.value ?? f.options?.[0]?.value ?? '')]),
    ),
  );
  const [pending, setPending] = useState<{ values: Record<string, string>; message: string }>();
  async function execute(values: Record<string, string>) {
    setPending(undefined);
    setBusy(true);
    setError('');
    try {
      await onSubmit(values);
      if (ref.current) delete ref.current.dataset.dirty;
      if (successMessage !== false) notifySuccess(successMessage ?? 'Đã lưu thành công.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa kết nối được máy chủ.');
    } finally {
      setBusy(false);
    }
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
      string,
      string
    >;
    const message = typeof confirm === 'function' ? confirm(values) : confirm;
    if (message) setPending({ values, message });
    else void execute(values);
  }
  return (
    <>
      <form
        ref={ref}
        className="core-form"
        onSubmit={save}
        aria-busy={busy}
        onInvalid={(e) => {
          const field = e.target as HTMLInputElement;
          const definition = fields.find((f) => f.key === field.name);
          if (!definition) return;
          const name = definition.label;
          field.setCustomValidity(
            field.validity.valueMissing
              ? definition.options
                ? `Chọn ${name.toLocaleLowerCase('vi-VN')}.`
                : `Nhập ${name.toLocaleLowerCase('vi-VN')}.`
              : field.validity.rangeUnderflow
                ? `${name} cần từ ${definition.min} trở lên.`
                : field.validity.rangeOverflow
                  ? `${name} không được vượt quá ${definition.max}.`
                  : `Kiểm tra lại ${name.toLocaleLowerCase('vi-VN')}.`,
          );
        }}
        onInput={(e) => {
          (e.target as HTMLInputElement).setCustomValidity('');
          setError('');
        }}
        onChange={(e) => {
          e.currentTarget.dataset.dirty = 'true';
          const target = e.target as unknown as HTMLInputElement;
          setFieldValues((values) => ({ ...values, [target.name]: target.value }));
        }}
      >
        <h3>{title}</h3>
        {notice}
        <div className="core-fields">
          {fields
            .filter((f) => !f.showWhen || fieldValues[f.showWhen.key] === f.showWhen.value)
            .map((f) => (
              <label key={f.key}>
                <span className="field-label">
                  {f.label}
                  {f.optional && <small> (không bắt buộc)</small>}
                </span>
                {f.options ? (
                  <select
                    name={f.key}
                    disabled={busy}
                    aria-label={f.label}
                    required={!f.optional}
                    defaultValue={f.value}
                  >
                    {f.options.length === 0 && <option value="">Chưa có dữ liệu</option>}
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    name={f.key}
                    disabled={busy}
                    aria-label={f.label}
                    defaultValue={f.value}
                    required={!f.optional}
                    maxLength={f.maxLength}
                    rows={3}
                  />
                ) : (
                  <input
                    name={f.key}
                    disabled={busy}
                    aria-label={f.label}
                    type={f.type ?? 'text'}
                    defaultValue={f.value}
                    required={!f.optional}
                    min={f.min}
                    max={f.max}
                    maxLength={f.maxLength}
                    step={f.step}
                    autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  />
                )}
              </label>
            ))}
        </div>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Đang xử lý…' : (submit ?? 'Lưu')}
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
      {pending && (
        <Modal
          title={confirmTitle ?? 'Kiểm tra trước khi xác nhận'}
          close={() => setPending(undefined)}
        >
          <div className="confirm-dialog">
            <div className="confirm-dialog-icon" aria-hidden="true">
              <Icon name="warning" size={28} />
            </div>
            <p>{pending.message}</p>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" onClick={() => setPending(undefined)}>
                Quay lại chỉnh sửa
              </button>
              <button className="primary-button" onClick={() => void execute(pending.values)}>
                {confirmLabel ?? 'Xác nhận'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Action({
  children,
  run,
  confirm,
  ariaLabel,
  busyContent,
  disabled = false,
  confirmLabel,
  confirmTitle,
  successMessage,
}: {
  children: React.ReactNode;
  run: () => Promise<void>;
  confirm?: string;
  confirmLabel?: string;
  confirmTitle?: string;
  ariaLabel?: string;
  busyContent?: React.ReactNode;
  disabled?: boolean;
  successMessage?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirming, setConfirming] = useState(false);
  async function execute() {
    if (disabled) return;
    setConfirming(false);
    setBusy(true);
    setError('');
    try {
      await run();
      if (successMessage) notifySuccess(successMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="core-action">
        <button
          type="button"
          className="secondary-button"
          aria-label={ariaLabel}
          title={ariaLabel}
          aria-busy={busy}
          disabled={busy || disabled}
          onClick={() => (confirm ? setConfirming(true) : void execute())}
        >
          {busy ? (busyContent ?? 'Đang xử lý…') : children}
        </button>
        {error && (
          <span role="alert" className="form-error">
            {error}
          </span>
        )}
      </span>
      {confirming && (
        <Modal title={confirmTitle ?? 'Xác nhận thao tác'} close={() => setConfirming(false)}>
          <div className="confirm-dialog">
            <div className="confirm-dialog-icon" aria-hidden="true">
              <Icon name="warning" size={28} />
            </div>
            <p>{confirm}</p>
            <div className="confirm-dialog-actions">
              <button className="secondary-button" onClick={() => setConfirming(false)}>
                Hủy
              </button>
              <button className="primary-button" onClick={() => void execute()}>
                {confirmLabel ?? 'Tiếp tục'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export const options = (rows: readonly { id: string; [key: string]: unknown }[], field = 'name') =>
  rows.map((r) => ({ value: r.id, label: String(r[field] ?? r.code ?? r.id) }));
