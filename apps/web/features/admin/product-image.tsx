'use client';
import { useState } from 'react';
import { api } from '../shared/components';
export function ProductImage({ save }: { save: (url: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div>
      <label>
        Ảnh món (PNG, JPEG, WebP; tối đa 2 MB)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              if (file.size > 2 * 1024 * 1024) throw new Error('Ảnh tối đa 2 MB.');
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]!);
                reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
                reader.readAsDataURL(file);
              });
              const result = await api<{ imageUrl: string }>('/core/menu-images', { data });
              await save(result.imageUrl);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Chưa tải được ảnh.');
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p>Đang lưu ảnh…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
