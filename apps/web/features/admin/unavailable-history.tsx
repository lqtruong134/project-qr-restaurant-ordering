'use client';
import { reasonLabel } from '@thesis/contracts';
import { vnd } from '../shared/components';
import { ServerHistory } from '../shared/history-filters';
import { restaurantDateTime } from '../shared/restaurant-time';

type RefundHistory = {
  scope: 'ITEM' | 'SHARED_SESSION' | 'SESSION' | 'NONE';
  cases: {
    scope: 'ITEM' | 'SHARED_SESSION' | 'SESSION';
    amount: string;
    refunded_amount: string;
    approved_at: string | null;
    status: string;
  }[];
};

export function HistoryRefund({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const history = value as RefundHistory;
  if (history.scope === 'NONE' || !history.cases?.length) return null;
  const lines = (['ITEM', 'SHARED_SESSION', 'SESSION'] as const).flatMap((scope) => {
    const cases = history.cases.filter((refund) => refund.scope === scope);
    if (!cases.length) return [];
    const returned = cases.reduce((sum, refund) => sum + BigInt(refund.refunded_amount), 0n);
    const open = cases.filter((refund) => ['OPEN', 'IN_PROGRESS'].includes(refund.status));
    const approved = open.reduce(
      (sum, refund) => sum + (refund.approved_at ? BigInt(refund.amount) : 0n),
      0n,
    );
    const pending = open.reduce(
      (sum, refund) => sum + (!refund.approved_at ? BigInt(refund.amount) : 0n),
      0n,
    );
    // History records what was returned; an old document balance is not the
    // current refund due when customers place more orders in the same session.
    const parts =
      returned > 0n
        ? [`Đã hoàn: ${vnd(returned)}`]
        : [
            approved > 0n ? `Phiếu hoàn đã duyệt: ${vnd(approved)}` : '',
            pending > 0n ? `Phiếu hoàn chờ duyệt: ${vnd(pending)}` : '',
          ].filter(Boolean);
    if (!parts.length) return [];
    const prefix =
      scope === 'SHARED_SESSION'
        ? 'Phiếu hoàn chung · '
        : scope === 'SESSION'
          ? 'Cả phiên bàn · '
          : '';
    return [prefix + parts.join(' · ')];
  });
  return lines.map((line) => (
    <p className="small-note unavailable-history-refund" key={line}>
      {line}
    </p>
  ));
}

export function UnavailableHistory({
  itemId,
  refreshKey,
}: {
  itemId?: string;
  refreshKey?: unknown;
}) {
  return (
    <ServerHistory
      kind="order-unavailable"
      refreshKey={refreshKey}
      filters={itemId ? { itemId } : undefined}
      placeholder="Tìm bàn, mã phiên, món, người xử lý hoặc lý do…"
      statuses={[
        { value: 'NEW', label: 'Chờ kiểm tra' },
        { value: 'ACKNOWLEDGED', label: 'Đã tiếp nhận' },
        { value: 'RESOLVED', label: 'Đã kiểm tra' },
      ]}
      empty="Không có món dừng trước chế biến phù hợp"
    >
      {(items) => (
        <div className="inbox-queue">
          {items.map((row) => (
            <article className="core-card inbox-case unavailable-history-case" key={String(row.id)}>
              <div className="unavailable-history-heading">
                <h3>
                  Bàn {String(row.table_code)}
                  <span className="unavailable-history-session" title={String(row.session_id)}>
                    {' · Phiên #'}
                    {String(row.session_code ?? String(row.session_id).slice(0, 8).toUpperCase())}
                  </span>
                </h3>
                <span className="status-pill" data-status={String(row.stock_check_status)}>
                  {row.stock_check_status === 'RESOLVED'
                    ? 'Đã kiểm tra'
                    : row.stock_check_status === 'ACKNOWLEDGED'
                      ? 'Đã tiếp nhận'
                      : row.report_id
                        ? 'Chờ kiểm tra'
                        : 'Chưa có biên bản'}
                </span>
              </div>
              <strong>
                {String(row.product_name_snapshot)} × {String(row.quantity)}
              </strong>
              <p>
                {String(
                  row.reported_reason ||
                    reasonLabel(row.reported_reason_code ?? row.cancel_reason_code) ||
                    'Chưa ghi nhận lý do',
                )}
              </p>
              <p className="small-note">
                {row.reported_at
                  ? `Bếp: ${String(row.reported_by_name ?? 'Chưa có tên')} - ${restaurantDateTime(row.reported_at)}`
                  : 'Bếp: Chưa ghi nhận'}
              </p>
              <HistoryRefund value={row.refund_history} />
              {row.stock_check_status === 'RESOLVED' && (
                <p className="small-note">
                  Xử lý: {String(row.stock_checked_by_name ?? 'Quản trị')}
                  {row.stock_checked_at && ` - ${restaurantDateTime(row.stock_checked_at)}`}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </ServerHistory>
  );
}
