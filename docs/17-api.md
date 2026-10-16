# 17. Danh mục API hiện hành

## API trợ lý thực đơn — 15/10/2026

Đã thêm GET `/guest/menu-assistant/capabilities` và POST `/guest/menu-assistant/recommendations`, đều yêu cầu guest cookie; POST cần Origin/CSRF. Bản đăng ký hiện hành có **177 thao tác nghiệp vụ / 186 route tổng**, gồm 7 auth/workspace và 2 health (không tính HEAD tự sinh). Nền tảng mặc định OFF, không gọi model hoặc ghi giỏ/đơn/kho/tiền. Trong phản hồi HTTP 200 phải kiểm tra status; UNAVAILABLE là fallback, không phải món được đề xuất. [Contract và nghiệp vụ](14-mo-rong.md), schema request trong Swagger được sinh từ contract dùng chung.

## API thanh toán payOS — 14/10/2026

Backend tích hợp `@payos/node` phía server. Giá trị tiền gửi/nhận trong API nội bộ là chuỗi số nguyên VND; server dùng dư nợ sau giảm và VAT nằm trong giá, không nhận giá hoặc thuế do trình duyệt tự quyết định. Các route mới và thay đổi dưới đây bổ sung cho danh mục lịch sử; số route bản nghiệm thu xem [bài 15](15-doi-chieu.md).

| Phương thức | Đường dẫn backend                              | Quyền và trách nhiệm                                                                                                 |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| POST        | /guest/payment-requests                        | Cookie khách đúng phiên; có thể chọn ONLINE khi backend báo sẵn sàng, chỉ gọi phục vụ                                |
| POST        | /core/sessions/:id/payments                    | STAFF tạo CASH/BANK_TRANSFER hoặc ONLINE; online tạo link payOS đúng phần còn được phép thu                          |
| POST        | /core/payments/:id/refresh                     | STAFF phụ trách kiểm tra lại payOS; không xác nhận tiền thủ công                                                     |
| POST        | /core/payments/:id/cancel                      | STAFF hủy khoản; với PAYOS phải kiểm tra/hủy ở provider trước khi giải phóng phần chưa rõ                            |
| POST        | /payments/webhooks/payos                       | Provider ngoài hệ thống; không dùng cookie nhân viên/CSRF, bắt buộc chữ ký và đối chiếu server                       |
| GET         | /core/admin/payment-reconciliation             | ADMIN xem các hồ sơ online cần/đã đối soát                                                                           |
| POST        | /core/admin/payment-reconciliation/:id/resolve | ADMIN ghi kết quả/căn cứ; không sửa hoặc thêm payment giả                                                            |
| GET         | /core/admin/payment-webhooks/unmatched         | ADMIN xem tối đa 100 thông báo payOS có chữ ký hợp lệ, số tiền dương, chưa khớp khoản thu và thuộc nhà hàng hiện tại |
| GET         | /core/sessions/:id/bill                        | STAFF/ADMIN đọc khoản thu và khả năng online; phiếu đã đóng ưu tiên snapshot                                         |
| GET         | /guest/state                                   | Cookie khách đọc tiền và lịch sử khoản online thuộc bàn; không nhận khóa merchant                                    |

Trên web/proxy các đường dẫn backend có tiền tố **`/api`**. Vì vậy URL đăng ký webhook qua web kết thúc bằng **`/api/payments/webhooks/payos`**. Không gửi webhook payOS tới generic `/payments/webhooks/connector`: endpoint đó có hợp đồng và chữ ký khác.

Hộp thư chưa khớp là **danh sách chỉ đọc**, tách khỏi hồ sơ đối soát của các khoản thu đã có. Mỗi dòng chỉ có ID, mã thanh toán, số tiền/đơn vị tiền tệ, tham chiếu và thời điểm nhận; không trả tài khoản ngân hàng hoặc tên người chuyển. Thông báo kiểm tra đăng ký cũng có thể xuất hiện: số tiền không được tự tính vào hóa đơn, không có nút đánh dấu đã thanh toán. Webhook không chữ ký hợp lệ bị từ chối trước khi lưu; sự kiện khác nhà hàng hoặc số tiền không dương không nằm trong danh sách. Route tại [webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts).

### Ví dụ tạo khoản thu online

```json
{
  "requestId": "KHOA_RIENG_CHO_KHOAN_THU",
  "method": "ONLINE",
  "amount": "44100",
  "collectionScope": "TABLE",
  "supportRequestId": "00000000-0000-4000-8000-000000000001"
}
```

