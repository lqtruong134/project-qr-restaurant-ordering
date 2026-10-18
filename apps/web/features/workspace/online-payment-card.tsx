'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, vnd } from '../shared/components';
import { restaurantDateTime } from '../shared/restaurant-time';
import type { OnlineIntentFunds } from '../shared/payment-refresh';
import {
  isOnlinePaymentPending,
  onlinePaymentState,
  safeCheckoutUrl,
  type PaymentIntent,
} from '../shared/online-payment';

export function OnlinePaymentCard({
  intent,
  canManage = false,
  funds,
  done,
  report,
}: {
  intent: PaymentIntent;
  canManage?: boolean;
  funds?: OnlineIntentFunds;
  done: () => Promise<void>;
  report: (message: string, error?: boolean) => void;
}) {
  const [qr, setQr] = useState(''),
    [qrError, setQrError] = useState(''),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false);
  const state = onlinePaymentState(intent, now);
  const online = intent.online;
  const canPay =
    state.kind === 'pending' && ['PENDING', 'UNDERPAID'].includes(String(online?.status));
  const checkout = canPay ? safeCheckoutUrl(online?.checkoutUrl) : undefined;
  useEffect(() => {
    if (!isOnlinePaymentPending(online?.status)) return;
    const clock = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => clearInterval(clock);
  }, [online?.status]);
  useEffect(() => {
    let live = true;
    setQr('');
    setQrError('');
    if (state.showQr && online?.qrCode) {
      void QRCode.toDataURL(online.qrCode, {
        width: 640,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((image) => {
          if (live) setQr(image);
        })
        .catch(() => {
          if (live)
            setQrError('Không hiển thị được QR. Kiểm tra lại trạng thái hoặc mở trang thanh toán.');
        });
    }
    return () => {
      live = false;
    };
  }, [online?.qrCode, state.showQr]);
  const received = online?.paidAmount ?? '0';
  const remaining = online?.remainingAmount ?? String(intent.amount);
  return (
    <section
      className={'online-payment-card online-' + state.kind}
      aria-label="Khoản thu online"
      data-payment-intent-id={intent.id}
      aria-busy={busy}
    >
      <div className="online-payment-heading">
        <div>
          <span className="online-payment-provider">Online · payOS</span>
          <h3 role="status" aria-live="polite">
            {funds && funds.refundable > 0n ? 'Đã nhận tiền; còn khoản cần hoàn' : state.title}
          </h3>
        </div>
        <strong className="online-payment-amount">{vnd(intent.amount)}</strong>
      </div>
      <p className="online-payment-detail">{state.detail}</p>
      {(state.showQr || checkout) && (
        <div className="online-payment-instructions">
          <div className="online-payment-qr">
            {state.showQr && qr ? (
              <img
                src={qr}
                width={300}
                height={300}
                alt={'QR thanh toán online ' + vnd(remaining)}
              />
            ) : (
              <p role={qrError ? 'alert' : 'status'}>
                {qrError ||
                  (state.showQr
                    ? 'Đang hiển thị QR…'
                    : 'Mở trang thanh toán để xem QR của khoản thu này.')}
              </p>
            )}
          </div>
          <div className="online-payment-facts">
            <p>
              <span>Số tiền của khoản thu</span>
              <strong>{vnd(intent.amount)}</strong>
            </p>
            <p>
              <span>Đã nhận qua ngân hàng</span>
              <strong>{vnd(received)}</strong>
            </p>
            <p>
              <span>Khách còn cần chuyển</span>
              <strong>{vnd(remaining)}</strong>
            </p>
            {online?.status === 'UNDERPAID' && (
              <p role="status">
                <strong>Chỉ chuyển thêm {vnd(remaining)}.</strong> QR có thể còn điền số tiền ban
                đầu; kiểm tra số tiền trong ứng dụng ngân hàng trước khi xác nhận.
              </p>
            )}
            {funds && (
              <>
                <p>
                  <span>Đã tính vào tiền món</span>
                  <strong>{vnd(funds.applied)}</strong>
                </p>
                {funds.refunded > 0n && (
                  <p>
                    <span>Đã hoàn lại khách</span>
                    <strong>{vnd(funds.refunded)}</strong>
                  </p>
                )}
                {funds.refundable > 0n && (
                  <p>
                    <span>Cần hoàn lại khách</span>
                    <strong>{vnd(funds.refundable)}</strong>
                  </p>
                )}
              </>
            )}
            {online?.expiresAt && (
              <p>
                <span>QR có hiệu lực đến</span>
                <strong>{restaurantDateTime(online.expiresAt)}</strong>
              </p>
            )}
            {online?.orderCode && (
              <p>
                <span>Mã thanh toán</span>
                <strong>{online.orderCode}</strong>
              </p>
            )}
            {checkout && (
              <a
                className="secondary-button online-checkout-link"
                href={checkout}
                target="_blank"
                rel="noreferrer noopener"
              >
                Mở trang thanh toán
              </a>
            )}
          </div>
        </div>
      )}
      {funds && !state.showQr && (
        <p>
          Đã tính vào tiền món <strong>{vnd(funds.applied)}</strong>
          {funds.refunded > 0n && (
            <>
              ; đã hoàn lại khách <strong>{vnd(funds.refunded)}</strong>
            </>
          )}
          {funds.refundable > 0n && (
            <>
              ; còn cần hoàn lại khách <strong>{vnd(funds.refundable)}</strong>. Khoản này chưa tự
              bù vào các món còn nợ
            </>
          )}
          .
        </p>
      )}
      {!state.showQr && BigInt(received) > 0n && (
        <p className="online-payment-received">
          Ngân hàng đã xác nhận <strong>{vnd(received)}</strong> cho khoản thu này.
        </p>
      )}
      {canManage && state.kind !== 'paid' && (
        <div className="online-payment-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await api('/core/payments/' + intent.id + '/refresh', {});
                await done();
                report('Đã kiểm tra với ngân hàng và tải lại trạng thái thanh toán.');
              } catch (error) {
                await done().catch(() => undefined);
                report((error as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Đang kiểm tra…' : 'Kiểm tra trạng thái'}
          </button>
          <p className="small-note">
            Hệ thống tự cập nhật khi ngân hàng xác nhận. Chỉ kiểm tra thủ công khi chờ lâu hoặc kết
            nối vừa phục hồi.
          </p>
        </div>
      )}
    </section>
  );
}
