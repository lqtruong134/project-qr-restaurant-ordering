'use client';
import { requestId } from '../shared/request-id';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, EntryForm, options, vnd, type Product } from '../shared/components';
import Receipt, { type Bill } from './receipt';
export default function BillPanel({
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
    [error, setError] = useState(''),
    [showReceipt, setShowReceipt] = useState(false);
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
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
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
          <div className="bill-balance-grid">
            <div>
              <span>Phải thanh toán</span>
              <strong>{vnd(bill.account.charge_total)}</strong>
            </div>
            <div>
              <span>Đã thu</span>
              <strong>{vnd(bill.account.paid_total)}</strong>
            </div>
            <div>
              <span>Còn phải thu</span>
              <strong>{vnd(bill.account.outstanding_amount)}</strong>
            </div>
            <div>
              <span>Cần hoàn khách</span>
              <strong>{vnd(bill.account.refund_due_amount)}</strong>
            </div>
          </div>
          <div className="receipt-controls">
            <button
              className="secondary-button"
              aria-expanded={showReceipt}
              onClick={() => setShowReceipt(!showReceipt)}
            >
              {showReceipt ? 'Ẩn phiếu' : 'Xem phiếu thanh toán'}
            </button>
            <button className="primary-button" onClick={() => window.print()}>
              In thông tin thanh toán
            </button>
          </div>
          <Receipt bill={bill} visible={showReceipt} />
          {bill.session.session_status === 'ACTIVE' && (
            <>
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
                .filter(
                  (p) =>
                    ['CREATED', 'PENDING'].includes(String(p.status)) &&
                    new Date(String(p.expires_at)).getTime() > Date.now(),
                )
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
                          : [
                              {
                                key: 'receivedAmount',
                                label: 'Tiền mặt khách đưa (đồng)',
                                type: 'number',
                                min: Number(p.amount),
                                value: String(p.amount),
                              },
                            ]
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
                available={(
                  BigInt(String(bill.account.outstanding_amount)) -
                  BigInt(String(bill.account.reserved_payment_amount ?? 0))
                ).toString()}
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
                  confirm="Đóng phiên bàn sau khi đã hoàn tất phục vụ và thanh toán?"
                  run={async () => {
                    await act('/core/sessions/' + id + '/close');
                    setShowReceipt(true);
                  }}
                >
                  Đóng phiên sau khi hoàn tất
                </Action>
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
  const [key, setKey] = useState(() => requestId());
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
          setKey(requestId());
          await done();
        }}
      />
    </details>
  );
}
function StaffPayment({
  id,
  done,
  available,
}: {
  id: string;
  available: string;
  done: () => Promise<void>;
}) {
  const [key, setKey] = useState(() => requestId());
  if (BigInt(available) <= 0n)
    return (
      <p className="small-note">
        Không còn số tiền chưa lập yêu cầu thu. Kiểm tra các yêu cầu đang chờ hoặc hoàn tất phiên.
      </p>
    );
  return (
    <EntryForm
      title="Lập yêu cầu thu tiền"
      key={available}
      fields={[
        {
          key: 'method',
          label: 'Hình thức',
          options: [
            { value: 'CASH', label: 'Tiền mặt' },
            { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
          ],
        },
        {
          key: 'amount',
          label: 'Số tiền (đồng)',
          type: 'number',
          min: 1,
          value: BigInt(available) > 0n ? available : '',
        },
      ]}
      onSubmit={async (v) => {
        await api('/core/sessions/' + id + '/payments', { ...v, requestId: key });
        setKey(requestId());
        await done();
      }}
    />
  );
}
