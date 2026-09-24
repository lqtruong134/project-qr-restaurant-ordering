import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  integer,
  object,
  one,
  reject,
  session,
  text,
  transaction,
  uuid,
} from '../shared/core-persistence.js';

export function registerTableTransfer(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'staff.workspace' };
  app.get('/core/sessions/:id/transfers', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant, false);
      return (
        await c.query(
          `SELECT h.*,f.name AS from_name,t.name AS to_name,u.display_name AS employee_name,u.username
     FROM table_transfer_history h JOIN dining_table f ON f.id=h.from_table_id JOIN dining_table t ON t.id=h.to_table_id
     JOIN app_user u ON u.id=h.transferred_by WHERE h.session_id=$1 ORDER BY h.transferred_at`,
          [s.id],
        )
      ).rows;
    }),
  );
  app.post('/core/sessions/:id/transfer', { config }, async (r) =>
    transaction(db, async (c) => {
      const b = object(r.body),
        s = await session(c, idParam(r), restaurant),
        targetId = uuid(b.tableId),
        fromId = uuid(b.fromTableId);
      if (s.table_id !== fromId) reject('Bàn đã được chuyển bởi người khác. Vui lòng tải lại.');
      if (targetId === s.table_id) reject('Hãy chọn một bàn khác.', 400);
      const partySize = integer(b.partySize, 1, 30);
      // Deterministic table lock ordering keeps concurrent transfers atomic.
      const tables = (
        await c.query(
          'SELECT * FROM dining_table WHERE id=ANY($1::uuid[]) AND restaurant_id=$2 ORDER BY id FOR UPDATE',
          [[s.table_id, targetId], restaurant],
        )
      ).rows;
      const to = tables.find((t) => t.id === targetId);
      if (!to || !to.is_active || to.table_status !== 'AVAILABLE')
        reject('Bàn đích chưa sẵn sàng.');
      await one(c, 'SELECT id FROM dining_area WHERE id=$1 AND is_active FOR SHARE', [to.area_id]);
      if (to.capacity < partySize) reject('Bàn đích không đủ chỗ cho số khách.');
      if (
        (
          await c.query(
            "SELECT id FROM table_session WHERE table_id=$1 AND session_status='ACTIVE'",
            [targetId],
          )
        ).rowCount
      )
        reject('Bàn đích đã có phiên phục vụ.');
      await c.query('UPDATE table_session SET table_id=$2,version=version+1 WHERE id=$1', [
        s.id,
        targetId,
      ]);
      const history = await one(
        c,
        'INSERT INTO table_transfer_history(restaurant_id,session_id,from_table_id,to_table_id,transferred_by,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [restaurant, s.id, s.table_id, targetId, r.identity!.id, text(b.reason, 500)],
      );
      await c.query(
        "UPDATE dining_table SET table_status=CASE WHEN id=$1 THEN 'NEEDS_CLEANING' ELSE 'OCCUPIED' END,version=version+1 WHERE id=ANY($2::uuid[])",
        [s.table_id, [s.table_id, targetId]],
      );
      return { sessionId: s.id, tableId: targetId, history };
    }),
  );
}
