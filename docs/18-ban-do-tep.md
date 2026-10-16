# 18. Bản đồ từng tệp nguồn

Danh mục tệp nguồn được Git quản lý và tệp mới chưa commit tại lần đối chiếu, bỏ bộ docs cũ và README cũ vì chúng đã được thay. Số dòng và SHA256 trong reference/audit.json dùng truy vết, không phải thước đo chất lượng. Các tệp sinh như node_modules, .next, generated Prisma, coverage, test-results và .runtime được giải thích riêng, không liệt kê hàng nghìn file thư viện.

| Tệp | Số dòng gần đúng | Vai trò |
|---|---:|---|
| [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts) | 191 | Điều kiện kết thúc bàn dùng chung cho bill xem trước, đóng thường và đóng ngoại lệ; nêu tên món, giai đoạn, tiền và công việc còn mở. |
| [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts) | 45 | Phục vụ xác nhận đã trao đổi trực tiếp về sự cố món; khóa phiên/cảnh báo và audit, độc lập với duyệt tiền. |
| [apps/api/src/modules/dining/transfer-reasons.ts](../apps/api/src/modules/dining/transfer-reasons.ts) | 20 | Kiểm tra mã lý do/ghi chú và định dạng chuỗi lưu lịch sử chuyển bàn. |
| [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts) | 139 | Bếp báo sự cố sau chế biến; audit/cảnh báo chờ quản trị, không tự bỏ tiền. |
| [apps/api/src/modules/orders/reasons.test.ts](../apps/api/src/modules/orders/reasons.test.ts) | 26 | Kiểm thử logic nhỏ của module. |
| [apps/api/src/modules/orders/reasons.ts](../apps/api/src/modules/orders/reasons.ts) | 40 | Kiểm tra lý do/ghi chú phía API; legacy text không tự cấp quyền miễn tiền. |
| [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts) | 190 | Lập/xác nhận khoản thu đúng người nhận; phân bổ theo khách, tiền thối và chống lặp mã/ảnh ngân hàng. |
| [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts) | 98 | Chứng từ riêng tối đa 2 MB; kiểm tra quyền owner trước khi tải cho khoản thu gắn lời gọi, chỉ STAFF/ADMIN được đọc. |
| [apps/api/src/modules/payments/payment-requests.routes.ts](../apps/api/src/modules/payments/payment-requests.routes.ts) | 107 | BILL có người nhận rõ ràng; chặn thu bỏ qua lời gọi, kiểm tra owner và kết thúc đúng các lời gọi khi bàn trả đủ. |
| [apps/api/src/modules/payments/refund-context.service.ts](../apps/api/src/modules/payments/refund-context.service.ts) | 36 | Lấy lý do hoàn từ quyết định ADMIN đã bỏ khoản thu món; lưu lý do lúc lập hồ sơ, không cần STAFF viết lại. |
| [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts) | 232 | API hỗ trợ, quyền sở hữu và bàn giao có người nhận xác nhận. |
| [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts) | 132 | Khóa dữ liệu, outbox/audit và truy vấn lịch sử hỗ trợ nhất quán. |
| [apps/web/app/support.css](../apps/web/app/support.css) | 238 | Điểm vào trang support.css hoặc CSS toàn ứng dụng. |
| [apps/web/app/table-transfer.css](../apps/web/app/table-transfer.css) | 363 | Điểm vào trang table-transfer.css hoặc CSS toàn ứng dụng. |
| [apps/web/features/admin/inventory-lines-form.tsx](../apps/web/features/admin/inventory-lines-form.tsx) | 287 | Biểu mẫu theo hai bước thông tin và nguyên liệu; dùng cho lập/sửa phiếu nhập và thay công thức. |
| [apps/web/features/admin/inventory-receipt-detail.tsx](../apps/web/features/admin/inventory-receipt-detail.tsx) | 225 | Đọc chi tiết phiếu và các dòng; sửa/hủy nháp hoặc xác nhận duyệt nhập kho. |
| [apps/web/features/admin/inventory-recipes.tsx](../apps/web/features/admin/inventory-recipes.tsx) | 180 | Danh sách món quản lý kho, công thức hiện hành và biểu mẫu tạo phiên bản công thức mới. |
| [apps/web/features/admin/inventory-ui.tsx](../apps/web/features/admin/inventory-ui.tsx) | 111 | Định dạng lượng/tiền, cảnh báo tồn và các thành phần phân trang/nhãn dùng chung cho kho. |
| [apps/web/features/admin/menu-panel.tsx](../apps/web/features/admin/menu-panel.tsx) | 299 | Danh sách 12 món mỗi trang, tìm/lọc, danh mục và hộp chỉnh sửa một món gồm ảnh/thông tin. |
| [apps/web/features/admin/support-report.tsx](../apps/web/features/admin/support-report.tsx) | 50 | ADMIN đọc hỗ trợ và lịch sử trong báo cáo. |
| [apps/web/features/admin/urgent-work.tsx](../apps/web/features/admin/urgent-work.tsx) | 140 | Thanh cảnh báo admin polling, dẫn thẳng đến món chờ duyệt và bàn cần hoàn tiền. |
| [apps/web/features/guest/bill-lines.tsx](../apps/web/features/guest/bill-lines.tsx) | 62 | Chi tiết tiền món phía khách, phân biệt giá trị gốc/bỏ tiền/vẫn tính phí. |
| [apps/web/features/guest/guest-support.tsx](../apps/web/features/guest/guest-support.tsx) | 122 | Gửi/reuse hỗ trợ và trạng thái yêu cầu chính khách. |
| [apps/web/features/guest/join-form.tsx](../apps/web/features/guest/join-form.tsx) | 95 | Tên, checkbox chưa chọn sẵn, validation và gửi acceptedPolicyVersion. |
| [apps/web/features/guest/payment-status.test.ts](../apps/web/features/guest/payment-status.test.ts) | 97 | Chín kiểm thử số dư, gồm bàn trống, giỏ, chờ duyệt, hủy/miễn, thanh toán đủ, hoàn một phần và hoàn đủ. |
| [apps/web/features/guest/payment-status.ts](../apps/web/features/guest/payment-status.ts) | 87 | Suy ra thông báo khách từ khoản phải thu, tiền đã nhận/hoàn, món chờ duyệt, giỏ và món hủy; không coi mọi số 0 là đã thanh toán. |
| [apps/web/features/guest/refund-summary.tsx](../apps/web/features/guest/refund-summary.tsx) | 70 | Khách xem đã hoàn, còn chờ, nhà hàng còn giữ và lịch sử trả tiền thực tế cho cả bàn. |
| [apps/web/features/shared/dish-image.tsx](../apps/web/features/shared/dish-image.tsx) | 38 | Hiển thị ảnh món dùng chung cho khách và ADMIN; giữ tỷ lệ/cắt khung, tải lười và chuyển sang hình giữ chỗ khi ảnh lỗi. |
| [apps/web/features/shared/policy-ui.tsx](../apps/web/features/shared/policy-ui.tsx) | 76 | Modal quy định, lời nhắc tại thao tác, hướng dẫn vai trò và trường chọn lý do. |
| [apps/web/features/shared/restaurant-time.test.ts](../apps/web/features/shared/restaurant-time.test.ts) | 18 | Hồi quy giờ qua ranh giới ngày khi thiết bị dùng UTC hoặc New York. |
| [apps/web/features/shared/restaurant-time.ts](../apps/web/features/shared/restaurant-time.ts) | 13 | Định dạng giờ và ngày giao dịch theo múi giờ Việt Nam, độc lập múi giờ thiết bị. |
| [apps/web/features/workforce/format.test.ts](../apps/web/features/workforce/format.test.ts) | 14 | Kiểm thử ngày theo lịch nhà hàng: giữ ngày nhập và phục hồi ngày từ DATE PostgreSQL được tuần tự hóa thành thời điểm UTC. |
| [apps/web/features/workforce/schedule-board.tsx](../apps/web/features/workforce/schedule-board.tsx) | 548 | Lịch ADMIN theo ngày/ca, tuần theo khung ca và tuần theo nhân viên; thống kê người/phân công và bộ lọc vai trò/khu vực. |
| [apps/web/features/workforce/schedule-data.test.ts](../apps/web/features/workforce/schedule-data.test.ts) | 56 | Kiểm thử đếm người khác lượt phân công, bỏ phân công hủy, ca qua đêm, ranh giới 00:00 và gom ca lặp. |
| [apps/web/features/workforce/schedule-data.ts](../apps/web/features/workforce/schedule-data.ts) | 52 | Đếm người khác nhau, kiểm tra ca giao với ngày trong múi giờ Việt Nam và gom khung ca lặp theo tên/giờ/nghỉ. |
| [apps/web/features/workforce/ui.tsx](../apps/web/features/workforce/ui.tsx) | 116 | Thành phần trình bày nhân sự dùng chung: lịch tuần, trạng thái công, tên nhân viên và định dạng giờ theo múi giờ nhà hàng. |
| [apps/web/features/workspace/close-checklist.tsx](../apps/web/features/workspace/close-checklist.tsx) | 57 | Hiển thị từng nguyên nhân chưa thể kết thúc bàn và nút đi tới đúng mục; trạng thái đủ điều kiện không đồng nghĩa khách đã rời bàn. |
| [apps/web/features/workspace/kitchen-issue.tsx](../apps/web/features/workspace/kitchen-issue.tsx) | 70 | Bếp chọn ba lý do nhanh và ghi chú tùy chọn để dừng món/báo sự cố. |
| [apps/web/features/workspace/payment-collection.tsx](../apps/web/features/workspace/payment-collection.tsx) | 524 | Thu cả bàn/món một khách/số tiền khác từ lời gọi đã nhận; giữ bản nhập qua polling, ba ô tiền và mã/ảnh chứng từ. |
| [apps/web/features/workspace/receipt-lines.test.ts](../apps/web/features/workspace/receipt-lines.test.ts) | 85 | Kiểm tra tiền gốc/net, lý do hủy, chống hiển thị trùng, snapshot cũ và sự cố chưa quyết định. |
| [apps/web/features/workspace/receipt-lines.ts](../apps/web/features/workspace/receipt-lines.ts) | 77 | Dựng dòng tiền và nhóm món thường/tặng/hủy; giữ đơn giá gốc, net 0 khi bỏ tiền, nhãn ngắn và tương thích snapshot cũ. |
| [apps/web/features/workspace/support-history.tsx](../apps/web/features/workspace/support-history.tsx) | 127 | Dialog lịch sử hỗ trợ/audit và trả focus về nút mở. |
| [apps/web/features/workspace/support-panel.tsx](../apps/web/features/workspace/support-panel.tsx) | 344 | Thẻ nhận việc, trách nhiệm và bàn giao trong hàng đợi/chi tiết bàn; BILL kết thúc chưa thu cần lý do, thu thành công tự kết thúc. |
| [apps/web/features/workspace/table-transfer-data.ts](../apps/web/features/workspace/table-transfer-data.ts) | 30 | Lọc bàn sẵn sàng đủ chỗ, xếp cùng khu/sức chứa/mã và tìm kiếm. |
| [apps/web/features/workspace/table-work.tsx](../apps/web/features/workspace/table-work.tsx) | 160 | Dựng việc theo bàn, gắn lời gọi/owner/cảnh báo; tránh tạo thẻ thu tiền trùng với lời gọi đang mở. |
| [apps/web/features/workspace/work-queue.tsx](../apps/web/features/workspace/work-queue.tsx) | 199 | Gom công việc theo bàn; bốn nhóm trách nhiệm, nhãn nhỏ và một nút mở chi tiết; không nhận việc khi chỉ mở xem. |
| [apps/web/lib/auth-renewal.test.ts](../apps/web/lib/auth-renewal.test.ts) | 106 | Gia hạn khi ACCESS_EXPIRED, coalescing, Web Locks, quyền bị thu hồi, lỗi mạng và không gửi lại thao tác ghi tùy tiện. |
| [apps/web/lib/media.ts](../apps/web/lib/media.ts) | 18 | Điểm tìm ảnh trong code: ảnh theo mã món, đồ họa nhận diện và hình giữ chỗ; ưu tiên URL ảnh đã tải lên. |
| [apps/web/public/images/README.md](../apps/web/public/images/README.md) | 14 | Hướng dẫn tìm và thay tài nguyên ảnh. |
| [apps/web/public/images/brand/restaurant-cover.svg](../apps/web/public/images/brand/restaurant-cover.svg) | 2 | Đồ họa nhận diện nhà hàng; không phải ảnh món thật. |
| [packages/database/resources/menu-images/README.md](../packages/database/resources/menu-images/README.md) | 11 | Hướng dẫn bộ ảnh cài đặt; ảnh cài đặt và ảnh ADMIN cùng được phục vụ từ kho runtime. |
| [apps/web/public/images/placeholders/dish.svg](../apps/web/public/images/placeholders/dish.svg) | 2 | Hình giữ chỗ trung tính cho món chưa có ảnh hoặc ảnh lỗi. |
| [apps/web/styles/experience.css](../apps/web/styles/experience.css) | 1079 | Bố cục mới bốn vai trò: header/menu gọn, thẻ công việc, bảng điều kiện đóng/dọn và ảnh thực đơn responsive. |
| [apps/web/styles/interface.css](../apps/web/styles/interface.css) | 2821 | Màu sắc, chữ, nút và bố cục hiện hành của tất cả vai trò; điều chỉnh điện thoại/máy tính sau các CSS nghiệp vụ. |
| [apps/web/styles/inventory.css](../apps/web/styles/inventory.css) | 800 | Kiểu trình bày, bố cục và trạng thái giao diện. |
| [apps/web/styles/issue.css](../apps/web/styles/issue.css) | 341 | Bố cục sự cố bếp/admin/phục vụ, thanh cảnh báo, căn cột phiếu và điện thoại/bản in. |
| [apps/web/styles/payment.css](../apps/web/styles/payment.css) | 354 | Bố cục thu tiền và việc tại bàn, màu ý nghĩa, tab chi tiết và đáp ứng điện thoại. |
| [apps/web/styles/work-queue.css](../apps/web/styles/work-queue.css) | 206 | Thẻ bàn trung tính, nhãn màu có chữ; lưới responsive ba/hai/một cột và bộ lọc gọn. |
| [apps/web/styles/workforce.css](../apps/web/styles/workforce.css) | 1775 | Kiểu trình bày, bố cục và trạng thái giao diện. |
| [packages/contracts/src/order-reasons.ts](../packages/contracts/src/order-reasons.ts) | 39 | Danh sách mã, nhãn tiếng Việt và tập lý do được phép theo scope. |
| [packages/contracts/src/restaurant-policy.ts](../packages/contracts/src/restaurant-policy.ts) | 118 | Nguồn văn bản quy định, version, tóm tắt, lời nhắc và quy trình theo vai trò dùng chung. |
| [packages/contracts/src/support-policy.ts](../packages/contracts/src/support-policy.ts) | 20 | Nhãn khách và ngưỡng tuổi chờ/polling cho hỗ trợ. |
| [packages/contracts/src/table-transfer-policy.ts](../packages/contracts/src/table-transfer-policy.ts) | 13 | Giới hạn số khách/ghi chú và nhãn lý do chuyển bàn dùng chung. |
| [packages/database/prisma/migrations/202609300001_review_integrity/migration.sql](../packages/database/prisma/migrations/202609300001_review_integrity/migration.sql) | 61 | Bước thay đổi cấu trúc 202609300001_review_integrity. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609300002_schema_alignment/migration.sql](../packages/database/prisma/migrations/202609300002_schema_alignment/migration.sql) | 7 | Bước thay đổi cấu trúc 202609300002_schema_alignment. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202610010001_guest_policy_order_reasons/migration.sql](../packages/database/prisma/migrations/202610010001_guest_policy_order_reasons/migration.sql) | 17 | Bước thay đổi cấu trúc 202610010001_guest_policy_order_reasons. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202610010002_support_handoffs/migration.sql](../packages/database/prisma/migrations/202610010002_support_handoffs/migration.sql) | 129 | Bước thay đổi cấu trúc 202610010002_support_handoffs. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202610010003_support_outbox_guards/migration.sql](../packages/database/prisma/migrations/202610010003_support_outbox_guards/migration.sql) | 16 | Bước thay đổi cấu trúc 202610010003_support_outbox_guards. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202610020001_payment_collection/migration.sql](../packages/database/prisma/migrations/202610020001_payment_collection/migration.sql) | 13 | Bước thay đổi cấu trúc 202610020001_payment_collection. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [scripts/demo-scenarios.ts](../scripts/demo-scenarios.ts) | 165 | Tạo giao dịch mô phỏng qua API thật và đối soát sổ kho/sổ tiền. |
| [scripts/reset-demo.ts](../scripts/reset-demo.ts) | 95 | Kiểm tra đúng database demo, migrate, thay dữ liệu có xác nhận đích; hỗ trợ chạy thử riêng. |
| [tests/browser/dish-issue.spec.ts](../tests/browser/dish-issue.spec.ts) | 251 | Kiểm thử ba vai trò, khách, cảnh báo chung, xác nhận báo khách, tiền cần hoàn và cột phiếu/bản in. |
| [tests/browser/interface.spec.ts](../tests/browser/interface.spec.ts) | 166 | Kiểm tra giao diện mới, phân trang/tìm món, thay ảnh thật, bảo vệ dữ liệu chưa lưu và ảnh lỗi trên desktop/Android/WebKit. |
| [tests/browser/inventory.spec.ts](../tests/browser/inventory.spec.ts) | 200 | Kiểm thử các góc nhìn kho và vòng đời phiếu nháp/sửa/duyệt/hủy trên 3 loại trình duyệt, đối chiếu số tồn thực. |
| [tests/browser/operations-experience.spec.ts](../tests/browser/operations-experience.spec.ts) | 194 | Bốn vai trò ở 320/390/768/1440px, ảnh không đè chữ, trả trước khi bếp nhận, dọn bàn bởi STAFF thứ hai, hai tab gia hạn và thao tác ghi đúng một lần. |
| [tests/browser/payment-collection.spec.ts](../tests/browser/payment-collection.spec.ts) | 418 | Thu tiền và hai STAFF: nhận, owner, lọc việc, bàn giao có xác nhận, thu tự kết thúc, điện thoại và tiền thối. |
| [tests/browser/policy.spec.ts](../tests/browser/policy.spec.ts) | 218 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/refund-experience.spec.ts](../tests/browser/refund-experience.spec.ts) | 232 | Trình duyệt ba cấu hình: cảnh báo dẫn đúng vùng hoàn, lý do quản trị, hoàn một phần/đủ, lịch sử khách và cảnh báo tự kết thúc. |
| [tests/browser/support.spec.ts](../tests/browser/support.spec.ts) | 237 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/table-queue.spec.ts](../tests/browser/table-queue.spec.ts) | 155 | Trình duyệt với API thật: ba bàn/bốn việc, một thẻ mỗi bàn, một nút, nhãn màu, responsive và bốn trạng thái số tiền 0. |
| [tests/browser/table-transfer.spec.ts](../tests/browser/table-transfer.spec.ts) | 287 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/ui-review.spec.ts](../tests/browser/ui-review.spec.ts) | 173 | Rà toàn bộ mục ADMIN, menu mở/thu gọn/tải lại, màn hình phục vụ/bếp/cá nhân, hộp thoại và các độ rộng từ 320px. |
| [tests/browser/workforce.spec.ts](../tests/browser/workforce.spec.ts) | 342 | Kiểm thử giao diện phân ca, duyệt công, bảng lương và chấm công cá nhân cho ADMIN/STAFF/KITCHEN trên desktop và hai loại trình duyệt điện thoại. |
| [tests/payment-collection.integration.test.ts](../tests/payment-collection.integration.test.ts) | 648 | API/CSDL: claim đồng thời, chặn bỏ qua/owner cũ, chứng từ, bàn giao, BILL cũ và nhiều lời gọi khi bàn trả đủ. |
| [tests/policy.integration.test.ts](../tests/policy.integration.test.ts) | 810 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/review.integration.test.ts](../tests/review.integration.test.ts) | 286 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/support.integration.test.ts](../tests/support.integration.test.ts) | 593 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/table-transfer.integration.test.ts](../tests/table-transfer.integration.test.ts) | 419 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [.env.example](../.env.example) | 17 | Tên biến môi trường và giá trị mẫu; không phải bí mật thực tế. |
| [.gitattributes](../.gitattributes) | 2 | Quy ước thuộc tính/line ending cho Git. |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | 30 | Workflow CI chạy các kiểm tra theo repository. |
| [.gitignore](../.gitignore) | 28 | Loại trừ bí mật/cache/kết quả sinh khỏi Git. |
| [.nvmrc](../.nvmrc) | 2 | Chỉ định nhánh Node dùng khi nvm use. |
| [.prettierignore](../.prettierignore) | 11 | Quy tắc định dạng hoặc kiểm tra mã nguồn. |
| [.prettierrc.json](../.prettierrc.json) | 6 | Quy tắc định dạng hoặc kiểm tra mã nguồn. |
| [apps/api/package.json](../apps/api/package.json) | 18 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [apps/api/src/app.test.ts](../apps/api/src/app.test.ts) | 69 | Kiểm thử logic nhỏ của module. |
| [apps/api/src/app.ts](../apps/api/src/app.ts) | 98 | Tạo Fastify, health endpoints và ánh xạ lỗi HTTP. |
| [apps/api/src/auth.ts](../apps/api/src/auth.ts) | 13 | Đầu vào công khai ghép đăng nhập và các workspace. |
| [apps/api/src/config.ts](../apps/api/src/config.ts) | 10 | Kiểm tra DATABASE_URL, host và port API. |
| [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts) | 244 | Đăng ký login/refresh/logout/me, cookie, CSRF và kiểm tra identity/permission. |
| [apps/api/src/modules/auth/login-limiter.ts](../apps/api/src/modules/auth/login-limiter.ts) | 22 | Giới hạn đăng nhập theo tài khoản/IP trong bộ nhớ. |
| [apps/api/src/modules/auth/session-cookies.ts](../apps/api/src/modules/auth/session-cookies.ts) | 42 | Ký access JWT, cấp/xóa cookie access và refresh. |
| [apps/api/src/modules/auth/types.ts](../apps/api/src/modules/auth/types.ts) | 29 | Kiểu cấu hình auth và identity gắn vào request. |
| [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts) | 287 | Quản trị khu vực/bàn/QR/menu; đọc catalog; kiểm tra phiên bản cập nhật. |
| [apps/api/src/modules/catalog/images.routes.ts](../apps/api/src/modules/catalog/images.routes.ts) | 53 | Nhận ảnh menu và phục vụ tệp ảnh đã lưu. |
| [apps/api/src/modules/catalog/qr-token.ts](../apps/api/src/modules/catalog/qr-token.ts) | 22 | Mã hóa/giải mã token QR để quản trị lấy lại. |
| [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts) | 302 | Mở/xác minh/đóng/dọn, cảnh báo và thiếu tiền; hỗ trợ đã tách sang module support. |
| [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts) | 98 | Chuyển bàn nguyên phiên và đọc lịch sử. |
| [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts) | 72 | Tạo khoản phải thu và tính lại số dư tài chính phiên. |
| [apps/api/src/modules/index.ts](../apps/api/src/modules/index.ts) | 42 | Ghép các module nghiệp vụ vào Fastify. |
| [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts) | 411 | Nguyên liệu/kho/công thức, phiếu nhập và điều chỉnh tồn. |
| [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts) | 123 | Giữ, trả giữ và tiêu hao nguyên liệu. |
| [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts) | 119 | Tác vụ 5 giây: phiên rỗng, review/payment hết hạn, phát outbox. |
| [apps/api/src/modules/orders/cancellation.service.ts](../apps/api/src/modules/orders/cancellation.service.ts) | 30 | Chuyển yêu cầu hủy cả lượt sang xử lý từng món đủ điều kiện. |
| [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts) | 180 | ADMIN hủy muộn và miễn khoản thu, ghi audit. |
| [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts) | 152 | Chuyển trạng thái từng món, tổng hợp batch, hủy từng dòng. |
| [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts) | 249 | Đăng ký submit/review/kitchen/item/serve/cancel theo vai trò. |
| [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts) | 198 | Submit: đọc giỏ/dòng, giá, policy, giữ kho, review/charge, history/outbox. |
| [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts) | 243 | Bill, intent, xác nhận tiền, hoàn, báo cáo và lịch sử phiếu thu. |
| [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts) | 106 | Đọc bill và chụp phiếu thu lúc đóng. |
| [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts) | 228 | Hợp đồng HMAC connector, chống lặp, ghi nhận tiền và đối soát muộn. |
| [apps/api/src/modules/risk/policy.service.ts](../apps/api/src/modules/risk/policy.service.ts) | 35 | Cấu hình mặc định và đọc override có hiệu lực. |
| [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts) | 95 | Xem/cập nhật phiên bản ngưỡng chính sách. |
| [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts) | 345 | QR/join/state, giỏ, đổi tên/rời bàn và hỗ trợ. |
| [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts) | 152 | Kiểm tra đầu vào, transaction, khóa phiên, xác thực guest, ghi history/outbox. |
| [apps/api/src/modules/shared/idempotency.ts](../apps/api/src/modules/shared/idempotency.ts) | 47 | Khóa chống lặp, hash request và snapshot kết quả order/payment. |
| [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts) | 103 | Tạo/sửa tài khoản, vai trò và thu hồi phiên. |
| [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts) | 285 | Lập nháp, điều chỉnh, chốt và ghi nhận chi lương. |
| [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts) | 294 | Ca, phân công, chấm công cá nhân, đơn giá và duyệt công. |
| [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts) | 88 | Khóa nghiệp vụ nhân sự, kiểm tra kỳ, tính gợi ý phút công. |
| [apps/api/src/modules/workspaces/routes.ts](../apps/api/src/modules/workspaces/routes.ts) | 15 | Ba endpoint workspace với quyền riêng. |
| [apps/api/src/server.ts](../apps/api/src/server.ts) | 31 | Điểm khởi động API: đọc config, tạo database, đăng ký auth/module, lắng nghe và đóng kết nối. |
| [apps/api/src/shared/http-errors.ts](../apps/api/src/shared/http-errors.ts) | 13 | Tệp hỗ trợ của apps/api/src/shared; xem nội dung để xác định chi tiết. |
| [apps/api/tsconfig.json](../apps/api/tsconfig.json) | 7 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [apps/web/app/api-docs/page.tsx](../apps/web/app/api-docs/page.tsx) | 18 | Điểm vào trang api-docs hoặc CSS toàn ứng dụng. |
| [apps/web/app/globals.css](../apps/web/app/globals.css) | 163 | Điểm vào trang globals.css hoặc CSS toàn ứng dụng. |
| [apps/web/app/guest/page.tsx](../apps/web/app/guest/page.tsx) | 5 | Điểm vào trang guest hoặc CSS toàn ứng dụng. |
| [apps/web/app/layout.tsx](../apps/web/app/layout.tsx) | 19 | Layout gốc và các lớp bao giao diện. |
| [apps/web/app/login/page.tsx](../apps/web/app/login/page.tsx) | 99 | Điểm vào trang login hoặc CSS toàn ứng dụng. |
| [apps/web/app/page.tsx](../apps/web/app/page.tsx) | 82 | Điểm vào trang page.tsx hoặc CSS toàn ứng dụng. |
| [apps/web/app/workspace/[area]/page.tsx](../apps/web/app/workspace/[area]/page.tsx) | 136 | Điểm vào trang workspace/[area] hoặc CSS toàn ứng dụng. |
| [apps/web/app/workspace/page.tsx](../apps/web/app/workspace/page.tsx) | 11 | Điểm vào trang workspace hoặc CSS toàn ứng dụng. |
| [apps/web/features/admin/admin-forms.tsx](../apps/web/features/admin/admin-forms.tsx) | 146 | Các form dùng trong quản trị. |
| [apps/web/features/admin/admin-types.ts](../apps/web/features/admin/admin-types.ts) | 24 | Kiểu dữ liệu giao diện quản trị. |
| [apps/web/features/admin/admin.tsx](../apps/web/features/admin/admin.tsx) | 620 | Ghép các vùng quản trị và tải dữ liệu nền. |
| [apps/web/features/admin/inventory-panel.tsx](../apps/web/features/admin/inventory-panel.tsx) | 715 | Ghép 5 mục kho: tồn, phiếu nhập, công thức, lịch sử, danh mục; lọc/tìm/phân trang và mở chi tiết riêng. |
| [apps/web/features/admin/order-exceptions.tsx](../apps/web/features/admin/order-exceptions.tsx) | 261 | Giao diện hủy muộn/miễn tiền. |
| [apps/web/features/admin/product-image.tsx](../apps/web/features/admin/product-image.tsx) | 70 | Kiểm tra PNG/JPEG/WebP tối đa 2 MB, bảo vệ nội dung chưa lưu, tải ảnh qua API và cập nhật URL/phiên bản món. |
| [apps/web/features/admin/receipt-editor.tsx](../apps/web/features/admin/receipt-editor.tsx) | 76 | Thành phần phiếu nháp cũ còn trong nguồn; giao diện kho hiện hành dùng inventory-receipt-detail.tsx. |
| [apps/web/features/admin/reports-panel.tsx](../apps/web/features/admin/reports-panel.tsx) | 264 | Tổng quan số liệu và 6 mục riêng: đối soát phiên, doanh số món, tiền đã thu, hồ sơ thiếu tiền, xử lý món và hỗ trợ tại bàn. |
| [apps/web/features/admin/risk-panel.tsx](../apps/web/features/admin/risk-panel.tsx) | 106 | Chia chính sách thành gọi món, bàn/thanh toán và ca/chấm công; lưu theo API hiện có và kiểm tra nội dung chưa lưu. |
| [apps/web/features/admin/stock-adjustment.tsx](../apps/web/features/admin/stock-adjustment.tsx) | 71 | Form COUNT/WASTE với version, requestId và lý do. |
| [apps/web/features/admin/users-panel.tsx](../apps/web/features/admin/users-panel.tsx) | 112 | Tạo/sửa nhân viên và quyền. |
| [apps/web/features/guest/guest-panels.tsx](../apps/web/features/guest/guest-panels.tsx) | 275 | Giỏ riêng theo chủ sở hữu và form yêu cầu thanh toán. |
| [apps/web/features/guest/guest.tsx](../apps/web/features/guest/guest.tsx) | 584 | Trang khách: QR, tham gia, tải trạng thái, menu, đơn, hỗ trợ. |
| [apps/web/features/shared/auth-boundary.tsx](../apps/web/features/shared/auth-boundary.tsx) | 50 | Màn hình chặn phiên bị khóa/hết hạn và thông báo quyền. |
| [apps/web/features/shared/components.tsx](../apps/web/features/shared/components.tsx) | 321 | Thành phần và hàm API/form dùng chung trong giao diện. |
| [apps/web/features/shared/primitives.tsx](../apps/web/features/shared/primitives.tsx) | 183 | Khối UI cơ bản, biểu tượng/modal/nút. |
| [apps/web/features/shared/request-id.ts](../apps/web/features/shared/request-id.ts) | 9 | Quản lý khóa request phía giao diện. |
| [apps/web/features/workforce/format.ts](../apps/web/features/workforce/format.ts) | 29 | Định dạng tiền, ngày và giờ cho nhân sự. |
| [apps/web/features/workforce/my-work.tsx](../apps/web/features/workforce/my-work.tsx) | 538 | Lịch, chấm công và phiếu lương cá nhân. |
| [apps/web/features/workforce/payroll-panel.tsx](../apps/web/features/workforce/payroll-panel.tsx) | 422 | Lập/chốt/ghi chi kỳ lương. |
| [apps/web/features/workforce/workforce-panel.tsx](../apps/web/features/workforce/workforce-panel.tsx) | 664 | Quản lý ca, phân công, duyệt công và đơn giá. |
| [apps/web/features/workspace/bill-panel.tsx](../apps/web/features/workspace/bill-panel.tsx) | 447 | Xem bill, intent, nhận tiền, hoàn tiền, đóng phiên. |
| [apps/web/features/workspace/order-card.tsx](../apps/web/features/workspace/order-card.tsx) | 160 | Thẻ lượt gọi và các thao tác trên từng món. |
| [apps/web/features/workspace/receipt.tsx](../apps/web/features/workspace/receipt.tsx) | 186 | Trình bày/in phiếu thu. |
| [apps/web/features/workspace/serve-selection.tsx](../apps/web/features/workspace/serve-selection.tsx) | 74 | Chọn các dòng món READY để phục vụ. |
| [apps/web/features/workspace/service-actions.tsx](../apps/web/features/workspace/service-actions.tsx) | 82 | Thao tác cảnh báo trên màn hình phục vụ; hỗ trợ đã tách sang support-panel. |
| [apps/web/features/workspace/service.tsx](../apps/web/features/workspace/service.tsx) | 852 | Màn hình STAFF/KITCHEN, polling, bàn/đơn và thao tác phục vụ. |
| [apps/web/features/workspace/table-transfer-panel.tsx](../apps/web/features/workspace/table-transfer-panel.tsx) | 523 | Chọn thẻ bàn, một bước xác nhận, thông báo và timeline lịch sử chuyển. |
| [apps/web/lib/api-client.test.ts](../apps/web/lib/api-client.test.ts) | 91 | Kiểm thử logic nhỏ của module. |
| [apps/web/lib/api-client.ts](../apps/web/lib/api-client.ts) | 115 | Fetch cùng nguồn/cookie/CSRF, tự gia hạn ACCESS_EXPIRED hợp lệ và phối hợp nhiều request/tab; phiên bị thu hồi vẫn chặn. |
| [apps/web/next.config.ts](../apps/web/next.config.ts) | 29 | Rewrite /api sang API_BASE_URL và header web. |
| [apps/web/package.json](../apps/web/package.json) | 29 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [apps/web/postcss.config.mjs](../apps/web/postcss.config.mjs) | 2 | Cấu hình xử lý CSS/Tailwind. |
| [apps/web/public/menu/dessert.svg](../apps/web/public/menu/dessert.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/public/menu/drink.svg](../apps/web/public/menu/drink.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/public/menu/grill.svg](../apps/web/public/menu/grill.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/public/menu/rice.svg](../apps/web/public/menu/rice.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/public/menu/soup.svg](../apps/web/public/menu/soup.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/public/menu/starter.svg](../apps/web/public/menu/starter.svg) | 1 | Ảnh menu có sẵn thuộc asset ứng dụng. |
| [apps/web/scripts/prepare-docs.mjs](../apps/web/scripts/prepare-docs.mjs) | 62 | Tạo asset Swagger từ docs/openapi.yaml và docs/core45/openapi-paths.json; phụ thuộc lúc dev/build. |
| [apps/web/scripts/swagger-init.js](../apps/web/scripts/swagger-init.js) | 23 | Khởi tạo Swagger và hỗ trợ request demo. |
| [apps/web/styles/restaurant.css](../apps/web/styles/restaurant.css) | 2755 | Kiểu trình bày, bố cục và trạng thái giao diện. |
| [apps/web/styles/service.css](../apps/web/styles/service.css) | 458 | Kiểu trình bày, bố cục và trạng thái giao diện. |
| [apps/web/styles/typography.css](../apps/web/styles/typography.css) | 24 | Kiểu trình bày, bố cục và trạng thái giao diện. |
| [apps/web/tsconfig.json](../apps/web/tsconfig.json) | 29 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [compose.yaml](../compose.yaml) | 23 | Dịch vụ PostgreSQL, volume, cổng và healthcheck. |
| [eslint.config.mjs](../eslint.config.mjs) | 24 | Quy tắc định dạng hoặc kiểm tra mã nguồn. |
| [package.json](../package.json) | 50 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [packages/config/package.json](../packages/config/package.json) | 9 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [packages/config/tsconfig.base.json](../packages/config/tsconfig.base.json) | 17 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [packages/contracts/package.json](../packages/contracts/package.json) | 15 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) | 18 | Kiểu ServiceHealth, chính sách khách, mã lý do và ngưỡng/nhãn hỗ trợ dùng chung; chưa phải toàn bộ hợp đồng API. |
| [packages/contracts/tsconfig.json](../packages/contracts/tsconfig.json) | 9 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [packages/database/package.json](../packages/database/package.json) | 23 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [packages/database/prisma.config.ts](../packages/database/prisma.config.ts) | 3 | Cấu hình Prisma CLI và nguồn schema/migration. |
| [packages/database/prisma/migrations/202609100001_c0_c1/migration.sql](../packages/database/prisma/migrations/202609100001_c0_c1/migration.sql) | 341 | Bước thay đổi cấu trúc 202609100001_c0_c1. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609220001_core45/migration.sql](../packages/database/prisma/migrations/202609220001_core45/migration.sql) | 1146 | Bước thay đổi cấu trúc 202609220001_core45. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609220002_core45_guards/migration.sql](../packages/database/prisma/migrations/202609220002_core45_guards/migration.sql) | 146 | Bước thay đổi cấu trúc 202609220002_core45_guards. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609220003_core45_session_guard/migration.sql](../packages/database/prisma/migrations/202609220003_core45_session_guard/migration.sql) | 30 | Bước thay đổi cấu trúc 202609220003_core45_session_guard. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609230001_core_ledger_guards/migration.sql](../packages/database/prisma/migrations/202609230001_core_ledger_guards/migration.sql) | 46 | Bước thay đổi cấu trúc 202609230001_core_ledger_guards. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609230002_review_withdrawal/migration.sql](../packages/database/prisma/migrations/202609230002_review_withdrawal/migration.sql) | 5 | Bước thay đổi cấu trúc 202609230002_review_withdrawal. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609230003_qr_token_recovery/migration.sql](../packages/database/prisma/migrations/202609230003_qr_token_recovery/migration.sql) | 3 | Bước thay đổi cấu trúc 202609230003_qr_token_recovery. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609240001_unavailable_inventory/migration.sql](../packages/database/prisma/migrations/202609240001_unavailable_inventory/migration.sql) | 11 | Bước thay đổi cấu trúc 202609240001_unavailable_inventory. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609240001_workforce_table_transfer/migration.sql](../packages/database/prisma/migrations/202609240001_workforce_table_transfer/migration.sql) | 169 | Bước thay đổi cấu trúc 202609240001_workforce_table_transfer. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609240002_receipt_snapshot/migration.sql](../packages/database/prisma/migrations/202609240002_receipt_snapshot/migration.sql) | 13 | Bước thay đổi cấu trúc 202609240002_receipt_snapshot. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609240003_payroll_snapshot_guard/migration.sql](../packages/database/prisma/migrations/202609240003_payroll_snapshot_guard/migration.sql) | 33 | Bước thay đổi cấu trúc 202609240003_payroll_snapshot_guard. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270001_uat_item_lifecycle/migration.sql](../packages/database/prisma/migrations/202609270001_uat_item_lifecycle/migration.sql) | 10 | Bước thay đổi cấu trúc 202609270001_uat_item_lifecycle. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270002_partial_refunds/migration.sql](../packages/database/prisma/migrations/202609270002_partial_refunds/migration.sql) | 13 | Bước thay đổi cấu trúc 202609270002_partial_refunds. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270003_product_policy/migration.sql](../packages/database/prisma/migrations/202609270003_product_policy/migration.sql) | 6 | Bước thay đổi cấu trúc 202609270003_product_policy. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270004_attendance_outcome/migration.sql](../packages/database/prisma/migrations/202609270004_attendance_outcome/migration.sql) | 8 | Bước thay đổi cấu trúc 202609270004_attendance_outcome. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270005_operation_audit/migration.sql](../packages/database/prisma/migrations/202609270005_operation_audit/migration.sql) | 5 | Bước thay đổi cấu trúc 202609270005_operation_audit. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270006_payroll_payment_audit/migration.sql](../packages/database/prisma/migrations/202609270006_payroll_payment_audit/migration.sql) | 32 | Bước thay đổi cấu trúc 202609270006_payroll_payment_audit. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270007_receipt_draft_guard/migration.sql](../packages/database/prisma/migrations/202609270007_receipt_draft_guard/migration.sql) | 18 | Bước thay đổi cấu trúc 202609270007_receipt_draft_guard. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270008_refund_request_key/migration.sql](../packages/database/prisma/migrations/202609270008_refund_request_key/migration.sql) | 3 | Bước thay đổi cấu trúc 202609270008_refund_request_key. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609270009_staff_code/migration.sql](../packages/database/prisma/migrations/202609270009_staff_code/migration.sql) | 12 | Bước thay đổi cấu trúc 202609270009_staff_code. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/202609280001_stock_adjustment_trace/migration.sql](../packages/database/prisma/migrations/202609280001_stock_adjustment_trace/migration.sql) | 3 | Bước thay đổi cấu trúc 202609280001_stock_adjustment_trace. Đọc theo thứ tự cùng các migration sau; không chạy thay script tùy ý. |
| [packages/database/prisma/migrations/migration_lock.toml](../packages/database/prisma/migrations/migration_lock.toml) | 2 | Nhà cung cấp database của lịch sử migration. |
| [packages/database/prisma/schema.prisma](../packages/database/prisma/schema.prisma) | 1330 | Mô hình bảng/quan hệ để sinh Prisma Client; đọc thêm migration cho trigger/check/index SQL. |
| [packages/database/src/demo-data.ts](../packages/database/src/demo-data.ts) | 522 | Danh mục dữ liệu mẫu menu/nguyên liệu/nhân viên. |
| [packages/database/src/index.ts](../packages/database/src/index.ts) | 27 | Tạo pg pool và PrismaClient dùng cùng database; đóng/ping kết nối. |
| [packages/database/src/seed.ts](../packages/database/src/seed.ts) | 286 | Khởi tạo nhà hàng, quyền, menu/kho và nhân sự mẫu; không phải code chạy cho mỗi request. |
| [packages/database/src/workforce-seed.ts](../packages/database/src/workforce-seed.ts) | 88 | Dữ liệu mẫu cho nhân sự/lương. |
| [packages/database/tsconfig.json](../packages/database/tsconfig.json) | 9 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [packages/ui/package.json](../packages/ui/package.json) | 19 | Khai báo tên gói, script chạy, dependency và phiên bản. |
| [packages/ui/src/index.tsx](../packages/ui/src/index.tsx) | 10 | Các thành phần UI dùng chung. |
| [packages/ui/tsconfig.json](../packages/ui/tsconfig.json) | 15 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [playwright.config.ts](../playwright.config.ts) | 25 | Cấu hình kiểm thử trình duyệt Playwright. |
| [pnpm-lock.yaml](../pnpm-lock.yaml) | 4895 | Khóa phiên bản phụ thuộc cài đặt. |
| [pnpm-workspace.yaml](../pnpm-workspace.yaml) | 14 | Danh sách package thuộc monorepo và thiết lập pnpm. |
| [scripts/browser-tests.ts](../scripts/browser-tests.ts) | 41 | Tạo database và thư mục ảnh tạm riêng, chạy máy chủ kiểm thử và Playwright, dọn tài nguyên do bài kiểm thử tạo. |
| [scripts/check-secrets.mjs](../scripts/check-secrets.mjs) | 36 | Quét dấu hiệu bí mật trong tệp được quản lý. |
| [scripts/core-api-docs.ts](../scripts/core-api-docs.ts) | 189 | Sinh danh mục route module cho Swagger từ đăng ký code. |
| [scripts/database-docs.ts](../scripts/database-docs.ts) | 154 | Xuất từ điển/ERD từ metadata PostgreSQL. |
| [scripts/db-check.ts](../scripts/db-check.ts) | 13 | Kiểm tra kết nối/schema theo script. |
| [scripts/rehearsal.ts](../scripts/rehearsal.ts) | 108 | Kịch bản dựng dữ liệu và diễn tập demo. |
| [scripts/run.mjs](../scripts/run.mjs) | 91 | Nạp .env và điều phối dev/database/test/tài liệu. |
| [scripts/seed.ts](../scripts/seed.ts) | 12 | Nạp cấu hình và chạy seed dữ liệu mẫu; có ghi database. |
| [scripts/setup.mjs](../scripts/setup.mjs) | 23 | Thiết lập cấu hình môi trường ban đầu. |
| [tests/browser/auth-blocking.spec.ts](../tests/browser/auth-blocking.spec.ts) | 65 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/auth.spec.ts](../tests/browser/auth.spec.ts) | 41 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/core45.spec.ts](../tests/browser/core45.spec.ts) | 295 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/foundation.spec.ts](../tests/browser/foundation.spec.ts) | 31 | Kiểm thử trình duyệt và luồng UI. |
| [tests/browser/swagger.spec.ts](../tests/browser/swagger.spec.ts) | 49 | Kiểm thử trình duyệt và luồng UI. |
| [tests/core45.integration.test.ts](../tests/core45.integration.test.ts) | 1394 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/database.integration.test.ts](../tests/database.integration.test.ts) | 15 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/sprint1.integration.test.ts](../tests/sprint1.integration.test.ts) | 544 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tests/workforce.integration.test.ts](../tests/workforce.integration.test.ts) | 544 | Kiểm thử API/database và quy tắc nghiệp vụ. |
| [tsconfig.tools.json](../tsconfig.tools.json) | 8 | Cấu hình kiểm tra/biên dịch TypeScript. |
| [vitest.config.ts](../vitest.config.ts) | 8 | Chọn phạm vi chạy Vitest và cấu hình kiểm thử/coverage. |
| [vitest.integration.config.ts](../vitest.integration.config.ts) | 3 | Chọn phạm vi chạy Vitest và cấu hình kiểm thử/coverage. |
| [vitest.quality.config.ts](../vitest.quality.config.ts) | 19 | Chọn phạm vi chạy Vitest và cấu hình kiểm thử/coverage. |

