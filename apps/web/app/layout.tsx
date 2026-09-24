import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Quyết Trường Bistro · Gọi món tại bàn',
  description: 'Trải nghiệm gọi món tại bàn của Quyết Trường Bistro.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
