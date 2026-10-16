'use client';
import { useEffect, useRef, useState } from 'react';
import { api, vnd, type Row } from '../shared/components';
import { localInstant } from './format';
import PayBreakdown from './pay-breakdown';
import WorkforceForm from './workforce-form';
import { Badge, clock, duration, Hint, Person, shiftTime } from './ui';
export const attendanceLabels: Record<string, string> = {
  NORMAL: 'Hoàn thành ca',
  LATE: 'Đi muộn',
  EARLY_LEAVE: 'Về sớm',
  MISSING_IN: 'Thiếu giờ vào',
  MISSING_OUT: 'Thiếu giờ ra',
  OUTSIDE: 'Có giờ làm ngoài ca',
  ACTIVE: 'Đang trong ca',
  SCHEDULED: 'Đã phân công',
  APPROVED: 'Đã duyệt',
  LEAVE: 'Nghỉ được ghi nhận',
  ABSENT: 'Vắng',
  CANCELLED: 'Đã hủy',
};
export default function AttendanceReview(props: { row: Row; done: () => Promise<void> }) {
  return props.row.pay_policy_active ? (
    <PolicyAttendanceReview {...props} />
  ) : (
    <LegacyAttendanceReview {...props} />
  );
}
function LegacyAttendanceReview({ row: a, done }: { row: Row; done: () => Promise<void> }) {
  const missing = !a.checked_in_at || !a.checked_out_at;
  const [mode, setMode] = useState(
      missing || Number(a.actual_minutes) === 0 ? 'ZERO' : a.requires_exception ? 'ACTUAL' : 'FULL',
    ),
    [zero, setZero] = useState('ABSENT'),
    [hours, setHours] = useState(Math.floor(Number(a.suggested_minutes) / 60)),
    [minutes, setMinutes] = useState(Number(a.suggested_minutes) % 60);
  const paid =
    mode === 'FULL'
      ? Number(a.scheduled_minutes)
      : mode === 'ACTUAL'
        ? Number(a.actual_minutes)
        : mode === 'ZERO'
          ? 0
          : hours * 60 + minutes;
  return (
    <div className="wf-form-modal">
      <Person name={a.display_name} sub={`${a.shift_name} - ${shiftTime(a)}`} />
      <Badge tone={a.requires_exception ? 'amber' : 'green'}>
        {attendanceLabels[String(a.classification)] ?? 'Cần duyệt công'}
      </Badge>
      <div className="wf-review-summary">
        <div>
          <span>Vào / ra thực tế</span>
          <strong>
            {clock(a.checked_in_at)} / {clock(a.checked_out_at)}
          </strong>
        </div>
        <div>
          <span>Giờ công theo lịch</span>
          <strong>{duration(a.scheduled_minutes)}</strong>
        </div>
        <div>
          <span>Công thực tế trong lịch</span>
          <strong>{duration(a.actual_minutes)}</strong>
        </div>
      </div>
      <p>
        {Number(a.late_minutes) > 0 && `Vào muộn ${a.late_minutes} phút. `}
        {Number(a.early_leave_minutes) > 0 && `Ra sớm ${a.early_leave_minutes} phút. `}
        {Number(a.outside_minutes) > 0 &&
          `${a.outside_minutes} phút ngoài ca chưa được tính vào tiền công.`}
      </p>
      <WorkforceForm
        submit="Duyệt công"
        successMessage={`Đã duyệt giờ công cho ${String(a.display_name)}.`}
        confirm={() =>
          `Duyệt ${duration(paid)} cho ${a.display_name}? Giờ chấm công thực tế giữ nguyên. Công này sẽ dùng để tính lương. Sau khi duyệt, bạn không thể sửa lại số công.`
        }
        onSubmit={async (v) => {
          await api('/core/workforce/assignments/' + a.id + '/approve', {
            minutes: paid,
            note: v.get('note'),
            approvalMode: mode,
            approveExtra: mode === 'EXCEPTION' || mode === 'FULL',
            outcome: mode === 'ZERO' ? zero : missing ? 'MISSED_CLOCK' : 'WORKED',
          });
          await done();
        }}
      >
        <label>
          Cách tính công
          <select name="approvalMode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="FULL">Tính đủ ca</option>
            <option value="ACTUAL" disabled={missing}>
              Tính theo thời gian thực tế trong ca
            </option>
            <option value="ZERO">Không tính công</option>
            <option value="EXCEPTION">Nhập số công sau khi kiểm tra thực tế</option>
          </select>
        </label>
        {mode === 'ZERO' && (
          <label>
            Kết quả ca làm
            <select name="outcome" value={zero} onChange={(e) => setZero(e.target.value)}>
              <option value="ABSENT">Vắng</option>
              <option value="LEAVE">Nghỉ được ghi nhận (không tính công)</option>
            </select>
          </label>
        )}
        {mode === 'EXCEPTION' && (
          <div className="core-fields">
            <label>
              Giờ công được duyệt
              <input
                name="hours"
                type="number"
                min={0}
                max={16}
                required
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <label>
              Phút công được duyệt
              <input
                name="minutes"
                type="number"
                min={0}
                max={hours === 16 ? 0 : 59}
                required
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
        )}
        <div className="wf-calculation" role="status">
          <span>
            Công được duyệt <strong>{duration(paid)}</strong>
          </span>
          {a.effective_hourly_rate ? (
            <span>
              {a.hourly_rate_override
                ? 'Đơn giá riêng đã lưu cho ca'
                : 'Đơn giá nhân viên tại ngày làm'}{' '}
              <strong>{vnd(a.effective_hourly_rate)} / giờ</strong>
              {' - Tiền công dự kiến '}
              {vnd(Math.round((paid * Number(a.effective_hourly_rate)) / 60))}
            </span>
          ) : (
            <span>
              Chưa có đơn giá tại ngày làm. Thêm đơn giá cho nhân viên trước khi duyệt công.
            </span>
          )}
        </div>
        <label>
          Lý do duyệt hoặc điều chỉnh giờ công
          <input
            name="note"
            required
            maxLength={500}
            defaultValue={
              !a.requires_exception && !missing
                ? 'Đã kiểm tra giờ vào và giờ ra; tính đủ giờ công theo lịch.'
                : ''
            }
          />
        </label>
        <Hint>
          {missing
            ? 'Thiếu giờ vào hoặc giờ ra. Kiểm tra với nhân viên trước khi nhập số công; ghi rõ lý do bổ sung. Giờ chấm công thực tế vẫn được giữ nguyên.'
            : 'Nếu trả công cho giờ làm ngoài ca, chọn nhập số công và ghi rõ lý do. Hệ thống tính theo đơn giá giờ, chưa áp dụng hệ số làm thêm.'}
        </Hint>
      </WorkforceForm>
    </div>
  );
}

