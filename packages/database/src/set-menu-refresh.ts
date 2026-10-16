import { importMenuMedia, menuPromotionMedia } from './menu-media.js';
import type { Database } from './index.js';
import { restaurantCombos } from './demo-data.js';

const restaurantId = '10000000-0000-4000-8000-000000000001';
const poster = menuPromotionMedia['COMBO-05'];
const legacyPoster = '/images/banners/promotions/set-com-69k.webp';
const previousName = 'Set cơm gà';
const previousDescription =
  'Cho 1 người: 1 phần cơm gà kho gừng, 1 phần rau cải xào tỏi, 1 chén canh rau củ và 1 phần trái cây.';
const previousCodes = ['CHINH-14', 'KHAI-09', 'LAU-10', 'DESSERT-09'];
type Member = { id: string; code: string; quantity: number; sort_order: number };

/** Upgrade only the exact earlier set template; preserve custom menus and all ordered snapshots. */
export async function refreshRestaurantSetMenu(db: Database, apply = false) {
  if (apply) await importMenuMedia();
  const plan = restaurantCombos.find((combo) => combo.code === 'COMBO-05')!;
  return db.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(450045)`;
      const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product WHERE restaurant_id=${restaurantId}::uuid AND code='COMBO-05'
      FOR UPDATE NOWAIT`;
      const base = { code: plan.code, applied: false };
      if (!locked.length) return { ...base, status: 'MISSING_PRODUCT' };
      const product = await tx.product.findUniqueOrThrow({
        where: { id: locked[0]!.id },
        include: { menu_category: true },
      });
      const members = await tx.$queryRaw<Member[]>`
      SELECT p.id,p.code,ci.quantity,ci.sort_order FROM product_combo_item ci
      JOIN product p ON p.id=ci.component_product_id WHERE ci.combo_product_id=${product.id}::uuid
      ORDER BY ci.sort_order,p.id`;
      const sameComponents = (codes: readonly string[]) =>
        members.length === codes.length &&
        codes.every(
          (code, index) =>
            members[index]?.code === code &&
            members[index]?.quantity === 1 &&
            members[index]?.sort_order === index,
        );
      if (
        product.product_kind === 'COMBO' &&
        product.name === plan.name &&
        product.base_price === BigInt(plan.price) &&
        product.description === plan.description &&
        sameComponents(plan.components.map((member) => member.code))
      )
        return { ...base, status: 'ALREADY_ALIGNED', version: product.version };
      if (
        product.product_kind !== 'COMBO' ||
        product.name !== previousName ||
        product.base_price !== 69000n ||
        product.description !== previousDescription ||
        (product.image_url !== poster && product.image_url !== legacyPoster) ||
        !product.is_active ||
        product.availability_status !== 'AVAILABLE' ||
        !product.stock_managed ||
        product.menu_category.code !== 'COMBO' ||
        !product.menu_category.is_active ||
        !sameComponents(previousCodes)
      )
        return { ...base, status: 'CUSTOMIZED', version: product.version };
      const codes = plan.components.map((member) => member.code);
      const products = await tx.product.findMany({
        where: { restaurant_id: restaurantId, code: { in: codes } },
      });
      const missing = codes.filter((code) => !products.some((row) => row.code === code));
      if (missing.length)
        return { ...base, status: 'MISSING_COMPONENTS', missingComponents: missing };
      // NOWAIT avoids the parent→child / recipe-writer child→parent lock cycle.
      for (const child of [...products].sort((a, b) => a.id.localeCompare(b.id)))
        await tx.$queryRaw`SELECT id FROM product WHERE id=${child.id}::uuid FOR SHARE NOWAIT`;
      const current = await tx.product.findMany({
        where: { id: { in: products.map((row) => row.id) } },
        include: { menu_category: true },
      });
      if (
        current.length !== plan.components.length ||
        current.some(
          (row) =>
            row.product_kind !== 'DISH' ||
            !row.is_active ||
            row.availability_status !== 'AVAILABLE' ||
            !row.stock_managed ||
            !row.menu_category.is_active,
        )
      )
        return { ...base, status: 'UNAVAILABLE_COMPONENTS', version: product.version };
      const clock = (await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0]!.now;
      const recipes = await tx.recipe_bom.findMany({
        where: {
          product_id: { in: current.map((row) => row.id) },
          status: 'ACTIVE',
          effective_from: { lte: clock },
          OR: [{ effective_to: null }, { effective_to: { gt: clock } }],
          recipe_bom_item: { some: {} },
        },
        select: { product_id: true },
      });
      if (new Set(recipes.map((row) => row.product_id)).size !== plan.components.length)
        return { ...base, status: 'MISSING_RECIPES', version: product.version };
      const before = {
        name: product.name,
        description: product.description,
        version: product.version,
        components: members.map((member) => ({ code: member.code, quantity: member.quantity })),
      };
      if (!apply)
        return {
          ...base,
          status: 'MATCHED_OLD_TEMPLATE',
          from: before,
          to: { name: plan.name, description: plan.description, components: plan.components },
        };
      await tx.product_combo_item.deleteMany({ where: { combo_product_id: product.id } });
      for (const [index, member] of plan.components.entries())
        await tx.product_combo_item.create({
          data: {
            combo_product_id: product.id,
            component_product_id: current.find((row) => row.code === member.code)!.id,
            quantity: member.quantity,
            sort_order: index,
          },
        });
      await tx.product.update({
        where: { id: product.id },
        data: {
          name: plan.name,
          description: plan.description,
          version: { increment: 1 },
        },
      });
      const recipe = await tx.$queryRaw<{ id: string }[]>`
      SELECT refresh_product_combo_recipe(${product.id}::uuid) AS id`;
      const actor = await tx.app_user.findUniqueOrThrow({
        where: {
          restaurant_id_username: { restaurant_id: restaurantId, username: 'quyettruong05' },
        },
      });
      await tx.business_audit_event.create({
        data: {
          restaurant_id: restaurantId,
          actor_id: actor.id,
          action: 'REFRESH_RESTAURANT_SET_MENU',
          resource_type: 'PRODUCT',
          resource_id: product.id,
          reason: 'Chuẩn hóa set cơm gồm gà, thịt, trứng và các phần ăn kèm.',
          details: {
            bootstrap: true,
            before,
            after: {
              name: plan.name,
              description: plan.description,
              version: product.version + 1,
              components: plan.components,
              recipeId: recipe[0]!.id,
            },
          },
        },
      });
      return { code: plan.code, applied: true, status: 'UPDATED', version: product.version + 1 };
    },
    { timeout: 60000 },
  );
}
