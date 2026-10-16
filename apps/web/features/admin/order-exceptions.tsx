'use client';
import { HistoryRefund, UnavailableHistory } from './unavailable-history';
import { restaurantDateTime } from '../shared/restaurant-time';
import { ServerHistory } from '../shared/history-filters';
import { useCallback, useEffect, useState } from 'react';
import { reasonLabel } from '@thesis/contracts';
import { api, Action, label, vnd, type Row } from '../shared/components';
import { Modal } from '../shared/primitives';
import { AdminHelp } from './admin-help';
import { ItemDecisions } from './item-decisions';
import { adminDecision, AdminStateChanged } from './operations-inbox';
import type { AdminOpen } from './admin-overview';

export function OrderExceptions({ open }: { open: AdminOpen }) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [view, setView] = useState('active'),
    [selected, setSelected] = useState<Row>();
  const [status, setStatus] = useState('');
  const refresh = useCallback(async () => {
    try {
      setRows(await api('/core/order-exceptions'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="exceptions-app">
      <div className="section-heading compact">
        <div>
          <h3>Tra cứu & xử lý món</h3>
          <p>
            Kiểm tra món đang chế biến, đã phục vụ hoặc đã hủy. Sự cố bếp vừa báo được tập hợp trong
            Việc cần xử lý.
          </p>
        </div>
        <button className="secondary-button" onClick={() => open('exceptions', 'incident')}>
          Mở sự cố món và nguyên liệu
        </button>
        <Action run={refresh}>Làm mới</Action>
      </div>
      <nav className="module-tabs" aria-label="Tra cứu món">
        <button
          className={view === 'active' ? 'active' : ''}
          aria-pressed={view === 'active'}
          onClick={() => {
            setView('active');
            setStatus('');
          }}
        >
          Đang chế biến / đã phục vụ
        </button>
        <button
          className={view === 'history' ? 'active' : ''}
          aria-pressed={view === 'history'}
          onClick={() => {
            setView('history');
            setStatus('');
          }}
        >
          Món đã hủy
        </button>
        <button
          className={view === 'unavailable' ? 'active' : ''}
          aria-pressed={view === 'unavailable'}
          onClick={() => {
            setView('unavailable');
            setStatus('');
          }}
        >
          Dừng trước chế biến
        </button>
      </nav>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {view === 'unavailable' ? (
        <UnavailableHistory refreshKey={rows} />
      ) : (
        <ServerHistory
          kind={view === 'active' ? 'order-active' : 'order-cancelled'}
          placeholder="Tìm bàn, món hoặc mã phiên…"
          refreshKey={rows}
          filters={{ status: status || 'all' }}
          onReset={() => setStatus('')}
          controls={
            view === 'active' ? (
              <label>
                Trạng thái món
                <select
                  aria-label="Trạng thái món"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  {['IN_PREPARATION', 'READY', 'SERVED'].map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
        >
          {(items) => (
            <div className="inbox-queue">
              {items.map((row) => (
                <article key={row.id} className="core-card inbox-case unavailable-history-case">
                  <div className="unavailable-history-heading">
                    <h3>
                      Bàn {String(row.table_code)}
                      <span className="unavailable-history-session" title={String(row.session_id)}>
                        {' · Phiên #'}
                        {String(
                          row.session_code ?? String(row.session_id).slice(0, 8).toUpperCase(),
                        )}
                      </span>
                    </h3>
                    {view === 'history' && (
                      <span className="status-pill" data-status={String(row.session_status)}>
                        {row.session_status === 'CLOSED' ? 'Phiên đã chốt' : 'Phiên đang mở'}
                      </span>
                    )}
                  </div>
                  <strong>
                    {String(row.product_name_snapshot)} × {String(row.quantity)}
                  </strong>
                  <p>
                    {label(row.status)} -{' '}
                    {row.has_charge === true
                      ? `Đang tính ${vnd(row.charged_amount ?? row.line_total)}`
                      : 'Không tính tiền'}
                  </p>
                  {(row.decision_reason || row.cancel_reason || row.cancel_reason_code) && (
                    <p>
                      {String(
                        row.decision_reason ||
                          row.cancel_reason ||
                          reasonLabel(row.cancel_reason_code),
                      )}
                    </p>
                  )}
                  {(row.decision_at || row.cancelled_at) && (
                    <p className="small-note">
                      {row.decision_action === 'WAIVE_ITEM' ? 'Miễn tiền' : 'Xử lý'}:{' '}
                      {String(row.decision_by_name || row.cancelled_by_name || 'Chưa có tên')}
                      {' - '}
                      {restaurantDateTime(row.decision_at || row.cancelled_at)}
                    </p>
                  )}
                  <HistoryRefund value={row.refund_history} />
                  <button className="secondary-button" onClick={() => setSelected(row)}>
                    {row.session_status === 'CLOSED'
                      ? 'Xem chi tiết món'
                      : 'Kiểm tra món & thao tác'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </ServerHistory>
      )}
      <p className="small-note">
        {view === 'unavailable'
          ? 'Lịch sử dừng trước chế biến gồm cả phiên đang mở và đã kết thúc. Lọc theo ngày bếp báo sự cố.'
          : view === 'history'
            ? 'Món đã hủy gồm cả phiên đang mở và đã chốt. Lọc theo ngày hủy hoặc quyết định miễn tiền. Phiên đã chốt chỉ xem lịch sử.'
            : 'Món trong các phiên đang mở. Lọc theo ngày gọi món.'}
      </p>
      {selected && (
        <Modal
          title={'Xử lý món - ' + String(selected.product_name_snapshot)}
          close={() => setSelected(undefined)}
        >
          {selected.session_status !== 'CLOSED' && <AdminHelp topic="waive" />}
          <p>
            Bàn {String(selected.table_code)} · Phiên #
            {String(selected.session_code ?? String(selected.session_id).slice(0, 8).toUpperCase())}
            {' - '}
            {label(selected.status)} -{' '}
            {selected.has_charge === true
              ? vnd(selected.charged_amount ?? selected.line_total)
              : 'Không tính tiền'}
          </p>
          <HistoryRefund value={selected.refund_history} />
          <ItemDecisions
            item={selected}
            act={async (path, body) => {
              try {
                await adminDecision(path, body, refresh);
                await refresh();
                setSelected(undefined);
                setNotice(
                  'Đã cập nhật quyết định món. Kiểm tra khoản cần hoàn nếu khách đã thanh toán.',
                );
              } catch (error) {
                if (error instanceof AdminStateChanged) {
                  setSelected(undefined);
                  setNotice(error.message);
                } else throw error;
              }
            }}
          />
        </Modal>
      )}
    </section>
  );
}
