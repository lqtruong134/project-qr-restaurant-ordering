'use client';
import { useState } from 'react';
import { api, vnd, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import WorkforceForm from './workforce-form';
import { workforceCode } from './format';
import { Badge, duration, Hint, PanelHeading } from './ui';

export const templateTime = (t: Row) =>
  `${String(t.start_time).slice(0, 5)} – ${String(t.end_time).slice(0, 5)}${t.ends_next_day ? ' (+1 ngày)' : ''}`;
const timeMinutes = (v: unknown) =>
  Number(String(v).slice(0, 2)) * 60 + Number(String(v).slice(3, 5));
export default function ShiftTemplates({
  templates,
  refresh,
}: {
  templates: Row[];
  refresh: () => Promise<void>;
}) {
  const [edit, setEdit] = useState<Row | null>(),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('active');
  const visible = templates.filter(
    (t) =>
      matches(`${t.code} ${workforceCode(t.code)} ${t.name}`, query) &&
      (filter === 'all' || Boolean(t.is_active) === (filter === 'active')),
  );
  return (
    <div className="wf-panel">
      <PanelHeading
        title="Mẫu ca dùng chung"
        description="Lưu giờ làm và thời gian nghỉ của các ca thường dùng. Chọn mẫu để lập lịch; lương được tính theo từng nhân viên và chính sách áp dụng."
      >
        <button className="primary-button" onClick={() => setEdit(null)}>
          <Icon name="plus" size={16} />
          Thêm mẫu ca
        </button>
      </PanelHeading>
      <div className="wf-toolbar">
        <Search value={query} onChange={setQuery} placeholder="Tìm tên hoặc mã mẫu ca…" />
        <label>
          Trạng thái mẫu ca
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Đang dùng</option>
            <option value="inactive">Ngừng dùng</option>
            <option value="all">Tất cả</option>
          </select>
        </label>
      </div>
      <div className="wf-template-list">
        {visible.map((t) => (
          <article className="wf-template-card" key={t.id}>
            <div className="wf-template-title">
              <div>
                <h4>{String(t.name)}</h4>
                <small>Mã ca: {workforceCode(t.code)}</small>
              </div>
              <Badge tone={t.is_active ? 'green' : 'muted'}>
                {t.is_active ? 'Đang dùng' : 'Ngừng dùng'}
              </Badge>
            </div>
            <strong className="wf-template-time">{templateTime(t)}</strong>
            <p>
              Giờ công theo lịch:{' '}
              <strong>
                {duration(
                  timeMinutes(t.end_time) -
                    timeMinutes(t.start_time) +
                    (t.ends_next_day ? 1440 : 0) -
                    Number(t.break_minutes),
                )}
              </strong>
            </p>
            <p>
              {Number(t.break_minutes) > 0
                ? `Nghỉ không tính công: ${t.break_minutes} phút`
                : 'Không có thời gian nghỉ không tính công'}
            </p>
            <p>
              {t.hourly_rate_override
                ? `Đơn giá cũ đã lưu: ${vnd(t.hourly_rate_override)} / giờ (công trước chính sách mới)`
                : 'Dùng đơn giá cơ bản của từng nhân viên'}
            </p>
            <footer>
              <small>Đã dùng để lập {String(t.scheduled_count ?? 0)} ca</small>
              <button className="secondary-button" onClick={() => setEdit(t)}>
                Sửa mẫu ca
              </button>
            </footer>
          </article>
        ))}
      </div>
      {!visible.length && (
        <Empty title={templates.length ? 'Không có mẫu ca phù hợp' : 'Chưa có mẫu ca'}>
          {templates.length
            ? 'Thử tìm tên khác hoặc đổi bộ lọc trạng thái.'
            : 'Thêm mẫu ca, sau đó vào Lịch phân ca để chọn ngày và phân công nhân viên.'}
        </Empty>
      )}
      <Hint>
        Sửa mẫu áp dụng cho lịch tạo sau. Ca đã lập giữ nguyên giờ làm và thời gian nghỉ. Công theo
        chính sách mới dùng lương riêng của từng người, kể cả mẫu ca có đơn giá cũ. Ngừng dùng mẫu
        sẽ ẩn mẫu đó khi lập lịch mới.
      </Hint>
      {edit !== undefined && (
        <Modal title={edit ? 'Sửa mẫu ca' : 'Thêm mẫu ca'} close={() => setEdit(undefined)}>
          <TemplateForm template={edit} refresh={refresh} done={() => setEdit(undefined)} />
        </Modal>
      )}
    </div>
  );
}
function TemplateForm({
  template: t,
  refresh,
  done,
}: {
  template: Row | null;
  refresh: () => Promise<void>;
  done: () => void;
}) {
  const [start, setStart] = useState(String(t?.start_time ?? '09:00').slice(0, 5)),
    [end, setEnd] = useState(String(t?.end_time ?? '15:00').slice(0, 5)),
    [next, setNext] = useState(Boolean(t?.ends_next_day)),
    [hasBreak, setHasBreak] = useState(Number(t?.break_minutes ?? 0) > 0),
    [unpaid, setUnpaid] = useState(
      Number(t?.break_minutes ?? 0) > 0 ? Number(t?.break_minutes) : 30,
    );
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)),
    length = minutes(end) - minutes(start) + (next ? 1440 : 0),
    paid = length - (hasBreak ? unpaid : 0);
  return (
    <WorkforceForm
      submit={t ? 'Cập nhật mẫu ca' : 'Tạo mẫu ca'}
      successMessage={t ? 'Đã cập nhật mẫu ca.' : 'Đã tạo mẫu ca mới.'}
      confirm={
        t
          ? () =>
              'Lưu thay đổi mẫu ca? Lịch tạo sau sẽ dùng thông tin mới. Ca đã lập và công đã duyệt giữ nguyên.'
          : undefined
      }
      onSubmit={async (v) => {
        const body = {
          code: v.get('code'),
          name: v.get('name'),
          startTime: start,
          endTime: end,
          endsNextDay: next,
          hasBreak,
          breakMinutes: hasBreak ? unpaid : 0,
          useShiftRate: Boolean(t?.hourly_rate_override),
          hourlyRate: t?.hourly_rate_override ?? undefined,
          sortOrder: Number(v.get('sortOrder')),
          version: t?.version,
          isActive: v.get('isActive') === 'on',
          reason: v.get('reason'),
        };
        try {
          await api(
            '/core/workforce/templates' + (t ? '/' + t.id : ''),
            body,
            t ? 'PATCH' : 'POST',
          );
          await refresh();
          done();
        } catch (e) {
          await refresh();
          throw e;
        }
      }}
    >
      <div className="core-fields">
        <label>
          Mã mẫu ca
          <input
            name="code"
            required
            maxLength={64}
            placeholder="Ví dụ: CA_SANG"
            defaultValue={String(t?.code ?? '')}
          />
        </label>
        <label>
          Tên mẫu ca
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Ví dụ: Ca sáng"
            defaultValue={String(t?.name ?? '')}
          />
        </label>
        <label>
          Giờ bắt đầu
          <input
            name="startTime"
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Giờ kết thúc
          <input
            name="endTime"
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <label className="wf-checkbox">
        <input
          name="endsNextDay"
          type="checkbox"
          checked={next}
          onChange={(e) => setNext(e.target.checked)}
        />
        Kết thúc vào ngày hôm sau
      </label>
      <label className="wf-checkbox">
        <input
          name="hasBreak"
          type="checkbox"
          checked={hasBreak}
          onChange={(e) => setHasBreak(e.target.checked)}
        />
        Có thời gian nghỉ không tính công
      </label>
      {hasBreak && (
        <label>
          Thời gian nghỉ không tính công (phút)
          <input
            name="breakMinutes"
            type="number"
            min={1}
            max={240}
            required
            value={unpaid}
            onChange={(e) => setUnpaid(Number(e.target.value))}
          />
        </label>
      )}
      <div className="wf-calculation" role="status">
        <span>
          Thời lượng ca <strong>{length > 0 ? duration(length) : 'Kiểm tra giờ kết thúc'}</strong>
        </span>
        <span>
          Nghỉ không tính công <strong>{hasBreak ? unpaid : 0} phút</strong>
        </span>
        <span>
          Giờ công theo lịch <strong>{paid > 0 ? duration(paid) : 'Chưa hợp lệ'}</strong>
        </span>
      </div>
      <Hint>
        Ca mới dùng lương cơ bản của từng nhân viên và chính sách làm đêm, làm thêm, ngày nghỉ đang
        áp dụng. Quản lý mức lương trong mục Đơn giá & chính sách.
      </Hint>
      {t?.hourly_rate_override && (
        <p>
          Đơn giá cũ đã lưu: {vnd(t.hourly_rate_override)} / giờ. Giữ để đối chiếu công trước ngày
          áp dụng chính sách mới.
        </p>
      )}
      <label>
        Thứ tự hiển thị
        <input
          name="sortOrder"
          type="number"
          min={0}
          max={10000}
          required
          defaultValue={String(t?.sort_order ?? 0)}
        />
      </label>
      {t && (
        <>
          <label className="wf-checkbox">
            <input name="isActive" type="checkbox" defaultChecked={Boolean(t.is_active)} />
            Cho phép chọn mẫu này khi lập lịch
          </label>
          <label>
            Lý do cập nhật
            <input
              name="reason"
              required
              maxLength={500}
              placeholder="Ví dụ: đổi giờ mở cửa của nhà hàng"
            />
          </label>
        </>
      )}
    </WorkforceForm>
  );
}
