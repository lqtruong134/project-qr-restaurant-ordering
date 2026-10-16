# 14. Vận hành online và nền tảng trợ lý chọn món

## Phạm vi hiện tại

Thanh toán payOS đã tích hợp ở bản 14/10/2026. Phần code, migration và kiểm thử local hoàn tất; kết nối merchant thật và nghiệm thu HTTPS thuộc bước triển khai theo [bài 12](12-van-hanh.md). Bản 15/10 đã có API nền tảng AI Menu Assistant tùy chọn, mặc định OFF; chưa có model hoặc giao diện AI thật.

## Thanh toán online: phần nào đã có?

STAFF lập khoản thu sau khi nhận lời gọi, server kiểm tra dư nợ sau khuyến mãi/VAT và số tiền đang giữ. Adapter dùng SDK payOS chính thức, gọi mạng ngoài transaction rồi ghi tiền bằng khóa phiên/idempotency hiện hành. Metadata provider nằm trong `payos_payment_request`; tiền tiếp tục dùng `payment_transaction`, `payment_allocation` và `session_financial_account`.

Webhook payOS dùng giao thức chữ ký của payOS, không dùng connector HMAC nội bộ. Mỗi khoản ngân hàng thực nhận được ghi một lần; chuyển thiếu chỉ giữ phần còn lại. Trang quay về không chứng minh đã nhận tiền. QR/state lưu ở server, tải lại không tạo khoản thu mới.

Mạng chưa rõ kết quả thì tiếp tục giữ chỗ. Khi provider xác nhận hủy/hết hạn mà chưa nhận tiền, có thể đổi phương thức. Nếu có tiền đến muộn, vượt hoặc không khớp, ADMIN đối soát; hoàn trong phiên vẫn admin duyệt → phục vụ trả và xác nhận. Tiền đến sau đóng phiên được giữ riêng, không sửa snapshot phiếu cũ. Thông báo ký nhưng chưa khớp nằm trong hộp thư chỉ đọc cho admin.

## Phần cần nghiệm thu khi triển khai

Cấu hình khóa riêng/URL HTTPS, đăng ký webhook trên đúng kênh payOS, rồi người vận hành thử giao dịch thật 5.000đ. Chưa có sandbox payOS; automated tests chỉ dùng provider giả. Đo tải polling, theo dõi lỗi provider, bảo vệ/recover database và kho ảnh/chứng từ, xác định người đối soát khi mạng/ngân hàng gặp sự cố.

Đợt payOS không triển khai chi hộ tự động hoặc hóa đơn điện tử thuế; phần trợ lý mới chỉ ở nền tảng tùy chọn. [Nghiệp vụ payOS](06-thanh-toan.md) và [kết quả kiểm tra](15-doi-chieu.md) phân biệt phần đã thử với phần chưa thử.

## AI Menu Assistant: nền tảng đã chuẩn bị — 15/10/2026

Trợ lý chỉ tư vấn chọn món; không phải agent điều khiển hệ thống. Mặc định `MENU_ASSISTANT_MODE=OFF`; chưa gọi model thật, chưa train hoặc triển khai Ollama. Giao diện khách chưa thêm nút AI để tránh giới thiệu một tính năng chưa sẵn sàng. Không có migration, bảng AI, vector database hoặc framework agent mới. Ứng dụng chính vẫn là TypeScript; Python chỉ ở notebook/công cụ nghiên cứu huấn luyện, không tham gia server gọi món.

### Audit dữ liệu hiện tại

Audit chỉ đọc xác nhận 91 sản phẩm (86 món và 5 combo), 11 danh mục, 113 nguyên liệu, 91 công thức hiệu lực và 630 dòng BOM. Năm combo có 16 dòng thành phần. Tất cả sản phẩm có mô tả; dữ liệu giá/tên/mô tả của bộ danh mục khớp database tại thời điểm audit. Đây là dữ liệu vận hành mô phỏng của dự án, không tự coi là dữ liệu nhà hàng thực tế hoặc bảo đảm chất lượng học máy.

