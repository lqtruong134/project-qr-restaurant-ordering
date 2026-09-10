BEGIN;
-- Sprint 1: exactly 14 business tables. PostgreSQL metadata excluded.
CREATE TABLE restaurant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  currency text NOT NULL DEFAULT 'VND',
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (currency = 'VND')
);
COMMENT ON TABLE restaurant IS 'Nhà hàng';
COMMENT ON COLUMN restaurant.id IS 'Khóa chính UUID';
COMMENT ON COLUMN restaurant.name IS 'Tên nhà hàng';
COMMENT ON COLUMN restaurant.address IS 'Địa chỉ';
COMMENT ON COLUMN restaurant.currency IS 'Đơn vị tiền';
COMMENT ON COLUMN restaurant.timezone IS 'Múi giờ hiển thị';
COMMENT ON COLUMN restaurant.status IS 'Trạng thái: ACTIVE, INACTIVE';
COMMENT ON COLUMN restaurant.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN restaurant.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  username varchar(64) NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  last_login_at timestamptz,
  refresh_token_hash text UNIQUE,
  refresh_expires_at timestamptz,
  auth_version integer NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, username), CHECK (username ~ '^[a-z0-9_.-]{3,64}$'), CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL))
);
COMMENT ON TABLE app_user IS 'Tài khoản nội bộ và trạng thái đăng nhập';
COMMENT ON COLUMN app_user.id IS 'Khóa chính UUID';
COMMENT ON COLUMN app_user.restaurant_id IS 'Tham chiếu restaurant; không xóa lịch sử';
COMMENT ON COLUMN app_user.username IS 'Tên đăng nhập chữ thường, duy nhất trong nhà hàng';
COMMENT ON COLUMN app_user.password_hash IS 'Argon2id hash; không chứa mật khẩu rõ';
COMMENT ON COLUMN app_user.display_name IS 'Tên hiển thị';
COMMENT ON COLUMN app_user.status IS 'Trạng thái: ACTIVE, INACTIVE';
COMMENT ON COLUMN app_user.last_login_at IS 'Lần đăng nhập thành công gần nhất';
COMMENT ON COLUMN app_user.refresh_token_hash IS 'SHA256 refresh opaque; chỉ lưu hash';
COMMENT ON COLUMN app_user.refresh_expires_at IS 'Hạn tuyệt đối của phiên đăng nhập';
COMMENT ON COLUMN app_user.auth_version IS 'Tăng khi đăng nhập/thu hồi phiên';
COMMENT ON COLUMN app_user.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN app_user.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code IN ('STAFF','KITCHEN','ADMIN'))
);
COMMENT ON TABLE role IS 'Vai trò toàn hệ thống';
COMMENT ON COLUMN role.id IS 'Khóa chính UUID';
COMMENT ON COLUMN role.code IS 'Mã STAFF, KITCHEN, ADMIN';
COMMENT ON COLUMN role.name IS 'Tên vai trò';
COMMENT ON COLUMN role.description IS 'Mô tả';
COMMENT ON COLUMN role.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN role.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE permission IS 'Quyền chức năng';
COMMENT ON COLUMN permission.id IS 'Khóa chính UUID';
COMMENT ON COLUMN permission.code IS 'Mã quyền duy nhất';
COMMENT ON COLUMN permission.module IS 'Phân hệ';
COMMENT ON COLUMN permission.action IS 'Hành động';
COMMENT ON COLUMN permission.description IS 'Mô tả';
COMMENT ON COLUMN permission.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN permission.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE user_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);
COMMENT ON TABLE user_role IS 'Lịch sử gán vai trò';
COMMENT ON COLUMN user_role.id IS 'Khóa chính UUID';
COMMENT ON COLUMN user_role.user_id IS 'Tham chiếu app_user; không xóa lịch sử';
COMMENT ON COLUMN user_role.role_id IS 'Tham chiếu role; không xóa lịch sử';
COMMENT ON COLUMN user_role.assigned_at IS 'Thời điểm cấp';
COMMENT ON COLUMN user_role.revoked_at IS 'Null khi còn hiệu lực';
COMMENT ON COLUMN user_role.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN user_role.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE role_permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope text NOT NULL DEFAULT 'RESTAURANT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id), CHECK (scope = 'RESTAURANT')
);
COMMENT ON TABLE role_permission IS 'Quyền của vai trò';
COMMENT ON COLUMN role_permission.id IS 'Khóa chính UUID';
COMMENT ON COLUMN role_permission.role_id IS 'Tham chiếu role; không xóa lịch sử';
COMMENT ON COLUMN role_permission.permission_id IS 'Tham chiếu permission; không xóa lịch sử';
COMMENT ON COLUMN role_permission.scope IS 'Phạm vi cấp quyền';
COMMENT ON COLUMN role_permission.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN role_permission.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE dining_area (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, code), UNIQUE (id, restaurant_id)
);
COMMENT ON TABLE dining_area IS 'Khu vực bàn';
COMMENT ON COLUMN dining_area.id IS 'Khóa chính UUID';
COMMENT ON COLUMN dining_area.restaurant_id IS 'Tham chiếu restaurant; không xóa lịch sử';
COMMENT ON COLUMN dining_area.code IS 'Mã khu vực';
COMMENT ON COLUMN dining_area.name IS 'Tên khu vực';
COMMENT ON COLUMN dining_area.sort_order IS 'Thứ tự hiển thị';
COMMENT ON COLUMN dining_area.is_active IS 'Ngừng dùng bằng false; giữ lịch sử';
COMMENT ON COLUMN dining_area.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN dining_area.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE dining_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  area_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  table_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (table_status IN ('AVAILABLE','OCCUPIED','NEEDS_CLEANING')),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, code), FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE dining_table IS 'Bàn ăn';
COMMENT ON COLUMN dining_table.id IS 'Khóa chính UUID';
COMMENT ON COLUMN dining_table.restaurant_id IS 'Tham chiếu restaurant; không xóa lịch sử';
COMMENT ON COLUMN dining_table.area_id IS 'Khu vực cùng nhà hàng; FK ghép';
COMMENT ON COLUMN dining_table.code IS 'Mã bàn';
COMMENT ON COLUMN dining_table.name IS 'Tên bàn';
COMMENT ON COLUMN dining_table.capacity IS 'Số chỗ > 0';
COMMENT ON COLUMN dining_table.table_status IS 'Trạng thái: AVAILABLE, OCCUPIED, NEEDS_CLEANING';
COMMENT ON COLUMN dining_table.is_active IS 'Ngừng dùng bằng false; giữ lịch sử';
COMMENT ON COLUMN dining_table.version IS 'Phiên bản optimistic locking';
COMMENT ON COLUMN dining_table.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN dining_table.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE table_qr_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES dining_table(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, version_no), CHECK (expires_at IS NULL OR expires_at > issued_at), CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
COMMENT ON TABLE table_qr_token IS 'QR bàn; giữ lịch sử token';
COMMENT ON COLUMN table_qr_token.id IS 'Khóa chính UUID';
COMMENT ON COLUMN table_qr_token.table_id IS 'Tham chiếu dining_table; không xóa lịch sử';
COMMENT ON COLUMN table_qr_token.token_hash IS 'SHA256 token opaque; không lưu token rõ';
COMMENT ON COLUMN table_qr_token.version_no IS 'Phiên bản QR của bàn';
COMMENT ON COLUMN table_qr_token.status IS 'Trạng thái: ACTIVE, REVOKED, EXPIRED';
COMMENT ON COLUMN table_qr_token.issued_at IS 'Thời điểm phát hành';
COMMENT ON COLUMN table_qr_token.expires_at IS 'Hạn tùy chọn';
COMMENT ON COLUMN table_qr_token.revoked_at IS 'Thời điểm thu hồi';
COMMENT ON COLUMN table_qr_token.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN table_qr_token.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE table_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES dining_table(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  session_status text NOT NULL DEFAULT 'ACTIVE' CHECK (session_status IN ('ACTIVE','CLOSED','CANCELLED')),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED','VERIFIED','SUSPENDED')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((session_status = 'ACTIVE') = (closed_at IS NULL)), CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
COMMENT ON TABLE table_session IS 'Phiên phục vụ tại bàn';
COMMENT ON COLUMN table_session.id IS 'Khóa chính UUID';
COMMENT ON COLUMN table_session.table_id IS 'Tham chiếu dining_table; không xóa lịch sử';
COMMENT ON COLUMN table_session.session_status IS 'Trạng thái: ACTIVE, CLOSED, CANCELLED';
COMMENT ON COLUMN table_session.verification_status IS 'Trạng thái: UNVERIFIED, VERIFIED, SUSPENDED';
COMMENT ON COLUMN table_session.opened_at IS 'Thời điểm mở';
COMMENT ON COLUMN table_session.verified_at IS 'Thời điểm xác minh';
COMMENT ON COLUMN table_session.closed_at IS 'Thời điểm kết thúc';
COMMENT ON COLUMN table_session.close_reason IS 'Lý do kết thúc';
COMMENT ON COLUMN table_session.version IS 'Phiên bản optimistic locking';
COMMENT ON COLUMN table_session.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN table_session.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE session_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_session(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  guest_id uuid NOT NULL,
  display_name text,
  credential_hash text NOT NULL UNIQUE,
  device_session_hash text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','LEFT')),
  blocked_until timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, guest_id)
);
COMMENT ON TABLE session_participant IS 'Khách trong phiên; chỉ dữ liệu mẫu Sprint 1';
COMMENT ON COLUMN session_participant.id IS 'Khóa chính UUID';
COMMENT ON COLUMN session_participant.session_id IS 'Tham chiếu table_session; không xóa lịch sử';
COMMENT ON COLUMN session_participant.guest_id IS 'Định danh khách opaque trong phiên';
COMMENT ON COLUMN session_participant.display_name IS 'Tên khách tùy chọn';
COMMENT ON COLUMN session_participant.credential_hash IS 'Hash credential khách';
COMMENT ON COLUMN session_participant.device_session_hash IS 'Hash định danh thiết bị trong phiên';
COMMENT ON COLUMN session_participant.status IS 'Trạng thái: ACTIVE, BLOCKED, LEFT';
COMMENT ON COLUMN session_participant.blocked_until IS 'Hạn chặn tùy chọn';
COMMENT ON COLUMN session_participant.joined_at IS 'Thời điểm tham gia';
COMMENT ON COLUMN session_participant.last_seen_at IS 'Hoạt động gần nhất';
COMMENT ON COLUMN session_participant.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN session_participant.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE session_cart (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_session(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cart_version integer NOT NULL DEFAULT 1 CHECK (cart_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);
COMMENT ON TABLE session_cart IS 'Giỏ phiên, chưa có dòng món';
COMMENT ON COLUMN session_cart.id IS 'Khóa chính UUID';
COMMENT ON COLUMN session_cart.session_id IS 'Tham chiếu table_session; không xóa lịch sử';
COMMENT ON COLUMN session_cart.cart_version IS 'Phiên bản giỏ';
COMMENT ON COLUMN session_cart.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN session_cart.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE menu_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, code), UNIQUE (id, restaurant_id)
);
COMMENT ON TABLE menu_category IS 'Danh mục món';
COMMENT ON COLUMN menu_category.id IS 'Khóa chính UUID';
COMMENT ON COLUMN menu_category.restaurant_id IS 'Tham chiếu restaurant; không xóa lịch sử';
COMMENT ON COLUMN menu_category.code IS 'Mã danh mục';
COMMENT ON COLUMN menu_category.name IS 'Tên danh mục';
COMMENT ON COLUMN menu_category.description IS 'Mô tả';
COMMENT ON COLUMN menu_category.sort_order IS 'Thứ tự hiển thị';
COMMENT ON COLUMN menu_category.is_active IS 'Ngừng dùng bằng false; giữ lịch sử';
COMMENT ON COLUMN menu_category.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN menu_category.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  category_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  image_url text,
  base_price bigint NOT NULL CHECK (base_price >= 0),
  availability_status text NOT NULL DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE','UNAVAILABLE')),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, code), FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_category(id, restaurant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE product IS 'Món ăn';
