'use client';
import { useState } from 'react';
import { reasonOptions, type OrderReasonCode } from '@thesis/contracts';
import { Icon } from '../shared/primitives';
import { notifySuccess } from '../shared/operation-notice';
export function KitchenIssue({ submit }: { submit: (body: unknown) => Promise<void> }) {
  const [reason, setReason] = useState<OrderReasonCode>(),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details className="kitchen-issue">
      <summary>
        <Icon name="warning" size={16} /> Báo sự cố và dừng món
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason) return;
          setBusy(true);
          setError('');
          try {
            await submit({ reasonCode: reason, note });
            notifySuccess('Đã báo sự cố và dừng món.');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h4>Món gặp vấn đề gì?</h4>
        <div className="issue-reasons" role="group" aria-label="Lý do dừng món">
          {reasonOptions('KITCHEN_ISSUE').map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={reason === option.value}
              disabled={busy}
              onClick={() => {
                setReason(option.value as OrderReasonCode);
                if (option.value !== 'OTHER') setNote('');
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {reason === 'OTHER' && (
          <label>
            Lý do khác - Vui lòng ghi rõ
            <textarea
              rows={2}
              required
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Nhập lý do món không thể tiếp tục phục vụ"
            />
          </label>
        )}
        <p className="small-note">
          Dừng món và báo phục vụ đến trao đổi với khách. Quản trị sẽ xem xét món có tính tiền hay
          không.
        </p>
        <button className="primary-button" disabled={!reason || busy}>
          {busy ? 'Đang gửi…' : 'Dừng món và báo sự cố'}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