| Nhu cầu | Có thể dùng ngay | Còn thiếu hoặc cần thận trọng |
| --- | --- | --- |
| Ngân sách | Giá VND hiện tại từ database, nhân số lượng và cộng bằng BigInt | Không dùng giá poster/model; tổng gợi ý là giá menu đã gồm VAT, trước giảm giá |
| Số người | Có đầu vào people; 34/91 mô tả có số người | 57 món chưa ghi số người; không có servings chuẩn, không cam kết vài món đủ no cho cả nhóm |
| Rau, đồ uống, tráng miệng | Danh mục runtime: Rau & đậu hũ, 9 thức uống, 13 tráng miệng | Thuộc nhóm rau không đồng nghĩa đã xác nhận món chay |
| Độ cay | BOM có ớt/tương ớt ở 16 sản phẩm; chỉ hai mô tả nói rõ cay | Chưa biết mức cay hoặc có thể bỏ ớt không |
| Món chay | Có các món cần quản trị rà soát | Không có trường xác nhận chay; nước mắm, nước dùng, gelatin và sốt phức hợp có thể làm suy luận từ tên sai |
| Hải sản/loại thịt | Có tên nguyên liệu chính trong BOM, thành phần combo | Không coi danh sách nguyên liệu kho là hồ sơ thành phần đầy đủ hoặc bằng chứng không có hải sản |
| Ăn nhẹ/chia sẻ | 19 mô tả ghi dùng chung | Chưa có định nghĩa món nhẹ, khẩu phần chia sẻ hoặc dinh dưỡng đã xác minh |
| Thành phần/dị ứng | Có BOM hiệu lực và 25 mô tả ghi chú một số thành phần | Chưa có hồ sơ allergen, nhà cung cấp, thành phần sốt/nước dùng hoặc lây nhiễm chéo; không xác nhận an toàn dị ứng |

Mức bổ sung tối thiểu sau này: trường khẩu phần tối thiểu/tối đa và dùng chung; vai trò món; mức cay và khả năng điều chỉnh; chế độ ăn; tags protein/ăn nhẹ có định nghĩa; chất gây dị ứng đã công bố và trạng thái rà soát. Mỗi xác nhận cần người/thời điểm/căn cứ và fingerprint phiên bản sản phẩm/công thức để vô hiệu khi công thức đổi. Nên quản lý các trường này qua ADMIN và lưu cùng nguồn dữ liệu dùng cho món nhập mới; không duy trì một bảng giá hoặc danh sách chay riêng trong model. Chưa thêm những trường này trong task hiện tại vì chưa có dữ liệu đã xác minh để điền.

### Kiến trúc và quyền

```text
Khách có phiên bàn hợp lệ
    → API trợ lý riêng, chỉ đọc
    → AssistantProvider.suggest(input, { signal })
    → quyết định JSON với productId / quantity / reasonCode
    → backend đọc lại database, xác minh và dựng card
    → khách tự xem/chọn; giỏ và gửi món vẫn dùng luồng hiện có
```

API không dùng lại `/guest/state` hoặc hàm `guest()` vì các luồng đó có cập nhật heartbeat/tính tài chính. Module mới xác thực guest bằng SELECT trong transaction READ ONLY, ràng buộc đúng nhà hàng, trạng thái khách và phiên bàn. Không nhận restaurantId/sessionId/participantId từ body. Không gửi credential, mã vào bàn, tên khách khác, giá vốn, số lượng kho hoặc dữ liệu tài chính tới provider. Kết nối database được trả trước khi chờ provider; sau đó xác thực lại guest và đọc lại các dữ kiện cần thiết.

