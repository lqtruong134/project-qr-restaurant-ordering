'use client';
import { SessionReference } from '../shared/session-reference';
import { useCallback, useEffect, useState } from 'react';
import { api, Action, vnd, type Row } from '../shared/components';
import { Modal } from '../shared/primitives';
import BillPanel from '../workspace/bill-panel';
import type { Bill } from '../workspace/receipt';
import { adminDecision, AdminStateChanged, SessionFacts } from './operations-inbox';
import { UnavailableHistory } from './unavailable-history';
import { paymentSummary } from '../shared/payment-summary';

export default function StockInspection({
  row,
  visible,
  close,
  editProduct,
  inspectInventory,
  refresh,
  complete,
}: {
  row: Row;
  visible: boolean;
  close: () => void;
  editProduct: () => void;
  inspectInventory: () => void;
  refresh: () => Promise<void>;
  complete: (message: string) => void;
}) {
  const [detail, setDetail] = useState<{ bill: Bill; exceptions: Row[] }>();
  const [error, setError] = useState('');
  const [refund, setRefund] = useState(false);
  const sid = String(row.session_id);
  const reload = useCallback(async () => {
    setDetail(undefined);
    setError('');
    try {
      setDetail(await api('/core/reports/sessions/' + sid));
    } catch {
      setError('Chưa tải được thông tin thanh toán. Chọn Tải lại để thử lại.');
    }
  }, [sid]);
  useEffect(() => {
    if (visible) void reload();
  }, [visible, reload]);
  const totals = paymentSummary(detail?.bill.account);
  if (!visible) return null;
  if (refund)
    return (
      <Modal
        title={'Hoàn tiền - Bàn ' + String(row.table_code)}
        wide
        close={() => {
          setRefund(false);
          void reload();
        }}
      >
        <BillPanel
          focusRefund
          financialOnly
          id={sid}
          products={[]}
          onClose={() => {
            setRefund(false);
            void reload();
          }}
          done={async () => {
            await Promise.all([refresh(), reload()]);
          }}
        />
      </Modal>
    );
  return (
    <Modal title={'Kiểm tra nguyên liệu - Bàn ' + String(row.table_code)} wide close={close}>
      <div className="inbox-detail">
        <p className="small-note">
          Bàn {String(row.table_code)}
          <SessionReference id={row.session_id} code={row.session_code} />
        </p>
        <h3>
          {String(row.product_name_snapshot)} × {String(row.quantity)}
        </h3>
        <p>{String(row.issue_reason)}</p>
        <p className="small-note">
          <strong>Không tính tiền - 0 đ</strong>
        </p>
        <p>
          Món đã dừng trước chế biến. Phần nguyên liệu giữ cho món đã được trả lại số lượng có thể
          dùng trên hệ thống; số lượng tồn thực tế chưa được điều chỉnh.
        </p>
        <p>
          Kiểm tra nguyên liệu hoặc thiết bị tại bếp, điều chỉnh tồn nếu cần. Chỉ mở bán lại khi đã
          có thể phục vụ.
        </p>
        <div className="core-actions">
          <button
            className="secondary-button"
            disabled={!row.product_id}
            onClick={inspectInventory}
          >
            Kiểm tra & điều chỉnh kho
          </button>
          <button className="secondary-button" disabled={!row.product_id} onClick={editProduct}>
            Chỉnh sửa món này
          </button>
        </div>
        {!row.product_id && (
          <p className="small-note">
            Món không còn trong thực đơn. Thông tin lúc khách gọi vẫn được giữ trong lịch sử.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!detail && !error && <p role="status">Đang kiểm tra thanh toán của bàn…</p>}
        {error && <Action run={reload}>Tải lại</Action>}
        {detail && (
          <>
            <SessionFacts
              detail={detail}
              note="Món đang kiểm tra không tính tiền. Số tiền bên dưới là của cả bàn, không phải riêng món này."
            />
            {totals.refundDue > 0n ? (
              <div className="context-notice">
                <p>
                  Cả bàn còn chờ hoàn {vnd(totals.refundDue)} sau khi đối chiếu tiền hóa đơn và số
                  tiền thực trả. Hoàn tất kiểm tra nguyên liệu chưa ghi nhận đã trả tiền cho khách.
                </p>
                <button className="primary-button" onClick={() => setRefund(true)}>
                  Kiểm tra & hoàn tiền
                </button>
              </div>
            ) : (
              <p className="small-note">
                {totals.collectedTotal === 0n
                  ? 'Khách chưa thanh toán. Món bị dừng không tính tiền, nên không cần hoàn tiền.'
                  : totals.refundedTotal > 0n
                    ? 'Các khoản cần hoàn đã được trả lại cho khách. Hiện cả bàn không còn tiền chờ hoàn.'
                    : 'Hiện không còn khoản cần hoàn theo thanh toán của cả bàn.'}
              </p>
            )}
          </>
        )}
        <div className="core-actions">
          <Action
            confirmTitle="Kiểm tra trước khi xác nhận"
            confirmLabel="Xác nhận"
            confirm="Bạn đã kiểm tra thực tế và cập nhật thông tin cần thiết? Cảnh báo sẽ được hoàn tất. Khoản cần hoàn, nếu có, vẫn phải xử lý riêng."
            run={async () => {
              try {
                await adminDecision(
                  '/core/alerts/' + row.id + '/stock-checked',
                  { reason: 'Đã hoàn tất kiểm tra nguyên liệu / thiết bị.' },
                  refresh,
                );
                await refresh();
                complete('Đã ghi nhận kết quả kiểm tra nguyên liệu.');
              } catch (e) {
                if (e instanceof AdminStateChanged) complete(e.message);
                else throw e;
              }
            }}
          >
            Hoàn tất kiểm tra
          </Action>
        </div>
        <details className="inbox-history">
          <summary>Lịch sử dừng món trước chế biến</summary>
          <UnavailableHistory itemId={String(row.item_id)} />
        </details>
      </div>
    </Modal>
  );
}
