'use client';
import { useEffect, useState } from 'react';
import { api, type Row } from '../shared/components';
export function SupportRetry({ request, done }: { request: Row; done: () => Promise<void> }) {
  const [now, setNow] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!['NEW', 'ACKNOWLEDGED'].includes(String(request.status))) return null;
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(String(request.retry_at)) - (now || Date.now())) / 1000),
  );
  const collecting = request.can_retry === false;
  return (
    <div className="support-retry">
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !request.retry_at || seconds > 0 || collecting}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('/guest/support/' + request.id + '/retry', {});
            await done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? 'Đang gọi lại…'
          : collecting
            ? 'Nhân viên đang thu tiền'
            : seconds > 0
              ? 'Gọi lại sau ' + seconds + ' giây'
              : 'Chưa được hỗ trợ? Gọi lại'}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
