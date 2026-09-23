# Tình trạng CORE 45 — 23/09/2026

Baseline 84cbbaf; worktree và database riêng, không thay thế bản Sprint 1.

Đã triển khai migration bổ sung 14 → 45 bảng, kiểm thử nâng cấp giữ dữ liệu cũ; khóa ngoại/phạm vi nhà hàng, lịch sử và snapshot tài chính, giao dịch chống xử lý trùng.

- C0: quản trị tài khoản và phân quyền.
- C1: thực đơn, khu vực, bàn, QR, phiên và khách.
- C2: giỏ chung, đặt món, duyệt/bếp/phục vụ/hủy, hỗ trợ, outbox.
- C3: khoản phải thu, thu từng phần và phân bổ, thanh toán thủ công; connector webhook chuẩn hóa riêng.
- C4: chính sách rủi ro, duyệt, hoàn tiền và hồ sơ dư nợ.
- C5: nguyên liệu, công thức, nhập/giữ/tiêu hao kho và snapshot giá vốn.

Giao diện Admin, Staff, Kitchen và Guest đã nối API. Xem RUN-DEMO.md để chạy thử.

Chưa hoàn thành tích hợp cổng thanh toán thật: cần lựa chọn nhà cung cấp và sandbox. Connector hiện tại không được trình bày như tích hợp VNPay/MoMo. Các tính năng EXT/AI ngoài 45 CORE chưa triển khai.

Kiểm chứng gần nhất: check và build đạt; 23 integration test đạt, 6 unit test đạt. Kiểm thử trình duyệt được chạy trên database riêng; xem báo cáo lần chạy cuối để biết kết quả. Không suy ra đủ điều kiện production từ số lượng bảng hay test.
