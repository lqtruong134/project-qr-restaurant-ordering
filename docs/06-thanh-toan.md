# 06. Hiểu tiền, hóa đơn và điều kiện đóng bàn

## Thanh toán online qua payOS — cập nhật 17/10/2026

Nhà hàng thu bằng tiền mặt, chuyển khoản do nhân viên đối chiếu hoặc **Online (payOS)** do server xác minh. Khách chuyển tiền xong thì màn hình nhân viên và khách tự đọc lại dữ liệu; nút **Kiểm tra trạng thái** chỉ là cách phục hồi khi cần.

| Vai trò | Trách nhiệm                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khách   | Chọn **Tiền mặt** hoặc **Chuyển khoản**, báo nhân viên và thống nhất phần tiền sẽ trả. Khi nhân viên chọn payOS, quét QR/link được nhân viên cung cấp; theo dõi kết quả trên màn hình khách. |
| Phục vụ | Nhận việc, chọn cả bàn/món của một khách/số tiền khác và lập khoản thu. Không tự xác nhận online đã nhận tiền.                                                                               |
| Bếp     | Xử lý món; không tạo QR, ghi nhận thu hoặc hoàn tiền.                                                                                                                                        |
| Admin   | Đối soát bất thường, duyệt hồ sơ hoàn và kiểm tra căn cứ; không nhập một khoản thu giả để đổi trạng thái.                                                                                    |

Giao diện khách hiện chỉ có hai lựa chọn **Tiền mặt / Chuyển khoản** để gọi phục vụ; không có nút tự lập khoản payOS. Nhân viên chọn **Online (payOS)** trong **Chi tiết bàn → Thu tiền & phiếu** sau khi trao đổi với khách. API hỗ trợ lưu hình thức ONLINE cho lời gọi nhưng không đồng nghĩa giao diện khách có lựa chọn này.

### Luồng xác nhận tiền và tự cập nhật

```text
Nhân viên lập khoản thu → server tạo link/QR payOS
→ khách chuyển khoản → webhook đến backend
→ SDK xác minh chữ ký → đối chiếu link, khoản thu và giao dịch ngân hàng
→ transaction + allocation + tài khoản tiền + lời gọi liên quan cùng được cập nhật
→ STAFF/GUEST đọc dữ liệu mới → thẻ online, tổng tiền và checklist thay đổi.
```

