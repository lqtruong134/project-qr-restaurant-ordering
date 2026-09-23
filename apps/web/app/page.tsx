import { StatusBadge } from '@thesis/ui';
export const dynamic = 'force-dynamic';
export default async function Home() {
  let ready = false;
  try {
    const r = await fetch((process.env.API_BASE_URL ?? 'http://127.0.0.1:4000') + '/health/ready', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    ready = r.ok;
  } catch {
    // The readiness card shows the recoverable offline state.
  }
  return (
    <main>
      <header>
        <a href="/" className="brand">
          <span className="brand-mark">Q</span>An Nhiên · QR Ordering
        </a>
        <a className="secondary-button" href="/login">
          Đăng nhập nhân viên
        </a>
      </header>
      <section className="intro">
        <span className="eyebrow">GỌI MÓN TẠI BÀN</span>
        <h1>
          Từ thực đơn
          <br />
          <em>đến từng bữa ăn.</em>
        </h1>
        <p>
          Khách quét mã QR trên bàn để gọi món. Nhân viên tiếp nhận, bếp cập nhật chế biến và quản
          trị theo dõi thực đơn, nguyên liệu, thanh toán.
        </p>
      </section>
      <section className="status-card" aria-label="Trạng thái hệ thống">
        <div>
          <h2>{ready ? 'Môi trường đã sẵn sàng' : 'Cần kiểm tra kết nối'}</h2>
          <p>
            {ready
              ? 'Bạn có thể đăng nhập để bắt đầu ca làm việc.'
              : 'Chưa kết nối được hệ thống. Vui lòng thử lại sau.'}
          </p>
        </div>
        <StatusBadge ready={ready}>{ready ? 'Hoạt động' : 'Chưa kết nối'}</StatusBadge>
      </section>
      <section className="milestones">
        {[
          ['Khách tại bàn', 'Quét QR, chọn món, theo dõi và gọi hỗ trợ.'],
          ['Phục vụ', 'Duyệt món, phục vụ bàn và xác nhận thu tiền.'],
          ['Bếp', 'Tiếp nhận lượt gọi, chế biến và báo món sẵn sàng.'],
          ['Quản trị', 'Quản lý món, công thức, kho và tài khoản nhân viên.'],
        ].map(([name, description]) => (
          <article key={name}>
            <h3>{name}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <footer>
        <a href="/login">Không gian nội bộ</a>
        <a href="/api-docs">Tài liệu API</a>
      </footer>
    </main>
  );
}
