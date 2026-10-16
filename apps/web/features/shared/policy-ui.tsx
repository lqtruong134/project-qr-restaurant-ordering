'use client';
import { useState } from 'react';
import { AdminHelp } from '../admin/admin-help';
import {
  restaurantPolicy,
  staffProcedure,
  reasonOptions,
  type ReasonScope,
} from '@thesis/contracts';
import { Modal, Icon } from './primitives';
import type { Field } from './components';
export function PolicyNotice({
  children,
  warning = false,
}: {
  children: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={'context-notice' + (warning ? ' context-warning' : '')}>
      <Icon name={warning ? 'warning' : 'info'} size={20} />
      <p>{children}</p>
    </div>
  );
}
export function PolicyDialog({ close }: { close: () => void }) {
  return (
    <Modal title={restaurantPolicy.title} close={close}>
      <div className="policy-content">
        <p className="policy-date">
          Cập nhật{' '}
          {new Date(restaurantPolicy.updatedAt + 'T00:00:00Z').toLocaleDateString('vi-VN', {
            timeZone: 'UTC',
          })}
        </p>
        <h3>Những điều cần biết</h3>
        <ul>
          {restaurantPolicy.summary.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <h3>Xem từng nội dung</h3>
        {restaurantPolicy.sections.map((section) => (
          <details key={section.title}>
            <summary>{section.title}</summary>
            <p>{section.text}</p>
          </details>
        ))}
      </div>
    </Modal>
  );
}
export function ProcedureHelp({ role }: { role: keyof typeof staffProcedure }) {
  const [open, setOpen] = useState(false);
  if (role === 'ADMIN') return <AdminHelp topic="overview" />;
  const title = role === 'STAFF' ? 'Hướng dẫn phục vụ' : 'Hướng dẫn bếp';
  const groups =
    role === 'STAFF'
      ? ([
          ['Đón khách và gọi món', [0, 1]],
          ['Mang món và trao đổi với khách', [2, 3]],
          ['Thu tiền, trả tiền thừa và phiếu', [4]],
          ['Hỗ trợ, bàn giao và kết thúc bàn', [5]],
        ] as const)
      : ([
          ['Nhận món và chế biến', [0]],
          ['Không thể phục vụ trước chế biến', [1]],
          ['Sự cố trong khi chế biến', [2]],
          ['Khách phản hồi sau phục vụ', [3]],
        ] as const);
  return (
    <div className="procedure-help">
      <button className="secondary-button" onClick={() => setOpen(true)}>
        <Icon name="info" size={18} /> {title}
      </button>
      {open && (
        <Modal title={title} close={() => setOpen(false)}>
          <p>Chọn việc bạn đang thực hiện để xem hướng dẫn.</p>
          <div className="procedure-topics">
            {groups.map(([name, steps]) => (
              <details key={name}>
                <summary>{name}</summary>
                <ul>
                  {steps.map((index) => (
                    <li key={index}>{staffProcedure[role][index]}</li>
                  ))}
                </ul>
              </details>
            ))}
            <details>
              <summary>Ca làm, chấm công và lương của tôi</summary>
              <ul>
                <li>
                  Xem lịch được phân công và chấm vào, ra đúng ca. Nếu quên chấm công hoặc giờ ghi
                  nhận sai, báo quản trị để đối chiếu.
                </li>
                <li>
                  Giờ làm thêm cần được thống nhất và quản trị duyệt; chấm ra muộn không tự tăng
                  tiền công.
                </li>
                <li>
                  Lương giờ được đặt riêng theo từng nhân viên. Tiền làm đêm, làm thêm, ngày nghỉ và
                  ngày lễ được tính theo chính sách áp dụng và công đã duyệt.
                </li>
                <li>
                  Xem chi tiết công để kiểm tra từng khoản. Phiếu lương chỉ hiển thị sau khi quản
                  trị chốt; có thắc mắc thì báo quản trị để đối chiếu.
                </li>
              </ul>
            </details>
          </div>
        </Modal>
      )}
    </div>
  );
}
export const reasonFields = (scope: ReasonScope, initial?: string): Field[] => [
  { key: 'reasonCode', label: 'Lý do xử lý', options: reasonOptions(scope), value: initial },
  {
    key: 'note',
    label: scope === 'ADMIN_WAIVE' ? 'Lý do miễn tiền' : 'Ghi chú thêm',
    type: 'textarea',
    maxLength: 500,
    optional: !['KITCHEN_UNAVAILABLE', 'ADMIN_WAIVE'].includes(scope),
    ...(scope === 'KITCHEN_UNAVAILABLE'
      ? { showWhen: { key: 'reasonCode', value: 'OTHER' }, label: 'Lý do khác - Vui lòng ghi rõ' }
      : {}),
  },
];
