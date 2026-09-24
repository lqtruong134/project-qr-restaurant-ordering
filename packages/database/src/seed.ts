import { seedWorkforce } from './workforce-seed.js';
import { hash, argon2id, type Database } from './index.js';
import { demoCategories, demoIngredients, demoMenu, demoStaff } from './demo-data.js';
export const restaurantId = '10000000-0000-4000-8000-000000000001';
const id = (n: number) => '10000000-0000-4000-8000-' + n.toString().padStart(12, '0');

/** Bootstrap demo master data. Reruns only fill missing rows: never reset operational stock, prices, passwords or table sessions. */
export async function seed(db: Database, password: string) {
  if (!password || password.length < 8)
    throw new Error('SEED_PASSWORD must contain at least 8 characters.');
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(450045)`;
      await tx.restaurant.upsert({
        where: { id: restaurantId },
        update: {
          address: 'Đường 3/2, phường Xuân Khánh, quận Ninh Kiều, thành phố Cần Thơ',
        },
        create: {
          id: restaurantId,
          name: 'Quyết Trường Bistro',
          address: 'Đường 3/2, phường Xuân Khánh, quận Ninh Kiều, thành phố Cần Thơ',
        },
      });
      const roles = new Map<string, string>();
      for (const [code, name, module] of [
        ['ADMIN', 'Quản trị viên', 'admin'],
        ['STAFF', 'Nhân viên phục vụ', 'staff'],
        ['KITCHEN', 'Nhân viên bếp', 'kitchen'],
      ] as const) {
        const role = await tx.role.upsert({ where: { code }, update: {}, create: { code, name } });
        roles.set(code, role.id);
        const permission = await tx.permission.upsert({
          where: { code: module + '.workspace' },
          update: {},
          create: {
            code: module + '.workspace',
            module,
            action: 'workspace',
            description: 'Truy cập không gian ' + name.toLowerCase(),
          },
        });
        await tx.role_permission.upsert({
          where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
          update: {},
          create: { role_id: role.id, permission_id: permission.id },
        });
      }
      for (const [username, display_name, role] of demoStaff) {
        const existing = await tx.app_user.findUnique({
          where: { restaurant_id_username: { restaurant_id: restaurantId, username } },
        });
        if (existing) {
          await tx.app_user.update({
            where: { id: existing.id },
            data: { display_name },
          });
          continue;
        }
        const user = await tx.app_user.create({
          data: {
            restaurant_id: restaurantId,
            username,
            display_name,
            password_hash: passwordHash,
          },
        });
        await tx.user_role.create({ data: { user_id: user.id, role_id: roles.get(role)! } });
      }
      for (const [n, code, name] of [
        [10, 'TRONG-NHA', 'Trong nhà'],
        [11, 'SAN-VUON', 'Sân vườn'],
        [12, 'PHONG-RIENG', 'Phòng riêng'],
      ] as const)
        await tx.dining_area.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: { id: id(n), restaurant_id: restaurantId, code, name, sort_order: n - 10 },
        });
      for (let n = 0; n < 16; n++) {
        const area = n < 8 ? 10 : n < 14 ? 11 : 12,
          code =
            (area === 10 ? 'A' : area === 11 ? 'V' : 'P') +
            String(area === 10 ? n + 1 : area === 11 ? n - 7 : n - 13).padStart(2, '0');
        await tx.dining_table.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {
            area_id: id(area),
            name: (area === 12 ? 'Phòng ' : 'Bàn ') + code,
            capacity: area === 12 ? 10 : 4,
          },
          create: {
            id: id(100 + n),
            restaurant_id: restaurantId,
            area_id: id(area),
            code,
            name: (area === 12 ? 'Phòng ' : 'Bàn ') + code,
            capacity: area === 12 ? 10 : 4,
          },
        });
      }
      for (const [i, [code, name, description]] of demoCategories.entries())
        await tx.menu_category.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            id: id(50 + i),
            restaurant_id: restaurantId,
            code,
            name,
            description,
            sort_order: i,
          },
        });
      const products = new Map<string, string>();
      for (const dish of demoMenu) {
        const p = await tx.product.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code: dish.code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            category_id: id(50 + dish.category),
            code: dish.code,
            name: dish.name,
            description: dish.description,
            base_price: BigInt(dish.price),
            image_url: '/menu/' + demoCategories[dish.category]![3] + '.svg',
          },
        });
        products.set(dish.code, p.id);
      }
      const units = new Map<string, string>();
      for (const [code, name, dimension, decimal_scale] of [
        ['KG', 'Kilogram', 'MASS', 6],
        ['L', 'Lít', 'VOLUME', 6],
        ['PCS', 'Cái', 'COUNT', 0],
      ] as const) {
        const u = await tx.unit_of_measure.upsert({
          where: { code },
          update: {},
          create: { code, name, dimension, decimal_scale },
        });
        units.set(code, u.id);
      }
      const location = await tx.stock_location.upsert({
        where: { restaurant_id_code: { restaurant_id: restaurantId, code: 'KHO-BEP' } },
        update: {},
        create: { restaurant_id: restaurantId, code: 'KHO-BEP', name: 'Kho nguyên liệu bếp' },
      });
      const ingredientIds = new Map<string, string>();
      for (const [code, name, unit, , cost, min] of demoIngredients) {
        const i = await tx.ingredient.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            code,
            name,
            base_unit_id: units.get(unit)!,
            current_avg_cost: cost,
            min_stock: min,
          },
        });
        ingredientIds.set(code, i.id);
      }
      // A real receipt trail backs the opening balances. Only absent balances are provisioned.
      const actor = await tx.app_user.findUniqueOrThrow({
        where: {
          restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' },
        },
      });
      const receiptNo = 'DEMO-OPENING-001';
      const previous = await tx.goods_receipt.findFirst({
        where: { location_id: location.id, receipt_no: receiptNo },
      });
      if (!previous) {
        const missing = [];
        for (const row of demoIngredients) {
          if (
            !(await tx.inventory_balance.findUnique({
              where: {
                location_id_ingredient_id: {
                  location_id: location.id,
                  ingredient_id: ingredientIds.get(row[0])!,
                },
              },
            }))
          )
            missing.push(row);
        }
        if (missing.length) {
          const receipt = await tx.goods_receipt.create({
            data: {
              location_id: location.id,
              receipt_no: receiptNo,
              supplier_name_snapshot: 'Nhà cung cấp mô phỏng · dữ liệu demo',
              created_by: actor.id,
              approved_by: actor.id,
              status: 'APPROVED',
              received_at: new Date(),
              total_value: BigInt(missing.reduce((s, i) => s + Math.round(i[3] * i[4]), 0)),
            },
          });
          for (const [code, , unit, qty, cost] of missing) {
            const ingredient_id = ingredientIds.get(code)!;
            await tx.goods_receipt_item.create({
              data: {
                receipt_id: receipt.id,
                ingredient_id,
                quantity: qty,
                unit_id: units.get(unit)!,
                base_quantity: qty,
                unit_cost: cost,
              },
            });
            await tx.inventory_balance.create({
              data: {
                location_id: location.id,
                ingredient_id,
                on_hand_qty: qty,
                reserved_qty: 0,
                available_qty: qty,
                avg_cost: cost,
              },
            });
            await tx.inventory_movement.create({
              data: {
                location_id: location.id,
                ingredient_id,
                movement_type: 'RECEIPT',
                quantity: qty,
                unit_cost: cost,
                value: BigInt(Math.round(qty * cost)),
                source_type: 'GOODS_RECEIPT',
                goods_receipt_id: receipt.id,
                created_by: actor.id,
              },
            });
          }
        }
      }
      for (const dish of demoMenu) {
        const product_id = products.get(dish.code)!;
        if (await tx.recipe_bom.findFirst({ where: { product_id } })) continue;
        const bom = await tx.recipe_bom.create({
          data: { product_id, version_no: 1, yield_quantity: 1, status: 'ACTIVE' },
        });
        for (const [code, quantity] of Object.entries(dish.recipe)) {
          await tx.recipe_bom_item.create({
            data: {
              recipe_bom_id: bom.id,
              ingredient_id: ingredientIds.get(code)!,
              quantity,
              waste_percent: 0,
            },
          });
        }
      }
      await seedWorkforce(tx, restaurantId);
    },
    { timeout: 60000 },
  );
}
