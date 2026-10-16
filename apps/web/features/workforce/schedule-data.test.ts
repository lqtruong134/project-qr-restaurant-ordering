import { describe, expect, it } from 'vitest';
import { assignedOnDate, overlapsDate, shiftGroupKey, staffingCount } from './schedule-data';
const users = [
  { id: 'a', role: 'STAFF' },
  { id: 'b', role: 'KITCHEN' },
];
const shift = (start: string, end: string) => ({
  id: 'shift',
  starts_at: start + '+07:00',
  ends_at: end + '+07:00',
});
describe('daily staffing', () => {
  it('counts distinct people separately from assignments and ignores cancelled assignments', () => {
    expect(
      staffingCount(
        [
          { id: '1', user_id: 'a', status: 'ASSIGNED' },
          { id: '2', user_id: 'a', status: 'ASSIGNED' },
          { id: '3', user_id: 'b', status: 'ASSIGNED' },
          { id: '4', user_id: 'c', status: 'CANCELLED' },
        ],
        users,
      ),
    ).toEqual({ people: 2, assignments: 3, staff: 1, kitchen: 1 });
  });
  it('includes overnight carryover but excludes shifts ending exactly at midnight', () => {
    expect(overlapsDate(shift('2026-09-30T21:00:00', '2026-10-01T03:00:00'), '2026-10-01')).toBe(
      true,
    );
    expect(overlapsDate(shift('2026-09-30T18:00:00', '2026-10-01T00:00:00'), '2026-10-01')).toBe(
      false,
    );
    expect(
      assignedOnDate(
        [{ ...shift('2026-10-01T09:00:00', '2026-10-01T15:00:00'), status: 'CANCELLED' }],
        '2026-10-01',
      ),
    ).toEqual([]);
  });
  it('groups recurring shifts by name, local hours, overnight span and break', () => {
    const first = {
      ...shift('2026-09-30T09:00:00', '2026-09-30T15:00:00'),
      name: 'Ca sáng',
      break_minutes: 30,
    };
    const next = {
      ...shift('2026-10-01T09:00:00', '2026-10-01T15:00:00'),
      name: 'Ca sáng',
      break_minutes: 30,
    };
    expect(shiftGroupKey(first)).toBe(shiftGroupKey(next));
    expect(shiftGroupKey({ ...next, name: 'Ca khác' })).not.toBe(shiftGroupKey(first));
    expect(shiftGroupKey({ ...next, break_minutes: 0 })).not.toBe(shiftGroupKey(first));
  });
});
