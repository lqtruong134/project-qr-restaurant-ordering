'use client';
import { vnd, type Product } from '../shared/components';
import { Icon } from '../shared/primitives';

export type ComboDraft = { productId: string; quantity: string };
export function ComboEditor({
  products,
  rows,
  onChange,
}: {
  products: Product[];
  rows: ComboDraft[];
  onChange: (rows: ComboDraft[]) => void;
}) {
  const choices = products.filter((product) => product.product_kind !== 'COMBO');
  const regular = rows.reduce((sum, row) => {
    const product = choices.find((product) => product.id === row.productId);
    const quantity = Number(row.quantity);
    return product && Number.isInteger(quantity) && quantity > 0 && quantity <= 20
      ? sum + BigInt(product.base_price) * BigInt(quantity)
      : sum;
  }, 0n);
  return (
    <fieldset className="combo-editor">
      <legend>Món trong combo</legend>
      <p>Chọn ít nhất 2 món khác nhau. Công thức nguyên liệu được tổng hợp từ các món này.</p>
      <div className="combo-editor-head" aria-hidden="true">
        <span>Món thành phần</span>
        <span>Số phần</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="combo-editor-row" key={index}>
          <label>
            <span className="sr-only">Món thành phần {index + 1}</span>
            <select
              required
              name={`comboProduct${index}`}
              value={row.productId}
              onChange={(event) =>
                onChange(
                  rows.map((item, at) =>
                    at === index ? { ...item, productId: event.target.value } : item,
                  ),
                )
              }
            >
              <option value="">Chọn món</option>
              {choices
                .filter(
                  (product) =>
                    product.id === row.productId ||
                    (product.is_active &&
                      !rows.some((other, at) => at !== index && other.productId === product.id)),
                )
                .map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {vnd(product.base_price)}
                    {!product.is_active
                      ? ' · Ngừng bán'
                      : product.availability_status !== 'AVAILABLE'
                        ? ' · Tạm hết'
                        : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Số phần của món {index + 1}</span>
            <input
              name={`comboQuantity${index}`}
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={row.quantity}
              onChange={(event) =>
                onChange(
                  rows.map((item, at) =>
                    at === index ? { ...item, quantity: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="combo-remove"
            aria-label={`Bỏ món thành phần ${index + 1}`}
            disabled={rows.length <= 2}
            onClick={(event) => {
              const form = event.currentTarget.closest('form');
              if (form) form.dataset.dirty = 'true';
              onChange(rows.filter((_, at) => at !== index));
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div className="combo-editor-footer">
        <button
          type="button"
          className="secondary-button"
          disabled={rows.length >= 20}
          onClick={(event) => {
            const form = event.currentTarget.closest('form');
            if (form) form.dataset.dirty = 'true';
            onChange([...rows, { productId: '', quantity: '1' }]);
          }}
        >
          <Icon name="plus" size={16} /> Thêm món thành phần
        </button>
        <span>
          Tổng giá bán lẻ: <strong>{vnd(regular)}</strong>
        </span>
      </div>
      <p className="small-note">
        Combo được gọi và xử lý cả phần. Khi một món thành phần tạm hết, combo ngừng nhận thêm.
      </p>
    </fieldset>
  );
}