UUID minh họa phải thay bằng lời gọi của đúng phiên đã nhận; nếu không có lời gọi đang mở thì bỏ `supportRequestId`. Thu riêng người gọi dùng `collectionScope: PARTICIPANT` và `participantId` đúng phiên. Gửi lại cùng `requestId` và nội dung dùng khoản cũ; cùng khóa nhưng nội dung khác bị chặn. Khách không được gọi endpoint tạo QR này hoặc tự xác nhận khoản online; `POST /guest/payments` cũ không hỗ trợ ONLINE.

Khoản trả về có đối tượng `online` gồm provider, status, orderCode, checkoutUrl, qrCode, expiresAt, lastError, paidAmount và remainingAmount. `paymentCapabilities.online` cho biết có sẵn sàng online hay không; không suy ra đã trả tiền. Khi khôi phục link mất phản hồi, `qrCode` có thể rỗng còn `checkoutUrl` vẫn mở được trang payOS.

### Xác minh, chia khoản và giải quyết đối soát

Webhook có chữ ký hợp lệ vẫn phải khớp mã thanh toán, link, VND và từng giao dịch truy vấn từ payOS. Thiếu/sai chữ ký không ghi tiền. Mã kết quả ở `data` quyết định giao dịch hợp lệ; cờ hoặc query string thành công ở giao diện không thay thế dữ liệu này. [Tài liệu chữ ký chính thức](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/).

Một intent PAYOS có thể nhận nhiều giao dịch ngân hàng, mỗi tham chiếu ghi một lần. `paidAmount` của provider là tổng, không phải giao dịch mới để cộng lại. Khoản thiếu vẫn giữ phần còn lại; quá hạn/hủy chưa đối chiếu thì không tự mở phần tiền ấy cho khoản khác. `POST /core/payments/:id/confirm` chỉ dùng tiền mặt/chuyển khoản thủ công; không đổi ONLINE thành thành công.

Admin giải quyết phiên đang mở bằng `resolution: RECONCILED` cùng `reason` sau khi payOS đã kết thúc và không còn tiền cần hoàn chưa xử lý. Khoản đến sau phiên đóng được giữ riêng: dùng `resolution: RETURNED_EXTERNALLY`, `reference` của giao dịch trả tiền bên ngoài và `reason`; thao tác không sửa phiếu hoặc gọi API chuyển tiền. Các ID trong URL là ID payment intent, không phải orderCode ngân hàng.

