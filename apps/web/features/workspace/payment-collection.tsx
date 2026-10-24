'use client';
import { collectionAmounts } from '../shared/collection-availability';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, vnd, type Row } from '../shared/components';
import { CashHistory } from './payment-handover';
import { MoneyInput } from '../shared/money-input';
import { requestId } from '../shared/request-id';
import type { Bill } from './receipt';
import { OnlinePaymentCard } from './online-payment-card';
import { paymentMethodLabel, type PaymentIntent } from '../shared/online-payment';
const value = (v: unknown) => {
  try {
    return BigInt(String(v ?? 0));
  } catch {
    return 0n;
  }
};
function collectionMessage(payment: Row) {
  const m = payment.metadata as unknown as { cashReceived?: string; changeGiven?: string } | null;
  return payment.method === 'CASH'
    ? `Đã ghi nhận thanh toán tiền món ${vnd(payment.amount)}. Khách đưa ${vnd(m?.cashReceived ?? payment.amount)} - Tiền cần thối ${vnd(m?.changeGiven ?? 0)}.`
    : `Đã ghi nhận chuyển khoản ${vnd(payment.amount)}.`;
}
export function CashPreview({
  amount,
  received,
  changeState,
}: {
  amount: string;
  received: string;
  changeState?: 'returned' | 'pending' | 'unverified';
}) {
  const enough = value(received) >= value(amount);
  return (
    <div className="cash-preview" aria-label="Kiểm tra tiền lần này">
      <div>
        <span>Thanh toán cho món</span>
        <strong>{vnd(amount)}</strong>
      </div>
      <div>
        <span>Tiền khách đưa</span>
        <strong>{vnd(received)}</strong>
      </div>
      <div className={enough ? 'change-due' : 'cash-short'}>
        <span>
          {enough
            ? changeState === 'returned'
              ? 'Đã thối cho khách'
              : changeState === 'unverified'
                ? 'Tiền thối ghi nhận'
                : 'Tiền cần thối'
            : 'Còn thiếu'}
        </span>
        <strong>
          {vnd(enough ? value(received) - value(amount) : value(amount) - value(received))}
        </strong>
      </div>
    </div>
  );
}
function BankEvidence({
  reference,
  setReference,
  setImage,
  hasProof,
  selectedImage,
}: {
  reference: string;
  setReference: (s: string) => void;
  setImage: (s: string) => void;
  hasProof: boolean;
  selectedImage: boolean;
}) {
  const [filename, setFilename] = useState(''),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selectedImage && input.current) input.current.value = '';
  }, [selectedImage]);
  return (
    <div className="bank-evidence">
      <label>
        Mã giao dịch ngân hàng (hoặc ảnh chứng từ)
        <input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
      </label>
      <label className="proof-upload">
        Ảnh chứng từ chuyển khoản
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError('');
            setImage('');
            setFilename('');
            if (
              !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
              file.size > 2 * 1024 * 1024
            ) {
              setError('Chọn PNG, JPEG hoặc WebP tối đa 2 MB.');
              e.target.value = '';
              return;
            }
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).split(',')[1]!);
                r.onerror = () => reject(Error('Không đọc được ảnh.'));
                r.readAsDataURL(file);
              });
              setImage(data);
              setFilename(file.name);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {((selectedImage && filename) || hasProof) && (
        <p className="proof-ready">
          {selectedImage && filename ? 'Đã chọn ' + filename : 'Đã có ảnh chứng từ được lưu'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="small-note">
        Ảnh là chứng từ đối chiếu. Chỉ xác nhận sau khi kiểm tra tiền đã vào tài khoản nhà hàng.
      </p>
    </div>
  );
}
function TenderFields({
  method,
  amount,
  received,
  setReceived,
  reference,
  setReference,
  setImage,
  hasProof,
  selectedImage,
}: {
  method: string;
  amount: string;
  received: string;
  setReceived: (s: string) => void;
  reference: string;
  setReference: (s: string) => void;
  setImage: (s: string) => void;
  hasProof: boolean;
  selectedImage: boolean;
}) {
  if (method === 'BANK_TRANSFER')
    return <BankEvidence {...{ reference, setReference, setImage, hasProof, selectedImage }} />;
  const suggestions = [
    ...new Set([
      amount,
      ...[50000, 100000, 200000, 500000, 1000000]
        .filter((n) => BigInt(n) >= value(amount))
        .map(String),
    ]),
  ].slice(0, 6);
  return (
    <>
      <MoneyInput
        label="Tiền mặt khách đưa (đồng)"
        value={received}
        onChange={setReceived}
        min={amount}
        presets={suggestions.map((n, i) => ({ value: n, label: i === 0 ? 'Đủ tiền' : vnd(n) }))}
      />
      <CashPreview amount={amount} received={received} />
    </>
  );
}
export function PaymentCapture({
  intent,
  done,
  report,
}: {
  intent: PaymentIntent;
  done: () => Promise<void>;
  report: (s: string, error?: boolean) => void;
}) {
  const [received, setReceived] = useState(String(intent.amount)),
    [reference, setReference] = useState(''),
    [image, setImage] = useState(''),
    [busy, setBusy] = useState(false);
  if (intent.method === 'ONLINE')
    return <OnlinePaymentCard intent={intent} done={done} report={report} />;
  const valid =
    intent.method === 'CASH'
      ? value(received) >= value(intent.amount)
      : !!(reference.trim() || image || intent.proof);
  return (
    <form
      className="collection-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !valid) return;
        setBusy(true);
        try {
          if (image) await api('/core/payments/' + intent.id + '/proof', { data: image });
          const payment = await api<Row>('/core/payments/' + intent.id + '/confirm', {
            amount: intent.amount,
            receivedAmount: received,
            reference: reference.trim() || undefined,
          });
          report(collectionMessage(payment));
          await done();
        } catch (e) {
          report((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <h3>Xác nhận sau khi nhận đủ tiền</h3>
        <TenderFields
          method={String(intent.method)}
          amount={String(intent.amount)}
          {...{ received, setReceived, reference, setReference, setImage }}
          hasProof={!!intent.proof}
          selectedImage={!!image}
        />
        <button className="primary-button" disabled={busy || !valid}>
          {busy ? 'Đang ghi nhận…' : 'Tôi đã nhận tiền'}
        </button>
      </fieldset>
    </form>
  );
}
export function CollectionForm({
  bill,
  userId,
  done,
  report,
  preferredRequestId,
}: {
  preferredRequestId?: string;
  bill: Bill;
  userId?: string;
  done: () => Promise<void>;
  report: (s: string, error?: boolean) => void;
}) {
  const requests = useMemo(
    () =>
      (bill.paymentRequests ?? []).filter(
        (r) => r.status === 'ACKNOWLEDGED' && r.acknowledged_by === userId,
      ),
    [bill.paymentRequests, userId],
  );
  const initial = requests.find((r) => r.id === preferredRequestId) ?? requests[0];
  const [request, setRequest] = useState(initial?.id ?? ''),
    [method, setMethod] = useState(String(initial?.payment_method ?? 'CASH')),
    [scope, setScope] = useState('TABLE'),
    [participant, setParticipant] = useState(
      String(initial?.participant_id ?? bill.participants?.[0]?.id ?? ''),
    ),
    [custom, setCustom] = useState(''),
    [received, setReceived] = useState(''),
    [reference, setReference] = useState(''),
    [image, setImage] = useState(''),
    [busy, setBusy] = useState(false);
  const key = useRef(requestId()),
    lastPreferred = useRef(preferredRequestId),
    draft = useRef<PaymentIntent | undefined>(undefined);
  useEffect(() => {
    if (busy || !draft.current) return;
    const latest = bill.intents.find((p) => p.id === draft.current?.id);
    if (!latest || !['CREATED', 'PENDING'].includes(String(latest.status))) {
      draft.current = undefined;
      key.current = requestId();
    }
  }, [bill.intents, busy]);
  useEffect(() => {
    if (busy) return;
    const preferredChanged = lastPreferred.current !== preferredRequestId;
    lastPreferred.current = preferredRequestId;
    if (preferredChanged || !requests.some((r) => r.id === request)) {
      const next = requests.find((r) => r.id === preferredRequestId) ?? requests[0];
      if ((next?.id ?? '') === request) return;
      setRequest(next?.id ?? '');
      if (next) {
        setMethod(String(next.payment_method ?? 'CASH'));
        setParticipant(String(next.participant_id));
        // The first claimed request can arrive after the collection fields become editable.
        // Bind that request without erasing a tender/evidence draft already entered at the table.
        if (request) {
          setReceived('');
          setReference('');
          setImage('');
        }
      }
    }
  }, [requests, preferredRequestId, request, busy]);
  const {
    outstanding,
    reserved,
    available,
    ownOutstanding,
    ownAvailable: own,
    blockedReason,
  } = collectionAmounts(bill.account, bill.charges ?? [], participant, bill.collectionAvailability);
  const amount =
    scope === 'CUSTOM'
      ? custom
      : (scope === 'PARTICIPANT' ? (own < available ? own : available) : available).toString();
  const cash = received || amount;
  const valid =
    value(amount) > 0n &&
    value(amount) <= available &&
    (method === 'ONLINE'
      ? Boolean(bill.paymentCapabilities?.online) &&
        !bill.intents.some(
          (p) => p.method === 'ONLINE' && ['CREATED', 'PENDING'].includes(String(p.status)),
        )
      : method === 'CASH'
        ? value(cash) >= value(amount)
        : !!(reference.trim() || image));
  if (blockedReason)
    return (
      <p className="payment-reservation-note" role="status">
        {blockedReason}
      </p>
    );
  if (available <= 0n)
    return (
      <p className="small-note">
        {value(bill.account.outstanding_amount) === 0n
          ? value(bill.account.refund_due_amount) > 0n
            ? 'Còn tiền phải hoàn khách. Xử lý hoàn tiền trước khi kết thúc bàn.'
            : !bill.closure?.canClose
              ? 'Đã thu đủ tiền. Còn công việc cần hoàn tất trước khi kết thúc bàn; xem danh sách bên dưới.'
              : 'Đã thu đủ tiền và hoàn tất công việc. Chỉ kết thúc bàn sau khi khách đã rời đi.'
          : 'Còn phải thu ' +
            vnd(outstanding) +
            '. Toàn bộ số này đang có khoản thu chờ xác nhận; chưa được xem là đã thanh toán.'}
      </p>
    );
  if ((bill.paymentRequests?.length ?? 0) > 0 && !requests.length)
    return (
      <p className="collection-ownership-note" role="status">
        Nhận lời gọi phía trên trước khi thu tiền. Lời gọi đồng nghiệp đã nhận cần bàn giao và được
        bạn đồng ý.
      </p>
    );
  return (
    <form
      className="collection-form"
      aria-label="Thu tiền tại bàn"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !valid) return;
        setBusy(true);
        try {
          draft.current ??= await api<PaymentIntent>(
            '/core/sessions/' + bill.session.id + '/payments',
            {
              requestId: key.current,
              method,
              amount,
              collectionScope: scope === 'PARTICIPANT' ? 'PARTICIPANT' : 'TABLE',
              participantId: scope === 'PARTICIPANT' ? participant : undefined,
              supportRequestId: request || undefined,
            },
          );
          if (method === 'ONLINE') {
            report(
              'Đã tạo khoản thu online. Mời khách quét QR; hệ thống tự xác nhận khi nhận tiền.',
            );
            draft.current = undefined;
            key.current = requestId();
            await done();
            return;
          }
          if (image && method === 'BANK_TRANSFER')
            await api('/core/payments/' + draft.current.id + '/proof', { data: image });
          const payment = await api<Row>('/core/payments/' + draft.current.id + '/confirm', {
            amount,
            receivedAmount: cash,
            reference: reference.trim() || undefined,
          });
          report(collectionMessage(payment));
          setRequest('');
          draft.current = undefined;
          key.current = requestId();
          setReceived('');
          setImage('');
          setReference('');
          await done();
        } catch (e) {
          report((e as Error).message, true);
          await done();
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <h3>Thu tiền lần này</h3>
        {requests.length > 0 && (
          <label>
            Lời gọi thu tiền
            <select
              value={request}
              onChange={(e) => {
                setRequest(e.target.value);
                const r = requests.find((x) => x.id === e.target.value);
                if (r) {
                  setMethod(String(r.payment_method ?? 'CASH'));
                  setParticipant(String(r.participant_id));
                }
              }}
            >
              {requests.map((r) => (
                <option value={r.id} key={r.id}>
                  {String(r.display_name ?? 'Khách')} -{' '}
                  {!r.payment_method
                    ? 'Chọn hình thức tại bàn'
                    : r.payment_method === 'CASH'
                      ? 'Tiền mặt'
                      : 'Chuyển khoản'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="money-chips payment-methods" aria-label="Hình thức thu tiền">
          {[
            ['CASH', 'Tiền mặt'],
            ['BANK_TRANSFER', 'Chuyển khoản'],
            ['ONLINE', 'Online (payOS)'],
          ].map(([m, label]) => (
            <button
              type="button"
              key={m}
              aria-pressed={method === m}
              disabled={
                m === 'ONLINE' &&
                (!bill.paymentCapabilities?.online ||
                  bill.intents.some(
                    (p) =>
                      p.method === 'ONLINE' && ['CREATED', 'PENDING'].includes(String(p.status)),
                  ))
              }
              onClick={() => setMethod(m!)}
            >
              {label}
            </button>
          ))}
        </div>
        {!bill.paymentCapabilities?.online && (
          <p className="small-note">
            {bill.paymentCapabilities?.reason ||
              'Thanh toán online chưa được cấu hình. Bạn có thể thu tiền mặt hoặc kiểm tra chuyển khoản.'}
          </p>
        )}
        {bill.intents.some(
          (p) => p.method === 'ONLINE' && ['CREATED', 'PENDING'].includes(String(p.status)),
        ) && (
          <p className="small-note">
            Bàn đang có một khoản thu online. Tiếp tục khoản thu đó trước khi tạo QR mới; các khoản
            còn lại vẫn có thể thu riêng.
          </p>
        )}
        <div className="amount-choices" aria-label="Chọn phần tiền thanh toán">
          {[
            ['TABLE', 'Cả bàn', 'Còn phải thu ' + vnd(outstanding)],
            ['PARTICIPANT', 'Món của một khách', 'Còn phải thu ' + vnd(ownOutstanding)],
            ['CUSTOM', 'Số tiền khác', 'Nhập khoản thu'],
          ].map(([s, label, detail]) => (
            <button
              type="button"
              key={s}
              aria-pressed={scope === s}
              onClick={() => {
                setScope(s!);
                setReceived('');
              }}
            >
              <strong>{label}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
        <div
          className="collection-availability"
          role="group"
          aria-label="Số tiền còn thu và khoản đang chờ"
        >
          <p>
            <span>Còn phải thu trong phạm vi đã chọn</span>
            <strong>{vnd(scope === 'PARTICIPANT' ? ownOutstanding : outstanding)}</strong>
          </p>
          {reserved > 0n && (
            <p>
              <span>Đang có khoản thu chờ xác nhận của bàn</span>
              <strong>{vnd(reserved)}</strong>
            </p>
          )}
          <p>
            <span>Có thể tạo khoản thu mới</span>
            <strong>{vnd(scope === 'PARTICIPANT' ? own : available)}</strong>
          </p>
          {reserved > 0n && (
            <small>
              Khoản đang chờ chưa phải tiền đã thanh toán. Số có thể thu mới đã loại phần chờ để
              tránh thu trùng.
            </small>
          )}
        </div>
        {scope === 'PARTICIPANT' && (
          <>
            <label>
              Khách thanh toán món riêng
              <select
                value={participant}
                onChange={(e) => {
                  setParticipant(e.target.value);
                  setReceived('');
                }}
              >
                {(bill.participants ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p.display_name)}
                  </option>
                ))}
              </select>
            </label>
            <div className="participant-charge-list" aria-label="Các món trong khoản thu riêng">
              {bill.charges
                .filter(
                  (c) =>
                    c.status === 'ACTIVE' &&
                    c.owner_participant_id === participant &&
                    value(c.unpaid_amount) > 0n,
                )
                .map((c) => (
                  <p key={c.id}>
                    <span>
                      {String(c.quantity)} × {String(c.product_name_snapshot)}
                    </span>
                    <strong>{vnd(c.unpaid_amount)}</strong>
                  </p>
                ))}
              {own <= 0n && <p>Khách này không còn tiền món cần thu.</p>}
            </div>
            <p className="small-note">
              Chỉ thu các món do khách này chọn còn chưa được thanh toán. Món nhân viên gọi hoặc món
              chung có thể thu bằng “Cả bàn” / “Số tiền khác”.
            </p>
          </>
        )}
        {scope === 'CUSTOM' && (
          <MoneyInput
            label="Số tiền thu lần này (đồng)"
            value={custom}
            max={available.toString()}
            onChange={(next) => {
              setCustom(next);
              setReceived('');
            }}
            presets={[{ value: available.toString(), label: 'Thu toàn bộ còn lại' }]}
          />
        )}
        {(method === 'BANK_TRANSFER' || method === 'ONLINE') && (
          <p className="collection-total">
            Thanh toán cho món <strong>{vnd(amount)}</strong>
          </p>
        )}
        {method === 'ONLINE' ? (
          <p className="small-note">
            Tạo QR cho đúng số tiền lần này. Không thu tiền trước và không bấm xác nhận nhận tiền
            cho khoản online.
          </p>
        ) : (
          <TenderFields
            {...{ method, amount, reference, setReference, setImage }}
            received={cash}
            setReceived={setReceived}
            hasProof={false}
            selectedImage={!!image}
          />
        )}
        <button className="primary-button" disabled={busy || !valid}>
          {busy
            ? method === 'ONLINE'
              ? 'Đang tạo QR…'
              : 'Đang ghi nhận…'
            : method === 'ONLINE'
              ? 'Tạo QR thanh toán'
              : 'Ghi nhận đã nhận tiền'}
        </button>
      </fieldset>
    </form>
  );
}
export function LastPayment({ payment }: { payment: Row }) {
  const m = payment.metadata as unknown as {
    cashReceived?: string;
    changeGiven?: string;
    cashHandlingVersion?: number;
    proof?: unknown;
    reference?: string;
    verificationSource?: string;
  } | null;
  return (
    <section className="last-payment">
      <h3>Lần thanh toán gần nhất</h3>
      <p>
        {paymentMethodLabel(payment.method)} - Đã nhận <strong>{vnd(payment.amount)}</strong>
      </p>
      {payment.method === 'CASH' && (payment.cash_received_amount ?? m?.cashReceived) && (
        <CashPreview
          amount={String(payment.amount)}
          received={String(payment.cash_received_amount ?? m?.cashReceived)}
          changeState={
            payment.change_returned_at
              ? 'returned'
              : m?.cashHandlingVersion === 1
                ? 'pending'
                : 'unverified'
          }
        />
      )}{' '}
      <CashHistory payment={payment} statusOnly />
      {payment.method === 'CASH' && !(payment.cash_received_amount ?? m?.cashReceived) && (
        <p className="small-note">Giao dịch cũ chưa lưu tiền khách đưa và tiền thối.</p>
      )}
      {payment.method === 'ONLINE' && (
        <p className="small-note">
          {m?.verificationSource === 'BANK_ADMIN_VERIFIED'
            ? 'Quản trị đã đối chiếu tiền thực nhận qua ngân hàng.'
            : 'Hệ thống đã xác minh thanh toán qua payOS.'}
        </p>
      )}
      {payment.allocated_amount !== undefined && (
        <p className="small-note">
          Đã tính vào tiền món: <strong>{vnd(payment.allocated_amount)}</strong>
          {BigInt(String(payment.refundable_amount ?? 0)) > 0n && (
            <>
              {' '}
              · Cần hoàn lại khách: <strong>{vnd(payment.refundable_amount)}</strong>
            </>
          )}
          .
        </p>
      )}
      <p className="small-note">Số tiền nhận lần này chưa trừ các khoản thực tế hoàn lại khách.</p>
      {!!m?.proof && payment.payment_intent_id && (
        <a
          href={'/api/core/payments/' + payment.payment_intent_id + '/proof'}
          target="_blank"
          rel="noreferrer"
        >
          Xem ảnh chứng từ
        </a>
      )}
    </section>
  );
}
