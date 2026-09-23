'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Action,
  api,
  EntryForm,
  label,
  options,
  vnd,
  type Field,
  type Product,
  type Row,
} from './common';
type Inventory = {
  units: Row[];
  ingredients: Row[];
  locations: Row[];
  balances: Row[];
  receipts: Row[];
};
type Data = {
  catalog: { categories: Row[]; products: Product[] };
  tables: Row[];
  areas: Row[];
  inventory: Inventory;
  users: Row[];
  reports: { sales: Row[]; payments: Row[] };
  risk: { defaults: Record<string, number | boolean>; policies: Row[] };
  outstanding: Row[];
};
export default function Admin() {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState(''),
    [tab, setTab] = useState('menu'),
    [qr, setQr] = useState<{ image: string; url: string; table: string }>(),
    [copyMessage, setCopyMessage] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [catalog, tables, areas, inventory, users, reports, risk, outstanding] =
        await Promise.all([
          api<Data['catalog']>('/core/catalog'),
          api<Row[]>('/core/admin/tables'),
          api<Row[]>('/core/areas'),
          api<Inventory>('/core/inventory'),
          api<Row[]>('/core/users'),
          api<Data['reports']>('/core/reports'),
          api<Data['risk']>('/core/risk'),
          api<Row[]>('/core/outstanding'),
        ]);
      setData({ catalog, tables, areas, inventory, users, reports, risk, outstanding });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ.');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(path: string, body: unknown, method = 'POST') {
    await api(path, body, method);
    await refresh();
  }
  const named: Field[] = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên' },
  ];
  return (
    <section className="core-app">
      <nav className="core-tabs" aria-label="Quản trị">
        {[
          ['menu', 'Thực đơn'],
          ['tables', 'Bàn & QR'],
          ['inventory', 'Kho & công thức'],
          ['users', 'Nhân viên'],
          ['risk', 'Kiểm soát gọi món'],
          ['reports', 'Báo cáo'],
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? 'primary-button' : 'secondary-button'}
            onClick={() => setTab(key!)}
          >
            {title}
          </button>
        ))}
        <Action run={refresh}>Tải lại</Action>
      </nav>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data ? (
        <p>Đang tải dữ liệu…</p>
      ) : (
        <>
          {tab === 'menu' && (
            <>
              <details className="core-card">
                <summary>Sửa danh mục</summary>
                {data.catalog.categories.map((c) => (
                  <EntryForm
                    key={c.id + String(c.updated_at)}
                    title={String(c.name)}
                    fields={[
                      { key: 'name', label: 'Tên danh mục', value: String(c.name) },
                      {
                        key: 'sortOrder',
                        label: 'Thứ tự',
                        type: 'number',
                        value: Number(c.sort_order),
                        min: 0,
                      },
                      {
                        key: 'active',
                        label: 'Sử dụng',
                        value: String(c.is_active),
                        options: [
                          { value: 'true', label: 'Đang dùng' },
                          { value: 'false', label: 'Ngừng dùng' },
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
                ))}
              </details>
              <div className="core-grid">
                <EntryForm
                  title="Thêm danh mục"
                  fields={named}
                  onSubmit={(v) => save('/core/categories', v)}
                />
                <EntryForm
                  title="Thêm món"
                  fields={[
                    ...named,
                    {
                      key: 'categoryId',
                      label: 'Danh mục',
                      options: options(data.catalog.categories),
                    },
                    { key: 'price', label: 'Giá bán (đồng)', type: 'number', min: 0, step: '1' },
                  ]}
                  onSubmit={(v) => save('/core/products', v)}
                />
              </div>
              {data.catalog.products.map((p) => (
                <details key={p.id} className="core-card">
                  <summary>
                    {p.name} · {vnd(p.base_price)} ·{' '}
                    {p.is_active ? label(p.availability_status) : 'Ngừng kinh doanh'}
                  </summary>
                  <EntryForm
                    key={p.version}
                    title="Chỉnh sửa món"
                    fields={[
                      { key: 'name', label: 'Tên món', value: p.name },
                      {
                        key: 'price',
                        label: 'Giá bán (đồng)',
                        type: 'number',
                        value: p.base_price,
                        min: 0,
                        step: '1',
                      },
                      {
                        key: 'active',
                        label: 'Kinh doanh',
                        value: String(p.is_active),
                        options: [
                          { value: 'true', label: 'Đang bán' },
                          { value: 'false', label: 'Ngừng bán' },
                        ],
                      },
                      {
                        key: 'availability',
                        label: 'Tình trạng',
                        value: p.availability_status,
                        options: [
                          { value: 'AVAILABLE', label: 'Còn món' },
                          { value: 'UNAVAILABLE', label: 'Tạm hết' },
                        ],
                      },
                    ]}
                    onSubmit={(v) =>
                      save(
                        '/core/products/' + p.id,
                        { ...v, active: v.active === 'true', version: p.version },
                        'PATCH',
                      )
                    }
                  />
                </details>
              ))}
            </>
          )}
          {tab === 'tables' && (
            <>
              <div className="core-grid">
                <EntryForm
                  title="Thêm khu vực"
                  fields={named}
                  onSubmit={(v) => save('/core/areas', v)}
                />
                <EntryForm
                  title="Thêm bàn"
                  fields={[
                    ...named,
                    { key: 'areaId', label: 'Khu vực', options: options(data.areas) },
                    { key: 'capacity', label: 'Số chỗ', type: 'number', value: 4, min: 1, max: 30 },
                  ]}
                  onSubmit={(v) => save('/core/tables', { ...v, capacity: Number(v.capacity) })}
                />
              </div>
              <div className="core-grid">
                {data.tables.map((t) => (
                  <article className="core-card" key={t.id}>
                    <h2>{String(t.name)}</h2>
                    <p>
                      {label(t.table_status)} · {String(t.capacity)} chỗ
                    </p>
                    <Action
                      run={async () => {
                        const result = await api<{ joinPath: string }>(
                          '/core/tables/' + t.id + '/qr',
                          {},
                        );
                        const url = window.location.origin + result.joinPath;
                        setQr({
                          image: await QRCode.toDataURL(url, { width: 320, margin: 4 }),
                          url,
                          table: String(t.name),
                        });
                      }}
                    >
                      Cấp QR mới, thay QR cũ
                    </Action>
                    <details>
                      <summary>Chỉnh sửa bàn</summary>
                      <EntryForm
                        key={String(t.version)}
                        title="Thông tin bàn"
                        fields={[
                          { key: 'name', label: 'Tên bàn', value: String(t.name) },
                          {
                            key: 'areaId',
                            label: 'Khu vực',
                            value: String(t.area_id),
                            options: options(data.areas),
                          },
                          {
                            key: 'capacity',
                            label: 'Số chỗ',
                            type: 'number',
                            value: Number(t.capacity),
                            min: 1,
                            max: 30,
                          },
                          {
                            key: 'active',
                            label: 'Sử dụng',
                            value: String(t.is_active),
                            options: [
                              { value: 'true', label: 'Đang dùng' },
                              { value: 'false', label: 'Ngừng dùng' },
                            ],
                          },
                        ]}
                        onSubmit={(v) =>
                          save(
                            '/core/tables/' + t.id,
                            {
                              ...v,
                              capacity: Number(v.capacity),
                              active: v.active === 'true',
                              version: t.version,
                            },
                            'PATCH',
                          )
                        }
                      />
                    </details>
                  </article>
                ))}
              </div>
              {qr && (
                <div className="core-card core-qr">
                  <h2>QR {qr.table}</h2>
                  <img src={qr.image} alt={'Mã QR ' + qr.table} width={320} height={320} />
                  <div className="core-qr-actions">
                    <a className="secondary-button" href={qr.url} target="_blank" rel="noreferrer">
                      Mở thực đơn của bàn
                    </a>
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        setCopyMessage('');
                        try {
                          await navigator.clipboard.writeText(qr.url);
                          setCopyMessage('Đã sao chép liên kết thực đơn.');
                        } catch {
                          setCopyMessage(
                            'Không sao chép được. Hãy mở liên kết rồi sao chép thủ công.',
                          );
                        }
                      }}
                    >
                      Sao chép liên kết
                    </button>
                  </div>
                  {copyMessage && <p role="status">{copyMessage}</p>}
                  <p className="small-note">
                    <a href={qr.url} target="_blank" rel="noreferrer">
                      Liên kết dành cho khách
                    </a>
                  </p>
                  <a
                    className="secondary-button"
                    href={qr.image}
                    download={'QR-' + qr.table + '.png'}
                  >
                    Tải mã QR để in
                  </a>
                </div>
              )}
            </>
          )}
          {tab === 'inventory' && (
            <>
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
                <EntryForm
                  title="Thêm kho"
                  fields={named}
                  onSubmit={(v) => save('/core/locations', v)}
                />
              </div>
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
                    save('/core/products/' + header.target + '/bom', { yield: header.yield, lines })
                  }
                />
              </div>
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
                    {data.inventory.balances.map((b) => (
                      <tr key={b.id}>
                        <td>{String(b.ingredient_name)}</td>
                        <td>{String(b.location_name)}</td>
                        <td>
                          {String(b.on_hand_qty)} {String(b.unit)}
                        </td>
                        <td>{String(b.reserved_qty)}</td>
                        <td>{String(b.available_qty)}</td>
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
          )}
          {tab === 'users' && (
            <>
              <EntryForm
                title="Tạo tài khoản nhân viên"
                fields={[
                  { key: 'username', label: 'Tên đăng nhập' },
                  { key: 'name', label: 'Tên hiển thị' },
                  { key: 'password', label: 'Mật khẩu (ít nhất 16 ký tự)', type: 'password' },
                  { key: 'role', label: 'Vai trò', options: roles },
                ]}
                onSubmit={(v) => save('/core/users', v)}
              />
              {data.users.map((u) => (
                <details className="core-card" key={u.id}>
                  <summary>
                    {String(u.display_name)} · {String(u.username)} · {label(u.status)}
                  </summary>
                  <EntryForm
                    title="Cập nhật tài khoản"
                    fields={[
                      { key: 'name', label: 'Tên hiển thị', value: String(u.display_name) },
                      { key: 'role', label: 'Vai trò', value: String(u.role), options: roles },
                      {
                        key: 'status',
                        label: 'Trạng thái',
                        value: String(u.status),
                        options: [
                          { value: 'ACTIVE', label: 'Hoạt động' },
                          { value: 'DISABLED', label: 'Khóa tài khoản' },
                        ],
                      },
                      {
                        key: 'password',
                        label: 'Mật khẩu mới (bỏ trống để giữ)',
                        optional: true,
                        type: 'password',
                      },
                    ]}
                    onSubmit={(v) => save('/core/users/' + u.id, v, 'PATCH')}
                  />
                </details>
              ))}
            </>
          )}
          {tab === 'risk' && (
            <>
              <p>
                Các thay đổi áp dụng cho lượt gửi tiếp theo. Đơn cũ giữ kết quả đánh giá tại lúc
                gửi.
              </p>
              <EntryForm
                key={JSON.stringify(data.risk.policies)}
                title="Ngưỡng xét duyệt"
                fields={Object.entries(data.risk.defaults).map(([key, value]) => ({
                  key,
                  label: riskLabels[key] ?? key,
                  value: String(
                    data.risk.policies.find((p) => p.config_key === key)?.value_json ?? value,
                  ),
                  ...(typeof value === 'boolean'
                    ? {
                        options: [
                          { value: 'true', label: 'Bật' },
                          { value: 'false', label: 'Tắt' },
                        ],
                      }
                    : { type: 'number', min: 1, step: '1' }),
                }))}
                onSubmit={(v) =>
                  save(
                    '/core/risk',
                    Object.fromEntries(
                      Object.entries(v).map(([k, value]) => [
                        k,
                        k === 'FIRST_ORDER_REVIEW_ENABLED' ? value === 'true' : Number(value),
                      ]),
                    ),
                  )
                }
              />
            </>
          )}
          {tab === 'reports' && (
            <>
              <h2>Doanh số món đã phục vụ</h2>
              <div className="core-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Món</th>
                      <th>Số lượng</th>
                      <th>Doanh số</th>
                      <th>Giá vốn nguyên liệu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.sales.map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.product_name_snapshot)}</td>
                        <td>{String(r.quantity)}</td>
                        <td>{vnd(r.sales)}</td>
                        <td>{vnd(r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2>Tiền đã thu</h2>
              {data.reports.payments.map((r, i) => (
                <p key={i}>
                  {r.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}: {vnd(r.amount)}
                </p>
              ))}
              <h2>Hồ sơ thiếu tiền</h2>
              {data.outstanding.map((r) => (
                <details key={r.id} className="core-card">
                  <summary>
                    {String(r.table_code ?? 'Bàn')} · {vnd(r.outstanding_amount)} ·{' '}
                    {String(r.status)}
                  </summary>
                  <p>{String(r.notes ?? '')}</p>
                  {['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(r.status)) && (
                    <EntryForm
                      title="Ghi nhận không thu hồi được"
                      fields={[{ key: 'reason', label: 'Lý do xử lý' }]}
                      submit="Chốt tổn thất và đóng phiên"
                      onSubmit={(v) => save('/core/outstanding/' + r.id + '/write-off', v)}
                    />
                  )}
                </details>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
const roles = [
  { value: 'STAFF', label: 'Nhân viên phục vụ' },
  { value: 'KITCHEN', label: 'Nhân viên bếp' },
  { value: 'ADMIN', label: 'Quản trị viên' },
];
const riskLabels: Record<string, string> = {
  FIRST_ORDER_REVIEW_ENABLED: 'Duyệt lượt đầu của phiên chưa xác minh',
  LINE_QTY_REVIEW: 'Một dòng: số lượng cần duyệt',
  LINE_QTY_HARD_LIMIT: 'Một dòng: số lượng tối đa',
  ORDER_TOTAL_QTY_REVIEW: 'Một lượt: tổng số lượng cần duyệt',
  ORDER_TOTAL_QTY_HARD_LIMIT: 'Một lượt: tổng số lượng tối đa',
  ORDER_AMOUNT_REVIEW_VND: 'Một lượt: tiền cần duyệt (đồng)',
  ORDER_AMOUNT_HARD_LIMIT_VND: 'Một lượt: tiền tối đa (đồng)',
  SESSION_AMOUNT_REVIEW_VND: 'Một phiên: tiền cần duyệt (đồng)',
};
function LinesForm({
  title,
  mode,
  ingredients,
  options: choices,
  save,
}: {
  title: string;
  mode: 'bom' | 'receipt';
  ingredients: Row[];
  options: { value: string; label: string }[];
  save: (header: Record<string, string>, lines: Record<string, string>[]) => Promise<void>;
}) {
  const [lines, setLines] = useState<Record<string, string>[]>([]);
  return (
    <section className="core-card">
      <h2>{title}</h2>
      <EntryForm
        title="Thêm dòng nguyên liệu"
        fields={[
          { key: 'ingredientId', label: 'Nguyên liệu', options: options(ingredients) },
          {
            key: 'quantity',
            label: 'Số lượng theo đơn vị cơ sở',
            type: 'number',
            min: 0.000001,
            step: '0.000001',
          },
          mode === 'bom'
            ? {
                key: 'waste',
                label: 'Hao hụt (%)',
                type: 'number',
                value: 0,
                min: 0,
                max: 100,
                step: '0.01',
              }
            : {
                key: 'unitCost',
                label: 'Đơn giá nhập (đồng)',
                type: 'number',
                min: 0,
                step: '0.000001',
              },
        ]}
        submit="Thêm dòng"
        onSubmit={async (v) => {
          if (lines.some((l) => l.ingredientId === v.ingredientId))
            throw new Error('Nguyên liệu đã có trong danh sách.');
          setLines([...lines, v]);
        }}
      />
      {lines.map((l, i) => (
        <div className="core-line" key={i}>
          <span>
            {String(ingredients.find((x) => x.id === l.ingredientId)?.name)} · {l.quantity}
          </span>
          <button
            className="secondary-button"
            onClick={() => setLines(lines.filter((_, n) => n !== i))}
          >
            Bỏ
          </button>
        </div>
      ))}
      <EntryForm
        title="Thông tin chung"
        fields={[
          { key: 'target', label: mode === 'bom' ? 'Món áp dụng' : 'Kho nhận', options: choices },
          ...(mode === 'bom'
            ? [
                {
                  key: 'yield',
                  label: 'Số phần công thức tạo ra',
                  type: 'number',
                  value: 1,
                  min: 0.000001,
                  step: '0.000001',
                },
              ]
            : [
                { key: 'number', label: 'Số phiếu nhập' },
                { key: 'supplier', label: 'Nhà cung cấp', optional: true },
              ]),
        ]}
        submit={mode === 'bom' ? 'Lưu phiên bản công thức mới' : 'Lưu phiếu nhập nháp'}
        onSubmit={async (h) => {
          if (!lines.length) throw new Error('Cần thêm ít nhất một nguyên liệu.');
          await save(h, lines);
          setLines([]);
        }}
      />
    </section>
  );
}
