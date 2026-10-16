'use client';
import { HistoryList, ServerHistory } from '../shared/history-filters';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, vnd, type Row } from '../shared/components';
import { Empty, Icon, Modal } from '../shared/primitives';
import { moment, workforceNote } from './format';
import { Slip, slipPaymentLabel, periodLabel } from './payroll-panel';
import { overlapsDate } from './schedule-data';
import { PayDetails } from './pay-breakdown';
import {
  addDays,
  attendanceState,
  Badge,
  clock,
  dateLabel,
  duration,
  Hint,
  localDay,
  monday,
  PanelHeading,
  shiftTime,
  WeekNav,
} from './ui';
export default function MyWork() {
  const [scheduleView, setScheduleView] = useState('day'),
    [selectedDay, setSelectedDay] = useState(() => localDay());
  const [assignments, setAssignments] = useState<Row[]>([]),
    [payroll, setPayroll] = useState<{ slips: Row[]; lines: Row[]; runs: Row[] }>(),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [tab, setTab] = useState('schedule'),
    [week, setWeek] = useState(() => monday(localDay())),
    [now, setNow] = useState(() => Date.now());
  const [detail, setDetail] = useState<Row>(),
    [selectedSlip, setSelectedSlip] = useState<Row>();
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [work, pay] = await Promise.all([
        api<{ assignments: Row[]; currentAssignments: Row[] }>(
          '/core/workforce/me?from=' + week + '&to=' + addDays(week, 6),
        ),
        api<{ slips: Row[]; lines: Row[]; runs: Row[] }>('/core/payroll/me'),
      ]);
      if (version !== requestVersion.current) return;
      setAssignments([
        ...new Map(
          [...work.assignments, ...work.currentAssignments].map((a) => [a.id, a]),
        ).values(),
      ]);
      setPayroll(pay);
      setLoaded(true);
      setNow(Date.now());
      setError('');
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError((e as Error).message);
    }
  }, [week]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const ordered = [...assignments]
    .filter((a) => a.status === 'ASSIGNED')
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const active = ordered.find(
    (a) => a.checked_in_at && !a.checked_out_at && a.attendance_status !== 'APPROVED',
  );
  const current =
    active ??
    ordered.find(
      (a) =>
        a.attendance_status !== 'APPROVED' &&
        !a.checked_out_at &&
        new Date(String(a.ends_at)).getTime() >= now,
    );
  const canEnter = current && current.can_check_in === true;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  return (
    <section className="wf-app wf-personal" aria-label="Lịch làm và lương cá nhân">
      <div className="wf-personal-heading">
        <div>
          <p className="wf-kicker">LỊCH LÀM CỦA BẠN</p>
          <h2>Lịch làm & lương của tôi</h2>
          <p>Xem ca, chấm công và theo dõi phiếu lương của bạn.</p>
        </div>
        <Action run={refresh}>
          <Icon name="refresh" size={16} />
          Làm mới
        </Action>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loaded ? (
        error ? (
          <Action run={refresh}>Thử tải lại</Action>
        ) : (
          <p role="status">Đang tải lịch cá nhân…</p>
        )
      ) : (
        <>
          <nav className="wf-tabs" aria-label="Thông tin cá nhân">
            {[
              ['schedule', 'Lịch của tôi', 'table'],
              ['history', 'Lịch sử chấm công', 'clock'],
              ['payroll', 'Phiếu lương', 'receipt'],
            ].map(([id, title, icon]) => (
              <button
                key={id}
                className={tab === id ? 'active' : ''}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id!)}
              >
                <Icon name={icon!} size={18} />
                {title}
              </button>
            ))}
          </nav>
          {tab === 'schedule' && (
            <div className="wf-personal-top">
              <div className={`wf-clock-card ${active ? 'wf-clock-active' : ''}`}>
                <div className="wf-clock-title">
                  <span className="wf-kicker">
                    {active
                      ? 'CA ĐANG LÀM'
                      : current && localDay(current.starts_at) === localDay()
                        ? 'CA CỦA BẠN HÔM NAY'
                        : 'CA SẮP TỚI'}
                  </span>
                  <Icon name="clock" size={24} />
                </div>
                {current ? (
                  <>
                    <h3>{shiftTime(current)}</h3>
                    <p>
                      {dateLabel(localDay(current.starts_at), true)} - {String(current.shift_name)}
                    </p>
                    <div className="wf-clock-meta">
                      <span>{String(current.area_name ?? 'Toàn nhà hàng / bếp')}</span>
                      <span>Nghỉ không tính công {String(current.break_minutes)} phút</span>
                    </div>
                    <div className="wf-clock-record">
                      <div>
                        <span>Đã vào ca</span>
                        <strong>{clock(current.checked_in_at)}</strong>
                      </div>
                      <div>
                        <span>Đã ra ca</span>
                        <strong>{clock(current.checked_out_at)}</strong>
                      </div>
                    </div>
                    <div className="wf-clock-action">
                      {active && active.can_check_out === true ? (
                        <Action
                          confirm="Kết thúc ca và ghi nhận giờ ra hiện tại?"
                          successMessage="Đã ghi nhận giờ ra ca."
                          run={async () => {
                            await api(
                              '/core/workforce/assignments/' + active.id + '/check-out',
                              {},
                            );
                            await refresh();
                          }}
                        >
                          Ra ca
                        </Action>
                      ) : canEnter ? (
                        <Action
                          successMessage="Đã ghi nhận giờ vào ca."
                          run={async () => {
                            await api(
                              '/core/workforce/assignments/' + current.id + '/check-in',
                              {},
                            );
                            await refresh();
                          }}
                        >
                          Vào ca
                        </Action>
                      ) : (
                        <p>
                          {active
                            ? 'Đã quá thời gian tự chấm ra. Báo quản trị để kiểm tra và bổ sung công cho bạn.'
                            : `Chưa đến giờ chấm công. Có thể vào trước ca ${String(current.clock_in_early_minutes)} phút.`}
                        </p>
                      )}
                      <button className="wf-light-button" onClick={() => setDetail(current)}>
                        Xem chi tiết ca →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Chưa có ca sắp tới</h3>
                    <p>Lịch mới sẽ hiển thị khi quản trị phân công cho bạn.</p>
                  </>
                )}
              </div>
              <div className="wf-personal-side">
                <div className="wf-panel">
                  <PanelHeading
                    title="Tuần đang xem"
                    description={`${dateLabel(week)}/${week.slice(0, 4)} – ${dateLabel(addDays(week, 6))}/${addDays(week, 6).slice(0, 4)}`}
                  />
                  <div className="wf-personal-stats">
                    <div>
                      <strong>
                        {
                          ordered.filter(
                            (a) =>
                              localDay(a.starts_at) >= week &&
                              localDay(a.starts_at) <= addDays(week, 6),
                          ).length
                        }
                      </strong>
                      <span>Ca được phân công</span>
                    </div>
                    <div>
                      <strong>
                        {duration(
                          ordered
                            .filter(
                              (a) =>
                                a.attendance_status === 'APPROVED' &&
                                localDay(a.starts_at) >= week &&
                                localDay(a.starts_at) <= addDays(week, 6),
                            )
                            .reduce((n, a) => n + Number(a.approved_minutes), 0),
                        )}
                      </strong>
                      <span>Công đã duyệt</span>
                    </div>
                  </div>
                </div>
                <Hint>
                  Bấm Vào ca khi bắt đầu làm và Ra ca khi kết thúc. Quản trị kiểm tra, duyệt công
                  sau ca. Bạn sẽ thấy phiếu lương khi bảng lương được chốt.
                </Hint>
              </div>
            </div>
          )}
          {tab === 'schedule' && (
            <div className="wf-panel">
              <PanelHeading
                title="Lịch của bạn theo ngày và tuần"
                description="Xem ca trong một ngày hoặc mở toàn tuần. Chọn ca để xem chi tiết."
              />
              <div className="wf-toolbar">
                <div className="wf-view-switch" role="group" aria-label="Cách xem lịch cá nhân">
                  <button
                    aria-pressed={scheduleView === 'day'}
                    className={scheduleView === 'day' ? 'active' : ''}
                    onClick={() => setScheduleView('day')}
                  >
                    Theo ngày
                  </button>
                  <button
                    aria-pressed={scheduleView === 'week'}
                    className={scheduleView === 'week' ? 'active' : ''}
                    onClick={() => setScheduleView('week')}
                  >
                    Cả tuần
                  </button>
                </div>
                <WeekNav
                  week={week}
                  onChange={(w) => {
                    setWeek(w);
                    if (selectedDay < w || selectedDay > addDays(w, 6)) setSelectedDay(w);
                  }}
                />
              </div>
              {scheduleView === 'day' ? (
                <>
                  <div
                    className="wf-day-strip wf-personal-strip"
                    aria-label="Chọn ngày xem lịch cá nhân"
                  >
                    {days.map((d) => (
                      <button
                        key={d}
                        aria-label={`Ca của tôi ngày ${d}`}
                        aria-pressed={d === selectedDay}
                        className={d === selectedDay ? 'active' : ''}
                        onClick={() => setSelectedDay(d)}
                      >
                        <span>{dateLabel(d, true).split(',')[0]}</span>
                        <strong>{dateLabel(d)}</strong>
                        <small>{ordered.filter((a) => overlapsDate(a, d)).length} ca</small>
                      </button>
                    ))}
                  </div>
                  <div className="wf-personal-agenda">
                    <div>
                      <h4>{dateLabel(selectedDay, true)}</h4>
                      <p>
                        {ordered.filter((a) => overlapsDate(a, selectedDay)).length} ca được phân
                        công trong ngày
                      </p>
                    </div>
                    {ordered.filter((a) => overlapsDate(a, selectedDay)).length ? (
                      ordered
                        .filter((a) => overlapsDate(a, selectedDay))
                        .map((a) => (
                          <button
                            key={a.id}
                            className="wf-agenda-shift"
                            onClick={() => setDetail(a)}
                          >
                            <div className="wf-agenda-time">
                              <Icon name="clock" size={18} />
                              <strong>{shiftTime(a)}</strong>
                            </div>
                            <div>
                              <strong>{String(a.shift_name)}</strong>
                              <small>
                                {String(a.area_name ?? 'Toàn nhà hàng / bếp')} - Nghỉ không tính
                                công {String(a.break_minutes)} phút
                              </small>
                              {localDay(a.starts_at) !== selectedDay && (
                                <small>Ca qua đêm tiếp từ {dateLabel(localDay(a.starts_at))}</small>
                              )}
                            </div>
                            <Badge tone={attendanceState(a, now).tone}>
                              {attendanceState(a, now).label}
                            </Badge>
                            <span aria-hidden="true">›</span>
                          </button>
                        ))
                    ) : (
                      <Empty title="Bạn không có ca trong ngày này" icon="table">
                        Chọn ngày khác để xem lịch của bạn.
                      </Empty>
                    )}
                  </div>
                </>
              ) : (
                <div className="wf-personal-week">
                  {days.map((day) => {
                    const shifts = ordered.filter((a) => localDay(a.starts_at) === day);
                    return (
                      <div className={day === localDay() ? 'wf-today' : ''} key={day}>
                        <div className="wf-personal-day">
                          <span>
                            {new Date(day + 'T12:00:00Z').toLocaleDateString('vi-VN', {
                              weekday: 'short',
                              timeZone: 'UTC',
                            })}
                          </span>
                          <strong>{dateLabel(day)}</strong>
                          {day === localDay() && <Badge tone="green">Hôm nay</Badge>}
                        </div>
                        {shifts.length ? (
                          shifts.map((a) => (
                            <button className="wf-shift" key={a.id} onClick={() => setDetail(a)}>
                              <strong>{shiftTime(a)}</strong>
                              <span>{String(a.shift_name)}</span>
                              <small>{String(a.area_name ?? 'Toàn nhà hàng / bếp')}</small>
                              <Badge tone={attendanceState(a, now).tone}>
                                {attendanceState(a, now).label}
                              </Badge>
                            </button>
                          ))
                        ) : (
                          <span className="wf-day-off">Không có ca</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {tab === 'history' && (
            <div className="wf-panel">
              <PanelHeading
                title="Giờ công của bạn"
                description="Xem giờ chấm công thực tế và số giờ công đã được quản trị duyệt. Nếu có sai sót, báo quản trị để kiểm tra."
              />
              <ServerHistory
                kind="my-attendance"
                placeholder="Tìm tên ca, khu vực hoặc ghi chú…"
                refreshKey={now}
                statuses={[
                  { value: 'approved', label: 'Đã duyệt' },
                  { value: 'pending', label: 'Chờ duyệt' },
                  { value: 'cancelled', label: 'Đã hủy phân công' },
                ]}
                empty="Không có ca đã kết thúc phù hợp"
              >
                {(rows) => (
                  <div className="wf-table-scroll">
                    <table className="wf-table wf-personal-history">
                      <thead>
                        <tr>
                          <th scope="col">Ngày / ca</th>
                          <th scope="col">Vào / ra thực tế</th>
                          <th scope="col">Giờ công được duyệt</th>
                          <th scope="col">Trạng thái</th>
                          <th scope="col">
                            <span className="wf-sr-only">Chi tiết</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((a) => (
                          <tr key={a.id}>
                            <td data-label="Ngày / ca">
                              <strong>
                                {dateLabel(localDay(a.starts_at))} - {shiftTime(a)}
                              </strong>
                              <small>{String(a.shift_name)}</small>
                            </td>
                            <td data-label="Vào / ra thực tế">
                              {clock(a.checked_in_at)} / {clock(a.checked_out_at)}
                            </td>
                            <td data-label="Giờ công được duyệt">
                              {a.attendance_status === 'APPROVED'
                                ? duration(a.approved_minutes)
                                : 'Chưa duyệt'}
                            </td>
                            <td data-label="Trạng thái">
                              <Badge tone={attendanceState(a, now).tone}>
                                {attendanceState(a, now).label}
                              </Badge>
                            </td>
                            <td data-label="Thao tác">
                              <button className="secondary-button" onClick={() => setDetail(a)}>
                                Chi tiết
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ServerHistory>
            </div>
          )}
          {tab === 'payroll' && (
            <div className="wf-panel">
              <PanelHeading
                title="Phiếu lương đã chốt"
                description="Xem tiền công, thưởng, khấu trừ và trạng thái trả lương của bạn. Phiếu được hiển thị sau khi quản trị chốt bảng lương."
              />
              <HistoryList
                items={payroll?.slips ?? []}
                date={(s) => payroll!.runs.find((r) => r.id === s.payroll_run_id)?.period_start}
                end={(s) =>
                  new Date(
                    Date.parse(
                      String(payroll!.runs.find((r) => r.id === s.payroll_run_id)?.period_end),
                    ) - 86400000,
                  )
                    .toISOString()
                    .slice(0, 10)
                }
                dateOnly
                search={(s) => periodLabel(payroll!.runs.find((r) => r.id === s.payroll_run_id)!)}
                state={(s) => String(s.payment_status)}
                statuses={[
                  { value: 'UNPAID', label: 'Đã chốt - Chưa chi' },
                  { value: 'NOT_REQUIRED', label: 'Không cần chi' },
                  { value: 'PAID', label: 'Đã chi lương' },
                ]}
                placeholder="Tìm kỳ lương…"
                empty="Chưa có phiếu lương phù hợp"
              >
                {(rows) => (
                  <div className="wf-slot-list">
                    {rows.map((s) => {
                      const p = payroll!.runs.find((p) => p.id === s.payroll_run_id)!;
                      return (
                        <div key={s.id}>
                          <div>
                            <strong>Kỳ {periodLabel(p)}</strong>
                            <p>{slipPaymentLabel(s)}</p>
                          </div>
                          <button className="secondary-button" onClick={() => setSelectedSlip(s)}>
                            Xem phiếu lương
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </HistoryList>
            </div>
          )}
        </>
      )}
      {detail && (
        <Modal title="Ca làm của bạn" close={() => setDetail(undefined)}>
          <div className="wf-detail">
            <Badge tone={attendanceState(detail, now).tone}>
              {attendanceState(detail, now).label}
            </Badge>
            <h3>{String(detail.shift_name)}</h3>
            <p>
              {moment(detail.starts_at)} → {moment(detail.ends_at)}
            </p>
            <dl className="wf-facts">
              <div>
                <dt>Khu vực</dt>
                <dd>{String(detail.area_name ?? 'Toàn nhà hàng / bếp')}</dd>
              </div>
              <div>
                <dt>Thời gian nghỉ không tính công</dt>
                <dd>{String(detail.break_minutes)} phút</dd>
              </div>
              <div>
                <dt>Vào ca</dt>
                <dd>{moment(detail.checked_in_at)}</dd>
              </div>
              <div>
                <dt>Ra ca</dt>
                <dd>{moment(detail.checked_out_at)}</dd>
              </div>
              <div>
                <dt>Công được hưởng lương</dt>
                <dd>
                  {detail.attendance_status === 'APPROVED'
                    ? duration(detail.approved_minutes)
                    : 'Chờ quản trị duyệt'}
                </dd>
              </div>
              <div>
                <dt>
                  {detail.attendance_status === 'APPROVED'
                    ? 'Tiền công đã duyệt'
                    : 'Đơn giá cơ bản / giờ'}
                </dt>
                <dd>
                  {detail.attendance_status === 'APPROVED'
                    ? vnd(detail.amount)
                    : Number(detail.effective_hourly_rate) >= 1000
                      ? vnd(detail.effective_hourly_rate)
                      : 'Chưa thiết lập'}
                </dd>
              </div>
            </dl>
            <PayDetails components={detail.pay_components} snapshot={detail.pay_snapshot} />
            {detail.pay_policy_active && detail.attendance_status !== 'APPROVED' && (
              <Hint>Giờ làm đêm, làm thêm và ngày lễ được tính riêng theo công được duyệt.</Hint>
            )}
            {detail.review_note && <Hint>{workforceNote(detail.review_note)}</Hint>}
            {detail.cancellation_reason && (
              <Hint>Lý do hủy: {String(detail.cancellation_reason)}</Hint>
            )}
          </div>
        </Modal>
      )}
      {selectedSlip && payroll && (
        <Modal title="Phiếu lương của bạn" close={() => setSelectedSlip(undefined)} wide>
          <div className="wf-app">
            <p className="wf-slip-period">
              Kỳ {periodLabel(payroll.runs.find((p) => p.id === selectedSlip.payroll_run_id)!)}
            </p>
            <Slip slip={selectedSlip} lines={payroll.lines} />
          </div>
        </Modal>
      )}
    </section>
  );
}
