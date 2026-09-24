# QR Restaurant Ordering

Ứng dụng gọi món bằng QR tại bàn cho **Quyết Trường Bistro** (nhà hàng demo). Một repository thống nhất gồm giao diện Next.js/React, API Fastify/TypeScript và PostgreSQL với **45 bảng nghiệp vụ**. Có bốn không gian: quản trị, phục vụ, bếp và khách.

Đã có gọi món, duyệt đơn, chế biến/phục vụ, hỗ trợ tại bàn, thu tiền và hoàn tiền thủ công, báo cáo, công thức và kho. **AI và tích hợp ngân hàng/cổng thanh toán online chưa triển khai.**

## Chạy trên máy

Môi trường phát triển: Ubuntu/WSL, Node theo `.nvmrc`, pnpm theo `packageManager`, Docker Compose.

```sh
cd ~/projects/qr-ordering-thesis
pnpm install --frozen-lockfile
pnpm run setup
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Mặc định mở **http://localhost:3000**, API ở cổng 4000, PostgreSQL ở 5433. Nếu `.env` đã đổi cổng, dùng `WEB_PORT` tương ứng. Giữ một terminal chạy; Ctrl+C để dừng. Lỗi `EADDRINUSE` nghĩa là cổng đang được chương trình khác dùng, thường do còn một phiên chạy cũ.

`pnpm run setup` tạo `.env` nếu chưa có và giữ các thiết lập đã tồn tại. Mật khẩu seed nằm trong `SEED_PASSWORD` của `.env` riêng. Không đưa `.env`, dump database, cookie hay trace trình duyệt lên Git. Sau khi đổi cấu hình, khởi động lại dịch vụ. `pnpm setup` là lệnh khác, hãy dùng đúng `pnpm run setup`.

| Vai trò | Tên đăng nhập demo |
|---|---|
| Quản trị | `quyettruong05` |
| Phục vụ | `pv001`, `pv002`, `pv003`, `pv004` |
| Bếp | `bep001`, `bep002`, `bep003` |
| Khách | Quét QR, nhập tên; không cần tài khoản nhân viên |

Mỗi nhân viên có mã đăng nhập riêng, kể cả khi trùng họ tên. Để thử nhiều vai trò cùng lúc, dùng hồ sơ trình duyệt riêng; các tab trong cùng hồ sơ chia sẻ cookie. Một tài khoản nội bộ chỉ có một phiên đăng nhập hiện hành.

## Tài liệu cần đọc

1. [Chạy thử bốn vai trò và dùng điện thoại](docs/core45/RUN-DEMO.md).
2. [Cấu trúc và luồng code](docs/code-guide.md), [quy tắc kiến trúc](docs/architecture/README.md).
3. [Dữ liệu mẫu và cách thay ảnh](docs/core45/DEMO-DATA.md).
4. [Phạm vi và giới hạn hiện tại](docs/core45/IMPLEMENTATION.md).
5. [Từ điển database](docs/database/data-dictionary.md), [ERD vật lý](docs/database/physical.svg). Migration là nguồn sự thật.
6. API trực tiếp tại `/api-docs`; nút Execute gửi yêu cầu thật. [Hướng dẫn Swagger](docs/swagger-demo.md).

Các phương án thiết kế cũ ở [docs/archive](docs/archive/README.md); ADR và bằng chứng từng đợt được giữ để phục vụ luận văn, không thay thế tài liệu hiện hành.

## Kiểm tra trước khi chia sẻ code

```sh
pnpm check
pnpm test:coverage
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
pnpm build
pnpm check:secrets
pnpm audit --audit-level=high
pnpm demo:rehearse
```

`check` gồm định dạng, lint, TypeScript và unit test. Coverage chạy kiểm thử backend và integration. Integration/E2E/rehearsal tự tạo database thử riêng rồi dọn; user PostgreSQL phát triển cần quyền CREATE DATABASE. Không dùng tài khoản hoặc database production để chạy test. E2E dùng cổng 13100/14100 và thư mục `.next-e2e`, không dùng seed đang thao tác trên giao diện phát triển. Trace có thể chứa dữ liệu đăng nhập thử nên bị Git bỏ qua.

## Database và seed

SQL migration nằm trong `packages/database/prisma/migrations`. Không sửa migration đã chia sẻ; thêm migration mới. Không dùng `db push` để thay lịch sử migration. `pnpm db:seed:core` là alias tương thích của `pnpm db:seed`, dùng cùng một bộ dữ liệu.

Seed chỉ bổ sung bản ghi thiếu, không đặt lại giá, mật khẩu, phiên bàn hoặc tồn kho đã vận hành. Muốn bắt đầu lại demo, sao lưu và tạo database rỗng riêng rồi migrate/seed; không xóa sổ giao dịch trực tiếp. Volume Docker được giữ khi `pnpm db:down`; không dùng `down -v` để dừng thông thường.

Cài Graphviz và chạy `pnpm docs:database` để cập nhật metadata/ERD. Tệp này không xuất dữ liệu khách hàng hay thông tin đăng nhập.

## Triển khai sau giai đoạn demo

Cần nghiệm thu tại nhà hàng, HTTPS/origin/cookie phù hợp, backup và thử phục hồi, giám sát lỗi và cấu hình môi trường riêng. Rate limiter hiện ở RAM, phù hợp một API instance; nhiều instance cần kho trạng thái chung. Báo cáo là số liệu nghiệp vụ, chưa phải hệ thống hóa đơn điện tử/kế toán. Kết quả test đạt không thay thế kiểm thử vận hành thực tế.
