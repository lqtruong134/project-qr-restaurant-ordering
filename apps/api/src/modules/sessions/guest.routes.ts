import { readGuestOnlinePayments } from './guest-payment-view.js';
import { readPromotionView } from '../finance/pricing.service.js';
import { recalculate } from '../finance/ledger.service.js';
import { listMenuPromotions, productPromotionField } from '@thesis/database/menu-promotions';
import { accessLimit, codeMatches, sessionAccessCode, qrTable } from './table-access.service.js';
import { assertProductAvailable, comboCatalogFields } from '../catalog/combo.service.js';
import { supportEvent } from '../support/support.service.js';
import { restaurantPolicy } from '@thesis/contracts';
import { withCashPaymentFields } from '../payments/payment-view.service.js';
import { parseReason } from '../orders/reasons.js';
import { readPolicy } from '../risk/policy.service.js';
import { randomUUID } from 'node:crypto';
import { ensureGuestNameAvailable, guestName } from './guest-name.js';
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
  app.get('/guest/policy', { config }, async () => restaurantPolicy);
  app.post('/guest/qr-info', { config }, async (r) => {
    const token = text(object(r.body).token, 128);
    const result = await db.pool.query(
      `SELECT t.name AS table_name,t.code AS table_code,a.name AS area_name,r.name AS restaurant_name,EXISTS(SELECT 1 FROM session_participant p JOIN table_session s ON s.id=p.session_id WHERE s.table_id=t.id AND s.session_status='ACTIVE' AND p.status='ACTIVE' AND p.credential_hash=$3) AS already_joined FROM table_qr_token q JOIN dining_table t ON t.id=q.table_id JOIN dining_area a ON a.id=t.area_id JOIN restaurant r ON r.id=t.restaurant_id WHERE q.token_hash=$1 AND q.status='ACTIVE' AND (q.expires_at IS NULL OR q.expires_at>now()) AND t.restaurant_id=$2 AND t.is_active AND a.is_active AND r.status='ACTIVE'`,
      [
        digest(token),
        restaurant,
        r.cookies.guest && r.cookies.guest.length <= 128 ? digest(r.cookies.guest) : null,
      ],
    );
    if (!result.rows[0])
      reject(
        'Mã QR đã hết hiệu lực hoặc bàn ngừng phục vụ. Vui lòng quét mã hiện tại hoặc liên hệ nhân viên.',
        410,
      );
    return result.rows[0];
  });
  app.patch('/guest/profile', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      const name = guestName(object(r.body).name);
      await ensureGuestNameAvailable(c, p.session_id, name, p.id);
      await c.query('UPDATE session_participant SET display_name=$2 WHERE id=$1', [p.id, name]);
      return { status: 'ok' };
    }),
  );
  app.post('/guest/leave', { config }, async (r, reply) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      await c.query("UPDATE session_participant SET status='LEFT' WHERE id=$1", [p.id]);
      await c.query('DELETE FROM cart_item WHERE owner_participant_id=$1', [p.id]);
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE session_id=$1', [
        p.session_id,
      ]);
      reply.clearCookie('guest', { httpOnly: true, sameSite: 'strict', secure, path: '/' });
      return { status: 'ok' };
    }),
  );
  app.post('/guest/orders/:id/cancel', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body);
      return cancelBatch(
        c,
        uuid(object(r.params).id),
        restaurant,
        { type: 'GUEST', id: p.id },
        parseReason(b, 'GUEST_CANCEL').text,
        parseReason(b, 'GUEST_CANCEL').code,
      );
    }),
  );
  app.post('/guest/join', { config }, async (r, reply) => {
    const visitor =
      r.cookies.table_access && r.cookies.table_access.length <= 128
        ? r.cookies.table_access
        : secret();
    reply.setCookie('table_access', visitor, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: 7200,
    });
    const result = await transaction(db, async (c) => {
      const b = object(r.body),
        token = text(b.token, 128),
        name = guestName(b.name);
      if (b.acceptedPolicyVersion === undefined)
        reject('Vui lòng đọc và đồng ý quy định trước khi tham gia bàn.', 400);
      if (b.acceptedPolicyVersion !== restaurantPolicy.version)
        reject('Quy định đã được cập nhật. Vui lòng tải lại trang và đọc bản mới.', 409);
      const table = await qrTable(c, token, restaurant);
      if (table.table_status === 'NEEDS_CLEANING')
        reject('Bàn đang chờ dọn. Vui lòng liên hệ nhân viên.');
      const s = (
        await c.query(
          "SELECT * FROM table_session WHERE table_id=$1 AND session_status='ACTIVE' FOR UPDATE",
          [table.id],
        )
      ).rows[0];
      if (!s)
        return {
          denied: 'Nhân viên chưa cấp mã cho lượt khách này. Nhấn yêu cầu cấp mã để được hỗ trợ.',
          status: 409,
        };
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
      if (
        !(await accessLimit(c, restaurant, visitor, 'JOIN_VISITOR', 5, false)) ||
        !(await accessLimit(c, restaurant, r.ip, 'JOIN_IP', 20, false))
      )
        return {
          denied: 'Bạn đã nhập sai mã nhiều lần. Vui lòng đợi 5 phút hoặc nhờ nhân viên kiểm tra.',
          status: 429,
        };
      if (!codeMatches(s, b.accessCode) || s.verification_status !== 'VERIFIED') {
        await accessLimit(c, restaurant, visitor, 'JOIN_VISITOR', 5, true);
        await accessLimit(c, restaurant, r.ip, 'JOIN_IP', 20, true);
        return {
          denied:
            'Mã vào bàn chưa đúng. Hỏi nhân viên hoặc người đang ngồi cùng bàn để nhận mã 4 số hiện tại.',
          status: 403,
        };
      }
      await ensureGuestNameAvailable(c, s.id, name);
      const credential = secret();
      const p = await one(
        c,
        'INSERT INTO session_participant(session_id,guest_id,display_name,credential_hash,accepted_policy_version,accepted_policy_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id',
        [s.id, randomUUID(), name, digest(credential), restaurantPolicy.version],
      );
      reply.setCookie('guest', credential, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: '/',
        maxAge: 86400,
      });
      return { sessionId: s.id, participantId: p.id };
    });
    if ('denied' in result) reject(result.denied!, result.status);
    return result;
  });
  app.get('/guest/state', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      const currentSession = await one(
        c,
        'SELECT s.*,t.name AS table_name,t.code AS table_code,a.name AS area_name FROM table_session s JOIN dining_table t ON t.id=s.table_id JOIN dining_area a ON a.id=t.area_id WHERE s.id=$1',
        [p.session_id],
      );
      const { access_code_ciphertext: _ciphertext, ...publicSession } = currentSession;
      void _ciphertext;
      const pricing = await readPromotionView(c, p.session_id, restaurant);
      await recalculate(c, p.session_id);
      return {
        billing: pricing.billing,
        discountPrograms: pricing.programs,
        participant: {
          id: p.id,
          displayName: p.display_name,
          acceptedPolicyVersion: p.accepted_policy_version,
          acceptedPolicyAt: p.accepted_policy_at,
        },
        participants: (
          await c.query(
            "SELECT id,display_name,joined_at FROM session_participant WHERE session_id=$1 AND status IN ('ACTIVE','BLOCKED') ORDER BY joined_at,id",
            [p.session_id],
          )
        ).rows,
        session: { ...publicSession, access_code: sessionAccessCode(currentSession) },
        cart: await one(c, 'SELECT * FROM session_cart WHERE session_id=$1', [p.session_id]),
        items: (
          await c.query(
            `SELECT i.*,p.name,p.product_kind,${comboCatalogFields},p.base_price AS current_price,product_catalog_available(p.id,p.restaurant_id) AS available,sp.display_name AS owner_name FROM cart_item i JOIN product p ON p.id=i.product_id JOIN menu_category mc ON mc.id=p.category_id JOIN session_participant sp ON sp.id=i.owner_participant_id JOIN session_cart c ON c.id=i.cart_id WHERE c.session_id=$1 ORDER BY i.created_at`,
            [p.session_id],
          )
        ).rows,
        promotions: await listMenuPromotions(c, restaurant, true),
        products: (
          await c.query(
            `SELECT p.*,${productPromotionField()} AS image_promotion,c.name AS category_name,${comboCatalogFields},
              CASE WHEN product_catalog_available(p.id,$1) THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END AS availability_status
              FROM product p JOIN menu_category c ON c.id=p.category_id WHERE p.restaurant_id=$1 AND p.is_active AND c.is_active ORDER BY c.sort_order,p.name`,
            [restaurant],
          )
        ).rows,
        orders: (
          await c.query(
            `SELECT b.id,b.status,b.total_amount,b.created_at,b.created_by_participant_id,i.id AS item_id,i.product_name_snapshot,i.product_kind_snapshot,i.combo_components_snapshot,i.quantity,i.unit_price_snapshot,i.status AS item_status,i.cancel_reason AS item_reason,i.cancel_reason_code,i.line_total,i.owner_participant_id,(SELECT display_name FROM session_participant WHERE id=i.owner_participant_id) AS owner_name,i.note,i.ready_at,i.served_at,f.id AS charge_id,f.status AS charge_status,f.amount AS original_amount,f.discount_amount,(f.amount-f.discount_amount)::text AS net_amount,f.tax_snapshot, COALESCE((SELECT sum(allocated_amount-reversed_amount) FROM payment_allocation WHERE financial_charge_id=f.id),0)::text AS paid_amount,
              EXISTS(SELECT 1 FROM business_audit_event e JOIN operational_alert a ON a.id=(e.details->>'alertId')::uuid WHERE e.resource_id=i.id AND e.action='KITCHEN_ISSUE_REPORTED' AND a.status<>'RESOLVED') AS awaiting_admin,
              (SELECT e.reason FROM business_audit_event e WHERE e.resource_id=i.id AND e.action IN ('WAIVE_ITEM','RESTAURANT_FAULT_CONFIRMED') ORDER BY e.created_at DESC LIMIT 1) AS finance_reason,
    (SELECT e.details->>'reasonCode' FROM business_audit_event e WHERE e.resource_id=i.id AND e.action IN ('WAIVE_ITEM','RESTAURANT_FAULT_CONFIRMED') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS finance_reason_code
              FROM order_batch b JOIN order_item i ON i.order_batch_id=b.id LEFT JOIN financial_charge f ON f.order_item_id=i.id AND f.charge_type='ITEM' WHERE b.session_id=$1 ORDER BY b.created_at DESC`,
            [p.session_id],
          )
        ).rows,
        support: (
          await c.query(
            "SELECT id,request_type,payment_method,content,status,created_at,acknowledged_at,resolved_at,replaces_request_id, GREATEST(created_at,COALESCE(acknowledged_at,created_at))+CASE WHEN status='ACKNOWLEDGED' THEN interval '180 seconds' ELSE interval '60 seconds' END AS retry_at, NOT EXISTS(SELECT 1 FROM payment_intent pi WHERE pi.support_request_id=support_request.id AND pi.status IN ('CREATED','PENDING') AND pi.expires_at>now()) AS can_retry FROM support_request WHERE session_id=$1 AND participant_id=$2 ORDER BY (status IN ('NEW','ACKNOWLEDGED')) DESC,created_at DESC LIMIT 20",
            [p.session_id, p.id],
          )
        ).rows,
        onlinePayments: await readGuestOnlinePayments(c, p.session_id, p.id, restaurant),
        payments: (
          await c.query(
            `SELECT p.id,p.method,p.amount::text,p.status,
              CASE WHEN p.method='CASH' THEN jsonb_build_object(
                'cashReceived',p.metadata->'cashReceived',
                'changeGiven',p.metadata->'changeGiven',
                'cashHandlingVersion',p.metadata->'cashHandlingVersion'
              ) ELSE '{}'::jsonb END AS metadata,
              (SELECT e.created_at FROM business_audit_event e
                WHERE e.resource_id=p.id AND e.action='CASH_CHANGE_RETURNED'
                ORDER BY e.created_at LIMIT 1) AS change_returned_at
             FROM payment_transaction p WHERE p.session_id=$1 AND p.status='SUCCEEDED'
             ORDER BY p.created_at DESC,p.id`,
            [p.session_id],
          )
        ).rows.map((payment) => withCashPaymentFields(payment)),
        refundTransactions: (
          await c.query(
            "SELECT t.id,t.method,t.amount::text,t.processed_at FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=$1 AND t.status='SUCCEEDED' ORDER BY t.processed_at DESC,t.id",
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
      await assertProductAvailable(c, product.id, restaurant);
      const item = await one(
        c,
        'INSERT INTO cart_item(cart_id,owner_participant_id,product_id,quantity,note,unit_price_preview,product_version_preview) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          cart.id,
          p.id,
          product.id,
          integer(
            b.quantity,
            1,
            Math.min(99, Number((await readPolicy(c, restaurant)).policy.LINE_QTY_HARD_LIMIT)),
          ),
          b.note ? text(b.note, 300) : null,
          product.base_price,
          product.version,
        ],
      );
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return item;
    }),
  );
  app.delete('/guest/cart', { config }, async (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body);
      const cart = await one(c, 'SELECT * FROM session_cart WHERE session_id=$1 FOR UPDATE', [
        p.session_id,
      ]);
      if (cart.cart_version !== integer(b.cartVersion, 1, 2147483646))
        reject('Giỏ đã thay đổi. Vui lòng kiểm tra lại các món trước khi xóa.', 409);
      if (!Array.isArray(b.itemIds) || !b.itemIds.length) reject('Chọn món cần xóa khỏi giỏ.', 400);
      const ids = b.itemIds.map(uuid);
      if (new Set(ids).size !== ids.length) reject('Dòng món bị lặp.', 400);
      const deleted = await c.query(
        'DELETE FROM cart_item WHERE cart_id=$1 AND owner_participant_id=$2 AND id=ANY($3::uuid[]) RETURNING id',
        [cart.id, p.id, ids],
      );
      if (deleted.rowCount !== ids.length)
        reject('Chỉ được xóa các món của bạn đang còn trong giỏ. Giỏ đã được giữ nguyên.', 403);
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return { removedCount: deleted.rowCount };
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
      if (b.quantity === 0) {
        await one(
          c,
          'DELETE FROM cart_item WHERE id=$1 AND cart_id=$2 AND owner_participant_id=$3 RETURNING id',
          [id, cart.id, p.id],
        );
        await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
        return { status: 'removed' };
      }
      const item = await one(
        c,
        `UPDATE cart_item i SET quantity=$1,note=$2,unit_price_preview=p.base_price,product_version_preview=p.version FROM product p WHERE i.product_id=p.id AND i.id=$3 AND i.cart_id=$4 AND i.owner_participant_id=$5 AND p.is_active AND EXISTS(SELECT 1 FROM menu_category mc WHERE mc.id=p.category_id AND mc.is_active) AND p.availability_status='AVAILABLE' RETURNING i.*`,
        [
          integer(
            b.quantity,
            1,
            Math.min(99, Number((await readPolicy(c, restaurant)).policy.LINE_QTY_HARD_LIMIT)),
          ),
          b.note ? text(b.note, 300) : null,
          id,
          cart.id,
          p.id,
        ],
      );
      await assertProductAvailable(c, item.product_id, restaurant);
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cart.id]);
      return item;
    }),
  );
  app.post('/guest/support', { config }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant),
        b = object(r.body),
        type = text(b.type);
      if (!['ASSISTANCE', 'WATER', 'UTENSILS', 'BILL', 'OTHER'].includes(type))
        reject('Loại hỗ trợ không hợp lệ.', 400);
      const content = b.content == null || b.content === '' ? null : text(b.content, 300);
      if (type === 'OTHER' && !content) reject('Vui lòng nhập nội dung cho yêu cầu khác.', 400);
      const existing = (
        await c.query(
          "SELECT id,request_type,payment_method,content,status,created_at,resolved_at FROM support_request WHERE session_id=$1 AND participant_id=$2 AND request_type=$3 AND status IN ('NEW','ACKNOWLEDGED')",
          [p.session_id, p.id, type],
        )
      ).rows[0];
      if (existing) return { ...existing, reused: true };
      const created = await one(
        c,
        'INSERT INTO support_request(session_id,participant_id,request_type,content) VALUES($1,$2,$3,$4) RETURNING id,request_type,content,status,created_at,resolved_at',
        [p.session_id, p.id, type, content],
      );
      await supportEvent(
        c,
        { ...created, session_id: p.session_id, participant_id: p.id },
        'SUPPORT_REQUEST_CREATED',
        null,
      );
      return { ...created, reused: false };
    }),
  );
}
