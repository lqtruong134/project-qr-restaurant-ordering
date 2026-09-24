# Chạy thử nhà hàng — bốn vai trò

Repository duy nhất: `~/projects/qr-ordering-thesis`. Mặc định web `http://localhost:3000`, API `4000`; cấu hình thật lấy từ `.env`. Trong Ubuntu/WSL, chạy `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, rồi `pnpm dev`. Nếu mới tải code, làm các bước cài đặt trong README trước.

## Chuẩn bị

Mở bốn hồ sơ trình duyệt tách biệt cho Admin, Staff, Kitchen, Guest. Admin `quyettruong05`; Staff `pv001`; Kitchen `bep001`. Mật khẩu lấy từ `.env` riêng. Không đăng nhập các vai trò bằng nhiều tab cùng hồ sơ vì cookie dùng chung. Khách không đăng nhập tài khoản nội bộ.

## Một lượt sử dụng đầy đủ

1. **Admin:** vào Bàn & QR, chọn A01, cấp QR mới. Xem QR hiện tại để in lại; chỉ cấp mới khi cần vô hiệu QR cũ. Sao chép liên kết hoặc mở thực đơn trong hồ sơ Guest.
2. **Guest:** nhập tên, chọn món (ví dụ cơm tấm sườn nướng), thêm vào giỏ; thử tăng/giảm số lượng. Chỉ dòng của mình mới được sửa/gửi. Gửi món rồi mở Món đã gọi. Lượt đầu chưa xác minh có thể chờ nhân viên duyệt.
3. **Staff:** xem Sơ đồ bàn và Gọi món; duyệt lượt chờ. **Kitchen:** bếp nhận lượt, bắt đầu chế biến, đánh dấu món xong. **Staff:** xác nhận đã mang ra bàn. Trạng thái bên khách cập nhật qua truy vấn định kỳ.
4. **Guest:** gọi thêm nước/hỗ trợ. **Staff:** tiếp nhận rồi hoàn tất yêu cầu. Hai người không được cùng nhận một yêu cầu mới; lịch sử giữ người xử lý.
5. **Guest:** mở Thanh toán, nhập số tiền muốn trả, chọn tiền mặt hoặc chuyển khoản. **Staff:** mở chi tiết bàn, chỉ xác nhận sau khi thực nhận đủ tiền; chuyển khoản phải có mã tham chiếu. Có thể trả nhiều lần, mỗi lần tạo giao dịch riêng. Hệ thống không tự xác minh tiền vào ngân hàng.
6. **Staff:** kiểm tra còn thiếu bằng 0, không còn tiền cần hoàn/công việc chờ, đóng phiên. Bàn sang chờ dọn; xác nhận dọn xong để nhận khách mới. QR của bàn có thể dùng cho lượt khách sau nếu chưa bị thay hoặc hết hạn.
7. **Admin:** xem doanh số món đã phục vụ, tiền đã thu và kho. Nguyên liệu được giữ lúc gửi món, tiêu hao khi bếp bắt đầu. Giá bán/giá vốn lịch sử giữ snapshot.

## Thử các tình huống bảo vệ dữ liệu

- Đổi giá sau khi đã gửi đơn: đơn cũ giữ giá cũ. Giỏ chưa gửi cần xác nhận lại giá mới.
- Gửi lại cùng yêu cầu: không tạo hai đơn/hai giao dịch. Giỏ bị người khác sửa thì cần tải lại phiên bản mới.
- Tắt danh mục: khách không thấy món mới của danh mục; dòng cũ trong giỏ không thể gửi tiếp.
- Tắt khu vực: không nhận khách mới qua QR, phiên đang phục vụ vẫn hiện cho Staff xử lý nốt.
- Hủy trước khi bếp làm: giải phóng phần nguyên liệu giữ. Đơn đã thu tiền có thể phát sinh hồ sơ hoàn, phải xử lý trước khi đóng phiên.
- Ngừng tài khoản nhân viên: phiên cũ mất quyền sử dụng. Mã đăng nhập duy nhất, họ tên được phép trùng.
- Thử vai trò bếp vào quản trị: API phải từ chối; ẩn nút trên giao diện không thay kiểm tra quyền.

## Thử bằng điện thoại

Máy tính và điện thoại phải cùng mạng Wi-Fi. `localhost` trên điện thoại là chính điện thoại, không phải máy tính.

Trong Ubuntu/WSL, đặt IP LAN của máy tính (thay ví dụ bằng IP thật):

```sh
LAN_HOST=192.168.1.10 pnpm dev:lan
```

Mở `http://192.168.1.10:3000` trên điện thoại. Mở trang Admin bằng **cùng địa chỉ LAN** để QR chứa đúng địa chỉ điện thoại truy cập được. Nếu dùng WSL ở chế độ NAT, cần chuyển tiếp cổng web từ Windows vào WSL và cho phép cổng này trong mạng riêng của Windows Firewall; lệnh trên chỉ cấu hình ứng dụng, không tự sửa firewall. Không cần mở cổng database/API ra LAN. IP WSL có thể đổi sau khi khởi động lại.

Trên máy tính vẫn thử được đầy đủ luồng nghiệp vụ. Chế độ điện thoại trong công cụ trình duyệt và test tự động kiểm tra bố cục; camera, Wi-Fi, bàn phím và cảm giác chạm cần kiểm tra thêm trên điện thoại thật.

## Phạm vi

AI và cổng ngân hàng trực tuyến để giai đoạn sau. Connector webhook hiện là nền kỹ thuật, mặc định chưa bật và không được coi là đã tích hợp nhà cung cấp. Ảnh là minh họa demo. Báo cáo hiển thị toàn bộ lịch sử đang lưu, không tự giới hạn hôm nay.
