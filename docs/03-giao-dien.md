# 03. Tham quan giao diện theo vai trò

## Các cửa vào

| Địa chỉ web | Người sử dụng | Tệp đầu vào |
|---|---|---|
| `/` | Người mở website | `apps/web/app/page.tsx` |
| `/login` | Nhân viên nội bộ | `apps/web/app/login/page.tsx` |
| `/guest#TOKEN_QR` | Khách quét mã bàn | `apps/web/app/guest/page.tsx`, `features/guest/guest.tsx` |
| `/workspace` | Điểm vào nội bộ | `apps/web/app/workspace/page.tsx` |
| `/workspace/staff` | Phục vụ, thu ngân | `features/workspace/service.tsx` |
| `/workspace/kitchen` | Bếp | Cùng `service.tsx`, bật chế độ kitchen |
| `/workspace/admin` | Quản trị | `features/admin/admin.tsx` |
| `/api-docs` | Người kiểm tra API | `apps/web/app/api-docs/page.tsx` |

Phần sau dấu `#` được web đọc rồi gửi token tới API kiểm tra/join; sau tham gia thành công, web bỏ token khỏi thanh địa chỉ. Không đưa QR/token thật vào tài liệu chia sẻ.

## Thiết kế hiện hành ngày 03/10/2026

Giao diện nội bộ dùng nền xám sáng, thẻ trắng và điểm nhấn xanh ngọc; khách có tông ấm để đọc thực đơn. Thanh trên cùng giữ tên nhà hàng, vai trò và công cụ. Nội dung công việc nằm ngay dưới; bỏ dải tiêu đề trống và khối giới thiệu lớn. Khách/phục vụ ưu tiên thao tác điện thoại; quản trị có menu trái trên máy tính và menu cuộn ngang trên điện thoại. Biểu mẫu và chi tiết mở riêng. [Xem cách bố trí từng vai trò và thay ảnh thật](20-anh-va-giao-dien.md).

## Khách

Quét QR → xem tên bàn/khu vực → nhập tên → tham gia → xem menu → thêm món → chọn dòng của mình → gửi. Khách thấy tiến độ món, có thể gọi hỗ trợ, đổi tên và rời bàn. Khi cần thanh toán, khách chọn Tiền mặt/Chuyển khoản rồi bấm Báo nhân viên thu tiền; màn hình giữ thông báo chờ. Số tiền do nhân viên trao đổi và chọn tại bàn.

Hai khách cùng phiên không phải hai tài khoản nhân viên. Việc khách thấy dòng món của người khác không có nghĩa họ được sửa, gửi hay hủy dòng đó. API dùng `owner_participant_id` để kiểm tra sở hữu.

## Phục vụ / thu ngân

Màn hình này tập trung vào bàn đang phục vụ, lượt cần duyệt, món sẵn sàng mang ra, hỗ trợ và cảnh báo. Việc cần làm là một hàng đợi chung, chia theo người phụ trách; không còn mục Hỗ trợ khách riêng. Nhận lời gọi trước khi đến bàn để đồng nghiệp thấy ai đang làm. Nhân viên có thể mở phiên, xác minh bàn, nhập món hộ, chuyển bàn, ghi nhận tiền/hoàn tiền, đóng phiên và xác nhận dọn bàn.

Chi tiết bàn có **Việc tại bàn / Thu tiền & phiếu / Món đã gọi / Thêm thao tác**. Đầu cửa sổ hiện việc mới nhất còn chờ, bấm để đến đúng mục. Việc thu tiền màu xanh lá, phục vụ món màu vàng cam, hỗ trợ màu xanh dương, sự cố/hoàn tiền màu đỏ, duyệt lượt gọi màu tím; có chữ và biểu tượng kèm theo. [Ví dụ thu tiền và tiền thối](25-thu-tien-tai-ban.md).

Hãy học theo công việc: **đón khách → theo dõi món → thu tiền → kết thúc**, không cố học tất cả nút trong một lần. Trong Thu tiền & phiếu, mục Điều kiện kết thúc bàn liệt kê rõ món đang chờ bếp/đang nấu/chưa mang ra, khoản thu và công việc còn mở. Nút Xem món hoặc Xem công việc đưa tới đúng mục. Đủ tiền vẫn phải phục vụ xong và chờ khách rời đi. Kết thúc bàn tạo việc Dọn bàn trong Việc chung; chỉ sau khi nhân viên xác nhận đã dọn thì bàn mới sẵn sàng.

