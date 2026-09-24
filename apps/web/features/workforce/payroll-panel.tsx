'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, EntryForm, vnd, type Row } from '../shared/components';
import { Empty } from '../shared/primitives';
export type PayrollDetail = { run: Row; slips: Row[]; lines: Row[] };
export const payrollStatus = (s: unknown) =>
  s === 'PAID' ? 'Đã ghi nhận chi lương' : s === 'FINALIZED' ? 'Đã chốt' : 'Bản nháp';
export const day = (s: unknown) => String(s).slice(0, 10);
export function Slip({ slip, lines }: { slip: Row; lines: Row[] }) {
  return (
    <article className="core-card">
      <h3>
        {String(slip.employee_name_snapshot)} · {String(slip.username_snapshot)}
      </h3>
      {lines
        .filter((l) => l.payroll_slip_id === slip.id)
        .map((l) => (
          <div className="core-line" key={l.id}>
            <span>
              {String(l.description)}
              {l.line_type === 'WORK' && (
                <small>
                  {' '}
                  · {String(l.minutes)} phút × {vnd(l.hourly_rate_snapshot)}/giờ
                </small>
              )}
            </span>
            <strong>{vnd(l.amount)}</strong>
          </div>
        ))}
      <div className="core-line">
        <strong>Thực nhận</strong>
        <strong>{vnd(slip.total_amount)}</strong>
      </div>
    </article>
  );
}
export default function PayrollPanel() {
  const [runs, setRuns] = useState<Row[]>([]),
    [detail, setDetail] = useState<PayrollDetail>(),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setRuns(await api('/core/payroll'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function open(id: string) {
    setDetail(await api('/core/payroll/' + id));
  }
  async function act(suffix: string, b: unknown) {
    await api('/core/payroll/' + detail!.run.id + suffix, b);
    await open(detail!.run.id);
    await refresh();
  }
  return (
    <>
      <p>
        Lương nội bộ theo giờ công đã duyệt, cộng thưởng và trừ các khoản được nhập rõ lý do. Chưa
        tự tính thuế, bảo hiểm hoặc hệ số làm thêm giờ.
      </p>
      <EntryForm
        title="Lập bảng lương nháp"
        fields={[
          { key: 'periodStart', label: 'Từ ngày (bao gồm)', type: 'date' },
          { key: 'periodEnd', label: 'Đến trước ngày (không bao gồm)', type: 'date' },
        ]}
        onSubmit={async (v) => {
          const run = await api<Row>('/core/payroll', v);
          await refresh();
          await open(run.id);
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!runs.length && <Empty title="Chưa có kỳ lương" />}
      <div className="core-grid">
        {runs.map((p) => (
          <article className="core-card" key={p.id}>
            <h3>
              {day(p.period_start)} → trước {day(p.period_end)}
            </h3>
            <p>
              {payrollStatus(p.status)} · {String(p.employee_count)} nhân viên
            </p>
            <strong>{vnd(p.total_amount)}</strong>
            <Action run={() => open(p.id)}>Xem bảng lương</Action>
          </article>
        ))}
      </div>
      {detail && (
        <section aria-label="Chi tiết bảng lương">
          <h2>Chi tiết kỳ lương · {payrollStatus(detail.run.status)}</h2>
          {detail.slips.map((s) => (
            <Slip key={s.id} slip={s} lines={detail.lines} />
          ))}
          {detail.run.status === 'DRAFT' && (
            <>
              <EntryForm
                title="Thưởng / khấu trừ"
                fields={[
                  {
                    key: 'slipId',
                    label: 'Nhân viên',
                    options: detail.slips.map((s) => ({
                      value: s.id,
                      label: String(s.employee_name_snapshot) + ' · ' + s.username_snapshot,
                    })),
                  },
                  {
                    key: 'type',
                    label: 'Loại khoản',
                    options: [
                      { value: 'BONUS', label: 'Thưởng / phụ cấp' },
                      { value: 'DEDUCTION', label: 'Khấu trừ' },
                    ],
                  },
                  { key: 'amount', label: 'Số tiền (nhập số dương)', type: 'number', min: 1 },
                  { key: 'description', label: 'Nội dung và lý do' },
                ]}
                onSubmit={(v) => act('/adjustments', v)}
              />
              <Action
                confirm="Chốt bảng lương? Sau khi chốt không sửa được số liệu và nhân viên sẽ thấy phiếu lương."
                run={() => act('/finalize', {})}
              >
                Chốt bảng lương
              </Action>
              <Action
                confirm="Xóa bản nháp cùng các khoản thưởng/khấu trừ để lập lại? Giờ công được duyệt vẫn giữ nguyên."
                run={async () => {
                  await api('/core/payroll/' + detail.run.id, {}, 'DELETE');
                  setDetail(undefined);
                  await refresh();
                }}
              >
                Xóa bản nháp
              </Action>
            </>
          )}
          {detail.run.status === 'FINALIZED' && (
            <EntryForm
              title="Ghi nhận đã chi đủ lương cho cả kỳ"
              fields={[{ key: 'reference', label: 'Chứng từ / nội dung chi tiền thực tế' }]}
              onSubmit={(v) => act('/paid', v)}
            />
          )}
          {detail.run.status === 'PAID' && (
            <p>Chứng từ chi: {String(detail.run.payment_reference)}</p>
          )}
        </section>
      )}
    </>
  );
}
