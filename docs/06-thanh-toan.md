# 06. Hiểu tiền, hóa đơn và điều kiện đóng bàn

## Lưu trữ ngoại lệ test có tiền thật — 25/10/2026

Hai intent A01/A02 được lưu riêng bằng marker bất biến và inbox webhook riêng; status PAID của provider không biến thành receipt hoặc phân bổ. Chặn polling/refresh/ghi sổ lại và giữ nguyên công nợ. [Runbook riêng](reference/payos-test-archive-20261025.md) liệt kê chính xác bảng/bản ghi, kiểm tra full UUID/checksum và rollback hiển thị; không hỗ trợ xóa vật lý hay hoàn tiền giả.


## Nền tảng thanh toán M2/M3 — 23/10/2026

Nhánh `feat/payos-payment-platform`, PR #3 bổ sung xác minh tự động tài khoản MB chính, chứng từ ngân hàng ADMIN hai bước, shared posting và nguồn xác minh rõ ràng cho cả ba vai trò. Kết quả nghiệm thu phần mềm hiện hành ở [bài 15](15-doi-chieu.md); [thiết kế](reference/payos-platform-design.md), [API](17-api.md) và [backup/rollback](26-trien-khai-qtruongres.md) đã cập nhật. Chưa merge, chưa triển khai hoặc xác nhận khoản A10 thật; test chỉ dùng dữ liệu tổng hợp.

### Luồng tự động và tài khoản ảo

Signed GET của đúng kênh có thể trả tài khoản MB chính khác account/VA từ signed CREATE/QR. Backend chấp nhận primary chỉ khi binding riêng khớp đầy đủ client/restaurant/BIN MB/tài khoản chính, QR CREATE khớp anchor và paymentLinkId GET khớp link đã lưu. Không còn bắt buộc chờ webhook cho trường hợp GET này đã đủ bằng chứng. Nếu webhook có mặt, mọi đối chiếu vẫn phải khớp; VA rõ ràng mâu thuẫn, chữ ký sai, order/link/reference/amount sai hoặc thiếu binding vẫn bị chặn. Không suy ra quan hệ từ độ dài tài khoản hoặc output diagnostic.

### ADMIN đối chiếu độc lập với ngân hàng

ADMIN vào **Việc cần xử lý → Ngoại lệ thanh toán → Xác minh qua ngân hàng**. Khoản lỗi kết nối `ERROR` đang mở cũng có thể truy cập; QR PENDING bình thường vẫn theo luồng tự động. Facts provider chỉ đọc, tài khoản nhận được che; ADMIN tải chứng từ PNG/JPEG/WebP tối đa 2 MB, nhập đúng reference/số thực nhận/thời điểm có múi giờ và xác nhận đã trực tiếp xem sao kê/app MB của nhà hàng. Ảnh khách gửi không tự chứng minh tiền vào tài khoản.

**Xem trước** đối chiếu provider rồi trả tác động tiền cùng token 2 phút, chưa tạo receipt/allocation. **Xác nhận cuối** kiểm tra lại quyền, tenant, chứng từ/hash, quote/version, số dư và phạm vi dưới khóa. Chứng từ đã dùng, token sai/hết hạn, quyền bị thu hồi hoặc facts thay đổi bị từ chối; replay đã thành công trả receipt cũ. Hết hạn quote chỉ được phục hồi khi có bằng chứng provider đã được hệ thống quan sát đúng hạn, không chỉ giờ ADMIN tự gõ. Phiên đã chốt giữ nguyên phiếu và bị chặn đường phân bổ này.

Receipt có source `PAYOS_VERIFIED` hoặc `BANK_ADMIN_VERIFIED`; intent có thể `MIXED`. ADMIN không làm provider_status thành PAID hoặc làm tăng số tiền payOS báo. STAFF/GUEST hiển thị số đã ghi sổ/phân bổ cùng nguồn thực tế; khách không nhận chứng từ, reference ngân hàng, tài khoản hoặc định danh nội bộ. Webhook đến sau chỉ bổ sung bằng chứng cho cùng receipt khi toàn bộ định danh/amount/receiver khớp, không ghi lần hai. Reference khác hoặc mâu thuẫn tiếp tục đối soát, không gộp bằng số tiền.

Cả hai nguồn dùng một hàm posting và identity **hash receiver tin cậy + exact reference**, có unique/lock xuyên nguồn. Chuyển khoản STAFF còn kiểm tra reference/chứng từ đã dùng; không tạo thêm receipt PAYOS từ khoản đã xác nhận thủ công. Mọi receipt/allocation/evidence/outbox/audit nằm trong cùng transaction.

Ví dụ bill 20.000đ, quote 10.000đ, thực nhận 12.000đ: ghi sổ 12.000đ, phân bổ tối đa 10.000đ, còn nợ 10.000đ và cần hoàn 2.000đ. Xem trước ADMIN cũng tách bốn số này. Duyệt hoàn chưa phải hoàn thực tế; chỉ đóng đối soát khi đúng nguồn đã hoàn thành công và không còn tiền/tham chiếu chưa xử lý. Chứng cứ ngân hàng độc lập đủ điều kiện có thể đóng nghĩa vụ tài chính sau hoàn dù provider đang PENDING, nhưng vẫn giữ nguyên facts provider và tiếp tục đối chiếu nền.

### Nền tảng M1 được giữ nguyên

Khi lập khoản payOS mới, service dùng allocator SQLite theo namespace Client ID, giữ high-water qua restart hoặc thay DB. Reservation được ghi bền vững trước khi request tạo link; transaction ứng dụng rollback có thể để khoảng trống mã nhưng không được cấp lại mã đó. Sequence PostgreSQL cũ vẫn giữ nguyên để tương thích schema/lịch sử; **M1 không thêm migration và không reset sequence**.

Production cố định `PAYOS_ORDER_CODE_STORE=/data/payos-state/order-codes.sqlite` trong volume `runtime_data`, tách khỏi volume PostgreSQL. Dev mặc định là `var/payos-state/order-codes.sqlite` ở gốc repo, suy ra từ `import.meta.url`, không đổi theo working directory của tiến trình. Store/channel chưa khởi tạo hợp lệ hoặc hỏng phải dừng cấp mã; không tự lấy max trong DB mới hay giờ hiện tại làm lịch sử merchant.

