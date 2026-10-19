import type { OnlinePaymentView } from '@thesis/contracts';
import { onlineViewFunds, type OnlineIntentFunds } from './online-funds';
export type { OnlinePaymentView, PaymentCapabilities } from '@thesis/contracts';
export type PaymentIntent = {
  id: string;
  amount: string;
  method: string;
  status: string;
  expires_at?: string;
  support_request_id?: string | null;
  payer_participant_id?: string | null;
  collection_scope?: string;
  proof?: unknown;
  online?: OnlinePaymentView | null;
  [key: string]: unknown;
};
export function paymentMethodLabel(method: unknown) {
  return method === 'CASH'
    ? 'Tiền mặt'
    : method === 'ONLINE'
      ? 'Online (payOS)'
      : method === 'BANK_TRANSFER'
        ? 'Chuyển khoản'
        : 'Thanh toán';
}
export function safeCheckoutUrl(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function onlinePaymentState(
  intent: PaymentIntent,
  now = Date.now(),
  sourceFunds?: OnlineIntentFunds,
) {
  const online = intent.online;
  const status = online?.status;
  if (status === 'REQUIRES_RECONCILIATION')
    return {
      kind: 'review',
      title: 'Quản trị đang kiểm tra khoản chuyển',
      detail:
        'Khoản chuyển đang cần quản trị kiểm tra trước khi ghi nhận thanh toán. Không thu lại cùng khoản này.',
      showQr: false,
    };
  if (intent.status === 'SUCCEEDED') {
    const funds = onlineViewFunds(online) ?? sourceFunds;
    if (
      funds &&
      funds.applied > 0n &&
      funds.refundable === 0n &&
      funds.recorded >= funds.applied + funds.refunded
    )
      return {
        kind: 'paid',
        title: 'Thanh toán thành công',
        detail: 'Hệ thống đã xác minh khoản chuyển tiền. Bạn không cần xác nhận nhận tiền thêm.',
        showQr: false,
      };
    if (funds && funds.applied === 0n && funds.refunded > 0n && funds.recorded === funds.refunded)
      return {
        kind: 'refunded',
        title: 'Khoản thanh toán đã được hoàn lại',
        detail:
          'Tiền đã được hoàn trả và không còn được tính vào tiền món. Xem số dư hóa đơn trước khi thu khoản mới.',
        showQr: false,
      };
  }
  if (status === 'PAID' || intent.status === 'SUCCEEDED')
    return {
      kind: 'pending',
      title: 'Đang xác nhận tiền vào hóa đơn',
      detail:
        'Ngân hàng đã báo kết quả. Nhà hàng đang hoàn tất ghi nhận tiền vào món; chưa thu lại cùng khoản này.',
      showQr: false,
    };
  if (status === 'CANCEL_PENDING')
    return {
      kind: 'pending',
      title: 'Đang kiểm tra để hủy khoản thu',
      detail: 'Chờ hệ thống xác nhận hủy trước khi tạo khoản thu thay thế.',
      showQr: false,
    };
  if (status === 'FAILED' || intent.status === 'FAILED')
    return {
      kind: 'error',
      title: 'Khoản thanh toán online không thành công',
      detail:
        'payOS đã kết thúc khoản này. Không dùng lại QR; kiểm tra phần tiền còn phải trả trước khi lập khoản thu mới.',
      showQr: false,
    };
  if (status === 'PROCESSING')
    return {
      kind: 'pending',
      title: 'Ngân hàng đang xử lý thanh toán',
      detail:
        'Chờ hệ thống đối chiếu kết quả ngân hàng. Không chuyển thêm hoặc tạo khoản thay thế khi chưa rõ kết quả.',
      showQr: false,
    };
  if (intent.status === 'CANCELLED' || status === 'CANCELLED')
    return {
      kind: 'cancelled',
      title: 'Khoản thu online đã hủy',
      detail: 'Không sử dụng QR này. Các khoản tiền đã nhận vẫn được giữ trong lịch sử thanh toán.',
      showQr: false,
    };
  if (
    intent.status === 'EXPIRED' ||
    status === 'EXPIRED' ||
    (online && new Date(online.expiresAt).getTime() <= now)
  )
    return {
      kind: 'expired',
      title: 'QR thanh toán đã hết hạn',
      detail: 'Không sử dụng QR này. Kiểm tra lại trạng thái trước khi tạo khoản thu mới.',
      showQr: false,
    };
  if (status === 'ERROR')
    return {
      kind: 'error',
      title: 'Chưa tạo được QR thanh toán',
      detail:
        'Hệ thống sẽ tự thử kết nối lại. Chưa có xác nhận thanh toán; không tạo lại cùng khoản thu khi chưa rõ kết quả.',
      showQr: false,
    };
  if (!online || status === 'CREATE_PENDING')
    return {
      kind: 'pending',
      title: 'Đang tạo QR thanh toán',
      detail: 'Khoản thu đã được lưu. Chờ hệ thống tạo QR; không tạo lại cùng khoản thu.',
      showQr: false,
    };
  if (status === 'UNDERPAID')
    return {
      kind: 'pending',
      title: 'Đã nhận một phần tiền online',
      detail:
        'Chỉ chuyển phần còn thiếu. Khi quét QR, kiểm tra và chỉnh số tiền trước khi xác nhận; không chuyển lại toàn bộ khoản thu. Hệ thống tự cập nhật tiền nhận.',
      showQr: Boolean(online.qrCode),
    };
  if (status === 'PENDING')
    return {
      kind: 'pending',
      title: 'Đang chờ khách thanh toán',
      detail:
        'Mời khách quét QR bằng ứng dụng ngân hàng. Trạng thái sẽ tự cập nhật khi tiền được xác minh.',
      showQr: Boolean(online.qrCode),
    };
  return {
    kind: 'review',
    title: 'Đang kiểm tra trạng thái thanh toán',
    detail: 'Chưa thể sử dụng QR này. Kiểm tra trạng thái hoặc báo quản trị trước khi thu lại.',
    showQr: false,
  };
}

/** Poll read models while the server still has provider work; local expiry never confirms money. */
export function isOnlinePaymentPending(status: unknown) {
  return [
    'CREATE_PENDING',
    'PENDING',
    'UNDERPAID',
    'PROCESSING',
    'CANCEL_PENDING',
    'ERROR',
  ].includes(String(status));
}
export function hasPendingOnlinePayment(intents: PaymentIntent[]) {
  return intents.some(
    (intent) =>
      intent.method === 'ONLINE' &&
      isOnlinePaymentPending(
        intent.online?.status ??
          (['CREATED', 'PENDING'].includes(intent.status) ? 'CREATE_PENDING' : ''),
      ),
  );
}
