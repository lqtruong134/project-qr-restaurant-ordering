# 11. Đăng nhập, quyền và bảo vệ thao tác

## Luồng đăng nhập nhân viên

Web gửi username/password tới `POST /auth/login`; backend kiểm tra cấu trúc, giới hạn thử, tìm user trong nhà hàng cấu hình, xác minh mật khẩu Argon2id và trạng thái. Nếu hợp lệ, tăng auth_version, lưu hash refresh token và cấp access/refresh cookie.

Access là JWT HS256, hạn 15 phút. Refresh có hạn tuyệt đối 7 ngày và được xoay khi gọi `/auth/refresh`. Đăng nhập lại tăng phiên bản xác thực nên phiên cũ mất hiệu lực. Đăng xuất, khóa/đổi quyền/đổi mật khẩu qua quản trị làm thông tin phiên bị thu hồi theo cơ chế code hiện có.

Hai thiết bị dùng cùng một tài khoản có thể làm thiết bị trước bị văng. Đây không nhất thiết là lỗi mạng; mô hình hiện tại chỉ giữ một refresh hash/version cho mỗi user. Backend kiểm tra trạng thái user và quyền trong database, không tin riêng những gì frontend hiển thị.

## Vì sao trước đây đang làm việc lại bị hết hạn?

Hãy phân biệt hai thứ: **mã truy cập** là thẻ dùng để gọi API, có hạn 15 phút; **phiên đăng nhập** có thông tin gia hạn còn hiệu lực tối đa 7 ngày từ lần đăng nhập. Trước đây giao diện chưa dùng thông tin gia hạn, nên thẻ hết 15 phút cũng làm màn hình yêu cầu đăng nhập lại.

Bản cập nhật 03/10 đã sửa: khi backend trả ACCESS_EXPIRED, web tự gia hạn rồi gửi lại đúng yêu cầu một lần. Bạn tiếp tục ca làm mà không phải nhập mật khẩu mỗi 15 phút. Nhiều request cùng lúc dùng chung một lần gia hạn. Khi trình duyệt hỗ trợ Web Locks, các tab cùng website còn xếp hàng và kiểm tra xem tab khác đã gia hạn chưa để tránh xoay token cùng lúc.

Ví dụ bạn đăng nhập lúc 08:00 và vẫn dùng web lúc 12:00: mã truy cập được gia hạn khi cần, màn hình không tự văng chỉ vì đã qua 15 phút. Gia hạn không kéo dài giới hạn tuyệt đối 7 ngày. Bài kiểm thử backend dùng đồng hồ giả để mô phỏng 8 giờ; bài trình duyệt kiểm tra hai tab mất access cookie cùng lúc trên Chromium và WebKit. Đây không phải thử chạy ngoài quán liên tục tám giờ.

Chỉ lỗi hết hạn mã truy cập được thử lại. Lỗi mạng không tự gửi lại thao tác ghi tiền hay đặt món. Nếu phiên bị thu hồi, tài khoản bị khóa, refresh không còn hợp lệ hoặc đã quá giới hạn 7 ngày, web vẫn chặn thao tác và yêu cầu đăng nhập lại. Hai thiết bị dùng chung tài khoản vẫn có thể làm phiên trước mất hiệu lực như mô hình đã nêu ở trên.

**Phiên đăng nhập nhân viên, ca chấm công và phiên bữa ăn là ba khái niệm riêng.** Gia hạn đăng nhập không tạo ca làm, không thay đổi giờ công và không tự đóng bàn khách. Bản này chưa có thời hạn tự đăng xuất theo số phút không thao tác. Nguyên tắc phân biệt thời hạn và gia hạn tham khảo [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); không coi đây là chứng nhận đã đáp ứng mọi yêu cầu bảo mật của tài liệu đó.

## Ma trận quyền hiện hành

| Nghiệp vụ | Khách | STAFF | KITCHEN | ADMIN |
|---|---|---|---|---|
| Tham gia QR, giỏ của mình | Có cookie guest | Qua luồng khách nếu dùng | Qua luồng khách nếu dùng | Qua luồng khách nếu dùng |
| Duyệt, phục vụ, thu/hoàn, đóng bàn | Không | Có | Không | Không mặc định |
| Nhận/chế biến/báo sẵn sàng | Không | Không | Có | Không mặc định |
| Menu, tài khoản, kho, lương, rủi ro | Không | Không | Không | Có |
| Xem catalog nội bộ | Không qua route nội bộ | Có | Có | Có |
| Xem công/lương bản thân | Không | Có | Có | Trả danh sách rỗng theo luồng hiện tại |

Guest route có `public:true` nghĩa bỏ qua đăng nhập nhân viên. Các route nghiệp vụ khách vẫn kiểm tra guest credential; không được gọi chúng là “ai cũng thao tác được”. QR-info/join là những bước trước khi có credential.

## CSRF, cookie và cùng nguồn

