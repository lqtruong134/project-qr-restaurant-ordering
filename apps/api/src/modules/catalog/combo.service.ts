import { productPromotionField } from '@thesis/database/menu-promotions';
import { integer, object, one, reject, uuid, type Connection } from '../shared/core-persistence.js';

/** Contents are for one fixed combo. The order line quantity is the number of combos. */
export const comboCatalogFields = `
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'product_id',child.id,'code',child.code,'name',child.name,'quantity',ci.quantity,
    'image_url',child.image_url,'image_promotion',${productPromotionField('child')},'unit_price',child.base_price::text,
    'available',product_catalog_available(child.id,p.restaurant_id)
  ) ORDER BY ci.sort_order,ci.id)
    FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id
    WHERE ci.combo_product_id=p.id),'[]'::jsonb) AS components,
  CASE WHEN p.product_kind='COMBO' THEN (SELECT sum(child.base_price*ci.quantity)::text
    FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id
    WHERE ci.combo_product_id=p.id) ELSE p.base_price::text END AS regular_price`;

export async function configureCombo(
  c: Connection,
  id: string,
  restaurant: string,
  input: unknown,
) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 20)
    reject('Combo cần từ 2 đến 20 món khác nhau.', 400);
  const members = input.map((raw) => {
    const row = object(raw);
    return { productId: uuid(row.productId), quantity: integer(row.quantity, 1, 20) };
  });
  if (new Set(members.map((row) => row.productId)).size !== members.length)
    reject('Mỗi món chỉ xuất hiện một dòng trong combo.', 400);
  if (members.some((row) => row.productId === id)) reject('Combo không thể chứa chính nó.', 400);
  const dishes = (
    await c.query(
      `SELECT p.id,p.name,p.stock_managed,EXISTS(SELECT 1 FROM recipe_bom b
      WHERE b.product_id=p.id AND b.status='ACTIVE' AND b.effective_from<=now()
        AND (b.effective_to IS NULL OR b.effective_to>now())
        AND EXISTS(SELECT 1 FROM recipe_bom_item bi WHERE bi.recipe_bom_id=b.id)) AS has_recipe
     FROM product p JOIN menu_category mc ON mc.id=p.category_id
     WHERE p.id=ANY($1::uuid[]) AND p.restaurant_id=$2 AND p.product_kind='DISH'
       AND p.is_active AND mc.is_active`,
      [members.map((row) => row.productId), restaurant],
    )
  ).rows;
  if (dishes.length !== members.length)
    reject('Chỉ chọn món đang sử dụng trong nhà hàng. Combo không chứa combo khác.', 400);
  const missing = dishes.find((row) => row.stock_managed && !row.has_recipe);
  if (missing) reject(`Món ${missing.name} chưa có công thức nguyên liệu.`, 400);
  await c.query('DELETE FROM product_combo_item WHERE combo_product_id=$1', [id]);
  for (const [index, member] of members.entries())
    await c.query(
      'INSERT INTO product_combo_item(combo_product_id,component_product_id,quantity,sort_order) VALUES($1,$2,$3,$4)',
      [id, member.productId, member.quantity, index],
    );
  await c.query('SELECT refresh_product_combo_recipe($1)', [id]);
}

export async function refreshDependentCombos(c: Connection, product: string) {
  const rows = (
    await c.query(
      'SELECT combo_product_id FROM product_combo_item WHERE component_product_id=$1 ORDER BY combo_product_id',
      [product],
    )
  ).rows;
  for (const row of rows) {
    await c.query('SELECT refresh_product_combo_recipe($1)', [row.combo_product_id]);
    await c.query('UPDATE product SET version=version+1 WHERE id=$1', [row.combo_product_id]);
  }
}

export async function orderedComboContents(c: Connection, product: Record<string, unknown>) {
  if (product.product_kind !== 'COMBO') return [];
  // submit holds the parent FOR SHARE. Recipe writers lock a child before its parent;
  // NOWAIT prevents that inverse order from forming a deadlock. The transaction wrapper
  // converts 55P03 to a retryable 409, and a committed disable is checked below.
  await c.query(
    `SELECT child.id FROM product_combo_item ci
     JOIN product child ON child.id=ci.component_product_id
     WHERE ci.combo_product_id=$1 ORDER BY child.id FOR SHARE OF child NOWAIT`,
    [product.id],
  );
  const members = (
    await c.query(
      `SELECT p.id AS product_id,p.code,p.name,ci.quantity,
      (p.is_active AND mc.is_active AND p.availability_status='AVAILABLE') AS available
     FROM product_combo_item ci JOIN product p ON p.id=ci.component_product_id
     JOIN menu_category mc ON mc.id=p.category_id
     WHERE ci.combo_product_id=$1 ORDER BY ci.sort_order,ci.id`,
      [product.id],
    )
  ).rows;
  if (members.length < 2 || members.some((row) => !row.available))
    reject('Một món trong combo đã ngừng phục vụ. Vui lòng chọn combo khác.');
  return members.map(({ product_id, code, name, quantity }) => ({
    product_id,
    code,
    name,
    quantity,
  }));
}

export async function assertProductAvailable(c: Connection, product: string, restaurant: string) {
  const state = await one(c, 'SELECT product_catalog_available($1,$2) AS available', [
    product,
    restaurant,
  ]);
  if (!state.available)
    reject('Món hoặc thành phần combo hiện không đủ điều kiện phục vụ. Vui lòng chọn món khác.');
}
