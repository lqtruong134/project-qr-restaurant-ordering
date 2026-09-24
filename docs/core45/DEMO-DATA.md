# Bộ dữ liệu demo

Nhà hàng **Quyết Trường Bistro** là dữ liệu giả định để học và chạy thử. Tên món, giá, định lượng và tồn đầu được biên soạn cho demo; không phải thực đơn hay công thức xác nhận của một nhà hàng thật.

| Nhóm | Dữ liệu có sẵn trên database rỗng |
|---|---|
| Nhân viên | 1 quản trị, 4 phục vụ, 3 bếp; mã đăng nhập riêng |
| Không gian | 3 khu vực; 16 bàn A01–A08, V01–V06, P01–P02 |
| Thực đơn | 6 danh mục, 24 món, giá 29.000–329.000đ |
| Kho | 1 kho bếp, 32 nguyên liệu, đơn vị kg/lít/cái |
| Công thức | Đủ 24 món, mỗi món có định lượng nguyên liệu |
| Tồn đầu | Phiếu nhập DEMO-OPENING-001 đã duyệt và các bút toán nhập tương ứng |
| Bàn/đơn/thanh toán | Ban đầu chưa có khách hay giao dịch giả; phát sinh khi chạy thử |

Hai nhân viên phục vụ và một nhân viên bếp cố ý có cùng họ tên Nguyễn Minh Anh để kiểm tra phân biệt bằng mã `pv001`, `pv002`, `bep003`. Tài khoản quản trị là `quyettruong05`. Mật khẩu không lưu trong tài liệu; lấy từ `SEED_PASSWORD` riêng.

Seed ở `packages/database/src/seed.ts`, dữ liệu ở `demo-data.ts`. Chạy lại chỉ thêm bản ghi thiếu, không khôi phục stock đã tiêu hao, không đổi giá hay mật khẩu hiện có. Một giao dịch seed khóa tránh hai lần khởi tạo chạy đồng thời. Không tạo token QR giả; Admin cấp QR thực sự từ giao diện.

Các kiểm thử kiểm tra đủ 24 món có thể giữ nguyên liệu cho một phần/món mà không phải bổ sung thủ công. Tồn mẫu hữu hạn; vận hành lâu vẫn cần nhập kho như thực tế. Đây không phải dự báo mua hàng hay công thức chuẩn đầu bếp.

## Ảnh minh họa tạm

Sáu ảnh SVG tự tạo trong `apps/web/public/menu/` tương ứng sáu nhóm món. Đây là tranh minh họa, nhiều món cùng nhóm dùng chung ảnh, không giả làm ảnh chụp món thật. Khi có ảnh riêng: đưa vào `public/menu/`, vào quản trị Thực đơn, chỉnh URL ảnh từng món (ví dụ `/menu/com-tam.jpg`). Cũng có thể dùng URL HTTPS. Không cần thay cấu trúc database. Lệnh seed chạy lại không ghi đè ảnh đã sửa.

## Tham khảo cách tổ chức thực đơn

- [Pizza 4P’s — thực đơn](https://pizza4ps.com/vn/menu?lang=vietnamese): phân nhóm món để duyệt dễ hơn.
- [Haidilao — món đặc trưng](https://www.haidilao.com/cate/dish/specialty): nhóm món và mô tả ngắn phục vụ chọn món.

Chỉ tham khảo cách trình bày; không sao chép ảnh, thương hiệu hoặc coi giá demo là giá của các nhà hàng này.
