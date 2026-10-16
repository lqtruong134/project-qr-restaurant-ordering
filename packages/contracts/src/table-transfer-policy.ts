export const tableTransferPolicy = {
  maxGuests: 30,
  maxNoteLength: 400,
  reasons: {
    CUSTOMER_REQUEST: 'Khách yêu cầu đổi bàn',
    MORE_SPACE: 'Cần bàn rộng hơn',
    TABLE_ISSUE: 'Bàn/khu vực có vấn đề',
    AREA_CHANGE: 'Chuyển khu vực',
    OTHER: 'Lý do khác',
  },
} as const;
export type TableTransferReason = keyof typeof tableTransferPolicy.reasons;
