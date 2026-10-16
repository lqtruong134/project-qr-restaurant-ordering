'use client';
import { useEffect, useState } from 'react';

export function QuantityStepper({
  value,
  onChange,
  label = 'Số lượng',
  min = 1,
  max = 99,
  disabled = false,
}: {
  value: number;
  onChange: (quantity: number) => void;
  label?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit(next: number) {
    if (!Number.isInteger(next) || next < min || next > max) {
      setDraft(String(value));
      return;
    }
    // Keep the confirmed quantity until the parent accepts the change.
    setDraft(String(value));
    if (next !== value) onChange(next);
  }
  return (
    <div className="quantity-stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={'Giảm ' + label.toLowerCase()}
        disabled={disabled || value <= min}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit(value - 1)}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        value={draft}
        disabled={disabled}
        maxLength={String(max).length}
        autoComplete="off"
        onChange={(e) => {
          if (/^\d*$/.test(e.target.value)) setDraft(e.target.value);
        }}
        onBlur={() => commit(Number(draft))}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
            e.preventDefault();
            commit(e.key === 'Enter' ? Number(draft) : value + (e.key === 'ArrowUp' ? 1 : -1));
          }
        }}
      />
      <button
        type="button"
        aria-label={'Tăng ' + label.toLowerCase()}
        disabled={disabled || value >= max}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit(value + 1)}
      >
        +
      </button>
    </div>
  );
}
