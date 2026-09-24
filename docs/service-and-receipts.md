# Phục vụ, phiếu thanh toán và nhân sự

## Phục vụ trên điện thoại và máy tính

- Sơ đồ bàn gom bàn theo khu vực; tìm theo tên/mã và lọc bàn cần xử lý, đang phục vụ, trống hoặc chờ dọn.
- Mỗi bàn hiển thị việc đang chờ: xác minh khách, duyệt món, mang món ra, hỗ trợ, yêu cầu thu tiền và cảnh báo.
- Mở chi tiết bàn để xử lý món, tiếp nhận hỗ trợ, thanh toán, hoàn tiền, chuyển bàn và đóng phiên. Mục Việc cần làm cho phép nhận/xử lý hỗ trợ trực tiếp; yêu cầu đã được đồng nghiệp nhận hiển thị tên và mã tài khoản.
- Dữ liệu tự cập nhật khoảng 3 giây khi trang đang hiển thị. Nút Bật âm báo cần được người dùng bấm trước. Đây chưa phải thông báo đẩy khi khóa máy/đóng ứng dụng. Lỗi kết nối được báo trên màn hình, không giả báo dữ liệu mới.
- Điện thoại dùng thanh điều hướng dưới; quản trị có menu thu gọn, tự thu sau khi chọn mục trên màn hình nhỏ.

## Thu tiền và phiếu

Khách gửi yêu cầu thu tiền; nhân viên chỉ xác nhận khi thực sự đã nhận. Với tiền mặt, nhập số tiền khách đưa: hệ thống ghi nhận đúng số phải thu và tính tiền trả lại, không coi tiền thừa là doanh thu. Chuyển khoản hiện là xác nhận thủ công, chưa tích hợp ngân hàng/webhook thật.

Phiếu gồm tên/địa chỉ nhà hàng, mã phiếu, bàn, giờ vào, giờ ra, thời điểm chốt, nhân viên chốt; từng món/khoản thu có số lượng, đơn giá và thành tiền; tổng phải trả, đã thu, còn thiếu/cần hoàn, các lần thanh toán và tiền thừa. Bố cục tham khảo mẫu in nhà hàng tại https://tanhoamai.com.vn/mau-hoa-don-ban-le-nha-hang-an-uong/; không tự thêm VAT hoặc thông tin pháp lý chưa cấu hình.

Trước khi đóng phiên là phiếu tạm tính. Khi đóng hợp lệ, database lưu snapshot phiếu cùng số phiếu duy nhất. Đổi giá món, tên nhà hàng hoặc nhân viên sau đó không đổi phiếu đã chốt. Mục Phiếu đã chốt cho phép xem/in lại; bản in chỉ chứa phiếu, không chứa nút thao tác. Phiếu nội bộ này không phải hóa đơn điện tử thuế. Phiên đóng trước khi nâng cấp chưa có snapshot nên không thể khôi phục chính xác những thông tin đã thay đổi trong quá khứ.

Món bếp báo không thể phục vụ sẽ trả phần giữ nguyên liệu và đảo khoản thu liên quan. Nếu đã thu tiền, hệ thống báo cần hoàn và không cho đóng khi chưa xử lý xong. Lịch sử món/thu/hoàn vẫn được giữ.

## Chuyển bàn

Chuyển toàn bộ phiên sang bàn trống cùng nhà hàng, kiểm tra sức chứa và chống hai nhân viên cùng chiếm một bàn. Giữ phiên, người tham gia, giỏ hàng, món và các giao dịch; bàn cũ chờ dọn, bàn mới đang phục vụ. Lưu người chuyển, giờ chuyển, bàn cũ/mới và lý do. Chưa hỗ trợ gộp/tách phiên giữa hai bàn có khách.

## Ca làm, chấm công, lương

Quản trị tạo ca theo ngày giờ, phân công nhân viên phục vụ/bếp và đặt đơn giá giờ có hiệu lực. Không cho phân ca chồng thời gian. Nhân viên tự ghi vào/ra; quản trị duyệt số phút được trả sau khi ca kết thúc và ghi lý do. Đơn giá tại đầu ca được chụp lại khi duyệt công.

Quản trị lập kỳ lương, kiểm tra công, thêm thưởng/khấu trừ rồi chốt. Bản chốt không sửa trực tiếp; nhân viên chỉ xem phiếu lương của mình đã chốt. Đánh dấu đã trả là ghi nhận thanh toán bên ngoài, không chuyển tiền tự động. Đây là tính lương giờ cơ bản; chưa tính thuế, bảo hiểm, hệ số tăng ca/ngày lễ theo pháp luật.

Database hiện có 53 bảng nghiệp vụ: 45 bảng lõi và 8 bảng ca làm/chấm công/lương/lịch sử chuyển bàn. SQL migration là nguồn ràng buộc; Prisma không biểu diễn hết CHECK, trigger và exclusion constraint. Không sửa migration đã chạy.

## Kiểm chứng đợt rà soát

- Kiểm tra định dạng, lint, TypeScript và 6 unit test đạt.
- 34 integration test đạt; coverage backend theo phạm vi cấu hình: 86,89% dòng.
- 11 kiểm thử trình duyệt đạt trên desktop, mobile Chromium và WebKit; 1 bài Swagger chủ động bỏ qua theo cấu hình.
- Build đạt; diễn tập database rỗng → migration → seed → phân quyền đạt hai lần.
- Test không thay thế nghiệm thu trên thiết bị và máy in thực tế. AI và thanh toán ngân hàng tự động chưa triển khai.
