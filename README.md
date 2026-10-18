# Hệ thống gọi món tại bàn bằng QR

Ứng dụng hiện hành gồm giao diện khách, phục vụ, bếp và quản trị; quản lý gọi món, khuyến mãi/VAT, thanh toán tiền mặt/chuyển khoản và payOS, kho và nhân sự. Đã tích hợp payOS với QR, webhook xác minh và đối soát; nền tảng AI Menu Assistant có API chỉ đọc và provider tùy chọn, mặc định tắt; chưa có model thật.

Bắt đầu học tại [docs/00-bat-dau.md](docs/00-bat-dau.md), hoặc mở [sổ tay HTML](docs/00-BAT-DAU.html). Bộ tài liệu có lộ trình 12 buổi và hướng dẫn nghiệp vụ/mã nguồn; ảnh chụp PostgreSQL ngày 15/10/2026 ghi nhận 67 bảng/786 cột. Kiến trúc AI v2 cập nhật ngày 16/10/2026; generator xác nhận 186 thao tác API. [Hồ sơ xác minh](docs/15-doi-chieu.md) nêu rõ những gì đã kiểm tra.

## Triển khai qtruongres — 17/10/2026

[Hướng dẫn triển khai trên laptop và chuyển sang VPS](docs/26-trien-khai-qtruongres.md) là quy trình chính cho stack Docker riêng gồm web, API, PostgreSQL, Caddy và Cloudflare Named Tunnel tùy chọn. Cấu hình production dùng tệp riêng từ `deploy/.env.example`; giữ `.env` và database phát triển riêng. Không tự seed dữ liệu khi khởi động hoặc nâng cấp.

Hiện mới chuẩn bị và diễn tập cục bộ, **chưa đưa website lên Internet**. Domain, tài khoản Cloudflare, token tunnel và giao dịch payOS thật còn do người vận hành thiết lập/nghiệm thu; AI vẫn OFF. Xem kết quả và giới hạn cụ thể ở [hồ sơ xác minh](docs/15-doi-chieu.md). Các lệnh cài đặt bên dưới dành cho môi trường phát triển; chuyển dữ liệu đang dùng phải theo quy trình sao lưu/khôi phục ở bài 26.

## Cài từ bản clone mới

