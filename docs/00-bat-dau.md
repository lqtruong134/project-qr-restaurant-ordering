# Học và làm chủ hệ thống gọi món QR

## Review tiền chuyển dư theo từng khoản thu — 18/10/2026

Hóa đơn 20.000đ, nhân viên lập khoản 10.000đ, ngân hàng nhận 12.000đ: **còn thu 10.000đ và cần hoàn 2.000đ**, không lấy khoản dư tự trả sang phần chưa được nhân viên lập. Sổ tiền, nguồn hoàn, đối soát và hiển thị STAFF/GUEST cùng dùng phân bổ thực tế. Admin chỉ đóng đối soát sau khi tiền dư đã hoàn thành công; phiếu được duyệt chưa phải bằng chứng đã trả. Bản bổ sung nằm trên nhánh review `fix/payos-payment-flow`, chưa merge/deploy và không có migration mới. Đọc [bài 06](06-thanh-toan.md), [bài 25](25-thu-tien-tai-ban.md) và [kết quả kiểm tra](15-doi-chieu.md).

## Triển khai qtruongres — 17/10/2026

Đọc [bài 26 — Triển khai trên laptop và chuyển sang VPS](26-trien-khai-qtruongres.md) khi cần chạy stack Docker riêng, chuyển dữ liệu hiện có hoặc sao lưu/khôi phục. Bài hướng dẫn tách cấu hình production khỏi `.env` phát triển, giữ PostgreSQL và ảnh tải lên trong volume riêng, chạy migration có kiểm soát và không tự seed khi khởi động.

Deployment đã được người vận hành đưa lên HTTPS và cấu hình merchant sau đợt chuẩn bị. Bản sửa thanh toán 17/10 còn chờ deploy có kiểm soát: xác minh primary/virtual account, tự cập nhật STAFF/GUEST và sửa CHECK hoàn tất yêu cầu bằng SYSTEM. Xem [nghiệp vụ thanh toán](06-thanh-toan.md) và checklist ở đầu [bài 26](26-trien-khai-qtruongres.md). AI tiếp tục OFF. [Bài 15](15-doi-chieu.md) ghi chính xác phạm vi đã kiểm tra. Lộ trình học bên dưới vẫn dùng môi trường phát triển ở [bài 12](12-van-hanh.md).

## Nền tảng AI Menu Assistant v2 — 16/10/2026

AI sở hữu việc đọc tools thực đơn, hiểu câu hỏi, tư vấn và hội thoại. API kiểm tra bảo mật/kỹ thuật và trả nguyên decision; core vẫn kiểm tra đầy đủ khi khách thêm giỏ/gửi đơn thật. Mặc định OFF, chưa có model, huấn luyện hoặc UI AI. Đọc [bài 14](14-mo-rong.md) về ranh giới read-only, contract v2 và lộ trình model; [bài 15](15-doi-chieu.md) ghi bằng chứng kiểm thử. Dữ liệu/tool trajectory và notebook chỉ ở mức scaffold nghiên cứu, không phải benchmark model.

## Đã đủ ảnh thực đơn — 15/10/2026

Đã gắn thêm **5 ảnh PNG** do chủ dự án gửi theo thứ tự: Bún gà sả, Rau cải xào tỏi (phần cơm), Lẩu Thái bò & tôm, Canh rau củ (phần cơm), Rau câu dừa sữa. Hiện **91/91 sản phẩm có ảnh**, không còn món chờ bổ sung ảnh. Ảnh gốc được giữ nguyên trong kho ảnh chung; tên món, công thức, giá và lịch sử không đổi. [Xem ảnh đã gắn và cách thay ảnh](20-anh-va-giao-dien.md).

## Hồ sơ ảnh và danh mục món — 14/10/2026

Tại đợt 14/10 đã bổ sung 28 ảnh từ `img_add_food_2`, có ảnh cho 86/91 sản phẩm, và phân lại toàn bộ thực đơn thành 11 nhóm. Canh tách khỏi lẩu; bánh/cuốn, bún/phở/mì và rau/đậu hũ có nhóm riêng. Giá, công thức và lịch sử giữ nguyên. [Xem cách phân loại và ảnh đã bổ sung](20-anh-va-giao-dien.md).

## Thanh toán payOS đã tích hợp — 14/10/2026

