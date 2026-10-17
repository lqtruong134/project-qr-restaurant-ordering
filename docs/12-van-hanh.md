# 12. Mở dự án, chạy và xử lý lỗi

## Vận hành stack qtruongres — 17/10/2026

Quy trình production nằm tại [bài 26 — Triển khai qtruongres](26-trien-khai-qtruongres.md): cấu hình riêng từ `deploy/.env.example`, build lần lượt, chuyển dữ liệu vào đích rỗng, migration chủ động, khởi động/dừng và sao lưu/khôi phục. Dùng `node scripts/deploy.mjs <lệnh> --env-file <tệp-riêng>` theo bài đó; không dùng các lệnh khởi động hoặc seed phát triển bên dưới để nâng cấp production. Giữ `AUTH_SECRET` và `RESTAURANT_ID` phù hợp khi chuyển dữ liệu hiện có; lưu bí mật riêng với mã nguồn và tài liệu.

Hiện đã chuẩn bị và diễn tập cục bộ, **chưa công bố trên Internet**. Domain/Cloudflare, tunnel và payOS thật cần cấu hình/nghiệm thu riêng; AI vẫn OFF. [Bài 15](15-doi-chieu.md) là nơi đối chiếu kiểm tra đã đạt và phần chưa kiểm tra. Backup chứa dữ liệu riêng của nhà hàng dù không đóng gói tệp môi trường; không đưa backup lên Git hoặc thư mục web.

Các mục còn lại của bài này mô tả môi trường phát triển và nghiệp vụ vận hành chung. Chi tiết production chỉ duy trì tại bài 26 để tránh hai quy trình khác nhau.

## Trợ lý thực đơn tùy chọn — 16/10/2026

Giữ `MENU_ASSISTANT_MODE=OFF` khi deploy giai đoạn này. `MOCK` chỉ là provider xác định kiểm tra contract/tools; chưa hiểu đầy đủ câu tự nhiên. `CUSTOM` cần adapter tin cậy được inject phía server, hiện chưa có adapter model thật. Timeout provider/tools mặc định 8000ms, 6 lượt/60000ms theo khách/IP, tối đa 4 tác vụ inference. Cấu hình sai tắt riêng trợ lý. Các biến chỉ ở backend, không dùng NEXT_PUBLIC; không cần Ollama để chạy nhà hàng.

V2 để AI tự đọc ba tools được phép và tự viết decision; API chỉ kiểm tra bảo mật, schema và giới hạn. `AVAILABLE` không xác nhận giá/ngân sách/sở thích chính xác. Hành động giỏ/đơn thật vẫn qua core hiện hành. Mỗi tool dùng transaction READ ONLY, xác thực lại guest, chỉ đọc trường thực đơn công khai; không có SQL tự do, thông tin kho/giá vốn, lương, khách hoặc tiền riêng. Tối đa 12 lượt thử/request, 2 lượt đồng thời/request và 2 lượt đọc tool trên mỗi Database; statement timeout 3s, kết quả 64KiB/lượt và 256KiB cộng dồn. Thu hồi tools không hủy tức thì SQL đã gửi.

`pnpm ai:data:validate` kiểm tra 36 mẫu JSONL bằng CPU. `pnpm ai:evaluate --predictions <jsonl> --output <json>` chấm raw predictions được cung cấp bên ngoài; không tạo kết quả model và không ghi đè nguồn. Facts/trajectory dành cho chấm độc lập, không dùng gold làm prediction. Notebook chỉ là scaffold nghiên cứu Colab/Kaggle, không là dependency ứng dụng và chưa GPU-validated. Không train, tải model, seed hoặc chạy migration để kiểm tra phần này.

Không có PostgreSQL login/role mới hoặc secrets AI trong repo. Đây là capability boundary trong API, không phải sandbox cho adapter JavaScript độc hại. Nếu tách dịch vụ AI sau này, cấp quyền trên surface duyệt riêng bằng bootstrap deployment, không GRANT toàn bộ bảng. `.env`, database nghiệp vụ và core không đổi trong đợt v2. Hướng dẫn kiến trúc, giới hạn và dị ứng ở [bài 14](14-mo-rong.md); kết quả kiểm tra ở [bài 15](15-doi-chieu.md).

## Cấu hình và vận hành payOS — 14/10/2026

