'use client';
import { ServerHistory } from '../shared/history-filters';
import { AdminHelp } from './admin-help';
import { useState } from 'react';
import type { AdminData, SaveAdmin } from './admin-types';
import { StockAdjustment } from './stock-adjustment';
import { InventoryReceiptDetail } from './inventory-receipt-detail';
import { InventoryRecipes } from './inventory-recipes';
import { InventoryLinesForm } from './inventory-lines-form';
import {
  Badge,
  CreateButton,
  movementLabels,
  receiptLabels,
  quantity,
  stockStatus,
  Paginated,
  PanelHeading,
} from './inventory-ui';
import { EntryForm, options, vnd, type Field, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';

type InventoryView = 'stock' | 'receipts' | 'recipes' | 'movements' | 'settings';
export default function InventoryPanel({
  data,
  save,
  initial = 'stock',
  initialProductId,
  onNavigate,
}: {
  data: Pick<AdminData, 'inventory' | 'catalog'>;
  save: SaveAdmin;
  initial?: string;
  initialProductId?: string;
  onNavigate?: (section: string) => void;
}) {
  const inventory = data.inventory;
  const [view, setView] = useState<InventoryView>(
      ['receipts', 'recipes', 'movements', 'settings'].includes(initial)
        ? (initial as InventoryView)
        : ['ingredients', 'units', 'locations'].includes(initial)
          ? 'settings'
          : 'stock',
    ),
    [search, setSearch] = useState('');
  const [location, setLocation] = useState('all'),
    [status, setStatus] = useState('all'),
    [productId, setProductId] = useState(initialProductId ?? 'all');
  const [receiptStatus, setReceiptStatus] = useState('all'),
    [movementType, setMovementType] = useState('all');
  const [setting] = useState(['units', 'locations'].includes(initial) ? initial : 'ingredients');
  const [modal, setModal] = useState<'receipt' | 'ingredient' | 'unit' | 'location' | null>(null);
  const [receipt, setReceipt] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null);
  const findIngredient = (id: unknown) => inventory.ingredients.find((i) => i.id === id);
  const locationName = (id: unknown) =>
    String(inventory.locations.find((l) => l.id === id)?.name ?? 'Kho');
  const inLocation = (row: Row) => location === 'all' || row.location_id === location;
  const selectedProduct = data.catalog.products.find((p) => p.id === productId);
  // The inventory endpoint supplies only recipes currently in effect.
  const selectedRecipe = inventory.recipes.find((r) => r.product_id === productId);
  const recipeIngredients = new Set(
    inventory.recipeItems
      .filter((line) => line.recipe_bom_id === selectedRecipe?.id)
      .map((line) => line.ingredient_id),
  );
  const balances = inventory.balances
    .filter((b) => productId === 'all' || recipeIngredients.has(b.ingredient_id))
    .filter(inLocation)
    .filter((b) =>
      matches(
        `${b.ingredient_name} ${findIngredient(b.ingredient_id)?.code ?? ''} ${b.location_name}`,
        search,
      ),
    );
  const stockRows = balances.filter(
    (b) => status === 'all' || stockStatus(b, findIngredient(b.ingredient_id)).key === status,
  );
  const pending = inventory.receipts.filter((r) => inLocation(r) && r.status === 'DRAFT').length;
  const named: Field[] = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên' },
  ];
  const warehouseFilter = (
    <label>
      Kho
      <select aria-label="Kho" value={location} onChange={(e) => setLocation(e.target.value)}>
        <option value="all">Tất cả kho</option>
        {inventory.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {String(l.name)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="inv-app">
      {view === 'stock' && (
        <>
          <div className="inv-stats">
            <article>
              <span>Nguyên liệu đang xem</span>
              <strong>
                {new Set(stockRows.map((b) => b.ingredient_id)).size}
                <small> loại</small>
              </strong>
              <p>{stockRows.length} dòng nguyên liệu / kho</p>
            </article>
            <article className="inv-stat-attention">
              <span>Cần kiểm tra / bổ sung</span>
              <strong>
                {
                  stockRows.filter(
                    (b) => stockStatus(b, findIngredient(b.ingredient_id)).key !== 'ready',
                  ).length
                }
                <small> dòng</small>
              </strong>
              <p>Hết khả dụng hoặc chạm mức tối thiểu</p>
            </article>
            <article>
              <span>Phiếu chờ nhập kho</span>
              <strong>
                {pending}
                <small> phiếu</small>
              </strong>
              <button
                className="inv-text-button"
                onClick={() => {
                  setReceiptStatus('DRAFT');
                  setView('receipts');
                  onNavigate?.('receipts');
                  setSearch('');
                }}
              >
                Xem phiếu chờ nhập <Icon name="arrow" size={14} />
              </button>
            </article>
          </div>
          <section className="inv-panel">
            <PanelHeading
              title="Tồn kho"
              hint="Kiểm tra nguyên liệu còn dùng được tại từng kho. Chọn tên để xem chi tiết."
            >
              <AdminHelp topic="inventory" />
              <CreateButton onClick={() => setModal('receipt')}>Lập phiếu nhập</CreateButton>
            </PanelHeading>
            <div className="inv-toolbar">
              <Search
                value={search}
                onChange={setSearch}
                placeholder="Tìm nguyên liệu, mã hoặc kho…"
              />
              <label className="inv-product-filter">
                Món ăn
                <select
                  aria-label="Món ăn"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="all">Tất cả món</option>
                  {data.catalog.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {warehouseFilter}
              <label>
                Tình trạng
                <select
                  aria-label="Tình trạng"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">Tất cả tình trạng</option>
                  <option value="empty">Hết khả dụng</option>
                  <option value="low">Cần bổ sung</option>
                  <option value="ready">Có thể dùng</option>
                </select>
              </label>
              {(search || productId !== 'all' || location !== 'all' || status !== 'all') && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSearch('');
                    setProductId('all');
                    setLocation('all');
                    setStatus('all');
                  }}
                >
                  Xóa bộ lọc
                </button>
              )}
            </div>
            {selectedProduct && selectedRecipe && (
              <p className="inv-footnote">
                Đang xem {recipeIngredients.size} nguyên liệu trong công thức hiện tại của{' '}
                <strong>{selectedProduct.name}</strong>.
              </p>
            )}
            <div className="inv-stock-guide">
              <span>
                <strong>Hiện có</strong> là lượng đang trong kho.
              </span>
              <span>
                <strong>Giữ cho món</strong> là phần dành cho món chưa nấu.
              </span>
              <span>
                <strong>Còn dùng = hiện có − giữ cho món.</strong>
              </span>
            </div>
            {stockRows.length ? (
              <Paginated key={`${productId}-${location}-${status}-${search}`} items={stockRows}>
                {(rows) => (
                  <div className="core-scroll inv-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Nguyên liệu</th>
                          <th>Kho</th>
                          <th className="inv-number">Còn dùng</th>
                          <th className="inv-number">Hiện có / giữ cho món</th>
                          <th>Tình trạng</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((b) => {
                          const ingredient = findIngredient(b.ingredient_id),
                            state = stockStatus(b, ingredient);
                          return (
                            <tr key={b.id}>
                              <td className="inv-name-cell" data-label="Nguyên liệu">
                                <button className="inv-name-button" onClick={() => setDetail(b)}>
                                  {String(b.ingredient_name)}
                                </button>
                                <small>
                                  {String(ingredient?.code ?? '')} - {String(b.unit)}
                                </small>
                              </td>
                              <td data-label="Kho">{String(b.location_name)}</td>
                              <td data-label="Còn dùng" className="inv-quantity">
                                <strong>{quantity(b.available_qty)}</strong>
                                <small>{String(b.unit)}</small>
                              </td>
                              <td data-label="Hiện có / giữ">
                                <span>
                                  {quantity(b.on_hand_qty)} {String(b.unit)} <small>hiện có</small>
                                </span>
                                <small>
                                  {quantity(b.reserved_qty)} {String(b.unit)} giữ cho món
                                </small>
                              </td>
                              <td data-label="Tình trạng">
                                <Badge kind={state.key}>{state.title}</Badge>
                              </td>
                              <td className="inv-action-cell" data-label="Thao tác">
                                <StockAdjustment balance={b} save={save} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paginated>
            ) : productId !== 'all' && !selectedRecipe ? (
              <Empty
                title={
                  selectedProduct?.stock_managed
                    ? 'Món chưa có công thức đang áp dụng'
                    : 'Món không quản lý nguyên liệu theo công thức'
                }
                icon="box"
              >
                Chưa có nguyên liệu liên quan để xem. Kiểm tra công thức hoặc chọn món khác.
              </Empty>
            ) : (
              <Empty title="Không có nguyên liệu phù hợp" icon="box">
                Đổi món ăn, kho, tình trạng hoặc từ khóa để xem lại.
              </Empty>
            )}
          </section>
        </>
      )}
      {view === 'receipts' && (
        <section className="inv-panel">
          <PanelHeading
            title="Phiếu nhập hàng"
            hint="Lập nháp → kiểm tra hàng nhận → duyệt nhập kho. Phiếu nháp chưa làm tăng tồn."
          >
            <AdminHelp topic="inventory" />
            <CreateButton onClick={() => setModal('receipt')}>Lập phiếu nhập</CreateButton>
          </PanelHeading>
          <ServerHistory
            kind="receipts"
            placeholder="Tìm số phiếu, chứng từ hoặc nguồn mua…"
            filters={{ scope: location, status: receiptStatus }}
            onReset={() => {
              setLocation('all');
              setReceiptStatus('all');
            }}
            refreshKey={inventory.receipts}
            controls={
              <>
                {warehouseFilter}
                <label>
                  Trạng thái phiếu
                  <select
                    aria-label="Trạng thái phiếu"
                    value={receiptStatus}
                    onChange={(e) => setReceiptStatus(e.target.value)}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    {Object.entries(receiptLabels).map(([value, name]) => (
                      <option value={value} key={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
          >
            {(rows) => (
              <div className="core-scroll inv-table">
                <table>
                  <thead>
                    <tr>
                      <th>Phiếu / ngày lập</th>
                      <th>Nhà cung cấp</th>
                      <th>Kho nhận</th>
                      <th className="inv-number">Tổng tiền</th>
                      <th>Trạng thái</th>
                      <th>Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="inv-name-cell" data-label="Phiếu">
                          <strong>{String(r.receipt_no)}</strong>
                          <small>
                            {restaurantDateTime(r.created_at)} - {String(r.creator_name)}
                          </small>
                          {r.external_reference && (
                            <small>Chứng từ: {String(r.external_reference)}</small>
                          )}
                        </td>
                        <td data-label="Nhà cung cấp">
                          {String(r.supplier_name_snapshot ?? 'Chưa ghi tên')}
                        </td>
                        <td data-label="Kho nhận">{locationName(r.location_id)}</td>
                        <td data-label="Tổng tiền">
                          <strong>{vnd(r.total_value)}</strong>
                        </td>
                        <td data-label="Trạng thái">
                          <Badge
                            kind={
                              r.status === 'DRAFT'
                                ? 'low'
                                : r.status === 'CANCELLED'
                                  ? 'muted'
                                  : 'ready'
                            }
                          >
                            {receiptLabels[String(r.status)] ?? String(r.status)}
                          </Badge>
                        </td>
                        <td className="inv-action-cell">
                          <button className="secondary-button" onClick={() => setReceipt(r)}>
                            Xem phiếu
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ServerHistory>
        </section>
      )}
      {view === 'recipes' && (
        <InventoryRecipes
          inventory={inventory}
          products={data.catalog.products}
          search={search}
          setSearch={setSearch}
          save={save}
        />
      )}
      {view === 'movements' && (
        <section className="inv-panel">
          <PanelHeading
            title="Lịch sử kho"
            hint="Tra nguyên liệu tăng hoặc giảm vì việc gì, do ai và vào lúc nào."
          />
          <ServerHistory
            kind="movements"
            placeholder="Tìm nguyên liệu, mã phiếu, người hoặc lý do…"
            filters={{ scope: location, status: movementType }}
            onReset={() => {
              setLocation('all');
              setMovementType('all');
            }}
            initialSearch={search}
            refreshKey={inventory.movements}
            controls={
              <>
                {warehouseFilter}
                <label>
                  Loại biến động
                  <select
                    aria-label="Loại biến động"
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value)}
                  >
                    <option value="all">Tất cả nghiệp vụ</option>
                    {Object.entries(movementLabels).map(([value, name]) => (
                      <option value={value} key={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
          >
            {(rows) => (
              <div className="core-scroll inv-table">
                <table>
                  <thead>
                    <tr>
                      <th>Nguyên liệu / kho</th>
                      <th>Thời điểm</th>
                      <th>Nghiệp vụ</th>
                      <th className="inv-number">Tăng / giảm</th>
                      <th className="inv-number">Giá trị</th>
                      <th>Người / lý do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td className="inv-name-cell" data-label="Nguyên liệu">
                          <strong>{String(m.ingredient_name)}</strong>
                          <small>{String(m.location_name)}</small>
                        </td>
                        <td data-label="Thời điểm">{restaurantDateTime(m.occurred_at)}</td>
                        <td data-label="Nghiệp vụ">
                          <Badge kind={Number(m.quantity) > 0 ? 'ready' : 'muted'}>
                            {movementLabels[String(m.movement_type)] ?? String(m.movement_type)}
                          </Badge>
                        </td>
                        <td
                          data-label="Tăng / giảm"
                          className={Number(m.quantity) > 0 ? 'inv-increase' : 'inv-decrease'}
                        >
                          <strong>
                            {Number(m.quantity) > 0 ? '+' : ''}
                            {quantity(m.quantity)} {String(m.unit)}
                          </strong>
                        </td>
                        <td data-label="Giá trị">{vnd(m.value)}</td>
                        <td className="inv-reason" data-label="Người / lý do">
                          <span>{String(m.actor_name ?? 'Hệ thống')}</span>
                          <small>{String(m.reason ?? m.receipt_no ?? 'Theo chứng từ gốc')}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ServerHistory>
        </section>
      )}
      {view === 'settings' && (
        <section className="inv-panel">
          <PanelHeading
            title={
              setting === 'ingredients'
                ? 'Nguyên liệu'
                : setting === 'locations'
                  ? 'Kho lưu trữ'
                  : 'Đơn vị tính'
            }
            hint="Khai báo nguyên liệu, đơn vị tính và nơi lưu hàng. Không nhập số tồn tại đây."
          >
            <CreateButton
              onClick={() =>
                setModal(
                  setting === 'ingredients'
                    ? 'ingredient'
                    : setting === 'locations'
                      ? 'location'
                      : 'unit',
                )
              }
            >
              {setting === 'ingredients'
                ? 'Thêm nguyên liệu'
                : setting === 'locations'
                  ? 'Thêm kho'
                  : 'Thêm đơn vị'}
            </CreateButton>
          </PanelHeading>
          <div className="inv-toolbar">
            <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã danh mục…" />
          </div>
          <Paginated
            key={`${setting}-${search}`}
            items={(setting === 'ingredients'
              ? inventory.ingredients
              : setting === 'locations'
                ? inventory.locations
                : inventory.units
            ).filter((i) => matches(`${i.name} ${i.code}`, search))}
          >
            {(rows) =>
              rows.length ? (
                <div className="core-scroll inv-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Tên</th>
                        <th>Mã</th>
                        <th>
                          {setting === 'ingredients'
                            ? 'Đơn vị / mức tối thiểu'
                            : setting === 'units'
                              ? 'Nhóm đơn vị'
                              : 'Trạng thái'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((i) => (
                        <tr key={i.id}>
                          <td className="inv-name-cell" data-label="Tên">
                            <strong>{String(i.name)}</strong>
                          </td>
                          <td data-label="Mã">{String(i.code)}</td>
                          <td
                            data-label={
                              setting === 'ingredients' ? 'Đơn vị / mức tối thiểu' : 'Thông tin'
                            }
                          >
                            {setting === 'ingredients' ? (
                              <>
                                <span>{String(i.unit_code)}</span>
                                <small>
                                  {Number(i.min_stock) > 0
                                    ? `Tối thiểu ${quantity(i.min_stock)} ${i.unit_code}`
                                    : 'Chưa đặt mức tối thiểu'}
                                </small>
                              </>
                            ) : setting === 'units' ? (
                              (
                                {
                                  MASS: 'Khối lượng',
                                  VOLUME: 'Thể tích',
                                  COUNT: 'Số lượng',
                                } as Record<string, string>
                              )[String(i.dimension)]
                            ) : (
                              <Badge kind={i.is_active ? 'ready' : 'muted'}>
                                {i.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Không có danh mục phù hợp" />
              )
            }
          </Paginated>
        </section>
      )}
      {modal === 'receipt' && (
        <Modal title="Lập phiếu nhập hàng" wide close={() => setModal(null)}>
          <div className="inv-dialog">
            <InventoryLinesForm
              mode="receipt"
              successMessage="Đã tạo phiếu nhập nháp. Duyệt phiếu để nhập hàng vào kho."
              ingredients={inventory.ingredients.filter((i) => i.is_active)}
              choices={options(inventory.locations.filter((l) => l.is_active))}
              initial={{ target: location === 'all' ? undefined : location }}
              save={async (h, lines) => {
                await save('/core/receipts', {
                  locationId: h.target,
                  externalReference: h.externalReference,
                  supplier: h.supplier,
                  lines,
                });
                setModal(null);
                setReceiptStatus('DRAFT');
                setSearch('');
                setView('receipts');
                onNavigate?.('receipts');
              }}
            />
          </div>
        </Modal>
      )}
      {modal && modal !== 'receipt' && (
        <Modal
          title={
            modal === 'ingredient'
              ? 'Thêm nguyên liệu'
              : modal === 'location'
                ? 'Thêm kho'
                : 'Thêm đơn vị tính'
          }
          close={() => setModal(null)}
        >
          <div className="inv-dialog">
            <p className="inv-form-hint">
              {modal === 'ingredient'
                ? 'Chọn đơn vị dùng thống nhất khi nhập hàng, kiểm kê và tính công thức.'
                : modal === 'location'
                  ? 'Ví dụ: Kho khô, Tủ mát bếp, Quầy đồ uống.'
                  : 'Mã đơn vị ngắn gọn, ví dụ KG, L hoặc CAI.'}
            </p>
            <EntryForm
              title="Thông tin danh mục"
              successMessage={
                modal === 'ingredient'
                  ? 'Đã thêm nguyên liệu.'
                  : modal === 'location'
                    ? 'Đã thêm kho.'
                    : 'Đã thêm đơn vị tính.'
              }
              fields={
                modal === 'location'
                  ? named
                  : modal === 'ingredient'
                    ? [
                        ...named,
                        { key: 'unitId', label: 'Đơn vị cơ sở', options: options(inventory.units) },
                        {
                          key: 'minStock',
                          label: 'Mức tồn tối thiểu',
                          type: 'number',
                          min: 0,
                          step: '0.000001',
                          value: 0,
                        },
                      ]
                    : [
                        ...named,
                        {
                          key: 'dimension',
                          label: 'Nhóm đơn vị',
                          options: [
                            { value: 'MASS', label: 'Khối lượng' },
                            { value: 'VOLUME', label: 'Thể tích' },
                            { value: 'COUNT', label: 'Số lượng' },
                          ],
                        },
                      ]
              }
              onSubmit={async (v) => {
                await save(
                  modal === 'ingredient'
                    ? '/core/ingredients'
                    : modal === 'location'
                      ? '/core/locations'
                      : '/core/units',
                  v,
                );
                setModal(null);
              }}
            />
          </div>
        </Modal>
      )}
      {receipt && (
        <InventoryReceiptDetail
          id={receipt.id}
          inventory={inventory}
          save={save}
          close={() => setReceipt(null)}
        />
      )}
      {detail && (
        <Modal title={String(detail.ingredient_name)} close={() => setDetail(null)}>
          <div className="inv-dialog inv-detail">
            <p>
              {String(detail.location_name)} -{' '}
              {String(findIngredient(detail.ingredient_id)?.code ?? '')}
            </p>
            <div className="inv-detail-quantities">
              {[
                ['Hiện có', detail.on_hand_qty],
                ['Giữ cho món', detail.reserved_qty],
                ['Còn dùng', detail.available_qty],
              ].map(([name, value]) => (
                <div key={String(name)}>
                  <span>{name}</span>
                  <strong>
                    {quantity(value)} <small>{String(detail.unit)}</small>
                  </strong>
                </div>
              ))}
            </div>
            <p>
              Còn dùng là phần chưa dành cho món. Lượng giữ sẽ được tiêu hao khi bếp bắt đầu chế
              biến.
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setLocation(String(detail.location_id));
                setSearch(String(detail.ingredient_name));
                setMovementType('all');
                setView('movements');
                onNavigate?.('movements');
                setDetail(null);
              }}
            >
              Xem lịch sử của nguyên liệu
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