Context chứa tối đa 120 sản phẩm với ID, tên, mô tả, danh mục, giá hiện tại, version, trạng thái khả dụng, tên nguyên liệu và thành phần combo. Nếu bị giới hạn thì có cờ và cảnh báo; không coi đó là toàn bộ thực đơn. Khả dụng được đọc bằng cùng hàm SQL hiện hành của menu. Kiểm tra cuối cộng nhu cầu nguyên liệu cho cả tập món/số lượng, làm tròn theo quy tắc giữ kho; không giữ hoặc trừ kho. Kiểm tra này bảo thủ: cần một vị trí kho đủ cho từng nguyên liệu, nên có thể từ chối khi hàng rải nhiều kho. Luồng đặt món hiện hành vẫn xác minh lần cuối và là nơi giữ kho thật.

### API và structured output

Backend: `GET /guest/menu-assistant/capabilities` và `POST /guest/menu-assistant/recommendations`. Qua frontend thêm tiền tố `/api`. Cả hai cần cookie guest của phiên đang hoạt động; POST còn cần Origin/CSRF theo cơ chế hiện hành. Xem schema và ví dụ trong [danh mục API](17-api.md).

```json
{
  "message": "Tôi đi 3 người, ngân sách 500.000đ và muốn có một món rau.",
  "people": 3,
  "budgetAmount": "500000",
  "preferences": { "include": ["VEGETABLE"] }
}
```

`message` tối đa 1.000 ký tự; people 1–20; tiền là chuỗi VND nguyên; danh sách và số lượng đều có giới hạn. Không lưu hội thoại hoặc hồ sơ dị ứng. Bản foundation yêu cầu people/budget ở trường có cấu trúc; nếu chỉ viết con số trong câu tự nhiên thì hỏi lại. Chưa có bước trích xuất ý định tự nhiên trong mock. Khi thêm model thật, có thể bổ sung bước trích xuất và cho khách xác nhận các trường này trước khi tư vấn; backend không lấy số tiền do model đoán làm ngân sách đã được xác nhận.

Provider chỉ được trả ba khóa: `kind`, `products`, `clarificationFields`. kind là RECOMMEND, CLARIFY, REFER_STAFF hoặc NO_MATCH. Mỗi dòng đề xuất có productId, quantity và reasonCode thuộc enum; không nhận tên món, giá, lời khẳng định dị ứng hoặc đoạn văn tùy ý do model trả. Các khóa giá/thông điệp tự tạo bị từ chối. Backend dựng tên, giá, tổng và lời giải thích từ dữ kiện/khung câu của hệ thống. Cách này hạn chế nội dung bịa giá ngay từ contract, thay vì để frontend đoán món qua text.

ID phải thuộc các món khả dụng trong context đã cấp và vẫn còn hợp lệ lúc đọc lại. ID trùng/không tồn tại, món ngừng bán, giá mới vượt ngân sách, thiếu loại món được yêu cầu hoặc thiếu nguyên liệu đều không tạo card gợi ý. HTTP 200 vẫn phải đọc status: RECOMMENDATIONS, CLARIFICATION, STAFF_REQUIRED, NO_MATCH hoặc UNAVAILABLE. Thiếu model, timeout hay dữ liệu provider sai trả fallback an toàn; không làm hỏng menu/giỏ/đơn/bếp/thanh toán.

Các yêu cầu chay/cay/protein/ăn nhẹ/chia sẻ/tránh thành phần/dị ứng được chuyển nhân viên khi metadata chưa được xác minh. Guard câu chữ được chuẩn hóa và xử lý một số cách nói phổ biến, không phải một bộ hiểu ngôn ngữ hoàn chỉnh hoặc chứng nhận y khoa. Mọi đề xuất đều nhắc giới hạn dị ứng và chưa giữ kho; không có câu “an toàn tuyệt đối”.

### Những phần code và cấu hình đã có

