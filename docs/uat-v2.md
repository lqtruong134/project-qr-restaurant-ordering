# Chuẩn hóa nghiệp vụ UAT v2 — 27/09/2026

Nguồn yêu cầu: UAT_QR_Restaurant_Chi_Tiet_Chuan_Nghiep_Vu_v2.docx (116 ca). Đợt này tiếp tục dự án thống nhất, không tạo dự án mới. Schema có 55 bảng nghiệp vụ; AI và thanh toán ngân hàng trực tuyến chưa tích hợp. Các kiểm thử tự động không thay thế việc bạn nghiệm thu 116 ca theo tài liệu gốc.

## Mở lại dự án để nghiệm thu

Database trên máy đã được sao lưu và nâng cấp, không chạy reset và không ghi đè dữ liệu bạn đã thử. Dừng đúng terminal đang chạy ứng dụng bằng Ctrl+C, rồi chạy `pnpm dev` trong `~/projects/qr-ordering-thesis`. Chỉ chạy một phiên để tránh trùng cổng. Mở http://localhost:3000. Dùng các hồ sơ trình duyệt riêng cho quản trị, hai nhân viên phục vụ, bếp và hai khách.

Nếu lấy code trên máy khác: làm theo README để cài dependencies, tạo cấu hình, khởi động database, generate Prisma và migrate. Không dùng `db push`, `migrate reset` hoặc xóa volume để cập nhật.

## Những luồng cần nghiệm thu lại trước

| Ca gốc | Vào đâu và thử | Kết quả cần quan sát |
|---|---|---|
| 001–013 | Đăng nhập; quản trị → nhân viên. Tạo hai người trùng tên, khác mã; khóa một người đang đăng nhập. | Tên được trùng; mã nhân viên/tên đăng nhập không trùng. Khóa và đổi vai trò có lý do, lịch sử; tài khoản bị khóa không tiếp tục thao tác. Sai mật khẩu hiện tại form, không gây vòng lặp hộp thoại. |
| 014–020 | Quản trị → khu vực/bàn → QR. Xem/in lại rồi cấp QR mới; thử link cũ và khách đã tham gia. | QR có ngữ cảnh bàn/khu vực; cấp mới khác in lại. Link cũ không thêm khách; khách đã tham gia không bị cắt chỉ vì đổi QR. Không ngừng bàn đang phục vụ. |
| 021–028 | Quản trị → thực đơn. Tải ảnh, đánh dấu món tặng hoặc món không quản lý kho; tăng giá khi khách có giỏ. | Giá 0 cần cờ món tặng. Ảnh tải file. Giỏ phải xác nhận giá mới; đơn đã gửi giữ tên/giá cũ. Món hết/tắt không làm mất lịch sử. |
| 029–037 | Hai khách cùng bàn, mỗi người thêm món; thử sửa/gửi món người kia; đổi tên, tải lại và rời bàn. | Giỏ chung rõ người sở hữu; chỉ sửa/gửi phần mình. Rời bàn bỏ giỏ của mình, giữ đơn đã gửi. Gửi lặp không tạo đơn mới. |
| 038–044 | Bàn chưa xác minh gửi hai lượt; phục vụ duyệt một lượt, xác minh bàn; bếp nhận riêng một món. | Duyệt đơn và xác minh bàn tách biệt. Trạng thái từng món quyết định thao tác; các món còn lại không bị chuyển trạng thái hộ. |
| 045–049 | Trong một lượt, bếp nhận một món; khách hủy phần còn chờ. Phục vụ hủy món đã nhận nhưng chưa nấu với lý do. | Kết quả hủy báo phần đã hủy/bị bỏ qua. Món đang nấu không hủy theo cách thường. Quản trị → báo cáo → ngoại lệ món để hủy muộn; miễn tiền là thao tác riêng, không trả nguyên liệu đã tiêu hao. |
| 040, 043 | Bếp làm xong nhiều món một bàn; phục vụ chọn các món READY → đánh dấu đã phục vụ. | Chỉ chọn cùng phiên bàn; món chưa READY không bị phục vụ. Có thời điểm sẵn sàng/đã phục vụ và người thao tác. Đã phục vụ không có nghĩa đã thu tiền. |
| 050–056 | Hai nhân viên nhận cùng yêu cầu; người nhận chuyển giao cho đồng nghiệp với lý do; xử lý cảnh báo. | Một người nhận thành công. Hoàn tất theo người phụ trách. Nhận biết cảnh báo khác giải quyết cảnh báo; giải quyết cần nội dung. Trở lại tab phải cập nhật dữ liệu. |
| 057–066 | Chi tiết bàn → thanh toán: trả một phần, tạo hai yêu cầu cùng lúc, tiền mặt có tiền thừa, chuyển khoản thủ công trùng tham chiếu. | Tiền khách đưa khác tiền áp dụng vào bill. Yêu cầu chờ giữ phần số dư; hủy/hết hạn không tạo khoản đã thu. Xác nhận lặp không thu thêm. Thanh toán sớm không tự đóng phiên. |
| 067–070 | Miễn khoản thu sau khi đã thu; tạo hồ sơ hoàn, hoàn một phần rồi hoàn phần còn lại. | Mỗi lần hoàn có giao dịch riêng; tổng không vượt số cần hoàn; gửi lặp không hoàn hai lần. Chấp nhận tổn thất không tạo tiền thu giả. |
| 071–076 | Thử đóng khi còn món, hỗ trợ hoặc tiền phải hoàn; hoàn tất rồi đóng và xem/in phiếu. | Chặn đóng còn việc bắt buộc. Phiếu có giờ vào/ra, món, khoản miễn, giao dịch thu/hoàn và tiền thừa. Phiếu chốt không đổi theo giá menu. Khách phiên cũ không thao tác được. |
| 077–080 | Chuyển bàn đang có món/hỗ trợ, hai nhân viên tranh cùng bàn đích. | Một phiên được chuyển, không sao chép đơn. Bếp/khách/phục vụ thấy bàn mới; không có hai phiên hoạt động trên một bàn. |
| 081–090 | Kho → tạo phiếu nháp → sửa dòng/lý do → hủy nháp hoặc duyệt. Sau đó gửi món, nhận bếp, bắt đầu nấu. | Nháp không tăng tồn; sửa cũ bị xung đột; phiếu duyệt bất biến. Giữ kho lúc chấp nhận, tiêu hao khi nấu; hủy trước nấu chỉ giải phóng phần giữ. Món quản lý kho cần công thức. |
| 091–095 | Chính sách và báo cáo → thay ngưỡng → mở đối soát một phiên. | Ngưỡng mềm không vượt ngưỡng cứng. Báo cáo tách doanh số/thu/hoàn/miễn/tổn thất; có chi tiết phiên để đối chiếu. |
| 096–103 | Ca làm/chấm công: ca qua đêm, ca chồng nhau, quên chấm, duyệt vắng/nghỉ hoặc công thực tế. | Cửa sổ chấm và giới hạn ca theo cấu hình. Giờ ghi nhận gốc giữ nguyên; phút duyệt có lý do/người duyệt. Không coi vắng 0 phút là công bình thường. |
| 104–108 | Lương: lập nháp, điều chỉnh, xóa nháp có lý do, lập lại, chốt và ghi nhận trả lương. | Không xóa công khi xóa nháp. Kỳ chốt giữ snapshot; trả lương có giao dịch riêng cho phiếu lương, tham chiếu/người trả; bấm lại không chi thêm. |
| 109–116 | Thử màn nhỏ, zoom, tên/ghi chú dài, bàn phím, đóng form đang sửa, ẩn tab và Wi-Fi chậm. | Không cắt số tiền/nút chính; form chưa lưu cảnh báo khi đóng. Trở lại tab lấy dữ liệu server. Đây là nhóm cần bạn kiểm tra thêm trên điện thoại thật. |