Nguồn mã: [payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [payos.service.ts](../apps/api/src/modules/payments/payos.service.ts), [payos-adapter.ts](../apps/api/src/modules/payments/payos-adapter.ts), [maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts). Hợp đồng provider theo [API payOS](https://payos.vn/docs/api/); lệnh cấu hình/đăng ký tại [scripts/payos-config.ts](../scripts/payos-config.ts). Kết quả tự động/kiểm thử kênh thật được ghi riêng, không suy ra đã nghiệm thu ngân hàng từ fixture.

## API khuyến mãi và VAT — 13/10/2026

Tại đợt 13/10/2026, bản sinh từ hook onRoute có **179 thao tác** (170 nghiệp vụ +7 auth/workspace +2 health), không gồm HEAD tự sinh. Swagger có177 thao tác do gộp3 workspace thành1 đường dẫn có tham số; đây không phải thiếu endpoint.

Các đường dẫn sau thêm vào danh mục lịch sử bên dưới. Mọi thao tác ghi dùng Origin/CSRF, quyền, phạm vi nhà hàng/phiên và kiểm tra trên backend. Tiền là chuỗi số nguyên VND. Cấu hình và số giảm gửi từ trình duyệt không thay thế số server tính.

| Phương thức       | Đường dẫn                                 | Vai trò và nghiệp vụ                                   |
| ----------------- | ----------------------------------------- | ------------------------------------------------------ |
| GET, POST         | /core/admin/discount-programs             | ADMIN xem/tạo chương trình                             |
| PATCH, DELETE     | /core/admin/discount-programs/:id         | ADMIN sửa theo version hoặc lưu trữ, không xóa lịch sử |
| GET               | /core/admin/discount-programs/:id/history | ADMIN xem phiên bản và lượt sử dụng                    |
| GET, POST         | /core/admin/tax-policies                  | ADMIN xem/lập chính sách tương lai có lý do            |
| PATCH             | /core/products/:id/tax                    | ADMIN phân loại VAT cho món mới, có version/lý do      |
| GET, POST, DELETE | /core/sessions/:id/promotion              | STAFF/ADMIN xem/chọn/gỡ trước thu tiền                 |
| GET, POST, DELETE | /guest/promotion                          | Cookie khách kiểm tra đúng phiên; xem/nhập mã/gỡ       |

POST chọn ưu đãi nhận `{ programId, requestId }` hoặc `{ code, requestId }`; khách chọn chương trình CODE phải nhập mã. DELETE nhận `{ requestId }`. Gửi lại cùng requestId/nội dung không tạo thêm lượt; thay nội dung cùng khóa trả 409. Lượt đã thu, phiên đóng, quota hết hoặc chưa đủ điều kiện bị chặn với thông báo phù hợp.

`Bill.billing` và trạng thái khách cung cấp tiền gốc/giảm/sau giảm, nhóm VAT và phân bổ từng charge/orderItem. `financial_charge.amount` là gốc bất biến, `discount_amount` là phần giảm; tiền thực thu dùng `amount - discount_amount`. `tax_snapshot` từ lúc gọi món và `tax_amount` đã phân bổ được chốt sau thu. Cờ `legacyTaxUnavailable` ngăn suy diễn thuế cũ. Nguồn: `apps/api/src/modules/finance/pricing.routes.ts`, `pricing.service.ts`, `billing-math.ts` và hợp đồng trong `packages/contracts`.

Con số 128 thao tác ở danh mục dưới là hồ sơ trước đợt mở rộng, không phải số route bản mới.

128 thao tác được thu bằng hook onRoute khi đăng ký backend, không gồm HEAD tự sinh. Đường dẫn trong bảng là backend; web gọi qua /api. Swagger gộp ba GET /workspaces/staff, /kitchen, /admin thành một mục /workspaces/{area} có lựa chọn area, nên hiển thị 126 mục API tương ứng 128 thao tác cụ thể; không thiếu endpoint hỗ trợ. Schema body của các route nghiệp vụ phần lớn được kiểm tra trong handler, nên mẫu JSON bên dưới là ví dụ có hướng dẫn, không phải JSON Schema đầy đủ. Đọc tệp nguồn khi cần toàn bộ điều kiện.

Khách: public bỏ qua đăng nhập nhân viên nhưng các route sau join vẫn cần cookie guest và kiểm tra sở hữu. Thao tác ghi từ giao diện cần Origin được phép và X-CSRF-Protection: 1; webhook payOS/connector là endpoint ngoài hệ thống có cơ chế chữ ký riêng. Mọi UUID mẫu phải thay ID thật từ GET phù hợp trong môi trường kiểm thử hoặc môi trường đang vận hành.

HTTP thường gặp: 400 đầu vào, 401 phiên, 403 quyền/CSRF, 404 không tìm thấy, 409 xung đột, 429 giới hạn, 503 connector/database chưa sẵn sàng. POST auth/logout trả 204. Không phải endpoint nào cũng phát tất cả mã này.

Đặc biệt: GET /core/receipts là lịch sử phiếu thu phiên (STAFF); POST /core/receipts và các route /core/receipts/:id là phiếu nhập kho (ADMIN). Tên giống nhau nhưng nghiệp vụ khác.

## Danh sách

| Phương thức | Đường dẫn                                     | Quyền đầu vào                        | Tệp xử lý                                                                                                               |
| ----------- | --------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| GET         | /health/live                                  | Công khai / auth cookie tùy route    | [apps/api/src/app.ts](../apps/api/src/app.ts)                                                                           |
| GET         | /health/ready                                 | Công khai / auth cookie tùy route    | [apps/api/src/app.ts](../apps/api/src/app.ts)                                                                           |
| POST        | /auth/login                                   | Công khai / auth cookie tùy route    | [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts)                                             |
| POST        | /auth/refresh                                 | Công khai / auth cookie tùy route    | [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts)                                             |
| POST        | /auth/logout                                  | Công khai / auth cookie tùy route    | [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts)                                             |
| GET         | /auth/me                                      | Nhân viên đã đăng nhập               | [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts)                                             |
| GET         | /workspaces/staff                             | staff.workspace                      | [apps/api/src/modules/workspaces/routes.ts](../apps/api/src/modules/workspaces/routes.ts)                               |
| GET         | /workspaces/kitchen                           | kitchen.workspace                    | [apps/api/src/modules/workspaces/routes.ts](../apps/api/src/modules/workspaces/routes.ts)                               |
| GET         | /workspaces/admin                             | admin.workspace                      | [apps/api/src/modules/workspaces/routes.ts](../apps/api/src/modules/workspaces/routes.ts)                               |
| GET         | /core/workforce                               | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| GET         | /core/workforce/me                            | Nhân viên đã đăng nhập               | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/shifts                        | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/assignments                   | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/assignments/:id/cancel        | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/assignments/:id/check-in      | Nhân viên đã đăng nhập               | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/assignments/:id/check-out     | Nhân viên đã đăng nhập               | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/pay-rates                     | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| POST        | /core/workforce/assignments/:id/approve       | admin.workspace                      | [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts)             |
| GET         | /core/payroll                                 | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| GET         | /core/payroll/me                              | Nhân viên đã đăng nhập               | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| GET         | /core/payroll/:id                             | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| POST        | /core/payroll                                 | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| POST        | /core/payroll/:id/adjustments                 | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| POST        | /core/payroll/:id/finalize                    | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| POST        | /core/payroll/:id/paid                        | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| DELETE      | /core/payroll/:id                             | admin.workspace                      | [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts)                 |
| GET         | /core/sessions/:id/transfers                  | staff.workspace                      | [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts)         |
| POST        | /core/sessions/:id/transfer                   | staff.workspace                      | [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts)         |
| POST        | /core/menu-images                             | admin.workspace                      | [apps/api/src/modules/catalog/images.routes.ts](../apps/api/src/modules/catalog/images.routes.ts)                       |
| GET         | /menu-images/:name                            | Công khai / auth cookie tùy route    | [apps/api/src/modules/catalog/images.routes.ts](../apps/api/src/modules/catalog/images.routes.ts)                       |
| PATCH       | /core/categories/:id                          | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| PATCH       | /core/areas/:id                               | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| PATCH       | /core/tables/:id                              | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /core/catalog                                 | Nhân viên đã đăng nhập               | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| POST        | /core/categories                              | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| POST        | /core/products                                | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| PATCH       | /core/products/:id                            | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /core/tables                                  | staff.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /core/admin/tables                            | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /core/areas                                   | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| POST        | /core/areas                                   | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| POST        | /core/tables                                  | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| POST        | /core/tables/:id/qr                           | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /core/tables/:id/qr                           | admin.workspace                      | [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts)                     |
| GET         | /guest/policy                                 | Công khai / auth cookie tùy route    | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/qr-info                                | Công khai / auth cookie tùy route    | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| PATCH       | /guest/profile                                | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/leave                                  | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/orders/:id/cancel                      | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/join                                   | Công khai / auth cookie tùy route    | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| GET         | /guest/state                                  | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/cart                                   | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| DELETE      | /guest/cart/:id                               | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| PATCH       | /guest/cart/:id                               | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| POST        | /guest/support                                | Guest cookie                         | [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts)                       |
| GET         | /core/inventory                               | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/inventory/adjustments                   | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/units                                   | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/ingredients                             | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/locations                               | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/products/:id/bom                        | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/receipts                                | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| GET         | /core/receipts/:id                            | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| PATCH       | /core/receipts/:id                            | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/receipts/:id/cancel                     | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /core/receipts/:id/approve                    | admin.workspace                      | [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts)             |
| POST        | /guest/orders                                 | Guest cookie                         | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/sessions/:id/orders                     | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| GET         | /core/orders                                  | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| GET         | /core/kitchen                                 | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/:id/unavailable                   | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/orders/:id/review                       | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/orders/:id/accept                       | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/:id/accept                        | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/:id/prepare                       | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/:id/ready                         | kitchen.workspace                    | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/:id/serve                         | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/sessions/:id/serve-items                | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /core/items/cancel                            | staff.workspace                      | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| POST        | /guest/items/cancel                           | Guest cookie                         | [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts)                         |
| GET         | /core/order-exceptions                        | admin.workspace                      | [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts)                   |
| POST        | /core/items/:id/late-cancel                   | admin.workspace                      | [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts)                   |
| POST        | /core/items/:id/waive                         | admin.workspace                      | [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts)                   |
| POST        | /core/items/:id/report-issue                  | kitchen.workspace                    | [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts)                           |
| POST        | /guest/payment-requests                       | Guest cookie                         | [apps/api/src/modules/payments/payment-requests.routes.ts](../apps/api/src/modules/payments/payment-requests.routes.ts) |
| POST        | /core/payments/:id/proof                      | staff.workspace                      | [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts)       |
| GET         | /core/payments/:id/proof                      | staff.workspace hoặc admin.workspace | [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts)       |
| GET         | /core/sessions/:id/bill                       | staff.workspace hoặc admin.workspace | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| GET         | /core/receipts                                | staff.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /guest/payments                               | Guest cookie                         | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/sessions/:id/payments                   | staff.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/payments/:id/confirm                    | staff.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/payments/:id/cancel                     | staff.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/sessions/:id/refunds                    | staff.workspace hoặc admin.workspace | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/refunds/:id/complete                    | staff.workspace hoặc admin.workspace | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| GET         | /core/reports/sessions/:id                    | admin.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| GET         | /core/reports                                 | admin.workspace                      | [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts)                 |
| POST        | /core/alerts/:id/guest-notified               | staff.workspace                      | [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts)               |
| POST        | /core/tables/:id/open                         | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/sessions/:id/verify                     | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/orders/:id/cancel                       | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/sessions/:id/close                      | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/tables/:id/clean                        | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| GET         | /core/alerts                                  | staff.workspace hoặc admin.workspace | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/alerts/:id/acknowledge                  | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/alerts/:id/resolve                      | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/sessions/:id/outstanding                | staff.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| GET         | /core/outstanding                             | admin.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/outstanding/:id/write-off               | admin.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| POST        | /core/outstanding/:id/recovered               | admin.workspace                      | [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts)                         |
| GET         | /core/support                                 | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| GET         | /core/support/:id/history                     | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| GET         | /core/admin/support                           | admin.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| GET         | /core/admin/support/:id/history               | admin.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/claim                       | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/resolve                     | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| GET         | /core/support-assignees                       | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/reassign                    | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/handoffs/:handoffId/accept  | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/handoffs/:handoffId/decline | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| POST        | /core/support/:id/handoffs/:handoffId/cancel  | staff.workspace                      | [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts)                     |
| GET         | /core/risk                                    | admin.workspace                      | [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts)                                 |
| POST        | /core/risk                                    | admin.workspace                      | [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts)                                 |
| GET         | /core/users                                   | admin.workspace                      | [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts) |
| POST        | /core/users                                   | admin.workspace                      | [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts) |
| PATCH       | /core/users/:id                               | admin.workspace                      | [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts) |
| POST        | /payments/webhooks/connector                  | Connector + chữ ký                   | [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts)                 |
| GET         | /core/payment-events                          | admin.workspace                      | [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts)                 |

## Duyệt đúng báo cáo sự cố đã lưu

POST /core/items/:id/late-cancel nhận {useReportedReason:true, expectedReportId:ID_BAO_CAO} để admin duyệt lý do bếp đã chọn. Không cần nhập lại ghi chú; backend lấy lý do từ báo cáo sau khi khóa món/phiên. Mã báo cáo cũ hoặc đã được xử lý bằng quyết định khác trả xung đột. Cách gửi reasonCode/note bên dưới vẫn dành cho xử lý thủ công. [Ví dụ đủ vai trò](24-su-co-mon-va-phieu-thanh-toan.md).

Quyền ghi admin.workspace hoặc staff.workspace nghĩa là chỉ cần một quyền trong hai quyền đó tại đúng API; không kế thừa toàn bộ thao tác workspace.

## Dữ liệu gửi và cách tra điều kiện

### POST /core/workforce/shifts

Nguồn: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "CA-SANG-20260925",
  "name": "Ca sáng",
  "startsAt": "2026-09-25T07:00:00+07:00",
  "endsAt": "2026-09-25T15:00:00+07:00",
  "breakMinutes": 30
}
```

### POST /core/workforce/assignments

Nguồn: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "shiftId": "00000000-0000-4000-8000-000000000001",
  "areaId": "00000000-0000-4000-8000-000000000001"
}
```

### POST /core/workforce/assignments/:id/cancel

Nguồn: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Ca thay đổi trước khi chấm công"
}
```

### POST /core/workforce/pay-rates

Nguồn: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "effectiveFrom": "2026-09-01T00:00:00+07:00",
  "hourlyRate": "30000",
  "reason": "Đơn giá mới"
}
```

