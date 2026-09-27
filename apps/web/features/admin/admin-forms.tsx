'use client';
import { useState } from 'react';
import { EntryForm, options, type Row } from '../shared/components';
export const roles = [
  { value: 'STAFF', label: 'Nhân viên phục vụ' },
  { value: 'KITCHEN', label: 'Nhân viên bếp' },
];
export const riskLabels: Record<string, string> = {
  TABLE_MAX_CAPACITY: 'Sức chứa bàn tối đa (không quá 30)',
  SHIFT_MAX_MINUTES: 'Thời lượng ca tối đa (phút, không quá 960)',
  SHIFT_MAX_BREAK_MINUTES: 'Nghỉ giữa ca tối đa (phút)',
  CLOCK_IN_EARLY_MINUTES: 'Cho phép vào sớm trước ca (phút)',
  CLOCK_OUT_LATE_MINUTES: 'Cho phép ra muộn sau ca (phút)',

  ORDER_MIN_INTERVAL_SECONDS: 'Khoảng cách tối thiểu giữa hai lượt (giây)',
  GUEST_5MIN_HARD_LIMIT: 'Một khách: số lượt tối đa trong 5 phút',
  GUEST_MINUTE_REVIEW: 'Một khách: số lượt/phút cần duyệt',
  SESSION_MINUTE_REVIEW: 'Một bàn: số lượt/phút cần duyệt',
  REVIEW_TTL_MINUTES: 'Thời hạn chờ duyệt (phút)',
  PAYMENT_TTL_MINUTES: 'Thời hạn yêu cầu thanh toán (phút)',
  FIRST_ORDER_REVIEW_ENABLED: 'Duyệt lượt đầu của phiên chưa xác minh',
  LINE_QTY_REVIEW: 'Một dòng: số lượng cần duyệt',
  LINE_QTY_HARD_LIMIT: 'Một dòng: số lượng tối đa',
  ORDER_TOTAL_QTY_REVIEW: 'Một lượt: tổng số lượng cần duyệt',
  ORDER_TOTAL_QTY_HARD_LIMIT: 'Một lượt: tổng số lượng tối đa',
  ORDER_AMOUNT_REVIEW_VND: 'Một lượt: tiền cần duyệt (đồng)',
  ORDER_AMOUNT_HARD_LIMIT_VND: 'Một lượt: tiền tối đa (đồng)',
  SESSION_AMOUNT_REVIEW_VND: 'Một phiên: tiền cần duyệt (đồng)',
};
export function LinesForm({
  title,
  mode,
  ingredients,
  options: choices,
  save,
  initial,
}: {
  initial?: { header: Record<string, string>; lines: Record<string, string>[] };
  title: string;
  mode: 'bom' | 'receipt';
  ingredients: Row[];
  options: { value: string; label: string }[];
  save: (header: Record<string, string>, lines: Record<string, string>[]) => Promise<void>;
}) {
  const [lines, setLines] = useState<Record<string, string>[]>(initial?.lines ?? []);
  return (
    <section className="core-card">
      <h2>{title}</h2>
      <EntryForm
        title="Thêm dòng nguyên liệu"
        fields={[
          { key: 'ingredientId', label: 'Nguyên liệu', options: options(ingredients) },
          {
            key: 'quantity',
            label: 'Số lượng theo đơn vị cơ sở',
            type: 'number',
            min: 0.000001,
            step: '0.000001',
          },
          mode === 'bom'
            ? {
                key: 'waste',
                label: 'Hao hụt (%)',
                type: 'number',
                value: 0,
                min: 0,
                max: 100,
                step: '0.01',
              }
            : {
                key: 'unitCost',
                label: 'Đơn giá nhập (đồng)',
                type: 'number',
                min: 0,
                step: '0.000001',
              },
        ]}
        submit="Thêm dòng"
        onSubmit={async (v) => {
          if (lines.some((l) => l.ingredientId === v.ingredientId))
            throw new Error('Nguyên liệu đã có trong danh sách.');
          setLines([...lines, v]);
        }}
      />
      {lines.map((l, i) => (
        <div className="core-line" key={i}>
          <span>
            {String(ingredients.find((x) => x.id === l.ingredientId)?.name)} · {l.quantity}
          </span>
          <button
            className="secondary-button"
            onClick={() => setLines(lines.filter((_, n) => n !== i))}
          >
            Bỏ
          </button>
        </div>
      ))}
      <EntryForm
        title="Thông tin chung"
        fields={[
          {
            key: 'target',
            label: mode === 'bom' ? 'Món áp dụng' : 'Kho nhận',
            options: choices,
            value: initial?.header.target,
          },
          ...(mode === 'bom'
            ? [
                {
                  key: 'yield',
                  label: 'Số phần công thức tạo ra',
                  type: 'number',
                  value: 1,
                  min: 0.000001,
                  step: '0.000001',
                },
              ]
            : [
                { key: 'number', label: 'Số phiếu nhập', value: initial?.header.number },
                {
                  key: 'supplier',
                  label: 'Nhà cung cấp',
                  optional: true,
                  value: initial?.header.supplier,
                },
              ]),
        ]}
        submit={mode === 'bom' ? 'Lưu phiên bản công thức mới' : 'Lưu phiếu nhập nháp'}
        onSubmit={async (h) => {
          if (!lines.length) throw new Error('Cần thêm ít nhất một nguyên liệu.');
          await save(h, lines);
          setLines([]);
        }}
      />
    </section>
  );
}
