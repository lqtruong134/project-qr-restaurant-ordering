'use client';
import { HistoryList } from '../shared/history-filters';
import { AdminHelp } from './admin-help';
import { useEffect, useState } from 'react';
import type { Inventory, SaveAdmin } from './admin-types';
import { Action, EntryForm, api, options, vnd, type Row } from '../shared/components';
import { Modal, confirmDiscard } from '../shared/primitives';
import { notifySuccess } from '../shared/operation-notice';
import { InventoryLinesForm } from './inventory-lines-form';
import { Badge, quantity, money, receiptLabels } from './inventory-ui';
import { restaurantDateTime } from '../shared/restaurant-time';
type Receipt = Omit<Row, 'lines' | 'audit'> & { id: string; lines: Row[]; audit: Row[] };
export function InventoryReceiptDetail({
  id,
  inventory,
  save,
  close,
}: {
  id: string;
  inventory: Inventory;
  save: SaveAdmin;
  close: () => void;
}) {
  const [receipt, setReceipt] = useState<Receipt>(),
    [error, setError] = useState(''),
    [mode, setMode] = useState('view');
  useEffect(() => {
    let active = true;
    void api<Receipt>('/core/receipts/' + id)
      .then((r) => {
        if (active) setReceipt(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function act(
    path: string,
    body: unknown,
    method = 'POST',
    propagate = true,
    successMessage = 'Đã cập nhật phiếu nhập nháp.',
  ) {
    try {
      await save(path, body, method);
      notifySuccess(successMessage);
      close();
    } catch (e) {
      const latest = await api<Receipt>('/core/receipts/' + id).catch(() => undefined);
      if (latest) {
        setReceipt(latest);
        if (latest.version !== receipt?.version) setMode('view');
      }
      setError(
        (e as Error).message +
          (latest
            ? ' Dữ liệu phiếu đã được tải lại.'
            : ' Chưa tải lại được phiếu; hãy mở lại trước khi thao tác.'),
      );
      if (propagate) throw e;
    }
  }
  return (
    <Modal
      title={receipt ? `Phiếu nhập - ${receipt.receipt_no}` : 'Chi tiết phiếu nhập'}
      wide
      close={close}
    >
      <div className="inv-dialog">
        <AdminHelp topic="inventory" />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!receipt && !error && <p role="status">Đang tải phiếu…</p>}
        {receipt && (
          <>
            <div className="inv-receipt-meta">
              <div>
                <span>Kho nhận</span>
                <strong>
                  {String(
                    inventory.locations.find((l) => l.id === receipt.location_id)?.name ??
                      'Kho đã ngừng sử dụng',
                  )}
                </strong>
              </div>
              <div>
                <span>Nhà cung cấp / Nguồn mua</span>
                <strong>{String(receipt.supplier_name_snapshot ?? 'Không ghi nguồn mua')}</strong>
              </div>
              <div>
                <span>Ngày lập</span>
                <strong>{restaurantDateTime(receipt.created_at)}</strong>
              </div>
              <div>
                <span>Trạng thái</span>
                <Badge
                  kind={
                    receipt.status === 'DRAFT'
                      ? 'low'
                      : receipt.status === 'CANCELLED'
                        ? 'muted'
                        : 'ready'
                  }
                >
                  {receiptLabels[String(receipt.status)] ?? String(receipt.status)}
                </Badge>
              </div>
              <div>
                <span>Người lập</span>
                <strong>{String(receipt.created_by_name ?? 'Không còn thông tin tên')}</strong>
              </div>
              <div>
                <span>Mã chứng từ bên ngoài</span>
                <strong>{String(receipt.external_reference ?? 'Không có chứng từ')}</strong>
              </div>
              {receipt.status === 'APPROVED' && (
                <>
                  <div>
                    <span>Thời điểm nhập kho</span>
                    <strong>{restaurantDateTime(receipt.received_at)}</strong>
                  </div>
                  <div>
                    <span>Người duyệt nhập kho</span>
                    <strong>{String(receipt.approved_by_name)}</strong>
                  </div>
                </>
              )}
            </div>
            {mode === 'view' && (
              <>
                <div className="core-scroll inv-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Nguyên liệu</th>
                        <th className="inv-number">Số lượng</th>
                        <th className="inv-number">Đơn giá</th>
                        <th className="inv-number">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.lines.map((l) => {
                        const ingredient = inventory.ingredients.find(
                          (i) => i.id === l.ingredient_id,
                        );
                        return (
                          <tr key={l.id}>
                            <td className="inv-name-cell" data-label="Nguyên liệu">
                              <strong>{String(ingredient?.name ?? 'Nguyên liệu')}</strong>
                              <small>{String(ingredient?.code ?? '')}</small>
                            </td>
                            <td data-label="Số lượng">
                              {quantity(l.quantity)} {String(ingredient?.unit_code ?? '')}
                            </td>
                            <td data-label="Đơn giá">{money(l.unit_cost)}</td>
                            <td data-label="Thành tiền">
                              {money(Math.round(Number(l.base_quantity) * Number(l.unit_cost)))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="inv-receipt-total">
                  <span>Tổng giá trị phiếu</span>
                  <strong>{vnd(receipt.total_value)}</strong>
                </div>
                {receipt.status === 'DRAFT' ? (
                  <>
                    <p className="inv-note">
                      Hàng chưa được cộng vào tồn kho. Kiểm tra số lượng và đơn giá trước khi duyệt.
                    </p>
                    <div className="inv-actions inv-receipt-actions">
                      <Action
                        confirmLabel="Duyệt nhập kho"
                        confirm={`Duyệt nhập kho phiếu ${receipt.receipt_no}? Phiếu gồm ${receipt.lines.length} nguyên liệu, tổng giá trị ${vnd(receipt.total_value)}. Tồn kho sẽ tăng theo các dòng hàng trên phiếu. Sau duyệt, phiếu không còn sửa như bản nháp.`}
                        run={async () => {
                          await act(
                            '/core/receipts/' + id + '/approve',
                            {
                              expectedVersion: receipt.version,
                            },
                            'POST',
                            false,
                            'Đã duyệt phiếu nhập kho. Tồn kho đã được cập nhật.',
                          );
                        }}
                      >
                        Duyệt nhập kho
                      </Action>
                      <button className="secondary-button" onClick={() => setMode('edit')}>
                        Sửa phiếu nháp
                      </button>
                      <button
                        className="secondary-button inv-danger"
                        onClick={() => setMode('cancel')}
                      >
                        Hủy phiếu nháp
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="inv-note">
                    {receipt.status === 'CANCELLED'
                      ? 'Phiếu nháp đã hủy, không làm thay đổi tồn kho.'
                      : 'Phiếu đã nhập kho. Xem phần Lịch sử kho để tra các dòng tăng tồn.'}
                  </p>
                )}
              </>
            )}
            {mode === 'edit' && (
              <InventoryLinesForm
                mode="receipt"
                successMessage={false}
                reasonRequired
                ingredients={inventory.ingredients.filter(
                  (i) => i.is_active || receipt.lines.some((l) => l.ingredient_id === i.id),
                )}
                choices={options(inventory.locations.filter((l) => l.is_active))}
                initial={{
                  target: String(receipt.location_id),
                  number: String(receipt.receipt_no),
                  supplier: String(receipt.supplier_name_snapshot ?? ''),
                  externalReference: String(receipt.external_reference ?? ''),
                  lines: receipt.lines.map((l) => ({
                    ingredientId: String(l.ingredient_id),
                    quantity: String(l.quantity),
                    unitCost: String(l.unit_cost),
                    waste: '0',
                  })),
                }}
                save={async (h, lines) => {
                  await act(
                    '/core/receipts/' + id,
                    {
                      locationId: h.target,
                      externalReference: h.externalReference,
                      supplier: h.supplier,
                      lines,
                      reason: h.reason,
                      expectedVersion: receipt.version,
                    },
                    'PATCH',
                  );
                }}
              />
            )}
            {mode === 'cancel' && (
              <EntryForm
                title="Hủy phiếu chưa nhập kho"
                successMessage={false}
                fields={[{ key: 'reason', label: 'Lý do hủy' }]}
                submit="Xác nhận hủy phiếu nháp"
                confirmTitle="Hủy phiếu nhập nháp?"
                confirmLabel="Hủy phiếu nháp"
                confirm="Phiếu sẽ ngừng xử lý và được giữ trong lịch sử. Vì chưa nhập kho, số tồn không thay đổi."
                onSubmit={async (v) => {
                  await act(
                    '/core/receipts/' + id + '/cancel',
                    { ...v, expectedVersion: receipt.version },
                    'POST',
                    true,
                    'Đã hủy phiếu nhập nháp.',
                  );
                }}
              />
            )}
            {mode === 'view' && (
              <details>
                <summary>Lịch sử thao tác trên phiếu</summary>
                <HistoryList
                  items={receipt.audit}
                  date={(e) => e.created_at}
                  search={(e) =>
                    [
                      e.actor_name,
                      e.reason,
                      (
                        {
                          CREATE_DRAFT_RECEIPT: 'Lập phiếu nháp',
                          EDIT_DRAFT_RECEIPT: 'Sửa phiếu nháp',
                          CANCEL_DRAFT_RECEIPT: 'Hủy phiếu nháp',
                          APPROVE_RECEIPT: 'Duyệt nhập kho',
                        } as Record<string, string>
                      )[String(e.action)],
                    ].join(' ')
                  }
                >
                  {(rows) => (
                    <ol className="support-history-list">
                      {rows.map((e) => (
                        <li key={e.id}>
                          <strong>
                            {(
                              {
                                CREATE_DRAFT_RECEIPT: 'Lập phiếu nháp',
                                EDIT_DRAFT_RECEIPT: 'Sửa phiếu nháp',
                                CANCEL_DRAFT_RECEIPT: 'Hủy phiếu nháp',
                                APPROVE_RECEIPT: 'Duyệt nhập kho',
                              } as Record<string, string>
                            )[String(e.action)] ?? 'Thao tác trên phiếu'}
                          </strong>
                          <small>
                            {String(e.actor_name ?? 'Nhà hàng')} -{' '}
                            {restaurantDateTime(e.created_at)}
                          </small>
                          {e.reason && <p>{String(e.reason)}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </HistoryList>
                <small>
                  Phiếu cũ có thể chưa ghi nhật ký chi tiết; ngày lập và người lập vẫn được giữ.
                </small>
              </details>
            )}
            {mode !== 'view' && (
              <button
                className="secondary-button"
                onClick={async (e) => {
                  const dialog = e.currentTarget.closest('dialog');
                  if (await confirmDiscard(dialog)) setMode('view');
                }}
              >
                Quay lại chi tiết
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
