import {
  readPayosTestArchives,
  requireOperationalPayosIntent,
} from './test-case-archive.service.js';
import { PayosService } from './payos.service.js';
import { completionStatus } from './completion.service.js';
import { readRefundContext } from './refund-context.service.js';
import { requireRefundSourceBudget } from './refund-budget.service.js';
import { approveRefund, requireRefundApproval } from './refund-approval.service.js';
import { createIntent, confirmPayment } from './collection.service.js';
import { requireCollectionOwner } from './payment-requests.routes.js';
import { registerPaymentRequests } from './payment-requests.routes.js';
import { registerBankEvidence } from './bank-evidence.routes.js';
import { registerPaymentProofs } from './payment-proof.routes.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '@thesis/database';
import {
  guest,
  idParam,
  money,
  object,
  one,
  reject,
  session,
  text,
  transaction,
  uuid,
} from '../shared/core-persistence.js';
import { readBill } from './receipt.service.js';
import { recalculate } from '../finance/ledger.service.js';
// Domain retries must remain 503 (the generic handler intentionally hides 5xx).
// Only fixed public domain messages are exposed; provider exceptions never reach clients.
async function providerAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<unknown>,
) {
  try {
    return await action();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 503 &&
      'publicMessage' in error &&
      typeof error.publicMessage === 'string'
    )
      return reply.header('Retry-After', '3').code(503).send({
        errorCode: 'PAYMENT_PROVIDER_UNAVAILABLE',
        userMessage: error.publicMessage,
        correlationId: request.id,
      });
    throw error;
  }
}
export function registerFinance(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  payos: PayosService = new PayosService(db, restaurant),
) {
  payos.setLogger(app.log);
  registerPaymentRequests(app, db, restaurant, payos.capabilities.online);
  registerPaymentProofs(app, db, restaurant);
  registerBankEvidence(app, db, restaurant, payos);
  const staff = { permission: 'staff.workspace' };
  const finance = { permission: ['staff.workspace', 'admin.workspace'] };
  app.get('/core/sessions/:id/bill', { config: finance }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant, false);
      return { ...(await readBill(c, s, restaurant)), paymentCapabilities: payos.capabilities };
    }),
  );
  app.get(
    '/core/receipts',
    { config: staff },
    async () =>
      (
        await db.pool.query(
          `SELECT s.id,s.receipt_number,s.opened_at,s.closed_at,s.close_reason,t.code AS table_code,
    COALESCE(s.receipt_snapshot->'account'->>'charge_total',a.charge_total::text,'0') AS total_amount,
    u.display_name AS closed_by_name FROM table_session s JOIN dining_table t ON t.id=s.table_id
    LEFT JOIN session_financial_account a ON a.session_id=s.id LEFT JOIN app_user u ON u.id=s.closed_by
    WHERE t.restaurant_id=$1 AND s.session_status='CLOSED' ORDER BY s.closed_at DESC LIMIT 100`,
          [restaurant],
        )
      ).rows,
  );
  app.post('/guest/payments', { config: { public: true } }, async (r) =>
    transaction(db, async (c) => {
      await guest(c, r, restaurant);
      reject(
        'Vui lòng gọi nhân viên thu tiền qua mục Thanh toán; khách không tự tạo khoản thu.',
        403,
      );
    }),
  );
  app.post('/core/sessions/:id/payments', { config: staff }, async (r, reply) => {
    const body = object(r.body);
    return body.method === 'ONLINE'
      ? providerAction(r, reply, () => payos.create(idParam(r), r.identity!.id, body))
      : transaction(db, (c) =>
          createIntent(c, idParam(r), restaurant, { type: 'USER', id: r.identity!.id }, body),
        );
  });
  app.post('/core/payments/:id/refresh', { config: staff }, (r, reply) =>
    providerAction(r, reply, () => payos.refresh(idParam(r), r.identity!.id)),
  );
  app.post(
    '/payments/webhooks/payos',
    { config: { public: true, externalWebhook: true }, bodyLimit: 64 * 1024 },
    (r, reply) => providerAction(r, reply, () => payos.webhook(r.body)),
  );
  app.get('/core/admin/payment-test-archives', { config: { permission: 'admin.workspace' } }, () =>
    readPayosTestArchives(db, restaurant),
  );
  app.get('/core/admin/payment-reconciliation', { config: { permission: 'admin.workspace' } }, () =>
    payos.cases(),
  );
  app.post(
    '/core/admin/payment-reconciliation/:id/resolve',
    { config: { permission: 'admin.workspace' } },
    (r) => payos.resolve(idParam(r), r.identity!.id, object(r.body)),
  );
  app.post(
    '/core/admin/payment-reconciliation/:id/refresh',
    { config: { permission: 'admin.workspace' } },
    (r, reply) => providerAction(r, reply, () => payos.refreshForAdmin(idParam(r), r.identity!.id)),
  );
  app.post(
    '/core/admin/payment-reconciliation/:id/acknowledge',
    { config: { permission: 'admin.workspace' } },
    (r) =>
      transaction(db, async (c) => {
        const intent = await one(
          c,
          'SELECT p.id,p.session_id FROM payment_intent p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.id=$1 AND t.restaurant_id=$2',
          [idParam(r), restaurant],
        );
        await session(c, intent.session_id, restaurant, false);
        await requireOperationalPayosIntent(c, restaurant, intent.id);
        const q = await one(
          c,
          'SELECT * FROM payos_payment_request WHERE payment_intent_id=$1 FOR UPDATE',
          [intent.id],
        );
        if (q.reconciliation_status !== 'OPEN') reject('Hồ sơ không còn trong hàng đợi cần xử lý.');
        const existing = await c.query(
          "SELECT id FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_RECONCILIATION_ACKNOWLEDGED' AND created_at>=COALESCE((SELECT max(created_at) FROM business_audit_event WHERE resource_id=$1 AND action='PAYOS_RECONCILIATION_REQUIRED'),'-infinity'::timestamptz)",
          [intent.id],
        );
        if (existing.rowCount) return { status: 'ok', alreadyProcessed: true };
        await c.query(
          "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details,actor_type) VALUES($1,$2,'PAYOS_RECONCILIATION_ACKNOWLEDGED','PAYMENT_INTENT',$3,'Đã tiếp nhận ngoại lệ; chưa xác nhận thu hoặc hoàn tiền',$4,'USER')",
          [restaurant, r.identity!.id, intent.id, JSON.stringify({ sessionId: intent.session_id })],
        );
        return { status: 'ok', acknowledged: true };
      }),
  );
  app.post('/core/payments/:id/confirm', { config: staff }, (r) =>
    transaction(db, (c) =>
      confirmPayment(c, idParam(r), restaurant, r.identity!.id, object(r.body)),
    ),
  );
  app.post('/core/payment-transactions/:id/change-returned', { config: staff }, (r) =>
    transaction(db, async (c) => {
      const p = await one(
        c,
        'SELECT p.* FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE p.id=$1 AND t.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      await session(c, p.session_id, restaurant);
      if (
        p.method !== 'CASH' ||
        p.status !== 'SUCCEEDED' ||
        BigInt(p.metadata?.changeGiven ?? 0) <= 0n
      )
        reject('Giao dịch này không có tiền thừa cần trả lại.');
      const old = (
        await c.query(
          "SELECT id FROM business_audit_event WHERE resource_id=$1 AND action='CASH_CHANGE_RETURNED'",
          [p.id],
        )
      ).rows[0];
      if (old) return { status: 'ok', alreadyProcessed: true };
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'CASH_CHANGE_RETURNED','PAYMENT_TRANSACTION',$3,'Đã trả tiền thừa cho khách',$4)",
        [
          restaurant,
          r.identity!.id,
          p.id,
          JSON.stringify({ sessionId: p.session_id, amount: p.metadata.changeGiven }),
        ],
      );
      return { status: 'ok' };
    }),
  );
  app.post('/core/sessions/:id/receipt-provided', { config: staff }, (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant),
        b = object(r.body);
      if (
        !['PRINTED', 'DECLINED'].includes(String(b.delivery)) ||
        !['standard', 'detailed'].includes(String(b.layout))
      )
        reject('Chọn cách giao phiếu hợp lệ.', 400);
      const status = await completionStatus(c, s.id);
      const account = await recalculate(c, s.id);
      if (
        BigInt(account.outstanding_amount) > 0n ||
        BigInt(account.refund_due_amount) > 0n ||
        status.pendingChange.length
      )
        reject('Hoàn tất thu, hoàn tiền và trả tiền thừa trước khi xác nhận phiếu.');
      if (b.billKey !== status.receiptKey)
        reject(
          'Thông tin phiếu đã thay đổi. Dữ liệu đã được làm mới; hãy kiểm tra và giao lại phiếu.',
        );
      if (status.receiptDelivery) return { status: 'ok', alreadyProcessed: true };
      await c.query(
        "INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details) VALUES($1,$2,'RECEIPT_PROVIDED','TABLE_SESSION',$3,$4,$5)",
        [
          restaurant,
          r.identity!.id,
          s.id,
          b.delivery === 'PRINTED' ? 'Đã in và giao phiếu cho khách' : 'Khách không cần phiếu giấy',
          JSON.stringify({ billKey: status.receiptKey, layout: b.layout, delivery: b.delivery }),
        ],
      );
      return { status: 'ok' };
    }),
  );
  app.post('/core/payments/:id/cancel', { config: staff }, async (r, reply) => {
    const target = await db.pool.query('SELECT provider FROM payment_intent WHERE id=$1', [
      idParam(r),
    ]);
    if (target.rows[0]?.provider === 'PAYOS')
      return providerAction(r, reply, () => payos.cancel(idParam(r), r.identity!.id));
    return transaction(db, async (c) => {
      const id = idParam(r),
        pi = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [id]);
      await session(c, pi.session_id, restaurant);
      const current = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [id]);
      if (current.status === 'CANCELLED') return current;
      if (current.support_request_id)
        await requireCollectionOwner(c, pi.session_id, current.support_request_id, r.identity!.id);
      const result = await one(
        c,
        "UPDATE payment_intent SET status='CANCELLED',version=version+1 WHERE id=$1 AND status IN ('CREATED','PENDING') RETURNING *",
        [id],
      );
      await recalculate(c, pi.session_id);
      return result;
    });
  });
  app.post('/core/sessions/:id/refunds', { config: { permission: 'admin.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const sid = idParam(r),
        b = object(r.body);
      await session(c, sid, restaurant, false);
      const requestKey = b.requestId === undefined ? null : text(b.requestId, 100);
      if (requestKey) {
        const old = (
          await c.query('SELECT * FROM refund_case WHERE session_id=$1 AND request_key=$2', [
            sid,
            requestKey,
          ])
        ).rows[0];
        if (old) {
          if (
            String(old.amount) !== money(b.amount) ||
            old.source_payment_transaction_id !== uuid(b.paymentId) ||
            (b.useDecisionReason !== true && old.reason !== text(b.reason, 300))
          )
            reject('Mã gửi lại đã dùng cho nội dung hoàn tiền khác.');
          return approveRefund(c, old.id, restaurant, r.identity!.id);
        }
      }
      const source = await requireRefundSourceBudget(c, sid, uuid(b.paymentId));
      const context =
        b.useDecisionReason === true && source.refund_context_kind === 'BILL_ADJUSTMENT'
          ? await readRefundContext(c, sid, source.id)
          : null;
      if (b.useDecisionReason === true && !context)
        reject(
          'Nguồn thu này cần nhập lý do hoàn riêng; không tự dùng lý do hủy món của cả phiên.',
        );
      const refundReason = context ? context.reason : text(b.reason, 300);
      const a = await recalculate(c, sid);
      const pending = await one(
        c,
        "SELECT COALESCE(sum(f.amount-COALESCE((SELECT sum(t.amount) FROM refund_transaction t WHERE t.refund_case_id=f.id AND t.status='SUCCEEDED'),0)),0) AS amount FROM refund_case f WHERE session_id=$1 AND status IN ('OPEN','IN_PROGRESS')",
        [sid],
      );
      const amount = money(b.amount);
      if (BigInt(amount) > BigInt(a.refund_due_amount) - BigInt(pending.amount))
        reject('Số tiền vượt số dư cần hoàn chưa lập hồ sơ.');
      const sourceRemaining = BigInt(source.available_refund_amount);
      if (BigInt(amount) > sourceRemaining)
        reject(
          'Giao dịch đã chọn chỉ còn có thể lập phiếu hoàn ' +
            sourceRemaining.toLocaleString('vi-VN') +
            ' đ. Tiền đang phân bổ cho món chưa hủy không thể hoàn từ giao dịch này.',
        );
      const refund = await one(
        c,
        'INSERT INTO refund_case(session_id,source_payment_transaction_id,amount,reason,assigned_staff_id,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [sid, source.id, amount, refundReason, r.identity!.id, requestKey],
      );
      return approveRefund(c, refund.id, restaurant, r.identity!.id);
    }),
  );
  app.post('/core/refunds/:id/approve', { config: { permission: 'admin.workspace' } }, (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        f = await one(c, 'SELECT session_id FROM refund_case WHERE id=$1', [id]);
      await session(c, f.session_id, restaurant, false);
      return approveRefund(c, id, restaurant, r.identity!.id);
    }),
  );
  app.post('/core/refunds/:id/complete', { config: staff }, async (r) =>
    transaction(db, async (c) => {
      const id = idParam(r),
        b = object(r.body),
        e = await one(c, 'SELECT session_id FROM refund_case WHERE id=$1', [id]);
      await session(c, e.session_id, restaurant, false);
      await one(c, 'SELECT * FROM refund_case WHERE id=$1 FOR UPDATE', [id]);
      const f = await requireRefundApproval(c, id);
      const key = b.requestId === undefined ? 'legacy-complete' : text(b.requestId, 100);
      const old = (
        await c.query(
          'SELECT * FROM refund_transaction WHERE refund_case_id=$1 AND request_key=$2',
          [id, key],
        )
      ).rows[0];
      if (old) {
        if (
          (b.amount !== undefined && money(b.amount) !== String(old.amount)) ||
          b.method !== old.method ||
          (old.method === 'BANK_TRANSFER' && b.reference !== old.reference)
        )
          reject('Mã gửi lại đã dùng cho nội dung hoàn tiền khác.');
        return old;
      }
      if (['RESOLVED_CASH', 'RESOLVED_TRANSFER'].includes(f.status)) return f;
      const totals = await one(
        c,
        "SELECT COALESCE(sum(amount),0) AS amount FROM refund_transaction WHERE refund_case_id=$1 AND status='SUCCEEDED'",
        [id],
      );
      const remaining = BigInt(f.amount) - BigInt(totals.amount);
      const amount = b.amount === undefined ? remaining.toString() : money(b.amount);
      if (BigInt(amount) > remaining) reject('Số tiền vượt phần còn phải hoàn của hồ sơ.');
      if (!['OPEN', 'IN_PROGRESS'].includes(f.status)) reject('Hồ sơ hoàn đã đóng.');
      const a = await recalculate(c, f.session_id);
      if (BigInt(amount) > BigInt(a.refund_due_amount)) reject('Số dư cần hoàn đã thay đổi.');
      const source = await requireRefundSourceBudget(
        c,
        f.session_id,
        f.source_payment_transaction_id,
        id,
      );
      if (BigInt(amount) > BigInt(source.available_refund_amount))
        reject(
          'Nguồn thu không còn đủ tiền chưa phân bổ để hoàn. Tải lại hồ sơ trước khi trả tiền.',
        );
      const method = text(b.method);
      if (!['CASH', 'BANK_TRANSFER'].includes(method))
        reject('Chọn tiền mặt hoặc chuyển khoản.', 400);
      const reference = method === 'BANK_TRANSFER' ? text(b.reference, 120) : null;
      await c.query(
        "INSERT INTO refund_transaction(refund_case_id,method,amount,reference,status,processed_by,processed_at,request_key) VALUES($1,$2,$3,$4,'SUCCEEDED',$5,now(),$6)",
        [id, method, amount, reference, r.identity!.id, key],
      );
      await c.query('UPDATE refund_case SET status=$2,resolution_method=$3 WHERE id=$1', [
        id,
        BigInt(amount) < remaining
          ? 'IN_PROGRESS'
          : method === 'CASH'
            ? 'RESOLVED_CASH'
            : 'RESOLVED_TRANSFER',
        method,
      ]);
      const balance = await recalculate(c, f.session_id);
      if (BigInt(balance.refund_due_amount) === 0n)
        await c.query(
          "UPDATE operational_alert SET status='RESOLVED',outstanding_amount=0,resolved_at=now(),resolved_by=$2,resolution_note='Đã ghi nhận hoàn đủ tiền cho khách' WHERE session_id=$1 AND alert_type='REFUND_REQUIRED' AND status<>'RESOLVED'",
          [f.session_id, r.identity!.id],
        );
      return { status: 'ok' };
    }),
  );
  app.get('/core/reports/sessions/:id', { config: { permission: 'admin.workspace' } }, async (r) =>
    transaction(db, async (c) => {
      const s = await session(c, idParam(r), restaurant, false);
      return {
        bill: await readBill(c, s, restaurant),
        exceptions: (
          await c.query(
            `SELECT e.action,e.reason,e.created_at,u.display_name FROM business_audit_event e LEFT JOIN app_user u ON u.id=e.actor_id WHERE e.restaurant_id=$2 AND (e.resource_id=$1 OR e.resource_id IN (SELECT i.id FROM order_item i JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=$1)) ORDER BY e.created_at`,
            [s.id, restaurant],
          )
        ).rows,
      };
    }),
  );
  app.get('/core/reports', { config: { permission: 'admin.workspace' } }, async () => ({
    reconciliation: (
      await db.pool.query(
        `SELECT s.id,s.receipt_number,t.code AS table_code,s.opened_at,s.closed_at,
      COALESCE((SELECT sum(amount-discount_amount) FROM financial_charge WHERE session_id=s.id AND status='ACTIVE'),0)::text AS payable,
      COALESCE((SELECT sum(amount) FROM payment_transaction WHERE session_id=s.id AND status='SUCCEEDED'),0)::text AS collected,
      COALESCE((SELECT sum(rt.amount) FROM refund_transaction rt JOIN refund_case f ON f.id=rt.refund_case_id WHERE f.session_id=s.id AND rt.status='SUCCEEDED'),0)::text AS refunded,
      COALESCE((SELECT sum(outstanding_amount) FROM outstanding_balance_case WHERE session_id=s.id AND status='WRITTEN_OFF'),0)::text AS written_off,
      COALESCE((SELECT sum(f.amount-f.discount_amount) FROM financial_charge f WHERE f.session_id=s.id AND f.status='REVERSED'),0)::text AS reversed,
      COALESCE((SELECT sum((e.details->>'consumedCost')::bigint) FROM business_audit_event e JOIN order_item i ON i.id=e.resource_id JOIN order_batch b ON b.id=i.order_batch_id WHERE b.session_id=s.id AND e.action='LATE_CANCEL'),0)::text AS stock_loss
      FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 ORDER BY s.opened_at DESC`,
        [restaurant],
      )
    ).rows,

    store: (await db.pool.query('SELECT name,address FROM restaurant WHERE id=$1', [restaurant]))
      .rows[0],
    sales: (
      await db.pool.query(
        `SELECT i.product_id,i.product_name_snapshot,sum(i.quantity)::text AS quantity,sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END)::text AS sales,sum(i.line_total)::text AS original_sales,COALESCE(sum((SELECT sum(s.cogs_value) FROM order_item_ingredient_snapshot s WHERE s.order_item_id=i.id)),0)::text AS cost FROM order_item i LEFT JOIN financial_charge f ON f.order_item_id=i.id AND f.charge_type='ITEM' JOIN order_batch b ON b.id=i.order_batch_id JOIN table_session s ON s.id=b.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND i.status='SERVED' GROUP BY i.product_id,i.product_name_snapshot ORDER BY sum(CASE WHEN f.status='ACTIVE' THEN f.amount-f.discount_amount ELSE 0 END) DESC`,
        [restaurant],
      )
    ).rows,
    payments: (
      await db.pool.query(
        "SELECT method,sum(amount)::text AS amount FROM payment_transaction p JOIN table_session s ON s.id=p.session_id JOIN dining_table t ON t.id=s.table_id WHERE t.restaurant_id=$1 AND p.status='SUCCEEDED' GROUP BY method",
        [restaurant],
      )
    ).rows,
  }));
}
