# Lỗi xác thực và phân quyền — 25/09/2026

Response giữ cấu trúc `errorCode`, `userMessage`, `correlationId` hiện tại.

| HTTP | errorCode | Ý nghĩa |
|---|---|---|
| 401 | INVALID_CREDENTIALS | Tên đăng nhập hoặc mật khẩu không chính xác |
| 401 | SESSION_EXPIRED | Thiếu/sai/hết hạn token hoặc phiên đã bị thay/thu hồi |
| 403 | ACCOUNT_LOCKED | Tài khoản ngừng hoạt động; khi login chỉ phân loại này sau khi mật khẩu đúng |
| 403 | PERMISSION_DENIED | Không có quyền thực hiện thao tác; không đăng xuất |

Cookie access/refresh là HttpOnly: backend xóa qua Set-Cookie khi trả 401 hoặc ACCOUNT_LOCKED. Frontend không lưu token trong localStorage. Khi nhận lỗi kết thúc phiên, AuthBoundary gỡ cây giao diện nghiệp vụ (bao gồm các modal con và dữ liệu trong React state), hiển thị dialog chặn duy nhất; Escape và bấm nền không đóng được. Nút duy nhất tải mới /login. Interceptor không tiếp tục polling, gửi mutation hoặc nhận thành công muộn để phục hồi màn hình cũ sau khi đã khóa.

Theo yêu cầu nghiệm thu mới, frontend KHÔNG tự refresh/retry sau 401, kể cả token access hết hạn. Token access hiện có hạn 15 phút; do đó lần gọi API sau khi hết hạn sẽ yêu cầu đăng nhập lại. Endpoint refresh vẫn tồn tại ở backend nhưng không được API client tự gọi. Muốn phiên kéo dài cần quyết định riêng về thời gian token hoặc cơ chế gia hạn trước khi hết hạn.

403 PERMISSION_DENIED hiện toast “Bạn không có quyền thực hiện nghiệp vụ này.” trong 6 giây, giữ nguyên cookie và phiên. CSRF_REJECTED, lỗi mạng và các lỗi nghiệp vụ 400/409 không làm đăng xuất. Mọi phương thức qua requestApi dùng chung cơ chế, gồm các màn quản trị, phục vụ, bếp, ca/lương và khách. Với 401 của khách, quy tắc hiện cũng chuyển về /login theo yêu cầu global; chưa có ngoại lệ tự đưa khách về quét QR.

Kiểm thử thủ công: đăng nhập ở hai hồ sơ, khóa tài khoản ở quản trị rồi thao tác/tải lại ở nhân viên; kiểm tra modal, không thấy dữ liệu bàn, Escape không thoát, nút duy nhất về login. Thử thiếu quyền ở /workspace/admin bằng nhân viên: có thông báo quyền, không mất phiên; quay lại /workspace/staff vẫn dùng được. Thử sai mật khẩu tại login: hiện modal đúng nội dung. Lỗi kết nối không được giả thành hết phiên.
