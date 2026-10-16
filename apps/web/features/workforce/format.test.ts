import { describe, expect, it } from 'vitest';
import { calendarDate, workforceCode, workforceNote } from './format';

describe('restaurant calendar dates', () => {
  it('preserves date-only values without shifting them', () => {
    expect(calendarDate('2026-01-01')).toBe('2026-01-01');
  });
  it('recovers the correct calendar date from PostgreSQL midnight serialized in UTC', () => {
    expect(calendarDate('2025-12-31T17:00:00.000Z')).toBe('2026-01-01');
    expect(calendarDate('2026-01-31T17:00:00.000Z')).toBe('2026-02-01');
    expect(calendarDate('2026-02-28T17:00:00.000Z')).toBe('2026-03-01');
  });
});

describe('legacy workforce presentation', () => {
  it('shows familiar shift aliases without changing current or custom codes', () => {
    expect(workforceCode('DEMO-WF2-SANG')).toBe('CA-SANG');
    expect(workforceCode('DEMO-WF2-2026-09-09-TOI')).toBe('CA-2026-09-09-TOI');
    expect(workforceCode('DEMO-CA-2026-09-30-SANG')).toBe('CA-2026-09-30-SANG');
    expect(workforceCode('CA_SANG')).toBe('CA_SANG');
    expect(workforceCode('DEMO-SPECIAL')).toBe('DEMO-SPECIAL');
  });
  it('retains work decisions, durations and missing-punch context when condensing old notes', () => {
    const original = 'DỮ LIỆU MẪU: Đi muộn 35 phút; quản trị xác nhận công thực tế trong lịch.';
    expect(workforceNote(original)).toBe('Đi muộn 35 phút; tính công thực tế.');
    expect(original).toContain('DỮ LIỆU MẪU:');
    expect(
      workforceNote(
        'DỮ LIỆU MẪU: Quên ra ca; quản trị đối chiếu thực tế và bổ sung đủ công, không tạo giờ ra giả.',
      ),
    ).toBe('Quên ra ca; đã đối chiếu và bổ sung công.');
    expect(
      workforceNote(
        'DỮ LIỆU MẪU: Quản lý yêu cầu ở lại kiểm kê thêm 1 giờ; đã xác nhận công ngoại lệ.',
      ),
    ).toBe('Kiểm kê cuối ca; duyệt thêm 1 giờ.');
  });
  it('preserves bonus details and arbitrary manager notes, including bank references', () => {
    expect(workforceNote('DỮ LIỆU MẪU: Thưởng hỗ trợ phục vụ cuối tuần')).toBe(
      'Thưởng hỗ trợ phục vụ cuối tuần',
    );
    expect(workforceNote('Nguyễn Minh Anh · bổ sung 30 phút hỗ trợ bàn A10.')).toBe(
      'Nguyễn Minh Anh · bổ sung 30 phút hỗ trợ bàn A10.',
    );
    expect(workforceNote('VCB-10102026-1284')).toBe('VCB-10102026-1284');
    expect(workforceNote('Kiểm tra máy demo tại bếp, chưa duyệt thêm công.')).toBe(
      'Kiểm tra máy demo tại bếp, chưa duyệt thêm công.',
    );
  });
  it('does not invent a note when the stored value is absent', () => {
    expect(workforceNote(null)).toBe('');
    expect(workforceNote(undefined)).toBe('');
  });
});
