'use client';
import { useEffect, useState } from 'react';
import { api, EntryForm, label, vnd, type Row } from '../shared/components';
export function OrderExceptions() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState('');
  async function refresh() {
    try {
      setRows(await api('/core/order-exceptions'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section>
      <h2>Quản trị xử lý món đã chế biến</h2>
      <p>
        Hủy muộn giữ nguyên nguyên liệu đã tiêu hao và khoản phải thu. Miễn tiền là quyết định
        riêng; tiền đã nhận được hoàn qua hồ sơ hoàn tiền.
      </p>
      {error && <p role="alert">{error}</p>}
      {rows.map((i) => (
        <details className="core-card" key={i.id}>
          <summary>
            {String(i.table_code)} · {String(i.quantity)} × {String(i.product_name_snapshot)} ·{' '}
            {label(i.status)} · {vnd(i.line_total)}
          </summary>
          {['IN_PREPARATION', 'READY', 'SERVED'].includes(String(i.status)) && (
            <EntryForm
              title="Hủy muộn / ghi nhận tổn thất món"
              fields={[{ key: 'reason', label: 'Lý do và diễn biến thực tế' }]}
              submit="Xác nhận hủy muộn, chưa miễn tiền"
              onSubmit={async (v) => {
                await api('/core/items/' + i.id + '/late-cancel', v);
                await refresh();
              }}
            />
          )}
          {i.late_cancelled === true && i.has_charge === true && (
            <EntryForm
              title="Quyết định miễn khoản thu"
              fields={[{ key: 'reason', label: 'Lý do miễn tiền' }]}
              submit="Miễn tiền món đã hủy"
              onSubmit={async (v) => {
                await api('/core/items/' + i.id + '/waive', v);
                await refresh();
              }}
            />
          )}
        </details>
      ))}
    </section>
  );
}
