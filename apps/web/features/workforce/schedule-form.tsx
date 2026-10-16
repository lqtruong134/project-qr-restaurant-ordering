'use client';
import { useState } from 'react';
import { api, type Row } from '../shared/components';
import { Search, matches } from '../shared/primitives';
import WorkforceForm from './workforce-form';
import { notifyInfo, notifySuccess } from '../shared/operation-notice';
import { templateTime } from './shift-templates';
import { addDays, dateLabel, Hint } from './ui';
export default function ScheduleForm({
  templates,
  users,
  areas,
  date,
  assign,
  done,
}: {
  templates: Row[];
  users: Row[];
  areas: Row[];
  date: string;
  assign: boolean;
  done: (date: string) => Promise<void>;
}) {
  const [from, setFrom] = useState(date),
    [to, setTo] = useState(date),
    [search, setSearch] = useState('');
  const active = templates.filter((t) => t.is_active),
    employees = users.filter((u) => u.role !== 'ADMIN' && u.status === 'ACTIVE');
  return (
    <WorkforceForm
      successMessage={false}
      submit={assign ? 'Phân công theo mẫu ca' : 'Lập lịch theo mẫu ca'}
      confirm={(v) =>
        `Lập lịch từ ${dateLabel(from)}/${from.slice(0, 4)} đến ${dateLabel(to)}/${to.slice(0, 4)} với ${v.getAll('templateIds').length} mẫu ca${assign ? ` và ${v.getAll('userIds').length} nhân viên` : ''}? Lịch và phân công đã có được giữ nguyên. Nếu có ca trùng giờ, hệ thống sẽ báo lỗi và chưa lưu lần lập lịch này.`
      }
      onSubmit={async (v) => {
        if (!v.getAll('templateIds').length) throw Error('Chọn ít nhất một mẫu ca.');
        if (assign && !v.getAll('userIds').length) throw Error('Chọn ít nhất một nhân viên.');
        const result = await api<{
          counts: {
            createdShifts: number;
            existingShifts: number;
            createdAssignments: number;
            existingAssignments: number;
          };
        }>('/core/workforce/schedule', {
          from,
          to,
          templateIds: v.getAll('templateIds'),
          ...(assign ? { userIds: v.getAll('userIds'), areaId: v.get('areaId') } : {}),
        });
        await done(from);
        const counts = result.counts;
        if (!counts.createdShifts && !counts.createdAssignments) {
          notifyInfo(
            assign
              ? 'Lịch và phân công đã có sẵn. Không tạo thêm bản ghi.'
              : 'Các ca trong khoảng ngày này đã có sẵn. Không tạo thêm ca.',
          );
        } else {
          const messages = [];
          if (counts.createdShifts) messages.push(`Đã lập ${counts.createdShifts} ca.`);
          if (counts.createdAssignments)
            messages.push(`Đã phân công ${counts.createdAssignments} lượt làm việc.`);
          if (counts.existingShifts) messages.push(`Giữ nguyên ${counts.existingShifts} ca đã có.`);
          if (counts.existingAssignments)
            messages.push(`Giữ nguyên ${counts.existingAssignments} phân công đã có.`);
          notifySuccess(messages.join(' '));
        }
      }}
    >
      <div className="core-fields">
        <label>
          Từ ngày
          <input
            name="from"
            type="date"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (to < e.target.value) setTo(e.target.value);
            }}
          />
        </label>
        <label>
          Đến ngày (bao gồm)
          <input
            name="to"
            type="date"
            required
            min={from}
            max={from ? addDays(from, 30) : undefined}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="secondary-button"
        disabled={!from}
        onClick={() => setTo(addDays(from, 6))}
      >
        Chọn 7 ngày từ ngày bắt đầu
      </button>
      <fieldset>
        <legend>Chọn ca cho mỗi ngày trong khoảng đã chọn</legend>
        <div className="wf-choice-grid">
          {active.map((t) => (
            <label className="wf-checkbox" key={t.id}>
              <input name="templateIds" type="checkbox" value={t.id} />
              <span>
                <strong>{String(t.name)}</strong>
                <small>{templateTime(t)}</small>
              </span>
            </label>
          ))}
        </div>
        {!active.length && <p>Chưa có mẫu ca đang dùng. Tạo mẫu trong “Quản lý ca làm” trước.</p>}
      </fieldset>
      {assign && (
        <>
          <fieldset>
            <legend>Chọn nhân viên cho các ca trên</legend>
            <Search value={search} onChange={setSearch} placeholder="Tìm nhân viên để phân công…" />
            {search && (
              <p className="small-note">
                Tìm kiếm không bỏ chọn nhân viên. Những người đã tích chọn vẫn được phân công.
              </p>
            )}
            <div className="wf-choice-grid">
              {employees.map((u) => (
                <label
                  className="wf-checkbox"
                  key={u.id}
                  hidden={!matches(`${u.display_name} ${u.username}`, search)}
                >
                  <input name="userIds" type="checkbox" value={u.id} />
                  <span>
                    <strong>{String(u.display_name)}</strong>
                    <small>
                      {String(u.username)} - {u.role === 'KITCHEN' ? 'Bếp' : 'Phục vụ'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Khu vực phụ trách
            <select name="areaId">
              <option value="">Toàn nhà hàng / bếp</option>
              {areas
                .filter((a) => a.is_active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {String(a.name)}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <Hint>
        {assign
          ? 'Mỗi nhân viên được chọn sẽ làm tất cả các ca trong tất cả các ngày đã chọn. Kiểm tra kỹ khoảng ngày và tránh chọn các ca trùng giờ.'
          : 'Mỗi ngày trong khoảng đã chọn sẽ có các ca này. Sau khi lập lịch, chọn từng ca để phân công nhân viên.'}
      </Hint>
    </WorkforceForm>
  );
}
