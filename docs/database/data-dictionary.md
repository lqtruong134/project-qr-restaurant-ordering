# Từ điển dữ liệu vật lý — 67 bảng

Sinh từ metadata PostgreSQL bằng `pnpm docs:database`, không chứa bản ghi nghiệp vụ hay thông tin đăng nhập. Kiểu, giá trị mặc định và các ràng buộc bên dưới lấy trực tiếp từ database đã migrate.

Đường nối sơ đồ là khóa ngoại thực tế. Đầu cha là `1` nếu toàn bộ cột tham chiếu bắt buộc, ngược lại là `0..1`; đầu con là `0..1` khi có khóa duy nhất toàn phần phù hợp, ngược lại là `0..N`. Unique có điều kiện chỉ giới hạn tập con (ví dụ phiên đang mở), không biến quan hệ lịch sử thành 1:1. CHECK bổ sung cần đọc ở từng bảng.

## app_user

Tài khoản nội bộ và trạng thái đăng nhập

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Có | FK | — | Tham chiếu restaurant; không xóa lịch sử |
| username | character varying(64) | Có |  | — | Tên đăng nhập chữ thường, duy nhất trong nhà hàng |
| password_hash | text | Có |  | — | Argon2id hash; không chứa mật khẩu rõ |
| display_name | text | Có |  | — | Tên hiển thị |
| status | text | Có |  | 'ACTIVE'::text | Trạng thái: ACTIVE, INACTIVE |
| last_login_at | timestamp with time zone | Không |  | — | Lần đăng nhập thành công gần nhất |
| refresh_token_hash | text | Không |  | — | SHA256 refresh opaque; chỉ lưu hash |
| refresh_expires_at | timestamp with time zone | Không |  | — | Hạn tuyệt đối của phiên đăng nhập |
| auth_version | integer | Có |  | 0 | Tăng khi đăng nhập/thu hồi phiên |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |
| staff_code | text | Có |  | — | — |

### Ràng buộc
```sql
app_user_auth_version_check: CHECK ((auth_version >= 0))
app_user_check: CHECK (((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL)))
app_user_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
app_user_username_check: CHECK (((username)::text ~ '^[a-z0-9_.-]{3,64}$'::text))
app_user_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
app_user_auth_version_not_null: NOT NULL auth_version
app_user_created_at_not_null: NOT NULL created_at
app_user_display_name_not_null: NOT NULL display_name
app_user_id_not_null: NOT NULL id
app_user_password_hash_not_null: NOT NULL password_hash
app_user_restaurant_id_not_null: NOT NULL restaurant_id
app_user_staff_code_not_null: NOT NULL staff_code
app_user_status_not_null: NOT NULL status
app_user_updated_at_not_null: NOT NULL updated_at
app_user_username_not_null: NOT NULL username
app_user_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
app_user_id_restaurant_key: UNIQUE (id, restaurant_id)
app_user_refresh_token_hash_key: UNIQUE (refresh_token_hash)
app_user_restaurant_id_username_key: UNIQUE (restaurant_id, username)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX app_user_id_restaurant_key ON public.app_user USING btree (id, restaurant_id);
CREATE UNIQUE INDEX app_user_pkey ON public.app_user USING btree (id);
CREATE UNIQUE INDEX app_user_refresh_token_hash_key ON public.app_user USING btree (refresh_token_hash);
CREATE UNIQUE INDEX app_user_restaurant_id_username_key ON public.app_user USING btree (restaurant_id, username);
CREATE UNIQUE INDEX app_user_restaurant_staff_code ON public.app_user USING btree (restaurant_id, staff_code);
```

## attendance_record



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| assignment_id | uuid | Có | FK | — | — |
| checked_in_at | timestamp with time zone | Không |  | — | — |
| checked_out_at | timestamp with time zone | Không |  | — | — |
| status | text | Có |  | 'RECORDED'::text | — |
| approved_minutes | integer | Không |  | — | — |
| hourly_rate_snapshot | bigint | Không |  | — | — |
| amount | bigint | Không |  | — | — |
| approved_by | uuid | Không | FK | — | — |
| approved_at | timestamp with time zone | Không |  | — | — |
| review_note | text | Không |  | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |
| outcome | text | Có |  | 'WORKED'::text | — |
| approval_mode | text | Không |  | — | — |
| rate_source | text | Không |  | — | — |
| pay_components | jsonb | Không |  | — | — |
| pay_snapshot | jsonb | Không |  | — | Immutable calculation evidence: approved paid periods, calendar, policy versions, personal rates and reconciled VND components. |
| paid_periods | jsonb | Không |  | — | — |

### Ràng buộc
```sql
attendance_outcome_allowed: CHECK ((outcome = ANY (ARRAY['WORKED'::text, 'ABSENT'::text, 'LEAVE'::text, 'MISSED_CLOCK'::text, 'PAID_HOLIDAY'::text])))
attendance_outcome_minutes: CHECK (((status <> 'APPROVED'::text) OR ((outcome = ANY (ARRAY['ABSENT'::text, 'LEAVE'::text])) AND (approved_minutes = 0)) OR ((outcome = ANY (ARRAY['WORKED'::text, 'MISSED_CLOCK'::text, 'PAID_HOLIDAY'::text])) AND (approved_minutes > 0))))
attendance_pay_snapshot_shape: CHECK (((((pay_snapshot IS NULL) AND (pay_components IS NULL) AND (paid_periods IS NULL) AND (outcome <> 'PAID_HOLIDAY'::text) AND ((amount IS NULL) OR (amount = ((((approved_minutes)::bigint * hourly_rate_snapshot) + 30) / 60)))) OR ((status = 'APPROVED'::text) AND (rate_source = 'EMPLOYEE'::text) AND (jsonb_typeof(pay_snapshot) = 'object'::text) AND (jsonb_typeof(pay_components) = 'object'::text) AND (jsonb_typeof(paid_periods) = 'array'::text) AND (((pay_snapshot ->> 'version'::text))::integer = 1) AND ((pay_snapshot -> 'components'::text) = pay_components) AND ((pay_snapshot -> 'periods'::text) = paid_periods) AND (amount = ((pay_components ->> 'totalAmount'::text))::bigint) AND (amount = (((((((pay_components ->> 'baseAmount'::text))::bigint + ((pay_components ->> 'nightAmount'::text))::bigint) + ((pay_components ->> 'overtimeAmount'::text))::bigint) + ((pay_components ->> 'restDayAmount'::text))::bigint) + ((pay_components ->> 'holidayAmount'::text))::bigint) + ((pay_components ->> 'paidHolidayAmount'::text))::bigint)))) IS TRUE))
attendance_record_amount_check: CHECK ((amount >= 0))
attendance_record_approval_mode_check: CHECK ((approval_mode = ANY (ARRAY['FULL'::text, 'ACTUAL'::text, 'ZERO'::text, 'EXCEPTION'::text])))
attendance_record_approved_minutes_check: CHECK (((approved_minutes >= 0) AND (approved_minutes <= 960)))
attendance_record_check: CHECK (((checked_out_at IS NULL) OR ((checked_in_at IS NOT NULL) AND (checked_out_at >= checked_in_at))))
attendance_record_check1: CHECK ((((status = 'RECORDED'::text) AND (approved_minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount IS NULL) AND (approved_by IS NULL) AND (approved_at IS NULL)) OR ((status = 'APPROVED'::text) AND (approved_minutes IS NOT NULL) AND (hourly_rate_snapshot IS NOT NULL) AND (amount IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL) AND (length(btrim(COALESCE(review_note, ''::text))) > 0))))
attendance_record_hourly_rate_snapshot_check: CHECK (((hourly_rate_snapshot >= 1000) AND (hourly_rate_snapshot <= 10000000)))
attendance_record_rate_source_check: CHECK ((rate_source = ANY (ARRAY['EMPLOYEE'::text, 'SHIFT'::text])))
attendance_record_status_check: CHECK ((status = ANY (ARRAY['RECORDED'::text, 'APPROVED'::text])))
attendance_record_approved_by_restaurant_id_fkey: FOREIGN KEY (approved_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
attendance_record_assignment_id_restaurant_id_fkey: FOREIGN KEY (assignment_id, restaurant_id) REFERENCES shift_assignment(id, restaurant_id)
attendance_record_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
attendance_record_assignment_id_not_null: NOT NULL assignment_id
attendance_record_created_at_not_null: NOT NULL created_at
attendance_record_id_not_null: NOT NULL id
attendance_record_outcome_not_null: NOT NULL outcome
attendance_record_restaurant_id_not_null: NOT NULL restaurant_id
attendance_record_status_not_null: NOT NULL status
attendance_record_updated_at_not_null: NOT NULL updated_at
attendance_record_pkey: PRIMARY KEY (id)
attendance_record_assignment_id_key: UNIQUE (assignment_id)
attendance_record_assignment_id_restaurant_id_key: UNIQUE (assignment_id, restaurant_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX attendance_record_assignment_id_key ON public.attendance_record USING btree (assignment_id);
CREATE UNIQUE INDEX attendance_record_assignment_id_restaurant_id_key ON public.attendance_record USING btree (assignment_id, restaurant_id);
CREATE UNIQUE INDEX attendance_record_pkey ON public.attendance_record USING btree (id);
```

## business_audit_event



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| actor_id | uuid | Không | FK | — | — |
| action | text | Có |  | — | — |
| resource_type | text | Có |  | — | — |
| resource_id | uuid | Có |  | — | — |
| reason | text | Có |  | — | — |
| details | jsonb | Có |  | '{}'::jsonb | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| actor_type | text | Không |  | — | — |

### Ràng buộc
```sql
business_audit_actor: CHECK (((actor_type IS NULL) OR ((actor_type = 'USER'::text) AND (actor_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::text) AND (actor_id IS NULL))))
business_audit_event_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'SYSTEM'::text])))
business_audit_event_reason_check: CHECK ((length(btrim(reason)) > 0))
business_audit_event_actor_id_restaurant_id_fkey: FOREIGN KEY (actor_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
business_audit_event_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
business_audit_event_action_not_null: NOT NULL action
business_audit_event_created_at_not_null: NOT NULL created_at
business_audit_event_details_not_null: NOT NULL details
business_audit_event_id_not_null: NOT NULL id
business_audit_event_reason_not_null: NOT NULL reason
business_audit_event_resource_id_not_null: NOT NULL resource_id
business_audit_event_resource_type_not_null: NOT NULL resource_type
business_audit_event_restaurant_id_not_null: NOT NULL restaurant_id
business_audit_event_pkey: PRIMARY KEY (id)
```

### Chỉ mục
```sql
CREATE INDEX business_audit_dining_completion ON public.business_audit_event USING btree (resource_id, action, created_at) WHERE (action = ANY (ARRAY['CASH_CHANGE_RETURNED'::text, 'RECEIPT_PROVIDED'::text, 'KITCHEN_UNAVAILABLE_REPORTED'::text]));
CREATE UNIQUE INDEX business_audit_event_pkey ON public.business_audit_event USING btree (id);
CREATE INDEX business_audit_resource ON public.business_audit_event USING btree (resource_type, resource_id, created_at);
```

## cart_item



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| cart_id | uuid | Có | FK | — | — |
| owner_participant_id | uuid | Không | FK | — | — |
| product_id | uuid | Có | FK | — | — |
| quantity | integer | Có |  | — | — |
| note | text | Không |  | — | — |
| unit_price_preview | bigint | Có |  | — | — |
| selected | boolean | Có |  | false | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| product_version_preview | integer | Không |  | — | — |

### Ràng buộc
```sql
cart_item_product_version_preview_check: CHECK ((product_version_preview > 0))
cart_item_quantity_check: CHECK ((quantity > 0))
cart_item_unit_price_preview_check: CHECK ((unit_price_preview >= 0))
cart_item_version_check: CHECK ((version > 0))
core_cart_item_f1: FOREIGN KEY (cart_id) REFERENCES session_cart(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_cart_item_f2: FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_cart_item_f3: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
cart_item_cart_id_not_null: NOT NULL cart_id
cart_item_created_at_not_null: NOT NULL created_at
cart_item_id_not_null: NOT NULL id
cart_item_product_id_not_null: NOT NULL product_id
cart_item_quantity_not_null: NOT NULL quantity
cart_item_selected_not_null: NOT NULL selected
cart_item_unit_price_preview_not_null: NOT NULL unit_price_preview
cart_item_updated_at_not_null: NOT NULL updated_at
cart_item_version_not_null: NOT NULL version
cart_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX cart_item_pkey ON public.cart_item USING btree (id);
CREATE INDEX core_cart_item_fk1 ON public.cart_item USING btree (cart_id);
CREATE INDEX core_cart_item_fk2 ON public.cart_item USING btree (owner_participant_id);
CREATE INDEX core_cart_item_fk3 ON public.cart_item USING btree (product_id);
```

## dining_area

Khu vực bàn

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Có | FK | — | Tham chiếu restaurant; không xóa lịch sử |
| code | text | Có |  | — | Mã khu vực |
| name | text | Có |  | — | Tên khu vực |
| sort_order | integer | Có |  | 0 | Thứ tự hiển thị |
| is_active | boolean | Có |  | true | Ngừng dùng bằng false; giữ lịch sử |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
dining_area_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_area_code_not_null: NOT NULL code
dining_area_created_at_not_null: NOT NULL created_at
dining_area_id_not_null: NOT NULL id
dining_area_is_active_not_null: NOT NULL is_active
dining_area_name_not_null: NOT NULL name
dining_area_restaurant_id_not_null: NOT NULL restaurant_id
dining_area_sort_order_not_null: NOT NULL sort_order
dining_area_updated_at_not_null: NOT NULL updated_at
dining_area_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
dining_area_id_restaurant_id_key: UNIQUE (id, restaurant_id)
dining_area_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX dining_area_id_restaurant_id_key ON public.dining_area USING btree (id, restaurant_id);
CREATE UNIQUE INDEX dining_area_pkey ON public.dining_area USING btree (id);
CREATE UNIQUE INDEX dining_area_restaurant_id_code_key ON public.dining_area USING btree (restaurant_id, code);
```

## dining_table

Bàn ăn

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Có | FK | — | Tham chiếu restaurant; không xóa lịch sử |
| area_id | uuid | Có | FK | — | Khu vực cùng nhà hàng; FK ghép |
| code | text | Có |  | — | Mã bàn |
| name | text | Có |  | — | Tên bàn |
| capacity | integer | Có |  | — | Số chỗ > 0 |
| table_status | text | Có |  | 'AVAILABLE'::text | Trạng thái: AVAILABLE, OCCUPIED, NEEDS_CLEANING |
| is_active | boolean | Có |  | true | Ngừng dùng bằng false; giữ lịch sử |
| version | integer | Có |  | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
dining_table_capacity_check: CHECK ((capacity > 0))
dining_table_table_status_check: CHECK ((table_status = ANY (ARRAY['AVAILABLE'::text, 'OCCUPIED'::text, 'NEEDS_CLEANING'::text])))
dining_table_version_check: CHECK ((version > 0))
dining_table_area_id_restaurant_id_fkey: FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_table_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_table_area_id_not_null: NOT NULL area_id
dining_table_capacity_not_null: NOT NULL capacity
dining_table_code_not_null: NOT NULL code
dining_table_created_at_not_null: NOT NULL created_at
dining_table_id_not_null: NOT NULL id
dining_table_is_active_not_null: NOT NULL is_active
dining_table_name_not_null: NOT NULL name
dining_table_restaurant_id_not_null: NOT NULL restaurant_id
dining_table_table_status_not_null: NOT NULL table_status
dining_table_updated_at_not_null: NOT NULL updated_at
dining_table_version_not_null: NOT NULL version
dining_table_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
dining_table_id_restaurant_key: UNIQUE (id, restaurant_id)
dining_table_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE INDEX dining_table_area_idx ON public.dining_table USING btree (area_id, restaurant_id);
CREATE UNIQUE INDEX dining_table_id_restaurant_key ON public.dining_table USING btree (id, restaurant_id);
CREATE UNIQUE INDEX dining_table_pkey ON public.dining_table USING btree (id);
CREATE UNIQUE INDEX dining_table_restaurant_id_code_key ON public.dining_table USING btree (restaurant_id, code);
```

