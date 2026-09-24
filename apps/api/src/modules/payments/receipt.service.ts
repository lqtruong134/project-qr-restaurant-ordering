import { one, type Connection } from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
export async function readBill(c: Connection, s: Record<string, unknown>, restaurant: string) {
  if (s.receipt_snapshot) return s.receipt_snapshot;
  const account = await recalculate(c, String(s.id));
  return {
    session: s,
    account,
    generatedAt: new Date().toISOString(),
    store: await one(c, 'SELECT name,address,timezone FROM restaurant WHERE id=$1', [restaurant]),
    charges: (
      await c.query(
        'SELECT f.*,i.product_name_snapshot,i.quantity,i.unit_price_snapshot FROM financial_charge f LEFT JOIN order_item i ON i.id=f.order_item_id WHERE f.session_id=$1 ORDER BY f.created_at,f.id',
        [s.id],
      )
    ).rows,
    intents: (
      await c.query('SELECT * FROM payment_intent WHERE session_id=$1 ORDER BY created_at DESC', [
        s.id,
      ])
    ).rows,
    payments: (
      await c.query(
        'SELECT p.*,u.display_name AS confirmed_by_name,u.username AS confirmed_by_username FROM payment_transaction p LEFT JOIN app_user u ON u.id=p.confirmed_by WHERE p.session_id=$1 ORDER BY p.created_at DESC',
        [s.id],
      )
    ).rows,
    refunds: (
      await c.query('SELECT * FROM refund_case WHERE session_id=$1 ORDER BY created_at DESC', [
        s.id,
      ])
    ).rows,
    closedBy: s.closed_by
      ? await one(c, 'SELECT display_name,username FROM app_user WHERE id=$1', [s.closed_by])
      : null,
  };
}
export async function freezeReceipt(c: Connection, id: string, restaurant: string, actor: string) {
  await c.query(
    "UPDATE table_session SET closed_by=$2,receipt_number='PT-'||to_char(closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYYMMDD')||'-'||lpad(nextval('receipt_number_seq')::text,8,'0') WHERE id=$1 AND receipt_snapshot IS NULL",
    [id, actor],
  );
  const s = await one(
    c,
    'SELECT s.*,t.code AS table_code,t.name AS table_name FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=$1',
    [id],
  );
  const bill = await readBill(c, s, restaurant);
  await c.query(
    'UPDATE table_session SET receipt_snapshot=$2::jsonb WHERE id=$1 AND receipt_snapshot IS NULL',
    [id, JSON.stringify(bill)],
  );
}
