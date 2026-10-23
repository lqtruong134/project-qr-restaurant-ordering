import { consumePromotion } from '../finance/pricing.service.js';
import { recalculate } from '../finance/ledger.service.js';
import { digest, money, one, reject, text, type Connection } from '../shared/core-persistence.js';

export type BankVerificationSource = 'PAYOS_VERIFIED' | 'BANK_ADMIN_VERIFIED';
type Intent = {
  id: string;
  session_id: string;
  amount: string;
  collection_scope: string;
  payer_participant_id: string | null;
};
type BankIdentity = {
  restaurantId: string;
  reference: string;
  receiverDigest?: string;
  paymentIntentId: string;
  amount: string;
  receiptId?: string;
};

/** The stable receiver identity is never an account suffix, a UI value, or a channel ID. */
export function bankReceiverDigest(bankBin: string, accountNumber: string) {
  if (!/^\d{6}$/.test(bankBin) || !/^\d{6,34}$/.test(accountNumber))
    reject('Chưa cấu hình tài khoản ngân hàng nhận tiền tin cậy.', 409);
  return digest(bankBin + ':' + accountNumber);
}

/** Acquire all identities in one stable order before handling a multi-receipt snapshot. */
export async function lockBankReferences(
  c: Connection,
  inputs: Array<Pick<BankIdentity, 'restaurantId' | 'reference' | 'receiverDigest'>>,
) {
  const keys = new Set<string>();
  for (const input of inputs) {
    const reference = text(input.reference, 160);
    if (reference !== input.reference || /\p{Cc}/u.test(reference))
      reject('Mã tham chiếu ngân hàng không hợp lệ.', 400);
    if (input.receiverDigest && !/^[a-f0-9]{64}$/.test(input.receiverDigest))
      reject('Định danh tài khoản nhận tiền không hợp lệ.', 400);
    keys.add('PAYOS:' + reference);
    keys.add(input.restaurantId + ':bank:' + reference);
    if (input.receiverDigest) keys.add('BANK:' + input.receiverDigest + ':' + reference);
  }
  for (const key of [...keys].sort())
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
}

/** Call with the session and payment intent already locked, before inserting money. */
export async function assertBankReferenceAvailable(c: Connection, input: BankIdentity) {
  const reference = input.reference;
  await lockBankReferences(c, [input]);
  const claims = input.receiverDigest
    ? (
        await c.query(
          `SELECT r.*,p.session_id FROM bank_receipt_claim r
         JOIN payment_transaction p ON p.id=r.receipt_id
         WHERE r.receiver_digest=$1 AND r.bank_reference=$2 FOR UPDATE OF r`,
          [input.receiverDigest, reference],
        )
      ).rows
    : [];
  const receipts = (
    await c.query(
      `SELECT p.id AS receipt_id,p.payment_intent_id,p.amount,p.method,p.provider,t.restaurant_id,
       p.metadata->>'bankReceiverDigest' AS receiver_digest
     FROM payment_transaction p JOIN table_session s ON s.id=p.session_id
     JOIN dining_table t ON t.id=s.table_id
     WHERE p.status='SUCCEEDED' AND (
       (p.provider='PAYOS' AND p.provider_transaction_id=$1) OR
       (p.method='BANK_TRANSFER' AND p.metadata->>'reference'=$1 AND
         (t.restaurant_id=$2 OR ($3::text IS NOT NULL AND p.metadata->>'bankReceiverDigest'=$3)))
     ) FOR UPDATE OF p`,
      [reference, input.restaurantId, input.receiverDigest ?? null],
    )
  ).rows;
  for (const existing of [...claims, ...receipts]) {
    if (
      (existing.method === 'BANK_TRANSFER' && !input.receiptId) ||
      existing.payment_intent_id !== input.paymentIntentId ||
      existing.restaurant_id !== input.restaurantId ||
      BigInt(existing.amount) !== BigInt(input.amount) ||
      (input.receiptId && existing.receipt_id !== input.receiptId) ||
      (input.receiverDigest &&
        existing.receiver_digest &&
        existing.receiver_digest !== input.receiverDigest)
    )
      reject('Tham chiếu ngân hàng đã thuộc khoản thu khác hoặc có bằng chứng không khớp.');
  }
  return receipts[0]?.receipt_id as string | undefined;
}

