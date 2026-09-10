# project-qr-restaurant-ordering

QR Ordering — luận văn

## Phạm vi hiện tại

EN-C0-01: pnpm monorepo, web Next.js, API Fastify và PostgreSQL local.
Chưa triển khai schema 14 bảng, auth, QR Guest, Order, Payment, Inventory hoặc AI.

## Môi trường

Windows: Docker Desktop đang chạy, WSL Integration bật cho Ubuntu; VS Code và DBeaver.
Thực hiện các lệnh dưới đây trong **Ubuntu**, ở thư mục dự án.
Node 24.21.0 (`nvm install` và `nvm use` nếu dùng nvm), pnpm 12.3.4 (`npm install -g pnpm@12.3.4`), Git và Docker Compose.
Không dùng chung node_modules giữa Windows và Ubuntu.

## Cài và chạy từ đầu

```bash
cd ~/projects/qr-ordering-thesis
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm db:check
pnpm check
pnpm test:integration
pnpm dev
```

Mở http://localhost:3000. API: http://localhost:4000/health/live và /health/ready.
Health live chỉ kiểm tra API còn hoạt động; ready trả 503 nếu database mất kết nối.
Trang chủ là trang kiểm tra nền tảng Sprint 1, chưa phải giao diện gọi món.
`Ctrl+C` dừng web/API. `pnpm db:down` dừng container nhưng giữ volume.
Chạy lại: `pnpm db:up && pnpm dev`. Nếu đổi cổng, sửa `.env` và chạy lại tiến trình.

## PostgreSQL và DBeaver

Kết nối mới: host localhost, port 5433, database thesis_dev, username thesis.
Password được sinh ngẫu nhiên trong `.env` khi chạy `pnpm setup`; chỉ xem trên máy của bạn.
Giữ nguyên kết nối cũ cổng 5432. Dự án không sử dụng hay xóa container my-postgres.
Compose tự đặt volume có tên theo project (`qr-ordering-thesis_postgres_data`).
Image PostgreSQL 18.6 được khóa bằng digest, có healthcheck và chỉ công bố cổng trên loopback.
Không chạy `docker compose down -v` nếu muốn giữ dữ liệu.
Sau khi đổi mật khẩu `.env`, database có volume cũ không tự đổi mật khẩu; cần thao tác quản trị có kế hoạch.

## Kiểm tra và build

```bash
pnpm check             # lint + TypeScript strict + unit tests
pnpm test:integration  # SELECT 1 và readiness trên PostgreSQL thật
pnpm check:secrets     # kiểm tra cơ bản các file Git, không in secret
pnpm build            # build giao diện production
```

CI trên GitHub chạy các bước trên khi repository được push. Chưa có remote thì chỉ đã kiểm chứng local.

## Migration và seed

`packages/database/prisma/schema.prisma` hiện chỉ có cấu hình kết nối/generator.
`pnpm db:migrate` và `pnpm db:seed` trả thông báo chưa triển khai thay vì giả báo thành công.
EN-C0-02 sẽ tạo đúng 14 bảng C0–C1 cùng migration. EN-C0-03 hoàn thiện seed/Dictionary/demo.
Chưa sinh Prisma Client ở EN-C0-01 vì chưa có model. Truy vấn kiểm tra kết nối hiện dùng pg.

## Cấu trúc

- apps/web: Next.js App Router, Tailwind, trang trạng thái.
- apps/api: Fastify; health endpoints, lỗi an toàn, graceful shutdown.
- packages/database: kết nối PostgreSQL và cấu hình Prisma.
- packages/contracts: type dùng chung.
- packages/ui: thành phần giao diện dùng chung.
- packages/config: TypeScript strict dùng chung.
- docs: quyết định kỹ thuật, minh chứng và hướng dẫn.

## Git

Remote: https://github.com/lqtruong134/project-qr-restaurant-ordering.git
Tác giả Git đã được cấu hình theo thông tin chủ dự án cung cấp. Xác thực push do Git Credential Manager quản lý.
Đặt `git config user.name` và `git config user.email` chỉ tại repository này.
Kiểm tra `git status`, `git diff --cached`, và `pnpm check:secrets` trước commit.
Không commit `.env`, token, mật khẩu hoặc log có credential.

## Nguồn yêu cầu

- [Sprint 1](https://www.notion.so/3cf731aa9a6b81d8a067dbef4c73e213)
- [EN-C0-01](https://www.notion.so/3cf731aa9a6b813fb99bc6541cf31a01)
- [SRS](https://www.notion.so/3ce731aa9a6b80d485a4d33bfb68dc91)

## Kiểm tra bằng trình duyệt

Lần đầu: `pnpm exec playwright install --with-deps chromium` (có thể cần quyền sudo).
Sau `pnpm db:up`: chạy `pnpm test:e2e`. Test tự chạy web/API nếu chưa có.
Kiểm tra desktop/mobile, trạng thái kết nối thật, tràn ngang và lỗi JavaScript.
Ảnh/log trong test-results không đưa vào Git vì có thể chứa dữ liệu của lần test sau.
