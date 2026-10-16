# 19. Thuật ngữ và câu hỏi ôn tập

| Thuật ngữ | Nghĩa ngắn |
|---|---|
| Actor | Người/hệ thống gây ra thao tác: USER, GUEST, SYSTEM tùy bảng |
| API endpoint | Một phương thức HTTP và đường dẫn backend |
| Audit | Dấu vết người thực hiện, đối tượng, lý do và chi tiết |
| Batch | Một lượt gửi món, chứa nhiều dòng |
| BOM | Công thức định lượng nguyên liệu cho món |
| Charge | Khoản phải thu, chưa phải tiền đã nhận |
| Constraint | Ràng buộc database bắt dữ liệu tuân quy tắc |
| Cookie | Thông tin trình duyệt gửi kèm request |
| Credential | Thông tin chứng minh phiên/định danh truy cập |
| CSRF | Loại yêu cầu giả mạo dựa vào phiên trình duyệt; dự án kiểm tra Origin/header |
| ERD | Sơ đồ thực thể và quan hệ |
| FK / PK | Khóa ngoại / khóa chính |
| Hash | Giá trị băm dùng đối chiếu, không phải bản rõ token/mật khẩu |
| Idempotency | Gửi lại cùng yêu cầu không gây thêm tác động nghiệp vụ |
| Lời gọi thu tiền | Khách nhờ nhân viên đến bàn; chưa có khoản thu hoặc tiền đã trả |
| Intent | Khoản thu xác định số tiền/phạm vi đang chờ xác nhận; khác lời gọi nhân viên |
| Tiền thối | Tiền mặt khách đưa trừ khoản thanh toán ghi vào hóa đơn |
| JSON | Định dạng dữ liệu trao đổi và lưu cấu trúc |
| JWT | Dạng token ký số; access cookie nhân viên dùng HS256 |
| Ledger | Hệ thống ghi nhận khoản thu/tiền/phân bổ để đối soát |
| Migration | Bước nâng cấu trúc database theo phiên bản |
| Monorepo | Nhiều ứng dụng/gói trong một repository |
| Nullable | Cột cho phép NULL |
| Optimistic version | So phiên bản đã nhìn với hiện tại để phát hiện xung đột |
| Outbox | Sự kiện được lưu cùng transaction, rồi xử lý sau commit |
| Participant | Khách tham gia một phiên bàn |
| Polling | Định kỳ gọi lại API lấy dữ liệu |
| RBAC | Phân quyền theo vai trò |
| Reservation | Lượng nguyên liệu đã giữ cho món, chưa chắc đã tiêu hao |
| Rollback | Hủy thay đổi của transaction thất bại |
| Seed | Ghi dữ liệu mẫu/khởi tạo |
| Session | Phải đọc ngữ cảnh: phiên đăng nhập khác phiên bàn |
| Snapshot | Bản chụp dữ liệu tại một thời điểm để giữ lịch sử |
| Tenant | Phạm vi nhà hàng sở hữu dữ liệu |
| Transaction | Trong SQL là giao dịch nguyên tử; trong payment_transaction là bản ghi tiền |
| Trigger | Mã chạy trong database khi xảy ra sự kiện ghi |
| UAT | Người dùng nghiệm thu theo tình huống nghiệp vụ |
| UUID | Mã định danh dùng cho nhiều khóa trong dự án |
| Webhook | Thông báo máy chủ khác gửi tới API |

## 12 câu tự trả lời trước khi xem đáp án

1. Một bàn có thể có bao nhiêu phiên trong lịch sử?
2. Hai khách cùng bàn có được gửi dòng giỏ của nhau không?
3. Khi nào giữ kho và khi nào trừ tồn thực tế?
4. Tại sao batch IN_PROGRESS không đủ để quyết định hủy một item?
5. Hủy muộn có tự miễn tiền không?
6. Intent 100.000đ có phải đã thu 100.000đ không?
7. Cách tính số tiền cần hoàn?
8. Trả đủ tiền có chắc được đóng bàn ngay không?
9. ADMIN có mặc định được gọi API kitchen không?
10. Vì sao đổi giá menu không đổi hóa đơn cũ?
11. API refresh tồn tại có nghĩa giao diện tự giữ phiên 7 ngày không?
12. Có bảng webhook/risk có nghĩa online/AI đã xong không?

## Đáp án ngắn

1. Nhiều; chỉ hạn chế tối đa một ACTIVE theo quy tắc hiện hành.
2. Không; owner_participant_id được kiểm tra ở backend.
3. Giữ lúc gửi/duyệt theo trạng thái, tiêu hao khi prepare.
4. Các item trong cùng batch có trạng thái khác nhau.
5. Khách đổi ý: vẫn thu, muốn miễn dùng waive. Lỗi nhà hàng trước phục vụ được ADMIN xác nhận: bỏ tiền trong cùng thao tác, không waive thêm.
6. Không; phải có ghi nhận giao dịch thành công.
7. max(đã thu − đã hoàn − phải thu, 0).
8. Không; còn món, giao dịch, hỗ trợ/cảnh báo/hồ sơ chưa xong có thể chặn.
9. Không; quyền hiện tại tách ba vai trò.
10. Nhờ các snapshot tên/giá/phiếu.
11. API có route chưa đủ; bản web hiện đã tự gia hạn ACCESS_EXPIRED khi refresh còn hợp lệ. Giới hạn 7 ngày tính từ lần đăng nhập không kéo dài; phiên bị thu hồi/khóa vẫn chặn. Đọc bài 11.
12. Không; phải đối chiếu route, dịch vụ và luồng người dùng thực tế.

## Bài trình bày 10 phút

Hai phút giới thiệu tác nhân và kiến trúc; ba phút theo một lượt gọi; hai phút giải thích tiền/kho; hai phút mở đúng file và truy vấn; một phút nêu phần chưa triển khai. Dùng câu “tôi đã kiểm chứng ở...” thay vì “chắc hệ thống sẽ...”.

## Chính sách khách khác cấu hình rủi ro

Policy version là tên bản quy định khách đã đồng ý, ví dụ 2026-10-v1. Hai cột accepted_policy_version/at là bằng chứng của lần tham gia. Risk policy là ngưỡng gọi món, bàn và chấm công; hai khái niệm này không phải cùng một bảng. Reason code là loại lý do máy chủ kiểm tra; giao diện dùng nhãn tiếng Việt.
