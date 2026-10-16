import { describe, expect, it } from 'vitest';
import {
  discountInput,
  newDiscountDraft,
  localPricingTime,
  discountStatus,
  taxPolicyLifecycle,
} from './pricing-admin-model';
import type { DiscountProgram } from '@thesis/contracts';

describe('admin promotion configuration', () => {
  const draft = () => ({
    ...newDiscountDraft(),
    name: 'Ưu đãi bữa trưa',
    startsAt: '2026-10-13T11:00',
    endsAt: '2026-11-13T14:00',
  });
  it('submits one canonical configuration and preserves Vietnam time', () => {
    const input = discountInput({
      ...draft(),
      mode: 'CODE',
      code: ' bua-trua ',
      percent: '10',
      maxDiscountAmount: '50000',
      minEligibleAmount: '300000',
      startTime: '11:00',
      endTime: '14:00',
      weekdays: [5, 1, 3],
    });
    expect(input).toMatchObject({
      code: 'BUA-TRUA',
      startsAt: '2026-10-13T04:00:00.000Z',
      excludeCombos: true,
      weekdays: [1, 3, 5],
      percent: 10,
      fixedAmount: null,
      maxDiscountAmount: '50000',
    });
    expect(localPricingTime(input.startsAt)).toBe('2026-10-13T11:00');
  });
  it('clears fields that do not belong to the chosen discount type or scope', () => {
    expect(
      discountInput({
        ...draft(),
        type: 'FIXED',
        fixedAmount: '25000',
        minEligibleAmount: '50000',
        percent: '90',
        maxDiscountAmount: '50000',
        productIds: ['stale'],
        categoryIds: ['stale'],
      }),
    ).toMatchObject({
      percent: null,
      fixedAmount: '25000',
      maxDiscountAmount: null,
      productIds: [],
      categoryIds: [],
    });
  });
  it.each([
    [{ percent: '51' }, 'Tỷ lệ giảm'],
    [{ type: 'FIXED', fixedAmount: '25000', minEligibleAmount: '49999' }, 'gấp đôi'],
    [{ minEligibleAmount: '-1' }, 'Ngưỡng tiền món'],
    [{ usageLimit: '0' }, 'Giới hạn lượt'],
    [{ type: 'FIXED', fixedAmount: '2.5' }, 'Số tiền giảm'],
    [{ mode: 'CODE', code: 'mã đẹp' }, 'Mã giảm giá'],
    [{ endsAt: '2026-10-12T11:00' }, 'kết thúc'],
    [{ startTime: '22:00', endTime: '02:00' }, 'cùng ngày'],
    [{ startTime: '11:00', endTime: '' }, 'Chọn đủ'],
    [{ scope: 'PRODUCTS', productIds: [] }, 'Chọn ít nhất một món'],
    [{ scope: 'CATEGORIES', categoryIds: [] }, 'Chọn ít nhất một nhóm'],
  ])('rejects incompatible configuration %j', (invalid, message) => {
    expect(() => discountInput({ ...draft(), ...invalid } as ReturnType<typeof draft>)).toThrow(
      message,
    );
  });
  it('reports actual lifecycle and quota rather than only the active flag', () => {
    const row = {
      ...discountInput(draft()),
      id: 'p',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2026-11-01T00:00:00Z',
      status: 'ACTIVE',
      version: 1,
      usedCount: 5,
      reservedCount: 1,
      usageLimit: 6,
      createdAt: '2026-10-01T00:00:00Z',
    } as DiscountProgram;
    expect(discountStatus(row, Date.parse('2026-10-13T00:00:00Z'))).toBe('Đã đủ lượt');
    expect(discountStatus({ ...row, status: 'PAUSED' }, Date.parse('2026-10-13T00:00:00Z'))).toBe(
      'Tạm dừng',
    );
    expect(discountStatus(row, Date.parse('2026-12-01T00:00:00Z'))).toBe('Hết hạn');
  });
});

it('marks a VAT policy replaced by a later version at the same instant without removing history', () => {
  const old = {
    id: 'old',
    effectiveAt: '2027-01-01T00:00:00+07:00',
    defaultRatePercent: 10 as const,
    version: 2,
    reason: 'Lịch ban đầu',
    createdAt: '2026-10-13T00:00:00Z',
  };
  const next = {
    ...old,
    id: 'new',
    effectiveAt: '2026-12-31T17:00:00Z',
    defaultRatePercent: 5 as const,
    version: 3,
    reason: 'Căn cứ mới',
  };
  const data = { current: null, policies: [old, next] };
  expect(taxPolicyLifecycle(old, data, Date.parse('2026-10-13T00:00:00Z'))).toBe('Đã thay thế');
  expect(taxPolicyLifecycle(next, data, Date.parse('2026-10-13T00:00:00Z'))).toBe(
    'Có lịch áp dụng',
  );
  expect(
    taxPolicyLifecycle(next, { ...data, current: next }, Date.parse('2027-01-13T00:00:00Z')),
  ).toBe('Đang áp dụng');
  expect(data.policies).toHaveLength(2);
});