### POST /core/workforce/assignments/:id/approve

Nguồn: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "minutes": 420,
  "note": "Đã đối chiếu giờ vào ra",
  "outcome": "WORKED",
  "approveExtra": false
}
```

### POST /core/payroll

Nguồn: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-15"
}
```

### POST /core/payroll/:id/adjustments

Nguồn: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "slipId": "00000000-0000-4000-8000-000000000001",
  "type": "BONUS",
  "amount": "20000",
  "description": "Thưởng ca"
}
```

### POST /core/payroll/:id/paid

Nguồn: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reference": "MA_PHIEU_CHI_THUC_TE"
}
```

### POST /core/sessions/:id/transfer

Nguồn: [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "tableId": "00000000-0000-4000-8000-000000000001",
  "fromTableId": "00000000-0000-4000-8000-000000000002",
  "partySize": 4,
  "reasonCode": "AREA_CHANGE",
  "note": "Khách muốn chuyển sang khu vực yên tĩnh"
}
```

### POST /core/menu-images

Nguồn: [apps/api/src/modules/catalog/images.routes.ts](../apps/api/src/modules/catalog/images.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "data": "BASE64_NOI_DUNG_ANH_PNG_JPEG_WEBP"
}
```

### PATCH /core/categories/:id

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Món chính",
  "sortOrder": 0,
  "active": true
}
```

### PATCH /core/areas/:id

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Tầng 1",
  "sortOrder": 0,
  "active": true
}
```