## Tệp sinh và dữ liệu cục bộ

- node_modules: thư viện cài bởi pnpm; không đọc như code tự viết.
- packages/database/generated: Prisma Client sinh từ schema.
- apps/web/.next: kết quả/cache Next.js, không phải nguồn nghiệp vụ.
- apps/web/public/api-docs-assets: Swagger được prepare-docs sinh từ docs và thư viện.
- coverage, test-results: kết quả test; không coi số cũ là kết quả lần chạy hiện tại.
- .runtime và .env: cấu hình/dấu chạy cục bộ; không đưa bí mật vào tài liệu.
- var/menu-images hoặc MENU_UPLOAD_DIR: ảnh menu tải lên, là dữ liệu vận hành.
- var/payment-proofs hoặc PAYMENT_PROOF_DIR: ảnh chứng từ riêng; chỉ đọc qua API có quyền, cần lưu bền cùng dữ liệu ngân hàng.
- Docker volume postgres_data: dữ liệu PostgreSQL, tách khỏi repository và docs.

## Duy trì tài liệu

Sửa bài Markdown tương ứng, cập nhật phụ lục nếu API/schema đổi, kiểm tra lại link và mở HTML desktop/mobile. Giữ ngày và commit đối chiếu; không nối thêm bộ Sprint cũ song song. Khi schema đổi, thu lại metadata ở đúng database rồi dựng từ điển/sơ đồ; giữ phần giải thích nghiệp vụ được rà soát. Không sửa code chỉ để làm câu chữ tài liệu khớp với giả định.
