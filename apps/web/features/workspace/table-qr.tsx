'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../shared/components';

export function StaffTableQr({
  tableId,
  initiallyExpanded = false,
}: {
  tableId: string;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [qr, setQr] = useState<{ image: string; table: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setQr(undefined);
    setError('');
    if (!expanded) return;
    void (async () => {
      try {
        const result = await api<{ available: boolean; table?: string; joinPath?: string }>(
          `/core/tables/${tableId}/qr`,
        );
        if (!result.available || !result.joinPath)
          throw new Error('Bàn chưa có QR hợp lệ. Nhờ quản trị kiểm tra.');
        const image = await QRCode.toDataURL(new URL(result.joinPath, location.origin).href, {
          width: 320,
          margin: 4,
          errorCorrectionLevel: 'M',
        });
        if (active) setQr({ image, table: result.table ?? '' });
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [expanded, tableId]);
  return (
    <details
      className="staff-table-qr"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>QR bàn</summary>
      {expanded && (
        <div className="staff-table-qr-content">
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : qr ? (
            <>
              <strong>{qr.table}</strong>
              <img src={qr.image} width={320} height={320} alt={'QR gọi món — ' + qr.table} />
              <p>Khách quét để mở thực đơn. Mã vào bàn được cấp riêng.</p>
            </>
          ) : (
            <p role="status">Đang tải QR bàn…</p>
          )}
        </div>
      )}
    </details>
  );
}
