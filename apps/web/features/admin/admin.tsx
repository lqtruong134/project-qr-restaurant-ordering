'use client';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import WorkforcePanel from '../workforce/workforce-panel';
import type { AdminData, Inventory } from './admin-types';
import InventoryPanel from './inventory-panel';
import UsersPanel from './users-panel';
import RiskPanel from './risk-panel';
import ReportsPanel from './reports-panel';
import { Icon, Modal, Search, matches } from '../shared/primitives';
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

const sumMoney = (rows: Row[], key: string) =>
  rows.reduce((sum, row) => sum + BigInt(String(row[key] ?? 0)), 0n);
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

function Overview({ data, open }: { data: AdminData; open: (tab: string) => void }) {
  const occupied = data.tables.filter((t) => t.table_status === 'OCCUPIED').length;
  const cleaning = data.tables.filter((t) => t.table_status === 'NEEDS_CLEANING').length;
  const activeStaff = data.users.filter((u) => u.status === 'ACTIVE' && u.role !== 'ADMIN').length;
  const topSales = data.reports.sales.slice(0, 6);
  const maxSales = Math.max(...topSales.map((r) => Number(r.sales ?? 0)), 1);
  return (
    <>
      <div className="welcome-panel">
        <div>
          <p className="eyebrow" style={{ color: '#c7d8b7' }}>
            QUYẾT TRƯỜNG BISTRO · TRUNG TÂM ĐIỀU HÀNH
          </p>
          <h2>Chủ quán nắm được mọi điểm quan trọng trong một màn hình.</h2>
          <p>Các số liệu bên dưới là lối tắt đến cùng hệ thống báo cáo chi tiết.</p>
        </div>
        <div className="welcome-art" aria-hidden="true">
          QT
        </div>
      </div>
      <div className="stats-grid">
        <button className="stat-card stat-card-button" onClick={() => open('tables')}>
          <div>
            <span className="stat-label">Bàn đang phục vụ</span>
            <strong>
              {occupied}/{data.tables.length}
            </strong>
            <small>
              {cleaning} bàn chờ dọn · {percent(occupied, data.tables.length)}% công suất
            </small>
          </div>
          <span className="stat-icon">
            <Icon name="table" />
          </span>
        </button>
        <button className="stat-card stat-card-button" onClick={() => open('reports')}>
          <div>
            <span className="stat-label">Doanh số đã phục vụ</span>
            <strong>{vnd(sumMoney(data.reports.sales, 'sales'))}</strong>
            <small>{data.reports.sales.length} món có phát sinh doanh số</small>
          </div>
          <span className="stat-icon">
            <Icon name="chart" />
          </span>
        </button>
        <button className="stat-card stat-card-button" onClick={() => open('users')}>
          <div>
            <span className="stat-label">Nhân viên đang hoạt động</span>
            <strong>{activeStaff}</strong>
            <small>
              {data.users.filter((u) => u.role === 'STAFF').length} phục vụ ·{' '}
              {data.users.filter((u) => u.role === 'KITCHEN').length} bếp
            </small>
          </div>
          <span className="stat-icon">
            <Icon name="people" />
          </span>
        </button>
        <button className="stat-card stat-card-button" onClick={() => open('reports')}>
          <div>
            <span className="stat-label">Đã thu thành công</span>
            <strong>{vnd(sumMoney(data.reports.payments, 'amount'))}</strong>
            <small>{data.reports.payments.length} phương thức thanh toán</small>
          </div>
          <span className="stat-icon">
            <Icon name="receipt" />
          </span>
        </button>
      </div>
      <div className="dashboard-grid">
        <article className="core-card chart-card">
          <div className="section-heading compact">
            <div>
              <h2>Top món theo doanh số</h2>
              <p>Bấm vào biểu đồ để mở báo cáo chi tiết.</p>
            </div>
            <button className="secondary-button" onClick={() => open('reports')}>
              Xem toàn bộ
            </button>
          </div>
          <div className="bar-chart">
            {topSales.length ? (
              topSales.map((row) => (
                <button
                  className="bar-row"
                  key={String(row.product_id ?? row.product_name_snapshot)}
                  onClick={() => open('reports')}
                >
                  <span title={String(row.product_name_snapshot)}>
                    {String(row.product_name_snapshot)}
                  </span>
                  <span className="bar-track">
                    <i
                      style={{
                        width: `${Math.max(5, (Number(row.sales ?? 0) / maxSales) * 100)}%`,
                      }}
                    />
                  </span>
                  <strong>{vnd(row.sales)}</strong>
                </button>
              ))
            ) : (
              <p>Chưa có dữ liệu món đã phục vụ.</p>
            )}
          </div>
        </article>
        <article className="core-card dashboard-summary">
          <div className="section-heading compact">
            <div>
              <h2>Cảnh báo cần chú ý</h2>
              <p>Ưu tiên xử lý trước khi chốt ca.</p>
            </div>
            <button className="secondary-button" onClick={() => open('risk')}>
              Mở kiểm soát
            </button>
          </div>
          <div className="dashboard-alert">
            <Icon name="shield" />
            <span>
              <strong>{data.outstanding.length}</strong>
              <small>hồ sơ thiếu tiền đang mở</small>
            </span>
          </div>
          <div className="dashboard-alert">
            <Icon name="box" />
            <span>
              <strong>
                {data.inventory.balances.filter((b) => Number(b.available_qty ?? 0) <= 0).length}
              </strong>
              <small>nguyên liệu hết khả dụng</small>
            </span>
          </div>
          <div className="dashboard-alert">
            <Icon name="bell" />
            <span>
              <strong>Đang bật</strong>
              <small>kiểm soát gọi món theo chính sách</small>
            </span>
          </div>
        </article>
      </div>
      <div className="quick-links">
        {(
          [
            ['reports', 'Báo cáo & thanh toán', 'Doanh số, tiền thu, thiếu tiền'],
            ['tables', 'Bàn & QR', 'Sức chứa, trạng thái và mã QR'],
            ['workforce', 'Ca làm & lương', 'Phân ca, duyệt công, chốt lương'],
            ['inventory', 'Kho & công thức', 'Tồn kho, nhập hàng, định lượng'],
          ] as const
        ).map(([key, title, desc]) => (
          <button className="quick-link" key={key} onClick={() => open(key)}>
            <span>
              <strong>{title}</strong>
              <small>{desc}</small>
            </span>
            <Icon name="arrow" size={17} />
          </button>
        ))}
      </div>
    </>
  );
}
export default function Admin() {
  const [data, setData] = useState<AdminData>(),
    [error, setError] = useState(''),
    [tab, setTab] = useState('overview'),
    [search, setSearch] = useState(''),
    [editTable, setEditTable] = useState<Row>(),
    [qr, setQr] = useState<{ image: string; url: string; table: string }>(),
    [copyMessage, setCopyMessage] = useState(''),
    [navCollapsed, setNavCollapsed] = useState(false);
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
    <section className={'core-app admin-layout' + (navCollapsed ? ' nav-collapsed' : '')}>
      <nav className="core-tabs" aria-label="Quản trị">
        <button
          className="sidebar-toggle secondary-button"
          type="button"
          aria-expanded={!navCollapsed}
          aria-label={navCollapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          onClick={() => setNavCollapsed((collapsed) => !collapsed)}
        >
          <Icon name="menu" size={18} />
          <span>{navCollapsed ? 'Mở menu' : 'Thu gọn menu'}</span>
        </button>
        {[
          ['overview', 'Tổng quan'],
          ['menu', 'Thực đơn'],
          ['tables', 'Bàn & QR'],
          ['inventory', 'Kho & công thức'],
          ['users', 'Nhân viên'],
          ['workforce', 'Ca làm & lương'],
          ['risk', 'Kiểm soát gọi món'],
          ['reports', 'Báo cáo'],
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? 'primary-button' : 'secondary-button'}
            title={title}
            aria-label={title}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => {
              setTab(key!);
              setSearch('');
              if (window.innerWidth <= 800) setNavCollapsed(true);
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
                    workforce: 'people',
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
                    workforce: 'Phân ca, chấm công & lương',
                    risk: 'Kiểm soát gọi món',
                    reports: 'Báo cáo & thanh toán',
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
                    workforce: 'Phân công rõ ràng, duyệt giờ công và chốt phiếu lương.',
                    risk: 'Các quy tắc hỗ trợ nhân viên duyệt yêu cầu bất thường.',
                    reports:
                      'Doanh số, tiền thu và hồ sơ thiếu tiền trong cùng một trang chi tiết.',
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
            {tab === 'overview' && <Overview data={data} open={setTab} />}
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
            {tab === 'workforce' && <WorkforcePanel users={data.users} areas={data.areas} />}
            {tab === 'risk' && <RiskPanel data={data} save={save} />}
            {tab === 'reports' && <ReportsPanel data={data} save={save} />}
          </>
        )}
      </div>
    </section>
  );
}
