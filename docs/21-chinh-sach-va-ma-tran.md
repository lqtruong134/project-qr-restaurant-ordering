# 21. Chính sách tại bàn và ma trận thao tác

Hồ sơ này ghi đợt chính sách v1 trước thay đổi hỗ trợ. **Hiện nguồn code dùng 2026-10-v2**, bổ sung Hỗ trợ tại bàn; đồng ý v1 cũ được giữ. Đọc [bài 22](22-ho-tro-va-ban-giao.md) cho bàn giao có xác nhận và kết quả/schema hiện tại.

## Bản review trước khi triển khai — 01/10/2026

Hệ thống hiện có QR/phiên bàn, giỏ theo người chọn, gọi món có kiểm tra rủi ro, duyệt, bếp, phục vụ, thu và hoàn tiền thủ công, kho, ca/công/lương. Các vai trò tách quyền ở API. Thanh toán online và AI chưa được triển khai hoàn chỉnh.

Tài liệu cũ trong yêu cầu đã được thay: code-guide/architecture/service-and-receipts/attendance-and-inventory/uat-v2 tương ứng bộ hiện hành 02, 04–12, 13, 15–18; core45 còn giữ tệp Swagger mà web dùng. Review dùng code thực tế cùng schema, migration và test; không phục hồi tài liệu cũ.

Trước sửa: `pnpm check` đạt với 19 bài nhỏ; `pnpm test:integration` đạt 51/51 trên năm tệp. Đây là kết quả nền trước đợt chính sách, không phải kết quả của tính năng mới.

## Những điểm cần sửa

- Chưa có chính sách chung hoặc bằng chứng khách chấp nhận phiên bản nào.
- Join chỉ nhận QR và tên; giao diện và backend chưa kiểm tra chấp nhận chính sách.
- Lý do hủy tự do nên không phân biệt rõ đổi ý với lỗi nhà hàng.
- Hủy muộn luôn giữ tiền; lỗi nhà hàng phải hủy rồi miễn riêng, dễ bỏ sót.
- Bếp chưa có thao tác dừng/báo sự cố sau khi bắt đầu chế biến.
- Phiếu thu có khoản đã miễn nhưng thiếu trạng thái/lý do và giải thích khoản vẫn thu sau hủy.
- Gửi yêu cầu thanh toán chưa có bước kiểm tra số tiền/phương thức rõ ràng. Một số form thay đổi tiền/kho/quyền cần xác nhận cụ thể hơn.
- Biểu tượng dấu chấm than ở xác nhận chưa nhất quán với bộ icon có nhãn hỗ trợ.

## Phương án giữ và điều chỉnh

Giữ vòng đời SUBMITTED → ACCEPTED → IN_PREPARATION → READY → SERVED, chỉ tiêu hao kho khi bắt đầu chế biến. Hủy sớm trả lượng giữ và bỏ tiền; hủy muộn không làm nguyên liệu quay lại kho. Giữ chống gửi lặp, kiểm tra sở hữu, phiên bản giỏ, khóa giao dịch, tính tiền ở backend và các giới hạn rủi ro.

Điều chỉnh ý tưởng tự miễn tiền bằng lý do của bếp: bếp được dừng món IN_PREPARATION/READY và báo sự cố, nhưng không tự giảm số phải thu. ADMIN xác nhận lỗi; hệ thống tự bỏ tiền món trong cùng thao tác, không cần miễn thêm. ADMIN có thể xác định sự cố không thuộc lỗi nhà hàng và giữ tiền với lý do. Lý do nhập đúng mã không chứng minh sự việc có thật; quyền và lịch sử xử lý mới giúp kiểm soát việc này.

Món đã SERVED không cho bếp dừng/miễn. ADMIN xử lý khiếu nại bằng miễn tiền, có thể giữ trạng thái đã phục vụ. Hoàn tiền vẫn là bước ghi nhận riêng sau khi tiền thực tế đã trả lại khách.

Không thêm trạng thái FAILED, bảng chính sách, CMS, rule engine hoặc workflow tổng quát. Dùng CANCELLED cho món dừng, trạng thái khoản tiền để biết còn thu không, lịch sử/audit/cảnh báo sẵn có để theo dõi sự cố.

## Business Action Matrix

Mức 0: thao tác thông thường. Mức 1: hướng dẫn ngắn. Mức 2: thông tin/cảnh báo ngay trên vùng thao tác. Mức 3: xác nhận trước khi ghi. “Không đảo” nghĩa là không khôi phục bằng một nút undo; có thể làm thao tác nghiệp vụ mới khi phù hợp.

