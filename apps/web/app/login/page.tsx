'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { postApi } from '../../lib/api-client';
export default function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    <main className="auth-shell">
      <section className="auth-story">
        <Link href="/" className="brand-link">
          AN NHIÊN · QR ORDERING
        </Link>
        <p className="eyebrow">KHÔNG GIAN NỘI BỘ</p>
        <h1>
          Một khởi đầu
          <br />
          cho ca làm việc.
        </h1>
        <p>Đăng nhập để vào không gian dành cho vai trò của bạn.</p>
        <div className="auth-note">Nhân viên · Bếp · Quản trị viên</div>
      </section>
      <section className="auth-card">
        <p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p>
        <h2>Đăng nhập</h2>
        <p>Dùng tài khoản nội bộ đã được cấp.</p>
        <form onSubmit={submit}>
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
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
          <div aria-live="polite" className="form-error">
            {error}
          </div>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
        <p className="small-note">Cần tài khoản? Liên hệ người quản lý nhà hàng.</p>
      </section>
    </main>
  );
}
