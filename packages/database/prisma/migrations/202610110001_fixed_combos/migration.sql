-- Fixed bundles keep a single price and lifecycle, with immutable contents on each order.
ALTER TABLE product ADD COLUMN product_kind text NOT NULL DEFAULT 'DISH'
  CHECK (product_kind IN ('DISH','COMBO'));
ALTER TABLE cart_item ADD COLUMN product_version_preview integer CHECK (product_version_preview>0);
ALTER TABLE order_item ADD COLUMN product_kind_snapshot text NOT NULL DEFAULT 'DISH'
  CHECK (product_kind_snapshot IN ('DISH','COMBO'));
ALTER TABLE order_item ADD COLUMN combo_components_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(combo_components_snapshot)='array');
ALTER TABLE order_item ADD CONSTRAINT order_combo_snapshot_matches_kind CHECK (
  (product_kind_snapshot='DISH' AND jsonb_array_length(combo_components_snapshot)=0)
  OR (product_kind_snapshot='COMBO' AND jsonb_array_length(combo_components_snapshot) BETWEEN 2 AND 20)
);

CREATE TABLE product_combo_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_product_id uuid NOT NULL REFERENCES product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  component_product_id uuid NOT NULL REFERENCES product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (combo_product_id,component_product_id),
  CHECK (combo_product_id<>component_product_id)
);
CREATE INDEX product_combo_component_idx ON product_combo_item(component_product_id);

CREATE FUNCTION check_product_combo_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent product; child product;
BEGIN
  SELECT * INTO parent FROM product WHERE id=NEW.combo_product_id;
  SELECT * INTO child FROM product WHERE id=NEW.component_product_id;
  IF parent.product_kind<>'COMBO' OR child.product_kind<>'DISH'
    OR parent.restaurant_id<>child.restaurant_id THEN
    RAISE EXCEPTION 'Combo components must be ordinary dishes in the same restaurant' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION product_catalog_available(target uuid, tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT p.is_active AND mc.is_active AND p.availability_status='AVAILABLE'
    AND (p.product_kind<>'COMBO' OR (
      (SELECT count(*) FROM product_combo_item ci WHERE ci.combo_product_id=p.id) BETWEEN 2 AND 20
      AND NOT EXISTS (
        SELECT 1 FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id
        JOIN menu_category cc ON cc.id=child.category_id
        WHERE ci.combo_product_id=p.id AND (NOT child.is_active OR NOT cc.is_active
          OR child.availability_status<>'AVAILABLE' OR (child.stock_managed AND NOT EXISTS (
            SELECT 1 FROM recipe_bom b WHERE b.product_id=child.id AND b.status='ACTIVE'
              AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
              AND EXISTS(SELECT 1 FROM recipe_bom_item bi WHERE bi.recipe_bom_id=b.id)
          )))
      )
    )) AND (NOT p.stock_managed OR (
      EXISTS (SELECT 1 FROM recipe_bom b WHERE b.product_id=p.id AND b.status='ACTIVE'
        AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
        AND EXISTS(SELECT 1 FROM recipe_bom_item bi WHERE bi.recipe_bom_id=b.id))
      AND NOT EXISTS (
        SELECT 1 FROM recipe_bom b JOIN recipe_bom_item bi ON bi.recipe_bom_id=b.id
        WHERE b.product_id=p.id AND b.status='ACTIVE' AND b.effective_from<=now()
          AND (b.effective_to IS NULL OR b.effective_to>now()) AND NOT EXISTS (
            SELECT 1 FROM inventory_balance ib JOIN stock_location sl ON sl.id=ib.location_id
            JOIN ingredient ig ON ig.id=ib.ingredient_id
            WHERE ib.ingredient_id=bi.ingredient_id AND sl.restaurant_id=tenant
              AND ig.restaurant_id=tenant AND sl.is_active AND ig.is_active
              AND ib.available_qty>=ceil(bi.quantity/b.yield_quantity*(1+bi.waste_percent/100)*1000000)/1000000
          )
      )
    )) FROM product p JOIN menu_category mc ON mc.id=p.category_id
      WHERE p.id=target AND p.restaurant_id=tenant),false)
$$;
CREATE TRIGGER product_combo_member BEFORE INSERT OR UPDATE ON product_combo_item
FOR EACH ROW EXECUTE FUNCTION check_product_combo_member();

