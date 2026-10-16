import { describe, it, expect } from 'vitest';
import { attendanceSummary } from './attendance.js';
const shift = {
  status: 'ASSIGNED',
  starts_at: '2026-10-06T09:00:00+07:00',
  ends_at: '2026-10-06T15:00:00+07:00',
  break_minutes: 30,
  attendance_grace_minutes: 15,
  clock_in_early_minutes: 15,
  clock_out_late_minutes: 120,
};
const at = (hour: string) => '2026-10-06T' + hour + ':00+07:00';
const end = Date.parse(at('15:00'));
describe('attendance evidence and full-shift suggestions', () => {
  it.each([
    ['08:55', '15:07', 330, 'NORMAL'],
    ['09:08', '14:55', 330, 'NORMAL'],
    ['09:25', '15:00', 305, 'LATE'],
    ['09:00', '14:30', 300, 'EARLY_LEAVE'],
    ['08:45', '16:00', 330, 'OUTSIDE'],
  ])('%s → %s suggests %d, %s', (enter, exit, minutes, type) => {
    expect(
      attendanceSummary({ ...shift, checked_in_at: at(enter), checked_out_at: at(exit) }, end + 1),
    ).toMatchObject({ suggested_minutes: minutes, classification: type, scheduled_minutes: 330 });
  });
  it('a zero break gives a four-hour standard overnight shift', () => {
    expect(
      attendanceSummary({
        ...shift,
        starts_at: '2026-10-06T22:00:00+07:00',
        ends_at: '2026-10-07T02:00:00+07:00',
        break_minutes: 0,
        checked_in_at: '2026-10-06T21:55:00+07:00',
        checked_out_at: '2026-10-07T02:08:00+07:00',
      }),
    ).toMatchObject({ scheduled_minutes: 240, suggested_minutes: 240 });
  });
  it('expired self checkout keeps missing evidence and does not fabricate paid time', () => {
    expect(
      attendanceSummary({ ...shift, checked_in_at: at('09:00') }, end + 121 * 60000),
    ).toMatchObject({ classification: 'MISSING_OUT', can_check_out: false, suggested_minutes: 0 });
    expect(attendanceSummary(shift, end + 1)).toMatchObject({
      classification: 'MISSING_IN',
      suggested_minutes: 0,
    });
  });
  it('clock window is separate from grace, and boundaries are inclusive', () => {
    expect(attendanceSummary(shift, Date.parse(at('08:45'))).can_check_in).toBe(true);
    expect(attendanceSummary(shift, Date.parse(at('08:45')) - 1).can_check_in).toBe(false);
    expect(
      attendanceSummary({ ...shift, checked_in_at: at('09:00') }, end + 120 * 60000).can_check_out,
    ).toBe(true);
  });
  it('never pays overlapping tolerance if there is no presence inside a short shift', () => {
    expect(
      attendanceSummary(
        {
          ...shift,
          ends_at: at('09:10'),
          break_minutes: 0,
          checked_in_at: at('09:12'),
          checked_out_at: at('09:13'),
        },
        end,
      ).suggested_minutes,
    ).toBe(0);
  });
  it('approved absence and recorded leave are distinct from missing punches', () => {
    expect(
      attendanceSummary({ ...shift, attendance_status: 'APPROVED', outcome: 'LEAVE' }, end + 1)
        .classification,
    ).toBe('LEAVE');
    expect(
      attendanceSummary({ ...shift, attendance_status: 'APPROVED', outcome: 'ABSENT' }, end + 1)
        .classification,
    ).toBe('ABSENT');
  });
});
