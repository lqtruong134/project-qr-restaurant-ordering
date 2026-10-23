'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type {
  BankEvidenceContext,
  BankEvidencePreview,
  BankEvidenceProof,
  BankEvidenceConfirmation,
} from '@thesis/contracts';
import { api, vnd } from '../shared/components';
import { Modal, Icon } from '../shared/primitives';
import { notifyInfo, notifySuccess } from '../shared/operation-notice';
import { restaurantDateTime } from '../shared/restaurant-time';
import { requestApi } from '../../lib/api-client';
import styles from './bank-evidence-dialog.module.css';

function imageBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh đã chọn.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('Không đọc được ảnh đã chọn.'));
      else resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
export default function BankEvidenceDialog({
  id,
  close,
  done,
}: {
  id: string;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [context, setContext] = useState<BankEvidenceContext>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [reference, setReference] = useState(''),
    [amount, setAmount] = useState(''),
    [bankTime, setBankTime] = useState(''),
    [reason, setReason] = useState('');
  const [proof, setProof] = useState<BankEvidenceProof>(),
    [attested, setAttested] = useState(false),
    [finalAttested, setFinalAttested] = useState(false);
  const [preview, setPreview] = useState<BankEvidencePreview>(),
    [dirty, setDirty] = useState(false),
    [proofImage, setProofImage] = useState('');
  const [clock, setClock] = useState(0),
    [loading, setLoading] = useState(true);
  const busyRef = useRef(false),
    alive = useRef(true),
    imageRef = useRef('');
  const descriptionId = useId(),
    previewRef = useRef<HTMLElement>(null);
  const base = '/core/admin/payment-reconciliation/' + id + '/bank-evidence';
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api<BankEvidenceContext>(base, undefined, 'GET', false, controller.signal)
      .then((data) => {
        if (!alive.current) return;
        setContext(data);
        const remaining = BigInt(data.facts.remainingQuoteAmount),
          outstanding = BigInt(data.facts.outstandingAmount);
        setAmount(
          data.facts.providerReferences.length === 1 &&
            BigInt(data.facts.bankReportedAmount) > 0n &&
            BigInt(data.facts.recordedAmount) === 0n
            ? data.facts.bankReportedAmount
            : (remaining < outstanding ? remaining : outstanding).toString(),
        );
        if (data.facts.providerReferences.length === 1)
          setReference(data.facts.providerReferences[0]!);
      })
      .catch((e) => {
        if (!controller.signal.aborted && alive.current)
          setError(e instanceof Error ? e.message : 'Không tải được thông tin ngân hàng.');
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      controller.abort();
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
    };
  }, [base]);
  useEffect(() => {
    if (!preview?.token) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview?.token]);
  function edit() {
    setPreview(undefined);
    setFinalAttested(false);
    setDirty(true);
    setError('');
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Không thực hiện được yêu cầu.');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function upload(file: File | undefined) {
    if (!file) return;
    edit();
    void run(async () => {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 2 * 1024 * 1024
      )
        throw Error('Chọn ảnh PNG, JPEG hoặc WebP tối đa 2 MB.');
      const result = await api<BankEvidenceProof>(base + '/proof', {
        data: await imageBase64(file),
      });
      if (alive.current) {
        setProof(result);
        setContext((current) =>
          current ? { ...current, proofs: [result, ...current.proofs] } : current,
        );
      }
    });
  }
  function viewProof() {
    if (!proof) return;
    void run(async () => {
      const response = await requestApi(base + '/proof/' + proof.id, { cache: 'no-store' });
      if (!response.ok) throw Error('Không đọc được chứng từ. Vui lòng kiểm tra quyền và thử lại.');
      const blob = await response.blob();
      if (!alive.current) return;
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
      imageRef.current = URL.createObjectURL(blob);
      setProofImage(imageRef.current);
    });
  }
  function previewBank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) {
      setError('Tải lên hoặc chọn chứng từ ngân hàng trước khi xem trước.');
      return;
    }
    void run(async () => {
      const withSeconds = bankTime.length === 16 ? bankTime + ':00' : bankTime;
      const at = new Date(withSeconds + '+07:00');
      if (!Number.isFinite(at.getTime()))
        throw Error('Kiểm tra thời điểm giao dịch theo giờ Việt Nam.');
      setPreview(undefined);
      setFinalAttested(false);
      const result = await api<BankEvidencePreview>(base + '/preview', {
        proofId: proof.id,
        reference,
        amount,
        bankTransactionAt: at.toISOString(),
        reason,
        attested,
      });
      if (alive.current) {
        setPreview(result);
        setContext((current) => (current ? { ...current, facts: result.facts } : current));
        setClock(Date.now());
        setTimeout(() => previewRef.current?.focus({ preventScroll: false }), 0);
      }
    });
  }
  function confirmBank() {
    if (!preview?.token || !finalAttested) return;
    const token = preview.token;
    void run(async () => {
      try {
        await api<BankEvidenceConfirmation>(base + '/confirm', { token, attested: finalAttested });
      } catch (error) {
        setPreview(undefined);
        setFinalAttested(false);
        throw error;
      }
      setDirty(false);
      notifySuccess('Đã ghi nhận tiền thực nhận theo chứng từ ngân hàng do quản trị xác minh.');
      await done().catch(() =>
        notifyInfo(
          'Tiền đã được ghi nhận. Dữ liệu danh sách chưa cập nhật; vui lòng làm mới đối soát.',
        ),
      );
      close();
    });
  }
  const expired = !!preview?.expiresAt && clock >= Date.parse(preview.expiresAt);
  const knownReference = context?.facts.providerReferences.length === 1;
  return (
    <Modal
      title="Xác minh tiền thực nhận qua ngân hàng"
      close={close}
      wide
      blocking={busy}
      descriptionId={descriptionId}
      className={styles.dialog}
    >
      <div className={styles.body}>
        <p id={descriptionId} className={styles.intro}>
          Chỉ dùng khi đã kiểm tra giao dịch tiền vào trên sao kê hoặc ứng dụng MB Bank của nhà
          hàng. Ảnh khách gửi và trạng thái payOS chưa thay thế việc đối chiếu này.
        </p>
        <ol className={styles.steps} aria-label="Các bước xác minh ngân hàng">
          <li>1. Đối chiếu chứng từ</li>
          <li aria-current={preview?.canConfirm ? 'step' : undefined}>2. Xem trước và xác nhận</li>
        </ol>
        {loading ? (
          <p role="status">Đang tải dữ liệu khoản thu…</p>
        ) : (
          context && (
            <>
              <section className={styles.facts} aria-label="Thông tin khoản thu chỉ đọc">
                <h3>
                  Bàn {context.facts.tableCode} · Phiên #{context.facts.sessionCode}
                </h3>
                <dl>
                  <div>
                    <dt>Số tiền yêu cầu</dt>
                    <dd>{vnd(context.facts.quoteAmount)}</dd>
                  </div>
                  <div>
                    <dt>payOS báo nhận</dt>
                    <dd>{vnd(context.facts.bankReportedAmount)}</dd>
                  </div>
                  <div>
                    <dt>Đã ghi sổ</dt>
                    <dd>{vnd(context.facts.recordedAmount)}</dd>
                  </div>
                  <div>
                    <dt>Đã tính vào tiền món</dt>
                    <dd>{vnd(context.facts.appliedAmount)}</dd>
                  </div>
                  <div>
                    <dt>Tài khoản nhà hàng</dt>
                    <dd>
                      {context.facts.receiverBank ?? 'Chưa xác minh'}{' '}
                      {context.facts.receiverAccountMasked}
                    </dd>
                  </div>
                  <div>
                    <dt>Mã khoản thu payOS</dt>
                    <dd>
                      <code>{context.facts.orderCode}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Thời điểm lập khoản thu</dt>
                    <dd>{restaurantDateTime(context.facts.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Hạn khoản thu</dt>
                    <dd>{restaurantDateTime(context.facts.expiresAt)}</dd>
                  </div>
                </dl>
              </section>
              {!context.facts.canVerify && (
                <div className={styles.blockers} role="status">
                  <strong>Chưa thể xác minh và ghi sổ</strong>
                  <ul>
                    {context.facts.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              <form
                onSubmit={previewBank}
                data-dirty={dirty ? 'true' : undefined}
                className={styles.form}
              >
                <fieldset disabled={busy || !context.facts.canVerify}>
                  <legend>Chứng cứ ngân hàng độc lập</legend>
                  <div className={styles.inputs}>
                    <label>
                      Mã giao dịch ngân hàng
                      <input
                        value={reference}
                        onChange={(e) => {
                          edit();
                          setReference(e.target.value);
                        }}
                        required
                        maxLength={160}
                        readOnly={knownReference}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Số tiền thực nhận (đ)
                      <input
                        value={amount}
                        onChange={(e) => {
                          edit();
                          setAmount(e.target.value);
                        }}
                        required
                        readOnly={knownReference && BigInt(context.facts.bankReportedAmount) > 0n}
                        inputMode="numeric"
                        pattern="[0-9]+"
                        autoComplete="off"
                      />
                    </label>
                    <label className={styles.full}>
                      Thời điểm ngân hàng (giờ Việt Nam)
                      <input
                        type="datetime-local"
                        step="1"
                        value={bankTime}
                        onChange={(e) => {
                          edit();
                          setBankTime(e.target.value);
                        }}
                        required
                      />
                    </label>
                    <label className={styles.full}>
                      Lý do đối chiếu
                      <textarea
                        aria-label="Lý do đối chiếu"
                        value={reason}
                        onChange={(e) => {
                          edit();
                          setReason(e.target.value);
                        }}
                        required
                        maxLength={500}
                        rows={3}
                      />
                    </label>
                    <label className={styles.full}>
                      Ảnh chứng từ ngân hàng
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => upload(e.target.files?.[0])}
                      />
                      <small>Ảnh PNG, JPEG hoặc WebP tối đa 2 MB. Chỉ quản trị được xem.</small>
                    </label>
                    {!!context.proofs.length && (
                      <label className={styles.full}>
                        Chứng từ đã tải lên
                        <select
                          value={proof?.id ?? ''}
                          onChange={(e) => {
                            edit();
                            setProof(context.proofs.find((p) => p.id === e.target.value));
                            setProofImage('');
                          }}
                        >
                          <option value="">Chọn chứng từ</option>
                          {context.proofs.map((p, index) => (
                            <option key={p.id} value={p.id}>
                              Chứng từ {index + 1} · {p.sha256.slice(0, 6)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {proof && (
                    <div className={styles.proof}>
                      <span>
                        <Icon name="shield" size={16} /> Chứng từ đã lưu ·{' '}
                        {Math.ceil(proof.byteSize / 1024)} KB
                      </span>
                      <small>
                        Lưu lúc {restaurantDateTime(proof.uploadedAt)} · SHA-256{' '}
                        {proof.sha256.slice(0, 12)}
                      </small>
                      <button type="button" className="secondary-button" onClick={viewProof}>
                        Xem chứng từ đã lưu
                      </button>
                    </div>
                  )}
                  {proofImage && (
                    <img
                      className={styles.image}
                      src={proofImage}
                      alt="Chứng từ ngân hàng dành riêng cho quản trị"
                    />
                  )}
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => {
                        edit();
                        setAttested(e.target.checked);
                      }}
                      required
                    />
                    <span>
                      Tôi đã đối chiếu trực tiếp giao dịch tiền vào, đúng tài khoản MB Bank nhà
                      hàng, đúng mã giao dịch và số tiền; không chỉ dựa vào ảnh khách gửi.
                    </span>
                  </label>
                  <button type="submit" disabled={!proof || !attested || busy}>
                    {busy ? 'Đang đối chiếu…' : 'Xem trước việc ghi nhận'}
                  </button>
                </fieldset>
              </form>
              {preview && (
                <section
                  className={styles.preview}
                  ref={previewRef}
                  tabIndex={-1}
                  aria-label="Xem trước tác động tiền"
                >
                  <h3>Xem trước tác động tiền</h3>
                  <p>
                    Nguồn xác minh: <strong>Quản trị đối chiếu ngân hàng</strong>. Không thay đổi dữ
                    liệu payOS đã báo.
                  </p>
                  {!preview.canConfirm ? (
                    <div className={styles.blockers} role="alert">
                      <ul>
                        {preview.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <>
                      <dl>
                        <div>
                          <dt>Ghi nhận thực thu</dt>
                          <dd>{vnd(preview.impact.recordedDelta)}</dd>
                        </div>
                        <div>
                          <dt>Tính vào tiền món</dt>
                          <dd>{vnd(preview.impact.allocatedDelta)}</dd>
                        </div>
                        <div>
                          <dt>Chưa phân bổ</dt>
                          <dd>{vnd(preview.impact.unallocatedDelta)}</dd>
                        </div>
                        <div>
                          <dt>Hóa đơn còn phải thu</dt>
                          <dd>{vnd(preview.impact.outstandingAfter)}</dd>
                        </div>
                      </dl>
                      <p role="status">
                        {expired
                          ? 'Bản xem trước đã hết hạn. Vui lòng xem trước lại.'
                          : 'Bản xem trước có hiệu lực 2 phút. Thay đổi chứng cứ hoặc số dư sẽ yêu cầu kiểm tra lại.'}
                      </p>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={finalAttested}
                          onChange={(e) => setFinalAttested(e.target.checked)}
                          disabled={busy || expired}
                        />
                        <span>
                          Tôi xác nhận chứng cứ và tác động nêu trên, chịu trách nhiệm xác minh tiền
                          ngân hàng thực nhận trước khi ghi sổ.
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={confirmBank}
                        disabled={busy || expired || !finalAttested}
                      >
                        {busy ? 'Đang ghi nhận…' : 'Xác nhận ghi nhận tiền ngân hàng'}
                      </button>
                    </>
                  )}
                </section>
              )}
              {!!context.history.length && (
                <details>
                  <summary>Lịch sử quản trị xác minh ngân hàng</summary>
                  <ul>
                    {context.history.map((h) => (
                      <li key={h.receiptId}>
                        {vnd(h.amount)} · {h.reference} · {restaurantDateTime(h.confirmedAt)}
                        {h.proofId && (
                          <a
                            href={'/api' + base + '/proof/' + encodeURIComponent(h.proofId)}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {' '}
                            Xem chứng từ ngân hàng
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !context && (
          <button type="button" className="secondary-button" onClick={close}>
            Đóng và thử mở lại
          </button>
        )}
      </div>
    </Modal>
  );
}
