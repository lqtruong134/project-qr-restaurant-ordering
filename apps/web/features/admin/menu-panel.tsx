'use client';
import MenuPromotionsPanel from './menu-promotions-panel';
import { useState } from 'react';
import type { AdminData, SaveAdmin } from './admin-types';
import { ProductImage } from './product-image';
import { EntryForm, options, vnd, type Product, type Field } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { DishImage } from '../shared/dish-image';
import { ComboContents } from '../shared/combo-contents';
import { ComboEditor, type ComboDraft } from './combo-editor';

export default function MenuPanel({
  catalog,
  save,
  initial = 'products',
  initialProductId,
  onProductSaved,
  onProductClose,
}: {
  catalog: AdminData['catalog'];
  save: SaveAdmin;
  initial?: string;
  initialProductId?: string;
  onProductSaved?: () => void;
  onProductClose?: () => void;
}) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [availability, setAvailability] = useState('all'),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Product | undefined>(() =>
      catalog.products.find((p) => p.id === initialProductId),
    ),
    [dialog, setDialog] = useState(initialProductId ? 'product' : '');
  const [newKind, setNewKind] = useState<'DISH' | 'COMBO'>('DISH');
  const [kind, setKind] = useState('all');
  const componentDraft = (p?: Product): ComboDraft[] =>
    p?.components?.length
      ? p.components.map((c) => ({ productId: c.product_id, quantity: String(c.quantity) }))
      : [
          { productId: '', quantity: '1' },
          { productId: '', quantity: '1' },
        ];
  const [components, setComponents] = useState<ComboDraft[]>(() =>
    componentDraft(catalog.products.find((p) => p.id === initialProductId)),
  );
  const rows = catalog.products.filter(
    (p) =>
      (!category || p.category_id === category) &&
      (kind === 'all' || (p.product_kind ?? 'DISH') === kind) &&
      (availability === 'all' ||
        (availability === 'inactive'
          ? !p.is_active
          : p.is_active && p.availability_status === availability)) &&
      matches(p.name + ' ' + p.code, search),
  );
  const index = Math.min(page, Math.max(0, Math.ceil(rows.length / 12) - 1));
  const product = selected && catalog.products.find((p) => p.id === selected.id);
  const isCombo = (product?.product_kind ?? newKind) === 'COMBO';
  const choice = [
    { value: 'true', label: 'Có' },
    { value: 'false', label: 'Không' },
  ];
  const fields: Field[] = [
    { key: 'name', label: 'Tên món', value: product?.name },
    {
      key: 'categoryId',
      label: 'Danh mục',
      value: String(
        product?.category_id ??
          catalog.categories.find((c) => c.is_active && (!isCombo || c.code === 'COMBO'))?.id ??
          catalog.categories.find((c) => c.is_active)?.id ??
          '',
      ),
      options: options(
        catalog.categories.filter((c) => c.is_active || c.id === product?.category_id),
      ),
    },
    ...(!isCombo
      ? [
          {
            key: 'stockManaged',
            label: 'Quản lý nguyên liệu theo công thức',
            value: String(product?.stock_managed ?? true),
            options: choice,
          },
        ]
      : []),
    ...(product
      ? [
          {
            key: 'description',
            label: 'Mô tả món',
            type: 'textarea',
            maxLength: 1000,
            value: String(product.description ?? ''),
            optional: true,
          },
        ]
      : []),
    {
      key: 'price',
      label: 'Giá bán (đồng)',
      type: 'number',
      value: product?.base_price,
      min: 0,
      step: '1',
    },
    {
      key: 'complimentary',
      label: 'Món miễn phí / tặng',
      value: String(product?.is_complimentary ?? false),
      options: choice,
    },
    ...(product
      ? [
          {
            key: 'active',
            label: 'Kinh doanh',
            value: String(product.is_active),
            options: [
              { value: 'true', label: 'Đang bán' },
              { value: 'false', label: 'Ngừng bán' },
            ],
          },
          {
            key: 'availability',
            label: 'Nhận món',
            value: product.configured_availability_status ?? product.availability_status,
            options: [
              { value: 'AVAILABLE', label: 'Cho phép nhận món' },
              { value: 'UNAVAILABLE', label: 'Tạm ngừng nhận món' },
            ],
          },
        ]
      : [{ key: 'code', label: 'Mã món' }]),
  ];
  if (initial === 'promotions') return <MenuPromotionsPanel catalog={catalog} save={save} />;
  if (initialProductId && !catalog.products.some((p) => p.id === initialProductId))
    return (
      <section aria-label="Chỉnh sửa món trong sự cố">
        <Empty title="Không tìm thấy món trong thực đơn">
          Thông tin lúc khách gọi vẫn được giữ trong lịch sử. Quay lại sự cố để tiếp tục kiểm tra.
        </Empty>
        {onProductClose && (
          <button className="secondary-button" onClick={onProductClose}>
            Quay lại sự cố
          </button>
        )}
      </section>
    );
  if (initial === 'categories')
    return (
      <section className="menu-categories" aria-label="Danh mục thực đơn">
        <div className="toolbar">
          <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã danh mục…" />
        </div>
        <div className="category-editor">
          <EntryForm
            title="Thêm danh mục"
            successMessage="Đã thêm danh mục món."
            fields={[
              { key: 'code', label: 'Mã danh mục' },
              { key: 'name', label: 'Tên danh mục' },
            ]}
            onSubmit={(v) => save('/core/categories', v)}
          />
          {catalog.categories
            .filter((c) => matches(`${c.name} ${c.code}`, search))
            .map((c) => (
              <details className="core-card" key={c.id + String(c.updated_at)}>
                <summary>
                  {String(c.name)}{' '}
                  <small>
                    - {catalog.products.filter((p) => p.category_id === c.id).length} món
                  </small>
                </summary>
                <EntryForm
                  title="Sửa danh mục"
                  successMessage={`Đã cập nhật danh mục ${String(c.name)}.`}
                  fields={[
                    { key: 'name', label: 'Tên danh mục', value: String(c.name) },
                    {
                      key: 'sortOrder',
                      label: 'Thứ tự hiển thị',
                      type: 'number',
                      value: Number(c.sort_order),
                      min: 0,
                      max: 10000,
                    },
                    {
                      key: 'active',
                      label: 'Hiển thị',
                      value: String(c.is_active),
                      options: [
                        { value: 'true', label: 'Hiển thị' },
                        { value: 'false', label: 'Ẩn' },
                      ],
                    },
                  ]}
                  onSubmit={(v) =>
                    save(
                      '/core/categories/' + c.id,
                      { ...v, sortOrder: Number(v.sortOrder), active: v.active === 'true' },
                      'PATCH',
                    )
                  }
                />
              </details>
            ))}
          {!catalog.categories.some((c) => matches(`${c.name} ${c.code}`, search)) && (
            <Empty title={search ? 'Không tìm thấy danh mục' : 'Chưa có danh mục món'}>
              {search ? 'Thử tên hoặc mã danh mục khác.' : 'Thêm danh mục trước khi tạo món mới.'}
            </Empty>
          )}
        </div>
      </section>
    );
  return (
    <section className="menu-manager" aria-label="Danh sách món">
      <div className="menu-manager-toolbar">
        <label>
          Loại thực đơn
          <select
            aria-label="Lọc món lẻ và combo"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">Món lẻ & combo</option>
            <option value="DISH">Món lẻ</option>
            <option value="COMBO">Combo</option>
          </select>
        </label>
        <Search
          value={search}
          placeholder="Tìm tên hoặc mã món…"
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
        />
        <label>
          Danh mục món
          <select
            aria-label="Lọc danh mục món"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Tất cả danh mục</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {String(c.name)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tình trạng kinh doanh
          <select
            aria-label="Lọc tình trạng kinh doanh"
            value={availability}
            onChange={(e) => {
              setAvailability(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">Tất cả tình trạng</option>
            <option value="AVAILABLE">Đang bán</option>
            <option value="UNAVAILABLE">Tạm hết</option>
            <option value="inactive">Ngừng bán</option>
          </select>
        </label>
        {(search || category || availability !== 'all' || kind !== 'all') && (
          <button
            className="secondary-button"
            onClick={() => {
              setSearch('');
              setCategory('');
              setAvailability('all');
              setKind('all');
              setPage(0);
            }}
          >
            Xóa bộ lọc
          </button>
        )}
        <button
          className="primary-button"
          onClick={() => {
            setSelected(undefined);
            setNewKind('DISH');
            setDialog('product');
          }}
        >
          <Icon name="plus" />
          Thêm món
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setSelected(undefined);
            setNewKind('COMBO');
            setComponents(componentDraft());
            setDialog('product');
          }}
        >
          <Icon name="plus" /> Thêm combo
        </button>
      </div>
      <p className="result-count">
        {rows.length} món - Chọn “Chỉnh sửa” để thay ảnh, giá hoặc thông tin món.
      </p>
      {!rows.length && (
        <Empty
          title={
            catalog.products.length ? 'Không tìm thấy món phù hợp' : 'Chưa có món trong thực đơn'
          }
        >
          {catalog.products.length
            ? 'Thử tên món khác hoặc xóa bộ lọc.'
            : 'Tạo danh mục rồi chọn Thêm món để bắt đầu.'}
        </Empty>
      )}
      <div className="managed-menu-grid">
        {rows.slice(index * 12, (index + 1) * 12).map((p) => (
          <article className="managed-dish" key={p.id}>
            <DishImage code={p.code} name={p.name} url={p.image_url} />
            <div className="managed-dish-body">
              <span className="dish-code">{p.code}</span>
              <h3>{p.name}</h3>
              {p.product_kind === 'COMBO' && (
                <>
                  <span className="combo-badge">Combo</span>
                  <ComboContents components={p.components} />
                </>
              )}
              <p>{String(catalog.categories.find((c) => c.id === p.category_id)?.name ?? '')}</p>
              <div className="managed-dish-price">
                <strong>{vnd(p.base_price)}</strong>
                <span
                  className="status-pill"
                  data-status={p.is_active ? p.availability_status : 'INACTIVE'}
                >
                  {p.is_active
                    ? p.availability_status === 'AVAILABLE'
                      ? 'Đang bán'
                      : 'Tạm hết'
                    : 'Ngừng bán'}
                </span>
              </div>
              <button
                className="secondary-button"
                aria-label={'Chỉnh sửa ' + p.name}
                onClick={() => {
                  setSelected(p);
                  setComponents(componentDraft(p));
                  setDialog('product');
                }}
              >
                Chỉnh sửa
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {rows.length > 12 && (
        <nav className="list-pagination" aria-label="Phân trang thực đơn">
          <span>
            {index * 12 + 1}–{Math.min((index + 1) * 12, rows.length)} / {rows.length} món
          </span>
          <button className="secondary-button" disabled={!index} onClick={() => setPage(index - 1)}>
            Trang trước
          </button>
          <span>
            {index + 1} / {Math.ceil(rows.length / 12)}
          </span>
          <button
            className="secondary-button"
            disabled={(index + 1) * 12 >= rows.length}
            onClick={() => setPage(index + 1)}
          >
            Trang sau
          </button>
        </nav>
      )}
      {dialog === 'product' && (
        <Modal
          title={
            product
              ? (isCombo ? 'Chỉnh sửa combo - ' : 'Chỉnh sửa món - ') + product.name
              : isCombo
                ? 'Thêm combo mới'
                : 'Thêm món mới'
          }
          wide
          close={() => {
            if (onProductClose) onProductClose();
            else setDialog('');
          }}
        >
          <p className="context-notice">
            {isCombo
              ? 'Combo có giá riêng và được xử lý cả phần. Nguyên liệu tự tổng hợp từ các món thành phần; thay đổi chỉ áp dụng cho lượt gọi mới.'
              : product
                ? 'Ngừng bán sẽ ẩn món khỏi thực đơn khách. Tạm hết sẽ ngừng nhận món mới. Đơn đã gửi giữ tên và giá lúc gọi; món quản lý kho vẫn cần có công thức và đủ nguyên liệu để nhận thêm.'
                : 'Sau khi tạo món, bạn có thể thêm ảnh và mô tả. Món có quản lý nguyên liệu cần công thức và đủ tồn kho trước khi nhận khách gọi.'}
          </p>
          <div className="product-editor">
            {product && (
              <aside>
                <DishImage code={product.code} name={product.name} url={product.image_url} eager />
                <h3>{product.name}</h3>
                <p>Mã món: {product.code}</p>
                <p className="small-note">
                  Cho phép nhận món vẫn cần đủ nguyên liệu và các món thành phần đang bán. Hiện tại:{' '}
                  {product.is_active && product.availability_status === 'AVAILABLE'
                    ? 'có thể nhận món'
                    : 'chưa thể nhận món'}
                  .
                </p>
                <ProductImage
                  save={async (imageUrl) => {
                    await save(
                      '/core/products/' + product.id,
                      {
                        name: product.name,
                        price: product.base_price,
                        active: product.is_active,
                        availability:
                          product.configured_availability_status ?? product.availability_status,
                        version: product.version,
                        imageUrl,
                      },
                      'PATCH',
                    );
                    setComponents(componentDraft(product));
                  }}
                />
              </aside>
            )}
            <EntryForm
              key={`${product?.id ?? 'new'}-${product?.version ?? newKind}`}
              title={isCombo ? 'Thông tin combo' : product ? 'Thông tin món' : 'Thông tin món mới'}
              fields={fields}
              notice={
                isCombo ? (
                  <ComboEditor
                    products={catalog.products.filter(
                      (p) =>
                        catalog.categories.some((c) => c.id === p.category_id && c.is_active) ||
                        components.some((row) => row.productId === p.id),
                    )}
                    rows={components}
                    onChange={setComponents}
                  />
                ) : undefined
              }
              submit={isCombo ? 'Lưu combo' : 'Lưu món'}
              successMessage={
                product
                  ? 'Đã cập nhật thực đơn.'
                  : isCombo
                    ? 'Đã thêm combo mới.'
                    : 'Đã thêm món mới.'
              }
              onSubmit={async (v) => {
                await save(
                  product ? '/core/products/' + product.id : '/core/products',
                  {
                    ...v,
                    ...(!isCombo ? { stockManaged: v.stockManaged === 'true' } : {}),
                    complimentary: v.complimentary === 'true',
                    productKind: isCombo ? 'COMBO' : 'DISH',
                    ...(isCombo
                      ? {
                          components: components.map((row) => ({
                            productId: row.productId,
                            quantity: Number(row.quantity),
                          })),
                        }
                      : {}),
                    ...(product ? { active: v.active === 'true', version: product.version } : {}),
                  },
                  product ? 'PATCH' : 'POST',
                );
                setDialog('');
                onProductSaved?.();
              }}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
