'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, label, vnd, type Order, type Product, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import BillPanel from './bill-panel';
import OrderCard from './order-card';
import TableTransferPanel from './table-transfer-panel';
import { SupportActions, AlertActions } from './service-actions';

export default function Service({
  kitchen = false,
  userId,
}: {
  kitchen?: boolean;
  userId: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]),
    [tables, setTables] = useState<Row[]>([]),
    [support, setSupport] = useState<Row[]>([]),
    [alerts, setAlerts] = useState<Row[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [receipts, setReceipts] = useState<Row[]>([]);
  const [selected, setSelected] = useState(''),
    [tab, setTab] = useState('tables'),
    [filter, setFilter] = useState('ALL'),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [updated, setUpdated] = useState(''),
    [notice, setNotice] = useState(''),
    [sound, setSound] = useState(false);
  const polling = useRef(false),
    seen = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const o = await api<Order[]>(kitchen ? '/core/kitchen' : '/core/orders');
      let signals = o.flatMap((b) =>
        b.items
          .filter((i) => i.status === 'READY' || i.status === 'UNAVAILABLE')
          .map((i) => i.id + ':' + i.status),
      );
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
          c.products.filter((p) => c.categories.some((x) => x.id === p.category_id && x.is_active)),
        );
        signals = [
          ...signals,
          ...s.map((x) => x.id + ':' + x.status),
          ...a.map((x) => x.id + ':' + x.status),
          ...t
            .filter((x) => Number(x.pending_payments) > 0)
            .map((x) => x.id + ':payment:' + x.pending_payments),
          ...o.filter((x) => x.status === 'PENDING_REVIEW').map((x) => x.id + ':review'),
        ];
      } else
        signals = [
          ...signals,
          ...o.filter((x) => x.status === 'SUBMITTED').map((x) => x.id + ':submitted'),
        ];
      const added = seen.current ? signals.filter((x) => !seen.current!.has(x)).length : 0;
      seen.current = new Set(signals);
      if (added) {
        setNotice('Có ' + added + ' cập nhật mới cần chú ý.');
        if (audio.current?.state === 'running') {
          const osc = audio.current.createOscillator(),
            gain = audio.current.createGain();
          osc.connect(gain);
          gain.connect(audio.current.destination);
          gain.gain.value = 0.06;
          osc.frequency.value = 660;
          osc.start();
          osc.stop(audio.current.currentTime + 0.18);
        }
      }
      setOrders(o);
      setError('');
      setUpdated(
        new Date().toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      polling.current = false;
    }
  }, [kitchen]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function act(path: string, body: unknown = {}) {
    await api(path, body);
    await refresh();
  }
  async function loadReceipts() {
    setReceipts(await api<Row[]>('/core/receipts'));
  }
  const related = (t: Row) => orders.filter((o) => o.session_id === t.session_id);
  const needs = (t: Row) => {
    const o = related(t),
      items = o.flatMap((o) => o.items);
    const list: string[] = [];
    if (t.verification_status === 'UNVERIFIED') list.push('Chưa xác minh khách');
    const pending = o.filter((o) => o.status === 'PENDING_REVIEW').length,
      ready = items.filter((i) => i.status === 'READY').length;
    if (pending) list.push(pending + ' lượt chờ duyệt');
    if (ready) list.push(ready + ' món chờ mang ra');
    const requests = support.filter((x) => x.session_id === t.session_id).length;
    if (requests) list.push(requests + ' yêu cầu hỗ trợ');
    if (Number(t.pending_payments) > 0) list.push(t.pending_payments + ' thanh toán chờ nhận');
    if (
      alerts.some(
        (a) => a.session_id === t.session_id || (a.session_id === null && a.table_id === t.id),
      )
    )
      list.push('Cảnh báo cần xử lý');
    if (items.some((i) => i.status === 'UNAVAILABLE')) list.push('Có món bếp không thể làm');
    return list;
  };
  const attention = tables.filter((t) => needs(t).length),
    ready = orders.flatMap((o) => o.items).filter((i) => i.status === 'READY').length;
  const current = tables.find((t) => t.session_id === selected);
  const visible = orders.filter((o) => matches(o.table_code, search));
  const selectedOrders = orders.filter((o) => o.session_id === selected);
  return (
    <section className={'core-app service-app ' + (kitchen ? 'kitchen-app' : '')}>
      <div className="service-overview">
        <div>
          <p className="eyebrow">{kitchen ? 'NHỊP BẾP' : 'ĐIỀU PHỐI PHỤC VỤ'}</p>
          <h2>
            {kitchen
              ? orders.filter((o) => o.status === 'SUBMITTED').length + ' lượt mới'
              : attention.length + ' bàn cần chú ý'}
          </h2>
          <p>
            {kitchen
              ? 'Tiếp nhận → Chế biến → Sẵn sàng'
              : tables.filter((t) => t.table_status === 'OCCUPIED').length +
                ' bàn có khách · ' +
                ready +
                ' món chờ mang ra'}
          </p>
        </div>
        <div className="service-tools">
          <Action run={refresh}>
            <Icon name="refresh" size={16} />
            Tải lại
          </Action>
          <button
            className="secondary-button"
            aria-pressed={sound}
            onClick={async () => {
              if (sound) {
                await audio.current?.suspend();
                setSound(false);
              } else {
                try {
                  audio.current ??= new AudioContext();
                  await audio.current.resume();
                  setSound(true);
                } catch {
                  setError('Thiết bị chưa cho phát âm báo. Thông báo trên màn hình vẫn hoạt động.');
                }
              }
            }}
          >
            {sound ? 'Tắt âm báo' : 'Bật âm báo'}
          </button>
          <small>
            {error ? 'Mất kết nối · Dữ liệu có thể đã cũ' : 'Cập nhật ' + (updated || '…')}
          </small>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <div className="service-notice" role="status">
          {notice}
          <button aria-label="Ẩn thông báo" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {!kitchen && (
        <nav className="service-nav" aria-label="Phục vụ">
          {[
            ['tables', 'Sơ đồ bàn', 'table'],
            ['tasks', 'Việc cần làm', 'bell'],
            ['orders', 'Gọi món', 'menu'],
            ['receipts', 'Phiếu đã chốt', 'receipt'],
          ].map(([key, title, icon]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => {
                setTab(key!);
                setSearch('');
                if (key === 'receipts') void loadReceipts().catch((e) => setError(e.message));
              }}
            >
              <Icon name={icon!} size={18} />
              <span>{title}</span>
              {key === 'tasks' && attention.length > 0 && <b>{attention.length}</b>}
            </button>
          ))}
        </nav>
      )}
      <div className="toolbar">
        <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã bàn…" />
      </div>
      {!kitchen && tab === 'tables' && (
        <>
          <div className="filter-chips">
            {[
              ['ALL', 'Tất cả'],
              ['ATTENTION', 'Cần xử lý'],
              ['AVAILABLE', 'Sẵn sàng'],
              ['OCCUPIED', 'Có khách'],
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
          {Array.from(new Set(tables.map((t) => String(t.area_name)))).map((area) => {
            const list = tables.filter(
              (t) =>
                t.area_name === area &&
                (filter === 'ALL' ||
                  (filter === 'ATTENTION' ? needs(t).length > 0 : t.table_status === filter)) &&
                matches(String(t.name) + ' ' + t.code, search),
            );
            return (
              list.length > 0 && (
                <section className="dining-area" key={area}>
                  <h3>
                    {area} <small>· {list.length} bàn</small>
                  </h3>
                  <div className="floor-grid">
                    {list.map((t) => {
                      const signals = needs(t);
                      return (
                        <article
                          className={
                            'table-tile table-dashboard-card' +
                            (signals.length ? ' has-attention' : '')
                          }
                          data-status={String(t.table_status)}
                          key={t.id}
                        >
                          <div className="tile-top">
                            <h3>{String(t.name)}</h3>
                            <span className="status-pill" data-status={String(t.table_status)}>
                              {label(t.table_status)}
                            </span>
                          </div>
                          <p>
                            {String(t.capacity)} chỗ
                            {t.opened_at
                              ? ' · Vào ' +
                                new Date(String(t.opened_at)).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </p>
                          <div className="table-signal">
                            {signals.map((s) => (
                              <span className="need-tag support" key={s}>
                                {s}
                              </span>
                            ))}
                            {!signals.length && (
                              <span className="table-calm">
                                {t.session_id
                                  ? 'Đang phục vụ bình thường'
                                  : 'Sẵn sàng cho thao tác tiếp theo'}
                              </span>
                            )}
                          </div>
                          {t.session_id && (
                            <div className="table-summary">
                              <span>Phải thu {vnd(t.charge_total)}</span>
                              <span>Còn {vnd(t.outstanding_amount)}</span>
                            </div>
                          )}
                          <div className="table-actions">
                            {t.session_id ? (
                              <button
                                className="primary-button"
                                onClick={() => setSelected(String(t.session_id))}
                              >
                                Mở chi tiết bàn
                              </button>
                            ) : t.table_status === 'AVAILABLE' ? (
                              <Action run={() => act('/core/tables/' + t.id + '/open')}>
                                Mở bàn
                              </Action>
                            ) : (
                              t.table_status === 'NEEDS_CLEANING' && (
                                <Action run={() => act('/core/tables/' + t.id + '/clean')}>
                                  Đã dọn xong
                                </Action>
                              )
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )
            );
          })}
        </>
      )}
      {!kitchen && tab === 'tasks' && (
        <>
          <h2>Ưu tiên xử lý</h2>
          {!attention.length && <Empty title="Chưa có việc cần xử lý" />}
          <div className="core-grid">
            {attention.map((t) => (
              <article className="core-card" key={t.id}>
                <h3>{String(t.name)}</h3>
                <p>{needs(t).join(' · ')}</p>
                <button
                  className="primary-button"
                  onClick={() => setSelected(String(t.session_id ?? ''))}
                >
                  Xử lý tại bàn
                </button>
              </article>
            ))}
          </div>
          <h3>Hỗ trợ khách</h3>
          <SupportActions rows={support} userId={userId} act={act} />
          <AlertActions rows={alerts} act={act} />
        </>
      )}
      {!kitchen && tab === 'orders' && (
        <div className="core-grid">
          {visible.length ? (
            visible.map((o) => <OrderCard key={o.id} o={o} kitchen={false} act={act} />)
          ) : (
            <Empty title="Chưa có lượt gọi" />
          )}
        </div>
      )}
      {!kitchen && tab === 'receipts' && (
        <>
          <p>100 phiên đã đóng gần nhất. Phiếu đã chốt có thể xem và in lại.</p>
          <Action run={loadReceipts}>Tải lại phiếu</Action>
          {receipts
            .filter((s) => matches(String(s.table_code) + ' ' + s.receipt_number, search))
            .map((s) => (
              <article className="task-card" key={s.id}>
                <div>
                  <strong>
                    {String(s.receipt_number ?? 'Phiên cũ')} · {String(s.table_code)}
                  </strong>
                  <p>
                    {new Date(String(s.closed_at)).toLocaleString('vi-VN')} · {vnd(s.total_amount)}
                  </p>
                </div>
                <button className="secondary-button" onClick={() => setSelected(s.id)}>
                  Xem / in lại
                </button>
              </article>
            ))}
        </>
      )}
      {kitchen && (
        <div className="kanban">
          {[
            ['Chờ tiếp nhận', visible.filter((o) => o.status === 'SUBMITTED')],
            [
              'Đang chế biến',
              visible.filter(
                (o) =>
                  o.status !== 'SUBMITTED' &&
                  o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
              ),
            ],
            [
              'Chờ phục vụ',
              visible.filter(
                (o) =>
                  o.status !== 'SUBMITTED' &&
                  !o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
              ),
            ],
          ].map(([title, list], i) => (
            <section className={'kanban-column kanban-column-' + i} key={String(title)}>
              <h2>
                {String(title)} <span>{(list as Order[]).length}</span>
              </h2>
              {(list as Order[]).map((o) => (
                <OrderCard key={o.id} o={o} kitchen act={act} />
              ))}
              {!(list as Order[]).length && <Empty title="Chưa có lượt gọi" icon="chef" />}
            </section>
          ))}
        </div>
      )}
      {selected && (
        <Modal
          title={'Chi tiết · ' + String(current?.name ?? 'Phiếu thanh toán')}
          wide
          close={() => setSelected('')}
        >
          {current && (
            <>
              <div className="table-detail-alerts">
                <h3>Việc tại bàn</h3>
                {current.verification_status === 'UNVERIFIED' && (
                  <Action run={() => act('/core/sessions/' + selected + '/verify')}>
                    Đã xác minh khách tại bàn
                  </Action>
                )}
                <SupportActions
                  rows={support.filter((s) => s.session_id === selected)}
                  userId={userId}
                  act={act}
                />
                <AlertActions rows={alerts.filter((a) => a.session_id === selected)} act={act} />
                {!needs(current).length && <p>Không có yêu cầu chờ xử lý.</p>}
              </div>
              <section className="table-orders">
                <h3>Các lượt gọi của bàn</h3>
                {selectedOrders.map((o) => (
                  <OrderCard key={o.id} o={o} kitchen={false} act={act} />
                ))}
              </section>
            </>
          )}
          <BillPanel
            key={selected}
            id={selected}
            products={products}
            onClose={() => setSelected('')}
            done={refresh}
          />
          {current && (
            <TableTransferPanel
              table={current}
              tables={tables}
              done={async () => {
                await refresh();
                setSelected('');
              }}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
