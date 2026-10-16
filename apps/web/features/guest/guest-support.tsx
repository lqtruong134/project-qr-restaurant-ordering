'use client';
import { SupportRetry } from './support-retry';
import { useState, type FormEvent } from 'react';
import { supportTypes, supportStatuses, supportPolicy, restaurantPolicy } from '@thesis/contracts';
import { api, type Row } from '../shared/components';
import { PolicyNotice } from '../shared/policy-ui';
import { restaurantTime } from '../shared/restaurant-time';
export function GuestSupport({ rows, done }: { rows: Row[]; done: () => Promise<void> }) {
  const replaced = new Set(rows.map((x) => x.replaces_request_id).filter(Boolean));
  const [type, setType] = useState<keyof typeof supportTypes>('ASSISTANCE');
  const [content, setContent] = useState(''),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setMessage('');
    if (type === 'OTHER' && !content.trim()) {
      setError('Vui lòng mô tả điều bạn cần hỗ trợ.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ reused: boolean }>('/guest/support', {
        type,
        content: content.trim(),
      });
      setMessage(
        result.reused
          ? supportPolicy.reuseMessage
          : 'Đã gửi yêu cầu. Nhân viên sẽ tiếp nhận hỗ trợ bạn.',
      );
      setContent('');
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="guest-support">
      <div className="core-card">
        <h2>Gọi nhân viên hỗ trợ</h2>
        <PolicyNotice>{restaurantPolicy.notices.support}</PolicyNotice>
        <form className="support-form" aria-busy={busy} onSubmit={send}>
          <label>
            Bạn cần gì?
            <select
              value={type}
              disabled={busy}
              onChange={(e) => {
                setType(e.target.value as keyof typeof supportTypes);
                setMessage('');
                setError('');
              }}
            >
              {Object.entries(supportTypes).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {type === 'OTHER' ? 'Nội dung yêu cầu (bắt buộc)' : 'Nội dung thêm (không bắt buộc)'}
            <textarea
              value={content}
              disabled={busy}
              onChange={(e) => {
                setContent(e.target.value);
                setError('');
              }}
              required={type === 'OTHER'}
              maxLength={300}
              rows={3}
              placeholder="Ví dụ: Cho bàn mình thêm 2 ly nước lọc."
            />
          </label>
          <p className="support-help">
            Theo dõi yêu cầu ở bên dưới. Nếu vẫn chưa được hỗ trợ, nút “Gọi lại” sẽ cho biết khi nào
            bạn có thể nhắc nhân viên.
          </p>
          {type === 'BILL' && (
            <p className="policy-inline">Gọi tính tiền chưa có nghĩa là bạn đã thanh toán.</p>
          )}
          <button className="primary-button" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? 'Đang gửi…' : 'Gửi yêu cầu'}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p role="status" className="support-feedback">
            {message}
          </p>
        </form>
      </div>
      <section className="core-card" aria-label="Yêu cầu hỗ trợ của bạn">
        <h2>Yêu cầu của bạn</h2>
        <p className="support-help">
          Yêu cầu đang chờ được hiển thị trước, bên dưới là các yêu cầu gần đây của bạn.
        </p>
        {!rows.length && <p>Bạn chưa gửi yêu cầu hỗ trợ.</p>}
        <div className="guest-support-list">
          {rows
            .filter((s) => !replaced.has(s.id))
            .map((s) => (
              <article key={s.id} className="guest-support-row" data-support-id={s.id}>
                <div>
                  <strong>{supportTypes[s.request_type as keyof typeof supportTypes]}</strong>
                  <small>
                    Đã gửi lúc{' '}
                    {restaurantTime(s.created_at, { hour: '2-digit', minute: '2-digit' })}
                  </small>
                  {s.content && <p>{String(s.content)}</p>}
                </div>
                <span className="status-pill" data-status={s.status} role="status">
                  {s.request_type === 'BILL' && s.status === 'CANCELLED'
                    ? 'Yêu cầu thanh toán đã kết thúc'
                    : s.status === 'ACKNOWLEDGED'
                      ? 'Nhân viên đã tiếp nhận'
                      : supportStatuses[String(s.status)]}
                </span>
                <SupportRetry request={s} done={done} />
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}
