# Kiến trúc QR Restaurant Ordering

Tài liệu này mô tả cấu trúc đang chạy trong repository chính
`qr-ordering-thesis` sau đợt refactor. Đây là **modular monolith**: một API
Fastify, một ứng dụng Next.js và các package dùng chung được triển khai cùng
nhau, nhưng mã được chia theo ranh giới nghiệp vụ. Đây không phải là quy tắc
duy nhất cho mọi công ty; nó phù hợp với quy mô hiện tại và vẫn cho phép đội
phát triển tách tiếp khi có nhu cầu thật.

## 1. Cấu trúc sau refactor

```text
apps/
├── api/src/
│   ├── app.ts                         # Tạo Fastify, health check, lỗi HTTP chung
│   ├── server.ts                      # Composition root: config, DB, đăng ký module
│   ├── auth.ts                        # Public entry point cho auth + workspace
│   ├── config.ts                      # Đọc và kiểm tra cấu hình runtime
│   ├── modules/
│   │   ├── index.ts                   # Đăng ký tất cả module nghiệp vụ
│   │   ├── auth/                      # Login, refresh, logout, cookie, limiter
│   │   ├── staff-access/              # Tài khoản nhân viên, role và quyền
│   │   ├── catalog/                   # Danh mục, món, giá và trạng thái bán
│   │   ├── dining/                    # Khu vực, bàn, mở/đóng bàn, hỗ trợ, cảnh báo
│   │   ├── sessions/                  # QR join và luồng khách trong phiên bàn
│   │   ├── orders/                    # Đặt món, trạng thái bếp, hủy, idempotency
│   │   ├── finance/                   # Khoản phải thu và tính số dư dùng chung
│   │   ├── payments/                  # Payment intent, refund, report, webhook connector
│   │   ├── inventory/                 # Nguyên liệu, BOM, nhập kho, giữ và tiêu hao
│   │   ├── risk/                      # Chính sách và đánh giá rủi ro
│   │   ├── notifications/             # Maintenance và phát outbox event
│   │   └── shared/core-persistence.ts # Transaction context và helper SQL dùng chung
│   └── shared/http-errors.ts           # Lỗi HTTP dùng chung, không chứa nghiệp vụ
├── web/
│   ├── app/                            # Route, layout và composition của Next.js
│   ├── features/
│   │   ├── guest/guest.tsx             # Màn hình QR guest, giỏ, gọi món, thanh toán
│   │   ├── workspace/service.tsx       # Màn hình Staff/Kitchen
│   │   ├── admin/admin.tsx             # Màn hình quản trị
│   │   └── shared/components.tsx       # Form/action/kiểu hiển thị dùng chung
│   └── lib/api-client.ts               # Cookie, CSRF, refresh và lỗi API chung
└── ...
packages/
├── contracts/                          # Hợp đồng API chia sẻ
├── database/                           # Prisma client, migration, seed
├── ui/                                 # UI primitive dùng chung, không có nghiệp vụ
└── config/                             # Cấu hình TypeScript dùng chung
```

Các URL API vẫn giữ nguyên `/auth/*`, `/guest/*` và `/core/*`. Từ `core` ở
URL không có nghĩa backend còn một module khổng lồ; đó là prefix API cũ được
giữ để không phá client và tài liệu OpenAPI.

### Bản đồ di chuyển chính

| Trước | Sau | Trách nhiệm |
| --- | --- | --- |
| `modules/core/catalog.ts` | `modules/catalog/catalog.routes.ts` | Catalog và QR quản trị bàn |
| `modules/core/operations.ts` | `modules/dining/dining.routes.ts` | Dining, support, alert, đóng phiên |
| `modules/core/guest.ts` | `modules/sessions/guest.routes.ts` | Join QR, cart guest và guest order |
| `modules/core/orders.ts` | `modules/orders/orders.routes.ts` | Order workflow và helper nghiệp vụ order |
| `modules/core/cancellation.ts` | `modules/orders/cancellation.service.ts` | Hủy order dùng từ nhiều route |
| `modules/core/finance.ts` | `modules/payments/payments.routes.ts` | Thu tiền, hoàn tiền, báo cáo tài chính |
| `modules/core/webhooks.ts` | `modules/payments/webhooks.routes.ts` | Connector webhook HMAC hiện có |
| `modules/core/inventory.ts` | `modules/inventory/inventory.routes.ts` | Kho và các hàm giữ/tiêu hao |
| `modules/core/users.ts` | `modules/staff-access/staff-access.routes.ts` | Người dùng nội bộ |
| `modules/core/risk.ts` | `modules/risk/risk.routes.ts` | Risk policy |
| `modules/core/maintenance.ts` | `modules/notifications/maintenance.ts` | Hết hạn và outbox |
| `modules/core/common.ts` | `modules/shared/core-persistence.ts` | Connection, transaction, SQL helper |