## discount_program



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| name | text | Có |  | — | — |
| description | text | Có |  | ''::text | — |
| mode | text | Có |  | — | — |
| code | text | Không |  | — | — |
| discount_type | text | Có |  | — | — |
| percent | integer | Không |  | — | — |
| fixed_amount | bigint | Không |  | — | — |
| min_eligible_amount | bigint | Có |  | 0 | — |
| max_discount_amount | bigint | Không |  | — | — |
| starts_at | timestamp(6) with time zone | Có |  | — | — |
| ends_at | timestamp(6) with time zone | Có |  | — | — |
| weekdays | integer[] | Có |  | '{}'::integer[] | — |
| start_time | text | Không |  | — | — |
| end_time | text | Không |  | — | — |
| scope | text | Có |  | 'ALL'::text | — |
| product_ids | uuid[] | Có |  | '{}'::uuid[] | — |
| category_ids | uuid[] | Có |  | '{}'::uuid[] | — |
| exclude_combos | boolean | Có |  | true | — |
| usage_limit | integer | Không |  | — | — |
| status | text | Có |  | 'ACTIVE'::text | — |
| version | integer | Có |  | 1 | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
discount_program_check: CHECK ((ends_at > starts_at))
discount_program_check1: CHECK (((discount_type <> 'FIXED'::text) OR ((min_eligible_amount > 0) AND ((fixed_amount * 2) <= min_eligible_amount))))
discount_program_check2: CHECK ((((mode = 'AUTO'::text) AND (code IS NULL)) OR ((mode = 'CODE'::text) AND (code IS NOT NULL) AND (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'::text))))
discount_program_check3: CHECK ((((discount_type = 'PERCENT'::text) AND (percent IS NOT NULL) AND ((percent >= 1) AND (percent <= 50)) AND (fixed_amount IS NULL)) OR ((discount_type = 'FIXED'::text) AND (fixed_amount IS NOT NULL) AND (fixed_amount > 0) AND (percent IS NULL))))
discount_program_check4: CHECK ((((start_time IS NULL) AND (end_time IS NULL)) OR ((start_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'::text) AND (end_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'::text) AND (end_time > start_time))))
discount_program_check5: CHECK ((((scope = 'ALL'::text) AND (cardinality(product_ids) = 0) AND (cardinality(category_ids) = 0)) OR ((scope = 'PRODUCTS'::text) AND (cardinality(product_ids) > 0) AND (cardinality(category_ids) = 0)) OR ((scope = 'CATEGORIES'::text) AND (cardinality(category_ids) > 0) AND (cardinality(product_ids) = 0))))
discount_program_description_check: CHECK ((length(description) <= 500))
discount_program_discount_type_check: CHECK ((discount_type = ANY (ARRAY['PERCENT'::text, 'FIXED'::text])))
discount_program_exclude_combos_check: CHECK (exclude_combos)
discount_program_max_discount_amount_check: CHECK ((max_discount_amount > 0))
discount_program_min_eligible_amount_check: CHECK ((min_eligible_amount >= 0))
discount_program_mode_check: CHECK ((mode = ANY (ARRAY['AUTO'::text, 'CODE'::text])))
discount_program_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
discount_program_scope_check: CHECK ((scope = ANY (ARRAY['ALL'::text, 'PRODUCTS'::text, 'CATEGORIES'::text])))
discount_program_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text, 'ARCHIVED'::text])))
discount_program_usage_limit_check: CHECK ((usage_limit > 0))
discount_program_version_check: CHECK ((version > 0))
discount_program_weekdays_check: CHECK (((weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]) AND (array_position(weekdays, NULL::integer) IS NULL)))
discount_program_created_by_fkey: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
discount_program_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
discount_program_category_ids_not_null: NOT NULL category_ids
discount_program_created_at_not_null: NOT NULL created_at
discount_program_created_by_not_null: NOT NULL created_by
discount_program_description_not_null: NOT NULL description
discount_program_discount_type_not_null: NOT NULL discount_type
discount_program_ends_at_not_null: NOT NULL ends_at
discount_program_exclude_combos_not_null: NOT NULL exclude_combos
discount_program_id_not_null: NOT NULL id
discount_program_min_eligible_amount_not_null: NOT NULL min_eligible_amount
discount_program_mode_not_null: NOT NULL mode
discount_program_name_not_null: NOT NULL name
discount_program_product_ids_not_null: NOT NULL product_ids
discount_program_restaurant_id_not_null: NOT NULL restaurant_id
discount_program_scope_not_null: NOT NULL scope
discount_program_starts_at_not_null: NOT NULL starts_at
discount_program_status_not_null: NOT NULL status
discount_program_updated_at_not_null: NOT NULL updated_at
discount_program_version_not_null: NOT NULL version
discount_program_weekdays_not_null: NOT NULL weekdays
discount_program_pkey: PRIMARY KEY (id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX discount_code_unique ON public.discount_program USING btree (restaurant_id, code) WHERE (code IS NOT NULL);
CREATE UNIQUE INDEX discount_program_pkey ON public.discount_program USING btree (id);
CREATE INDEX discount_program_restaurant ON public.discount_program USING btree (restaurant_id, status, starts_at, ends_at);
```

## employee_pay_rate



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| user_id | uuid | Có | FK | — | — |
| effective_from | timestamp with time zone | Có |  | — | — |
| hourly_rate | bigint | Có |  | — | — |
| reason | text | Có |  | — | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
employee_pay_rate_hourly_rate_check: CHECK (((hourly_rate >= 1000) AND (hourly_rate <= 10000000)))
employee_pay_rate_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
employee_pay_rate_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
employee_pay_rate_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
employee_pay_rate_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
employee_pay_rate_created_at_not_null: NOT NULL created_at
employee_pay_rate_created_by_not_null: NOT NULL created_by
employee_pay_rate_effective_from_not_null: NOT NULL effective_from
employee_pay_rate_hourly_rate_not_null: NOT NULL hourly_rate
employee_pay_rate_id_not_null: NOT NULL id
employee_pay_rate_reason_not_null: NOT NULL reason
employee_pay_rate_restaurant_id_not_null: NOT NULL restaurant_id
employee_pay_rate_user_id_not_null: NOT NULL user_id
employee_pay_rate_pkey: PRIMARY KEY (id)
employee_pay_rate_user_id_effective_from_key: UNIQUE (user_id, effective_from)
```

### Chỉ mục
```sql
CREATE INDEX employee_pay_rate_lookup_idx ON public.employee_pay_rate USING btree (user_id, effective_from DESC);
CREATE UNIQUE INDEX employee_pay_rate_pkey ON public.employee_pay_rate USING btree (id);
CREATE UNIQUE INDEX employee_pay_rate_user_id_effective_from_key ON public.employee_pay_rate USING btree (user_id, effective_from);
```

## financial_charge



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| order_item_id | uuid | Không | FK | — | — |
| charge_type | text | Có |  | — | — |
| amount | bigint | Có |  | — | — |
| status | text | Có |  | 'ACTIVE'::text | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| reversed_at | timestamp(6) with time zone | Không |  | — | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| discount_amount | bigint | Có |  | 0 | — |
| promotion_snapshot | jsonb | Không |  | — | — |
| tax_snapshot | jsonb | Không |  | — | — |
| tax_amount | bigint | Không |  | — | — |

### Ràng buộc
```sql
charge_discount_valid: CHECK (((discount_amount >= 0) AND ((discount_amount * 2) <= amount)))
charge_tax_valid: CHECK ((((tax_amount IS NULL) AND (tax_snapshot IS NULL)) OR ((tax_amount IS NOT NULL) AND (tax_amount >= 0) AND (tax_amount <= (amount - discount_amount)) AND (tax_snapshot IS NOT NULL))))
financial_charge_amount_check: CHECK ((amount >= 0))
financial_charge_charge_type_check: CHECK ((charge_type = ANY (ARRAY['ITEM'::text, 'ADJUSTMENT'::text])))
financial_charge_charge_type_check1: CHECK ((length(btrim(charge_type)) > 0))
financial_charge_check: CHECK (((charge_type <> 'ITEM'::text) OR (order_item_id IS NOT NULL)))
financial_charge_check1: CHECK (((status <> 'REVERSED'::text) OR (reversed_at IS NOT NULL)))
financial_charge_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVERSED'::text])))
financial_charge_status_check1: CHECK ((length(btrim(status)) > 0))
core_financial_charge_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_financial_charge_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
financial_charge_amount_not_null: NOT NULL amount
financial_charge_charge_type_not_null: NOT NULL charge_type
financial_charge_created_at_not_null: NOT NULL created_at
financial_charge_discount_amount_not_null: NOT NULL discount_amount
financial_charge_id_not_null: NOT NULL id
financial_charge_session_id_not_null: NOT NULL session_id
financial_charge_status_not_null: NOT NULL status
financial_charge_updated_at_not_null: NOT NULL updated_at
financial_charge_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_financial_charge_fk1 ON public.financial_charge USING btree (session_id);
CREATE INDEX core_financial_charge_fk2 ON public.financial_charge USING btree (order_item_id);
CREATE UNIQUE INDEX financial_charge_pkey ON public.financial_charge USING btree (id);
CREATE UNIQUE INDEX pdm_item_charge ON public.financial_charge USING btree (order_item_id) WHERE (charge_type = 'ITEM'::text);
```

## goods_receipt



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| location_id | uuid | Có | FK | — | — |
| receipt_no | text | Có |  | — | — |
| status | text | Có |  | 'DRAFT'::text | — |
| received_at | timestamp(6) with time zone | Không |  | — | — |
| total_value | bigint | Có |  | — | — |
| created_by | uuid | Có | FK | — | — |
| approved_by | uuid | Không | FK | — | — |
| supplier_name_snapshot | text | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| version | integer | Có |  | 1 | — |
| external_reference | text | Không |  | — | — |

### Ràng buộc
```sql
goods_receipt_check: CHECK (((status <> 'APPROVED'::text) OR ((approved_by IS NOT NULL) AND (received_at IS NOT NULL))))
goods_receipt_external_reference_check: CHECK (((external_reference IS NULL) OR ((length(external_reference) >= 1) AND (length(external_reference) <= 120))))
goods_receipt_receipt_no_check: CHECK ((length(btrim(receipt_no)) > 0))
goods_receipt_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'CANCELLED'::text])))
goods_receipt_status_check1: CHECK ((length(btrim(status)) > 0))
goods_receipt_total_value_check: CHECK ((total_value >= 0))
goods_receipt_version_check: CHECK ((version > 0))
core_goods_receipt_f1: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_f2: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_f3: FOREIGN KEY (approved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
goods_receipt_created_at_not_null: NOT NULL created_at
goods_receipt_created_by_not_null: NOT NULL created_by
goods_receipt_id_not_null: NOT NULL id
goods_receipt_location_id_not_null: NOT NULL location_id
goods_receipt_receipt_no_not_null: NOT NULL receipt_no
goods_receipt_status_not_null: NOT NULL status
goods_receipt_total_value_not_null: NOT NULL total_value
goods_receipt_updated_at_not_null: NOT NULL updated_at
goods_receipt_version_not_null: NOT NULL version
goods_receipt_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
goods_receipt_location_id_receipt_no_key: UNIQUE (location_id, receipt_no)
```

### Chỉ mục
```sql
CREATE INDEX core_goods_receipt_fk1 ON public.goods_receipt USING btree (location_id);
CREATE INDEX core_goods_receipt_fk2 ON public.goods_receipt USING btree (created_by);
CREATE INDEX core_goods_receipt_fk3 ON public.goods_receipt USING btree (approved_by);
CREATE INDEX goods_receipt_history_idx ON public.goods_receipt USING btree (location_id, created_at DESC, id);
CREATE UNIQUE INDEX goods_receipt_location_id_receipt_no_key ON public.goods_receipt USING btree (location_id, receipt_no);
CREATE UNIQUE INDEX goods_receipt_pkey ON public.goods_receipt USING btree (id);
```

## goods_receipt_item



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| receipt_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| quantity | numeric(18,6) | Có |  | — | — |
| unit_id | uuid | Có | FK | — | — |
| base_quantity | numeric(18,6) | Có |  | — | — |
| unit_cost | numeric(18,6) | Có |  | — | — |
| lot_no | text | Không |  | — | — |
| expiry_date | date | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
goods_receipt_item_base_quantity_check: CHECK ((base_quantity > (0)::numeric))
goods_receipt_item_quantity_check: CHECK ((quantity > (0)::numeric))
goods_receipt_item_unit_cost_check: CHECK ((unit_cost >= (0)::numeric))
core_goods_receipt_item_f1: FOREIGN KEY (receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_item_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_item_f3: FOREIGN KEY (unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT
goods_receipt_item_base_quantity_not_null: NOT NULL base_quantity
goods_receipt_item_created_at_not_null: NOT NULL created_at
goods_receipt_item_id_not_null: NOT NULL id
goods_receipt_item_ingredient_id_not_null: NOT NULL ingredient_id
goods_receipt_item_quantity_not_null: NOT NULL quantity
goods_receipt_item_receipt_id_not_null: NOT NULL receipt_id
goods_receipt_item_unit_cost_not_null: NOT NULL unit_cost
goods_receipt_item_unit_id_not_null: NOT NULL unit_id
goods_receipt_item_updated_at_not_null: NOT NULL updated_at
goods_receipt_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_goods_receipt_item_fk1 ON public.goods_receipt_item USING btree (receipt_id);
CREATE INDEX core_goods_receipt_item_fk2 ON public.goods_receipt_item USING btree (ingredient_id);
CREATE INDEX core_goods_receipt_item_fk3 ON public.goods_receipt_item USING btree (unit_id);
CREATE UNIQUE INDEX goods_receipt_item_pkey ON public.goods_receipt_item USING btree (id);
```

## idempotency_record



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| scope | text | Có |  | — | — |
| idempotency_key | text | Có |  | — | — |
| request_hash | text | Có |  | — | — |
| resource_type | text | Có |  | — | — |
| response_snapshot | jsonb | Không |  | — | — |
| expires_at | timestamp(6) with time zone | Có |  | — | — |
| actor_type | text | Có |  | — | — |
| actor_user_id | uuid | Không | FK | — | — |
| actor_participant_id | uuid | Không | FK | — | — |
| order_batch_id | uuid | Không | FK | — | — |
| payment_intent_id | uuid | Không | FK | — | — |
| status | text | Có |  | 'PROCESSING'::text | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
idempotency_record_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
idempotency_record_actor_type_check1: CHECK ((length(btrim(actor_type)) > 0))
idempotency_record_check: CHECK (((((actor_type = 'USER'::text) AND (actor_user_id IS NOT NULL) AND (actor_participant_id IS NULL)) OR ((actor_type = 'GUEST'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NULL))) IS TRUE))
idempotency_record_check1: CHECK (((((resource_type = 'ORDER_BATCH'::text) AND (payment_intent_id IS NULL)) OR ((resource_type = 'PAYMENT_INTENT'::text) AND (order_batch_id IS NULL))) IS TRUE))
idempotency_record_check2: CHECK (((status <> 'SUCCEEDED'::text) OR ((num_nonnulls(order_batch_id, payment_intent_id) = 1) AND (response_snapshot IS NOT NULL))))
idempotency_record_check3: CHECK ((expires_at > created_at))
idempotency_record_idempotency_key_check: CHECK ((length(btrim(idempotency_key)) > 0))
idempotency_record_request_hash_check: CHECK ((length(btrim(request_hash)) > 0))
idempotency_record_resource_type_check: CHECK ((resource_type = ANY (ARRAY['ORDER_BATCH'::text, 'PAYMENT_INTENT'::text])))
idempotency_record_resource_type_check1: CHECK ((length(btrim(resource_type)) > 0))
idempotency_record_scope_check: CHECK ((length(btrim(scope)) > 0))
idempotency_record_status_check: CHECK ((status = ANY (ARRAY['PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text])))
idempotency_record_status_check1: CHECK ((length(btrim(status)) > 0))
core_idempotency_record_f1: FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f2: FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f5: FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT
idempotency_record_actor_type_not_null: NOT NULL actor_type
idempotency_record_created_at_not_null: NOT NULL created_at
idempotency_record_expires_at_not_null: NOT NULL expires_at
idempotency_record_id_not_null: NOT NULL id
idempotency_record_idempotency_key_not_null: NOT NULL idempotency_key
idempotency_record_request_hash_not_null: NOT NULL request_hash
idempotency_record_resource_type_not_null: NOT NULL resource_type
idempotency_record_scope_not_null: NOT NULL scope
idempotency_record_status_not_null: NOT NULL status
idempotency_record_updated_at_not_null: NOT NULL updated_at
idempotency_record_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_idempotency_record_fk1 ON public.idempotency_record USING btree (actor_user_id);
CREATE INDEX core_idempotency_record_fk2 ON public.idempotency_record USING btree (actor_participant_id);
CREATE INDEX core_idempotency_record_fk4 ON public.idempotency_record USING btree (order_batch_id);
CREATE INDEX core_idempotency_record_fk5 ON public.idempotency_record USING btree (payment_intent_id);
CREATE UNIQUE INDEX idempotency_record_pkey ON public.idempotency_record USING btree (id);
CREATE INDEX pdm_idem_expiry ON public.idempotency_record USING btree (expires_at);
CREATE UNIQUE INDEX pdm_idem_guest ON public.idempotency_record USING btree (scope, actor_participant_id, idempotency_key) WHERE (actor_type = 'GUEST'::text);
CREATE UNIQUE INDEX pdm_idem_system ON public.idempotency_record USING btree (scope, idempotency_key) WHERE (actor_type = 'SYSTEM'::text);
CREATE UNIQUE INDEX pdm_idem_user ON public.idempotency_record USING btree (scope, actor_user_id, idempotency_key) WHERE (actor_type = 'USER'::text);
```

## ingredient



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| code | text | Có |  | — | — |
| name | text | Có |  | — | — |
| base_unit_id | uuid | Có | FK | — | — |
| min_stock | numeric(18,6) | Có |  | 0 | — |
| is_active | boolean | Có |  | true | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
ingredient_code_check: CHECK ((length(btrim(code)) > 0))
ingredient_min_stock_check: CHECK ((min_stock >= (0)::numeric))
ingredient_name_check: CHECK ((length(btrim(name)) > 0))
ingredient_version_check: CHECK ((version > 0))
core_ingredient_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_ingredient_f2: FOREIGN KEY (base_unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT
ingredient_base_unit_id_not_null: NOT NULL base_unit_id
ingredient_code_not_null: NOT NULL code
ingredient_created_at_not_null: NOT NULL created_at
ingredient_id_not_null: NOT NULL id
ingredient_is_active_not_null: NOT NULL is_active
ingredient_min_stock_not_null: NOT NULL min_stock
ingredient_name_not_null: NOT NULL name
ingredient_restaurant_id_not_null: NOT NULL restaurant_id
ingredient_updated_at_not_null: NOT NULL updated_at
ingredient_version_not_null: NOT NULL version
ingredient_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
ingredient_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE INDEX core_ingredient_fk1 ON public.ingredient USING btree (restaurant_id);
CREATE INDEX core_ingredient_fk2 ON public.ingredient USING btree (base_unit_id);
CREATE UNIQUE INDEX ingredient_pkey ON public.ingredient USING btree (id);
CREATE UNIQUE INDEX ingredient_restaurant_id_code_key ON public.ingredient USING btree (restaurant_id, code);
```

## inventory_balance

Per-location stock aggregate. available_qty=on_hand_qty-reserved_qty; reconcile against movements and active reservations.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| location_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| on_hand_qty | numeric(18,6) | Có |  | 0 | — |
| reserved_qty | numeric(18,6) | Có |  | 0 | — |
| available_qty | numeric(18,6) | Có |  | — | — |
| avg_cost | numeric(18,6) | Có |  | 0 | Moving weighted average VND per base unit for this location; snapshotted when consumed. |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
inventory_balance_available_qty_check: CHECK ((available_qty >= (0)::numeric))
inventory_balance_avg_cost_check: CHECK ((avg_cost >= (0)::numeric))
inventory_balance_check: CHECK (((available_qty = (on_hand_qty - reserved_qty)) AND (reserved_qty <= on_hand_qty)))
inventory_balance_on_hand_qty_check: CHECK ((on_hand_qty >= (0)::numeric))
inventory_balance_reserved_qty_check: CHECK ((reserved_qty >= (0)::numeric))
inventory_balance_version_check: CHECK ((version > 0))
core_inventory_balance_f1: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_balance_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_balance_available_qty_not_null: NOT NULL available_qty
inventory_balance_avg_cost_not_null: NOT NULL avg_cost
inventory_balance_created_at_not_null: NOT NULL created_at
inventory_balance_id_not_null: NOT NULL id
inventory_balance_ingredient_id_not_null: NOT NULL ingredient_id
inventory_balance_location_id_not_null: NOT NULL location_id
inventory_balance_on_hand_qty_not_null: NOT NULL on_hand_qty
inventory_balance_reserved_qty_not_null: NOT NULL reserved_qty
inventory_balance_updated_at_not_null: NOT NULL updated_at
inventory_balance_version_not_null: NOT NULL version
inventory_balance_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
inventory_balance_location_id_ingredient_id_key: UNIQUE (location_id, ingredient_id)
```

### Chỉ mục
```sql
CREATE INDEX core_inventory_balance_fk1 ON public.inventory_balance USING btree (location_id);
CREATE INDEX core_inventory_balance_fk2 ON public.inventory_balance USING btree (ingredient_id);
CREATE UNIQUE INDEX inventory_balance_location_id_ingredient_id_key ON public.inventory_balance USING btree (location_id, ingredient_id);
CREATE UNIQUE INDEX inventory_balance_pkey ON public.inventory_balance USING btree (id);
```

## inventory_movement



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| location_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| movement_type | text | Có |  | — | — |
| quantity | numeric(18,6) | Có |  | — | — |
| unit_cost | numeric(18,6) | Có |  | — | — |
| value | bigint | Có |  | — | — |
| source_type | text | Có |  | — | — |
| occurred_at | timestamp(6) with time zone | Có |  | now() | — |
| created_by | uuid | Không | FK | — | — |
| goods_receipt_id | uuid | Không | FK | — | — |
| order_item_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| request_key | text | Không |  | — | — |
| reason | text | Không |  | — | — |

### Ràng buộc
```sql
inventory_movement_check: CHECK (((((source_type = 'GOODS_RECEIPT'::text) AND (goods_receipt_id IS NOT NULL) AND (order_item_id IS NULL)) OR ((source_type = 'ORDER_ITEM'::text) AND (goods_receipt_id IS NULL) AND (order_item_id IS NOT NULL)) OR ((source_type = 'MANUAL'::text) AND (goods_receipt_id IS NULL) AND (order_item_id IS NULL))) IS TRUE))
inventory_movement_check1: CHECK ((((movement_type = ANY (ARRAY['RECEIPT'::text, 'ADJUSTMENT_IN'::text, 'TRANSFER_IN'::text])) AND (quantity > (0)::numeric) AND (value >= 0)) OR ((movement_type = ANY (ARRAY['CONSUMPTION'::text, 'WASTE'::text, 'ADJUSTMENT_OUT'::text, 'TRANSFER_OUT'::text])) AND (quantity < (0)::numeric) AND (value <= 0))))
inventory_movement_movement_type_check: CHECK ((movement_type = ANY (ARRAY['RECEIPT'::text, 'CONSUMPTION'::text, 'WASTE'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'TRANSFER_IN'::text, 'TRANSFER_OUT'::text])))
inventory_movement_movement_type_check1: CHECK ((length(btrim(movement_type)) > 0))
inventory_movement_quantity_check: CHECK ((quantity <> (0)::numeric))
inventory_movement_source_type_check: CHECK ((source_type = ANY (ARRAY['GOODS_RECEIPT'::text, 'ORDER_ITEM'::text, 'MANUAL'::text])))
inventory_movement_source_type_check1: CHECK ((length(btrim(source_type)) > 0))
inventory_movement_unit_cost_check: CHECK ((unit_cost >= (0)::numeric))
core_inventory_movement_f1: FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f4: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f5: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f6: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_movement_created_at_not_null: NOT NULL created_at
inventory_movement_id_not_null: NOT NULL id
inventory_movement_ingredient_id_not_null: NOT NULL ingredient_id
inventory_movement_location_id_not_null: NOT NULL location_id
inventory_movement_movement_type_not_null: NOT NULL movement_type
inventory_movement_occurred_at_not_null: NOT NULL occurred_at
inventory_movement_quantity_not_null: NOT NULL quantity
inventory_movement_source_type_not_null: NOT NULL source_type
inventory_movement_unit_cost_not_null: NOT NULL unit_cost
inventory_movement_value_not_null: NOT NULL value
inventory_movement_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX core_consumption_line ON public.inventory_movement USING btree (order_item_id, ingredient_id, location_id) WHERE (movement_type = 'CONSUMPTION'::text);
CREATE INDEX core_inventory_movement_fk1 ON public.inventory_movement USING btree (goods_receipt_id);
CREATE INDEX core_inventory_movement_fk2 ON public.inventory_movement USING btree (order_item_id);
CREATE INDEX core_inventory_movement_fk4 ON public.inventory_movement USING btree (location_id);
CREATE INDEX core_inventory_movement_fk5 ON public.inventory_movement USING btree (ingredient_id);
CREATE INDEX core_inventory_movement_fk6 ON public.inventory_movement USING btree (created_by);
CREATE UNIQUE INDEX inventory_manual_request_key ON public.inventory_movement USING btree (location_id, request_key) WHERE (request_key IS NOT NULL);
CREATE INDEX inventory_movement_history_idx ON public.inventory_movement USING btree (location_id, occurred_at DESC, id);
CREATE UNIQUE INDEX inventory_movement_pkey ON public.inventory_movement USING btree (id);
```

## inventory_reservation



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_item_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| location_id | uuid | Có | FK | — | — |
| reservation_type | text | Có |  | — | — |
| quantity | numeric(18,6) | Có |  | — | — |
| status | text | Có |  | 'PROVISIONAL'::text | — |
| expires_at | timestamp(6) with time zone | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
inventory_reservation_quantity_check: CHECK ((quantity > (0)::numeric))
inventory_reservation_reservation_type_check: CHECK ((reservation_type = ANY (ARRAY['PROVISIONAL'::text, 'CONFIRMED'::text])))
inventory_reservation_reservation_type_check1: CHECK ((length(btrim(reservation_type)) > 0))
inventory_reservation_status_check: CHECK ((status = ANY (ARRAY['PROVISIONAL'::text, 'ACTIVE'::text, 'CONSUMED'::text, 'RELEASED'::text, 'EXPIRED'::text])))
inventory_reservation_status_check1: CHECK ((length(btrim(status)) > 0))
core_inventory_reservation_f1: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_reservation_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_reservation_f3: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_reservation_created_at_not_null: NOT NULL created_at
inventory_reservation_id_not_null: NOT NULL id
inventory_reservation_ingredient_id_not_null: NOT NULL ingredient_id
inventory_reservation_location_id_not_null: NOT NULL location_id
inventory_reservation_order_item_id_not_null: NOT NULL order_item_id
inventory_reservation_quantity_not_null: NOT NULL quantity
inventory_reservation_reservation_type_not_null: NOT NULL reservation_type
inventory_reservation_status_not_null: NOT NULL status
inventory_reservation_updated_at_not_null: NOT NULL updated_at
inventory_reservation_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_inventory_reservation_fk1 ON public.inventory_reservation USING btree (order_item_id);
CREATE INDEX core_inventory_reservation_fk2 ON public.inventory_reservation USING btree (ingredient_id);
CREATE INDEX core_inventory_reservation_fk3 ON public.inventory_reservation USING btree (location_id);
CREATE UNIQUE INDEX core_reservation_line ON public.inventory_reservation USING btree (order_item_id, ingredient_id, location_id);
CREATE UNIQUE INDEX inventory_reservation_pkey ON public.inventory_reservation USING btree (id);
```

## menu_category

Danh mục món

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Có | FK | — | Tham chiếu restaurant; không xóa lịch sử |
| code | text | Có |  | — | Mã danh mục |
| name | text | Có |  | — | Tên danh mục |
| description | text | Không |  | — | Mô tả |
| sort_order | integer | Có |  | 0 | Thứ tự hiển thị |
| is_active | boolean | Có |  | true | Ngừng dùng bằng false; giữ lịch sử |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
menu_category_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
menu_category_code_not_null: NOT NULL code
menu_category_created_at_not_null: NOT NULL created_at
menu_category_id_not_null: NOT NULL id
menu_category_is_active_not_null: NOT NULL is_active
menu_category_name_not_null: NOT NULL name
menu_category_restaurant_id_not_null: NOT NULL restaurant_id
menu_category_sort_order_not_null: NOT NULL sort_order
menu_category_updated_at_not_null: NOT NULL updated_at
menu_category_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
menu_category_id_restaurant_id_key: UNIQUE (id, restaurant_id)
menu_category_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX menu_category_id_restaurant_id_key ON public.menu_category USING btree (id, restaurant_id);
CREATE UNIQUE INDEX menu_category_pkey ON public.menu_category USING btree (id);
CREATE UNIQUE INDEX menu_category_restaurant_id_code_key ON public.menu_category USING btree (restaurant_id, code);
```

## menu_promotion



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| product_id | uuid | Có | FK | — | — |
| image_url | text | Có |  | — | — |
| image_width | integer | Có |  | — | — |
| image_height | integer | Có |  | — | — |
| presentation | text | Có |  | 'PHOTO'::text | — |
| eyebrow | text | Không |  | — | — |
| image_note | text | Không |  | — | — |
| expected_price | bigint | Không |  | — | — |
| expected_components | jsonb | Có |  | '[]'::jsonb | — |
| sort_order | integer | Có |  | 0 | — |
| is_active | boolean | Có |  | true | — |
| is_deleted | boolean | Có |  | false | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
menu_promotion_expected_components_check: CHECK (((jsonb_typeof(expected_components) = 'array'::text) AND (jsonb_array_length(expected_components) <= 20)))
menu_promotion_expected_price_check: CHECK ((expected_price >= 0))
menu_promotion_eyebrow_check: CHECK ((char_length(eyebrow) <= 80))
menu_promotion_image_height_check: CHECK (((image_height >= 1) AND (image_height <= 20000)))
menu_promotion_image_note_check: CHECK ((char_length(image_note) <= 300))
menu_promotion_image_url_check: CHECK ((image_url ~ '^/api/menu-images/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$'::text))
menu_promotion_image_width_check: CHECK (((image_width >= 1) AND (image_width <= 20000)))
menu_promotion_presentation_check: CHECK ((presentation = ANY (ARRAY['PHOTO'::text, 'POSTER'::text])))
menu_promotion_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 1000)))
menu_promotion_version_check: CHECK ((version > 0))
menu_promotion_product_tenant_fk: FOREIGN KEY (product_id, restaurant_id) REFERENCES product(id, restaurant_id) ON UPDATE RESTRICT ON DELETE CASCADE
menu_promotion_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
menu_promotion_created_at_not_null: NOT NULL created_at
menu_promotion_expected_components_not_null: NOT NULL expected_components
menu_promotion_id_not_null: NOT NULL id
menu_promotion_image_height_not_null: NOT NULL image_height
menu_promotion_image_url_not_null: NOT NULL image_url
menu_promotion_image_width_not_null: NOT NULL image_width
menu_promotion_is_active_not_null: NOT NULL is_active
menu_promotion_is_deleted_not_null: NOT NULL is_deleted
menu_promotion_presentation_not_null: NOT NULL presentation
menu_promotion_product_id_not_null: NOT NULL product_id
menu_promotion_restaurant_id_not_null: NOT NULL restaurant_id
menu_promotion_sort_order_not_null: NOT NULL sort_order
menu_promotion_updated_at_not_null: NOT NULL updated_at
menu_promotion_version_not_null: NOT NULL version
menu_promotion_pkey: PRIMARY KEY (id)
menu_promotion_restaurant_id_product_id_key: UNIQUE (restaurant_id, product_id)
```

### Chỉ mục
```sql
CREATE INDEX menu_promotion_active_order ON public.menu_promotion USING btree (restaurant_id, is_active, sort_order, id);
CREATE UNIQUE INDEX menu_promotion_pkey ON public.menu_promotion USING btree (id);
CREATE UNIQUE INDEX menu_promotion_restaurant_id_product_id_key ON public.menu_promotion USING btree (restaurant_id, product_id);
```

## operational_alert



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Không | FK | — | — |
| table_id | uuid | Có | FK | — | — |
| alert_type | text | Có |  | — | — |
| severity | text | Có |  | — | — |
| outstanding_amount | bigint | Có |  | 0 | — |
| status | text | Có |  | 'NEW'::text | — |
| acknowledged_by | uuid | Không | FK | — | — |
| escalated_at | timestamp(6) with time zone | Không |  | — | — |
| resolved_at | timestamp(6) with time zone | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| resolution_note | text | Không |  | — | — |
| resolved_by | uuid | Không | FK | — | — |

### Ràng buộc
```sql
operational_alert_alert_type_check: CHECK ((alert_type = ANY (ARRAY['PAYMENT_SHORTFALL'::text, 'REFUND_REQUIRED'::text, 'RISK_REVIEW'::text, 'OTHER'::text])))
operational_alert_alert_type_check1: CHECK ((length(btrim(alert_type)) > 0))
operational_alert_check: CHECK (((alert_type <> 'PAYMENT_SHORTFALL'::text) OR (session_id IS NOT NULL)))
operational_alert_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
operational_alert_severity_check: CHECK ((severity = ANY (ARRAY['INFO'::text, 'WARNING'::text, 'CRITICAL'::text])))
operational_alert_severity_check1: CHECK ((length(btrim(severity)) > 0))
operational_alert_status_check: CHECK ((status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text, 'ESCALATED'::text, 'RESOLVED'::text])))
operational_alert_status_check1: CHECK ((length(btrim(status)) > 0))
core_operational_alert_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_operational_alert_f2: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_operational_alert_f3: FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
operational_alert_resolved_by_fkey: FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON DELETE RESTRICT
operational_alert_alert_type_not_null: NOT NULL alert_type
operational_alert_created_at_not_null: NOT NULL created_at
operational_alert_id_not_null: NOT NULL id
operational_alert_outstanding_amount_not_null: NOT NULL outstanding_amount
operational_alert_severity_not_null: NOT NULL severity
operational_alert_status_not_null: NOT NULL status
operational_alert_table_id_not_null: NOT NULL table_id
operational_alert_updated_at_not_null: NOT NULL updated_at
operational_alert_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
uat_alert_resolver_tenant: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX alert_resolved_by_lookup ON public.operational_alert USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);
CREATE INDEX core_operational_alert_fk1 ON public.operational_alert USING btree (session_id);
CREATE INDEX core_operational_alert_fk2 ON public.operational_alert USING btree (table_id);
CREATE INDEX core_operational_alert_fk3 ON public.operational_alert USING btree (acknowledged_by);
CREATE UNIQUE INDEX operational_alert_pkey ON public.operational_alert USING btree (id);
CREATE UNIQUE INDEX pdm_alert_shortfall ON public.operational_alert USING btree (session_id) WHERE ((alert_type = 'PAYMENT_SHORTFALL'::text) AND (status <> 'RESOLVED'::text) AND (session_id IS NOT NULL));
```

## order_batch



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| created_by_type | text | Có |  | — | — |
| client_request_id | text | Có |  | — | — |
| status | text | Có |  | 'SUBMITTED'::text | — |
| subtotal | bigint | Có |  | — | — |
| total_amount | bigint | Có |  | — | — |
| risk_decision | text | Không |  | — | — |
| config_version | integer | Không |  | — | — |
| submitted_at | timestamp(6) with time zone | Không |  | — | — |
| accepted_at | timestamp(6) with time zone | Không |  | — | — |
| version | integer | Có |  | 1 | — |
| created_by_user_id | uuid | Không | FK | — | — |
| created_by_participant_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
order_batch_check: CHECK (((((created_by_type = 'USER'::text) AND (created_by_user_id IS NOT NULL) AND (created_by_participant_id IS NULL)) OR ((created_by_type = 'GUEST'::text) AND (created_by_user_id IS NULL) AND (created_by_participant_id IS NOT NULL))) IS TRUE))
order_batch_client_request_id_check: CHECK ((length(btrim(client_request_id)) > 0))
order_batch_config_version_check: CHECK ((config_version >= 0))
order_batch_created_by_type_check: CHECK ((created_by_type = ANY (ARRAY['USER'::text, 'GUEST'::text])))
order_batch_created_by_type_check1: CHECK ((length(btrim(created_by_type)) > 0))
order_batch_risk_decision_check: CHECK ((risk_decision = ANY (ARRAY['ALLOW'::text, 'REVIEW'::text, 'BLOCK'::text])))
order_batch_status_check: CHECK ((status = ANY (ARRAY['PENDING_REVIEW'::text, 'SUBMITTED'::text, 'ACCEPTED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
order_batch_status_check1: CHECK ((length(btrim(status)) > 0))
order_batch_subtotal_check: CHECK ((subtotal >= 0))
order_batch_total_amount_check: CHECK ((total_amount >= 0))
order_batch_version_check: CHECK ((version > 0))
core_order_batch_f1: FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_batch_f2: FOREIGN KEY (created_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_batch_f4: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_batch_client_request_id_not_null: NOT NULL client_request_id
order_batch_created_at_not_null: NOT NULL created_at
order_batch_created_by_type_not_null: NOT NULL created_by_type
order_batch_id_not_null: NOT NULL id
order_batch_session_id_not_null: NOT NULL session_id
order_batch_status_not_null: NOT NULL status
order_batch_subtotal_not_null: NOT NULL subtotal
order_batch_total_amount_not_null: NOT NULL total_amount
order_batch_updated_at_not_null: NOT NULL updated_at
order_batch_version_not_null: NOT NULL version
order_batch_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_order_batch_fk1 ON public.order_batch USING btree (created_by_user_id);
CREATE INDEX core_order_batch_fk2 ON public.order_batch USING btree (created_by_participant_id);
CREATE INDEX core_order_batch_fk4 ON public.order_batch USING btree (session_id);
CREATE UNIQUE INDEX order_batch_pkey ON public.order_batch USING btree (id);
CREATE UNIQUE INDEX pdm_order_guest_request ON public.order_batch USING btree (session_id, created_by_participant_id, client_request_id) WHERE (created_by_type = 'GUEST'::text);
CREATE UNIQUE INDEX pdm_order_user_request ON public.order_batch USING btree (session_id, created_by_user_id, client_request_id) WHERE (created_by_type = 'USER'::text);
```

