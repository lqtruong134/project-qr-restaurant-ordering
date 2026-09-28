# Kiểm chứng chấm công và kho — 28/09/2026

Nền mã nguồn 36b422d; thay đổi trong commit chứa tài liệu này.

- Check: định dạng, ESLint, TypeScript và 12 unit test đạt.
- 43 integration test đạt trong đợt coverage; lines 85,67%, branches 73,78%.
- Bộ trình duyệt đầy đủ trước bổ sung ca kho: 17 đạt, 1 bỏ qua theo cấu hình.
- Bộ core45 sau bổ sung ca kho và sửa bộ chọn combobox: 6 đạt trên desktop/mobile/WebKit. Đã thử xuất hủy qua giao diện và nhìn thấy lý do trên sổ.
- Build production đạt; kiểm tra secret cơ bản đạt, không phải kiểm toán bảo mật đầy đủ.
- Database hiện tại được sao lưu archive và kiểm tra danh mục archive trước khi áp dụng 202609280001_stock_adjustment_trace. Không reset/seed lại dữ liệu đang vận hành. Vẫn 55 bảng.

Regression mới: tính gợi ý ca qua đêm, loại giờ ngoài ca khỏi gợi ý, xác nhận giờ ngoại lệ kèm audit và giữ giờ gốc; điều chỉnh kho chống lặp, chặn phiên bản cũ, chặn giảm dưới phần đang giữ, hai thao tác đồng thời chỉ một thao tác được ghi.

Điện thoại vật lý và quy trình thực tế vẫn cần chủ dự án nghiệm thu; các giới hạn hiện tại được ghi trong [tài liệu nghiệp vụ](../attendance-and-inventory.md).
