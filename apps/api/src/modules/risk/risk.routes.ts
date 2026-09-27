import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { object, one, reject, transaction } from '../shared/core-persistence.js';
import { riskDefaults } from './policy.service.js';
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
          value <
            ([
              'SHIFT_MAX_BREAK_MINUTES',
              'CLOCK_IN_EARLY_MINUTES',
              'CLOCK_OUT_LATE_MINUTES',
            ].includes(key)
              ? 0
              : 1) ||
          value > 100000000000
        )
          reject('Ngưỡng phải là số nguyên dương hợp lệ.', 400);
        current[key] = value;
      }
      if (Number(current.TABLE_MAX_CAPACITY) > 30)
        reject('Sức chứa tối đa trong phạm vi hiện tại là 30 chỗ.', 400);
      if (
        Number(current.LINE_QTY_HARD_LIMIT) > 99 ||
        Number(current.REVIEW_TTL_MINUTES) > 120 ||
        Number(current.PAYMENT_TTL_MINUTES) > 120
      )
        reject('Giới hạn một dòng tối đa 99; thời hạn yêu cầu tối đa 120 phút.', 400);
      if (
        Number(current.SHIFT_MAX_MINUTES) > 960 ||
        Number(current.SHIFT_MAX_BREAK_MINUTES) > 240 ||
        Number(current.CLOCK_IN_EARLY_MINUTES) > 240 ||
        Number(current.CLOCK_OUT_LATE_MINUTES) > 1440
      )
        reject(
          'Ca tối đa 960 phút; nghỉ và vào sớm tối đa 240 phút; ra muộn tối đa 1440 phút.',
          400,
        );
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