payOS là tùy chọn của backend. Giữ tiền mặt và chuyển khoản thủ công khi online chưa được bật hoặc còn thiếu cấu hình. Các khóa chỉ đặt trong `.env` riêng của máy hoặc kho bí mật khi triển khai; không đặt trong biến `NEXT_PUBLIC_`, mã frontend, Git, tài liệu hay ảnh chia sẻ.

| Tên biến           | Dùng cho việc gì?                                 |
| ------------------ | ------------------------------------------------- |
| PAYOS_ENABLED      | Bật hoặc tắt tính năng online                     |
| PAYOS_CLIENT_ID    | Nhận diện kênh thanh toán                         |
| PAYOS_API_KEY      | Backend gọi API của kênh                          |
| PAYOS_CHECKSUM_KEY | Xác minh tính toàn vẹn dữ liệu thanh toán         |
| PAYOS_RETURN_URL   | Địa chỉ giao diện quay về sau thao tác thanh toán |
| PAYOS_CANCEL_URL   | Địa chỉ giao diện quay về khi hủy ở trang payOS   |
| PAYOS_WEBHOOK_URL  | Địa chỉ HTTPS công khai nhận webhook tại nhà hàng |

Bảng chỉ ghi **tên biến**, không ghi giá trị khóa. Nếu khóa đã xuất hiện trong ảnh hoặc nội dung chia sẻ, thay khóa trên dashboard payOS trước khi cấu hình sử dụng. Không sao chép khóa từ ảnh vào mã nguồn. [SDK Node chính thức](https://payos.vn/docs/sdks/back-end/node/).

`PAYOS_RETURN_URL` và `PAYOS_CANCEL_URL` do người vận hành cấu hình. Luồng phục vụ quản lý khoản thu dùng đường dẫn `/workspace/staff` trên đúng host của môi trường; nếu chưa đăng nhập thì đăng nhập nội bộ trước khi kiểm tra khoản thu. Khách theo dõi trạng thái ở phần Thanh toán của bàn, không cần dùng trang quản trị/nhân viên để xác nhận tiền. Production yêu cầu HTTPS. Webhook đăng ký phải tới **`/api/payments/webhooks/payos`** nếu đi qua web/proxy của dự án; nếu reverse proxy đi thẳng API thì backend nhận **`/payments/webhooks/payos`**. Địa chỉ localhost hoặc IP LAN chưa phải URL công khai mà payOS có thể gọi từ bên ngoài. Không tự mở toàn bộ máy hay database chỉ để nhận webhook.

### Kiểm tra cấu hình và đăng ký webhook

Các lệnh `pnpm payos:*` dưới đây nạp `.env` phát triển. Với production qtruongres, dùng cách nạp tệp cấu hình riêng trong [bài 26](26-trien-khai-qtruongres.md) để kiểm tra hoặc đăng ký đúng môi trường.

Trong gốc repository:

```bash
pnpm payos:check
```

Lệnh này chỉ kiểm tra cấu hình, **không gọi payOS**, không in giá trị khóa, không tạo link và không chuyển tiền. Thiếu cấu hình hoặc chưa bật online thì chỉnh môi trường riêng rồi kiểm tra lại. Áp dụng migration đang chờ bằng quy trình bảo trì/sao lưu thông thường; không cần reset/seed dữ liệu để bật payOS.

Khi đã có HTTPS công khai, route webhook hoạt động và bộ khóa mới đúng kênh, người vận hành chạy:

```bash
pnpm payos:register-webhook
```

Đây là thao tác gọi payOS để xác nhận/đăng ký URL; không phải lệnh kiểm tra chỉ đọc. payOS gửi một thông báo thử tới webhook. Backend xác minh chữ ký, lưu sự kiện chưa khớp khoản thu và không tạo tiền vào hóa đơn từ thông báo thử. Kiểm tra lại URL/kênh trên dashboard sau khi lệnh hoàn tất. Không chạy đăng ký tự động mỗi lần mở server. [Đăng ký webhook trong API payOS](https://payos.vn/docs/api/).

### Thử luồng thật với 5.000đ

payOS **không có sandbox/staging riêng**; chuyển khoản thử là giao dịch ngân hàng thật trên môi trường production. Bộ kiểm thử tự động của dự án dùng provider giả và database riêng, không thay cho việc nghiệm thu kênh thật. [Hướng dẫn môi trường kiểm thử chính thức](https://payos.vn/docs/moi-truong-test/).

1. Người vận hành tự chuẩn bị một phiên thử và một khoản phải trả **5.000đ** đúng nghiệp vụ; không sửa số tiền trực tiếp trong database. Thống nhất trước tài khoản nhận và cách xử lý khoản thử.
2. Khách gọi nhân viên, phục vụ nhận việc, chọn Online (payOS) và lập khoản thu đúng 5.000đ. Đối chiếu bàn, mã phiên và số tiền trước khi chuyển.
3. Người thử tự dùng ứng dụng ngân hàng chuyển tiền. Kiểm tra tiền vào tài khoản, webhook được nhận và giao diện tự ghi đúng một giao dịch 5.000đ. Quay lại trang thanh toán không tự tạo giao dịch thứ hai.
4. Thử tải lại giao diện và nút Kiểm tra trạng thái; tổng đã nhận phải giữ nguyên. Hoàn tất món/công việc, giao phiếu rồi chốt phiên theo quy trình thông thường.
5. Nếu quyết định hoàn khoản thử khi phiên còn mở, admin lập phiếu đúng nguồn, phục vụ thực trả và xác nhận; không giả nhận đã trả bằng việc bấm nút. Giữ chứng cứ nghiệm thu nhưng che khóa, cookie và thông tin ngân hàng không cần chia sẻ.

Các bước chuyển tiền thật do người dùng chủ động thực hiện; chưa được coi là hoàn tất chỉ vì unit/integration/browser tests đã đạt. Phạm vi đã kiểm tra của mỗi đợt nằm ở [bài 15](15-doi-chieu.md).

### Khi kết nối hoặc số tiền chưa rõ

| Tình huống                               | Cách xử lý                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Online chưa sẵn sàng                     | Chạy kiểm tra cấu hình; tiền mặt/chuyển khoản thủ công vẫn dùng được                         |
| Tạo link mất phản hồi                    | Kiểm tra lại khoản cũ; backend dùng cùng mã thanh toán để khôi phục, không tạo mã mới tùy ý  |
| Chưa có QR trong thẻ nhưng có link payOS | Mở trang thanh toán để dùng QR của provider; không nhập số tài khoản đoán để vẽ lại QR       |
| Đã chuyển nhưng còn chờ                  | Phục vụ kiểm tra trạng thái, admin đối chiếu sao kê và kênh; không xác nhận tay khoản online |
| Hủy đang chờ hoặc provider lỗi           | Giữ khoản đang xử lý; không thu tiền mặt thay thế khi kết quả ngân hàng chưa rõ              |
| Chuyển thiếu/thừa hoặc tiền đến muộn     | Đọc phần đã nhận/phần còn cần chuyển và hồ sơ đối soát; hoàn đúng nguồn nếu cần              |
| Phiên đã đóng rồi mới có thêm tiền       | Đối soát và trả khoản đến muộn bên ngoài; giữ nguyên phiếu đã chốt                           |

API kiểm chữ ký và đối chiếu từng tham chiếu ngân hàng; webhook lặp không cộng lại tiền. Tác vụ nền tiếp tục kiểm tra các khoản chờ theo thời gian của server. Sao lưu PostgreSQL cùng tài nguyên riêng của dự án; khóa payOS giữ riêng, không đưa vào tệp bằng chứng hoặc bản HTML chia sẻ. Không cam kết webhook luôn tới tức thời: sự cố mạng và ngân hàng vẫn cần quy trình đối soát.

## Danh mục và dữ liệu vận hành thống nhất — 13/10/2026

Danh mục có sẵn và danh mục nhập từ ADMIN dùng cùng các bảng, trạng thái bán, công thức kho, quyền thao tác và phiên bản. Bộ chuẩn gồm **86 món Việt, 5 combo, 113 nguyên liệu, 24 bàn, 3 khu vực và 3 kho**. Giá và định mức là cấu hình kế hoạch; nguồn nguyên liệu được đối chiếu trong bài 20.

`pnpm db:seed` dùng `restaurant-data.ts` để thêm cấu hình/danh mục còn thiếu, đưa ảnh vào kho chung và tạo lịch dự kiến. **Seed thường không reset dữ liệu, không thay mật khẩu hoặc giá món đã lưu, không ghi thêm tồn cho nguyên liệu đã có và không tự tạo giao dịch/chấm công.** Tài khoản, món và ảnh sau khi nhập được xử lý như dữ liệu nhập từ giao diện; không có cờ đặc biệt cho phép dữ liệu khởi tạo bỏ qua quy tắc khi sử dụng.

Dữ liệu lịch sử tháng 8–10 được tạo riêng bởi `scripts/restaurant-history.ts` và `restaurant-workforce-history.ts`, có manifest để nhận biết nguồn, phạm vi và kiểm tra. Đây là **dữ liệu vận hành mô phỏng phục vụ phát triển/nghiệm thu**, không phải chứng từ khách hàng hoặc tiền lương phát sinh thật. Có thể dùng để thử truy vấn, báo cáo và pipeline học máy; số lượng lớn không chứng minh độ chính xác trên dữ liệu thực tế. Khi triển khai ở nhà hàng, dùng seed danh mục/cấu hình, không nhập lịch sử mô phỏng vào dữ liệu vận hành thật.

Lệnh `pnpm db:seed:workforce` dùng bộ tính công hiện hành, mặc định chỉ xem trước và rollback. Khoảng ngày được chọn rõ bằng `--from=YYYY-MM-DD --through=YYYY-MM-DD`; muốn ghi phải dùng `--apply`. Nó không có chức năng xóa lịch/công/lương hiện có. Chạy lại cùng dataset đã hoàn tất không tạo bản trùng; không dùng lệnh này để sửa công đã duyệt.

Quy trình thay dữ liệu thử lần này dùng `scripts/restaurant-data-refresh.ts` với ba bước `--prepare`, `--history --with-workforce`, `--verify` trên database ứng viên riêng. Lệnh từ chối database từ xa, tên nguồn khác, tên ứng viên trùng nguồn và ứng viên chưa có manifest phù hợp. Sau khi kiểm tra mới chuyển database tại bước bảo trì riêng. Không có lệnh TRUNCATE/CASCADE áp dụng trực tiếp toàn bộ database đang vận hành.

Sao lưu cả PostgreSQL, `var/menu-images` và `var/payment-proofs` nếu dùng đường dẫn phát triển mặc định; đường dẫn thực tế có thể được cấu hình riêng. Trong stack qtruongres, hai kho tệp nằm trong volume `/data`; sao lưu/khôi phục đồng bộ theo [bài 26](26-trien-khai-qtruongres.md). Tệp sao lưu và manifest chi tiết ở `var/backups`/`var/data` là dữ liệu riêng, không đưa vào public hoặc tài liệu chia sẻ. [Cách thay ảnh và danh sách còn thiếu](20-anh-va-giao-dien.md).

## Ba nơi khác nhau

- Mã nguồn: `/home/quyettruong05/projects/qr-ordering-thesis` trong WSL Ubuntu.
- Bản đọc Windows: `C:\Users\Admin\Documents\Codex\QR-Restaurant-Thesis\Tai-lieu`.
- Dữ liệu PostgreSQL: Docker volume của dịch vụ postgres; `.env` chứa thông tin kết nối. Không nằm trong thư mục tài liệu.

Từ File Explorer có thể mở `\\wsl.localhost\Ubuntu\home\quyettruong05\projects\qr-ordering-thesis`. Trong Ubuntu terminal:

```bash
cd /home/quyettruong05/projects/qr-ordering-thesis
git status --short
node --version
pnpm --version
```

Repository yêu cầu Node 24 và ghi packageManager pnpm 12.3.4. Không tự nâng phiên bản trong lúc đang học/ổn định. Nếu terminal không nhận Node, nạp nvm đã cài bằng lệnh dưới; nếu chưa cài nvm thì cần thiết lập môi trường trước, không suy ra code ứng dụng hỏng.

```bash
source ~/.nvm/nvm.sh
nvm use
```

## Khởi động trên máy đã có dự án và dữ liệu

Mở Docker Desktop, chờ engine hoạt động và WSL integration sẵn sàng. Trong gốc repository:

```bash
pnpm db:up
pnpm db:check
pnpm dev
```

`pnpm dev` chạy API và web; giữ terminal mở. Mặc định web ở `http://127.0.0.1:3000`, API ở `http://127.0.0.1:4000`, PostgreSQL publish `127.0.0.1:5433` vào container 5432. Cấu hình thực tế trong .env có thể khác.

Kiểm tra GET `/api/health/live` trên web để xem API sống; GET `/api/health/ready` để kiểm tra kết nối database. Ready thành công chỉ chứng minh truy vấn kiểm tra kết nối thành công, không chứng minh toàn bộ nghiệp vụ đúng.

## Các lệnh có tác động khác nhau

| Lệnh                        | Ý nghĩa                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| pnpm setup                  | Thiết lập môi trường; dành cho khởi tạo, đọc script trước nếu đang có .env |
| pnpm db:up                  | Khởi động dịch vụ database theo compose                                    |
| pnpm db:down                | Dừng compose, script hiện không có cờ xóa volume                           |
| pnpm db:migrate             | Áp dụng migration đang chờ, làm thay đổi cấu trúc                          |
| pnpm db:generate            | Sinh Prisma Client từ schema                                               |
| pnpm db:seed / db:seed:core | Chạy seed dữ liệu mẫu; có ghi database                                     |
| pnpm test                   | Unit test theo cấu hình Vitest mặc định                                    |
| pnpm test:integration       | Các kiểm thử API/database, xem cách tạo database riêng trong test          |
| pnpm test:e2e               | Kịch bản trình duyệt và môi trường do scripts/browser-tests.ts quản lý     |
| pnpm build                  | Build web; có bước chuẩn bị Swagger từ tài liệu                            |
| pnpm payos:check            | Chỉ kiểm tra tên biến/URL cần thiết, không gọi provider hoặc in khóa       |
| pnpm payos:register-webhook | Gọi payOS xác nhận URL webhook HTTPS công khai do người vận hành cấu hình  |

Đừng dùng seed như nút “sửa tất cả”. Seed bootstrap hiện chỉ bổ sung dữ liệu thiếu, giữ tên nhà hàng/nhân viên/bàn, sức chứa, mật khẩu, giá món, tồn kho và trạng thái đã sửa. Đây không phải lệnh chỉ đọc. Cũng không cần migrate hay seed mỗi lần mở web đã hoạt động.

## Dùng điện thoại qua LAN

Trong Ubuntu, sau khi biết IP LAN của máy:

```bash
LAN_HOST=192.168.1.10 pnpm dev:lan
```

Thay địa chỉ ví dụ bằng IP thật. Script mở web trên 0.0.0.0 và thêm Origin tương ứng. QR cho điện thoại phải dùng host điện thoại truy cập được; `localhost` trên điện thoại trỏ về điện thoại. Còn cần cùng mạng và cấu hình mạng/firewall phù hợp của máy. Không coi dev:lan là triển khai production có HTTPS.

## Chẩn đoán từ ngoài vào trong

| Triệu chứng                    | Kiểm tra đầu tiên                        | Bằng chứng nên ghi                              |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------- |
| Không mở được trang            | Terminal web, host/cổng                  | URL, thông báo terminal                         |
| Trang mở nhưng tải dữ liệu lỗi | `/api/health/live`, API process          | HTTP status và request path                     |
| Ready 503 / ECONNREFUSED       | Docker/PostgreSQL, cổng, .env đang dùng  | Ready response, tên dịch vụ; không gửi password |
| 401 sau một thời gian          | Access hết hạn hoặc đăng nhập nơi khác   | Thời điểm, role, errorCode                      |
| 403                            | Quyền, Origin, header CSRF               | errorCode và hành động                          |
| 409 giỏ/kho/phiếu              | Dữ liệu đã bị thay đổi                   | version đã nhìn và thao tác vừa xảy ra          |
| Không đóng được bàn            | Món, tiền, intent/refund, support/alert  | Thông báo backend, trạng thái phiên             |
| QR không vào được              | QR bị thu hồi/hết hạn, bàn/khu vực ngừng | Chỉ ghi mã bàn, không phát tán token            |

Mở DevTools → Network → chọn request lỗi → xem Status và Response. Khi báo lỗi, chép `userMessage`, `errorCode`, correlationId nếu có. Không chép Cookie, Authorization, password hoặc toàn bộ .env.

## Mẫu báo lỗi có ích

```text
Chức năng / vai trò:
Môi trường / URL / commit:
Điều kiện trước khi làm:
Các bước tái hiện:
Kết quả mong đợi:
Kết quả thực tế:
API + HTTP + errorCode + correlationId (nếu có):
Có lặp lại được không? Một người hay hai người thao tác cùng lúc?
```

## Tài nguyên ngoài database

Ảnh món được chuẩn bị sẵn và ảnh ADMIN tải lên dùng chung kho runtime `var/menu-images` ở gốc repository, hoặc thư mục MENU_UPLOAD_DIR được cấu hình riêng. CSDL giữ URL ảnh dùng để hiển thị. Đây là tệp vận hành cần sao lưu, không xóa như tài liệu; không còn dùng thư mục public/menu để đoán ảnh theo mã món. [Bài 20](20-anh-va-giao-dien.md) mô tả cấu trúc hiện hành.

## Tự kiểm tra

Giải thích khác biệt giữa db:migrate, db:seed và db:generate. Đáp án: thay cấu trúc, ghi dữ liệu mẫu, sinh thư viện truy cập. Cả ba không thay thế việc kiểm tra Docker và chọn đúng database.

## Hồ sơ seed ngày 30/09/2026 — dữ liệu lịch sử

Các số liệu và cách dựng dữ liệu trong mục này thuộc đợt 30/09/2026, không mô tả bộ dữ liệu hiện hành sau hợp nhất tháng 8–10. Đọc phần hiện hành ở đầu bài và bài 15; không chạy reset để bật payOS. Lịch sử migration vẫn được giữ. Dữ liệu mới là **nhà hàng giả lập**, không phải hồ sơ giao dịch/nhân sự thật của một quán được sao chép.

| Nhóm                  | Dữ liệu sẵn có                                                                  |
| --------------------- | ------------------------------------------------------------------------------- |
| Nhà hàng              | Quyết Trường Bistro, bối cảnh món Việt tại Cần Thơ                              |
| Khu/bàn               | Trong nhà A01–A12; sân vườn V01–V08; phòng riêng P01–P04; 24 QR đã cấp          |
| Sức chứa              | 20 bàn thường × 4 chỗ; 4 phòng × 10 chỗ                                         |
| Thực đơn              | 6 danh mục × 8 món = 48 món, có mô tả/giá và ảnh SVG minh họa theo nhóm         |
| Nguyên liệu/công thức | 50 nguyên liệu; 48 BOM hoạt động với các dòng định lượng                        |
| Kho                   | KHO-BEP, KHO-KHO, QUAY-NUOC; 3 phiếu nhập đầu kỳ đã duyệt và movement tương ứng |
| Nhân sự               | 2 quản trị, 8 phục vụ, 6 bếp; tên mẫu khác nhau                                 |
| Lịch                  | 14 ngày tính từ ngày tạo seed, mỗi ngày 2 ca; có ngày nghỉ luân phiên           |
| Giao dịch mẫu         | 12 phiên đã đóng, 16 giao dịch thu, 1 giao dịch hoàn; 3 phiên còn mở            |

Giá món, giá nguyên liệu, giờ ca và đơn giá công là giả định minh họa có chủ đích; không phải khảo sát giá thị trường có chứng nhận. Thực đơn được lấy cảm hứng về cơ cấu món Việt từ website nhà hàng, không sao chép ảnh hay nhận là menu của họ. [Thực đơn Quán Ăn Ngon 138](https://quananngon138.com/menu-quan-ngon-138/).

Mật khẩu các tài khoản seed mới lấy từ SEED_PASSWORD trong `.env` hiện có, không ghi vào tài liệu. Đăng nhập mẫu: ADMIN `quyettruong05` hoặc `admin002`; STAFF `pv001`…`pv008`; KITCHEN `bep001`…`bep006`. Các role không kế thừa workspace của nhau; muốn thử phục vụ phải đăng nhập tài khoản phục vụ.

Không tạo chấm công hoặc chi lương giả rồi nhận là công thật. Có lịch và đơn giá minh họa để bạn tự thực hành quy trình vào/ra/duyệt công/lương. Việc áp dụng bảng lương vào một doanh nghiệp thật cần quy định nhân sự riêng, ngoài phạm vi demo.

## Nên xem dữ liệu mẫu ở đâu?

1. ADMIN → Tổng quan: xem 3/24 bàn đang phục vụ và số liệu thu/doanh số khác nhau. “Doanh số đã phục vụ” không phải tiền thu ròng.
2. STAFF → lịch sử phiếu: A01–A12 là 12 phiên đã hoàn tất. A01/A04/A07/A10 có chia thu; A04 có miễn món; A06 có miễn sau thanh toán và hoàn chuyển khoản.
3. Phòng P01: món vừa gửi, chờ bếp nhận. P02: món đang chế biến. P03: món đã phục vụ, chưa thanh toán. Bạn có thể tiếp tục xử lý đúng vai trò.
4. ADMIN → Bàn & QR → Xem/in QR hiện tại: mở link/scan để làm khách. QR cũ trước lần reset không còn hiệu lực.
5. ADMIN → Kho & công thức: kiểm tra tồn đã trừ theo các món đã prepare, giữ kho của món chờ và ba phiếu nhập đầu kỳ.
6. ADMIN → Ca làm & lương: xem lịch 14 ngày và phân công; điều chỉnh khu vực/nhân sự theo cách bạn muốn vận hành. Lịch seed là điểm bắt đầu để học, không phải tối ưu định biên cho nhà hàng thật.

Tất cả giao dịch mẫu được tạo qua API nghiệp vụ trong cùng ngày chạy seed, không giả lùi thời gian để tạo biểu đồ lịch sử nhiều tháng. Tên/mã ghi chú DEMO giúp phân biệt. Số lượng món/tiền có thể đổi khi bạn tiếp tục thực hành; không dùng con số ban đầu làm bất biến vĩnh viễn.

## Ba lệnh seed/reset khác nhau

```bash
# Bổ sung master data thiếu; giữ dữ liệu đã sửa/vận hành.
pnpm db:seed

# Dựng database thử riêng, chạy cả migration/seed/kịch bản/đối soát rồi tự dọn.
pnpm db:reset-demo --rehearse

# Chỉ khi chủ động muốn XÓA TOÀN BỘ dữ liệu demo hiện tại và làm mới.
# Dừng web/API, kiểm tra đúng database trong .env trước khi dùng.
pnpm db:reset-demo --confirm=qr_restaurant_ordering
```

Reset từ chối host không phải localhost, tên khác qr_restaurant_ordering, tên xác nhận không khớp, schema không đủ 55 bảng hoặc còn client khác nối vào. Nó migrate trước, truncate rõ 55 bảng public không dùng CASCADE, giữ `_prisma_migrations`, nạp master + kịch bản, đối soát tiền/kho và thử bootstrap lần hai. Không dùng reset như lệnh mở web thường ngày. Sau khi xóa thành công, nếu seed gặp lỗi thì dữ liệu cũ đã mất; đọc lỗi và chạy lại trên đúng demo, không giả định toàn bộ nhiều bước là một transaction.

Mã dữ liệu nằm ở `packages/database/src/demo-data.ts`; khởi tạo ở `seed.ts`, lịch ở `workforce-seed.ts`; kịch bản/đối soát ở `scripts/demo-scenarios.ts`; kiểm soát reset ở `scripts/reset-demo.ts`. Đây là các tệp cần đọc khi muốn hiểu từng bản ghi đến từ đâu.

## Dữ liệu ảnh chuyển khoản

Mặc định ảnh lưu ở var/payment-proofs tại gốc repo, hoặc PAYMENT_PROOF_DIR (đường dẫn tương đối tính từ apps/api khi chạy chuẩn). Đây là thư mục dữ liệu riêng, bỏ khỏi Git; phải lưu bền khi chuyển máy/triển khai. PostgreSQL giữ tên tệp và metadata, không giữ toàn ảnh. Chỉ mở bằng API có quyền, không chuyển ảnh sang public/. Migration 202610020001_payment_collection đã được áp dụng vào qr_restaurant_ordering; không cần reset hay seed lại để dùng UI mới.

## Ba kiểm tra khi đang phục vụ — 03/10

1. **Đủ tiền mà chưa đóng bàn:** mở Thu tiền & phiếu → Điều kiện kết thúc bàn. Đọc tên món và việc còn mở, bấm Xem món/Xem công việc; không xử lý bằng cách sửa database hoặc bỏ kiểm tra.
2. **Khách vừa rời bàn:** kết thúc khi đủ điều kiện, rồi vào Việc chung → Dọn bàn. Chỉ xác nhận Đã dọn xong sau khi dọn; Chờ dọn vẫn chặn mở bàn mới.
3. **Đang làm việc lâu:** web tự gia hạn mã truy cập nếu phiên còn hiệu lực. Nếu vẫn báo Phiên làm việc hết hạn, kiểm tra có đăng nhập cùng tài khoản ở hồ sơ/thiết bị khác, tài khoản bị đổi/khóa, hoặc đã hết thời hạn tuyệt đối không. Không dùng một tài khoản chung cho nhiều nhân viên. [Bài 11](11-bao-mat.md) giải thích ba loại phiên.
