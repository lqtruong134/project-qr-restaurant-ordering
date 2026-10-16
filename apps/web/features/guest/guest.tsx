'use client';
import { PromotionSelection } from '../shared/promotion-selection';
import { payableItemAmount } from '../shared/billing-summary';
import { SessionReference } from '../shared/session-reference';
import { HistoryList } from '../shared/history-filters';
import { GuestRefundSummary } from './refund-summary';
import { GuestPaymentSummary } from './payment-summary';
import { GuestSupport } from './guest-support';
import { reasonLabel, restaurantPolicy } from '@thesis/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Action,
  api,
  ApiError,
  EntryForm,
  label,
  vnd,
  type Product,
  type Row,
} from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { notifyInfo, notifySuccess } from '../shared/operation-notice';
import { PaymentForm, type GuestState } from './guest-panels';
import { Cart, CartSummary, cartTotal } from './cart';
import { DishPicker } from './dish-picker';
import { guestPaymentStatus } from './payment-status';
import { SessionCode } from './session-code';
import { GuestBillLines } from './bill-lines';
import { GuestScope } from './scope';
import { GuestParticipants } from './participants';
import { PolicyDialog, PolicyNotice } from '../shared/policy-ui';
import { restaurantDateTime } from '../shared/restaurant-time';
import { GuestLiveNotice } from './live-notice';
import { advanceDishNotices, type DishNoticeFeed } from './dish-notices';
import { GuestWelcome } from './welcome';
import { MarketingCarousel } from '../shared/marketing-carousel';
import { menuSlides } from './menu-promotions';
import { MenuCard } from './menu-card';
import { OrderedComboContents } from './order-combo';
import '../../app/restaurant-notice.css';

