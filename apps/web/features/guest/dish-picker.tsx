'use client';
import { useId, useState } from 'react';
import { vnd, type Product } from '../shared/components';
import { DishImage } from '../shared/dish-image';
import { QuantityStepper } from '../shared/quantity-stepper';
import { ComboContents } from './combo-contents';
import { ComboGallery } from './combo-gallery';
import { safeProductImage } from './menu-promotions';

export function DishPicker({
  product,
  add,
}: {
  product: Product;
  add: (quantity: number, note: string, mode: 'cart' | 'now') => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(1),
    [note, setNote] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const noteId = useId();
  async function save(next: 'cart' | 'now') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await add(quantity, note.trim(), next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="dish-picker"
      aria-busy={busy}
      aria-label="Chọn món"
      onSubmit={(e) => {
        e.preventDefault();
        void save('cart');
      }}
    >
      <div
        className={
          'add-dish-preview' + (product.product_kind === 'COMBO' ? ' combo-picker-preview' : '')
        }
      >
        {product.product_kind !== 'COMBO' && (
          <DishImage
            code={product.code}
            name={product.name}
            url={safeProductImage(product)}
            poster={product.image_promotion?.presentation === 'POSTER'}
            eager
          />
        )}
        <div>
          <h3>{product.name}</h3>
          <strong>
            {vnd(product.base_price)} / {product.product_kind === 'COMBO' ? 'combo' : 'phần'}
          </strong>
          {product.description && <p>{String(product.description)}</p>}
        </div>
      </div>
      {product.product_kind === 'COMBO' && (
        <div className="combo-picker-gallery">
          <ComboGallery product={product} eager />
        </div>
      )}
      {product.product_kind === 'COMBO' && <ComboContents components={product.components} />}
      <div className="dish-picker-quantity">
        <span>{product.product_kind === 'COMBO' ? 'Số combo' : 'Số lượng'}</span>
        <QuantityStepper
          value={quantity}
          label={'Số lượng ' + product.name}
          onChange={setQuantity}
          disabled={busy}
        />
      </div>
      <label htmlFor={noteId}>
        Ghi chú cho bếp <small>(không bắt buộc)</small>
      </label>
      <textarea
        id={noteId}
        value={note}
        disabled={busy}
        maxLength={300}
        rows={2}
        placeholder="Ví dụ: ít cay, không hành…"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="dish-picker-total">
        <span>Tạm tính</span>
        <strong>{vnd(BigInt(product.base_price) * BigInt(quantity))}</strong>
      </div>
      <p className="small-note">
        “Thêm vào giỏ” để chọn tiếp. “Gọi ngay” mở giỏ với riêng món này được chọn; bạn vẫn kiểm tra
        trước khi gửi bếp.
      </p>
      <div className="dish-picker-actions">
        <button type="submit" className="secondary-button" disabled={busy}>
          Thêm vào giỏ
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void save('now')}
        >
          {busy ? 'Đang thêm món…' : 'Gọi ngay'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
