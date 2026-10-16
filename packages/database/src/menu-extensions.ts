import type { Database } from './index.js';
import {
  restaurantCategories as demoCategories,
  restaurantCategorySortOrder,
  restaurantIngredients as demoIngredients,
  restaurantMenu as demoMenu,
  restaurantIngredientLocation as ingredientLocation,
  restaurantCombos,
} from './restaurant-data.js';
import { menuExtensionCodes } from './demo-data.js';
import { importMenuMedia, menuMedia } from './menu-media.js';

const restaurantId = '10000000-0000-4000-8000-000000000001';

/** Add missing catalogue rows only. Existing prices, stock, users and operational history are preserved. */
export async function addRestaurantMenuExtensions(
  db: Database,
  apply = false,
  openingStock = false,
) {
  if (apply) await importMenuMedia();
  return db.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(450045)`;
      const startsAt = (await tx.$queryRaw<{ startsAt: Date }[]>`SELECT now() AS "startsAt"`)[0]!
        .startsAt;
      const report = {
        applied: apply,
        openingStock,
        products: [] as string[],
        ingredients: [] as string[],
        combos: [] as string[],
      };
      const existing = new Map(
        (await tx.product.findMany({ where: { restaurant_id: restaurantId } })).map((row) => [
          row.code,
          row,
        ]),
      );
      const dishes = demoMenu.filter((dish) => menuExtensionCodes.includes(dish.code));
      report.products = dishes.filter((dish) => !existing.has(dish.code)).map((dish) => dish.code);
      report.combos = restaurantCombos
        .filter((combo) => !existing.has(combo.code))
        .map((combo) => combo.code);
      const neededIngredients = new Set(dishes.flatMap((dish) => Object.keys(dish.recipe)));
      const ingredientDefinitions = demoIngredients.filter((row) => neededIngredients.has(row[0]));
      for (const code of neededIngredients)
        if (!ingredientDefinitions.some((row) => row[0] === code))
          throw new Error(`Thiếu định nghĩa nguyên liệu ${code}; chưa thể bổ sung thực đơn.`);
      const ingredientRows = await tx.ingredient.findMany({
        where: { restaurant_id: restaurantId },
      });
      report.ingredients = ingredientDefinitions
        .filter((row) => !ingredientRows.some((ingredient) => ingredient.code === row[0]))
        .map((row) => row[0]);
      if (!apply) return report;
      const categories = new Map<number, string>();
      for (const index of new Set(dishes.map((dish) => dish.category))) {
        const [code, name, description] = demoCategories[index]!;
        const category = await tx.menu_category.upsert({
          where: { restaurant_id_code: { restaurant_id: restaurantId, code } },
          update: {},
          create: {
            restaurant_id: restaurantId,
            code,
            name,
            description,
            sort_order: restaurantCategorySortOrder(code),
          },
        });
        categories.set(index, category.id);
      }
      const comboCategory = await tx.menu_category.upsert({
        where: { restaurant_id_code: { restaurant_id: restaurantId, code: 'COMBO' } },
        update: {},
        create: {
          restaurant_id: restaurantId,
          code: 'COMBO',
          name: demoCategories[6][1],
          description: demoCategories[6][2],
          sort_order: restaurantCategorySortOrder('COMBO'),
        },
      });
      for (const [
        code,
        name,
        unitCode,
        plannedQty,
        plannedCost,
        minimum,
      ] of ingredientDefinitions) {
        if (!report.ingredients.includes(code)) continue;
        const unit = await tx.unit_of_measure.findUniqueOrThrow({ where: { code: unitCode } });
        const ingredient = await tx.ingredient.create({
          data: {
            restaurant_id: restaurantId,
            code,
            name,
            base_unit_id: unit.id,
            min_stock: minimum,
          },
        });
        const location = await tx.stock_location.findUniqueOrThrow({
          where: {
            restaurant_id_code: { restaurant_id: restaurantId, code: ingredientLocation(code) },
          },
        });
        // Only a newly created ingredient can receive this explicitly requested planning balance.
        const qty = openingStock ? plannedQty : 0,
          cost = openingStock ? plannedCost : 0;
        await tx.inventory_balance.create({
          data: {
            location_id: location.id,
            ingredient_id: ingredient.id,
            on_hand_qty: qty,
            reserved_qty: 0,
            available_qty: qty,
            avg_cost: cost,
          },
        });
        if (openingStock) {
          const actor = await tx.app_user.findUniqueOrThrow({
            where: {
              restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' },
            },
          });
          await tx.inventory_movement.create({
            data: {
              location_id: location.id,
              ingredient_id: ingredient.id,
              movement_type: 'ADJUSTMENT_IN',
              quantity: qty,
              unit_cost: cost,
              value: BigInt(Math.round(qty * cost)),
              source_type: 'MANUAL',
              created_by: actor.id,
              request_key: `MENU-EXTENSION-${code}-OPENING`,
              reason: 'Tồn đầu kỳ theo kế hoạch thực đơn bổ sung',
            },
          });
        }
      }
      const ingredients = new Map(
        (await tx.ingredient.findMany({ where: { restaurant_id: restaurantId } })).map((row) => [
          row.code,
          row.id,
        ]),
      );
      for (const dish of dishes) {
        if (existing.has(dish.code)) continue;
        const parent = await tx.product.create({
          data: {
            restaurant_id: restaurantId,
            category_id: categories.get(dish.category)!,
            code: dish.code,
            name: dish.name,
            description: dish.description,
            base_price: BigInt(dish.price),
            image_url: menuMedia[dish.code] ?? null,
          },
        });
        existing.set(dish.code, parent);
        const recipe = await tx.recipe_bom.create({
          data: {
            product_id: parent.id,
            version_no: 1,
            yield_quantity: 1,
            status: 'ACTIVE',
            effective_from: startsAt,
          },
        });
        for (const [code, quantity] of Object.entries(dish.recipe)) {
          const ingredientId = ingredients.get(code);
          if (!ingredientId)
            throw new Error(`Thiếu nguyên liệu ${code}; chưa thể bổ sung ${dish.code}.`);
          await tx.recipe_bom_item.create({
            data: {
              recipe_bom_id: recipe.id,
              ingredient_id: ingredientId,
              quantity,
              waste_percent: 0,
            },
          });
        }
      }
      for (const combo of restaurantCombos) {
        if (existing.has(combo.code)) continue;
        const members = combo.components.map((component) => {
          const dish = existing.get(component.code);
          if (!dish || dish.product_kind !== 'DISH')
            throw new Error(
              `Thiếu món thành phần ${component.code}; chưa thể bổ sung ${combo.code}.`,
            );
          return { ...component, id: dish.id };
        });
        const parent = await tx.product.create({
          data: {
            restaurant_id: restaurantId,
            category_id: comboCategory.id,
            product_kind: 'COMBO',
            code: combo.code,
            name: combo.name,
            description: combo.description,
            base_price: BigInt(combo.price),
            image_url: menuMedia[combo.code] ?? null,
          },
        });
        for (const [index, member] of members.entries())
          await tx.product_combo_item.create({
            data: {
              combo_product_id: parent.id,
              component_product_id: member.id,
              quantity: member.quantity,
              sort_order: index,
            },
          });
        await tx.$executeRaw`SELECT refresh_product_combo_recipe(${parent.id}::uuid)`;
      }
      return report;
    },
    { timeout: 60000 },
  );
}
