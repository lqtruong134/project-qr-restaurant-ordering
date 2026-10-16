'use client';
import { useState } from 'react';
import type { Row } from '../shared/components';
import { Action } from '../shared/components';
import { Empty, Icon, Search, matches } from '../shared/primitives';
import {
  addDays,
  attendanceState,
  Badge,
  dateLabel,
  localDay,
  monday,
  PanelHeading,
  Person,
  shiftTime,
  WeekNav,
} from './ui';
import { assignedOnDate, overlapsDate, shiftGroupKey, staffingCount } from './schedule-data';

export default function ScheduleBoard({
  data,
  users,
  areas,
  date,
  onDate,
  onCreate,
  onAssign,
  onDetail,
  refresh,
}: {
  data: { shifts: Row[]; assignments: Row[] };
  users: Row[];
  areas: Row[];
  date: string;
  onDate: (date: string) => void;
  onCreate: () => void;
  onAssign: (shift?: string, user?: string) => void;
  onDetail: (row: Row) => void;
  refresh: () => Promise<void>;
}) {
  const [view, setView] = useState('people'),
    [search, setSearch] = useState(''),
    [role, setRole] = useState('all'),
    [area, setArea] = useState('all');
  const week = monday(date),
    days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const userRole = (a: Row) => users.find((u) => u.id === a.user_id)?.role;
  const matchesFilter = (a: Row) =>
    matches(`${a.display_name} ${a.username}`, search) &&
    (role === 'all' || userRole(a) === role) &&
    (area === 'all' || (area === 'none' ? !a.area_id : a.area_id === area));
  const live = data.assignments.filter((a) => a.status === 'ASSIGNED' && matchesFilter(a));
  const daily = assignedOnDate(live, date),
    counts = staffingCount(daily, users);
  const filtered = search !== '' || role !== 'all' || area !== 'all';
  const slots = [...data.shifts]
    .filter((s) => overlapsDate(s, date) && (!filtered || daily.some((a) => a.shift_id === s.id)))
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const weekSlots = data.shifts.filter(
    (s) =>
      days.includes(localDay(s.starts_at)) && (!filtered || live.some((a) => a.shift_id === s.id)),
  );
  const groups = [
    ...new Map(
      [...weekSlots]
        .sort((a, b) => shiftTime(a).localeCompare(shiftTime(b)))
        .map((s) => [shiftGroupKey(s), s]),
    ).entries(),
  ];
  const shownPeople = users.filter(
    (u) =>
      u.role !== 'ADMIN' &&
      (u.status === 'ACTIVE' || live.some((a) => a.user_id === u.id)) &&
      matches(`${u.display_name} ${u.username}`, search) &&
      (role === 'all' || u.role === role) &&
      (area === 'all' || live.some((a) => a.user_id === u.id)),
  );
  function openDay(day: string) {
    onDate(day);
    setView('day');
  }
  return (
    <div className="wf-schedule">
      <div className="wf-panel">
        <PanelHeading
          title="Lịch phân ca"
          description="Xem nhân viên trong từng ca hoặc lịch cả tuần. Chọn một phân công để xem chấm công và chi tiết."
        >
          <button className="secondary-button" onClick={onCreate}>
            <Icon name="plus" size={16} />
            Lập lịch theo mẫu ca
          </button>
          <button className="primary-button" onClick={() => onAssign()}>
            <Icon name="people" size={16} />
            Phân công nhân viên
          </button>
        </PanelHeading>
        <div className="wf-schedule-controls">
          <div className="wf-view-switch" role="group" aria-label="Cách xem lịch">
            {[
              ['day', 'Ngày theo ca'],
              ['shifts', 'Tuần theo ca'],
              ['people', 'Tuần theo nhân viên'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                className={view === id ? 'active' : ''}
                onClick={() => setView(id!)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="wf-date-controls">
            {view === 'day' ? (
              <>
                <button
                  className="icon-button"
                  aria-label="Ngày trước"
                  onClick={() => onDate(addDays(date, -1))}
                >
                  ‹
                </button>
                <label className="wf-date-picker">
                  <span className="wf-sr-only">Ngày xem lịch</span>
                  <input
                    aria-label="Ngày xem lịch"
                    type="date"
                    value={date}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    onChange={(e) => {
                      if (e.target.value) onDate(e.target.value);
                    }}
                  />
                  <strong>
                    {dateLabel(date)}/{date.slice(0, 4)}
                  </strong>
                </label>
                <button
                  className="icon-button"
                  aria-label="Ngày sau"
                  onClick={() => onDate(addDays(date, 1))}
                >
                  ›
                </button>
                <button className="secondary-button" onClick={() => onDate(localDay())}>
                  Hôm nay
                </button>
              </>
            ) : (
              <WeekNav
                week={week}
                onChange={(w) =>
                  onDate(
                    addDays(date, (new Date(w).getTime() - new Date(week).getTime()) / 86400000),
                  )
                }
              />
            )}
            <Action run={refresh}>
              <Icon name="refresh" size={16} />
              Làm mới
            </Action>
          </div>
        </div>
        <div className="wf-schedule-filters">
          <Search value={search} onChange={setSearch} placeholder="Tìm nhân viên…" />
          <label>
            Bộ phận
            <select
              aria-label="Lọc lịch theo bộ phận"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="all">Tất cả bộ phận</option>
              <option value="STAFF">Phục vụ</option>
              <option value="KITCHEN">Bếp</option>
            </select>
          </label>
          <label>
            Khu vực
            <select
              aria-label="Lọc lịch theo khu vực"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="all">Tất cả khu vực</option>
              <option value="none">Toàn nhà hàng / bếp</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {String(a.name)}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              className="wf-back"
              onClick={() => {
                setSearch('');
                setRole('all');
                setArea('all');
              }}
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
        <div className="wf-day-strip" aria-label="Chọn ngày trong tuần">
          {days.map((d) => {
            const c = staffingCount(assignedOnDate(live, d), users),
              numSlots = data.shifts.filter((s) => overlapsDate(s, d)).length;
            return (
              <button
                key={d}
                aria-label={`Xem ngày ${d}`}
                aria-pressed={d === date}
                className={d === date ? 'active' : ''}
                onClick={() => openDay(d)}
              >
                <span>
                  {dateLabel(d, true).split(',')[0]}
                  {d === localDay() && <i title="Hôm nay" />}
                </span>
                <strong>{dateLabel(d)}</strong>
                <small>
                  {c.people} người -{' '}
                  {filtered
                    ? new Set(assignedOnDate(live, d).map((a) => a.shift_id)).size
                    : numSlots}{' '}
                  ca
                </small>
              </button>
            );
          })}
        </div>
      </div>
      {view === 'day' ? (
        <>
          <div className="wf-day-heading">
            <div>
              <p className="wf-kicker">NHÂN SỰ TRONG NGÀY</p>
              <h3>
                {dateLabel(date, true)}
                <span> / {date.slice(0, 4)}</span>
              </h3>
              <p>
                {filtered
                  ? 'Thống kê và danh sách theo bộ lọc đang chọn.'
                  : 'Mỗi khối là một ca; danh sách bên dưới là người được giao vào ca đó.'}
              </p>
            </div>
            <Badge>{slots.length} ca có lịch</Badge>
          </div>
          <div className="wf-day-stats" aria-label="Thống kê nhân sự trong ngày">
            <div>
              <span>Nhân viên được phân ca</span>
              <strong data-testid="day-people">
                {counts.people}
                <small> người</small>
              </strong>
              <p>{counts.assignments} lượt phân công</p>
            </div>
            <div>
              <span>Phục vụ</span>
              <strong>
                {counts.staff}
                <small> người</small>
              </strong>
              <p>Đếm một lần cho mỗi người</p>
            </div>
            <div>
              <span>Bếp</span>
              <strong>
                {counts.kitchen}
                <small> người</small>
              </strong>
              <p>Đếm một lần cho mỗi người</p>
            </div>
            <div>
              <span>Ca chưa có người</span>
              <strong>
                {slots.filter((s) => !daily.some((a) => a.shift_id === s.id)).length}
                <small> ca</small>
              </strong>
              <p>{filtered ? 'Trong danh sách đang lọc' : 'Đã tạo, chưa phân công'}</p>
            </div>
          </div>
          {!slots.length ? (
            <div className="wf-panel">
              <Empty
                title={filtered ? 'Không có phân công phù hợp' : 'Ngày này chưa có ca làm'}
                icon="table"
              >
                {filtered
                  ? 'Thử đổi ngày hoặc xóa bộ lọc.'
                  : 'Chọn “Lập lịch theo mẫu ca” để đặt lịch, sau đó phân công nhân viên.'}
              </Empty>
            </div>
          ) : (
            <div className="wf-day-shifts">
              {slots.map((s) => {
                const members = daily.filter((a) => a.shift_id === s.id),
                  c = staffingCount(members, users),
                  carry = localDay(s.starts_at) !== date;
                return (
                  <article
                    className="wf-day-shift wf-panel"
                    key={s.id}
                    data-testid={`day-shift-${s.id}`}
                  >
                    <div className="wf-day-shift-heading">
                      <div className="wf-shift-clock">
                        <Icon name="clock" size={21} />
                      </div>
                      <div className="wf-shift-title">
                        <p>
                          {carry
                            ? `Tiếp từ ${dateLabel(localDay(s.starts_at))} - ca qua đêm`
                            : 'CA LÀM'}
                          {!carry && localDay(s.ends_at) !== date ? ' - QUA ĐÊM' : ''}
                        </p>
                        <h4>{String(s.name)}</h4>
                        <strong>{shiftTime(s)}</strong>
                        <small>
                          Nghỉ không tính công {String(s.break_minutes)} phút
                          {carry ? ` - kết thúc ${dateLabel(localDay(s.ends_at))}` : ''}
                        </small>
                      </div>
                      <div className="wf-shift-head-actions">
                        <Badge tone={members.length ? 'green' : 'amber'}>
                          {c.people} người được phân công
                        </Badge>
                        <button
                          className="secondary-button"
                          aria-label={`Phân công vào ${String(s.name)} ${shiftTime(s)}`}
                          onClick={() => onAssign(s.id)}
                        >
                          <Icon name="plus" size={16} />
                          Thêm người vào ca
                        </button>
                      </div>
                    </div>
                    {!members.length ? (
                      <div className="wf-unassigned">
                        <Icon name="people" size={19} />
                        <p>Ca này chưa có người. Chọn “Thêm người vào ca” để phân công.</p>
                      </div>
                    ) : (
                      <div className="wf-role-rosters">
                        {[
                          ['STAFF', 'Phục vụ'],
                          ['KITCHEN', 'Bếp'],
                        ].map(([r, label]) => {
                          const team = members.filter((a) => userRole(a) === r);
                          return (
                            <section key={r} className={r === 'KITCHEN' ? 'wf-roster-kitchen' : ''}>
                              <h5>
                                <span>
                                  <i />
                                  {label}
                                </span>
                                <Badge>{new Set(team.map((a) => a.user_id)).size} người</Badge>
                              </h5>
                              {team.length ? (
                                team.map((a) => (
                                  <button
                                    key={a.id}
                                    className="wf-roster-person"
                                    aria-label={`Chi tiết ${String(a.display_name)} - ${String(s.name)}`}
                                    onClick={() => onDetail(a)}
                                  >
                                    <Person
                                      name={a.display_name}
                                      sub={`${a.username} - ${a.area_name ?? 'Toàn nhà hàng / bếp'}`}
                                    />
                                    <Badge tone={attendanceState(a).tone}>
                                      {attendanceState(a).label}
                                    </Badge>
                                    <span aria-hidden="true">›</span>
                                  </button>
                                ))
                              ) : (
                                <p className="wf-empty-role">
                                  {filtered
                                    ? 'Không có ' + label!.toLowerCase() + ' theo bộ lọc.'
                                    : 'Chưa phân công ' + label!.toLowerCase() + ' vào ca này.'}
                                </p>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <p className="wf-schedule-note">
            Một người làm hai ca vẫn là 1 nhân viên, nhưng có 2 lượt phân công. Ca qua đêm tiếp từ
            hôm trước cũng được hiển thị. Số người trên lịch là số được phân công; xem chấm công để
            biết ai đã vào ca.
          </p>
        </>
      ) : view === 'shifts' ? (
        <div className="wf-panel">
          <PanelHeading
            title="Lịch tuần theo ca"
            description="Xem nhanh số người trong từng ca. Chọn ô ngày để mở danh sách đầy đủ."
          />
          <div className="wf-calendar-scroll">
            <table className="wf-calendar wf-shift-matrix">
              <caption className="wf-sr-only">Lịch tuần theo khung ca</caption>
              <thead>
                <tr>
                  <th scope="col">Ca / giờ làm</th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={d === localDay() ? 'wf-today' : ''}>
                      <button
                        className="wf-calendar-date"
                        aria-label={`Mở lịch ngày ${d}`}
                        onClick={() => openDay(d)}
                      >
                        {dateLabel(d, true)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([key, s]) => (
                  <tr key={key}>
                    <th scope="row">
                      <strong>{String(s.name)}</strong>
                      <small>{shiftTime(s)}</small>
                      <small>Nghỉ không tính công {String(s.break_minutes)} phút</small>
                    </th>
                    {days.map((d) => {
                      const shifts = weekSlots.filter(
                          (x) => shiftGroupKey(x) === key && localDay(x.starts_at) === d,
                        ),
                        ids = new Set(shifts.map((x) => x.id)),
                        members = live.filter((a) => ids.has(String(a.shift_id))),
                        c = staffingCount(members, users);
                      return (
                        <td key={d} className={d === localDay() ? 'wf-today' : ''}>
                          {shifts.length ? (
                            <button
                              className={`wf-coverage-cell ${!members.length ? 'wf-coverage-empty' : ''}`}
                              aria-label={`${String(s.name)}, ${d}: ${c.people} người`}
                              onClick={() => openDay(d)}
                            >
                              <strong>{c.people} người</strong>
                              <span>
                                {c.staff} phục vụ - {c.kitchen} bếp
                              </span>
                              <small>
                                {members.length
                                  ? members
                                      .slice(0, 2)
                                      .map((a) => String(a.display_name))
                                      .join(', ') +
                                    (members.length > 2 ? ` +${members.length - 2}` : '')
                                  : 'Chưa phân công'}
                              </small>
                            </button>
                          ) : (
                            <span className="wf-no-shift">Chưa tạo ca</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!groups.length && <Empty title="Tuần này chưa có ca phù hợp" icon="table" />}
          <p className="wf-schedule-note">
            Gộp ca cùng tên, giờ và thời gian nghỉ vào một hàng; mỗi cột là ngày bắt đầu ca. Lịch
            ngày hiển thị cả phần ca qua đêm tiếp từ hôm trước.
          </p>
        </div>
      ) : (
        <div className="wf-panel">
          <PanelHeading
            title="Lịch tuần theo nhân viên"
            description="Dùng khi cần kiểm tra lịch của một người. Chọn phân công để mở chi tiết."
          />
          <div className="wf-calendar-scroll">
            <table className="wf-calendar">
              <caption className="wf-sr-only">Lịch tuần theo nhân viên</caption>
              <thead>
                <tr>
                  <th scope="col">
                    Nhân viên<small>{shownPeople.length} người</small>
                  </th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={d === localDay() ? 'wf-today' : ''}>
                      <button className="wf-calendar-date" onClick={() => openDay(d)}>
                        {dateLabel(d, true)}
                      </button>
                      <small>
                        {staffingCount(assignedOnDate(live, d), users).people} người trong ngày
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownPeople.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">
                      <Person
                        name={u.display_name}
                        sub={`${u.role === 'KITCHEN' ? 'Bếp' : 'Phục vụ'} - ${u.username}`}
                      />
                    </th>
                    {days.map((d) => (
                      <td key={d} className={d === localDay() ? 'wf-today' : ''}>
                        {live
                          .filter((a) => a.user_id === u.id && localDay(a.starts_at) === d)
                          .map((a) => (
                            <button
                              className={`wf-shift ${u.role === 'KITCHEN' ? 'wf-shift-kitchen' : ''}`}
                              key={a.id}
                              onClick={() => onDetail(a)}
                            >
                              <strong>{shiftTime(a)}</strong>
                              <span>{String(a.shift_name)}</span>
                              <small>{String(a.area_name ?? 'Toàn nhà hàng / bếp')}</small>
                            </button>
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shownPeople.length && <Empty title="Không tìm thấy nhân viên" icon="people" />}
        </div>
      )}
    </div>
  );
}