Yêu cầu Node.js 24, pnpm 12.3.4 và Docker đang chạy; trên Windows dùng WSL cho các lệnh phát triển/kiểm thử. Trong gốc repository chạy lần lượt:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm db:up
pnpm db:migrate
pnpm db:generate
pnpm db:seed
pnpm dev
```

`setup` tạo `.env` cục bộ với bí mật ngẫu nhiên; không chia sẻ hoặc commit tệp này. Các tài khoản khởi tạo dùng mật khẩu `SEED_PASSWORD` trong `.env` của chính máy cài; không có mật khẩu chung được công bố. `db:generate` sinh Prisma Client nên cần chạy sau khi clone, vì mã sinh không nằm trong Git. Ảnh món/banner thực đơn được cài từ tài nguyên đã đóng gói vào kho runtime khi khởi tạo; ảnh ADMIN tải lên và dữ liệu PostgreSQL cần sao lưu riêng khi chuyển môi trường.

Lần khởi tạo mới tạo danh mục và lịch làm việc ban đầu, không tự sao chép lịch sử giao dịch hoặc hồ sơ trên máy khác. Khi đã có database vận hành, đọc [hướng dẫn vận hành](docs/12-van-hanh.md) trước khi chạy migration/seed; không dùng script reset cũ để nâng cấp dữ liệu.

## Chạy trên môi trường đã cài

Yêu cầu Node 24, pnpm theo packageManager và PostgreSQL qua Docker Desktop/WSL. Trong gốc repository: `pnpm db:up`, `pnpm db:check`, rồi `pnpm dev`. Xem [hướng dẫn vận hành](docs/12-van-hanh.md) trước khi chạy migration hoặc seed.

## Ảnh và giao diện

Xem [cách thay ảnh thật và bố cục từng vai trò](docs/20-anh-va-giao-dien.md). Ảnh món và banner thực đơn dùng cùng kho var/menu-images hoặc MENU_UPLOAD_DIR; database giữ đường dẫn. Ảnh thương hiệu/nền tĩnh nằm ở apps/web/public/images.

## Chính sách khách và xử lý món

[Hồ sơ chính sách và ma trận nghiệp vụ](docs/21-chinh-sach-va-ma-tran.md) ghi hồ sơ phiên bản 2026-10-v1, bằng chứng đồng ý, lý do hủy và quyền xử lý lỗi nhà hàng.

## Hỗ trợ và bàn giao

[Ví dụ hỗ trợ và bàn giao có xác nhận](docs/22-ho-tro-va-ban-giao.md) giải thích trách nhiệm, CSDL và kết quả kiểm thử. Chính sách hiện hành là 2026-10-v2; các bằng chứng đồng ý trước đó được giữ.

## Chuyển bàn

[Hướng dẫn chuyển cả phiên và lịch sử](docs/23-chuyen-ban.md): chọn thẻ bàn đủ chỗ, xác nhận một lần và giữ khách/giỏ/món/tiền. Đợt này không thêm migration hoặc reset dữ liệu.

## Sự cố món và phiếu thanh toán

[Hướng dẫn bếp báo lỗi, phục vụ trao đổi khách, admin duyệt và hoàn tiền](docs/24-su-co-mon-va-phieu-thanh-toan.md) giải thích thanh việc cần xử lý, lý do nhanh và phiếu có thành tiền 0đ. Không thêm migration hoặc reset dữ liệu.

## Thu tiền tại bàn

PayOS được cấu hình riêng phía backend; không sao chép khóa vào Git. Xem [biến môi trường, webhook HTTPS và test thật 5.000đ](docs/12-van-hanh.md), cùng [nghiệm thu](docs/15-doi-chieu.md). Merchant production do người vận hành cấu hình; bản sửa thanh toán 17/10 chưa deploy. Xem checklist cập nhật và đối soát ở đầu [runbook](docs/26-trien-khai-qtruongres.md).

[Khách gọi nhân viên, khoản thu, tiền thối và ảnh chuyển khoản](docs/25-thu-tien-tai-ban.md). Luồng thu tiền hiện hành đã bao gồm khuyến mãi, VAT và payOS; schema hiện có 67 bảng và 37 migration trong source (migration mới cần áp dụng có kiểm soát). Các phiếu chốt giữ ảnh chụp số liệu tại thời điểm thanh toán.

## Duy trì tài liệu

Markdown trong docs là nguồn chính. Chạy `node docs/tools/export-html.mjs` để sinh lại bản đọc HTML sau khi cập nhật. Giữ đồng bộ bản Windows ở thư mục Tai-lieu. Các tệp docs/openapi.yaml và docs/core45/openapi-paths.json được bước build Swagger sử dụng trực tiếp.

## Nền tảng AI Menu Assistant

Xem [ranh giới AI advisory v2, tools chỉ đọc và core transactional](docs/14-mo-rong.md). Provider chủ động đọc thực đơn được phép, tự tư vấn và hỏi lại; API trả nguyên decision đúng schema, không sửa giá/ngân sách/sở thích cho model. Core tiếp tục kiểm tra đầy đủ khi thực hiện giỏ/đơn thật. Mặc định OFF, không cần Ollama để chạy nhà hàng. `pnpm ai:data:validate` kiểm tra 36 mẫu tool trajectory; evaluator chấm raw predictions bằng facts độc lập. Notebook chỉ là scaffold, chưa có model/train/GPU hoặc UI AI. [Dữ liệu và notebook nghiên cứu](ai/menu-assistant/README.md).
