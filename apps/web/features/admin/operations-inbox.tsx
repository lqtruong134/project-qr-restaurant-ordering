'use client';
import { SessionReference } from '../shared/session-reference';
import { HistoryList } from '../shared/history-filters';
import { useEffect, useState } from 'react';
import type { PaymentReconciliationCase } from '@thesis/contracts';
import styles from './payment-exceptions.module.css';
import { reasonLabel } from '@thesis/contracts';
import { Action, ApiError, api, EntryForm, label, vnd, type Row } from '../shared/components';
import { Empty, Icon, Modal, Search, matches } from '../shared/primitives';
import { restaurantDateTime } from '../shared/restaurant-time';
import { paymentSummary } from '../shared/payment-summary';
import { PaymentBreakdown } from '../shared/payment-breakdown';
import { BillingTotals } from '../shared/billing-totals';
import { payableItemAmount } from '../shared/billing-summary';
import BillPanel from '../workspace/bill-panel';
import type { Bill } from '../workspace/receipt';
import { AdminHelp } from './admin-help';
import { ItemDecisions } from './item-decisions';
import type { AdminOpen } from './admin-overview';

export type WorkKind = 'all' | 'incident' | 'refund' | 'shortfall';
export type UrgentWork = {
  issues: Row[];
  refunds: Row[];
  outstanding: Row[];
  paymentCases?: PaymentReconciliationCase[];
  paymentError?: string;
  error: string;
  updatedAt?: string;
  refresh: () => Promise<void>;
};
const kinds = {
  incident: 'Món & kho cần xử lý',
  refund: 'Cần hoàn tiền',
  shortfall: 'Hồ sơ thiếu tiền',
} as const;
export const openShortfalls = (rows: Row[]) =>
  rows.filter((row) =>
    ['PENDING_ADMIN_REVIEW', 'IN_RECOVERY', 'PARTIALLY_RECOVERED'].includes(String(row.status)),
  );
