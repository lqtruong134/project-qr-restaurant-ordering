# Data Dictionary — Sprint 1
Version: 2026-09-10 · Migration: `202609100001_c0_c1`
Sinh từ PostgreSQL đang chạy, gồm đúng 14 bảng. PK/FK/unique/check ở từng bảng; index bao gồm partial unique. Mọi FK RESTRICT, mọi thời gian UTC (timestamptz). Trigger tự cập nhật updated_at; trigger app_user_revoke thu hồi phiên khi đổi mật khẩu/trạng thái. Prisma schema quản lý cấu trúc; SQL migration quản lý thêm partial index, check, comment và trigger.
## app_user
Tài khoản nội bộ và trạng thái đăng nhập
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Không | — | Tham chiếu restaurant; không xóa lịch sử |
| username | character varying(64) | Không | — | Tên đăng nhập chữ thường, duy nhất trong nhà hàng |
| password_hash | text | Không | — | Argon2id hash; không chứa mật khẩu rõ |
| display_name | text | Không | — | Tên hiển thị |
| status | text | Không | 'ACTIVE'::text | Trạng thái: ACTIVE, INACTIVE |
| last_login_at | timestamp with time zone | Có | — | Lần đăng nhập thành công gần nhất |
| refresh_token_hash | text | Có | — | SHA256 refresh opaque; chỉ lưu hash |
| refresh_expires_at | timestamp with time zone | Có | — | Hạn tuyệt đối của phiên đăng nhập |
| auth_version | integer | Không | 0 | Tăng khi đăng nhập/thu hồi phiên |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
app_user_status_not_null: NOT NULL status
app_user_updated_at_not_null: NOT NULL updated_at
app_user_username_not_null: NOT NULL username
app_user_pkey: PRIMARY KEY (id)
app_user_refresh_token_hash_key: UNIQUE (refresh_token_hash)
app_user_restaurant_id_username_key: UNIQUE (restaurant_id, username)
```
### Index
```sql
CREATE UNIQUE INDEX app_user_pkey ON public.app_user USING btree (id);
CREATE UNIQUE INDEX app_user_refresh_token_hash_key ON public.app_user USING btree (refresh_token_hash);
CREATE UNIQUE INDEX app_user_restaurant_id_username_key ON public.app_user USING btree (restaurant_id, username);
```
## dining_area
Khu vực bàn
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Không | — | Tham chiếu restaurant; không xóa lịch sử |
| code | text | Không | — | Mã khu vực |
| name | text | Không | — | Tên khu vực |
| sort_order | integer | Không | 0 | Thứ tự hiển thị |
| is_active | boolean | Không | true | Ngừng dùng bằng false; giữ lịch sử |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
dining_area_id_restaurant_id_key: UNIQUE (id, restaurant_id)
dining_area_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```
### Index
```sql
CREATE UNIQUE INDEX dining_area_id_restaurant_id_key ON public.dining_area USING btree (id, restaurant_id);
CREATE UNIQUE INDEX dining_area_pkey ON public.dining_area USING btree (id);
CREATE UNIQUE INDEX dining_area_restaurant_id_code_key ON public.dining_area USING btree (restaurant_id, code);
```
## dining_table
Bàn ăn
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Không | — | Tham chiếu restaurant; không xóa lịch sử |
| area_id | uuid | Không | — | Khu vực cùng nhà hàng; FK ghép |
| code | text | Không | — | Mã bàn |
| name | text | Không | — | Tên bàn |
| capacity | integer | Không | — | Số chỗ > 0 |
| table_status | text | Không | 'AVAILABLE'::text | Trạng thái: AVAILABLE, OCCUPIED, NEEDS_CLEANING |
| is_active | boolean | Không | true | Ngừng dùng bằng false; giữ lịch sử |
| version | integer | Không | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
dining_table_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```
### Index
```sql
CREATE INDEX dining_table_area_idx ON public.dining_table USING btree (area_id, restaurant_id);
CREATE UNIQUE INDEX dining_table_pkey ON public.dining_table USING btree (id);
CREATE UNIQUE INDEX dining_table_restaurant_id_code_key ON public.dining_table USING btree (restaurant_id, code);
```
## menu_category
Danh mục món
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Không | — | Tham chiếu restaurant; không xóa lịch sử |
| code | text | Không | — | Mã danh mục |
| name | text | Không | — | Tên danh mục |
| description | text | Có | — | Mô tả |
| sort_order | integer | Không | 0 | Thứ tự hiển thị |
| is_active | boolean | Không | true | Ngừng dùng bằng false; giữ lịch sử |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
menu_category_id_restaurant_id_key: UNIQUE (id, restaurant_id)
menu_category_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```
### Index
```sql
CREATE UNIQUE INDEX menu_category_id_restaurant_id_key ON public.menu_category USING btree (id, restaurant_id);
CREATE UNIQUE INDEX menu_category_pkey ON public.menu_category USING btree (id);
CREATE UNIQUE INDEX menu_category_restaurant_id_code_key ON public.menu_category USING btree (restaurant_id, code);
```
## permission
Quyền chức năng
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| code | text | Không | — | Mã quyền duy nhất |
| module | text | Không | — | Phân hệ |
| action | text | Không | — | Hành động |
| description | text | Có | — | Mô tả |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
### Index
```sql
CREATE UNIQUE INDEX permission_code_key ON public.permission USING btree (code);
CREATE UNIQUE INDEX permission_pkey ON public.permission USING btree (id);
```
## product
Món ăn
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| restaurant_id | uuid | Không | — | Tham chiếu restaurant; không xóa lịch sử |
| category_id | uuid | Không | — | Danh mục cùng nhà hàng; FK ghép |
| code | text | Không | — | Mã món |
| name | text | Không | — | Tên món |
| description | text | Có | — | Mô tả |
| image_url | text | Có | — | Đường dẫn ảnh tùy chọn |
| base_price | bigint | Không | — | Giá VND nguyên không âm |
| availability_status | text | Không | 'AVAILABLE'::text | Trạng thái: AVAILABLE, UNAVAILABLE |
| is_active | boolean | Không | true | Ngừng dùng bằng false; giữ lịch sử |
| version | integer | Không | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
```sql
product_availability_status_check: CHECK ((availability_status = ANY (ARRAY['AVAILABLE'::text, 'UNAVAILABLE'::text])))
product_base_price_check: CHECK ((base_price >= 0))
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
product_name_not_null: NOT NULL name
product_restaurant_id_not_null: NOT NULL restaurant_id
product_updated_at_not_null: NOT NULL updated_at
product_version_not_null: NOT NULL version
product_pkey: PRIMARY KEY (id)
product_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```
### Index
```sql
CREATE INDEX product_category_idx ON public.product USING btree (category_id, restaurant_id);
CREATE UNIQUE INDEX product_pkey ON public.product USING btree (id);
CREATE UNIQUE INDEX product_restaurant_id_code_key ON public.product USING btree (restaurant_id, code);
```
## restaurant
Nhà hàng
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| name | text | Không | — | Tên nhà hàng |
| address | text | Có | — | Địa chỉ |
| currency | text | Không | 'VND'::text | Đơn vị tiền |
| timezone | text | Không | 'Asia/Ho_Chi_Minh'::text | Múi giờ hiển thị |
| status | text | Không | 'ACTIVE'::text | Trạng thái: ACTIVE, INACTIVE |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
### Index
```sql
CREATE UNIQUE INDEX restaurant_pkey ON public.restaurant USING btree (id);
```
## role
Vai trò toàn hệ thống
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| code | text | Không | — | Mã STAFF, KITCHEN, ADMIN |
| name | text | Không | — | Tên vai trò |
| description | text | Có | — | Mô tả |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
### Index
```sql
CREATE UNIQUE INDEX role_code_key ON public.role USING btree (code);
CREATE UNIQUE INDEX role_pkey ON public.role USING btree (id);
```
## role_permission
Quyền của vai trò
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| role_id | uuid | Không | — | Tham chiếu role; không xóa lịch sử |
| permission_id | uuid | Không | — | Tham chiếu permission; không xóa lịch sử |
| scope | text | Không | 'RESTAURANT'::text | Phạm vi cấp quyền |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
### Index
```sql
CREATE INDEX role_permission_permission_idx ON public.role_permission USING btree (permission_id);
CREATE UNIQUE INDEX role_permission_pkey ON public.role_permission USING btree (id);
CREATE UNIQUE INDEX role_permission_role_id_permission_id_key ON public.role_permission USING btree (role_id, permission_id);
```
## session_cart
Giỏ phiên, chưa có dòng món
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| session_id | uuid | Không | — | Tham chiếu table_session; không xóa lịch sử |
| cart_version | integer | Không | 1 | Phiên bản giỏ |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
```sql
session_cart_cart_version_check: CHECK ((cart_version > 0))
session_cart_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_cart_cart_version_not_null: NOT NULL cart_version
session_cart_created_at_not_null: NOT NULL created_at
session_cart_id_not_null: NOT NULL id
session_cart_session_id_not_null: NOT NULL session_id
session_cart_updated_at_not_null: NOT NULL updated_at
session_cart_pkey: PRIMARY KEY (id)
session_cart_session_id_key: UNIQUE (session_id)
```
### Index
```sql
CREATE UNIQUE INDEX session_cart_pkey ON public.session_cart USING btree (id);
CREATE UNIQUE INDEX session_cart_session_id_key ON public.session_cart USING btree (session_id);
```
## session_participant
Khách trong phiên; chỉ dữ liệu mẫu Sprint 1
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| session_id | uuid | Không | — | Tham chiếu table_session; không xóa lịch sử |
| guest_id | uuid | Không | — | Định danh khách opaque trong phiên |
| display_name | text | Có | — | Tên khách tùy chọn |
| credential_hash | text | Không | — | Hash credential khách |
| device_session_hash | text | Có | — | Hash định danh thiết bị trong phiên |
| status | text | Không | 'ACTIVE'::text | Trạng thái: ACTIVE, BLOCKED, LEFT |
| blocked_until | timestamp with time zone | Có | — | Hạn chặn tùy chọn |
| joined_at | timestamp with time zone | Không | now() | Thời điểm tham gia |
| last_seen_at | timestamp with time zone | Không | now() | Hoạt động gần nhất |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
```sql
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
session_participant_credential_hash_key: UNIQUE (credential_hash)
session_participant_session_id_guest_id_key: UNIQUE (session_id, guest_id)
```
### Index
```sql
CREATE UNIQUE INDEX session_participant_credential_hash_key ON public.session_participant USING btree (credential_hash);
CREATE UNIQUE INDEX session_participant_pkey ON public.session_participant USING btree (id);
CREATE UNIQUE INDEX session_participant_session_id_guest_id_key ON public.session_participant USING btree (session_id, guest_id);
```
## table_qr_token
QR bàn; giữ lịch sử token
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| table_id | uuid | Không | — | Tham chiếu dining_table; không xóa lịch sử |
| token_hash | text | Không | — | SHA256 token opaque; không lưu token rõ |
| version_no | integer | Không | — | Phiên bản QR của bàn |
| status | text | Không | 'ACTIVE'::text | Trạng thái: ACTIVE, REVOKED, EXPIRED |
| issued_at | timestamp with time zone | Không | now() | Thời điểm phát hành |
| expires_at | timestamp with time zone | Có | — | Hạn tùy chọn |
| revoked_at | timestamp with time zone | Có | — | Thời điểm thu hồi |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
table_qr_token_table_id_version_no_key: UNIQUE (table_id, version_no)
table_qr_token_token_hash_key: UNIQUE (token_hash)
```
### Index
```sql
CREATE UNIQUE INDEX table_qr_one_active ON public.table_qr_token USING btree (table_id) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX table_qr_token_pkey ON public.table_qr_token USING btree (id);
CREATE UNIQUE INDEX table_qr_token_table_id_version_no_key ON public.table_qr_token USING btree (table_id, version_no);
CREATE UNIQUE INDEX table_qr_token_token_hash_key ON public.table_qr_token USING btree (token_hash);
```
## table_session
Phiên phục vụ tại bàn
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| table_id | uuid | Không | — | Tham chiếu dining_table; không xóa lịch sử |
| session_status | text | Không | 'ACTIVE'::text | Trạng thái: ACTIVE, CLOSED, CANCELLED |
| verification_status | text | Không | 'UNVERIFIED'::text | Trạng thái: UNVERIFIED, VERIFIED, SUSPENDED |
| opened_at | timestamp with time zone | Không | now() | Thời điểm mở |
| verified_at | timestamp with time zone | Có | — | Thời điểm xác minh |
| closed_at | timestamp with time zone | Có | — | Thời điểm kết thúc |
| close_reason | text | Có | — | Lý do kết thúc |
| version | integer | Không | 1 | Phiên bản optimistic locking |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
```sql
table_session_check: CHECK (((session_status = 'ACTIVE'::text) = (closed_at IS NULL)))
table_session_check1: CHECK (((closed_at IS NULL) OR (closed_at >= opened_at)))
table_session_session_status_check: CHECK ((session_status = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text, 'CANCELLED'::text])))
table_session_verification_status_check: CHECK ((verification_status = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'SUSPENDED'::text])))
table_session_version_check: CHECK ((version > 0))
table_session_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
table_session_created_at_not_null: NOT NULL created_at
table_session_id_not_null: NOT NULL id
table_session_opened_at_not_null: NOT NULL opened_at
table_session_session_status_not_null: NOT NULL session_status
table_session_table_id_not_null: NOT NULL table_id
table_session_updated_at_not_null: NOT NULL updated_at
table_session_verification_status_not_null: NOT NULL verification_status
table_session_version_not_null: NOT NULL version
table_session_pkey: PRIMARY KEY (id)
```
### Index
```sql
CREATE UNIQUE INDEX table_session_one_open ON public.table_session USING btree (table_id) WHERE (session_status <> ALL (ARRAY['CLOSED'::text, 'CANCELLED'::text]));
CREATE UNIQUE INDEX table_session_pkey ON public.table_session USING btree (id);
CREATE INDEX table_session_table_idx ON public.table_session USING btree (table_id);
```
## user_role
Lịch sử gán vai trò
| Cột | Kiểu | Nullable | Default | Ý nghĩa |
|---|---|---|---|---|
| id | uuid | Không | gen_random_uuid() | Khóa chính UUID |
| user_id | uuid | Không | — | Tham chiếu app_user; không xóa lịch sử |
| role_id | uuid | Không | — | Tham chiếu role; không xóa lịch sử |
| assigned_at | timestamp with time zone | Không | now() | Thời điểm cấp |
| revoked_at | timestamp with time zone | Có | — | Null khi còn hiệu lực |
| created_at | timestamp with time zone | Không | now() | Thời điểm tạo UTC |
| updated_at | timestamp with time zone | Không | now() | Thời điểm cập nhật UTC; trigger tự động |
### PK / FK / Unique / Check
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
```
### Index
```sql
CREATE UNIQUE INDEX user_role_one_active ON public.user_role USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX user_role_pkey ON public.user_role USING btree (id);
CREATE INDEX user_role_role_idx ON public.user_role USING btree (role_id);
```