CREATE FUNCTION freeze_product_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_kind<>OLD.product_kind THEN
    RAISE EXCEPTION 'Product kind cannot be changed after creation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_kind_immutable BEFORE UPDATE ON product
FOR EACH ROW EXECUTE FUNCTION freeze_product_kind();

CREATE FUNCTION check_product_combo_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; members integer;
BEGIN
  IF TG_TABLE_NAME='product' THEN
    target:=NEW.id;
  ELSIF TG_OP='DELETE' THEN
    target:=OLD.combo_product_id;
  ELSE
    target:=NEW.combo_product_id;
  END IF;
  IF EXISTS(SELECT 1 FROM product WHERE id=target AND product_kind='COMBO') THEN
    SELECT count(*) INTO members FROM product_combo_item WHERE combo_product_id=target;
    IF members NOT BETWEEN 2 AND 20 THEN
      RAISE EXCEPTION 'A fixed combo must contain 2 to 20 distinct dishes' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_combo_complete AFTER INSERT OR UPDATE ON product
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_product_combo_complete();
CREATE CONSTRAINT TRIGGER product_combo_items_complete AFTER INSERT OR UPDATE OR DELETE ON product_combo_item
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_product_combo_complete();

CREATE FUNCTION freeze_order_combo_contents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_kind_snapshot IS DISTINCT FROM OLD.product_kind_snapshot
    OR NEW.combo_components_snapshot IS DISTINCT FROM OLD.combo_components_snapshot THEN
    RAISE EXCEPTION 'Ordered combo contents are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_combo_contents_immutable BEFORE UPDATE ON order_item
FOR EACH ROW EXECUTE FUNCTION freeze_order_combo_contents();

-- Aggregate shared ingredients before reserving stock, preventing duplicate reservations/costs.
-- Old versions remain referenced by existing order_item_ingredient_snapshot rows.
CREATE FUNCTION refresh_product_combo_recipe(target uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE recipe_id uuid; next_version integer; tracked boolean;
BEGIN
  PERFORM id FROM product WHERE id=target AND product_kind='COMBO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Combo not found' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM product_combo_item ci JOIN product p ON p.id=ci.component_product_id
    WHERE ci.combo_product_id=target AND p.stock_managed AND NOT EXISTS (
      SELECT 1 FROM recipe_bom b WHERE b.product_id=p.id AND b.status='ACTIVE'
        AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
        AND EXISTS(SELECT 1 FROM recipe_bom_item bi WHERE bi.recipe_bom_id=b.id)
    )
  ) THEN RAISE EXCEPTION 'A combo component has no active recipe' USING ERRCODE='23514'; END IF;
  SELECT bool_or(p.stock_managed) INTO tracked FROM product_combo_item ci
    JOIN product p ON p.id=ci.component_product_id WHERE ci.combo_product_id=target;
  UPDATE product SET stock_managed=COALESCE(tracked,false) WHERE id=target;
  SELECT COALESCE(max(version_no),0)+1 INTO next_version FROM recipe_bom WHERE product_id=target;
  UPDATE recipe_bom SET status='RETIRED',effective_to=now() WHERE product_id=target AND status='ACTIVE';
  IF NOT COALESCE(tracked,false) THEN RETURN NULL; END IF;
  INSERT INTO recipe_bom(product_id,version_no,yield_quantity,status)
    VALUES(target,next_version,1,'ACTIVE') RETURNING id INTO recipe_id;
  INSERT INTO recipe_bom_item(recipe_bom_id,ingredient_id,quantity,waste_percent)
    SELECT recipe_id,bi.ingredient_id,
      ceil(sum(bi.quantity/b.yield_quantity*(1+bi.waste_percent/100)*ci.quantity)*1000000)/1000000,0
    FROM product_combo_item ci JOIN product p ON p.id=ci.component_product_id AND p.stock_managed
    JOIN recipe_bom b ON b.product_id=p.id AND b.status='ACTIVE'
      AND b.effective_from<=now() AND (b.effective_to IS NULL OR b.effective_to>now())
    JOIN recipe_bom_item bi ON bi.recipe_bom_id=b.id
    WHERE ci.combo_product_id=target GROUP BY bi.ingredient_id;
  RETURN recipe_id;
END $$;
