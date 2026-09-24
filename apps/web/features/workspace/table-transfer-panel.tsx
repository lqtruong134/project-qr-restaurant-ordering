'use client';
import { useEffect, useState } from 'react';
import { api, EntryForm, type Row } from '../shared/components';
export default function TableTransferPanel({
  table,
  tables,
  done,
}: {
  table: Row;
  tables: Row[];
  done: () => Promise<void>;
}) {
  const [history, setHistory] = useState<Row[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<Row[]>('/core/sessions/' + table.session_id + '/transfers')
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [table.session_id]);
  const targets = tables.filter(
    (t) => t.id !== table.id && t.table_status === 'AVAILABLE' && !t.session_id,
  );
  return (
    <details className="core-card">
      <summary>Chuyển bàn & lịch sử</summary>
      <p>
        Chuyển toàn bộ phiên đang phục vụ. Món đã gọi, giỏ hàng và tiền đã thanh toán được giữ
        nguyên. Bàn cũ chuyển sang chờ dọn; khách đang mở thực đơn không cần đăng nhập lại.
      </p>
      {targets.length ? (
        <EntryForm
          title={'Chuyển từ ' + table.name}
          fields={[
            {
              key: 'tableId',
              label: 'Bàn trống đích',
              options: targets.map((t) => ({
                value: t.id,
                label: String(t.name) + ' · ' + t.capacity + ' chỗ',
              })),
            },
            {
              key: 'partySize',
              label: 'Số khách thực tế',
              type: 'number',
              min: 1,
              max: 30,
              value: Math.min(Number(table.capacity), 4),
            },
            { key: 'reason', label: 'Lý do chuyển bàn' },
          ]}
          onSubmit={async (v) => {
            await api('/core/sessions/' + table.session_id + '/transfer', {
              ...v,
              fromTableId: table.id,
              partySize: Number(v.partySize),
            });
            await done();
          }}
        />
      ) : (
        <p>Chưa có bàn trống để chuyển.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <h3>Lịch sử chuyển của phiên</h3>
      {!history.length ? (
        <p>Chưa chuyển bàn.</p>
      ) : (
        history.map((h) => (
          <p key={h.id}>
            {String(h.from_name)} → {String(h.to_name)} ·{' '}
            {new Date(String(h.transferred_at)).toLocaleString('vi-VN')}
            <br />
            {String(h.employee_name)} ({String(h.username)}): {String(h.reason)}
          </p>
        ))
      )}
    </details>
  );
}
