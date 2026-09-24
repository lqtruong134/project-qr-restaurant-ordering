import Link from 'next/link';
import { Icon } from '../features/shared/primitives';
export default function Home() {
  return (
    <main className="landing">
      <header className="landing-header">
        <Link href="/" className="brand-lockup">
          <span className="brand-symbol">
            <Icon name="leaf" />
          </span>
          <div>
            <strong>QUYẾT TRƯỜNG</strong>
            <small>Vietnamese Bistro</small>
          </div>
        </Link>
        <Link className="secondary-button" href="/login">
          Đăng nhập nội bộ <Icon name="arrow" size={15} />
        </Link>
      </header>
      <section className="landing-hero">
        <div>
          <p className="eyebrow">ẨM THỰC VIỆT · NHỮNG KHOẢNH KHẮC GẦN NHAU</p>
          <h1>
            Món ngon trên bàn.
            <br />
            <em>Niềm vui ở lại.</em>
          </h1>
          <p>
            Chọn món theo cách của bạn. Quét mã QR tại bàn để khám phá thực đơn, gọi món và cùng
            nhau tận hưởng bữa ăn.
          </p>
          <div className="guest-table" style={{ display: 'inline-flex' }}>
            <Icon name="table" />
            Bạn đã đến nhà hàng? Quét QR trên bàn nhé.
          </div>
        </div>
        <div className="landing-visual">
          <img src="/menu/rice.svg" alt="Minh họa món Việt được trình bày trên đĩa" />
          <span className="landing-caption">Thân quen trong từng hương vị.</span>
        </div>
      </section>
      <section className="landing-features">
        {[
          [
            'menu',
            'Chọn món thật dễ',
            'Khám phá thực đơn và thêm những món yêu thích vào giỏ chung của bàn.',
          ],
          [
            'chef',
            'Theo dõi từng món',
            'Biết khi nào bếp đang chuẩn bị và món ngon đã sẵn sàng phục vụ.',
          ],
          [
            'bell',
            'Hỗ trợ ngay tại bàn',
            'Cần thêm nước, dụng cụ hay tính tiền? Gửi yêu cầu ngay trên điện thoại.',
          ],
        ].map(([icon, title, text]) => (
          <article key={title}>
            <Icon name={icon!} size={25} />
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <footer className="landing-footer">
        <span>QUYẾT TRƯỜNG BISTRO · Trân trọng từng bữa ăn</span>
        <Link href="/login">Dành cho đội ngũ nhà hàng</Link>
      </footer>
    </main>
  );
}
