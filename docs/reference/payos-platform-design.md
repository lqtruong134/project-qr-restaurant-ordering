# Thiết kế nền tảng thanh toán payOS

Ngày lập: **22/10/2026**. Nhánh: `feat/payos-payment-platform`, nền `main` tại `6c45`. Đây là hồ sơ thiết kế đi cùng [nghiệp vụ thanh toán](../06-thanh-toan.md), [bằng chứng kiểm chứng](../15-doi-chieu.md) và [quy trình triển khai/khôi phục](../26-trien-khai-qtruongres.md). Không thay bộ tài liệu hiện hành bằng một bộ hướng dẫn vận hành khác.

**Phạm vi bàn giao hiện tại là M1: nền tảng cấp mã bền vững, kiểm kê reset chỉ đọc và hồ sơ thiết kế. M2 (nghiệp vụ chứng từ ngân hàng) và M3 (UI, E2E sâu, nghiệm thu triển khai) CHƯA được triển khai trên nhánh này. Không coi nhánh này là bản hoàn tất tính năng hoặc sẵn sàng deploy toàn bộ luồng mới.** Tên endpoint/type trong phần đề xuất bên dưới là thiết kế cho M2/M3, không phải API đã có. Trạng thái file/test cuối của M1 được chốt ở bài 15; tài liệu này không tự tuyên bố mọi test đã đạt.

## 1. Bằng chứng và giới hạn kết luận

| Bằng chứng | Điều đã biết | Điều không được suy ra |
| --- | --- | --- |
| Chủ dự án tự chạy diagnostic với giao dịch A10 / phiên 48A135F3 / 10.000đ | CREATE và QR cùng account 13 số; GET đã xác minh chữ ký, PAID và khớp order/link/amount; webhook v2 đủ điều kiện cùng primary 10 số; hai VA null | Không suy ra hai account cùng chủ chỉ từ độ dài hoặc hai thông báo có cùng primary |
| Kết quả công cụ riêng tư do chủ dự án xác nhận | Primary 10 số từ provider khớp chính xác tài khoản MB của đúng kênh được nhập từ nguồn độc lập | Input diagnostic không tự trở thành quyền ghi sổ, cấu hình backend hoặc bằng chứng payOS xác nhận mapping |
| Đối chiếu code | Nhánh thiếu VA không nối được primary với account CREATE, dẫn đến `WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE`; tiền báo nhận có thể có trước ledger/allocation | Không đồng nhất PAID, báo nhận, ghi sổ và phân bổ thành một trạng thái |
| Hotfix recipient hiện có ở nền | Cho phép bridge khi có backend binding đúng client/restaurant/bank/account, QR CREATE phù hợp và hai nguồn hợp lệ; VA mâu thuẫn vẫn bị chặn | Không dùng hotfix làm đường xác nhận thủ công mọi khoản lỗi hoặc bỏ qua receipt đến muộn/phiên đã chốt |