## Bếp

Theo từng dòng món: tiếp nhận → bắt đầu chế biến → sẵn sàng. Phục vụ xác nhận món đã giao khách. Bếp có thao tác báo không thể phục vụ đối với món đã ACCEPTED. Không sử dụng trạng thái tổng của lượt gọi để suy ra mọi món bên trong đều cùng trạng thái.

## Quản trị

Quản trị có các nhóm danh mục/món/ảnh, khu vực/bàn/QR, người dùng/quyền, kho/công thức/phiếu nhập/kiểm kê, ca làm/chấm công/lương, chính sách rủi ro, ngoại lệ món, thiếu tiền và báo cáo. Các tệp `features/admin/*` và `features/workforce/*` chia giao diện này thành phần nhỏ.

Trong **Kho & công thức**, màn hình chia thành năm mục: **Tồn kho**, **Phiếu nhập**, **Công thức món**, **Lịch sử kho**, **Danh mục**. Mặc định mở Tồn kho để xem nguyên liệu còn dùng được. Các danh sách có tìm kiếm, bộ lọc và phân trang; chọn nguyên liệu, phiếu hoặc công thức để mở chi tiết. Biểu mẫu chỉ mở khi cần tạo/sửa. Đọc [bài 08](08-kho.md) để thực hành theo từng việc.

Thanh menu bên trái có thể mở đầy đủ tên mục hoặc thu gọn thành các biểu tượng. Khi thu gọn trên máy tính, rê chuột vào biểu tượng để xem tên; nút hình đồng hồ mở “Ca làm & lương”, nút mũi tên vòng tròn tải lại dữ liệu. Nút mở/thu gọn nằm đầu thanh. Trên điện thoại, menu đầy đủ nằm thành một dải cuộn ngang; vuốt để chọn mục. Khi thu gọn chỉ còn nút mở và mục hiện tại.

Giờ gọi món, thu tiền, chuyển bàn và lịch sử kho hiển thị theo **giờ nhà hàng tại Việt Nam (UTC+7)**. Đổi múi giờ trên thiết bị không làm những thời điểm này đổi sang giờ của thiết bị.

**Quyền hiện tại tách riêng:** ADMIN có `admin.workspace`, STAFF có `staff.workspace`, KITCHEN có `kitchen.workspace`. Không giả định admin mở được API phục vụ. Muốn demo đủ vai trò, dùng tài khoản đúng vai trò; nhiều tab thường dùng chung cookie, nên cần các hồ sơ trình duyệt riêng hoặc các phiên trình duyệt tách biệt.

## Lịch làm và lương của tôi

Nhân viên không phải ADMIN có vùng “Lịch làm & lương của tôi”. Nhân viên chỉ thấy phân công và phiếu lương của chính mình; kỳ lương còn DRAFT không được đưa ra như phiếu đã chốt. ADMIN không nằm trong luồng chấm công/lương nhân viên của phiên bản này.

Ngay đầu vùng cá nhân có ba mục: **Lịch của tôi**, **Lịch sử chấm công**, **Phiếu lương**. Trong “Lịch của tôi”, phần đầu ưu tiên **ca đang làm hoặc ca sắp tới**, cùng nút “Vào ca”/“Ra ca” khi đủ điều kiện. Bên dưới mặc định xem **Theo ngày**: chọn ngày trên dải lịch để thấy các ca của chính mình, giờ làm, khu vực và trạng thái. Nút **Cả tuần** mở toàn bộ lịch tuần. Chọn ca hoặc phiếu để mở chi tiết. Sang mục lịch sử hoặc phiếu lương thì chỉ hiện thông tin của mục đang chọn.

Trong “Ca làm & lương” của ADMIN, bốn mục được tách rõ:

| Mục | Dùng khi nào? |
|---|---|
| Lịch phân ca | Mặc định xem người theo ca trong ngày; có thêm tuần theo ca và tuần theo nhân viên; tạo/phân công bằng biểu mẫu mở riêng |
| Chấm công & duyệt | Lọc công cần duyệt, đang trong ca hoặc đã duyệt; mở một ca để đối chiếu và xác nhận |
| Bảng lương | Xem danh sách kỳ; chọn kỳ rồi chọn phiếu của một nhân viên để kiểm tra |
| Đơn giá giờ | Xem mức hiện tại theo từng nhân viên; mở lịch sử hoặc thêm mức có hiệu lực mới |

Đọc [bài 09](09-nhan-su.md) khi cần hiểu quy trình đầy đủ và cách tiền công đi vào phiếu lương.

Trong lịch ADMIN, **Ngày theo ca** trả lời “hôm nay ca sáng/chiều có bao nhiêu người, những ai làm?”. Thống kê đầu ngày tách tổng nhân viên, số phục vụ, số bếp và ca chưa có người. Mỗi ca có danh sách phục vụ và bếp riêng; chọn “Thêm người vào ca” để biểu mẫu chọn sẵn đúng ca.

**Tuần theo ca** đặt các ca cùng tên/giờ/nghỉ trên cùng một hàng, mỗi ngày một cột. Mỗi ô có tổng người, số phục vụ và số bếp; chọn ô để mở lịch ngày. **Tuần theo nhân viên** dùng để đối chiếu lịch của một người. Có lọc vai trò, khu vực và tìm tên; số liệu thay đổi theo bộ lọc.

[Ảnh ADMIN theo ngày](evidence/staffing-day-admin.png) · [Ảnh tuần theo ca](evidence/staffing-week-shifts.png) · [Ảnh lịch cá nhân theo ngày](evidence/staffing-personal-day.png). Đây là ảnh trên database kiểm thử riêng của lần cập nhật 01/10/2026.

## Bài tập quan sát

Chọn một món và xác định ba chỗ: khách thấy tên/giá, bếp thấy dòng món, thu ngân thấy khoản thu. Cùng một món nhưng ba màn hình dùng dữ liệu phục vụ ba mục đích. Tự trả lời: đổi giá menu hôm nay có được đổi lại giá của món đã gọi hôm qua không? Không: đơn lưu snapshot tên và giá lúc tạo.

## Hỗ trợ khách có bàn giao xác nhận

STAFF vào **Vận hành nhà hàng → Việc cần làm**. Tại đây lọc việc chưa nhận, việc bạn phụ trách, bàn giao đến bạn hoặc việc của đồng nghiệp. Mỗi bàn một thẻ, nhãn màu ở từng việc. Bấm Chi tiết bàn để mở xem; nút nhận việc nằm bên trong. Có bốn nhóm Việc chung, Tôi phụ trách, Bàn giao đến tôi và Đồng nghiệp phụ trách. Tên người phụ trách cũng xuất hiện ở sơ đồ bàn và thanh toán. Banner nhắc bàn giao ngay cả khi đang xem mục khác. ADMIN xem lịch sử tại Báo cáo → Hỗ trợ tại bàn. Khách chỉ xem yêu cầu của mình và trạng thái dễ hiểu. [Thực hành bài 22](22-ho-tro-va-ban-giao.md).

## Chuyển bàn trong chi tiết phiên

STAFF chọn Mở chi tiết bàn → Chuyển bàn ngay đầu hộp thoại. Nhập số người thực tế, tìm/lọc khu vực và chọn thẻ bàn đủ chỗ; đọc lại trước khi chuyển. Lịch sử mở riêng. Khách tiếp tục dùng trang đang mở, thấy bàn mới ở vòng cập nhật tiếp theo. [Hướng dẫn và ví dụ bài 23](23-chuyen-ban.md).

## Sự cố món — cập nhật 02/10/2026

Bếp chọn ba lý do nhanh, ghi chú tùy chọn. Phục vụ thấy bàn cần trao đổi với khách ngay trên màn hình, xác nhận riêng sau khi đã đến bàn. ADMIN có thanh Việc cần xử lý ở tất cả mục và hàng đợi theo bàn/tìm món; duyệt lý do bếp đã chọn không cần nhập lại. Món không tính tiền có thành tiền 0đ trong nhóm cuối của phiếu. [Hướng dẫn đủ vai trò và ví dụ bài 24](24-su-co-mon-va-phieu-thanh-toan.md).
