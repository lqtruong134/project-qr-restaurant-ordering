'use client';
import { AdminHelp } from './admin-help';
import type { AdminData, SaveAdmin } from './admin-types';
import { riskLabels } from './admin-forms';
import { EntryForm } from '../shared/components';
export default function RiskPanel({
  data,
  save,
  initial = 'ordering',
}: {
  data: Pick<AdminData, 'risk'>;
  save: SaveAdmin;
  initial?: string;
}) {
  const group = ['tables', 'workforce'].includes(initial) ? initial : 'ordering';
  const belongs = (key: string) =>
    group === 'workforce'
      ? /^(SHIFT_|CLOCK_|ATTENDANCE_)/.test(key)
      : group === 'tables'
        ? /^(TABLE_|PAYMENT_)/.test(key)
        : !/^(SHIFT_|CLOCK_|ATTENDANCE_|TABLE_|PAYMENT_)/.test(key);
  return (
    <section className="risk-app">
      <AdminHelp topic="risk" />
      <p>
        {group === 'workforce'
          ? 'Quy tắc chấm công được lưu khi tạo ca. Lịch đã tạo giữ quy tắc đã lưu.'
          : group === 'tables'
            ? 'Giới hạn mới áp dụng cho các thao tác sau khi lưu. Giao dịch đã ghi nhận được giữ nguyên.'
            : 'Quy tắc mới áp dụng cho lượt gọi món gửi sau khi lưu. Lượt đã gửi giữ kết quả xét duyệt cũ.'}
      </p>
      {group === 'ordering' && (
        <div className="risk-intro-grid">
          <article className="core-card">
            <h3>Duyệt lượt gọi của bàn chưa xác minh</h3>
            <p>Khi bật, nhân viên phải duyệt lượt gọi của bàn chưa được xác minh tại bàn.</p>
          </article>
          <article className="core-card">
            <h3>Ngưỡng cảnh báo</h3>
            <p>Lượt gọi đạt ngưỡng số lượng, giá trị hoặc tần suất sẽ cần nhân viên duyệt.</p>
          </article>
          <article className="core-card">
            <h3>Giới hạn tối đa</h3>
            <p>
              Lượt gọi vượt giới hạn tối đa sẽ không được gửi; khách cần giảm số lượng hoặc chờ gọi
              tiếp.
            </p>
          </article>
        </div>
      )}

      <div className="core-card risk-settings-card">
        <h2>Thiết lập quy tắc</h2>
        <p>Chỉ lưu các thiết lập trong nhóm đang chọn.</p>
        <EntryForm
          key={group + JSON.stringify(data.risk.policies)}
          title={group === 'ordering' ? 'Ngưỡng xét duyệt và giới hạn' : 'Giới hạn áp dụng'}
          submit="Áp dụng quy tắc"
          successMessage="Đã cập nhật quy tắc trong nhóm đang chọn."
          confirmLabel="Xác nhận áp dụng quy tắc"
          confirm="Lưu các giới hạn trong nhóm này? Những thao tác sau khi lưu sẽ áp dụng quy tắc mới."
          fields={Object.entries(data.risk.defaults)
            .filter(([key]) => belongs(key))
            .map(([key, value]) => ({
              key,
              label: riskLabels[key] ?? key,
              value: String(
                data.risk.policies.find((p) => p.config_key === key)?.value_json ?? value,
              ),
              ...(typeof value === 'boolean'
                ? {
                    options: [
                      { value: 'true', label: 'Bật' },
                      { value: 'false', label: 'Tắt' },
                    ],
                  }
                : {
                    type: 'number',
                    min: [
                      'SHIFT_MAX_BREAK_MINUTES',
                      'CLOCK_IN_EARLY_MINUTES',
                      'CLOCK_OUT_LATE_MINUTES',
                      'ATTENDANCE_GRACE_MINUTES',
                    ].includes(key)
                      ? 0
                      : 1,
                    step: '1',
                    max:
                      (
                        {
                          TABLE_MAX_CAPACITY: 30,
                          LINE_QTY_HARD_LIMIT: 99,
                          REVIEW_TTL_MINUTES: 120,
                          PAYMENT_TTL_MINUTES: 120,
                          SHIFT_MAX_MINUTES: 960,
                          SHIFT_MAX_BREAK_MINUTES: 240,
                          CLOCK_IN_EARLY_MINUTES: 240,
                          CLOCK_OUT_LATE_MINUTES: 240,
                          ATTENDANCE_GRACE_MINUTES: 60,
                        } as Record<string, number>
                      )[key] ?? 100000000000,
                  }),
            }))}
          onSubmit={(v) =>
            save(
              '/core/risk',
              Object.fromEntries(
                Object.entries(v).map(([k, value]) => [
                  k,
                  k === 'FIRST_ORDER_REVIEW_ENABLED' ? value === 'true' : Number(value),
                ]),
              ),
            )
          }
        />
      </div>
    </section>
  );
}