Có CLI khởi tạo **tường minh** ở `scripts/payos-order-code-store.ts`, chạy bằng maintenance service `payos-state` với UID 10001. Lệnh mặc định chỉ in `--help`; không mở DB, ghi state hoặc gọi payOS. Initialize cần watermark do operator đã kiểm chứng với **mọi DB/archive/provider và durable state cũ**, cùng `--confirm-channel-history`; CLI chỉ kiểm tra thêm READ ONLY rằng watermark không thấp hơn max trong DB đang trỏ tới. Cờ này là cam kết người vận hành, không phải xác minh lịch sử provider tự động. Không đưa watermark đoán hoặc giá trị 0 vào kênh đang có giao dịch; DB sạch không chứng minh kênh mới. Chỉ thực hiện bootstrap sau đợt review/cutover được chấp thuận, mọi writer cũ đã được fence và backup/restore đã kiểm chứng.

M2 thêm migration **`202610230001_bank_payment_evidence/migration.sql`** cho receipt identity, chứng từ private, preview và evidence bất biến. Các migration SQL cũ không đổi. Allocator M1 tiếp tục nằm ngoài DB ứng dụng; không reset cùng dữ liệu vận hành.

Các mục bên dưới là lịch sử hotfix/điều tra; quy tắc hiện hành M2/M3 ở đầu bài được ưu tiên. Không có xác nhận cutover hoặc giao dịch production trong đợt phát triển này.

## Hotfix MB: tài khoản QR khác tài khoản ngân hàng chính — 22/10/2026

**Đã sửa trên PR #2, chưa triển khai production.** Chủ dự án xác nhận công cụ riêng tư so khớp chính xác primary 10 số với tài khoản MB của đúng kênh. Bằng chứng trước đó: CREATE/QR cùng tài khoản 13 số; signed GET PAID 10.000đ và webhook v2 hợp lệ cùng primary 10 số, cả hai VA null. Nguyên nhân guard: code chỉ biết anchor CREATE/VA nên không nối được hai biểu diễn tài khoản. [FAQ chính thức payOS](https://payos.vn/docs/cau-hoi-thuong-gap/) giải thích VietQR Pro dùng tài khoản ảo theo đơn; **hotfix vẫn không lấy lời xác nhận hoặc output chẩn đoán làm quyền ghi sổ**.

### Quy tắc xác minh mới, mặc định vẫn chặn

Nhánh primary bridge chỉ mở khi backend có binding độc lập do người vận hành cấu hình, khóa đúng **Client ID hiện tại + restaurant ID + BIN MB 970422 + tài khoản chính chính xác**. Link đã lưu phải tồn tại và khớp GET được payOS ký bằng khóa của kênh; QR lưu từ CREATE đã ký phải có BIN MB và tài khoản bằng anchor CREATE. GET và webhook v2 cùng primary bằng binding, cả hai thiếu VA hợp lệ về kiểu dữ liệu; webhook vẫn phải khớp chữ ký đã xác minh, tenant/order/link/reference/amount/VND/code. Bất kỳ VA rõ ràng nào mâu thuẫn vẫn chặn.

Không so theo độ dài/tiền tố/hậu tố. Không dùng GET hoặc webhook tự khai báo tài khoản kỳ vọng. Thiếu/sai binding, thiếu CREATE/QR/link, thiếu webhook hoặc sai chữ ký/định danh/số tiền thì không đi qua bridge. Quy tắc khớp trực tiếp/exact VA hiện có giữ nguyên. Đây là binding backend tin cậy, **không phải một API tự lấy cấu hình tài khoản kênh từ payOS**; signed GET đúng link ràng buộc response với credential/kênh đã cấu hình.

### Cấu hình riêng trước khi chủ dự án deploy

Template thêm đúng một biến tùy chọn `PAYOS_RECIPIENT_BINDING`; compose truyền biến này vào API. Người vận hành tự nhập vào cấu hình production riêng đang được bảo vệ; không đổi/rotate Client ID, API key, checksum key hay AUTH_SECRET. Cấu trúc minh họa bên dưới chỉ có placeholder, không phải lệnh để chạy hoặc dữ liệu để commit:

```dotenv
PAYOS_RECIPIENT_BINDING='{"clientId":"CURRENT_PAYOS_CLIENT_ID","restaurantId":"CURRENT_RESTAURANT_ID","bankBin":"970422","accountNumber":"EXACT_LINKED_MB_PRIMARY_ACCOUNT"}'
```

Thay placeholder bằng giá trị chính xác của **đúng kênh và nhà hàng** sau đối chiếu riêng tư. Không đưa số tài khoản thực vào chat/PR/log. Nếu để trống, fallback mới bị tắt và giao dịch 13→10 vẫn chặn. Nếu JSON/kiểu dữ liệu sai, startup báo lỗi cấu hình chung, không in nội dung binding. Bản vá không sửa tệp env thật, không chứa tài khoản thật, không thêm dependency/schema/migration và không thay compose dev hoặc Quality gate.

### Khoản A10 cũ và thao tác ADMIN

Ngoài recipient, khoản cũ phải còn phiên ACTIVE, không bị hủy và không có tiền cách ly/ngoại lệ khác. Nếu hạn chỉ đã qua trong lúc chờ sửa identity, backend chỉ bỏ kiểm tra expiry theo thời điểm retry khi có **audit PAYOS_PROVIDER_REPORTED đã tồn tại trong khoảng created_at ≤ thời điểm quan sát < expires_at**. Audit phải gắn đúng intent/tenant/order/link/số tiền và toàn bộ references hiện tại; số tiền 0đ của lúc tạo QR không đủ. Không diễn giải timestamp ngân hàng thiếu múi giờ và không sửa thời hạn/DB để làm khoản thu hợp lệ.

Nhánh bridge mới dừng trước ledger/allocation khi hết hạn/hủy hoặc phiên đã đóng mà không đủ bằng chứng nhận đúng hạn. Không ép SUCCEEDED, không sửa phiếu đã chốt. Webhook/refresh lặp dùng khóa và unique reference hiện có nên không tạo giao dịch/phân bổ lần hai.

Sau khi chủ dự án tự review/deploy mã và cấu hình binding: vào **ADMIN → Việc cần xử lý → Ngoại lệ thanh toán payOS**, mở A10 / #48A135F3 rồi chọn **Đối chiếu lại với payOS**. Nếu đủ bằng chứng, hệ thống tự ghi sổ 10.000đ và áp 10.000đ vào đúng phạm vi hóa đơn, tự kết thúc ngoại lệ; không cần ADMIN bấm xác nhận thu thủ công. STAFF/GUEST nhận số dư từ backend như cũ. Bấm đối chiếu lại lần nữa phải giữ số tiền không đổi. Nếu thiếu audit đúng hạn, đã hủy/đóng phiên hoặc có bằng chứng mâu thuẫn, hồ sơ tiếp tục OPEN; không sửa DB để vượt chặn.

