import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  digest,
  guest,
  idParam,
  object,
  one,
  reject,
  secret,
  text,
  transaction,
} from '../shared/core-persistence.js';
import {
  cancelForRetry,
  lockSupport,
  requireOwner,
  serviceStaff,
  supportEvent,
  supportRetryAt,
} from '../support/support.service.js';
import {
  accessLimit,
  issueTableCode,
  sessionAccessCode,
  qrTable,
  supportRetrySeconds,
} from './table-access.service.js';
import { guestName } from './guest-name.js';

export function registerTableAccess(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  secure: boolean,
) {
  const publicConfig = { public: true },
    staffConfig = { permission: 'staff.workspace' };
  app.post('/guest/access-request/status', { config: publicConfig }, (r) =>
    transaction(db, async (c) => {
      const t = await qrTable(c, text(object(r.body).token, 128), restaurant);
      const x = (
        await c.query(
          `SELECT x.id,x.status,x.created_at,x.acknowledged_at,x.resolved_at
      FROM support_request x LEFT JOIN table_session s ON s.id=x.session_id
      WHERE COALESCE(s.table_id,x.table_id)=$1 AND x.request_type='ACCESS_CODE'
      AND (x.session_id IS NULL OR s.session_status='ACTIVE') AND x.status<>'CANCELLED'
      ORDER BY x.created_at DESC LIMIT 1`,
          [t.id],
        )
      ).rows[0];
      return x ? { ...x, retryAt: supportRetryAt(x), retrySeconds: supportRetrySeconds } : null;
    }),
  );
  app.post('/guest/access-request', { config: publicConfig }, async (r, reply) => {
    const b = object(r.body),
      token = text(b.token, 128),
      name = guestName(b.name);
    const visitor =
      r.cookies.table_access && r.cookies.table_access.length <= 128
        ? r.cookies.table_access
        : secret();
    reply.setCookie('table_access', visitor, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: 7200,
    });
    // Commit throttling even when the request below is rejected.
    const allowed = await transaction(
      db,
      async (c) =>
        (await accessLimit(c, restaurant, r.ip, 'REQUEST_IP', 30, true)) &&
        (await accessLimit(c, restaurant, visitor, 'REQUEST_VISITOR', 10, true)),
    );
    if (!allowed)
      reject('Bạn đã gửi nhiều yêu cầu. Vui lòng đợi vài phút hoặc gọi nhân viên trực tiếp.', 429);
    return transaction(db, async (c) => {
      const t = await qrTable(c, token, restaurant);
      if (t.table_status === 'NEEDS_CLEANING')
        reject('Bàn đang chờ dọn. Vui lòng gọi nhân viên trực tiếp.');
      const existing = (
        await c.query(
          `SELECT x.* FROM support_request x LEFT JOIN table_session s ON s.id=x.session_id
        WHERE COALESCE(s.table_id,x.table_id)=$1 AND x.request_type='ACCESS_CODE' AND (x.session_id IS NULL OR s.session_status='ACTIVE') AND x.status IN ('NEW','ACKNOWLEDGED')
        ORDER BY x.created_at LIMIT 1 FOR UPDATE OF x`,
          [t.id],
        )
      ).rows[0];
      if (existing && !b.retry)
        return {
          id: existing.id,
          status: existing.status,
          reused: true,
          retryAt: supportRetryAt(existing),
        };
      if (existing) {
        if (existing.visitor_hash !== digest(visitor))
          reject(
            'Bàn đã có người gọi hỗ trợ cấp mã. Vui lòng đợi nhân viên hoặc hỏi người cùng bàn.',
          );
        if (Date.now() < Date.parse(supportRetryAt(existing)))
          reject('Chưa đến lúc gọi lại. Vui lòng đợi hết thời gian hiển thị trên nút.', 429);
        await cancelForRetry(c, existing, null);
      } else {
        const recent = (
          await c.query(
            `SELECT x.status,x.created_at,x.acknowledged_at FROM support_request x LEFT JOIN table_session s ON s.id=x.session_id
          WHERE COALESCE(s.table_id,x.table_id)=$1 AND x.request_type='ACCESS_CODE' AND (x.session_id IS NULL OR s.session_status='ACTIVE') ORDER BY x.created_at DESC LIMIT 1`,
            [t.id],
          )
        ).rows[0];
        if (recent && Date.now() < Date.parse(supportRetryAt(recent)))
          reject('Chưa đến lúc gọi lại. Vui lòng đợi hết thời gian hiển thị trên nút.', 429);
      }
      const currentVisit = (
        await c.query(
          "SELECT id FROM table_session WHERE table_id=$1 AND session_status='ACTIVE' AND verification_status='VERIFIED' AND access_code_ciphertext IS NOT NULL",
          [t.id],
        )
      ).rows[0];
      const x = await one(
        c,
        `INSERT INTO support_request(session_id,table_id,request_type,content,visitor_hash,visitor_name,replaces_request_id)
        VALUES($1,$2,'ACCESS_CODE','Khách cần nhân viên đến bàn cung cấp mã vào bàn.',$3,$4,$5) RETURNING *`,
        [
          currentVisit?.id ?? null,
          currentVisit ? null : t.id,
          digest(visitor),
          name,
          existing?.id ?? null,
        ],
      );
      await supportEvent(c, x, 'SUPPORT_REQUEST_CREATED', null, {
        previousRequestId: existing?.id ?? null,
      });
      return { id: x.id, status: x.status, reused: false, retryAt: supportRetryAt(x) };
    });
  });
  app.get('/core/tables/:id/access-code', { config: staffConfig }, (r) =>
    transaction(db, async (c) => {
      await serviceStaff(c, [r.identity!.id], restaurant);
      const t = await one(
        c,
        'SELECT t.id FROM dining_table t JOIN dining_area a ON a.id=t.area_id WHERE t.id=$1 AND t.restaurant_id=$2 AND t.is_active AND a.is_active',
        [idParam(r), restaurant],
      );
      const s = (
        await c.query("SELECT * FROM table_session WHERE table_id=$1 AND session_status='ACTIVE'", [
          t.id,
        ])
      ).rows[0];
      return {
        sessionId: s?.id ?? null,
        accessCode: s && s.verification_status === 'VERIFIED' ? sessionAccessCode(s) : null,
      };
    }),
  );
  app.post('/core/tables/:id/access-code', { config: staffConfig }, (r) =>
    transaction(db, async (c) => {
      await serviceStaff(c, [r.identity!.id], restaurant);
      const t = await one(
        c,
        'SELECT t.* FROM dining_table t JOIN dining_area a ON a.id=t.area_id WHERE t.id=$1 AND t.restaurant_id=$2 AND a.is_active FOR UPDATE OF t',
        [idParam(r), restaurant],
      );
      return issueTableCode(c, t, r.identity!.id);
    }),
  );
  app.post('/core/support/:id/access-code', { config: staffConfig }, (r) =>
    transaction(db, async (c) => {
      await serviceStaff(c, [r.identity!.id], restaurant);
      const x = await lockSupport(c, idParam(r), restaurant);
      requireOwner(x, r.identity!.id);
      if (x.request_type !== 'ACCESS_CODE') reject('Đây không phải yêu cầu cấp mã.', 400);
      const tableId =
        x.table_id ??
        (await one(c, 'SELECT table_id FROM table_session WHERE id=$1', [x.session_id])).table_id;
      const t = await one(
        c,
        'SELECT * FROM dining_table WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',
        [tableId, restaurant],
      );
      const result = await issueTableCode(c, t, r.identity!.id);
      await c.query('UPDATE support_request SET session_id=$2,table_id=NULL WHERE id=$1', [
        x.id,
        result.sessionId,
      ]);
      await supportEvent(
        c,
        { ...x, session_id: result.sessionId },
        'SUPPORT_ACCESS_CODE_ISSUED',
        r.identity!.id,
      );
      return result;
    }),
  );
  app.post('/guest/support/:id/retry', { config: publicConfig }, (r) =>
    transaction(db, async (c) => {
      const p = await guest(c, r, restaurant);
      const x = await one(
        c,
        'SELECT * FROM support_request WHERE id=$1 AND session_id=$2 AND participant_id=$3 FOR UPDATE',
        [idParam(r), p.session_id, p.id],
      );
      if (!['NEW', 'ACKNOWLEDGED'].includes(x.status))
        reject('Yêu cầu đã kết thúc. Gửi yêu cầu mới nếu bạn vẫn cần hỗ trợ.');
      if (Date.now() < Date.parse(supportRetryAt(x)))
        reject('Chưa đến lúc gọi lại. Vui lòng đợi hết thời gian hiển thị trên nút.', 429);
      if (
        x.request_type === 'BILL' &&
        (
          await c.query(
            "SELECT id FROM payment_intent WHERE support_request_id=$1 AND status IN ('CREATED','PENDING') AND expires_at>now()",
            [x.id],
          )
        ).rowCount
      )
        reject(
          'Nhân viên đang xử lý khoản thu. Vui lòng tiếp tục giao dịch hoặc trao đổi trực tiếp; không gọi lại để tránh thu trùng.',
        );
      await cancelForRetry(c, x, p.id);
      const replacement = await one(
        c,
        `INSERT INTO support_request(session_id,participant_id,request_type,payment_method,content,replaces_request_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [p.session_id, p.id, x.request_type, x.payment_method, x.content, x.id],
      );
      await supportEvent(c, replacement, 'SUPPORT_REQUEST_CREATED', null, {
        previousRequestId: x.id,
        requestedByParticipantId: p.id,
      });
      return {
        id: replacement.id,
        status: replacement.status,
        retryAt: supportRetryAt(replacement),
      };
    }),
  );
}
