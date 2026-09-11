import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'QR Ordering · Sprint 1',
  description: 'Môi trường phát triển luận văn gọi món tại bàn.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
