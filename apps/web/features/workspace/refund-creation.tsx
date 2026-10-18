'use client';
import { useState } from 'react';
import { EntryForm, vnd, type Row } from '../shared/components';
import { restaurantDateTime } from '../shared/restaurant-time';
import { refundableSources, refundReasonForSource } from '../shared/refund-source';

export function RefundCreation({
  payments,
  unassigned,
  decisionReason,
  submit,
}: {
  payments: Row[];
  unassigned: bigint;
  decisionReason?: string;
  submit: (values: Record<string, string | boolean>) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const sources = refundableSources(payments);
  const source = sources.find((entry) => entry.payment.id === selected) ?? sources[0];
  if (!source)
    return (
      <p role="alert" className="form-error">
        Không còn giao dịch có thể lập phiếu hoàn. Tải lại để đối chiếu các phiếu đã lập.
      </p>
    );
  const limit = source.available < unassigned ? source.available : unassigned;
  const { useDecisionReason, reason: defaultReason } = refundReasonForSource(
    source.payment,
    decisionReason,
  );
  return (
    <section className="refund-creation" aria-label="Lập hồ sơ hoàn tiền">
      <label className="refund-source-field">
        <span className="field-label">Giao dịch gốc</span>
        <select
          aria-label="Giao dịch gốc"
          value={source.payment.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {sources.map(({ payment, available }) => (
            <option key={payment.id} value={payment.id}>
              {payment.method === 'CASH'
                ? 'Tiền mặt'
                : payment.method === 'BANK_TRANSFER'
                  ? 'Chuyển khoản'
                  : 'Thanh toán trực tuyến'}{' '}
              · {vnd(payment.amount)} · Còn có thể hoàn {vnd(available)} ·{' '}
              {restaurantDateTime(payment.created_at)}
            </option>
          ))}
        </select>
      </label>
      <p className="small-note">
        Giao dịch này còn có thể lập phiếu hoàn {vnd(source.available)}. Tổng chưa lập phiếu của
        bàn: {vnd(unassigned)}.
      </p>
      {unassigned > source.available && (
        <p className="small-note">
          Khoản cần hoàn thuộc nhiều giao dịch. Lập phiếu cho giao dịch này, rồi tiếp tục với giao
          dịch còn lại.
        </p>
      )}
      {useDecisionReason && <p className="small-note">Lý do hoàn tiền: {decisionReason}</p>}
      <EntryForm
        key={source.payment.id + ':' + limit.toString() + ':' + String(useDecisionReason)}
        title="Lập hồ sơ hoàn tiền"
        submit="Lập hồ sơ hoàn tiền"
        successMessage="Đã lập hồ sơ hoàn tiền. Nhân viên sẽ trả tiền cho khách."
        confirmLabel="Lập hồ sơ hoàn tiền"
        confirm={(values) =>
          'Duyệt hoàn ' +
          vnd(values.amount) +
          ' từ giao dịch ' +
          vnd(source.payment.amount) +
          '? Nhân viên sẽ nhận việc trả tiền. Đây chưa phải tiền đã hoàn thực tế.'
        }
        fields={[
          {
            key: 'amount',
            label: 'Số tiền hoàn',
            type: 'number',
            min: 1,
            max: Number(limit),
            value: limit.toString(),
          },
          ...(!useDecisionReason
            ? [
                {
                  key: 'reason',
                  label: 'Lý do hoàn',
                  value: defaultReason,
                },
              ]
            : []),
        ]}
        onSubmit={(values) =>
          submit({
            ...values,
            paymentId: source.payment.id,
            ...(useDecisionReason ? { useDecisionReason: true } : {}),
          })
        }
      />
    </section>
  );
}
