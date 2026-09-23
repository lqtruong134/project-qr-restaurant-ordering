import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  type Actor,
  type Connection,
  digest,
  event,
  guest,
  history,
  idParam,
  integer,
  object,
  one,
  reject,
  session,
  text,
  transaction,
  uuid,
} from './common.js';
import { consume, release, reserve } from './inventory.js';
export async function idempotent(
  c: Connection,
  actor: Actor,
  scope: string,
  key: string,
  body: unknown,
  resource: 'ORDER_BATCH' | 'PAYMENT_INTENT',
  fn: () => Promise<{ id: string }>,
) {
  const hash = digest(JSON.stringify(body));
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    scope + ':' + actor.type + ':' + actor.id + ':' + key,
  ]);
  const old = (
    await c.query(
      'SELECT * FROM idempotency_record WHERE scope=$1 AND actor_type=$2 AND idempotency_key=$3 AND (actor_user_id=$4 OR actor_participant_id=$4)',
      [scope, actor.type, key, actor.id],
    )
  ).rows[0];
  if (old) {
    if (old.request_hash !== hash) reject('Mã gửi lại đã dùng cho nội dung khác.');
    if (old.status === 'SUCCEEDED') return old.response_snapshot;
    reject('Yêu cầu đang được xử lý.');
  }
  const record = await one(
    c,
    `INSERT INTO idempotency_record(scope,idempotency_key,request_hash,resource_type,expires_at,actor_type,actor_user_id,actor_participant_id) VALUES($1,$2,$3,$4,now()+interval '7 days',$5,$6,$7) RETURNING id`,
    [
      scope,
      key,
      hash,
      resource,
      actor.type,
      actor.type === 'USER' ? actor.id : null,
      actor.type === 'GUEST' ? actor.id : null,
    ],
  );
  const result = await fn();
  const column = resource === 'ORDER_BATCH' ? 'order_batch_id' : 'payment_intent_id';
  await c.query(
    `UPDATE idempotency_record SET status='SUCCEEDED',${column}=$2,response_snapshot=$3::jsonb WHERE id=$1`,
    [record.id, result.id, JSON.stringify(result)],
  );
  return result;
}
export async function addCharges(c: Connection, batch: string, sid: string) {
  await c.query(
    `INSERT INTO financial_charge(session_id,order_item_id,charge_type,amount) SELECT $2,id,'ITEM',line_total FROM order_item WHERE order_batch_id=$1 AND status<>'CANCELLED' ON CONFLICT DO NOTHING`,
    [batch, sid],
  );
  await recalculate(c, sid);
}
export async function recalculate(c: Connection, sid: string) {
  await c.query(
    'INSERT INTO session_financial_account(session_id) VALUES($1) ON CONFLICT(session_id) DO NOTHING',
    [sid],
  );
  await c.query(
    `UPDATE session_financial_account SET charge_total=(SELECT COALESCE(sum(amount),0) FROM financial_charge WHERE session_id=$1 AND status='ACTIVE'),paid_total=(SELECT COALESCE(sum(amount),0) FROM payment_transaction WHERE session_id=$1 AND status='SUCCEEDED'),refunded_total=(SELECT COALESCE(sum(t.amount),0) FROM refund_transaction t JOIN refund_case f ON f.id=t.refund_case_id WHERE f.session_id=$1 AND t.status='SUCCEEDED'),reserved_payment_amount=(SELECT COALESCE(sum(amount),0) FROM payment_intent WHERE session_id=$1 AND status IN ('CREATED','PENDING') AND expires_at>now()),version=version+1 WHERE session_id=$1`,
    [sid],
  );
  const a = await one(
    c,
    'UPDATE session_financial_account SET outstanding_amount=greatest(charge_total-paid_total+refunded_total,0),refund_due_amount=greatest(paid_total-refunded_total-charge_total,0) WHERE session_id=$1 RETURNING *',
    [sid],
  );
  const status =
    BigInt(a.refund_due_amount) > 0n
      ? 'REFUND_DUE'
      : BigInt(a.outstanding_amount) === 0n
        ? 'SETTLED'
        : BigInt(a.paid_total) > 0n
          ? 'PARTIALLY_PAID'
          : 'UNPAID';
  await c.query(
    "UPDATE table_session SET financial_status=$2 WHERE id=$1 AND financial_status<>'OUTSTANDING_EXCEPTION'",
    [sid, status],
  );
  return a;
}
async function submit(
  c: Connection,
  sid: string,
  restaurant: string,
  actor: Actor,
  b: Record<string, unknown>,
) {
  const s = await session(c, sid, restaurant);
  if (s.verification_status === 'SUSPENDED' || s.risk_status === 'BLOCKED')
    reject('Phiên đang tạm ngừng nhận món.', 403);
  const key = text(b.requestId, 100);
  return idempotent(c, actor, 'order:' + sid, key, b, 'ORDER_BATCH', async () => {
    let requested: Record<string, unknown>[] = [];
    let cartId: string | undefined;
    if (actor.type === 'GUEST') {
      const cart = await one(c, 'SELECT * FROM session_cart WHERE session_id=$1 FOR UPDATE', [sid]);
      cartId = cart.id;
      if (cart.cart_version !== integer(b.cartVersion, 1, 2147483646))
        reject('Giỏ đã thay đổi. Vui lòng tải lại.');
      if (!Array.isArray(b.itemIds) || !b.itemIds.length || b.itemIds.length > 50)
        reject('Chọn 1–50 dòng món.', 400);
      const ids = b.itemIds.map(uuid);
      if (new Set(ids).size !== ids.length) reject('Dòng món bị lặp.', 400);
      requested = (
        await c.query(
          'SELECT product_id AS "productId",quantity,note,unit_price_preview AS price,id FROM cart_item WHERE cart_id=$1 AND owner_participant_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE',
          [cart.id, actor.id, ids],
        )
      ).rows;
      if (requested.length !== ids.length) reject('Chỉ được gửi các dòng món của bạn.', 403);
    } else {
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50)
        reject('Cần 1–50 dòng món.', 400);
      requested = b.lines.map(object);
    }
    const lines = [];
    let total = 0n,
      qty = 0;
    for (const row of requested) {
      const p = await one(
        c,
        `SELECT p.* FROM product p JOIN menu_category m ON m.id=p.category_id WHERE p.id=$1 AND p.restaurant_id=$2 AND p.is_active AND m.is_active AND p.availability_status='AVAILABLE' FOR SHARE OF p`,
        [uuid(row.productId), restaurant],
      );
      const quantity = integer(row.quantity, 1, 100);
      const amount = BigInt(p.base_price) * BigInt(quantity);
      if (actor.type === 'GUEST' && String(row.price) !== String(p.base_price))
        reject('Giá món đã thay đổi. Vui lòng chọn lại món với giá mới.');
      total += amount;
      qty += quantity;
      lines.push({
        product: p,
        quantity,
        amount: amount.toString(),
        note: row.note ? text(row.note, 300) : null,
      });
    }
    const settings = (
      await c.query(
        'SELECT DISTINCT ON(config_key) config_key,value_json,version_no FROM risk_policy_config WHERE restaurant_id=$1 AND effective_from<=now() ORDER BY config_key,version_no DESC',
        [restaurant],
      )
    ).rows;
    const policy: Record<string, unknown> = {
      FIRST_ORDER_REVIEW_ENABLED: true,
      LINE_QTY_REVIEW: 5,
      LINE_QTY_HARD_LIMIT: 20,
      ORDER_TOTAL_QTY_REVIEW: 15,
      ORDER_TOTAL_QTY_HARD_LIMIT: 50,
      ORDER_AMOUNT_REVIEW_VND: 2000000,
      ORDER_AMOUNT_HARD_LIMIT_VND: 10000000,
      SESSION_AMOUNT_REVIEW_VND: 5000000,
    };
    for (const setting of settings) policy[setting.config_key] = setting.value_json;
    const reasons: string[] = [];
    if (actor.type === 'GUEST') {
      if (
        qty > Number(policy.ORDER_TOTAL_QTY_HARD_LIMIT) ||
        total > BigInt(String(policy.ORDER_AMOUNT_HARD_LIMIT_VND)) ||
        lines.some((l) => l.quantity > Number(policy.LINE_QTY_HARD_LIMIT))
      )
        reject('Lượt gọi vượt giới hạn. Vui lòng nhờ nhân viên hỗ trợ.', 400);
      const metrics = await one(
        c,
        `SELECT count(*) FILTER(WHERE status NOT IN ('REJECTED','CANCELLED','PENDING_REVIEW'))::int AS count,COALESCE(sum(total_amount) FILTER(WHERE status NOT IN ('REJECTED','CANCELLED')),0) AS total,max(created_at) AS last FROM order_batch WHERE session_id=$1`,
        [sid],
      );
      if (
        policy.FIRST_ORDER_REVIEW_ENABLED &&
        s.verification_status === 'UNVERIFIED' &&
        metrics.count === 0
      )
        reasons.push('FIRST_UNVERIFIED_ORDER');
      if (qty >= Number(policy.ORDER_TOTAL_QTY_REVIEW)) reasons.push('QUANTITY');
      if (lines.some((l) => l.quantity >= Number(policy.LINE_QTY_REVIEW)))
        reasons.push('LINE_QUANTITY');
      if (total >= BigInt(String(policy.ORDER_AMOUNT_REVIEW_VND))) reasons.push('ORDER_AMOUNT');
      if (total + BigInt(metrics.total) >= BigInt(String(policy.SESSION_AMOUNT_REVIEW_VND)))
        reasons.push('SESSION_AMOUNT');
      const recent = await one(
        c,
        `SELECT count(*)::int AS count,count(*) FILTER(WHERE created_at>now()-interval '60 seconds')::int AS minute,max(created_at) AS last FROM order_batch WHERE created_by_participant_id=$1 AND created_at>now()-interval '5 minutes'`,
        [actor.id],
      );
      if (recent.last && Date.now() - new Date(recent.last).getTime() < 3000)
        reject('Vui lòng chờ ít nhất 3 giây giữa hai lượt gửi.', 429);
      if (recent.count >= 5)
        throw Object.assign(new Error('Quá nhiều lượt gọi trong 5 phút.'), { blockGuest: true });
      if (recent.minute >= 2) reasons.push('GUEST_RATE');
      const sessionRate = await one(
        c,
        "SELECT count(*)::int AS n FROM order_batch WHERE session_id=$1 AND created_at>now()-interval '60 seconds'",
        [sid],
      );
      if (sessionRate.n >= 7) reasons.push('SESSION_RATE');
      const duplicate = await c.query(
        `SELECT b.id FROM order_batch b WHERE b.session_id=$1 AND b.created_by_participant_id=$2 AND b.created_at>now()-interval '120 seconds' AND b.status NOT IN ('REJECTED','CANCELLED') AND (SELECT jsonb_agg(jsonb_build_object('id',i.product_id,'qty',i.quantity) ORDER BY i.product_id,i.quantity) FROM order_item i WHERE i.order_batch_id=b.id)=$3::jsonb`,
        [
          sid,
          actor.id,
          JSON.stringify(
            lines
              .map((l) => ({ id: l.product.id, qty: l.quantity }))
              .sort((a, b) => a.id.localeCompare(b.id) || a.qty - b.qty),
          ),
        ],
      );
      if (duplicate.rowCount) reasons.push('DUPLICATE_CONTENT');
    }
    const review = reasons.length > 0,
      status = review ? 'PENDING_REVIEW' : 'SUBMITTED';
    const batch = await one(
      c,
      `INSERT INTO order_batch(session_id,created_by_type,created_by_user_id,created_by_participant_id,client_request_id,status,subtotal,total_amount,risk_decision,config_version,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,now()) RETURNING *`,
      [
        sid,
        actor.type,
        actor.type === 'USER' ? actor.id : null,
        actor.type === 'GUEST' ? actor.id : null,
        key,
        status,
        total.toString(),
        review ? 'REVIEW' : 'ALLOW',
        Math.max(1, ...settings.map((v) => Number(v.version_no))),
      ],
    );
    for (const l of lines) {
      const item = await one(
        c,
        `INSERT INTO order_item(order_batch_id,owner_participant_id,product_id,product_name_snapshot,quantity,unit_price_snapshot,line_total,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          batch.id,
          actor.type === 'GUEST' ? actor.id : null,
          l.product.id,
          l.product.name,
          l.quantity,
          l.product.base_price,
          l.amount,
          l.note,
        ],
      );
      await reserve(c, item.id, l.product.id, l.quantity, restaurant, review);
    }
    await c.query(
      `INSERT INTO order_risk_assessment(order_batch_id,decision,metric_snapshot,reason_codes,config_version,config_snapshot) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        batch.id,
        review ? 'REVIEW' : 'ALLOW',
        JSON.stringify({ quantity: qty, amount: total.toString() }),
        JSON.stringify(reasons),
        batch.config_version,
        JSON.stringify(policy),
      ],
    );
    if (review)
      await c.query(
        "INSERT INTO order_review(order_batch_id,expires_at) VALUES($1,now()+interval '10 minutes')",
        [batch.id],
      );
    else await addCharges(c, batch.id, sid);
    await history(c, batch.id, null, null, status, actor);
    await event(c, batch.id, review ? 'ORDER_REVIEW_REQUESTED' : 'ORDER_SUBMITTED');
    if (cartId) {
      await c.query('DELETE FROM cart_item WHERE cart_id=$1 AND id=ANY($2::uuid[])', [
        cartId,
        b.itemIds,
      ]);
      await c.query('UPDATE session_cart SET cart_version=cart_version+1 WHERE id=$1', [cartId]);
    }
    return batch;
  });
}
export function registerOrders(app: FastifyInstance, db: Database, restaurant: string) {
  app.post('/guest/orders', { config: { public: true } }, async (r) => {
    const result = await transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      await c.query('SAVEPOINT guest_submit');
      try {
        return await submit(
          c,
          p.session_id,
          restaurant,
          { type: 'GUEST', id: p.id },
          object(r.body),
        );
      } catch (error) {
        if (!(error instanceof Error) || !('blockGuest' in error)) throw error;
        await c.query('ROLLBACK TO SAVEPOINT guest_submit');
        await c.query(
          "UPDATE session_participant SET status='BLOCKED',blocked_until=now()+interval '10 minutes' WHERE id=$1",
          [p.id],
        );
        return { blocked: true };
      }
    });
    if (result.blocked)
      reject(
        'Tạm dừng gọi món trong 10 phút do gửi quá nhiều lượt. Vui lòng nhờ nhân viên hỗ trợ.',
        429,
      );
    return result;
  });
  app.post('/core/sessions/:id/orders', { config: { permission: 'staff.workspace' } }, async (r) =>
    transaction(db, (c) =>
      submit(c, idParam(r), restaurant, { type: 'USER', id: r.identity!.id }, object(r.body)),
    ),
  );
  app.get('/core/orders', { config: { permission: 'staff.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT b.*,t.code AS table_code,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND s.session_status='ACTIVE' ORDER BY b.created_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.get('/core/kitchen', { config: { permission: 'kitchen.workspace' } }, async () =>
    db.pool
      .query(
        `SELECT b.*,t.code AS table_code,(SELECT jsonb_agg(i ORDER BY i.created_at) FROM order_item i WHERE i.order_batch_id=b.id) AS items FROM order_batch b JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND b.status IN ('SUBMITTED','ACCEPTED','IN_PROGRESS') ORDER BY b.submitted_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.post('/core/orders/:id/review', { config: { permission: 'staff.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        id = idParam(r);
      const existing = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
      await session(c, existing.session_id, restaurant);
      const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
      const review = await one(c, 'SELECT * FROM order_review WHERE order_batch_id=$1 FOR UPDATE', [
        id,
      ]);
      if (batch.status !== 'PENDING_REVIEW' || review.status !== 'PENDING')
        reject('Lượt gọi đã được xử lý.');
      const approve = b.approve === true,
        expired = new Date(review.expires_at).getTime() <= Date.now();
      if (typeof b.approve !== 'boolean') reject('Quyết định không hợp lệ.', 400);
      if (approve && expired) reject('Yêu cầu duyệt đã hết hạn.');
      if (approve) {
        const invalid = await c.query(
          `SELECT i.id FROM order_item i JOIN product p ON p.id=i.product_id JOIN menu_category m ON m.id=p.category_id WHERE i.order_batch_id=$1 AND (NOT p.is_active OR NOT m.is_active OR p.availability_status<>'AVAILABLE' OR p.base_price<>i.unit_price_snapshot)`,
          [id],
        );
        if (invalid.rowCount)
          reject('Món hoặc giá đã thay đổi. Từ chối lượt này và yêu cầu khách đặt lại.');
        await c.query(
          "UPDATE inventory_reservation SET status='ACTIVE',reservation_type='CONFIRMED',expires_at=NULL WHERE order_item_id IN (SELECT id FROM order_item WHERE order_batch_id=$1) AND status='PROVISIONAL'",
          [id],
        );
        await addCharges(c, id, batch.session_id);
      } else {
        await release(c, id);
        await c.query(
          "UPDATE order_item SET status='CANCELLED',cancel_reason=$2,cancelled_by_type='USER',cancelled_by_user_id=$3,version=version+1 WHERE order_batch_id=$1",
          [id, text(b.reason, 300), r.identity!.id],
        );
      }
      await c.query(
        'UPDATE order_review SET status=$2,reviewer_id=$3,decided_at=now(),decision_reason=$4,version=version+1 WHERE id=$1',
        [
          review.id,
          approve ? 'APPROVED' : 'REJECTED',
          r.identity!.id,
          approve ? 'Đã kiểm tra tại bàn' : text(b.reason, 300),
        ],
      );
      await c.query('UPDATE order_batch SET status=$2,version=version+1 WHERE id=$1', [
        id,
        approve ? 'SUBMITTED' : 'REJECTED',
      ]);
      await history(c, id, null, batch.status, approve ? 'SUBMITTED' : 'REJECTED', {
        type: 'USER',
        id: r.identity!.id,
      });
      await event(c, id, approve ? 'ORDER_SUBMITTED' : 'ORDER_REJECTED');
      return { status: 'ok' };
    }),
  );
  app.post('/core/orders/:id/accept', { config: { permission: 'kitchen.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        e = await one(c, 'SELECT session_id FROM order_batch WHERE id=$1', [id]);
      await session(c, e.session_id, restaurant);
      const batch = await one(c, 'SELECT * FROM order_batch WHERE id=$1 FOR UPDATE', [id]);
      if (batch.status !== 'SUBMITTED') reject('Bếp chỉ tiếp nhận lượt đã được gửi duyệt hợp lệ.');
      await c.query(
        "UPDATE order_batch SET status='ACCEPTED',accepted_at=now(),version=version+1 WHERE id=$1",
        [id],
      );
      await c.query(
        "UPDATE order_item SET status='ACCEPTED',version=version+1 WHERE order_batch_id=$1 AND status='SUBMITTED'",
        [id],
      );
      await history(c, id, null, 'SUBMITTED', 'ACCEPTED', { type: 'USER', id: r.identity!.id });
      await event(c, id, 'ORDER_ACCEPTED');
      return { status: 'ok' };
    }),
  );
  for (const [action, permission, from, to] of [
    ['prepare', 'kitchen.workspace', 'ACCEPTED', 'IN_PREPARATION'],
    ['ready', 'kitchen.workspace', 'IN_PREPARATION', 'READY'],
    ['serve', 'staff.workspace', 'READY', 'SERVED'],
  ]) {
    app.post('/core/items/:id/' + action, { config: { permission: permission! } }, async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          i = await one(
            c,
            'SELECT i.*,b.session_id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE i.id=$1',
            [id],
          );
        await session(c, i.session_id, restaurant);
        const item = await one(c, 'SELECT * FROM order_item WHERE id=$1 FOR UPDATE', [id]);
        if (item.status !== from) reject('Trạng thái món đã thay đổi.');
        if (action === 'prepare') await consume(c, id, r.identity!.id);
        await c.query('UPDATE order_item SET status=$2,version=version+1 WHERE id=$1', [id, to]);
        const remaining = await one(
          c,
          "SELECT count(*)::int AS n FROM order_item WHERE order_batch_id=$1 AND status NOT IN ('SERVED','CANCELLED')",
          [item.order_batch_id],
        );
        await c.query('UPDATE order_batch SET status=$2,version=version+1 WHERE id=$1', [
          item.order_batch_id,
          remaining.n === 0 ? 'COMPLETED' : 'IN_PROGRESS',
        ]);
        await history(c, item.order_batch_id, id, item.status, to!, {
          type: 'USER',
          id: r.identity!.id,
        });
        await event(c, item.order_batch_id, 'ITEM_' + to);
        return { status: 'ok' };
      }),
    );
  }
}