export default function Guest() {
  const [state, setState] = useState<GuestState>(),
    [error, setError] = useState(''),
    [token, setToken] = useState('');
  const [qrInfo, setQrInfo] = useState<{ table_name: string; area_name: string }>();
  const [view, setView] = useState('menu'),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('Tất cả'),
    [orderScope, setOrderScope] = useState<'mine' | 'table'>('table'),
    [paymentScope, setPaymentScope] = useState<'mine' | 'table'>('table');
  const [selected, setSelected] = useState<Product>(),
    [cartSelection, setCartSelection] = useState<Record<string, boolean>>({}),
    [joining, setJoining] = useState(true),
    [loading, setLoading] = useState(true),
    [profile, setProfile] = useState(false),
    [showPolicy, setShowPolicy] = useState(false);
  const qrGeneration = useRef(0);
  const liveDishFeed = useRef<DishNoticeFeed | undefined>(undefined);
  const [dishFeed, setDishFeed] = useState<DishNoticeFeed>();
  const lastCartVersion = useRef(0);
  const lastTable = useRef<{ sessionId: string; tableId: string; version: number } | null>(null);
  const refresh = useCallback(async () => {
    const generation = qrGeneration.current;
    try {
      const next = await api<GuestState>('/guest/state', undefined, 'GET', true);
      if (generation !== qrGeneration.current) return;
      const previous = lastTable.current;
      if (
        previous?.sessionId === next.session.id &&
        (Number(next.session.version) < previous.version ||
          next.cart.cart_version < lastCartVersion.current)
      )
        return;
      if (previous?.sessionId === next.session.id && previous.tableId !== next.session.table_id)
        notifyInfo(
          'Bàn của bạn đã được chuyển sang ' +
            next.session.table_name +
            '. Giỏ, món và thanh toán được giữ nguyên.',
        );
      lastTable.current = {
        sessionId: next.session.id,
        tableId: String(next.session.table_id),
        version: Number(next.session.version),
      };
      lastCartVersion.current = next.cart.cart_version;
      liveDishFeed.current = advanceDishNotices(liveDishFeed.current, {
        sessionId: next.session.id,
        tableId: String(next.session.table_id),
        participantId: next.participant.id,
        orders: next.orders,
      });
      setDishFeed(liveDishFeed.current);
      setState(next);
      setError('');
    } catch (e) {
      if (generation !== qrGeneration.current) return;
      if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) {
        setState(undefined);
        liveDishFeed.current = undefined;
        setDishFeed(undefined);
      }
      if (e instanceof ApiError && e.status === 401) setJoining(true);
      setError(e instanceof Error ? e.message : 'Chưa kết nối được nhà hàng.');
    }
  }, []);
  useEffect(() => {
    const readQr = () => {
      const generation = ++qrGeneration.current;
      lastTable.current = null;
      lastCartVersion.current = 0;
      liveDishFeed.current = undefined;
      setDishFeed(undefined);
      setCartSelection({});
      const qr = window.location.hash.slice(1);
      setToken(qr);
      setQrInfo(undefined);
      setError('');
      setLoading(true);
      // A hash navigation may keep this page mounted. Each new QR is explicit,
      // and responses for an earlier QR must never restore the previous table.
      setJoining(Boolean(qr));
      if (!qr)
        void refresh().finally(() => {
          if (generation === qrGeneration.current) setLoading(false);
        });
      else {
        setState(undefined);
        setProfile(false);
        void api<{ table_name: string; area_name: string; already_joined: boolean }>(
          '/guest/qr-info',
          { token: qr },
          'POST',
          true,
        )
          .then(async (info) => {
            if (generation !== qrGeneration.current) return;
            setQrInfo(info);
            if (info.already_joined) {
              window.history.replaceState(null, '', '/guest');
              setToken('');
              setJoining(false);
              await refresh();
            }
          })
          .catch((e) => {
            if (generation === qrGeneration.current) setError(e.message);
          })
          .finally(() => {
            if (generation === qrGeneration.current) setLoading(false);
          });
      }
    };
    readQr();
    window.addEventListener('hashchange', readQr);
    return () => {
      ++qrGeneration.current;
      window.removeEventListener('hashchange', readQr);
    };
  }, [refresh]);
  useEffect(() => {
    if (joining) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
    };
  }, [joining, refresh]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    const result = await api<{ skipped?: unknown[]; cancelled?: unknown[] }>(
      path,
      body,
      method,
      true,
    );
    if (result?.skipped?.length)
      notifyInfo(
        'Đã hủy ' +
          (result.cancelled?.length ?? 0) +
          ' món; ' +
          result.skipped.length +
          ' món đã đổi trạng thái nên được giữ lại.',
      );
    else if (result?.cancelled)
      if (result.cancelled.length)
        notifySuccess(`Đã hủy ${result.cancelled.length} món còn chờ bếp.`);
      else notifyInfo('Không có món nào còn đủ điều kiện hủy.');
    await refresh();
  }
  function navigate(next: string) {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const scopedOrders =
    state?.orders.filter(
      (o) => orderScope === 'table' || o.owner_participant_id === state.participant.id,
    ) ?? [];
  const categories = [
    'Tất cả',
    'Combo',
    ...new Set(
      state?.products
        .filter((p) => p.product_kind !== 'COMBO')
        .map((p) => String(p.category_name ?? 'Khác'))
        .filter((name) => name !== 'Combo' && name !== 'Tất cả') ?? [],
    ),
  ];
  const products =
    state?.products.filter(
      (p) =>
        (category === 'Tất cả' ||
          (category === 'Combo'
            ? p.product_kind === 'COMBO'
            : p.product_kind !== 'COMBO' && String(p.category_name ?? 'Khác') === category)) &&
        matches([p.name, ...(p.components?.map((item) => item.name) ?? [])].join(' '), search),
    ) ?? [];
  const mine = state?.items.filter((i) => i.owner_participant_id === state.participant.id) ?? [];
  const count = mine.reduce((sum, i) => sum + i.quantity, 0);
  const total = cartTotal(mine);
  const comboProducts = products.filter((p) => p.product_kind === 'COMBO');
  const dishProducts = products.filter((p) => p.product_kind !== 'COMBO');
  return (
    <main className="guest-app guest-experience">
      <header className="guest-header">
        <a
          className="brand-lockup"
          href="/guest"
          aria-label="Quyết Trường: về thực đơn"
          onClick={(e) => {
            e.preventDefault();
            navigate('menu');
          }}
        >
          <span className="brand-symbol">
            <Icon name="table" />
          </span>
          <div>
            <strong>QUYẾT TRƯỜNG</strong>
            <small>MÓN VIỆT TẠI BÀN</small>
          </div>
        </a>
        <button
          className="icon-button policy-header-button"
          aria-label="Quy định & chính sách"
          title="Quy định & chính sách"
          onClick={() => setShowPolicy(true)}
        >
          <Icon name="info" />
        </button>
        {state && !joining && (
          <div className="guest-header-actions">
            <span className="guest-table">
              <Icon name="table" size={16} />
              <span>
                <strong>{String(state.session.table_name)}</strong>
                <small>
                  {String(state.session.area_name)}
                  <SessionReference id={state.session.id} />
                </small>
              </span>
            </span>
            {state.session.access_code && <SessionCode code={String(state.session.access_code)} />}
            <GuestParticipants
              members={
                state.participants ?? [
                  { id: state.participant.id, display_name: state.participant.displayName },
                ]
              }
              currentId={state.participant.id}
              tableName={String(state.session.table_name)}
              onEditProfile={() => setProfile(true)}
            />
          </div>
        )}
      </header>
      {showPolicy && <PolicyDialog close={() => setShowPolicy(false)} />}
      {!state || joining ? (
        <GuestWelcome
          token={token}
          table={qrInfo}
          loading={loading}
          error={error}
          showPolicy={() => setShowPolicy(true)}
          joined={async () => {
            setJoining(false);
            setToken('');
            window.history.replaceState(null, '', '/guest');
            await refresh();
          }}
        />
      ) : (
        <>
          <GuestLiveNotice
            key={[state.session.id, state.session.table_id, state.participant.id].join(':')}
            feed={dishFeed}
            orders={state.orders}
            openOrders={() => navigate('orders')}
          />
          {error && (
            <p role="alert" className="form-error">
              {error} Vui lòng thử lại hoặc gọi nhân viên.
            </p>
          )}
          {profile && (
            <Modal title="Tên của bạn và rời bàn" close={() => setProfile(false)}>
              <p className="field-hint">
                Chọn tên khác với người cùng bàn để dễ nhận ra món của bạn. Đổi tên không làm thay
                đổi các món đã chọn hoặc đã gọi.
              </p>
              <EntryForm
                title="Đổi tên hiển thị"
                submit="Cập nhật tên"
                successMessage="Đã cập nhật tên của bạn."
                fields={[
                  { key: 'name', label: 'Tên của bạn', value: state.participant.displayName },
                ]}
                onSubmit={(v) => mutate('/guest/profile', v, 'PATCH')}
              />
              <Action
                confirmTitle="Rời bàn trên thiết bị này?"
                confirmLabel="Xác nhận rời bàn"
                successMessage="Bạn đã rời bàn trên thiết bị này."
                confirm={restaurantPolicy.notices.leave}
                run={async () => {
                  await api('/guest/leave', {}, 'POST', true);
                  setState(undefined);
                  liveDishFeed.current = undefined;
                  setDishFeed(undefined);
                  setJoining(true);
                  setProfile(false);
                }}
              >
                Rời bàn
              </Action>
            </Modal>
          )}
          {view === 'menu' && (
            <>
              <div className="guest-menu-intro">
                <div>
                  <p className="eyebrow">THỰC ĐƠN QUYẾT TRƯỜNG</p>
                  <h1>Hôm nay bạn muốn dùng món gì?</h1>
                </div>
                <p>
                  Chọn món, xem lại giỏ rồi gửi bếp.
                  <small className="menu-vat-note">Giá thực đơn đã gồm VAT.</small>
                </p>
              </div>
              {(state.discountPrograms ?? []).length > 0 && (
                <button className="guest-discount-discovery" onClick={() => navigate('payment')}>
                  <span>
                    <Icon name="receipt" size={20} />
                    <span>
                      <strong>Ưu đãi của bàn</strong>
                      <small>
                        {state.billing?.promotion && BigInt(state.billing.discountAmount) > 0n
                          ? `${state.billing.promotion.name} · Đang giảm ${vnd(state.billing.discountAmount)}`
                          : `${state.discountPrograms!.length} chương trình · Xem điều kiện và áp dụng mã trước khi thanh toán`}
                      </small>
                    </span>
                  </span>
                  <Icon name="arrow" size={20} />
                </button>
              )}
              <div className="menu-layout">
                <section className="guest-menu-column" aria-label="Thực đơn">
                  <MarketingCarousel
                    slides={menuSlides(state.products, state.promotions)}
                    className="guest-menu-promotions"
                    onSelect={(id) => {
                      const product = state.products.find(
                        (p) => p.id === id && p.availability_status === 'AVAILABLE',
                      );
                      if (product) setSelected(product);
                    }}
                  />
                  <div className="section-heading">
                    <div>
                      <h2>Thực đơn tại bàn</h2>
                      <p>
                        {products.length} lựa chọn
                        {category !== 'Tất cả' ? ' - ' + category : ' trong thực đơn'}
                      </p>
                    </div>
                  </div>
                  <Search
                    value={search}
                    onChange={setSearch}
                    placeholder="Tìm món bạn yêu thích…"
                  />
                  <div className="filter-chips" role="group" aria-label="Danh mục món">
                    {categories.map((c) => (
                      <button
                        key={c}
                        className={c === category ? 'active' : ''}
                        title={c}
                        aria-pressed={c === category}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {!products.length && (
                    <Empty
                      title={
                        state.products.length
                          ? 'Không tìm thấy món phù hợp'
                          : 'Thực đơn đang được cập nhật'
                      }
                    >
                      {state.products.length
                        ? 'Thử tên món khác hoặc xem tất cả danh mục.'
                        : 'Vui lòng nhờ nhân viên giới thiệu món hiện có.'}
                      {(search || category !== 'Tất cả') && (
                        <button
                          type="button"
                          className="secondary-button menu-filter-reset"
                          onClick={() => {
                            setSearch('');
                            setCategory('Tất cả');
                          }}
                        >
                          Xem tất cả món
                        </button>
                      )}
                    </Empty>
                  )}
                  {comboProducts.length > 0 && (
                    <section className="guest-combo-section" aria-label="Combo gợi ý">
                      <div className="guest-menu-group-heading">
                        <div>
                          <span className="eyebrow">CHỌN NHANH MỘT BỮA NGON</span>
                          <h3>Combo gợi ý</h3>
                        </div>
                        <p>Xem các món đi kèm và giá trọn combo.</p>
                      </div>
                      <div className="menu-grid combo-grid">
                        {comboProducts.map((p) => (
                          <MenuCard key={p.id} product={p} select={setSelected} />
                        ))}
                      </div>
                    </section>
                  )}
                  {dishProducts.length > 0 && (
                    <section className="guest-dish-section" aria-label="Món lẻ">
                      {comboProducts.length > 0 && (
                        <div className="guest-menu-group-heading">
                          <h3>Món lẻ</h3>
                          <p>Chọn thêm theo khẩu vị của bạn.</p>
                        </div>
                      )}
                      <div className="menu-grid">
                        {dishProducts.map((p) => (
                          <MenuCard key={p.id} product={p} select={setSelected} />
                        ))}
                      </div>
                    </section>
                  )}
                  <p className="menu-footnote">
                    Nếu bạn có dị ứng hoặc cần thay đổi nguyên liệu, vui lòng trao đổi với nhân viên
                    trước khi gọi món.
                  </p>
                </section>
                <aside className="cart-sidebar">
                  <CartSummary state={state} open={() => navigate('cart')} />
                </aside>
              </div>
            </>
          )}
          {view === 'orders' && (
            <section className="guest-content">
              <p className="eyebrow">TỪ BẾP ĐẾN BÀN</p>
              <h1>Món đã gọi</h1>
              <GuestScope value={orderScope} change={setOrderScope} />
              {!scopedOrders.length && (
                <Empty
                  title={orderScope === 'mine' ? 'Bạn chưa gửi món nào' : 'Bàn chưa gửi món nào'}
                  icon="chef"
                >
                  Chọn món trong thực đơn, sau đó gửi từ giỏ món.
                </Empty>
              )}
              {scopedOrders.length > 0 && (
                <HistoryList
                  showTimeFilter={false}
                  items={[...new Map(scopedOrders.map((o) => [o.id, o])).values()]}
                  date={(o) => o.created_at}
                  search={(o) =>
                    scopedOrders
                      .filter((i) => i.id === o.id)
                      .map((i) =>
                        [i.product_name_snapshot, i.note, i.owner_name, i.id.slice(0, 6)].join(' '),
                      )
                      .join(' ')
                  }
                  placeholder="Tìm món, người gọi hoặc ghi chú…"
                  empty="Không tìm thấy lượt gọi phù hợp"
                >
                  {(rows) => (
                    <>
                      {rows.map((orderRow) => {
                        const id = orderRow.id;
                        const lines = scopedOrders.filter((o) => o.id === id),
                          order = lines[0]!;
                        return (
                          <article className="core-card guest-order-group" key={id}>
                            <div className="section-heading">
                              <div>
                                <h3>Lượt gọi #{id.slice(0, 6).toUpperCase()}</h3>
                                <strong className="order-owner">
                                  {order.created_by_participant_id === state.participant.id
                                    ? 'Bạn gọi'
                                    : order.created_by_participant_id
                                      ? String(
                                          state.participants?.find(
                                            (p) => p.id === order.created_by_participant_id,
                                          )?.display_name ?? 'Khách cùng bàn',
                                        ) + ' gọi'
                                      : 'Nhân viên gọi cho bàn'}
                                </strong>
                              </div>
                              <span className="status-pill" data-status={String(order.status)}>
                                {label(order.status)}
                              </span>
                            </div>
                            <div className="order-meta">
                              <Icon name="clock" size={14} />
                              {restaurantDateTime(order.created_at)}
                            </div>
                            {lines.map((i) => (
                              <div className="core-line guest-order-item" key={String(i.item_id)}>
                                <strong>
                                  {String(i.quantity)} × {String(i.product_name_snapshot)}
                                </strong>
                                {i.product_kind_snapshot === 'COMBO' && (
                                  <OrderedComboContents value={i.combo_components_snapshot} />
                                )}
                                <span className="status-pill" data-status={String(i.item_status)}>
                                  {label(i.item_status)}
                                </span>
                                <small className="item-owner">
                                  {i.owner_participant_id === state.participant.id
                                    ? 'Món của bạn'
                                    : i.owner_participant_id
                                      ? 'Món của ' + String(i.owner_name ?? 'khách cùng bàn')
                                      : 'Món chung - Nhân viên gọi hộ'}
                                </small>
                                {i.note && <small>Ghi chú: {String(i.note)}</small>}
                                {i.owner_participant_id === state.participant.id &&
                                  i.item_status === 'SUBMITTED' && (
                                    <Action
                                      confirmTitle="Hủy món đang chờ bếp?"
                                      confirmLabel="Xác nhận hủy món"
                                      confirm={
                                        String(i.quantity) +
                                        ' × ' +
                                        i.product_name_snapshot +
                                        ' - ' +
                                        vnd(i.line_total) +
                                        '. ' +
                                        restaurantPolicy.notices.cancel
                                      }
                                      run={() =>
                                        mutate('/guest/items/cancel', {
                                          itemIds: [i.item_id],
                                          reasonCode: 'CUSTOMER_CHANGED_MIND',
                                        })
                                      }
                                    >
                                      Hủy món này
                                    </Action>
                                  )}
                                {i.awaiting_admin === true && (
                                  <small>
                                    Nhà hàng đang kiểm tra sự cố và số tiền cần trả. Nhân viên sẽ
                                    đến trao đổi với bạn.
                                  </small>
                                )}
                                {i.charge_status === 'REVERSED' && (
                                  <small>Không tính tiền món này.</small>
                                )}
                                {i.item_status === 'CANCELLED' &&
                                  i.charge_status === 'ACTIVE' &&
                                  i.awaiting_admin !== true && (
                                    <small>
                                      Món đã hủy sau khi bắt đầu chế biến - Vẫn tính tiền.
                                    </small>
                                  )}
                                {i.item_reason && (
                                  <small className="form-error">
                                    {i.cancel_reason_code === 'CUSTOMER_CHANGED_MIND'
                                      ? 'Món đã hủy theo yêu cầu.'
                                      : i.cancel_reason_code === 'OTHER'
                                        ? 'Nhà hàng chưa thể phục vụ món này. Nhân viên sẽ đến trao đổi với bạn.'
                                        : reasonLabel(i.cancel_reason_code) ||
                                          'Món đã được dừng. Nhân viên sẽ trao đổi với bạn.'}
                                  </small>
                                )}
                              </div>
                            ))}
                            <p className="core-line guest-order-total">
                              {orderScope === 'mine'
                                ? 'Tiền món của bạn trong lượt này'
                                : 'Tiền món trong lượt này'}{' '}
                              <strong>
                                {vnd(
                                  lines.reduce(
                                    (sum, i) =>
                                      sum +
                                      (i.charge_status === 'ACTIVE'
                                        ? BigInt(String(i.original_amount ?? i.line_total ?? 0))
                                        : 0n),
                                    0n,
                                  ),
                                )}
                              </strong>
                            </p>
                            {order.created_by_participant_id === state.participant.id &&
                              state.orders.some(
                                (i) => i.id === id && i.item_status === 'SUBMITTED',
                              ) && (
                                <Action
                                  confirmTitle="Hủy các món còn chờ?"
                                  confirmLabel="Xác nhận hủy"
                                  confirm={
                                    'Hủy ' +
                                    lines
                                      .filter((i) => i.item_status === 'SUBMITTED')
                                      .reduce((sum, i) => sum + Number(i.quantity), 0) +
                                    ' phần chưa được bếp tiếp nhận trong lượt này? ' +
                                    restaurantPolicy.notices.cancel
                                  }
                                  run={() =>
                                    mutate('/guest/orders/' + id + '/cancel', {
                                      reasonCode: 'CUSTOMER_CHANGED_MIND',
                                      note: 'Khách yêu cầu hủy lượt trước khi bếp tiếp nhận',
                                    })
                                  }
                                >
                                  Hủy các món còn chờ trong lượt
                                </Action>
                              )}
                          </article>
                        );
                      })}
                    </>
                  )}
                </HistoryList>
              )}
            </section>
          )}
          {view === 'payment' && (
            <section className="guest-content">
              <p className="eyebrow">THÔNG TIN THANH TOÁN</p>
              <h1>Thanh toán tại bàn</h1>
              <div className="core-card">
                <GuestPaymentSummary
                  account={state.account}
                  billing={state.billing}
                  payments={state.payments}
                  requests={state.support}
                />
                {state.session.session_status === 'ACTIVE' && (
                  <PromotionSelection
                    guest
                    sessionId={state.session.id}
                    billing={state.billing}
                    hasPayment={BigInt(String(state.account.paid_total ?? 0)) > 0n}
                    done={refresh}
                  />
                )}
                <GuestRefundSummary
                  account={state.account}
                  transactions={state.refundTransactions}
                />
                {BigInt(String(state.account?.outstanding_amount ?? 0)) > 0n && (
                  <p>
                    Bạn có thể thanh toán toàn bộ hoặc chia thành nhiều lần. Nhân viên sẽ kiểm tra
                    và xác nhận sau khi nhận tiền.
                  </p>
                )}
                <GuestScope value={paymentScope} change={setPaymentScope} />
                {paymentScope === 'mine' && (
                  <div className="own-bill-summary">
                    <span>Tiền món của bạn</span>
                    <strong>
                      {vnd(
                        state.orders
                          .filter(
                            (i) =>
                              i.owner_participant_id === state.participant.id &&
                              i.charge_status === 'ACTIVE',
                          )
                          .reduce((sum, i) => sum + payableItemAmount(i, state.billing), 0n),
                      )}
                    </strong>
                    <small>
                      Các số tiền phía trên là của cả bàn. Muốn trả riêng, hãy nhờ nhân viên kiểm
                      tra phần món của bạn.
                    </small>
                  </div>
                )}
                {state.orders.length > 0 && (
                  <GuestBillLines
                    items={state.orders.filter(
                      (i) =>
                        paymentScope === 'table' || i.owner_participant_id === state.participant.id,
                    )}
                    billing={state.billing}
                    mine={paymentScope === 'mine'}
                  />
                )}
                {BigInt(String(state.account?.outstanding_amount ?? 0)) > 0n && (
                  <PolicyNotice>{restaurantPolicy.notices.payment}</PolicyNotice>
                )}
                {(BigInt(String(state.account?.outstanding_amount ?? 0)) > 0n ||
                  (BigInt(String(state.account?.refunded_total ?? 0)) === 0n &&
                    BigInt(String(state.account?.refund_due_amount ?? 0)) === 0n)) && (
                  <PaymentForm
                    done={refresh}
                    available={String(state.account?.outstanding_amount ?? '0')}
                    requests={state.support}
                    paymentStatus={guestPaymentStatus(
                      state.account,
                      state.orders,
                      state.items.length,
                    )}
                  />
                )}
              </div>
            </section>
          )}
          {view === 'cart' && (
            <section className="guest-content">
              <h1>Giỏ món</h1>
              <Cart
                state={state}
                mutate={mutate}
                done={refresh}
                selection={cartSelection}
                select={setCartSelection}
                menu={() => navigate('menu')}
                submitted={(order) =>
                  notifySuccess(
                    order.status === 'PENDING_REVIEW'
                      ? 'Đã gửi món đã chọn. Nhân viên sẽ kiểm tra lượt gọi của bạn; các món chưa chọn vẫn ở trong giỏ.'
                      : 'Đã gửi món đã chọn đến bếp. Các món chưa chọn vẫn ở trong giỏ.',
                  )
                }
              />
            </section>
          )}
          {view === 'support' && (
            <section className="guest-content">
              <p className="eyebrow">HỖ TRỢ TẠI BÀN</p>
              <h1>Bạn cần hỗ trợ gì?</h1>
              <GuestSupport rows={state.support ?? []} done={refresh} />
            </section>
          )}
          {view === 'menu' && count > 0 && (
            <button
              className="mobile-cart-button"
              aria-label="Xem giỏ món của tôi"
              onClick={() => navigate('cart')}
            >
              <Icon name="bag" size={18} />
              <span>
                Giỏ của tôi · {count}{' '}
                {mine.every((item) => item.product_kind === 'COMBO') ? 'combo' : 'món'}
              </span>
              <strong>{vnd(total)}</strong>
              <Icon name="arrow" size={17} />
            </button>
          )}
          <nav className="guest-bottom-nav" aria-label="Điều hướng khách">
            {[
              ['menu', 'Thực đơn', 'menu'],
              ['orders', 'Món đã gọi', 'chef'],
              ['cart', 'Giỏ món', 'bag'],
              ['payment', 'Thanh toán', 'receipt'],
              ['support', 'Hỗ trợ', 'bell'],
            ].map(([key, title, icon]) => (
              <button
                key={key}
                className={view === key ? 'active' : ''}
                aria-current={view === key ? 'page' : undefined}
                onClick={() => navigate(key!)}
              >
                <Icon name={icon!} />
                {title}
                {key === 'cart' && count > 0 && <span className="nav-count">{count}</span>}
              </button>
            ))}
          </nav>
          {selected && (
            <Modal title="Chọn món" close={() => setSelected(undefined)}>
              <DishPicker
                product={selected}
                add={async (quantity, note, mode) => {
                  const item = await api<Row>(
                    '/guest/cart',
                    {
                      productId: selected.id,
                      quantity,
                      note,
                      cartVersion: state.cart.cart_version,
                    },
                    'POST',
                    true,
                  );
                  if (mode === 'now')
                    setCartSelection({
                      ...Object.fromEntries(mine.map((i) => [i.id, false])),
                      [item.id]: true,
                    });
                  else setCartSelection((previous) => ({ ...previous, [item.id]: true }));
                  await refresh();
                  setSelected(undefined);
                  if (mode === 'now') navigate('cart');
                  else
                    notifySuccess(
                      'Đã thêm ' +
                        quantity +
                        ' × ' +
                        selected.name +
                        ' vào giỏ. Bạn có thể tiếp tục chọn món.',
                    );
                }}
              />
            </Modal>
          )}
        </>
      )}
    </main>
  );
}