| Thao tác | Ai / điều kiện | Hậu quả / đảo được? | Tiền | Kho | UX | Lý do / audit / duyệt | Khách cần biết |
|---|---|---|---|---|---|---|---|
| Xem món/danh mục/giỏ | Guest trong phiên | Chỉ đọc | Không | Không | 0 | Không | Không |
| Tham gia QR | Khách mới, QR/bàn hợp lệ | Tạo người tham gia; không đảo | Không | Không | 1 + checkbox chưa tick | Lưu version/thời điểm ở participant | Có |
| Đổi tên | Guest của chính mình | Đổi tên hiển thị; sửa lại được | Không | Không | 1 | Kiểm tra tên ở API | Tên dùng chung trong bàn |
| Thêm/sửa/xóa giỏ | Guest, chỉ dòng của mình | Chưa gửi bếp; thêm lại được | Chỉ giá xem trước | Chưa giữ kho | 0–1 | Phiên bản giỏ và sở hữu | Giỏ chung, quyền riêng từng dòng |
| Đồng ý giá mới | Chủ dòng, giá đã đổi | Cập nhật giá xem trước | Có giá mới | Không | 2 | API đọc giá hiện tại | Có |
| Gửi món | Guest / Staff, phiên hợp lệ | Tạo lượt; không undo | Backend tính; chờ duyệt chưa thu | Giữ tạm/xác nhận | 2, tóm tắt giỏ và tổng lần gửi | Idempotency, lịch sử, outbox | Có |
| Duyệt/từ chối | Staff, review còn chờ | Gửi bếp hoặc hủy; không đảo | Duyệt tạo tiền; từ chối không thu | Xác nhận/trả giữ | Duyệt 1; từ chối 2 | Từ chối cần lý do; lịch sử | Có thể phải chờ duyệt |
| Hủy món sớm | Guest: món mình SUBMITTED; Staff: SUBMITTED/ACCEPTED | CANCELLED; không đảo | Không thu / cần hoàn nếu đã trả | Trả lượng giữ | 3 | Mã lý do; lịch sử; Staff audit | Có |
| Hủy nhiều dòng/lượt | Guest chủ lượt / Staff, từng dòng đủ điều kiện | Có thể hủy một phần | Chỉ bỏ tiền dòng đã hủy | Chỉ trả giữ dòng đã hủy | 3 + thông báo kết quả | Lý do, sở hữu, danh sách skipped | Có |
| Nhận món | Kitchen, SUBMITTED và lượt được duyệt | ACCEPTED | Không đổi | Vẫn giữ | 0–1 | Lịch sử | Trạng thái món |
| Bắt đầu chế biến | Kitchen, ACCEPTED | IN_PREPARATION; không đảo | Không đổi | CONSUME, giữ chi phí | 2 ngay tại chức năng | Lịch sử, kho, outbox | Từ đây khách không tự hủy |
| Báo hết nguyên liệu | Kitchen, ACCEPTED | UNAVAILABLE | Không thu; có thể cần hoàn | Trả giữ, chưa tiêu hao | 3 | OUT_OF_STOCK + ghi chú; audit | Có |
| Báo món đã xong | Kitchen, IN_PREPARATION | READY | Không đổi | Không đổi | 0–1 | Lịch sử | Trạng thái món |
| Đã mang ra bàn | Staff, READY | SERVED | Không đổi | Không đổi | 0–1 | Lịch sử | Trạng thái món |
| Báo sự cố sau chế biến | Kitchen, IN_PREPARATION/READY | Dừng món → CANCELLED, chờ quản trị | Tạm giữ khoản tiền để quản trị quyết định | Không hoàn tiêu hao | 3 | Mã lỗi + ghi chú, audit và cảnh báo | Đang xử lý sự cố |
| Xác nhận lỗi nhà hàng | ADMIN, IN_PREPARATION/READY hoặc món dừng đang có báo cáo | Hủy/dừng và bỏ tiền trong một giao dịch | Bỏ tiền, tính số cần hoàn nếu có | Giữ tiêu hao/chi phí | 3, nêu món và số tiền | Lý do lỗi, audit; ADMIN quyết định | Có |
| Khách đổi ý sau chế biến | ADMIN, IN_PREPARATION/READY/SERVED | Hủy muộn, không undo | Vẫn thu | Giữ tiêu hao | 3, nói rõ vẫn thu | CUSTOMER_CHANGED_MIND/OTHER, note/audit | Có |
| Khiếu nại sau phục vụ/miễn quản lý | ADMIN | Có thể giữ SERVED | Bỏ tiền; hoàn riêng nếu đã trả | Không hoàn tiêu hao | 3 | Lý do + audit; ADMIN | Có |
| Gọi nước/dụng cụ/hỗ trợ | Guest trong phiên | Tạo/tái dùng yêu cầu đang mở | Không tự tạo tiền | Không | 0–1 | Chống trùng yêu cầu | Có hướng dẫn liên hệ |
| Yêu cầu tính tiền | Guest | Gọi Staff; chưa ghi thu | Chỉ yêu cầu | Không | 1 | Hỗ trợ loại BILL | Có |
| Đề nghị thanh toán | Guest / Staff, còn số tiền chưa có yêu cầu | Tạo yêu cầu, chưa phải đã trả | Giữ phần tiền chờ xác nhận | Không | 3, số tiền + phương thức | Idempotency, API đọc lại dư | Có |
| Xác nhận đã thu | Staff, yêu cầu hợp lệ, thực nhận tiền | Ghi thu; không sửa tiền cũ | Thu đúng yêu cầu | Không | 3, tiền nhận/mã giao dịch | Người xác nhận, chống trùng | Có |
| Hủy yêu cầu thanh toán | Staff, chưa thu thành công | Hủy yêu cầu, tạo lại được | Giải phóng phần chờ | Không | 3 | Trạng thái ở API | Có nếu đang chờ |
| Lập hồ sơ hoàn | Staff, có tiền cần hoàn và giao dịch nguồn cùng phiên | Giữ phần cần hoàn | Chưa trả tiền | Không | 2–3, kiểm tra số tiền/nguồn | Lý do, chống trùng | Có |
| Ghi nhận đã hoàn | Staff, hồ sơ/số dư hợp lệ | Ghi giao dịch hoàn, không sửa lịch sử thu | Giảm số cần hoàn | Không | 3, tiền/phương thức | Thực trả trước; mã chuyển khoản/audit | Có |
| Rời bàn | Guest của mình | LEFT, xóa giỏ của mình và cookie; không undo | Món đã gửi/tiền không mất | Không đổi món đã gửi | 3 | Không cần lý do | Có |
| Mở/xác minh phiên | Staff, bàn/phiên hợp lệ | Mở lượt ngồi ăn / xác minh | Không tự thu | Không | 1 | Người xác minh và lịch sử | Phiên bàn |
| Chuyển bàn | Staff, bàn đích trống, đủ chỗ | Phiên theo bàn mới; bàn cũ chờ dọn | Giữ nguyên tiền | Giữ nguyên kho | 3 | Lý do, nguồn quan sát, audit | Có |
| Đóng phiên | Staff, món/tiền/hỗ trợ/ngoại lệ xong | Đóng, đóng băng phiếu; không đảo | Không được che nợ/hoàn | Không | 3 | Backend kiểm tra toàn phiên | Có |
| Dọn bàn xong | Staff, NEEDS_CLEANING | AVAILABLE | Không | Không | 1 | Kiểm tra trạng thái | Không |
| Ghi nhận thiếu tiền/xóa nợ nghiệp vụ | Staff lập / ADMIN quyết định | Hồ sơ; quản trị đóng ngoại lệ | Tổn thất có lịch sử | Không | 3 | Lý do/audit/ADMIN | Khi liên quan bàn |
| Tiếp nhận/hoàn tất/bàn giao hỗ trợ | Staff đúng người xử lý | Trạng thái công việc | Không tự đổi tiền | Không | 1; bàn giao 2 | Bàn giao cần lý do/audit và target đồng ý; PENDING giữ owner | Có thể xem trạng thái |
| Tạo/sửa phiếu nhập nháp | ADMIN | Nháp, chưa tăng kho | Chưa hạch toán tiêu hao | Chưa đổi tồn | 1–2 | Sửa/hủy cần lý do | Không |
| Duyệt phiếu nhập | ADMIN, nháp hợp lệ | POSTED; không đảo bằng sửa phiếu | Giá vốn nhập | Tăng tồn | 3, xem nguyên liệu/lượng | Audit, version | Không |
| Điều chỉnh tồn | ADMIN | Movement mới, không sửa lịch sử | Có thể đổi chi phí | Tăng/giảm tồn | 3 | Lý do, version, audit | Không |
| Thay công thức | ADMIN | Phiên bản mới cho lượt sau | Giá vốn lượt sau | Không đổi snapshot cũ | 2 | Phiên bản và định lượng | Không |
| Đổi tài khoản/vai trò/khóa | ADMIN | Thay quyền/thu hồi phiên | Không trực tiếp | Không | 3 | Backend chặn mất ADMIN cuối và thu hồi quyền STAFF của owner còn hỗ trợ | Không |
| Đổi chính sách rủi ro | ADMIN | Cấu hình cho lượt sau | Gián tiếp | Gián tiếp | 3 + hướng dẫn | Version/audit; khác policy text | Có nội dung chung, không lộ ngưỡng |
| Phân ca/duyệt công | ADMIN, Staff/Kitchen chỉ tự chấm | Phân công/công duyệt; kiểm tra ca | Dùng tính lương | Không | 1–2 | Quyền/giới hạn/audit hiện có | Không |
| Chốt/chi/xóa nháp lương | ADMIN | Khóa phiếu hoặc ghi thực chi | Có | Không | 3 | Quyền, tham chiếu, audit | Không |