Kiểm chứng hotfix: **45 unit** (16 bài binding mới + 29 normalization hiện có), **13 integration được chọn** (8 regression MB mới + 5 ca VA/idempotency/late hiện có), **27 bài công cụ chẩn đoán** đều đạt. API và tools typecheck, lint các file thay đổi, format, secret check và compose config với biến giả đạt. Integration chỉ dùng PostgreSQL tmpfs riêng, localhost và credential giả; fixture tự tạo/migrate/xóa DB thử nghiệm có tên ngẫu nhiên. Audit append-only giữ nguyên; lịch sử fixture được tạo bằng INSERT, không tắt trigger hoặc UPDATE audit. Không chạy toàn Playwright/E2E, không thay Quality gate và không đọc/sửa production DB/env/secrets. CI hiện hữu vẫn chạy độc lập khi push; kết quả local không thay thế trạng thái GitHub.
Các phần chẩn đoán bên dưới ghi lịch sử điều tra trước hotfix. Chỉ output chẩn đoán không chứng minh sổ đã cập nhật; lấy số ghi sổ/phân bổ và trạng thái backend làm kết quả nghiệm thu.

## Đối chiếu bằng chứng MB của phiên A10 — 21/10/2026

**Đã chứng minh chính xác nhánh từ chối; chưa chứng minh mapping của hai tài khoản.** Chủ dự án đã tự chạy diagnostic trên production và báo: CREATE/QR cùng tài khoản 13 số; GET có chữ ký hợp lệ, PAID 10.000đ và mọi kiểm tra order/link/amount đều khớp; webhook v2 đủ điều kiện; GET/webhook cùng tài khoản 10 số, cả hai VA đều null. Helper dừng ở `WEBHOOK_DOES_NOT_BRIDGE_TO_CREATE`: primary khớp nhau nhưng `recipientMatches(CREATE.accountNumber, webhook)` vẫn false.

