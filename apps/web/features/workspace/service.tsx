'use client';
import { SessionReference } from '../shared/session-reference';
import { ServerHistory } from '../shared/history-filters';
import { supportPolicy } from '@thesis/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, label, vnd, type Order, type Product, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { RoleVisual } from '../shared/role-visual';
import { notifyInfo, notifySuccess } from '../shared/operation-notice';
import BillPanel from './bill-panel';
import { AssistedOrder } from './assisted-order';
import { StaffTableCode } from './table-access';
import { StaffTableQr } from './table-qr';
import { WorkQueue, workState } from './work-queue';
import { tableWork, TableTasks, requestOwner } from './table-work';
import OrderCard from './order-card';
import { ServeSelection } from './serve-selection';
import TableTransferPanel from './table-transfer-panel';
import { AlertActions } from './service-actions';
import { SupportActions } from './support-panel';
import { supportLabels } from '../shared/support-labels';
import { restaurantDateTime, restaurantTime } from '../shared/restaurant-time';

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
    [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Row[]>([]),
    [ordering, setOrdering] = useState(''),
    [accessTable, setAccessTable] = useState('');
  const [receiptReload, setReceiptReload] = useState(0);
  const [cleaningTable, setCleaningTable] = useState('');
  const [qrTable, setQrTable] = useState<Row>();
  const [selected, setSelected] = useState(''),
    [tab, setTab] = useState('tables'),
    [detailTab, setDetailTab] = useState('tasks'),
    [refundFocus, setRefundFocus] = useState(false),
    [taskFilter, setTaskFilter] = useState('all'),
    [queueView, setQueueView] = useState('common'),
    [paymentRequest, setPaymentRequest] = useState(''),
    [filter, setFilter] = useState('ALL'),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [updated, setUpdated] = useState(''),
    [notice, setNotice] = useState(''),
    [sound, setSound] = useState(false),
    [lane, setLane] = useState('all');
  const [tableNotice, setTableNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setTableNotice('');
  }, [selected]);
  useEffect(() => {
    if (!tableNotice) return;
    const t = setTimeout(() => setTableNotice(''), 5000);
    return () => clearTimeout(t);
  }, [tableNotice]);
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
        setCategories(c.categories);
        setTables(t);
        setSupport(s);
        setAlerts(a.filter((alert) => !alert.requires_admin && !alert.payment_reconciliation));
        setProducts(
          c.products.filter((p) => c.categories.some((x) => x.id === p.category_id && x.is_active)),
        );
        signals = [
          ...signals,
          ...s
            .filter((x) => x.status === 'NEW' || x.acknowledged_by === userId)
            .map((x) => x.id + ':' + x.status + ':' + x.acknowledged_by),
          ...s
            .filter((x) => x.pending_to_staff_id === userId)
            .map((x) => 'handoff:' + x.pending_handoff_id),
          ...s
            .filter((x) => x.acknowledged_by === userId && x.latest_handoff_id)
            .map((x) => 'response:' + x.latest_handoff_id + ':' + x.latest_handoff_status),
          ...a.filter((x) => !x.requires_admin).map((x) => x.id + ':' + x.status),
          ...t
            .filter((x) => Number(x.pending_payments) > 0)
            .map((x) => x.id + ':payment:' + x.pending_payments),
          ...o.filter((x) => x.status === 'PENDING_REVIEW').map((x) => x.id + ':review'),
          ...t
            .filter((x) => x.table_status === 'NEEDS_CLEANING')
            .map((x) => x.id + ':clean:' + x.version),
          ...t.filter((x) => x.verification_status === 'UNVERIFIED').map((x) => x.id + ':verify'),
        ];
      } else
        signals = [
          ...signals,
          ...o.filter((x) => x.status === 'SUBMITTED').map((x) => x.id + ':submitted'),
        ];
      const seenBefore = seen.current ?? new Set<string>();
      const added = seen.current ? signals.filter((x) => !seen.current!.has(x)).length : 0;
      seen.current = new Set(signals);
      if (added) {
        const newCleaning = signals.filter(
          (x) => x.includes(':clean:') && !seenBefore.has(x),
        ).length;
        setNotice(
          newCleaning
            ? newCleaning + ' bàn vừa chuyển sang chờ dọn. Xem Việc chung → Dọn bàn.'
            : 'Có ' + added + ' cập nhật mới cần chú ý.',
        );
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
        restaurantTime(new Date().toISOString(), {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      polling.current = false;
      setLoaded(true);
    }
  }, [kitchen, userId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, supportPolicy.pollMs);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
    };
  }, [refresh]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function act(path: string, body: unknown = {}) {
    let result: { skipped?: unknown[]; cancelled?: unknown[] };
    try {
      result = await api(path, body);
    } catch (e) {
      await refresh();
      throw e;
    }
    if (path.endsWith('/close')) setNotice('Đã kết thúc bàn. Việc dọn bàn đã có trong Việc chung.');
    if (result?.skipped?.length)
      notifyInfo(
        'Đã hủy ' +
          (result.cancelled?.length ?? 0) +
          ' món; giữ lại ' +
          result.skipped.length +
          ' món không còn đủ điều kiện.',
      );
    else if (result?.cancelled)
      if (result.cancelled.length)
        notifySuccess(`Đã hủy ${result.cancelled.length} món chưa chế biến.`);
      else notifyInfo('Không có món nào còn đủ điều kiện hủy.');
    await refresh();
    if (/^\/core\/support\/[^/]+\/(claim|handoffs\/[^/]+\/accept)$/.test(path))
      setQueueView('mine');
  }
  async function loadReceipts() {
    setReceiptReload((v) => v + 1);
  }
  function openTable(t: Row, targetTab?: string, requestId = '') {
    if (!t.session_id && support.some((s) => s.table_id === t.id)) {
      setAccessTable(t.id);
      return;
    }
    if (!t.session_id && t.table_status === 'NEEDS_CLEANING') {
      setCleaningTable(t.id);
      return;
    }
    setSelected(String(t.session_id ?? ''));
    setPaymentRequest(requestId);
    setRefundFocus(tableWork(t, orders, support, alerts)[0]?.kind === 'refund');
    setDetailTab(targetTab ?? tableWork(t, orders, support, alerts)[0]?.tab ?? 'payments');
  }
  function openRequest(s: Row) {
    const t = tables.find(
      (t) => (s.session_id && t.session_id === s.session_id) || t.id === s.table_id,
    );
    if (t) openTable(t, s.request_type === 'BILL' ? 'payments' : 'tasks', s.id);
  }
  const related = (t: Row) => orders.filter((o) => o.session_id === t.session_id);
  const needs = (t: Row) => {
    const o = related(t),
      items = o.flatMap((o) => o.items);
    const list: string[] = [];
    if (t.table_status === 'NEEDS_CLEANING') list.push('Dọn bàn để đón khách mới');
    for (const s of support.filter(
      (s) => (t.session_id && s.session_id === t.session_id) || s.table_id === t.id,
    ))
      list.push(
        (s.request_type === 'BILL'
          ? 'Thu tiền'
          : (supportLabels[String(s.request_type)] ?? 'Hỗ trợ')) +
          ' - ' +
          requestOwner(s, userId),
      );
    if (t.verification_status === 'UNVERIFIED') list.push('Chưa xác minh khách');
    const pending = o.filter((o) => o.status === 'PENDING_REVIEW').length,
      ready = items.filter((i) => i.status === 'READY').length;
    if (pending) list.push(pending + ' lượt chờ duyệt');
    if (ready) list.push(ready + ' món chờ mang ra');

    if (Number(t.pending_payments) > 0) list.push(t.pending_payments + ' thanh toán chờ nhận');
    if (
      alerts.some(
        (a) =>
          !a.requires_admin &&
          (a.session_id === t.session_id || (a.session_id === null && a.table_id === t.id)),
      )
    )
      list.push(
        alerts.some((a) => a.session_id === t.session_id && a.guest_notice === true)
          ? 'Món bị dừng - Cần báo khách'
          : 'Cảnh báo cần xử lý',
      );
    return [...new Set(list)];
  };
  const priority = (t: Row) =>
    alerts.some((a) => !a.requires_admin && a.session_id === t.session_id)
      ? 4
      : Number(t.pending_payments) > 0 ||
          support.some((s) => s.session_id === t.session_id && s.request_type === 'BILL')
        ? 3
        : related(t).some((o) => o.items.some((i) => i.status === 'READY'))
          ? 2
          : related(t).some((o) => o.status === 'PENDING_REVIEW')
            ? 1
            : 0;
  const attention = tables.filter((t) => needs(t).length).sort((a, b) => priority(b) - priority(a)),
    ready = orders.flatMap((o) => o.items).filter((i) => i.status === 'READY').length;
  const actionableCount = tables
    .flatMap((t) => tableWork(t, orders, support, alerts))
    .filter((j) => workState(j, userId) !== 'other').length;
  const dishNotices = alerts.filter((a) => a.guest_notice === true);
  const incomingHandoffs = support.filter((x) => x.pending_to_staff_id === userId).length;
  const current = tables.find((t) => t.session_id === selected);
  const visible = orders.filter((o) =>
    matches(
      [
        o.table_code,
        o.id.slice(0, 6),
        ...o.items.map((i) => i.product_name_snapshot + ' ' + (i.note ?? '')),
      ].join(' '),
      search,
    ),
  );
  const shownTables = tables.filter(
    (t) =>
      (filter === 'ALL' ||
        (filter === 'ATTENTION' ? needs(t).length > 0 : t.table_status === filter)) &&
      matches(String(t.name) + ' ' + t.code, search),
  );
  const selectedOrders = orders.filter((o) => o.session_id === selected);
  if (ordering)
    return (
      <AssistedOrder
        sessionId={ordering}
        table={tables.find((t) => t.session_id === ordering)}
        products={products}
        categories={categories}
        orders={orders}
        back={() => setOrdering('')}
        done={refresh}
      />
    );
  return (
    <section className={'core-app service-app ' + (kitchen ? 'kitchen-app' : '')}>
      <RoleVisual role={kitchen ? 'kitchen' : 'staff'}>
        <div className="service-overview">
          <div>
            <p className="eyebrow">{kitchen ? 'Màn hình chế biến' : 'Điều phối phục vụ'}</p>
            <h2>
              {kitchen
                ? orders.filter((o) => o.status === 'SUBMITTED').length + ' lượt mới'
                : attention.length + ' bàn cần chú ý'}
            </h2>
            <p>
              {kitchen
                ? 'Nhận món → Bắt đầu chế biến → Báo món đã xong'
                : tables.filter((t) => t.table_status === 'OCCUPIED').length +
                  ' bàn có khách - ' +
                  ready +
                  ' món chờ mang ra - ' +
                  tables.filter((t) => t.table_status === 'NEEDS_CLEANING').length +
                  ' bàn chờ dọn'}
            </p>
          </div>
          <div className="service-tools">
            <Action run={refresh}>
              <Icon name="refresh" size={16} />
              Làm mới
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
                    setError(
                      'Thiết bị chưa cho phát âm báo. Thông báo trên màn hình vẫn hoạt động.',
                    );
                  }
                }
              }}
            >
              {sound ? 'Tắt âm báo' : 'Bật âm báo'}
            </button>
            <small>
              {error ? 'Cần kiểm tra thông báo bên dưới' : 'Cập nhật ' + (updated || '…')}
            </small>
          </div>
        </div>
      </RoleVisual>
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
      {!kitchen && dishNotices.length > 0 && (
        <div className="support-alert-banner dish-issue-banner" role="status">
          <Icon name="warning" />
          <div>
            <strong>{dishNotices.length} món bị dừng - Cần đến trao đổi với khách</strong>
            <p>
              Bàn {Array.from(new Set(dishNotices.map((a) => String(a.table_code)))).join(', ')} -
              Khách có thể chưa xem điện thoại.
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              setTab('tasks');
              setQueueView('common');
              setTaskFilter('issue');
              setSearch('');
            }}
          >
            Xem việc trao đổi tại bàn
          </button>
        </div>
      )}
      {!kitchen && incomingHandoffs > 0 && (
        <div className="support-alert-banner" role="status">
          <Icon name="bell" />
          <div>
            <strong>Bàn giao đến bạn - {incomingHandoffs}</strong>
            <p>Đồng nghiệp đang chờ bạn nhận hoặc từ chối.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              setTab('tasks');
              setQueueView('incoming');
              setTaskFilter('all');
              setSearch('');
            }}
          >
            Xem bàn giao
          </button>
        </div>
      )}
      {!kitchen && (
        <section className="service-metrics" aria-label="Tình trạng phục vụ">
          <button
            onClick={() => {
              setTab('tasks');
              setQueueView('common');
              setTaskFilter('all');
              setSearch('');
            }}
          >
            <Icon name="bell" />
            <span>
              <strong>{actionableCount}</strong>
              <small>việc cần xử lý</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
          <button
            onClick={() => {
              setTab('tasks');
              setQueueView('common');
              setTaskFilter('serve');
              setSearch('');
            }}
          >
            <Icon name="chef" />
            <span>
              <strong>{ready}</strong>
              <small>món chờ mang ra</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
          <button
            onClick={() => {
              setTab('tasks');
              setQueueView('common');
              setTaskFilter('clean');
              setSearch('');
            }}
          >
            <Icon name="check" />
            <span>
              <strong>{tables.filter((t) => t.table_status === 'NEEDS_CLEANING').length}</strong>
              <small>bàn chờ dọn</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        </section>
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
              {key === 'tasks' && actionableCount > 0 && (
                <b aria-label={actionableCount + ' việc cần bạn xử lý'}>{actionableCount}</b>
              )}
            </button>
          ))}
        </nav>
      )}
      {kitchen && (
        <nav className="kitchen-lanes" aria-label="Trạng thái bếp">
          {['Tất cả', 'Chờ tiếp nhận', 'Bếp đang xử lý', 'Chờ mang ra'].map((title, index) => {
            const value = index === 0 ? 'all' : String(index - 1);
            return (
              <button
                key={value}
                className={lane === value ? 'active' : ''}
                aria-pressed={lane === value}
                onClick={() => setLane(value)}
              >
                {title}
                <span className="lane-count">
                  {index === 0
                    ? orders.length
                    : index === 1
                      ? orders.filter((o) => o.status === 'SUBMITTED').length
                      : index === 2
                        ? orders.filter(
                            (o) =>
                              o.status !== 'SUBMITTED' &&
                              o.items.some((i) =>
                                ['ACCEPTED', 'IN_PREPARATION'].includes(i.status),
                              ),
                          ).length
                        : orders.filter(
                            (o) =>
                              o.status !== 'SUBMITTED' &&
                              !o.items.some((i) =>
                                ['ACCEPTED', 'IN_PREPARATION'].includes(i.status),
                              ),
                          ).length}
                </span>
              </button>
            );
          })}
        </nav>
      )}
      {(kitchen || (tab !== 'receipts' && tab !== 'tasks')) && (
        <div className="toolbar">
          <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã bàn…" />
        </div>
      )}
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
                aria-pressed={filter === key}
                onClick={() => setFilter(key!)}
              >
                {title}
              </button>
            ))}
          </div>
          {loaded && shownTables.length === 0 && (
            <Empty
              title={tables.length ? 'Không có bàn phù hợp' : 'Chưa có bàn trong sơ đồ'}
              icon="table"
            >
              {tables.length
                ? 'Thử tìm tên hoặc mã bàn khác, hoặc chọn Tất cả để xem lại.'
                : 'Nhờ quản lý kiểm tra danh sách bàn của nhà hàng.'}
            </Empty>
          )}
          {!loaded && <p role="status">Đang tải danh sách bàn…</p>}
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
                    {area} <small>- {list.length} bàn</small>
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
                              {t.is_active ? label(t.table_status) : 'Ngừng sử dụng'}
                            </span>
                          </div>
                          <p>
                            {String(t.capacity)} chỗ
                            {t.opened_at
                              ? ' - Vào ' +
                                restaurantTime(t.opened_at, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </p>
                          <div className="table-signal">
                            {signals.map((s) => (
                              <span
                                className={
                                  'need-tag task-' +
                                  (s.includes('thu tiền') || s.includes('thanh toán')
                                    ? 'payment'
                                    : s.includes('mang ra')
                                      ? 'serve'
                                      : s.includes('duyệt')
                                        ? 'review'
                                        : s.includes('bị dừng') || s.includes('Cảnh báo')
                                          ? 'issue'
                                          : 'support')
                                }
                                key={s}
                              >
                                {s}
                              </span>
                            ))}
                            {!signals.length && (
                              <span className="table-calm">
                                {t.session_id ? 'Đang phục vụ' : 'Chưa có khách'}
                              </span>
                            )}
                          </div>
                          {t.session_id && (
                            <div className="table-summary">
                              <span>
                                <SessionReference id={t.session_id} separator={false} />
                              </span>
                              <span>Tổng tiền {vnd(t.charge_total)}</span>
                              <span>Còn phải trả {vnd(t.outstanding_amount)}</span>
                            </div>
                          )}
                          <div className="table-actions">
                            {t.is_active && (
                              <button className="secondary-button" onClick={() => setQrTable(t)}>
                                QR bàn
                              </button>
                            )}
                            {t.session_id ? (
                              <button className="primary-button" onClick={() => openTable(t)}>
                                Mở chi tiết bàn
                              </button>
                            ) : !t.is_active ? (
                              <span className="small-note">Bàn tạm ngừng phục vụ</span>
                            ) : t.table_status === 'AVAILABLE' ? (
                              <Action
                                successMessage={`Đã mở bàn ${String(t.name)}.`}
                                run={() => act('/core/tables/' + t.id + '/open')}
                              >
                                Mở bàn
                              </Action>
                            ) : (
                              t.table_status === 'NEEDS_CLEANING' && (
                                <button className="secondary-button" onClick={() => openTable(t)}>
                                  Chi tiết bàn
                                </button>
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
          <WorkQueue
            tables={tables}
            orders={orders}
            support={support}
            alerts={alerts}
            userId={userId}
            search={search}
            setSearch={setSearch}
            kind={taskFilter}
            setKind={setTaskFilter}
            view={queueView}
            setView={setQueueView}
            open={openTable}
          />
        </>
      )}
      {!kitchen && tab === 'orders' && (
        <div className="core-grid">
          <ServeSelection orders={visible} act={act} />
          {visible.length ? (
            visible.map((o) => <OrderCard key={o.id} o={o} kitchen={false} hideServe act={act} />)
          ) : (
            <Empty title={search ? 'Không tìm thấy lượt gọi phù hợp' : 'Chưa có lượt gọi'}>
              Thử tên bàn, tên món hoặc mã lượt gọi khác.
            </Empty>
          )}
        </div>
      )}
      {qrTable && (
        <Modal title={'QR bàn — ' + String(qrTable.name)} close={() => setQrTable(undefined)}>
          <StaffTableQr tableId={qrTable.id} initiallyExpanded />
        </Modal>
      )}
      {!kitchen && tab === 'receipts' && (
        <>
          <p>Tra cứu phiếu đã chốt theo ngày kết thúc bàn. Chọn phiếu để xem và in lại.</p>
          <ServerHistory
            kind="closed-bills"
            placeholder="Tìm số phiếu, mã bàn hoặc người kết thúc…"
            refreshKey={receiptReload}
            statuses={[
              { value: 'SETTLED', label: 'Đã thanh toán đủ' },
              { value: 'OUTSTANDING_WRITTEN_OFF', label: 'Có khoản đã miễn thu' },
            ]}
          >
            {(rows) => (
              <>
                {rows.map((s) => (
                  <article className="task-card" key={s.id}>
                    <div>
                      <strong>
                        {String(s.receipt_number ?? 'Phiên cũ')} - {String(s.table_code)}
                      </strong>
                      <p>
                        {restaurantDateTime(s.closed_at)} - {vnd(s.total_amount)}
                      </p>
                    </div>
                    <button className="secondary-button" onClick={() => setSelected(s.id)}>
                      Xem / in lại
                    </button>
                  </article>
                ))}
              </>
            )}
          </ServerHistory>
        </>
      )}
      {kitchen && (
        <div className="kanban">
          {[
            ['Chờ tiếp nhận', visible.filter((o) => o.status === 'SUBMITTED')],
            [
              'Bếp đang xử lý',
              visible.filter(
                (o) =>
                  o.status !== 'SUBMITTED' &&
                  o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
              ),
            ],
            [
              'Chờ mang ra',
              visible.filter(
                (o) =>
                  o.status !== 'SUBMITTED' &&
                  !o.items.some((i) => ['ACCEPTED', 'IN_PREPARATION'].includes(i.status)),
              ),
            ],
          ].map(([title, list], i) => (
            <section
              className={'kanban-column kanban-column-' + i}
              key={String(title)}
              hidden={lane !== 'all' && lane !== String(i)}
            >
              <h2>
                {String(title)} <span>{(list as Order[]).length}</span>
              </h2>
              {(list as Order[]).map((o) => (
                <OrderCard key={o.id} o={o} kitchen act={act} />
              ))}
              {!(list as Order[]).length && (
                <Empty
                  title={search ? 'Không có lượt gọi phù hợp' : 'Chưa có lượt gọi ở bước này'}
                  icon="chef"
                />
              )}
            </section>
          ))}
        </div>
      )}
      {cleaningTable &&
        (() => {
          const table = tables.find((t) => t.id === cleaningTable);
          return (
            <Modal
              title={'Dọn bàn - ' + String(table?.name ?? '')}
              close={() => setCleaningTable('')}
            >
              {table?.table_status === 'NEEDS_CLEANING' ? (
                <section className="cleaning-detail">
                  <span className="work-badge kind-clean">
                    <Icon name="check" size={16} />
                    Chờ dọn - Việc chung
                  </span>
                  <h3>Chuẩn bị bàn cho lượt khách tiếp theo</h3>
                  <ol>
                    <li>Thu dọn chén, đĩa và dụng cụ đã sử dụng.</li>
                    <li>Vệ sinh mặt bàn, ghế và khu vực xung quanh.</li>
                    <li>Sắp lại dụng cụ, kiểm tra bàn đã sẵn sàng.</li>
                  </ol>
                  <Action
                    confirm="Đã dọn và kiểm tra xong bàn này? Bàn sẽ sẵn sàng đón khách mới."
                    confirmLabel="Đã dọn xong"
                    run={async () => {
                      await act('/core/tables/' + cleaningTable + '/clean');
                      setNotice(String(table.name) + ' đã sẵn sàng đón khách mới.');
                      setCleaningTable('');
                    }}
                  >
                    Đã dọn xong
                  </Action>
                </section>
              ) : (
                <p role="status">
                  Bàn đã được đồng nghiệp xử lý. Trạng thái mới nhất: {label(table?.table_status)}.
                </p>
              )}
            </Modal>
          );
        })()}
      {accessTable && (
        <Modal
          title={'Cấp mã - ' + String(tables.find((t) => t.id === accessTable)?.name ?? 'Bàn')}
          close={() => setAccessTable('')}
        >
          <SupportActions
            rows={support.filter((s) => s.table_id === accessTable)}
            userId={userId}
            act={act}
            refresh={refresh}
            flat
            onOpen={openRequest}
          />
          {!support.some((s) => s.table_id === accessTable) && (
            <p role="status">
              Yêu cầu đã hoàn tất hoặc được thay thế. Đóng cửa sổ để xem danh sách mới.
            </p>
          )}
        </Modal>
      )}
      {selected && (
        <Modal
          title={'Chi tiết - ' + String(current?.name ?? 'Phiếu thanh toán')}
          wide
          headingContent={
            tableNotice ? (
              <p className="table-header-notice" role="status">
                {tableNotice}
              </p>
            ) : (
              current &&
              tableWork(current, orders, support, alerts)[0] && (
                <button
                  className={
                    'latest-table-job task-' + tableWork(current, orders, support, alerts)[0]!.kind
                  }
                  onClick={() => setDetailTab(tableWork(current, orders, support, alerts)[0]!.tab)}
                >
                  <small>Việc cần ưu tiên tại bàn</small>
                  {tableWork(current, orders, support, alerts)[0]!.title}
                  {tableWork(current, orders, support, alerts)[0]!.request && (
                    <small>
                      {requestOwner(
                        tableWork(current, orders, support, alerts)[0]!.request!,
                        userId,
                      )}
                    </small>
                  )}
                </button>
              )
            )
          }
          close={() => setSelected('')}
        >
          {current && (
            <>
              <p className="small-note">
                <SessionReference id={current.session_id} separator={false} />
              </p>
              <div className="core-actions">
                <button className="primary-button" onClick={() => setOrdering(selected)}>
                  <Icon name="menu" /> Gọi món cho bàn
                </button>
              </div>
              <nav className="table-detail-tabs" aria-label="Chức năng tại bàn">
                {[
                  ['tasks', 'Việc tại bàn'],
                  ['payments', 'Thu tiền & phiếu'],
                  ['orders', 'Món đã gọi'],
                  ['more', 'Thêm thao tác'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={detailTab === key}
                    onClick={() => setDetailTab(key!)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {detailTab === 'tasks' && (
                <>
                  <TableTasks
                    showEmpty={
                      !support.some((s) => s.session_id === selected) &&
                      !alerts.some((a) => a.session_id === selected && !a.requires_admin)
                    }
                    jobs={tableWork(current, orders, support, alerts).filter(
                      (j) => !j.request && !j.alert,
                    )}
                    userId={userId}
                    open={setDetailTab}
                  />
                  <div className="table-code-card">
                    <StaffTableQr key={current.id} tableId={current.id} />
                    <StaffTableCode key={selected} tableId={current.id} done={refresh} />
                  </div>
                  {(support.some((s) => s.session_id === selected) ||
                    alerts.some((a) => a.session_id === selected && !a.requires_admin)) && (
                    <div className="table-detail-alerts">
                      {support.some((s) => s.session_id === selected) && (
                        <SupportActions
                          rows={support.filter((s) => s.session_id === selected)}
                          userId={userId}
                          act={act}
                          refresh={refresh}
                          flat
                          onOpen={openRequest}
                        />
                      )}{' '}
                      {alerts.some((a) => a.session_id === selected && !a.requires_admin) && (
                        <AlertActions
                          rows={alerts.filter(
                            (a) => a.session_id === selected && !a.requires_admin,
                          )}
                          act={act}
                          openRefund={() => {
                            setDetailTab('payments');
                            setRefundFocus(true);
                          }}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
              {detailTab === 'orders' && (
                <section className="table-orders">
                  <ServeSelection orders={selectedOrders} act={act} />
                  <h3>Trạng thái các lượt gọi của bàn</h3>
                  {selectedOrders.map((o) => (
                    <OrderCard key={o.id} o={o} kitchen={false} hideServe act={act} />
                  ))}
                </section>
              )}
              {detailTab === 'more' && (
                <>
                  <TableTransferPanel
                    table={current}
                    tables={tables}
                    refresh={async () => {
                      setTables(await api<Row[]>('/core/tables'));
                      await refresh();
                    }}
                    done={async (message) => {
                      setNotice(message);
                      setTables(await api<Row[]>('/core/tables'));
                      await refresh();
                    }}
                  />
                </>
              )}
            </>
          )}
          {(!current || detailTab === 'payments') && (
            <BillPanel
              key={selected + ':' + current?.id}
              id={selected}
              onNotice={setTableNotice}
              products={products}
              userId={userId}
              openTab={setDetailTab}
              focusRefund={refundFocus}
              requests={support.filter(
                (s) => s.session_id === selected && s.request_type === 'BILL',
              )}
              preferredRequestId={paymentRequest}
              openRequest={openRequest}
              onClose={() => setSelected('')}
              done={refresh}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
