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
      <EntryForm
        key={JSON.stringify(data.risk.policies)}
        title="Ngưỡng xét duyệt"
        fields={Object.entries(data.risk.defaults).map(([key, value]) => ({
          key,
          label: riskLabels[key] ?? key,
          value: String(data.risk.policies.find((p) => p.config_key === key)?.value_json ?? value),
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
    </>
  );
}
