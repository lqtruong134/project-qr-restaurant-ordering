BEGIN;
-- core_active_bom already enforces the identical active-recipe rule.
DROP INDEX pdm_bom_active;
-- The UNIQUE(session_id) index already supports lookups and its foreign key.
DROP INDEX core_session_financial_account_fk1;
COMMIT;
