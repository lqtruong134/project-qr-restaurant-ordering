'use client';
import { useState } from 'react';
import { api } from '../shared/components';
import { confirmDiscard } from '../shared/primitives';
export function ProductImage({
  save,
  label = 'Thay ảnh món (PNG, JPEG, WebP; tối đa 2 MB)',
  successMessage = 'Đã thay ảnh món. Thực đơn khách sẽ sử dụng ảnh mới.',
  confirmDiscardBeforeUpload = true,
  disabled = false,
  onBusyChange,
}: {
  save: (url: string) => Promise<void>;
  label?: string;
  successMessage?: string;
  confirmDiscardBeforeUpload?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  return (
    <div className="image-upload">
      <label>
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || disabled}
          onChange={async (e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            if (
              confirmDiscardBeforeUpload &&
              !(await confirmDiscard(input.closest('.product-editor')))
            ) {
              input.value = '';
              return;
            }
            setBusy(true);
            onBusyChange?.(true);
            setError('');
            setMessage('');
            try {
              if (file.size > 2 * 1024 * 1024) throw new Error('Ảnh tối đa 2 MB.');
              if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
                throw new Error('Chọn ảnh PNG, JPEG hoặc WebP.');
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]!);
                reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
                reader.readAsDataURL(file);
              });
              await new Promise<void>((resolve, reject) => {
                const preview = new Image();
                preview.onload = () => resolve();
                preview.onerror = () =>
                  reject(new Error('Không đọc được nội dung ảnh. Vui lòng chọn ảnh khác.'));
                preview.src = 'data:' + file.type + ';base64,' + data;
              });
              const result = await api<{ imageUrl: string }>('/core/menu-images', { data });
              await save(result.imageUrl);
              setMessage(successMessage);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Chưa tải được ảnh.');
            } finally {
              setBusy(false);
              onBusyChange?.(false);
              input.value = '';
            }
          }}
        />
      </label>
      <p>
        Ưu tiên ảnh thật, đặt món ở giữa khung. Gợi ý 1200 × 900 px; ảnh ngang hoặc dọc đều dùng
        được.
      </p>
      {busy && <p>Đang lưu ảnh…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