| Phần | Vị trí và vai trò |
| --- | --- |
| Contract | `packages/contracts/src/menu-assistant.ts`: schema, parser, kiểu và policy version 1 |
| Backend | `apps/api/src/modules/assistant/`: đọc context, abstraction provider, service và route |
| Mock | Provider xác định theo dữ liệu đầu vào; chỉ để kiểm tra cơ chế, không giả làm model AI |
| Dữ liệu và notebook | `ai/menu-assistant/`: JSONL, preflight, notebook QLoRA, profile dependency và Modelfile minh họa |
| Validator/evaluator | `scripts/menu-assistant-data.ts` và helper contract; chỉ đọc dữ liệu cục bộ, không truy cập DB/model |
| Tests | Contract/evaluator/provider unit và integration PostgreSQL cô lập |

Không có HTTP client Ollama/Qwen/OpenAI/Gemini, API key mới hoặc dependency ML trong Node runtime. Provider thật sẽ được inject qua options ở server; không sửa nghiệp vụ chính. Cấu hình sai tắt riêng trợ lý thay vì làm server gọi món không khởi động. `.env` đang dùng không bị sửa; biến mới chỉ nằm trong `.env.example` và mặc định OFF.

Rate limit hiện 6 lượt/60 giây theo khách/IP, tối đa 4 tác vụ inference, timeout mặc định 8 giây; giá trị có ràng buộc. Provider phải tôn trọng AbortSignal. Provider bỏ qua abort tiếp tục chiếm slot tới khi kết thúc để không tạo vô hạn tác vụ mồ côi. Các bộ đếm nằm trong bộ nhớ tiến trình; nhiều API instance cần cơ chế giới hạn chung trước khi mở AI ra Internet. Không log câu hỏi, dữ liệu dị ứng, context hoặc output thô.

### Dataset SFT và evaluation

Có 36 mẫu CURATED_SYNTHETIC, chia **24 train / 6 validation / 6 evaluation**. Mỗi dòng JSONL có id, groupId, scenario, source và messages theo system/user/assistant. User chứa JSON của request và runtime context; assistant chứa JSON quyết định. Giá/tồn trong context là fixture thay đổi theo tình huống, không phải kiến thức cố định cần học thuộc. Không trích khách hàng/giao dịch thật vào dataset.

Train dùng để tối ưu, validation chọn cấu hình, evaluation giữ riêng để so sánh cuối. Các biến thể cùng nhóm không sang split khác; ID, prompt chuẩn hóa và menu fixture được đối chiếu chống trùng/rò rỉ. Cặp evaluation đổi giá và trạng thái còn bán để buộc model dựa vào context. Bộ nhỏ chỉ là chuẩn cấu trúc/hành vi; chưa đủ chứng minh fine-tune có ích hoặc accuracy cao.

```bash
pnpm ai:data:validate
pnpm ai:evaluate --predictions var/ai/base-predictions.jsonl --output var/ai/base-report.json
pnpm ai:evaluate --predictions var/ai/lora-predictions.jsonl --output var/ai/lora-report.json
```

Tệp dự đoán do model thật sinh sau này, mỗi dòng `{ "id": "evaluation-001", "output": "chuỗi JSON thô model trả" }`. Bộ chấm không tự lấy đáp án mẫu làm dự đoán. Kiểm tra format, grounding ID/khả dụng, cấm giá tự tạo, ngân sách, nhóm món, hỏi lại và xử lý dị ứng; điểm kind/clarification đối chiếu đáp án, còn giá/ID kiểm bằng context. Mẫu thiếu hoặc sai vẫn nằm trong mẫu số; ID lạ/trùng không làm tăng điểm. Chưa có phép đo độ nhất quán lặp nhiều lần vì một dự đoán/mẫu chưa đủ; khi so sánh cần giữ seed, decoding, revision và chạy nhiều lượt có nhãn riêng.

### Notebook và lộ trình model thật

Notebook là scaffold, chưa được chạy với GPU. Các cờ install/train/generate/export mặc định False. Kiểm tra dữ liệu dùng Python standard library trước mọi bước tải; notebook không nằm trong luồng production. Profile dependency là ứng viên theo nguồn chính thức, chưa phải môi trường GPU đã được chứng nhận tương thích.

