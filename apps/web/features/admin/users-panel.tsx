'use client';
import { AdminHelp } from './admin-help';
import type { AdminData, SaveAdmin } from './admin-types';
import { roles } from './admin-forms';
import { EntryForm, label } from '../shared/components';
import { Empty, matches } from '../shared/primitives';
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
  const matching = (u: (typeof data.users)[number]) =>
    matches(`${u.display_name} ${u.username} ${u.staff_code ?? ''}`, search);
  const visibleStaff = staff.filter(matching);
  const visibleKitchen = kitchen.filter(matching);
  const renderUser = (u: (typeof data.users)[number]) => (
    <details className="core-card staff-card" key={u.id}>
      <summary>
        <span className="staff-avatar" aria-hidden="true">
          {String(u.display_name).slice(0, 1)}
        </span>
        <span>
          <strong>{String(u.display_name)}</strong>
          <small>
            Mã {String(u.staff_code ?? u.username)} - Đăng nhập {String(u.username)} -{' '}
            {label(u.status)}
          </small>
        </span>
      </summary>
      <EntryForm
        title="Cập nhật tài khoản"
        submit="Cập nhật tài khoản"
        successMessage={`Đã cập nhật tài khoản ${String(u.display_name)}.`}
        confirmLabel="Xác nhận cập nhật tài khoản"
        fields={[
          { key: 'name', label: 'Tên hiển thị', value: String(u.display_name) },
          { key: 'reason', label: 'Lý do cập nhật tài khoản / quyền' },
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
            label: 'Mật khẩu mới (16–128 ký tự; bỏ trống để giữ)',
            maxLength: 128,
            optional: true,
            type: 'password',
          },
        ]}
        confirm={(v) =>
          'Cập nhật tài khoản của ' +
          u.display_name +
          ': ' +
          (roles.find((role) => role.value === v.role)?.label ?? 'Vai trò đã chọn') +
          ', ' +
          label(v.status) +
          '. Các phiên đăng nhập cũ sẽ bị kết thúc. Lý do: ' +
          v.reason
        }
        onSubmit={(v) => save('/core/users/' + u.id, v, 'PATCH')}
      />
    </details>
  );
  return (
    <>
      <AdminHelp topic="access" />
      <details className="core-card">
        <summary>Thêm nhân viên mới</summary>
        <EntryForm
          title="Tạo tài khoản nhân viên"
          submit="Tạo tài khoản"
          successMessage="Đã tạo tài khoản nhân viên."
          fields={[
            { key: 'staffCode', label: 'Mã nhân viên (duy nhất, không đổi)' },
            { key: 'username', label: 'Tên đăng nhập' },
            { key: 'name', label: 'Tên hiển thị' },
            { key: 'password', label: 'Mật khẩu (16–128 ký tự)', type: 'password', maxLength: 128 },
            { key: 'role', label: 'Vai trò', options: roles },
          ]}
          onSubmit={(v) => save('/core/users', v)}
        />
      </details>
      <section className="staff-group">
        <div className="section-heading">
          <div>
            <h2>Đội phục vụ</h2>
            <p>
              {visibleStaff.length} / {staff.length} tài khoản - hỗ trợ bàn, gọi món và thu tiền
            </p>
          </div>
        </div>
        <div className="staff-grid">
          {visibleStaff.map(renderUser)}
          {!visibleStaff.length && (
            <Empty
              title={search ? 'Không tìm thấy nhân viên phục vụ' : 'Chưa có nhân viên phục vụ'}
            >
              {search
                ? 'Thử tên, tên đăng nhập hoặc mã nhân viên khác.'
                : 'Chọn Thêm nhân viên mới để tạo tài khoản.'}
            </Empty>
          )}
        </div>
      </section>
      <section className="staff-group">
        <div className="section-heading">
          <div>
            <h2>Đội bếp</h2>
            <p>
              {visibleKitchen.length} / {kitchen.length} tài khoản - tiếp nhận và chế biến món
            </p>
          </div>
        </div>
        <div className="staff-grid">
          {visibleKitchen.map(renderUser)}
          {!visibleKitchen.length && (
            <Empty title={search ? 'Không tìm thấy nhân viên bếp' : 'Chưa có nhân viên bếp'}>
              {search
                ? 'Thử tên, tên đăng nhập hoặc mã nhân viên khác.'
                : 'Chọn Thêm nhân viên mới để tạo tài khoản.'}
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}
