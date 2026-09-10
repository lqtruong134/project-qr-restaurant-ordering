import { StatusBadge } from '@thesis/ui';
import type { ServiceHealth } from '@thesis/contracts';
export const dynamic = 'force-dynamic';
export default async function Home() {
  let ready = false;
  try {
    const response = await fetch(`${process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'}/health/ready`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const health: ServiceHealth = await response.json();
    ready = response.ok && health.status === 'ok' && health.database === 'connected';
  } catch { /* The status card provides a recoverable offline state. */ }
  return <main>
    <header><a href="/" className="brand"><span className="brand-mark">Q</span> QR Ordering</a><span className="eyebrow">LUẬN VĂN · 2026</span></header>
    <section className="intro"><span className="eyebrow">SPRINT 01 / NỀN TẢNG</span><h1>Khởi đầu từ một<br/><em>nền tảng vững chắc.</em></h1><p>Môi trường phát triển cho website gọi món tại bàn.<br/>Kiểm tra kết nối và truy cập không gian nội bộ.</p></section>
    <section className="status-card" aria-label="Trạng thái hệ thống"><div><span className="eyebrow">KẾT NỐI HỆ THỐNG</span><h2>{ready ? 'Môi trường đã sẵn sàng' : 'Cần kiểm tra kết nối'}</h2><p>{ready ? 'Giao diện, API và PostgreSQL đang kết nối.' : 'Khởi động API và database, sau đó tải lại trang.'}</p></div><StatusBadge ready={ready}>{ready ? 'Hoạt động' : 'Chưa kết nối'}</StatusBadge></section>
    <section className="milestones" aria-label="Lộ trình Sprint 1">{[
      ['01', 'Bộ khung dự án', 'Môi trường và kiểm tra chất lượng', 'Đã kiểm thử'],
      ['02', 'Thiết kế dữ liệu', 'ERD và migration 14 bảng C0–C1', 'Đã tạo 14 bảng'],
      ['03', 'Đăng nhập & quyền', 'Staff · Kitchen · Admin', 'Sẵn sàng nghiệm thu'],
      ['04', 'Dữ liệu & demo', 'Seed, từ điển dữ liệu và diễn tập', 'Sẵn sàng nghiệm thu'],
    ].map(([n, title, detail, status]) => <article key={n}><span className="step">{n}</span><h3>{title}</h3><p>{detail}</p><small>{status}</small></article>)}</section>
    <footer><span>Mốc Sprint Review</span><strong>20 tháng 09, 2026</strong><span>Sprint 1 · Môi trường local</span></footer>
  <p style={{marginTop:24}}><a className="primary-button" href="/login">Đăng nhập nội bộ</a> <a className="secondary-button" href="/api-docs">Demo API — Swagger UI</a></p></main>;
}
