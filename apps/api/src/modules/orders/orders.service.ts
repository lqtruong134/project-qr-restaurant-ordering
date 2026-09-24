import {
  type Connection,
  type Actor,
  session,
  object,
  text,
  one,
  integer,
  reject,
  uuid,
  history,
  event,
} from '../shared/core-persistence.js';
import { reserve } from '../inventory/inventory.service.js';
import { addCharges } from '../finance/ledger.service.js';
import { idempotent } from '../shared/idempotency.js';
export async function submit(
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