Phục vụ lập khoản thu online, hiển thị QR/link; hệ thống xác minh payOS rồi tự ghi nhận từng khoản ngân hàng thực nhận. Hỗ trợ tiền mặt xen kẽ nhiều lần online, khuyến mãi/VAT, tải lại giao diện, hủy/hết hạn và đối soát tiền đến muộn. Hoàn tiền vẫn qua admin duyệt → phục vụ thực trả và xác nhận. Không tự chuyển tiền hoàn hoặc phát hành hóa đơn điện tử.

Code và migration đã hoàn tất; **chưa bật merchant thật hoặc chạy giao dịch thật trong đợt này**. Bạn tự cấu hình khóa và URL, đăng ký webhook HTTPS rồi nghiệm thu 5.000đ. Đọc [06 — Nghiệp vụ](06-thanh-toan.md), [12 — Cấu hình và triển khai](12-van-hanh.md), [25 — Thu tiền tại bàn](25-thu-tien-tai-ban.md), [15 — Bằng chứng kiểm tra](15-doi-chieu.md).

## Khuyến mãi và VAT vừa bổ sung — 13/10/2026

Bản mới có khuyến mãi cơ bản theo mã/tự động, điều kiện món và thời gian, giới hạn lượt và một ưu đãi mỗi phiên. Giá thực đơn đã gồm VAT theo mô hình doanh nghiệp; admin quản lý mốc hiệu lực và thuế từng món. Phiếu tạm tính/thanh toán và báo cáo đã tách giảm giá, VAT, tiền thối và hoàn tiền. Phiếu lịch sử giữ nguyên, không tự gán thuế cho dữ liệu cũ. Bắt đầu tại **ADMIN → Khuyến mãi & VAT**, rồi đọc [bài 06](06-thanh-toan.md), [bài 25](25-thu-tien-tai-ban.md) và [kết quả kiểm tra](15-doi-chieu.md).

Bộ học dành cho người chưa biết lập trình. Bạn không cần đọc hết code trước khi bắt đầu. Hãy đi từ một bữa ăn cụ thể, hiểu thông tin được lưu ở đâu, rồi lần theo mã nguồn xử lý thông tin đó.

## Bản hiện hành — 13/10/2026

Danh mục và ảnh đã chuyển sang cơ chế chung: **86 món Việt, 5 combo, 113 nguyên liệu**, ảnh món đọc từ URL trong database và một kho `var/menu-images`. Quản trị quản lý banner thực đơn trong **Thực đơn → Ảnh giới thiệu**. Lịch sử tháng 8–10, nguồn dữ liệu mô phỏng và kết quả kiểm tra mới xem [bài 12](12-van-hanh.md), [bài 15](15-doi-chieu.md); cách thay ảnh và tình trạng ảnh hiện hành xem [bài 20](20-anh-va-giao-dien.md).

Các số liệu và biên bản ngày cũ bên dưới giữ để đối chiếu lịch sử, không phải số đếm bản hiện hành.

## Bản hệ thống được mô tả trước đây

Đối chiếu ngày **03/10/2026**, mã nguồn tại commit **7b6301aeb2b7bd6bc519b8cc018506d2ab92f649** và nội dung đang có trên máy. Bản đang học bao gồm đợt sửa nghiệp vụ/CSDL và seed ngày 30/09, chưa commit. Thay đổi có sẵn của người dùng trong test được giữ; bộ tài liệu mô tả working tree hiện hành, không chỉ commit nền.

Đọc trực tiếp PostgreSQL `qr_restaurant_ordering`: **56 bảng nghiệp vụ, 613 cột, 138 khóa ngoại, 27 migration đã áp dụng thành công**. Route đăng ký trong backend: **128 thao tác**, không tính HEAD tự sinh. Các con số này là ảnh chụp trạng thái kiểm tra, không phải mục tiêu thiết kế.

Ở hồ sơ 03/10, mục đích là hiểu phần cơ bản trước khi mở rộng. Tại thời điểm đó chỉ có tiền mặt/chuyển khoản thủ công; bản 14/10 đã tích hợp payOS như mô tả ở đầu bài. Không thấy chatbot được đăng ký trong backend hoặc màn hình hiện tại.

Tên database hiện tại là `qr_restaurant_ordering`, đã được đổi tên trực tiếp từ database trước đó theo yêu cầu. Tại lần đổi tên trước đây, dữ liệu của 55 bảng và 23 migration được giữ nguyên; không chạy lại seed. Đợt chính sách thêm migration 24 và ba cột. Đợt hỗ trợ có xác nhận thêm bảng bàn giao/FK outbox, migration 25–26; dữ liệu vận hành được giữ nguyên.

