import { tableTransferPolicy } from '@thesis/contracts';
import { transferReason } from './transfer-reasons.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  integer,
  object,
  one,
  reject,
  session,
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
     JOIN app_user u ON u.id=h.transferred_by WHERE h.session_id=$1 ORDER BY h.transferred_at DESC,h.id DESC`,
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
      if (s.table_id !== fromId)
        reject('Phiên đã được chuyển bởi nhân viên khác. Vui lòng tải lại dữ liệu.');
      if (targetId === s.table_id) reject('Hãy chọn một bàn khác.', 400);
      if (
        typeof b.partySize !== 'number' ||
        !Number.isSafeInteger(b.partySize) ||
        b.partySize < 1 ||
        b.partySize > tableTransferPolicy.maxGuests
      )
        reject(`Số khách thực tế phải từ 1 đến ${tableTransferPolicy.maxGuests}.`, 400);
      const partySize = integer(b.partySize, 1, tableTransferPolicy.maxGuests);
      const reason = transferReason(b);
      // Deterministic table lock ordering keeps concurrent transfers atomic.
      const tables = (
        await c.query(
          'SELECT * FROM dining_table WHERE id=ANY($1::uuid[]) AND restaurant_id=$2 ORDER BY id FOR UPDATE',
          [[s.table_id, targetId], restaurant],
        )
      ).rows;
      const to = tables.find((t) => t.id === targetId);
      if (!to || !to.is_active) reject('Bàn đích không còn hoạt động. Vui lòng chọn bàn khác.');
      if (to.table_status !== 'AVAILABLE')
        reject(
          to.table_status === 'OCCUPIED'
            ? `Bàn ${to.name} vừa được sử dụng. Vui lòng chọn bàn khác.`
            : `Bàn ${to.name} đang chờ dọn. Vui lòng chọn bàn khác.`,
        );
      const area = (
        await c.query(
          'SELECT id FROM dining_area WHERE id=$1 AND restaurant_id=$2 AND is_active FOR SHARE',
          [to.area_id, restaurant],
        )
      ).rows[0];
      if (!area) reject('Khu vực của bàn đích đã ngừng hoạt động. Vui lòng chọn bàn khác.');
      if (to.capacity < partySize) reject(`Bàn ${to.name} không đủ chỗ cho ${partySize} khách.`);
      if (
        (
          await c.query(
            "SELECT id FROM table_session WHERE table_id=$1 AND session_status='ACTIVE'",
            [targetId],
          )
        ).rowCount
      )
        reject(`Bàn ${to.name} vừa được sử dụng. Vui lòng chọn bàn khác.`);
      await c.query('UPDATE table_session SET table_id=$2,version=version+1 WHERE id=$1', [
        s.id,
        targetId,
      ]);
      const history = await one(
        c,
        'INSERT INTO table_transfer_history(restaurant_id,session_id,from_table_id,to_table_id,transferred_by,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [restaurant, s.id, s.table_id, targetId, r.identity!.id, reason],
      );
      await c.query(
        "UPDATE dining_table SET table_status=CASE WHEN id=$1 THEN 'NEEDS_CLEANING' ELSE 'OCCUPIED' END,version=version+1 WHERE id=ANY($2::uuid[])",
        [s.table_id, [s.table_id, targetId]],
      );
      return { sessionId: s.id, tableId: targetId, history };
    }),
  );
}