Các request ghi thông thường phải có Origin trong APP_ORIGINS và `X-CSRF-Protection: 1`. Cookie dùng HttpOnly, SameSite Strict; Secure khi production. Web gọi `/api` cùng nguồn nhờ rewrite Next.js. Payment webhook có cơ chế chữ ký riêng và được đánh dấu ngoại lệ CSRF.

## Những cơ chế chống lỗi bạn sẽ gặp

| Cơ chế | Chặn loại vấn đề nào? |
|---|---|
| RBAC / config.permission | Tài khoản gọi sai nghiệp vụ |
| restaurant_id / tenant guards | Nối/sửa dữ liệu khác nhà hàng |
| Ownership | Khách sửa/hủy món của người khác |
| version / cartVersion | Ghi đè dựa trên màn hình đã cũ |
| Idempotency key | Mạng gửi lại khiến tạo giao dịch trùng |
| Transaction + row lock | Hai thao tác đồng thời làm sai trạng thái/tồn/tiền |
| Snapshot | Dữ liệu lịch sử bị đổi theo danh mục mới |
| Audit / history | Mất dấu ai làm gì và vì sao |

Không phải mọi POST đều dùng chung idempotency_record. Một số trả kết quả cũ theo trạng thái, một số dùng request_key riêng, một số từ chối 409 nếu đã xử lý. Tra endpoint cụ thể thay vì giả định tất cả “bấm lại đều được”.

## Giới hạn cần nhớ

Login limiter đang lưu trong bộ nhớ một tiến trình API; chưa dùng kho chia sẻ cho nhiều instance. Polling 3 giây không bảo đảm hai người luôn nhìn cùng phiên bản. QR là thông tin truy cập bàn, nên có quy tắc duyệt và giới hạn gửi nhưng không nên coi QR ảnh chụp là bằng chứng chắc chắn khách đang ngồi tại nhà hàng.

## Mở mã nguồn

`apps/api/src/modules/auth/index.ts`, `session-cookies.ts`, `login-limiter.ts`; `apps/web/lib/api-client.ts`; `apps/web/features/shared/auth-boundary.tsx`; `apps/api/src/shared/http-errors.ts`.

## Tự kiểm tra

401 ACCESS_EXPIRED được web tự gia hạn nếu phiên còn hợp lệ; các 401 do phiên bị thu hồi/hết hạn tuyệt đối cần xác thực lại. 403 PERMISSION_DENIED không nên tự đăng xuất một phiên hợp lệ; giao diện hiện cảnh báo quyền. 403 ACCOUNT_LOCKED lại là trạng thái chặn. CSRF_REJECTED có thể do Origin/header cấu hình sai; không chữa bằng cách bỏ hẳn kiểm tra CSRF.

## Chính sách và lý do phải được API kiểm tra

Checkbox chỉ giúp khách thao tác đúng. API join vẫn kiểm tra phiên bản hiện hành và tự ghi thời gian đồng ý. API xử lý món kiểm tra quyền, loại lý do và trạng thái món, khóa phiên trước khi thay đổi. Không thể cho bếp miễn tiền chỉ bằng cách gửi mã KITCHEN_ERROR; mã đó ở API bếp chỉ tạo báo cáo chờ quản trị.

Danh sách mã và nhãn tiếng Việt dùng chung; backend chọn whitelist theo scope thao tác, kiểm tra ghi chú không quá 500 ký tự. Client cũ gửi lý do tự do được tiếp nhận theo nhánh OTHER khi hợp lệ, không được tự động coi là lỗi nhà hàng để bỏ tiền.

## Quyền với hỗ trợ và bàn giao

Chỉ owner hoàn tất/đề nghị bàn giao; chỉ target nhận/từ chối. Backend kiểm tra lại tài khoản/quyền khi khóa dữ liệu, không dựa vào việc ẩn nút. Không khóa hoặc bỏ STAFF của owner còn việc; cần hoàn tất hoặc đồng nghiệp nhận bàn giao trước. ADMIN chỉ đọc lịch sử bằng quyền quản trị. [Bài 22](22-ho-tro-va-ban-giao.md).

## API dùng chung cho admin và phục vụ

Mỗi vai trò vẫn có workspace riêng. Backend cho phép một trong hai quyền admin/staff tại đúng các API đọc cảnh báo, xem phiếu, lập hồ sơ hoàn và ghi nhận đã hoàn. Điều này không cấp admin toàn bộ quyền gọi món/chuyển bàn của phục vụ, và không cho bếp xử lý tiền. API bếp báo sự cố và API admin quyết định tiền vẫn kiểm tra quyền riêng. Giao diện không thể tự quyết định quyền bằng cách hiện hoặc giấu nút.

## Quyền đọc ảnh chuyển khoản

Ảnh chứng từ không nằm trong public/images. STAFF/ADMIN đọc qua GET /core/payments/:id/proof, backend kiểm tra nhà hàng; khách và bếp không có quyền. Response private/no-store. Xem [bài 25](25-thu-tien-tai-ban.md) để phân biệt ảnh minh chứng với việc thực nhận tiền.
