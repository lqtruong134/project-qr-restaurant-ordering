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
  return (
    <>
      <details className="core-card">
        <summary>Thêm nhân viên</summary>
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
      {data.users
        .filter((u) => matches(String(u.display_name) + ' ' + u.username, search))
        .map((u) => (
          <details className="core-card" key={u.id}>
            <summary>
              {String(u.display_name)} · {String(u.username)} · {label(u.status)}
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
        ))}
    </>
  );
}
