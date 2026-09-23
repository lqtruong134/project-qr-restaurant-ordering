'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, EntryForm, label, vnd, type Product, type Row } from './common';
type State = {
  participant: { id: string; displayName: string };
  session: Row;
  cart: { cart_version: number };
  items: (Row & {
    quantity: number;
    unit_price_preview: string;
    owner_participant_id: string;
    name: string;
  })[];
  products: Product[];
  orders: Row[];
  account: Row;
};
export default function Guest() {
  const [state, setState] = useState<State>(),
    [error, setError] = useState(''),
    [token, setToken] = useState('');
  const refresh = useCallback(async () => {
    try {
      setState(await api<State>('/guest/state', undefined, 'GET', true));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kết nối được máy chủ.');
    }
  }, []);
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    await api(path, body, method, true);
    await refresh();
  }
  return (
    <main className="core-guest">
      <header>
        <strong>AN NHIÊN · GỌI MÓN</strong>
        {state && (
          <span>
            {String(state.session.table_name)} · {state.participant.displayName}
          </span>
        )}
      </header>
      {!state ? (
        <>
          <h1>Chào mừng bạn</h1>
          <p>Quét mã QR trên bàn rồi nhập tên để gọi món cùng mọi người.</p>
          {token ? (
            <EntryForm
              title="Tham gia bàn"
              fields={[{ key: 'name', label: 'Tên của bạn' }]}
              submit="Xem thực đơn"
              onSubmit={async (v) => {
                await mutate('/guest/join', { token, name: v.name });
                window.history.replaceState(null, '', '/guest');
              }}
            />
          ) : (
            <p>Vui lòng quét lại mã QR tại bàn.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <h1>Hôm nay bạn muốn dùng gì?</h1>
          <section className="core-grid" aria-label="Thực đơn">
            {state.products.map((p) => (
              <article className="core-card" key={p.id}>
                <h2>{p.name}</h2>
                <p>{vnd(p.base_price)}</p>
                {p.availability_status === 'AVAILABLE' ? (
                  <EntryForm
                    title="Chọn món"
                    fields={[
                      {
                        key: 'quantity',
                        label: 'Số lượng',
                        type: 'number',
                        value: 1,
                        min: 1,
                        max: 20,
                      },
                      { key: 'note', label: 'Ghi chú cho bếp', optional: true },
                    ]}
                    submit="Thêm vào giỏ"
                    onSubmit={(v) =>
                      mutate('/guest/cart', {
                        productId: p.id,
                        quantity: Number(v.quantity),
                        note: v.note,
                        cartVersion: state.cart.cart_version,
                      })
                    }
                  />
                ) : (
                  <p>Tạm hết món</p>
                )}
              </article>
            ))}
          </section>
          <section className="core-card">
            <h2>Giỏ chung của bàn</h2>
            <p>Bạn chỉ gửi hoặc bỏ những dòng món do mình chọn.</p>
            {!state.items.length && <p>Giỏ chưa có món.</p>}
            {state.items.map((i) => (
              <div className="core-line" key={i.id}>
                <span>
                  {i.name} × {i.quantity} · {vnd(BigInt(i.unit_price_preview) * BigInt(i.quantity))}
                  {i.owner_participant_id !== state.participant.id ? ' · Người cùng bàn' : ''}
                </span>
                {i.owner_participant_id === state.participant.id && (
                  <Action
                    run={() =>
                      mutate(
                        '/guest/cart/' + i.id,
                        { cartVersion: state.cart.cart_version },
                        'DELETE',
                      )
                    }
                  >
                    Bỏ món
                  </Action>
                )}
              </div>
            ))}
            {state.items.some((i) => i.owner_participant_id === state.participant.id) && (
              <SendOrder state={state} done={refresh} />
            )}
          </section>
          <section className="core-card">
            <h2>Món đã gửi</h2>
            {!state.orders.length && <p>Chưa có lượt gọi món.</p>}
            {state.orders.map((i, index) => (
              <div className="core-line" key={String(i.item_id)}>
                <span>
                  {String(i.product_name_snapshot)} × {String(i.quantity)}
                </span>
                <span className="access-badge">
                  {label(i.status === 'PENDING_REVIEW' ? i.status : i.item_status)}
                </span>
                {i.created_by_participant_id === state.participant.id &&
                  ['SUBMITTED', 'PENDING_REVIEW'].includes(String(i.status)) &&
                  state.orders.findIndex((o) => o.id === i.id) === index && (
                    <Action
                      run={() =>
                        mutate('/guest/orders/' + i.id + '/cancel', {
                          reason: 'Khách yêu cầu hủy lượt trước khi bếp tiếp nhận',
                        })
                      }
                    >
                      Hủy lượt gọi này
                    </Action>
                  )}
              </div>
            ))}
          </section>
          <section className="core-card">
            <h2>Thanh toán</h2>
            <p>
              Còn phải trả: <strong>{vnd(state.account?.outstanding_amount)}</strong>
            </p>
            <p>Đang chờ xác nhận: {vnd(state.account?.reserved_payment_amount)}</p>
            <p>Cần hoàn lại: {vnd(state.account?.refund_due_amount)}</p>
            <PaymentForm done={refresh} />
          </section>
          <EntryForm
            title="Gọi nhân viên hỗ trợ"
            fields={[
              {
                key: 'type',
                label: 'Bạn cần gì?',
                options: ['ASSISTANCE', 'WATER', 'UTENSILS', 'BILL', 'OTHER'].map((value) => ({
                  value,
                  label: label(value),
                })),
              },
              { key: 'content', label: 'Nội dung thêm', optional: true },
            ]}
            submit="Gửi hỗ trợ"
            onSubmit={(v) => mutate('/guest/support', v)}
          />
        </>
      )}
    </main>
  );
}
function SendOrder({ state, done }: { state: State; done: () => Promise<void> }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <Action
      run={async () => {
        await api(
          '/guest/orders',
          {
            requestId: key,
            cartVersion: state.cart.cart_version,
            itemIds: state.items
              .filter((i) => i.owner_participant_id === state.participant.id)
              .map((i) => i.id),
          },
          'POST',
          true,
        );
        setKey(crypto.randomUUID());
        await done();
      }}
    >
      Gửi các món của tôi
    </Action>
  );
}
function PaymentForm({ done }: { done: () => Promise<void> }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <EntryForm
      title="Yêu cầu thanh toán"
      fields={[
        {
          key: 'method',
          label: 'Hình thức',
          options: [
            { value: 'CASH', label: 'Tiền mặt' },
            { value: 'BANK_TRANSFER', label: 'Chuyển khoản, nhân viên xác nhận' },
          ],
        },
        { key: 'amount', label: 'Số tiền (đồng)', type: 'number', min: 1, step: '1' },
      ]}
      submit="Báo nhân viên thu tiền"
      onSubmit={async (v) => {
        await api('/guest/payments', { ...v, requestId: key }, 'POST', true);
        setKey(crypto.randomUUID());
        await done();
      }}
    />
  );
}
