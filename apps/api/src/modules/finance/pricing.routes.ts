import type { Database } from '@thesis/database';
import type { FastifyInstance } from 'fastify';
import {
  digest,
  guest,
  idParam,
  integer,
  object,
  one,
  reject,
  session,
  text,
  transaction,
  type Actor,
  type Connection,
} from '../shared/core-persistence.js';
import { recalculate } from './ledger.service.js';
import {
  createTaxPolicy,
  listDiscountPrograms,
  readPromotionView,
  readTaxSettings,
  saveDiscountProgram,
  selectPromotion,
} from './pricing.service.js';

async function promotionMutation(
  c: Connection,
  sid: string,
  restaurant: string,
  actor: Actor,
  b: Record<string, unknown>,
  remove: boolean,
) {
  const key = text(b.requestId, 100),
    hash = digest(JSON.stringify({ remove, ...b }));
  const old = (
    await c.query(
      'SELECT * FROM promotion_request WHERE session_id=$1 AND actor_type=$2 AND actor_id=$3 AND request_key=$4',
      [sid, actor.type, actor.id, key],
    )
  ).rows[0];
  if (old) {
    if (old.request_hash !== hash) reject('Mã gửi lại đã dùng cho nội dung ưu đãi khác.');
    return old.response_snapshot;
  }
  const result = await selectPromotion(c, sid, restaurant, actor, b, remove);
  await recalculate(c, sid);
  await c.query(
    'INSERT INTO promotion_request(session_id,actor_type,actor_id,request_key,request_hash,response_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
    [sid, actor.type, actor.id, key, hash, JSON.stringify(result)],
  );
  return result;
}
export function registerPricing(app: FastifyInstance, db: Database, restaurant: string) {
  const admin = { permission: 'admin.workspace' },
    finance = { permission: ['staff.workspace', 'admin.workspace'] },
    publicConfig = { public: true };
  app.get('/core/admin/discount-programs', { config: admin }, () =>
    transaction(db, (c) => listDiscountPrograms(c, restaurant)),
  );
  app.post('/core/admin/discount-programs', { config: admin }, (r) =>
    transaction(db, (c) => saveDiscountProgram(c, restaurant, r.identity!.id, object(r.body))),
  );
  app.patch('/core/admin/discount-programs/:id', { config: admin }, (r) =>
    transaction(db, (c) =>
      saveDiscountProgram(c, restaurant, r.identity!.id, object(r.body), idParam(r)),
    ),
  );
  app.delete('/core/admin/discount-programs/:id', { config: admin }, (r) =>
    transaction(db, async (c) => {
      const existing = (await listDiscountPrograms(c, restaurant)).find((x) => x.id === idParam(r));
      if (!existing) reject('Không tìm thấy chương trình.', 404);
      return saveDiscountProgram(
        c,
        restaurant,
        r.identity!.id,
        { ...existing, ...object(r.body), status: 'ARCHIVED' },
        existing.id,
      );
    }),
  );
  app.get('/core/admin/discount-programs/:id/history', { config: admin }, (r) =>
    transaction(db, async (c) => {
      await one(c, 'SELECT id FROM discount_program WHERE id=$1 AND restaurant_id=$2', [
        idParam(r),
        restaurant,
      ]);
      const versions = (
        await c.query(
          `SELECT e.details->'version' AS version,e.created_at AS "changedAt",u.display_name AS "changedBy",e.action,e.details->'snapshot' AS snapshot FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.restaurant_id=$1 AND e.resource_id=$2 AND e.resource_type='DISCOUNT_PROGRAM' ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
          [restaurant, idParam(r)],
        )
      ).rows;
      const redemptions = (
        await c.query(
          `SELECT p.session_id AS "sessionId",t.code AS "tableCode",p.status,p.discount_amount::text AS "discountAmount",p.created_at AS "createdAt",p.locked_at AS "lockedAt" FROM session_promotion p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.program_id=$1 ORDER BY p.created_at DESC,p.session_id LIMIT 100`,
          [idParam(r)],
        )
      ).rows;
      return { versions, redemptions };
    }),
  );
  app.get('/core/admin/tax-policies', { config: admin }, () =>
    transaction(db, (c) => readTaxSettings(c, restaurant)),
  );
  app.post('/core/admin/tax-policies', { config: admin }, (r) =>
    transaction(db, (c) => createTaxPolicy(c, restaurant, r.identity!.id, object(r.body))),
  );
  app.patch('/core/products/:id/tax', { config: admin }, (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        treatment = String(b.treatment),
        rate = b.ratePercent == null ? null : integer(b.ratePercent, 0, 10),
        reason = text(b.reason, 500);
      if (
        !['DEFAULT', 'TAXABLE', 'EXEMPT'].includes(treatment) ||
        (treatment === 'TAXABLE' ? ![0, 5, 8, 10].includes(rate ?? -1) : rate !== null) ||
        reason.length < 5
      )
        reject('Chọn phân loại VAT và ghi lý do tối thiểu 5 ký tự.', 400);
      const old = await one(
        c,
        'SELECT * FROM product WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [idParam(r), restaurant],
      );
      if (old.version !== integer(b.version, 1, 2147483646))
        reject('Món đã thay đổi. Vui lòng tải lại.');
      const result = await one(
        c,
        'UPDATE product SET tax_treatment=$2,vat_rate_percent=$3,version=version+1 WHERE id=$1 RETURNING id,code,name,tax_treatment AS treatment,vat_rate_percent AS "ratePercent",version',
        [old.id, treatment, rate],
      );
      await c.query(
        `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'PRODUCT_TAX_CHANGED','PRODUCT',$3,$4,$5)`,
        [
          restaurant,
          r.identity!.id,
          old.id,
          reason,
          JSON.stringify({
            before: { treatment: old.tax_treatment, ratePercent: old.vat_rate_percent },
            after: result,
          }),
        ],
      );
      return result;
    }),
  );
  app.get('/core/sessions/:id/promotion', { config: finance }, (r) =>
    transaction(db, async (c) => {
      await session(c, idParam(r), restaurant);
      return readPromotionView(c, idParam(r), restaurant);
    }),
  );
  app.post('/core/sessions/:id/promotion', { config: finance }, (r) =>
    transaction(db, async (c) => {
      const sid = idParam(r);
      await session(c, sid, restaurant);
      return promotionMutation(
        c,
        sid,
        restaurant,
        { type: 'USER', id: r.identity!.id },
        object(r.body),
        false,
      );
    }),
  );
  app.delete('/core/sessions/:id/promotion', { config: finance }, (r) =>
    transaction(db, async (c) => {
      const sid = idParam(r);
      await session(c, sid, restaurant);
      return promotionMutation(
        c,
        sid,
        restaurant,
        { type: 'USER', id: r.identity!.id },
        object(r.body),
        true,
      );
    }),
  );
  app.get('/guest/promotion', { config: publicConfig }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      return readPromotionView(c, p.session_id, restaurant);
    }),
  );
  app.post('/guest/promotion', { config: publicConfig }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      return promotionMutation(
        c,
        p.session_id,
        restaurant,
        { type: 'GUEST', id: p.id },
        object(r.body),
        false,
      );
    }),
  );
  app.delete('/guest/promotion', { config: publicConfig }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      return promotionMutation(
        c,
        p.session_id,
        restaurant,
        { type: 'GUEST', id: p.id },
        object(r.body),
        true,
      );
    }),
  );
}
