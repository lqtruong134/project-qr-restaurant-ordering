'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BillingSummary, DiscountProgram } from '@thesis/contracts';
import { api, vnd } from './components';
import { requestId } from './request-id';
import { restaurantDateTime } from './restaurant-time';
import { notifySuccess } from './operation-notice';

export type DiscountOffer = DiscountProgram & {
  eligible: boolean;
  eligibleAmount: string;
  discountAmount: string;
  reason: string | null;
};
type PromotionQuote = { billing: BillingSummary; programs: DiscountOffer[]; locked: boolean };

export function PromotionSelection({
  sessionId,
  guest = false,
  billing,
  hasPayment = false,
  done,
}: {
  sessionId: string;
  guest?: boolean;
  billing?: BillingSummary;
  hasPayment?: boolean;
  done: () => Promise<void>;
}) {
  const [quote, setQuote] = useState<PromotionQuote>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const inFlight = useRef(false);
  const quoteGeneration = useRef(0);
  const codeId = useId();
  const path = guest ? '/guest/promotion' : `/core/sessions/${sessionId}/promotion`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++quoteGeneration.current;
      const result = await api<PromotionQuote>(path, undefined, 'GET', guest, signal);
      if (!signal?.aborted && generation === quoteGeneration.current) setQuote(result);
    },
    [path, guest],
  );
  const revision = JSON.stringify(billing);
  useEffect(() => {
    let active = true;
    let controller = new AbortController();
    const read = async () => {
      if (!active || inFlight.current || document.hidden) return;
      const signal = controller.signal;
      try {
        await refresh(signal);
        if (active && !signal.aborted) setLoadError('');
      } catch (e) {
        if (active && !signal.aborted)
          setLoadError(e instanceof Error ? e.message : 'Chưa tải được ưu đãi.');
      }
    };
    const stopReads = () => controller.abort();
    const resumeReads = () => {
      if (controller.signal.aborted) {
        controller = new AbortController();
        void read();
      }
    };
    // A document reload does not unmount React first. Abort before WebKit tears down fetches.
    window.addEventListener('pagehide', stopReads);
    window.addEventListener('pageshow', resumeReads);
    void read();
    const timer = setInterval(() => {
      void read();
    }, 3000);
    return () => {
      active = false;
      quoteGeneration.current++;
      stopReads();
      clearInterval(timer);
      window.removeEventListener('pagehide', stopReads);
      window.removeEventListener('pageshow', resumeReads);
    };
  }, [refresh, revision]);
  const selection = quote ? quote.billing.promotion : billing?.promotion;
  const locked = quote?.locked ?? selection?.locked ?? false;
  const paidLock = hasPayment || selection?.status === 'USED';
  const activeDiscount = BigInt(selection?.discountAmount ?? '0') > 0n;
  async function apply(body: { programId?: string; code?: string }, method = 'POST') {
    if (inFlight.current) return;
    inFlight.current = true;
    quoteGeneration.current++;
    setBusy(true);
    setError('');
    try {
      const next = await api<PromotionQuote>(
        path,
        { ...body, requestId: requestId() },
        method,
        guest,
      );
      setQuote(next);
      if (method === 'POST') setCode('');
      await done();
      notifySuccess(
        method === 'DELETE' ? 'Đã bỏ khuyến mãi của bàn.' : 'Đã cập nhật khuyến mãi của bàn.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa áp dụng được khuyến mãi.');
      await refresh().catch(() => undefined);
      await done().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="promotion-selection" aria-label="Khuyến mãi của bàn" aria-busy={busy}>
      <div className="promotion-heading">
        <div>
          <h3>Khuyến mãi của bàn</h3>
          <p>Một ưu đãi cho mỗi phiên bàn.</p>
        </div>
        {selection && (
          <span className="promotion-status">
            {locked
              ? paidLock
                ? 'Đã chốt'
                : 'Tạm khóa'
              : activeDiscount
                ? 'Đang áp dụng'
                : 'Đã chọn'}
          </span>
        )}
      </div>
      {selection && (
        <div className="promotion-selected">
          <div>
            <strong>{selection.name}</strong>
            <small>{selection.code ?? 'Ưu đãi tự động'}</small>
          </div>
          <strong>−{vnd(selection.discountAmount)}</strong>
          {!locked && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void apply({}, 'DELETE')}
            >
              Bỏ ưu đãi
            </button>
          )}
        </div>
      )}
      {selection?.reason && <p className="small-note">{selection.reason}</p>}
      {locked ? (
        <p className="small-note">
          {paidLock
            ? 'Ưu đãi đã chốt; món gọi thêm tính theo giá thực đơn, không áp dụng ưu đãi này.'
            : 'Đang có khoản thu chờ xác nhận. Hủy khoản thu hoặc chờ xử lý xong trước khi đổi ưu đãi.'}
        </p>
      ) : (
        <>
          <form
            className="promotion-code-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void apply({ code: code.trim() });
            }}
          >
            <label htmlFor={codeId}>Mã khuyến mãi</label>
            <div>
              <input
                id={codeId}
                value={code}
                maxLength={32}
                autoComplete="off"
                placeholder="Nhập mã ưu đãi"
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
              />
              <button className="primary-button" disabled={busy || !code.trim()}>
                {busy ? 'Đang xử lý…' : 'Áp dụng mã'}
              </button>
            </div>
          </form>
          <details className="promotion-available">
            <summary>
              Ưu đãi và điều kiện áp dụng{quote ? ` (${quote.programs.length})` : ''}
            </summary>
            {!quote ? (
              <p>Đang tải ưu đãi…</p>
            ) : !quote.programs.length ? (
              <p>Hiện chưa có chương trình khuyến mãi.</p>
            ) : (
              <ul>
                {quote.programs.map((program) => (
                  <li key={program.id}>
                    <div className="promotion-offer-heading">
                      <strong>{program.name}</strong>
                      <span>
                        {program.type === 'PERCENT'
                          ? `Giảm ${program.percent}%`
                          : `Giảm ${vnd(program.fixedAmount)}`}
                      </span>
                    </div>
                    {program.description && <p>{program.description}</p>}
                    <p>
                      Từ {vnd(program.minEligibleAmount)} tiền món đủ điều kiện
                      {program.maxDiscountAmount
                        ? ` · Giảm tối đa ${vnd(program.maxDiscountAmount)}`
                        : ''}
                      .
                    </p>
                    {program.excludeCombos && (
                      <small>Combo không được giảm tiếp và không tính vào ngưỡng ưu đãi.</small>
                    )}
                    {program.scope !== 'ALL' && (
                      <small>
                        {program.scope === 'PRODUCTS' ? 'Món áp dụng: ' : 'Nhóm món áp dụng: '}
                        {(program.scope === 'PRODUCTS'
                          ? program.productNames
                          : program.categoryNames
                        )?.join(', ') || 'Theo danh sách món của chương trình.'}
                      </small>
                    )}
                    <small>
                      {restaurantDateTime(program.startsAt)} – {restaurantDateTime(program.endsAt)}
                      {program.startTime && program.endTime
                        ? ` · ${program.startTime}–${program.endTime}`
                        : ''}
                    </small>
                    {program.weekdays.length > 0 && program.weekdays.length < 7 && (
                      <small>
                        Áp dụng:{' '}
                        {program.weekdays
                          .map((day) => (day === 0 ? 'Chủ nhật' : `Thứ ${day + 1}`))
                          .join(', ')}
                        .
                      </small>
                    )}
                    <p className={program.eligible ? 'promotion-eligible' : 'small-note'}>
                      {program.eligible
                        ? `Bàn được giảm ${vnd(program.discountAmount)} trên ${vnd(program.eligibleAmount)} tiền món đủ điều kiện.`
                        : (program.reason ?? 'Bàn chưa đủ điều kiện.')}
                    </p>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy || !program.eligible || selection?.id === program.id}
                      onClick={() =>
                        void apply(
                          program.mode === 'CODE'
                            ? { code: program.code ?? '' }
                            : { programId: program.id },
                        )
                      }
                    >
                      {selection?.id === program.id
                        ? 'Đang áp dụng'
                        : program.mode === 'CODE'
                          ? `Dùng mã ${program.code}`
                          : 'Chọn ưu đãi'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <p className="small-note">
            Ưu đãi áp dụng cho món đã gửi và được tính tiền. Giỏ chưa gửi bếp chưa tính vào điều
            kiện. Số tiền được kiểm tra lại trước khi thu tiền.
          </p>
        </>
      )}
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}{' '}
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              void refresh()
                .then(() => setLoadError(''))
                .catch((e) =>
                  setLoadError(e instanceof Error ? e.message : 'Chưa tải được ưu đãi.'),
                )
            }
          >
            Tải lại ưu đãi
          </button>
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
