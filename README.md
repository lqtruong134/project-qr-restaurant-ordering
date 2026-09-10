# QR Restaurant Ordering — luận văn

Sprint 1: môi trường Next.js + Fastify + PostgreSQL, schema 14 bảng C0/C1,
đăng nhập Staff/Kitchen/Admin, kiểm thử quyền và gói demo ERD.
Guest QR, gọi món, POS/KDS nghiệp vụ, thanh toán, kho và AI thuộc các Sprint sau.

## Khởi động trong Ubuntu / WSL

Yêu cầu Node theo `.nvmrc` (24.21.0), pnpm theo `packageManager` (12.3.4), Docker Compose.
Chạy trong thư mục repository:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Mở http://localhost:3000/login. Dùng `staff`, `kitchen` hoặc `admin` và giá trị
`SEED_PASSWORD` trong `.env` riêng trên máy. Không commit, chụp ảnh hoặc đưa mật khẩu
vào báo cáo. `pnpm run setup` giữ cấu hình đã có và chỉ thêm secret còn thiếu.
Phải dùng `pnpm run setup`; `pnpm setup` là lệnh khác của pnpm.
Sau khi sửa `.env`, khởi động lại `pnpm dev`.

Docker dự án dùng cổng **5433**, database `thesis_dev`, user `thesis`; mật khẩu lấy
từ `.env`. DBeaver kết nối localhost:5433. Container `my-postgres` cổng 5432 cũ là
môi trường riêng, không chứa schema mới này. Volume dự án được giữ khi `pnpm db:down`.

## Sprint Review theo thứ tự

1. Chạy các lệnh khởi động ở trên; kiểm tra trang chủ có “Môi trường đã sẵn sàng”.
2. Mở [ERD vật lý 14 bảng](docs/database/physical.svg), [Data Dictionary](docs/database/data-dictionary.md).
3. Phân biệt với [ERD logic đích 72 thực thể](docs/database/logical-target.md): chỉ 14 bảng đã triển khai.
4. Đăng nhập lần lượt `staff`, `kitchen`, `admin`; mỗi vai trò vào trang của mình rồi đăng xuất.
5. Với Staff, nhập `/workspace/admin`: màn hình báo không có quyền và API trả 403.
6. Chạy `pnpm test:integration` để chứng minh 401/403, refresh rotation, logout,
   khóa tài khoản/đổi password, CSRF, rate limit, FK/unique/check và concurrency.
7. Chạy `pnpm demo:rehearse`: tự tạo DB rỗng riêng hai lần, migrate, seed hai lần,
   query và kiểm tra ba vai trò; không sửa DB bằng tay. Database tạm được dọn sau chạy.
8. Đọc [log rehearsal](docs/evidence/rehearsal.md), [bằng chứng Sprint](docs/evidence/sprint1.md),
   xác nhận nghiệm thu trước khi đánh dấu Done/Đạt DoD trên Notion.

## Kiểm tra chất lượng

```sh
pnpm check
pnpm test:integration
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
pnpm audit --audit-level=high
pnpm check:secrets
pnpm demo:rehearse
```

Integration/rehearsal sử dụng DB riêng cùng PostgreSQL; user phát triển cần quyền
CREATE DATABASE. Không chạy bằng user production. Browser test dùng account demo
ở DB phát triển, đăng nhập mới thu hồi phiên cùng account; tránh demo đồng thời.
Không chia sẻ Playwright trace vì có thể chứa credential kiểm thử. Chỉ xuất PNG
màn hình không có mật khẩu. Test-results/trace/.env/.runtime đều được Git bỏ qua.

## Schema và phục hồi

- Migration là nguồn sự thật, chỉ thêm migration mới sau khi đã chia sẻ; không dùng `db push`.
- Prisma biểu diễn quan hệ lịch sử 1:N. Partial unique/check/trigger nằm trong SQL;
  không chạy `db pull` rồi ghi đè schema vì partial unique có thể bị suy luận thành 1:1.
- Initial migration tạo đúng 14 bảng; `_prisma_migrations` chỉ là metadata công cụ.
- Trước migration mới, tạo backup: `docker compose exec -T postgres pg_dump -U thesis -d thesis_dev -Fc > .runtime/pre-migration.dump`
  (tạo thư mục `.runtime` trước). Backup chứa dữ liệu riêng, không đưa Git.
- Phục hồi sang DB mới bằng `createdb` và `pg_restore --no-owner --exit-on-error` trong
  container; đổi DATABASE_URL sang DB đã phục hồi, kiểm tra trước khi sử dụng.
- Ưu tiên forward-fix hoặc rollback ứng dụng tương thích schema; không rollback bằng
  DROP TABLE hoặc `docker compose down -v`. Migration đầu chạy transaction nên lỗi
  SQL rollback toàn bộ; Prisma resolve chỉ sau khi xác minh trạng thái database.
- Sinh lại docs: cài Graphviz (`sudo apt install graphviz`), chạy `pnpm docs:database`.

## Quyết định và giới hạn đã biết

[ADR 002](docs/adr/002-sprint1-data-auth.md) mô tả auth và schema.
Mỗi account có một phiên nội bộ; access 15 phút, refresh tối đa 7 ngày và rotate.
Rate limiter RAM dùng một API instance cho local/demo; nhiều instance cần shared limiter.
Cookie Secure ở production; deployment công khai cần HTTPS và cấu hình origin/CSP phù hợp.
Không tự nhận đã nghiệm thu production hoặc đã triển khai 72 bảng.
Role workspace là quyền vào phân hệ để chứng minh RBAC C0; quyền hành động nghiệp vụ
chi tiết sẽ được bổ sung cùng endpoint ở các Sprint sau.
`financial_status`/`risk_status` chưa tạo vì chưa có chức năng C3/C4 trong Sprint 1.
Secret seed chỉ tạo account mới; chạy seed lại không đổi mật khẩu hoặc đặt lại dữ liệu.

Thư viện bắc cầu được khóa bản vá trong pnpm overrides (deepmerge-ts 8.0.0,
mysql2 3.23.1) theo advisory; kiểm thử migration và runtime sau cập nhật.
[Deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
[MySQL2 advisory](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).

API contract: [OpenAPI](docs/openapi.yaml). CI chạy lint/typecheck/unit,
migration/seed, integration, build, browser test, audit và rehearsal.

## Demo API bằng Swagger UI

Mở http://localhost:3000/api-docs sau khi chạy `pnpm dev`. Không cần Postman.
Xem [hướng dẫn demo từng bước](docs/swagger-demo.md). Trang dùng cookie cùng nguồn
và tự gửi header chống CSRF. Tài nguyên Swagger được sinh trước dev/build, không dùng CDN.
