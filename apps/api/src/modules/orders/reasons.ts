import {
  orderReasons,
  reasonsByScope,
  type OrderReasonCode,
  type ReasonScope,
} from '@thesis/contracts';
import { reject } from '../shared/core-persistence.js';
export function parseReason(body: Record<string, unknown>, scope: ReasonScope) {
  // Legacy free text never grants automatic financial forgiveness.
  const fallback =
    scope === 'GUEST_CANCEL'
      ? 'CUSTOMER_CHANGED_MIND'
      : scope === 'KITCHEN_UNAVAILABLE'
        ? 'OUT_OF_STOCK'
        : 'OTHER';
  const raw = body.reasonCode ?? fallback;
  if (typeof raw !== 'string' || !Object.hasOwn(orderReasons, raw))
    reject('Chọn lý do hợp lệ.', 400);
  const code = raw as OrderReasonCode;
  if (!reasonsByScope[scope].includes(code))
    reject('Vai trò này không được dùng lý do đã chọn cho thao tác này.', 403);
  const supplied = body.note ?? body.reason ?? '';
  if (typeof supplied !== 'string' || supplied.trim().length > 500)
    reject('Ghi chú tối đa 500 ký tự.', 400);
  const note = supplied.trim();
  if (
    !note &&
    (code === 'OTHER' ||
      (orderReasons[code].fault && scope !== 'KITCHEN_ISSUE') ||
      scope === 'ADMIN_WAIVE')
  )
    reject('Vui lòng ghi rõ sự việc để đối chiếu.', 400);
  return {
    code,
    note,
    fault: orderReasons[code].fault,
    text: orderReasons[code].label + (note ? ': ' + note : ''),
  };
}
