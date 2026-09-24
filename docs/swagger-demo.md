# Dùng Swagger để xem và thử API

Khởi động dự án rồi mở `http://localhost:3000/api-docs` (hoặc cổng WEB_PORT trong `.env`). Dùng cố định một hostname để cookie không bị tách. Nút Execute gửi yêu cầu thật, có thể tạo/sửa dữ liệu demo.

1. Mở nhóm Kết nối, gọi health/live và health/ready.
2. Đăng nhập ở `/auth/login`: dùng `pv001`, `bep001` hoặc `quyettruong05`; nhập mật khẩu từ `.env` riêng, không đưa mật khẩu vào tài liệu.
3. Gọi `/auth/me` và `/workspaces/{area}`. Staff vào admin phải bị 403. Đăng xuất trước khi thử tài khoản khác.
4. Các nhóm CORE hiển thị thao tác quản trị, khách, gọi món, kho và thanh toán. ID ví dụ là placeholder; lấy ID thật từ API đọc trước khi gửi thao tác ghi. Mã requestId phải mới cho thao tác mới, giữ nguyên khi thử lại chính yêu cầu đó.
5. Luồng khách cần cookie guest tạo từ `/guest/join`; tài khoản nhân viên không thay cookie khách.

Swagger tự gửi cookie và header chống CSRF khi cần; không nhập cookie hoặc mật khẩu vào URL. API yêu cầu quyền và ràng buộc thật, không bỏ qua chúng để phục vụ demo. Trình duyệt trả 401 khi không có phiên hợp lệ, 403 khi không đủ quyền hoặc CSRF/origin bị từ chối, 409 khi xung đột nghiệp vụ.

Nguồn nền ở `docs/openapi.yaml`; `scripts/core-api-docs.ts` liệt kê đường dẫn đã đăng ký và ví dụ CORE, đầu ra `docs/core45/openapi-paths.json`. Sau khi thay route, chạy `node --env-file=.env --import tsx scripts/core-api-docs.ts`, rồi dev/build để chuẩn bị tài nguyên Swagger. Không chỉnh tay `apps/web/public/api-docs-assets`.

Phần CORE là tài liệu thao tác/ví dụ, chưa phải mô tả JSON Schema đầy đủ của tất cả phản hồi. Khi xây tích hợp bên ngoài cần hoàn thiện hợp đồng schema. Hướng dẫn kiểm thử bốn vai trò nằm ở [RUN-DEMO.md](core45/RUN-DEMO.md).
