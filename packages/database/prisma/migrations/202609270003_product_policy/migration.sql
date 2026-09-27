ALTER TABLE product ADD COLUMN stock_managed boolean NOT NULL DEFAULT true, ADD COLUMN is_complimentary boolean NOT NULL DEFAULT false;
-- Preserve intentionally free historical menu entries while making the policy explicit.
UPDATE product SET is_complimentary=true WHERE base_price=0;
ALTER TABLE product ADD CONSTRAINT product_free_price CHECK(base_price>0 OR is_complimentary);
ALTER TABLE order_item ADD COLUMN stock_managed_snapshot boolean NOT NULL DEFAULT true;