## Nội dung chính sách khách sẽ đọc

1. QR dùng tham gia đúng bàn, không phải mã thanh toán; mã cũ có thể bị thu hồi.
2. Tên để nhận ra món của từng người; người cùng bàn có thể xem tên/giỏ; không cần tài khoản nhân viên.
3. Giỏ chưa gửi chưa phải món đã gọi. Mỗi người chỉ sửa/gửi món mình chọn.
4. Giá được kiểm tra lúc gửi; nếu thay đổi phải xem và chọn theo giá mới. Giá hiện tại chưa thêm thuế/phí riêng.
5. Một số lượt cần nhân viên duyệt; khách thấy trạng thái chờ, không hứa thời gian chính xác.
6. Khách tự hủy món mình khi còn chờ bếp nhận. Khi bếp đã nhận, liên hệ Staff; khi bắt đầu chế biến khách không tự hủy.
7. Đổi ý sau chế biến có thể vẫn tính tiền; nhân viên/quản trị xử lý theo tình trạng thực tế.
8. Món hết trước chế biến không tính tiền; lỗi chế biến/chất lượng/nhầm món do nhà hàng được quản trị xác nhận sẽ không tính tiền. Khiếu nại sau phục vụ cần quản trị xử lý.
9. Thanh toán tiền mặt/chuyển khoản được nhân viên xác nhận sau thực nhận; gửi yêu cầu chưa có nghĩa đã thanh toán. Chưa có checkout online tự động.
10. Nếu đã trả thừa sau xử lý món, nhân viên trả và ghi nhận hoàn riêng; không hứa hoàn tự động hoặc thời gian ngân hàng cố định.
11. Rời bàn xóa giỏ chưa gửi/cookie của mình; món đã gửi và tiền của bàn vẫn còn.
12. Phiên kết thúc khi nhân viên hoàn tất xử lý; cần hỗ trợ/dị ứng/yêu cầu đặc biệt phải liên hệ nhân viên, không mặc định ghi chú luôn được đáp ứng.
13. Lưu tối thiểu tên hiển thị, hoạt động trong phiên, xác nhận chính sách và thông tin nghiệp vụ cần đối soát; cookie nhận diện phiên. Không yêu cầu khách nhập thông tin thẻ trên giao diện này.

## Kiến trúc đề xuất

- Một tệp chính sách version cố định `2026-10-v1` trong package contracts đang có; summary/full/notices cùng nguồn, dùng API và web. Không thêm package hoặc CMS riêng.
- Participant thêm version/thời điểm chấp nhận, cùng kiểm tra cặp giá trị và không sửa bằng chứng đã ghi. Dữ liệu cũ để NULL, không bịa xác nhận cho khách cũ; không bắt khách đang trong phiên tick lại.
- Order item thêm mã lý do, còn lời diễn giải cho người đọc. Whitelist theo thao tác/actor/state ở backend; note tối đa 500 ký tự, lỗi nhà hàng/OTHER cần ghi chú.
- Dùng lịch sử món, business audit và cảnh báo OTHER đang có cho sự cố; không thêm bảng workflow. Báo cáo của bếp chặn đóng bàn đến khi quản trị xử lý.
- Form tiền/kho/quyền dùng một cơ chế xác nhận dùng chung, có dữ liệu cụ thể; thao tác xem/thêm giỏ không có popup.

## Nguồn định hướng

