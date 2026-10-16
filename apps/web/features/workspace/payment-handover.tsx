import { Action, vnd, type Row } from '../shared/components';
import { restaurantDateTime } from '../shared/restaurant-time';
export function CashHistory({
  payment,
  statusOnly = false,
}: {
  payment: Row;
  statusOnly?: boolean;
}) {
  const m = payment.metadata as unknown as {
    cashReceived?: string;
    changeGiven?: string;
    cashHandlingVersion?: number;
  } | null;
  const received = payment.cash_received_amount ?? m?.cashReceived;
  if (payment.method !== 'CASH' || received == null) return null;
  const change = BigInt(String(payment.change_amount ?? m?.changeGiven ?? 0));
  return (
    <div className="cash-history">
      {!statusOnly && (
        <span>
          Khách đưa <strong>{vnd(received)}</strong> -{' '}
          {payment.change_returned_at
            ? 'Đã thối'
            : m?.cashHandlingVersion === 1
              ? 'Tiền cần thối'
              : 'Tiền thối ghi nhận'}{' '}
          <strong>{vnd(change)}</strong>
        </span>
      )}
      {change > 0n ? (
        <small>
          {payment.change_returned_at
            ? 'Đã xác nhận thối tiền - ' +
              String(payment.change_returned_by_name ?? 'Nhân viên') +
              ' - ' +
              restaurantDateTime(payment.change_returned_at)
            : m?.cashHandlingVersion === 1
              ? 'Chưa xác nhận đã trả tiền thừa'
              : 'Giao dịch cũ chưa lưu xác nhận trả tiền thừa'}
        </small>
      ) : (
        <small>Khách đưa đúng số tiền cần thu</small>
      )}
    </div>
  );
}
export function CashHandover({
  payments,
  act,
}: {
  payments: Row[];
  act: (path: string, body?: unknown) => Promise<void>;
}) {
  const pending = payments.filter((p) => {
    const m = p.metadata as unknown as {
      changeGiven?: string;
      cashHandlingVersion?: number;
    } | null;
    return (
      p.status === 'SUCCEEDED' &&
      p.method === 'CASH' &&
      m?.cashHandlingVersion === 1 &&
      BigInt(m.changeGiven ?? 0) > 0n &&
      !p.change_returned_at
    );
  });
  if (!pending.length) return null;
  return (
    <section className="cash-handover" aria-label="Trả tiền thừa cho khách">
      <h3>Trả tiền thừa cho khách</h3>
      {pending.map((p) => (
        <article key={p.id}>
          <CashHistory payment={p} />
          <Action
            confirm="Bạn đã trả đủ tiền thừa cho khách? Chỉ xác nhận sau khi khách đã nhận tiền."
            confirmLabel="Đã trả đủ tiền thừa"
            successMessage="Đã ghi nhận trả đủ tiền thừa cho khách."
            run={() => act('/core/payment-transactions/' + p.id + '/change-returned', {})}
          >
            Xác nhận đã trả tiền thừa
          </Action>
        </article>
      ))}
    </section>
  );
}