Một số file vẫn có cả đăng ký route và use-case nội bộ vì chúng đã là đơn vị
cohesive, có transaction và query liên quan chặt chẽ. Không tạo `repository`
giả chỉ để chuyển tiếp một câu SQL. Khi một module có nhiều use-case độc lập,
hãy tách `*.service.ts` (như `orders/cancellation.service.ts`) và giữ route
chỉ làm adapter HTTP.

## 2. Hướng phụ thuộc

```text
app/server (composition)
        ↓
module routes ─────→ module services
        ↓                  ↓
  input guards       core-persistence
        ↓                  ↓
      contracts       Database transaction context
```

Quy tắc thực tế:

1. `server.ts` và `modules/index.ts` được phép biết mọi module để lắp ứng dụng.
2. Route nhận `request`, kiểm tra quyền/schema, chuyển input vào nghiệp vụ và
   trả kết quả. Route không nên tự mở kết nối mới cho từng query.
3. Service không nhận `FastifyRequest`/`FastifyReply` nếu không cần. Các hàm
   `reserve`, `release`, `consume`, `cancelBatch`, `recalculate` nhận
   `Connection` và có thể dùng trong cùng transaction.
4. Repository chỉ cần tạo khi có truy vấn đọc/ghi ổn định được dùng ở nhiều
   use-case. Hiện tại `core-persistence.ts` là lớp hạ tầng nhỏ hơn một
   repository tổng quát: nó giữ connection, `transaction`, khóa phiên và
   các helper SQL có tính toàn cục.
5. Một transaction phải truyền cùng `Connection` xuống các hàm con. Không
   gọi lại `transaction(db, ...)` từ bên trong một transaction đang chạy.
6. Module chỉ import API công khai của module khác. Hiện những hàm nghiệp vụ
   được dùng liên module là các export có chủ đích trong `orders.service.ts`,
   `inventory.service.ts` và `cancellation.service.ts`; việc tách tiếp nên
   chuyển chúng vào `*.service.ts`, không import ngược route mới.
7. `packages/contracts` không xuất toàn bộ model Prisma. Hợp đồng API chỉ
   chứa dữ liệu cần chia sẻ giữa server và browser.

## 3. Route, schema, service, repository và frontend

- **Route**: adapter HTTP. Ví dụ `apps/api/src/modules/payments/payments.routes.ts`
  khai báo URL, permission và chuyển body vào transaction.
- **Schema**: mô tả và kiểm tra input ở biên HTTP. Các module hiện đang dùng
  schema Fastify inline ở route vì số endpoint chưa lớn; khi một schema được
  dùng lại hoặc dài, đưa vào `payments.schemas.ts`/`orders.schemas.ts`.
- **Service**: quy tắc nghiệp vụ thuần hơn HTTP. Ví dụ
  `orders/cancellation.service.ts` và các hàm inventory nhận connection,
  không quyết định status code.
- **Repository**: nơi gom truy vấn có lý do tái sử dụng. Chưa tạo repository
  hàng loạt vì phần lớn SQL hiện phụ thuộc lock và transaction của use-case.
- **Component**: JSX hiển thị và tương tác. `features/admin/admin.tsx` không
  truy cập database; nó gọi API qua helper.
- **Hook**: state/effect dùng lại giữa component. Khi cần polling hoặc form
  logic dùng ở nhiều màn hình, đặt hook trong feature tương ứng.
- **API client**: `apps/web/lib/api-client.ts` giữ quy tắc cookie, CSRF,
  refresh và retry hiện có. Feature không tự viết lại các quy tắc này.

Frontend giữ `app/` cho route Next.js. Các page như
`app/workspace/[area]/page.tsx` chỉ ghép feature, còn UI nghiệp vụ nằm trong
`features/`. `packages/ui` chỉ chứa primitive giao diện, không import API,
database hay mã nghiệp vụ.