Bản 03/10 còn cải tiến bố cục bốn vai trò, lý do chặn đóng bàn theo từng món/việc, dọn bàn trong Việc chung và tự gia hạn đăng nhập. [Bài 06](06-thanh-toan.md), [11](11-bao-mat.md), [20](20-anh-va-giao-dien.md) giải thích phần mới. Giao diện nhận việc/thu tiền được cập nhật 03/10: mỗi bàn một thẻ gọn, nhãn màu từng việc, mở Chi tiết bàn rồi nhận việc; số tiền bằng 0 có thông báo theo đúng tình huống. Luồng nền 02/10: chỉ một mục Việc cần làm, nhận trước khi đến bàn, đồng nghiệp thấy người phụ trách và bàn giao có xác nhận. Chi tiết ở [22 — Hỗ trợ và nhận việc](22-ho-tro-va-ban-giao.md), [25 — Thu tiền](25-thu-tien-tai-ban.md).

## Dùng bộ này ở đâu?

- Bản đọc: mở `00-BAT-DAU.html` trong thư mục `C:\Users\Admin\Documents\Codex\QR-Restaurant-Thesis\Tai-lieu`.
- Nguồn chính: các bài Markdown, metadata, sơ đồ và tài liệu API trong `docs/` của repository WSL.
- Windows là bản xuất để học dễ hơn. Khi cập nhật, sửa nguồn trong repository rồi xuất lại; không duy trì hai bộ nội dung độc lập.
- Notion không cần làm kho tài liệu thứ ba. Không có bằng chứng ứng dụng dùng Notion làm database vận hành.

## Lộ trình 12 buổi, có thể học chậm hơn

| Buổi | Đọc                                                                                  | Kết quả phải tự làm được                                  |
| ---- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1    | [01 — Bức tranh hệ thống](01-tong-quan.md)                                           | Kể lại ai làm gì trong một bữa ăn                         |
| 2    | [02 — Nền tảng web và code](02-nen-tang.md)                                          | Phân biệt giao diện, API, database, request, response     |
| 3    | [03 — Tham quan giao diện](03-giao-dien.md)                                          | Tìm đúng màn hình và vai trò cho từng việc                |
| 4    | [04 — QR đến gửi món](04-goi-mon.md)                                                 | Phân biệt bàn, phiên bàn, người tham gia, giỏ và lượt gọi |
| 5    | [05 — Bếp và ngoại lệ](05-bep-huy-mon.md)                                            | Giải thích khi nào hủy được, khi nào trừ kho              |
| 6    | [06 — Tiền và đóng bàn](06-thanh-toan.md)                                            | Tự tính thiếu tiền, cần hoàn tiền và điều kiện đóng bàn   |
| 7    | [07 — Học database](07-database.md)                                                  | Đọc một bảng, một FK và một truy vấn JOIN                 |
| 8    | [08 — Kho và công thức](08-kho.md)                                                   | Theo dõi nhập, giữ, tiêu hao, kiểm kê                     |
| 9    | [09 — Nhân sự và lương](09-nhan-su.md)                                               | Theo dõi phân ca → chấm công → duyệt → chốt               |
| 10   | [10 — Đọc mã nguồn](10-doc-code.md), [11 — Đăng nhập](11-bao-mat.md)                 | Lần theo một nút bấm xuống SQL                            |
| 11   | [12 — Chạy và xử lý lỗi](12-van-hanh.md)                                             | Kiểm tra dịch vụ, đọc lỗi và báo lỗi có bằng chứng        |
| 12   | [13 — Thực hành nghiệm thu](13-thuc-hanh.md), [14 — Sẵn sàng mở rộng](14-mo-rong.md) | Tự demo luồng chính và nhận ra giới hạn hiện tại          |

Mỗi buổi nên dành khoảng 45–75 phút: đọc, tự kể lại không nhìn tài liệu, mở đúng file, rồi làm bài tập. Đừng cố nhớ 613 cột. Chỉ tra phụ lục khi gặp một tên chưa hiểu.

## Cách biết mình thật sự hiểu

Với mỗi chức năng, trả lời 6 câu: **Ai được làm? Bắt đầu từ màn hình nào? Gửi API nào? Backend kiểm tra gì? Ghi bảng nào? Nếu thao tác lặp hoặc thất bại thì sao?**

Ví dụ “bếp bắt đầu chế biến”: người có quyền bếp → màn hình bếp → `POST /core/items/:id/prepare` → món phải ACCEPTED → giảm tồn và chuyển món IN_PREPARATION trong cùng giao dịch → gọi lại không được trừ kho thêm.

