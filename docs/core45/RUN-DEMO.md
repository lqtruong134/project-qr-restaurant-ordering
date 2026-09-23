# Hướng dẫn chạy thử CORE 45

Bản hợp nhất dùng tại `~/projects/qr-ordering-thesis`, nhánh `main`. Các chức năng Sprint 1
và CORE45 dùng chung một lịch sử Git; database phát triển hiện tại được giữ nguyên.

## Mở chương trình

Trong terminal Ubuntu/WSL:

```sh
cd ~/projects/qr-ordering-thesis
pnpm dev
```

Mở http://127.0.0.1:3100. API chạy cổng 4100. Giữ terminal chạy; Ctrl+C để dừng. Nếu cổng đang dùng, kiểm tra cửa sổ chạy trước, không mở thêm một bản nữa.

Nếu PostgreSQL chưa chạy: `pnpm db:up`. Khi cập nhật mã nguồn: `pnpm db:migrate`. Dữ liệu mẫu CORE: `pnpm db:seed:core` (không dùng để xóa lịch sử).

Tài khoản mẫu: `admin`, `staff`, `kitchen`; mật khẩu là SEED_PASSWORD trong .env riêng của bản này. Không chép .env vào báo cáo hoặc Git. Dùng các hồ sơ trình duyệt riêng cho từng vai trò vì cookie dùng chung giữa các tab trong cùng hồ sơ. Khách không cần tài khoản nhân viên.

## Thử một lượt phục vụ

1. Admin đăng nhập, chọn Bàn & QR, cấp QR mới và mở liên kết thực đơn. Mỗi lần cấp mới làm QR cũ mất hiệu lực.
2. Mở liên kết trong hồ sơ trình duyệt của khách, nhập tên, thêm món vào giỏ, gửi lượt gọi. Đơn đầu của phiên chưa xác minh có thể cần nhân viên duyệt.
3. Staff chọn bàn, kiểm tra và duyệt yêu cầu đang chờ. Kitchen nhận lượt gọi, chuyển món sang đang làm rồi sẵn sàng. Staff xác nhận phục vụ.
4. Khách gửi yêu cầu thanh toán tiền mặt/chuyển khoản. Staff chỉ xác nhận khi đã thực nhận tiền; có thể thu nhiều lần. Số tiền được phân bổ vào từng khoản phải thu.
5. Khi hết khoản chưa thanh toán và các công việc chờ, Staff đóng phiên rồi xác nhận dọn bàn.
6. Admin xem doanh thu, nguyên liệu và tồn kho. Khi bếp bắt đầu làm, nguyên liệu được tiêu hao theo công thức và giá vốn được lưu lại.

## Các tình huống khác

- Khách gọi hỗ trợ; Staff tiếp nhận rồi hoàn tất để tránh nhiều người xử lý cùng yêu cầu.
- Khách được rút lượt của mình trước khi bếp nhận. Hủy sau khi đã thu tiền tạo số tiền cần hoàn; nhân viên xử lý hoàn tiền và lưu xác nhận.
- Admin đổi giá món; đơn đã gửi vẫn giữ tên và giá chụp tại thời điểm đặt.
- Admin quản lý nhân viên, thực đơn, khu vực/bàn, công thức, nhập kho và chính sách duyệt đơn. Có thể thử yêu cầu số lượng lớn để thấy bước duyệt hoặc từ chối.
- Phiên trống chưa xác minh quá hạn và các yêu cầu duyệt/thanh toán quá hạn được tác vụ nền xử lý.

## Giới hạn cần hiểu

Đây là bản chạy thử nghiệp vụ CORE trên máy. Tiền mặt và chuyển khoản là xác nhận thủ công, không tự đối soát ngân hàng. Connector webhook có kiểm tra chữ ký, chống lặp và kiểm thử nhưng chưa phải tích hợp VNPay/MoMo hay cổng cụ thể; cần chọn nhà cung cấp và cấu hình sandbox trước khi bật thanh toán trực tuyến.

Kho hiện hỗ trợ công thức, nhập kho, giữ nguyên liệu, tiêu hao và giá vốn; các phần mở rộng như lô hàng, đổi đơn vị, nhà cung cấp và kiểm kê đầy đủ chưa thuộc bản này. Thông báo giao diện được cập nhật bằng truy vấn định kỳ. Không đưa bản thử nghiệm ra Internet trước khi cấu hình triển khai và kiểm tra vận hành thực tế.

## Tài liệu và kiểm tra

- `/api-docs`: API nền và 66 thao tác CORE; ví dụ là dữ liệu minh họa, nút Execute gọi thật.
- `pnpm check`: định dạng, kiểm tra code/kiểu và unit test.
- `pnpm test:integration`: database thử riêng, kiểm tra nâng cấp và các luồng nghiệp vụ.
- `pnpm test:e2e`: database riêng tự tạo/xóa, thử trình duyệt desktop/mobile.
- `pnpm build`: kiểm tra đóng gói web.

45 bảng là mô hình đã triển khai; mức sẵn sàng triển khai thực tế còn phụ thuộc cấu hình thanh toán, sao lưu, giám sát và nghiệm thu tại nhà hàng.
