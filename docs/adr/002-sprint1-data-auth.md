# ADR 002 — C0/C1 và đăng nhập nội bộ
Ngày 2026-09-10. Phạm vi: EN-C0-02, US-C0-01, EN-C0-03.

Thiết kế trước migration: restaurant có nhiều app_user, dining_area, dining_table,
menu_category, product. Dining_area có nhiều dining_table. Bàn có nhiều QR lịch sử
và nhiều session lịch sử; tối đa một QR ACTIVE và một session chưa kết thúc.
Session có nhiều participant và tối đa một cart (seed tạo đủ một cart).
Product thuộc đúng category cùng restaurant. User có một role hoạt động;
user_role giữ lịch sử revoked, cho phép gán lại cùng role bằng bản ghi mới.
Role/permission là danh mục toàn hệ thống, code unique, đúng SRS §5.4.

Chỉ 14 bảng nghiệp vụ. Tất cả FK RESTRICT khi delete/update; UUID không thay đổi.
Tất cả thời gian timestamptz; tiền BIGINT. Partial unique/check/trigger được quản lý
trong SQL migration vì Prisma không biểu diễn toàn bộ; không dùng db push.
Không tạo financial/risk columns chưa phục vụ Sprint; bổ sung cùng Increment tương ứng.

Một phiên đăng nhập nội bộ đang hiệu lực trên mỗi account: đăng nhập mới thu hồi
phiên cũ. app_user lưu hash refresh, hạn tuyệt đối 7 ngày và auth_version.
Access JWT 15 phút, HS256 bằng secret ngẫu nhiên >=32 byte; mỗi request đọc lại
status, auth_version, role/permission từ DB. Refresh rotate bằng UPDATE compare-and-swap
và không kéo dài hạn tuyệt đối. Logout thu hồi cả access/refresh. Trigger thu hồi
khi status/password thay đổi kể cả thay qua công cụ quản trị. Không thêm bảng token.
Cookie HttpOnly, SameSite=Strict, Secure khi production; origin allowlist + header
CSRF (bắt buộc cả login) ngăn gửi form/cross-site. Không bật CORS.
Rate limit account VÀ IP, 5 lần/60 giây, cấu hình được; bộ đếm RAM chỉ phù hợp
demo một API instance. Khi triển khai nhiều instance cần shared limiter.
Password dùng scrypt không được chọn vì AC yêu cầu Argon2id/bcrypt: dùng Argon2id
memoryCost=19456 KiB, timeCost=2, parallelism=1. Không log body/cookie/token.
Guest chưa có luồng truy cập trong Sprint 1. Trang theo vai trò chỉ chứng minh
quyền vào phân hệ, không giả lập đã hoàn thành POS/KDS/quản trị thực tế.
