ALTER TABLE app_user ADD COLUMN staff_code text;
UPDATE app_user SET staff_code=username;
ALTER TABLE app_user ALTER COLUMN staff_code SET NOT NULL;
CREATE UNIQUE INDEX app_user_restaurant_staff_code ON app_user(restaurant_id,staff_code);
CREATE FUNCTION app_user_staff_code_default() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.staff_code:=lower(btrim(COALESCE(NEW.staff_code,NEW.username)));
 IF NEW.staff_code='' THEN RAISE EXCEPTION 'Staff code required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.staff_code IS DISTINCT FROM OLD.staff_code THEN RAISE EXCEPTION 'Staff code is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_user_staff_code_default BEFORE INSERT OR UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION app_user_staff_code_default();
