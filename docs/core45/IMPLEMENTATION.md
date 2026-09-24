# Phạm vi triển khai hiện tại — 24/09/2026

Một repository `qr-ordering-thesis`, nhánh `main`; không còn hai ứng dụng Sprint 1/CORE độc lập. Các migration bổ sung nâng schema nền 14 bảng lên 45 bảng và giữ kiểm thử nâng cấp dữ liệu cũ.

| Nhóm | Chức năng hiện có |
|---|---|
| Tài khoản | Đăng nhập, refresh/logout, quyền ba vai trò nội bộ, quản lý nhân viên, thu hồi phiên khi khóa tài khoản |
| Bàn và thực đơn | Danh mục/món, giá/ảnh/trạng thái bán, khu vực/bàn, cấp và in lại QR, khách tham gia phiên |
| Gọi món | Giỏ theo người tham gia, phiên bản giỏ, chống gửi trùng, duyệt/nhận bếp/chế biến/phục vụ/hủy |
| Hỗ trợ | Gửi yêu cầu, một người tiếp nhận, hoàn tất; cảnh báo phiên |
| Tài chính | Khoản phải thu, snapshot, thu từng phần, phân bổ tiền, hoàn thủ công, hồ sơ thiếu tiền, báo cáo toàn bộ lịch sử |
| Rủi ro | Ngưỡng cấu hình, đánh giá lúc gửi, duyệt/từ chối, hết hạn chờ |
| Kho | Đơn vị/nguyên liệu, công thức theo phiên bản, nhập kho, giữ/giải phóng/tiêu hao, snapshot giá vốn |

Giao diện Guest/Staff/Kitchen/Admin gọi cùng API và database. Các màn vận hành truy vấn định kỳ; chưa dùng WebSocket. Seed mới có 16 bàn, 24 món đủ công thức, 32 nguyên liệu với tồn đầu có phiếu nhập và 8 tài khoản; xem [DEMO-DATA.md](DEMO-DATA.md).

## Chưa nằm trong đợt này

- AI, gợi ý thông minh và chức năng mở rộng ngoài CORE.
- Ngân hàng/cổng thanh toán trực tuyến: tiền mặt/chuyển khoản hiện phải nhân viên xác nhận. Connector HMAC có kiểm thử nhưng chưa tích hợp nhà cung cấp và mặc định chưa bật.
- Hóa đơn điện tử, kế toán đầy đủ, quản lý lô/hạn sử dụng, kiểm kê và chuyển kho toàn diện.
- Cam kết vận hành thương mại: cần kiểm tra trên điện thoại thật, nghiệm thu nhà hàng và chuẩn bị triển khai/giám sát/sao lưu.

Kiểm chứng đợt rà soát ở [bằng chứng kiểm thử](../evidence/review-2026-09-24.md). Không suy ra chất lượng từ số lượng bảng; các trường hợp nghiệp vụ được kiểm tra bằng test và dùng thử.