## Giới hạn được giữ rõ

- Chuyển khoản là ghi nhận thủ công sau khi nhân viên đối chiếu, chưa tự kiểm tra tài khoản ngân hàng.
- Cập nhật màn hình dùng truy vấn định kỳ và đồng bộ khi trở lại tab; chưa có push khi trình duyệt bị hệ điều hành đóng.
- Lương đang trả toàn bộ phiếu đã chốt; chưa có luồng trả lương nhiều đợt cho từng người. Phân vùng quyền theo ca, định vị chấm công và hóa đơn điện tử là phần mở rộng.
- Phiếu nhập hủy giữ lịch sử. Xóa kỳ lương nháp lưu bản ghi kiểm toán, không xóa dữ liệu chấm công.
- Khởi tạo mẫu không có giao dịch khách giả và không phục hồi tồn đã tiêu hao. Cần nhập kho khi dùng hết tồn mẫu.

## Ghi nhận phản hồi

Tiếp tục dùng mã UAT-001 đến UAT-116 trong tài liệu của bạn. Với mỗi lỗi hoặc nghiệp vụ muốn đổi, ghi: mã ca, vai trò, bàn/phiên hoặc mã đối tượng, thao tác, kết quả thực tế và kết quả mong muốn. Không ghi mật khẩu, token QR hay cookie. Điểm đánh dấu trong sổ HTML cũ được giữ; đợt nghiệm thu v2 nên xuất kết quả cũ trước và đặt mã lượt thử mới.

## Kiểm chứng kỹ thuật

Các nhóm tự động bao gồm xác thực/phân quyền; sở hữu giỏ và món; chuyển trạng thái đồng thời; giữ/tiêu hao kho; thu/hoàn tiền; chuyển bàn; chấm công/lương; các luồng trình duyệt desktop/mobile/WebKit. Kết quả từng đợt ở `docs/evidence`. Không đồng nhất số test tự động với số ca nghiệm thu nghiệp vụ.
