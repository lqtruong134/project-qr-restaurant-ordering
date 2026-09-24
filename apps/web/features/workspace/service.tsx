'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, label, vnd, type Order, type Product, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, Stat, matches } from '../shared/primitives';
import BillPanel from './bill-panel';
import OrderCard from './order-card';

export default function Service({ kitchen = false }: { kitchen?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]),
    [tables, setTables] = useState<Row[]>([]),
    [support, setSupport] = useState<Row[]>([]),
    [alerts, setAlerts] = useState<Row[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const [tab, setTab] = useState('tables'),
    [filter, setFilter] = useState('ALL'),
    [search, setSearch] = useState('');
  const refresh = useCallback(async () => {
    try {
      setOrders(await api<Order[]>(kitchen ? '/core/kitchen' : '/core/orders'));
      if (!kitchen) {
        const [t, s, a, c] = await Promise.all([
          api<Row[]>('/core/tables'),
          api<Row[]>('/core/support'),
          api<Row[]>('/core/alerts'),
          api<{ products: Product[]; categories: Row[] }>('/core/catalog'),
        ]);
        setTables(t);
        setSupport(s);
        setAlerts(a);
        setProducts(
          c.products.filter((p) =>
            c.categories.some((category) => category.id === p.category_id && category.is_active),
          ),
        );
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa kết nối được máy chủ.');
    }
  }, [kitchen]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(path: string, body: unknown = {}) {
    await api(path, body);
    await refresh();
  }
  const visible = orders.filter((o) => matches(o.table_code, search));
  const queue = visible.filter((o) => o.status === 'SUBMITTED');
  const preparing = visible.filter(
    (o) =>
      o.status !== 'SUBMITTED' &&
      o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
  );
  const ready = visible.filter(
    (o) =>
      o.status !== 'SUBMITTED' &&
      !o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
  );
  const readyCount = orders.reduce(
    (s, o) => s + o.items.filter((i) => i.status === 'READY').length,
    0,
  );
  return (
    <section className="core-app">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="stats-grid">
        {kitchen ? (
          <>
            <Stat title="Lượt mới" value={queue.length} hint="Chờ bếp tiếp nhận" icon="bell" />
            <Stat
              title="Đang chế biến"
              value={preparing.length}
              hint="Lượt đang xử lý"
              icon="chef"
            />
            <Stat title="Món sẵn sàng" value={readyCount} hint="Chờ phục vụ mang ra" icon="check" />
            <Stat
              title="Tổng lượt đang mở"
              value={orders.length}
              hint="Tự cập nhật sau vài giây"
              icon="receipt"
            />
          </>
        ) : (
          <>
            <Stat
              title="Bàn đang phục vụ"
              value={tables.filter((t) => t.table_status === 'OCCUPIED').length}
              hint={'Trong ' + tables.length + ' bàn'}
              icon="table"
            />
            <Stat
              title="Bàn sẵn sàng"
              value={tables.filter((t) => t.table_status === 'AVAILABLE').length}
              hint="Có thể đón khách"
              icon="check"
            />
            <Stat
              title="Món chờ mang ra"
              value={readyCount}
              hint="Ưu tiên phục vụ khi món nóng"
              icon="chef"
            />
            <Stat
              title="Yêu cầu hỗ trợ"
              value={support.length}
              hint="Đang chờ hoặc đang xử lý"
              icon="bell"
            />
          </>
        )}
      </div>
      {!kitchen && (
        <nav className="service-nav" aria-label="Phục vụ">
          {[
            ['tables', 'Sơ đồ bàn', tables.length],
            ['orders', 'Gọi món', orders.length],
            ['support', 'Hỗ trợ & cảnh báo', support.length + alerts.length],
          ].map(([key, title, count]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => {
                setTab(String(key));
                setSearch('');
              }}
            >
              {title} <span className="status-pill">{count}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder={kitchen || tab === 'orders' ? 'Tìm theo mã bàn…' : 'Tìm tên hoặc mã bàn…'}
        />
        <span className="live-indicator">Cập nhật mỗi 3 giây</span>
        <Action run={refresh}>
          <Icon name="refresh" size={16} />
          Tải lại dữ liệu
        </Action>
      </div>
      {!kitchen && tab === 'tables' && (
        <>
          <div className="filter-chips">
            {[
              ['ALL', 'Tất cả'],
              ['AVAILABLE', 'Sẵn sàng'],
              ['OCCUPIED', 'Đang có khách'],
              ['NEEDS_CLEANING', 'Chờ dọn'],
            ].map(([key, title]) => (
              <button
                key={key}
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key!)}
              >
                {title}
              </button>
            ))}
          </div>
          <div className="floor-grid">
            {tables
              .filter(
                (t) =>
                  (filter === 'ALL' || t.table_status === filter) &&
                  matches(String(t.name) + ' ' + t.code, search),
              )
              .map((t) => (
                <article className="table-tile" data-status={String(t.table_status)} key={t.id}>
                  <div className="tile-top">
                    <Icon name="table" size={27} />
                    <span className="status-pill" data-status={String(t.table_status)}>
                      {label(t.table_status)}
                    </span>
                  </div>
                  <h3>{String(t.name)}</h3>
                  <p>
                    {String(t.capacity)} chỗ · {String(t.code)}
                  </p>
                  {t.table_status === 'AVAILABLE' && (
                    <Action run={() => act('/core/tables/' + t.id + '/open')}>
                      Mở bàn cho khách
                    </Action>
                  )}
                  {t.session_id && (
                    <>
                      <button
                        className="primary-button"
                        onClick={() => setSelected(String(t.session_id))}
                      >
                        Xem bàn / tính tiền
                      </button>
                      {t.verification_status === 'UNVERIFIED' && (
                        <Action run={() => act('/core/sessions/' + t.session_id + '/verify')}>
                          Đã xác minh khách tại bàn
                        </Action>
                      )}
                    </>
                  )}
                  {t.table_status === 'NEEDS_CLEANING' && (
                    <Action run={() => act('/core/tables/' + t.id + '/clean')}>Đã dọn xong</Action>
                  )}
                </article>
              ))}
          </div>
        </>
      )}
      {!kitchen && tab === 'support' && (
        <>
          <div className="section-heading">
            <h2>Yêu cầu hỗ trợ</h2>
          </div>
          {!support.length && (
            <Empty title="Mọi bàn đang ổn" icon="bell">
              Yêu cầu mới của khách sẽ xuất hiện tại đây.
            </Empty>
          )}
          <div className="core-grid">
            {support
              .filter((s) => matches(String(s.table_code), search))
              .map((s) => (
                <article className="core-card" key={s.id}>
                  <div className="section-heading">
                    <h3>
                      {String(s.table_code)} · {label(s.request_type)}
                    </h3>
                    <span className="status-pill">{label(s.status)}</span>
                  </div>
                  <p>{String(s.content ?? 'Khách cần nhân viên đến bàn.')}</p>
                  {s.status === 'NEW' ? (
                    <Action run={() => act('/core/support/' + s.id + '/claim')}>
                      Tôi tiếp nhận
                    </Action>
                  ) : (
                    <Action run={() => act('/core/support/' + s.id + '/resolve')}>
                      Tôi đã hỗ trợ xong
                    </Action>
                  )}
                </article>
              ))}
          </div>
          {alerts.length > 0 && (
            <>
              <h2>Cảnh báo cần chú ý</h2>
              {alerts.map((a) => (
                <article className="core-card" key={a.id}>
                  <h3>
                    {String(a.table_code)} ·{' '}
                    {a.alert_type === 'REFUND_REQUIRED'
                      ? 'Cần hoàn tiền'
                      : a.alert_type === 'PAYMENT_SHORTFALL'
                        ? 'Thiếu tiền thanh toán'
                        : 'Cần kiểm tra giao dịch'}
                  </h3>
                  <p>{vnd(a.outstanding_amount)}</p>
                  {['NEW', 'ESCALATED'].includes(String(a.status)) && (
                    <Action run={() => act('/core/alerts/' + a.id + '/acknowledge')}>
                      Xác nhận đã nhận cảnh báo
                    </Action>
                  )}
                  {a.status === 'ACKNOWLEDGED' && (
                    <Action run={() => act('/core/alerts/' + a.id + '/resolve')}>
                      Đã xử lý cảnh báo
                    </Action>
                  )}
                </article>
              ))}
            </>
          )}
        </>
      )}
      {kitchen ? (
        <>
          <div className="section-heading">
            <h2>Các lượt bếp cần xử lý</h2>
            <small>Nhận lượt → Chế biến → Sẵn sàng</small>
          </div>
          <div className="kanban">
            {[
              ['Mới tiếp nhận', queue],
              ['Đang thực hiện', preparing],
              ['Chờ phục vụ', ready],
            ].map(([title, list]) => (
              <section className="kanban-column" key={String(title)}>
                <h2>
                  {String(title)}
                  <span>{(list as Order[]).length}</span>
                </h2>
                {!(list as Order[]).length ? (
                  <Empty title="Chưa có lượt gọi" icon="chef" />
                ) : (
                  (list as Order[]).map((o) => <OrderCard key={o.id} o={o} kitchen act={act} />)
                )}
              </section>
            ))}
          </div>
        </>
      ) : (
        tab === 'orders' && (
          <>
            <div className="section-heading">
              <h2>Các lượt gọi món</h2>
            </div>
            {!visible.length && <Empty title="Chưa có lượt gọi cần xử lý" icon="receipt" />}
            <div className="core-grid">
              {visible.map((o) => (
                <OrderCard key={o.id} o={o} kitchen={false} act={act} />
              ))}
            </div>
          </>
        )
      )}
      {selected && (
        <Modal
          title={
            'Chi tiết · ' + String(tables.find((t) => t.session_id === selected)?.name ?? 'Bàn')
          }
          wide
          close={() => setSelected('')}
        >
          <BillPanel
            key={selected}
            id={selected}
            products={products}
            onClose={() => setSelected('')}
            done={refresh}
          />
        </Modal>
      )}
    </section>
  );
}
