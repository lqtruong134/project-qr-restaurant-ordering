'use client';
import { useRef, useState } from 'react';
import { api, label, vnd, type Order, type Product, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { ComboContents } from '../shared/combo-contents';
type Line = {
  key: string;
  productId: string;
  quantity: number;
  note: string;
  name: string;
  price: string;
  version: number;
  components: unknown;
  kind: 'DISH' | 'COMBO';
};
export function AssistedOrder({
  sessionId,
  table,
  products,
  categories,
  orders,
  back,
  done,
}: {
  sessionId: string;
  table: Row | undefined;
  products: Product[];
  categories: Row[];
  orders: Order[];
  back: () => void;
  done: () => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>([]),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [view, setView] = useState('menu'),
    [review, setReview] = useState(false),
    [leaving, setLeaving] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const requestId = useRef<string | null>(null),
    uncertain = useRef(false);
  const total = lines.reduce((sum, l) => sum + BigInt(l.price) * BigInt(l.quantity), 0n);
  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const current = orders.filter((o) => o.session_id === sessionId);
  const alive = table?.session_id === sessionId;
  function change(next: Line[]) {
    if (uncertain.current) {
      setError(
        'Lượt gửi chưa được xác nhận. Bấm thử lại với danh sách giữ nguyên để tránh gửi trùng.',
      );
      return;
    }
    setLines(next);
    requestId.current = null;
    setMessage('');
    setError('');
  }
  const invalid = lines.some((l) => {
    const p = products.find((p) => p.id === l.productId);
    return (
      !p?.is_active ||
      p.availability_status !== 'AVAILABLE' ||
      p.base_price !== l.price ||
      (p.product_kind === 'COMBO' && p.version !== l.version)
    );
  });
  async function send() {
    if (busy || !lines.length || !alive) return;
    setBusy(true);
    setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      await api('/core/sessions/' + sessionId + '/orders', {
        requestId: requestId.current,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          note: l.note,
          productVersion: l.version,
        })),
      });
      uncertain.current = false;
      requestId.current = null;
      setLines([]);
      setReview(false);
      setMessage('Đã gửi lượt gọi đến bếp. Xem Món đã gửi để theo dõi.');
    } catch (e) {
      // HTTP rejections roll back; a lost response may have committed. Retry that same request ID.
      uncertain.current = !(e instanceof Error && 'status' in e);
      setError((e as Error).message);
    } finally {
      try {
        await done();
      } catch {
        setError(
          (previous) =>
            previous ||
            'Chưa làm mới được trạng thái bàn. Kiểm tra kết nối rồi mở lại chi tiết bàn.',
        );
      }
      setBusy(false);
    }
  }
  const list = (
    <div className="assisted-cart-lines">
      {lines.map((l) => (
        <article key={l.key}>
          <div>
            <strong>{l.name}</strong>
            <ComboContents components={l.components} />
            <small>
              {vnd(l.price)} / {l.kind === 'COMBO' ? 'combo' : 'phần'}
            </small>
          </div>
          <div className="assisted-quantity">
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={'Giảm số lượng ' + l.name}
              onClick={() =>
                change(
                  lines.map((x) =>
                    x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x,
                  ),
                )
              }
            >
              −
            </button>
            <span aria-label={'Số lượng ' + l.name}>{l.quantity}</span>
            <button
              type="button"
              className="icon-button"
              disabled={busy || l.quantity >= 99}
              aria-label={'Tăng số lượng ' + l.name}
              onClick={() =>
                change(lines.map((x) => (x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x)))
              }
            >
              +
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => change(lines.filter((x) => x.key !== l.key))}
              aria-label={'Bỏ ' + l.name}
            >
              Bỏ
            </button>
          </div>
          <label>
            Ghi chú cho bếp
            <input
              value={l.note}
              maxLength={300}
              disabled={busy}
              placeholder="Ví dụ: ít cay, không hành"
              onChange={(e) =>
                change(lines.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))
              }
            />
          </label>
          <strong>{vnd(BigInt(l.price) * BigInt(l.quantity))}</strong>
        </article>
      ))}
    </div>
  );
  return (
    <section className="assisted-order" aria-label="Gọi món cho bàn">
      <header>
        <div>
          <button className="text-link" onClick={() => (lines.length ? setLeaving(true) : back())}>
            <Icon name="arrow" /> Trở về chi tiết bàn
          </button>
          <h2>Gọi món - {String(table?.name ?? 'Bàn đã kết thúc')}</h2>
          <p>Chọn món, cho khách kiểm tra rồi gửi đến bếp.</p>
        </div>
        <span className="status-pill">Nhân viên gọi hộ</span>
      </header>
      {!alive && (
        <p role="alert" className="form-error">
          Phiên bàn đã kết thúc hoặc chuyển bàn. Trở về sơ đồ bàn để kiểm tra trước khi gọi món.
        </p>
      )}
      <nav className="queue-views" aria-label="Gọi hộ và trạng thái món">
        <button aria-pressed={view === 'menu'} onClick={() => setView('menu')}>
          Thực đơn & giỏ món
        </button>
        <button aria-pressed={view === 'sent'} onClick={() => setView('sent')}>
          Món đã gửi - {current.length} lượt
        </button>
      </nav>
      {message && (
        <p role="status" className="policy-inline">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {view === 'sent' ? (
        <section className="assisted-sent">
          {!current.length ? (
            <Empty title="Bàn chưa có món đã gửi" />
          ) : (
            current.map((o) => (
              <article className="core-card" key={o.id}>
                <span className="status-pill">{label(o.status)}</span>
                {o.items.map((i) => (
                  <p key={i.id}>
                    <strong>
                      {i.quantity} × {i.product_name_snapshot}
                    </strong>
                    <ComboContents components={i.combo_components_snapshot} />
                    <span>{label(i.status)}</span>
                    {i.note && <small>Ghi chú: {String(i.note)}</small>}
                  </p>
                ))}
              </article>
            ))
          )}
        </section>
      ) : (
        <div className="assisted-layout">
          <section className="assisted-menu">
            <Search value={search} onChange={setSearch} placeholder="Tìm tên món…" />
            <label>
              Nhóm món
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">Tất cả nhóm món</option>
                {categories
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {String(c.name)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="assisted-products">
              {products
                .filter(
                  (p) =>
                    p.is_active &&
                    (category === 'all' || p.category_id === category) &&
                    matches(p.name, search),
                )
                .map((p) => (
                  <article className="core-card" key={p.id}>
                    {p.product_kind === 'COMBO' && <span className="combo-badge">Combo</span>}
                    <h3>{p.name}</h3>
                    <ComboContents components={p.components} />
                    {p.description && <p>{String(p.description)}</p>}
                    <strong>{vnd(p.base_price)}</strong>
                    <button
                      className="secondary-button"
                      disabled={
                        busy ||
                        !alive ||
                        p.availability_status !== 'AVAILABLE' ||
                        lines.length >= 50
                      }
                      onClick={() => {
                        const existing = lines.find(
                          (l) =>
                            l.productId === p.id &&
                            !l.note &&
                            l.price === p.base_price &&
                            l.version === p.version,
                        );
                        change(
                          existing
                            ? lines.map((l) =>
                                l.key === existing.key
                                  ? { ...l, quantity: Math.min(99, l.quantity + 1) }
                                  : l,
                              )
                            : [
                                ...lines,
                                {
                                  key: crypto.randomUUID(),
                                  productId: p.id,
                                  quantity: 1,
                                  note: '',
                                  name: p.name,
                                  price: p.base_price,
                                  version: p.version,
                                  components: p.components,
                                  kind: p.product_kind ?? 'DISH',
                                },
                              ],
                        );
                      }}
                    >
                      {p.availability_status === 'AVAILABLE' ? 'Thêm món' : 'Tạm hết món'}
                    </button>
                  </article>
                ))}
            </div>
          </section>
          <aside className="assisted-cart core-card" aria-label="Giỏ món nhân viên gọi hộ">
            <h3>Giỏ món - {count} phần</h3>
            <p className="small-note">Chỉ gồm món bạn đang chọn; chưa gửi đến bếp.</p>
            {!lines.length ? <Empty title="Chọn món từ thực đơn" icon="menu" /> : list}
            <div className="assisted-cart-total">
              <span>Tạm tính lượt này</span>
              <strong>{vnd(total)}</strong>
            </div>
            {invalid && (
              <p className="form-error">
                Có món đổi giá, combo đổi thành phần hoặc món tạm hết. Bỏ mục đó rồi chọn lại trước
                khi gửi.
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || !alive || !lines.length || (invalid && !uncertain.current)}
              onClick={() => setReview(true)}
            >
              Cho khách kiểm tra & gửi món
            </button>
          </aside>
        </div>
      )}
      {leaving && (
        <Modal title="Rời màn hình gọi hộ?" close={() => setLeaving(false)}>
          <p>
            {uncertain.current
              ? 'Chưa nhận được kết quả gửi món. Thử lại lượt gửi hiện tại để kiểm tra trước khi rời màn hình, tránh gửi trùng.'
              : 'Giỏ món đang chọn chưa được gửi. Rời màn hình sẽ bỏ các món này khỏi giỏ gọi hộ.'}
          </p>
          <div className="core-actions">
            <button className="primary-button" onClick={() => setLeaving(false)}>
              Tiếp tục gọi món
            </button>
            <button className="secondary-button" disabled={uncertain.current} onClick={back}>
              Bỏ giỏ món & trở về bàn
            </button>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title={'Kiểm tra lượt gọi - ' + String(table?.name ?? '')}
          close={() => {
            if (!busy) setReview(false);
          }}
        >
          <p>Khách kiểm tra món, số lượng và ghi chú trước khi nhân viên gửi.</p>
          <div className="assisted-review">
            {lines.map((l) => (
              <article key={l.key}>
                <strong>
                  {l.quantity} × {l.name}
                </strong>
                <ComboContents components={l.components} />
                <span>{vnd(BigInt(l.price) * BigInt(l.quantity))}</span>
                {l.note && <p>Ghi chú: {l.note}</p>}
              </article>
            ))}
          </div>
          <p className="assisted-cart-total">
            <span>Tạm tính lượt này</span>
            <strong>{vnd(total)}</strong>
          </p>
          <p className="small-note">
            Sau khi gửi, món được chuyển đến bếp và tính vào hóa đơn của bàn. Bạn vẫn đăng nhập với
            vai trò nhân viên.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="core-actions">
            <button className="secondary-button" disabled={busy} onClick={() => setReview(false)}>
              Sửa giỏ món
            </button>
            <button
              className="primary-button"
              disabled={busy || !alive || (invalid && !uncertain.current)}
              onClick={() => void send()}
            >
              {busy ? 'Đang gửi…' : uncertain.current ? 'Thử lại lượt gửi này' : 'Gửi món đến bếp'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
