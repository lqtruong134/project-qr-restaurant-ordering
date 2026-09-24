'use client';
import { requestId } from '../shared/request-id';
import { useState } from 'react';
import { Action, api, EntryForm, vnd, type Product, type Row } from '../shared/components';
import { Empty } from '../shared/primitives';
export type GuestState = {
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
  support?: Row[];
};
export function Cart({
  state,
  mutate,
  done,
}: {
  state: GuestState;
  mutate: (path: string, body: unknown, method?: string) => Promise<void>;
  done: () => Promise<void>;
}) {
  const [key, setKey] = useState(() => requestId());
  const mine = state.items.filter((i) => i.owner_participant_id === state.participant.id);
  const total = state.items.reduce(
    (s, i) => s + BigInt(i.unit_price_preview) * BigInt(i.quantity),
    0n,
  );
  return (
    <>
      <h2>
        Giỏ chung của bàn{' '}
        <span className="status-pill">{state.items.reduce((s, i) => s + i.quantity, 0)} món</span>
      </h2>
      <p>Bạn gửi những món mình chọn. Mọi người cùng bàn vẫn xem được giỏ chung.</p>
      {!state.items.length && (
        <Empty title="Chưa có món trong giỏ" icon="bag">
          Một bữa ngon đang chờ bạn.
        </Empty>
      )}
      {state.items.map((i) => (
        <div key={i.id} className="cart-item">
          <div>
            <strong>
              {i.quantity} × {i.name}
            </strong>
            <span>{vnd(BigInt(i.unit_price_preview) * BigInt(i.quantity))}</span>
          </div>
          {i.note && <small>{String(i.note)}</small>}
          {i.owner_participant_id !== state.participant.id ? (
            <small>Người cùng bàn chọn</small>
          ) : (
            <>
              <Action
                run={() =>
                  mutate(
                    '/guest/cart/' + i.id,
                    {
                      quantity: i.quantity + 1,
                      note: i.note ?? '',
                      cartVersion: state.cart.cart_version,
                    },
                    'PATCH',
                  )
                }
              >
                +1
              </Action>
              {i.quantity > 1 && (
                <Action
                  run={() =>
                    mutate(
                      '/guest/cart/' + i.id,
                      {
                        quantity: i.quantity - 1,
                        note: i.note ?? '',
                        cartVersion: state.cart.cart_version,
                      },
                      'PATCH',
                    )
                  }
                >
                  −1
                </Action>
              )}
              <Action
                run={() =>
                  mutate('/guest/cart/' + i.id, { cartVersion: state.cart.cart_version }, 'DELETE')
                }
              >
                Bỏ món
              </Action>
            </>
          )}
        </div>
      ))}
      {state.items.length > 0 && (
        <div className="cart-total">
          <span>Tạm tính cả giỏ</span>
          <strong>{vnd(total)}</strong>
        </div>
      )}
      {mine.length > 0 && (
        <Action
          run={async () => {
            await api(
              '/guest/orders',
              {
                requestId: key,
                cartVersion: state.cart.cart_version,
                itemIds: mine.map((i) => i.id),
              },
              'POST',
              true,
            );
            setKey(requestId());
            await done();
          }}
        >
          Gửi các món của tôi
        </Action>
      )}
    </>
  );
}
export function PaymentForm({ done, available }: { done: () => Promise<void>; available: string }) {
  const [key, setKey] = useState(() => requestId());
  if (BigInt(available) <= 0n)
    return (
      <Empty title="Chưa có khoản cần gửi thanh toán" icon="receipt">
        Nếu đã gửi yêu cầu, vui lòng chờ nhân viên xác nhận.
      </Empty>
    );
  return (
    <EntryForm
      key={available}
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
        {
          key: 'amount',
          label: 'Số tiền (đồng)',
          type: 'number',
          min: 1,
          step: '1',
          value: available,
        },
      ]}
      submit="Báo nhân viên thu tiền"
      onSubmit={async (v) => {
        await api('/guest/payments', { ...v, requestId: key }, 'POST', true);
        setKey(requestId());
        await done();
      }}
    />
  );
}
