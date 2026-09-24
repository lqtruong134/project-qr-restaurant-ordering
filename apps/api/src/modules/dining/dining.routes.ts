import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  idParam,
  object,
  one,
  reject,
  session,
  text,
  transaction,
} from '../shared/core-persistence.js';
import { recalculate } from '../finance/ledger.service.js';
import { cancelBatch } from '../orders/cancellation.service.js';
export function registerOperations(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'staff.workspace' };
  app.post('/core/tables/:id/open', { config }, async (r) =>
    transaction(db, async (c) => {
      const t = await one(
        c,
        'SELECT t.* FROM dining_table t JOIN dining_area a ON a.id=t.area_id WHERE t.id=$1 AND t.restaurant_id=$2 AND t.is_active AND a.is_active FOR UPDATE OF t',
        [idParam(r), restaurant],
      );
      if (t.table_status !== 'AVAILABLE') reject('Bàn chưa sẵn sàng mở phiên.');
      const s = await one(
        c,
        "INSERT INTO table_session(table_id,verification_status,verified_at) VALUES($1,'VERIFIED',now()) RETURNING *",
        [t.id],
      );
      await c.query('INSERT INTO session_cart(session_id) VALUES($1)', [s.id]);
      await c.query('INSERT INTO session_financial_account(session_id) VALUES($1)', [s.id]);
      await c.query(
        "UPDATE dining_table SET table_status='OCCUPIED',version=version+1 WHERE id=$1",
        [t.id],
      );
      return s;
    }),
  );
  app.post('/core/sessions/:id/verify', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant);
      return one(
        c,
        "UPDATE table_session SET verification_status='VERIFIED',verified_at=now(),version=version+1 WHERE id=$1 RETURNING *",
        [s.id],
      );
    }),
  );
  app.get('/core/support', { config }, async () =>
    db.pool
      .query(
        `SELECT x.*,t.code AS table_code,p.display_name FROM support_request x JOIN table_session s ON s.id=x.session_id JOIN dining_table t ON t.id=s.table_id LEFT JOIN session_participant p ON p.id=x.participant_id WHERE t.restaurant_id=$1 AND x.status IN ('NEW','ACKNOWLEDGED') ORDER BY x.created_at`,
        [restaurant],
      )
      .then((v) => v.rows),
  );
  for (const action of ['claim', 'resolve'])
    app.post('/core/support/:id/' + action, { config }, async (r) =>
      transaction(db, async (c) => {
        const x = await one(
          c,
          'SELECT x.* FROM support_request x JOIN table_session s ON s.id=x.session_id JOIN dining_table t ON t.id=s.table_id WHERE x.id=$1 AND t.restaurant_id=$2 FOR UPDATE OF x',
          [idParam(r), restaurant],
        );
        if (action === 'claim') {
          if (x.status !== 'NEW') reject('Yêu cầu đã được người khác tiếp nhận.');
          return one(
            c,
            "UPDATE support_request SET status='ACKNOWLEDGED',acknowledged_by=$2,acknowledged_at=now() WHERE id=$1 RETURNING *",
            [x.id, r.identity!.id],
          );
        }
        if (x.status !== 'ACKNOWLEDGED' || x.acknowledged_by !== r.identity!.id)
          reject('Chỉ người đang tiếp nhận được hoàn tất yêu cầu.', 403);
        return one(
          c,
          "UPDATE support_request SET status='RESOLVED',resolved_by=$2,resolved_at=now() WHERE id=$1 RETURNING *",
          [x.id, r.identity!.id],
        );
      }),
    );
  app.post('/core/orders/:id/cancel', { config }, async (r) =>
    transaction(db, (c) =>
      cancelBatch(
        c,
        idParam(r),
        restaurant,
        { type: 'USER', id: r.identity!.id },
        text(object(r.body).reason, 300),
      ),
    ),
  );
  app.post('/core/sessions/:id/close', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant),
        a = await recalculate(c, s.id);
      if (BigInt(a.outstanding_amount) !== 0n || BigInt(a.refund_due_amount) !== 0n)
        reject('Phiên còn thiếu tiền hoặc cần hoàn tiền.');
      const pending = await one(
        c,
        `SELECT (SELECT count(*) FROM order_batch WHERE session_id=$1 AND status NOT IN ('COMPLETED','REJECTED','CANCELLED'))+(SELECT count(*) FROM payment_intent WHERE session_id=$1 AND status IN ('CREATED','PENDING','REQUIRES_RECONCILIATION'))+(SELECT count(*) FROM refund_case WHERE session_id=$1 AND status IN ('OPEN','IN_PROGRESS')) AS n`,
        [s.id],
      );
      if (Number(pending.n)) reject('Còn đơn hoặc giao dịch chưa kết thúc.');
      const cases = await c.query(
        "SELECT id FROM outstanding_balance_case WHERE session_id=$1 AND status NOT IN ('RECOVERED','CANCELLED','WRITTEN_OFF')",
        [s.id],
      );
      if (cases.rowCount) reject('Quản trị cần chốt hồ sơ thiếu tiền trước khi đóng phiên.');
      await c.query(
        "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='SETTLED',version=version+1 WHERE id=$1",
        [s.id],
      );
      await c.query("UPDATE session_participant SET status='LEFT' WHERE session_id=$1", [s.id]);
      await c.query(
        "UPDATE dining_table SET table_status='NEEDS_CLEANING',version=version+1 WHERE id=$1",
        [s.table_id],
      );
      return { status: 'ok' };
    }),
  );
  app.post('/core/tables/:id/clean', { config }, async (r) =>
    transaction(db, (c) =>
      one(
        c,
        "UPDATE dining_table SET table_status='AVAILABLE',version=version+1 WHERE id=$1 AND restaurant_id=$2 AND table_status='NEEDS_CLEANING' AND NOT EXISTS(SELECT 1 FROM table_session WHERE table_id=$1 AND session_status='ACTIVE') RETURNING *",
        [idParam(r), restaurant],
      ),
    ),
  );
  app.get('/core/alerts', { config }, async () =>
    db.pool
      .query(
        "SELECT a.*,t.code AS table_code FROM operational_alert a JOIN dining_table t ON t.id=a.table_id WHERE t.restaurant_id=$1 AND a.status<>'RESOLVED' ORDER BY a.created_at",
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.post('/core/alerts/:id/acknowledge', { config }, async (r) =>
    transaction(db, (c) =>
      one(
        c,
        "UPDATE operational_alert a SET status='ACKNOWLEDGED',acknowledged_by=$3 WHERE id=$1 AND status IN ('NEW','ESCALATED') AND table_id IN (SELECT id FROM dining_table WHERE restaurant_id=$2) RETURNING *",
        [idParam(r), restaurant, r.identity!.id],
      ),
    ),
  );
  app.post('/core/alerts/:id/resolve', { config }, async (r) =>
    transaction(db, async (c) => {
      const a = await one(
        c,
        'SELECT a.* FROM operational_alert a JOIN dining_table t ON t.id=a.table_id WHERE a.id=$1 AND t.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      if (a.session_id) {
        await session(c, a.session_id, restaurant, false);
        const balance = await recalculate(c, a.session_id);
        if (a.alert_type === 'REFUND_REQUIRED' && BigInt(balance.refund_due_amount) > 0n)
          reject('Vẫn còn số tiền cần hoàn.');
        if (a.alert_type === 'PAYMENT_SHORTFALL' && BigInt(balance.outstanding_amount) > 0n) {
          const resolved = await c.query(
            "SELECT id FROM outstanding_balance_case WHERE session_id=$1 AND status='WRITTEN_OFF'",
            [a.session_id],
          );
          if (!resolved.rowCount) reject('Hồ sơ thiếu tiền chưa được xử lý.');
        }
      }
      return one(
        c,
        "UPDATE operational_alert SET status='RESOLVED',resolved_at=now() WHERE id=$1 AND status='ACKNOWLEDGED' RETURNING *",
        [a.id],
      );
    }),
  );
  app.post('/core/sessions/:id/outstanding', { config }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant),
        b = object(r.body),
        a = await recalculate(c, s.id);
      if (BigInt(a.outstanding_amount) <= 0n) reject('Phiên không có dư nợ.');
      const result = await one(
        c,
        'INSERT INTO outstanding_balance_case(session_id,table_id,invoice_total,paid_total,outstanding_amount,reason_code,reported_by,notes,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [
          s.id,
          s.table_id,
          a.charge_total,
          a.paid_total,
          a.outstanding_amount,
          text(b.reason, 100),
          r.identity!.id,
          text(b.notes, 500),
          b.evidence ? text(b.evidence, 300) : null,
        ],
      );
      await c.query(
        "UPDATE table_session SET financial_status='OUTSTANDING_EXCEPTION' WHERE id=$1",
        [s.id],
      );
      await c.query(
        "INSERT INTO operational_alert(session_id,table_id,alert_type,severity,outstanding_amount) VALUES($1,$2,'PAYMENT_SHORTFALL','CRITICAL',$3)",
        [s.id, s.table_id, a.outstanding_amount],
      );
      return result;
    }),
  );
  app.get('/core/outstanding', { config: { permission: 'admin.workspace' } }, async () =>
    db.pool
      .query(
        'SELECT o.*,t.code AS table_code FROM outstanding_balance_case o JOIN dining_table t ON t.id=o.table_id WHERE t.restaurant_id=$1 ORDER BY o.created_at DESC',
        [restaurant],
      )
      .then((v) => v.rows),
  );
  app.post(
    '/core/outstanding/:id/write-off',
    { config: { permission: 'admin.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          b = object(r.body),
          e = await one(c, 'SELECT session_id FROM outstanding_balance_case WHERE id=$1', [id]);
        const s = await session(c, e.session_id, restaurant);
        const o = await one(c, 'SELECT * FROM outstanding_balance_case WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        if (!['PENDING_ADMIN_REVIEW', 'IN_RECOVERY'].includes(o.status))
          reject('Hồ sơ không còn chờ xử lý.');
        const pending = await one(
          c,
          "SELECT count(*)::int AS n FROM order_batch WHERE session_id=$1 AND status NOT IN ('COMPLETED','CANCELLED','REJECTED')",
          [s.id],
        );
        if (pending.n) reject('Cần hoàn tất các lượt gọi trước khi đóng ngoại lệ.');
        const payment = await one(
          c,
          "SELECT count(*)::int AS n FROM payment_intent WHERE session_id=$1 AND status IN ('CREATED','PENDING','REQUIRES_RECONCILIATION')",
          [s.id],
        );
        if (payment.n) reject('Còn yêu cầu thanh toán đang xử lý.');
        const a = await recalculate(c, s.id);
        if (BigInt(a.refund_due_amount) > 0n || BigInt(a.outstanding_amount) === 0n)
          reject('Số dư đã thay đổi, cần kiểm tra lại hồ sơ.');
        await c.query(
          "UPDATE outstanding_balance_case SET status='WRITTEN_OFF',admin_owner=$2,notes=COALESCE(notes,'')||E'\n'||$3 WHERE id=$1",
          [id, r.identity!.id, text(b.reason, 500)],
        );
        await c.query(
          "UPDATE table_session SET session_status='CLOSED',closed_at=now(),close_reason='OUTSTANDING_WRITTEN_OFF',version=version+1 WHERE id=$1",
          [s.id],
        );
        await c.query("UPDATE session_participant SET status='LEFT' WHERE session_id=$1", [s.id]);
        await c.query(
          "UPDATE dining_table SET table_status='NEEDS_CLEANING',version=version+1 WHERE id=$1",
          [s.table_id],
        );
        return { status: 'ok' };
      }),
  );
  app.post(
    '/core/outstanding/:id/recovered',
    { config: { permission: 'admin.workspace' } },
    async (r) =>
      transaction(db, async (c) => {
        const id = idParam(r),
          b = object(r.body),
          e = await one(c, 'SELECT session_id FROM outstanding_balance_case WHERE id=$1', [id]);
        await session(c, e.session_id, restaurant);
        const a = await recalculate(c, e.session_id);
        if (BigInt(a.outstanding_amount) > 0n || BigInt(a.refund_due_amount) > 0n)
          reject('Phiên chưa cân đối đủ tiền.');
        const result = await one(
          c,
          "UPDATE outstanding_balance_case SET status='RECOVERED',admin_owner=$2,notes=COALESCE(notes,'')||E'\n'||$3 WHERE id=$1 AND status IN ('PENDING_ADMIN_REVIEW','IN_RECOVERY','PARTIALLY_RECOVERED') RETURNING *",
          [id, r.identity!.id, text(b.reason, 500)],
        );
        await c.query("UPDATE table_session SET financial_status='SETTLED' WHERE id=$1", [
          e.session_id,
        ]);
        return result;
      }),
  );
}
