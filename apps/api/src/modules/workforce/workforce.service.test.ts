import { describe, expect, it, vi } from 'vitest';
import type { Connection } from '../shared/core-persistence.js';
import { assertAssignmentAvailable, timestamp } from './workforce.service.js';

describe('workforce timestamps', () => {
  it.each([
    ['2024-02-29T09:00:00+07:00', '2024-02-29T02:00:00.000Z'],
    ['2026-12-31T23:59:59.123Z', '2026-12-31T23:59:59.123Z'],
    ['2026-01-01T09:30-04:00', '2026-01-01T13:30:00.000Z'],
  ])('accepts real calendar dates with explicit timezone: %s', (input, expected) => {
    expect(timestamp(input)).toBe(expected);
  });
  it.each([
    '2026-02-30T09:00:00+07:00',
    '2025-02-29T09:00:00Z',
    '2026-04-31T09:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T09:60:00Z',
    '2026-01-01T09:00:00',
    '2026-01-01T09:00:00+07:99',
  ])('rejects normalized or incomplete timestamps: %s', (input) => {
    expect(() => timestamp(input)).toThrow();
  });
});

describe('assignment conflict feedback', () => {
  const user = { id: 'employee', display_name: 'Nguyễn An', username: 'pv001' };
  const shift = {
    id: 'candidate',
    starts_at: '2026-10-02T01:00:00+07:00',
    ends_at: '2026-10-02T03:00:00+07:00',
  };
  const conflicting = {
    shift_id: 'overnight',
    status: 'ASSIGNED',
    shift_name: 'Ca đêm',
    starts_label: '01/10/2026 22:00',
    ends_label: '02/10/2026 02:00',
  };
  const connection = (rows: unknown[]) =>
    ({ query: vi.fn().mockResolvedValue({ rows }) }) as unknown as Connection;
  it('identifies employee and full overnight interval, explaining bulk rollback', async () => {
    await expect(
      assertAssignmentAvailable(connection([conflicting]), 'restaurant', user, shift, true),
    ).rejects.toMatchObject({
      statusCode: 409,
      publicMessage:
        'Nhân viên Nguyễn An có ca “Ca đêm” (01/10/2026 22:00 → 02/10/2026 02:00) trùng giờ. Không có lịch hoặc phân công mới nào được lưu; hãy điều chỉnh lựa chọn.',
    });
  });
  it('distinguishes an exact duplicate from a cancelled assignment', async () => {
    await expect(
      assertAssignmentAvailable(
        connection([{ ...conflicting, shift_id: shift.id }]),
        'restaurant',
        user,
        shift,
      ),
    ).rejects.toThrow('đã được phân công vào ca');
    await expect(
      assertAssignmentAvailable(
        connection([{ ...conflicting, shift_id: shift.id, status: 'CANCELLED' }]),
        'restaurant',
        user,
        shift,
      ),
    ).rejects.toThrow('đã có phân công bị hủy');
  });
  it('allows an available assignment', async () => {
    await expect(
      assertAssignmentAvailable(connection([]), 'restaurant', user, shift),
    ).resolves.toBeUndefined();
  });
});
