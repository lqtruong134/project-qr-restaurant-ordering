# ADR-001 — Nền tảng local Sprint 1

Ngày: 09/09/2026. Phạm vi: EN-C0-01.

- Modular monolith; Next.js sở hữu giao diện, Fastify sở hữu API nghiệp vụ.
- Mã nguồn đặt trong filesystem Ubuntu; Node 24, pnpm 12.3.4 được khóa theo môi trường đã cài.
- PostgreSQL 18.6 theo SRS/Roadmap, dùng Compose riêng cổng 5433 vì my-postgres chiếm 5432.
- Volume cũ và dữ liệu DBeaver hiện có không bị thay đổi.
- pnpm setup sinh mật khẩu local ngẫu nhiên, .env không được commit.
- Chỉ cấu hình database/Prisma ở item này; không dựng schema tương lai.
- Trang nền tảng đọc readiness thật qua server Next.js; không có API nghiệp vụ trong Next.js.
- CI đã có workflow; kết quả GitHub chỉ được xác nhận sau khi có remote và workflow chạy thực tế.
- Thiết kế refresh rotation/revocation trong 6 bảng C0 cần được ghi ở ADR tiếp theo trước EN-C0-02.
