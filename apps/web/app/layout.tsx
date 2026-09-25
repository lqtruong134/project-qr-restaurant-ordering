import type { Metadata } from 'next';
import './globals.css';
import AuthBoundary from '../features/shared/auth-boundary';
export const metadata: Metadata = {
  title: 'Quyết Trường Bistro · Gọi món tại bàn',
  description: 'Trải nghiệm gọi món tại bàn của Quyết Trường Bistro.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthBoundary>{children}</AuthBoundary>
      </body>
    </html>
  );
}