export class AdminStateChanged extends Error {}
export async function adminDecision(path: string, body: unknown, refresh: () => Promise<void>) {
  try {
    return await api<{ alreadyProcessed?: boolean }>(path, body);
  } catch (error) {
    await refresh();
    if (
      error instanceof ApiError &&
      error.status === 409 &&
      /Báo cáo đã|đã.*(?:xử lý|miễn|quyết định|hoàn tất|thay đổi)|người khác|Chỉ xử lý món|Phiên.*(?:kết thúc|đóng)/i.test(
        error.message,
      )
    )
      throw new AdminStateChanged(
        'Công việc đã thay đổi hoặc được xử lý bởi người khác. Dữ liệu đã được làm mới; hãy kiểm tra lại trước khi quyết định.',
      );
    throw error;
  }
}
export function WorkSummary({
  work,
  choose,
}: {
  work: UrgentWork;
  choose: (kind: WorkKind | 'payment') => void;
}) {
  const counts = {
    incident: work.issues.length,
    refund: work.refunds.length,
    shortfall: openShortfalls(work.outstanding).length,
    payment: work.paymentCases?.length ?? 0,
  };
  const summaryKinds = { ...kinds, payment: 'Ngoại lệ thanh toán' };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <section
      className={'core-card inbox-summary' + (total ? ' has-work' : '')}
      aria-label="Tóm tắt việc cần xử lý"
    >
      <strong>
        {!work.updatedAt
          ? 'Đang kiểm tra việc cần xử lý…'
          : total
            ? `Việc cần xử lý - ${total}`
            : 'Không có công việc đang chờ xử lý.'}
      </strong>
      {total > 0 && (
        <div>
          {(Object.keys(summaryKinds) as (keyof typeof summaryKinds)[]).map(
            (kind) =>
              counts[kind] > 0 && (
                <button key={kind} className="secondary-button" onClick={() => choose(kind)}>
                  <span className={'inbox-badge ' + kind}>
                    {counts[kind]} {summaryKinds[kind].toLowerCase()}
                  </span>
                  <Icon name="arrow" size={16} />
                </button>
              ),
          )}
        </div>
      )}
      {work.paymentError && (
        <p role="status" className="small-note">
          {work.paymentError}
        </p>
      )}
      {work.error && (
        <p role="alert" className="form-error">
          Chưa cập nhật được công việc.{' '}
          {work.updatedAt ? 'Đang hiển thị lần cập nhật gần nhất.' : 'Hãy làm mới để thử lại.'}
        </p>
      )}
    </section>
  );
}
export function waitText(value: unknown, now = Date.now()) {
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) return 'Chưa có giờ ghi nhận';
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  return minutes < 1
    ? 'Vừa ghi nhận'
    : minutes < 60
      ? `Đã chờ ${minutes} phút`
      : minutes < 1440
        ? `Đã chờ ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`
        : `Đã chờ ${Math.floor(minutes / 1440)} ngày`;
}
export function SessionFacts({
  detail,
  note = 'Số tiền của cả bàn sau các lần thu, hoàn và điều chỉnh hóa đơn.',
}: {
  detail: { bill: Bill; exceptions: Row[] };
  note?: string;
}) {
  const totals = paymentSummary(detail.bill.account);
  const facts = [
    ['Đã tính vào tiền món', totals.appliedTotal],
    ...(totals.unappliedHeld > 0n || totals.refundedTotal > 0n
      ? [['Đã nhận (trước hoàn)', totals.collectedTotal]]
      : []),
    ['Còn phải thanh toán', totals.outstanding],
    ...(totals.refundDue > 0n ? [['Cần hoàn lại khách', totals.refundDue]] : []),
  ];
  return (
    <>
      <section className="inbox-bill-summary" aria-label="Thanh toán cả bàn">
        <h4>Thanh toán cả bàn</h4>
        <p className="small-note">{note}</p>
        <BillingTotals billing={detail.bill.billing} account={detail.bill.account} />
        <dl className="inbox-facts">
          {facts.map(([key, value]) => (
            <div key={String(key)}>
              <dt>{String(key)}</dt>
              <dd>{vnd(value)}</dd>
            </div>
          ))}
        </dl>
        {totals.refundedTotal > 0n && (
          <p className="small-note">Đã ghi nhận các khoản thực tế hoàn lại khách.</p>
        )}
        <details className="inbox-history">
          <summary>Chi tiết thu và hoàn tiền</summary>
          <PaymentBreakdown account={detail.bill.account} payments={detail.bill.payments} />
        </details>
      </section>
      <details className="inbox-history">
        <summary>Lịch sử thao tác trong phiên</summary>
        <HistoryList
          items={detail.exceptions}
          date={(r) => r.created_at}
          search={(r) => [r.reason, r.display_name].join(' ')}
        >
          {(rows) => (
            <ol>
              {rows.map((row, index) => (
                <li key={index}>
                  <strong>{String(row.reason || 'Đã ghi nhận thao tác')}</strong>
                  <small>
                    {String(row.display_name ?? 'Nhà hàng')} - {restaurantDateTime(row.created_at)}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </HistoryList>
      </details>
    </>
  );
}
function WorkDetail({
  row,
  kind,
  close,
  done,
}: {
  row: Row;
  kind: Exclude<WorkKind, 'all'>;
  close: () => void;
  done: (message?: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<{ bill: Bill; exceptions: Row[] }>();
  const [error, setError] = useState('');
  const sid = String(row.session_id);
  useEffect(() => {
    let active = true;
    void api<{ bill: Bill; exceptions: Row[] }>('/core/reports/sessions/' + sid)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active)
          setError('Không tải được thông tin tiền của phiên. Hãy đóng và mở lại để thử lại.');
      });
    return () => {
      active = false;
    };
  }, [sid]);
  const itemAmount =
    row.has_charge === true
      ? payableItemAmount({ ...row, order_item_id: row.item_id ?? row.id }, detail?.bill.billing)
      : 0n;
  return (
    <Modal title={`${kinds[kind]} - Bàn ${String(row.table_code)}`} wide close={close}>
      <div className="inbox-detail">
        <p className="small-note">
          Bàn {String(row.table_code)}
          <SessionReference id={row.session_id} code={row.session_code} />
        </p>
        <div className="section-heading compact">
          <span className={'inbox-badge ' + kind}>
            {kind === 'incident' ? 'Bếp đã dừng món' : label(row.status)}
          </span>
          <AdminHelp topic={kind === 'incident' ? 'incident' : 'shortfall'} />
        </div>
        {kind === 'incident' ? (
          <>
            <h3>
              {String(row.product_name_snapshot)} × {String(row.quantity)}
            </h3>
            <p>
              <strong>{reasonLabel(row.reported_reason_code ?? row.cancel_reason_code)}</strong>
            </p>
            {row.reported_note && <blockquote>{String(row.reported_note)}</blockquote>}
            <p className="small-note">
              Bếp báo: {String(row.reported_by_name ?? 'Chưa có tên')} -{' '}
              {restaurantDateTime(row.reported_at)} - {waitText(row.reported_at)}
            </p>
            <p className="small-note">
              {row.guest_notified === true
                ? 'Phục vụ đã trao đổi với khách.'
                : 'Nhân viên phục vụ cần đến bàn giải thích với khách.'}
            </p>
          </>
        ) : (
          <>
            <h3>Còn thiếu theo hồ sơ: {vnd(row.outstanding_amount)}</h3>
            <p>{String(row.notes ?? 'Chưa có ghi chú')}</p>
            <p className="small-note">
              {label(row.status)} - {restaurantDateTime(row.created_at)}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!detail && !error && <p role="status">Đang kiểm tra tiền và lịch sử phiên…</p>}
        {detail && (
          <>
            <SessionFacts detail={detail} />
            {kind === 'incident' ? (
              <>
                <p className="context-notice">
                  Nếu xác nhận lỗi nhà hàng: bỏ tính tiền {vnd(itemAmount)}. Hệ thống sẽ đối chiếu
                  tiền đã phân bổ theo từng giao dịch sau quyết định. Khoản cần hoàn và tiền món còn
                  thiếu được xử lý riêng; khách chỉ nhận lại tiền khi có xác nhận hoàn thực tế.
                </p>
                <ItemDecisions
                  item={row}
                  act={async (path, body) => {
                    try {
                      const result = await adminDecision(path, body, () => done());
                      await done(
                        result.alreadyProcessed
                          ? 'Sự cố này đã được xử lý trước đó. Dữ liệu đã được làm mới.'
                          : undefined,
                      );
                      close();
                    } catch (error) {
                      if (error instanceof AdminStateChanged) {
                        await done(error.message);
                        close();
                      } else throw error;
                    }
                  }}
                />
              </>
            ) : (
              <>
                {BigInt(String(detail.bill.account.outstanding_amount)) === 0n &&
                BigInt(String(detail.bill.account.refund_due_amount)) === 0n ? (
                  <Action
                    confirmTitle="Xác nhận đã thu hồi đủ?"
                    confirmLabel="Xác nhận đã thu hồi"
                    confirm="Đã đối chiếu đủ tiền và không còn khoản cần hoàn? Hồ sơ sẽ chuyển sang Đã thu hồi; lịch sử giao dịch được giữ."
                    run={async () => {
                      await api('/core/outstanding/' + row.id + '/recovered', {});
                      await done();
                      close();
                    }}
                  >
                    Xác nhận đã thu hồi
                  </Action>
                ) : ['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(String(row.status)) ? (
                  <EntryForm
                    title="Chấp nhận phần tiền không thu hồi"
                    successMessage={false}
                    fields={[{ key: 'reason', label: 'Lý do chấp nhận tổn thất' }]}
                    submit="Chấp nhận tổn thất"
                    confirmTitle="Chấp nhận tổn thất và kết thúc phiên?"
                    confirmLabel="Xác nhận chấp nhận tổn thất"
                    confirm={`Nhà hàng không tiếp tục thu phần còn thiếu ${vnd(detail.bill.account.outstanding_amount)}. Nếu mọi việc khác đã hoàn tất, phiên sẽ đóng và bàn chuyển sang Chờ dọn. Tiền đã thu và lịch sử vẫn được giữ.`}
                    onSubmit={async (body) => {
                      await api('/core/outstanding/' + row.id + '/write-off', body);
                      await done();
                      close();
                    }}
                  />
                ) : (
                  <p className="small-note">
                    Hồ sơ đang thu hồi một phần. Phục vụ cần đối chiếu phần tiền còn thiếu; chỉ xác
                    nhận đã thu hồi khi số dư đã hết.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
export default function OperationsInbox({
  work,
  open,
  initial = 'all',
  onNavigate,
  onInspectStock,
}: {
  work: UrgentWork;
  open: AdminOpen;
  initial?: string;
  onNavigate?: (section: string) => void;
  onInspectStock: (row: Row) => void;
}) {
  const [kind, setKind] = useState<WorkKind>(
    (['incident', 'refund', 'shortfall'].includes(initial) ? initial : 'all') as WorkKind,
  );
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<{ row: Row; kind: Exclude<WorkKind, 'all'> }>();
  const [notice, setNotice] = useState('');
  const rows = [
    ...work.issues.map((row) => ({ row, kind: 'incident' as const, time: row.reported_at })),
    ...work.refunds.map((row) => ({ row, kind: 'refund' as const, time: row.created_at })),
    ...openShortfalls(work.outstanding).map((row) => ({
      row,
      kind: 'shortfall' as const,
      time: row.created_at,
    })),
  ];
  const visible = rows
    .filter(
      (item) =>
        (kind === 'all' || item.kind === kind) &&
        matches(
          `${item.row.table_code} ${item.row.product_name_snapshot ?? ''} ${item.row.session_id} ${item.row.issue_reason ?? ''} ${item.row.notes ?? ''} ${reasonLabel(item.row.reported_reason_code ?? item.row.cancel_reason_code)}`,
          search,
        ),
    )
    .sort(
      (a, b) =>
        (a.row.severity === 'CRITICAL' ? 0 : 1) - (b.row.severity === 'CRITICAL' ? 0 : 1) ||
        (Date.parse(String(a.time)) || 0) - (Date.parse(String(b.time)) || 0),
    );
  async function done(message?: string) {
    await work.refresh();
    setNotice(message ?? 'Đã cập nhật công việc.');
  }
  return (
    <section className="operations-inbox">
      <WorkSummary
        work={work}
        choose={(kind) => {
          if (kind === 'payment') {
            open('exceptions', 'payment');
            return;
          }
          setKind(kind);
          onNavigate?.(kind);
        }}
      />
      <div className="inbox-toolbar">
        <Search value={search} onChange={setSearch} placeholder="Tìm bàn, món hoặc mã phiên…" />
        <Action run={work.refresh}>
          <Icon name="refresh" size={17} /> Làm mới
        </Action>
        <button className="secondary-button" onClick={() => open('reports', 'exceptions')}>
          Tra cứu & xử lý món
        </button>
        <button className="secondary-button" onClick={() => open('reports', 'reconciliation')}>
          Lịch sử & đối soát
        </button>
      </div>

      <p className="small-note">
        Cảnh báo nghiêm trọng được đưa lên trước, sau đó đến việc chờ lâu nhất. Quyết định tiền món
        và trả tiền cho khách là hai bước riêng.
      </p>
      {notice && <p role="status">{notice}</p>}
      {kind === 'all' && (work.paymentCases?.length ?? 0) > 0 && (
        <button
          className={'core-card ' + styles.inboxLink}
          onClick={() => open('exceptions', 'payment')}
        >
          <Icon name="warning" size={22} />
          <span>
            <strong>{work.paymentCases!.length} ngoại lệ thanh toán đang chờ</strong>
            <small>Xem số tiền ngân hàng báo, tiền đã ghi sổ và bước xử lý hợp lệ.</small>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      )}
      {work.updatedAt && !visible.length && !(kind === 'all' && work.paymentCases?.length) && (
        <Empty
          title={
            search
              ? 'Không có công việc phù hợp'
              : kind === 'refund'
                ? 'Không có khoản nào cần hoàn cho khách.'
                : kind === 'incident'
                  ? 'Không có sự cố món hoặc nguyên liệu đang chờ xử lý.'
                  : kind === 'shortfall'
                    ? 'Không có hồ sơ thiếu tiền đang mở.'
                    : 'Không có công việc đang chờ.'
          }
        >
          {search
            ? 'Thử tên bàn, món hoặc mã phiên khác.'
            : 'Các công việc mới cần quản trị xử lý sẽ xuất hiện tại đây.'}
        </Empty>
      )}
      <div className="inbox-queue">
        {visible.map(({ row, kind: rowKind, time }) => (
          <article key={rowKind + '-' + row.id} className="core-card inbox-case">
            <div className="inbox-case-top">
              <span className={'inbox-badge ' + rowKind}>
                {row.stock_inspection ? 'Kiểm tra nguyên liệu / thiết bị' : kinds[rowKind]}
              </span>
              <small>{waitText(time)}</small>
            </div>
            <h3>
              Bàn {String(row.table_code)}
              <SessionReference id={row.session_id} code={row.session_code} />
            </h3>
            <strong>
              {rowKind === 'incident'
                ? `${String(row.product_name_snapshot)} × ${String(row.quantity)}`
                : rowKind === 'refund'
                  ? `Cần hoàn ${vnd(row.refund_due_amount)}`
                  : `Hồ sơ thiếu ${vnd(row.outstanding_amount)}`}
            </strong>
            <p>
              {rowKind === 'incident'
                ? reasonLabel(row.reported_reason_code ?? row.cancel_reason_code)
                : rowKind === 'refund'
                  ? 'Phải thu của phiên đã giảm hoặc tiền thu vượt số cần trả.'
                  : label(row.status)}
            </p>
            <small>
              {rowKind === 'incident'
                ? row.stock_inspection
                  ? 'Chưa chế biến - Đã bỏ tính tiền - Cần kiểm tra nguyên liệu'
                  : 'Bếp đã dừng món - Chờ quyết định tiền'
                : row.status === 'ACKNOWLEDGED'
                  ? 'Đã có người tiếp nhận - Chưa hoàn xong'
                  : rowKind === 'refund'
                    ? 'Chưa hoàn đủ tiền cho khách'
                    : 'Cần đối chiếu tiền và quyết định hồ sơ'}
            </small>
            {row.severity === 'CRITICAL' && (
              <strong className="form-error">Cảnh báo nghiêm trọng</strong>
            )}
            <button
              className="primary-button"
              onClick={() =>
                row.stock_inspection ? onInspectStock(row) : setSelected({ row, kind: rowKind })
              }
            >
              {rowKind === 'incident'
                ? row.stock_inspection
                  ? 'Kiểm tra kho & khả năng phục vụ'
                  : 'Kiểm tra & quyết định'
                : rowKind === 'refund'
                  ? 'Xử lý hoàn tiền'
                  : 'Kiểm tra hồ sơ'}
            </button>
          </article>
        ))}
      </div>
      {selected &&
        (selected.kind === 'refund' ? (
          <Modal
            title={'Hoàn tiền - Bàn ' + String(selected.row.table_code)}
            wide
            close={() => setSelected(undefined)}
          >
            <AdminHelp topic="refund" />
            <BillPanel
              focusRefund
              financialOnly
              id={String(selected.row.session_id)}
              products={[]}
              onClose={() => setSelected(undefined)}
              done={done}
            />
          </Modal>
        ) : (
          <WorkDetail
            row={selected.row}
            kind={selected.kind}
            close={() => setSelected(undefined)}
            done={done}
          />
        ))}
    </section>
  );
}
