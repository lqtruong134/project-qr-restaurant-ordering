'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Action,
  api,
  EntryForm,
  label,
  options,
  vnd,
  type Order,
  type Product,
  type Row,
} from './common';
type Bill = {
  session: Row;
  account: Row;
  charges: Row[];
  intents: Row[];
  payments: Row[];
  refunds: Row[];
};
export default function Service({ kitchen = false }: { kitchen?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]),
    [tables, setTables] = useState<Row[]>([]),
    [support, setSupport] = useState<Row[]>([]),
    [alerts, setAlerts] = useState<Row[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setOrders(await api<Order[]>(kitchen ? '/core/kitchen' : '/core/orders'));
      if (!kitchen) {
        const [t, s, a, c] = await Promise.all([
          api<Row[]>('/core/tables'),
          api<Row[]>('/core/support'),
          api<Row[]>('/core/alerts'),
          api<{ products: Product[] }>('/core/catalog'),
        ]);
        setTables(t);
        setSupport(s);
        setAlerts(a);
        setProducts(c.products);
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa kết nối được máy chủ.');
    }
  }, [kitchen]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(path: string, body: unknown = {}) {
    await api(path, body);
    await refresh();
  }
  return (
    <section className="core-app">
      <div className="core-line">
        <p>Tự cập nhật mỗi 3 giây.</p>
        <Action run={refresh}>Tải lại</Action>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!kitchen && (
        <>
          <h2>Bàn phục vụ</h2>
          <div className="core-grid">
            {tables.map((t) => (
              <article key={t.id} className="core-card">
                <h3>{String(t.name)}</h3>
                <p>{label(t.table_status)}</p>
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
          {selected && (
            <BillPanel
              key={selected}
              id={selected}
              products={products}
              onClose={() => setSelected('')}
              done={refresh}
            />
          )}
          <h2>Yêu cầu hỗ trợ</h2>
          {!support.length && <p>Không có yêu cầu chờ.</p>}
          <div className="core-grid">
            {support.map((s) => (
              <article key={s.id} className="core-card">
                <h3>
                  {String(s.table_code)} · {label(s.request_type)}
                </h3>
                <p>{String(s.content ?? '')}</p>
                <p>{label(s.status)}</p>
                {s.status === 'NEW' ? (
                  <Action run={() => act('/core/support/' + s.id + '/claim')}>Tôi tiếp nhận</Action>
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
                <div className="core-card" key={a.id}>
                  <strong>
                    {String(a.table_code)} ·{' '}
                    {a.alert_type === 'REFUND_REQUIRED'
                      ? 'Cần hoàn tiền'
                      : a.alert_type === 'PAYMENT_SHORTFALL'
                        ? 'Thiếu tiền thanh toán'
                        : String(a.alert_type)}
                  </strong>
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
                </div>
              ))}
            </>
          )}
        </>
      )}
      <h2>{kitchen ? 'Các lượt bếp cần xử lý' : 'Các lượt gọi món'}</h2>
      {!orders.length && <p>Chưa có lượt gọi cần xử lý.</p>}
      <div className="core-grid">
        {orders.map((o) => (
          <article className="core-card" key={o.id}>
            <div className="core-line">
              <h3>Bàn {o.table_code}</h3>
              <span className="access-badge">{label(o.status)}</span>
            </div>
            {o.items?.map((i) => (
              <div key={i.id} className="core-order-item">
                <strong>
                  {i.quantity} × {i.product_name_snapshot}
                </strong>
                {i.note && <p>Ghi chú: {String(i.note)}</p>}
                <p>{label(i.status)}</p>
                {kitchen && i.status === 'ACCEPTED' && (
                  <Action run={() => act('/core/items/' + i.id + '/prepare')}>
                    Bắt đầu chế biến
                  </Action>
                )}
                {kitchen && i.status === 'IN_PREPARATION' && (
                  <Action run={() => act('/core/items/' + i.id + '/ready')}>Món đã xong</Action>
                )}
                {!kitchen && i.status === 'READY' && (
                  <Action run={() => act('/core/items/' + i.id + '/serve')}>Đã mang ra bàn</Action>
                )}
              </div>
            ))}
            <p>Tổng: {vnd(o.total_amount)}</p>
            {kitchen && o.status === 'SUBMITTED' && (
              <Action run={() => act('/core/orders/' + o.id + '/accept')}>Bếp nhận cả lượt</Action>
            )}
            {!kitchen && o.status === 'PENDING_REVIEW' && (
              <>
                <Action run={() => act('/core/orders/' + o.id + '/review', { approve: true })}>
                  Duyệt gửi bếp
                </Action>
                <EntryForm
                  title="Từ chối lượt gọi"
                  fields={[{ key: 'reason', label: 'Lý do' }]}
                  submit="Từ chối"
                  onSubmit={(v) =>
                    act('/core/orders/' + o.id + '/review', { ...v, approve: false })
                  }
                />
              </>
            )}
            {!kitchen && ['SUBMITTED', 'ACCEPTED'].includes(o.status) && (
              <details>
                <summary>Hủy lượt chưa chế biến</summary>
                <EntryForm
                  title="Hủy lượt gọi"
                  fields={[{ key: 'reason', label: 'Lý do hủy' }]}
                  submit="Xác nhận hủy"
                  onSubmit={(v) => act('/core/orders/' + o.id + '/cancel', v)}
                />
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function BillPanel({
  id,
  products,
  onClose,
  done,
}: {
  id: string;
  products: Product[];
  onClose: () => void;
  done: () => Promise<void>;
}) {
  const [bill, setBill] = useState<Bill>(),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setBill(await api<Bill>('/core/sessions/' + id + '/bill'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được hóa đơn.');
    }
  }, [id]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);
  async function act(path: string, body: unknown = {}) {
    await api(path, body);
    await refresh();
    await done();
  }
  return (
    <section className="core-bill">
      <div className="core-line">
        <h2>Chi tiết bàn</h2>
        <button className="secondary-button" onClick={onClose}>
          Đóng chi tiết
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {bill && (
        <>
          <div className="core-stats">
            <p>
              Phải thu <strong>{vnd(bill.account.charge_total)}</strong>
            </p>
            <p>
              Đã thu <strong>{vnd(bill.account.paid_total)}</strong>
            </p>
            <p>
              Còn thiếu <strong>{vnd(bill.account.outstanding_amount)}</strong>
            </p>
            <p>
              Cần hoàn <strong>{vnd(bill.account.refund_due_amount)}</strong>
            </p>
          </div>
          {bill.charges.map((c) => (
            <div key={c.id} className="core-line">
              <span>
                {String(c.product_name_snapshot ?? 'Khoản thu')} × {String(c.quantity ?? 1)}{' '}
                {c.status === 'REVERSED' ? '(đã hủy)' : ''}
              </span>
              <strong>{vnd(c.amount)}</strong>
            </div>
          ))}
          <StaffOrder
            id={id}
            products={products}
            done={async () => {
              await refresh();
              await done();
            }}
          />
          <h3>Thanh toán chờ xác nhận</h3>
          {bill.intents
            .filter((p) => ['CREATED', 'PENDING'].includes(String(p.status)))
            .map((p) => (
              <div className="core-card" key={p.id}>
                <strong>
                  {p.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'} · {vnd(p.amount)}
                </strong>
                <EntryForm
                  title="Xác nhận sau khi nhận đủ tiền"
                  fields={
                    p.method === 'BANK_TRANSFER'
                      ? [{ key: 'reference', label: 'Mã giao dịch ngân hàng' }]
                      : []
                  }
                  submit="Tôi đã nhận tiền"
                  onSubmit={(v) =>
                    act('/core/payments/' + p.id + '/confirm', { ...v, amount: p.amount })
                  }
                />
                <Action run={() => act('/core/payments/' + p.id + '/cancel')}>
                  Hủy yêu cầu thanh toán
                </Action>
              </div>
            ))}
          <StaffPayment
            id={id}
            done={async () => {
              await refresh();
              await done();
            }}
          />
          {BigInt(String(bill.account.refund_due_amount)) > 0n && (
            <EntryForm
              title="Lập hồ sơ hoàn tiền"
              fields={[
                {
                  key: 'paymentId',
                  label: 'Giao dịch gốc',
                  options: bill.payments.map((p) => ({
                    value: p.id,
                    label:
                      (p.method === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản') +
                      ' · ' +
                      vnd(p.amount) +
                      ' · ' +
                      new Date(String(p.created_at)).toLocaleTimeString('vi-VN'),
                  })),
                },
                {
                  key: 'amount',
                  label: 'Số tiền hoàn',
                  type: 'number',
                  min: 1,
                  value: String(bill.account.refund_due_amount),
                },
                { key: 'reason', label: 'Lý do hoàn' },
              ]}
              onSubmit={(v) => act('/core/sessions/' + id + '/refunds', v)}
            />
          )}
          {bill.refunds
            .filter((r) => ['OPEN', 'IN_PROGRESS'].includes(String(r.status)))
            .map((r) => (
              <EntryForm
                key={r.id}
                title={'Hoàn lại ' + vnd(r.amount)}
                fields={[
                  {
                    key: 'method',
                    label: 'Cách hoàn',
                    options: [
                      { value: 'CASH', label: 'Tiền mặt' },
                      { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
                    ],
                  },
                  {
                    key: 'reference',
                    label: 'Mã chuyển khoản (bắt buộc khi chuyển khoản)',
                    optional: true,
                  },
                ]}
                submit="Đã hoàn tiền cho khách"
                onSubmit={(v) => act('/core/refunds/' + r.id + '/complete', v)}
              />
            ))}
          <div className="core-line">
            <Action
              run={async () => {
                await act('/core/sessions/' + id + '/close');
                onClose();
              }}
            >
              Đóng phiên sau khi hoàn tất
            </Action>
            <button className="secondary-button" onClick={() => window.print()}>
              In thông tin thanh toán
            </button>
          </div>
          <details>
            <summary>Khách rời đi khi còn thiếu tiền</summary>
            <EntryForm
              title="Báo quản trị xử lý"
              fields={[
                { key: 'reason', label: 'Mã lý do', value: 'LEFT_WITHOUT_PAYING' },
                { key: 'notes', label: 'Diễn biến sự việc' },
                { key: 'evidence', label: 'Tham chiếu bằng chứng (nếu có)', optional: true },
              ]}
              submit="Lập hồ sơ thiếu tiền"
              onSubmit={(v) => act('/core/sessions/' + id + '/outstanding', v)}
            />
          </details>
        </>
      )}
    </section>
  );
}
function StaffOrder({
  id,
  products,
  done,
}: {
  id: string;
  products: Product[];
  done: () => Promise<void>;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <details>
      <summary>Gọi thêm món giúp khách</summary>
      <EntryForm
        title="Thêm món"
        fields={[
          {
            key: 'productId',
            label: 'Món',
            options: options(
              products.filter((p) => p.is_active && p.availability_status === 'AVAILABLE'),
            ),
          },
          { key: 'quantity', label: 'Số lượng', type: 'number', value: 1, min: 1, max: 100 },
          { key: 'note', label: 'Ghi chú', optional: true },
        ]}
        submit="Gửi bếp"
        onSubmit={async (v) => {
          await api('/core/sessions/' + id + '/orders', {
            requestId: key,
            lines: [{ ...v, quantity: Number(v.quantity) }],
          });
          setKey(crypto.randomUUID());
          await done();
        }}
      />
    </details>
  );
}
function StaffPayment({ id, done }: { id: string; done: () => Promise<void> }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <EntryForm
      title="Lập yêu cầu thu tiền"
      fields={[
        {
          key: 'method',
          label: 'Hình thức',
          options: [
            { value: 'CASH', label: 'Tiền mặt' },
            { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
          ],
        },
        { key: 'amount', label: 'Số tiền (đồng)', type: 'number', min: 1 },
      ]}
      onSubmit={async (v) => {
        await api('/core/sessions/' + id + '/payments', { ...v, requestId: key });
        setKey(crypto.randomUUID());
        await done();
      }}
    />
  );
}