type PeriodKind = 'REGULAR' | 'OVERTIME' | 'PAID_HOLIDAY';
type Period = { startsAt: string; endsAt: string; kind: PeriodKind };
type Interval = { key: number; start: string; end: string };
type Preview = {
  approvedMinutes: number;
  hourlyRate: string;
  amount: string;
  payComponents: Parameters<typeof PayBreakdown>[0]['components'];
};
const localInput = (value: unknown) => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(String(value)));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};
const intervalMinutes = (period: Period) =>
  (Date.parse(period.endsAt) - Date.parse(period.startsAt)) / 60000;
function PolicyAttendanceReview({ row: a, done }: { row: Row; done: () => Promise<void> }) {
  const missing = !a.checked_in_at || !a.checked_out_at;
  const [mode, setMode] = useState(
      missing || Number(a.actual_minutes) === 0 ? 'ZERO' : a.requires_exception ? 'ACTUAL' : 'FULL',
    ),
    [zero, setZero] = useState('ABSENT'),
    [note, setNote] = useState(
      !missing && !a.requires_exception ? 'Đã đối chiếu giờ vào và giờ ra.' : '',
    ),
    [breakStart, setBreakStart] = useState(''),
    [breakEnd, setBreakEnd] = useState(''),
    [overtime, setOvertime] = useState(false),
    [consent, setConsent] = useState(false),
    [paidHoliday, setPaidHoliday] = useState(false),
    [manual, setManual] = useState<Interval[]>([
      { key: 1, start: localInput(a.starts_at), end: localInput(a.ends_at) },
    ]),
    [extra, setExtra] = useState<Interval[]>([
      {
        key: 2,
        start: localInput(a.ends_at),
        end: localInput(new Date(Date.parse(String(a.ends_at)) + 3600000)),
      },
    ]),
    [holiday, setHoliday] = useState<Interval[]>([
      {
        key: 3,
        start: localInput(a.starts_at),
        end: localInput(
          new Date(Date.parse(String(a.ends_at)) - Number(a.break_minutes ?? 0) * 60000),
        ),
      },
    ]),
    [preview, setPreview] = useState<{ key: string; value: Preview }>(),
    [previewError, setPreviewError] = useState(''),
    [previewRetry, setPreviewRetry] = useState(0),
    [calculating, setCalculating] = useState(false);
  const sequence = useRef(0),
    nextKey = useRef(4);
  const period = (start: string, end: string, kind: PeriodKind): Period => {
    if (!start || !end)
      throw new Error('Nhập đầy đủ giờ bắt đầu và giờ kết thúc của khoảng tính công.');
    const result = { startsAt: localInstant(start), endsAt: localInstant(end), kind };
    if (intervalMinutes(result) <= 0) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
    return result;
  };
  let periods: Period[] = [],
    inputError = '';
  try {
    if (mode === 'EXCEPTION') periods = manual.map((p) => period(p.start, p.end, 'REGULAR'));
    else if (mode === 'FULL' || mode === 'ACTUAL') {
      if (mode === 'ACTUAL' && missing)
        throw new Error(
          'Thiếu giờ vào hoặc giờ ra; hãy kiểm tra thực tế và nhập khoảng tính công.',
        );
      const start =
          mode === 'FULL'
            ? Date.parse(String(a.starts_at))
            : Math.ceil(
                Math.max(Date.parse(String(a.starts_at)), Date.parse(String(a.checked_in_at))) /
                  60000,
              ) * 60000,
        end =
          mode === 'FULL'
            ? Date.parse(String(a.ends_at))
            : Math.floor(
                Math.min(Date.parse(String(a.ends_at)), Date.parse(String(a.checked_out_at))) /
                  60000,
              ) * 60000;
      if (end <= start) throw new Error('Chưa có thời gian làm việc trong ca để tính công.');
      if (Number(a.break_minutes) > 0) {
        if (!breakStart || !breakEnd)
          throw new Error('Chọn giờ bắt đầu và kết thúc nghỉ để tách đúng giờ thường và giờ đêm.');
        const pause = period(breakStart, breakEnd, 'REGULAR'),
          bs = Date.parse(pause.startsAt),
          be = Date.parse(pause.endsAt);
        if (bs < start || be > end)
          throw new Error('Khoảng nghỉ phải nằm trong khoảng làm việc được tính công.');
        if (intervalMinutes(pause) !== Number(a.break_minutes))
          throw new Error(
            `Khoảng nghỉ phải đủ ${String(a.break_minutes)} phút theo lịch. Nếu thực tế khác, chọn nhập khoảng tính công sau kiểm tra.`,
          );
        if (bs > start)
          periods.push({
            startsAt: new Date(start).toISOString(),
            endsAt: pause.startsAt,
            kind: 'REGULAR',
          });
        if (be < end)
          periods.push({
            startsAt: pause.endsAt,
            endsAt: new Date(end).toISOString(),
            kind: 'REGULAR',
          });
      } else
        periods = [
          {
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            kind: 'REGULAR',
          },
        ];
    }
    if (mode !== 'ZERO' && mode !== 'HOLIDAY' && overtime) {
      if (!consent)
        throw new Error('Xác nhận đã thống nhất giờ làm thêm với nhân viên trước khi duyệt.');
      periods.push(...extra.map((p) => period(p.start, p.end, 'OVERTIME')));
    }
    if (mode === 'HOLIDAY' || (mode !== 'ZERO' && paidHoliday))
      periods.push(...holiday.map((p) => period(p.start, p.end, 'PAID_HOLIDAY')));
  } catch (e) {
    inputError = (e as Error).message;
  }
  const paid = periods.reduce((sum, p) => sum + intervalMinutes(p), 0);
  const body = {
    minutes: paid,
    note,
    approvalMode: mode === 'HOLIDAY' ? 'EXCEPTION' : mode,
    approveExtra: overtime && consent && mode !== 'ZERO' && mode !== 'HOLIDAY',
    outcome:
      mode === 'ZERO'
        ? zero
        : mode === 'HOLIDAY'
          ? 'PAID_HOLIDAY'
          : missing
            ? 'MISSED_CLOCK'
            : 'WORKED',
    paidPeriods: periods,
  };
  const requestKey = JSON.stringify(body);
  useEffect(() => {
    const version = ++sequence.current;
    setPreview(undefined);
    setPreviewError('');
    if (inputError || !note.trim()) {
      setCalculating(false);
      return;
    }
    setCalculating(true);
    const timer = setTimeout(() => {
      void api<Preview>(
        '/core/workforce/assignments/' + a.id + '/pay-preview',
        JSON.parse(requestKey),
      )
        .then((value) => {
          if (version !== sequence.current) return;
          setPreview({ key: requestKey, value });
          setCalculating(false);
        })
        .catch((e) => {
          if (version !== sequence.current) return;
          setPreviewError((e as Error).message);
          setCalculating(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      if (sequence.current === version) sequence.current++;
    };
  }, [a.id, requestKey, inputError, note, previewRetry]);
  const update = (rows: Interval[], key: number, name: 'start' | 'end', value: string) =>
    rows.map((p) => (p.key === key ? { ...p, [name]: value } : p));
  return (
    <div className="wf-form-modal wf-pay-review">
      <Person name={a.display_name} sub={`${a.shift_name} - ${shiftTime(a)}`} />
      <Badge tone={a.requires_exception ? 'amber' : 'green'}>
        {attendanceLabels[String(a.classification)] ?? 'Cần duyệt công'}
      </Badge>
      <div className="wf-review-summary">
        <div>
          <span>Vào / ra thực tế</span>
          <strong>
            {clock(a.checked_in_at)} / {clock(a.checked_out_at)}
          </strong>
        </div>
        <div>
          <span>Công theo lịch</span>
          <strong>{duration(a.scheduled_minutes)}</strong>
        </div>
        <div>
          <span>Công thực tế trong ca</span>
          <strong>{duration(a.actual_minutes)}</strong>
        </div>
      </div>
      <WorkforceForm
        submit="Duyệt công"
        successMessage={`Đã duyệt giờ công cho ${String(a.display_name)}.`}
        confirm={() =>
          `Duyệt ${duration(paid)} cho ${String(a.display_name)}, tiền công ${vnd(preview?.value.amount)}? Giờ chấm công giữ nguyên. Công đã duyệt không thể sửa.`
        }
        onSubmit={async () => {
          if (inputError) throw new Error(inputError);
          if (calculating || !preview || preview.key !== requestKey)
            throw new Error(
              previewError || 'Chờ hệ thống tính tiền dự kiến thành công trước khi duyệt công.',
            );
          try {
            await api('/core/workforce/assignments/' + a.id + '/approve', {
              ...body,
              expectedAmount: preview.value.amount,
            });
          } catch (error) {
            setPreview(undefined);
            setPreviewRetry((value) => value + 1);
            throw error;
          }
          await done();
        }}
      >
        <label>
          Cách tính công
          <select name="approvalMode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="FULL" disabled={missing}>
              Tính đủ ca
            </option>
            <option value="ACTUAL" disabled={missing}>
              Tính theo thời gian thực tế trong ca
            </option>
            <option value="EXCEPTION">Nhập khoảng tính công sau kiểm tra</option>
            <option value="HOLIDAY">Nghỉ lễ hưởng lương</option>
            <option value="ZERO">Không tính công</option>
          </select>
        </label>
        {mode === 'ZERO' && (
          <label>
            Kết quả ca làm
            <select value={zero} onChange={(e) => setZero(e.target.value)}>
              <option value="ABSENT">Vắng</option>
              <option value="LEAVE">Nghỉ được ghi nhận (không tính công)</option>
            </select>
          </label>
        )}
        {(mode === 'FULL' || mode === 'ACTUAL') && Number(a.break_minutes) > 0 && (
          <div className="wf-pay-period-group">
            <h4>Khoảng nghỉ không tính công · {String(a.break_minutes)} phút</h4>
            <div className="core-fields">
              <label>
                Bắt đầu nghỉ
                <input
                  name="breakStart"
                  type="datetime-local"
                  required
                  value={breakStart}
                  onChange={(e) => setBreakStart(e.target.value)}
                />
              </label>
              <label>
                Kết thúc nghỉ
                <input
                  name="breakEnd"
                  type="datetime-local"
                  required
                  value={breakEnd}
                  onChange={(e) => setBreakEnd(e.target.value)}
                />
              </label>
            </div>
            <p>Chọn giờ nghỉ thực tế để phần làm đêm được tính đúng.</p>
          </div>
        )}
        {mode === 'EXCEPTION' && (
          <IntervalFields
            title="Khoảng thời gian được tính công"
            description="Chỉ nhập khoảng thực sự làm việc, bỏ các khoảng nghỉ không tính công. Không sửa giờ chấm công gốc."
            rows={manual}
            onChange={(key, field, value) => setManual(update(manual, key, field, value))}
            onAdd={() => setManual([...manual, { key: nextKey.current++, start: '', end: '' }])}
            onRemove={(key) => setManual(manual.filter((p) => p.key !== key))}
          />
        )}
        {mode !== 'ZERO' && mode !== 'HOLIDAY' && (
          <>
            <label className="wf-checkbox">
              <input
                name="overtime"
                type="checkbox"
                checked={overtime}
                onChange={(e) => setOvertime(e.target.checked)}
              />
              Duyệt thêm giờ làm ngoài ca
            </label>
            {overtime && (
              <>
                <IntervalFields
                  title="Giờ làm thêm được duyệt"
                  description="Chọn riêng từng khoảng làm thêm trước hoặc sau ca. Các khoảng làm việc không được trùng nhau."
                  rows={extra}
                  onChange={(key, field, value) => setExtra(update(extra, key, field, value))}
                  onAdd={() => setExtra([...extra, { key: nextKey.current++, start: '', end: '' }])}
                  onRemove={(key) => setExtra(extra.filter((p) => p.key !== key))}
                />
                <label className="wf-checkbox">
                  <input
                    name="consent"
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  Đã xác nhận giờ làm thêm với nhân viên
                </label>
              </>
            )}
            <label className="wf-checkbox">
              <input
                name="paidHoliday"
                type="checkbox"
                checked={paidHoliday}
                onChange={(e) => setPaidHoliday(e.target.checked)}
              />
              Ghi nhận thêm tiền nghỉ lễ được hưởng
            </label>
          </>
        )}
        {(mode === 'HOLIDAY' || (mode !== 'ZERO' && paidHoliday)) && (
          <IntervalFields
            title="Nghỉ lễ hưởng lương"
            description="Ghi giờ được hưởng theo chế độ, không cần tạo giờ chấm công. Khoản này tách riêng tiền làm trong ngày lễ; chỉ áp dụng ngày đã ghi trong lịch lễ."
            rows={holiday}
            onChange={(key, field, value) => setHoliday(update(holiday, key, field, value))}
            onAdd={() => setHoliday([...holiday, { key: nextKey.current++, start: '', end: '' }])}
            onRemove={(key) => setHoliday(holiday.filter((p) => p.key !== key))}
          />
        )}
        <label>
          Lý do duyệt hoặc điều chỉnh giờ công
          <input
            name="note"
            required
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi kết quả đối chiếu và lý do tính công"
          />
        </label>
        <section className="wf-pay-preview" aria-label="Tiền công dự kiến">
          <h4>Tiền công dự kiến</h4>
          {inputError ? (
            <p className="wf-pay-help">{inputError}</p>
          ) : !note.trim() ? (
            <p>Ghi lý do đối chiếu để xem kết quả tính công.</p>
          ) : calculating ? (
            <p role="status">Đang tính tiền công theo chính sách…</p>
          ) : preview?.key === requestKey ? (
            <>
              <p>
                Công được duyệt: <strong>{duration(preview.value.approvedMinutes)}</strong>
              </p>
              <PayBreakdown components={preview.value.payComponents} />
            </>
          ) : null}
          {previewError && (
            <>
              <p className="form-error" role="alert">
                {previewError}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPreviewRetry((value) => value + 1)}
              >
                Tính lại tiền công
              </button>
            </>
          )}
        </section>
        <Hint>
          Hệ thống tách khoảng làm việc theo ngày, giờ đêm và chính sách có hiệu lực. Quản trị kiểm
          tra tiền công dự kiến trước khi duyệt. Giờ ngoài ca không tự trở thành giờ làm thêm.
        </Hint>
      </WorkforceForm>
    </div>
  );
}
function IntervalFields({
  title,
  description,
  rows,
  onChange,
  onAdd,
  onRemove,
}: {
  title: string;
  description: string;
  rows: Interval[];
  onChange: (key: number, name: 'start' | 'end', value: string) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  return (
    <div className="wf-pay-period-group">
      <h4>{title}</h4>
      <p>{description}</p>
      {rows.map((p, index) => (
        <div className="wf-pay-period-row" key={p.key}>
          <label>
            Bắt đầu · khoảng {index + 1}
            <input
              type="datetime-local"
              required
              value={p.start}
              onChange={(e) => onChange(p.key, 'start', e.target.value)}
            />
          </label>
          <label>
            Kết thúc · khoảng {index + 1}
            <input
              type="datetime-local"
              required
              value={p.end}
              onChange={(e) => onChange(p.key, 'end', e.target.value)}
            />
          </label>
          {rows.length > 1 && (
            <button
              type="button"
              className="secondary-button"
              aria-label={`Bỏ khoảng ${index + 1} trong ${title}`}
              onClick={() => onRemove(p.key)}
            >
              Bỏ khoảng
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={rows.length >= 8}
        onClick={onAdd}
      >
        Thêm khoảng
      </button>
    </div>
  );
}