[FAQ chính thức payOS, câu 6](https://payos.vn/docs/cau-hoi-thuong-gap/) giải thích link VietQR Pro có thể hiển thị VA gắn với đơn và số tiền. [Mô tả công nghệ VA](https://payos.vn/tai-khoan-ao/) giải thích quan hệ VA với tài khoản chính. Đó là căn cứ cho khả năng hai biểu diễn có ngữ nghĩa khác nhau, không tự xác nhận metadata của một merchant cụ thể.

[API payOS](https://payos.vn/docs/api/) mô tả CREATE trả account/QR/link; [webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/) có account và VA; [tài liệu signature](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/) quy định kiểm tra tính toàn vẹn dữ liệu. SDK được khóa phiên bản trong repo; kiểu trường không phải bằng chứng account này ánh xạ sang account khác. Không gọi POST confirm-webhook chỉ để dò account vì có thể thay cấu hình webhook.

Không đưa account đầy đủ, khóa, token, nội dung sao kê hoặc bản ghi cá nhân vào hồ sơ, PR, fixture hay log. Không có việc đọc/sửa DB production, giao dịch thật hoặc xác nhận phục hồi tiền thật trong quá trình viết thiết kế này.

## 2. Luồng tự động hiện có và các khoảng trống

Luồng hiện có là STAFF lập khoản thu có phạm vi → backend giữ quote/order → CREATE payOS → GET/webhook có chữ ký → kiểm tra danh tính và số tiền → transaction ledger/allocation/outbox → read model STAFF/GUEST. ADMIN refresh và worker gọi cùng luồng xử lý provider; nhãn PAID hoặc redirect không tự làm giảm công nợ.

`PayosService.applyLink` kiểm tra orderCode, paymentLinkId, amount/tổng giao dịch, currency của webhook, reference, recipient và lịch sử. Webhook có inbox bền vững; các bước ghi sổ/phân bổ được transaction hóa. Reference được khóa advisory và unique ở namespace PAYOS. Worker có lease/next_poll_at, thử lại nhóm trạng thái đang xử lý và một số identity case có thể phục hồi. Thuộc tính này cần giữ khi tách service, không xây thêm một worker ghi sổ độc lập.

Các khoảng trống phải giải quyết theo mốc:

- Cấp orderCode bằng sequence trong DB ứng dụng chỉ chống trùng trong chính DB đó. Tạo DB sạch/restore snapshot cũ có thể tái sử dụng mã merchant đã dùng ngoài payOS.
- Các đường ghi tiền PAYOS và BANK_TRANSFER thủ công chưa dùng một receipt identity chung. Manual hiện lưu reference trong metadata, chống trùng reference chủ yếu trong method BANK_TRANSFER; PAYOS lại dùng provider_transaction_id. Một khoản ngân hàng có thể bị biểu diễn qua hai đường nếu chỉ dựa vào các unique hiện hữu.
- Proof upload hiện tại phục vụ STAFF cho BANK_TRANSFER đang chờ; không phải cơ chế ADMIN xác minh ngoại lệ payOS.
- Giao dịch đến muộn hoặc phiên đã chốt cần xử lý theo bằng chứng và phạm vi phiếu bất biến. Hết hạn tại lúc retry không tự chứng minh khách chuyển muộn; ngược lại không được lấy giờ người dùng tự nhập để hợp thức hóa receipt chưa có chứng cứ.
- Thông báo chung từ refresh FAILED/WAITING không đồng nghĩa recipient mismatch. Không bắt bỏ exception hoặc đổi copy thành thành công để che lỗi kỹ thuật.
- Đóng cảnh báo, xác minh bank, ghi sổ, phân bổ và hoàn thực tế là những bước khác nhau. Một token preview hoặc ảnh tải lên không thay thế bước ghi sổ có khóa và audit.

## 3. Một receipt, nhiều nguồn bằng chứng

Giữ riêng ba khái niệm:

| Trường/khái niệm | Ý nghĩa |
| --- | --- |
| `provider=PAYOS` | Nguồn payment link/order và namespace provider, không tự mô tả ai đã xác minh ngân hàng |
| `verificationSource=PAYOS_VERIFIED` | Dữ liệu provider đủ điều kiện và được tự động xác minh qua pipeline |
| `verificationSource=BANK_ADMIN_VERIFIED` | ADMIN đã đối chiếu nguồn ngân hàng độc lập, thao tác có trách nhiệm và chứng từ; không được ghi là payOS đã tự xác minh |
| Ledger receipt | Một lần thực nhận; chỉ một bản ghi tiền cho cùng giao dịch ngân hàng, bất kể có bao nhiêu webhook/chứng cứ |
| Allocation | Phần receipt đã trả cho các charge đúng phạm vi khoản thu |
| Refund | Việc trả tiền thực tế có transaction/chứng từ riêng; duyệt phiếu chưa phải đã hoàn |

Provenance nên lưu ở mức receipt/evidence, gồm người thực hiện, thời điểm, source, phiên bản policy, hash chứng từ và các provider/bank identifiers liên quan trong phạm vi bảo vệ. Nếu một intent có nhiều receipts từ nhiều nguồn, read model phải hỗ trợ nguồn hỗn hợp hoặc danh sách provenance; không gán cả intent là PAYOS chỉ vì link thuộc payOS.

Tiền báo nhận, đã ghi sổ, đã phân bổ, chưa phân bổ, cần hoàn và đã hoàn vẫn do backend canonical projection tính. UI không cộng lại từ nhãn trạng thái hoặc suy luận từ source.

## 4. Shared posting và chống ghi trùng xuyên provider

M2 cần một hàm posting dùng chung cho payOS tự động, bank evidence của ADMIN và chuyển khoản thủ công phù hợp. Hàm chịu trách nhiệm kiểm tra tenant/session/intent, khóa receipt identity, insert một lần, allocation đúng scope, phần dư, audit, outbox và projection. Không copy vòng allocation sang một service khác.

Receipt identity ngân hàng cần dựa trên **tài khoản thụ hưởng tin cậy + reference ngân hàng chính xác**, không chỉ method/provider/amount. Nếu cùng tài khoản vật lý được dùng ở nhiều channel hoặc nhà hàng, registry phải phát hiện việc một receipt đã được claim trước, rồi kiểm tra đúng tenant thay vì cho phép double claim vì khác namespace. ID receiver phải ổn định và kín, không đưa số tài khoản vào khóa hiển thị/log.

Giữ cả namespace provider và canonical bank identity, với unique/locking phù hợp ở DB. Các trường hợp không chứng minh được reference ngân hàng tương ứng phải đưa về đối soát. Không tự gộp bằng số tiền, giờ gần nhau, tên khách, suffix account hoặc ảnh giống nhau.

Khi webhook đến sau một receipt BANK_ADMIN_VERIFIED:

1. Chỉ nâng/gắn thêm bằng chứng khi reference, intent, amount, order/link, tenant và receiver đều khớp chính xác cùng receipt đã lưu.
2. Khóa cùng receipt identity và intent; thêm evidence/audit idempotent, không INSERT một payment_transaction hoặc allocation thứ hai.
3. Không sửa lịch sử source thành một câu chuyện khác: lưu rằng tiền đã được ghi nhận nhờ bank/admin và sau đó provider bổ sung bằng chứng.
4. Reference mới hoặc dữ liệu mâu thuẫn phải vào inbox/quarantine để xác minh. Trong đường nối receipt cũ, cùng amount không được coi là duplicate. Một khoản tiền thật khác vẫn phải được phân biệt và xử lý bằng nghiệp vụ thu/hoàn, không bị âm thầm bỏ qua.

## 5. Luồng ADMIN hai bước dự kiến cho M2/M3

Đây là ngoại lệ có audit, không phải nút “ép PAID”.

Bước nhập chứng cứ: backend trả readonly các facts đã biết như bàn/phiên, quote, order/link, reference provider, số ngân hàng báo, recipient được che và lý do chặn. ADMIN chỉ bổ sung các trường sao kê còn thiếu, chứng từ và lý do đối chiếu. Không yêu cầu gõ lại định danh provider đã biết; không cho sửa amount/intent trên form để vượt policy.

Bước preview: server xác thực quyền ADMIN và tenant, đọc fresh provider/bank evidence cần thiết, kiểm tra receiver binding và thời điểm, tìm duplicate claim, tính tác động tiền mà chưa ghi sổ. Trả token ngắn hạn ràng buộc với actor, tenant, intent/version, input chuẩn hóa, proof ID/hash, facts và policy snapshot. Token không chứa secret/plain account trong client và không được xem là quyền ghi sổ vĩnh viễn.

Bước confirm cuối: ADMIN đọc tóm tắt nguồn BANK_ADMIN_VERIFIED, receipt/allocation/phần dư/công nợ sau xử lý và tick xác nhận đã đối chiếu nguồn ngân hàng độc lập. Mutation kiểm lại quyền, token/hạn, versions, hash/chứng từ, provider identity và balance **dưới khóa**. Thay dữ liệu hoặc có webhook xen giữa phải trả kết quả idempotent nếu đã cùng receipt, hoặc yêu cầu preview mới; không tự áp lại preview cũ.

Proof phải lưu riêng có quyền đọc ADMIN, MIME/magic bytes và dung lượng giới hạn, tên file server sinh, hash nội dung, không URL tùy ý. Ảnh khách gửi hoặc câu ghi chú không tự chứng minh tài khoản nhà hàng đã nhận. Cần provenance rõ việc ADMIN xác minh trực tiếp sao kê/app bank của đúng receiver. Không dùng OCR/AI hoặc file upload như xác minh cryptographic.

Thời điểm hợp lệ phải được đối chiếu với bằng chứng đáng tin cậy và lịch sử quote; không chỉ giờ do ADMIN tự gõ. Không đổi expires_at, quote amount hoặc số dư để cứu một khoản cũ. Phiên đã chốt giữ nguyên receipt snapshot; ngoại lệ đến muộn đi đường được thiết kế riêng và phải có đầy đủ ngân hàng/hoàn tiền, không mở lại phiếu lịch sử.

### Contract API/UI đề xuất, chưa tồn tại ở M1

Tên endpoint và field cần được chốt trước khi triển khai; bảng này không phải Swagger hiện hành.

| API đề xuất | Request đáng chú ý | Response/guard |
| --- | --- | --- |
| GET `/core/admin/payment-reconciliation/:id/bank-evidence` | Không lấy account/reference từ query tùy ý | Readonly facts đã che, khả năng xử lý, blockers, evidence/provenance hiện có |
| POST `.../:id/bank-evidence/proof` | Nội dung file giới hạn theo policy | Proof ID, MIME, hash, thời điểm; URL đọc có quyền, không đường dẫn storage |
| POST `.../:id/bank-evidence/preview` | Request ID, proof ID, bank reference/thời điểm còn thiếu, note | Preview token, expiresAt, canConfirm, blockers, readonly facts, recordedDelta/allocatedDelta/unallocatedDelta/outstandingAfter; chưa ghi tiền |
| POST `.../:id/bank-evidence/confirm` | Preview token, request ID, xác nhận cuối | Revalidate dưới khóa, shared posting idempotent, receipt/evidence/source và snapshot mới |

UI ADMIN nên dùng dialog riêng với bước preview/confirm rõ ràng, dữ liệu provider chỉ đọc, proof protected, chống double submit, mất hiệu lực preview khi sửa input và xử lý token hết hạn/stale state. Backend luôn là nơi quyết định canConfirm/blockers; ẩn nút không thay authorization.

STAFF chỉ thấy số dư và hướng dẫn việc cần làm, không được upload/xác nhận bank exception thay ADMIN. GUEST không nhận reference nội bộ, account hoặc ảnh sao kê. Cả STAFF/GUEST cần copy phân biệt “payOS tự xác minh” với “Nhà hàng đã đối chiếu qua quản trị”; không dùng câu “tự động qua payOS” cho BANK_ADMIN_VERIFIED.

Các contract OnlinePaymentView, GuestOnlinePayment và PaymentReconciliationCase cần provenance phù hợp. Fingerprint/polling phải theo dõi provenance và trạng thái evidence ngoài amount/status để UI không giữ source cũ khi tiền không thay đổi.

## 6. OrderCode bền vững qua DB sạch và restore

M1 đặt nền tảng allocator ngoài vòng đời DB ứng dụng mới. Allocator phải có namespace gắn đúng merchant/channel, counter/high watermark bền vững, khóa giữa nhiều process và reserve mã trước request CREATE. Mã đã reserve hoặc CREATE có kết quả chưa rõ tuyệt đối không tái sử dụng. Khởi động phải fail closed nếu durable state chưa được khởi tạo hợp lệ hoặc đã hỏng hoặc namespace cấu hình không khớp.

Giữ miền số nguyên an toàn của payOS/JavaScript; không chuyển sang mã thời gian có thể trùng, random không có uniqueness registry, hoặc tự set sequence từ max trong một DB sạch. Gaps sau lỗi là chấp nhận được; tái dùng mã cũ thì không.

Durable allocator state cần backup/restore riêng và không rollback lùi theo snapshot DB. Môi trường mới phải reconcile high watermark với lịch sử merchant/allocator trước khi cho tạo order mới. Test phải bao phủ process đồng thời, restart, DB application khác, counter hỏng và exhaustion. Việc có module allocator ở M1 chưa xác nhận production đã mount đúng persistent state.

## 7. DB sạch, archive và reset an toàn

M1 chỉ có **inventory/dry-run**, không executor xóa/reset. Công cụ không được coi tên “demo”, tuổi dữ liệu, user xác nhận chung hoặc amount 0 là chứng minh không có tiền thật. Intent có provider/ONLINE/payOS linkage, ledger, allocation, refund, webhook hoặc kết quả bên ngoài chưa rõ phải được giữ/đưa vào archive. Dữ liệu không xác định mặc định retain.

Kế hoạch chỉ đọc phải dùng READ ONLY/ROLLBACK, scope restaurant, output counts/trạng thái đã che và blockers. Hash của aggregate report chỉ phục vụ review; không phải token cho phép xóa dữ liệu hay row-level manifest. Chưa chứng minh backup/restore, allocator và routing archive thì không có quyền reset.

Handover tương lai cần:

1. Backup được mã hóa/bảo vệ, kiểm tra restore thành công trên môi trường cách ly; giữ DB cũ bất biến hoặc quyền read-only, không xóa ledger/audit/chứng từ.
2. Inventory các order/link/reference cũ, các khoản PAID chưa ghi sổ, unmatched webhooks, refunds và mọi trạng thái bên ngoài chưa rõ.
3. Durable order allocator tiếp tục tiến, không reset cùng DB mới.
4. **Một webhook writer có thẩm quyền tại một thời điểm** cho mỗi channel. Không để app cũ và app mới cùng xử lý/ghi sổ một merchant event.
5. Routing cũ/mới dựa trên mapping order/link đã đăng ký. Event cũ đến muộn chuyển archive inbox/luồng đối soát đúng hồ sơ cũ; không ghép vào bill của DB mới bằng amount hoặc số bàn.
6. Event không biết mapping phải lưu inbox/quarantine bền vững, xác minh chữ ký và xử lý có trách nhiệm; không auto-assign hay ACK rồi bỏ mất.
7. Plan cutover và rollback phải bảo toàn mọi receipt/evidence đã phát sinh sau cutover. Rollback code không được restore DB cũ đè lên sổ mới hoặc rewind allocator.

Triển khai, migration, đổi writer/webhook route, mount state, archive và rollback đều là bước operator có kế hoạch riêng ở [bài 26](../26-trien-khai-qtruongres.md), không phải hành động đã thực hiện bởi hồ sơ này.

## 8. Mốc nghiệm thu và điều kiện kết thúc

| Mốc | Phạm vi | Điều kiện/giới hạn |
| --- | --- | --- |
| M1 — nền tảng hiện tại | Durable order allocator, reset inventory chỉ đọc, kiến trúc/bằng chứng và kiểm thử tương ứng | Kết quả thực chạy ghi ở [bài 15](../15-doi-chieu.md); không có reset executor, bank-evidence mutation hoặc UI mới hoặc quyền tự cutover |
| M2 — backend, CHƯA triển khai | Schema/evidence registry, preview/confirm, protected proof, shared posting, cross-provider dedup, late webhook attachment, migration cần thiết | Integration cách ly cho success/deny/replay/concurrency/rollback; không fake provider success từ một ảnh |
| M3 — UI và nghiệm thu sâu, CHƯA triển khai | ADMIN hai bước, provenance STAFF/GUEST, UI lỗi/stale state, E2E desktop/mobile, triển khai/rollback rehearsal | Chỉ báo deploy-ready sau M2/M3 hoàn tất và test đạt; production acceptance do chủ dự án thực hiện theo kế hoạch |

M2 phải có test exact recipient mapping, sai client/tenant/account/VA, invalid signature/order/link/reference/amount, quyền STAFF/GUEST, proof mismatch, token replay/expiry/stale state, concurrent confirm/webhook/refresh, bank/manual cross-provider duplicate, unknown reference và phiên đã chốt/tiền đến muộn. Một receipt, một lần allocation, một audit/outbox phù hợp; lỗi DB phải rollback toàn bộ.

M3 phải kiểm tra bank-reported/recorded/applied/outstanding/refund trên cùng snapshot backend; trường provider readonly; chứng từ không lộ cho guest/staff; BANK_ADMIN_VERIFIED không bị gắn nhãn PAYOS; nhập/sửa proof sau preview buộc xác minh lại; refresh tự cập nhật và reload không gửi lại confirm. Giữ nguyên Quality gate, không bỏ test/skip/nới assertion để lấy PASS.

Hồ sơ này được viết từ code/schema/fixture và bằng chứng do chủ dự án cung cấp. Không tự chạy migration, reset/archive thực, giao dịch payOS hoặc kiểm thử ngân hàng thật. M2/M3 còn thiếu là công việc chưa hoàn thành, không được mô tả như đã có chỉ vì endpoint/flow được đề xuất ở trên.
