import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  decimal,
  idParam,
  object,
  one,
  reject,
  text,
  transaction,
  uuid,
} from '../shared/core-persistence.js';
export function registerInventory(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get('/core/inventory', { config }, async () => ({
    units: await db.prisma.unit_of_measure.findMany(),
    ingredients: await db.prisma.ingredient.findMany({ where: { restaurant_id: restaurant } }),
    locations: await db.prisma.stock_location.findMany({ where: { restaurant_id: restaurant } }),
    balances: (
      await db.pool.query(
        `SELECT b.*,i.name AS ingredient_name,l.name AS location_name,u.code AS unit FROM inventory_balance b JOIN ingredient i ON i.id=b.ingredient_id JOIN stock_location l ON l.id=b.location_id JOIN unit_of_measure u ON u.id=i.base_unit_id WHERE l.restaurant_id=$1 ORDER BY i.name`,
        [restaurant],
      )
    ).rows,
    receipts: (
      await db.pool.query(
        'SELECT g.* FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE l.restaurant_id=$1 ORDER BY g.created_at DESC LIMIT 100',
        [restaurant],
      )
    ).rows,
  }));
  app.post('/core/units', { config }, async (r) => {
    const b = object(r.body),
      dimension = text(b.dimension);
    if (!['MASS', 'VOLUME', 'COUNT'].includes(dimension)) reject('Nhóm đơn vị không hợp lệ.', 400);
    return db.prisma.unit_of_measure.create({
      data: { code: text(b.code, 20), name: text(b.name, 80), dimension, decimal_scale: 6 },
    });
  });
  app.post('/core/ingredients', { config }, async (r) => {
    const b = object(r.body);
    return db.prisma.ingredient.create({
      data: {
        restaurant_id: restaurant,
        code: text(b.code, 40),
        name: text(b.name, 120),
        base_unit_id: uuid(b.unitId),
        min_stock: decimal(b.minStock ?? '0', true),
      },
    });
  });
  app.post('/core/locations', { config }, async (r) => {
    const b = object(r.body);
    return db.prisma.stock_location.create({
      data: { restaurant_id: restaurant, code: text(b.code, 40), name: text(b.name, 120) },
    });
  });
  app.post('/core/products/:id/bom', { config }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        b = object(r.body);
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50)
        reject('Cần 1–50 nguyên liệu.', 400);
      await one(c, 'SELECT id FROM product WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [
        id,
        restaurant,
      ]);
      const v = await one(
        c,
        'SELECT COALESCE(max(version_no),0)+1 AS next FROM recipe_bom WHERE product_id=$1',
        [id],
      );
      await c.query(
        "UPDATE recipe_bom SET status='RETIRED',effective_to=now() WHERE product_id=$1 AND status='ACTIVE'",
        [id],
      );
      const bom = await one(
        c,
        "INSERT INTO recipe_bom(product_id,version_no,yield_quantity,status) VALUES($1,$2,$3,'ACTIVE') RETURNING *",
        [id, v.next, decimal(b.yield ?? '1')],
      );
      for (const raw of b.lines) {
        const line = object(raw);
        await one(c, 'SELECT id FROM ingredient WHERE id=$1 AND restaurant_id=$2 AND is_active', [
          uuid(line.ingredientId),
          restaurant,
        ]);
        await c.query(
          'INSERT INTO recipe_bom_item(recipe_bom_id,ingredient_id,quantity,waste_percent) VALUES($1,$2,$3,$4)',
          [bom.id, line.ingredientId, decimal(line.quantity), decimal(line.waste ?? '0', true)],
        );
      }
      return bom;
    }),
  );
  app.post('/core/receipts', { config }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body);
      await one(
        c,
        'SELECT id FROM stock_location WHERE id=$1 AND restaurant_id=$2 AND is_active FOR UPDATE',
        [uuid(b.locationId), restaurant],
      );
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100)
        reject('Cần 1–100 dòng nhập kho.', 400);
      const receipt = await one(
        c,
        'INSERT INTO goods_receipt(location_id,receipt_no,total_value,created_by,supplier_name_snapshot) VALUES($1,$2,0,$3,$4) RETURNING *',
        [
          b.locationId,
          text(b.number, 80),
          r.identity!.id,
          b.supplier ? text(b.supplier, 120) : null,
        ],
      );
      for (const raw of b.lines) {
        const line = object(raw);
        const ingredient = await one(
          c,
          'SELECT * FROM ingredient WHERE id=$1 AND restaurant_id=$2 AND is_active',
          [uuid(line.ingredientId), restaurant],
        );
        await c.query(
          'INSERT INTO goods_receipt_item(receipt_id,ingredient_id,quantity,unit_id,base_quantity,unit_cost) VALUES($1,$2,$3,$4,$3,$5)',
          [
            receipt.id,
            ingredient.id,
            decimal(line.quantity),
            ingredient.base_unit_id,
            decimal(line.unitCost, true),
          ],
        );
      }
      return one(
        c,
        'UPDATE goods_receipt SET total_value=(SELECT round(sum(base_quantity*unit_cost))::bigint FROM goods_receipt_item WHERE receipt_id=$1) WHERE id=$1 RETURNING *',
        [receipt.id],
      );
    }),
  );
  app.post('/core/receipts/:id/approve', { config }, async (r) =>
    transaction(db, async (c) => {
      const g = await one(
        c,
        'SELECT g.* FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE g.id=$1 AND l.restaurant_id=$2 FOR UPDATE OF g',
        [idParam(r), restaurant],
      );
      if (g.status === 'APPROVED') return g;
      if (g.status !== 'DRAFT') reject('Phiếu nhập không còn ở trạng thái nháp.');
      const items = (
        await c.query(
          'SELECT * FROM goods_receipt_item WHERE receipt_id=$1 ORDER BY ingredient_id',
          [g.id],
        )
      ).rows;
      for (const item of items) {
        await c.query(
          'INSERT INTO inventory_balance(location_id,ingredient_id,available_qty) VALUES($1,$2,0) ON CONFLICT(location_id,ingredient_id) DO NOTHING',
          [g.location_id, item.ingredient_id],
        );
        const balance = await one(
          c,
          'SELECT * FROM inventory_balance WHERE location_id=$1 AND ingredient_id=$2 FOR UPDATE',
          [g.location_id, item.ingredient_id],
        );
        await c.query(
          'UPDATE inventory_balance SET avg_cost=(on_hand_qty*avg_cost+$2::numeric*$3::numeric)/(on_hand_qty+$2::numeric),on_hand_qty=on_hand_qty+$2::numeric,available_qty=available_qty+$2::numeric,version=version+1 WHERE id=$1',
          [balance.id, item.base_quantity, item.unit_cost],
        );
        await c.query(
          `INSERT INTO inventory_movement(location_id,ingredient_id,movement_type,quantity,unit_cost,value,source_type,created_by,goods_receipt_id) VALUES($1,$2,'RECEIPT',$3,$4,round($3::numeric*$4::numeric)::bigint,'GOODS_RECEIPT',$5,$6)`,
          [
            g.location_id,
            item.ingredient_id,
            item.base_quantity,
            item.unit_cost,
            r.identity!.id,
            g.id,
          ],
        );
      }
      return one(
        c,
        "UPDATE goods_receipt SET status='APPROVED',approved_by=$2,received_at=now() WHERE id=$1 RETURNING *",
        [g.id, r.identity!.id],
      );
    }),
  );
}