- [Square — Comp and void](https://squareup.com/help/gb/en/article/5814-get-started-with-comp-and-void): tham khảo việc tách hủy trước chế biến, miễn tiền và lý do/phân quyền.
- [Toast — Refunds and voids](https://doc.toasttab.com/doc/platformguide/adminRefundsAndVoids.html): tham khảo việc tách thay đổi món khỏi tiền đã thu/hoàn. Không sao chép quy tắc gateway của Toast sang thanh toán thủ công.
- [GOV.UK — Checkboxes](https://design-system.service.gov.uk/components/checkboxes/): checkbox rõ nhãn, không chọn sẵn và lỗi dễ nhận biết.

Đây là quy tắc nghiệp vụ của phiên bản luận văn, không phải bản điều khoản pháp lý được chứng nhận. Phần dưới ghi kết quả thực sự của đợt triển khai này.
## Kết quả triển khai thực tế — 01/10/2026

Phần review và ma trận phía trên được viết trước khi sửa code. Các phần dưới mô tả phiên bản đã triển khai. Database hiện hành là **qr_restaurant_ordering: 55 bảng, 598 cột, 132 khóa ngoại, 24 migration**. Backend đăng ký 118 thao tác API. Prisma migrate diff PostgreSQL → schema trả không có khác biệt; CHECK/trigger vẫn được kiểm tra riêng vì Prisma không mô tả đầy đủ chúng. Không chạy lại reset/seed của database vận hành trong đợt chính sách này.

### 1. Các tệp đã thay đổi

Đợt này thay đổi 48 tệp nguồn/kiểm thử bên dưới. Đây là các tệp so với bản đã đối chiếu trước đợt chính sách; repository còn có thay đổi chưa commit từ các đợt trước. Danh sách không tính tệp Prisma/Swagger/build tự sinh hoặc tài liệu được xuất lại. SHA256 của từng tệp nằm trong [biên bản máy đọc](reference/policy-review-20261001.json); [bản đồ toàn bộ nguồn](18-ban-do-tep.md) giúp tra cứu thêm.

| Tệp nguồn hoặc kiểm thử | Thay đổi |
|---|---|
| [apps/api/src/app.ts](../apps/api/src/app.ts) | Cập nhật |
| [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts) | Cập nhật |
| [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts) | Cập nhật |
| [apps/api/src/modules/index.ts](../apps/api/src/modules/index.ts) | Cập nhật |
| [apps/api/src/modules/orders/cancellation.service.ts](../apps/api/src/modules/orders/cancellation.service.ts) | Cập nhật |
| [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts) | Cập nhật |
| [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts) | Thêm mới |
| [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts) | Cập nhật |
| [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts) | Cập nhật |
| [apps/api/src/modules/orders/reasons.test.ts](../apps/api/src/modules/orders/reasons.test.ts) | Thêm mới |
| [apps/api/src/modules/orders/reasons.ts](../apps/api/src/modules/orders/reasons.ts) | Thêm mới |
| [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts) | Cập nhật |
| [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts) | Cập nhật |
| [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts) | Cập nhật |
| [apps/web/app/workspace/[area]/page.tsx](../apps/web/app/workspace/[area]/page.tsx) | Cập nhật |
| [apps/web/features/admin/order-exceptions.tsx](../apps/web/features/admin/order-exceptions.tsx) | Cập nhật |
| [apps/web/features/admin/reports-panel.tsx](../apps/web/features/admin/reports-panel.tsx) | Cập nhật |
| [apps/web/features/admin/risk-panel.tsx](../apps/web/features/admin/risk-panel.tsx) | Cập nhật |
| [apps/web/features/admin/stock-adjustment.tsx](../apps/web/features/admin/stock-adjustment.tsx) | Cập nhật |
| [apps/web/features/admin/users-panel.tsx](../apps/web/features/admin/users-panel.tsx) | Cập nhật |
| [apps/web/features/guest/bill-lines.tsx](../apps/web/features/guest/bill-lines.tsx) | Thêm mới |
| [apps/web/features/guest/guest-panels.tsx](../apps/web/features/guest/guest-panels.tsx) | Cập nhật |
| [apps/web/features/guest/guest.tsx](../apps/web/features/guest/guest.tsx) | Cập nhật |
| [apps/web/features/guest/join-form.tsx](../apps/web/features/guest/join-form.tsx) | Thêm mới |
| [apps/web/features/shared/components.tsx](../apps/web/features/shared/components.tsx) | Cập nhật |
| [apps/web/features/shared/policy-ui.tsx](../apps/web/features/shared/policy-ui.tsx) | Thêm mới |
| [apps/web/features/shared/primitives.tsx](../apps/web/features/shared/primitives.tsx) | Cập nhật |
| [apps/web/features/workforce/payroll-panel.tsx](../apps/web/features/workforce/payroll-panel.tsx) | Cập nhật |
| [apps/web/features/workforce/workforce-panel.tsx](../apps/web/features/workforce/workforce-panel.tsx) | Cập nhật |
| [apps/web/features/workspace/bill-panel.tsx](../apps/web/features/workspace/bill-panel.tsx) | Cập nhật |
| [apps/web/features/workspace/order-card.tsx](../apps/web/features/workspace/order-card.tsx) | Cập nhật |
| [apps/web/features/workspace/receipt.tsx](../apps/web/features/workspace/receipt.tsx) | Cập nhật |
| [apps/web/features/workspace/service-actions.tsx](../apps/web/features/workspace/service-actions.tsx) | Cập nhật |
| [apps/web/styles/interface.css](../apps/web/styles/interface.css) | Cập nhật |
| [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) | Cập nhật |
| [packages/contracts/src/order-reasons.ts](../packages/contracts/src/order-reasons.ts) | Thêm mới |
| [packages/contracts/src/restaurant-policy.ts](../packages/contracts/src/restaurant-policy.ts) | Thêm mới |
| [packages/database/prisma/migrations/202610010001_guest_policy_order_reasons/migration.sql](../packages/database/prisma/migrations/202610010001_guest_policy_order_reasons/migration.sql) | Thêm mới |
| [packages/database/prisma/schema.prisma](../packages/database/prisma/schema.prisma) | Cập nhật |
| [scripts/core-api-docs.ts](../scripts/core-api-docs.ts) | Cập nhật |
| [tests/browser/core45.spec.ts](../tests/browser/core45.spec.ts) | Cập nhật |
| [tests/browser/interface.spec.ts](../tests/browser/interface.spec.ts) | Cập nhật |
| [tests/browser/policy.spec.ts](../tests/browser/policy.spec.ts) | Thêm mới |
| [tests/browser/workforce.spec.ts](../tests/browser/workforce.spec.ts) | Cập nhật |
| [tests/core45.integration.test.ts](../tests/core45.integration.test.ts) | Cập nhật |
| [tests/policy.integration.test.ts](../tests/policy.integration.test.ts) | Thêm mới |
| [tests/review.integration.test.ts](../tests/review.integration.test.ts) | Cập nhật |
| [tests/workforce.integration.test.ts](../tests/workforce.integration.test.ts) | Cập nhật |

Tài liệu học được cập nhật tại 00, 04, 05, 06, 07, 11, 13, 15–19 và bài 21 này; API mẫu/Swagger, từ điển đủ 55 bảng và ERD xuất lại từ metadata. README gốc và bản HTML Windows được đồng bộ từ cùng bộ nguồn.

### 2. Migration và ý nghĩa ba cột mới

[Migration 202610010001_guest_policy_order_reasons](../packages/database/prisma/migrations/202610010001_guest_policy_order_reasons/migration.sql) là migration thứ 24; đã áp dụng bằng migrate deploy, sinh lại Prisma Client. Không sửa migration cũ, không dùng db push, không thêm bảng chính sách.

| Bảng / cột mới | Để làm gì? |
|---|---|
| session_participant.accepted_policy_version | Lưu phiên bản khách chấp nhận khi tham gia, ví dụ 2026-10-v1. |
| session_participant.accepted_policy_at | Thời điểm máy chủ ghi nhận sự đồng ý; không lấy giờ do client tự gửi. |
| order_item.cancel_reason_code | Mã lý do chuẩn để phân quyền, giải thích hóa đơn và truy vết. cancel_reason vẫn giữ diễn giải. |

Hai cột đồng ý phải cùng NULL hoặc cùng có giá trị; version có định dạng được kiểm tra. Trigger không cho sửa bằng chứng đã ghi, kể cả việc gán một xác nhận mới cho participant cũ vốn NULL. Khách cũ giữ NULL vì hệ thống chưa từng hỏi họ; không bịa lịch sử hoặc buộc họ đồng ý lại giữa bữa ăn. Chỉ tên hiển thị/last_seen và dữ liệu hợp lệ khác được cập nhật bình thường.

### 3. Kiến trúc chính sách và xác nhận QR

[restaurant-policy.ts](../packages/contracts/src/restaurant-policy.ts) là nguồn chung của API và giao diện: version **2026-10-v1**, ngày cập nhật 01/10/2026, sáu ý tóm tắt, 12 nhóm đầy đủ, thông báo theo ngữ cảnh và quy trình ngắn cho ba vai trò. GET /guest/policy công khai nội dung hiện tại. Không có bảng lưu policy text, CMS hoặc rule engine.

QR mới → nhập tên → checkbox **chưa chọn sẵn** → gửi acceptedPolicyVersion. Giao diện báo lỗi ngay cạnh trường; API vẫn tự kiểm tra: thiếu version trả 400, sai version hiện tại trả 409. Backend ghi version và giờ máy chủ trong cùng giao dịch tạo participant. Đồng ý trên UI không thay thế kiểm tra quyền, trạng thái hoặc giá tiền tại API.

Khách đang tham gia quét lại cùng bàn thì tiếp tục participant cũ, không tick lại và không đổi bằng chứng. Quét QR bàn khác vẫn phải qua bước tham gia rõ ràng. Khách mở lại “Quy định & chính sách” từ header cả trước/sau join; hộp thoại dùng được bằng bàn phím và trên điện thoại. Nhân viên/bếp/quản trị có “Quy trình nghiệp vụ”, không có checkbox bắt buộc.

Khách chưa có hoặc hết phiên được hướng dẫn quét QR; không hiển thị thông báo đăng nhập nhân viên. Backend chỉ đưa lời giải thích đã đánh dấu publicMessage của kiểm tra nghiệp vụ; không xuất lỗi nội bộ. Lỗi đăng nhập/quyền nhân viên vẫn theo cơ chế riêng hiện có.

Trang khách nhận thay đổi QR ngay cả khi URL chỉ đổi phần sau dấu # và trang không được tải lại. Mỗi lần đổi QR có mã thế hệ nội bộ để bỏ phản hồi chậm của bàn cũ. Quét QR bàn khác đưa về form chưa đồng ý, không hiển thị hoặc tự chuyển sang dữ liệu của bàn trước; quét lại bàn đã tham gia tiếp tục phiên cũ sau backend xác minh.

Nếu sửa chính sách lớn về sau: đổi version trong nguồn chung, cập nhật tài liệu/kiểm thử và giữ khả năng truy lại nội dung phiên bản cũ qua lịch sử mã nguồn. Participant mới chấp nhận version mới; không tự thay bằng chứng khách đã ở trong phiên.

### 4. Trạng thái món và cách xử lý ngoại lệ

Luồng bình thường vẫn **SUBMITTED → ACCEPTED → IN_PREPARATION → READY → SERVED**. Kho tiêu hao đúng tại ACCEPTED → IN_PREPARATION.

| Trường hợp | Trạng thái / thao tác | Kho | Khoản tiền của món |
|---|---|---|---|
| Khách hủy món của mình khi SUBMITTED | CANCELLED | Trả lượng đang giữ | Không tính; tính phần cần hoàn nếu đã thu. |
| STAFF hủy trước chế biến | SUBMITTED/ACCEPTED → CANCELLED | Trả lượng đang giữ | Không tính; tính lại hóa đơn. |
| Bếp hết nguyên liệu trước chế biến | ACCEPTED → UNAVAILABLE | Trả lượng đang giữ | Không tính; giữ lịch sử và lý do hết nguyên liệu. |
| Bếp báo lỗi chế biến/chất lượng/nhầm món | IN_PREPARATION/READY → CANCELLED, tạo sự cố chờ ADMIN | Không hoàn nguyên liệu đã dùng | Tạm giữ tiền đến khi quản trị quyết định; khách thấy đang xử lý. |
| ADMIN xác nhận lỗi nhà hàng | Dừng món nếu cần + quyết định lỗi, trong cùng giao dịch | Giữ tiêu hao và giá vốn | Bỏ khoản tiền món, tính lại, tạo/cập nhật cảnh báo cần hoàn nếu đã thu dư. Không phải bấm miễn thêm. |
| ADMIN xác định khách đổi ý | Hủy muộn hoặc xử lý báo cáo bếp đang chờ | Giữ tiêu hao và giá vốn | Vẫn tính tiền; ghi lý do và quyết định rõ. |
| Khách khiếu nại sau SERVED | ADMIN quyết định miễn | Giữ trạng thái đã phục vụ và giá vốn | Bỏ tiền, hoàn riêng khi có tiền đã thu dư. |

Không thêm FAILED hoặc một bộ trạng thái workflow mới. CANCELLED mô tả món đã dừng; trạng thái khoản phải thu và audit mô tả quyết định tài chính. Cảnh báo sự cố dùng operational_alert hiện có và không cho đóng bàn khi chưa xử lý. STAFF không được “hoàn tất” báo cáo lỗi bếp để bỏ qua ADMIN.

### 5. Quyền và mã lý do

| Vai trò | Quyền trong đợt này | Giới hạn |
|---|---|---|
| Guest | Đồng ý chính sách, giỏ của mình, gọi/hủy món SUBMITTED của mình, hỗ trợ, đề nghị trả, rời phiên của mình | Không hủy món người khác, không hủy sau bếp nhận, không tự xác nhận đã thu/hoàn hoặc miễn tiền. |
| STAFF | Duyệt/từ chối lượt chờ, hủy sớm, phục vụ, thu/hoàn thủ công, hỗ trợ, chuyển/đóng/dọn bàn | Không miễn tùy ý, không xử lý quyết định lỗi nhà hàng thay ADMIN. |
| KITCHEN | Nhận/bắt đầu/xong món, báo hết trước chế biến, dừng và báo sự cố sau chế biến | Không tự giảm tiền; không dùng lý do khách đổi ý để báo lỗi; không dừng/miễn món SERVED. |
| ADMIN | Quyết định lỗi/đổi ý/miễn, cấu hình rủi ro/quyền, kho và nhân sự | Quyền admin.workspace không mặc nhiên kế thừa staff.workspace hoặc kitchen.workspace. |

API kiểm tra permission, nhà hàng/phiên, actor/sở hữu, trạng thái và whitelist theo thao tác. UI chỉ đưa lựa chọn thích hợp. [order-reasons.ts](../packages/contracts/src/order-reasons.ts) dùng chung nhãn; [orders/reasons.ts](../apps/api/src/modules/orders/reasons.ts) kiểm tra phía máy chủ.

| Mã / nhãn khách thấy | Ai dùng và trạng thái chính | Ghi chú và hậu quả |
|---|---|---|
| CUSTOMER_CHANGED_MIND — Khách thay đổi lựa chọn | Guest SUBMITTED; STAFF hủy sớm; ADMIN xử lý muộn/miễn theo quyết định | Hủy sớm bỏ tiền/trả giữ; hủy muộn giữ tiền/kho. Không tự dùng mã này để miễn. |
| OUT_OF_STOCK — Hết nguyên liệu trước chế biến | KITCHEN, chỉ ACCEPTED | Cần ghi chú; UNAVAILABLE, bỏ tiền/trả giữ. |
| KITCHEN_ERROR — Lỗi chế biến của nhà hàng | KITCHEN báo IN_PREPARATION/READY; ADMIN xác nhận hoặc quyết định miễn | Cần ghi chú; chỉ quyết định ADMIN mới bỏ tiền, giữ nguyên tiêu hao. |
| QUALITY_ISSUE — Món không đạt chất lượng | KITCHEN báo IN_PREPARATION/READY; ADMIN xử lý | Như lỗi chế biến; không tự hoàn kho. |
| WRONG_ITEM — Nhà hàng làm nhầm món | STAFF hủy sớm; KITCHEN báo món đã làm; ADMIN xử lý | Sớm trả giữ/bỏ tiền; muộn giữ kho và chờ quyết định ADMIN. Lỗi cần ghi chú. |
| CUSTOMER_COMPLAINT — Xử lý khiếu nại của khách | ADMIN quyết định miễn món đã chế biến/phục vụ/hủy muộn | Cần ghi chú; bỏ tiền, giữ trạng thái/giá vốn thích hợp. |
| OTHER — Lý do khác | Guest/STAFF hủy sớm; ADMIN xử lý muộn/miễn | Luôn cần ghi chú; hiệu lực phụ thuộc thao tác, không tự được coi là lỗi nhà hàng. |

Ghi chú tối đa 500 ký tự sau loại khoảng trắng đầu/cuối. API cũ gửi lời tự do được quy về mã an toàn theo thao tác, không suy đoán là lỗi nhà hàng để tự miễn tiền. Lịch sử món giữ ai/thời điểm/trạng thái; audit nhân viên giữ mã lý do, diễn giải và quyết định tiền. Guest được truy vết bằng participant, sở hữu và lịch sử món; business_audit_event hiện tại dùng người dùng nhân viên nên không bịa một tài khoản nhân viên cho Guest.

### 6. Ảnh hưởng tới kho

Không đổi công thức snapshot hoặc nguyên tắc giữ/tiêu hao hiện có. Hủy sớm/hết trước chế biến chỉ RELEASE reservation. Sau bắt đầu, nguyên liệu đã dùng không được hoàn ngược vì thực tế đã tiêu hao; movement và COGS vẫn còn cả khi nhà hàng không thu tiền món.

Ví dụ một món giá 85.000đ có giá vốn 30.000đ: nếu chưa chế biến mà hủy, trả giữ nguyên liệu và bỏ 85.000đ. Nếu đã chế biến lỗi, không nhập lại nguyên liệu; ADMIN bỏ 85.000đ, giá vốn 30.000đ vẫn là chi phí. Nếu khách đổi ý sau khi đã làm, vẫn tính 85.000đ và giữ chi phí 30.000đ. Các con số này chỉ để học, không phải giá/định lượng của một món seed cụ thể.

### 7. Ảnh hưởng tới tiền, bill và receipt

Một hàm reverseItemCharge dùng chung cho hủy sớm/hết/ADMIN xác nhận lỗi/miễn. Trong transaction có khóa phiên, chỉ bỏ các financial_charge còn ACTIVE, đảo allocation liên quan và hủy yêu cầu thanh toán đang chờ đã lỗi thời, tính lại account. Nếu tiền đã thu lớn hơn khoản còn phải trả, tạo hoặc cập nhật một cảnh báo REFUND_REQUIRED chưa giải quyết; không tạo khoản giảm lần hai khi gửi lại cùng quyết định.

**Không tính tiền món ≠ đã trả lại tiền khách.** Ví dụ khách đã đưa 200.000đ, sau bỏ món lỗi bill còn 115.000đ thì cần hoàn 85.000đ. STAFF lập hồ sơ và ghi nhận khi đã trả thực tế. Payment/refund giữ giao dịch nguồn, allocation, giới hạn số tiền, tham chiếu và chống gửi lặp. Không sửa/xóa lần thu cũ để làm lịch sử trông như chưa từng nhận tiền.

Bill/receipt giữ dòng món gốc, trạng thái, lý do và dòng điều chỉnh âm cho món không thu; món hủy muộn còn thu có chú thích “Vẫn tính phí”. Món đang có báo cáo bếp có chú thích chờ quản trị. Phiếu phiên đã đóng là snapshot, không bị viết lại bởi code mới; phiếu cũ thiếu trường lý do vẫn hiển thị an toàn. Doanh thu món đã phục vụ lấy tiền còn tính sau điều chỉnh; tiền thực nhận/hoàn và chi phí được trình bày riêng, không gộp thành một chỉ tiêu.

### 8. Thông báo và bước xác nhận

| Nhóm | Cách trình bày đã áp dụng |
|---|---|
| Xem món, đổi danh mục, thêm/sửa/xóa giỏ, gọi hỗ trợ | Không popup xác nhận. Có thông tin ngắn về giỏ theo người chọn, trạng thái và món hết khi cần. |
| Gửi món | Xem số món/tổng tiền phần của mình và lưu ý hủy ngay trong giỏ trước nút gửi. Không thêm một popup lặp lại cùng bản tóm tắt. |
| Hủy món/lượt, báo hết/lỗi, ADMIN quyết định | Một hộp xác nhận nói rõ món/lượng/tiền và còn tính hay không; lý do có nhãn tiếng Việt. |
| Đề nghị thanh toán | Nhập số tiền/phương thức → kiểm tra lại một lần → gửi; nói rõ chưa phải đã thu. Quay lại không ghi dữ liệu. |
| Thu, lập/ghi hoàn, thiếu tiền, đóng phiên, chuyển bàn | Xác nhận dữ liệu cụ thể của giao dịch; backend kiểm tra số dư/trạng thái hiện tại. Các luồng vốn có xác nhận được giữ, không chồng popup. |
| Rời bàn | Xác nhận xóa giỏ chưa gửi/cookie của mình; món đã gửi và tiền phát sinh của bàn vẫn còn. Hủy hộp thoại không đổi backend. |
| Kho, cấu hình quyền/rủi ro, chốt/chi/xóa nháp lương | Xác nhận theo tác động hiện có: lượng/đơn vị/kho, vai trò/trạng thái/lý do hoặc tổng tiền kỳ lương. |

Dùng icon info/warning trong bộ icon chung, tên hỗ trợ, nhãn trường, không chỉ dùng màu. Dialog hỗ trợ Escape/tab/focus; khi đóng phải gọi close trước khi trả focus về nút mở. Bảng duyệt công ADMIN đổi thành thẻ có nhãn ở điện thoại để nút “Duyệt công” không bị bảng rộng che hoặc cuộn lệch.

### 9. Kiểm thử đã chạy và những lỗi đã sửa

| Kiểm tra | Kết quả bản hiện tại |
|---|---|
| Trước sửa: pnpm check + API/database | 19 unit và 51 integration đạt; không phát hiện lỗi test có sẵn trong nền này. |
| pnpm check sau sửa cuối | ĐẠT: định dạng, ESLint, TypeScript; 21 unit test trên sáu tệp. |
| pnpm test:integration | ĐẠT: 62/62 trên sáu tệp; gồm 11 bài chính sách/xử lý món mới. |
| SQL migration trên database tạm | ĐẠT sáu kiểm tra cặp version/time, xác nhận cũ NULL, bất biến bằng chứng và cập nhật tên hợp lệ. |
| Playwright toàn hệ thống sau sửa cuối | 50 đạt / 1 chủ động bỏ qua / 0 lỗi, 51 trường hợp; 4.3m. |
| Chạy riêng nhân sự sau sửa bảng mobile | ĐẠT: 9/9, desktop/Android Chrome/WebKit mobile; 39 giây. |
| Chạy riêng QR/chính sách/gọi món sau sửa hash | ĐẠT: 9/9 trên ba dự án trình duyệt, 1,7 phút; quét bàn khác, quay lại bàn cũ và gửi món đến đóng/dọn phiên. |
| pnpm build | ĐẠT; bản production đủ 7 route, dùng thư mục build riêng. |
| pnpm check:secrets | ĐẠT; quét bí mật cơ bản của repository. |

Integration kiểm tra: thiếu/sai/chấp nhận policy; version/time server và bất biến; cùng QR/khác QR/khách cũ; rời bàn không mất món/tiền; sở hữu và quyền; hủy SUBMITTED/ACCEPTED; hết nguyên liệu; lỗi ở IN_PREPARATION/READY; không tự miễn/không tự hủy muộn; mã ngoài whitelist/note dài; ADMIN xác nhận/không xác nhận; thu trước rồi lỗi cần hoàn; allocation/audit/alert; retry không bỏ tiền hai lần; không hoàn nguyên liệu đã dùng; SERVED complaint/waive và doanh thu sau điều chỉnh.

Browser kiểm tra checkbox chưa tick, lỗi tên/đồng ý, chính sách và bàn phím/Escape/focus, 320/390/768/1440px, reload/quét lại, tóm tắt giỏ, quay lại từ xác nhận thanh toán không tạo yêu cầu, SOP, bếp báo lỗi qua UI → ADMIN xác nhận qua UI → khách thấy bill đúng, hủy rời bàn không làm rời thật. Toàn bộ các nhóm cũ của gọi món/kho/nhân sự/giao diện vẫn chạy trong suite.

Thêm assertion API/browser cho khách chưa quét QR: trả 401 và hướng dẫn quét QR, không dùng câu “phiên đăng nhập hết hạn” của nhân viên. Vấn đề câu chữ này được thấy khi mở thủ công ứng dụng; nền test trước đó chưa kiểm tra câu này. Sau sửa đã chạy lại check, toàn bộ integration và browser.

Assertion browser mới có một lần thất bại do chọn cả thông báo khách và vùng thông báo rỗng do Next sinh (47 đạt / 1 bỏ qua / 3 lỗi locator). Đã giới hạn locator vào vùng chào khách, không bỏ assertion hoặc ép click. Kết quả toàn suite sau sửa selector được ghi ở bảng trên; không lấy lượt lỗi đó làm bằng chứng đạt.

Lượt sau đó có 46 đạt / 1 bỏ qua / 4 lỗi: ba trường hợp phát hiện trang đã mở không nhận QR khi chỉ đổi hash; một trường hợp WebKit thao tác điều hướng trong lúc gửi giỏ còn cập nhật. Đã sửa nhận hash và bỏ phản hồi cũ; test gọi món chờ dấu hiệu giỏ gửi xong rồi kiểm tra màn hình món đã gửi. Bài chính sách còn kiểm tra QR bàn khác bắt buộc hiện form mới và quay lại QR cũ vẫn giữ đúng session. Không sửa quy tắc duyệt để làm test dễ đạt.

Trong lúc triển khai đã phát hiện và sửa regression mất route review/accept của lượt gọi (khôi phục nguyên API cũ), đường import package contracts không phù hợp Next/Turbopack, focus không trở lại sau dialog, nhãn select chứa cả options và nút duyệt công mobile bị bảng rộng che. Lần full browser trước sửa bảng mobile có **49 đạt / 1 bỏ qua / 1 lỗi**; không gọi lần đó là đạt. Sau sửa bảng mobile nhóm nhân sự 9/9 đã đạt; kết quả toàn suite cuối nằm ở bảng trên. Những lỗi này được phân biệt với nền test trước sửa vốn đã đạt.

Database/browser tests tạo database riêng và dọn sau; không xóa dữ liệu vận hành. Bản build dùng thư mục riêng, không dừng máy chủ phát triển mà người dùng đang dùng. [Ảnh và biên bản cuối](reference/policy-review-20261001.json) ghi phạm vi thực tế, không coi tên test là bằng chứng nếu chưa chạy.

[Quy định trên điện thoại](evidence/policy-policy-dialog-mobile.png) · [Giỏ trước khi gửi](evidence/policy-guest-order-review-mobile.png) · [Bill món lỗi không tính tiền](evidence/policy-guest-fault-bill-mobile.png) · [Bảng công dạng thẻ](evidence/policy-attendance-mobile.png).

Log thực sự: [check](evidence/policy-check.log), [API/database](evidence/policy-integration.log), [browser](evidence/policy-browser.log), [production build](evidence/policy-build.log). Các ảnh có mã/tên dữ liệu tự sinh của database kiểm thử.

### 10. Giới hạn và cách duy trì

- Đây là quy định nghiệp vụ nhà hàng nhỏ-vừa của luận văn, không phải xác nhận pháp lý hay chứng nhận vận hành. Ghi nhận version/time chứng minh hệ thống nhận xác nhận, không chứng minh khách đã đọc từng câu.
- Sự thật một món lỗi cần con người kiểm tra; mã lý do đúng không tự chứng minh lỗi có thật. Bếp báo cáo, ADMIN quyết định; hệ thống lưu dấu vết và không cho đóng bỏ qua.
- Thanh toán/hoàn tiền mặt hoặc chuyển khoản vẫn cần nhân viên thực nhận/thực trả. Chưa có checkout VNPAY/MoMo tự động hoặc AI chatbot hoàn chỉnh.
- Giao diện đang tải lại trạng thái khoảng mỗi ba giây; chưa có WebSocket/SSE tới browser. Có khoảng chờ hiển thị; backend transaction là nguồn trạng thái cuối.
- Chưa kiểm tải, vận hành nhiều ngày tại quán, gateway online, kiểm toán an ninh chuyên sâu, hóa đơn thuế hoặc tính lương theo luật. Một trường hợp Swagger mobile chủ động bỏ qua không được tính là test đạt.
- Tài liệu và source hiện nằm trong working tree chưa commit; có thể truy từng tệp theo SHA256 trong biên bản. Nếu code/schema thay đổi tiếp, cập nhật bài tương ứng, metadata/test và xuất HTML từ cùng nguồn.

Đọc bài 04 để hiểu khách tham gia, bài 05 để theo từng trạng thái món, bài 06 để hiểu thu/hoàn, bài 07/16 để học bảng. Bài 21 dùng khi muốn đối chiếu vì sao hệ thống chọn các quy tắc này.

## Cập nhật áp dụng 02/10/2026: thao tác nhanh và hai trách nhiệm

[Bài 24](24-su-co-mon-va-phieu-thanh-toan.md) thay cách trình bày/xử lý sự cố của đợt 01/10 ở các điểm sau. Bếp chọn mã lỗi có sẵn, ghi chú không bắt buộc; không còn yêu cầu nhập ghi chú bắt buộc cho KITCHEN_ISSUE. Admin duyệt báo cáo đã lưu bằng một bước xác nhận, không nhập lại; xử lý thủ công khác vẫn cần ghi chú theo scope ở backend. Việc phục vụ đã trao đổi khách độc lập với quyết định tiền. Admin và Staff cùng được xem phiếu/lập/ghi nhận hoàn; hoàn đủ tự giải quyết cảnh báo hoàn tiền. Không thay chính sách chấp thuận của khách hoặc thêm migration. Phiếu dùng thành tiền 0đ thay dòng giảm âm.

## Cập nhật thao tác thu tiền ngày 02/10/2026

[Bài 25](25-thu-tien-tai-ban.md) thay phần thao tác thanh toán trước đây: khách chọn hình thức và gọi nhân viên, không nhập/xác nhận số tiền. Nhân viên chọn khoản thu rồi ghi nhận sau thực nhận, chuyển khoản dùng mã hoặc ảnh riêng. Không thay điều kiện hủy/miễn/hoàn hay chính sách đã đồng ý v2. Lời nhắc tại thao tác được sửa để khớp màn hình mới.
