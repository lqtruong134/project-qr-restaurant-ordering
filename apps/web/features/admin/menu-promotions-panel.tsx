'use client';
import { useRef, useState } from 'react';
import type { MenuPromotion } from '@thesis/contracts';
import type { AdminData, SaveAdmin } from './admin-types';
import { ProductImage } from './product-image';
import { Action, vnd } from '../shared/components';
import { DishImage } from '../shared/dish-image';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';

export default function MenuPromotionsPanel({
  catalog,
  save,
}: {
  catalog: AdminData['catalog'];
  save: SaveAdmin;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<MenuPromotion | null>(),
    [productId, setProductId] = useState(''),
    [imageUrl, setImageUrl] = useState(''),
    [presentation, setPresentation] = useState<'PHOTO' | 'POSTER'>('PHOTO');
  const [eyebrow, setEyebrow] = useState(''),
    [imageNote, setImageNote] = useState(''),
    [sortOrder, setSortOrder] = useState('0'),
    [isActive, setIsActive] = useState(true),
    [hasPrice, setHasPrice] = useState(false),
    [price, setPrice] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const promotions = catalog.promotions ?? [];
  const products = catalog.products.filter((p) => p.is_active || p.id === editing?.product_id);
  const product = catalog.products.find((p) => p.id === productId);
  const rows = promotions.filter(
    (row) =>
      matches(`${row.product_name ?? ''} ${row.product_code ?? ''} ${row.eyebrow ?? ''}`, search) &&
      (filter === 'all' ||
        (filter === 'hidden'
          ? !row.is_active
          : filter === 'review'
            ? row.matches_current_menu === false
            : row.is_active && row.matches_current_menu !== false)),
  );
  const markDirty = () => {
    if (form.current) form.current.dataset.dirty = 'true';
    setError('');
    setConfirmed(false);
  };
  const open = (row: MenuPromotion | null) => {
    setEditing(row);
    setError('');
    setConfirmed(false);
    const chosen =
      catalog.products.find((p) => p.id === row?.product_id) ??
      products.find((p) => !promotions.some((r) => r.product_id === p.id));
    setProductId(chosen?.id ?? '');
    setImageUrl(row?.image_url ?? chosen?.image_url ?? '');
    setPresentation(row?.presentation ?? 'PHOTO');
    setEyebrow(row?.eyebrow ?? '');
    setImageNote(row?.image_note ?? '');
    setSortOrder(String(row?.sort_order ?? promotions.length));
    setIsActive(row?.is_active ?? true);
    setHasPrice(row?.expected_price != null);
    setPrice(row?.expected_price ?? '');
  };
  return (
    <section className="menu-promotions-panel" aria-label="Ảnh giới thiệu trên thực đơn">
      <div className="section-heading">
        <div>
          <h2>Danh sách ảnh giới thiệu</h2>
          <p>
            Chọn những món muốn giới thiệu ở đầu thực đơn khách. Khách nhấn ảnh để xem và chọn món.
          </p>
        </div>
        <button className="primary-button" disabled={!products.length} onClick={() => open(null)}>
          <Icon name="plus" size={18} /> Thêm ảnh giới thiệu
        </button>
      </div>
      <div className="toolbar menu-manager-toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Tìm món hoặc nội dung giới thiệu…"
        />
        <label>
          Hiển thị
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Tất cả ảnh</option>
            <option value="visible">Đang bật</option>
            <option value="hidden">Đã ẩn</option>
            <option value="review">Cần cập nhật ảnh</option>
          </select>
        </label>
        <button
          className="secondary-button"
          onClick={() => {
            setSearch('');
            setFilter('all');
          }}
        >
          Xóa bộ lọc
        </button>
      </div>
      {!rows.length ? (
        <Empty title={promotions.length ? 'Không tìm thấy ảnh phù hợp' : 'Chưa có ảnh giới thiệu'}>
          {promotions.length
            ? 'Thử tên món khác hoặc xóa bộ lọc.'
            : 'Chọn Thêm ảnh giới thiệu để đưa một món lên đầu thực đơn khách.'}
        </Empty>
      ) : (
        <div className="managed-menu-grid">
          {rows.map((row) => {
            const selected = catalog.products.find((p) => p.id === row.product_id),
              canOrder = selected?.is_active && selected.availability_status === 'AVAILABLE';
            const status = !row.is_active
              ? 'Đã ẩn'
              : row.matches_current_menu === false
                ? 'Cần cập nhật ảnh'
                : !canOrder
                  ? 'Chưa nhận gọi món'
                  : 'Đang hiển thị';
            return (
              <article
                className="managed-dish"
                key={row.id}
                aria-label={'Ảnh giới thiệu ' + (row.product_name ?? selected?.name ?? 'món')}
              >
                <DishImage
                  code={row.product_code ?? ''}
                  name={row.product_name ?? selected?.name ?? 'Ảnh giới thiệu'}
                  url={row.image_url}
                  poster={row.presentation === 'POSTER'}
                />
                <div className="managed-dish-body">
                  <span className="status-pill">{status}</span>
                  <h3>{row.product_name ?? selected?.name}</h3>
                  <p>{row.eyebrow || 'Gợi ý từ thực đơn'}</p>
                  {row.expected_price !== null && (
                    <p>
                      Giá trên ảnh: <strong>{vnd(row.expected_price)}</strong>
                    </p>
                  )}
                  <small>Thứ tự: {row.sort_order}</small>
                  {row.matches_current_menu === false && (
                    <p className="form-error">
                      Giá hoặc phần ăn đã thay đổi. Ảnh này được ẩn với khách cho đến khi bạn cập
                      nhật.
                    </p>
                  )}
                  <div className="core-actions">
                    <button className="secondary-button" onClick={() => open(row)}>
                      Sửa
                    </button>
                    <Action
                      run={() =>
                        save(
                          '/core/menu-promotions/' + row.id,
                          { version: row.version, isActive: !row.is_active },
                          'PATCH',
                        )
                      }
                    >
                      {row.is_active ? 'Ẩn ảnh' : 'Hiện ảnh'}
                    </Action>
                    <Action
                      confirm="Xóa ảnh giới thiệu này khỏi thực đơn khách? Món và ảnh món vẫn được giữ."
                      confirmTitle="Xóa ảnh giới thiệu?"
                      confirmLabel="Xóa ảnh giới thiệu"
                      run={() =>
                        save('/core/menu-promotions/' + row.id, { version: row.version }, 'DELETE')
                      }
                    >
                      Xóa
                    </Action>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? 'Sửa ảnh giới thiệu' : 'Thêm ảnh giới thiệu'}
          close={() => setEditing(undefined)}
        >
          <div className="product-editor">
            <aside>
              <DishImage
                code={product?.code ?? ''}
                name={product?.name ?? 'Ảnh giới thiệu'}
                url={imageUrl}
                poster={presentation === 'POSTER'}
                eager
              />
              <ProductImage
                label="Tải ảnh giới thiệu (PNG, JPEG, WebP; tối đa 2 MB)"
                successMessage="Ảnh đã sẵn sàng. Chọn Lưu ảnh giới thiệu để hoàn tất."
                confirmDiscardBeforeUpload={false}
                disabled={busy}
                onBusyChange={setUploading}
                save={async (url) => {
                  setImageUrl(url);
                  markDirty();
                }}
              />
              <button
                className="secondary-button"
                disabled={busy || uploading || !product?.image_url}
                onClick={() => {
                  setImageUrl(product?.image_url ?? '');
                  markDirty();
                }}
              >
                Dùng ảnh hiện tại của món
              </button>
            </aside>
            <form
              className="core-form"
              ref={form}
              aria-busy={busy || uploading}
              onChange={(e) => {
                if (e.target instanceof HTMLInputElement && e.target.name === 'confirmed') {
                  if (form.current) form.current.dataset.dirty = 'true';
                } else markDirty();
              }}
              onInvalid={(event) => {
                event.preventDefault();
                const field = event.target as HTMLInputElement;
                setError(
                  field.getAttribute('aria-label') === 'Giá ghi trên ảnh (đồng)'
                    ? 'Nhập giá ghi trên ảnh bằng số nguyên không âm.'
                    : field.getAttribute('aria-label') === 'Thứ tự hiển thị'
                      ? 'Nhập thứ tự từ 0 đến 1000.'
                      : 'Chọn món cần giới thiệu.',
                );
                field.focus();
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || uploading) return;
                if (!imageUrl) {
                  setError('Chọn hoặc tải ảnh giới thiệu trước khi lưu.');
                  return;
                }
                if (!confirmed) {
                  setError('Kiểm tra ảnh và xác nhận thông tin trước khi lưu.');
                  return;
                }
                setBusy(true);
                setError('');
                try {
                  await save(
                    '/core/menu-promotions' + (editing ? '/' + editing.id : ''),
                    {
                      productId,
                      imageUrl,
                      presentation,
                      eyebrow,
                      imageNote,
                      sortOrder: Number(sortOrder),
                      isActive,
                      expectedPrice: hasPrice ? price : null,
                      refreshChecks: true,
                      ...(editing ? { version: editing.version } : {}),
                    },
                    editing ? 'PATCH' : 'POST',
                  );
                  if (form.current) delete form.current.dataset.dirty;
                  setEditing(undefined);
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : 'Chưa lưu được ảnh giới thiệu.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3>Thông tin giới thiệu</h3>
              <div className="core-fields">
                <label>
                  Món được giới thiệu
                  <select
                    aria-label="Món được giới thiệu"
                    required
                    disabled={busy || uploading}
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      const chosen = catalog.products.find((p) => p.id === e.target.value);
                      if (!editing) {
                        setImageUrl(chosen?.image_url ?? '');
                        setHasPrice(chosen?.image_promotion?.expected_price != null);
                        setPrice(chosen?.image_promotion?.expected_price ?? '');
                        setPresentation(chosen?.image_promotion?.presentation ?? 'PHOTO');
                      }
                    }}
                  >
                    <option value="">Chọn món</option>
                    {products
                      .filter(
                        (p) =>
                          p.id === editing?.product_id ||
                          !promotions.some((row) => row.product_id === p.id),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {vnd(p.base_price)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Loại ảnh
                  <select
                    aria-label="Loại ảnh giới thiệu"
                    disabled={busy || uploading}
                    value={presentation}
                    onChange={(e) => setPresentation(e.target.value as 'PHOTO' | 'POSTER')}
                  >
                    <option value="PHOTO">Ảnh món</option>
                    <option value="POSTER">Ảnh có sẵn chữ</option>
                  </select>
                </label>
                <label>
                  Dòng giới thiệu ngắn
                  <input
                    aria-label="Dòng giới thiệu ngắn"
                    disabled={busy || uploading}
                    maxLength={80}
                    value={eyebrow}
                    placeholder="Ví dụ: Món mới từ bếp"
                    onChange={(e) => setEyebrow(e.target.value)}
                  />
                </label>
                <label>
                  Ghi chú dưới ảnh
                  <textarea
                    aria-label="Ghi chú dưới ảnh"
                    disabled={busy || uploading}
                    maxLength={300}
                    rows={3}
                    value={imageNote}
                    onChange={(e) => setImageNote(e.target.value)}
                  />
                </label>
                <label>
                  Thứ tự hiển thị
                  <input
                    aria-label="Thứ tự hiển thị"
                    disabled={busy || uploading}
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    required
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                </label>
                <label>
                  Hiển thị với khách
                  <select
                    aria-label="Hiển thị với khách"
                    disabled={busy || uploading}
                    value={String(isActive)}
                    onChange={(e) => setIsActive(e.target.value === 'true')}
                  >
                    <option value="true">Bật</option>
                    <option value="false">Ẩn</option>
                  </select>
                </label>
              </div>
              <label className="policy-consent">
                <input
                  type="checkbox"
                  disabled={busy || uploading}
                  checked={hasPrice}
                  onChange={(e) => setHasPrice(e.target.checked)}
                />
                <span>Ảnh có ghi giá bán</span>
              </label>
              {hasPrice && (
                <label>
                  Giá ghi trên ảnh (đồng)
                  <input
                    aria-label="Giá ghi trên ảnh (đồng)"
                    disabled={busy || uploading}
                    inputMode="numeric"
                    pattern="[0-9]+"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
              )}
              <p className="small-note">
                Nếu ảnh có ghi giá, nhập đúng giá trên ảnh. Khi đổi giá hoặc thành phần combo, ảnh
                cũ sẽ được ẩn để khách không đọc nhầm.
              </p>
              {product?.product_kind === 'COMBO' && (
                <p>
                  Phần ăn hiện tại:{' '}
                  {product.components?.map((c) => `${c.quantity} × ${c.name}`).join(' + ')}
                </p>
              )}
              <label className="policy-consent">
                <input
                  name="confirmed"
                  type="checkbox"
                  disabled={busy || uploading}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>Tôi đã kiểm tra ảnh đúng món, giá và phần ăn hiện tại.</span>
              </label>
              <button className="primary-button" disabled={busy || uploading}>
                {busy ? 'Đang lưu…' : uploading ? 'Đang tải ảnh…' : 'Lưu ảnh giới thiệu'}
              </button>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </div>
        </Modal>
      )}
    </section>
  );
}