### PATCH /core/tables/:id

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Bàn A05",
  "areaId": "00000000-0000-4000-8000-000000000001",
  "capacity": 4,
  "active": true,
  "version": 1
}
```

### POST /core/categories

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "MON-CHINH",
  "name": "Món chính"
}
```

### POST /core/products

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "BUN-BO",
  "name": "Bún bò Huế",
  "categoryId": "00000000-0000-4000-8000-000000000001",
  "price": "69000"
}
```

### PATCH /core/products/:id

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Bún bò Huế",
  "categoryId": "00000000-0000-4000-8000-000000000001",
  "description": "Bún bò nóng, dùng cùng rau thơm.",
  "imageUrl": "/menu/rice.svg",
  "price": "75000",
  "active": true,
  "availability": "AVAILABLE",
  "version": 1
}
```

### POST /core/areas

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "TANG-1",
  "name": "Tầng 1"
}
```

### POST /core/tables

Nguồn: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "A05",
  "name": "Bàn A05",
  "areaId": "00000000-0000-4000-8000-000000000001",
  "capacity": 4
}
```

### POST /guest/qr-info

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "token": "TOKEN_TU_QR_HIEN_TAI"
}
```

### PATCH /guest/profile

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Tên khách mới"
}
```

### POST /guest/orders/:id/cancel

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "CUSTOMER_CHANGED_MIND"
}
```

### POST /guest/join

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "token": "LAY_TU_MA_QR_MOI",
  "name": "Khách",
  "acceptedPolicyVersion": "2026-10-v2"
}
```