## 4. Hai luồng mẫu

### Đăng nhập

1. Browser ở `app/login/page.tsx` gọi `postApi` từ `lib/api-client.ts`.
2. `apps/api/src/auth.ts` là public entry point và đăng ký auth module.
3. `modules/auth/index.ts` kiểm tra CSRF, rate limit, username/password,
   tạo access/refresh cookie và trả `Identity`.
4. `modules/auth/session-cookies.ts` chỉ lo ký/đọc cookie; `types.ts` giữ kiểu.
5. `modules/auth/index.ts` truy vấn user theo `restaurantId`, nên quyền và
   phạm vi nhà hàng vẫn được kiểm tra ở backend.

### Đặt món và đi qua bếp

1. `features/guest/guest.tsx` gọi `/guest/cart`, sau đó `/guest/orders` qua
   helper API dùng cookie guest.
2. `modules/sessions/guest.routes.ts` lấy guest/session và gọi
   `transaction(db, async (c) => ...)`.
3. Trong cùng `Connection`, order use-case ở
   `modules/orders/orders.service.ts` khóa cart, chụp tên/giá món, chạy
   idempotency và gọi `reserve` ở `inventory/inventory.service.ts`.
4. Transaction commit hoặc rollback tại `shared/core-persistence.ts`; các
   helper không mở connection riêng.
5. Staff/Kitchen gọi các route order trong cùng module để duyệt, nhận bếp,
   chế biến và phục vụ. `dining/dining.routes.ts` xử lý mở/đóng phiên.
6. Thanh toán đi qua `payments/payments.routes.ts`, cập nhật account và
   điều kiện đóng phiên trong transaction. Webhook hiện tại là connector HMAC
   nội bộ, **chưa phải tích hợp VNPay/MoMo**.
7. `notifications/maintenance.ts` xử lý hết hạn và phát outbox định kỳ.

## 5. Thêm chức năng mới

1. Xác định nghiệp vụ: món ăn vào `catalog`, bàn/phiên vào `dining` hoặc
   `sessions`, thu tiền vào `payments`, kho vào `inventory`.
2. Thêm route gần module đó. Nếu input dài hoặc dùng lại, tạo
   `module.schemas.ts`; nếu quy tắc có thể test độc lập, tạo
   `module.service.ts`; nếu query lặp và có ý nghĩa riêng, tạo
   `module.repository.ts`.
3. Đăng ký module tại `apps/api/src/modules/index.ts` nếu có route mới.
4. Cập nhật `packages/contracts` chỉ khi client và server thật sự cần cùng
   một hợp đồng.
5. Thêm unit test cho service và integration test cho permission,
   transaction/idempotency/concurrency quan trọng.
6. Frontend đặt page trong `app/`, còn component, hook và API wrapper ở
   `features/<domain>/`. Không đưa secret, Prisma hoặc Fastify vào bundle.

## 6. Những điều cần tránh

- Query database trực tiếp trong component hoặc page browser.
- Cho route quyết định logic lock, snapshot, tiền hoặc trạng thái.
- Import vòng giữa `orders` và `payments`; dùng service công khai hoặc một
  use-case điều phối ở module sở hữu luồng.
- Đưa mọi thứ vào `shared`. Chỉ đưa hạ tầng thật sự dùng chung vào đó.
- Tạo một file cho mỗi bảng database hoặc một class chỉ bọc một lời gọi.
- Dùng lại kiểu Prisma làm API contract nếu nó làm lộ cột nội bộ.
- Tự viết lại CSRF/refresh/retry POST trong từng feature.
- Chạy integration test trên database có dữ liệu vận hành. Dùng database
  kiểm thử riêng theo hướng dẫn trong `README.md`.

## 7. Đánh đổi

- Giữ một process và một database giúp local development, transaction và
  debugging đơn giản hơn; đổi lại các module chưa có ranh giới deploy độc lập.
- Giữ SQL có khóa dòng và advisory lock bảo toàn tính đúng đắn; đổi lại
  repository không hoàn toàn thuần Prisma.
- Một vài file route còn chứa use-case cũ để tránh refactor hình thức và rủi
  ro đổi hành vi. Khi domain lớn lên, tách service theo use-case có test riêng.
- Prefix `/core` và hợp đồng API được giữ để tương thích; cấu trúc source
  mới là ranh giới bảo trì, không phải lý do đổi URL.
