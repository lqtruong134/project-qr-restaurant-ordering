import type { OnlinePaymentView } from '@thesis/contracts';
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
export function onlinePaymentState(intent: PaymentIntent, now = Date.now()) {
  const online = intent.online;
  const status = online?.status;
  if (status === 'REQUIRES_RECONCILIATION')
    return {
      kind: 'review',
      title: 'Cần quản trị đối soát',
      detail:
        'Khoản chuyển tiền cần được kiểm tra. Không thu thêm cho cùng khoản này; báo quản trị đối chiếu giao dịch.',
      showQr: false,
    };
  if (intent.status === 'SUCCEEDED' || status === 'PAID')
    return {
      kind: 'paid',
      title: 'Đã nhận thanh toán online',
      detail: 'Hệ thống đã xác minh khoản chuyển tiền. Bạn không cần xác nhận nhận tiền thêm.',
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
      detail: online?.lastError || 'Kiểm tra kết nối rồi thử lại. Chưa có xác nhận nhận tiền.',
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
