'use client';
import { useState, type FormEvent } from 'react';
import { postApi } from '../../lib/api-client';
import { media } from '../../lib/media';
export default function InternalLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const res = await postApi('/auth/login', {
        username: form.get('username'),
        password: form.get('password'),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.userMessage ?? 'Đăng nhập chưa thành công.');
        return;
      }
      const roles: Record<string, string> = { STAFF: 'staff', KITCHEN: 'kitchen', ADMIN: 'admin' };
      const area = roles[data.user?.role as string];
      window.location.assign(area ? '/workspace/' + area : '/workspace');
    } catch {
      setError('Chưa kết nối được máy chủ. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="internal-login">
      <a className="skip-link" href="#login-form">
        Đến biểu mẫu đăng nhập
      </a>
      <div className="internal-login-background" aria-hidden="true">
        <img
          src={media.loginCover}
          alt=""
          width={1600}
          height={1000}
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <section className="internal-login-card" id="login-form" tabIndex={-1}>
        <div className="internal-login-brand">
          <img
            src={media.logo}
            alt="Quyết Trường Bistro"
            width={180}
            height={135}
            decoding="async"
          />
        </div>
        <h1>Đăng nhập nội bộ</h1>
        <p>Dùng tài khoản nhà hàng đã cấp cho bạn.</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="username">Tên đăng nhập</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            maxLength={64}
            autoCapitalize="none"
            spellCheck={false}
          />
          <label htmlFor="password">Mật khẩu</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={256}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? 'Ẩn' : 'Hiện'}
            </button>
          </div>
          <div role={error ? 'alert' : undefined} aria-live="polite" className="form-error">
            {error}
          </div>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
        <p className="internal-login-help">Cần hỗ trợ tài khoản? Liên hệ quản lý.</p>
      </section>
    </main>
  );
}
