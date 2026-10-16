'use client';
import { useEffect, useState } from 'react';
import { api, type Row } from '../shared/components';
import { Action } from '../shared/components';
export function StaffTableCode({
  tableId,
  requestId,
  done,
}: {
  tableId?: string;
  requestId?: string;
  done: () => Promise<void>;
}) {
  const [code, setCode] = useState(''),
    [loaded, setLoaded] = useState(false),
    [expanded, setExpanded] = useState(false),
    [readError, setReadError] = useState('');
  useEffect(() => {
    let active = true;
    setCode('');
    setLoaded(false);
    setReadError('');
    if (!requestId && !expanded) return;
    if (!tableId) {
      setLoaded(true);
      return;
    }
    api<Row>(`/core/tables/${tableId}/access-code`)
      .then((x) => {
        if (active) {
          setCode(String(x.accessCode ?? ''));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setReadError('Chưa tải được mã. Đóng và mở lại chi tiết bàn để thử lại.');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [tableId, requestId, expanded]);
  const content = (
    <section className="staff-table-code">
      {!loaded && <p role="status">Đang lấy mã vào bàn…</p>}
      {loaded && !readError && (
        <p>
          {code
            ? 'Mã đã được cấp cho bàn này. Chỉ đọc mã cho khách đang ngồi tại bàn.'
            : 'Đến đúng bàn, xác nhận khách rồi cấp mã để khách gọi món.'}
        </p>
      )}
      {loaded && code && (
        <div role="status">
          <small>Đọc mã này cho khách tại bàn</small>
          <strong>{code}</strong>
        </div>
      )}
      {readError && (
        <p role="alert" className="form-error">
          {readError}
        </p>
      )}
      {loaded && !code && !readError && (
        <Action
          disabled={!loaded}
          successMessage="Đã xác nhận bàn và cấp mã tham gia."
          confirm="Bạn đã đến đúng bàn và xác nhận khách? Cấp mã sẽ xác minh bàn; các lượt gọi thông thường được chuyển đến bếp."
          run={async () => {
            const result = await api<Row>(
              requestId
                ? `/core/support/${requestId}/access-code`
                : `/core/tables/${tableId}/access-code`,
              {},
            );
            setCode(String(result.accessCode));
            await done();
          }}
        >
          Xác nhận tại bàn & cấp mã
        </Action>
      )}
    </section>
  );
  return requestId ? (
    content
  ) : (
    <details
      className="staff-code-details"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Mã tham gia bàn</summary>
      {content}
    </details>
  );
}