Webhook dùng SDK payOS chính thức; dữ liệu GET/cancel cũng được kiểm tra chữ ký. Backend đối chiếu nhà hàng/phiên, `orderCode`, `paymentLinkId`, VND, số tiền và tham chiếu từng giao dịch. Trường tài khoản chính và tài khoản ảo được so khớp chính xác sau khi xác minh; không ép số làm mất số 0 đầu hoặc chấp nhận tài khoản bất kỳ. payOS có thể cấp tài khoản ảo riêng cho đơn khi dùng VietQR Pro. [payOS API](https://payos.vn/docs/api/), [payOS: tài khoản ảo](https://payos.vn/docs/cau-hoi-thuong-gap/).

`returnUrl` và `cancelUrl` chỉ điều hướng trình duyệt. Query `status=PAID`, ảnh chuyển khoản hoặc việc đã mở trang thanh toán không ghi tiền vào hóa đơn. Dự án áp dụng mẫu server xác nhận và xử lý lặp an toàn; không tích hợp Stripe hoặc thêm dịch vụ realtime khác. [payOS Return URL](https://payos.vn/docs/du-lieu-tra-ve/return-url/), [Stripe: webhook và xử lý lặp/đồng thời](https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted).

Mỗi tham chiếu ngân hàng chỉ được ghi một lần, kể cả webhook trùng hoặc chạy đồng thời với kiểm tra nền/refresh. Khóa phiên, khóa tham chiếu ngân hàng và ràng buộc duy nhất bảo vệ việc ghi/phân bổ. Một GET cũ không làm giảm tiền đã nhận hoặc đổi PAID thành chờ/hủy. Lease có dấu nhận diện riêng; webhook không giải phóng lease của worker khác, worker phải trả lease cả khi bỏ qua snapshot cũ.

Log vận hành có các chặng `RECEIVED → VERIFIED → MATCHED → RECORDED → ACCOUNT_UPDATED`; hai chặng ghi tiền chỉ được phát sau khi transaction commit. Thông báo trùng/chờ dữ liệu/lỗi có chặng riêng nên không phải webhook nào cũng đi hết chuỗi. Log chỉ chứa mã khoản/mã thanh toán, số tiền, kết quả, thời gian và nhóm lỗi an toàn; không chứa khóa, cookie hoặc toàn payload. Tên provider PAYOS dành riêng cho adapter chính thức, không dùng connector HMAC chung để xác nhận khoản này.

Webhook đã xác minh có thể đến trước khi GET của payOS thấy giao dịch. Trường hợp thiếu đúng tham chiếu mới là **chờ dữ liệu và retry**, không lập hồ sơ đối soát vĩnh viễn ngay. Nếu đã có tham chiếu nhưng sai số tiền/tài khoản hoặc sai link thì phải kiểm tra như bất thường. Chỉ nhãn PAID mà chưa có giao dịch ngân hàng cũng chưa đủ để ghi đã trả tiền. [Định dạng webhook payOS](https://payos.vn/docs/du-lieu-tra-ve/webhook/).

### Các trạng thái không thay thế sổ tiền

| Nguồn                                        | Ý nghĩa                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `payos_payment_request.provider_status`      | Trạng thái link do provider trả; không tự chứng minh đã phân bổ tiền vào hóa đơn.                     |
| `payos_payment_request.status`               | Kết quả xử lý tại nhà hàng: chờ, đang xử lý, nhận một phần, đã đủ, lỗi/hủy/hết hạn hoặc cần đối soát. |
| `payment_intent.status`                      | Vòng đời khoản thu có số tiền/phạm vi xác định; không phải tổng tiền khách đã trả của cả bàn.         |
| `payment_transaction` + `payment_allocation` | Tiền đã ghi nhận và đã dùng trả khoản phải thu nào; là căn cứ tổng hợp tài khoản tiền.                |
| `session_financial_account`                  | Tổng phải trả, đã thu, đã hoàn và số còn thiếu/cần hoàn của phiên.                                    |

Màn hình khách tách **Đã ghi nhận thanh toán** từ sổ thu và **Ngân hàng đã xác nhận** từ payOS. Tiền còn cách ly/chờ đối soát không bị tính thành đã trả hóa đơn. Khách chỉ nhận bản tóm tắt của bàn hoặc phần thuộc mình; không nhận raw payload, tài khoản ngân hàng, mã provider/tham chiếu giao dịch hay ID nhân viên. QR/link được cung cấp từ phía nhân viên.

### Cập nhật màn hình: polling có điều kiện

Dự án dùng webhook ghi DB và một bộ smart refresh dùng chung, chưa có SSE/WebSocket cho màn hình thanh toán. Outbox vẫn ghi sự kiện nghiệp vụ nhưng không được trình bày như đã có kênh push tới trình duyệt.

- Khi có online đang chờ, nhận thiếu, đang xử lý, đang hủy hoặc lỗi còn cần phục hồi: bill nhân viên và màn hình khách đọc lại khoảng **3 giây/lần**.
- Hết khoản cần theo dõi nhanh: khách trở lại nhịp đọc trạng thái bàn **5 giây**, bill phiên đang mở **10 giây**; bill đã đóng dừng lịch đọc. Đây là nhịp cho màn hình đang mở, không polling mọi trang.
- Tab ẩn hoặc offline dừng lịch tự đọc; quay lại foreground/kết nối thì đọc mới. Mỗi scheduler chỉ có một request đang chạy, có timeout 10 giây, backoff lỗi tối đa 30 giây và dọn timer/request khi unmount. Các màn hình khác nhau vẫn là các client độc lập.
- Tác vụ backend quét công việc khoảng 5 giây, có hạn mức lô và lịch đối chiếu riêng của từng khoản, thông thường khoảng 30 giây. Poll UI đọc DB, không gọi payOS mỗi 3 giây. Thời gian ngân hàng/webhook/mạng có thể làm kết quả xuất hiện muộn hơn một nhịp màn hình.

Sau ghi nhận, QR được ẩn khi đã đủ/kết thúc/cần đối soát, bill và điều kiện kết thúc bàn đổi theo dữ liệu mới. Khoản thực nhận mới có thông báo cho nhân viên/khách. Hệ thống không tự đóng bàn, xác nhận tiền mặt, hoàn tiền hoặc quyết định xử lý bất thường.

### Kiểm tra trạng thái chỉ dùng khi cần phục hồi

`POST /core/payments/:id/refresh` yêu cầu STAFF đúng nhà hàng và người phụ trách lời gọi liên quan; người đã phụ trách vẫn được kiểm tra lại khoản cũ sau khi lời gọi tự hoàn tất. Backend truy vấn đúng mã payOS và đối chiếu qua cùng đường ghi tiền; **không tạo link mới trong thao tác này**. UI đọc lại bill cả khi kiểm tra trả lỗi.

| Kết quả                                              | Cách hiểu                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `200` + khoản thu mới nhất                           | Đã thực hiện đối chiếu; trạng thái có thể vẫn chờ hoặc cần admin kiểm tra. Không đồng nghĩa đã thanh toán.                          |
| `409` đang đối chiếu                                 | Worker khác đang giữ lease; không trả thành công giả và không chiếm lease đó. Chờ dữ liệu tự cập nhật rồi thử lại nếu cần.          |
| `503 PAYMENT_PROVIDER_UNAVAILABLE`, `Retry-After: 3` | Provider tạm lỗi hoặc đang cập nhật dữ liệu. Lỗi an toàn không chứa raw exception; chưa được thu lại cùng phần tiền bằng cách khác. |

`force` bỏ qua lịch `next_poll_at`, không vượt qua lease đang hoạt động. Khi tạo link ban đầu mất phản hồi, nền có thể khôi phục bằng mã cũ; thẻ có thể có link nhưng chưa có QR. Không tự sinh QR từ số tài khoản đoán hoặc lập khoản mới để che việc chưa rõ kết quả.

### Chuyển thiếu, chuyển dư và yêu cầu thu tiền

Ví dụ món 49.000đ giảm 10% còn **44.100đ đã gồm VAT**. Hai lần chuyển 20.000đ và 24.100đ tạo hai giao dịch ngân hàng, tổng thu 44.100đ. Phần còn thiếu được giữ chỗ cho khoản đang xử lý; không ghi tổng 44.100đ thêm một lần nữa. VAT nằm trong tổng, không cộng thêm khi tạo QR.

**QR cũ có thể vẫn điền số tiền ban đầu.** Sau lần chuyển một phần, phải kiểm tra số còn cần chuyển trên thẻ và số tiền trong ứng dụng ngân hàng. Không quét rồi chuyển lại nguyên khoản; nếu ngân hàng không cho đổi số tiền thì nhờ nhân viên hỗ trợ. Với một số kênh VietQR Pro, chuyển sai số tiền có thể bị từ chối/hoàn bởi ngân hàng; phần mềm chỉ căn cứ giao dịch được xác minh, không tự coi đó là hoàn tiền đã thực hiện. [payOS: chuyển sai số tiền](https://payos.vn/docs/cau-hoi-thuong-gap/).

Khi khoản đã trả đủ **số tiền được lập cho phạm vi đó**, lời gọi BILL gắn chính xác qua `support_request_id` tự RESOLVED bởi SYSTEM. Ví dụ bàn còn 94.000đ nhưng lập khoản trả trước 49.000đ: đủ 49.000đ thì lời gọi gắn khoản này kết thúc, bàn vẫn còn 45.000đ. Khi cả bàn cân đối đủ, các lời gọi BILL còn mở khác được CANCELLED với lý do đã đủ tiền; không giả người khác là người nhận. Hỗ trợ/cảnh báo khác không tự kết thúc.

Khuyến mãi/phạm vi thu vẫn được server khóa và kiểm tra. Bất định từ provider hoặc hủy chưa xác nhận giữ phần đang xử lý để tránh thu hai lần. Tiền chuyển dư là tiền thực nhận cần đối soát/hoàn, không phải doanh số món mới. Tiền thối của thu tiền mặt là khoản riêng.

### Hoàn tiền, đối soát và phiếu đã đóng

Tiền online thực nhận trong phiên đang mở được giữ trong sổ tiền. Quy trình hoàn vẫn là **admin lập/duyệt hồ sơ theo giao dịch gốc → phục vụ thực trả → phục vụ xác nhận đã hoàn**; chưa gọi payOS chi hộ để tự chuyển tiền.

Hồ sơ đối soát OPEN không tự chuyển RESOLVED khi sửa code hoặc đọc lại màn hình. Với một khoản đã bị chặn bởi kiểm tra tài khoản nhận, người vận hành cần:

1. Giữ khoản cũ; không reset/seed, nhập khoản thu giả, thu lại hoặc đánh dấu PAID bằng tay.
2. Sau khi cập nhật mã và migration theo [runbook triển khai](26-trien-khai-qtruongres.md), nhân viên phụ trách dùng **Kiểm tra trạng thái** cho đúng khoản, rồi xem dữ liệu mới cùng dashboard/sao kê. Nếu còn không khớp, giữ OPEN để kiểm tra kênh/provider; không bỏ qua guard.
3. Admin chỉ đóng đối soát khi trạng thái provider đã kết thúc, tiền xác nhận khớp tiền đã ghi sổ và các khoản phải hoàn đã xử lý. Nút đối soát không tạo khoản thu thiếu trong sổ và không thực hiện chuyển tiền.

Tiền **mới** đến sau khi phiên đã đóng được cách ly trong hồ sơ, không sửa `receipt_snapshot` hoặc cộng vào phiếu cũ. Khi đã thực trả bên ngoài, admin lưu kết quả **RETURNED_EXTERNALLY**, tham chiếu trả và căn cứ. Tiền cách ly chưa từng trả hóa đơn không biến thành SUCCEEDED; tiền đã thực thu hợp lệ trước đóng phiên vẫn được giữ nguyên. Khoản đã ghi nhận đúng từ trước cũng không bị coi là tiền đến muộn chỉ vì hôm sau đọc lại sau hạn QR.

### Migration cho tự hoàn tất lời gọi

Bản nâng cấp có migration tiến [202610170001_payment_system_resolution](../packages/database/prisma/migrations/202610170001_payment_system_resolution/migration.sql). CHECK cũ yêu cầu `resolved_by` luôn có người dùng đã mâu thuẫn với kết quả SYSTEM, làm toàn bộ transaction ghi tiền/lời gọi rollback. Migration xác nhận đúng CHECK cũ rồi thay bằng CHECK phân biệt rõ SYSTEM phải có `resolved_by` NULL và USER phải có người dùng, kèm thời gian hoàn tất. Điều kiện dùng so sánh không nhận nhầm NULL; giữ nguyên CHECK ownership để USER vẫn phải đúng người đã nhận việc. Không thêm bảng/cột, không reset hoặc seed dữ liệu. Cần áp dụng migration cùng bản mã trước khi vận hành; ghi tệp migration không có nghĩa schema production đã đổi.

Tắt/chưa cấu hình payOS thì tiền mặt và chuyển khoản thủ công vẫn hoạt động. Thiết lập và triển khai xem [bài 12](12-van-hanh.md), [bài 26](26-trien-khai-qtruongres.md); thao tác xem [bài 25](25-thu-tien-tai-ban.md), kết quả kiểm thử xem [bài 15](15-doi-chieu.md). Phiếu vẫn là phiếu thanh toán nội bộ, chưa tích hợp hóa đơn điện tử thuế hoặc hoàn tự động.

## Khuyến mãi và VAT — bản 13/10/2026

Nhà hàng dùng mô hình **doanh nghiệp kê khai VAT theo phương pháp khấu trừ**. **Giá thực đơn đã gồm VAT**: khách không bị cộng thêm một lần thuế khi thanh toán. Phí phục vụ chưa được triển khai; không tự thêm phụ phí vào phiếu.

### Quy tắc khuyến mãi cơ bản

Admin vào **Khuyến mãi & VAT → Chương trình khuyến mãi** để tạo chương trình giảm phần trăm hoặc giảm số tiền cố định. Chương trình có thời hạn, ngày trong tuần, khung giờ trong cùng ngày, ngưỡng tiền món đủ điều kiện, phạm vi toàn bộ món/món chọn/nhóm món và giới hạn lượt nếu cần. Chỉ admin được thay điều kiện hoặc tạm dừng/lưu trữ; không xóa lịch sử sử dụng.

- Chương trình tự động chọn mức giảm tốt nhất khi phiên chưa bắt đầu thu tiền. Khách/phục vụ có thể chọn một chương trình hoặc nhập mã. Gỡ ưu đãi có nghĩa không tự chọn lại cho đến khi chọn một ưu đãi khác.
- **Một ưu đãi cho mỗi phiên**, không cộng dồn. Combo đã có giá riêng, luôn bị loại khỏi tiền đủ điều kiện và khỏi mức giảm. Giảm tối đa 50% mỗi dòng món; giảm tiền cố định yêu cầu ngưỡng ít nhất gấp đôi số giảm. Mức trần giảm chỉ dùng cho chương trình phần trăm.
- Mã kiểm tra trên server: thời gian/múi giờ nhà hàng, trạng thái, phạm vi món, tiền tối thiểu và lượt còn lại. Không có hạn mức theo từng người vì tên khách chưa phải danh tính thành viên đã xác thực.
- Một lượt được giữ 30 phút khi áp dụng, gia hạn đủ thời hạn khoản thu đang chờ; gỡ hoặc hết hạn sẽ giải phóng; riêng payOS chưa rõ kết quả giữ lượt cho đến khi provider xác nhận kết thúc. Lượt được sử dụng khi có giao dịch thu thành công đầu tiên; hoàn tiền không trả lại lượt. Các yêu cầu đồng thời được khóa để không vượt số lượt.
- Trước thu tiền, thêm/hủy món hoặc admin sửa chương trình làm tính lại điều kiện. Đang có khoản thu chờ thì ưu đãi tạm khóa; cần hủy khoản thu để đổi. Sau lần thu thành công đầu tiên, mức giảm của các dòng hiện có được chốt; món gọi thêm không được giảm tiếp.
- Nhà hàng hủy món sau thu tiền: đảo **tiền sau giảm**, giữ mức giảm đã chốt của món còn lại. Hoàn không vượt số cần hoàn hoặc nguồn giao dịch gốc. Miễn tiền do khiếu nại là quyết định riêng của admin, không phải chương trình giảm giá.

Giới hạn 50% là phạm vi chương trình thông thường của bản này; không triển khai các ngoại lệ khuyến mại tập trung 100%. [Quy định Chính phủ về Nghị định 128/2024/NĐ-CP](https://baochinhphu.vn/sua-quy-dinh-han-muc-toi-da-ve-gia-tri-hang-hoa-dich-vu-dung-de-khuyen-mai-102241011152040434.htm).

### Thuế được quản lý theo thời điểm

Admin vào **Giá & VAT** để lập chính sách có mốc hiệu lực trong tương lai và lý do. Món theo cấu hình mặc định dùng VAT 8% đến hết 31/12/2026, đã có lịch mức thông thường 10% từ 01/01/2027. Đây là lịch cấu hình có thể được admin thay bằng phiên bản mới khi quy định thay đổi, không phải hằng số áp lên mọi hóa đơn. Hai phiên bản cùng mốc hiệu lực thì phiên bản mới nhất được dùng; phiên bản cũ vẫn giữ để truy vết.

Từng món có thể theo mức mặc định, VAT 0%/5%/8%/10%, hoặc không chịu VAT. **0% khác không chịu VAT**. Mức 8% riêng cũng thuộc thời hạn giảm: món mới từ 2027 quay về 10% nếu chưa có chính sách 8% mới được admin thiết lập hiệu lực từ 2027. Người quản trị phải phân loại đúng hồ sơ thuế; phần mềm không tự gán 5% cho món ăn chỉ vì có nguyên liệu được bán ở mức 5%.

VAT được chụp vào dòng món **khi gửi lượt gọi**, kể cả lượt đang chờ duyệt. Sửa thuế món hay chính sách sau đó không đổi dòng đã gọi. Phiếu đã đóng và các giao dịch cũ giữ nguyên; dữ liệu trước nâng cấp thiếu snapshot thuế được ghi **Chưa có dữ liệu tách VAT**, không đoán VAT là 0 hoặc 8%.

Giảm thương mại được trừ trước khi tách VAT. Với cùng thuế suất, số VAT được tính trên tổng tiền sau giảm rồi phân bổ xuống từng dòng bằng số nguyên VND và phần dư lớn nhất. Khi đã thu tiền, VAT từng dòng được giữ nguyên; hủy dòng thì lấy đúng phần VAT đã chụp của dòng đó, không làm tròn lại các dòng đã thanh toán.

`Tiền chưa VAT = Tiền sau giảm gồm VAT − VAT`; `VAT = làm tròn(Tiền sau giảm × thuế suất / (100 + thuế suất))`.

Ví dụ món **49.000đ**, giảm **10% = 4.900đ**: khách trả **44.100đ**, gồm tiền chưa VAT **40.833đ** và VAT 8% **3.267đ**. Khách đưa **100.000đ**, thối **55.900đ**. Nếu nhà hàng hủy món này sau thu, khoản hoàn là **44.100đ**, không phải 49.000đ và không gồm tiền thối.

Nguồn tham khảo: [Nghị định 174/2025 và thời hạn giảm VAT](https://baochinhphu.vn/giam-thue-gia-tri-gia-tang-tu-01-7-2025-den-het-31-12-2026-10225070118590677.htm), [Văn bản hợp nhất 03/VBHN-BTC, Điều 14 về giá tính thuế sau chiết khấu](https://congbao.cdnchinhphu.vn/180507251028987904/2026/3/4/cong-bao-so-130-ngay-28-02-47029signed-1772613365843813772539.pdf), [KiotViet: cấu hình thuế và giá gồm VAT](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-hoa-don-dien-tu/thiet-lap-thue-vat/).

### Cách đọc phiếu và báo cáo mới

Phiếu tạm tính/phiếu thanh toán ghi bàn, mã phiên, thời điểm, số lượng/đơn giá, tiền món trước giảm, chương trình và số giảm, tổng thanh toán đã gồm VAT, các nhóm tiền chưa VAT/VAT. Phiếu theo người gọi dùng đúng phần giảm và thuế đã phân bổ cho món của từng người. Tiền khách đưa, tiền thối, thanh toán vào tiền món, hoàn do hủy/miễn và tiền nhà hàng còn giữ là các số riêng. Bấm lại cùng loại phiếu để thu gọn; in được khổ 80mm.

Báo cáo giữ **Doanh số sau giảm, gồm VAT**, bổ sung số giảm, VAT và doanh số chưa VAT. Lãi gộp trước chi phí vận hành chỉ tách khi có đủ dữ liệu VAT, không phải lợi nhuận ròng của nhà hàng. Dữ liệu cũ thiếu thuế không được trình bày thành VAT/lãi gộp bằng 0.

Đây là **phiếu thanh toán nội bộ, không thay thế hóa đơn điện tử**. Chưa tích hợp nhà cung cấp hóa đơn điện tử, chữ ký số hoặc cơ quan thuế. Tham khảo trình bày dòng giảm/thuế và trả tiền: [MISA CUKCUK](https://helpv2.cukcuk.com/vi/kb/thu-tien-va-in-hoa-don/), [Square: in phiếu](https://squareup.com/help/us/en/article/6139-print-receipts).

## Các bảng tiền không có cùng ý nghĩa

| Bảng                                  | Câu hỏi nó trả lời                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| financial_charge                      | Phiên phải trả những khoản nào?                                                   |
| support_request BILL + payment_method | Khách đang gọi nhân viên hỗ trợ thu tiền bằng hình thức nào? Chưa có số tiền thu. |
| payment_intent                        | Khoản thu xác định số tiền, hình thức và phạm vi nào đang chờ xác nhận?           |
| payos_payment_request                 | Link/mã payOS nào gắn khoản thu, đã nhận bao nhiêu và có cần đối soát riêng?      |
| payment_webhook_event                 | Thông báo provider nào đã xác minh, đã xử lý hoặc chưa khớp khoản thu?            |
| payment_transaction                   | Khoản tiền nào đã thực sự được hệ thống ghi nhận?                                 |
| payment_allocation                    | Tiền nhận được đã phân bổ vào các charge nào?                                     |
| refund_case                           | Cần xử lý hồ sơ hoàn bao nhiêu, từ giao dịch gốc nào?                             |
| refund_transaction                    | Đã ghi nhận hoàn bao nhiêu trong hồ sơ đó?                                        |
| session_financial_account             | Tổng hợp hiện tại: phải thu, đã thu, đã hoàn, còn thiếu/cần hoàn                  |

Tạo intent không có nghĩa đã nhận tiền. Xác nhận “đã nhận” là bước chịu trách nhiệm của nhân viên đối với tiền mặt và chuyển khoản thủ công.

## Ba công thức cần thuộc

```text
Thực giữ của khách = paid_total - refunded_total
Còn thiếu = max(charge_total - paid_total + refunded_total, 0)
Cần hoàn = max(paid_total - refunded_total - charge_total, 0)
```

`reserved_payment_amount` là phần tiền đang xử lý chưa được nhận, đã trừ các giao dịch thành công của từng intent. Khoản thủ công giữ chỗ đến khi hết hạn; khoản PAYOS chưa rõ kết quả vẫn giữ phần còn lại kể cả hết giờ tại giao diện, cho đến khi provider được đối chiếu. Khi tạo intent mới, số được đặt thêm không vượt `outstanding_amount - reserved_payment_amount`. Đây là giữ phần tiền đang chờ xử lý, không phải tiền đã thu.

## Ví dụ 140.000đ

| Bước                      | Phải thu |  Đã thu | Đã hoàn | Còn thiếu | Cần hoàn |
| ------------------------- | -------: | ------: | ------: | --------: | -------: |
| Cơm + nước được chấp nhận |  140.000 |       0 |       0 |   140.000 |        0 |
| An trả 100.000            |  140.000 | 100.000 |       0 |    40.000 |        0 |
| Bình trả 40.000           |  140.000 | 140.000 |       0 |         0 |        0 |
| Đảo một charge 60.000     |   80.000 | 140.000 |       0 |         0 |   60.000 |
| Hoàn lần đầu 20.000       |   80.000 | 140.000 |  20.000 |         0 |   40.000 |
| Hoàn tiếp 40.000          |   80.000 | 140.000 |  60.000 |         0 |        0 |

## Khách gọi và nhân viên chọn khoản thu

Giao diện khách không nhập số tiền: chọn **Tiền mặt / Chuyển khoản** rồi báo nhân viên, chờ người đến bàn. Nhân viên có thể thống nhất dùng payOS và là người lập khoản online. Lời gọi dùng support_request, không tạo intent và không giữ tiền. Nhân viên chọn Cả bàn, Món của một khách hoặc Số tiền khác, nhận tiền rồi ghi nhận. [Bài 25 có ví dụ từng bước](25-thu-tien-tai-ban.md).

## Tiền mặt

Tạo intent `method: CASH`, `amount` là số cần thanh toán. Nhân viên confirm đúng amount; `receivedAmount` là tiền khách đưa, không được nhỏ hơn amount. Tiền thừa `changeGiven = receivedAmount - amount`. Giao dịch chỉ ghi nhận phần thanh toán amount. Ví dụ phải thu 140.000, khách đưa 200.000: khoản thanh toán được ghi nhận là 140.000, tiền thừa 60.000.

## Chuyển khoản thủ công

Tạo intent BANK_TRANSFER, nhân viên đối chiếu tiền bên ngoài rồi confirm với **mã giao dịch hoặc ảnh chứng từ đã tải riêng**. Ảnh được lưu riêng, không tự chứng minh tiền đã vào tài khoản. Code chặn cùng mã tham chiếu chuyển khoản thành công được dùng lại trong cùng nhà hàng. Đây vẫn là **nhân viên xác nhận**, không phải ngân hàng tự báo tiền qua cổng online.

Confirm lặp một intent SUCCEEDED trả lại giao dịch đã có. Intent hết hạn hoặc đã hủy không được xác nhận theo đường thủ công. Khi hủy/miễn món làm dư nợ thay đổi, các intent chưa xong có thể bị hủy để tránh thu theo số tiền cũ.

## Hoàn tiền từng phần

Tạo refund_case gắn giao dịch thành công gốc và phiên. Amount không vượt phần còn cần hoàn, sau khi trừ hồ sơ đang chờ, và không vượt giao dịch gốc. Hoàn có thể nhiều lần; lần đầu chưa đủ đổi hồ sơ sang IN_PROGRESS. `requestId` giúp chống ghi nhận lại cùng lần hoàn; cùng khóa nhưng đổi nội dung bị chặn.

Thao tác “hoàn thành” trong phần mềm ghi nhận việc hoàn thủ công, không tự chuyển tiền qua ngân hàng. Admin lập/duyệt hồ sơ; phục vụ thực trả và xác nhận đã hoàn. Admin không thay nhân viên xác nhận hoàn. Admin mở đúng bàn từ thanh Việc cần xử lý; khi đã ghi nhận hoàn đủ, cảnh báo hoàn tiền tự hoàn tất. [Ví dụ bò + nước ở bài 24](24-su-co-mon-va-phieu-thanh-toan.md).

## Đóng phiên thường

Backend yêu cầu: còn thiếu bằng 0; cần hoàn bằng 0; không còn batch chưa kết thúc; không có payment intent CREATED/PENDING/REQUIRES_RECONCILIATION; không có refund case OPEN/IN_PROGRESS; hỗ trợ/cảnh báo phải xong; hồ sơ thiếu tiền phải được chốt.

Sau đó phiên CLOSED, người tham gia LEFT, bàn NEEDS_CLEANING. Hệ thống cấp số phiếu và chụp `receipt_snapshot`. Phiếu đã chốt tự hiện sau khi kết thúc và khi mở lại từ lịch sử; nhân viên có thể xem/in lại. Khi xem lại, `readBill` ưu tiên snapshot để hóa đơn cũ không bị đổi theo tên nhà hàng hoặc menu hiện tại. Bàn chỉ AVAILABLE sau thao tác clean.

Phiếu thu in từ web không được tự coi là hóa đơn điện tử thuế. Code đang tạo bản in nghiệp vụ nội bộ; tài liệu không xác nhận tích hợp phát hành hóa đơn điện tử.

## Thiếu tiền là ngoại lệ riêng

Nhân viên lập outstanding_balance_case với lý do/diễn biến; phiên mang trạng thái tài chính OUTSTANDING_EXCEPTION. ADMIN có thể xác nhận đã thu hồi sau đối soát hoặc write-off khi không thu được. Write-off đóng phiên theo lý do ngoại lệ sau các kiểm tra riêng; không tạo một payment giả để đưa paid_total lên bằng tổng phải thu.

Luồng đóng ngoại lệ có lý do và quyết định quản trị riêng. Backend vẫn chặn các việc chưa xử lý như hỗ trợ, hồ sơ hoàn tiền và cảnh báo không phải thiếu tiền; không được dùng write-off để bỏ qua chúng.

## Mở mã nguồn

`apps/api/src/modules/finance/ledger.service.ts` chứa công thức. `payments/payments.routes.ts` đăng ký intent/confirm/refund; `payments/collection.service.ts` xử lý khoản thu và phân bổ; `payment-requests.routes.ts` xử lý lời gọi, `payment-proof.routes.ts` lưu/đọc ảnh riêng. `payments/payos.service.ts` và `payos-adapter.ts` xử lý provider online; `payments/receipt.service.ts` tạo snapshot. `dining/dining.routes.ts` chứa close, clean và xử lý thiếu tiền. Frontend nằm ở `features/workspace/bill-panel.tsx`, `online-payment-card.tsx`, `receipt.tsx` và `features/guest/online-payments.tsx`; cơ chế đọc lại dùng chung ở `features/shared/smart-refresh.ts` và `use-smart-refresh.ts`. Chuẩn hóa dữ liệu đã xác minh nằm ở `payments/payos-normalization.ts`, bản tóm tắt khách ở `sessions/guest-payment-view.ts`.

## Tự kiểm tra

Món đã SERVED nhưng chưa trả tiền thì có đóng bàn được không? Không. Đã trả đủ nhưng còn một món đang nấu thì có đóng thường được không? Không. Đã hủy món và còn tiền cần hoàn thì có đóng thường được không? Không. Chỉ nhìn nút “đã thanh toán” là chưa đủ để hiểu toàn bộ phiên.

## Kiểm tra ngoại lệ tài chính đã bổ sung

Write-off chỉ thực hiện khi công việc còn lại của phiên đã được xử lý: support, refund case và cảnh báo khác thiếu tiền phải hoàn tất. Khi ADMIN xác nhận xóa nợ, hệ thống ghi business_audit_event WRITE_OFF_BALANCE với số báo cáo/số thực xóa, tự giải quyết cảnh báo PAYMENT_SHORTFALL và chụp phiếu đóng theo lý do ngoại lệ. Không tự xóa các cảnh báo không liên quan.

Mã giao dịch hoàn BANK_TRANSFER được trim và không dùng lại cho hai hồ sơ trong cùng nhà hàng. Khóa request vẫn cần thiết để thao tác gửi lại được nhận diện đúng; mã chuyển khoản bảo vệ thêm ở mức giao dịch tiền ngoài hệ thống.

Thanh toán chia phần là tình huống thực tế, nhưng bản hiện hành chia theo **số tiền** hoặc **các món do một khách sở hữu còn chưa trả**, với phân bổ backend; không tự nhận đã có đầy đủ chia hóa đơn theo ghế/món như các POS lớn. [Square: chia thanh toán và hóa đơn](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants).

## Nhìn phiếu biết món nào bị bỏ tiền

Chi tiết phía khách và phiếu thu giữ tên món, số lượng, giá trị gốc, trạng thái và lý do. Món lỗi đã xác nhận giữ đơn giá gốc nhưng thành tiền 0đ, kèm nhãn ngắn “Nhà hàng hủy · Không tính tiền”. Không có dòng điều chỉnh âm riêng. Món khách yêu cầu hủy sau chế biến còn thu tiền ghi “Khách yêu cầu hủy · Vẫn tính tiền”. Món hủy/miễn được gom cuối, các cột SL/đơn giá/thành tiền dùng cùng độ rộng. Sự cố chưa được quản trị quyết định có nhãn đang chờ, không hiển thị như đã miễn.

Khách gọi nhân viên bằng một lần bấm và nhận thông báo chờ; không có hộp nhập/xác nhận số tiền. Nhân viên xem rõ khoản thu, tiền khách đưa và tiền thối trước khi ghi nhận. Lập hồ sơ hoàn và xác nhận đã hoàn có lời nhắc riêng: lập hồ sơ không phải trả tiền, phải thực trả rồi mới ghi nhận. Khi bill đổi giữa lúc thao tác, API kiểm tra lại số dư và trạng thái.

Doanh số **món đã phục vụ** trong báo cáo đã trừ tiền món được miễn; số lượng và giá vốn của món đã phục vụ vẫn giữ. Tiền đã thu là tổng giao dịch thành công; hoàn tiền nằm ở đối soát riêng. Chi phí món dừng/hủy muộn nằm trong tổn thất nguyên liệu, không lẫn vào chỉ số món đã phục vụ.

## Bàn trên phiếu sau khi chuyển

Chuyển bàn không tạo lại tài khoản tiền hoặc mã phiếu. Khi đóng phiên, phiếu chốt tên/mã bàn hiện tại tại thời điểm đó. Ví dụ bữa ăn từ P01 sang A05 thì phiếu cuối ghi A05; lịch sử P01 → A05 xem riêng tại chi tiết phiên. [Bài 23](23-chuyen-ban.md) giải thích và ghi kết quả kiểm thử giữ tiền/định danh/snapshot.

## Ví dụ trả trước 55.000đ nhưng bếp chưa nhận món

Khách A02 gọi một Chả giò giòn 55.000đ. Nhân viên đã duyệt lượt gọi, thu đủ tiền mặt, nhưng bếp chưa bấm nhận. Phần tiền ghi đúng đã thu 55.000đ, còn thiếu 0đ. Phần phục vụ vẫn chưa xong, nên bàn chưa thể kết thúc.

Mở **Chi tiết bàn → Thu tiền & phiếu → Điều kiện kết thúc bàn**. Bạn thấy **Bếp chưa nhận món · 1**, kèm **1 × Chả giò giòn** và nút **Xem món**. Nút kết thúc bị khóa ngay trên màn hình; không cần bấm thử rồi đoán lỗi chung.

| Vấn đề thực tế              | Màn hình nói gì?                                    | Ai làm tiếp?                                                |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Lượt chưa duyệt             | Lượt gọi chưa được duyệt, kèm tên món               | Phục vụ kiểm tra lượt                                       |
| Món SUBMITTED               | Bếp chưa nhận món, kèm tên và số lượng              | Bếp tiếp nhận                                               |
| Món ACCEPTED/IN_PREPARATION | Món chưa chế biến xong                              | Bếp làm và báo sẵn sàng; có vấn đề thì báo sự cố            |
| Món READY                   | Món chưa mang ra bàn                                | Phục vụ mang món và xác nhận                                |
| Chưa cân đối tiền           | Số còn phải thu hoặc còn phải hoàn                  | Nhân viên đối chiếu và ghi nhận đúng thực tế                |
| Intent chưa xong            | Khoản thu chưa xác nhận hoặc giao dịch cần đối soát | Kiểm tra khoản thu, không ghi đã nhận nếu chưa nhận         |
| Hồ sơ hoàn đang mở          | Hồ sơ hoàn tiền chưa xong                           | Hoàn thực tế rồi ghi nhận                                   |
| Hỗ trợ/cảnh báo còn mở      | Loại vấn đề và số yêu cầu chưa nhận/đang xử lý      | Người phụ trách hoàn tất; việc cần quản trị chuyển quản trị |
| Hồ sơ thiếu tiền chưa chốt  | Quản trị chưa chốt hồ sơ thiếu tiền                 | Quản trị đối chiếu và quyết định                            |

Ở ví dụ trên, khi bếp nhận/bắt đầu làm, lý do đổi thành Món chưa chế biến xong. Bếp báo xong thì đổi thành Món chưa mang ra bàn. Phục vụ xác nhận đã mang món và mọi công việc/tiền đều xong thì mục này báo Bàn đã đủ điều kiện kết thúc. Nhân viên chỉ kết thúc sau khi khách đã rời bàn.

**Ba bước khác nhau: đã thu tiền → kết thúc phục vụ → dọn bàn.** Kết thúc chuyển bàn sang Chờ dọn, đưa vào Việc chung của các nhân viên. Mở Chi tiết bàn, dọn/kiểm tra bàn ghế và xác nhận Đã dọn xong; bàn mới Sẵn sàng. Bàn Chờ dọn không nhận phiên khách mới. Cách phân biệt Paid và Dirty cũng được dùng trong [Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist); quy tắc xác nhận cụ thể ở đây theo hệ thống hiện hành.

Danh sách xem trước và API đóng bàn dùng chung **close-readiness.ts**. API khóa phiên và kiểm tra lại trước khi ghi, nên dữ liệu thay đổi sau khi mở màn hình vẫn bị chặn đúng. Đóng theo ngoại lệ thiếu tiền cũng dùng các điều kiện công việc này, chỉ miễn điều kiện trả đủ và cảnh báo/hồ sơ thiếu tiền đúng phạm vi quyết định; không bỏ qua món, hỗ trợ hay hoàn tiền.

[Ảnh điện thoại: đúng món chưa được bếp nhận](evidence/experience-mobile-close-blocked-exact-dish.png) · [Ảnh dọn bàn của nhân viên thứ hai](evidence/experience-mobile-shared-cleaning-detail.png). Ảnh từ database thử riêng. Không thêm bảng/cột hay sửa dữ liệu vận hành trong đợt này.

## Đọc số thu và số hoàn trên màn hình khách

Khách đã trả trước hoàn là tổng thu ban đầu, không bị đổi thành 0 sau khi hoàn. Đã hoàn lại chỉ gồm giao dịch hoàn thành công; Còn chờ hoàn là số dư hiện tại. Nhà hàng còn giữ = tổng thu − tổng đã hoàn. Khi hoàn đủ cho một bàn có toàn bộ món bị hủy, màn hình ghi rõ đã hoàn đủ và giữ lịch sử các lần trả tiền. [Ví dụ và tự test ở bài 24](24-su-co-mon-va-phieu-thanh-toan.md).
