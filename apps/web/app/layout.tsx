import './support.css';
import './table-transfer.css';
import type { Metadata } from 'next';
import './globals.css';
import AuthBoundary from '../features/shared/auth-boundary';
import { DiscardDialogHost } from '../features/shared/primitives';
import { OperationNoticeHost } from '../features/shared/operation-notice';
export const metadata: Metadata = {
  title: 'Quyết Trường Bistro · Gọi món tại bàn',
  description: 'Trải nghiệm gọi món tại bàn của Quyết Trường Bistro.',
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthBoundary>
          {children}
          <DiscardDialogHost />
          <OperationNoticeHost />
        </AuthBoundary>
      </body>
    </html>
  );
}
