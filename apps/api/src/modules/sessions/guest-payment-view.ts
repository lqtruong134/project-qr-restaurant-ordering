import type { GuestOnlinePayment, PayosStatus } from '@thesis/contracts';
import { digest, type Connection } from '../shared/core-persistence.js';

type GuestPaymentRow = {
  id: string;
  collection_scope: 'TABLE' | 'PARTICIPANT';
  amount: string;
  status: PayosStatus;
  recorded_amount: string;
  bank_confirmed_amount: string;
  expires_at: Date | string;
  created_at: Date | string;
  support_request_id: string | null;
};

// This is a display key only. Guest APIs never accept it as a payment or bank reference.
export function guestOnlinePaymentView(
  row: GuestPaymentRow,
  participantId: string,
): GuestOnlinePayment {
  const amount = BigInt(row.amount);
  const paid = BigInt(row.recorded_amount);
  return {
    id: digest('guest-online:' + row.id + ':' + participantId),
    scope: row.collection_scope,
    amount: amount.toString(),
    status: row.status,
    paidAmount: paid.toString(),
    bankConfirmedAmount: BigInt(row.bank_confirmed_amount).toString(),
    remainingAmount: (amount > paid ? amount - paid : 0n).toString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.support_request_id ? { supportRequestId: row.support_request_id } : {}),
  };
}

export async function readGuestOnlinePayments(
  c: Connection,
  sessionId: string,
  participantId: string,
  restaurantId: string,
): Promise<GuestOnlinePayment[]> {
  const { rows } = await c.query<GuestPaymentRow>(
    `SELECT p.id,p.collection_scope,p.amount::text,q.status,
      COALESCE((SELECT sum(t.amount) FROM payment_transaction t
        WHERE t.payment_intent_id=p.id AND t.session_id=p.session_id
          AND t.provider='PAYOS' AND t.status='SUCCEEDED'),0)::text AS recorded_amount,
      q.paid_amount::text AS bank_confirmed_amount,p.expires_at,p.created_at,
      own_request.id AS support_request_id
     FROM payment_intent p JOIN payos_payment_request q ON q.payment_intent_id=p.id
     JOIN table_session s ON s.id=p.session_id
     JOIN dining_table t ON t.id=s.table_id
     LEFT JOIN support_request own_request ON own_request.id=p.support_request_id
       AND own_request.session_id=p.session_id AND own_request.participant_id=$2
     WHERE p.session_id=$1 AND t.restaurant_id=$3 AND p.method='ONLINE' AND p.provider='PAYOS'
       AND (p.collection_scope='TABLE'
         OR (p.collection_scope='PARTICIPANT' AND p.payer_participant_id=$2))
     ORDER BY (q.status IN ('CREATE_PENDING','PENDING','PROCESSING','UNDERPAID',
       'CANCEL_PENDING','ERROR','REQUIRES_RECONCILIATION')) DESC,p.created_at DESC,p.id
     LIMIT 50`,
    [sessionId, participantId, restaurantId],
  );
  return rows.map((row) => guestOnlinePaymentView(row, participantId));
}
