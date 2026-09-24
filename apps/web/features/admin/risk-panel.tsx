'use client';
import type { AdminData, SaveAdmin } from './admin-types';
import { riskLabels } from './admin-forms';
import { EntryForm } from '../shared/components';
export default function RiskPanel({
  data,
  save,
}: {
  data: Pick<AdminData, 'risk'>;
  save: SaveAdmin;
}) {
  return (
    <>
      <p>Các thay đổi áp dụng cho lượt gửi tiếp theo. Đơn cũ giữ kết quả đánh giá tại lúc gửi.</p>
      <div className="risk-intro-grid">
        <article className="core-card">
          <h3>Duyệt lượt đầu</h3>
          <p>Giảm rủi ro khách chưa xác minh gọi món bất thường trong lần đầu.</p>
        </article>
        <article className="core-card">
          <h3>Ngưỡng cảnh báo</h3>
          <p>Đơn vượt số lượng hoặc giá trị sẽ chuyển nhân viên xem xét.</p>
        </article>
        <article className="core-card">
          <h3>Giới hạn cứng</h3>
          <p>Đơn vượt giới hạn sẽ bị chặn, không thể bỏ qua bằng thao tác thông thường.</p>
        </article>
      </div>
      <div className="core-card risk-settings-card">
        <h2>Thiết lập chính sách</h2>
        <EntryForm
          key={JSON.stringify(data.risk.policies)}
          title="Ngưỡng xét duyệt"
          fields={Object.entries(data.risk.defaults).map(([key, value]) => ({
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
              : { type: 'number', min: 1, step: '1' }),
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
    </>
  );
}
