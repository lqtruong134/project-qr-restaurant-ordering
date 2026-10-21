// Signed webhooks can arrive before GET catches up. Report those funds without
// treating them as recorded/allocated. Replays of one bank reference count once.
export const payosBankReportedJoin = `LEFT JOIN LATERAL (
  SELECT sum(proof.amount) AS amount FROM (
    SELECT e.payload_snapshot->>'reference' AS reference,
      max((e.payload_snapshot->>'amount')::bigint) AS amount
    FROM payment_webhook_event e
    WHERE e.provider='PAYOS' AND e.signature_valid
      AND e.payload_snapshot->>'code'='00' AND e.payload_snapshot->>'currency'='VND'
      AND e.payload_snapshot->>'amount' ~ '^[0-9]{1,12}$'
      AND COALESCE(e.payload_snapshot->>'reference','')<>''
      AND e.payload_snapshot->>'orderCode'=q.order_code::text
      AND e.payload_snapshot->>'paymentLinkId'=q.payment_link_id
      AND e.payload_snapshot->>'restaurantId'=(SELECT t.restaurant_id::text
        FROM table_session s JOIN dining_table t ON t.id=s.table_id WHERE s.id=p.session_id)
    GROUP BY e.payload_snapshot->>'reference'
    HAVING min((e.payload_snapshot->>'amount')::bigint)=max((e.payload_snapshot->>'amount')::bigint)
  ) proof
) reported ON true`;
