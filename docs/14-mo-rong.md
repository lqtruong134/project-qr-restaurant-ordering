# 14. Vận hành online và nền tảng trợ lý chọn món

## Phạm vi hiện tại

Thanh toán payOS đã tích hợp ở bản 14/10/2026. Phần code, migration và kiểm thử local hoàn tất; kết nối merchant thật và nghiệm thu HTTPS thuộc bước triển khai theo [bài 12](12-van-hanh.md). Bản 16/10 điều chỉnh nền tảng AI Menu Assistant sang AI tự đọc tools và sở hữu nội dung tư vấn; mặc định OFF, chưa có model hoặc giao diện AI thật.

## Thanh toán online: phần nào đã có?

STAFF lập khoản thu sau khi nhận lời gọi, server kiểm tra dư nợ sau khuyến mãi/VAT và số tiền đang giữ. Adapter dùng SDK payOS chính thức, gọi mạng ngoài transaction rồi ghi tiền bằng khóa phiên/idempotency hiện hành. Metadata provider nằm trong `payos_payment_request`; tiền tiếp tục dùng `payment_transaction`, `payment_allocation` và `session_financial_account`.

Webhook payOS dùng giao thức chữ ký của payOS, không dùng connector HMAC nội bộ. Mỗi khoản ngân hàng thực nhận được ghi một lần; chuyển thiếu chỉ giữ phần còn lại. Trang quay về không chứng minh đã nhận tiền. QR/state lưu ở server, tải lại không tạo khoản thu mới.

Mạng chưa rõ kết quả thì tiếp tục giữ chỗ. Khi provider xác nhận hủy/hết hạn mà chưa nhận tiền, có thể đổi phương thức. Nếu có tiền đến muộn, vượt hoặc không khớp, ADMIN đối soát; hoàn trong phiên vẫn admin duyệt → phục vụ trả và xác nhận. Tiền đến sau đóng phiên được giữ riêng, không sửa snapshot phiếu cũ. Thông báo ký nhưng chưa khớp nằm trong hộp thư chỉ đọc cho admin.

## Phần cần nghiệm thu khi triển khai

Cấu hình khóa riêng/URL HTTPS, đăng ký webhook trên đúng kênh payOS, rồi người vận hành thử giao dịch thật 5.000đ. Chưa có sandbox payOS; automated tests chỉ dùng provider giả. Đo tải polling, theo dõi lỗi provider, bảo vệ/recover database và kho ảnh/chứng từ, xác định người đối soát khi mạng/ngân hàng gặp sự cố.

Đợt payOS không triển khai chi hộ tự động hoặc hóa đơn điện tử thuế; phần trợ lý mới chỉ ở nền tảng tùy chọn. [Nghiệp vụ payOS](06-thanh-toan.md) và [kết quả kiểm tra](15-doi-chieu.md) phân biệt phần đã thử với phần chưa thử.

## AI Menu Assistant: ranh giới tư vấn v2 — 16/10/2026

Trợ lý là miền tư vấn chỉ đọc. AI sở hữu hiểu câu tự nhiên, chủ động tìm dữ liệu thực đơn, cân đối người/ngân sách, lựa chọn, giải thích và hỏi lại. API giữ các giới hạn kỹ thuật và bảo mật; không tính lại đề xuất để làm câu trả lời của model thành đúng. Mặc định `MENU_ASSISTANT_MODE=OFF`. Chưa chạy model thật, train, Ollama hoặc xây giao diện AI; Python chỉ phục vụ nghiên cứu offline.

### Ai chịu trách nhiệm cho việc gì?

| Miền | Trách nhiệm |
| --- | --- |
| AI advisory | Đọc qua tools được phép; hiểu câu hỏi/lịch sử; tìm và lọc món; suy luận số người, ngân sách, sở thích; đưa tên, giá, số lượng, tổng, lời giải thích và câu hỏi tiếp theo |
| API kỹ thuật/bảo mật | Xác thực guest, phiên và nhà hàng; CSRF; giới hạn lượt, thời gian, đồng thời, kích thước; kiểm tra JSON/schema; xử lý provider unavailable |
| Core transactional | Khi khách thực hiện hành động thật: kiểm tra sản phẩm, phiên, giá/version, khả dụng, số lượng và kho; thêm giỏ/gửi đơn/bếp; khuyến mãi, tiền, hoàn và đóng phiên |

