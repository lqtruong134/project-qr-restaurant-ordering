'use client';
import { BillingTotals } from '../shared/billing-totals';
import { PromotionSelection } from '../shared/promotion-selection';
import { CashHandover, CashHistory } from './payment-handover';
import { HistoryList } from '../shared/history-filters';
import { restaurantDateTime } from '../shared/restaurant-time';
import { requestId } from '../shared/request-id';
import { paymentSummary } from '../shared/payment-summary';
import { PaymentBreakdown } from '../shared/payment-breakdown';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Action, api, EntryForm, options, vnd, type Product, type Row } from '../shared/components';
import { CollectionForm, PaymentCapture, LastPayment } from './payment-collection';
import { OnlinePaymentCard } from './online-payment-card';
import { hasPendingOnlinePayment, paymentMethodLabel } from '../shared/online-payment';
import { paymentRevision, onlineReceivedIncrease } from '../shared/payment-refresh';
import { useSmartRefresh } from '../shared/use-smart-refresh';
import { confirmDiscard } from '../shared/primitives';
import { SupportActions } from './support-panel';
import Receipt, { type Bill } from './receipt';
import { CloseChecklist } from './close-checklist';
import { RefundCreation } from './refund-creation';
import { SessionReference } from '../shared/session-reference';
export default function BillPanel({
  id,
  onClose,
  done,
  financialOnly = false,
  userId,
  requests = [],
  preferredRequestId,
  openRequest,
  openTab,
  focusRefund = false,
  onNotice,
}: {
  id: string;
  products: Product[];
  onClose: () => void;
  done: () => Promise<void>;
  financialOnly?: boolean;
  userId?: string;
  requests?: Row[];
  preferredRequestId?: string;
  openRequest?: (request: Row) => void;
  openTab?: (tab: string) => void;
  focusRefund?: boolean;
  onNotice?: (message: string) => void;
}) {
  const refundSection = useRef<HTMLElement>(null);
  const receiptId = useId();
  const refundRevision = useRef<string | undefined>(undefined);
  const [bill, setBill] = useState<Bill>(),
    [error, setError] = useState(''),
    [showReceipt, setShowReceipt] = useState(false),
    [receiptLayout, setReceiptLayout] = useState<'standard' | 'detailed'>('standard'),
    [collectionNotice, setCollectionNotice] = useState(''),
    [collectionError, setCollectionError] = useState(false),
    [refundKey, setRefundKey] = useState(() => requestId());
  const doneRef = useRef(done);
  doneRef.current = done;
  const previousBill = useRef<Bill | undefined>(undefined);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const next = await api<Bill>(
          '/core/sessions/' + id + '/bill',
          undefined,
          'GET',
          false,
          signal,
        );
        if (signal.aborted) return;
        const previous =
          previousBill.current?.session.id === next.session.id ? previousBill.current : undefined;
        previousBill.current = next;
        const revision = next.refunds
          .map((refund) => refund.id)
          .sort()
          .join(',');
        if (refundRevision.current !== undefined && refundRevision.current !== revision)
          setRefundKey(requestId());
        refundRevision.current = revision;
        setBill(next);
        setError('');
        if (previous) {
          const increase = onlineReceivedIncrease(previous.payments, next.payments);
          if (increase > 0n) {
            setCollectionError(false);
            setCollectionNotice(
              'Đã nhận ' + vnd(increase) + ' qua payOS. Hóa đơn và số tiền còn lại đã cập nhật.',
            );
          }
          if (paymentRevision(previous) !== paymentRevision(next)) await doneRef.current();
        }
      } catch (e) {
        if (signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Không tải được hóa đơn.');
        throw e;
      }
    },
    [id],
  );
  const refresh = useSmartRefresh(load, {
    intervalMs:
      !bill || hasPendingOnlinePayment(bill.intents)
        ? 3000
        : bill.session.session_status === 'ACTIVE'
          ? 10000
          : false,
  });
  async function act(path: string, body: unknown = {}) {
    try {
      await api(path, body);
    } catch (error) {
      await refresh();
      throw error;
    }
    await refresh();
    await done();
  }
  useEffect(() => {
    if (bill?.session.session_status === 'CLOSED') setShowReceipt(true);
  }, [bill?.session.session_status]);
  useEffect(() => {
    if (!collectionNotice || collectionError) return;
    onNotice?.(collectionNotice);
    const t = setTimeout(() => setCollectionNotice(''), 5000);
    return () => clearTimeout(t);
  }, [collectionNotice, collectionError, onNotice]);
  const hasBill = Boolean(bill);
  useEffect(() => {
    if (!focusRefund || !hasBill) return;
    const frame = requestAnimationFrame(() => {
      const section = refundSection.current;
      const heading = section?.closest('dialog')?.querySelector('.dialog-heading');
      if (section && heading)
        section.style.scrollMarginTop = `${heading.getBoundingClientRect().height + 16}px`;
      section?.scrollIntoView({ block: 'start' });
      section?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRefund, hasBill]);
  const currentRequests = bill?.paymentRequests ?? requests;
  const totals = paymentSummary(bill?.account);
  const openRefunds =
    bill?.refunds.filter((r) => ['OPEN', 'IN_PROGRESS'].includes(String(r.status))) ?? [];
  const approvedRefunds = openRefunds.filter(
    (r) => totals.refundDue > 0n && r.approved_at && !r.approval_required,
  );
  const pendingApproval = openRefunds.filter((r) => !r.approved_at || r.approval_required);
  const payableRefund = (r: Row) => {
    const remaining = BigInt(String(r.remaining_amount ?? r.amount));
    return remaining < totals.refundDue ? remaining : totals.refundDue;
  };
  const assignedRefund = openRefunds.reduce(
    (sum, r) => sum + BigInt(String(r.remaining_amount ?? r.amount)),
    0n,
  );
  const unassignedRefund =
    totals.refundDue > assignedRefund ? totals.refundDue - assignedRefund : 0n;
  return (
    <section className="core-bill">
      <div className="core-line">
        <h2>Chi tiết bàn</h2>
        <button
          className="secondary-button"
          onClick={async (e) => {
            if (await confirmDiscard(e.currentTarget.closest('.core-bill'))) onClose();
          }}
        >
          Đóng chi tiết
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {bill && (
        <>
          <p className="small-note">
            Bàn {String(bill.session.table_code)}
            <SessionReference id={bill.session.id} />
            {' · '}
            {bill.session.session_status === 'CLOSED'
              ? 'Phiên đã đóng — chỉ xem thông tin'
              : 'Phiên đang phục vụ'}
          </p>
          <BillingTotals billing={bill.billing} account={bill.account} />
          <div className="bill-balance-grid">
            <div>
              <span>Đã thanh toán (sau hoàn)</span>
              <strong>{vnd(totals.netPaid)}</strong>
            </div>
            <div>
              <span>Còn phải thanh toán</span>
              <strong>{vnd(totals.outstanding)}</strong>
            </div>
            {totals.refundDue > 0n && (
              <div>
                <span>Còn chờ hoàn tiền món</span>
                <strong>{vnd(totals.refundDue)}</strong>
              </div>
            )}
          </div>
          {totals.refundedTotal > 0n && <p className="small-note">Đã trừ tiền hoàn món.</p>}
          {collectionNotice && (collectionError || !onNotice) && (
            <p
              className={'collection-feedback' + (collectionError ? ' is-error' : '')}
              role={collectionError ? 'alert' : 'status'}
            >
              {collectionNotice}
            </p>
          )}
          {bill.payments.find((p) => p.status === 'SUCCEEDED') && (
            <LastPayment payment={bill.payments.find((p) => p.status === 'SUCCEEDED')!} />
          )}
          {!financialOnly && bill.session.session_status === 'ACTIVE' && (
            <CashHandover payments={bill.payments} act={act} />
          )}
          <details className="bill-transaction-history">
            <summary>Lịch sử thu và hoàn tiền của bàn</summary>
            <PaymentBreakdown account={bill.account} payments={bill.payments} />
            <HistoryList<Row>
              items={[
                ...bill.payments
                  .filter((p) => p.status === 'SUCCEEDED')
                  .map((p) => ({
                    ...p,
                    amount: p.amount ?? null,
                    method: p.method ?? null,
                    historyType: 'PAYMENT',
                    historyDate: p.confirmed_at ?? p.created_at ?? null,
                  })),
                ...(bill.refundTransactions ?? []).map((p) => ({
                  ...p,
                  amount: p.amount ?? null,
                  method: p.method ?? null,
                  historyType: 'REFUND',
                  historyDate: p.processed_at ?? p.created_at ?? null,
                })),
              ]}
              date={(p) => p.historyDate}
              search={(p) =>
                [
                  p.amount,
                  paymentMethodLabel(p.method),
                  p.historyType === 'PAYMENT' ? 'Thanh toán tiền món' : 'Hoàn tiền món',
                ].join(' ')
              }
              state={(p) => String(p.historyType)}
              statuses={[
                { value: 'PAYMENT', label: 'Thanh toán tiền món' },
                { value: 'REFUND', label: 'Hoàn tiền món' },
              ]}
              placeholder="Tìm số tiền hoặc hình thức giao dịch…"
            >
              {(rows) => (
                <ol className="support-history-list">
                  {rows.map((p) => (
                    <li key={p.historyType + ':' + p.id}>
                      <strong>
                        {p.historyType === 'PAYMENT' ? 'Thanh toán tiền món' : 'Hoàn tiền món'} -{' '}
                        {vnd(p.amount)}
                      </strong>
                      <small>
                        {paymentMethodLabel(p.method)} - {restaurantDateTime(p.historyDate)} -{' '}
                        {p.method === 'ONLINE'
                          ? 'Hệ thống xác nhận'
                          : String(p.confirmed_by_name ?? p.processed_by_name ?? 'Nhân viên')}
                      </small>
                      {p.historyType === 'PAYMENT' && <CashHistory payment={p} />}
                    </li>
                  ))}
                </ol>
              )}
            </HistoryList>
          </details>
          <div className="receipt-controls">
            <div className="guest-scope" role="group" aria-label="Cách trình bày phiếu">
              {(['standard', 'detailed'] as const).map((layout) => (
                <button
                  className="secondary-button"
                  key={layout}
                  type="button"
                  aria-pressed={showReceipt && receiptLayout === layout}
                  aria-expanded={showReceipt && receiptLayout === layout}
                  aria-controls={receiptId}
                  onClick={() => {
                    setShowReceipt(!(showReceipt && receiptLayout === layout));
                    setReceiptLayout(layout);
                  }}
                >
                  {layout === 'standard' ? 'Phiếu thường' : 'Phiếu chi tiết theo người gọi'}
                </button>
              ))}
            </div>
            <button className="primary-button" onClick={() => window.print()}>
              In thông tin thanh toán
            </button>
          </div>
          <Receipt id={receiptId} bill={bill} visible={showReceipt} layout={receiptLayout} />
          {!financialOnly &&
            bill.session.session_status === 'ACTIVE' &&
            bill.completion?.receiptRequired && (
              <section className="receipt-handover" aria-label="Giao phiếu cho khách">
                <h3>Giao phiếu cho khách</h3>
                {bill.completion.receiptDelivery ? (
                  <p role="status">
                    {bill.completion.receiptDelivery.details.delivery === 'PRINTED'
                      ? 'Đã in và giao phiếu cho khách'
                      : 'Khách không cần phiếu giấy'}{' '}
                    - {bill.completion.receiptDelivery.confirmed_by_name} -{' '}
                    {restaurantDateTime(bill.completion.receiptDelivery.created_at)}
                  </p>
                ) : (
                  <>
                    <p>
                      Chỉ xác nhận sau khi đã trả tiền thừa và giao phiếu. Bấm nút in chưa được coi
                      là đã giao phiếu.
                    </p>
                    <div className="core-actions">
                      {(['PRINTED', 'DECLINED'] as const).map((delivery) => (
                        <Action
                          key={delivery}
                          successMessage={
                            delivery === 'PRINTED'
                              ? 'Đã ghi nhận in và giao phiếu cho khách.'
                              : 'Đã ghi nhận khách không cần phiếu giấy.'
                          }
                          disabled={
                            BigInt(String(bill.account.outstanding_amount)) > 0n ||
                            BigInt(String(bill.account.refund_due_amount)) > 0n ||
                            bill.completion!.pendingChange.length > 0
                          }
                          confirm={
                            delivery === 'PRINTED'
                              ? 'Bạn đã in và giao phiếu đúng thông tin hiện tại cho khách?'
                              : 'Khách đã xác nhận không cần phiếu giấy?'
                          }
                          run={() =>
                            act('/core/sessions/' + id + '/receipt-provided', {
                              delivery,
                              layout: receiptLayout,
                              billKey: bill.completion!.receiptKey,
                            })
                          }
                        >
                          {delivery === 'PRINTED'
                            ? 'Đã in và giao phiếu'
                            : 'Khách không cần phiếu giấy'}
                        </Action>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          {bill.session.session_status === 'ACTIVE' && (
            <>
              {!financialOnly && (
                <>
                  {currentRequests.length > 0 && userId && (
                    <section
                      className="payment-request-ownership"
                      aria-label="Lời gọi thu tiền tại bàn"
                    >
                      <h3>Lời gọi thu tiền - Người phụ trách</h3>
                      <SupportActions
                        flat
                        rows={currentRequests}
                        userId={userId}
                        act={async (path, body) => {
                          try {
                            await act(path, body);
                          } finally {
                            await refresh();
                            await done();
                          }
                        }}
                        onOpen={openRequest}
                      />
                    </section>
                  )}
                  <PromotionSelection
                    sessionId={id}
                    billing={bill.billing}
                    hasPayment={BigInt(String(bill.account.paid_total ?? 0)) > 0n}
                    done={async () => {
                      await refresh();
                      await done();
                    }}
                  />
                  <CollectionForm
                    bill={bill}
                    userId={userId}
                    preferredRequestId={preferredRequestId}
                    done={async () => {
                      await refresh();
                      await done();
                    }}
                    report={(s, error = false) => {
                      setCollectionNotice(s);
                      setCollectionError(error);
                    }}
                  />
                  {bill.intents
                    .filter((p) => p.method === 'ONLINE')
                    .slice(0, 5)
                    .map((p) => {
                      const canManage =
                        !p.support_request_id ||
                        currentRequests.some(
                          (r) => r.id === p.support_request_id && r.acknowledged_by === userId,
                        );
                      const cancellable =
                        canManage &&
                        ['CREATED', 'PENDING'].includes(String(p.status)) &&
                        !['PAID', 'CANCEL_PENDING', 'REQUIRES_RECONCILIATION'].includes(
                          String(p.online?.status),
                        );
                      return (
                        <div className="online-payment-wrap" key={p.id}>
                          <OnlinePaymentCard
                            intent={p}
                            canManage={canManage}
                            done={async () => {
                              await refresh();
                              await done();
                            }}
                            report={(s, error = false) => {
                              setCollectionNotice(s);
                              setCollectionError(error);
                            }}
                          />
                          {cancellable && (
                            <Action
                              confirm={
                                'Hủy QR thu ' +
                                vnd(p.amount) +
                                '? Hệ thống sẽ kiểm tra giao dịch trước khi hủy.'
                              }
                              successMessage="Đã gửi yêu cầu hủy QR thanh toán."
                              run={() => act('/core/payments/' + p.id + '/cancel')}
                            >
                              Hủy QR thanh toán
                            </Action>
                          )}
                          {!canManage && (
                            <p className="collection-ownership-note">
                              Khoản thu thuộc lời gọi đồng nghiệp phụ trách. Cần bàn giao trước khi
                              kiểm tra hoặc hủy.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  {bill.intents.some(
                    (p) =>
                      p.method !== 'ONLINE' &&
                      ['CREATED', 'PENDING'].includes(String(p.status)) &&
                      new Date(String(p.expires_at)).getTime() > Date.now(),
                  ) && <h3>Khoản thu đang chờ xác nhận</h3>}
                  {bill.intents
                    .filter(
                      (p) =>
                        p.method !== 'ONLINE' &&
                        ['CREATED', 'PENDING'].includes(String(p.status)) &&
                        new Date(String(p.expires_at)).getTime() > Date.now(),
                    )
                    .map((p) => (
                      <div className="core-card" key={p.id}>
                        <strong>
                          {paymentMethodLabel(p.method)} - {vnd(p.amount)}
                        </strong>
                        {!p.support_request_id ||
                        requests.some(
                          (r) => r.id === p.support_request_id && r.acknowledged_by === userId,
                        ) ? (
                          <>
                            {!p.support_request_id && (bill.paymentRequests?.length ?? 0) > 0 ? (
                              <p className="collection-ownership-note">
                                Khoản thu cũ chưa gắn lời gọi. Hủy khoản thu này rồi tiếp tục từ lời
                                gọi đã nhận ở phía trên.
                              </p>
                            ) : (
                              <PaymentCapture
                                intent={p}
                                report={(s, error = false) => {
                                  setCollectionNotice(s);
                                  setCollectionError(error);
                                }}
                                done={async () => {
                                  await refresh();
                                  await done();
                                }}
                              />
                            )}
                            <Action
                              confirm={'Hủy yêu cầu thu ' + vnd(p.amount) + '?'}
                              successMessage="Đã hủy yêu cầu thanh toán."
                              run={() => act('/core/payments/' + p.id + '/cancel')}
                            >
                              Hủy yêu cầu thanh toán
                            </Action>
                          </>
                        ) : (
                          <p className="collection-ownership-note">
                            Khoản thu thuộc lời gọi do đồng nghiệp phụ trách. Cần bàn giao trước khi
                            xác nhận hoặc hủy.
                          </p>
                        )}
                      </div>
                    ))}
                </>
              )}
              <section
                className="staff-refund-panel"
                aria-label="Hoàn tiền cho khách"
                ref={refundSection}
                tabIndex={-1}
              >
                {((financialOnly && (unassignedRefund > 0n || pendingApproval.length > 0)) ||
                  approvedRefunds.length > 0) && (
                  <h3>{financialOnly ? 'Phiếu hoàn tiền' : 'Hoàn tiền cho khách'}</h3>
                )}
                {!financialOnly && totals.refundDue > 0n && approvedRefunds.length === 0 && (
                  <p className="small-note">
                    Khoản hoàn đang chờ quản trị duyệt. Bạn chưa cần trả tiền.
                  </p>
                )}
                {((financialOnly && unassignedRefund > 0n) || approvedRefunds.length > 0) &&
                  bill.refundContext && (
                    <div className="refund-decision-reason">
                      <strong>Lý do hoàn tiền</strong>
                      <p>{bill.refundContext.reason}</p>
                      <small>
                        {financialOnly
                          ? unassignedRefund > 0n || pendingApproval.length > 0
                            ? 'Kiểm tra giao dịch và số tiền trước khi duyệt phiếu hoàn.'
                            : 'Phiếu đã được chuyển cho nhân viên phục vụ. Nhân viên trả tiền rồi xác nhận đã hoàn.'
                          : 'Phiếu đã được quản trị duyệt. Trả tiền thực tế rồi xác nhận bên dưới.'}
                      </small>
                    </div>
                  )}
                {financialOnly &&
                  pendingApproval.map((r) => (
                    <div className="core-card" key={r.id}>
                      <strong>Phiếu chờ duyệt - {vnd(r.remaining_amount ?? r.amount)}</strong>
                      <p>{String(r.reason)}</p>
                      <Action
                        successMessage="Đã duyệt phiếu hoàn tiền và chuyển việc trả tiền cho phục vụ."
                        confirm={
                          'Duyệt phiếu hoàn ' +
                          vnd(r.remaining_amount ?? r.amount) +
                          '? Nhân viên sẽ nhận việc trả tiền cho khách.'
                        }
                        run={() => act('/core/refunds/' + r.id + '/approve')}
                      >
                        Duyệt phiếu hoàn tiền
                      </Action>
                    </div>
                  ))}
                {financialOnly && unassignedRefund > 0n && (
                  <RefundCreation
                    payments={bill.payments}
                    refunds={bill.refunds}
                    unassigned={unassignedRefund}
                    decisionReason={bill.refundContext?.reason}
                    submit={async (values) => {
                      await act('/core/sessions/' + id + '/refunds', {
                        ...values,
                        ...(bill.refundContext ? { useDecisionReason: true } : {}),
                        requestId: refundKey,
                      });
                    }}
                  />
                )}
                {financialOnly &&
                  approvedRefunds.map((r) => (
                    <article className="core-card admin-approved-refund" role="status" key={r.id}>
                      <h3>Đã chuyển cho nhân viên hoàn tiền</h3>
                      <p>Chờ nhân viên trả {vnd(payableRefund(r))} cho khách.</p>
                      <small>
                        Quản trị đã duyệt: {String(r.approved_by_name ?? 'Quản trị')} -{' '}
                        {restaurantDateTime(r.approved_at)}
                      </small>
                      <p className="small-note">
                        Kết quả sẽ tự cập nhật sau khi nhân viên xác nhận đã trả tiền.
                      </p>
                    </article>
                  ))}
                {!financialOnly &&
                  approvedRefunds.map((r) => (
                    <EntryForm
                      key={r.id + ':' + String(r.remaining_amount ?? r.amount)}
                      title={'Còn phải hoàn ' + vnd(payableRefund(r))}
                      successMessage="Đã ghi nhận hoàn tiền cho khách."
                      notice={
                        <>
                          <p>Lý do hồ sơ: {String(r.reason)}</p>
                          <small>
                            Quản trị đã duyệt: {String(r.approved_by_name ?? 'Quản trị')} -{' '}
                            {restaurantDateTime(r.approved_at)}
                          </small>
                        </>
                      }
                      confirm={(v) =>
                        'Ghi nhận đã hoàn ' +
                        vnd(v.amount) +
                        ' bằng ' +
                        (v.method === 'CASH' ? 'tiền mặt' : 'chuyển khoản') +
                        '? Chỉ xác nhận sau khi đã trả tiền thực tế.'
                      }
                      fields={[
                        {
                          key: 'amount',
                          label: 'Số tiền hoàn lần này',
                          type: 'number',
                          min: 1,
                          value: String(payableRefund(r)),
                          max: Number(payableRefund(r)),
                        },
                        {
                          key: 'method',
                          label: 'Cách hoàn',
                          options: [
                            { value: 'CASH', label: 'Tiền mặt' },
                            { value: 'BANK_TRANSFER', label: 'Chuyển khoản' },
                          ],
                        },
                        {
                          key: 'reference',
                          label: 'Mã giao dịch chuyển khoản',
                          showWhen: { key: 'method', value: 'BANK_TRANSFER' },
                        },
                      ]}
                      submit="Đã hoàn tiền cho khách"
                      onSubmit={(v) =>
                        act('/core/refunds/' + r.id + '/complete', {
                          ...v,
                          requestId:
                            'refund:' + r.id + ':' + String(r.remaining_amount ?? r.amount),
                        })
                      }
                    />
                  ))}
              </section>
              {!financialOnly && (
                <>
                  <CloseChecklist readiness={bill.closure} open={openTab} />
                  <div className="core-line">
                    <Action
                      disabled={!bill.closure?.canClose}
                      confirm="Khách đã rời bàn, đã hoàn tất phục vụ và thanh toán? Bàn sẽ chuyển sang chờ dọn."
                      run={async () => {
                        await act('/core/sessions/' + id + '/close');
                        setShowReceipt(true);
                        setCollectionNotice(
                          'Đã kết thúc bàn. Việc dọn bàn đã được đưa vào Việc chung cho đội phục vụ.',
                        );
                      }}
                    >
                      Đóng phiên sau khi hoàn tất
                    </Action>
                  </div>
                  <details>
                    <summary>Khách rời đi khi còn thiếu tiền</summary>
                    <EntryForm
                      title="Báo quản trị xử lý"
                      confirm="Lập hồ sơ thiếu tiền và chuyển quản trị? Số tiền chưa thu vẫn được giữ trong lịch sử."
                      fields={[
                        { key: 'reason', label: 'Mã lý do', value: 'LEFT_WITHOUT_PAYING' },
                        { key: 'notes', label: 'Diễn biến sự việc' },
                        {
                          key: 'evidence',
                          label: 'Tham chiếu bằng chứng (nếu có)',
                          optional: true,
                        },
                      ]}
                      submit="Lập hồ sơ thiếu tiền"
                      onSubmit={(v) => act('/core/sessions/' + id + '/outstanding', v)}
                    />
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
export function StaffOrder({
  id,
  products,
  done,
}: {
  id: string;
  products: Product[];
  done: () => Promise<void>;
}) {
  const [key, setKey] = useState(() => requestId());
  return (
    <details>
      <summary>Gọi thêm món giúp khách</summary>
      <EntryForm
        title="Thêm món"
        fields={[
          {
            key: 'productId',
            label: 'Món',
            options: options(
              products.filter((p) => p.is_active && p.availability_status === 'AVAILABLE'),
            ),
          },
          { key: 'quantity', label: 'Số lượng', type: 'number', value: 1, min: 1, max: 99 },
          { key: 'note', label: 'Ghi chú', optional: true },
        ]}
        submit="Gửi bếp"
        onSubmit={async (v) => {
          await api('/core/sessions/' + id + '/orders', {
            requestId: key,
            lines: [{ ...v, quantity: Number(v.quantity) }],
          });
          setKey(requestId());
          await done();
        }}
      />
    </details>
  );
}
