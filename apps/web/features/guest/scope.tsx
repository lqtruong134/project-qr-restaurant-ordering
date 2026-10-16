import type { ReactNode } from 'react';
export function GuestScope({
  value,
  change,
  children,
}: {
  value: 'mine' | 'table';
  change: (value: 'mine' | 'table') => void;
  children?: ReactNode;
}) {
  return (
    <div className="guest-scope" role="group" aria-label="Xem món theo người gọi">
      {(['table', 'mine'] as const).map((scope) => (
        <button
          className="secondary-button"
          type="button"
          key={scope}
          aria-pressed={value === scope}
          onClick={() => change(scope)}
        >
          {scope === 'table' ? 'Cả bàn' : 'Món của tôi'}
        </button>
      ))}
      {children}
    </div>
  );
}
