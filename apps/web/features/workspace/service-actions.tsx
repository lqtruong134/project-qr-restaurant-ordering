'use client';
import { useState } from 'react';
import { Action, api, EntryForm, label, vnd, type Row } from '../shared/components';
export function SupportActions({
  rows,
  userId,
  act,
}: {
  rows: Row[];
  userId: string;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <>
      {rows.map((s) => (
        <article className="task-card" key={s.id}>
          <div>
            <strong>
              {String(s.table_code)} · {label(s.request_type)}
            </strong>
            <small>
              Đã chờ{' '}
              {Math.max(
                0,
                Math.floor((Date.now() - new Date(String(s.created_at)).getTime()) / 60000),
              )}{' '}
              phút
            </small>
            <p>{String(s.content ?? 'Khách cần hỗ trợ tại bàn.')}</p>
            <small>
              {s.status === 'ACKNOWLEDGED'
                ? 'Đang xử lý: ' + s.acknowledged_by_name + ' · ' + s.acknowledged_by_username
                : 'Chưa có người tiếp nhận'}
            </small>
          </div>
          {s.status === 'NEW' ? (
            <Action run={() => act('/core/support/' + s.id + '/claim')}>Tôi tiếp nhận</Action>
          ) : s.acknowledged_by === userId ? (
            <div>
              <Action run={() => act('/core/support/' + s.id + '/resolve')}>
                Tôi đã hỗ trợ xong
              </Action>
              <SupportHandover id={s.id} userId={userId} act={act} />
            </div>
          ) : (
            <span className="status-pill">Đồng nghiệp đang xử lý</span>
          )}
        </article>
      ))}
    </>
  );
}
export function AlertActions({
  rows,
  act,
}: {
  rows: Row[];
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  return (
    <>
      {rows.map((a) => (
        <article className="task-card alert-card" key={a.id}>
          <div>
            <strong>
              {String(a.table_code)} ·{' '}
              {a.alert_type === 'REFUND_REQUIRED'
                ? 'Cần hoàn tiền'
                : a.alert_type === 'PAYMENT_SHORTFALL'
                  ? 'Thiếu tiền thanh toán'
                  : 'Kiểm tra giao dịch'}
            </strong>
            <p>
              {vnd(a.outstanding_amount)} · {label(a.status)}
            </p>
          </div>
          {['NEW', 'ESCALATED'].includes(String(a.status)) ? (
            <Action run={() => act('/core/alerts/' + a.id + '/acknowledge')}>
              Xác nhận đã nhận cảnh báo
            </Action>
          ) : (
            <EntryForm
              title="Kết quả xử lý cảnh báo"
              fields={[{ key: 'reason', label: 'Nội dung đã xử lý' }]}
              submit="Hoàn tất cảnh báo"
              onSubmit={(v) => act('/core/alerts/' + a.id + '/resolve', v)}
            />
          )}
        </article>
      ))}
    </>
  );
}

function SupportHandover({
  id,
  userId,
  act,
}: {
  id: string;
  userId: string;
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  const [people, setPeople] = useState<Row[] | null>(null);
  return (
    <details>
      <summary>Bàn giao khi hết ca</summary>
      {!people ? (
        <Action run={async () => setPeople(await api<Row[]>('/core/support-assignees'))}>
          Chọn người nhận
        </Action>
      ) : (
        <EntryForm
          title="Bàn giao yêu cầu"
          fields={[
            {
              key: 'userId',
              label: 'Người nhận',
              options: people
                .filter((p) => p.id !== userId)
                .map((p) => ({ value: p.id, label: p.display_name + ' · ' + p.username })),
            },
            { key: 'reason', label: 'Lý do bàn giao' },
          ]}
          submit="Bàn giao"
          onSubmit={(v) => act('/core/support/' + id + '/reassign', v)}
        />
      )}
    </details>
  );
}
