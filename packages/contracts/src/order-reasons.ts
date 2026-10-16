export type ReasonScope =
  | 'GUEST_CANCEL'
  | 'STAFF_CANCEL'
  | 'KITCHEN_UNAVAILABLE'
  | 'KITCHEN_ISSUE'
  | 'ADMIN_LATE'
  | 'ADMIN_WAIVE';
export const orderReasons = {
  CUSTOMER_CHANGED_MIND: { label: 'Khách thay đổi lựa chọn', fault: false },
  OUT_OF_STOCK: { label: 'Không đủ nguyên liệu', fault: false },
  INGREDIENT_QUALITY: { label: 'Nguyên liệu không đạt chất lượng', fault: false },
  EQUIPMENT_FAILURE: { label: 'Thiết bị bếp gặp sự cố', fault: false },
  KITCHEN_ERROR: { label: 'Lỗi chế biến của nhà hàng', fault: true },
  QUALITY_ISSUE: { label: 'Món không đạt chất lượng', fault: true },
  WRONG_ITEM: { label: 'Nhà hàng làm nhầm món', fault: true },
  CUSTOMER_COMPLAINT: { label: 'Xử lý khiếu nại của khách', fault: false },
  OTHER: { label: 'Lý do khác', fault: false },
} as const;
export type OrderReasonCode = keyof typeof orderReasons;
export const reasonsByScope: Record<ReasonScope, readonly OrderReasonCode[]> = {
  GUEST_CANCEL: ['CUSTOMER_CHANGED_MIND', 'OTHER'],
  STAFF_CANCEL: ['CUSTOMER_CHANGED_MIND', 'WRONG_ITEM', 'OTHER'],
  KITCHEN_UNAVAILABLE: ['OUT_OF_STOCK', 'INGREDIENT_QUALITY', 'EQUIPMENT_FAILURE', 'OTHER'],
  KITCHEN_ISSUE: ['KITCHEN_ERROR', 'QUALITY_ISSUE', 'WRONG_ITEM', 'OTHER'],
  ADMIN_LATE: ['CUSTOMER_CHANGED_MIND', 'KITCHEN_ERROR', 'QUALITY_ISSUE', 'WRONG_ITEM', 'OTHER'],
  ADMIN_WAIVE: [
    'CUSTOMER_COMPLAINT',
    'KITCHEN_ERROR',
    'QUALITY_ISSUE',
    'WRONG_ITEM',
    'CUSTOMER_CHANGED_MIND',
    'OTHER',
  ],
};
export const reasonOptions = (scope: ReasonScope) =>
  reasonsByScope[scope].map((value) => ({ value, label: orderReasons[value].label }));
export const reasonLabel = (value: unknown) =>
  typeof value === 'string' && Object.hasOwn(orderReasons, value)
    ? orderReasons[value as OrderReasonCode].label
    : '';