### POST /guest/cart

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "productId": "00000000-0000-4000-8000-000000000001",
  "quantity": 1,
  "cartVersion": 1,
  "note": ""
}
```

### DELETE /guest/cart/:id

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "cartVersion": 2
}
```

### PATCH /guest/cart/:id

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "quantity": 2,
  "cartVersion": 2,
  "note": ""
}
```

### POST /guest/support

Nguồn: [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "type": "ASSISTANCE",
  "content": "Cần hỗ trợ tại bàn"
}
```

### POST /core/inventory/adjustments

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "balanceId": "00000000-0000-4000-8000-000000000001",
  "expectedVersion": 1,
  "requestId": "MA_MOI_MOI_LAN_DIEU_CHINH",
  "mode": "WASTE",
  "quantity": "0.5",
  "reason": "Nguyên liệu hỏng, kiểm tra đầu ca"
}
```

### POST /core/units

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "KG",
  "name": "Kilogram",
  "dimension": "MASS"
}
```

### POST /core/ingredients

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "GAO",
  "name": "Gạo",
  "unitId": "00000000-0000-4000-8000-000000000001",
  "minStock": "2"
}
```

### POST /core/locations

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "code": "KHO-BEP",
  "name": "Kho bếp"
}
```

### POST /core/products/:id/bom

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "yield": "1",
  "lines": [
    {
      "ingredientId": "00000000-0000-4000-8000-000000000001",
      "quantity": "0.2",
      "waste": "0"
    }
  ]
}
```

### POST /core/receipts

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "locationId": "00000000-0000-4000-8000-000000000001",
  "number": "PN-001",
  "supplier": "Nhà cung cấp",
  "lines": [
    {
      "ingredientId": "00000000-0000-4000-8000-000000000001",
      "quantity": "10",
      "unitCost": "20000"
    }
  ]
}
```