## Cách đọc bằng chứng

Các đoạn `apps/...` là đường dẫn tính từ gốc repository. Liên kết mã nguồn trong bản HTML mặc định trỏ GitHub main; thay đổi chưa push cần xem tại kho WSL trên máy và đối chiếu bài 15. API ở tài liệu dùng đường dẫn backend; trên trình duyệt web chúng có tiền tố `/api`.

**Đã thấy trong code** khác với **đã kiểm thử thành công**. Danh sách test cho biết ý định kiểm thử; kết quả thực sự của lần làm tài liệu nằm trong [15 — Hồ sơ đối chiếu](15-doi-chieu.md). Tài liệu này không biến một bản demo thành hệ thống đã được chứng nhận vận hành thực tế.

## Tra cứu khi cần

- [Từ điển hiện hành 67 bảng](16-tu-dien-du-lieu.md): cột, kiểu, null, default, khóa, index, trigger, nơi dùng trong code.
- [Danh mục API](17-api.md): đủ route đang đăng ký, quyền và tệp xử lý.
- [Bản đồ tệp](18-ban-do-tep.md): từng tệp được Git quản lý và vai trò của nó.
- [Thuật ngữ và câu hỏi tự kiểm tra](19-thuat-ngu.md).
- [Triển khai qtruongres trên laptop/VPS, chuyển dữ liệu và sao lưu](26-trien-khai-qtruongres.md).
- [Giao diện mới và cách thay ảnh thật](20-anh-va-giao-dien.md): cách sử dụng theo vai trò, ảnh theo mã món và lưu ảnh tải lên.

## Chính sách khách và xử lý lỗi món mới

Bài 04–06 giải thích quy định gọi món và xử lý món. Chính sách hiện hành là `2026-10-v2`; bằng chứng khách đã đồng ý v1 trước đó được giữ nguyên. Khách mới đồng ý một lần khi tham gia bàn. Bếp báo sự cố sau chế biến; quản trị xác nhận lỗi và bỏ tiền món trong một thao tác. Nguyên liệu đã dùng và lịch sử thu tiền vẫn giữ. [Bài 21](21-chinh-sach-va-ma-tran.md) là hồ sơ đầy đủ về quyết định, quyền, ma trận thao tác và kiểm thử; bạn vẫn học theo trình tự thông thường. Migration 24 đã bổ sung ba cột, không thay dữ liệu mẫu hay ép khách đang ăn xác nhận lại.

## Hỗ trợ tại bàn vừa chuẩn hóa

[Bài 22 — Ví dụ và báo cáo hỗ trợ/bàn giao](22-ho-tro-va-ban-giao.md) giải thích ai phụ trách khi chờ đồng nghiệp nhận, từng trạng thái, thiết kế CSDL và kiểm thử. Khi đọc bài 05 gặp phần hỗ trợ, có thể mở bài 22 để thực hành; không cần học thêm công nghệ mới.

## Chuyển bàn vừa thiết kế lại

[Bài 23](23-chuyen-ban.md) hướng dẫn chọn bàn trống đủ chỗ, một bước xác nhận và lịch sử chuyển. Giữ nguyên mã phiên, khách, giỏ, món và thanh toán; bàn cũ chờ dọn. Đợt 02/10 không thêm migration hoặc reset dữ liệu. Bạn vẫn đọc theo lộ trình; mở phụ lục này khi cần thực hành chuyển bàn.

## Sự cố món và phiếu thanh toán vừa làm gọn

[Bài 24](24-su-co-mon-va-phieu-thanh-toan.md) đi qua bếp chọn lý do nhanh → phục vụ đến báo khách → admin mở thẳng hàng đợi theo bàn → xử lý tiền. Phiếu gom món hủy/miễn ở cuối, một dòng tiền cho mỗi món. Đợt này giữ cấu trúc database và dữ liệu vận hành. Bạn vẫn học theo trình tự, mở bài này để thực hành khi đến bài 05–06.

## Thu tiền tại bàn vừa đơn giản hóa

[Bài 25](25-thu-tien-tai-ban.md) hướng dẫn khách chọn hình thức và gọi nhân viên, nhân viên thu cả bàn/món của một khách/một khoản tiền, phân biệt tiền khách đưa với tiền trả vào hóa đơn và tiền thối, lưu ảnh chuyển khoản riêng. Chi tiết bàn chia bốn mục theo việc. Migration 27 thêm bốn cột và một FK, giữ 56 bảng và dữ liệu vận hành; không chạy lại seed.
