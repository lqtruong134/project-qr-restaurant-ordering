'use client';
import { useEffect, useState, use } from 'react';
import MyWork from '../../../features/workforce/my-work';
import Admin from '../../../features/admin/admin';
import Service from '../../../features/workspace/service';
import Link from 'next/link';
import { Icon } from '../../../features/shared/primitives';
import { getAuthenticated, postApi } from '../../../lib/api-client';
type User = { id: string; displayName: string; role: string; permissions: string[] };
const labels: Record<string, string> = {
  staff: 'Không gian nhân viên',
  kitchen: 'Không gian bếp',
  admin: 'Không gian quản trị',
};
export default function Workspace({ params }: { params: Promise<{ area: string }> }) {
  const { area } = use(params);
  const [user, setUser] = useState<User>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [myWork, setMyWork] = useState(false);
  const canViewOwnWork = user?.role !== 'ADMIN';
  useEffect(() => {
    let active = true;
    setUser(undefined);
    setError('');
    async function load() {
      try {
        const res = await getAuthenticated('/workspaces/' + encodeURIComponent(area));
        if (!active) return;
        if (res.status === 401) return;
        const data = await res.json();
        if (active) {
          if (!res.ok) setError(data.userMessage ?? 'Không tìm thấy chức năng.');
          else setUser(data.user);
        }
      } catch {
        if (active) setError('Chưa kết nối được máy chủ. Vui lòng tải lại trang.');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [area]);
  async function logout() {
    setBusy(true);
    try {
      const res = await postApi('/auth/logout');
      if (res.ok) window.location.assign('/login');
      else setError('Chưa đăng xuất được. Vui lòng thử lại.');
    } catch {
      setError('Chưa kết nối được máy chủ.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link href="/" className="brand-lockup">
          <span className="brand-symbol">
            <Icon name="leaf" />
          </span>
          <div>
            <strong>QUYẾT TRƯỜNG</strong>
            <small>Restaurant workspace</small>
          </div>
        </Link>
        <div className="workspace-user">
          {user && (
            <>
              <span className="avatar">{user.displayName.slice(0, 1)}</span>
              <div>
                <strong>{user.displayName}</strong>
                <small>
                  {area === 'admin' ? 'Quản trị' : area === 'kitchen' ? 'Nhân viên bếp' : 'Phục vụ'}
                </small>
              </div>
            </>
          )}
          <button className="secondary-button" onClick={logout} disabled={busy}>
            {busy ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      </header>
      <section className="workspace-content">
        <div className="workspace-title">
          <div>
            <p className="eyebrow">
              {area === 'kitchen'
                ? 'TRONG BẾP HÔM NAY'
                : area === 'admin'
                  ? 'VẬN HÀNH NHÀ HÀNG'
                  : 'CHĂM SÓC TỪNG BÀN KHÁCH'}
            </p>
            <h1>{labels[area] ?? 'Không gian nội bộ'}</h1>
            <p>
              {area === 'kitchen'
                ? 'Nhận món, chuẩn bị và phối hợp cùng đội phục vụ.'
                : area === 'admin'
                  ? 'Mọi hoạt động nhà hàng, trong một không gian.'
                  : 'Một ca phục vụ nhịp nhàng bắt đầu từ đây.'}
            </p>
          </div>
          {user && <span className="live-indicator">Đã xác thực quyền truy cập</span>}
        </div>
        {error ? (
          <div role="alert" className="auth-card">
            <h2>Không thể truy cập</h2>
            <p>{error}</p>
            <Link href="/login">Quay lại đăng nhập</Link>
          </div>
        ) : !user ? (
          <p role="status">Đang kiểm tra quyền truy cập…</p>
        ) : (
          <>
            {canViewOwnWork && (
              <nav className="filter-chips" aria-label="Không gian làm việc">
                <button className={!myWork ? 'active' : ''} onClick={() => setMyWork(false)}>
                  Vận hành nhà hàng
                </button>
                <button className={myWork ? 'active' : ''} onClick={() => setMyWork(true)}>
                  Lịch làm & lương của tôi
                </button>
              </nav>
            )}
            {canViewOwnWork && myWork ? (
              <MyWork />
            ) : area === 'admin' ? (
              <Admin />
            ) : (
              <Service kitchen={area === 'kitchen'} userId={user.id} />
            )}
          </>
        )}
      </section>
    </main>
  );
}
