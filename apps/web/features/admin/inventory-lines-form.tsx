'use client';
import { useState, type FormEvent } from 'react';
import type { Row } from '../shared/components';
import { notifySuccess } from '../shared/operation-notice';
import { Icon } from '../shared/primitives';
import { decimalInput, money } from './inventory-ui';

export type InventoryLine = {
  ingredientId: string;
  quantity: string;
  unitCost: string;
  waste: string;
};
export function InventoryLinesForm({
  mode,
  ingredients,
  choices,
  initial,
  reasonRequired = false,
  save,
  successMessage,
}: {
  mode: 'receipt' | 'bom';
  ingredients: Row[];
  choices: { value: string; label: string }[];
  initial?: {
    target?: string;
    number?: string;
    supplier?: string;
    externalReference?: string;
    yield?: string;
    lines?: InventoryLine[];
  };
  reasonRequired?: boolean;
  save: (header: Record<string, string>, lines: InventoryLine[]) => Promise<void>;
  successMessage?: string | false;
}) {
  const [lines, setLines] = useState<InventoryLine[]>(
    initial?.lines?.length
      ? initial.lines.map((line) => ({
          ...line,
          quantity: decimalInput(line.quantity),
          unitCost: decimalInput(line.unitCost),
          waste: decimalInput(line.waste),
        }))
      : [{ ingredientId: ingredients[0]?.id ?? '', quantity: '', unitCost: '', waste: '0' }],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = (index: number, field: keyof InventoryLine, value: string) => {
    setError('');
    setLines(lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError('');
    setBusy(true);
    try {
      if (!lines.length) throw new Error('Cần ít nhất một nguyên liệu.');
      if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length)
        throw new Error('Mỗi nguyên liệu chỉ xuất hiện một lần.');
      await save(Object.fromEntries(new FormData(form).entries()) as Record<string, string>, lines);
      delete form.dataset.dirty;
      if (successMessage !== false)
        notifySuccess(
          successMessage ??
            (mode === 'receipt' ? 'Đã lưu phiếu nhập nháp.' : 'Đã lưu công thức mới.'),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="inv-entry-form"
      onSubmit={submit}
      onChange={(e) => {
        e.currentTarget.dataset.dirty = 'true';
      }}
    >
      {(!ingredients.length || !choices.length) && (
        <p className="context-notice">
          {!ingredients.length
            ? 'Chưa có nguyên liệu để lập phiếu hoặc công thức. Hãy thêm nguyên liệu trong Kho & công thức.'
            : 'Chưa có kho hoặc món phù hợp. Hãy kiểm tra danh mục trước khi tiếp tục.'}
        </p>
      )}
      <div className="inv-form-intro">
        <span className="inv-step">1</span>
        <div>
          <h3>{mode === 'receipt' ? 'Thông tin phiếu nhập' : 'Món và số phần'}</h3>
          <p>
            {mode === 'receipt'
              ? 'Lưu nháp để kiểm tra hàng; duyệt phiếu mới tăng tồn kho.'
              : 'Lượng nguyên liệu bên dưới dùng để làm số phần này.'}
          </p>
        </div>
      </div>
      <div className="inv-form-grid">
        <label>
          {mode === 'receipt' ? 'Kho nhận' : 'Món áp dụng'}
          <select
            disabled={busy}
            aria-label={mode === 'receipt' ? 'Kho nhận' : 'Món áp dụng'}
            name="target"
            defaultValue={initial?.target ?? choices[0]?.value}
            required
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {mode === 'receipt' ? (
          <>
            <div className="inv-auto-code" role="note">
              <span>Mã phiếu nội bộ - Tự động</span>
              <strong>{initial?.number ?? 'Tự động tạo khi lưu'}</strong>
              <small>Ngày lập và người lập được ghi nhận khi lưu phiếu.</small>
            </div>
            <label>
              Nhà cung cấp / Nguồn mua <small>(không bắt buộc)</small>
              <input
                disabled={busy}
                name="supplier"
                defaultValue={initial?.supplier}
                maxLength={120}
                placeholder="Ví dụ: Công ty ABC, Chợ Tân An…"
              />
            </label>
            <label>
              Mã chứng từ bên ngoài <small>(không bắt buộc)</small>
              <input
                disabled={busy}
                name="externalReference"
                defaultValue={initial?.externalReference}
                maxLength={120}
                placeholder="Số hóa đơn / phiếu giao hàng, nếu có"
              />
              <small>Mua ngoài chợ không có chứng từ vẫn lập được phiếu.</small>
            </label>
          </>
        ) : (
          <label>
            Số phần công thức tạo ra
            <input
              disabled={busy}
              type="number"
              name="yield"
              defaultValue={decimalInput(initial?.yield ?? '1')}
              min="0.000001"
              step="0.000001"
              required
            />
          </label>
        )}
        {reasonRequired && (
          <label className="inv-span">
            Lý do sửa
            <input
              disabled={busy}
              name="reason"
              required
              maxLength={500}
              placeholder="Ví dụ: sửa số lượng theo phiếu giao hàng"
            />
          </label>
        )}
      </div>
      <div className="inv-form-intro">
        <span className="inv-step">2</span>
        <div>
          <h3>{mode === 'receipt' ? 'Hàng nhận vào kho' : 'Nguyên liệu cần dùng'}</h3>
          <p>Nhập theo đơn vị bên cạnh tên nguyên liệu.</p>
        </div>
      </div>
      <div className="inv-line-editor">
        {lines.map((line, index) => {
          const ingredient = ingredients.find((i) => i.id === line.ingredientId);
          return (
            <div className="inv-edit-line" key={index}>
              <label>
                Nguyên liệu {index + 1}
                <select
                  disabled={busy}
                  aria-label={`Nguyên liệu ${index + 1}`}
                  value={line.ingredientId}
                  onChange={(e) => change(index, 'ingredientId', e.target.value)}
                  required
                >
                  {ingredients
                    .filter(
                      (i) =>
                        i.id === line.ingredientId || !lines.some((l) => l.ingredientId === i.id),
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {String(i.name)} - {String(i.unit_code)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Số lượng ({String(ingredient?.unit_code ?? 'đơn vị cơ sở')})
                <input
                  disabled={busy}
                  aria-label={`Số lượng dòng ${index + 1}`}
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  required
                  value={line.quantity}
                  onChange={(e) => change(index, 'quantity', e.target.value)}
                />
              </label>
              {mode === 'receipt' ? (
                <label>
                  Đơn giá (đ/{String(ingredient?.unit_code ?? 'đơn vị')})
                  <input
                    disabled={busy}
                    aria-label={`Đơn giá dòng ${index + 1}`}
                    type="number"
                    min="0"
                    step="0.000001"
                    required
                    value={line.unitCost}
                    onChange={(e) => change(index, 'unitCost', e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  Hao hụt (%)
                  <input
                    disabled={busy}
                    aria-label={`Hao hụt dòng ${index + 1}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={line.waste}
                    onChange={(e) => change(index, 'waste', e.target.value)}
                  />
                </label>
              )}

              <button
                className="icon-button"
                type="button"
                aria-label={`Bỏ dòng ${index + 1}`}
                disabled={busy || lines.length === 1}
                onClick={(e) => {
                  e.currentTarget.closest('form')!.dataset.dirty = 'true';
                  setLines(lines.filter((_, i) => i !== index));
                }}
              >
                <Icon name="close" size={17} />
              </button>
              {mode === 'receipt' && (
                <p className="inv-line-value">
                  Thành tiền:{' '}
                  <strong>
                    {money(Math.round(Number(line.quantity) * Number(line.unitCost)))}
                  </strong>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button
        className="secondary-button"
        type="button"
        disabled={
          busy || lines.length >= Math.min(mode === 'receipt' ? 100 : 50, ingredients.length)
        }
        onClick={(e) => {
          e.currentTarget.closest('form')!.dataset.dirty = 'true';
          setLines([
            ...lines,
            {
              ingredientId:
                ingredients.find((i) => !lines.some((l) => l.ingredientId === i.id))?.id ?? '',
              quantity: '',
              unitCost: '',
              waste: '0',
            },
          ]);
        }}
      >
        <Icon name="plus" size={17} />
        Thêm nguyên liệu
      </button>
      <div className="inv-form-footer">
        <div>
          <strong>
            {mode === 'receipt'
              ? money(
                  lines.reduce(
                    (sum, l) => sum + Math.round(Number(l.quantity) * Number(l.unitCost)),
                    0,
                  ),
                )
              : `${lines.length} nguyên liệu`}
          </strong>
          <small>
            {mode === 'receipt' ? 'Tổng giá trị phiếu' : 'Lưu thành phiên bản công thức mới'}
          </small>
        </div>
        <button
          className="primary-button"
          disabled={busy || !choices.length || !ingredients.length}
        >
          {busy ? 'Đang lưu…' : mode === 'receipt' ? 'Lưu phiếu nháp' : 'Lưu công thức mới'}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