## order_item



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_batch_id | uuid | Có | FK | — | — |
| owner_participant_id | uuid | Không | FK | — | — |
| product_id | uuid | Có | FK | — | — |
| product_name_snapshot | text | Có |  | — | — |
| quantity | integer | Có |  | — | — |
| unit_price_snapshot | bigint | Có |  | — | — |
| line_total | bigint | Có |  | — | — |
| note | text | Không |  | — | — |
| status | text | Có |  | 'SUBMITTED'::text | — |
| cancel_reason | text | Không |  | — | — |
| version | integer | Có |  | 1 | — |
| cancelled_by_type | text | Không |  | — | — |
| cancelled_by_user_id | uuid | Không | FK | — | — |
| cancelled_by_participant_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| received_at | timestamp with time zone | Không |  | — | — |
| preparation_started_at | timestamp with time zone | Không |  | — | — |
| ready_at | timestamp with time zone | Không |  | — | — |
| served_at | timestamp with time zone | Không |  | — | — |
| stock_managed_snapshot | boolean | Có |  | true | — |
| cancel_reason_code | text | Không |  | — | — |
| product_kind_snapshot | text | Có |  | 'DISH'::text | — |
| combo_components_snapshot | jsonb | Có |  | '[]'::jsonb | — |
| tax_snapshot | jsonb | Không |  | — | — |

### Ràng buộc
```sql
order_combo_snapshot_matches_kind: CHECK ((((product_kind_snapshot = 'DISH'::text) AND (jsonb_array_length(combo_components_snapshot) = 0)) OR ((product_kind_snapshot = 'COMBO'::text) AND ((jsonb_array_length(combo_components_snapshot) >= 2) AND (jsonb_array_length(combo_components_snapshot) <= 20)))))
order_item_cancellation_check: CHECK (((status <> ALL (ARRAY['CANCELLED'::text, 'UNAVAILABLE'::text])) OR ((cancel_reason IS NOT NULL) AND (length(btrim(cancel_reason)) > 0) AND (cancelled_by_type IS NOT NULL))))
order_item_cancelled_by_type_check: CHECK ((cancelled_by_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
order_item_check: CHECK (((((cancelled_by_type = 'USER'::text) AND (cancelled_by_user_id IS NOT NULL) AND (cancelled_by_participant_id IS NULL)) OR ((cancelled_by_type = 'GUEST'::text) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NOT NULL)) OR ((cancelled_by_type = 'SYSTEM'::text) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NULL)) OR ((cancelled_by_type IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NULL))) IS TRUE))
order_item_check1: CHECK (((line_total)::numeric = ((quantity)::numeric * (unit_price_snapshot)::numeric)))
order_item_combo_components_snapshot_check: CHECK ((jsonb_typeof(combo_components_snapshot) = 'array'::text))
order_item_line_total_check: CHECK ((line_total >= 0))
order_item_product_kind_snapshot_check: CHECK ((product_kind_snapshot = ANY (ARRAY['DISH'::text, 'COMBO'::text])))
order_item_product_name_snapshot_check: CHECK ((length(btrim(product_name_snapshot)) > 0))
order_item_quantity_check: CHECK ((quantity > 0))
order_item_reason_code: CHECK (((cancel_reason_code IS NULL) OR (cancel_reason_code = ANY (ARRAY['CUSTOMER_CHANGED_MIND'::text, 'OUT_OF_STOCK'::text, 'INGREDIENT_QUALITY'::text, 'EQUIPMENT_FAILURE'::text, 'KITCHEN_ERROR'::text, 'QUALITY_ISSUE'::text, 'WRONG_ITEM'::text, 'CUSTOMER_COMPLAINT'::text, 'OTHER'::text]))))
order_item_status_check: CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'ACCEPTED'::text, 'IN_PREPARATION'::text, 'READY'::text, 'SERVED'::text, 'UNAVAILABLE'::text, 'CANCELLED'::text])))
order_item_status_check1: CHECK ((length(btrim(status)) > 0))
order_item_unit_price_snapshot_check: CHECK ((unit_price_snapshot >= 0))
order_item_version_check: CHECK ((version > 0))
core_order_item_f1: FOREIGN KEY (cancelled_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f2: FOREIGN KEY (cancelled_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f5: FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f6: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_item_combo_components_snapshot_not_null: NOT NULL combo_components_snapshot
order_item_created_at_not_null: NOT NULL created_at
order_item_id_not_null: NOT NULL id
order_item_line_total_not_null: NOT NULL line_total
order_item_order_batch_id_not_null: NOT NULL order_batch_id
order_item_product_id_not_null: NOT NULL product_id
order_item_product_kind_snapshot_not_null: NOT NULL product_kind_snapshot
order_item_product_name_snapshot_not_null: NOT NULL product_name_snapshot
order_item_quantity_not_null: NOT NULL quantity
order_item_status_not_null: NOT NULL status
order_item_stock_managed_snapshot_not_null: NOT NULL stock_managed_snapshot
order_item_unit_price_snapshot_not_null: NOT NULL unit_price_snapshot
order_item_updated_at_not_null: NOT NULL updated_at
order_item_version_not_null: NOT NULL version
order_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_order_item_fk1 ON public.order_item USING btree (cancelled_by_user_id);
CREATE INDEX core_order_item_fk2 ON public.order_item USING btree (cancelled_by_participant_id);
CREATE INDEX core_order_item_fk4 ON public.order_item USING btree (order_batch_id);
CREATE INDEX core_order_item_fk5 ON public.order_item USING btree (owner_participant_id);
CREATE INDEX core_order_item_fk6 ON public.order_item USING btree (product_id);
CREATE UNIQUE INDEX order_item_pkey ON public.order_item USING btree (id);
```

