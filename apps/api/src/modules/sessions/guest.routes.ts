import { randomUUID } from 'node:crypto';
import { cancelBatch } from '../orders/cancellation.service.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  digest,
  guest,
  integer,
  object,
  one,
  reject,
  secret,
  text,
  transaction,
  uuid,
} from '../shared/core-persistence.js';
export function registerGuest(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  secure: boolean,
) {
  const config = { public: true };
  app.post('/guest/orders/:id/cancel', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body);
      return cancelBatch(
        c,
        uuid(object(r.params).id),
        restaurant,
        { type: 'GUEST', id: p.id },
        text(b.reason, 300),
      );
    }),
  );
  app.post('/guest/join', { config }, async (r, reply) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        token = text(b.token, 128),
        name = text(b.name, 80);
      const table = await one(
        c,
        `SELECT t.* FROM table_qr_token q JOIN dining_table t ON t.id=q.table_id JOIN dining_area a ON a.id=t.area_id JOIN restaurant r ON r.id=t.restaurant_id WHERE q.token_hash=$1 AND q.status='ACTIVE' AND (q.expires_at IS NULL OR q.expires_at>now()) AND t.restaurant_id=$2 AND t.is_active AND a.is_active AND r.status='ACTIVE' FOR UPDATE OF t`,
        [digest(token), restaurant],
      );
      if (table.table_status === 'NEEDS_CLEANING')
        reject('Bàn đang chờ dọn. Vui lòng liên hệ nhân viên.');
      let s = (
        await c.query(
          "SELECT * FROM table_session WHERE table_id=$1 AND session_status='ACTIVE' FOR UPDATE",
          [table.id],
        )
      ).rows[0];
      if (!s) {
        s = await one(c, 'INSERT INTO table_session(table_id) VALUES($1) RETURNING *', [table.id]);
        await c.query(
          "UPDATE dining_table SET table_status='OCCUPIED',version=version+1 WHERE id=$1",
          [table.id],
        );
      }
      await c.query(
        'INSERT INTO session_cart(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',
        [s.id],
      );
      await c.query(
        'INSERT INTO session_financial_account(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',
        [s.id],
      );
      const old = r.cookies.guest;
      if (old && old.length <= 128) {
        const p = (
          await c.query(
            "SELECT id FROM session_participant WHERE session_id=$1 AND credential_hash=$2 AND status='ACTIVE'",
            [s.id, digest(old)],
          )
        ).rows[0];
        if (p) return { sessionId: s.id, participantId: p.id };
      }
      const credential = secret();
      const p = await one(
        c,
        'INSERT INTO session_participant(session_id,guest_id,display_name,credential_hash) VALUES($1,$2,$3,$4) RETURNING id',
        [s.id, randomUUID(), name, digest(credential)],
      );
      reply.setCookie('guest', credential, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
        maxAge: 86400,
      });
      return { sessionId: s.id, participantId: p.id };
    }),
  );
  app.get('/guest/state', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      return {
        participant: { id: p.id, displayName: p.display_name },
        session: await one(
          c,
          'SELECT s.*,t.name AS table_name FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=$1',
          [p.session_id],
        ),
        cart: await one(c, 'SELECT * FROM session_cart WHERE session_id=$1', [p.session_id]),
        items: (
          await c.query(
            `SELECT i.*,p.name FROM cart_item i JOIN product p ON p.id=i.product_id JOIN session_cart c ON c.id=i.cart_id WHERE c.session_id=$1 ORDER BY i.created_at`,
            [p.session_id],
          )
        ).rows,
        products: (
          await c.query(
            `SELECT p.*,c.name AS category_name FROM product p JOIN menu_category c ON c.id=p.category_id WHERE p.restaurant_id=$1 AND p.is_active AND c.is_active ORDER BY c.sort_order,p.name`,
            [restaurant],
          )
        ).rows,
        orders: (
          await c.query(
            'SELECT b.id,b.status,b.total_amount,b.created_at,b.created_by_participant_id,i.id AS item_id,i.product_name_snapshot,i.quantity,i.unit_price_snapshot,i.status AS item_status FROM order_batch b JOIN order_item i ON i.order_batch_id=b.id WHERE b.session_id=$1 ORDER BY b.created_at DESC',
            [p.session_id],
          )
        ).rows,
        support: (
          await c.query(
            'SELECT id,request_type,status,created_at FROM support_request WHERE session_id=$1 ORDER BY created_at DESC LIMIT 10',
            [p.session_id],
          )
        ).rows,
        account:
          (
            await c.query('SELECT * FROM session_financial_account WHERE session_id=$1', [
              p.session_id,
            ])
          ).rows[0] ?? null,
      };
    }),
  );
  app.post('/guest/cart', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body);
      const cart = await one(c, 'SELECT * FROM session_cart WHERE session_id=$1 FOR UPDATE', [
        p.session_id,
      ]);
      if (cart.cart_version !== integer(b.cartVersion, 1, 2147483646))
        reject('Giỏ đã thay đổi. Vui lòng tải lại.');
      const product = await one(
        c,
        `SELECT p.* FROM product p JOIN menu_category c ON c.id=p.category_id WHERE p.id=$1 AND p.restaurant_id=$2 AND p.is_active AND c.is_active AND p.availability_status='AVAILABLE' FOR SHARE OF p`,
        [uuid(b.productId), restaurant],
      );
      const item = await one(
        c,
        'INSERT INTO cart_item(cart_id,owner_participant_id,product_id,quantity,note,unit_price_preview) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          cart.id,
          p.id,
          product.id,
          integer(b.quantity),
          b.note ? text(b.note, 300) : null,
          product.base_price,
        ],
      );
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return item;
    }),
  );
  app.delete('/guest/cart/:id', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body),
        id = uuid(object(r.params).id);
      const cart = await one(c, 'SELECT * FROM session_cart WHERE session_id=$1 FOR UPDATE', [
        p.session_id,
      ]);
      if (cart.cart_version !== integer(b.cartVersion, 1, 2147483646)) reject('Giỏ đã thay đổi.');
      await one(
        c,
        'DELETE FROM cart_item WHERE id=$1 AND cart_id=$2 AND owner_participant_id=$3 RETURNING id',
        [id, cart.id, p.id],
      );
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return { status: 'ok' };
    }),
  );
  app.patch('/guest/cart/:id', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body),
        id = uuid(object(r.params).id);
      const cart = await one(c, 'SELECT * FROM session_cart WHERE session_id=$1 FOR UPDATE', [
        p.session_id,
      ]);
      if (cart.cart_version !== integer(b.cartVersion, 1, 2147483646))
        reject('Giỏ đã thay đổi. Vui lòng tải lại.');
      const item = await one(
        c,
        `UPDATE cart_item i SET quantity=$1,note=$2,unit_price_preview=p.base_price FROM product p WHERE i.product_id=p.id AND i.id=$3 AND i.cart_id=$4 AND i.owner_participant_id=$5 AND p.is_active AND EXISTS(SELECT 1 FROM menu_category mc WHERE mc.id=p.category_id AND mc.is_active) AND p.availability_status='AVAILABLE' RETURNING i.*`,
        [integer(b.quantity), b.note ? text(b.note, 300) : null, id, cart.id, p.id],
      );
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return item;
    }),
  );
  app.post('/guest/support', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body),
        type = text(b.type);
      if (!['ASSISTANCE', 'WATER', 'UTENSILS', 'BILL', 'OTHER'].includes(type))
        reject('Loại yêu cầu không hợp lệ.', 400);
      const pending = (
        await c.query(
          "SELECT * FROM support_request WHERE session_id=$1 AND participant_id=$2 AND request_type=$3 AND status IN ('NEW','ACKNOWLEDGED')",
          [p.session_id, p.id, type],
        )
      ).rows[0];
      return (
        pending ??
        one(
          c,
          'INSERT INTO support_request(session_id,participant_id,request_type,content) VALUES($1,$2,$3,$4) RETURNING *',
          [p.session_id, p.id, type, b.content ? text(b.content, 300) : null],
        )
      );
    }),
  );
}
