'use client';
import { supportLabels } from '../shared/support-labels';
import { useCallback, useEffect, useState } from 'react';
import { supportStatuses } from '@thesis/contracts';
import { api, Action, type Row } from '../shared/components';
import { SupportHistory } from '../workspace/support-history';
import { restaurantDateTime } from '../shared/restaurant-time';
export function SupportReport() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setRows(await api<Row[]>('/core/admin/support'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="core-card">
      <h2>Hỗ trợ tại bàn & lịch sử bàn giao</h2>
      <p>
        Tối đa 100 yêu cầu, ưu tiên đang chờ. Quản trị xem và đối chiếu lịch sử; nhân viên phụ trách
        thực hiện xử lý.
      </p>
      <Action run={refresh}>Tải lại hỗ trợ</Action>
      {error && <p role="alert">{error}</p>}
      <div className="support-report-grid">
        {rows.map((s) => (
          <article className="support-task" key={s.id}>
            <strong>
              {String(s.table_code)} - {supportLabels[String(s.request_type)]}
            </strong>
            <p>
              {s.request_type === 'BILL' && s.status === 'CANCELLED'
                ? 'Lời gọi thu tiền đã kết thúc'
                : supportStatuses[String(s.status)]}{' '}
              - {String(s.acknowledged_by_name ?? 'Chưa có người phụ trách')}
            </p>
            <small>{restaurantDateTime(s.created_at)}</small>
            <SupportHistory id={s.id} admin />
          </article>
        ))}
      </div>
    </section>
  );
}
