import type { DiscountProgram, TaxPolicy, TaxSettings } from '@thesis/contracts';

export type DiscountDraft = {
  name: string;
  description: string;
  mode: 'AUTO' | 'CODE';
  code: string;
  type: 'PERCENT' | 'FIXED';
  percent: string;
  fixedAmount: string;
  minEligibleAmount: string;
  maxDiscountAmount: string;
  startsAt: string;
  endsAt: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  scope: 'ALL' | 'PRODUCTS' | 'CATEGORIES';
  productIds: string[];
  categoryIds: string[];
  usageLimit: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
};

const restaurantTimezone = 'Asia/Ho_Chi_Minh';
export function localPricingTime(value: Date | string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: restaurantTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const p = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}

export function pricingTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: restaurantTimezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function newDiscountDraft(row?: DiscountProgram): DiscountDraft {
  const now = new Date();
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    name: row?.name ?? '',
    description: row?.description ?? '',
    mode: row?.mode ?? 'AUTO',
    code: row?.code ?? '',
    type: row?.type ?? 'PERCENT',
    percent: String(row?.percent ?? 10),
    fixedAmount: row?.fixedAmount ?? '',
    minEligibleAmount: row?.minEligibleAmount ?? '0',
    maxDiscountAmount: row?.maxDiscountAmount ?? '',
    startsAt: localPricingTime(row?.startsAt ?? now),
    endsAt: localPricingTime(row?.endsAt ?? nextMonth),
    weekdays: row?.weekdays ?? [],
    startTime: row?.startTime ?? '',
    endTime: row?.endTime ?? '',
    scope: row?.scope ?? 'ALL',
    productIds: row?.productIds ?? [],
    categoryIds: row?.categoryIds ?? [],
    usageLimit: row?.usageLimit == null ? '' : String(row.usageLimit),
    status: row?.status ?? 'PAUSED',
  };
}

export function discountInput(draft: DiscountDraft) {
  const integer = (value: string, field: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    if (
      !/^[0-9]+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new Error(
        `${field} phải là số nguyên từ ${min.toLocaleString('vi-VN')}${max === Number.MAX_SAFE_INTEGER ? ' trở lên' : ` đến ${max.toLocaleString('vi-VN')}`}.`,
      );
    return Number(value);
  };
  if (!draft.name.trim()) throw new Error('Nhập tên chương trình khuyến mãi.');
  if (draft.mode === 'CODE' && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(draft.code.trim().toUpperCase()))
    throw new Error('Mã giảm giá gồm 3–32 chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.');
  const startsAt = new Date(draft.startsAt + ':00+07:00');
  const endsAt = new Date(draft.endsAt + ':00+07:00');
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
  if (
    !!draft.startTime !== !!draft.endTime ||
    (draft.startTime && draft.endTime <= draft.startTime)
  )
    throw new Error('Chọn đủ giờ bắt đầu và kết thúc trong cùng ngày; giờ kết thúc phải muộn hơn.');
  if (draft.scope === 'PRODUCTS' && !draft.productIds.length)
    throw new Error('Chọn ít nhất một món lẻ được hưởng ưu đãi.');
  if (draft.scope === 'CATEGORIES' && !draft.categoryIds.length)
    throw new Error('Chọn ít nhất một nhóm món được hưởng ưu đãi.');
  const minEligibleAmount = String(
    integer(draft.minEligibleAmount, 'Ngưỡng tiền món', 0, 100000000000),
  );
  const percent = draft.type === 'PERCENT' ? integer(draft.percent, 'Tỷ lệ giảm', 1, 50) : null;
  const fixedAmount =
    draft.type === 'FIXED'
      ? String(integer(draft.fixedAmount, 'Số tiền giảm', 1, 100000000000))
      : null;
  if (fixedAmount !== null && BigInt(minEligibleAmount) < 2n * BigInt(fixedAmount))
    throw new Error(
      'Tiền món tối thiểu phải ít nhất gấp đôi số tiền giảm để ưu đãi không vượt 50%.',
    );
  const maxDiscountAmount =
    draft.type === 'PERCENT' && draft.maxDiscountAmount
      ? String(integer(draft.maxDiscountAmount, 'Mức giảm tối đa', 1, 100000000000))
      : null;
  const usageLimit = draft.usageLimit
    ? integer(draft.usageLimit, 'Giới hạn lượt', 1, 1000000)
    : null;
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    mode: draft.mode,
    code: draft.mode === 'CODE' ? draft.code.trim().toUpperCase() : null,
    type: draft.type,
    percent,
    fixedAmount,
    minEligibleAmount,
    maxDiscountAmount,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    startTime: draft.startTime || null,
    endTime: draft.endTime || null,
    scope: draft.scope,
    productIds: draft.scope === 'PRODUCTS' ? draft.productIds : [],
    categoryIds: draft.scope === 'CATEGORIES' ? draft.categoryIds : [],
    excludeCombos: true,
    usageLimit,
    status: draft.status,
  };
}

export function discountStatus(row: DiscountProgram, now = Date.now()) {
  if (row.status === 'ARCHIVED') return 'Đã lưu trữ';
  if (row.status === 'PAUSED') return 'Tạm dừng';
  if (new Date(row.endsAt).getTime() <= now) return 'Hết hạn';
  if (new Date(row.startsAt).getTime() > now) return 'Chưa bắt đầu';
  if (row.usageLimit != null && row.usedCount + row.reservedCount >= row.usageLimit)
    return 'Đã đủ lượt';
  return 'Đang bật';
}

export const taxRateOptions = [
  { value: '8', label: '8% — mức giảm có điều kiện' },
  { value: '10', label: '10% — mức thông thường' },
  { value: '5', label: '5% — nhóm hàng áp dụng' },
  { value: '0', label: '0% — thuế suất 0%' },
];

export function taxPolicyLifecycle(
  policy: TaxPolicy,
  data: Pick<TaxSettings, 'policies' | 'current'>,
  now = Date.now(),
) {
  if (
    data.policies.some(
      (other) =>
        other.version > policy.version &&
        new Date(other.effectiveAt).getTime() === new Date(policy.effectiveAt).getTime(),
    )
  )
    return 'Đã thay thế';
  if (data.current?.id === policy.id) return 'Đang áp dụng';
  return new Date(policy.effectiveAt).getTime() > now ? 'Có lịch áp dụng' : 'Đã áp dụng';
}
