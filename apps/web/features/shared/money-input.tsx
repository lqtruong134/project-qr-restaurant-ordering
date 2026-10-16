'use client';
import { useEffect, useId, useRef } from 'react';
import { vnd } from './components';
import { moneySuggestions } from './money-suggestions';
import { formatMoneyInput, parseMoneyInput } from './money-format';

export function MoneyInput({
  label,
  value,
  onChange,
  min = '1',
  max,
  presets = [],
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  presets?: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const parsed = parseMoneyInput(value);
  const valid = parsed !== null && parsed !== '';
  const amount = valid ? BigInt(parsed) : 0n;
  const message =
    !valid && value
      ? 'Nhập số tiền bằng đồng, không dùng số âm hoặc số lẻ.'
      : valid && amount < BigInt(min)
        ? 'Số tiền phải từ ' + vnd(min) + '.'
        : valid && max && amount > BigInt(max)
          ? 'Số tiền tối đa là ' + vnd(max) + '.'
          : '';
  useEffect(() => input.current?.setCustomValidity(message), [message]);
  return (
    <div className="money-entry">
      <label htmlFor={id}>{label}</label>
      <div className="money-entry-field">
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={formatMoneyInput(value)}
          required
          disabled={disabled}
          aria-invalid={!!message}
          aria-describedby={id + '-hint'}
          onChange={(e) => {
            const text = e.target.value;
            const native = e.nativeEvent as InputEvent;
            const editingDigits =
              native.inputType?.startsWith('delete') ||
              (native.inputType === 'insertText' && /^\d+$/.test(native.data ?? ''));
            const candidate =
              editingDigits && /^[\d.]*$/.test(text) ? text.replace(/\./g, '') : text;
            const offset = text
              .slice(0, e.target.selectionStart ?? text.length)
              .replace(/\D/g, '').length;
            onChange(parseMoneyInput(candidate) ?? candidate);
            requestAnimationFrame(() => {
              const field = input.current;
              if (!field || document.activeElement !== field) return;
              let position = 0,
                digits = 0;
              while (position < field.value.length && digits < offset) {
                if (/\d/.test(field.value[position]!)) digits++;
                position++;
              }
              field.setSelectionRange(position, position);
            });
          }}
        />
        <span aria-hidden="true">VNĐ</span>
      </div>
      <p id={id + '-hint'} className={message ? 'form-error' : 'small-note'}>
        {message || 'Nhập số tiền chính xác hoặc chọn mốc bên dưới. Mỗi lần tăng/giảm là 10.000 đ.'}
      </p>
      {valid && moneySuggestions(parsed, min, max).length > 0 && (
        <div className="money-suggestions" aria-label="Gợi ý số tiền từ số vừa nhập">
          <small>Bạn muốn nhập</small>
          {moneySuggestions(parsed, min, max).map((n) => (
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              key={n}
              onClick={() => onChange(n)}
            >
              {vnd(n)}
            </button>
          ))}
        </div>
      )}
      <div className="money-chips" aria-label={'Chọn nhanh ' + label.toLowerCase()}>
        {[-1n, 1n].map((direction) => {
          const next = amount + direction * 10000n;
          return (
            <button
              type="button"
              key={direction.toString()}
              disabled={disabled || !valid || next < BigInt(min) || (!!max && next > BigInt(max))}
              aria-label={(direction < 0 ? 'Giảm' : 'Tăng') + ' 10.000 đ: ' + label}
              onClick={() => onChange(next.toString())}
            >
              {direction < 0 ? '−' : '+'} 10.000 đ
            </button>
          );
        })}
        {presets.map((preset) => (
          <button
            type="button"
            key={preset.value}
            disabled={disabled}
            aria-pressed={parsed === preset.value}
            onClick={() => onChange(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
