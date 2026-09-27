import { type Connection } from '../shared/core-persistence.js';
export const riskDefaults = {
  FIRST_ORDER_REVIEW_ENABLED: true,
  LINE_QTY_REVIEW: 5,
  LINE_QTY_HARD_LIMIT: 99,
  ORDER_TOTAL_QTY_REVIEW: 15,
  ORDER_TOTAL_QTY_HARD_LIMIT: 200,
  ORDER_AMOUNT_REVIEW_VND: 2000000,
  ORDER_AMOUNT_HARD_LIMIT_VND: 10000000,
  SESSION_AMOUNT_REVIEW_VND: 5000000,
  ORDER_MIN_INTERVAL_SECONDS: 3,
  GUEST_5MIN_HARD_LIMIT: 5,
  GUEST_MINUTE_REVIEW: 2,
  SESSION_MINUTE_REVIEW: 7,
  REVIEW_TTL_MINUTES: 10,
  PAYMENT_TTL_MINUTES: 15,
  TABLE_MAX_CAPACITY: 30,
  SHIFT_MAX_MINUTES: 960,
  SHIFT_MAX_BREAK_MINUTES: 240,
  CLOCK_IN_EARLY_MINUTES: 30,
  CLOCK_OUT_LATE_MINUTES: 1440,
};

export async function readPolicy(c: Connection, restaurant: string) {
  const rows = (
    await c.query(
      'SELECT DISTINCT ON(config_key) config_key,value_json,version_no FROM risk_policy_config WHERE restaurant_id=$1 AND effective_from<=now() ORDER BY config_key,version_no DESC',
      [restaurant],
    )
  ).rows;
  const policy: Record<string, unknown> = { ...riskDefaults };
  for (const row of rows) policy[row.config_key] = row.value_json;
  return { policy, version: Math.max(1, ...rows.map((row) => Number(row.version_no))) };
}
