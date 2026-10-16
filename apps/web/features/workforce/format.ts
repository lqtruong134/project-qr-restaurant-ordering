export const moment = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : 'Chưa ghi nhận';
export function localInstant(value: unknown) {
  // Forms explicitly use restaurant local time, independent of the device timezone.
  return new Date(String(value) + ':00+07:00').toISOString();
}
export function calendarDate(value: unknown) {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  // PostgreSQL DATE may arrive as an ISO instant at midnight in the restaurant's timezone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(text));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Presentation aliases only. Forms and API requests keep the stored code. */
export function workforceCode(value: unknown) {
  return String(value ?? '').replace(/^DEMO-(?:WF2-|CA-)/, 'CA-');
}

const legacyWorkforceNotes: Record<string, string> = {
  'Hoàn thành ca trong dung sai, duyệt đủ công chuẩn.': 'Duyệt đủ công ca.',
  'Đi muộn 35 phút; quản trị xác nhận công thực tế trong lịch.':
    'Đi muộn 35 phút; tính công thực tế.',
  'Về sớm 30 phút; quản trị duyệt công theo thời gian trong lịch.':
    'Về sớm 30 phút; tính công thực tế.',
  'Nhân viên báo nghỉ trước; nghỉ được ghi nhận, không tính công.':
    'Nghỉ đã báo trước; không tính công.',
  'Không đến làm ca; quản trị xác nhận vắng, 0 công.': 'Vắng ca; không tính công.',
  'Quên ra ca; quản trị đối chiếu thực tế và bổ sung đủ công, không tạo giờ ra giả.':
    'Quên ra ca; đã đối chiếu và bổ sung công.',
  'Quản lý yêu cầu ở lại kiểm kê thêm 1 giờ; đã xác nhận công ngoại lệ.':
    'Kiểm kê cuối ca; duyệt thêm 1 giờ.',
  'Đơn giá cơ bản để thử ca làm và lương; không phải thỏa thuận trả lương thực tế.':
    'Đơn giá giờ cơ bản.',
  'Đơn giá minh họa cho dữ liệu demo; quản trị điều chỉnh theo thỏa thuận thực tế.':
    'Đơn giá giờ cơ bản.',
  'Khoản khấu trừ theo thỏa thuận minh họa; không tự phạt đi muộn': 'Khấu trừ theo thỏa thuận.',
  'Minh họa đã chi lương ngoài hệ thống; không phải giao dịch ngân hàng thật.': 'Chi lương.',
  'Dấu chấm công minh họa để thử hàng đợi duyệt; không phải chấm công thực tế.':
    'Chờ đối chiếu giờ vào và ra ca.',
};

/**
 * Condense known legacy bootstrap wording for personnel screens. Source records
 * and audit events are unchanged; arbitrary manager notes are not rewritten.
 */
export function workforceNote(value: unknown) {
  const text = String(value ?? '').trim();
  const unprefixed = text.replace(/^DỮ LIỆU MẪU:\s*/i, '');
  return legacyWorkforceNotes[unprefixed] ?? unprefixed;
}
