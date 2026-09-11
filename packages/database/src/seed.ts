import { randomBytes, createHash } from 'node:crypto';
import { hash, argon2id, type Database } from './index.js';
export const restaurantId = '10000000-0000-4000-8000-000000000001';
const id = (n: number) => '10000000-0000-4000-8000-' + n.toString().padStart(12, '0');
const opaqueHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
export async function seed(db: Database, password: string) {
  if (!password || password.length < 16)
    throw new Error('SEED_PASSWORD must contain at least 16 characters.');
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.prisma.$transaction(
    async (tx) => {
      await tx.restaurant.upsert({
        where: { id: restaurantId },
        update: {},
        create: { id: restaurantId, name: 'Nhà hàng An Nhiên', address: 'Dữ liệu mẫu luận văn' },
      });
      const roles = ['STAFF', 'KITCHEN', 'ADMIN'];
      const names = ['Nhân viên', 'Nhân viên bếp', 'Quản trị viên'];
      const permissions = ['staff.workspace', 'kitchen.workspace', 'admin.workspace'];
      for (let i = 0; i < 3; i++) {
        const code = roles[i]!;
        const permission = permissions[i]!;
        const r = await tx.role.upsert({
          where: { code },
          update: {},
          create: { code, name: names[i]! },
        });
        const p = await tx.permission.upsert({
          where: { code: permission },
          update: {},
          create: {
            code: permission,
            module: code.toLowerCase(),
            action: 'workspace',
            description: 'Truy cập không gian ' + names[i],
          },
        });
        await tx.role_permission.upsert({
          where: { role_id_permission_id: { role_id: r.id, permission_id: p.id } },
          update: {},
          create: { role_id: r.id, permission_id: p.id },
        });
        const u = await tx.app_user.upsert({
          where: {
            restaurant_id_username: { restaurant_id: restaurantId, username: code.toLowerCase() },
          },
          update: {},
          create: {
            restaurant_id: restaurantId,
            username: code.toLowerCase(),
            display_name: names[i]!,
            password_hash: passwordHash,
          },
        });
        if (!(await tx.user_role.findFirst({ where: { user_id: u.id, revoked_at: null } })))
          await tx.user_role.create({ data: { user_id: u.id, role_id: r.id } });
      }
      await tx.dining_area.upsert({
        where: { id: id(10) },
        update: {},
        create: { id: id(10), restaurant_id: restaurantId, code: 'TANG-1', name: 'Tầng 1' },
      });
      for (let i = 0; i < 3; i++) {
        await tx.dining_table.upsert({
          where: { id: id(20 + i) },
          update: {},
          create: {
            id: id(20 + i),
            restaurant_id: restaurantId,
            area_id: id(10),
            code: 'B' + (i + 1).toString().padStart(2, '0'),
            name: 'Bàn ' + (i + 1),
            capacity: 4,
            table_status: i === 0 ? 'OCCUPIED' : 'AVAILABLE',
          },
        });
        await tx.table_qr_token.upsert({
          where: { id: id(30 + i) },
          update: {},
          create: { id: id(30 + i), table_id: id(20 + i), token_hash: opaqueHash(), version_no: 1 },
        });
      }
      await tx.table_session.upsert({
        where: { id: id(40) },
        update: {},
        create: { id: id(40), table_id: id(20) },
      });
      await tx.session_participant.upsert({
        where: { id: id(41) },
        update: {},
        create: {
          id: id(41),
          session_id: id(40),
          guest_id: id(42),
          display_name: 'Khách mẫu',
          credential_hash: opaqueHash(),
          device_session_hash: opaqueHash(),
        },
      });
      await tx.session_cart.upsert({
        where: { session_id: id(40) },
        update: {},
        create: { session_id: id(40) },
      });
      await tx.menu_category.upsert({
        where: { id: id(50) },
        update: {},
        create: { id: id(50), restaurant_id: restaurantId, code: 'MON-CHINH', name: 'Món chính' },
      });
      const products = [
        ['COM-GA', 'Cơm gà', 55000n],
        ['PHO-BO', 'Phở bò', 65000n],
        ['BUN-CHA', 'Bún chả', 60000n],
      ] as const;
      for (const [code, name, base_price] of products)
        await tx.product.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            category_id: id(50),
            code,
            name,
            base_price,
            description: 'Món mẫu phục vụ kiểm thử Sprint 1',
          },
        });
    },
    { timeout: 20000 },
  );
}
