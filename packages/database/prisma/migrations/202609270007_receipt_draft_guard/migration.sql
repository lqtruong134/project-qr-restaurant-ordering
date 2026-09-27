ALTER TABLE goods_receipt ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
DROP TRIGGER core_no_delete ON goods_receipt_item;
CREATE FUNCTION receipt_line_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status text;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.receipt_id; ELSE parent_id:=NEW.receipt_id; END IF;
 IF TG_OP='UPDATE' AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id THEN RAISE EXCEPTION 'Cannot move receipt line' USING ERRCODE='23514'; END IF;
 SELECT status INTO parent_status FROM goods_receipt WHERE id=parent_id FOR UPDATE;
 IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Only draft receipt lines can change' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER receipt_line_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON goods_receipt_item FOR EACH ROW EXECUTE FUNCTION receipt_line_draft_guard();
CREATE FUNCTION receipt_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Posted or cancelled receipts are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_header_guard BEFORE UPDATE ON goods_receipt FOR EACH ROW EXECUTE FUNCTION receipt_header_guard();
