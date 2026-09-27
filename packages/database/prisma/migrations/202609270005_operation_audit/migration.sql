ALTER TABLE operational_alert ADD COLUMN resolution_note text, ADD COLUMN resolved_by uuid REFERENCES app_user(id) ON DELETE RESTRICT;
ALTER TABLE table_session ADD COLUMN verified_by uuid REFERENCES app_user(id) ON DELETE RESTRICT;
CREATE CONSTRAINT TRIGGER uat_alert_resolver_tenant AFTER INSERT OR UPDATE ON operational_alert DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','resolved_by');
CREATE CONSTRAINT TRIGGER uat_verifier_tenant AFTER INSERT OR UPDATE ON table_session DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user','verified_by');
