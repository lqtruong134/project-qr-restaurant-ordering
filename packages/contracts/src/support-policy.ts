export const supportTypes = {
  ASSISTANCE: 'Cần nhân viên hỗ trợ',
  WATER: 'Thêm nước',
  UTENSILS: 'Thêm dụng cụ',
  BILL: 'Gọi thanh toán / yêu cầu hóa đơn',
  OTHER: 'Yêu cầu khác',
} as const;
export const supportStatuses: Record<string, string> = {
  NEW: 'Đã gửi yêu cầu',
  ACKNOWLEDGED: 'Nhân viên đang xử lý',
  RESOLVED: 'Đã xử lý',
  CANCELLED: 'Đã hủy',
};
export const supportPolicy = {
  waitingMinutes: 2,
  attentionMinutes: 5,
  pollMs: 3000,
  reuseMessage: 'Yêu cầu này đã được gửi và đang được xử lý.',
} as const;
