# Sprint 1 — gói nghiệm thu kỹ thuật

Ngày kiểm tra: 2026-09-10. Phạm vi: EN-C0-01, EN-C0-02, US-C0-01, EN-C0-03.
Trạng thái: kiểm thử kỹ thuật đạt, chờ Product Owner nghiệm thu.

| Kiểm tra | Kết quả |
|---|---|
| Lint + typecheck | PASS |
| Unit + integration trên PostgreSQL thật | 16/16 PASS |
| E2E Chromium desktop 1440px và mobile 390px | 4/4 PASS |
| Production build Next.js | PASS |
| Migrate từ rỗng, seed lặp, role allow/deny | 2/2 rehearsal PASS |
| pnpm audit, toàn bộ lockfile | Không có lỗ hổng được báo cáo |
| Secret scan + git diff check | PASS |
| Coverage app.ts / auth.ts / config.ts | Lines 96.29%; branches 86.27% |

Coverage không tính bootstrap server.ts, Prisma generated code hoặc frontend.
Coverage là bằng chứng bổ sung; không khẳng định đã kiểm thử mọi nhánh hay bảo mật tuyệt đối.

## Truy vết nghiệm thu

- EN-C0-02: `packages/database/prisma/migrations/202609100001_c0_c1/migration.sql`,
  `docs/database/physical.svg`, `data-dictionary.md`; test đủ 14 bảng, FK/RESTRICT,
  unique mã món, tenant isolation, tiền không âm, một cart/session,
  một QR ACTIVE/bàn, một session chưa đóng/bàn, một role hoạt động/user.
- US-C0-01: `tests/sprint1.integration.test.ts`; 3 vai trò × 3 endpoint,
  401/403, default-deny route mới, CSRF, validation, generic login error,
  5 login/phút theo account và IP, refresh rotation/concurrency, logout,
  access 15 phút và refresh 7 ngày, login mới thu hồi phiên cũ,
  khóa/đổi mật khẩu/thu hồi role có hiệu lực ngay, Secure cookie production.
- EN-C0-03: seed idempotent 14 bảng, Argon2id account, ERD physical và logical target,
  dictionary sinh từ PostgreSQL, OpenAPI, README demo, `rehearsal.md` gồm hai lượt sạch.

## Phạm vi và giới hạn cần PO chấp nhận

- Sprint 1 cung cấp đăng nhập/RBAC và dữ liệu C1; chưa có luồng Guest QR, đặt món,
  POS/KDS nghiệp vụ, thanh toán, kho hoặc AI.
- Chỉ 14 bảng đã triển khai; 72 bảng là đích logic, không phải database hiện hành.
- Một phiên đăng nhập nội bộ/account; login mới thay phiên cũ. Rate limiter RAM
  dành cho demo một instance. `.env` và mật khẩu chỉ ở máy local.
- Chromium desktop/mobile đã test; Edge/Firefox/Safari và tải production chưa được chứng nhận.
- Quyền hiện tại là quyền vào workspace; quyền nghiệp vụ được bổ sung cùng Sprint sau.
- Chưa đánh dấu Đạt DoD cho phần mới trước khi PO xem demo và chấp nhận.
