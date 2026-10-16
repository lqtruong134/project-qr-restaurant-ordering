'use client';
import { useEffect, useState } from 'react';
import { api, type Row } from '../shared/components';
import { Icon } from '../shared/primitives';
export function AccessRequest({ token, name }: { token: string; name: string }) {
  const [request, setRequest] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const x = await api<Row | null>('/guest/access-request/status', { token });
        if (active) setRequest(x);
      } catch {
        /* Join form handles invalid QR. */
      }
    };
    void refresh();
    const poll = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [token]);
  useEffect(() => setError(''), [name]);
  const seconds = request
    ? Math.max(0, Math.ceil((Date.parse(String(request.retryAt)) - (now || Date.now())) / 1000))
    : 0;
  const waiting = request && ['NEW', 'ACKNOWLEDGED'].includes(String(request.status));
  return (
    <section className="access-request" aria-label="Nhờ nhân viên cấp mã">
      <p>
        <Icon name="bell" size={17} /> Chưa có mã vào bàn?
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !!(waiting && seconds > 0)}
        aria-busy={busy}
        onClick={async () => {
          if (!name.trim()) {
            setError('Nhập tên của bạn trước khi gọi nhân viên.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await api('/guest/access-request', { token, name, retry: !!waiting });
            setRequest(await api<Row>('/guest/access-request/status', { token }));
            setNow(Date.now());
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? 'Đang gửi…'
          : waiting && seconds > 0
            ? `Gọi lại sau ${seconds} giây`
            : request
              ? 'Cần cấp mã? Gọi lại'
              : 'Yêu cầu nhân viên cấp mã'}
      </button>
      {request && (
        <p role="status">
          {request.status === 'ACKNOWLEDGED'
            ? 'Nhân viên đã tiếp nhận yêu cầu. Vui lòng chờ tại bàn để được cung cấp mã.'
            : request.status === 'NEW'
              ? 'Đã gửi yêu cầu cấp mã. Vui lòng chờ nhân viên đến hỗ trợ bạn.'
              : request.status === 'RESOLVED'
                ? 'Nhân viên đã hỗ trợ cấp mã. Nhập mã vào ô bên dưới để gọi món.'
                : 'Yêu cầu trước đã kết thúc. Nếu vẫn cần mã, bạn có thể gọi nhân viên lại.'}
        </p>
      )}
      {!request && (
        <small>
          Bạn có thể hỏi mã từ người đã vào thực đơn tại bàn này, hoặc nhờ nhân viên hỗ trợ.
        </small>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
