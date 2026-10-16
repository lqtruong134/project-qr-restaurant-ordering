'use client';
import { orderReasons, reasonLabel, type OrderReasonCode } from '@thesis/contracts';
import { Action, EntryForm, type Row, vnd } from '../shared/components';
import { reasonFields } from '../shared/policy-ui';
import { AdminHelp } from './admin-help';

export function ItemDecisions({
  item: i,
  act,
}: {
  item: Row;
  act: (path: string, body: unknown) => Promise<void>;
}) {
  if (i.session_status === 'CLOSED')
    return (
      <p className="small-note" role="status">
        Phiên bàn đã chốt. Chỉ xem lịch sử, không thể hủy hoặc miễn tiền món.
      </p>
    );
  const amount = vnd(i.line_total);
  const consequence = `Khách không phải trả ${amount} cho món này. Nguyên liệu đã sử dụng vẫn tính là tiêu hao. Nếu khách đã trả dư, hệ thống tính số cần hoàn; cần hoàn tiền thực tế và xác nhận giao dịch riêng.`;
  return i.reported_issue === true ? (
    <div className="incident-actions">
      <p className="small-note">
        Xác nhận sau khi kiểm tra món và lý do bếp báo. Lý do được dùng lại, không cần nhập lần nữa.
      </p>
      <Action
        confirmTitle="Xác nhận lỗi nhà hàng?"
        confirmLabel="Xác nhận lỗi nhà hàng"
        confirm={`${String(i.quantity)} × ${String(i.product_name_snapshot)} - Bàn ${String(i.table_code)}. Lý do: ${reasonLabel(i.reported_reason_code ?? i.cancel_reason_code)}. ${consequence}`}
        run={() =>
          act('/core/items/' + i.id + '/late-cancel', {
            useReportedReason: true,
            expectedReportId: i.report_id,
          })
        }
      >
        Xác nhận lỗi nhà hàng
      </Action>
      <details className="rare-action">
        <summary>Thực tế là khách yêu cầu hủy sau chế biến?</summary>
        <EntryForm
          title="Ghi nhận khách yêu cầu hủy"
          successMessage={false}
          fields={[
            {
              key: 'note',
              label: 'Ghi chú thêm (không bắt buộc)',
              optional: true,
              type: 'textarea',
              maxLength: 500,
            },
          ]}
          submit="Giữ khoản phải thu"
          confirmLabel="Xác nhận giữ khoản phải thu"
          confirm={`Chỉ chọn khi thực tế khách yêu cầu hủy sau chế biến. Khoản ${amount} vẫn phải trả; sự cố bếp được kết thúc với lý do khách đổi ý. Quyết định được lưu trong lịch sử.`}
          onSubmit={(v) =>
            act('/core/items/' + i.id + '/late-cancel', {
              ...v,
              reasonCode: 'CUSTOMER_CHANGED_MIND',
            })
          }
        />
      </details>
    </div>
  ) : (
    <>
      {['IN_PREPARATION', 'READY', 'SERVED'].includes(String(i.status)) && (
        <details>
          <summary>Hủy món sau khi đã chế biến</summary>
          <p className="small-note">
            Chọn đúng lý do thực tế. Món đã phục vụ: dùng Miễn tiền để giải quyết khiếu nại.
          </p>
          <EntryForm
            title="Quyết định hủy món"
            successMessage={false}
            fields={reasonFields('ADMIN_LATE').map((field) =>
              field.key === 'reasonCode' && i.status === 'SERVED'
                ? {
                    ...field,
                    options: field.options?.filter(
                      (option) => !orderReasons[option.value as OrderReasonCode].fault,
                    ),
                  }
                : field,
            )}
            submit="Xác nhận hủy món"
            confirmLabel="Xác nhận hủy món"
            confirm={(v) =>
              orderReasons[v.reasonCode as OrderReasonCode]?.fault
                ? consequence
                : `Hủy phục vụ món này nhưng khoản ${amount} vẫn phải trả vì khách đổi ý sau chế biến. Nguyên liệu đã dùng vẫn tính là tiêu hao.`
            }
            onSubmit={(v) => act('/core/items/' + i.id + '/late-cancel', v)}
          />
        </details>
      )}
      {i.has_charge === true &&
        (i.late_cancelled === true ||
          ['IN_PREPARATION', 'READY', 'SERVED'].includes(String(i.status))) && (
          <details>
            <summary>Miễn tiền theo quyết định của quản trị</summary>
            <AdminHelp topic="waive" />
            <EntryForm
              title="Miễn tiền món"
              successMessage={false}
              fields={reasonFields('ADMIN_WAIVE')}
              submit="Miễn tiền"
              confirmTitle="Miễn tiền món này?"
              confirmLabel="Xác nhận miễn tiền"
              confirm={`${String(i.product_name_snapshot)}. ${consequence} Món vẫn được giữ trong lịch sử và phiếu thanh toán.`}
              onSubmit={(v) => act('/core/items/' + i.id + '/waive', v)}
            />
          </details>
        )}
    </>
  );
}
