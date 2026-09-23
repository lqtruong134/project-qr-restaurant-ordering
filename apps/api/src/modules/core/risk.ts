import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { object, one, reject, transaction } from './common.js';
export const riskDefaults = {
  FIRST_ORDER_REVIEW_ENABLED: true,
  LINE_QTY_REVIEW: 5,
  LINE_QTY_HARD_LIMIT: 20,
  ORDER_TOTAL_QTY_REVIEW: 15,
  ORDER_TOTAL_QTY_HARD_LIMIT: 50,
  ORDER_AMOUNT_REVIEW_VND: 2000000,
  ORDER_AMOUNT_HARD_LIMIT_VND: 10000000,
  SESSION_AMOUNT_REVIEW_VND: 5000000,
};
export function registerRisk(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get('/core/risk', { config }, async () => ({
    defaults: riskDefaults,
    policies: (
      await db.pool.query(
        'SELECT DISTINCT ON(config_key) * FROM risk_policy_config WHERE restaurant_id=$1 AND effective_from<=now() ORDER BY config_key,version_no DESC',
        [restaurant],
      )
    ).rows,
  }));
  app.post('/core/risk', { config }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body);
      await one(c, 'SELECT id FROM restaurant WHERE id=$1 FOR UPDATE', [restaurant]);
      const rows = (
        await c.query(
          'SELECT DISTINCT ON(config_key) * FROM risk_policy_config WHERE restaurant_id=$1 AND effective_from<=now() ORDER BY config_key,version_no DESC',
          [restaurant],
        )
      ).rows;
      const current: Record<string, unknown> = { ...riskDefaults };
      for (const row of rows) current[row.config_key] = row.value_json;
      for (const key of Object.keys(b)) {
        if (!(key in riskDefaults)) reject('Thiết lập không được hỗ trợ.', 400);
        const value = b[key];
        if (key === 'FIRST_ORDER_REVIEW_ENABLED') {
          if (typeof value !== 'boolean') reject('Trạng thái phải là bật hoặc tắt.', 400);
        } else if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > 100000000000
        )
          reject('Ngưỡng phải là số nguyên dương hợp lệ.', 400);
        current[key] = value;
      }
      for (const [review, hard] of [
        ['LINE_QTY_REVIEW', 'LINE_QTY_HARD_LIMIT'],
        ['ORDER_TOTAL_QTY_REVIEW', 'ORDER_TOTAL_QTY_HARD_LIMIT'],
        ['ORDER_AMOUNT_REVIEW_VND', 'ORDER_AMOUNT_HARD_LIMIT_VND'],
      ])
        if (Number(current[review!]) > Number(current[hard!]))
          reject('Ngưỡng cần duyệt không được vượt giới hạn cứng.', 400);
      const version = await one(
        c,
        'SELECT COALESCE(max(version_no),0)+1 AS n FROM risk_policy_config WHERE restaurant_id=$1',
        [restaurant],
      );
      for (const [key, value] of Object.entries(current))
        await c.query(
          'INSERT INTO risk_policy_config(restaurant_id,config_key,value_type,value_json,version_no,changed_by) VALUES($1,$2,$3,$4,$5,$6)',
          [
            restaurant,
            key,
            typeof value === 'boolean' ? 'BOOLEAN' : 'NUMBER',
            JSON.stringify(value),
            version.n,
            r.identity!.id,
          ],
        );
      return { version: version.n };
    }),
  );
}
