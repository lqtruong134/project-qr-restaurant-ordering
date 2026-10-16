# 10. Đọc mã nguồn theo đường đi của một nút bấm

## Đừng đọc từ tệp đầu đến tệp cuối

Chọn một chức năng, tìm giao diện, tìm chuỗi đường dẫn API, tìm route backend, tìm hàm dịch vụ, cuối cùng đọc SQL và migration. [Bản đồ tệp](18-ban-do-tep.md) giúp tra vị trí; không cần học thuộc mọi tệp tự sinh trong node_modules.

| Thư mục | Nhiệm vụ |
|---|---|
| apps/web/app | Trang và layout theo URL của Next.js |
| apps/web/features | Thành phần giao diện theo nghiệp vụ |
| apps/web/lib | Lớp gọi API và xử lý lỗi phiên |
| apps/api/src/modules | Route và dịch vụ nghiệp vụ backend |
| packages/database | Kết nối, schema, migration, seed |
| packages/contracts | Kiểu dùng chung; hiện rất nhỏ, không phải toàn bộ hợp đồng API |
| packages/ui | Thành phần UI dùng chung |
| scripts | Chạy môi trường, dữ liệu mẫu, test và sinh tài liệu |
| tests | Integration và kiểm thử trình duyệt |

## Bài đọc có hướng dẫn: bếp bắt đầu chế biến

**Bước 1 — Giao diện.** Mở `apps/web/features/workspace/order-card.tsx`. Tìm các thao tác `prepare`, `ready`, `accept`. Thành phần này được ghép vào màn hình service/bếp. Nó quyết định nút nào hiển thị, nhưng không được quyền tự quyết trạng thái database.

**Bước 2 — Gửi mạng.** Mở `apps/web/features/shared/components.tsx` và `apps/web/lib/api-client.ts`. Hàm API dùng đường dẫn `/api` ở trình duyệt, gửi cookie cùng request; thao tác ghi có header chống CSRF. `apps/web/next.config.ts` chuyển `/api/:path*` tới API_BASE_URL.

**Bước 3 — Route.** Mở `apps/api/src/modules/orders/orders.routes.ts`, tìm vòng lặp `['accept', 'prepare', 'ready', 'serve']`. Route được ghép thành `/core/items/:id/prepare`; quyền là kitchen.workspace, trừ serve dùng staff.workspace.

**Bước 4 — Transaction.** Route gọi `transaction(db, ...)`, rồi `transitionItem`. Đọc `shared/core-persistence.ts`: lấy connection, BEGIN, lock_timeout 5 giây, COMMIT hoặc ROLLBACK, trả connection về pool. Không phải mỗi câu SQL tự thành công độc lập.

**Bước 5 — Điều kiện nghiệp vụ.** Trong `item-lifecycle.service.ts`, tìm bảng transitions. Prepare chỉ nhận ACCEPTED và đưa sang IN_PREPARATION. Nó khóa phiên, item và batch, chặn các batch còn PENDING_REVIEW/đã từ chối/đã hủy.

**Bước 6 — Tác động kho.** `if (action === 'prepare') await consume(...)`. Vào `inventory.service.ts`: đọc reservation ACTIVE, giảm on_hand và reserved, tạo movement CONSUMPTION, chụp cost, đổi reservation sang CONSUMED. Available không giảm thêm vì đã giảm lúc reserve.

**Bước 7 — Kết quả.** Cập nhật status và mốc giờ, ghi history, tổng hợp batch, ghi event. Chỉ khi tất cả thành công mới commit. Màn hình đọc lại dữ liệu và hiện trạng thái mới.

## Đọc SQL có tham số

```ts
await c.query(
  'SELECT * FROM order_item WHERE id=$1 FOR UPDATE',
  [id],
);
```

`c` là connection trong transaction; `$1` nhận giá trị đầu tiên trong mảng `[id]`. PostgreSQL xử lý giá trị như dữ liệu. `FOR UPDATE` giữ khóa dòng cho giao dịch hiện tại. Không nối dữ liệu người dùng thẳng vào SQL. Các chỗ code ghép tên cột/bảng phải được kiểm soát từ danh sách nội bộ, không tùy ý từ request.

## Vì sao có cả Prisma và SQL?

Một số truy vấn đơn giản dùng `db.prisma.*`; nhiều nghiệp vụ phức tạp dùng `db.pool.query`/connection query để kiểm soát khóa, transaction và SQL cụ thể. Cả hai cùng PostgreSQL. Đừng tìm toàn bộ logic chỉ trong schema.prisma hoặc chỉ trong các hàm Prisma.

## Bài đọc thứ hai: gửi món

Theo đường `guest-panels.tsx` → `/guest/orders` → `orders.routes.ts` → `submit` trong `orders.service.ts` → `idempotent`, `reserve`, `addCharges` → các bảng order và inventory/finance. Vẽ lại bằng giấy; ở mỗi mũi tên ghi đầu vào và đầu ra. Sau đó đối chiếu [bài 04](04-goi-mon.md).

## Cách tìm trong trình soạn thảo

Dùng tìm toàn dự án với chuỗi chính xác như `/guest/orders`, `refund_due_amount`, `consume(` hoặc `receipt_snapshot`. Bỏ qua node_modules, `.next`, coverage và generated khi tìm logic tự viết. Các phần đó chủ yếu là thư viện hoặc kết quả sinh tự động.

Đọc tên hàm trước, điều kiện `if/reject` kế tiếp, rồi tác động `INSERT/UPDATE/DELETE`, cuối cùng xem return. Hỏi “trạng thái nào bị từ chối?” thường giúp hiểu nghiệp vụ nhanh hơn đọc từng dòng theo thứ tự.

## Tự kiểm tra

Bạn phải chỉ ra được nơi nút prepare hiển thị, quyền backend, trạng thái đầu/cuối, thời điểm trừ kho và nơi ghi lịch sử. Nếu chỉ tìm được nút mà không tìm được điều kiện backend thì chưa đủ hiểu chức năng.

## Tìm phần giao diện và ảnh

Thiết kế hiện hành ở apps/web/styles/interface.css. Ảnh dùng chung khai báo tại apps/web/lib/media.ts và hiển thị qua features/shared/dish-image.tsx. Quản lý món tách thành features/admin/menu-panel.tsx; tải ảnh ở product-image.tsx. Đọc [hướng dẫn thay ảnh](20-anh-va-giao-dien.md) trước khi đổi tài nguyên.


## Lần theo nút chuyển bàn mới

`features/workspace/table-transfer-panel.tsx` mở chọn/xác nhận; `table-transfer-data.ts` lọc và xếp bàn. POST tới `dining/table-transfer.routes.ts`; `shared/core-persistence.ts` khóa bằng ID phiên rồi đọc bàn hiện tại. Lý do được kiểm tra ở `dining/transfer-reasons.ts`. Trong transaction, UPDATE liên kết bàn của phiên, INSERT lịch sử và UPDATE trạng thái hai bàn. Các bảng giỏ/đơn/tiền vẫn liên kết cùng phiên. [Ví dụ và danh sách tệp bài 23](23-chuyen-ban.md).
