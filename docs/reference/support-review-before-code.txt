# Review trước thay đổi — 01/10/2026

Đã đọc schema, migration/tenant guard, guest routes/state, dining routes, workforce assignments/attendance, staff access, maintenance/outbox, Guest/Staff UI và kiểm thử liên quan. Baseline chạy thực tế: pnpm check thành công (21 unit), integration 62/62 trên 6 tệp.

## 1. Luồng hiện tại
Khách gửi một trong năm loại hỗ trợ. Cùng khách/phiên/loại đang NEW hoặc ACKNOWLEDGED được dùng lại. guest() khóa phiên rồi người tham gia, nên hai lần gửi qua API đã tuần tự hóa. Nhân viên khóa yêu cầu để nhận; chỉ người đang nhận được hoàn tất. Bàn giao hiện đổi acknowledged_by và acknowledged_at ngay lập tức.

## 2. Schema hiện tại
support_request có phiên, người tham gia, loại/nội dung, status, acknowledged_by/at và resolved_by/at. Không có bảng bàn giao; chưa có partial unique chống trùng ở biên SQL. core_tenant và core_session_guard kiểm tra cùng nhà hàng/cùng phiên. business_audit_event hiện chỉ ghi SUPPORT_REASSIGN; actor_id bắt buộc là nhân viên. outbox_event hiện liên kết order_batch hoặc payment_transaction, chưa liên kết hỗ trợ.

## 3. Quyền hiện tại
staff.workspace được đọc/nhận/hoàn tất/bàn giao; API kiểm tra ownership khi hoàn tất/bàn giao. Target phải ACTIVE/cùng nhà hàng/có staff.workspace. ADMIN và KITCHEN không mặc định có quyền phục vụ. Chưa có accept/decline. Thu hồi quyền người đang giữ hỗ trợ chưa bị chặn.

## 4. UI hiện tại
Guest dùng form chung, OTHER không bắt buộc nội dung và danh sách có cả yêu cầu người khác cùng bàn; response tạo trả cả row nội bộ. STAFF xem hỗ trợ lẫn trong Việc cần làm; không có banner/badge bàn giao đến mình. Polling 3 giây, visibilitychange; STAFF thiếu focus/online. Âm báo đã opt-in. Outbox được publish qua PostgreSQL NOTIFY mỗi khoảng 5 giây; trình duyệt vẫn polling.

## 5. Vấn đề
Chuyển chủ sở hữu trước khi target đồng ý; không có lịch sử phản hồi nhiều lượt. Mất dấu trách nhiệm khi cuối ca. Handoff không đổi support status nên thông báo hiện tại không thấy thay đổi. Claim có khóa một người thắng nhưng chưa audit; không có kiểm thử race accept/resolve, hai handoff, third-party accept. Chưa có tuổi chờ/nhóm ưu tiên rõ. Ca phân công tồn tại với area_id nullable; lịch ca không đồng nghĩa nhân viên thực sự đang làm, vì vậy không đủ để ẩn yêu cầu ngoài khu vực.

## 6. Thiết kế triển khai
- Giữ NEW → ACKNOWLEDGED → RESOLVED; CANCELLED cũ chỉ đọc, không thêm luồng hủy hỗ trợ mới.
- Thêm support_request_handoff: from/to, reason, PENDING/ACCEPTED/DECLINED/CANCELLED, requested/responded_at, responded_by, response_reason. Một pending mỗi yêu cầu. Không tự hết hạn hoặc tự phân công.
- PENDING giữ nguyên owner. Chỉ target accept/decline; accept đổi owner trong cùng transaction. Owner có thể rút bàn giao hoặc resolve; resolve đóng pending nguyên tử. Sau accept owner cũ mất quyền.
- Khóa app_user (kiểm tra lại ACTIVE/quyền) → table_session → support_request → handoff. App_user lock cùng quy trình đổi quyền ngăn nhận trách nhiệm ngay lúc bị khóa tài khoản. Không cho thu hồi STAFF/khóa owner còn ACKNOWLEDGED: cần hoàn tất hoặc bàn giao được nhận trước.
- Partial unique chống trùng hỗ trợ active và pending handoff; FK/tenant guard/check trạng thái bảo vệ SQL. Migration phát hiện dữ liệu cũ không hợp lệ và báo rõ, không xóa/reset nghiệp vụ.
- Mọi STAFF hợp lệ cùng nhà hàng xem NEW/đang xử lý; gợi ý người đang chấm vào ca và cùng area trước, lịch ca kế tiếp, rồi tất cả fallback. Ca không phải điều kiện quyền. Không ẩn yêu cầu ngoài area.
- Thêm FK outbox tới support_request, tái sử dụng maintenance/NOTIFY; mỗi thao tác thành công ghi event, staff thao tác ghi business audit. Request + created event lưu nguồn khách. Audit không đưa ra Guest.
- Guest chỉ xem yêu cầu chính mình, năm tên Việt, OTHER bắt buộc nội dung, rõ trạng thái/thời gian/message reuse. Hỗ trợ tính tiền không ghi nhận thanh toán.
- STAFF có mục Hỗ trợ khách riêng: bàn giao đến bạn trước; NEW theo thời gian chờ; bạn phụ trách; đồng nghiệp phụ trách. Badge/banner hiện từ mọi tab, tuổi chờ 2/5 phút là gợi ý UI, không cam kết SLA. Handoff/form/history trong dialog có focus/keyboard.
- ADMIN đọc lịch sử tại báo cáo bằng admin.workspace; không có quyền giành/resolve hỗ trợ.
- Poll 3 giây, focus/visibility/online; giữ âm báo opt-in. Thông báo chính là banner/badge/card.
- Thêm integration ít nhất 17 tình huống và kiểm thử UI desktop/mobile/WebKit + 320/768/1440, không can thiệp database vận hành ngoài migration.