1. Giữ cấu trúc data/training và chạy validator TypeScript trước khi đưa lên Colab/Kaggle. Rà/mở rộng dữ liệu theo nhóm, giữ evaluation độc lập.
2. Chọn NVIDIA GPU, kiểm tra RAM/VRAM/disk và ghi exact revision của checkpoint Qwen3-4B; chủ động bật cell cài dependency rồi kiểm tra/restart kernel nếu cần.
3. Chạy riêng BASE để tạo dự đoán bằng checkpoint 4 bit chưa có LoRA, không bật training/export; lưu nhãn run riêng.
4. Chạy ADAPTER với QLoRA, rank 16, prompt/completion, completion_only_loss và validation riêng. Xem nhãn token để chắc prompt bị mask; mẫu vượt context phải báo lỗi, không cắt mất đáp án.
5. Lưu adapter/tokenizer cùng manifest môi trường, dữ liệu, template, cấu hình và revision. Tạo dự đoán held-out của adapter rồi chấm cùng evaluator với base. Không coi loss giảm là đã tư vấn tốt.
6. Sau khi kiểm tra mới merge 16 bit và export GGUF q4_k_m. Không commit weights/adapter vào Git; thư mục artifacts/outputs và các đuôi model đã được ignore.
7. Nhập complete merged GGUF vào Ollama bằng Modelfile minh họa; kiểm tra template/EOS/thinking và chạy lại evaluation để đo sai khác sau quantization/export. Không mặc định một adapter LoRA có thể được nạp trực tiếp bằng mọi phiên bản Ollama.
8. Viết adapter server thật: gửi shared JSON Schema, không-thinking và timeout/output/context có giới hạn; tôn trọng abort, không cấp tools ghi dữ liệu. Inject provider, kiểm thử trên staging, rồi mới bật cho khách và thêm UI chọn món có xác nhận.

Đối chiếu [Qwen3-4B chính chủ](https://huggingface.co/Qwen/Qwen3-4B), [TRL 0.22.2 SFT](https://huggingface.co/docs/trl/v0.22.2/en/sft_trainer), [Unsloth export GGUF](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf), [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs). Bản scaffold dùng prompt non-thinking và kiểm tra JSON cuối; không coi Qwen có khả năng agent là quyền để điều khiển nhà hàng.

Context runtime 91–120 món có thể vượt 4.096 token của profile notebook, trong khi fixture chỉ tối đa tám món. Provider thật phải đo token trước khi gửi, đặt giới hạn phù hợp tài nguyên hoặc chọn tập ứng viên có quy tắc; không cắt âm thầm thông tin hoặc giả coi tập bị cắt là toàn menu.

### Việc để sau deployment và rủi ro còn lại

Ưu tiên deploy web/API/database/kho ảnh, HTTPS, sao lưu, luồng gọi món/thanh toán và giám sát trước. Sau đó bổ sung metadata do quản trị xác minh, dữ liệu hội thoại được đồng ý/ẩn danh, evaluation lớn hơn, adapter thật, đo latency/tải/tài nguyên và UX xác nhận. Chưa thêm conversation memory, telemetry câu hỏi, embeddings, vector database hoặc RAG framework vì 91 sản phẩm chưa cần các tầng này.

Giới hạn hiện tại: chỉ MOCK/OFF hoạt động sẵn; NLP và UI AI chưa có; một số câu hỏi tự nhiên chưa được hiểu; metadata đang UNREVIEWED; kiểm kho không giữ chỗ; context tối đa 120 món; limiter chưa phân tán và quota IP có thể dùng chung giữa nhiều khách cùng Wi-Fi; dependency/notebook chưa GPU-tested; bộ evaluation nhỏ chưa đo chất lượng hoặc độ nhất quán model. [Hồ sơ kiểm tra](15-doi-chieu.md) tách rõ kiểm thử phần mềm và việc chưa train/model thật.
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