AI không được gọi công cụ ghi, tạo giỏ/đơn, giữ hoặc trừ kho, đổi món/giá, áp ưu đãi, thu/hoàn tiền hoặc thay tài khoản. Giá AI nêu chỉ là tư vấn theo giá menu đã gồm VAT, trước giảm giá; không phải báo giá được giữ chỗ. Core hiện có không dùng giá hoặc tổng do AI nêu để ghi giao dịch.

```text
Guest hợp lệ → API giới hạn kỹ thuật
  → provider nhận câu hỏi + history + metadata công khai + định nghĩa tools
  → provider chủ động gọi listCategories / searchMenu / getProducts
  → mỗi lượt đọc xác thực lại guest, SELECT trong transaction READ ONLY
  → provider tự suy luận, trả decision JSON
  → API kiểm tra cấu trúc/kích thước, xác thực lại guest, trả nguyên decision

Khách tự chọn thực hiện hành động → API giỏ/đơn hiện hành → core kiểm tra đầy đủ
```

### Vùng dữ liệu đọc tối thiểu

Không gửi sẵn toàn thực đơn và không giao SQL, Prisma, pool, mật khẩu hoặc connection string cho model. `AssistantProvider.suggest(input, { signal, tools })` nhận một capability chỉ có `tools.call(name, arguments)`. Provider sau này lựa chọn lượt đọc dựa trên câu hỏi và kết quả trước đó. Ba tên tool là allowlist; thêm SQL hoặc tenant/session vào đối số bị từ chối.

| Tool | Đối số | Kết quả được phép |
| --- | --- | --- |
| `listCategories` | Object rỗng | Mã và tên danh mục đang hoạt động |
| `searchMenu` | Câu tìm, mã danh mục, loại món/combo, khoảng giá, chỉ lấy khả dụng, limit/offset | Các món đang hoạt động trong danh mục đang hoạt động; có phân trang |
| `getProducts` | Tối đa 20 UUID sản phẩm | Chi tiết sản phẩm thuộc cùng vùng được phép; không trả món tenant khác hoặc đã tắt |

Sản phẩm chỉ gồm ID, mã, tên, mô tả, mã/tên danh mục, giá VND hiện tại, loại DISH/COMBO, version, khả dụng công khai, **tên** nguyên liệu của công thức hiệu lực và ID/tên/số lượng món thành phần combo. Không có giá vốn, định lượng BOM, hao hụt, tồn/giữ kho thực tế, vị trí kho, khách khác, nhân sự/lương, thông tin thanh toán, audit hoặc secrets. `asOf` ghi mốc đọc; `truncated` báo trang hoặc trường/danh sách bị giới hạn. Khả dụng công khai của một sản phẩm không bảo đảm đủ kho cho toàn bộ tập món/số lượng được tư vấn.

Mỗi lượt dùng truy vấn tĩnh có tham số, kiểm tra cookie guest bằng SELECT và ràng buộc nhà hàng từ server. Không nhận restaurantId/sessionId/participantId từ body. Không dùng helper guest có heartbeat hoặc tính tài chính; `last_seen` không đổi. Mỗi lượt trả kết nối trước khi AI suy luận tiếp. Một request có nhiều lượt đọc nên giá/kho có thể thay đổi giữa các lượt; đây không phải snapshot giữ nguyên cả hội thoại.

Giới hạn hiện hành: 12 lần thử gọi tool/request, 2 lượt đồng thời/request, tối đa 2 lượt đọc tool đồng thời trên mỗi đối tượng Database của tiến trình. Search mặc định 20, tối đa 30 dòng, offset tối đa 1000; danh mục tối đa 100, mỗi món tối đa 40 tên nguyên liệu và 20 thành phần combo. Mỗi kết quả tối đa 65.536 byte UTF-8, cộng dồn 262.144 byte. Đối số được clone trước validate/await để provider không đổi limit/ID trong lúc chờ kết nối. Chuỗi và danh sách đều có giới hạn ở contract/runtime.

