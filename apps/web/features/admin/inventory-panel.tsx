'use client';
import type { AdminData, SaveAdmin } from './admin-types';
import { LinesForm } from './admin-forms';
import { Action, EntryForm, options, vnd, type Field } from '../shared/components';
import { matches } from '../shared/primitives';
const quantity = (value: unknown) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
};
export default function InventoryPanel({
  data,
  search,
  save,
}: {
  data: Pick<AdminData, 'inventory' | 'catalog'>;
  search: string;
  save: SaveAdmin;
}) {
  const named: Field[] = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên' },
  ];
  return (
    <>
      <details className="core-card">
        <summary>Thiết lập nguyên liệu và kho</summary>
        <div className="core-grid">
          <EntryForm
            title="Thêm đơn vị tính"
            fields={[
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
            ]}
            onSubmit={(v) => save('/core/units', v)}
          />
          <EntryForm
            title="Thêm nguyên liệu"
            fields={[
              ...named,
              {
                key: 'unitId',
                label: 'Đơn vị cơ sở',
                options: options(data.inventory.units),
              },
            ]}
            onSubmit={(v) => save('/core/ingredients', v)}
          />
          <EntryForm title="Thêm kho" fields={named} onSubmit={(v) => save('/core/locations', v)} />
        </div>
      </details>
      <details className="core-card">
        <summary>Nhập kho hoặc cập nhật công thức</summary>
        <div className="core-grid">
          <LinesForm
            key={'receipt-' + data.inventory.ingredients.length}
            title="Lập phiếu nhập kho"
            mode="receipt"
            ingredients={data.inventory.ingredients}
            options={options(data.inventory.locations)}
            save={async (header, lines) =>
              save('/core/receipts', {
                locationId: header.target,
                number: header.number,
                supplier: header.supplier,
                lines,
              })
            }
          />
          <LinesForm
            key={'bom-' + data.inventory.ingredients.length}
            title="Thay công thức món"
            mode="bom"
            ingredients={data.inventory.ingredients}
            options={options(data.catalog.products)}
            save={async (header, lines) =>
              save('/core/products/' + header.target + '/bom', {
                yield: header.yield,
                lines,
              })
            }
          />
        </div>
      </details>
      <h2>Tồn kho</h2>
      <div className="core-scroll">
        <table>
          <thead>
            <tr>
              <th>Nguyên liệu</th>
              <th>Kho</th>
              <th>Hiện có</th>
              <th>Đang giữ</th>
              <th>Có thể dùng</th>
            </tr>
          </thead>
          <tbody>
            {data.inventory.balances
              .filter((b) => matches(String(b.ingredient_name) + ' ' + b.location_name, search))
              .map((b) => (
                <tr key={b.id}>
                  <td>{String(b.ingredient_name)}</td>
                  <td>{String(b.location_name)}</td>
                  <td>
                    {quantity(b.on_hand_qty)} {String(b.unit)}
                  </td>
                  <td>
                    {quantity(b.reserved_qty)} {String(b.unit)}
                  </td>
                  <td>
                    {quantity(b.available_qty)} {String(b.unit)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h2>Phiếu nhập</h2>
      {data.inventory.receipts.map((r) => (
        <div className="core-card" key={r.id}>
          <strong>
            {String(r.receipt_no)} · {vnd(r.total_value)}
          </strong>
          <p>{r.status === 'DRAFT' ? 'Nháp' : 'Đã nhập kho'}</p>
          {r.status === 'DRAFT' && (
            <Action run={() => save('/core/receipts/' + r.id + '/approve', {})}>
              Duyệt nhập kho
            </Action>
          )}
        </div>
      ))}
    </>
  );
}