export async function registerBankReceiptClaim(
  c: Connection,
  input: BankIdentity & { receiverDigest: string; receiptId: string },
) {
  await assertBankReferenceAvailable(c, input);
  const existing = (
    await c.query('SELECT id FROM bank_receipt_claim WHERE receipt_id=$1', [input.receiptId])
  ).rows[0];
  if (existing) {
    const same = (
      await c.query(
        `SELECT id FROM bank_receipt_claim WHERE receipt_id=$1 AND receiver_digest=$2
       AND bank_reference=$3 AND restaurant_id=$4 AND payment_intent_id=$5 AND amount=$6`,
        [
          input.receiptId,
          input.receiverDigest,
          input.reference,
          input.restaurantId,
          input.paymentIntentId,
          input.amount,
        ],
      )
    ).rows[0];
    if (!same) reject('Giao dịch đã gắn với chứng cứ ngân hàng khác.');
    return;
  }
  await c.query(
    `INSERT INTO bank_receipt_claim(receiver_digest,bank_reference,restaurant_id,payment_intent_id,receipt_id,amount)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      input.receiverDigest,
      input.reference,
      input.restaurantId,
      input.paymentIntentId,
      input.receiptId,
      input.amount,
    ],
  );
}

/**
 * Both authenticated provider evidence and independent ADMIN bank evidence use
 * this posting path. Its caller owns lifecycle decisions; this function never
 * changes a provider status or infers a refund from an unallocated balance.
 */
export async function postPayosReceipt(
  c: Connection,
  input: {
    pi: Intent;
    restaurantId: string;
    reference: string;
    amount: string | bigint;
    metadata: Record<string, unknown>;
    verificationSource: BankVerificationSource;
    actorId?: string;
    receiverDigest?: string;
  },
) {
  const { pi } = input;
  const amount = money(String(input.amount));
  const identity = { ...input, amount, paymentIntentId: pi.id };
  const existingId = await assertBankReferenceAvailable(c, identity);
  if (existingId) {
    if (input.receiverDigest)
      await registerBankReceiptClaim(c, {
        ...identity,
        receiverDigest: input.receiverDigest,
        receiptId: existingId,
      });
    const allocated = await one(
      c,
      `SELECT COALESCE(sum(allocated_amount),0)::text AS amount FROM payment_allocation
       WHERE payment_transaction_id=$1`,
      [existingId],
    );
    return {
      receiptId: existingId,
      created: false,
      appliedAmount: allocated.amount as string,
      anomaly: BigInt(allocated.amount) < BigInt(amount),
    };
  }
  const active = await one(
    c,
    `SELECT s.session_status FROM table_session s JOIN dining_table t ON t.id=s.table_id
     WHERE s.id=$1 AND t.restaurant_id=$2`,
    [pi.session_id, input.restaurantId],
  );
  if (active.session_status !== 'ACTIVE') reject('Phiên đã chốt; xử lý qua đối soát ngoài phiếu.');
  const account = await recalculate(c, pi.session_id);
  const captured = await one(
    c,
    `SELECT COALESCE(sum(amount),0)::text AS amount FROM payment_transaction
     WHERE payment_intent_id=$1 AND status='SUCCEEDED'`,
    [pi.id],
  );
  const remaining =
    BigInt(pi.amount) > BigInt(captured.amount) ? BigInt(pi.amount) - BigInt(captured.amount) : 0n;
  const payment = await one(
    c,
    `INSERT INTO payment_transaction(payment_intent_id,session_id,method,provider,provider_transaction_id,
      amount,status,confirmed_by,confirmed_at,metadata)
     VALUES($1,$2,'ONLINE','PAYOS',$3,$4,'SUCCEEDED',$5,now(),$6) RETURNING *`,
    [
      pi.id,
      pi.session_id,
      input.reference,
      amount,
      input.actorId ?? null,
      JSON.stringify({
        ...input.metadata,
        collectionScope: pi.collection_scope,
        payerParticipantId: pi.payer_participant_id,
        verificationSource: input.verificationSource,
        verificationPolicyVersion: 1,
        ...(input.receiverDigest ? { bankReceiverDigest: input.receiverDigest } : {}),
      }),
    ],
  );
  if (input.receiverDigest)
    await registerBankReceiptClaim(c, {
      ...identity,
      receiverDigest: input.receiverDigest,
      receiptId: payment.id,
    });
  const safeLimit = BigInt(amount) < remaining ? BigInt(amount) : remaining;
  let left =
    safeLimit < BigInt(account.outstanding_amount) ? safeLimit : BigInt(account.outstanding_amount);
  const target = left;
  const charges = (
    await c.query(
      `SELECT f.id,f.amount-f.discount_amount-COALESCE((SELECT sum(allocated_amount-reversed_amount)
      FROM payment_allocation WHERE financial_charge_id=f.id),0) AS remaining
     FROM financial_charge f WHERE f.session_id=$1 AND f.status='ACTIVE'
     AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM order_item i WHERE i.id=f.order_item_id
       AND i.owner_participant_id=$2)) ORDER BY f.created_at,f.id FOR UPDATE`,
      [pi.session_id, pi.collection_scope === 'PARTICIPANT' ? pi.payer_participant_id : null],
    )
  ).rows;
  for (const charge of charges) {
    if (!left) break;
    const available = BigInt(charge.remaining);
    if (available <= 0n) continue;
    const part = left < available ? left : available;
    await c.query(
      'INSERT INTO payment_allocation(payment_transaction_id,financial_charge_id,allocated_amount) VALUES($1,$2,$3)',
      [payment.id, charge.id, part.toString()],
    );
    left -= part;
  }
  await consumePromotion(c, pi.session_id);
  await recalculate(c, pi.session_id);
  await c.query(
    `INSERT INTO outbox_event(aggregate_type,payment_transaction_id,event_type,payload)
     VALUES('PAYMENT_TRANSACTION',$1,'PAYMENT_RECEIVED',$2)`,
    [
      payment.id,
      JSON.stringify({
        sessionId: pi.session_id,
        provider: 'PAYOS',
        verificationSource: input.verificationSource,
      }),
    ],
  );
  await c.query(
    `INSERT INTO business_audit_event(restaurant_id,actor_id,action,resource_type,resource_id,reason,details,actor_type)
     VALUES($1,$2,$3,'PAYMENT_INTENT',$4,$5,$6,CASE WHEN $2::uuid IS NULL THEN 'SYSTEM' ELSE 'USER' END)`,
    [
      input.restaurantId,
      input.actorId ?? null,
      input.verificationSource === 'PAYOS_VERIFIED'
        ? 'PAYOS_BANK_PAYMENT_RECEIVED'
        : 'BANK_ADMIN_PAYMENT_RECEIVED',
      pi.id,
      input.verificationSource === 'PAYOS_VERIFIED'
        ? 'payOS xác nhận tiền đã vào tài khoản'
        : 'Quản trị đã đối chiếu tiền thực nhận từ ngân hàng',
      JSON.stringify({
        sessionId: pi.session_id,
        paymentId: payment.id,
        amount,
        reference: input.reference,
        verificationSource: input.verificationSource,
      }),
    ],
  );
  return {
    receiptId: payment.id as string,
    created: true,
    appliedAmount: (target - left).toString(),
    anomaly: left > 0n || target < BigInt(amount),
  };
}
