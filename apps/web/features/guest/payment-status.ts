import type { GuestOnlinePayment } from '@thesis/contracts';
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
        money(account?.refund_due_amount) > 0n
          ? 'Còn ' +
            vnd(account?.outstanding_amount) +
            ' tiền món; nhà hàng cần hoàn lại ' +
            vnd(account?.refund_due_amount) +
            '. Khoản cần hoàn chưa được tự bù vào tiền món còn thiếu. Vui lòng trao đổi với nhân viên để xử lý riêng hai khoản.'
          : 'Bạn có thể trả cả bàn hoặc một phần. Nhân viên hỗ trợ thanh toán; hệ thống cập nhật khi tiền đã được xác nhận.',
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

/** Guest wording uses only server-projected statuses, never redirect parameters or screenshots. */
export function guestOnlinePaymentStatus(payment: GuestOnlinePayment): PaymentStatus {
  if (money(payment.refundableAmount) > 0n)
    return {
      kind: 'review',
      title: 'Khoản chuyển có phần cần hoàn lại',
      detail:
        'Nhà hàng đã nhận ' +
        vnd(payment.paidAmount) +
        ', đã tính ' +
        vnd(payment.appliedAmount) +
        ' vào tiền món và cần hoàn lại ' +
        vnd(payment.refundableAmount) +
        '. Phần cần hoàn chưa tự bù vào các món còn nợ; vui lòng trao đổi với nhân viên.',
    };
  switch (payment.status) {
    case 'PAID': {
      const applied = /^\d+$/.test(payment.appliedAmount ?? '')
        ? money(payment.appliedAmount)
        : undefined;
      const recorded = money(payment.paidAmount);
      const refunded = money(payment.refundedAmount);
      if (applied !== undefined && applied === 0n && refunded > 0n && recorded === refunded)
        return {
          kind: 'refunded',
          title: 'Khoản thanh toán đã được hoàn lại',
          detail:
            'Nhà hàng đã hoàn tiền cho khoản này. Xem số dư cả bàn trước khi thanh toán khoản mới.',
        };
      if (applied === undefined || applied <= 0n || recorded < applied + refunded)
        return {
          kind: 'pending',
          title: 'Nhà hàng đang xác nhận thanh toán',
          detail:
            'Ngân hàng đã báo kết quả nhưng nhà hàng chưa ghi nhận tiền vào món. Vui lòng chờ và không chuyển lại cùng khoản tiền.',
        };
      return {
        kind: 'paid',
        title: 'Thanh toán thành công',
        detail:
          (payment.verificationSource === 'BANK_ADMIN_VERIFIED' ||
          payment.verificationSource === 'MIXED'
            ? 'Nhà hàng đã đối chiếu tiền thực nhận qua quản trị. '
            : 'Nhà hàng đã xác nhận tiền qua ngân hàng. ') +
          'Xem số dư của cả bàn bên trên; khoản này không cần chuyển thêm.',
      };
    }
    case 'UNDERPAID':
      return {
        kind: 'pending',
        title: 'Đã nhận một phần thanh toán',
        detail:
          'Đã nhận ' +
          vnd(payment.paidAmount) +
          '. Còn ' +
          vnd(payment.remainingAmount) +
          ' cho khoản này. Nhân viên hỗ trợ phần còn lại; trạng thái tự cập nhật.',
      };
    case 'REQUIRES_RECONCILIATION':
      return {
        kind: 'review',
        title: 'Nhà hàng đang kiểm tra khoản chuyển tiền',
        detail:
          'Chưa cần chuyển thêm cho cùng khoản này. Hãy trao đổi với nhân viên để đối chiếu; số dư của bàn chỉ thay đổi khi được hệ thống xác nhận.',
      };
    case 'CANCELLED':
      return {
        kind: 'cancelled',
        title: 'Khoản thanh toán online đã hủy',
        detail:
          'Không sử dụng QR cũ. Nếu bạn đã chuyển tiền, báo nhân viên kiểm tra trước khi chuyển lại; tiền đã xác nhận vẫn được giữ trong tổng thanh toán.',
      };
    case 'EXPIRED':
      return {
        kind: 'expired',
        title: 'QR thanh toán đã hết hạn',
        detail:
          'Không sử dụng QR cũ. Nếu đã chuyển tiền, chờ nhân viên đối chiếu trước khi thanh toán lại.',
      };
    case 'FAILED':
      return {
        kind: 'error',
        title: 'Khoản thanh toán chưa hoàn tất',
        detail:
          'Không dùng lại QR này. Nếu đã chuyển tiền, nhờ nhân viên kiểm tra trước khi thử lại.',
      };
    case 'CANCEL_PENDING':
      return {
        kind: 'pending',
        title: 'Đang kiểm tra để hủy khoản thanh toán',
        detail: 'Vui lòng chờ xác nhận và không chuyển thêm cho cùng khoản này.',
      };
    case 'PROCESSING':
      return {
        kind: 'pending',
        title: 'Đang chờ ngân hàng xác nhận',
        detail:
          'Nếu đã chuyển tiền, bạn không cần thao tác thêm. Màn hình tự cập nhật khi nhà hàng xác minh được tiền nhận.',
      };
    case 'CREATE_PENDING':
    case 'ERROR':
      return {
        kind: 'pending',
        title: 'Nhân viên đang chuẩn bị thanh toán online',
        detail:
          'Chưa có xác nhận nhận tiền. Nhân viên sẽ hỗ trợ QR; bạn không cần gửi lại cùng yêu cầu.',
      };
    default:
      return {
        kind: 'pending',
        title: 'Đang chờ thanh toán online',
        detail:
          'Quét QR do nhân viên cung cấp. Nếu đã chuyển, chờ ngân hàng xác nhận; màn hình tự cập nhật, không cần chuyển lại.',
      };
  }
}
