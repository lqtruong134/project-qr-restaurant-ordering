'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AdminData, Inventory } from './admin-types';
import InventoryPanel from './inventory-panel';
import UsersPanel from './users-panel';
import RiskPanel from './risk-panel';
import ReportsPanel from './reports-panel';
import { Icon, Modal, Search, Stat, matches } from '../shared/primitives';
import {
  Action,
  api,
  EntryForm,
  label,
  options,
  vnd,
  type Field,
  type Row,
} from '../shared/components';
export default function Admin() {
  const [data, setData] = useState<AdminData>(),
    [error, setError] = useState(''),
    [tab, setTab] = useState('overview'),
    [search, setSearch] = useState(''),
    [editTable, setEditTable] = useState<Row>(),
    [qr, setQr] = useState<{ image: string; url: string; table: string }>(),
    [copyMessage, setCopyMessage] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [catalog, tables, areas, inventory, users, reports, risk, outstanding] =
        await Promise.all([
          api<AdminData['catalog']>('/core/catalog'),
          api<Row[]>('/core/admin/tables'),
          api<Row[]>('/core/areas'),
          api<Inventory>('/core/inventory'),
          api<Row[]>('/core/users'),
          api<AdminData['reports']>('/core/reports'),
          api<AdminData['risk']>('/core/risk'),
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
    <section className="core-app admin-layout">
      <nav className="core-tabs" aria-label="Quản trị">
        {[
          ['overview', 'Tổng quan'],
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
            onClick={() => {
              setTab(key!);
              setSearch('');
            }}
          >
            <Icon
              name={
                (
                  {
                    overview: 'home',
                    menu: 'menu',
                    tables: 'table',
                    inventory: 'box',
                    users: 'people',
                    risk: 'shield',
                    reports: 'chart',
                  } as Record<string, string>
                )[key!]!
              }
              size={18}
            />
            {title}
          </button>
        ))}
        <Action run={refresh}>
          <Icon name="refresh" size={16} />
          Tải lại dữ liệu
        </Action>
      </nav>
      <div className="admin-content">
        <div className="section-heading">
          <div>
            <h2>
              {
                (
                  {
                    overview: 'Tổng quan nhà hàng',
                    menu: 'Quản lý thực đơn',
                    tables: 'Không gian & bàn',
                    inventory: 'Kho nguyên liệu',
                    users: 'Đội ngũ của bạn',
                    risk: 'Kiểm soát gọi món',
                    reports: 'Báo cáo vận hành',
                  } as Record<string, string>
                )[tab]
              }
            </h2>
            <p>
              {
                (
                  {
                    overview: 'Nhìn nhanh tình hình vận hành của nhà hàng.',
                    menu: 'Chăm chút từng món, giữ trọn trải nghiệm.',
                    tables: 'Quản lý khu vực, sức chứa và QR tại bàn.',
                    inventory: 'Theo dõi nguyên liệu từ nhập kho đến chế biến.',
                    users: 'Mỗi người một mã đăng nhập. Tên hiển thị có thể trùng nhau.',
                    risk: 'Các quy tắc hỗ trợ nhân viên duyệt yêu cầu bất thường.',
                    reports: 'Số liệu toàn bộ lịch sử đang lưu, không phải riêng hôm nay.',
                  } as Record<string, string>
                )[tab]
              }
            </p>
          </div>
        </div>
        {['menu', 'tables', 'users', 'inventory'].includes(tab) && (
          <div className="toolbar">
            <Search value={search} onChange={setSearch} placeholder="Tìm theo tên hoặc mã…" />
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!data ? (
          <p>Đang tải dữ liệu…</p>
        ) : (
          <>
            {tab === 'overview' && (
              <>
                <div className="welcome-panel">
                  <div>
                    <p className="eyebrow" style={{ color: '#c7d8b7' }}>
                      QUYẾT TRƯỜNG BISTRO
                    </p>
                    <h2>Mỗi ca làm, một trải nghiệm tốt hơn.</h2>
                    <p>Thực đơn được chăm chút. Không gian sẵn sàng. Đội ngũ luôn kết nối.</p>
                    <button className="primary-button" onClick={() => setTab('tables')}>
                      Quản lý bàn <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  <div className="welcome-art" aria-hidden="true">
                    QT
                  </div>
                </div>
                <div className="stats-grid">
                  <Stat
                    title="Bàn đang phục vụ"
                    value={data.tables.filter((t) => t.table_status === 'OCCUPIED').length}
                    hint={'Trên ' + data.tables.length + ' bàn'}
                    icon="table"
                  />
                  <Stat
                    title="Món đang kinh doanh"
                    value={data.catalog.products.filter((p) => p.is_active).length}
                    hint={data.catalog.categories.length + ' danh mục'}
                    icon="menu"
                  />
                  <Stat
                    title="Nhân viên hoạt động"
                    value={data.users.filter((u) => u.status === 'ACTIVE').length}
                    hint="Tài khoản nội bộ"
                    icon="people"
                  />
                  <Stat
                    title="Doanh số đã phục vụ"
                    value={vnd(
                      data.reports.sales.reduce((s, r) => s + BigInt(String(r.sales)), 0n),
                    )}
                    hint="Toàn bộ lịch sử"
                    icon="chart"
                  />
                </div>
                <div className="core-grid">
                  <article className="core-card">
                    <h2>Chuẩn bị cho ca phục vụ</h2>
                    <p>Kiểm tra bàn, thực đơn và nguyên liệu trước khi đón khách.</p>
                    {[
                      ['tables', 'Bàn & QR'],
                      ['menu', 'Thực đơn'],
                      ['inventory', 'Kho & công thức'],
                    ].map(([key, title]) => (
                      <div className="core-line" key={key}>
                        <span>{title}</span>
                        <button
                          className="icon-button"
                          aria-label={'Mở ' + title}
                          onClick={() => setTab(key!)}
                        >
                          <Icon name="arrow" size={17} />
                        </button>
                      </div>
                    ))}
                  </article>
                  <article className="core-card">
                    <h2>Phân công rõ ràng</h2>
                    <p>
                      Quản trị thiết lập vận hành. Phục vụ chăm sóc bàn và thu tiền. Bếp tiếp nhận
                      và hoàn thành món.
                    </p>
                    <div className="core-line">
                      <span>Phục vụ</span>
                      <strong>
                        {data.users.filter((u) => u.role === 'STAFF').length} tài khoản
                      </strong>
                    </div>
                    <div className="core-line">
                      <span>Nhân viên bếp</span>
                      <strong>
                        {data.users.filter((u) => u.role === 'KITCHEN').length} tài khoản
                      </strong>
                    </div>
                    <div className="core-line">
                      <span>Hồ sơ dư nợ</span>
                      <strong>{data.outstanding.length}</strong>
                    </div>
                  </article>
                </div>
              </>
            )}
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
                <details className="core-card">
                  <summary>Thêm món hoặc danh mục</summary>
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
                        {
                          key: 'price',
                          label: 'Giá bán (đồng)',
                          type: 'number',
                          min: 0,
                          step: '1',
                        },
                      ]}
                      onSubmit={(v) => save('/core/products', v)}
                    />
                  </div>
                </details>
                {data.catalog.products
                  .filter((p) => matches(p.name + ' ' + p.code, search))
                  .map((p) => (
                    <details key={p.id} className="core-card product-row">
                      <summary>
                        <span className="list-product">
                          <img src={String(p.image_url || '/menu/rice.svg')} alt="" />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.code} · {vnd(p.base_price)} ·{' '}
                              {p.is_active ? label(p.availability_status) : 'Ngừng kinh doanh'}
                            </small>
                          </span>
                        </span>
                      </summary>
                      <EntryForm
                        key={p.version}
                        title="Chỉnh sửa món"
                        fields={[
                          { key: 'name', label: 'Tên món', value: p.name },
                          {
                            key: 'categoryId',
                            label: 'Danh mục',
                            value: String(p.category_id),
                            options: options(data.catalog.categories),
                          },
                          {
                            key: 'description',
                            label: 'Mô tả món',
                            value: String(p.description ?? ''),
                            optional: true,
                          },
                          {
                            key: 'imageUrl',
                            label: 'Địa chỉ ảnh HTTPS hoặc /menu/…',
                            value: String(p.image_url ?? ''),
                            optional: true,
                          },
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
                <details className="core-card">
                  <summary>Thêm bàn hoặc khu vực</summary>
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
                        {
                          key: 'capacity',
                          label: 'Số chỗ',
                          type: 'number',
                          value: 4,
                          min: 1,
                          max: 30,
                        },
                      ]}
                      onSubmit={(v) => save('/core/tables', { ...v, capacity: Number(v.capacity) })}
                    />
                  </div>
                </details>
                <div className="core-grid">
                  {data.tables
                    .filter((t) => matches(String(t.name) + ' ' + t.code, search))
                    .map((t) => (
                      <article className="core-card" key={t.id}>
                        <h2>{String(t.name)}</h2>
                        <p>
                          {label(t.table_status)} · {String(t.capacity)} chỗ
                        </p>
                        <Action
                          confirm="Cấp QR mới sẽ vô hiệu QR cũ của bàn. Tiếp tục?"
                          run={async () => {
                            const result = await api<{ joinPath: string }>(
                              '/core/tables/' + t.id + '/qr',
                              {},
                            );
                            const url = window.location.origin + result.joinPath;
                            setCopyMessage('');
                            setQr({
                              image: await QRCode.toDataURL(url, { width: 320, margin: 4 }),
                              url,
                              table: String(t.name),
                            });
                          }}
                        >
                          Cấp QR mới, thay QR cũ
                        </Action>
                        <Action
                          run={async () => {
                            const result = await api<{
                              available: boolean;
                              joinPath?: string;
                              table?: string;
                            }>('/core/tables/' + t.id + '/qr');
                            if (!result.available || !result.joinPath) {
                              setError('Bàn này chưa có QR hiện tại để hiển thị.');
                              return;
                            }
                            const url = window.location.origin + result.joinPath;
                            setCopyMessage('');
                            setQr({
                              image: await QRCode.toDataURL(url, { width: 320, margin: 4 }),
                              url,
                              table: result.table ?? String(t.name),
                            });
                            setError('');
                          }}
                        >
                          Xem / in QR hiện tại
                        </Action>
                        <button className="secondary-button" onClick={() => setEditTable(t)}>
                          Chỉnh sửa bàn
                        </button>
                      </article>
                    ))}
                </div>
                {qr && (
                  <Modal title={'QR · ' + qr.table} close={() => setQr(undefined)}>
                    <div className="core-qr">
                      <p className="eyebrow">MÃ BÀN DÀNH CHO KHÁCH</p>
                      <h2>Quyết Trường Bistro · {qr.table}</h2>
                      <p>
                        Đặt mã QR ở vị trí dễ nhìn, phẳng và đủ sáng. Khách chỉ cần mở camera, quét
                        mã rồi chọn món tại bàn.
                      </p>
                      <img src={qr.image} alt={'Mã QR ' + qr.table} width={320} height={320} />
                      <div className="core-qr-actions">
                        <a
                          className="secondary-button"
                          href={qr.url}
                          target="_blank"
                          rel="noreferrer"
                        >
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
                        <button className="secondary-button" onClick={() => window.print()}>
                          In trực tiếp
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
                  </Modal>
                )}
                {editTable && (
                  <Modal
                    title={'Chỉnh sửa · ' + String(editTable.name)}
                    close={() => setEditTable(undefined)}
                  >
                    <EntryForm
                      key={String(editTable.version)}
                      title="Thông tin bàn"
                      fields={[
                        { key: 'name', label: 'Tên bàn', value: String(editTable.name) },
                        {
                          key: 'areaId',
                          label: 'Khu vực',
                          value: String(editTable.area_id),
                          options: options(data.areas),
                        },
                        {
                          key: 'capacity',
                          label: 'Số chỗ',
                          type: 'number',
                          value: Number(editTable.capacity),
                          min: 1,
                          max: 30,
                        },
                        {
                          key: 'active',
                          label: 'Sử dụng',
                          value: String(editTable.is_active),
                          options: [
                            { value: 'true', label: 'Đang dùng' },
                            { value: 'false', label: 'Ngừng dùng' },
                          ],
                        },
                      ]}
                      onSubmit={(v) =>
                        save(
                          '/core/tables/' + editTable.id,
                          {
                            ...v,
                            capacity: Number(v.capacity),
                            active: v.active === 'true',
                            version: editTable.version,
                          },
                          'PATCH',
                        ).then(() => setEditTable(undefined))
                      }
                    />
                  </Modal>
                )}
              </>
            )}
            {tab === 'inventory' && <InventoryPanel data={data} search={search} save={save} />}
            {tab === 'users' && <UsersPanel data={data} search={search} save={save} />}
            {tab === 'risk' && <RiskPanel data={data} save={save} />}
            {tab === 'reports' && <ReportsPanel data={data} save={save} />}
          </>
        )}
      </div>
    </section>
  );
}
