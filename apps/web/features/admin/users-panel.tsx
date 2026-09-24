'use client';
import type { AdminData, SaveAdmin } from './admin-types';
import { roles } from './admin-forms';
import { EntryForm, label } from '../shared/components';
import { matches } from '../shared/primitives';
export default function UsersPanel({
  data,
  search,
  save,
}: {
  data: Pick<AdminData, 'users'>;
  search: string;
  save: SaveAdmin;
}) {
  const staff = data.users.filter((u) => u.role === 'STAFF');
  const kitchen = data.users.filter((u) => u.role === 'KITCHEN');
  const renderUser = (u: (typeof data.users)[number]) => (
    <details className="core-card staff-card" key={u.id}>
      <summary>
        <span className="staff-avatar">{String(u.display_name).slice(0, 1)}</span>
        <span>
          <strong>{String(u.display_name)}</strong>
          <small>
            {String(u.username)} · {label(u.status)}
          </small>
        </span>
      </summary>
      <EntryForm
        title="Cập nhật tài khoản"
        fields={[
          { key: 'name', label: 'Tên hiển thị', value: String(u.display_name) },
          { key: 'role', label: 'Vai trò', value: String(u.role), options: roles },
          {
            key: 'status',
            label: 'Trạng thái',
            value: String(u.status),
            options: [
              { value: 'ACTIVE', label: 'Hoạt động' },
              { value: 'INACTIVE', label: 'Khóa tài khoản' },
            ],
          },
          {
            key: 'password',
            label: 'Mật khẩu mới (bỏ trống để giữ)',
            optional: true,
            type: 'password',
          },
        ]}
        onSubmit={(v) => save('/core/users/' + u.id, v, 'PATCH')}
      />
    </details>
  );
  return (
    <>
      <details className="core-card">
        <summary>Thêm nhân viên mới</summary>
        <EntryForm
          title="Tạo tài khoản nhân viên"
          fields={[
            { key: 'username', label: 'Tên đăng nhập' },
            { key: 'name', label: 'Tên hiển thị' },
            { key: 'password', label: 'Mật khẩu (ít nhất 16 ký tự)', type: 'password' },
            { key: 'role', label: 'Vai trò', options: roles },
          ]}
          onSubmit={(v) => save('/core/users', v)}
        />
      </details>
      <section className="staff-group">
        <div className="section-heading">
          <div>
            <h2>Đội phục vụ</h2>
            <p>{staff.length} tài khoản · phụ trách bàn, đơn và thanh toán tại ca</p>
          </div>
        </div>
        <div className="staff-grid">
          {staff
            .filter((u) => matches(String(u.display_name) + ' ' + u.username, search))
            .map(renderUser)}
        </div>
      </section>
      <section className="staff-group">
        <div className="section-heading">
          <div>
            <h2>Đội bếp</h2>
            <p>{kitchen.length} tài khoản · tiếp nhận và hoàn thành món</p>
          </div>
        </div>
        <div className="staff-grid">
          {kitchen
            .filter((u) => matches(String(u.display_name) + ' ' + u.username, search))
            .map(renderUser)}
        </div>
      </section>
    </>
  );
}
