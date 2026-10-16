import type { FastifyInstance } from 'fastify';
import { refreshDependentCombos } from '../catalog/combo.service.js';
import type { Database } from '@thesis/database';
import { receiptNumber } from './receipt-number.js';
import {
  decimal,
  integer,
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
    ingredients: (
      await db.pool.query(
        'SELECT i.*,u.code AS unit_code FROM ingredient i JOIN unit_of_measure u ON u.id=i.base_unit_id WHERE i.restaurant_id=$1 ORDER BY i.name',
        [restaurant],
      )
    ).rows,
    locations: await db.prisma.stock_location.findMany({ where: { restaurant_id: restaurant } }),
    balances: (
      await db.pool.query(
        `SELECT b.*,i.name AS ingredient_name,l.name AS location_name,u.code AS unit FROM inventory_balance b JOIN ingredient i ON i.id=b.ingredient_id JOIN stock_location l ON l.id=b.location_id JOIN unit_of_measure u ON u.id=i.base_unit_id WHERE l.restaurant_id=$1 ORDER BY i.name`,
        [restaurant],
      )
    ).rows,
    movements: (
      await db.pool.query(
        `SELECT m.*,i.name AS ingredient_name,u.code AS unit,l.name AS location_name,a.display_name AS actor_name FROM inventory_movement m JOIN ingredient i ON i.id=m.ingredient_id JOIN unit_of_measure u ON u.id=i.base_unit_id JOIN stock_location l ON l.id=m.location_id LEFT JOIN app_user a ON a.id=m.created_by WHERE l.restaurant_id=$1 ORDER BY m.occurred_at DESC,m.id LIMIT 100`,
        [restaurant],
      )
    ).rows,
    receipts: (
      await db.pool.query(
        `SELECT g.* FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE l.restaurant_id=$1 AND (g.status='DRAFT' OR g.id IN (SELECT x.id FROM goods_receipt x JOIN stock_location y ON y.id=x.location_id WHERE y.restaurant_id=$1 ORDER BY x.created_at DESC LIMIT 100)) ORDER BY g.created_at DESC`,
        [restaurant],
      )
    ).rows,
    recipes: (
      await db.pool.query(
        `SELECT b.* FROM recipe_bom b JOIN product p ON p.id=b.product_id
         WHERE p.restaurant_id=$1 AND b.status='ACTIVE' AND b.effective_from<=now()
         AND (b.effective_to IS NULL OR b.effective_to>now()) ORDER BY p.name`,
        [restaurant],
      )
    ).rows,
    recipeItems: (
      await db.pool.query(
        `SELECT bi.*,i.name AS ingredient_name,u.code AS unit
         FROM recipe_bom_item bi JOIN recipe_bom b ON b.id=bi.recipe_bom_id
         JOIN product p ON p.id=b.product_id JOIN ingredient i ON i.id=bi.ingredient_id
         JOIN unit_of_measure u ON u.id=i.base_unit_id
         WHERE p.restaurant_id=$1 AND b.status='ACTIVE' AND b.effective_from<=now()
         AND (b.effective_to IS NULL OR b.effective_to>now()) ORDER BY i.name`,
        [restaurant],
      )
    ).rows,
  }));

  app.post('/core/inventory/adjustments', { config }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        balanceId = uuid(b.balanceId),
        key = text(b.requestId, 120),
        reason = text(b.reason, 500),
        mode = text(b.mode);
      if (!['COUNT', 'WASTE'].includes(mode)) reject('Chọn kiểm kê hoặc xuất hủy.', 400);
      const quantity = decimal(b.quantity, mode === 'COUNT');
      const balance = await one(
        c,
        `SELECT b.* FROM inventory_balance b JOIN stock_location l ON l.id=b.location_id WHERE b.id=$1 AND l.restaurant_id=$2 AND l.is_active FOR UPDATE OF b`,
        [balanceId, restaurant],
      );
      const replay = (
        await c.query('SELECT * FROM inventory_movement WHERE location_id=$1 AND request_key=$2', [
          balance.location_id,
          key,
        ])
      ).rows[0];
      if (replay) {
        const audit = await one(
          c,
          "SELECT details FROM business_audit_event WHERE resource_id=$1 AND action='ADJUST_STOCK'",
          [replay.id],
        );
        if (
          audit.details.balanceId !== balanceId ||
          audit.details.mode !== mode ||
          audit.details.quantity !== quantity ||
          replay.reason !== reason
        )
          reject('Mã gửi đã dùng cho nội dung khác.');
        return replay;
      }
      if (integer(b.expectedVersion, 1, 2147483647) !== balance.version)
        reject('Tồn kho đã thay đổi. Tải lại và kiểm tra số thực tế trước khi ghi nhận.');
      const computed = await one(
        c,
        `SELECT CASE WHEN $1='COUNT' THEN $2::numeric-$3::numeric ELSE -$2::numeric END AS delta`,
        [mode, quantity, balance.on_hand_qty],
      );
      const check = await one(
        c,
        'SELECT $1::numeric+$2::numeric >= $3::numeric AS valid,$2::numeric=0 AS unchanged',
        [balance.on_hand_qty, computed.delta, balance.reserved_qty],
      );
      if (!check.valid)
        reject(
          'Tồn sau điều chỉnh thấp hơn lượng đang giữ cho món. Xử lý các món/giữ kho liên quan trước.',
        );
      if (check.unchanged) reject('Số kiểm kê bằng tồn hiện tại, không cần điều chỉnh.', 400);
      const movement = await one(
        c,
        `INSERT INTO inventory_movement(location_id,ingredient_id,movement_type,quantity,unit_cost,value,source_type,created_by,request_key,reason) VALUES($1,$2,CASE WHEN $3='WASTE' THEN 'WASTE' WHEN $4::numeric>0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END,$4,$5,sign($4::numeric)*round(abs($4::numeric)*$5::numeric)::bigint,'MANUAL',$6,$7,$8) RETURNING *`,
        [
          balance.location_id,
          balance.ingredient_id,
          mode,
          computed.delta,
          balance.avg_cost,
          r.identity!.id,
          key,
          reason,
        ],
      );
      await c.query(
        'UPDATE inventory_balance SET on_hand_qty=on_hand_qty+$2::numeric,available_qty=available_qty+$2::numeric,version=version+1 WHERE id=$1',
        [balance.id, computed.delta],
      );
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'ADJUST_STOCK','INVENTORY_MOVEMENT',$3,$4,$5)",
        [
          restaurant,
          r.identity!.id,
          movement.id,
          reason,
          JSON.stringify({
            balanceId,
            mode,
            quantity,
            before: balance.on_hand_qty,
            delta: computed.delta,
          }),
        ],
      );
      return movement;
    }),
  );
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
      const product = await one(
        c,
        'SELECT id,product_kind FROM product WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [id, restaurant],
      );
      if (product.product_kind === 'COMBO')
        reject('Công thức combo được cộng từ các món thành phần. Hãy chỉnh công thức món lẻ.', 400);
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
      await refreshDependentCombos(c, id);
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
      if (new Set(b.lines.map((raw) => uuid(object(raw).ingredientId))).size !== b.lines.length)
        reject('Mỗi nguyên liệu chỉ xuất hiện một dòng trong phiếu nhập.', 400);
      const sequence = await one(c, "SELECT nextval('goods_receipt_number_seq')::text AS number");
      const receipt = await one(
        c,
        'INSERT INTO goods_receipt(location_id,receipt_no,total_value,created_by,supplier_name_snapshot,external_reference) VALUES($1,$2,0,$3,$4,$5) RETURNING *',
        [
          b.locationId,
          receiptNumber(sequence.number),
          r.identity!.id,
          b.supplier ? text(b.supplier, 120) : null,
          b.externalReference ? text(b.externalReference, 120) : null,
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
      const created = await one(
        c,
        'UPDATE goods_receipt SET total_value=(SELECT sum(round(base_quantity*unit_cost))::bigint FROM goods_receipt_item WHERE receipt_id=$1) WHERE id=$1 RETURNING *',
        [receipt.id],
      );
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'CREATE_DRAFT_RECEIPT','GOODS_RECEIPT',$3,'Lập phiếu nhập nháp',$4)",
        [
          restaurant,
          r.identity!.id,
          receipt.id,
          JSON.stringify({ after: created, lines: b.lines }),
        ],
      );
      return created;
    }),
  );
  app.get('/core/receipts/:id', { config }, async (r) =>
    transaction(db, async (c) => {
      const g = await one(
        c,
        'SELECT g.*,l.name AS location_name,a.display_name AS created_by_name,b.display_name AS approved_by_name FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id JOIN app_user a ON a.id=g.created_by LEFT JOIN app_user b ON b.id=g.approved_by WHERE g.id=$1 AND l.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      return {
        ...g,
        audit: (
          await c.query(
            "SELECT e.id,e.action,e.reason,e.created_at,u.display_name AS actor_name FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.restaurant_id=$1 AND e.resource_type='GOODS_RECEIPT' AND e.resource_id=$2 ORDER BY e.created_at DESC,e.id DESC",
            [restaurant, g.id],
          )
        ).rows,
        lines: (
          await c.query(
            'SELECT * FROM goods_receipt_item WHERE receipt_id=$1 ORDER BY created_at,id',
            [g.id],
          )
        ).rows,
      };
    }),
  );
  app.patch('/core/receipts/:id', { config }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        g = await one(
          c,
          'SELECT g.* FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE g.id=$1 AND l.restaurant_id=$2 FOR UPDATE OF g',
          [idParam(r), restaurant],
        );
      if (g.status !== 'DRAFT') reject('Chỉ được sửa phiếu nhập nháp.');
      if (b.expectedVersion !== g.version)
        reject('Phiếu đã được sửa ở nơi khác. Hãy tải lại trước khi lưu.');
      const reason = text(b.reason, 500);
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100)
        reject('Cần 1–100 dòng nhập kho.', 400);
      if (new Set(b.lines.map((raw) => uuid(object(raw).ingredientId))).size !== b.lines.length)
        reject('Mỗi nguyên liệu chỉ xuất hiện một dòng trong phiếu nhập.', 400);
      await one(c, 'SELECT id FROM stock_location WHERE id=$1 AND restaurant_id=$2 AND is_active', [
        uuid(b.locationId),
        restaurant,
      ]);
      const previous = (
        await c.query('SELECT * FROM goods_receipt_item WHERE receipt_id=$1', [g.id])
      ).rows;
      await c.query('DELETE FROM goods_receipt_item WHERE receipt_id=$1', [g.id]);
      for (const raw of b.lines) {
        const line = object(raw),
          i = await one(
            c,
            'SELECT * FROM ingredient WHERE id=$1 AND restaurant_id=$2 AND is_active',
            [uuid(line.ingredientId), restaurant],
          );
        await c.query(
          'INSERT INTO goods_receipt_item(receipt_id,ingredient_id,quantity,unit_id,base_quantity,unit_cost) VALUES($1,$2,$3,$4,$3,$5)',
          [g.id, i.id, decimal(line.quantity), i.base_unit_id, decimal(line.unitCost, true)],
        );
      }
      const updated = await one(
        c,
        'UPDATE goods_receipt SET version=version+1,location_id=$2,external_reference=$3,supplier_name_snapshot=$4,total_value=(SELECT sum(round(base_quantity*unit_cost))::bigint FROM goods_receipt_item WHERE receipt_id=$1) WHERE id=$1 RETURNING *',
        [
          g.id,
          b.locationId,
          b.externalReference ? text(b.externalReference, 120) : null,
          b.supplier ? text(b.supplier, 120) : null,
        ],
      );
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'EDIT_DRAFT_RECEIPT','GOODS_RECEIPT',$3,$4,$5)",
        [
          restaurant,
          r.identity!.id,
          g.id,
          reason,
          JSON.stringify({
            before: { ...g, lines: previous },
            after: { ...updated, lines: b.lines },
          }),
        ],
      );
      return updated;
    }),
  );
  app.post('/core/receipts/:id/cancel', { config }, async (r) =>
    transaction(db, async (c) => {
      const reason = text(object(r.body).reason, 500),
        g = await one(
          c,
          'SELECT g.* FROM goods_receipt g JOIN stock_location l ON l.id=g.location_id WHERE g.id=$1 AND l.restaurant_id=$2 FOR UPDATE OF g',
          [idParam(r), restaurant],
        );
      if (g.status === 'CANCELLED') return g;
      if (g.status !== 'DRAFT') reject('Phiếu đã nhập kho không được hủy như phiếu nháp.');
      if (object(r.body).expectedVersion !== g.version)
        reject('Phiếu đã thay đổi. Hãy kiểm tra lại trước khi hủy.');
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason) VALUES($1,$2,'CANCEL_DRAFT_RECEIPT','GOODS_RECEIPT',$3,$4)",
        [restaurant, r.identity!.id, g.id, reason],
      );
      return one(
        c,
        "UPDATE goods_receipt SET version=version+1,status='CANCELLED' WHERE id=$1 RETURNING *",
        [g.id],
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
      if (object(r.body).expectedVersion !== g.version)
        reject('Phiếu đã được sửa ở nơi khác. Hãy kiểm tra lại hàng và tổng tiền trước khi duyệt.');
      await one(c, 'SELECT id FROM stock_location WHERE id=$1 AND is_active', [g.location_id]);
      const items = (
        await c.query(
          'SELECT * FROM goods_receipt_item WHERE receipt_id=$1 ORDER BY ingredient_id',
          [g.id],
        )
      ).rows;
      if (!items.length) reject('Phiếu nhập không có dòng nguyên liệu.', 400);
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
      const approved = await one(
        c,
        "UPDATE goods_receipt SET version=version+1,status='APPROVED',approved_by=$2,received_at=now() WHERE id=$1 RETURNING *",
        [g.id, r.identity!.id],
      );
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'APPROVE_RECEIPT','GOODS_RECEIPT',$3,'Kiểm tra hàng và duyệt nhập kho',$4)",
        [
          restaurant,
          r.identity!.id,
          g.id,
          JSON.stringify({
            receiptNo: g.receipt_no,
            totalValue: g.total_value,
            lineCount: items.length,
          }),
        ],
      );
      return approved;
    }),
  );
}