### Security boundary và lựa chọn PostgreSQL

Phương án tối thiểu phù hợp hiện tại là **capability đọc trong API + transaction PostgreSQL READ ONLY**, không tạo login/role trong Prisma migration. Provider/model chỉ thấy ba tools; helper database và câu SQL nằm trong module tin cậy. Transaction đặt `REPEATABLE READ READ ONLY` và `statement_timeout=3s`. Kiểm thử PostgreSQL thực xác nhận các lệnh INSERT/UPDATE/DELETE/CREATE/ALTER/DROP, kể cả CREATE TEMP TABLE, bị từ chối trong helper này.

Đây không phải tài khoản PostgreSQL có ACL riêng và không phải sandbox chống JavaScript adapter độc hại trong cùng tiến trình. Chủ triển khai phải tin cậy adapter được inject, vì mã Node tùy ý trong tiến trình vẫn có khả năng đọc môi trường/import module. Model không được nhận quyền đó. Nếu sau này tách dịch vụ AI có kết nối DB riêng, cần bootstrap một login không sở hữu bảng và chỉ GRANT trên views/functions đã duyệt, REVOKE quyền không cần thiết; không `SELECT ON ALL TABLES`, không commit credential. Cần kiểm tra ACL của lần triển khai đó riêng. [READ ONLY PostgreSQL](https://www.postgresql.org/docs/current/sql-set-transaction.html) và [quyền đối tượng](https://www.postgresql.org/docs/current/ddl-priv.html).

Deadline provider/tools mặc định 8 giây, cấu hình tối đa 30 giây. Khi hoàn tất/lỗi/hết hạn, capability bị thu hồi; không gọi mới hoặc nhận kết quả đọc sau thu hồi. SQL đã gửi có thể còn chạy đến statement timeout, không bị hủy tức thì bởi AbortSignal. Adapter không chịu abort giữ admission slot đến khi promise kết thúc, tránh tác vụ mồ côi làm vượt giới hạn. Xác thực trước/sau inference là kiểm tra bảo mật riêng, không nằm trong cam kết tổng HTTP đúng 8 giây.

### API v2 và nội dung trả nguyên

`GET /guest/menu-assistant/capabilities` và `POST /guest/menu-assistant/recommendations` cần cookie guest của phiên hoạt động. Trên web thêm tiền tố `/api`; POST dùng Origin/CSRF hiện hành. `contractVersion: 2` phân biệt với contract ID/reasonCode cũ. [Schema API](17-api.md).

Request bắt buộc `message` tối đa 1.000 ký tự; `history` tùy chọn tối đa 8 dòng user/assistant, mỗi dòng 1.000 ký tự. `people` 1–20, `budgetAmount` chuỗi VND và `preferences` là gợi ý có cấu trúc tùy chọn, không bắt buộc người dùng phải nhập lại con số đã nói trong câu. Model chịu trách nhiệm hiểu và hỏi khi chưa rõ; history và nội dung thực đơn đều là dữ liệu không tin cậy, không thay system policy. Không lưu hội thoại hoặc hồ sơ dị ứng vào DB trong task này.

Decision có `kind` RECOMMEND/CLARIFY/REFER_STAFF/NO_MATCH; `message`; tối đa 6 dòng `products` với productId, name, quantity, unitPrice, lineTotal, reason; `totalAmount`, `clarificationFields` và `warnings`. Số lượng 1–20, tiền là chuỗi VND nguyên không âm (đơn giá tối đa 9 chữ số, thành tiền/tổng tối đa 12 chữ số), ID phải đúng cú pháp UUID. Body request và decision tối đa 32 KiB. Schema, enum, khóa lạ, kiểu và kích thước được kiểm tra; việc này không chứng minh nội dung đúng.

Wrapper `AVAILABLE / ADVISORY_RESULT` có nghĩa **đã nhận được decision đúng cấu trúc**, không chứng nhận lời tư vấn chính xác. API không tra ID đầu ra để dựng tên/giá, không cộng tổng, không đổi lý do/thông điệp, không kiểm lại ngân sách/sở thích hoặc kho để từ chối một decision đúng định dạng. ID bịa nhưng đúng UUID, giá/tổng sai, vượt ngân sách, món hết, dòng trùng và nội dung Unicode được giữ nguyên để đánh giá chất lượng thật. Output sai cấu trúc/quá lớn hoặc provider lỗi trả UNAVAILABLE an toàn; core vẫn hoạt động.

Mặc định giới hạn 6 lượt/60 giây theo guest và IP, một tác vụ cùng guest, tối đa 4 tác vụ inference. Limiter trong bộ nhớ một tiến trình; Wi-Fi dùng chung IP có thể dùng chung quota, nhiều API instance cần cơ chế phân tán sau này. OFF hoặc thiếu CUSTOM provider chỉ tắt trợ lý, không chặn menu/giỏ/đơn/thanh toán.

### Dữ liệu ngữ nghĩa và dị ứng

Audit ngày 15/10 ghi nhận 91 sản phẩm (86 món, 5 combo), 11 danh mục, 113 nguyên liệu, 91 công thức hiệu lực, 630 dòng BOM và 16 thành phần combo. Đây là ảnh chụp dữ liệu vận hành mô phỏng để phát triển, không phải chứng từ nhà hàng hoặc bằng chứng chất lượng model. Database chưa có metadata chay/cay/protein/khẩu phần/allergen được xác minh đầy đủ; capabilities công bố `semanticMetadata: UNREVIEWED`, `supportsAllergySafetyConfirmation: false`.

Tên món/danh mục và BOM không chứng minh không có nước mắm, thành phần sốt, nước dùng hoặc lây nhiễm chéo. Policy và dataset yêu cầu AI nói rõ giới hạn và đề nghị nhân viên khi không xác nhận được dị ứng; không được khẳng định an toàn tuyệt đối. API không dùng keyword gate để thay câu trả lời của model. Câu ăn chay/ít cay/tránh nguyên liệu có thể cần hỏi lại hoặc tư vấn có điều kiện; trách nhiệm này thuộc AI. Evaluator kiểm tra hành vi và rubric thủ công, không tự coi bộ dò từ khóa là chứng nhận an toàn.

Sau này nên bổ sung metadata có người/thời điểm/căn cứ xác minh, fingerprint công thức để hết hiệu lực khi đổi BOM: khẩu phần, dùng chung, chế độ ăn, mức cay/khả năng điều chỉnh, protein và allergen công bố. Quản trị và dữ liệu khởi tạo phải dùng cùng nguồn; không giữ bảng giá hoặc danh sách chay riêng trong model. Task này chưa thêm metadata/schema hoặc tự gán nhãn thực đơn đang dùng.

### Dataset, đánh giá raw và model thật

36 mẫu tách 24 train / 6 validation / 6 evaluation theo nhóm; không dùng gold làm predictions. V2 có câu hỏi tự nhiên, history, các bước TOOL_CALL/FINAL và kết quả tools ghi lại. Facts độc lập phục vụ chấm, không đưa đáp án hoặc toàn menu riêng vào prompt. Chi tiết định dạng, các lệnh CPU, rubric và giới hạn nằm trong [README nghiên cứu](../ai/menu-assistant/README.md).

Bộ chấm đọc raw decision/trajectory và ghi lỗi; không sửa tên, giá hoặc tổng trước khi chấm. Phân biệt structured-output, ID bịa/menu grounding, giá theo facts, phép nhân/cộng, ngân sách tính bằng giá facts độc lập, khả dụng, sở thích có facts đã rà soát, hỏi lại và hành vi dị ứng. Thiếu prediction vẫn tính trong mẫu số; nhãn chưa đủ không được biến thành preference pass. Chất lượng hữu ích, khẩu phần và an toàn cần rubric/người rà soát; vài quy tắc tự động không thay đánh giá người dùng.

`MOCK` là provider xác định để kiểm tra contract/tools; nó tự quyết định trong miền AI, không phải model hiểu tiếng Việt. Nó vẫn cần hints people/budget và còn xử lý sở thích đơn giản. CUSTOM là điểm inject provider tin cậy, chưa có adapter model/HTTP inference thật. Chuẩn bị dataset không có nghĩa chức năng NLP đã hoàn thành hoặc fine-tune tốt hơn base.

Notebook QLoRA là scaffold: cờ install/train/generate/export tắt, chưa tải checkpoint, chưa chạy GPU/BASE/ADAPTER, chưa export GGUF/Ollama. Profile dependency là ứng viên chưa GPU-validated. Khi triển khai model: pin revision, kiểm tra môi trường/token budget và prompt/completion masking, chạy BASE và ADAPTER held-out riêng, lưu raw tool trajectory + manifest, chấm cùng evaluator, kiểm tra lại sau export/quantization. Adapter phải chuyển đúng TOOL_CALL qua capability và FINAL qua contract; giới hạn context/output/turns và abort. Không được chạy mỗi một FINAL từ context rỗng rồi coi đã kiểm tra truy xuất realtime.

Tài liệu tham khảo: [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B), [TRL SFT](https://huggingface.co/docs/trl/v0.22.2/en/sft_trainer), [Unsloth GGUF](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf), [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs). Chưa thêm vector DB, RAG/agent framework, telemetry câu hỏi hoặc memory production. [Bài 15](15-doi-chieu.md) ghi kiểm thử phần mềm đã chạy, tách khỏi benchmark model chưa có.

## Giới hạn hiện tại cần hiểu trước khi mở rộng

| Quan sát từ code                                                                                    | Hệ quả cần kiểm chứng                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Access 15 phút; web tự gia hạn ACCESS_EXPIRED khi phiên còn hợp lệ, refresh có hạn tuyệt đối 7 ngày | Đã kiểm tra mô phỏng ca 8 giờ và hai tab; vẫn cần kiểm nghiệm ca thực tế, thiết bị/mạng và quy định đăng nhập của quán |
| Login limiter trong bộ nhớ tiến trình                                                               | Cần thiết kế lại nếu chạy nhiều API instance                                                                           |
| Polling 3 giây                                                                                      | Cần đo tải và độ trễ theo số bàn/thiết bị thật                                                                         |
| Nhiều API có LIMIT 100/200/500/1000                                                                 | Lịch sử hiển thị có giới hạn; không coi luôn là toàn bộ dữ liệu                                                        |
| Route báo cáo tổng hợp các định nghĩa riêng                                                         | “Sales của món SERVED” khác tiền thu ròng/hoàn/miễn/thiếu                                                              |
| Schema có cột chưa được mọi route sử dụng                                                           | Không suy ra một tính năng đã hoàn chỉnh chỉ từ cột                                                                    |
| Snapshot bảo vệ lịch sử                                                                             | Cần thiết kế hiển thị đối soát phát sinh sau snapshot                                                                  |
| Chưa thấy tích hợp Notion trong runtime                                                             | Có thể giữ một nguồn tài liệu cạnh code, giảm lệch phiên bản                                                           |

Đây là giới hạn/điểm cần thử, không khẳng định tất cả là bug đã tái hiện. Đợt rà soát đã sửa các lỗi nêu trong bài 15; các giới hạn ở bảng này vẫn cần quyết định và đo riêng khi đưa vào vận hành thật.

## Điều kiện qua giai đoạn

Bạn tự chạy và demo được phần cơ bản; bộ bài nghiệm thu có kết quả thực; không còn lỗi nghiêm trọng làm sai đơn, tiền, kho hoặc quyền; các tình huống đồng thời/lặp đã được kiểm tra; việc vận hành và xử lý sự cố có người hiểu; mỗi thay đổi nhỏ đều cập nhật bài liên quan và phụ lục nếu schema/API đổi.

Sau đó chỉ chọn **một phần mở rộng mỗi lần**, mô tả tiêu chí chấp nhận và kiểm tra tác động lên luồng hiện có. Lộ trình học kết thúc bằng khả năng giải thích hệ thống, không phải bằng việc thêm thật nhiều chức năng.
