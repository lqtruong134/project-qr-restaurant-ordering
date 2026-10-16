import { type Row, vnd } from '../shared/components';

export type PaymentStatus = { kind: string; title: string; detail: string };
const money = (value: unknown) => BigInt(String(value ?? 0));
export function guestPaymentStatus(
  account: Row | null | undefined,
  orders: Row[],
  cartItems = 0,
): PaymentStatus {
  if (money(account?.outstanding_amount) > 0n)
    return {
      kind: 'due',
      title: 'Bàn còn khoản cần thanh toán',
      detail:
        'Bạn có thể trả cả bàn hoặc một phần. Nhân viên hỗ trợ thanh toán; hệ thống cập nhật khi tiền đã được xác nhận.',
    };
  if (money(account?.refund_due_amount) > 0n)
    return {
      kind: 'refund',
      title:
        money(account?.refunded_total) > 0n
          ? 'Nhà hàng đã hoàn một phần cho bàn'
          : 'Nhà hàng cần hoàn tiền cho bàn',
      detail:
        (money(account?.refunded_total) > 0n
          ? 'Đã hoàn ' + vnd(account?.refunded_total) + '. Còn cần hoàn: '
          : 'Số tiền cần hoàn: ') +
        vnd(account?.refund_due_amount) +
        '. Vui lòng trao đổi với nhân viên để nhận lại tiền.',
    };
  if (orders.some((item) => item.status === 'PENDING_REVIEW' && item.item_status !== 'CANCELLED'))
    return {
      kind: 'review',
      title: 'Món đang chờ nhân viên xác nhận',
      detail: 'Tiền món sẽ cập nhật sau khi lượt gọi được duyệt. Hiện bạn chưa cần thanh toán.',
    };
  if (!orders.length)
    return cartItems > 0
      ? {
          kind: 'cart',
          title: 'Bạn chưa gửi món',
          detail:
            'Các món đang ở trong giỏ. Hãy gửi món để nhà hàng tiếp nhận; hiện chưa có khoản cần thanh toán.',
        }
      : {
          kind: 'empty',
          title: 'Bàn chưa có món cần thanh toán',
          detail: 'Bạn chưa gửi món. Hãy xem thực đơn và chọn món khi sẵn sàng.',
        };
  if (money(account?.refunded_total) > 0n)
    return {
      kind: 'refunded',
      title:
        money(account?.charge_total) > 0n
          ? 'Bàn đã thanh toán đủ và nhận tiền hoàn'
          : 'Nhà hàng đã hoàn đủ tiền cần trả lại',
      detail:
        'Đã hoàn lại ' +
        vnd(account?.refunded_total) +
        '. Không còn tiền chờ hoàn; xem các lần hoàn ở thông tin thanh toán của bàn.',
    };
  if (money(account?.charge_total) > 0n && money(account?.paid_total) > 0n)
    return {
      kind: 'paid',
      title: 'Bàn đã thanh toán đủ',
      detail: 'Bạn có thể nhờ nhân viên cung cấp phiếu thanh toán.',
    };
  const cancelled = orders.every(
    (item) =>
      ['CANCELLED', 'REJECTED'].includes(String(item.item_status)) ||
      item.charge_status === 'REVERSED',
  );
  return cancelled
    ? {
        kind: 'cancelled',
        title: 'Hiện không có khoản cần thanh toán',
        detail:
          'Các món đã hủy hoặc không tính tiền được giữ trong chi tiết bên trên. Bạn có thể gọi món khác hoặc nhờ nhân viên hỗ trợ.',
      }
    : {
        kind: 'zero',
        title: 'Hiện không có khoản cần thanh toán',
        detail:
          'Các món hiện có chưa phát sinh số tiền cần trả. Bạn có thể xem chi tiết món hoặc nhờ nhân viên hỗ trợ.',
      };
}