Độ dài 10 số và ngân hàng MB **không chứng minh đúng tài khoản nhận**. [FAQ chính thức payOS, câu 6](https://payos.vn/docs/cau-hoi-thuong-gap/) xác nhận link qua VietQR Pro có thể dùng tài khoản ảo theo đơn/số tiền; [mô tả tài khoản ảo](https://payos.vn/tai-khoan-ao/) giải thích VA liên kết với tài khoản chính. Đây là cơ sở cho khả năng khác ngữ nghĩa, không phải xác nhận merchant này đang dùng loại liên kết đó hay hai giá trị cụ thể có mapping. SDK 2.0.5 chỉ khai báo `accountNumber`/`virtualAccountNumber`, không cung cấp API read-only xác nhận mapping của kênh trong phần paymentRequests. Không gọi POST confirm-webhook để lấy tài khoản vì thao tác đó có thể thay cấu hình webhook.

### Bước tiếp theo duy nhất: so sánh riêng tư với tài khoản MB của đúng kênh

Tại thư mục gốc repository trong terminal WSL/bash tương tác, với tệp mới từ PR #2:

```bash
node scripts/payos-recipient-compare.mjs --table A10 --session 48A135F3
```

Mở **đúng kênh payOS đang cấu hình**, xem tài khoản MB chính đã liên kết và đối chiếu với app MB. Nhập tài khoản đó tại lời nhắc terminal; ký tự không hiển thị, không ghi lịch sử nhập. Không dán số tài khoản vào lệnh, chat, PR, ảnh chụp hoặc log. Công cụ kiểm tra định dạng 10 chữ số theo thông tin chủ dự án đã cung cấp, nhưng kết quả so sánh dùng **toàn bộ chuỗi chính xác**, không dùng độ dài, hậu tố hoặc tiền tố.

Account chỉ đi qua bộ nhớ và stdin của tiến trình chẩn đoán, không qua argv, biến môi trường, shell expansion hoặc tệp tạm. Tool tái sử dụng signed GET và transaction READ ONLY/ROLLBACK của diagnostic, không chạy server, refresh, worker hoặc đăng ký webhook. Node code truyền vào Docker là mã tĩnh; dữ liệu riêng nằm riêng trong stdin. Lỗi container/SDK/DB thô bị giữ kín; output được lọc lại chỉ còn boolean và trạng thái cho phép. Không cần build/deploy/restart và người chuẩn bị công cụ không chạy lệnh này trên production.

Gửi lại JSON gồm `getMatchesEnteredMb`, `eligibleWebhookMatchesEnteredMb`, `getChecksAllMatch`, `createMatchesQrAccount` và các cờ khác. `true` chỉ có nghĩa dữ liệu provider khớp **tài khoản do người vận hành nhập từ nguồn độc lập**, không phải API tự xác minh cấu hình kênh; công cụ không tạo allowlist, không lưu mapping hoặc xác nhận tiền. Tài khoản nhập sai cùng độ dài phải trả false; thiếu dữ liệu trả null. Nếu không tìm được thông tin tài khoản của đúng kênh, dừng thay vì nhập giá trị đoán từ giao dịch.

### Vì sao nút đối chiếu từng báo lỗi chung?

Theo code, recipient mismatch trả `REQUIRES_RECONCILIATION`, rồi `process` trả `UPDATED`; `refreshForAdmin` trả view, không tự ném lỗi 503. Thông báo chung xuất hiện khi `process` gặp exception và trả `FAILED`, hoặc snapshot chưa đủ trả `WAITING`. Vì vậy chưa thể kết luận lỗi chung trước đây chỉ do recipient. Diagnostic GET thành công hiện tại không chứng minh lần refresh trước không gặp lỗi mạng/chữ ký/xử lý; chưa có log thời điểm tương ứng để kết luận. Không thay thông báo hoặc bắt/bỏ lỗi để che một nguyên nhân chưa được chứng minh.

### Giới hạn phục hồi khoản cũ và kiểm thử

Chưa có bản sửa chấp nhận thanh toán để deploy/nghiệm thu ADMIN. Sau khi có mapping đủ chứng cứ mới sửa và kiểm thử ghi sổ/phân bổ/idempotency. Hiện scheduler/ADMIN refresh có đường retry identity case, nhưng vẫn chặn phiên đã chốt, quote đã hủy/hết hạn, tiền dư hoặc dữ liệu mâu thuẫn. Đáng chú ý, `quoteInvalidatedAtReceipt` hiện so expires_at với thời điểm retry, chưa dựa trên thời điểm ngân hàng nhận. Công cụ bổ sung `quoteExpiredNow` và `cancelRequested` để biết liệu khoản 10.000đ cũ còn vướng guard này; không tự sửa expiry hay số dư để phục hồi.

Kiểm thử tập trung đạt: **18 bài diagnostic, 8 bài private comparison, 29 unit normalization**. Có ca 13/10 số thiếu VA tái hiện đúng nhánh chặn, tài khoản khác cùng độ dài, nhập ẩn/Ctrl+C, không lộ dữ liệu qua argv/env/output/lỗi, bootstrap thực thi Node với module DB/provider giả, READ ONLY/ROLLBACK và signed GET giả chống sửa payload. Đây là kiểm thử công cụ và guard hiện hữu; chưa phải regression ghi sổ thành công/duplicate webhook của một bản sửa payment mới. Không chạy E2E, không đọc DB/payOS production, không đổi logic nghiệp vụ, secrets, migration hoặc workflow Quality gate.

## Chẩn đoán recipient A10 / #48A135F3 — 21/10/2026

**Chưa chứng minh được nguyên nhân gốc của giao dịch thật 10.000đ.** Bản này chỉ bổ sung công cụ đọc bằng chứng, không sửa `payos.service.ts`, `payos-normalization.ts`, trạng thái tiền, allocation hoặc quy tắc bảo mật. Báo nhận 10.000đ / ghi sổ 0đ / phân bổ 0đ phù hợp với nhánh recipient bị chặn, nhưng chưa cho biết trường tài khoản nào gây chặn.

Code hiện lưu `CREATE.accountNumber` làm tài khoản kỳ vọng. Khi GET hoặc webhook có `virtualAccountNumber` rõ ràng, helper ưu tiên VA và yêu cầu VA khớp tài khoản kỳ vọng. Nếu GET thiếu VA và primary khác tài khoản kỳ vọng, cần webhook đã xác minh khớp primary và chứng minh VA đúng. Webhook chỉ được dùng khi khớp chữ ký đã xác minh, nhà hàng, orderCode, paymentLinkId, reference, amount, VND, code 00 và recipientEvidenceVersion 2. Bấm đối chiếu dùng lại cùng điều kiện, không vượt qua guard.

[API chính thức](https://payos.vn/docs/api/) mô tả CREATE trả `accountNumber` và QR. [Webhook chính thức](https://payos.vn/docs/du-lieu-tra-ve/webhook/) có cả `accountNumber` và `virtualAccountNumber`; SDK đang khóa ở `@payos/node 2.0.5` cũng khai báo hai trường trên transaction GET. Các tài liệu này không chứng minh tài khoản chính và VA của giao dịch đang bị chặn có quan hệ gì; không dùng chúng để tự nới guard.

### Một lệnh để chủ dự án chạy trên production

Chạy từ thư mục gốc repository trong **WSL/bash**, khi đã có tệp [scripts/payos-recipient-diagnostic.mjs](../scripts/payos-recipient-diagnostic.mjs) từ nhánh `fix/payos-recipient-diagnostic`. Container API hiện tại phải đang chạy. Lệnh truyền công cụ qua stdin vào container hiện có; **không cần build image, deploy, chuyển mã đang chạy, migration, restart hoặc nạp lại secrets**. Người chuẩn bị bản này chưa chạy lệnh trên production.

```bash
docker compose --env-file deploy/.env.production -f compose.production.yaml exec -T api node --import tsx --input-type=module - --table A10 --session 48A135F3 < scripts/payos-recipient-diagnostic.mjs
```

Công cụ dùng môi trường sẵn có trong container, không đọc/in tệp env. Chỉ import adapter và normalization hiện đang chạy; không khởi động API/worker, không gọi refresh, tạo/hủy link, ghi sổ hay phân bổ. DB mở transaction `REPEATABLE READ READ ONLY`, timeout truy vấn 5 giây, kết thúc bằng `ROLLBACK`. Đích phải khớp đúng một phiên trong nhà hàng cấu hình; tối đa 10 khoản payOS, mỗi khoản một GET (adapter giới hạn 8 giây, không retry), mỗi khoản tối đa 100 giao dịch/webhook. Không có đích hoặc vượt giới hạn thì dừng, không mở rộng truy vấn toàn dữ liệu.

Kết quả chỉ có số thứ tự khoản/giao dịch, trạng thái, số tiền, kiểu/độ dài trường và boolean so sánh. Không in bất kỳ chữ số nào của tài khoản, QR, link ID, reference, tên khách, mô tả, chữ ký, khóa hoặc lỗi SDK/DB thô. `signaturePreviouslyVerified` là cờ lịch sử lưu trong DB, không phải xác minh lại chữ ký gốc từ snapshot. GET được xác minh chữ ký mới bằng adapter hiện có. Tài khoản đọc từ QR chỉ để so tính nhất quán, **không kiểm chứng CRC/chữ ký QR và không trở thành bằng chứng để chấp nhận thanh toán**.

### Đọc kết quả

- `get.checks`: order/link/amount, tổng transaction, số còn lại, amount dương và reference duy nhất phải khớp.
- `createAccount` và `qr.createMatchesQrAccount`: kiểm tra tài khoản lưu lúc tạo so với tài khoản trong QR; chỉ hiện trạng thái/độ dài/boolean.
- `webhookCandidates[].checks`: chỉ rõ vì sao một snapshot không được chọn làm bằng chứng, kể cả bản cũ thiếu version 2, sai order/link/amount/tenant hoặc chưa xác minh chữ ký.
- `transactions[].recipient.equals`: phân biệt tài khoản kỳ vọng, primary/VA trong GET và webhook; giá trị `null` nghĩa là không có đủ hai chuỗi hợp lệ để so.
- `recipient.decision`: `GET_EXPLICIT_VA_DIFFERS_FROM_CREATE`, `WEBHOOK_EXPLICIT_VA_DIFFERS_FROM_CREATE`, `GET_PRIMARY_DIFFERS_NO_ELIGIBLE_WEBHOOK`, hoặc nhánh cụ thể khác. `matched` gọi nguyên helper đang chạy; kết quả chỉ là recipient, không xác nhận giao dịch đã qua mọi lớp kiểm tra hoặc đã vào sổ.

Gửi lại **JSON đã che dữ liệu do lệnh xuất ra**. Nếu có lỗi, chỉ gửi mã lỗi công cụ; không gửi env, raw response, logs chứa khóa hoặc số tài khoản. Chưa có kết quả thì dừng điều tra tại đây, không đổi luật recipient, không ép PAID/SUCCEEDED và không xác nhận thủ công tiền đã ghi sổ. Sau khi chứng minh được nguyên nhân mới chuẩn bị bản sửa tối thiểu và kiểm thử tương ứng.

Kiểm thử bản chẩn đoán: 16 bài Node cho công cụ/stream stdin/chống lộ dữ liệu/GET HMAC giả và 29 unit normalization đạt; lint và syntax của hai tệp mới đạt. Không truy cập DB hoặc payOS production, không kiểm thử giao dịch thật, không chạy Playwright/E2E. Workflow Quality gate giữ nguyên; CI tự chạy theo cấu hình repository khi push/PR. Công cụ mới có lệnh test riêng `node --import tsx --test scripts/payos-recipient-diagnostic.test.mjs`; không thay lệnh hay ngưỡng Quality gate hiện hành.

## Audit và mô hình thanh toán hiện hành — 19/10/2026

Phần này mô tả nhánh **`fix/payos-payment-experience`** và thay cho các hướng dẫn cũ bên dưới về yêu cầu đối soát thủ công cho mọi khoản online hoặc nhập mã để xác nhận `RETURNED_EXTERNALLY`. Đây là thay đổi mã nguồn và kiểm thử bằng dữ liệu giả. **Đợt 19/10 không đọc production DB, không gọi payOS thật, không xác nhận merchant/tài khoản nhận thật và chưa chứng minh giao dịch 5.000đ được chủ dự án phản ánh đã được ghi sổ hoặc phân bổ.** Dashboard, ảnh QR biến mất và ảnh giao diện không đủ để kết luận khoản đó đã trả vào hóa đơn. Biên bản các ngày trước là bằng chứng lịch sử của chính đợt đó; không chuyển kết luận của chúng thành kết quả kiểm tra mới.

### Những nguyên nhân đã chứng minh trong code

| Phát hiện | Hậu quả có thể tái hiện bằng môi trường giả | Cách xử lý trên nhánh mới |
| --- | --- | --- |
| Snapshot webhook cũ giữ số tiền/tham chiếu nhưng bỏ tài khoản nhận và tài khoản ảo đã được ký | Lần GET về sau chỉ có tài khoản chính không còn đủ bằng chứng gắn với tài khoản ảo của khoản thu; một khoản hợp lệ có thể bị báo mismatch | Giữ bằng chứng recipient đã normalize sau SDK verify. Chỉ kết hợp hai nguồn đã ký khi cùng nhà hàng, `orderCode`, link, reference, số tiền và VND |
| Hồ sơ OPEN cũ tiếp tục chi phối nhánh xử lý, trong khi worker chủ yếu lấy khoản chưa terminal | Sau khi provider đã PAID, bằng chứng hợp lệ về sau vẫn có thể bị giữ trong đối soát và không tự phục hồi | Cho worker thử lại các nhóm lỗi có khả năng phục hồi; chỉ tự kết thúc khi toàn bộ kiểm tra hiện tại đạt, ghi sổ/phân bổ thành công và không còn bất thường thật |
| Nhánh lỗi tài khoản nhận có thể kết thúc trước khi cập nhật số tiền ngân hàng báo | UI có thể hiện 0đ dù đã có thông báo có chữ ký về tiền, khiến admin/nhân viên không hiểu tiền đang ở tầng nào | Tách số tiền provider báo với sổ thu. Chỉ các thông báo khớp đầy đủ định danh mới được đưa vào tổng báo nhận; chưa đủ xác minh không tăng tiền ghi sổ hoặc phân bổ |
| Chọn cả bàn trừ tiền đang giữ chỗ, còn chọn món một khách dùng số nợ riêng chưa bị giới hạn chung | 69.000đ và 64.000đ có thể cùng xuất hiện dù tiền món chưa được trả | Backend trả cùng `financialSummary` và `collectionAvailability`; mọi lựa chọn bị giới hạn bởi phần còn được lập khoản mới của cả phiên |
| Admin nhập tham chiếu/lý do trong một biểu mẫu chung; STAFF còn đường xử lý cảnh báo kỹ thuật | Việc tiếp nhận bị hiểu như xác minh, nhập mã bị hiểu như bằng chứng hoàn, cùng nguyên nhân tạo nhiều việc | Tách tiếp nhận, xác minh, hoàn thực tế và đóng hồ sơ; chỉ mở đúng hành động hợp lệ từ backend |

Các lỗi trên là **nguyên nhân ứng viên của tình huống thật**, không phải truy vết giao dịch production. Cần kết quả đọc chỉ đọc đã che dữ liệu để biết khoản thật dừng ở lớp báo nhận, sổ thu, phân bổ, tài khoản phiên hay cảnh báo. Không sửa dữ liệu kế toán để làm giao diện khớp ảnh.

[FAQ payOS](https://payos.vn/docs/cau-hoi-thuong-gap/) xác nhận link dùng VietQR Pro có thể hiển thị tài khoản ảo theo đơn/số tiền. Vì vậy khác tài khoản chính không tự chứng minh sai người nhận. Ngược lại, một tài khoản ảo được chỉ rõ nhưng không khớp vẫn bị từ chối; không dùng cùng tài khoản chính để bỏ qua VA sai. Thuật toán cụ thể là quyết định của dự án trong `payos-normalization.ts`, phải đi kèm bằng chứng và test, không phải lời đảm bảo của nhà cung cấp cho merchant đang vận hành.

Bản tin cũ thiếu recipient không được tự suy ra từ cấu hình hiện tại. Một lần gửi lại chỉ được bổ sung bằng chứng sau khi SDK xác minh chữ ký, dữ liệu ngân hàng gốc giữ nguyên và có audit. Không biến chữ ký hợp lệ thành sự cho phép bỏ kiểm tra số tiền, tài khoản, link hoặc phạm vi hóa đơn.

### Một nguồn dữ liệu tài chính, nhiều ý nghĩa tiền

`payment-position.service.ts` tạo hai projection cho các API đọc bill/trạng thái: `financialSummary` cho số tiền cả phiên, `collectionAvailability` cho phần được phép lập khoản mới ở cả bàn và từng người. Các số là chuỗi số nguyên VND, không tính tiền bằng số thực trên frontend. Khoản online đang có kết quả chưa chắc chắn có thể chặn lập khoản thay thế; đây không phải chứng cứ khách đã trả.

| Khái niệm | Ý nghĩa và điều kiện thay đổi |
| --- | --- |
| Tổng hóa đơn | Tổng charge còn hiệu lực sau chính sách giảm/VAT; không đổi vì QR được tạo hoặc biến mất |
| payOS/ngân hàng báo nhận | Dữ liệu provider đã xác thực nguồn; có thể còn chờ kiểm tra người nhận/nghiệp vụ. Tổng này chỉ thuộc kênh online, không cộng tiền mặt vào số ngân hàng báo |
| Đã ghi sổ | Giao dịch thu thành công đã commit. Tổng phiên có thể gồm CASH, BANK_TRANSFER và ONLINE; không so tổng nhiều kênh với riêng payOS |
| Đã tính vào tiền món | Phân bổ còn hiệu lực vào charge; đây mới là phần làm giảm nợ món |
| Còn phải thu | Charge còn hiệu lực trừ phân bổ còn hiệu lực; không trừ QR đang chờ |
| QR đang chờ / tiền giữ chỗ | Số khoản online còn chờ và phần dành cho các khoản thu chưa kết thúc; ngăn thu trùng, không phải tiền đã nhận |
| Còn được lập khoản mới | Phần chưa bị giữ chỗ trong nợ hiện tại; bằng 0 khi đang có trạng thái cần kiểm tra theo guard backend |
| Chưa phân bổ / cần hoàn | Tiền ghi sổ còn lại ở từng nguồn sau phân bổ và hoàn thành công; không tự trả sang món hoặc người khác |
| Đã hoàn thực tế | Chỉ tăng sau giao dịch hoàn thành công; duyệt hồ sơ hoặc gõ tham chiếu không làm tăng số này |

Ví dụ minh họa chỉ có kênh online:

| Hóa đơn 69.000đ, khoản QR 5.000đ | Đã báo nhận | Đã ghi sổ | Đã tính vào món | Còn phải thu | Giữ chỗ | Còn được lập khoản mới |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Đang chờ QR, chưa chuyển | 0 | 0 | 0 | 69.000 | 5.000 | 64.000 |
| Đã báo nhận, còn bất thường cần kiểm tra | 5.000 | 0 | 0 | 69.000 | Theo trạng thái khoản thu | 0 khi guard đang chặn |
| Đã xác minh, ghi sổ và phân bổ đủ khoản | 5.000 | 5.000 | 5.000 | 64.000 | 0 | 64.000 |

Hai số 64.000đ ở hàng đầu và cuối có **ý nghĩa khác nhau**. Khi QR chờ, đó là phần được lập khoản mới; sau phân bổ, đó mới là nợ còn lại. Lựa chọn “món của một khách” có thể còn nợ riêng 69.000đ nhưng không được lập vượt phần khả dụng chung 64.000đ. Không suy ra đã thanh toán từ nhãn lựa chọn, redirect hay trạng thái provider đơn lẻ.

Giữ nguyên quy tắc dư khoản thu của đợt 18/10: hóa đơn 20.000đ, khoản được lập 10.000đ, nhận 12.000đ → ghi sổ 12.000đ, phân bổ 10.000đ, còn thu 10.000đ, cần hoàn 2.000đ. Hoàn thật 2.000đ không làm nợ 10.000đ biến mất. Trong chi tiết admin, `unapplied_amount` thuộc khoản thu đang xem, còn `refund_due_amount` thuộc **cả phiên**; UI ghi rõ phạm vi, không cộng hai số thành một nghĩa vụ mới.

### Trạng thái, vai trò và điều kiện kết thúc

| Tình trạng thực tế | STAFF/GUEST thấy và làm gì? | Backend/ADMIN |
| --- | --- | --- |
| QR chờ, chưa có tiền | Số yêu cầu và QR/link; chờ chuyển đúng khoản | Giữ chỗ, không giảm nợ; không tạo việc admin bình thường |
| Provider báo tiền, ghi sổ đang chờ hoặc chưa đủ bằng chứng | Đang xác minh/nhà hàng đang kiểm tra, nhắc không chuyển hoặc thu lại | Retry an toàn; chỉ tạo ngoại lệ khi có bất thường thật; không báo thành công từ provider PAID đơn lẻ |
| Khoản hợp lệ được ghi sổ và phân bổ | Thông báo thành công của khoản hoặc đã trả một phần; hóa đơn tự cập nhật | Ghi mỗi reference đúng một lần, kết thúc đúng lời gọi thanh toán; không yêu cầu STAFF/admin xác nhận lại |
| Sai tài khoản, sai định danh, lịch sử xung đột, tiền đến muộn | Thông báo ngắn, không có biểu mẫu đóng cảnh báo kỹ thuật | Hàng đợi ngoại lệ với lý do, bằng chứng và bước hợp lệ; chưa đủ điều kiện thì giữ chặn |
| Tiền dư/chưa phân bổ | Tách còn phải trả và chờ hoàn | ADMIN lập/duyệt theo nguồn; STAFF thực trả, xác nhận; không tự hoàn qua payOS |
| Hết hạn/hủy/thất bại | QR không dùng tiếp; xem tiền đã nhận và nợ thật trước khi lập khoản thay thế | Giữ giao dịch đã thu và lịch sử; khoản đến muộn vẫn kiểm tra riêng |

ADMIN vào **Việc cần xử lý → Ngoại lệ thanh toán**; đường **Báo cáo → Đối soát online** mở cùng trung tâm. Badge chỉ đếm hồ sơ OPEN, kể cả hồ sơ đã có người tiếp nhận. Hàng đợi ưu tiên cập nhật mới nhất; “Lịch sử đã đóng” giữ dấu vết. Thông báo có chữ ký nhưng chưa khớp khoản thu có vùng riêng, không được tự gán vào bàn. Đường dẫn việc hoàn bị gộp khi cùng nguồn đã được hồ sơ ngoại lệ bao phủ đủ; dữ liệu cảnh báo và tiền gốc không bị xóa.

Ba bước độc lập: **tiếp nhận** chỉ ghi audit người đang kiểm tra; **xác minh** là kết quả backend kiểm bằng chứng hiện tại sau bất thường; **đóng hồ sơ** phải kiểm tra lại dưới khóa. Tham chiếu provider đã biết hiển thị chỉ đọc. `can_resolve` và `resolution_blockers` do backend trả và dùng cùng điều kiện với mutation; nút bị ẩn không thay thế guard API. Thiếu chứng cứ, còn tiền chưa phân bổ/cần hoàn, sổ không khớp, provider chưa kết thúc hoặc phiên đã chốt thì không cho đóng.

**`RETURNED_EXTERNALLY` không còn là lối đóng bằng mã nhập tay.** Khoản cách ly/đến sau phiên đã chốt cần bằng chứng trả tiền ngân hàng được xác minh riêng; bản này chưa có workflow chứng minh outbound đó nên vẫn chặn, không cho giả “đã hoàn” hay sửa phiếu đã đóng. Thao tác hoàn nguồn đã ghi sổ vẫn theo luồng hoàn hiện có với phân quyền, ngân sách đúng nguồn và audit.

### Tự phục hồi, polling và dữ liệu lịch sử

Webhook đã verify kích hoạt kiểm tra; backend worker bổ sung refresh/retry có khóa và lease. Snapshot GET cũ không được phủ nhận tiền đã ghi hợp lệ, reference lặp không tạo giao dịch thứ hai. Màn hình đọc trạng thái có kiểm soát, tạm dừng khi ẩn/offline và cập nhật khi focus/reconnect; nút kiểm tra nằm trong vùng phục hồi thu gọn, hướng dẫn chỉ dùng khi khoản chờ lâu hoặc kết nối lỗi. Chưa cần SSE/WebSocket cho quy mô và bộ kiểm thử hiện tại; polling không làm provider PAID thành bằng chứng allocation.

Đợt 19/10 **không thêm SQL migration, không đổi CHECK hoặc schema để phục hồi tự động**. Khi một ngoại lệ có thể phục hồi đã được kiểm đầy đủ, hệ thống kết thúc trạng thái hoạt động bằng `reconciliation_status = NULL`, giữ `resolved_at` và sự kiện `PAYOS_VERIFICATION_RECOVERED` với actor SYSTEM. Read model vẫn chiếu nó thành lịch sử RESOLVED. Đây là cách tương thích CHECK hiện có đối với hồ sơ do người dùng đóng; không bịa `resolved_by` của admin và không xóa hồ sơ/bằng chứng. Một bất thường mới có thể mở hồ sơ lại với audit riêng.

Các đường mã chính: `payos-normalization.ts`, `payos.service.ts`, `payment-reported-funds.ts`, `payment-position.service.ts`, `payos-resolution.ts` trong `apps/api/src/modules/payments/`; contract ở `packages/contracts/src/payments-online.ts`. [Kết quả và giới hạn kiểm thử hiện hành](15-doi-chieu.md) là nơi chốt số lượng test/build. Bộ kiểm thử giả không xác nhận merchant production, giao dịch thật, tốc độ webhook ngân hàng hoặc độ bền vận hành dài ngày.

### Nguồn tham khảo và phạm vi áp dụng

- [payOS API](https://payos.vn/docs/api/) và [webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/): trường định danh, giao dịch, chữ ký và dữ liệu trả về. Hệ thống giữ SDK verify; Return URL chỉ phục vụ điều hướng.
- [payOS FAQ](https://payos.vn/docs/cau-hoi-thuong-gap/): tài khoản ảo và khác biệt theo kênh VietQR Pro. Không giả định mọi merchant chấp nhận chuyển thiếu/dư; nghiệm thu thật phải kiểm tra đúng kênh.
- [Toast: chia khoản thanh toán](https://support.toasttab.com/en/article/Split-Payments-with-Toast-Mobile-Order-Pay): tham khảo cách tách phần của một người và phần còn lại của bàn. Dự án giữ giới hạn phân bổ của từng khoản, không sao chép luồng sản phẩm khác.
- [Square: tìm giao dịch và mở chi tiết](https://squareup.com/help/us/en/article/5145-transaction-search): tham khảo filter trạng thái, chi tiết và hành động từ giao dịch gốc.
- [Stripe: tự đối chiếu chuyển khoản](https://support.stripe.com/questions/bank-transfer-reconciliation?locale=en-GB): tham khảo việc tự xử lý khoản khớp và tách ngoại lệ. Đây là nguyên tắc UX, không phải dùng quy tắc khớp invoice của Stripe thay guard nhà hàng.

## Chuyển dư khoản thanh toán một phần — 18/10/2026

Tiền ngân hàng thực nhận và tiền đã trả cho món là hai số khác nhau. Mỗi khoản thu có phạm vi/số tiền được nhân viên lập; tiền vượt giới hạn đó **không tự trả sang món hoặc người khác**, kể cả cả bàn vẫn còn thiếu. Dư nợ tính từ charge còn hiệu lực trừ phân bổ thực tế; tiền cần hoàn tính riêng tại từng giao dịch gốc, sau khi trừ phân bổ còn hiệu lực và các lần hoàn thành công. Vì vậy một bàn có thể **vừa còn phải thu, vừa cần hoàn**.

| Trạng thái hóa đơn 20.000đ, khoản thu được lập 10.000đ | Đã nhận | Đã tính vào món | Đã hoàn thật | Còn phải thu | Cần hoàn |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ngân hàng xác nhận 12.000đ | 12.000 | 10.000 | 0 | 10.000 | 2.000 |
| Admin mới duyệt phiếu hoàn 2.000đ | 12.000 | 10.000 | 0 | 10.000 | 2.000 |
| Nhân viên đã trả và xác nhận 1.000đ | 12.000 | 10.000 | 1.000 | 10.000 | 1.000 |
| Trả và xác nhận thêm 1.000đ | 12.000 | 10.000 | 2.000 | 10.000 | 0 |
| Lập khoản mới đúng phạm vi và thu tiếp 10.000đ | 22.000 | 20.000 | 2.000 | 0 | 0 |

Admin không thể đóng **RECONCILED** khi 2.000đ chưa hoàn thực tế; ghi lý do hay duyệt hồ sơ chưa đủ. Backend kiểm tra lại cả khi gọi API trực tiếp: từng nguồn payOS phải có **tiền nhận − tiền đã hoàn thành công = phân bổ còn hiệu lực**, tổng provider phải khớp sổ thu, trạng thái provider phải kết thúc và các khoản cần hoàn trong phiên đã xử lý. Có thể đóng đối soát khoản 10.000đ sau hoàn dư dù bàn vẫn còn phải thu 10.000đ; **đóng đối soát không phải đóng bàn**. Bàn còn nợ tiếp tục bị chặn kết thúc bình thường.

Chuyển 22.000đ cho toàn hóa đơn 20.000đ chỉ phân bổ 20.000đ, cần hoàn 2.000đ. Hủy/miễn món đã được trả tiền giải phóng đúng phần phân bổ của nguồn cũ; một món gọi thêm không tự hấp thụ số cần hoàn ấy. Hồ sơ hoàn chỉ được lập/duyệt/thực hiện trong số dư chưa phân bổ của **đúng nguồn**, trừ phần đã hoàn và phần đang dành cho phiếu khác. Hoàn thất bại, phiếu được duyệt hoặc lời ghi chú không làm giảm số cần hoàn.

Khoản chưa từng phân bổ không tự gán vào lịch sử hoàn món bị hủy. Lý do hủy món chỉ được dùng khi nguồn ấy đã thực trả cho món bị đảo; nguồn gồm cả dư chuyển và tiền món bị đảo được ghi là khoản chung, không lặp toàn bộ số hoàn cho từng món. Nhân viên vẫn phải thực trả rồi xác nhận; chưa có chi hộ/hoàn tự động qua payOS.

Nếu quote đã bị hủy/hết hạn trước khi tiền được ghi nhận và không còn đủ charge để phân bổ, hệ thống ghi tiền thật, giữ phần cần hoàn và yêu cầu đối soát. Sau hoàn thực tế có thể đóng khoản ở **CANCELLED**, không giả **PAID** hoặc tự hoàn tất lời gọi chưa được đáp ứng. Một webhook/refresh lặp với cùng lịch sử ngân hàng sau đối soát không ghi thêm tiền, không phân bổ thêm và không mở lại hồ sơ đã giải quyết; tham chiếu tiền mới vẫn phải được xử lý.

Đợt này chỉ sửa phép tổng hợp, kiểm tra nguồn hoàn và read model; **không thêm migration**. Migration `202610170001_payment_system_resolution` của đợt trước vẫn là phần nâng cấp cần được operator kiểm soát khi triển khai. Chưa truy cập database production, gọi payOS thật, đổi secret, merge main hoặc deploy trong đợt review 18/10. Phiếu đã đóng giữ nguyên snapshot.

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

Màn hình khách tách **Đã nhận tiền**, **Đã tính vào tiền món**, **Đã hoàn** và **Cần hoàn**, cùng số **Ngân hàng đã xác nhận** từ payOS. Tiền còn cách ly/chờ đối soát không bị tính thành đã trả hóa đơn. Khách chỉ nhận bản tóm tắt của bàn hoặc phần thuộc mình; không nhận raw payload, tài khoản ngân hàng, mã provider/tham chiếu giao dịch hay ID nhân viên. QR/link được cung cấp từ phía nhân viên.

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

## Phân biệt tiền thực giữ và tiền đã trả cho món

```text
Thực giữ của khách = paid_total - refunded_total
Còn thiếu = tổng max(tiền charge còn hiệu lực sau giảm - phân bổ ròng vào charge, 0)
Cần hoàn = tổng max(tiền mỗi nguồn thu - hoàn thành công của nguồn - phân bổ còn hiệu lực của nguồn, 0)
Đã tính vào tiền món = charge_total - outstanding_amount
```

Phân bổ ròng là allocated_amount − reversed_amount của giao dịch thành công. Chỉ cộng/trừ tổng tiền của cả bàn sẽ bù nhầm khoản dư vào phạm vi chưa được yêu cầu thanh toán; không dùng công thức ấy cho khoản thu riêng. Tổng đã nhận và tổng đã hoàn vẫn giữ lịch sử thực tế, không sửa số ngân hàng để làm cân phiếu.

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


## Chẩn đoán chỉ đọc giao dịch A01 / #FFC78214 — 19/10/2026

Đợt audit mã nguồn không đọc DB production hoặc gọi merchant thật. Các dấu hiệu chủ nhà hàng cung cấp chưa đủ để xác nhận 5.000đ đã vào sổ/phân bổ. Người vận hành có quyền đọc có thể chạy [SQL chẩn đoán đã giới hạn dữ liệu](reference/payment-readonly-audit-20261019.sql) bằng client PostgreSQL được cấp quyền đọc. Tệp tự mở transaction READ ONLY, giới hạn 5 giây và kết thúc bằng ROLLBACK; **không tự chạy tệp này trong đợt sửa mã**. Nếu kết quả rỗng, cần đối chiếu lại mã phiên hiển thị với UUID; không bỏ bộ lọc để xuất toàn bộ dữ liệu.

Kết quả chỉ gồm số tiền, trạng thái và boolean đối chiếu; không xuất số tài khoản, tên khách, khóa, payload nguyên bản hoặc tham chiếu đầy đủ. Chỉ chia sẻ trường đã che này. Không gửi .env, checksum key, API key, cookie hoặc thông tin đăng nhập DB.

Đối chiếu theo thứ tự: có transaction SUCCEEDED chưa → có active allocation bao nhiêu → account.outstanding là bao nhiêu → provider báo bao nhiêu → snapshot webhook có bằng chứng recipient v2 không. Nếu bản cũ thiếu trường tài khoản thì NULL không có nghĩa tài khoản sai; nó có nghĩa chưa đủ dữ liệu để kết luận. GET hiện hành của payOS có thể còn cần được người vận hành đối chiếu riêng: chỉ cung cấp boolean tài khoản chính/tài khoản ảo có trùng kỳ vọng không, cùng order/link/reference có khớp không; không gửi nguyên mã hoặc tài khoản.

Với dữ liệu cũ chỉ có recipient-less snapshot và GET thiếu tài khoản ảo, bản sửa **không tự dựng bằng chứng**. Cần phản hồi tạo link gốc hoặc lần gửi lại webhook có chữ ký hợp lệ từ payOS; nếu không có thì tiếp tục ngoại lệ, liên hệ nhà cung cấp. Khoản đến sau chốt cần chứng từ hoàn ngân hàng có thể xác minh; phiên bản này không có connector xác minh chi ra nên không cho đóng chỉ bằng mã nhập tay. Việc này là giới hạn có chủ đích, không phải đã hoàn tiền.

Khi được phê duyệt nâng cấp riêng: sao lưu theo quy trình hiện hành, review branch và diff, build lại API/web từ cùng commit. Đợt này không có migration mới; giữ nguyên 37 migration hiện có. Không chạy seed/reset hay tự sửa hồ sơ kế toán cũ. Chỉ sau khi người vận hành triển khai mới thực hiện checklist giao dịch thật bên trên. Chuẩn bị phương án quay lại image trước và theo dõi hàng đợi ngoại lệ; quay lại mã không được xóa bằng chứng/transaction đã ghi.
