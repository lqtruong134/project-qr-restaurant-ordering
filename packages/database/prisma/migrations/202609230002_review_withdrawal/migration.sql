-- A guest withdrawing a pending order is not a staff rejection or a timeout.
ALTER TABLE order_review DROP CONSTRAINT order_review_status_check;
ALTER TABLE order_review ADD CONSTRAINT order_review_status_check
 CHECK(status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED'));
