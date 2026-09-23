import type { FastifyInstance } from 'fastify';
import { hash, argon2id, type Database } from '@thesis/database';
import { idParam, object, one, reject, text, transaction } from './common.js';
async function passwordHash(value: unknown) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 128)
    reject('Mật khẩu phải có từ 16 đến 128 ký tự.', 400);
  return hash(value, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export function registerUsers(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get(
    '/core/users',
    { config },
    async () =>
      (
        await db.pool.query(
          `SELECT u.id,u.username,u.display_name,u.status,r.code AS role FROM app_user u LEFT JOIN user_role ur ON ur.user_id=u.id AND ur.revoked_at IS NULL LEFT JOIN role r ON r.id=ur.role_id WHERE u.restaurant_id=$1 ORDER BY u.username`,
          [restaurant],
        )
      ).rows,
  );
  app.post('/core/users', { config }, async (r) => {
    const b = object(r.body),
      username = text(b.username, 60),
      role = text(b.role);
    if (!/^[a-z0-9._-]{3,60}$/.test(username) || !['ADMIN', 'STAFF', 'KITCHEN'].includes(role))
      reject('Tên đăng nhập hoặc vai trò không hợp lệ.', 400);
    const hashed = await passwordHash(b.password);
    return transaction(db, async (c) => {
      const rr = await one(c, 'SELECT id FROM role WHERE code=$1', [role]);
      const user = await one(
        c,
        'INSERT INTO app_user(restaurant_id,username,password_hash,display_name) VALUES($1,$2,$3,$4) RETURNING id,username,display_name,status',
        [restaurant, username, hashed, text(b.name, 100)],
      );
      await c.query('INSERT INTO user_role(user_id,role_id) VALUES($1,$2)', [user.id, rr.id]);
      return user;
    });
  });
  app.patch('/core/users/:id', { config }, async (r) => {
    const b = object(r.body),
      id = idParam(r),
      role = text(b.role),
      status = text(b.status);
    if (!['ADMIN', 'STAFF', 'KITCHEN'].includes(role) || !['ACTIVE', 'DISABLED'].includes(status))
      reject('Vai trò hoặc trạng thái không hợp lệ.', 400);
    if (id === r.identity!.id && (role !== 'ADMIN' || status !== 'ACTIVE'))
      reject('Không được tự thu hồi quyền quản trị đang sử dụng.');
    const hashed = b.password ? await passwordHash(b.password) : null;
    return transaction(db, async (c) => {
      await one(c, 'SELECT id FROM restaurant WHERE id=$1 FOR UPDATE', [restaurant]);
      await one(c, 'SELECT id FROM app_user WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [
        id,
        restaurant,
      ]);
      const rr = await one(c, 'SELECT id FROM role WHERE code=$1', [role]);
      await c.query(
        'UPDATE user_role SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL AND role_id<>$2',
        [id, rr.id],
      );
      await c.query(
        'INSERT INTO user_role(user_id,role_id) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM user_role WHERE user_id=$1 AND revoked_at IS NULL)',
        [id, rr.id],
      );
      return one(
        c,
        'UPDATE app_user SET display_name=$2,status=$3,password_hash=COALESCE($4,password_hash),auth_version=auth_version+1,refresh_token_hash=NULL,refresh_expires_at=NULL WHERE id=$1 RETURNING id,username,display_name,status',
        [id, text(b.name, 100), status, hashed],
      );
    });
  });
}
