'use client';
import { useState } from 'react';
import type { Inventory, SaveAdmin } from './admin-types';
import type { Product } from '../shared/components';
import { options } from '../shared/components';
import { Empty, Modal, Search, matches } from '../shared/primitives';
import { InventoryLinesForm } from './inventory-lines-form';
import { Badge, quantity, Paginated, PanelHeading } from './inventory-ui';
import { ComboContents } from '../shared/combo-contents';
export function InventoryRecipes({
  inventory,
  products,
  search,
  setSearch,
  save,
}: {
  inventory: Inventory;
  products: Product[];
  search: string;
  setSearch: (value: string) => void;
  save: SaveAdmin;
}) {
  const [selected, setSelected] = useState<Product | null>(null),
    [editing, setEditing] = useState(false),
    [filter, setFilter] = useState('all');
  const recipeFor = (id: string) => inventory.recipes.find((r) => r.product_id === id);
  const rows = products
    .filter((p) => p.stock_managed)
    .filter((p) => matches(`${p.name} ${p.code}`, search))
    .filter(
      (p) => filter === 'all' || (filter === 'missing' ? !recipeFor(p.id) : !!recipeFor(p.id)),
    );
  const recipe = selected && recipeFor(selected.id),
    lines = inventory.recipeItems.filter((l) => l.recipe_bom_id === recipe?.id);
  return (
    <section className="inv-panel">
      <PanelHeading
        title="Công thức nguyên liệu của món"
        hint="Xem mỗi món dùng nguyên liệu gì và bao nhiêu. Công thức giúp hệ thống giữ và trừ kho khi gọi món."
      />
      <div className="inv-toolbar">
        <Search value={search} onChange={setSearch} placeholder="Tìm món hoặc mã món…" />
        <label>
          Công thức
          <select aria-label="Công thức" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Tất cả món quản lý kho</option>
            <option value="ready">Đã có công thức</option>
            <option value="missing">Chưa có công thức</option>
          </select>
        </label>
        {(search || filter !== 'all') && (
          <button
            className="secondary-button"
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
      {rows.length ? (
        <Paginated key={`${search}-${filter}`} items={rows}>
          {(page) => (
            <div className="inv-recipe-grid">
              {page.map((p) => {
                const r = recipeFor(p.id),
                  items = inventory.recipeItems.filter((l) => l.recipe_bom_id === r?.id);
                return (
                  <article className="inv-recipe-card" key={p.id}>
                    <div>
                      <h3>{p.name}</h3>
                      {p.product_kind === 'COMBO' && <span className="combo-badge">Combo</span>}
                      <small>{p.code}</small>
                      <Badge kind={r ? 'ready' : 'low'}>
                        {r ? `Phiên bản ${r.version_no}` : 'Chưa có công thức'}
                      </Badge>
                    </div>
                    <p>
                      {r
                        ? `${items.length} nguyên liệu - cho ${quantity(r.yield_quantity)} phần`
                        : 'Cần thiết lập nguyên liệu trước khi nhận món.'}
                    </p>
                    <div className="inv-recipe-preview">
                      {items.slice(0, 3).map((l) => (
                        <span key={l.id}>{String(l.ingredient_name)}</span>
                      ))}
                      {items.length > 3 && <span>+{items.length - 3}</span>}
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setSelected(p);
                        setEditing(!r && p.product_kind !== 'COMBO');
                      }}
                    >
                      {r || p.product_kind === 'COMBO' ? 'Xem công thức' : 'Thiết lập công thức'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </Paginated>
      ) : (
        <Empty
          title={
            products.some((p) => p.stock_managed)
              ? 'Không có món phù hợp'
              : 'Chưa có món quản lý kho'
          }
          icon="chef"
        >
          {products.some((p) => p.stock_managed)
            ? 'Thử tìm tên, mã món khác hoặc xóa bộ lọc.'
            : 'Vào Thực đơn và bật quản lý nguyên liệu cho món cần thiết lập công thức.'}
        </Empty>
      )}
      <p className="inv-footnote">
        Món không quản lý kho được thiết lập tại Thực đơn, không cần công thức nguyên liệu ở đây.
      </p>
      {selected && (
        <Modal title={`Công thức - ${selected.name}`} wide close={() => setSelected(null)}>
          <div className="inv-dialog">
            {selected.product_kind === 'COMBO' && (
              <>
                <ComboContents components={selected.components} />
                <p className="inv-note">
                  Nguyên liệu của mỗi combo được cộng từ công thức các món thành phần. Để thay đổi,
                  chỉnh món thành phần hoặc thành phần combo tại Thực đơn.
                </p>
              </>
            )}
            {!editing && recipe ? (
              <>
                <div className="inv-recipe-summary">
                  <Badge>Phiên bản {String(recipe.version_no)}</Badge>
                  <strong>Định lượng cho {quantity(recipe.yield_quantity)} phần</strong>
                </div>
                <div className="core-scroll inv-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Nguyên liệu</th>
                        <th className="inv-number">Định lượng</th>
                        <th className="inv-number">Hao hụt dự kiến</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id}>
                          <td className="inv-name-cell" data-label="Nguyên liệu">
                            <strong>{String(l.ingredient_name)}</strong>
                          </td>
                          <td data-label="Định lượng">
                            {quantity(l.quantity)} {String(l.unit)}
                          </td>
                          <td data-label="Hao hụt">{quantity(l.waste_percent)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selected.product_kind !== 'COMBO' && (
                  <p className="inv-note">
                    Ví dụ: công thức cho 2 phần sẽ dùng một nửa định lượng mỗi khi làm 1 phần; hệ
                    thống tính thêm hao hụt.
                  </p>
                )}
                {selected.product_kind !== 'COMBO' && (
                  <button className="primary-button" onClick={() => setEditing(true)}>
                    Thay công thức
                  </button>
                )}
              </>
            ) : selected.product_kind === 'COMBO' ? (
              <Empty title="Combo chưa có đủ công thức">
                Kiểm tra công thức từng món thành phần tại danh sách này.
              </Empty>
            ) : (
              <>
                <p className="inv-note">
                  Lưu sẽ áp dụng công thức mới cho các lần gọi món tiếp theo. Các món đã gọi giữ
                  định lượng đã ghi nhận.
                </p>
                <InventoryLinesForm
                  mode="bom"
                  successMessage={`Đã lưu công thức mới cho ${String(selected.name)}.`}
                  ingredients={inventory.ingredients.filter(
                    (i) => i.is_active || lines.some((l) => l.ingredient_id === i.id),
                  )}
                  choices={options([selected])}
                  initial={{
                    target: selected.id,
                    yield: recipe ? String(recipe.yield_quantity) : '1',
                    lines: lines.map((l) => ({
                      ingredientId: String(l.ingredient_id),
                      quantity: String(l.quantity),
                      waste: String(l.waste_percent),
                      unitCost: '',
                    })),
                  }}
                  save={async (h, items) => {
                    await save('/core/products/' + selected.id + '/bom', {
                      yield: h.yield,
                      lines: items,
                    });
                    setSelected(null);
                  }}
                />
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
