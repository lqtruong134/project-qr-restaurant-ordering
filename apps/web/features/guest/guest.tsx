'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, ApiError, EntryForm, label, vnd, type Product } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { Cart, PaymentForm, type GuestState } from './guest-panels';

export default function Guest() {
  const [state, setState] = useState<GuestState>(),
    [error, setError] = useState(''),
    [token, setToken] = useState('');
  const [view, setView] = useState('menu'),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('Tất cả');
  const [selected, setSelected] = useState<Product>(),
    [joining, setJoining] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setState(await api<GuestState>('/guest/state', undefined, 'GET', true));
      setError('');
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status)) setState(undefined);
      setError(e instanceof Error ? e.message : 'Chưa kết nối được nhà hàng.');
    }
  }, []);
  useEffect(() => {
    const qr = window.location.hash.slice(1);
    setToken(qr);
    // A new QR must be joined explicitly; never silently show a previous table's session.
    setJoining(Boolean(qr));
    if (!qr) void refresh();
  }, [refresh]);
  useEffect(() => {
    if (joining) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [joining, refresh]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    await api(path, body, method, true);
    await refresh();
  }
  const categories = [
    'Tất cả',
    ...new Set(state?.products.map((p) => String(p.category_name ?? 'Món ngon')) ?? []),
  ];
  const products =
    state?.products.filter(
      (p) => (category === 'Tất cả' || p.category_name === category) && matches(p.name, search),
    ) ?? [];
  const count = state?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const total =
    state?.items.reduce((sum, i) => sum + BigInt(i.unit_price_preview) * BigInt(i.quantity), 0n) ??
    0n;
  return (
    <main className="guest-app">
      <header className="guest-header">
        <a className="brand-lockup" href="/">
          <span className="brand-symbol">
            <Icon name="leaf" />
          </span>
          <div>
            <strong>QUYẾT TRƯỜNG</strong>
            <small>Vietnamese Bistro</small>
          </div>
        </a>
        {state && !joining && (
          <span className="guest-table">
            <Icon name="table" size={16} />
            {String(state.session.table_name)} · {state.participant.displayName}
          </span>
        )}
      </header>
      {!state || joining ? (
        <section className="guest-welcome">
          <p className="eyebrow">MỘT BỮA NGON, MỘT NIỀM VUI</p>
          <h1>Mời bạn vào bàn.</h1>
          <p>Nhập tên để cả bàn dễ nhận ra những món bạn chọn. Không cần tạo tài khoản.</p>
          {token ? (
            <EntryForm
              title="Tham gia bàn"
              fields={[{ key: 'name', label: 'Tên của bạn' }]}
              submit="Xem thực đơn"
              onSubmit={async (v) => {
                await api('/guest/join', { token, name: v.name }, 'POST', true);
                setJoining(false);
                setToken('');
                window.history.replaceState(null, '', '/guest');
                await refresh();
              }}
            />
          ) : (
            <Empty title="Quét QR tại bàn để bắt đầu" icon="table">
              Nếu phiên đã kết thúc, hãy quét lại mã QR hoặc liên hệ nhân viên.
            </Empty>
          )}
          {error && !token && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </section>
      ) : (
        <>
          {error && (
            <p role="alert" className="form-error">
              {error} Vui lòng thử lại hoặc gọi nhân viên.
            </p>
          )}
          {view === 'menu' && (
            <>
              <section className="guest-hero">
                <div>
                  <p className="eyebrow">BẾP VIỆT · NGUYÊN LIỆU TƯƠI · VỊ THÂN QUEN</p>
                  <h1>Hôm nay bạn muốn dùng gì?</h1>
                  <p>
                    Một chút món quen, một chút khám phá. Chọn món ngon và chia sẻ cùng những người
                    bên cạnh.
                  </p>
                </div>
                <div className="hero-plate">
                  <img src="/menu/rice.svg" alt="Minh họa món Việt" />
                </div>
              </section>
              <div className="menu-layout">
                <section aria-label="Thực đơn">
                  <div className="section-heading">
                    <div>
                      <h2>Thực đơn tại bàn</h2>
                      <p>{state.products.length} lựa chọn từ căn bếp của chúng tôi</p>
                    </div>
                  </div>
                  <Search
                    value={search}
                    onChange={setSearch}
                    placeholder="Tìm món bạn yêu thích…"
                  />
                  <div className="filter-chips" aria-label="Danh mục món">
                    {categories.map((c) => (
                      <button
                        key={c}
                        className={c === category ? 'active' : ''}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {!products.length && (
                    <Empty title="Chưa tìm thấy món phù hợp">
                      Thử tên món khác hoặc chọn tất cả danh mục.
                    </Empty>
                  )}
                  <div className="menu-grid">
                    {products.map((p) => (
                      <article
                        className={
                          'dish-card' +
                          (p.availability_status !== 'AVAILABLE' ? ' dish-unavailable' : '')
                        }
                        key={p.id}
                      >
                        <div className="dish-visual">
                          <img
                            src={String(p.image_url || '/menu/rice.svg')}
                            alt={'Minh họa ' + p.name}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = '/menu/rice.svg';
                            }}
                          />
                          <span className="dish-category">{String(p.category_name)}</span>
                        </div>
                        <div className="dish-content">
                          <h3>{p.name}</h3>
                          <p>{String(p.description ?? 'Được chuẩn bị tươi ngon tại bếp.')}</p>
                          <div className="dish-bottom">
                            <strong>{vnd(p.base_price)}</strong>
                            {p.availability_status === 'AVAILABLE' ? (
                              <button aria-label={'Chọn ' + p.name} onClick={() => setSelected(p)}>
                                <Icon name="plus" size={18} />
                              </button>
                            ) : (
                              <small>Tạm hết món</small>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <p className="menu-footnote">
                    Hình minh họa. Nếu có dị ứng thực phẩm, vui lòng trao đổi với nhân viên trước
                    khi gọi món.
                  </p>
                </section>
                <aside className="cart-sidebar">
                  <Cart state={state} mutate={mutate} done={refresh} />
                </aside>
              </div>
            </>
          )}
          {view === 'orders' && (
            <section className="guest-content">
              <p className="eyebrow">TỪ BẾP ĐẾN BÀN</p>
              <h1>Món đã gửi</h1>
              {!state.orders.length && (
                <Empty title="Bữa ăn của bạn bắt đầu từ đây" icon="chef">
                  Chọn món trong thực đơn, sau đó gửi từ giỏ món.
                </Empty>
              )}
              {[...new Set(state.orders.map((o) => o.id))].map((id) => {
                const lines = state.orders.filter((o) => o.id === id),
                  order = lines[0]!;
                return (
                  <article className="core-card guest-order-group" key={id}>
                    <div className="section-heading">
                      <h3>Lượt gọi #{id.slice(0, 6).toUpperCase()}</h3>
                      <span className="status-pill" data-status={String(order.status)}>
                        {label(order.status)}
                      </span>
                    </div>
                    <div className="order-meta">
                      <Icon name="clock" size={14} />
                      {new Date(String(order.created_at)).toLocaleString('vi-VN')}
                    </div>
                    {lines.map((i) => (
                      <div className="core-line" key={String(i.item_id)}>
                        <strong>
                          {String(i.quantity)} × {String(i.product_name_snapshot)}
                        </strong>
                        <span className="status-pill" data-status={String(i.item_status)}>
                          {label(i.item_status)}
                        </span>
                        {i.item_reason && (
                          <small className="form-error">{String(i.item_reason)}</small>
                        )}
                      </div>
                    ))}
                    <p className="core-line">
                      Tổng lượt gọi <strong>{vnd(order.total_amount)}</strong>
                    </p>
                    {order.created_by_participant_id === state.participant.id &&
                      ['SUBMITTED', 'PENDING_REVIEW'].includes(String(order.status)) && (
                        <Action
                          confirm="Hủy toàn bộ món trong lượt gọi này?"
                          run={() =>
                            mutate('/guest/orders/' + id + '/cancel', {
                              reason: 'Khách yêu cầu hủy lượt trước khi bếp tiếp nhận',
                            })
                          }
                        >
                          Hủy lượt gọi này
                        </Action>
                      )}
                  </article>
                );
              })}
            </section>
          )}
          {view === 'payment' && (
            <section className="guest-content">
              <p className="eyebrow">THOẢI MÁI CHIA SẺ BỮA ĂN</p>
              <h1>Thanh toán tại bàn</h1>
              <div className="core-card">
                <div className="core-stats">
                  <p>
                    Tiền món<strong>{vnd(state.account?.charge_total)}</strong>
                  </p>
                  <p>
                    Đã thanh toán<strong>{vnd(state.account?.paid_total)}</strong>
                  </p>
                  <p>
                    Còn phải trả<strong>{vnd(state.account?.outstanding_amount)}</strong>
                  </p>
                  <p>
                    Chờ xác nhận<strong>{vnd(state.account?.reserved_payment_amount)}</strong>
                  </p>
                </div>
                {BigInt(String(state.account?.refund_due_amount ?? 0)) > 0n && (
                  <p className="attention-banner">
                    Nhân viên cần hoàn lại {vnd(state.account.refund_due_amount)} cho bàn.
                  </p>
                )}
                <p>
                  Bạn có thể thanh toán toàn bộ hoặc chia thành nhiều lần. Nhân viên sẽ kiểm tra và
                  xác nhận sau khi nhận tiền.
                </p>
                <PaymentForm
                  done={refresh}
                  available={(
                    BigInt(String(state.account?.outstanding_amount ?? 0)) -
                    BigInt(String(state.account?.reserved_payment_amount ?? 0))
                  ).toString()}
                />
              </div>
            </section>
          )}
          {view === 'cart' && (
            <section className="guest-content">
              <p className="eyebrow">MÓN BẠN ĐANG CHỌN</p>
              <h1>Giỏ món</h1>
              <div className="core-card">
                <Cart state={state} mutate={mutate} done={refresh} />
              </div>
            </section>
          )}
          {view === 'support' && (
            <section className="guest-content">
              <p className="eyebrow">CHÚNG TÔI LUÔN SẴN SÀNG</p>
              <h1>Bạn cần hỗ trợ gì?</h1>
              <div className="core-card">
                <EntryForm
                  title="Gọi nhân viên hỗ trợ"
                  fields={[
                    {
                      key: 'type',
                      label: 'Bạn cần gì?',
                      options: ['ASSISTANCE', 'WATER', 'UTENSILS', 'BILL', 'OTHER'].map(
                        (value) => ({ value, label: label(value) }),
                      ),
                    },
                    { key: 'content', label: 'Nội dung thêm', optional: true },
                  ]}
                  submit="Gửi hỗ trợ"
                  onSubmit={(v) => mutate('/guest/support', v)}
                />
                {state.support?.map((s) => (
                  <div className="core-line" key={s.id}>
                    <span>{label(s.request_type)}</span>
                    <span className="status-pill" data-status={s.status}>
                      {label(s.status)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {view === 'menu' && count > 0 && (
            <button className="mobile-cart-button" onClick={() => setView('cart')}>
              <Icon name="bag" size={18} />
              {count} món · {vnd(total)}
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
                onClick={() => setView(key!)}
              >
                <Icon name={icon!} />
                {title}
                {key === 'cart' && count > 0 && <span className="nav-count">{count}</span>}
              </button>
            ))}
          </nav>
          {selected && (
            <Modal title="Thêm món vào giỏ" close={() => setSelected(undefined)}>
              <div className="add-dish-preview">
                <img src={String(selected.image_url || '/menu/rice.svg')} alt="" />
                <div>
                  <h3>{selected.name}</h3>
                  <p>{vnd(selected.base_price)}</p>
                </div>
              </div>
              <EntryForm
                title="Chọn món"
                fields={[
                  { key: 'quantity', label: 'Số lượng', type: 'number', value: 1, min: 1, max: 20 },
                  { key: 'note', label: 'Ghi chú cho bếp', optional: true },
                ]}
                submit="Thêm vào giỏ"
                onSubmit={async (v) => {
                  await mutate('/guest/cart', {
                    productId: selected.id,
                    quantity: Number(v.quantity),
                    note: v.note,
                    cartVersion: state.cart.cart_version,
                  });
                  setSelected(undefined);
                  setView('cart');
                }}
              />
            </Modal>
          )}
        </>
      )}
    </main>
  );
}