## order_item_ingredient_snapshot



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_item_id | uuid | Có | FK | — | — |
| recipe_bom_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| planned_qty | numeric(18,6) | Có |  | — | — |
| consumed_qty | numeric(18,6) | Có |  | — | — |
| unit_cost_snapshot | numeric(18,6) | Có |  | — | — |
| cogs_value | bigint | Có |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
order_item_ingredient_snapshot_cogs_value_check: CHECK ((cogs_value >= 0))
order_item_ingredient_snapshot_consumed_qty_check: CHECK ((consumed_qty >= (0)::numeric))
order_item_ingredient_snapshot_planned_qty_check: CHECK ((planned_qty >= (0)::numeric))
order_item_ingredient_snapshot_unit_cost_snapshot_check: CHECK ((unit_cost_snapshot >= (0)::numeric))
core_order_item_ingredient_snapshot_f1: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_ingredient_snapshot_f2: FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_ingredient_snapshot_f3: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_item_ingredient_snapshot_cogs_value_not_null: NOT NULL cogs_value
order_item_ingredient_snapshot_consumed_qty_not_null: NOT NULL consumed_qty
order_item_ingredient_snapshot_created_at_not_null: NOT NULL created_at
order_item_ingredient_snapshot_id_not_null: NOT NULL id
order_item_ingredient_snapshot_ingredient_id_not_null: NOT NULL ingredient_id
order_item_ingredient_snapshot_order_item_id_not_null: NOT NULL order_item_id
order_item_ingredient_snapshot_planned_qty_not_null: NOT NULL planned_qty
order_item_ingredient_snapshot_recipe_bom_id_not_null: NOT NULL recipe_bom_id
order_item_ingredient_snapshot_unit_cost_snapshot_not_null: NOT NULL unit_cost_snapshot
order_item_ingredient_snapshot_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
order_item_ingredient_snapsho_order_item_id_recipe_bom_id_i_key: UNIQUE (order_item_id, recipe_bom_id, ingredient_id)
```

### Chỉ mục
```sql
CREATE INDEX core_order_item_ingredient_snapshot_fk1 ON public.order_item_ingredient_snapshot USING btree (order_item_id);
CREATE INDEX core_order_item_ingredient_snapshot_fk2 ON public.order_item_ingredient_snapshot USING btree (recipe_bom_id);
CREATE INDEX core_order_item_ingredient_snapshot_fk3 ON public.order_item_ingredient_snapshot USING btree (ingredient_id);
CREATE UNIQUE INDEX order_item_ingredient_snapsho_order_item_id_recipe_bom_id_i_key ON public.order_item_ingredient_snapshot USING btree (order_item_id, recipe_bom_id, ingredient_id);
CREATE UNIQUE INDEX order_item_ingredient_snapshot_pkey ON public.order_item_ingredient_snapshot USING btree (id);
```

## order_review



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_batch_id | uuid | Có | FK | — | — |
| status | text | Có |  | 'PENDING'::text | — |
| requested_at | timestamp(6) with time zone | Có |  | now() | — |
| expires_at | timestamp(6) with time zone | Có |  | — | — |
| reviewer_id | uuid | Không | FK | — | — |
| decided_at | timestamp(6) with time zone | Không |  | — | — |
| decision_reason | text | Không |  | — | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
order_review_check: CHECK ((expires_at > requested_at))
order_review_check1: CHECK (((status <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text])) OR ((reviewer_id IS NOT NULL) AND (decided_at IS NOT NULL))))
order_review_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text])))
order_review_status_check1: CHECK ((length(btrim(status)) > 0))
order_review_version_check: CHECK ((version > 0))
core_order_review_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_review_f2: FOREIGN KEY (reviewer_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_review_created_at_not_null: NOT NULL created_at
order_review_expires_at_not_null: NOT NULL expires_at
order_review_id_not_null: NOT NULL id
order_review_order_batch_id_not_null: NOT NULL order_batch_id
order_review_requested_at_not_null: NOT NULL requested_at
order_review_status_not_null: NOT NULL status
order_review_updated_at_not_null: NOT NULL updated_at
order_review_version_not_null: NOT NULL version
order_review_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_order_review_fk1 ON public.order_review USING btree (order_batch_id);
CREATE INDEX core_order_review_fk2 ON public.order_review USING btree (reviewer_id);
CREATE UNIQUE INDEX order_review_pkey ON public.order_review USING btree (id);
CREATE UNIQUE INDEX pdm_review_pending ON public.order_review USING btree (order_batch_id) WHERE (status = 'PENDING'::text);
```

## order_risk_assessment



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_batch_id | uuid | Có | FK | — | — |
| decision | text | Có |  | — | — |
| score | numeric(18,6) | Không |  | — | — |
| metric_snapshot | jsonb | Có |  | — | — |
| reason_codes | jsonb | Có |  | — | — |
| config_version | integer | Không |  | — | — |
| config_snapshot | jsonb | Có |  | — | — |
| evaluated_at | timestamp(6) with time zone | Có |  | now() | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
order_risk_assessment_config_version_check: CHECK ((config_version >= 0))
order_risk_assessment_decision_check: CHECK ((decision = ANY (ARRAY['ALLOW'::text, 'REVIEW'::text, 'BLOCK'::text])))
order_risk_assessment_decision_check1: CHECK ((length(btrim(decision)) > 0))
core_order_risk_assessment_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_risk_assessment_config_snapshot_not_null: NOT NULL config_snapshot
order_risk_assessment_created_at_not_null: NOT NULL created_at
order_risk_assessment_decision_not_null: NOT NULL decision
order_risk_assessment_evaluated_at_not_null: NOT NULL evaluated_at
order_risk_assessment_id_not_null: NOT NULL id
order_risk_assessment_metric_snapshot_not_null: NOT NULL metric_snapshot
order_risk_assessment_order_batch_id_not_null: NOT NULL order_batch_id
order_risk_assessment_reason_codes_not_null: NOT NULL reason_codes
order_risk_assessment_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_order_risk_assessment_fk1 ON public.order_risk_assessment USING btree (order_batch_id);
CREATE UNIQUE INDEX order_risk_assessment_pkey ON public.order_risk_assessment USING btree (id);
```

## order_status_history



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| order_batch_id | uuid | Có | FK | — | — |
| order_item_id | uuid | Không | FK | — | — |
| old_status | text | Không |  | — | — |
| new_status | text | Có |  | — | — |
| actor_type | text | Có |  | — | — |
| reason | text | Không |  | — | — |
| changed_at | timestamp(6) with time zone | Có |  | now() | — |
| actor_user_id | uuid | Không | FK | — | — |
| actor_participant_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
order_status_history_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
order_status_history_actor_type_check1: CHECK ((length(btrim(actor_type)) > 0))
order_status_history_check: CHECK (((((actor_type = 'USER'::text) AND (actor_user_id IS NOT NULL) AND (actor_participant_id IS NULL)) OR ((actor_type = 'GUEST'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NULL))) IS TRUE))
order_status_history_new_status_check: CHECK ((length(btrim(new_status)) > 0))
core_order_status_history_f1: FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f2: FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f5: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_status_history_actor_type_not_null: NOT NULL actor_type
order_status_history_changed_at_not_null: NOT NULL changed_at
order_status_history_created_at_not_null: NOT NULL created_at
order_status_history_id_not_null: NOT NULL id
order_status_history_new_status_not_null: NOT NULL new_status
order_status_history_order_batch_id_not_null: NOT NULL order_batch_id
order_status_history_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_order_status_history_fk1 ON public.order_status_history USING btree (actor_user_id);
CREATE INDEX core_order_status_history_fk2 ON public.order_status_history USING btree (actor_participant_id);
CREATE INDEX core_order_status_history_fk4 ON public.order_status_history USING btree (order_batch_id);
CREATE INDEX core_order_status_history_fk5 ON public.order_status_history USING btree (order_item_id);
CREATE UNIQUE INDEX order_status_history_pkey ON public.order_status_history USING btree (id);
```

## outbox_event



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| aggregate_type | text | Có |  | — | — |
| event_type | text | Có |  | — | — |
| payload | jsonb | Có |  | — | — |
| status | text | Có |  | 'PENDING'::text | — |
| attempts | integer | Có |  | 0 | — |
| available_at | timestamp(6) with time zone | Có |  | now() | — |
| published_at | timestamp(6) with time zone | Không |  | — | — |
| order_batch_id | uuid | Không | FK | — | — |
| payment_transaction_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| support_request_id | uuid | Không | FK | — | Support aggregate FK used by the existing outbox publisher and tenant resolver. |

### Ràng buộc
```sql
outbox_event_aggregate_type_check: CHECK ((aggregate_type = ANY (ARRAY['ORDER_BATCH'::text, 'PAYMENT_TRANSACTION'::text, 'SUPPORT_REQUEST'::text])))
outbox_event_aggregate_type_check1: CHECK ((length(btrim(aggregate_type)) > 0))
outbox_event_attempts_check: CHECK ((attempts >= 0))
outbox_event_check: CHECK (((((aggregate_type = 'ORDER_BATCH'::text) AND (order_batch_id IS NOT NULL) AND (payment_transaction_id IS NULL) AND (support_request_id IS NULL)) OR ((aggregate_type = 'PAYMENT_TRANSACTION'::text) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NOT NULL) AND (support_request_id IS NULL)) OR ((aggregate_type = 'SUPPORT_REQUEST'::text) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NULL) AND (support_request_id IS NOT NULL))) IS TRUE))
outbox_event_check1: CHECK (((status <> 'PUBLISHED'::text) OR (published_at IS NOT NULL)))
outbox_event_event_type_check: CHECK ((length(btrim(event_type)) > 0))
outbox_event_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'PUBLISHED'::text, 'FAILED'::text])))
outbox_event_status_check1: CHECK ((length(btrim(status)) > 0))
outbox_support_aggregate: CHECK ((((aggregate_type = 'SUPPORT_REQUEST'::text) AND (support_request_id IS NOT NULL) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NULL)) OR ((aggregate_type <> 'SUPPORT_REQUEST'::text) AND (support_request_id IS NULL))))
core_outbox_event_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outbox_event_f2: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outbox_event_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outbox_event_aggregate_type_not_null: NOT NULL aggregate_type
outbox_event_attempts_not_null: NOT NULL attempts
outbox_event_available_at_not_null: NOT NULL available_at
outbox_event_created_at_not_null: NOT NULL created_at
outbox_event_event_type_not_null: NOT NULL event_type
outbox_event_id_not_null: NOT NULL id
outbox_event_payload_not_null: NOT NULL payload
outbox_event_status_not_null: NOT NULL status
outbox_event_updated_at_not_null: NOT NULL updated_at
outbox_event_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
outbox_support_tenant: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_outbox_event_fk1 ON public.outbox_event USING btree (order_batch_id);
CREATE INDEX core_outbox_event_fk2 ON public.outbox_event USING btree (payment_transaction_id);
CREATE UNIQUE INDEX outbox_event_pkey ON public.outbox_event USING btree (id);
CREATE INDEX outbox_support_request ON public.outbox_event USING btree (support_request_id);
CREATE INDEX pdm_outbox_ready ON public.outbox_event USING btree (status, available_at);
```

