import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
import type { AssistantContext, AssistantMenuProduct } from '@thesis/contracts';
import { digest, reject, type Connection } from '../shared/core-persistence.js';
const catalogLimit = 120;
export type AssistantSnapshot = {
  participantId: string;
  context: AssistantContext;
  images: Map<string, string | null>;
};
async function verifyGuest(c: Connection, request: FastifyRequest, restaurant: string) {
  const credential = request.cookies.guest;
  if (!credential || credential.length > 128) reject('Vui lòng quét QR để tham gia bàn.', 401);
  const row = (
    await c.query(
      `SELECT p.id AS participant_id,p.status AS participant_status,p.blocked_until,s.session_status
      FROM session_participant p JOIN table_session s ON s.id=p.session_id
      JOIN dining_table t ON t.id=s.table_id JOIN restaurant r ON r.id=t.restaurant_id
      WHERE p.credential_hash=$1 AND t.restaurant_id=$2 AND r.status='ACTIVE'`,
      [digest(credential), restaurant],
    )
  ).rows[0];
  if (!row || row.session_status !== 'ACTIVE')
    reject('Phiên bàn đã kết thúc hoặc hết hiệu lực. Vui lòng quét lại QR.', 401);
  if (
    row.participant_status !== 'ACTIVE' &&
    !(
      row.participant_status === 'BLOCKED' &&
      row.blocked_until &&
      new Date(row.blocked_until).getTime() <= Date.now()
    )
  )
    reject('Người tham gia đang bị chặn hoặc đã rời bàn.', 403);
  return String(row.participant_id);
}
async function readonly<T>(db: Database, work: (c: Connection) => Promise<T>): Promise<T> {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout = '3s'");
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export function readAssistantIdentity(db: Database, request: FastifyRequest, restaurant: string) {
  return readonly(db, (c) => verifyGuest(c, request, restaurant));
}
export function readAssistantSnapshot(db: Database, request: FastifyRequest, restaurant: string) {
  return readonly(db, async (c): Promise<AssistantSnapshot> => {
    const participantId = await verifyGuest(c, request, restaurant);
    const rows = (
      await c.query(
        `SELECT p.id AS product_id,p.code,p.name,p.description,p.image_url,p.base_price::text AS unit_price,
        p.product_kind,p.version,mc.code AS category_code,mc.name AS category_name,
        product_catalog_available(p.id,$1) AS available,
        ARRAY(SELECT DISTINCT left(ig.name,80) FROM recipe_bom b
          JOIN recipe_bom_item bi ON bi.recipe_bom_id=b.id JOIN ingredient ig ON ig.id=bi.ingredient_id
          WHERE b.product_id=p.id AND b.status='ACTIVE' AND b.effective_from<=now()
            AND (b.effective_to IS NULL OR b.effective_to>now()) AND ig.restaurant_id=$1 AND ig.is_active
          ORDER BY left(ig.name,80) LIMIT 40) AS ingredients,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',child.id,'name',left(child.name,120),
          'quantity',ci.quantity) ORDER BY ci.sort_order,ci.id)
          FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id
          WHERE ci.combo_product_id=p.id AND child.restaurant_id=$1),'[]'::jsonb) AS components
        FROM product p JOIN menu_category mc ON mc.id=p.category_id AND mc.restaurant_id=p.restaurant_id
        WHERE p.restaurant_id=$1 AND p.is_active AND mc.is_active
        ORDER BY mc.sort_order,p.name,p.id LIMIT $2`,
        [restaurant, catalogLimit + 1],
      )
    ).rows;
    const selected = rows.slice(0, catalogLimit);
    return {
      participantId,
      images: new Map(
        selected.map((r) => [String(r.product_id).toLowerCase(), r.image_url as string | null]),
      ),
      context: {
        currency: 'VND',
        priceIncludesVat: true,
        semanticMetadata: 'UNREVIEWED',
        catalogTruncated: rows.length > catalogLimit,
        menu: selected.map((r): AssistantMenuProduct => ({
          productId: String(r.product_id).toLowerCase(),
          code: String(r.code).slice(0, 40),
          name: String(r.name).slice(0, 120),
          description: String(r.description ?? '').slice(0, 400),
          categoryCode: String(r.category_code).slice(0, 40),
          categoryName: String(r.category_name).slice(0, 120),
          unitPrice: String(r.unit_price),
          productKind: r.product_kind,
          version: Number(r.version),
          available: r.available === true,
          ingredients: r.ingredients,
          components: r.components,
        })),
      },
    };
  });
}
/** Mirrors reserve() rounding, aggregating shared ingredients across proposed lines.
 * Requires one sufficient location per ingredient; never reserves or promises future stock.
 */
export function readAssistantBasketStock(
  db: Database,
  request: FastifyRequest,
  restaurant: string,
  products: { productId: string; quantity: number; unitPrice: string; version: number }[],
) {
  return readonly(db, async (c) => {
    await verifyGuest(c, request, restaurant);
    const result = await c.query(
      `WITH requested(product_id,quantity,unit_price,version) AS (
        SELECT * FROM unnest($1::uuid[],$2::int[],$4::text[],$5::int[])),
      needed AS (
        SELECT bi.ingredient_id,
          sum(ceil((bi.quantity*r.quantity::numeric/b.yield_quantity*(1+bi.waste_percent/100))*1000000)/1000000) AS quantity
        FROM requested r JOIN product p ON p.id=r.product_id AND p.restaurant_id=$3 AND p.stock_managed
        JOIN recipe_bom b ON b.product_id=p.id AND b.status='ACTIVE' AND b.effective_from<=now()
          AND (b.effective_to IS NULL OR b.effective_to>now())
        JOIN recipe_bom_item bi ON bi.recipe_bom_id=b.id GROUP BY bi.ingredient_id
      ) SELECT NOT EXISTS (
        SELECT 1 FROM requested r LEFT JOIN product p ON p.id=r.product_id AND p.restaurant_id=$3
        WHERE p.id IS NULL OR p.base_price::text<>r.unit_price OR p.version<>r.version
          OR NOT product_catalog_available(p.id,$3)
      ) AND NOT EXISTS (SELECT 1 FROM needed n WHERE NOT EXISTS (
        SELECT 1 FROM inventory_balance ib JOIN stock_location sl ON sl.id=ib.location_id
        JOIN ingredient ig ON ig.id=ib.ingredient_id
        WHERE ib.ingredient_id=n.ingredient_id AND sl.restaurant_id=$3 AND ig.restaurant_id=$3
          AND sl.is_active AND ig.is_active AND ib.available_qty>=n.quantity)) AS stock_ok`,
      [
        products.map((p) => p.productId),
        products.map((p) => p.quantity),
        restaurant,
        products.map((p) => p.unitPrice),
        products.map((p) => p.version),
      ],
    );
    return result.rows[0]?.stock_ok === true;
  });
}
