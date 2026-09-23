# CORE45 — Rehearsal evidence
2026-09-23T00:34:30.104Z
Each run creates its own empty database; existing development data is untouched.
## Run 1 — PASS
- Empty DB migrate: PASS
- Seed twice + migration rerun preserve data: PASS
- Three logins / 3 allow / 6 deny: PASS
- Sample VND query: PASS
```json
{
  "app_user": 3,
  "cart_item": 0,
  "dining_area": 1,
  "dining_table": 3,
  "financial_charge": 0,
  "goods_receipt": 0,
  "goods_receipt_item": 0,
  "idempotency_record": 0,
  "ingredient": 0,
  "inventory_balance": 0,
  "inventory_movement": 0,
  "inventory_reservation": 0,
  "menu_category": 1,
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
  "product": 3,
  "recipe_bom": 0,
  "recipe_bom_item": 0,
  "refund_case": 0,
  "refund_transaction": 0,
  "restaurant": 1,
  "risk_policy_config": 0,
  "role": 3,
  "role_permission": 3,
  "session_cart": 1,
  "session_financial_account": 0,
  "session_participant": 1,
  "stock_location": 0,
  "support_request": 0,
  "table_qr_token": 3,
  "table_session": 1,
  "unit_of_measure": 0,
  "user_role": 3
}
```
## Run 2 — PASS
- Empty DB migrate: PASS
- Seed twice + migration rerun preserve data: PASS
- Three logins / 3 allow / 6 deny: PASS
- Sample VND query: PASS
```json
{
  "app_user": 3,
  "cart_item": 0,
  "dining_area": 1,
  "dining_table": 3,
  "financial_charge": 0,
  "goods_receipt": 0,
  "goods_receipt_item": 0,
  "idempotency_record": 0,
  "ingredient": 0,
  "inventory_balance": 0,
  "inventory_movement": 0,
  "inventory_reservation": 0,
  "menu_category": 1,
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
  "product": 3,
  "recipe_bom": 0,
  "recipe_bom_item": 0,
  "refund_case": 0,
  "refund_transaction": 0,
  "restaurant": 1,
  "risk_policy_config": 0,
  "role": 3,
  "role_permission": 3,
  "session_cart": 1,
  "session_financial_account": 0,
  "session_participant": 1,
  "stock_location": 0,
  "support_request": 0,
  "table_qr_token": 3,
  "table_session": 1,
  "unit_of_measure": 0,
  "user_role": 3
}
```
