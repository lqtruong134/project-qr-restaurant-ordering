# Thiết kế lịch sử

Các tệp trong `design/` là phương án thiết kế ban đầu phục vụ luận văn, không phải cấu trúc database hiện hành. Có cả mô hình mở rộng ngoài 45 CORE. Không dùng chúng để tạo bảng hoặc suy ra chức năng đã có.

Nguồn triển khai là `packages/database/prisma/migrations/`; tài liệu vật lý hiện hành ở `docs/database/data-dictionary.md` và `physical.svg`, sinh lại bằng `pnpm docs:database`. ADR và bằng chứng từng đợt ở `docs/adr/`, `docs/evidence/` được giữ để truy vết quyết định.
