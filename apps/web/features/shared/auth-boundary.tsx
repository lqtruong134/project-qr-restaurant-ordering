'use client';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Modal } from './primitives';
import {
  getAuthFailure,
  getPermissionNotice,
  subscribeAuth,
  clearPermissionNotice,
} from '../../lib/api-client';
export default function AuthBoundary({ children }: { children: ReactNode }) {
  const failure = useSyncExternalStore(subscribeAuth, getAuthFailure, () => undefined);
  const notice = useSyncExternalStore(subscribeAuth, getPermissionNotice, () => '');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(clearPermissionNotice, 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (failure)
    return (
      <div className="auth-blocked-screen">
        <Modal
          blocking
          title={
            failure.errorCode === 'ACCOUNT_LOCKED'
              ? 'Tài khoản đã bị khóa'
              : failure.errorCode === 'INVALID_CREDENTIALS'
                ? 'Đăng nhập không thành công'
                : 'Phiên làm việc hết hạn'
          }
          close={() => {}}
        >
          <p>{failure.userMessage}</p>
          <button className="primary-button" onClick={() => window.location.replace('/login')}>
            Về trang đăng nhập
          </button>
        </Modal>
      </div>
    );
  return (
    <>
      {children}
      {notice && (
        <div className="permission-toast" role="alert">
          {notice}
        </div>
      )}
    </>
  );
}
