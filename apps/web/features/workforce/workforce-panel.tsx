'use client';
import { ServerHistory } from '../shared/history-filters';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, EntryForm, options, vnd, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import ShiftTemplates from './shift-templates';
import ScheduleForm from './schedule-form';
import AttendanceReview from './attendance-review';
import ClockPolicy from './clock-policy';
import TimesheetBoard from './timesheet-board';
import PayrollPanel from './payroll-panel';
import ScheduleBoard from './schedule-board';
import PaySettings from './pay-settings';
import { PayDetails } from './pay-breakdown';
import { moment, localInstant, workforceNote } from './format';
import {
  attendanceState,
  Badge,
  duration,
  Hint,
  localDay,
  PanelHeading,
  Person,
  addDays,
  monday,
  shiftTime,
} from './ui';

type Data = { templates: Row[]; shifts: Row[]; assignments: Row[]; rates: Row[] };
export default function WorkforcePanel({
  users,
  areas,
  initial = 'schedule',
}: {
  users: Row[];
  areas: Row[];
  initial?: string;
}) {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState('');
  const [section] = useState(
      ['templates', 'attendance', 'payroll', 'rates'].includes(initial) ? initial : 'schedule',
    ),
    [date, setDate] = useState(() => localDay());
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<'shift' | 'assign' | 'assign-template' | 'rate'>(),
    [pickedShift, setPickedShift] = useState(''),
    [pickedPerson, setPickedPerson] = useState('');
  const [detail, setDetail] = useState<Row>(),
    [review, setReview] = useState<Row>(),
    [cancel, setCancel] = useState<Row>(),
    [history, setHistory] = useState<Row>();
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const week = monday(date);
      const result = await api<Data>(
        '/core/workforce' +
          (section === 'schedule' ? '?from=' + week + '&to=' + addDays(week, 6) : ''),
      );
      if (version !== requestVersion.current) return;
      setData(result);
      setError('');
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError((e as Error).message);
    }
  }, [date, section]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(path: string, body: unknown) {
    await api('/core/workforce/' + path, body);
    await refresh();
  }
  const employees = users.filter((u) => u.status === 'ACTIVE' && u.role !== 'ADMIN');
  const people = employees.map((u) => ({
    value: u.id,
    label: `${u.display_name} - ${u.username}`,
  }));
  const shownPeople = employees.filter((u) => matches(`${u.display_name} ${u.username}`, search));
  function assign(shiftId = '', userId = '') {
    setPickedShift(shiftId);
    setPickedPerson(userId);
    setForm(shiftId ? 'assign' : 'assign-template');
  }
  const currentRate = (id: string) =>
    data?.rates.find(
      (r) => r.user_id === id && new Date(String(r.effective_from)).getTime() <= Date.now(),
    );
  return (
    <section className="wf-app" aria-label="Quản lý ca làm và lương">
      <div className="wf-workflow-strip" aria-label="Luồng quản lý công và lương">
        <span className={section === 'templates' || section === 'schedule' ? 'active' : ''}>
          <b>1</b> Lập lịch & phân ca
        </span>
        <span className={section === 'attendance' ? 'active' : ''}>
          <b>2</b> Đối chiếu & duyệt công
        </span>
        <span className={section === 'payroll' ? 'active' : ''}>
          <b>3</b> Chốt & ghi nhận chi lương
        </span>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {section === 'payroll' ? (
        <PayrollPanel />
      ) : !data ? (
        error ? (
          <Action run={refresh}>Thử tải lại</Action>
        ) : (
          <p role="status">Đang tải lịch và giờ công…</p>
        )
      ) : (
        <>
          {section === 'templates' && (
            <ShiftTemplates templates={data.templates} refresh={refresh} />
          )}
          {section === 'schedule' && (
            <ScheduleBoard
              data={data}
              users={users}
              areas={areas}
              date={date}
              onDate={setDate}
              onCreate={() => setForm('shift')}
              onAssign={assign}
              onDetail={setDetail}
              refresh={refresh}
            />
          )}
          {section === 'attendance' && (
            <>
              <div className="wf-panel">
                <ClockPolicy />
              </div>
              <TimesheetBoard users={users} />
            </>
          )}
          {section === 'rates' && (
            <>
              <div className="wf-panel">
                <PanelHeading
                  title="Đơn giá cơ bản của từng nhân viên"
                  description="Đặt lương giờ riêng theo thỏa thuận. Các khoản làm đêm, làm thêm và ngày lễ được cộng theo chính sách áp dụng."
                >
                  <button
                    className="primary-button"
                    onClick={() => {
                      setPickedPerson('');
                      setForm('rate');
                    }}
                  >
                    <Icon name="plus" size={16} />
                    Thêm đơn giá
                  </button>
                </PanelHeading>
                {data.templates.some((t) => t.hourly_rate_override) && (
                  <details className="wf-policy">
                    <summary>Đơn giá ca đã lưu theo cách tính cũ</summary>
                    <div className="wf-rate-rules">
                      {data.templates
                        .filter((t) => t.hourly_rate_override)
                        .map((t) => (
                          <p key={t.id}>
                            <strong>{String(t.name)}</strong>
                            <span>{vnd(t.hourly_rate_override)} / giờ</span>
                          </p>
                        ))}
                    </div>
                    <p>
                      Chỉ dùng cho công trước ngày áp dụng chính sách mới. Công theo chính sách mới
                      dùng lương riêng của nhân viên.
                    </p>
                  </details>
                )}
                <div className="wf-toolbar">
                  <Search value={search} onChange={setSearch} placeholder="Tìm nhân viên…" />
                </div>
                <div className="wf-table-scroll">
                  <table className="wf-table">
                    <thead>
                      <tr>
                        <th scope="col">Nhân viên</th>
                        <th scope="col">Đơn giá cơ bản hiện tại</th>
                        <th scope="col">Có hiệu lực từ</th>
                        <th scope="col">Lịch sử</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownPeople.map((u) => {
                        const r = currentRate(u.id);
                        return (
                          <tr key={u.id}>
                            <td data-label="Nhân viên">
                              <Person
                                name={u.display_name}
                                sub={`${u.role === 'KITCHEN' ? 'Bếp' : 'Phục vụ'} - ${u.username}`}
                              />
                            </td>
                            <td data-label="Đơn giá cơ bản hiện tại">
                              <strong>
                                {r ? `${vnd(r.hourly_rate)} / giờ` : 'Chưa có đơn giá'}
                              </strong>
                            </td>
                            <td data-label="Có hiệu lực từ">
                              {r ? moment(r.effective_from) : '—'}
                            </td>
                            <td data-label="Lịch sử">
                              <button
                                className="secondary-button"
                                aria-label={`Xem lịch sử đơn giá của ${u.display_name}`}
                                onClick={() => setHistory(u)}
                              >
                                Xem lịch sử
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!shownPeople.length && (
                  <Empty
                    title={
                      employees.length
                        ? 'Không tìm thấy nhân viên'
                        : 'Chưa có nhân viên đang làm việc'
                    }
                  >
                    {employees.length
                      ? 'Thử tìm tên hoặc mã nhân viên khác.'
                      : 'Thêm tài khoản nhân viên trước khi đặt đơn giá giờ.'}
                  </Empty>
                )}
                <Hint>
                  Tiền công dùng đơn giá có hiệu lực tại từng khoảng làm việc. Công đã duyệt và
                  phiếu lương đã chốt giữ nguyên khi bạn thêm đơn giá mới.
                </Hint>
              </div>
              <PaySettings employees={employees} />
            </>
          )}
        </>
      )}
      {form && data && (
        <Modal
          title={
            form === 'shift'
              ? 'Lập lịch theo mẫu ca'
              : form === 'assign-template'
                ? 'Phân công theo mẫu ca'
                : form === 'assign'
                  ? 'Phân công vào ca đã lập'
                  : 'Thêm đơn giá cơ bản'
          }
          close={() => setForm(undefined)}
        >
          <div className="wf-form-modal">
            {form === 'shift' || form === 'assign-template' ? (
              <ScheduleForm
                templates={data.templates}
                users={users}
                areas={areas}
                date={date}
                assign={form === 'assign-template'}
                done={async (day) => {
                  setDate(day);
                  await refresh();
                  setForm(undefined);
                }}
              />
            ) : (
              <EntryForm
                title={
                  form === 'assign' ? 'Phân công vào lịch đã tạo' : 'Đơn giá cơ bản của nhân viên'
                }
                submit={form === 'assign' ? 'Lưu phân công' : 'Lưu đơn giá'}
                successMessage={
                  form === 'assign'
                    ? 'Đã phân công nhân viên vào ca.'
                    : 'Đã lưu đơn giá giờ mới của nhân viên.'
                }
                fields={
                  form === 'assign'
                    ? [
                        {
                          key: 'shiftId',
                          label: 'Ca làm',
                          value: pickedShift,
                          options: data.shifts.map((x) => ({
                            value: x.id,
                            label: moment(x.starts_at) + ' - ' + x.name + ' - ' + shiftTime(x),
                          })),
                        },
                        { key: 'userId', label: 'Nhân viên', value: pickedPerson, options: people },
                        {
                          key: 'areaId',
                          label: 'Khu vực phụ trách',
                          optional: true,
                          options: [
                            { value: '', label: 'Toàn nhà hàng / bếp' },
                            ...options(areas.filter((a) => a.is_active)),
                          ],
                        },
                      ]
                    : [
                        { key: 'userId', label: 'Nhân viên', value: pickedPerson, options: people },
                        {
                          key: 'hourlyRate',
                          label: 'Đơn giá một giờ (đồng)',
                          type: 'number',
                          min: 1000,
                          max: 10000000,
                        },
                        { key: 'effectiveFrom', label: 'Có hiệu lực từ', type: 'datetime-local' },
                        { key: 'reason', label: 'Lý do / thỏa thuận' },
                      ]
                }
                confirm={
                  form === 'rate'
                    ? 'Lưu đơn giá cơ bản mới? Công theo chính sách mới dùng mức lương riêng này từ thời điểm áp dụng. Công đã duyệt giữ nguyên.'
                    : undefined
                }
                onSubmit={async (v) => {
                  await save(
                    form === 'assign' ? 'assignments' : 'pay-rates',
                    form === 'assign' ? v : { ...v, effectiveFrom: localInstant(v.effectiveFrom) },
                  );
                  if (form === 'assign') {
                    const selected = data.shifts.find((x) => x.id === v.shiftId);
                    if (selected) setDate(localDay(selected.starts_at));
                  }
                  setForm(undefined);
                }}
              />
            )}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title="Chi tiết phân công" close={() => setDetail(undefined)}>
          <div className="wf-detail">
            <Person name={detail.display_name} sub={detail.username} />
            <Badge tone={attendanceState(detail).tone}>{attendanceState(detail).label}</Badge>
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
              {detail.attendance_status === 'APPROVED' && (
                <>
                  <div>
                    <dt>Giờ công đã duyệt</dt>
                    <dd>{duration(detail.approved_minutes)}</dd>
                  </div>
                  <div>
                    <dt>Tiền công</dt>
                    <dd>{vnd(detail.amount)}</dd>
                  </div>
                </>
              )}
            </dl>
            {detail.attendance_status === 'APPROVED' && (
              <PayDetails components={detail.pay_components} snapshot={detail.pay_snapshot} />
            )}
            {detail.review_note && <Hint>{workforceNote(detail.review_note)}</Hint>}
            <div className="wf-actions">
              {detail.status === 'ASSIGNED' &&
                detail.attendance_status !== 'APPROVED' &&
                new Date(String(detail.ends_at)).getTime() <= Date.now() && (
                  <button
                    className="primary-button"
                    onClick={() => {
                      setReview(detail);
                      setDetail(undefined);
                    }}
                  >
                    Duyệt giờ công
                  </button>
                )}
              {detail.status === 'ASSIGNED' && !detail.attendance_id && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setCancel(detail);
                    setDetail(undefined);
                  }}
                >
                  Hủy phân công
                </button>
              )}
            </div>
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
      {cancel && (
        <Modal title="Hủy phân công" close={() => setCancel(undefined)}>
          <div className="wf-form-modal">
            <Person name={cancel.display_name} sub={cancel.username} />
            <EntryForm
              title="Lý do hủy"
              submit="Xác nhận hủy phân công"
              successMessage={`Đã hủy phân công của ${String(cancel.display_name)}.`}
              confirm="Hủy phân công này? Nhân viên sẽ không thể chấm công vào ca. Lý do hủy được lưu trong lịch sử; ca làm vẫn còn để bạn phân người thay thế."
              fields={[{ key: 'reason', label: 'Lý do hủy' }]}
              onSubmit={async (v) => {
                await save('assignments/' + cancel.id + '/cancel', v);
                setCancel(undefined);
              }}
            />
          </div>
        </Modal>
      )}
      {history && data && (
        <Modal title="Lịch sử đơn giá giờ" close={() => setHistory(undefined)}>
          <div className="wf-detail">
            <Person name={history.display_name} sub={history.username} />
            <ServerHistory
              kind="rates"
              placeholder="Tìm lý do hoặc người cập nhật…"
              filters={{ scope: history.id }}
              refreshKey={data.rates}
            >
              {(rows) => (
                <>
                  {rows.map((r) => (
                    <div className="wf-history-row" key={r.id}>
                      <strong>{vnd(r.hourly_rate)} / giờ</strong>
                      <p>Từ {moment(r.effective_from)}</p>
                      <small>
                        {workforceNote(r.reason)} - {String(r.actor_name)}
                      </small>
                    </div>
                  ))}
                </>
              )}
            </ServerHistory>
            <button
              className="primary-button"
              onClick={() => {
                setPickedPerson(history.id);
                setHistory(undefined);
                setForm('rate');
              }}
            >
              Thêm đơn giá mới
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