## outstanding_balance_case



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| table_id | uuid | Có | FK | — | — |
| invoice_total | bigint | Có |  | — | — |
| paid_total | bigint | Có |  | 0 | — |
| outstanding_amount | bigint | Có |  | 0 | — |
| reason_code | text | Có |  | — | — |
| status | text | Có |  | 'PENDING_ADMIN_REVIEW'::text | — |
| reported_by | uuid | Có | FK | — | — |
| admin_owner | uuid | Không | FK | — | — |
| evidence_ref | text | Không |  | — | — |
| notes | text | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
outstanding_balance_case_invoice_total_check: CHECK ((invoice_total >= 0))
outstanding_balance_case_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
outstanding_balance_case_paid_total_check: CHECK ((paid_total >= 0))
outstanding_balance_case_reason_code_check: CHECK ((length(btrim(reason_code)) > 0))
outstanding_balance_case_status_check: CHECK ((status = ANY (ARRAY['PENDING_ADMIN_REVIEW'::text, 'IN_RECOVERY'::text, 'PARTIALLY_RECOVERED'::text, 'RECOVERED'::text, 'WRITTEN_OFF'::text, 'CANCELLED'::text])))
outstanding_balance_case_status_check1: CHECK ((length(btrim(status)) > 0))
core_outstanding_balance_case_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f2: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f3: FOREIGN KEY (reported_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f4: FOREIGN KEY (admin_owner) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outstanding_balance_case_created_at_not_null: NOT NULL created_at
outstanding_balance_case_id_not_null: NOT NULL id
outstanding_balance_case_invoice_total_not_null: NOT NULL invoice_total
outstanding_balance_case_outstanding_amount_not_null: NOT NULL outstanding_amount
outstanding_balance_case_paid_total_not_null: NOT NULL paid_total
outstanding_balance_case_reason_code_not_null: NOT NULL reason_code
outstanding_balance_case_reported_by_not_null: NOT NULL reported_by
outstanding_balance_case_session_id_not_null: NOT NULL session_id
outstanding_balance_case_status_not_null: NOT NULL status
outstanding_balance_case_table_id_not_null: NOT NULL table_id
outstanding_balance_case_updated_at_not_null: NOT NULL updated_at
outstanding_balance_case_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_outstanding_balance_case_fk1 ON public.outstanding_balance_case USING btree (session_id);
CREATE INDEX core_outstanding_balance_case_fk2 ON public.outstanding_balance_case USING btree (table_id);
CREATE INDEX core_outstanding_balance_case_fk3 ON public.outstanding_balance_case USING btree (reported_by);
CREATE INDEX core_outstanding_balance_case_fk4 ON public.outstanding_balance_case USING btree (admin_owner);
CREATE UNIQUE INDEX outstanding_balance_case_pkey ON public.outstanding_balance_case USING btree (id);
CREATE UNIQUE INDEX pdm_outstanding_open ON public.outstanding_balance_case USING btree (session_id) WHERE (status <> ALL (ARRAY['RECOVERED'::text, 'WRITTEN_OFF'::text, 'CANCELLED'::text]));
```

## payment_allocation



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| payment_transaction_id | uuid | Có | FK | — | — |
| financial_charge_id | uuid | Có | FK | — | — |
| allocated_amount | bigint | Có |  | — | — |
| reversed_amount | bigint | Có |  | 0 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payment_allocation_allocated_amount_check: CHECK ((allocated_amount >= 0))
payment_allocation_check: CHECK ((reversed_amount <= allocated_amount))
payment_allocation_reversed_amount_check: CHECK ((reversed_amount >= 0))
core_payment_allocation_f1: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_allocation_f2: FOREIGN KEY (financial_charge_id) REFERENCES financial_charge(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_allocation_allocated_amount_not_null: NOT NULL allocated_amount
payment_allocation_created_at_not_null: NOT NULL created_at
payment_allocation_financial_charge_id_not_null: NOT NULL financial_charge_id
payment_allocation_id_not_null: NOT NULL id
payment_allocation_payment_transaction_id_not_null: NOT NULL payment_transaction_id
payment_allocation_reversed_amount_not_null: NOT NULL reversed_amount
payment_allocation_updated_at_not_null: NOT NULL updated_at
payment_allocation_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_allocation_payment_transaction_id_financial_charge__key: UNIQUE (payment_transaction_id, financial_charge_id)
```

### Chỉ mục
```sql
CREATE INDEX core_payment_allocation_fk1 ON public.payment_allocation USING btree (payment_transaction_id);
CREATE INDEX core_payment_allocation_fk2 ON public.payment_allocation USING btree (financial_charge_id);
CREATE UNIQUE INDEX payment_allocation_payment_transaction_id_financial_charge__key ON public.payment_allocation USING btree (payment_transaction_id, financial_charge_id);
CREATE UNIQUE INDEX payment_allocation_pkey ON public.payment_allocation USING btree (id);
```

## payment_intent



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| payer_participant_id | uuid | Không | FK | — | — |
| method | text | Có |  | — | — |
| amount | bigint | Có |  | — | — |
| currency | text | Có |  | 'VND'::text | — |
| status | text | Có |  | 'CREATED'::text | — |
| client_request_id | text | Có |  | — | — |
| provider | text | Không |  | — | — |
| provider_reference | text | Không |  | — | — |
| expires_at | timestamp(6) with time zone | Có |  | — | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| collection_scope | text | Có |  | 'TABLE'::text | — |
| support_request_id | uuid | Không | FK | — | — |
| proof | jsonb | Không |  | — | — |

### Ràng buộc
```sql
payment_collection_scope: CHECK (((collection_scope = ANY (ARRAY['TABLE'::text, 'PARTICIPANT'::text])) AND ((collection_scope <> 'PARTICIPANT'::text) OR (payer_participant_id IS NOT NULL))))
payment_intent_amount_check: CHECK ((amount > 0))
payment_intent_check: CHECK ((expires_at > created_at))
payment_intent_client_request_id_check: CHECK ((length(btrim(client_request_id)) > 0))
payment_intent_currency_check: CHECK ((length(btrim(currency)) > 0))
payment_intent_currency_check1: CHECK ((currency = 'VND'::text))
payment_intent_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'ONLINE'::text])))
payment_intent_method_check1: CHECK ((length(btrim(method)) > 0))
payment_intent_status_check: CHECK ((status = ANY (ARRAY['CREATED'::text, 'PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'EXPIRED'::text, 'CANCELLED'::text, 'REQUIRES_RECONCILIATION'::text])))
payment_intent_status_check1: CHECK ((length(btrim(status)) > 0))
payment_intent_version_check: CHECK ((version > 0))
core_payment_intent_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_intent_f2: FOREIGN KEY (payer_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_intent_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON DELETE RESTRICT
payment_intent_amount_not_null: NOT NULL amount
payment_intent_client_request_id_not_null: NOT NULL client_request_id
payment_intent_collection_scope_not_null: NOT NULL collection_scope
payment_intent_created_at_not_null: NOT NULL created_at
payment_intent_currency_not_null: NOT NULL currency
payment_intent_expires_at_not_null: NOT NULL expires_at
payment_intent_id_not_null: NOT NULL id
payment_intent_method_not_null: NOT NULL method
payment_intent_session_id_not_null: NOT NULL session_id
payment_intent_status_not_null: NOT NULL status
payment_intent_updated_at_not_null: NOT NULL updated_at
payment_intent_version_not_null: NOT NULL version
payment_intent_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_intent_session_id_client_request_id_key: UNIQUE (session_id, client_request_id)
```

### Chỉ mục
```sql
CREATE INDEX core_payment_intent_fk1 ON public.payment_intent USING btree (session_id);
CREATE INDEX core_payment_intent_fk2 ON public.payment_intent USING btree (payer_participant_id);
CREATE UNIQUE INDEX payment_intent_pkey ON public.payment_intent USING btree (id);
CREATE UNIQUE INDEX payment_intent_session_id_client_request_id_key ON public.payment_intent USING btree (session_id, client_request_id);
CREATE INDEX payment_intent_support_request ON public.payment_intent USING btree (support_request_id);
CREATE UNIQUE INDEX pdm_pending_online ON public.payment_intent USING btree (session_id) WHERE ((method = 'ONLINE'::text) AND (status = ANY (ARRAY['CREATED'::text, 'PENDING'::text])));
```

## payment_transaction



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| payment_intent_id | uuid | Không | FK | — | — |
| session_id | uuid | Có | FK | — | — |
| method | text | Có |  | — | — |
| provider | text | Không |  | — | — |
| provider_transaction_id | text | Không |  | — | — |
| amount | bigint | Có |  | — | — |
| currency | text | Có |  | 'VND'::text | — |
| status | text | Có |  | 'PENDING'::text | — |
| confirmed_by | uuid | Không | FK | — | — |
| confirmed_at | timestamp(6) with time zone | Không |  | — | — |
| metadata | jsonb | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
core_success_confirmation: CHECK (((status <> 'SUCCEEDED'::text) OR (confirmed_at IS NOT NULL)))
payment_transaction_amount_check: CHECK ((amount > 0))
payment_transaction_check: CHECK (((provider IS NULL) = (provider_transaction_id IS NULL)))
payment_transaction_currency_check: CHECK ((length(btrim(currency)) > 0))
payment_transaction_currency_check1: CHECK ((currency = 'VND'::text))
payment_transaction_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'ONLINE'::text])))
payment_transaction_method_check1: CHECK ((length(btrim(method)) > 0))
payment_transaction_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])))
payment_transaction_status_check1: CHECK ((length(btrim(status)) > 0))
core_payment_transaction_f1: FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_transaction_f2: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_transaction_f3: FOREIGN KEY (confirmed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_transaction_amount_not_null: NOT NULL amount
payment_transaction_created_at_not_null: NOT NULL created_at
payment_transaction_currency_not_null: NOT NULL currency
payment_transaction_id_not_null: NOT NULL id
payment_transaction_method_not_null: NOT NULL method
payment_transaction_session_id_not_null: NOT NULL session_id
payment_transaction_status_not_null: NOT NULL status
payment_transaction_updated_at_not_null: NOT NULL updated_at
payment_transaction_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX core_intent_capture ON public.payment_transaction USING btree (payment_intent_id) WHERE ((payment_intent_id IS NOT NULL) AND (status = 'SUCCEEDED'::text) AND (provider IS DISTINCT FROM 'PAYOS'::text));
CREATE INDEX core_payment_transaction_fk1 ON public.payment_transaction USING btree (payment_intent_id);
CREATE INDEX core_payment_transaction_fk2 ON public.payment_transaction USING btree (session_id);
CREATE INDEX core_payment_transaction_fk3 ON public.payment_transaction USING btree (confirmed_by);
CREATE UNIQUE INDEX payment_transaction_pkey ON public.payment_transaction USING btree (id);
CREATE UNIQUE INDEX pdm_provider_tx ON public.payment_transaction USING btree (provider, provider_transaction_id) WHERE (provider IS NOT NULL);
```

## payment_webhook_event

Idempotent receipt log for the internal payment connector; not a deployed online gateway.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| provider | text | Có |  | — | — |
| provider_event_id | text | Có |  | — | — |
| provider_transaction_id | text | Không |  | — | — |
| payload_hash | text | Có |  | — | — |
| payload_snapshot | jsonb | Có |  | — | — |
| signature_valid | boolean | Có |  | — | — |
| processing_status | text | Có |  | 'RECEIVED'::text | — |
| received_at | timestamp(6) with time zone | Có |  | now() | — |
| processed_at | timestamp(6) with time zone | Không |  | — | — |
| payment_transaction_id | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payment_webhook_event_check: CHECK (((processing_status <> 'PROCESSED'::text) OR ((signature_valid IS TRUE) AND (payment_transaction_id IS NOT NULL) AND (processed_at IS NOT NULL))))
payment_webhook_event_payload_hash_check: CHECK ((length(btrim(payload_hash)) > 0))
payment_webhook_event_processing_status_check: CHECK ((processing_status = ANY (ARRAY['RECEIVED'::text, 'UNMATCHED'::text, 'PROCESSED'::text, 'REJECTED'::text, 'FAILED'::text])))
payment_webhook_event_processing_status_check1: CHECK ((length(btrim(processing_status)) > 0))
payment_webhook_event_provider_event_id_check: CHECK ((length(btrim(provider_event_id)) > 0))
core_payment_webhook_event_f1: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_webhook_event_created_at_not_null: NOT NULL created_at
payment_webhook_event_id_not_null: NOT NULL id
payment_webhook_event_payload_hash_not_null: NOT NULL payload_hash
payment_webhook_event_payload_snapshot_not_null: NOT NULL payload_snapshot
payment_webhook_event_processing_status_not_null: NOT NULL processing_status
payment_webhook_event_provider_event_id_not_null: NOT NULL provider_event_id
payment_webhook_event_provider_not_null: NOT NULL provider
payment_webhook_event_received_at_not_null: NOT NULL received_at
payment_webhook_event_signature_valid_not_null: NOT NULL signature_valid
payment_webhook_event_updated_at_not_null: NOT NULL updated_at
payment_webhook_event_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_webhook_event_provider_provider_event_id_key: UNIQUE (provider, provider_event_id)
```

### Chỉ mục
```sql
CREATE INDEX core_payment_webhook_event_fk1 ON public.payment_webhook_event USING btree (payment_transaction_id);
CREATE UNIQUE INDEX payment_webhook_event_pkey ON public.payment_webhook_event USING btree (id);
CREATE UNIQUE INDEX payment_webhook_event_provider_provider_event_id_key ON public.payment_webhook_event USING btree (provider, provider_event_id);
```

## payos_payment_request



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| payment_intent_id | uuid | Có | FK | — | — |
| created_by | uuid | Có | FK | — | — |
| order_code | bigint | Có |  | nextval('payos_order_code_seq'::regclass) | — |
| payment_link_id | text | Không |  | — | — |
| status | text | Có |  | 'CREATE_PENDING'::text | — |
| provider_status | text | Không |  | — | — |
| request_payload | jsonb | Có |  | — | — |
| account_number | text | Không |  | — | — |
| checkout_url | text | Không |  | — | — |
| qr_code | text | Không |  | — | — |
| paid_amount | bigint | Có |  | 0 | — |
| quarantined_transactions | jsonb | Có |  | '[]'::jsonb | — |
| last_error | text | Không |  | — | — |
| lease_until | timestamp with time zone | Không |  | — | — |
| next_poll_at | timestamp with time zone | Có |  | now() | — |
| cancel_requested | boolean | Có |  | false | — |
| reconciliation_status | text | Không |  | — | — |
| reconciliation_reason | text | Không |  | — | — |
| resolved_by | uuid | Không | FK | — | — |
| resolved_at | timestamp with time zone | Không |  | — | — |
| alert_id | uuid | Không | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payos_payment_request_check: CHECK (((reconciliation_status IS DISTINCT FROM 'RESOLVED'::text) OR ((resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL))))
payos_payment_request_order_code_check: CHECK (((order_code >= 1) AND (order_code <= '9007199254740991'::bigint)))
payos_payment_request_paid_amount_check: CHECK ((paid_amount >= 0))
payos_payment_request_quarantined_transactions_check: CHECK ((jsonb_typeof(quarantined_transactions) = 'array'::text))
payos_payment_request_reconciliation_status_check: CHECK ((reconciliation_status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text])))
payos_payment_request_status_check: CHECK ((status = ANY (ARRAY['CREATE_PENDING'::text, 'PENDING'::text, 'PROCESSING'::text, 'UNDERPAID'::text, 'PAID'::text, 'CANCEL_PENDING'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'FAILED'::text, 'ERROR'::text, 'REQUIRES_RECONCILIATION'::text])))
payos_payment_request_alert_id_fkey: FOREIGN KEY (alert_id) REFERENCES operational_alert(id) ON DELETE RESTRICT
payos_payment_request_created_by_fkey: FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT
payos_payment_request_payment_intent_id_fkey: FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON DELETE RESTRICT
payos_payment_request_resolved_by_fkey: FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON DELETE RESTRICT
payos_payment_request_cancel_requested_not_null: NOT NULL cancel_requested
payos_payment_request_created_at_not_null: NOT NULL created_at
payos_payment_request_created_by_not_null: NOT NULL created_by
payos_payment_request_id_not_null: NOT NULL id
payos_payment_request_next_poll_at_not_null: NOT NULL next_poll_at
payos_payment_request_order_code_not_null: NOT NULL order_code
payos_payment_request_paid_amount_not_null: NOT NULL paid_amount
payos_payment_request_payment_intent_id_not_null: NOT NULL payment_intent_id
payos_payment_request_quarantined_transactions_not_null: NOT NULL quarantined_transactions
payos_payment_request_request_payload_not_null: NOT NULL request_payload
payos_payment_request_status_not_null: NOT NULL status
payos_payment_request_updated_at_not_null: NOT NULL updated_at
payos_payment_request_pkey: PRIMARY KEY (id)
payos_payment_request_order_code_key: UNIQUE (order_code)
payos_payment_request_payment_intent_id_key: UNIQUE (payment_intent_id)
payos_payment_request_payment_link_id_key: UNIQUE (payment_link_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX payos_payment_request_order_code_key ON public.payos_payment_request USING btree (order_code);
CREATE UNIQUE INDEX payos_payment_request_payment_intent_id_key ON public.payos_payment_request USING btree (payment_intent_id);
CREATE UNIQUE INDEX payos_payment_request_payment_link_id_key ON public.payos_payment_request USING btree (payment_link_id);
CREATE UNIQUE INDEX payos_payment_request_pkey ON public.payos_payment_request USING btree (id);
CREATE INDEX payos_request_alert ON public.payos_payment_request USING btree (alert_id);
CREATE INDEX payos_request_created_by ON public.payos_payment_request USING btree (created_by);
CREATE INDEX payos_request_poll ON public.payos_payment_request USING btree (next_poll_at) WHERE (status <> ALL (ARRAY['PAID'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'FAILED'::text]));
CREATE INDEX payos_request_resolved_by ON public.payos_payment_request USING btree (resolved_by);
```

## payroll_line



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| payroll_slip_id | uuid | Có | FK | — | — |
| attendance_id | uuid | Không | FK | — | — |
| line_type | text | Có |  | — | — |
| description | text | Có |  | — | — |
| minutes | integer | Không |  | — | — |
| hourly_rate_snapshot | bigint | Không |  | — | — |
| amount | bigint | Có |  | — | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| pay_components | jsonb | Không |  | — | — |
| pay_snapshot | jsonb | Không |  | — | — |
| paid_periods | jsonb | Không |  | — | — |

### Ràng buộc
```sql
payroll_line_amount_check: CHECK (((amount >= '-100000000000'::bigint) AND (amount <= '100000000000'::bigint)))
payroll_line_check: CHECK ((((line_type = 'WORK'::text) AND (attendance_id IS NOT NULL) AND (minutes >= 0) AND (minutes IS NOT NULL) AND (hourly_rate_snapshot IS NOT NULL) AND (amount >= 0)) OR ((line_type = 'BONUS'::text) AND (attendance_id IS NULL) AND (minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount > 0)) OR ((line_type = 'DEDUCTION'::text) AND (attendance_id IS NULL) AND (minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount < 0))))
payroll_line_description_check: CHECK (((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 500)))
payroll_line_line_type_check: CHECK ((line_type = ANY (ARRAY['WORK'::text, 'BONUS'::text, 'DEDUCTION'::text])))
payroll_line_attendance_id_fkey: FOREIGN KEY (attendance_id) REFERENCES attendance_record(id)
payroll_line_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_line_payroll_slip_id_restaurant_id_fkey: FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id)
payroll_line_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_line_amount_not_null: NOT NULL amount
payroll_line_created_at_not_null: NOT NULL created_at
payroll_line_created_by_not_null: NOT NULL created_by
payroll_line_description_not_null: NOT NULL description
payroll_line_id_not_null: NOT NULL id
payroll_line_line_type_not_null: NOT NULL line_type
payroll_line_payroll_slip_id_not_null: NOT NULL payroll_slip_id
payroll_line_restaurant_id_not_null: NOT NULL restaurant_id
payroll_line_pkey: PRIMARY KEY (id)
payroll_line_attendance_id_key: UNIQUE (attendance_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX payroll_line_attendance_id_key ON public.payroll_line USING btree (attendance_id);
CREATE UNIQUE INDEX payroll_line_pkey ON public.payroll_line USING btree (id);
CREATE INDEX payroll_line_slip_idx ON public.payroll_line USING btree (payroll_slip_id);
```

## payroll_payment



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| payroll_slip_id | uuid | Có | FK | — | — |
| amount | bigint | Có |  | — | — |
| reference | text | Có |  | — | — |
| paid_by | uuid | Có | FK | — | — |
| paid_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payroll_payment_amount_check: CHECK ((amount > 0))
payroll_payment_reference_check: CHECK ((length(btrim(reference)) > 0))
payroll_payment_paid_by_restaurant_id_fkey: FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_payment_payroll_slip_id_restaurant_id_fkey: FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id)
payroll_payment_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_payment_amount_not_null: NOT NULL amount
payroll_payment_id_not_null: NOT NULL id
payroll_payment_paid_at_not_null: NOT NULL paid_at
payroll_payment_paid_by_not_null: NOT NULL paid_by
payroll_payment_payroll_slip_id_not_null: NOT NULL payroll_slip_id
payroll_payment_reference_not_null: NOT NULL reference
payroll_payment_restaurant_id_not_null: NOT NULL restaurant_id
payroll_payment_pkey: PRIMARY KEY (id)
payroll_payment_payroll_slip_id_key: UNIQUE (payroll_slip_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX payroll_payment_payroll_slip_id_key ON public.payroll_payment USING btree (payroll_slip_id);
CREATE UNIQUE INDEX payroll_payment_pkey ON public.payroll_payment USING btree (id);
```

## payroll_run



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| period_start | date | Có |  | — | — |
| period_end | date | Có |  | — | — |
| status | text | Có |  | 'DRAFT'::text | — |
| created_by | uuid | Có | FK | — | — |
| finalized_by | uuid | Không | FK | — | — |
| finalized_at | timestamp with time zone | Không |  | — | — |
| paid_by | uuid | Không | FK | — | — |
| paid_at | timestamp with time zone | Không |  | — | — |
| payment_reference | text | Không |  | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payroll_run_check: CHECK (((period_end > period_start) AND (period_end <= (period_start + 62))))
payroll_run_check1: CHECK ((((status = 'DRAFT'::text) AND (finalized_at IS NULL) AND (finalized_by IS NULL) AND (paid_at IS NULL) AND (paid_by IS NULL) AND (payment_reference IS NULL)) OR ((status = 'FINALIZED'::text) AND (finalized_at IS NOT NULL) AND (finalized_by IS NOT NULL) AND (paid_at IS NULL) AND (paid_by IS NULL) AND (payment_reference IS NULL)) OR ((status = 'PAID'::text) AND (finalized_at IS NOT NULL) AND (finalized_by IS NOT NULL) AND (paid_at IS NOT NULL) AND (paid_by IS NOT NULL) AND (length(btrim(COALESCE(payment_reference, ''::text))) > 0))))
payroll_run_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'FINALIZED'::text, 'PAID'::text])))
payroll_run_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_finalized_by_restaurant_id_fkey: FOREIGN KEY (finalized_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_paid_by_restaurant_id_fkey: FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_run_created_at_not_null: NOT NULL created_at
payroll_run_created_by_not_null: NOT NULL created_by
payroll_run_id_not_null: NOT NULL id
payroll_run_period_end_not_null: NOT NULL period_end
payroll_run_period_start_not_null: NOT NULL period_start
payroll_run_restaurant_id_not_null: NOT NULL restaurant_id
payroll_run_status_not_null: NOT NULL status
payroll_run_updated_at_not_null: NOT NULL updated_at
payroll_run_pkey: PRIMARY KEY (id)
payroll_run_id_restaurant_id_key: UNIQUE (id, restaurant_id)
payroll_run_restaurant_id_daterange_excl: EXCLUDE USING gist (restaurant_id WITH =, daterange(period_start, period_end, '[)'::text) WITH &&)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX payroll_run_id_restaurant_id_key ON public.payroll_run USING btree (id, restaurant_id);
CREATE UNIQUE INDEX payroll_run_pkey ON public.payroll_run USING btree (id);
CREATE INDEX payroll_run_restaurant_id_daterange_excl ON public.payroll_run USING gist (restaurant_id, daterange(period_start, period_end, '[)'::text));
```

## payroll_slip



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| payroll_run_id | uuid | Có | FK | — | — |
| user_id | uuid | Có | FK | — | — |
| employee_name_snapshot | text | Có |  | — | — |
| username_snapshot | text | Có |  | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
payroll_slip_payroll_run_id_restaurant_id_fkey: FOREIGN KEY (payroll_run_id, restaurant_id) REFERENCES payroll_run(id, restaurant_id)
payroll_slip_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_slip_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_slip_created_at_not_null: NOT NULL created_at
payroll_slip_employee_name_snapshot_not_null: NOT NULL employee_name_snapshot
payroll_slip_id_not_null: NOT NULL id
payroll_slip_payroll_run_id_not_null: NOT NULL payroll_run_id
payroll_slip_restaurant_id_not_null: NOT NULL restaurant_id
payroll_slip_user_id_not_null: NOT NULL user_id
payroll_slip_username_snapshot_not_null: NOT NULL username_snapshot
payroll_slip_pkey: PRIMARY KEY (id)
payroll_slip_id_restaurant_id_key: UNIQUE (id, restaurant_id)
payroll_slip_payroll_run_id_user_id_key: UNIQUE (payroll_run_id, user_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX payroll_slip_id_restaurant_id_key ON public.payroll_slip USING btree (id, restaurant_id);
CREATE UNIQUE INDEX payroll_slip_payroll_run_id_user_id_key ON public.payroll_slip USING btree (payroll_run_id, user_id);
CREATE UNIQUE INDEX payroll_slip_pkey ON public.payroll_slip USING btree (id);
```

## permission

Quyền chức năng

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| code | text | Có |  | — | Mã quyền duy nhất |
| module | text | Có |  | — | Phân hệ |
| action | text | Có |  | — | Hành động |
| description | text | Không |  | — | Mô tả |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
permission_action_not_null: NOT NULL action
permission_code_not_null: NOT NULL code
permission_created_at_not_null: NOT NULL created_at
permission_id_not_null: NOT NULL id
permission_module_not_null: NOT NULL module
permission_updated_at_not_null: NOT NULL updated_at
permission_pkey: PRIMARY KEY (id)
permission_code_key: UNIQUE (code)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX permission_code_key ON public.permission USING btree (code);
CREATE UNIQUE INDEX permission_pkey ON public.permission USING btree (id);
```

## product

Món ăn

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Có | FK | — | Tham chiếu restaurant; không xóa lịch sử |
| category_id | uuid | Có | FK | — | Danh mục cùng nhà hàng; FK ghép |
| code | text | Có |  | — | Mã món |
| name | text | Có |  | — | Tên món |
| description | text | Không |  | — | Mô tả |
| image_url | text | Không |  | — | Đường dẫn ảnh tùy chọn |
| base_price | bigint | Có |  | — | Giá VND nguyên không âm |
| availability_status | text | Có |  | 'AVAILABLE'::text | Trạng thái: AVAILABLE, UNAVAILABLE |
| is_active | boolean | Có |  | true | Ngừng dùng bằng false; giữ lịch sử |
| version | integer | Có |  | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |
| stock_managed | boolean | Có |  | true | — |
| is_complimentary | boolean | Có |  | false | — |
| product_kind | text | Có |  | 'DISH'::text | — |
| tax_treatment | text | Có |  | 'DEFAULT'::text | — |
| vat_rate_percent | integer | Không |  | — | — |

### Ràng buộc
```sql
product_availability_status_check: CHECK ((availability_status = ANY (ARRAY['AVAILABLE'::text, 'UNAVAILABLE'::text])))
product_base_price_check: CHECK ((base_price >= 0))
product_free_price: CHECK (((base_price > 0) OR is_complimentary))
product_product_kind_check: CHECK ((product_kind = ANY (ARRAY['DISH'::text, 'COMBO'::text])))
product_tax_classification: CHECK ((((tax_treatment = 'DEFAULT'::text) AND (vat_rate_percent IS NULL)) OR ((tax_treatment = 'EXEMPT'::text) AND (vat_rate_percent IS NULL)) OR ((tax_treatment = 'TAXABLE'::text) AND (vat_rate_percent IS NOT NULL) AND (vat_rate_percent = ANY (ARRAY[0, 5, 8, 10])))))
product_version_check: CHECK ((version > 0))
product_category_id_restaurant_id_fkey: FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_category(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_availability_status_not_null: NOT NULL availability_status
product_base_price_not_null: NOT NULL base_price
product_category_id_not_null: NOT NULL category_id
product_code_not_null: NOT NULL code
product_created_at_not_null: NOT NULL created_at
product_id_not_null: NOT NULL id
product_is_active_not_null: NOT NULL is_active
product_is_complimentary_not_null: NOT NULL is_complimentary
product_name_not_null: NOT NULL name
product_product_kind_not_null: NOT NULL product_kind
product_restaurant_id_not_null: NOT NULL restaurant_id
product_stock_managed_not_null: NOT NULL stock_managed
product_tax_treatment_not_null: NOT NULL tax_treatment
product_updated_at_not_null: NOT NULL updated_at
product_version_not_null: NOT NULL version
product_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
product_combo_complete: TRIGGER DEFERRABLE INITIALLY DEFERRED
product_id_restaurant_promotion_key: UNIQUE (id, restaurant_id)
product_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE INDEX product_category_idx ON public.product USING btree (category_id, restaurant_id);
CREATE UNIQUE INDEX product_id_restaurant_promotion_key ON public.product USING btree (id, restaurant_id);
CREATE UNIQUE INDEX product_pkey ON public.product USING btree (id);
CREATE UNIQUE INDEX product_restaurant_id_code_key ON public.product USING btree (restaurant_id, code);
```

## product_combo_item



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| combo_product_id | uuid | Có | FK | — | — |
| component_product_id | uuid | Có | FK | — | — |
| quantity | integer | Có |  | — | — |
| sort_order | integer | Có |  | 0 | — |
| created_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
product_combo_item_check: CHECK ((combo_product_id <> component_product_id))
product_combo_item_quantity_check: CHECK (((quantity >= 1) AND (quantity <= 20)))
product_combo_item_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 20)))
product_combo_item_combo_product_id_fkey: FOREIGN KEY (combo_product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_combo_item_component_product_id_fkey: FOREIGN KEY (component_product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_combo_item_combo_product_id_not_null: NOT NULL combo_product_id
product_combo_item_component_product_id_not_null: NOT NULL component_product_id
product_combo_item_created_at_not_null: NOT NULL created_at
product_combo_item_id_not_null: NOT NULL id
product_combo_item_quantity_not_null: NOT NULL quantity
product_combo_item_sort_order_not_null: NOT NULL sort_order
product_combo_item_pkey: PRIMARY KEY (id)
product_combo_items_complete: TRIGGER DEFERRABLE INITIALLY DEFERRED
product_combo_item_combo_product_id_component_product_id_key: UNIQUE (combo_product_id, component_product_id)
```

### Chỉ mục
```sql
CREATE INDEX product_combo_component_idx ON public.product_combo_item USING btree (component_product_id);
CREATE UNIQUE INDEX product_combo_item_combo_product_id_component_product_id_key ON public.product_combo_item USING btree (combo_product_id, component_product_id);
CREATE UNIQUE INDEX product_combo_item_pkey ON public.product_combo_item USING btree (id);
```

## promotion_request



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| actor_type | text | Có |  | — | — |
| actor_id | uuid | Có |  | — | — |
| request_key | text | Có |  | — | — |
| request_hash | text | Có |  | — | — |
| response_snapshot | jsonb | Có |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
promotion_request_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'GUEST'::text])))
promotion_request_request_key_check: CHECK (((length(request_key) >= 1) AND (length(request_key) <= 100)))
promotion_request_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
promotion_request_actor_id_not_null: NOT NULL actor_id
promotion_request_actor_type_not_null: NOT NULL actor_type
promotion_request_created_at_not_null: NOT NULL created_at
promotion_request_id_not_null: NOT NULL id
promotion_request_request_hash_not_null: NOT NULL request_hash
promotion_request_request_key_not_null: NOT NULL request_key
promotion_request_response_snapshot_not_null: NOT NULL response_snapshot
promotion_request_session_id_not_null: NOT NULL session_id
promotion_request_pkey: PRIMARY KEY (id)
promotion_request_session_id_actor_type_actor_id_request_ke_key: UNIQUE (session_id, actor_type, actor_id, request_key)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX promotion_request_pkey ON public.promotion_request USING btree (id);
CREATE UNIQUE INDEX promotion_request_session_id_actor_type_actor_id_request_ke_key ON public.promotion_request USING btree (session_id, actor_type, actor_id, request_key);
```

## recipe_bom



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| product_id | uuid | Có | FK | — | — |
| version_no | integer | Có |  | 1 | — |
| yield_quantity | numeric(18,6) | Có |  | — | — |
| status | text | Có |  | 'DRAFT'::text | — |
| effective_from | timestamp(6) with time zone | Có |  | now() | — |
| effective_to | timestamp(6) with time zone | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
recipe_bom_check: CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
recipe_bom_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'RETIRED'::text])))
recipe_bom_status_check1: CHECK ((length(btrim(status)) > 0))
recipe_bom_version_no_check: CHECK ((version_no > 0))
recipe_bom_yield_quantity_check: CHECK ((yield_quantity > (0)::numeric))
core_recipe_bom_f1: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
recipe_bom_created_at_not_null: NOT NULL created_at
recipe_bom_effective_from_not_null: NOT NULL effective_from
recipe_bom_id_not_null: NOT NULL id
recipe_bom_product_id_not_null: NOT NULL product_id
recipe_bom_status_not_null: NOT NULL status
recipe_bom_updated_at_not_null: NOT NULL updated_at
recipe_bom_version_no_not_null: NOT NULL version_no
recipe_bom_yield_quantity_not_null: NOT NULL yield_quantity
recipe_bom_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
recipe_bom_product_id_version_no_key: UNIQUE (product_id, version_no)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX core_active_bom ON public.recipe_bom USING btree (product_id) WHERE (status = 'ACTIVE'::text);
CREATE INDEX core_recipe_bom_fk1 ON public.recipe_bom USING btree (product_id);
CREATE UNIQUE INDEX recipe_bom_pkey ON public.recipe_bom USING btree (id);
CREATE UNIQUE INDEX recipe_bom_product_id_version_no_key ON public.recipe_bom USING btree (product_id, version_no);
```

