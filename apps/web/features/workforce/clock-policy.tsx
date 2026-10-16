'use client';
import { useEffect, useState } from 'react';
import { api, EntryForm, type Row } from '../shared/components';
import { Hint } from './ui';
export default function ClockPolicy() {
  const [data, setData] = useState<{ defaults: Record<string, unknown>; policies: Row[] }>(),
    [error, setError] = useState('');
  useEffect(() => {
    void api<{ defaults: Record<string, unknown>; policies: Row[] }>('/core/risk')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  const labels: Record<string, string> = {
    CLOCK_IN_EARLY_MINUTES: 'Cho phép vào ca sớm tối đa (phút)',
    ATTENDANCE_GRACE_MINUTES: 'Chênh lệch giờ vào, ra được gợi ý tính đủ ca (phút)',
    CLOCK_OUT_LATE_MINUTES: 'Cho phép tự chấm ra sau giờ kết thúc, tối đa (phút)',
  };
  return (
    <details className="wf-policy">
      <summary>Chính sách chấm công của nhà hàng</summary>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <EntryForm
          title="Giờ chấm công và mức chênh lệch cho phép"
          submit="Áp dụng chính sách chấm công"
          successMessage="Đã cập nhật. Ca được lập sau sẽ dùng quy định mới."
          confirm="Lưu quy định chấm công? Ca được lập sau sẽ áp dụng các mốc này. Ca đã lập giữ quy định đang áp dụng."
          fields={Object.entries(labels).map(([key, label]) => ({
            key,
            label,
            type: 'number',
            min: 0,
            max: key === 'ATTENDANCE_GRACE_MINUTES' ? 60 : 240,
            value: String(
              data.policies.find((p) => p.config_key === key)?.value_json ?? data.defaults[key],
            ),
          }))}
          onSubmit={async (v) => {
            await api(
              '/core/risk',
              Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])),
            );
          }}
        />
      )}
      <Hint>
        Mức chênh lệch chỉ dùng để gợi ý tính đủ ca. Giờ làm trước hoặc sau lịch không tự cộng vào
        tiền công. Quản trị vẫn cần kiểm tra và duyệt công.
      </Hint>
    </details>
  );
}
