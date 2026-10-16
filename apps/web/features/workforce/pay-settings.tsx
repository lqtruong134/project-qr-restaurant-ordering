'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, api, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import WorkforceForm from './workforce-form';
import { calendarDate } from './format';
import { addDays, Badge, Hint, localDay, PanelHeading } from './ui';

type Settings = { policies: Row[]; calendar: Row[]; timezone: string; today: string };
const dayLabel = (value: unknown) => {
  const day = calendarDate(value);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
};
export default function PaySettings({ employees }: { employees: Row[] }) {
  const [settings, setSettings] = useState<Settings>(),
    [error, setError] = useState(''),
    [form, setForm] = useState<'policy' | 'calendar'>(),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('all');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const value = await api<Settings>('/core/workforce/pay-settings');
      if (version !== request.current) return;
      setSettings(value);
      setError('');
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const current = settings?.policies.find((p) => calendarDate(p.effective_from) <= settings.today);
  const latestPolicyDay = settings?.policies.reduce(
    (latest, p) =>
      calendarDate(p.effective_from) > latest ? calendarDate(p.effective_from) : latest,
    '',
  );
  const nextPolicyDay = latestPolicyDay ? addDays(latestPolicyDay, 1) : undefined;
  const shown = settings?.calendar.filter(
    (c) =>
      (kind === 'all' || c.kind === kind) &&
      matches(
        `${c.name} ${dayLabel(c.date)} ${employees.find((u) => u.id === c.user_id)?.display_name ?? c.display_name ?? (c.kind === 'HOLIDAY' ? 'Toàn nhà hàng' : 'Nhân viên')}`,
        query,
      ),
  );
  return (
    <>
      <section className="wf-panel wf-pay-settings" aria-label="Chính sách tính công và lương">
        <PanelHeading
          title="Chính sách tính công và lương"
          description="Giữ đơn giá riêng của từng người; cộng tiền làm đêm, làm thêm, ngày nghỉ và ngày lễ theo chính sách có hiệu lực."
        >
          <button className="primary-button" onClick={() => setForm('policy')}>
            <Icon name="plus" size={16} />
            Thêm chính sách
          </button>
        </PanelHeading>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!settings ? (
          error ? (
            <Action run={refresh}>Thử tải lại chính sách</Action>
          ) : (
            <p role="status">Đang tải chính sách tính lương…</p>
          )
        ) : (
          <>
            {current ? (
              <div className="wf-pay-policy-grid">
                <div>
                  <span>Giờ đêm 22:00–06:00</span>
                  <strong>Cộng {String(current.night_premium_percent)}%</strong>
                </div>
                <div>
                  <span>Làm thêm ngày thường</span>
                  <strong>{String(current.overtime_weekday_percent)}% lương giờ</strong>
                </div>
                <div>
                  <span>Làm vào ngày nghỉ hằng tuần</span>
                  <strong>{String(current.rest_day_percent)}% lương giờ</strong>
                </div>
                <div>
                  <span>Làm vào ngày lễ</span>
                  <strong>{String(current.holiday_percent)}% lương giờ</strong>
                </div>
              </div>
            ) : (
              <Empty title="Chưa áp dụng chính sách tính lương mới">
                Thêm chính sách và chọn ngày bắt đầu áp dụng. Công trước ngày đó giữ cách tính đã
                lưu.
              </Empty>
            )}
            <Hint>
              Giờ làm thêm cần được quản trị duyệt sau khi xác nhận với nhân viên. Tiền nghỉ lễ
              hưởng lương được ghi riêng với tiền làm trong ngày lễ. Công đã duyệt và phiếu lương đã
              chốt giữ nguyên.
            </Hint>
            {settings.policies.length > 0 && (
              <details className="wf-policy">
                <summary>Lịch sử và chính sách sắp áp dụng</summary>
                <div className="wf-pay-records">
                  {settings.policies.map((p) => (
                    <article key={p.id}>
                      <div className="wf-pay-record-title">
                        <strong>Từ {dayLabel(p.effective_from)}</strong>
                        <Badge
                          tone={
                            p.id === current?.id
                              ? 'green'
                              : calendarDate(p.effective_from) > settings.today
                                ? 'blue'
                                : 'muted'
                          }
                        >
                          {p.id === current?.id
                            ? 'Đang áp dụng'
                            : calendarDate(p.effective_from) > settings.today
                              ? 'Sắp áp dụng'
                              : 'Đã áp dụng'}
                        </Badge>
                      </div>
                      <p>
                        Đêm +{String(p.night_premium_percent)}% · Làm thêm{' '}
                        {String(p.overtime_weekday_percent)}% · Ngày nghỉ{' '}
                        {String(p.rest_day_percent)}% · Lễ {String(p.holiday_percent)}%
                      </p>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>
      <section className="wf-panel wf-pay-settings" aria-label="Lịch ngày lễ và ngày nghỉ">
        <PanelHeading
          title="Lịch ngày lễ và ngày nghỉ"
          description="Ngày lễ áp dụng cho nhà hàng. Ngày nghỉ hằng tuần đặt theo từng nhân viên, không mặc định Chủ nhật là ngày nghỉ."
        >
          <button
            className="primary-button"
            disabled={!settings}
            onClick={() => setForm('calendar')}
          >
            <Icon name="plus" size={16} />
            Thêm ngày nghỉ
          </button>
        </PanelHeading>
        <div className="wf-toolbar">
          <Search
            value={query}
            onChange={setQuery}
            placeholder="Tìm ngày, tên ngày nghỉ hoặc nhân viên…"
          />
          <label>
            Loại ngày
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Tất cả</option>
              <option value="HOLIDAY">Ngày lễ</option>
              <option value="WEEKLY_REST">Nghỉ hằng tuần</option>
            </select>
          </label>
        </div>
        <div className="wf-pay-records">
          {shown?.map((c) => (
            <article key={c.id}>
              <div className="wf-pay-record-title">
                <div>
                  <strong>
                    {dayLabel(c.date)} · {String(c.name)}
                  </strong>
                  <p>
                    {c.kind === 'HOLIDAY'
                      ? 'Ngày lễ · Toàn nhà hàng'
                      : `Nghỉ hằng tuần · ${employees.find((u) => u.id === c.user_id)?.display_name ?? c.display_name ?? 'Nhân viên'}`}
                  </p>
                </div>
                <Action
                  confirm={`Gỡ ngày nghỉ ${String(c.name)} ngày ${dayLabel(c.date)}? Công đã duyệt giữ nguyên; công chưa duyệt sẽ dùng lịch cập nhật.`}
                  confirmLabel="Gỡ ngày nghỉ"
                  successMessage="Đã gỡ ngày nghỉ khỏi lịch."
                  run={async () => {
                    await api('/core/workforce/calendar/' + c.id, undefined, 'DELETE');
                    await refresh();
                  }}
                >
                  Gỡ ngày nghỉ
                </Action>
              </div>
            </article>
          ))}
        </div>
        {settings && !shown?.length && (
          <Empty
            title={
              settings.calendar.length
                ? 'Không có ngày nghỉ phù hợp'
                : 'Chưa ghi nhận ngày lễ và ngày nghỉ'
            }
          >
            {settings.calendar.length
              ? 'Thử đổi tên tìm kiếm hoặc loại ngày.'
              : 'Ghi nhận ngày lễ, Tết và ngày nghỉ của nhân viên trước khi duyệt công liên quan.'}
          </Empty>
        )}
      </section>
      {form && settings && (
        <Modal
          title={form === 'policy' ? 'Thêm chính sách tính lương' : 'Thêm ngày lễ hoặc ngày nghỉ'}
          close={() => setForm(undefined)}
        >
          <div className="wf-form-modal">
            {form === 'policy' ? (
              <WorkforceForm
                submit="Lưu chính sách"
                successMessage="Đã lưu chính sách tính lương mới."
                confirm={() =>
                  'Lưu chính sách? Công từ ngày áp dụng sẽ tính theo các mức này. Công đã duyệt và phiếu lương đã chốt giữ nguyên.'
                }
                onSubmit={async (v) => {
                  await api('/core/workforce/pay-policies', {
                    effectiveFrom: v.get('effectiveFrom'),
                    nightPremiumPercent: Number(v.get('nightPremiumPercent')),
                    overtimeWeekdayPercent: Number(v.get('overtimeWeekdayPercent')),
                    restDayPercent: Number(v.get('restDayPercent')),
                    holidayPercent: Number(v.get('holidayPercent')),
                  });
                  await refresh();
                  setForm(undefined);
                }}
              >
                <label>
                  Ngày bắt đầu áp dụng
                  <input
                    name="effectiveFrom"
                    type="date"
                    required
                    min={nextPolicyDay}
                    defaultValue={
                      nextPolicyDay && nextPolicyDay > settings.today
                        ? nextPolicyDay
                        : (settings.today ?? localDay())
                    }
                  />
                </label>
                <div className="core-fields">
                  <label>
                    Trả thêm cho giờ đêm (%)
                    <input
                      name="nightPremiumPercent"
                      type="number"
                      min={30}
                      max={300}
                      required
                      defaultValue={Number(current?.night_premium_percent ?? 30)}
                    />
                  </label>
                  <label>
                    Lương làm thêm ngày thường (%)
                    <input
                      name="overtimeWeekdayPercent"
                      type="number"
                      min={150}
                      max={1000}
                      required
                      defaultValue={Number(current?.overtime_weekday_percent ?? 150)}
                    />
                  </label>
                  <label>
                    Lương làm ngày nghỉ hằng tuần (%)
                    <input
                      name="restDayPercent"
                      type="number"
                      min={200}
                      max={1000}
                      required
                      defaultValue={Number(current?.rest_day_percent ?? 200)}
                    />
                  </label>
                  <label>
                    Lương làm ngày lễ (%)
                    <input
                      name="holidayPercent"
                      type="number"
                      min={300}
                      max={1000}
                      required
                      defaultValue={Number(current?.holiday_percent ?? 300)}
                    />
                  </label>
                </div>
                <Hint>
                  Mức phần trăm tính trên lương cơ bản của từng người. Làm thêm ban đêm có thêm
                  khoản trả theo quy định, không chỉ nhân một hệ số chung. Hệ thống tách ngày và giờ
                  tự động khi duyệt công.
                </Hint>
              </WorkforceForm>
            ) : (
              <CalendarForm
                employees={employees}
                today={settings.today}
                done={async () => {
                  await refresh();
                  setForm(undefined);
                }}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function CalendarForm({
  employees,
  today,
  done,
}: {
  employees: Row[];
  today: string;
  done: () => Promise<void>;
}) {
  const [kind, setKind] = useState('HOLIDAY');
  return (
    <WorkforceForm
      submit="Lưu ngày nghỉ"
      successMessage="Đã thêm ngày nghỉ vào lịch."
      onSubmit={async (v) => {
        await api('/core/workforce/calendar', {
          date: v.get('date'),
          kind,
          userId: kind === 'WEEKLY_REST' ? v.get('userId') : undefined,
          name: v.get('name'),
        });
        await done();
      }}
    >
      <div className="core-fields">
        <label>
          Ngày nghỉ
          <input name="date" type="date" required defaultValue={today} />
        </label>
        <label>
          Loại ngày
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="HOLIDAY">Ngày lễ</option>
            <option value="WEEKLY_REST">Nghỉ hằng tuần</option>
          </select>
        </label>
      </div>
      {kind === 'WEEKLY_REST' && (
        <label>
          Nhân viên
          <select name="userId" required defaultValue="">
            <option value="" disabled>
              Chọn nhân viên
            </option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>
                {String(u.display_name)} · {String(u.username)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Tên ngày nghỉ
        <input
          name="name"
          required
          maxLength={120}
          placeholder={kind === 'HOLIDAY' ? 'Ví dụ: Quốc khánh 2/9' : 'Ví dụ: Nghỉ theo lịch tuần'}
        />
      </label>
      <Hint>
        Ghi đủ từng ngày nghỉ thực tế, kể cả ngày nghỉ bù. Lịch này dùng để phân loại giờ khi duyệt
        công; không tạo ca làm hay giờ chấm công.
      </Hint>
    </WorkforceForm>
  );
}
