const restaurantTimeZone = 'Asia/Ho_Chi_Minh';

export function restaurantDateTime(value: unknown) {
  return new Date(String(value)).toLocaleString('vi-VN', { timeZone: restaurantTimeZone });
}

export function restaurantTime(value: unknown, options: Intl.DateTimeFormatOptions = {}) {
  return new Date(String(value)).toLocaleTimeString('vi-VN', {
    ...options,
    timeZone: restaurantTimeZone,
  });
}
