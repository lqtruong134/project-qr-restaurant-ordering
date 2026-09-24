import { type Connection, one, reject } from '../shared/core-persistence.js';
export async function reserve(
  c: Connection,
  itemId: string,
  product: string,
  quantity: number,
  restaurant: string,
  review: boolean,
) {
  const bomResult = await c.query(
    "SELECT * FROM recipe_bom WHERE product_id=$1 AND status='ACTIVE' AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now()) FOR SHARE",
    [product],
  );
  const bom = bomResult.rows[0];
  if (!bom) reject('Món chưa được thiết lập công thức. Vui lòng chọn món khác hoặc báo nhân viên.');
  const lines = (
    await c.query(
      `SELECT bi.*,ceil((bi.quantity * $2::numeric / $3::numeric * (1+bi.waste_percent/100))*1000000)/1000000 AS needed FROM recipe_bom_item bi WHERE recipe_bom_id=$1 ORDER BY bi.ingredient_id`,
      [bom.id, quantity, bom.yield_quantity],
    )
  ).rows;
  if (!lines.length) reject('Món chưa có định lượng nguyên liệu.');
  for (const line of lines) {
    const balanceResult = await c.query(
      `SELECT b.* FROM inventory_balance b JOIN stock_location l ON l.id=b.location_id JOIN ingredient i ON i.id=b.ingredient_id WHERE b.ingredient_id=$1 AND l.restaurant_id=$2 AND i.restaurant_id=$2 AND l.is_active AND i.is_active AND b.available_qty >= $3::numeric ORDER BY b.location_id LIMIT 1 FOR UPDATE OF b`,
      [line.ingredient_id, restaurant, line.needed],
    );
    const balance = balanceResult.rows[0];
    if (!balance)
      reject(
        'Nguyên liệu không đủ cho số lượng đã chọn. Vui lòng giảm số lượng hoặc chọn món khác.',
      );
    await c.query(
      'UPDATE inventory_balance SET reserved_qty=reserved_qty+$2::numeric,available_qty=available_qty-$2::numeric,version=version+1 WHERE id=$1',
      [balance.id, line.needed],
    );
    await c.query(
      `INSERT INTO inventory_reservation(order_item_id,ingredient_id,location_id,reservation_type,quantity,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now()+interval '10 minutes' ELSE NULL END)`,
      [
        itemId,
        line.ingredient_id,
        balance.location_id,
        review ? 'PROVISIONAL' : 'CONFIRMED',
        line.needed,
        review ? 'PROVISIONAL' : 'ACTIVE',
        review,
      ],
    );
    await c.query(
      `INSERT INTO order_item_ingredient_snapshot(order_item_id,recipe_bom_id,ingredient_id,planned_qty,consumed_qty,unit_cost_snapshot,cogs_value) VALUES($1,$2,$3,$4,0,$5,0)`,
      [itemId, bom.id, line.ingredient_id, line.needed, balance.avg_cost],
    );
  }
}
export async function release(c: Connection, batch: string) {
  const rows = (
    await c.query(
      `SELECT r.* FROM inventory_reservation r JOIN order_item i ON i.id=r.order_item_id WHERE i.order_batch_id=$1 AND r.status IN ('PROVISIONAL','ACTIVE') ORDER BY r.ingredient_id,r.location_id FOR UPDATE OF r`,
      [batch],
    )
  ).rows;
  for (const row of rows) {
    await c.query(
      'UPDATE inventory_balance SET reserved_qty=reserved_qty-$3::numeric,available_qty=available_qty+$3::numeric,version=version+1 WHERE ingredient_id=$1 AND location_id=$2',
      [row.ingredient_id, row.location_id, row.quantity],
    );
    await c.query("UPDATE inventory_reservation SET status='RELEASED' WHERE id=$1", [row.id]);
  }
}
export async function releaseItem(c: Connection, item: string) {
  const rows = (
    await c.query(
      "SELECT * FROM inventory_reservation WHERE order_item_id=$1 AND status IN ('PROVISIONAL','ACTIVE') FOR UPDATE",
      [item],
    )
  ).rows;
  for (const row of rows) {
    await c.query(
      'UPDATE inventory_balance SET reserved_qty=reserved_qty-$2::numeric,available_qty=available_qty+$2::numeric,version=version+1 WHERE ingredient_id=$1 AND location_id=$3',
      [row.ingredient_id, row.quantity, row.location_id],
    );
    await c.query("UPDATE inventory_reservation SET status='RELEASED' WHERE id=$1", [row.id]);
  }
}
export async function consume(c: Connection, item: string, actor: string) {
  const rows = (
    await c.query(
      "SELECT * FROM inventory_reservation WHERE order_item_id=$1 AND status='ACTIVE' ORDER BY ingredient_id,location_id FOR UPDATE",
      [item],
    )
  ).rows;
  if (!rows.length) reject('Không có giữ kho hợp lệ cho dòng món.');
  for (const row of rows) {
    const balance = await one(
      c,
      'SELECT * FROM inventory_balance WHERE ingredient_id=$1 AND location_id=$2 FOR UPDATE',
      [row.ingredient_id, row.location_id],
    );
    await c.query(
      'UPDATE inventory_balance SET on_hand_qty=on_hand_qty-$2::numeric,reserved_qty=reserved_qty-$2::numeric,version=version+1 WHERE id=$1',
      [balance.id, row.quantity],
    );
    await c.query(
      `INSERT INTO inventory_movement(location_id,ingredient_id,movement_type,quantity,unit_cost,value,source_type,created_by,order_item_id) VALUES($1,$2,'CONSUMPTION',-$3::numeric,$4,-round($3::numeric*$4::numeric)::bigint,'ORDER_ITEM',$5,$6)`,
      [row.location_id, row.ingredient_id, row.quantity, balance.avg_cost, actor, item],
    );
    await c.query("UPDATE inventory_reservation SET status='CONSUMED' WHERE id=$1", [row.id]);
    await c.query(
      'UPDATE order_item_ingredient_snapshot SET consumed_qty=$3,unit_cost_snapshot=$4,cogs_value=round($3::numeric*$4::numeric)::bigint WHERE order_item_id=$1 AND ingredient_id=$2',
      [item, row.ingredient_id, row.quantity, balance.avg_cost],
    );
  }
}
