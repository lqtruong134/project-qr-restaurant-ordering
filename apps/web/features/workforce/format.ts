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
