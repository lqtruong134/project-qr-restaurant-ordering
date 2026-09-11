import type { ReactNode } from 'react';
export function StatusBadge({ children, ready }: { children: ReactNode; ready: boolean }) {
  return (
    <span className={ready ? 'badge ready' : 'badge pending'}>
      {ready ? '● ' : '○ '}
      {children}
    </span>
  );
}
