-- Administrative and bootstrap promotion images use the same menu warehouse and records.
ALTER TABLE product ADD CONSTRAINT product_id_restaurant_promotion_key UNIQUE(id,restaurant_id);
CREATE TABLE menu_promotion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  product_id uuid NOT NULL,
  image_url text NOT NULL CHECK (image_url ~ '^/api/menu-images/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$'),
  image_width integer NOT NULL CHECK (image_width BETWEEN 1 AND 20000),
  image_height integer NOT NULL CHECK (image_height BETWEEN 1 AND 20000),
  presentation text NOT NULL DEFAULT 'PHOTO' CHECK (presentation IN ('PHOTO','POSTER')),
  eyebrow text CHECK (char_length(eyebrow)<=80),
  image_note text CHECK (char_length(image_note)<=300),
  expected_price bigint CHECK (expected_price>=0),
  expected_components jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(expected_components)='array' AND jsonb_array_length(expected_components)<=20),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_promotion_product_tenant_fk FOREIGN KEY(product_id,restaurant_id) REFERENCES product(id,restaurant_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  UNIQUE(restaurant_id,product_id)
);
CREATE INDEX menu_promotion_active_order ON menu_promotion(restaurant_id,is_active,sort_order,id);
CREATE TRIGGER menu_promotion_updated BEFORE UPDATE ON menu_promotion FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
