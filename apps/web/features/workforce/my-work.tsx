'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, type Row } from '../shared/components';
import { Empty } from '../shared/primitives';
import { moment } from './format';
import { Slip, day, payrollStatus } from './payroll-panel';
export default function MyWork() {
  const [assignments, setAssignments] = useState<Row[]>([]),
    [payroll, setPayroll] = useState<{ slips: Row[]; lines: Row[]; runs: Row[] }>(),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [work, pay] = await Promise.all([
        api<{ assignments: Row[] }>('/core/workforce/me'),
        api<{ slips: Row[]; lines: Row[]; runs: Row[] }>('/core/payroll/me'),
      ]);
      setAssignments(work.assignments);
      setPayroll(pay);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <section className="core-app">
      <h2>Lịch làm & lương của tôi</h2>
      <p>
        Giờ Việt Nam (UTC+7). Vào ca sớm tối đa 30 phút. Giờ công tính lương do quản trị duyệt sau
        khi ca kết thúc.
      </p>
      <Action run={refresh}>Tải lại lịch cá nhân</Action>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!assignments.length && <Empty title="Chưa được phân ca" />}
      <div className="core-grid">
        {assignments.map((a) => (
          <article className="core-card" key={a.id}>
            <h3>{String(a.shift_name)}</h3>
            <p>
              {moment(a.starts_at)} → {moment(a.ends_at)}
            </p>
            <p>
              {String(a.area_name ?? 'Toàn nhà hàng / bếp')} · Nghỉ {String(a.break_minutes)} phút
            </p>
            <p>
              Vào: {moment(a.checked_in_at)}
              <br />
              Ra: {moment(a.checked_out_at)}
            </p>
            {a.status === 'CANCELLED' ? (
              <p>Đã hủy phân công</p>
            ) : a.attendance_status === 'APPROVED' ? (
              <p>
                Đã duyệt {String(a.approved_minutes)} phút. {String(a.review_note)}
              </p>
            ) : (
              <>
                {!a.attendance_id &&
                  Date.now() >= new Date(String(a.starts_at)).getTime() - 1800000 &&
                  Date.now() <= new Date(String(a.ends_at)).getTime() && (
                    <Action
                      run={async () => {
                        await api('/core/workforce/assignments/' + a.id + '/check-in', {});
                        await refresh();
                      }}
                    >
                      Vào ca
                    </Action>
                  )}
                {a.checked_in_at && !a.checked_out_at && (
                  <Action
                    run={async () => {
                      await api('/core/workforce/assignments/' + a.id + '/check-out', {});
                      await refresh();
                    }}
                  >
                    Ra ca
                  </Action>
                )}
                <p className="small-note">Chưa duyệt công</p>
              </>
            )}
          </article>
        ))}
      </div>
      <h2>Phiếu lương đã chốt</h2>
      {!payroll?.slips.length && <Empty title="Chưa có phiếu lương đã chốt" />}
      {payroll?.slips.map((s) => {
        const p = payroll.runs.find((p) => p.id === s.payroll_run_id)!;
        return (
          <section key={s.id}>
            <h3>
              {day(p.period_start)} → trước {day(p.period_end)} · {payrollStatus(p.status)}
            </h3>
            <Slip slip={s} lines={payroll.lines} />
          </section>
        );
      })}
    </section>
  );
}
