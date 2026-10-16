import { seedWorkforce } from './workforce-seed.js';
import { importMenuMedia, menuMedia } from './menu-media.js';
import { seedMenuPromotions } from './menu-promotions.js';
import { hash, argon2id, type Database } from './index.js';
import {
  restaurantCategories as demoCategories,
  restaurantCategorySortOrder,
  restaurantIngredients as demoIngredients,
  restaurantMenu as demoMenu,
  restaurantStaff as demoStaff,
  restaurantIngredientLocation as ingredientLocation,
  restaurantCombos,
} from './restaurant-data.js';
export const restaurantId = '10000000-0000-4000-8000-000000000001';
const id = (n: number) => '10000000-0000-4000-8000-' + n.toString().padStart(12, '0');

/** Bootstrap restaurant master data. Reruns only fill missing rows: never reset operational stock, prices, passwords or table sessions. */
export type RestaurantSeedOptions = { startsAt?: Date; includeWorkforce?: boolean };
export async function seed(db: Database, password: string, options: RestaurantSeedOptions = {}) {
  if (!password || password.length < 8)
    throw new Error('SEED_PASSWORD must contain at least 8 characters.');
  if (
    options.startsAt &&
    (!Number.isFinite(options.startsAt.getTime()) || options.startsAt.getTime() > Date.now())
  )
    throw new Error('Ngày bắt đầu vận hành phải hợp lệ và không nằm trong tương lai.');
  await importMenuMedia();
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(450045)`;
      const startsAt =
        options.startsAt ??
        (await tx.$queryRaw<{ startsAt: Date }[]>`SELECT now() AS "startsAt"`)[0]!.startsAt;
      await tx.restaurant.upsert({
        where: { id: restaurantId },
        update: {},
        create: {
          id: restaurantId,
          name: 'Quyết Trường Bistro',
          address: 'Cần Thơ',
        },
      });
      const roles = new Map<string, string>();
      for (const [code, name, module] of [
        ['ADMIN', 'Quản trị viên', 'admin'],
        ['STAFF', 'Nhân viên phục vụ', 'staff'],
        ['KITCHEN', 'Nhân viên bếp', 'kitchen'],
      ] as const) {
        const role = await tx.role.upsert({
          where: { code },
          update: {},
          create: { code, name, created_at: startsAt, updated_at: startsAt },
        });
        roles.set(code, role.id);
        const permission = await tx.permission.upsert({
          where: { code: module + '.workspace' },
          update: {},
          create: {
            code: module + '.workspace',
            module,
            action: 'workspace',
            description: 'Truy cập không gian ' + name.toLowerCase(),
            created_at: startsAt,
            updated_at: startsAt,
          },
        });
        await tx.role_permission.upsert({
          where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
          update: {},
          create: {
            role_id: role.id,
            permission_id: permission.id,
            created_at: startsAt,
            updated_at: startsAt,
          },
        });
      }
      for (const [username, display_name, role] of demoStaff) {
        const existing = await tx.app_user.findUnique({
          where: { restaurant_id_username: { restaurant_id: restaurantId, username } },
        });
        if (existing) continue;
        const user = await tx.app_user.create({
          data: {
            restaurant_id: restaurantId,
            username,
            display_name,
            password_hash: passwordHash,
            created_at: startsAt,
          },
        });
        await tx.user_role.create({
          data: {
            user_id: user.id,
            role_id: roles.get(role)!,
            assigned_at: startsAt,
            created_at: startsAt,
            updated_at: startsAt,
          },
        });
      }
      const areas = new Map<number, string>();
      for (const [n, code, name] of [
        [10, 'TRONG-NHA', 'Trong nhà'],
        [11, 'SAN-VUON', 'Sân vườn'],
        [12, 'PHONG-RIENG', 'Phòng riêng'],
      ] as const) {
        const area = await tx.dining_area.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: { id: id(n), restaurant_id: restaurantId, code, name, sort_order: n - 10 },
        });
        areas.set(n, area.id);
      }
      for (let n = 0; n < 24; n++) {
        const area = n < 12 ? 10 : n < 20 ? 11 : 12,
          code =
            (area === 10 ? 'A' : area === 11 ? 'V' : 'P') +
            String(area === 10 ? n + 1 : area === 11 ? n - 11 : n - 19).padStart(2, '0');
        await tx.dining_table.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            id: id(100 + n),
            restaurant_id: restaurantId,
            area_id: areas.get(area)!,
            code,
            name: (area === 12 ? 'Phòng ' : 'Bàn ') + code,
            capacity: area === 12 ? 10 : 4,
          },
        });
      }
      const categories = new Map<number, string>();
      for (const [i, [code, name, description]] of demoCategories.entries()) {
        const category = await tx.menu_category.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            id: id(50 + i),
            restaurant_id: restaurantId,
            code,
            name,
            description,
            sort_order: restaurantCategorySortOrder(code),
          },
        });
        categories.set(i, category.id);
      }
      const products = new Map<string, string>();
      for (const dish of demoMenu) {
        const p = await tx.product.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code: dish.code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            category_id: categories.get(dish.category)!,
            code: dish.code,
            name: dish.name,
            description: dish.description,
            base_price: BigInt(dish.price),
            image_url: menuMedia[dish.code] ?? null,
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
      const locations = [];
      for (const [code, name] of [
        ['KHO-BEP', 'Kho mát và nguyên liệu bếp'],
        ['KHO-KHO', 'Kho khô và gia vị'],
        ['QUAY-NUOC', 'Quầy nước và tráng miệng'],
      ] as const) {
        locations.push(
          await tx.stock_location.upsert({
            where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
            update: {},
            create: { restaurant_id: restaurantId, code, name },
          }),
        );
      }
      const ingredientIds = new Map<string, string>();
      for (const [code, name, unit, , , min] of demoIngredients) {
        const i = await tx.ingredient.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            code,
            name,
            base_unit_id: units.get(unit)!,
            min_stock: min,
          },
        });
        ingredientIds.set(code, i.id);
      }
      // Opening balances have a traceable receipt. These are initial planning
      // quantities, not evidence of a purchase from an actual supplier.
      const actor = await tx.app_user.findUniqueOrThrow({
        where: {
          restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' },
        },
      });
      for (const location of locations) {
        const receiptNo = 'PN-DAU-KY-' + location.code;
        const previous = await tx.goods_receipt.findFirst({
          where: { location_id: location.id, receipt_no: receiptNo },
        });
        if (!previous) {
          const missing = [];
          for (const row of demoIngredients.filter(
            (i) => ingredientLocation(i[0]) === location.code,
          )) {
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
                supplier_name_snapshot:
                  location.code === 'KHO-BEP'
                    ? 'Nhà cung cấp thực phẩm bếp'
                    : location.code === 'KHO-KHO'
                      ? 'Nhà cung cấp gia vị và hàng khô'
                      : 'Nhà cung cấp đồ uống và tráng miệng',
                created_by: actor.id,
                approved_by: actor.id,
                status: 'DRAFT',
                received_at: startsAt,
                created_at: startsAt,
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
                  created_at: startsAt,
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
                  created_at: startsAt,
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
                  created_at: startsAt,
                  occurred_at: startsAt,
                },
              });
            }
            await tx.goods_receipt.update({
              where: { id: receipt.id },
              data: { status: 'APPROVED' },
            });
          }
        }
      }
      for (const dish of demoMenu) {
        const product_id = products.get(dish.code)!;
        if (await tx.recipe_bom.findFirst({ where: { product_id } })) continue;
        const bom = await tx.recipe_bom.create({
          data: {
            product_id,
            version_no: 1,
            yield_quantity: 1,
            status: 'ACTIVE',
            effective_from: startsAt,
            created_at: startsAt,
          },
        });
        for (const [code, quantity] of Object.entries(dish.recipe)) {
          await tx.recipe_bom_item.create({
            data: {
              recipe_bom_id: bom.id,
              ingredient_id: ingredientIds.get(code)!,
              quantity,
              waste_percent: 0,
              created_at: startsAt,
              updated_at: startsAt,
            },
          });
        }
      }
      for (const combo of restaurantCombos) {
        const existing = await tx.product.findUnique({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code: combo.code } },
        });
        if (existing) continue;
        const parent = await tx.product.create({
          data: {
            restaurant_id: restaurantId,
            category_id: categories.get(6)!,
            product_kind: 'COMBO',
            code: combo.code,
            name: combo.name,
            description: combo.description,
            base_price: BigInt(combo.price),
            image_url: menuMedia[combo.code] ?? null,
          },
        });
        for (const [index, component] of combo.components.entries())
          await tx.product_combo_item.create({
            data: {
              combo_product_id: parent.id,
              component_product_id: products.get(component.code)!,
              quantity: component.quantity,
              sort_order: index,
            },
          });
        await tx.$executeRaw`SELECT refresh_product_combo_recipe(${parent.id}::uuid)`;
        await tx.$executeRaw`
          UPDATE recipe_bom SET effective_from=${startsAt},created_at=${startsAt}
          WHERE product_id=${parent.id}::uuid AND version_no=1
        `;
        // The shared function stamps the newly generated aggregate with now().
        // Only this fresh, unreferenced seed recipe receives the agreed baseline.
        await tx.$executeRaw`
          UPDATE recipe_bom_item SET created_at=${startsAt}
          WHERE recipe_bom_id IN (
            SELECT id FROM recipe_bom WHERE product_id=${parent.id}::uuid AND version_no=1
          )
        `;
      }
      if (options.includeWorkforce !== false) await seedWorkforce(tx, restaurantId);
      // Migrations may run before the restaurant exists on a fresh installation.
      // Start classified pay today; retain every historical attendance snapshot.
      await tx.$executeRaw`
        INSERT INTO workforce_pay_policy (restaurant_id,effective_from,created_by,created_at)
        SELECT r.id,(${startsAt}::timestamptz AT TIME ZONE r.timezone)::date,u.id,${startsAt}
        FROM restaurant r JOIN app_user u ON u.restaurant_id=r.id AND u.username='quyettruong05'
        WHERE r.id=${restaurantId}::uuid
          AND NOT EXISTS (SELECT 1 FROM workforce_pay_policy p WHERE p.restaurant_id=r.id)
        ON CONFLICT (restaurant_id,effective_from) DO NOTHING
      `;
    },
    { timeout: 60000 },
  );
  await seedMenuPromotions(db, restaurantId);
}

type CatalogChange = {
  resource: 'RESTAURANT' | 'CATEGORY' | 'PRODUCT';
  id: string;
  code: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
};

/**
 * Refresh presentation fields of existing bootstrap rows. The default is a
 * read-only preview. Prices, identities, uploaded images, stock, recipes,
 * permissions, passwords and all operational history stay untouched.
 */
export async function refreshRestaurantCatalog(db: Database, apply = false) {
  if (apply) await importMenuMedia();
  return db.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(450045)`;
      const changes: CatalogChange[] = [];
      const skippedCustomizedProductCodes: string[] = [];
      const restaurant = await tx.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
      const legacyAddress = 'Khu trung tâm Cần Thơ · nhà hàng mô phỏng phục vụ luận văn';
      if (restaurant.address === legacyAddress) {
        changes.push({
          resource: 'RESTAURANT',
          id: restaurant.id,
          code: 'QUYET-TRUONG',
          before: { address: restaurant.address },
          after: { address: 'Cần Thơ' },
        });
        if (apply)
          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: { address: 'Cần Thơ' },
          });
      }
      for (const [code, name, description] of demoCategories) {
        const current = await tx.menu_category.findUnique({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
        });
        if (!current) continue;
        // A renamed custom category belongs to the restaurant, not the bootstrap.
        const legacyName = code === 'MON-NUONG' ? 'Món nướng' : name;
        if (current.name !== name && current.name !== legacyName) continue;
        if (current.name === name && current.description === description) continue;
        changes.push({
          resource: 'CATEGORY',
          id: current.id,
          code,
          before: { name: current.name, description: current.description },
          after: { name, description },
        });
        if (apply) {
          const updated = await tx.menu_category.updateMany({
            where: { id: current.id, name: current.name, description: current.description },
            data: { name, description },
          });
          if (updated.count !== 1)
            throw new Error('Danh mục vừa thay đổi. Hãy xem lại bản cập nhật.');
        }
      }
      for (const dish of [...demoMenu, ...restaurantCombos]) {
        const current = await tx.product.findUnique({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code: dish.code } },
        });
        if (!current) continue;
        if (current.name !== dish.name) {
          skippedCustomizedProductCodes.push(dish.code);
          continue;
        }
        const legacyDrawing =
          current.image_url &&
          /^\/menu\/(rice|grill|soup|starter|drink|dessert)\.svg$/.test(current.image_url);
        const image_url =
          !current.image_url || legacyDrawing ? (menuMedia[dish.code] ?? null) : current.image_url;
        if (current.description === dish.description && current.image_url === image_url) continue;
        changes.push({
          resource: 'PRODUCT',
          id: current.id,
          code: dish.code,
          before: { description: current.description, image_url: current.image_url },
          after: { description: dish.description, image_url },
        });
        if (apply) {
          const updated = await tx.product.updateMany({
            where: { id: current.id, version: current.version, name: dish.name },
            data: { description: dish.description, image_url, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw new Error('Món vừa thay đổi. Hãy xem lại bản cập nhật.');
        }
      }
      if (apply && changes.length) {
        const actor = await tx.app_user.findUniqueOrThrow({
          where: {
            restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' },
          },
        });
        await tx.business_audit_event.create({
          data: {
            restaurant_id: restaurantId,
            actor_id: actor.id,
            action: 'REFRESH_RESTAURANT_CATALOG',
            resource_type: 'RESTAURANT',
            resource_id: restaurantId,
            reason: 'Chuẩn hóa mô tả món, danh mục và ảnh mặc định.',
            details: { bootstrap: true, presentationOnly: true, changes },
          },
        });
      }
      return { applied: apply, changes, skippedCustomizedProductCodes };
    },
    { timeout: 60000 },
  );
}
