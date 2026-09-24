'use client';
import { useCallback, useEffect, useState } from 'react';
import { Action, api, EntryForm, options, vnd, type Row } from '../shared/components';
import { Empty, Modal } from '../shared/primitives';
import PayrollPanel from './payroll-panel';

import { moment, localInstant } from './format';
export default function WorkforcePanel({ users, areas }: { users: Row[]; areas: Row[] }) {
  const [data, setData] = useState<{ shifts: Row[]; assignments: Row[]; rates: Row[] }>(),
    [error, setError] = useState(''),
    [section, setSection] = useState('schedule'),
    [review, setReview] = useState<Row>(),
    [cancel, setCancel] = useState<Row>();
  const refresh = useCallback(async () => {
    try {
      setData(await api('/core/workforce'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(path: string, b: unknown) {
    await api('/core/workforce/' + path, b);
    await refresh();
  }
  const people = users
    .filter((u) => u.status === 'ACTIVE' && u.role !== 'ADMIN')
    .map((u) => ({ value: u.id, label: String(u.display_name) + ' · ' + u.username }));
  return (
    <>
      <nav className="filter-chips" aria-label="Nhân sự và lương">
        {[
          ['schedule', 'Lịch & chấm công'],
          ['rates', 'Đơn giá giờ'],
          ['payroll', 'Bảng lương'],
        ].map(([id, title]) => (
          <button
            key={id}
            className={section === id ? 'active' : ''}
            onClick={() => setSection(id!)}
          >
            {title}
          </button>
        ))}
      </nav>
      <p className="small-note">
        Giờ hiển thị theo Việt Nam (UTC+7). Ca qua đêm: chọn ngày kết thúc là ngày hôm sau.
      </p>
      <div className="workflow-strip" aria-label="Quy trình ca làm và lương">
        {[
          ['1', 'Tạo ca', 'Chủ quán tạo ca theo ngày và giờ thực tế.'],
          ['2', 'Phân công', 'Chọn nhân viên phục vụ hoặc bếp; hệ thống chặn ca trùng.'],
          ['3', 'Chấm công', 'Nhân viên tự ghi nhận vào/ra, quản trị duyệt phút được trả.'],
          ['4', 'Chốt lương', 'Lấy đơn giá tại thời điểm ca, thêm thưởng/phạt rồi khóa kỳ.'],
        ].map(([step, title, description]) => (
          <div className="workflow-step" key={step}>
            <span>{step}</span>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {section === 'payroll' ? (
        <PayrollPanel />
      ) : !data ? (
        <p>Đang tải nhân sự…</p>
      ) : section === 'rates' ? (
        <>
          <EntryForm
            title="Thêm đơn giá có hiệu lực"
            fields={[
              { key: 'userId', label: 'Nhân viên', options: people },
              {
                key: 'hourlyRate',
                label: 'Đơn giá một giờ (đồng)',
                type: 'number',
                min: 1000,
                max: 10000000,
              },
              { key: 'effectiveFrom', label: 'Có hiệu lực từ', type: 'datetime-local' },
              { key: 'reason', label: 'Lý do / thỏa thuận' },
            ]}
            onSubmit={(v) =>
              save('pay-rates', { ...v, effectiveFrom: localInstant(v.effectiveFrom) })
            }
          />
          <p>
            Đơn giá được chọn theo lúc ca bắt đầu. Không sửa lịch sử đơn giá đã áp dụng cho giờ công
            được duyệt.
          </p>
          {data.rates.map((r) => (
            <article className="core-card" key={r.id}>
              <h3>
                {String(r.display_name)} · {String(r.username)}
              </h3>
              <p>
                {vnd(r.hourly_rate)} / giờ · Từ {moment(r.effective_from)}
              </p>
              <p>{String(r.reason)}</p>
            </article>
          ))}
        </>
      ) : (
        <>
          <div className="core-grid">
            <details className="core-card">
              <summary>Tạo ca làm</summary>
              <EntryForm
                title="Ca theo ngày cụ thể"
                fields={[
                  { key: 'code', label: 'Mã ca (ví dụ SANG-20260925)' },
                  { key: 'name', label: 'Tên ca' },
                  { key: 'startsAt', label: 'Bắt đầu', type: 'datetime-local' },
                  { key: 'endsAt', label: 'Kết thúc', type: 'datetime-local' },
                  {
                    key: 'breakMinutes',
                    label: 'Nghỉ không tính lương (phút)',
                    type: 'number',
                    min: 0,
                    max: 240,
                    value: 30,
                  },
                ]}
                onSubmit={(v) =>
                  save('shifts', {
                    ...v,
                    startsAt: localInstant(v.startsAt),
                    endsAt: localInstant(v.endsAt),
                    breakMinutes: Number(v.breakMinutes),
                  })
                }
              />
            </details>
            <details className="core-card">
              <summary>Phân công nhân viên</summary>
              <EntryForm
                title="Thêm phân công"
                fields={[
                  {
                    key: 'shiftId',
                    label: 'Ca làm',
                    options: data.shifts.map((s) => ({
                      value: s.id,
                      label: String(s.name) + ' · ' + moment(s.starts_at),
                    })),
                  },
                  { key: 'userId', label: 'Nhân viên', options: people },
                  {
                    key: 'areaId',
                    label: 'Khu vực (không bắt buộc)',
                    optional: true,
                    options: [
                      { value: '', label: 'Toàn nhà hàng / bếp' },
                      ...options(areas.filter((a) => a.is_active)),
                    ],
                  },
                ]}
                onSubmit={(v) => save('assignments', v)}
              />
            </details>
          </div>
          <Action run={refresh}>Tải lại lịch và chấm công</Action>
          {!data.assignments.length && <Empty title="Chưa có phân công" />}
          <div className="core-grid">
            {data.assignments.map((a) => (
              <article className="core-card" key={a.id}>
                <h3>
                  {String(a.display_name)} <small>· {String(a.username)}</small>
                </h3>
                <p>
                  {String(a.shift_name)} · {String(a.area_name ?? 'Toàn nhà hàng / bếp')}
                </p>
                <p>
                  {moment(a.starts_at)} → {moment(a.ends_at)}
                </p>
                <p>
                  Nghỉ: {String(a.break_minutes)} phút ·{' '}
                  {a.status === 'CANCELLED'
                    ? 'Đã hủy'
                    : a.attendance_status === 'APPROVED'
                      ? 'Đã duyệt công'
                      : 'Chờ duyệt công'}
                </p>
                <p>
                  Vào: {moment(a.checked_in_at)}
                  <br />
                  Ra: {moment(a.checked_out_at)}
                </p>
                {a.attendance_status === 'APPROVED' ? (
                  <>
                    <strong>
                      {String(a.approved_minutes)} phút · {vnd(a.amount)}
                    </strong>
                    <p>{String(a.review_note)}</p>
                  </>
                ) : (
                  a.status === 'ASSIGNED' && (
                    <div className="core-actions">
                      {new Date(String(a.ends_at)).getTime() <= Date.now() && (
                        <button className="primary-button" onClick={() => setReview(a)}>
                          Duyệt giờ công
                        </button>
                      )}
                      {!a.attendance_id && (
                        <button className="secondary-button" onClick={() => setCancel(a)}>
                          Hủy phân công
                        </button>
                      )}
                    </div>
                  )
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {review && (
        <Modal title="Duyệt giờ công" close={() => setReview(undefined)}>
          <p>
            {String(review.display_name)} · {String(review.username)}
          </p>
          <p>
            Giờ vào/ra gốc được giữ nguyên. Nhập số phút được trả lương sau khi trừ giờ nghỉ; nhập 0
            nếu vắng. Đây là quyết định duyệt công của quản trị.
          </p>
          <EntryForm
            title="Giờ công được duyệt"
            fields={[
              {
                key: 'minutes',
                label: 'Số phút được trả lương',
                type: 'number',
                min: 0,
                max: 960,
                value:
                  review.checked_in_at && review.checked_out_at
                    ? Math.max(
                        0,
                        Math.floor(
                          (new Date(String(review.checked_out_at)).getTime() -
                            new Date(String(review.checked_in_at)).getTime()) /
                            60000,
                        ) - Number(review.break_minutes),
                      )
                    : 0,
              },
              { key: 'note', label: 'Giải thích giờ công / xử lý quên chấm công' },
            ]}
            onSubmit={async (v) => {
              await save('assignments/' + review.id + '/approve', {
                ...v,
                minutes: Number(v.minutes),
              });
              setReview(undefined);
            }}
          />
        </Modal>
      )}
      {cancel && (
        <Modal title="Hủy phân công" close={() => setCancel(undefined)}>
          <EntryForm
            title={String(cancel.display_name)}
            fields={[{ key: 'reason', label: 'Lý do hủy' }]}
            onSubmit={async (v) => {
              await save('assignments/' + cancel.id + '/cancel', v);
              setCancel(undefined);
            }}
          />
        </Modal>
      )}
    </>
  );
}
