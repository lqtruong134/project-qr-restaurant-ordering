# CORE45 — Rehearsal evidence
2026-09-23T17:35:25.542Z
Each run creates its own empty database; existing development data is untouched.
## Run 1 — PASS
- Empty DB migrate: PASS
- Seed twice + migration rerun preserve data: PASS
- Three logins / 3 allow / 6 deny: PASS
- Sample VND catalog query (24 dishes): PASS
```json
{
  "app_user": 8,
  "cart_item": 0,
  "dining_area": 3,
  "dining_table": 16,
  "financial_charge": 0,
  "goods_receipt": 1,
  "goods_receipt_item": 32,
  "idempotency_record": 0,
  "ingredient": 32,
  "inventory_balance": 32,
  "inventory_movement": 32,
  "inventory_reservation": 0,
  "menu_category": 6,
  "operational_alert": 0,
  "order_batch": 0,
  "order_item": 0,
  "order_item_ingredient_snapshot": 0,
  "order_review": 0,
  "order_risk_assessment": 0,
  "order_status_history": 0,
  "outbox_event": 0,
  "outstanding_balance_case": 0,
  "payment_allocation": 0,
  "payment_intent": 0,
  "payment_transaction": 0,
  "payment_webhook_event": 0,
  "permission": 3,
  "product": 24,
  "recipe_bom": 24,
  "recipe_bom_item": 94,
  "refund_case": 0,
  "refund_transaction": 0,
  "restaurant": 1,
  "risk_policy_config": 0,
  "role": 3,
  "role_permission": 3,
  "session_cart": 0,
  "session_financial_account": 0,
  "session_participant": 0,
  "stock_location": 1,
  "support_request": 0,
  "table_qr_token": 0,
  "table_session": 0,
  "unit_of_measure": 3,
  "user_role": 8
}
```
## Run 2 — PASS
- Empty DB migrate: PASS
- Seed twice + migration rerun preserve data: PASS
- Three logins / 3 allow / 6 deny: PASS
- Sample VND catalog query (24 dishes): PASS
```json
{
  "app_user": 8,
  "cart_item": 0,
  "dining_area": 3,
  "dining_table": 16,
  "financial_charge": 0,
  "goods_receipt": 1,
  "goods_receipt_item": 32,
  "idempotency_record": 0,
  "ingredient": 32,
  "inventory_balance": 32,
  "inventory_movement": 32,
  "inventory_reservation": 0,
  "menu_category": 6,
  "operational_alert": 0,
  "order_batch": 0,
  "order_item": 0,
  "order_item_ingredient_snapshot": 0,
  "order_review": 0,
  "order_risk_assessment": 0,
  "order_status_history": 0,
  "outbox_event": 0,
  "outstanding_balance_case": 0,
  "payment_allocation": 0,
  "payment_intent": 0,
  "payment_transaction": 0,
  "payment_webhook_event": 0,
  "permission": 3,
  "product": 24,
  "recipe_bom": 24,
  "recipe_bom_item": 94,
  "refund_case": 0,
  "refund_transaction": 0,
  "restaurant": 1,
  "risk_policy_config": 0,
  "role": 3,
  "role_permission": 3,
  "session_cart": 0,
  "session_financial_account": 0,
  "session_participant": 0,
  "stock_location": 1,
  "support_request": 0,
  "table_qr_token": 0,
  "table_session": 0,
  "unit_of_measure": 3,
  "user_role": 8
}
```