COMMENT ON COLUMN product.id IS 'Khóa chính UUID';
COMMENT ON COLUMN product.restaurant_id IS 'Tham chiếu restaurant; không xóa lịch sử';
COMMENT ON COLUMN product.category_id IS 'Danh mục cùng nhà hàng; FK ghép';
COMMENT ON COLUMN product.code IS 'Mã món';
COMMENT ON COLUMN product.name IS 'Tên món';
COMMENT ON COLUMN product.description IS 'Mô tả';
COMMENT ON COLUMN product.image_url IS 'Đường dẫn ảnh tùy chọn';
COMMENT ON COLUMN product.base_price IS 'Giá VND nguyên không âm';
COMMENT ON COLUMN product.availability_status IS 'Trạng thái: AVAILABLE, UNAVAILABLE';
COMMENT ON COLUMN product.is_active IS 'Ngừng dùng bằng false; giữ lịch sử';
COMMENT ON COLUMN product.version IS 'Phiên bản optimistic locking';
COMMENT ON COLUMN product.created_at IS 'Thời điểm tạo UTC';
COMMENT ON COLUMN product.updated_at IS 'Thời điểm cập nhật UTC; trigger tự động';
CREATE UNIQUE INDEX user_role_one_active ON user_role(user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_role_role_idx ON user_role(role_id);
CREATE INDEX role_permission_permission_idx ON role_permission(permission_id);
CREATE INDEX dining_table_area_idx ON dining_table(area_id, restaurant_id);
CREATE INDEX product_category_idx ON product(category_id, restaurant_id);
CREATE UNIQUE INDEX table_qr_one_active ON table_qr_token(table_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX table_session_one_open ON table_session(table_id) WHERE session_status NOT IN ('CLOSED','CANCELLED');
CREATE INDEX table_session_table_idx ON table_session(table_id);
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION revoke_changed_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
  NEW.refresh_token_hash = NULL; NEW.refresh_expires_at = NULL; NEW.auth_version = OLD.auth_version + 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_user_revoke BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION revoke_changed_account();
CREATE TRIGGER restaurant_updated BEFORE UPDATE ON restaurant FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER app_user_updated BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER role_updated BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER permission_updated BEFORE UPDATE ON permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER user_role_updated BEFORE UPDATE ON user_role FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER role_permission_updated BEFORE UPDATE ON role_permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER dining_area_updated BEFORE UPDATE ON dining_area FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER dining_table_updated BEFORE UPDATE ON dining_table FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER table_qr_token_updated BEFORE UPDATE ON table_qr_token FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER table_session_updated BEFORE UPDATE ON table_session FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER session_participant_updated BEFORE UPDATE ON session_participant FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER session_cart_updated BEFORE UPDATE ON session_cart FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER menu_category_updated BEFORE UPDATE ON menu_category FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER product_updated BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
COMMIT;
