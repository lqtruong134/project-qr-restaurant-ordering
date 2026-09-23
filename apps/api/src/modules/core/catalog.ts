import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  integer,
  money,
  object,
  one,
  reject,
  secret,
  digest,
  text,
  transaction,
  uuid,
} from './common.js';
export function registerCatalog(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { permission: 'admin.workspace' };
  for (const [path, table] of [
    ['categories', 'menu_category'],
    ['areas', 'dining_area'],
  ] as const) {
    app.patch('/core/' + path + '/:id', { config: admin }, async (r) =>
      transaction(db, async (c) => {
        const b = object(r.body);
        if (typeof b.active !== 'boolean') reject('Trạng thái không hợp lệ.', 400);
        return one(
          c,
          `UPDATE ${table} SET name=$1,sort_order=$2,is_active=$3 WHERE id=$4 AND restaurant_id=$5 RETURNING *`,
          [text(b.name, 120), integer(b.sortOrder, 0, 10000), b.active, idParam(r), restaurant],
        );
      }),
    );
  }
  app.patch('/core/tables/:id', { config: admin }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        id = idParam(r);
      if (typeof b.active !== 'boolean') reject('Trạng thái không hợp lệ.', 400);
      await one(c, 'SELECT id FROM dining_table WHERE id=$1 AND restaurant_id=$2 FOR UPDATE', [
        id,
        restaurant,
      ]);
      if (
        !b.active &&
        (
          await c.query(
            "SELECT id FROM table_session WHERE table_id=$1 AND session_status='ACTIVE'",
            [id],
          )
        ).rowCount
      )
        reject('Không ngừng sử dụng bàn đang có khách.');
      await one(c, 'SELECT id FROM dining_area WHERE id=$1 AND restaurant_id=$2 AND is_active', [
        uuid(b.areaId),
        restaurant,
      ]);
      return one(
        c,
        'UPDATE dining_table SET name=$1,area_id=$2,capacity=$3,is_active=$4,version=version+1 WHERE id=$5 AND version=$6 RETURNING *',
        [
          text(b.name, 100),
          b.areaId,
          integer(b.capacity, 1, 30),
          b.active,
          id,
          integer(b.version, 1, 2147483646),
        ],
      );
    }),
  );
  app.get('/core/catalog', { config: { authenticated: true } }, async () => ({
    categories: await db.prisma.menu_category.findMany({
      where: { restaurant_id: restaurant },
      orderBy: { sort_order: 'asc' },
    }),
    products: (
      await db.prisma.product.findMany({
        where: { restaurant_id: restaurant },
        orderBy: { name: 'asc' },
      })
    ).map((p) => ({ ...p, base_price: p.base_price.toString() })),
  }));
  app.post('/core/categories', { config: admin }, async (r) => {
    const b = object(r.body);
    return db.prisma.menu_category.create({
      data: { restaurant_id: restaurant, code: text(b.code, 40), name: text(b.name, 120) },
    });
  });
  app.post('/core/products', { config: admin }, async (r) => {
    const b = object(r.body);
    return transaction(db, async (c) => {
      await one(c, 'SELECT id FROM menu_category WHERE id=$1 AND restaurant_id=$2 AND is_active', [
        uuid(b.categoryId),
        restaurant,
      ]);
      return one(
        c,
        `INSERT INTO product(restaurant_id,category_id,code,name,base_price) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [restaurant, b.categoryId, text(b.code, 40), text(b.name, 120), money(b.price, true)],
      );
    });
  });
  app.patch('/core/products/:id', { config: admin }, async (r) => {
    const b = object(r.body),
      id = idParam(r);
    const active = b.active;
    if (typeof active !== 'boolean') reject('Trạng thái không hợp lệ.', 400);
    const availability = text(b.availability);
    if (!['AVAILABLE', 'UNAVAILABLE'].includes(availability))
      reject('Trạng thái món không hợp lệ.', 400);
    return transaction(db, (c) =>
      one(
        c,
        `UPDATE product SET name=$1,base_price=$2,is_active=$3,availability_status=$4,version=version+1 WHERE id=$5 AND restaurant_id=$6 AND version=$7 RETURNING *`,
        [
          text(b.name, 120),
          money(b.price, true),
          active,
          availability,
          id,
          restaurant,
          integer(b.version, 1, 2147483646),
        ],
      ),
    );
  });
  app.get('/core/tables', { config: { permission: 'staff.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT t.*,a.name AS area_name,s.id AS session_id,s.verification_status,s.financial_status FROM dining_table t JOIN dining_area a ON a.id=t.area_id LEFT JOIN table_session s ON s.table_id=t.id AND s.session_status='ACTIVE' WHERE t.restaurant_id=$1 ORDER BY a.sort_order,t.code`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.get('/core/admin/tables', { config: admin }, async () =>
    db.pool
      .query('SELECT * FROM dining_table WHERE restaurant_id=$1 ORDER BY code', [restaurant])
      .then((v) => v.rows),
  );
  app.get('/core/areas', { config: admin }, async () =>
    db.prisma.dining_area.findMany({ where: { restaurant_id: restaurant } }),
  );
  app.post('/core/areas', { config: admin }, async (r) => {
    const b = object(r.body);
    return db.prisma.dining_area.create({
      data: { restaurant_id: restaurant, code: text(b.code, 40), name: text(b.name, 100) },
    });
  });
  app.post('/core/tables', { config: admin }, async (r) => {
    const b = object(r.body);
    return transaction(db, async (c) => {
      await one(c, 'SELECT id FROM dining_area WHERE id=$1 AND restaurant_id=$2 AND is_active', [
        uuid(b.areaId),
        restaurant,
      ]);
      return one(
        c,
        `INSERT INTO dining_table(restaurant_id,area_id,code,name,capacity) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [restaurant, b.areaId, text(b.code, 40), text(b.name, 100), integer(b.capacity, 1, 30)],
      );
    });
  });
  app.post('/core/tables/:id/qr', { config: admin }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r);
      await one(
        c,
        'SELECT id FROM dining_table WHERE id=$1 AND restaurant_id=$2 AND is_active FOR UPDATE',
        [id, restaurant],
      );
      await c.query(
        "UPDATE table_qr_token SET status='REVOKED',revoked_at=now() WHERE table_id=$1 AND status='ACTIVE'",
        [id],
      );
      const token = secret();
      await c.query(
        `INSERT INTO table_qr_token(table_id,token_hash,version_no) SELECT $1,$2,COALESCE(max(version_no),0)+1 FROM table_qr_token WHERE table_id=$1`,
        [id, digest(token)],
      );
      return { joinPath: '/guest#' + token };
    }),
  );
}