## recipe_bom_item



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| recipe_bom_id | uuid | Có | FK | — | — |
| ingredient_id | uuid | Có | FK | — | — |
| quantity | numeric(18,6) | Có |  | — | — |
| waste_percent | numeric(18,6) | Có |  | 0 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
recipe_bom_item_quantity_check: CHECK ((quantity > (0)::numeric))
recipe_bom_item_waste_percent_check: CHECK ((waste_percent >= (0)::numeric))
recipe_bom_item_waste_percent_check1: CHECK ((waste_percent <= (100)::numeric))
core_recipe_bom_item_f1: FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_recipe_bom_item_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
recipe_bom_item_created_at_not_null: NOT NULL created_at
recipe_bom_item_id_not_null: NOT NULL id
recipe_bom_item_ingredient_id_not_null: NOT NULL ingredient_id
recipe_bom_item_quantity_not_null: NOT NULL quantity
recipe_bom_item_recipe_bom_id_not_null: NOT NULL recipe_bom_id
recipe_bom_item_updated_at_not_null: NOT NULL updated_at
recipe_bom_item_waste_percent_not_null: NOT NULL waste_percent
recipe_bom_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
recipe_bom_item_recipe_bom_id_ingredient_id_key: UNIQUE (recipe_bom_id, ingredient_id)
```

### Chỉ mục
```sql
CREATE INDEX core_recipe_bom_item_fk1 ON public.recipe_bom_item USING btree (recipe_bom_id);
CREATE INDEX core_recipe_bom_item_fk2 ON public.recipe_bom_item USING btree (ingredient_id);
CREATE UNIQUE INDEX recipe_bom_item_pkey ON public.recipe_bom_item USING btree (id);
CREATE UNIQUE INDEX recipe_bom_item_recipe_bom_id_ingredient_id_key ON public.recipe_bom_item USING btree (recipe_bom_id, ingredient_id);
```

## refund_case



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| order_item_id | uuid | Không | FK | — | — |
| source_payment_transaction_id | uuid | Không | FK | — | — |
| source_allocation_id | uuid | Không | FK | — | — |
| amount | bigint | Có |  | — | — |
| reason | text | Không |  | — | — |
| status | text | Có |  | 'OPEN'::text | — |
| resolution_method | text | Không |  | — | — |
| assigned_staff_id | uuid | Không | FK | — | — |
| evidence_ref | text | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| request_key | text | Không |  | — | — |

### Ràng buộc
```sql
refund_case_amount_check: CHECK ((amount > 0))
refund_case_resolution_method_check: CHECK ((resolution_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))
refund_case_status_check: CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'RESOLVED_CASH'::text, 'RESOLVED_TRANSFER'::text, 'CANCELLED'::text])))
refund_case_status_check1: CHECK ((length(btrim(status)) > 0))
core_refund_case_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f3: FOREIGN KEY (source_payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f4: FOREIGN KEY (source_allocation_id) REFERENCES payment_allocation(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f5: FOREIGN KEY (assigned_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
refund_case_amount_not_null: NOT NULL amount
refund_case_created_at_not_null: NOT NULL created_at
refund_case_id_not_null: NOT NULL id
refund_case_session_id_not_null: NOT NULL session_id
refund_case_status_not_null: NOT NULL status
refund_case_updated_at_not_null: NOT NULL updated_at
refund_case_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_refund_case_fk1 ON public.refund_case USING btree (session_id);
CREATE INDEX core_refund_case_fk2 ON public.refund_case USING btree (order_item_id);
CREATE INDEX core_refund_case_fk3 ON public.refund_case USING btree (source_payment_transaction_id);
CREATE INDEX core_refund_case_fk4 ON public.refund_case USING btree (source_allocation_id);
CREATE INDEX core_refund_case_fk5 ON public.refund_case USING btree (assigned_staff_id);
CREATE UNIQUE INDEX refund_case_pkey ON public.refund_case USING btree (id);
CREATE UNIQUE INDEX refund_case_request_key ON public.refund_case USING btree (session_id, request_key) WHERE (request_key IS NOT NULL);
```

## refund_transaction



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| refund_case_id | uuid | Có | FK | — | — |
| method | text | Có |  | — | — |
| amount | bigint | Có |  | — | — |
| reference | text | Không |  | — | — |
| status | text | Có |  | 'PENDING'::text | — |
| processed_by | uuid | Có | FK | — | — |
| processed_at | timestamp(6) with time zone | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| request_key | text | Không |  | — | — |

### Ràng buộc
```sql
refund_transaction_amount_check: CHECK ((amount > 0))
refund_transaction_check: CHECK (((status <> 'SUCCEEDED'::text) OR (processed_at IS NOT NULL)))
refund_transaction_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))
refund_transaction_method_check1: CHECK ((length(btrim(method)) > 0))
refund_transaction_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])))
refund_transaction_status_check1: CHECK ((length(btrim(status)) > 0))
core_refund_transaction_f1: FOREIGN KEY (refund_case_id) REFERENCES refund_case(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_transaction_f2: FOREIGN KEY (processed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
refund_transaction_amount_not_null: NOT NULL amount
refund_transaction_created_at_not_null: NOT NULL created_at
refund_transaction_id_not_null: NOT NULL id
refund_transaction_method_not_null: NOT NULL method
refund_transaction_processed_by_not_null: NOT NULL processed_by
refund_transaction_refund_case_id_not_null: NOT NULL refund_case_id
refund_transaction_status_not_null: NOT NULL status
refund_transaction_updated_at_not_null: NOT NULL updated_at
refund_transaction_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE INDEX core_refund_transaction_fk1 ON public.refund_transaction USING btree (refund_case_id);
CREATE INDEX core_refund_transaction_fk2 ON public.refund_transaction USING btree (processed_by);
CREATE INDEX refund_bank_reference_lookup ON public.refund_transaction USING btree (reference) WHERE ((method = 'BANK_TRANSFER'::text) AND (status = 'SUCCEEDED'::text));
CREATE UNIQUE INDEX refund_request_once ON public.refund_transaction USING btree (refund_case_id, request_key) WHERE (request_key IS NOT NULL);
CREATE UNIQUE INDEX refund_transaction_pkey ON public.refund_transaction USING btree (id);
```

## restaurant

Nhà hàng

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| name | text | Có |  | — | Tên nhà hàng |
| address | text | Không |  | — | Địa chỉ |
| currency | text | Có |  | 'VND'::text | Đơn vị tiền |
| timezone | text | Có |  | 'Asia/Ho_Chi_Minh'::text | Múi giờ hiển thị |
| status | text | Có |  | 'ACTIVE'::text | Trạng thái: ACTIVE, INACTIVE |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
restaurant_currency_check: CHECK ((currency = 'VND'::text))
restaurant_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
restaurant_created_at_not_null: NOT NULL created_at
restaurant_currency_not_null: NOT NULL currency
restaurant_id_not_null: NOT NULL id
restaurant_name_not_null: NOT NULL name
restaurant_status_not_null: NOT NULL status
restaurant_timezone_not_null: NOT NULL timezone
restaurant_updated_at_not_null: NOT NULL updated_at
restaurant_pkey: PRIMARY KEY (id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX restaurant_pkey ON public.restaurant USING btree (id);
```

## restaurant_tax_policy



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| effective_at | timestamp(6) with time zone | Có |  | — | — |
| default_rate_percent | integer | Có |  | — | — |
| price_includes_vat | boolean | Có |  | true | — |
| version | integer | Có |  | — | — |
| reason | text | Có |  | — | — |
| created_by | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
restaurant_tax_policy_default_rate_percent_check: CHECK ((default_rate_percent = ANY (ARRAY[0, 5, 8, 10])))
restaurant_tax_policy_price_includes_vat_check: CHECK (price_includes_vat)
restaurant_tax_policy_reason_check: CHECK (((length(btrim(reason)) >= 5) AND (length(btrim(reason)) <= 500)))
restaurant_tax_policy_version_check: CHECK ((version > 0))
restaurant_tax_policy_created_by_fkey: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
restaurant_tax_policy_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
restaurant_tax_policy_created_at_not_null: NOT NULL created_at
restaurant_tax_policy_default_rate_percent_not_null: NOT NULL default_rate_percent
restaurant_tax_policy_effective_at_not_null: NOT NULL effective_at
restaurant_tax_policy_id_not_null: NOT NULL id
restaurant_tax_policy_price_includes_vat_not_null: NOT NULL price_includes_vat
restaurant_tax_policy_reason_not_null: NOT NULL reason
restaurant_tax_policy_restaurant_id_not_null: NOT NULL restaurant_id
restaurant_tax_policy_version_not_null: NOT NULL version
restaurant_tax_policy_pkey: PRIMARY KEY (id)
restaurant_tax_policy_restaurant_id_version_key: UNIQUE (restaurant_id, version)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX restaurant_tax_policy_pkey ON public.restaurant_tax_policy USING btree (id);
CREATE UNIQUE INDEX restaurant_tax_policy_restaurant_id_version_key ON public.restaurant_tax_policy USING btree (restaurant_id, version);
CREATE INDEX tax_policy_effective ON public.restaurant_tax_policy USING btree (restaurant_id, effective_at, version);
```

## risk_policy_config



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| config_key | text | Có |  | — | — |
| value_type | text | Có |  | — | — |
| value_json | jsonb | Có |  | — | — |
| allowed_min | numeric(18,6) | Không |  | — | — |
| allowed_max | numeric(18,6) | Không |  | — | — |
| version_no | integer | Có |  | 1 | — |
| effective_from | timestamp(6) with time zone | Có |  | now() | — |
| changed_by | uuid | Có | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
risk_policy_config_check: CHECK (((allowed_min IS NULL) OR (allowed_max IS NULL) OR (allowed_min <= allowed_max)))
risk_policy_config_config_key_check: CHECK ((length(btrim(config_key)) > 0))
risk_policy_config_value_type_check: CHECK ((value_type = ANY (ARRAY['NUMBER'::text, 'BOOLEAN'::text, 'STRING'::text, 'JSON'::text])))
risk_policy_config_value_type_check1: CHECK ((length(btrim(value_type)) > 0))
risk_policy_config_version_no_check: CHECK ((version_no > 0))
core_risk_policy_config_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_risk_policy_config_f2: FOREIGN KEY (changed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
risk_policy_config_changed_by_not_null: NOT NULL changed_by
risk_policy_config_config_key_not_null: NOT NULL config_key
risk_policy_config_created_at_not_null: NOT NULL created_at
risk_policy_config_effective_from_not_null: NOT NULL effective_from
risk_policy_config_id_not_null: NOT NULL id
risk_policy_config_restaurant_id_not_null: NOT NULL restaurant_id
risk_policy_config_value_json_not_null: NOT NULL value_json
risk_policy_config_value_type_not_null: NOT NULL value_type
risk_policy_config_version_no_not_null: NOT NULL version_no
risk_policy_config_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
risk_policy_config_restaurant_id_config_key_version_no_key: UNIQUE (restaurant_id, config_key, version_no)
```

### Chỉ mục
```sql
CREATE INDEX core_risk_policy_config_fk1 ON public.risk_policy_config USING btree (restaurant_id);
CREATE INDEX core_risk_policy_config_fk2 ON public.risk_policy_config USING btree (changed_by);
CREATE UNIQUE INDEX risk_policy_config_pkey ON public.risk_policy_config USING btree (id);
CREATE UNIQUE INDEX risk_policy_config_restaurant_id_config_key_version_no_key ON public.risk_policy_config USING btree (restaurant_id, config_key, version_no);
```

## role

Vai trò toàn hệ thống

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| code | text | Có |  | — | Mã STAFF, KITCHEN, ADMIN |
| name | text | Có |  | — | Tên vai trò |
| description | text | Không |  | — | Mô tả |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
role_code_check: CHECK ((code = ANY (ARRAY['STAFF'::text, 'KITCHEN'::text, 'ADMIN'::text])))
role_code_not_null: NOT NULL code
role_created_at_not_null: NOT NULL created_at
role_id_not_null: NOT NULL id
role_name_not_null: NOT NULL name
role_updated_at_not_null: NOT NULL updated_at
role_pkey: PRIMARY KEY (id)
role_code_key: UNIQUE (code)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX role_code_key ON public.role USING btree (code);
CREATE UNIQUE INDEX role_pkey ON public.role USING btree (id);
```

## role_permission

Quyền của vai trò

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| role_id | uuid | Có | FK | — | Tham chiếu role; không xóa lịch sử |
| permission_id | uuid | Có | FK | — | Tham chiếu permission; không xóa lịch sử |
| scope | text | Có |  | 'RESTAURANT'::text | Phạm vi cấp quyền |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
role_permission_scope_check: CHECK ((scope = 'RESTAURANT'::text))
role_permission_permission_id_fkey: FOREIGN KEY (permission_id) REFERENCES permission(id) ON UPDATE RESTRICT ON DELETE RESTRICT
role_permission_role_id_fkey: FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT
role_permission_created_at_not_null: NOT NULL created_at
role_permission_id_not_null: NOT NULL id
role_permission_permission_id_not_null: NOT NULL permission_id
role_permission_role_id_not_null: NOT NULL role_id
role_permission_scope_not_null: NOT NULL scope
role_permission_updated_at_not_null: NOT NULL updated_at
role_permission_pkey: PRIMARY KEY (id)
role_permission_role_id_permission_id_key: UNIQUE (role_id, permission_id)
```

### Chỉ mục
```sql
CREATE INDEX role_permission_permission_idx ON public.role_permission USING btree (permission_id);
CREATE UNIQUE INDEX role_permission_pkey ON public.role_permission USING btree (id);
CREATE UNIQUE INDEX role_permission_role_id_permission_id_key ON public.role_permission USING btree (role_id, permission_id);
```

## session_cart

One shared cart per table session; owned lines live in cart_item.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| session_id | uuid | Có | FK | — | Tham chiếu table_session; không xóa lịch sử |
| cart_version | integer | Có |  | 1 | Phiên bản giỏ |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
session_cart_cart_version_check: CHECK ((cart_version > 0))
session_cart_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_cart_cart_version_not_null: NOT NULL cart_version
session_cart_created_at_not_null: NOT NULL created_at
session_cart_id_not_null: NOT NULL id
session_cart_session_id_not_null: NOT NULL session_id
session_cart_updated_at_not_null: NOT NULL updated_at
session_cart_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_cart_session_id_key: UNIQUE (session_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX session_cart_pkey ON public.session_cart USING btree (id);
CREATE UNIQUE INDEX session_cart_session_id_key ON public.session_cart USING btree (session_id);
```

## session_financial_account

Rebuildable aggregate of charges, successful payments, refunds and live payment reservations.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Có | FK | — | — |
| charge_total | bigint | Có |  | 0 | — |
| paid_total | bigint | Có |  | 0 | — |
| refunded_total | bigint | Có |  | 0 | — |
| reserved_payment_amount | bigint | Có |  | 0 | — |
| outstanding_amount | bigint | Có |  | 0 | — |
| refund_due_amount | bigint | Có |  | 0 | — |
| version | integer | Có |  | 1 | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
session_financial_account_charge_total_check: CHECK ((charge_total >= 0))
session_financial_account_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
session_financial_account_paid_total_check: CHECK ((paid_total >= 0))
session_financial_account_refund_due_amount_check: CHECK ((refund_due_amount >= 0))
session_financial_account_refunded_total_check: CHECK ((refunded_total >= 0))
session_financial_account_reserved_payment_amount_check: CHECK ((reserved_payment_amount >= 0))
session_financial_account_version_check: CHECK ((version > 0))
core_session_financial_account_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_financial_account_charge_total_not_null: NOT NULL charge_total
session_financial_account_created_at_not_null: NOT NULL created_at
session_financial_account_id_not_null: NOT NULL id
session_financial_account_outstanding_amount_not_null: NOT NULL outstanding_amount
session_financial_account_paid_total_not_null: NOT NULL paid_total
session_financial_account_refund_due_amount_not_null: NOT NULL refund_due_amount
session_financial_account_refunded_total_not_null: NOT NULL refunded_total
session_financial_account_reserved_payment_amount_not_null: NOT NULL reserved_payment_amount
session_financial_account_session_id_not_null: NOT NULL session_id
session_financial_account_updated_at_not_null: NOT NULL updated_at
session_financial_account_version_not_null: NOT NULL version
session_financial_account_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_financial_account_session_id_key: UNIQUE (session_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX session_financial_account_pkey ON public.session_financial_account USING btree (id);
CREATE UNIQUE INDEX session_financial_account_session_id_key ON public.session_financial_account USING btree (session_id);
```

## session_participant

Guest identity scoped to a table session; credential_hash stores only a hash.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| session_id | uuid | Có | FK | — | Tham chiếu table_session; không xóa lịch sử |
| guest_id | uuid | Có |  | — | Định danh khách opaque trong phiên |
| display_name | text | Không |  | — | Tên khách tùy chọn |
| credential_hash | text | Có |  | — | Hash credential khách |
| device_session_hash | text | Không |  | — | Hash định danh thiết bị trong phiên |
| status | text | Có |  | 'ACTIVE'::text | Trạng thái: ACTIVE, BLOCKED, LEFT |
| blocked_until | timestamp with time zone | Không |  | — | Hạn chặn tùy chọn |
| joined_at | timestamp with time zone | Có |  | now() | Thời điểm tham gia |
| last_seen_at | timestamp with time zone | Có |  | now() | Hoạt động gần nhất |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |
| accepted_policy_version | text | Không |  | — | — |
| accepted_policy_at | timestamp with time zone | Không |  | — | — |

### Ràng buộc
```sql
participant_policy_ack_pair: CHECK ((((accepted_policy_version IS NULL) AND (accepted_policy_at IS NULL)) OR ((accepted_policy_version IS NOT NULL) AND (accepted_policy_version ~ '^[0-9]{4}-[0-9]{2}-v[0-9]+$'::text) AND (accepted_policy_at IS NOT NULL))))
session_participant_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'BLOCKED'::text, 'LEFT'::text])))
session_participant_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_participant_created_at_not_null: NOT NULL created_at
session_participant_credential_hash_not_null: NOT NULL credential_hash
session_participant_guest_id_not_null: NOT NULL guest_id
session_participant_id_not_null: NOT NULL id
session_participant_joined_at_not_null: NOT NULL joined_at
session_participant_last_seen_at_not_null: NOT NULL last_seen_at
session_participant_session_id_not_null: NOT NULL session_id
session_participant_status_not_null: NOT NULL status
session_participant_updated_at_not_null: NOT NULL updated_at
session_participant_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_participant_credential_hash_key: UNIQUE (credential_hash)
session_participant_session_id_guest_id_key: UNIQUE (session_id, guest_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX session_participant_credential_hash_key ON public.session_participant USING btree (credential_hash);
CREATE UNIQUE INDEX session_participant_pkey ON public.session_participant USING btree (id);
CREATE UNIQUE INDEX session_participant_session_id_guest_id_key ON public.session_participant USING btree (session_id, guest_id);
```

## session_promotion



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| session_id | uuid | Có | PK, FK | — | — |
| program_id | uuid | Không | FK | — | — |
| status | text | Có |  | — | — |
| explicit_selection | boolean | Có |  | false | — |
| program_snapshot | jsonb | Không |  | — | — |
| eligible_amount | bigint | Có |  | 0 | — |
| discount_amount | bigint | Có |  | 0 | — |
| expires_at | timestamp(6) with time zone | Không |  | — | — |
| locked_at | timestamp(6) with time zone | Không |  | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
session_promotion_check: CHECK (((discount_amount >= 0) AND (discount_amount <= eligible_amount)))
session_promotion_check1: CHECK ((((status = 'REMOVED'::text) AND (program_id IS NULL) AND (program_snapshot IS NULL)) OR ((status <> 'REMOVED'::text) AND (program_id IS NOT NULL) AND (program_snapshot IS NOT NULL))))
session_promotion_check2: CHECK (((status <> 'RESERVED'::text) OR (expires_at IS NOT NULL)))
session_promotion_check3: CHECK (((status <> 'USED'::text) OR (locked_at IS NOT NULL)))
session_promotion_eligible_amount_check: CHECK ((eligible_amount >= 0))
session_promotion_status_check: CHECK ((status = ANY (ARRAY['SELECTED'::text, 'RESERVED'::text, 'USED'::text, 'REMOVED'::text])))
session_promotion_program_id_fkey: FOREIGN KEY (program_id) REFERENCES discount_program(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_promotion_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_promotion_created_at_not_null: NOT NULL created_at
session_promotion_discount_amount_not_null: NOT NULL discount_amount
session_promotion_eligible_amount_not_null: NOT NULL eligible_amount
session_promotion_explicit_selection_not_null: NOT NULL explicit_selection
session_promotion_session_id_not_null: NOT NULL session_id
session_promotion_status_not_null: NOT NULL status
session_promotion_updated_at_not_null: NOT NULL updated_at
session_promotion_pkey: PRIMARY KEY (session_id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX session_promotion_pkey ON public.session_promotion USING btree (session_id);
CREATE INDEX session_promotion_quota ON public.session_promotion USING btree (program_id, status, expires_at);
```

## shift_assignment



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| shift_id | uuid | Có | FK | — | — |
| user_id | uuid | Có | FK | — | — |
| area_id | uuid | Không | FK | — | — |
| starts_at | timestamp with time zone | Có |  | — | — |
| ends_at | timestamp with time zone | Có |  | — | — |
| status | text | Có |  | 'ASSIGNED'::text | — |
| assigned_by | uuid | Có | FK | — | — |
| cancellation_reason | text | Không |  | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
shift_assignment_check: CHECK ((ends_at > starts_at))
shift_assignment_status_check: CHECK ((status = ANY (ARRAY['ASSIGNED'::text, 'CANCELLED'::text])))
shift_assignment_area_id_restaurant_id_fkey: FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id)
shift_assignment_assigned_by_restaurant_id_fkey: FOREIGN KEY (assigned_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_assignment_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
shift_assignment_shift_id_restaurant_id_fkey: FOREIGN KEY (shift_id, restaurant_id) REFERENCES work_shift(id, restaurant_id)
shift_assignment_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_assignment_assigned_by_not_null: NOT NULL assigned_by
shift_assignment_created_at_not_null: NOT NULL created_at
shift_assignment_ends_at_not_null: NOT NULL ends_at
shift_assignment_id_not_null: NOT NULL id
shift_assignment_restaurant_id_not_null: NOT NULL restaurant_id
shift_assignment_shift_id_not_null: NOT NULL shift_id
shift_assignment_starts_at_not_null: NOT NULL starts_at
shift_assignment_status_not_null: NOT NULL status
shift_assignment_updated_at_not_null: NOT NULL updated_at
shift_assignment_user_id_not_null: NOT NULL user_id
shift_assignment_pkey: PRIMARY KEY (id)
shift_assignment_id_restaurant_id_key: UNIQUE (id, restaurant_id)
shift_assignment_shift_id_user_id_key: UNIQUE (shift_id, user_id)
shift_assignment_user_id_tstzrange_excl: EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status = 'ASSIGNED'::text))
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX shift_assignment_id_restaurant_id_key ON public.shift_assignment USING btree (id, restaurant_id);
CREATE UNIQUE INDEX shift_assignment_pkey ON public.shift_assignment USING btree (id);
CREATE INDEX shift_assignment_restaurant_start_idx ON public.shift_assignment USING btree (restaurant_id, starts_at);
CREATE UNIQUE INDEX shift_assignment_shift_id_user_id_key ON public.shift_assignment USING btree (shift_id, user_id);
CREATE INDEX shift_assignment_user_id_tstzrange_excl ON public.shift_assignment USING gist (user_id, tstzrange(starts_at, ends_at, '[)'::text)) WHERE (status = 'ASSIGNED'::text);
```

## shift_template



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| code | text | Có |  | — | — |
| name | text | Có |  | — | — |
| start_time | time without time zone | Có |  | — | — |
| end_time | time without time zone | Có |  | — | — |
| ends_next_day | boolean | Có |  | false | — |
| break_minutes | integer | Có |  | 0 | — |
| hourly_rate_override | bigint | Không |  | — | — |
| is_active | boolean | Có |  | true | — |
| sort_order | integer | Có |  | 0 | — |
| version | integer | Có |  | 1 | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
shift_template_break_minutes_check: CHECK (((break_minutes >= 0) AND (break_minutes <= 240)))
shift_template_check: CHECK ((((end_time - start_time) +
CASE
    WHEN ends_next_day THEN '24:00:00'::interval
    ELSE '00:00:00'::interval
END) > ((break_minutes)::double precision * '00:01:00'::interval)))
shift_template_check1: CHECK ((((end_time - start_time) +
CASE
    WHEN ends_next_day THEN '24:00:00'::interval
    ELSE '00:00:00'::interval
END) <= '16:00:00'::interval))
shift_template_code_check: CHECK (((length(btrim(code)) >= 1) AND (length(btrim(code)) <= 64)))
shift_template_hourly_rate_override_check: CHECK (((hourly_rate_override >= 1000) AND (hourly_rate_override <= 10000000)))
shift_template_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
shift_template_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 10000)))
shift_template_version_check: CHECK ((version > 0))
shift_template_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_template_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
shift_template_break_minutes_not_null: NOT NULL break_minutes
shift_template_code_not_null: NOT NULL code
shift_template_created_at_not_null: NOT NULL created_at
shift_template_created_by_not_null: NOT NULL created_by
shift_template_end_time_not_null: NOT NULL end_time
shift_template_ends_next_day_not_null: NOT NULL ends_next_day
shift_template_id_not_null: NOT NULL id
shift_template_is_active_not_null: NOT NULL is_active
shift_template_name_not_null: NOT NULL name
shift_template_restaurant_id_not_null: NOT NULL restaurant_id
shift_template_sort_order_not_null: NOT NULL sort_order
shift_template_start_time_not_null: NOT NULL start_time
shift_template_updated_at_not_null: NOT NULL updated_at
shift_template_version_not_null: NOT NULL version
shift_template_pkey: PRIMARY KEY (id)
shift_template_id_restaurant_id_key: UNIQUE (id, restaurant_id)
shift_template_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE INDEX shift_template_active_order ON public.shift_template USING btree (restaurant_id, is_active, sort_order, name);
CREATE UNIQUE INDEX shift_template_id_restaurant_id_key ON public.shift_template USING btree (id, restaurant_id);
CREATE UNIQUE INDEX shift_template_pkey ON public.shift_template USING btree (id);
CREATE UNIQUE INDEX shift_template_restaurant_id_code_key ON public.shift_template USING btree (restaurant_id, code);
```

## stock_location



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| code | text | Có |  | — | — |
| name | text | Có |  | — | — |
| is_active | boolean | Có |  | true | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
stock_location_code_check: CHECK ((length(btrim(code)) > 0))
stock_location_name_check: CHECK ((length(btrim(name)) > 0))
core_stock_location_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
stock_location_code_not_null: NOT NULL code
stock_location_created_at_not_null: NOT NULL created_at
stock_location_id_not_null: NOT NULL id
stock_location_is_active_not_null: NOT NULL is_active
stock_location_name_not_null: NOT NULL name
stock_location_restaurant_id_not_null: NOT NULL restaurant_id
stock_location_updated_at_not_null: NOT NULL updated_at
stock_location_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
stock_location_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục
```sql
CREATE INDEX core_stock_location_fk1 ON public.stock_location USING btree (restaurant_id);
CREATE UNIQUE INDEX stock_location_pkey ON public.stock_location USING btree (id);
CREATE UNIQUE INDEX stock_location_restaurant_id_code_key ON public.stock_location USING btree (restaurant_id, code);
```

## support_request



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| session_id | uuid | Không | FK | — | — |
| participant_id | uuid | Không | FK | — | — |
| request_type | text | Có |  | — | — |
| content | text | Không |  | — | — |
| status | text | Có |  | 'NEW'::text | — |
| acknowledged_by | uuid | Không | FK | — | — |
| resolved_by | uuid | Không | FK | — | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |
| acknowledged_at | timestamp(6) with time zone | Không |  | — | First claim time; preserved across accepted handoffs. Each transfer time is in handoff history. |
| resolved_at | timestamp(6) with time zone | Không |  | — | — |
| payment_method | text | Không |  | — | — |
| table_id | uuid | Không | FK | — | — |
| visitor_hash | text | Không |  | — | — |
| visitor_name | text | Không |  | — | — |
| replaces_request_id | uuid | Không | FK | — | — |
| resolution_actor_type | text | Có |  | 'USER'::text | — |

### Ràng buộc
```sql
access_request_visitor: CHECK (((request_type <> 'ACCESS_CODE'::text) OR ((visitor_hash IS NOT NULL) AND ((length(btrim(visitor_name)) >= 1) AND (length(btrim(visitor_name)) <= 80)))))
support_payment_method: CHECK (((payment_method IS NULL) OR ((request_type = 'BILL'::text) AND (payment_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'ONLINE'::text])))))
support_request_check: CHECK (((status <> 'RESOLVED'::text) OR ((resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL))))
support_request_context: CHECK ((((session_id IS NOT NULL) AND (table_id IS NULL)) OR ((request_type = 'ACCESS_CODE'::text) AND (session_id IS NULL) AND (table_id IS NOT NULL) AND (participant_id IS NULL))))
support_request_owner_state: CHECK ((((status = 'NEW'::text) AND (acknowledged_by IS NULL) AND (acknowledged_at IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL)) OR ((status = 'ACKNOWLEDGED'::text) AND (acknowledged_by IS NOT NULL) AND (acknowledged_at IS NOT NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL)) OR ((status = 'RESOLVED'::text) AND (acknowledged_by IS NOT NULL) AND (acknowledged_at IS NOT NULL) AND (resolved_at IS NOT NULL) AND (((resolution_actor_type = 'USER'::text) AND (resolved_by = acknowledged_by)) OR ((resolution_actor_type = 'SYSTEM'::text) AND (resolved_by IS NULL)))) OR (status = 'CANCELLED'::text)))
support_request_request_type_check: CHECK ((request_type = ANY (ARRAY['ASSISTANCE'::text, 'WATER'::text, 'UTENSILS'::text, 'BILL'::text, 'OTHER'::text, 'ACCESS_CODE'::text])))
support_request_request_type_check1: CHECK ((length(btrim(request_type)) > 0))
support_request_resolution_actor_type_check: CHECK ((resolution_actor_type = ANY (ARRAY['USER'::text, 'SYSTEM'::text])))
support_request_status_check: CHECK ((status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text, 'RESOLVED'::text, 'CANCELLED'::text])))
support_request_status_check1: CHECK ((length(btrim(status)) > 0))
core_support_request_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f2: FOREIGN KEY (participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f3: FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f4: FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_replaces_request_id_fkey: FOREIGN KEY (replaces_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_created_at_not_null: NOT NULL created_at
support_request_id_not_null: NOT NULL id
support_request_request_type_not_null: NOT NULL request_type
support_request_resolution_actor_type_not_null: NOT NULL resolution_actor_type
support_request_status_not_null: NOT NULL status
support_request_updated_at_not_null: NOT NULL updated_at
support_request_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
support_pending_owner: TRIGGER DEFERRABLE INITIALLY DEFERRED
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX access_request_one_pending_table ON public.support_request USING btree (table_id) WHERE ((request_type = 'ACCESS_CODE'::text) AND (status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text])) AND (session_id IS NULL));
CREATE INDEX core_support_request_fk1 ON public.support_request USING btree (session_id);
CREATE INDEX core_support_request_fk2 ON public.support_request USING btree (participant_id);
CREATE INDEX core_support_request_fk3 ON public.support_request USING btree (acknowledged_by);
CREATE INDEX core_support_request_fk4 ON public.support_request USING btree (resolved_by);
CREATE INDEX support_replacement ON public.support_request USING btree (replaces_request_id);
CREATE UNIQUE INDEX support_request_active_participant ON public.support_request USING btree (session_id, participant_id, request_type) WHERE ((participant_id IS NOT NULL) AND (status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text])));
CREATE UNIQUE INDEX support_request_pkey ON public.support_request USING btree (id);
CREATE INDEX support_request_queue ON public.support_request USING btree (status, created_at);
```

## support_request_handoff

Recipient-confirmed handoff history. Current owner remains responsible while PENDING.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| support_request_id | uuid | Có | FK | — | — |
| from_staff_id | uuid | Có | FK | — | — |
| to_staff_id | uuid | Có | FK | — | — |
| reason | text | Có |  | — | — |
| status | text | Có |  | 'PENDING'::text | — |
| requested_at | timestamp(6) with time zone | Có |  | now() | — |
| responded_at | timestamp(6) with time zone | Không |  | — | — |
| responded_by | uuid | Không | FK | — | — |
| response_reason | text | Không |  | — | — |
| response_actor_type | text | Có |  | 'USER'::text | — |

### Ràng buộc
```sql
support_handoff_response: CHECK ((((status = 'PENDING'::text) AND (responded_at IS NULL) AND (responded_by IS NULL) AND (response_reason IS NULL)) OR ((status <> 'PENDING'::text) AND (responded_at IS NOT NULL) AND (responded_at >= requested_at) AND ((length(btrim(response_reason)) >= 1) AND (length(btrim(response_reason)) <= 500)) AND (((response_actor_type = 'SYSTEM'::text) AND (status = 'CANCELLED'::text) AND (responded_by IS NULL)) OR ((response_actor_type = 'USER'::text) AND (responded_by IS NOT NULL) AND (((status = ANY (ARRAY['ACCEPTED'::text, 'DECLINED'::text])) AND (responded_by = to_staff_id)) OR ((status = 'CANCELLED'::text) AND (responded_by = from_staff_id))))))))
support_request_handoff_check: CHECK ((from_staff_id <> to_staff_id))
support_request_handoff_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
support_request_handoff_response_actor_type_check: CHECK ((response_actor_type = ANY (ARRAY['USER'::text, 'SYSTEM'::text])))
support_request_handoff_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'DECLINED'::text, 'CANCELLED'::text])))
support_request_handoff_from_staff_id_fkey: FOREIGN KEY (from_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_responded_by_fkey: FOREIGN KEY (responded_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_to_staff_id_fkey: FOREIGN KEY (to_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_from_staff_id_not_null: NOT NULL from_staff_id
support_request_handoff_id_not_null: NOT NULL id
support_request_handoff_reason_not_null: NOT NULL reason
support_request_handoff_requested_at_not_null: NOT NULL requested_at
support_request_handoff_response_actor_type_not_null: NOT NULL response_actor_type
support_request_handoff_status_not_null: NOT NULL status
support_request_handoff_support_request_id_not_null: NOT NULL support_request_id
support_request_handoff_to_staff_id_not_null: NOT NULL to_staff_id
support_request_handoff_pkey: PRIMARY KEY (id)
support_handoff_tenant: TRIGGER DEFERRABLE
support_pending_owner: TRIGGER DEFERRABLE INITIALLY DEFERRED
```

### Chỉ mục
```sql
CREATE INDEX support_handoff_from ON public.support_request_handoff USING btree (from_staff_id);
CREATE INDEX support_handoff_incoming ON public.support_request_handoff USING btree (to_staff_id, status);
CREATE UNIQUE INDEX support_handoff_one_pending ON public.support_request_handoff USING btree (support_request_id) WHERE (status = 'PENDING'::text);
CREATE INDEX support_handoff_request_history ON public.support_request_handoff USING btree (support_request_id, requested_at);
CREATE INDEX support_handoff_responder ON public.support_request_handoff USING btree (responded_by);
CREATE UNIQUE INDEX support_request_handoff_pkey ON public.support_request_handoff USING btree (id);
```

## table_access_limit



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| bucket_hash | text | Có | PK | — | — |
| restaurant_id | uuid | Có |  | — | — |
| attempts | integer | Có |  | 0 | — |
| started_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
table_access_limit_attempts_check: CHECK ((attempts >= 0))
table_access_limit_attempts_not_null: NOT NULL attempts
table_access_limit_bucket_hash_not_null: NOT NULL bucket_hash
table_access_limit_restaurant_id_not_null: NOT NULL restaurant_id
table_access_limit_started_at_not_null: NOT NULL started_at
table_access_limit_pkey: PRIMARY KEY (bucket_hash)
```

### Chỉ mục
```sql
CREATE INDEX table_access_limit_expiry ON public.table_access_limit USING btree (started_at);
CREATE UNIQUE INDEX table_access_limit_pkey ON public.table_access_limit USING btree (bucket_hash);
```

## table_qr_token

QR bàn; giữ lịch sử token

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| table_id | uuid | Có | FK | — | Tham chiếu dining_table; không xóa lịch sử |
| token_hash | text | Có |  | — | SHA256 token opaque; không lưu token rõ |
| version_no | integer | Có |  | — | Phiên bản QR của bàn |
| status | text | Có |  | 'ACTIVE'::text | Trạng thái: ACTIVE, REVOKED, EXPIRED |
| issued_at | timestamp with time zone | Có |  | now() | Thời điểm phát hành |
| expires_at | timestamp with time zone | Không |  | — | Hạn tùy chọn |
| revoked_at | timestamp with time zone | Không |  | — | Thời điểm thu hồi |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |
| token_ciphertext | text | Không |  | — | — |

### Ràng buộc
```sql
table_qr_token_check: CHECK (((expires_at IS NULL) OR (expires_at > issued_at)))
table_qr_token_check1: CHECK (((status = 'REVOKED'::text) = (revoked_at IS NOT NULL)))
table_qr_token_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text, 'EXPIRED'::text])))
table_qr_token_version_no_check: CHECK ((version_no > 0))
table_qr_token_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
table_qr_token_created_at_not_null: NOT NULL created_at
table_qr_token_id_not_null: NOT NULL id
table_qr_token_issued_at_not_null: NOT NULL issued_at
table_qr_token_status_not_null: NOT NULL status
table_qr_token_table_id_not_null: NOT NULL table_id
table_qr_token_token_hash_not_null: NOT NULL token_hash
table_qr_token_updated_at_not_null: NOT NULL updated_at
table_qr_token_version_no_not_null: NOT NULL version_no
table_qr_token_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
table_qr_token_table_id_version_no_key: UNIQUE (table_id, version_no)
table_qr_token_token_hash_key: UNIQUE (token_hash)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX table_qr_one_active ON public.table_qr_token USING btree (table_id) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX table_qr_token_pkey ON public.table_qr_token USING btree (id);
CREATE UNIQUE INDEX table_qr_token_table_id_version_no_key ON public.table_qr_token USING btree (table_id, version_no);
CREATE UNIQUE INDEX table_qr_token_token_hash_key ON public.table_qr_token USING btree (token_hash);
```

## table_session

Phiên phục vụ tại bàn

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| table_id | uuid | Có | FK | — | Tham chiếu dining_table; không xóa lịch sử |
| session_status | text | Có |  | 'ACTIVE'::text | Trạng thái: ACTIVE, CLOSED, CANCELLED |
| verification_status | text | Có |  | 'UNVERIFIED'::text | Trạng thái: UNVERIFIED, VERIFIED, SUSPENDED |
| opened_at | timestamp with time zone | Có |  | now() | Thời điểm mở |
| verified_at | timestamp with time zone | Không |  | — | Thời điểm xác minh |
| closed_at | timestamp with time zone | Không |  | — | Thời điểm kết thúc |
| close_reason | text | Không |  | — | Lý do kết thúc |
| version | integer | Có |  | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |
| financial_status | text | Có |  | 'UNPAID'::text | — |
| risk_status | text | Có |  | 'NORMAL'::text | — |
| receipt_number | text | Không |  | — | — |
| closed_by | uuid | Không | FK | — | — |
| receipt_snapshot | jsonb | Không |  | — | — |
| verified_by | uuid | Không | FK | — | — |
| access_code_ciphertext | text | Không |  | — | — |
| access_code_issued_at | timestamp(6) with time zone | Không |  | — | — |

### Ràng buộc
```sql
core_financial_status: CHECK ((financial_status = ANY (ARRAY['UNPAID'::text, 'PARTIALLY_PAID'::text, 'SETTLED'::text, 'REFUND_DUE'::text, 'OUTSTANDING_EXCEPTION'::text])))
core_risk_status: CHECK ((risk_status = ANY (ARRAY['NORMAL'::text, 'REVIEW_REQUIRED'::text, 'BLOCKED'::text])))
receipt_snapshot_closed: CHECK (((receipt_snapshot IS NULL) OR ((session_status = 'CLOSED'::text) AND (closed_at IS NOT NULL) AND (closed_by IS NOT NULL) AND (receipt_number IS NOT NULL))))
table_session_check: CHECK (((session_status = 'ACTIVE'::text) = (closed_at IS NULL)))
table_session_check1: CHECK (((closed_at IS NULL) OR (closed_at >= opened_at)))
table_session_session_status_check: CHECK ((session_status = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text, 'CANCELLED'::text])))
table_session_verification_status_check: CHECK ((verification_status = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'SUSPENDED'::text])))
table_session_version_check: CHECK ((version > 0))
table_session_closed_by_fkey: FOREIGN KEY (closed_by) REFERENCES app_user(id)
table_session_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
table_session_verified_by_fkey: FOREIGN KEY (verified_by) REFERENCES app_user(id) ON DELETE RESTRICT
table_session_created_at_not_null: NOT NULL created_at
table_session_financial_status_not_null: NOT NULL financial_status
table_session_id_not_null: NOT NULL id
table_session_opened_at_not_null: NOT NULL opened_at
table_session_risk_status_not_null: NOT NULL risk_status
table_session_session_status_not_null: NOT NULL session_status
table_session_table_id_not_null: NOT NULL table_id
table_session_updated_at_not_null: NOT NULL updated_at
table_session_verification_status_not_null: NOT NULL verification_status
table_session_version_not_null: NOT NULL version
table_session_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
uat_verifier_tenant: TRIGGER DEFERRABLE
table_session_receipt_number_key: UNIQUE (receipt_number)
```

### Chỉ mục
```sql
CREATE INDEX session_closed_by_lookup ON public.table_session USING btree (closed_by) WHERE (closed_by IS NOT NULL);
CREATE INDEX session_verified_by_lookup ON public.table_session USING btree (verified_by) WHERE (verified_by IS NOT NULL);
CREATE UNIQUE INDEX table_session_one_open ON public.table_session USING btree (table_id) WHERE (session_status <> ALL (ARRAY['CLOSED'::text, 'CANCELLED'::text]));
CREATE UNIQUE INDEX table_session_pkey ON public.table_session USING btree (id);
CREATE UNIQUE INDEX table_session_receipt_number_key ON public.table_session USING btree (receipt_number);
CREATE INDEX table_session_table_idx ON public.table_session USING btree (table_id);
```

## table_transfer_history



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| session_id | uuid | Có | FK | — | — |
| from_table_id | uuid | Có | FK | — | — |
| to_table_id | uuid | Có | FK | — | — |
| transferred_by | uuid | Có | FK | — | — |
| reason | text | Có |  | — | — |
| transferred_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
table_transfer_history_check: CHECK ((from_table_id <> to_table_id))
table_transfer_history_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
table_transfer_history_from_table_id_restaurant_id_fkey: FOREIGN KEY (from_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
table_transfer_history_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id)
table_transfer_history_to_table_id_restaurant_id_fkey: FOREIGN KEY (to_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_transferred_by_restaurant_id_fkey: FOREIGN KEY (transferred_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
table_transfer_history_from_table_id_not_null: NOT NULL from_table_id
table_transfer_history_id_not_null: NOT NULL id
table_transfer_history_reason_not_null: NOT NULL reason
table_transfer_history_restaurant_id_not_null: NOT NULL restaurant_id
table_transfer_history_session_id_not_null: NOT NULL session_id
table_transfer_history_to_table_id_not_null: NOT NULL to_table_id
table_transfer_history_transferred_at_not_null: NOT NULL transferred_at
table_transfer_history_transferred_by_not_null: NOT NULL transferred_by
table_transfer_history_pkey: PRIMARY KEY (id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX table_transfer_history_pkey ON public.table_transfer_history USING btree (id);
CREATE INDEX table_transfer_history_session_idx ON public.table_transfer_history USING btree (session_id, transferred_at);
```

## unit_of_measure



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| code | text | Có |  | — | — |
| name | text | Có |  | — | — |
| dimension | text | Có |  | — | — |
| decimal_scale | integer | Có |  | — | — |
| is_active | boolean | Có |  | true | — |
| created_at | timestamp(6) with time zone | Có |  | now() | — |
| updated_at | timestamp(6) with time zone | Có |  | now() | — |

### Ràng buộc
```sql
unit_of_measure_code_check: CHECK ((length(btrim(code)) > 0))
unit_of_measure_decimal_scale_check: CHECK ((decimal_scale >= 0))
unit_of_measure_decimal_scale_check1: CHECK ((decimal_scale <= 6))
unit_of_measure_dimension_check: CHECK ((dimension = ANY (ARRAY['MASS'::text, 'VOLUME'::text, 'COUNT'::text])))
unit_of_measure_dimension_check1: CHECK ((length(btrim(dimension)) > 0))
unit_of_measure_name_check: CHECK ((length(btrim(name)) > 0))
unit_of_measure_code_not_null: NOT NULL code
unit_of_measure_created_at_not_null: NOT NULL created_at
unit_of_measure_decimal_scale_not_null: NOT NULL decimal_scale
unit_of_measure_dimension_not_null: NOT NULL dimension
unit_of_measure_id_not_null: NOT NULL id
unit_of_measure_is_active_not_null: NOT NULL is_active
unit_of_measure_name_not_null: NOT NULL name
unit_of_measure_updated_at_not_null: NOT NULL updated_at
unit_of_measure_pkey: PRIMARY KEY (id)
unit_of_measure_code_key: UNIQUE (code)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX unit_of_measure_code_key ON public.unit_of_measure USING btree (code);
CREATE UNIQUE INDEX unit_of_measure_pkey ON public.unit_of_measure USING btree (id);
```

## user_role

Lịch sử gán vai trò

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | Khóa chính UUID |
| user_id | uuid | Có | FK | — | Tham chiếu app_user; không xóa lịch sử |
| role_id | uuid | Có | FK | — | Tham chiếu role; không xóa lịch sử |
| assigned_at | timestamp with time zone | Có |  | now() | Thời điểm cấp |
| revoked_at | timestamp with time zone | Không |  | — | Null khi còn hiệu lực |
| created_at | timestamp with time zone | Có |  | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Có |  | now() | Thời điểm cập nhật UTC; trigger tự động |

### Ràng buộc
```sql
user_role_check: CHECK (((revoked_at IS NULL) OR (revoked_at >= assigned_at)))
user_role_role_id_fkey: FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT
user_role_user_id_fkey: FOREIGN KEY (user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
user_role_assigned_at_not_null: NOT NULL assigned_at
user_role_created_at_not_null: NOT NULL created_at
user_role_id_not_null: NOT NULL id
user_role_role_id_not_null: NOT NULL role_id
user_role_updated_at_not_null: NOT NULL updated_at
user_role_user_id_not_null: NOT NULL user_id
user_role_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX user_role_one_active ON public.user_role USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX user_role_pkey ON public.user_role USING btree (id);
CREATE INDEX user_role_role_idx ON public.user_role USING btree (role_id);
```

## work_shift



| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| code | text | Có |  | — | — |
| name | text | Có |  | — | — |
| starts_at | timestamp with time zone | Có |  | — | — |
| ends_at | timestamp with time zone | Có |  | — | — |
| break_minutes | integer | Có |  | 0 | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |
| updated_at | timestamp with time zone | Có |  | now() | — |
| template_id | uuid | Không | FK | — | — |
| scheduled_date | date | Không |  | — | — |
| template_version | integer | Không |  | — | — |
| hourly_rate_override | bigint | Không |  | — | — |
| attendance_grace_minutes | integer | Có |  | 15 | — |
| clock_in_early_minutes | integer | Có |  | 15 | — |
| clock_out_late_minutes | integer | Có |  | 120 | — |

### Ràng buộc
```sql
work_shift_attendance_grace_minutes_check: CHECK (((attendance_grace_minutes >= 0) AND (attendance_grace_minutes <= 60)))
work_shift_break_minutes_check: CHECK (((break_minutes >= 0) AND (break_minutes <= 240)))
work_shift_check: CHECK (((ends_at > starts_at) AND (ends_at <= (starts_at + '16:00:00'::interval))))
work_shift_check1: CHECK ((((break_minutes)::double precision * '00:01:00'::interval) < (ends_at - starts_at)))
work_shift_clock_in_early_minutes_check: CHECK (((clock_in_early_minutes >= 0) AND (clock_in_early_minutes <= 240)))
work_shift_clock_out_late_minutes_check: CHECK (((clock_out_late_minutes >= 0) AND (clock_out_late_minutes <= 240)))
work_shift_code_check: CHECK (((length(btrim(code)) >= 1) AND (length(btrim(code)) <= 64)))
work_shift_hourly_rate_override_check: CHECK (((hourly_rate_override >= 1000) AND (hourly_rate_override <= 10000000)))
work_shift_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
work_shift_template_snapshot: CHECK ((((template_id IS NULL) AND (scheduled_date IS NULL) AND (template_version IS NULL)) OR ((template_id IS NOT NULL) AND (scheduled_date IS NOT NULL) AND (template_version > 0))))
work_shift_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
work_shift_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
work_shift_template_tenant: FOREIGN KEY (template_id, restaurant_id) REFERENCES shift_template(id, restaurant_id)
work_shift_attendance_grace_minutes_not_null: NOT NULL attendance_grace_minutes
work_shift_break_minutes_not_null: NOT NULL break_minutes
work_shift_clock_in_early_minutes_not_null: NOT NULL clock_in_early_minutes
work_shift_clock_out_late_minutes_not_null: NOT NULL clock_out_late_minutes
work_shift_code_not_null: NOT NULL code
work_shift_created_at_not_null: NOT NULL created_at
work_shift_created_by_not_null: NOT NULL created_by
work_shift_ends_at_not_null: NOT NULL ends_at
work_shift_id_not_null: NOT NULL id
work_shift_name_not_null: NOT NULL name
work_shift_restaurant_id_not_null: NOT NULL restaurant_id
work_shift_starts_at_not_null: NOT NULL starts_at
work_shift_updated_at_not_null: NOT NULL updated_at
work_shift_pkey: PRIMARY KEY (id)
work_shift_id_restaurant_id_key: UNIQUE (id, restaurant_id)
work_shift_restaurant_id_code_key: UNIQUE (restaurant_id, code)
work_shift_template_day: UNIQUE (template_id, scheduled_date)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX work_shift_id_restaurant_id_key ON public.work_shift USING btree (id, restaurant_id);
CREATE UNIQUE INDEX work_shift_pkey ON public.work_shift USING btree (id);
CREATE UNIQUE INDEX work_shift_restaurant_id_code_key ON public.work_shift USING btree (restaurant_id, code);
CREATE UNIQUE INDEX work_shift_template_day ON public.work_shift USING btree (template_id, scheduled_date);
```

## workforce_calendar_day

Declared public holidays and employee-specific weekly rest dates; Sunday is not assumed to be a rest day.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| date | date | Có |  | — | — |
| kind | text | Có |  | — | — |
| user_id | uuid | Không | FK | — | — |
| name | text | Có |  | — | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
workforce_calendar_day_check: CHECK ((((kind = 'HOLIDAY'::text) AND (user_id IS NULL)) OR ((kind = 'WEEKLY_REST'::text) AND (user_id IS NOT NULL))))
workforce_calendar_day_kind_check: CHECK ((kind = ANY (ARRAY['HOLIDAY'::text, 'WEEKLY_REST'::text])))
workforce_calendar_day_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
workforce_calendar_day_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_calendar_day_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
workforce_calendar_day_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_calendar_day_created_at_not_null: NOT NULL created_at
workforce_calendar_day_created_by_not_null: NOT NULL created_by
workforce_calendar_day_date_not_null: NOT NULL date
workforce_calendar_day_id_not_null: NOT NULL id
workforce_calendar_day_kind_not_null: NOT NULL kind
workforce_calendar_day_name_not_null: NOT NULL name
workforce_calendar_day_restaurant_id_not_null: NOT NULL restaurant_id
workforce_calendar_day_pkey: PRIMARY KEY (id)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX workforce_calendar_day_pkey ON public.workforce_calendar_day USING btree (id);
CREATE UNIQUE INDEX workforce_calendar_holiday_unique ON public.workforce_calendar_day USING btree (restaurant_id, date) WHERE (kind = 'HOLIDAY'::text);
CREATE INDEX workforce_calendar_lookup ON public.workforce_calendar_day USING btree (restaurant_id, date, user_id);
CREATE UNIQUE INDEX workforce_calendar_rest_unique ON public.workforce_calendar_day USING btree (restaurant_id, date, user_id) WHERE (kind = 'WEEKLY_REST'::text);
```

## workforce_pay_policy

Effective-dated append-only hourly pay rules. No historical approvals are recomputed.

| Cột | Kiểu | Bắt buộc | Khóa | Mặc định | Ý nghĩa |
|---|---|---|---|---|---|
| id | uuid | Có | PK | gen_random_uuid() | — |
| restaurant_id | uuid | Có | FK | — | — |
| effective_from | date | Có |  | — | — |
| night_premium_percent | integer | Có |  | 30 | — |
| overtime_weekday_percent | integer | Có |  | 150 | — |
| rest_day_percent | integer | Có |  | 200 | — |
| holiday_percent | integer | Có |  | 300 | — |
| created_by | uuid | Có | FK | — | — |
| created_at | timestamp with time zone | Có |  | now() | — |

### Ràng buộc
```sql
workforce_pay_policy_holiday_percent_check: CHECK (((holiday_percent >= 300) AND (holiday_percent <= 1000)))
workforce_pay_policy_night_premium_percent_check: CHECK (((night_premium_percent >= 30) AND (night_premium_percent <= 300)))
workforce_pay_policy_overtime_weekday_percent_check: CHECK (((overtime_weekday_percent >= 150) AND (overtime_weekday_percent <= 1000)))
workforce_pay_policy_rest_day_percent_check: CHECK (((rest_day_percent >= 200) AND (rest_day_percent <= 1000)))
workforce_pay_policy_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_pay_policy_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
workforce_pay_policy_created_at_not_null: NOT NULL created_at
workforce_pay_policy_created_by_not_null: NOT NULL created_by
workforce_pay_policy_effective_from_not_null: NOT NULL effective_from
workforce_pay_policy_holiday_percent_not_null: NOT NULL holiday_percent
workforce_pay_policy_id_not_null: NOT NULL id
workforce_pay_policy_night_premium_percent_not_null: NOT NULL night_premium_percent
workforce_pay_policy_overtime_weekday_percent_not_null: NOT NULL overtime_weekday_percent
workforce_pay_policy_rest_day_percent_not_null: NOT NULL rest_day_percent
workforce_pay_policy_restaurant_id_not_null: NOT NULL restaurant_id
workforce_pay_policy_pkey: PRIMARY KEY (id)
workforce_pay_policy_restaurant_id_effective_from_key: UNIQUE (restaurant_id, effective_from)
```

### Chỉ mục
```sql
CREATE UNIQUE INDEX workforce_pay_policy_pkey ON public.workforce_pay_policy USING btree (id);
CREATE UNIQUE INDEX workforce_pay_policy_restaurant_id_effective_from_key ON public.workforce_pay_policy USING btree (restaurant_id, effective_from);
```