### PATCH /core/receipts/:id

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "expectedVersion": 1,
  "locationId": "00000000-0000-4000-8000-000000000001",
  "number": "PN-DEMO",
  "supplier": "Nhà cung cấp",
  "reason": "Điều chỉnh số lượng",
  "lines": [
    {
      "ingredientId": "00000000-0000-4000-8000-000000000001",
      "quantity": "2",
      "unitCost": "20000"
    }
  ]
}
```

### POST /core/receipts/:id/cancel

Nguồn: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Phiếu nháp nhập nhầm"
}
```

### POST /guest/orders

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "requestId": "MA_MOI_CHO_MOI_LUOT",
  "cartVersion": 2,
  "itemIds": ["00000000-0000-4000-8000-000000000001"]
}
```

### POST /core/sessions/:id/orders

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "requestId": "MA_MOI_CHO_MOI_LUOT",
  "lines": [
    {
      "productId": "00000000-0000-4000-8000-000000000001",
      "quantity": 1,
      "note": ""
    }
  ]
}
```

### POST /core/items/:id/unavailable

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "OUT_OF_STOCK",
  "note": "Đối chiếu hết nguyên liệu trước chế biến"
}
```

### POST /core/orders/:id/review

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "approve": true,
  "reason": "Đã kiểm tra"
}
```

### POST /core/sessions/:id/serve-items

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "itemIds": ["00000000-0000-4000-8000-000000000001"]
}
```

### POST /core/items/cancel

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "itemIds": ["00000000-0000-4000-8000-000000000001"],
  "reasonCode": "CUSTOMER_CHANGED_MIND",
  "note": "Khách yêu cầu trước chế biến"
}
```

### POST /guest/items/cancel

Nguồn: [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "itemIds": ["00000000-0000-4000-8000-000000000001"],
  "reasonCode": "CUSTOMER_CHANGED_MIND"
}
```

### POST /core/items/:id/late-cancel

Nguồn: [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "KITCHEN_ERROR",
  "note": "Quản trị xác minh món lỗi trước phục vụ"
}
```

### POST /core/items/:id/waive

Nguồn: [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "CUSTOMER_COMPLAINT",
  "note": "Quản trị đối chiếu khiếu nại sau phục vụ"
}
```

### POST /core/items/:id/report-issue

Nguồn: [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "KITCHEN_ERROR",
  "note": "Món cháy, bếp dừng phục vụ"
}
```

### POST /guest/payment-requests

Nguồn: [apps/api/src/modules/payments/payment-requests.routes.ts](../apps/api/src/modules/payments/payment-requests.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "method": "CASH"
}
```

### POST /core/payments/:id/proof

Nguồn: [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "data": "BASE64_ANH_PNG_JPEG_WEBP_TOI_DA_2MB"
}
```

### POST /guest/payments

Nguồn: [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "requestId": "MA_MOI_CHO_MOI_LUOT",
  "method": "CASH",
  "amount": "55000"
}
```

### POST /core/sessions/:id/payments

Nguồn: [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "requestId": "KHOA_THU_MOI",
  "method": "CASH",
  "amount": "40000",
  "collectionScope": "TABLE",
  "supportRequestId": "00000000-0000-4000-8000-000000000001"
}
```

### POST /core/payments/:id/confirm

Chỉ dùng cho CASH hoặc BANK_TRANSFER sau đối chiếu thực nhận; ONLINE được xác minh qua payOS, không được xác nhận bằng route này.

Nguồn: [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "amount": "55000",
  "receivedAmount": "100000",
  "reference": "CHI_CAN_CHO_BANK_TRANSFER"
}
```

### POST /core/sessions/:id/refunds

Nguồn: [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "paymentId": "00000000-0000-4000-8000-000000000001",
  "amount": "20000",
  "reason": "Hoàn khoản đã miễn",
  "requestId": "HO_SO_MOI"
}
```

### POST /core/refunds/:id/complete

Nguồn: [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "method": "CASH",
  "amount": "20000",
  "requestId": "HOAN_MOI_MOT_LAN"
}
```

### POST /core/alerts/:id/guest-notified

Nguồn: [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{}
```

### POST /core/orders/:id/cancel

