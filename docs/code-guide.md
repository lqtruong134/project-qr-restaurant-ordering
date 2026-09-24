# Đọc code theo chức năng

Đọc README để chạy ứng dụng trước. Dự án hiện thống nhất 53 bảng; những tên test có `sprint1` vẫn giữ để bảo vệ phần nền cũ, không có một ứng dụng Sprint 1 độc lập.

## Cây thư mục

| Nơi | Nhiệm vụ |
|---|---|
| `apps/web/app` | URL, layout, trang đăng nhập, trang khách và ghép không gian theo vai trò |
| `apps/web/features/admin` | Tổng quan, thực đơn/bàn/QR; các panel riêng cho kho, nhân viên, rủi ro và báo cáo |
| `apps/web/features/workspace` | Màn hình phục vụ/bếp, thẻ lượt gọi, chi tiết thanh toán bàn |
| `apps/web/features/guest` | Thực đơn, giỏ cá nhân trong phiên bàn, món đã gọi, hỗ trợ và yêu cầu thanh toán |
| `apps/web/features/shared` | Form, nút thao tác, hộp thoại, tìm kiếm và định dạng hiển thị |
| `apps/web/lib` | Gửi API, cookie, CSRF và làm mới phiên nội bộ |
| `apps/web/styles` | Phông Arial, thang cỡ chữ, màu, bố cục desktop/mobile và bản in |
| `apps/web/public/menu` | Ảnh món minh họa có thể thay sau |
| `apps/api/src/modules` | Các nghiệp vụ chia theo miền, xem tài liệu kiến trúc |
| `packages/database` | Prisma, pool PostgreSQL, migration, dữ liệu seed |
| `packages/contracts`, `ui`, `config` | Kiểu/hợp đồng, thành phần giao diện, cấu hình chung |
| `scripts` | Khởi động, database, tài liệu và điều phối kiểm thử |
| `tests` | Kiểm thử tích hợp và trình duyệt; giữ lại để bảo vệ khi phát triển AI/thanh toán |
| `docs` | Hướng dẫn hiện hành, thiết kế vật lý, quyết định kiến trúc và bằng chứng |

## Luồng đăng nhập

`app/login/page.tsx` nhận dữ liệu → `lib/api-client.ts` gửi `/api/auth/login` → `next.config.ts` chuyển tiếp tới Fastify → `modules/auth/index.ts` kiểm tra dữ liệu/tài khoản/mật khẩu và tạo cookie → `app/workspace/[area]/page.tsx` chọn feature đúng vai trò. Backend kiểm tra lại quyền mỗi yêu cầu; sửa URL không tạo thêm quyền.

`server.ts` là điểm lắp ứng dụng; `app.ts` tạo Fastify, health check và xử lý lỗi chung. `auth.ts` là đầu vào tương thích gọi module auth và route workspace, không phải hệ thống đăng nhập thứ hai.

## Luồng khách gọi món

1. `features/guest/guest.tsx` đọc QR và gửi tên khách; `sessions/guest.routes.ts` kiểm tra QR, bàn, khu vực và tạo/tham gia phiên.
2. Khách thêm/sửa giỏ: backend kiểm tra chủ dòng, phiên bản giỏ, trạng thái món và danh mục.
3. Gửi món: `orders/orders.service.ts` dùng cùng transaction để khóa phiên, chụp tên/giá, chống trùng, đánh giá rủi ro và gọi `inventory/inventory.service.ts` giữ nguyên liệu.
4. `orders/orders.routes.ts` xử lý duyệt/nhận bếp/chế biến/phục vụ. `cancellation.service.ts` xử lý hủy, giải phóng nguyên liệu, khoản thu liên quan.
5. `payments/payments.routes.ts` xử lý thu/hoàn thủ công; `finance/ledger.service.ts` tính các khoản tiền. Ghi khoản phải thu và phân bổ đảm bảo giữ lịch sử.
6. `dining/dining.routes.ts` kiểm tra điều kiện đóng phiên/dọn bàn. `notifications/maintenance.ts` xử lý hết hạn và outbox.

Không cần đọc từng dòng ngay. Theo một thao tác từ component → route → service → SQL rồi xem test tương ứng. Đọc [kiến trúc](architecture/README.md) để biết chỗ thêm chức năng.

## File viết tay và file tự sinh

Code trong `src`, `features`, `app`, migration SQL, seed và test là nguồn cần giữ. `node_modules`, `.next`, `.next-e2e`, `coverage`, `test-results`, Prisma client và `public/api-docs-assets` là kết quả cài đặt/build/test, không chỉnh tay hoặc commit. `next-env.d.ts` do Next sinh để khai báo kiểu, được Git bỏ qua vì đường dẫn kiểu có thể đổi giữa dev/build/test. `pnpm-lock.yaml` do công cụ cập nhật nhưng cần Git lưu để cài đúng phiên bản.

`docs/openapi.yaml` và script `scripts/core-api-docs.ts` là nguồn tài liệu API. `apps/web/scripts/prepare-docs.mjs` chuẩn bị bản phục vụ Swagger trước dev/build. Muốn sửa mô tả API, sửa nguồn, không sửa bản trong public.
