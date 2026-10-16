'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, type Row, vnd } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import AttendanceReview, { attendanceLabels } from './attendance-review';
import { workforceNote } from './format';
import { PayDetails } from './pay-breakdown';
import { Badge, clock, dateLabel, duration, localDay, PanelHeading, Person, shiftTime } from './ui';
import {
  canApproveStandard,
  canReview,
  cellLabel,
  downloadCsv,
  monthRange,
  monthRows,
  previousMonth,
  shortHours,
  totals,
} from './timesheet-data';

export default function TimesheetBoard({ users }: { users: Row[] }) {
  const [month, setMonth] = useState(previousMonth),
    [view, setView] = useState('month');
  const [rows, setRows] = useState<Row[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [role, setRole] = useState('all'),
    [category, setCategory] = useState('all');
  const [person, setPerson] = useState<Row>(),
    [review, setReview] = useState<Row>(),
    [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState(''),
    [processing, setProcessing] = useState(false);
  const version = useRef(0);
  const range = monthRange(month);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    setLoaded(false);
    try {
      const { from, to } = monthRange(month);
      const data = await api<{ assignments: Row[] }>('/core/workforce?from=' + from + '&to=' + to);
      if (request !== version.current) return;
      setRows(monthRows(data.assignments, month));
      setError('');
      setSelected([]);
      setLoaded(true);
    } catch (e) {
      if (request === version.current) {
        setError((e as Error).message);
        setLoaded(true);
      }
    }
  }, [month]);
  useEffect(() => {
    void refresh();
    return () => {
      version.current++;
    };
  }, [refresh]);
  const people = users
    .filter(
      (u) => u.role !== 'ADMIN' && (u.status === 'ACTIVE' || rows.some((a) => a.user_id === u.id)),
    )
    .filter(
      (u) =>
        matches(`${u.display_name} ${u.username}`, search) && (role === 'all' || u.role === role),
    )
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));
  const scope = rows.filter((a) => people.some((u) => u.id === a.user_id));
  const t = totals(scope);
  const queue = scope
    .filter(
      (a) =>
        canReview(a) &&
        (category === 'all' ||
          (category === 'normal' ? canApproveStandard(a) : !canApproveStandard(a))),
    )
    .sort(
      (a, b) =>
        Number(canApproveStandard(a)) - Number(canApproveStandard(b)) ||
        String(a.starts_at).localeCompare(String(b.starts_at)),
    );
  const eligible = queue.filter((a) => canApproveStandard(a));
  const checked = selected
    .map((id) => eligible.find((a) => a.id === id))
    .filter((a): a is Row => !!a);
  function shiftMonth(n: number) {
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
    setPerson(undefined);
    setNotice('');
  }
  function exportMonth() {
    downloadCsv('bang-cong-' + month + '.csv', [
      [
        'Bảng công',
        month,
        'Giờ công đã duyệt (giờ:phút); N = nghỉ; V = vắng; ! = cần duyệt; L = lịch chưa duyệt',
      ],
      [
        'Mã nhân viên',
        'Nhân viên',
        ...range.days.map((d) => dateLabel(d)),
        'Công đã duyệt',
        'Ca đã duyệt',
        'Nghỉ',
        'Vắng',
        'Ca cần duyệt',
        'Tiền công đã duyệt',
      ],
      ...people.map((u) => {
        const mine = scope.filter((a) => a.user_id === u.id),
          sum = totals(mine);
        return [
          u.username,
          u.display_name,
          ...range.days.map((d) => cellLabel(mine.filter((a) => localDay(a.starts_at) === d))),
          shortHours(sum.minutes),
          sum.approved,
          sum.leave,
          sum.absent,
          sum.pending,
          sum.amount.toString(),
        ];
      }),
    ]);
  }
  async function approveSelected() {
    setProcessing(true);
    let count = 0;
    const failures: string[] = [];
    try {
      for (const a of checked) {
        try {
          await api('/core/workforce/assignments/' + a.id + '/approve', {
            minutes: Number(a.scheduled_minutes),
            approvalMode: 'FULL',
            outcome: 'WORKED',
            note: 'Quản trị đã kiểm tra giờ vào và giờ ra; tính đủ giờ công theo lịch cho các ca đã chọn.',
          });
          count++;
        } catch (e) {
          failures.push(
            `${a.display_name} - ${dateLabel(localDay(a.starts_at))}: ${(e as Error).message}`,
          );
        }
      }
      setNotice(
        `Đã duyệt ${count}/${checked.length} ca đã chọn.` +
          (failures.length ? ' Các ca không thành công vẫn cần kiểm tra.' : ''),
      );
      await refresh();
      if (failures.length) setError(failures.join(' '));
    } finally {
      setProcessing(false);
    }
  }
  const mine = person
    ? scope
        .filter((a) => a.user_id === person.id)
        .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    : [];
  return (
    <div className="wf-timesheets" aria-busy={!loaded}>
      <div className="wf-panel">
        <PanelHeading
          title="Bảng công và duyệt ca"
          description="Chọn tháng để đối chiếu công từng người. Kiểm tra các ca đi muộn, về sớm hoặc thiếu giờ chấm công trước khi tính lương."
        >
          <Action run={refresh} disabled={processing}>
            <Icon name="refresh" size={16} />
            Làm mới
          </Action>
          <button
            className="secondary-button"
            onClick={exportMonth}
            disabled={!loaded || processing}
          >
            <Icon name="receipt" size={16} />
            Xuất bảng công
          </button>
        </PanelHeading>
        <div className="wf-period-toolbar">
          <div className="wf-view-switch" role="group" aria-label="Cách xem chấm công">
            <button
              aria-pressed={view === 'month'}
              className={view === 'month' ? 'active' : ''}
              onClick={() => setView('month')}
            >
              Bảng công tháng
            </button>
            <button
              aria-pressed={view === 'review'}
              className={view === 'review' ? 'active' : ''}
              onClick={() => setView('review')}
            >
              Cần duyệt <span>{t.pending}</span>
            </button>
          </div>
          <div className="wf-date-controls">
            <button
              className="icon-button"
              aria-label="Tháng trước"
              disabled={processing}
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <label>
              <span className="wf-sr-only">Tháng chấm công</span>
              <input
                type="month"
                aria-label="Tháng chấm công"
                value={month}
                disabled={processing}
                onChange={(e) => {
                  if (e.target.value) {
                    setMonth(e.target.value);
                    setPerson(undefined);
                    setNotice('');
                  }
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Tháng sau"
              disabled={processing}
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
            <button
              className="secondary-button"
              disabled={processing}
              onClick={() => setMonth(localDay().slice(0, 7))}
            >
              Tháng này
            </button>
          </div>
        </div>
        <div className="wf-metrics" aria-label="Tổng công trong phạm vi đang lọc">
          <div>
            <span>Công đã duyệt</span>
            <strong>{duration(t.minutes)}</strong>
            <small>
              {t.approved} / {t.assigned} ca - {people.length} người
            </small>
          </div>
          <button
            onClick={() => {
              setView('review');
              setCategory('all');
            }}
          >
            <span>Ca cần duyệt</span>
            <strong>{t.pending}</strong>
            <small>
              {t.pending ? 'Kiểm tra trước khi tính lương' : 'Không còn ca đã kết thúc chờ duyệt'}
            </small>
          </button>
          <button
            onClick={() => {
              setView('review');
              setCategory('exceptions');
            }}
          >
            <span>Ca cần kiểm tra riêng</span>
            <strong>{t.exceptions}</strong>
            <small>Muộn, về sớm, thiếu chấm công…</small>
          </button>
          <div>
            <span>Tiền công đã duyệt</span>
            <strong>{vnd(t.amount)}</strong>
            <small>Chưa cộng thưởng hoặc trừ khấu trừ</small>
          </div>
        </div>
        <div className="wf-month-filters">
          <Search value={search} onChange={setSearch} placeholder="Tìm tên hoặc mã nhân viên…" />
          <label>
            Bộ phận
            <select
              aria-label="Lọc công theo bộ phận"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="all">Tất cả bộ phận</option>
              <option value="STAFF">Phục vụ</option>
              <option value="KITCHEN">Bếp</option>
            </select>
          </label>
          {view === 'review' && (
            <label>
              Loại ca
              <select
                aria-label="Lọc ca cần duyệt"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">Tất cả ca cần duyệt</option>
                <option value="exceptions">Ca cần kiểm tra riêng</option>
                <option value="normal">Giờ vào, ra trong mức cho phép</option>
              </select>
            </label>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="wf-inline-notice" role="status">
            {notice}
          </p>
        )}
        {!loaded ? (
          <p className="wf-inline-notice" role="status">
            Đang tải bảng công tháng…
          </p>
        ) : view === 'month' ? (
          <>
            <div className="wf-legend">
              <span>Giờ:phút = số giờ và phút đã duyệt</span>
              <span>N = Nghỉ được ghi nhận</span>
              <span>V = Vắng</span>
              <span>! = Cần duyệt</span>
              <span>L = Lịch chưa duyệt</span>
              <span>— = Không phân ca</span>
            </div>
            {!people.length ? (
              <Empty title="Không có nhân viên phù hợp" />
            ) : (
              <>
                <p className="wf-month-desktop wf-scroll-hint">
                  Cuộn ngang để xem hết tháng. Chọn tên nhân viên để xem chi tiết công.
                </p>
                <div
                  className="wf-month-desktop wf-table-scroll"
                  tabIndex={0}
                  aria-label="Bảng công theo ngày; cuộn ngang để xem hết tháng"
                >
                  <table className="wf-month-table">
                    <caption>
                      Bảng chấm công tháng {month.slice(5)}/{month.slice(0, 4)} - tính theo ngày bắt
                      đầu ca
                    </caption>
                    <thead>
                      <tr>
                        <th className="wf-sticky-person" scope="col">
                          Nhân viên
                        </th>
                        <th scope="col">Tổng công</th>
                        {range.days.map((d) => (
                          <th
                            key={d}
                            scope="col"
                            className={
                              new Date(d + 'T12:00:00Z').getUTCDay() === 0 ? 'wf-weekend' : ''
                            }
                          >
                            <strong>{Number(d.slice(8))}</strong>
                            <small>
                              {new Date(d + 'T12:00:00Z').toLocaleDateString('vi-VN', {
                                weekday: 'short',
                              })}
                            </small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((u) => {
                        const employeeRows = scope.filter((a) => a.user_id === u.id),
                          sum = totals(employeeRows);
                        return (
                          <tr key={u.id}>
                            <th scope="row" className="wf-sticky-person">
                              <button
                                onClick={() => setPerson(u)}
                                aria-label={`Xem công của ${u.display_name}`}
                              >
                                <Person name={u.display_name} sub={u.username} />
                              </button>
                            </th>
                            <td className="wf-month-total">
                              <strong>{shortHours(sum.minutes)}</strong>
                              <small>
                                {sum.pending
                                  ? `${sum.pending} cần duyệt`
                                  : `${sum.approved} ca đã duyệt`}
                              </small>
                            </td>
                            {range.days.map((d) => {
                              const daily = employeeRows.filter((a) => localDay(a.starts_at) === d),
                                s = totals(daily);
                              return (
                                <td key={d}>
                                  <button
                                    disabled={!daily.length}
                                    onClick={() => setPerson(u)}
                                    className={
                                      s.pending
                                        ? 'wf-cell-pending'
                                        : s.leave || s.absent
                                          ? 'wf-cell-leave'
                                          : s.approved
                                            ? 'wf-cell-approved'
                                            : ''
                                    }
                                    aria-label={`${u.display_name}, ${dateLabel(d)}: ${cellLabel(daily)}`}
                                  >
                                    {cellLabel(daily)}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="wf-month-mobile">
                  {people.map((u) => {
                    const s = totals(scope.filter((a) => a.user_id === u.id));
                    return (
                      <button key={u.id} onClick={() => setPerson(u)}>
                        <Person name={u.display_name} sub={u.username} />
                        <strong>{duration(s.minutes)}</strong>
                        <small>
                          {s.approved} ca đã duyệt - {s.pending} cần duyệt
                        </small>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="wf-bulk-toolbar">
              <label className="wf-checkbox">
                <input
                  type="checkbox"
                  aria-label="Chọn tối đa 50 ca đủ điều kiện tính công theo lịch"
                  disabled={!eligible.length || processing}
                  checked={
                    eligible.length > 0 &&
                    eligible.slice(0, 50).every((a) => selected.includes(a.id))
                  }
                  onChange={(e) =>
                    setSelected(e.target.checked ? eligible.slice(0, 50).map((a) => a.id) : [])
                  }
                />
                Chọn ca đủ điều kiện tính công theo lịch (tối đa 50)
              </label>
              <Action
                disabled={!checked.length || processing}
                confirmTitle="Tính đủ giờ công theo lịch cho các ca đã chọn?"
                confirmLabel="Xác nhận duyệt công"
                confirm={`Duyệt ${checked.length} ca đã chọn, tổng ${duration(checked.reduce((n, a) => n + Number(a.scheduled_minutes), 0))}. Giờ chấm công thực tế giữ nguyên. Các ca cần kiểm tra riêng không được duyệt bằng thao tác này. Sau khi duyệt, bạn không thể sửa lại số công.`}
                run={approveSelected}
              >
                Duyệt {checked.length} ca đã chọn
              </Action>
            </div>
            <p className="small-note">
              Ca có giờ nghỉ cần mở từng ca để xác định các khoảng làm việc và nghỉ trước khi duyệt
              công.
            </p>
            {!queue.length ? (
              <Empty title="Không có ca nào đang chờ trong nhóm này">
                Công đã duyệt được giữ trong Bảng công tháng. Chọn tháng hoặc bộ lọc khác để xem.
              </Empty>
            ) : (
              <div className="wf-review-queue">
                {queue.map((a) => (
                  <article key={a.id} className="wf-queue-row">
                    <div>
                      {canApproveStandard(a) && (
                        <input
                          type="checkbox"
                          aria-label={`Chọn ca ${a.display_name} ${dateLabel(localDay(a.starts_at))}`}
                          disabled={
                            processing || (!selected.includes(a.id) && checked.length >= 50)
                          }
                          checked={selected.includes(a.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, a.id]
                                : selected.filter((id) => id !== a.id),
                            )
                          }
                        />
                      )}
                      <Person
                        name={a.display_name}
                        sub={`${a.username} - ${dateLabel(localDay(a.starts_at))}`}
                      />
                    </div>
                    <div>
                      <strong>
                        {String(a.shift_name)} - {shiftTime(a)}
                      </strong>
                      <small>
                        Vào {clock(a.checked_in_at)} - Ra {clock(a.checked_out_at)}
                      </small>
                    </div>
                    <div>
                      <Badge tone={canApproveStandard(a) ? 'blue' : 'amber'}>
                        {attendanceLabels[String(a.classification)] ?? 'Cần kiểm tra'}
                      </Badge>
                      <small>
                        Gợi ý {duration(a.suggested_minutes)} - Theo lịch{' '}
                        {duration(a.scheduled_minutes)}
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={processing}
                      onClick={() => setReview(a)}
                    >
                      {canApproveStandard(a) ? 'Kiểm tra & duyệt' : 'Kiểm tra ca này'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {person && (
        <Modal
          title={`Công tháng ${month.slice(5)}/${month.slice(0, 4)} - ${person.display_name}`}
          close={() => setPerson(undefined)}
        >
          <div className="wf-detail">
            <Person name={person.display_name} sub={person.username} />
            <div className="wf-calculation">
              <span>
                Công đã duyệt<strong>{duration(totals(mine).minutes)}</strong>
              </span>
              <span>
                Tiền công<strong>{vnd(totals(mine).amount)}</strong>
              </span>
            </div>
            {!mine.length ? (
              <Empty title="Chưa phân ca trong tháng này" />
            ) : (
              <div className="wf-person-days">
                {mine.map((a) => (
                  <article key={a.id}>
                    <div>
                      <strong>
                        {dateLabel(localDay(a.starts_at), true)} - {String(a.shift_name)}
                      </strong>
                      <small>
                        {shiftTime(a)} - Vào {clock(a.checked_in_at)} / Ra {clock(a.checked_out_at)}
                      </small>
                      <small>
                        {a.attendance_status === 'APPROVED'
                          ? [
                              duration(a.approved_minutes),
                              vnd(a.amount),
                              workforceNote(a.review_note),
                            ]
                              .filter(Boolean)
                              .join(' - ')
                          : `Gợi ý ${duration(a.suggested_minutes)}`}
                      </small>
                      {a.attendance_status === 'APPROVED' && (
                        <PayDetails components={a.pay_components} snapshot={a.pay_snapshot} />
                      )}
                    </div>
                    <Badge tone={a.attendance_status === 'APPROVED' ? 'green' : 'amber'}>
                      {attendanceLabels[String(a.classification)] ?? 'Đã phân công'}
                    </Badge>
                    {canReview(a) && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setPerson(undefined);
                          setReview(a);
                        }}
                      >
                        Duyệt công
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
      {review && (
        <Modal title="Duyệt công của ca" close={() => setReview(undefined)}>
          <AttendanceReview
            row={review}
            done={async () => {
              await refresh();
              setReview(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