Nguồn: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reasonCode": "CUSTOMER_CHANGED_MIND",
  "note": "Khách yêu cầu trước chế biến"
}
```

### POST /core/alerts/:id/resolve

Nguồn: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Đã xử lý và đối chiếu"
}
```

### POST /core/sessions/:id/outstanding

Nguồn: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "LEFT_WITHOUT_PAYING",
  "notes": "Diễn biến sự việc"
}
```

### POST /core/outstanding/:id/write-off

Nguồn: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Đã xác minh không thu hồi được"
}
```

### POST /core/outstanding/:id/recovered

Nguồn: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Đã đối chiếu thu đủ"
}
```

### POST /core/support/:id/resolve

Nguồn: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Khách muốn tiếp tục dùng bữa, chưa thanh toán"
}
```

### POST /core/support/:id/reassign

Nguồn: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "reason": "Bàn giao ca phục vụ"
}
```

### POST /core/support/:id/handoffs/:handoffId/accept

Nguồn: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{}
```

### POST /core/support/:id/handoffs/:handoffId/decline

Nguồn: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Đang thu tiền bàn khác"
}
```

### POST /core/support/:id/handoffs/:handoffId/cancel

Nguồn: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "reason": "Tiếp tục tự xử lý"
}
```

### POST /core/risk

Nguồn: [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "LINE_QTY_REVIEW": 5
}
```

### POST /core/users

Nguồn: [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "username": "pv005",
  "staffCode": "NV005",
  "name": "Nhân viên mới",
  "role": "STAFF",
  "password": "THAY_BANG_MAT_KHAU_RIENG"
}
```

### PATCH /core/users/:id

Nguồn: [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "name": "Nhân viên",
  "role": "STAFF",
  "status": "ACTIVE",
  "reason": "Cập nhật phân công nhân viên"
}
```

### POST /payments/webhooks/connector

Nguồn: [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts). Mẫu minh họa; quyền, trạng thái, version và ID phải phù hợp.

```json
{
  "eventId": "ID_SU_KIEN",
  "transactionId": "ID_GIAO_DICH",
  "intentId": "00000000-0000-4000-8000-000000000001",
  "amount": "55000",
  "currency": "VND",
  "timestamp": 0
}
```

## Route không có mẫu body

GET thường không có body. Các thao tác theo trạng thái như accept/prepare/ready/serve/open/verify/close/clean/check-in/check-out/finalize/approve phiếu nhập dựa vào ID trên URL và phiên xác thực; một số client gửi {}. Xem handler để phân biệt yêu cầu không body với body bắt buộc. Login nhận username/password; refresh/logout dùng cookie.

## Thu tiền và chứng từ mới

Giao diện khách dùng POST /guest/payment-requests với method, không đặt số tiền. Nếu có BILL đang mở, STAFF phải nhận bằng POST /core/support/:id/claim và gửi supportRequestId khi lập khoản thu; chỉ owner hiện tại được lập/xác nhận/tải chứng từ/hủy khoản thu liên kết. Khi không có lời gọi BILL, khoản thu trực tiếp mới được bỏ supportRequestId. Mẫu bên trên là thu từ lời gọi đã nhận. BILL cũ chưa có payment_method cũng theo quy tắc này. Khoản thu TABLE hoặc PARTICIPANT (cần participantId) xác nhận bằng amount khớp khoản thu. CASH dùng receivedAmount >= amount. BANK_TRANSFER cần reference hoặc ảnh đã lưu qua POST /core/payments/:id/proof; GET cùng đường dẫn trả ảnh riêng cho STAFF/ADMIN, không phải JSON. Thu thành công tự kết thúc lời gọi. POST /core/support/:id/resolve với BILL chỉ dành cho kết thúc lời gọi chưa thu: bắt buộc reason và không được còn khoản thu liên kết chưa hết hạn đang chờ; không ghi nhận tiền. Hỗ trợ thường không bắt buộc reason. API cũ POST /guest/payments giữ tương thích, không phải thao tác hiện hành của giao diện khách. [Bài 25](25-thu-tien-tai-ban.md).

## Dữ liệu đọc màn hình kho

GET /core/inventory (ADMIN) trả units, ingredients, locations, balances, movements, receipts, recipes và recipeItems. Hai danh sách cuối bổ sung để giao diện đọc công thức đang áp dụng và định lượng trước khi sửa. Movements và receipts giới hạn 100 dòng mới nhất. Không thêm endpoint, bảng hoặc migration cho thay đổi giao diện này.
