# 23. Chuyển bàn: giữ nguyên bữa ăn, đổi vị trí phục vụ

Khách đang ngồi ở P01 muốn sang A05. Nhân viên chuyển **cả phiên phục vụ đang mở** sang bàn trống đó. Khách tiếp tục dùng web đang mở; giỏ, món đã gọi, số tiền và thanh toán vẫn thuộc cùng bữa ăn.

Ví dụ: phiên S123 bắt đầu ở P01 → chuyển sang A05 → kết thúc ở A05. Mã phiên vẫn là S123. Phiếu thanh toán cuối ghi A05, và nhân viên có thể xem lịch sử để biết bữa ăn từng ở P01.

## Thực hành theo từng bước

1. Đăng nhập bằng tài khoản **phục vụ**. Trong **Sơ đồ bàn**, chọn **Mở chi tiết bàn** của P01.
2. Ngay đầu chi tiết, chọn **Chuyển bàn**. Phần đầu cho biết bàn nguồn, khu vực và sức chứa.
3. Kiểm tra **Số khách thực tế**. Đây là tổng người đang ngồi tại bàn, có thể khác số người đang dùng web. Hệ thống gợi ý theo người tham gia đang hoạt động, tối thiểu 1; nhân viên cần sửa cho đúng thực tế. Giới hạn hiện tại là 1–30.
4. Tìm mã/tên bàn hoặc lọc khu vực. Mỗi thẻ ghi tên bàn, khu vực, số chỗ và **Sẵn sàng**. Chỉ xuất hiện bàn trống đang hoạt động, ở khu vực đang hoạt động, không có phiên mở và đủ chỗ.
5. Chọn bàn. Thẻ có dấu chọn và chữ **Đã chọn**. Chọn lý do; nếu chọn **Lý do khác**, phải nhập nội dung. Ghi chú bổ sung tối đa 400 ký tự.
6. Bấm **Xác nhận chuyển bàn** để xem lại: P01 → A05, số khách, lý do và ảnh hưởng đến hai bàn. **Hủy** quay lại phần chọn, chưa ghi dữ liệu. **Chuyển bàn** mới gửi yêu cầu thực hiện.
7. Thành công: màn hình báo **Đã chuyển P01 → A05**, chi tiết tiếp tục mở tại A05. P01 thành **Chờ dọn**, A05 thành **Đang có khách**. Nhân viên chỉ mở lại P01 sau khi xác nhận **Đã dọn xong**.
8. Chọn **Lịch sử chuyển bàn** để xem các lần chuyển của phiên, mới nhất trước: thời gian Việt Nam, bàn nguồn/đích, nhân viên và lý do.

**Ví dụ khi đổi số khách:** bạn chọn A05 có 4 chỗ. Đổi số khách từ 4 lên 6 thì A05 biến mất khỏi danh sách phù hợp và lựa chọn bị bỏ, kèm thông báo. Hãy chọn A06 có 6 chỗ hoặc bàn lớn hơn. Màn hình không tự chọn bàn thay bạn.

## 1. Nguồn POS đã tham khảo trước khi triển khai

| Nguồn chính thức | Điều được tham khảo | Áp dụng vào dự án |
|---|---|---|
| [Lightspeed K: chuyển món và đơn sang bàn khác](https://k-series-support.lightspeedhq.com/hc/en-us/articles/10032856591643-Transferring-items-and-orders-to-other-tables) | Chọn bàn đích qua danh sách hoặc sơ đồ; có thao tác chuyển cả đơn | Chọn đích rõ ràng, chuyển cả phiên |
| [Lightspeed L: Transfer Receipt](https://resto-support.lightspeedhq.com/hc/en-us/articles/226405488-Transferring-and-merging-orders) | Chọn bàn đích; bàn đã có khách dẫn tới quy trình gộp riêng | Dự án chặn bàn có khách, không gộp phiên |
| [Square: reassign checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants) | Tương tác bàn trên sơ đồ; bàn trống và bàn đã có khách được xử lý khác nhau | Kiểm tra trạng thái đích; giữ quyền nhân viên |
| [Toast: transferring items, checks and payments](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments) | Chọn bàn mới rồi xác nhận Move Check | Một bước xem lại trước khi ghi chuyển |
| [Oracle Simphony: table management](https://docs.oracle.com/en/industries/food-beverage/simphony/simcg/c_tms_chapter_heading.htm) | Quản lý trạng thái bàn; các mức TMS có phạm vi khác nhau | Giữ rõ bàn có khách và bàn chờ dọn |

Các nguồn giúp chọn cách tổ chức thao tác. Không dùng CSS, thương hiệu, mã nguồn hoặc dịch vụ của họ. Những hệ thống cho gộp/split đơn có quy tắc riêng; dự án này chỉ chuyển cả phiên đang mở sang bàn trống.

## 2. Cách tổ chức giao diện được chọn

**Tìm/lọc + thẻ bàn**, tiếp theo là một bước xác nhận. Repository chưa có tọa độ sơ đồ sàn nên không dựng bản đồ bàn giả hoặc kéo thả. Danh sách thẻ phù hợp với khoảng 10–50 bàn, có vùng cuộn giới hạn; máy tính nhiều cột, điện thoại một cột. Khu vực và số chỗ được đọc ngay trên thẻ.

Chức năng đặt đầu chi tiết phiên, trước món và thu tiền. Lịch sử mở riêng để nhân viên không phải đọc nhiều dòng trong lúc chọn bàn. Phần xác nhận nằm trong cùng hộp thoại, không có xác nhận kép.

## 3. Các tệp đã sửa và vai trò

| Tệp tính từ gốc repository | Vai trò |
|---|---|
| `packages/contracts/src/table-transfer-policy.ts`, `packages/contracts/src/index.ts` | Giới hạn số khách/ghi chú và năm lý do tiếng Việt dùng chung |
| `apps/api/src/modules/dining/table-transfer.routes.ts` | Kiểm tra chuyển bàn, ghi giao dịch và trả lịch sử mới nhất trước |
| `apps/api/src/modules/dining/transfer-reasons.ts` | Kiểm tra mã lý do, định dạng chuỗi dễ đọc; tương thích lý do chữ cũ |
| `apps/api/src/modules/shared/core-persistence.ts` | Khóa theo mã phiên ổn định; kiểm tra lại nhà hàng sau khóa |
| `apps/api/src/modules/catalog/catalog.routes.ts` | Danh sách bàn thêm trạng thái khu vực và số người tham gia hoạt động |
| `apps/web/features/workspace/table-transfer-data.ts` | Lọc bàn phù hợp, xếp thứ tự và tìm kiếm |
| `apps/web/features/workspace/table-transfer-panel.tsx` | Chọn bàn, xác nhận, thông báo và timeline lịch sử |
| `apps/web/features/workspace/service.tsx` | Đặt chức năng ở đầu chi tiết; tải lại bàn/phiên/hóa đơn sau chuyển |
| `apps/web/features/guest/guest.tsx` | Cập nhật bàn và thông báo khi cùng phiên được chuyển |
| `apps/web/features/shared/primitives.tsx` | Escape chỉ đóng hộp đang mở trên cùng, giữ chi tiết bàn |
| `apps/web/app/table-transfer.css`, `apps/web/app/layout.tsx` | Bố cục thẻ, trạng thái chọn và responsive |
| `tests/table-transfer.integration.test.ts` | Kiểm chứng API, CSDL, hóa đơn và đồng thời |
| `tests/browser/table-transfer.spec.ts` | Thao tác giao diện thực trên trình duyệt |
| `tests/browser/core45.spec.ts` | Ảnh kiểm thử dùng pixel CSS để tránh giới hạn ảnh Retina khi dữ liệu test cộng dồn |
| `tests/support.integration.test.ts` | Tách nhân viên test ca trực khỏi seed tương đối theo ngày, tránh trùng lịch |
| `scripts/core-api-docs.ts` | Ví dụ payload API chuyển bàn mới |

Danh sách/hàm băm chính xác của đợt này nằm trong [biên bản](reference/table-transfer-review-20261002.json). Các bài học và bản xuất HTML được cập nhật từ cùng nguồn Markdown.

## 4. CSDL và migration

**Không thêm bảng/cột/migration, không reset hoặc seed lại dữ liệu vận hành.** Dùng các bảng và ràng buộc hiện hành:

- `table_session`: đổi `table_id`, tăng `version`; giữ `id` và các thuộc tính phiên khác.
- `dining_table`: bàn cũ → NEEDS_CLEANING; bàn mới → OCCUPIED; tăng phiên bản của hai bàn.
- `table_transfer_history`: thêm một bản ghi với nhà hàng, phiên, hai bàn, nhân viên, thời gian và lý do dễ đọc.

Các bảng khách, giỏ, đơn, tài khoản tài chính, thanh toán và hỗ trợ vẫn liên kết với cùng mã phiên. Lịch sử chuyển là dữ liệu truy vết; trigger hiện hành chặn sửa/xóa. Số khách nhập dùng để kiểm tra sức chứa khi chuyển; **không phải dữ liệu thống kê số khách được lưu riêng trong lịch sử**. Nếu cần báo cáo lượng khách theo lần chuyển sau này, phải bổ sung thiết kế rõ ràng.

## 5. Backend kiểm tra những gì?

`POST /core/sessions/:id/transfer` cần quyền `staff.workspace`. ADMIN/KITCHEN không có quyền này trong cấu hình hiện tại. Backend kiểm tra:

| Điều kiện | Khi không đạt |
|---|---|
| Phiên thuộc nhà hàng và còn ACTIVE | Từ chối |
| `fromTableId` còn là bàn hiện tại | Báo phiên đã được nhân viên khác chuyển |
| Bàn đích khác nguồn | Yêu cầu chọn bàn khác |
| `partySize` là số nguyên 1–30 | Báo giới hạn số khách |
| Bàn đích cùng nhà hàng, đang hoạt động | Từ chối bàn không còn hoạt động |
| Khu vực đích cùng nhà hàng và đang hoạt động | Báo khu vực đã ngừng hoạt động |
| Bàn AVAILABLE, không có phiên ACTIVE | Báo bàn vừa được sử dụng hoặc đang chờ dọn |
| Sức chứa ≥ số khách thực tế | Báo bàn không đủ chỗ cho số khách đó |
| Mã lý do hợp lệ; OTHER có nội dung; ghi chú trong giới hạn | Yêu cầu sửa đầu vào |

Frontend giúp chọn nhanh; backend kiểm tra lại bằng dữ liệu đang có trong transaction. Sửa request thủ công không vượt qua được những điều kiện này. Hợp đồng lý do chữ `reason` cũ vẫn được nhận nếu chưa gửi `reasonCode`; giao diện mới gửi mã và ghi chú.

## 6. Danh sách bàn hoạt động thế nào?

Mỗi thẻ có tên, khu vực, số chỗ, nhãn **Sẵn sàng**; mã bàn cũng xuất hiện nếu khác tên. Không dồn bàn có khách, chờ dọn hoặc ngừng hoạt động vào danh sách rồi vô hiệu hóa hàng loạt.

Đổi số khách làm danh sách cập nhật ngay. Bàn đang chọn trở nên thiếu chỗ hoặc không còn sẵn sàng sẽ bị bỏ chọn. Dữ liệu bàn được tải lại khi mở chức năng, khi bấm tải lại và qua vòng cập nhật của màn hình phục vụ. Backend vẫn bảo vệ khoảng thời gian giữa lúc xem và lúc bấm chuyển.

## 7. Xếp thứ tự và bộ lọc

Thứ tự: **cùng khu vực trước → sức chứa nhỏ nhất vẫn đủ chỗ → mã bàn theo thứ tự số tự nhiên**. Với 4 khách, trong cùng khu: bàn 4 chỗ trước 6 chỗ, rồi 10 chỗ. Bàn ở khu khác được xếp sau theo cùng nguyên tắc.

Có hai bộ lọc: tìm theo mã/tên (không phân biệt dấu, hoa/thường) và khu vực. Không có nút “đủ chỗ” vì đó là điều kiện luôn áp dụng. Số **Bàn phù hợp** là số thẻ đang khớp bộ lọc. Nếu bộ lọc mới ẩn bàn đã chọn thì bỏ lựa chọn, nhắc chọn lại. Không có kết quả thì nút xác nhận bị khóa.

## 8. Xác nhận

Nút **Xác nhận chuyển bàn** mở phần xem lại; chưa ghi CSDL. Nhân viên đọc P01 → A05, số khách và lý do. Màn hình nói rõ khách/giỏ/món/tiền được giữ và trạng thái hai bàn sau chuyển. **Hủy** quay lại chọn. **Chuyển bàn** mới thực hiện; khi đang gửi, khóa thao tác lặp và đóng hộp thoại.

## 9. Lịch sử

Mỗi lần chuyển là một khối: thời gian UTC+7, P01 → A05, tên/tài khoản nhân viên và lý do. Mới nhất trước. Chưa có lần chuyển thì ghi **Phiên này chưa từng chuyển bàn**. Không đưa enum vào phần thông tin dành cho nhân viên.

Tên bàn/nhân viên trong timeline hiện được JOIN từ danh mục hiện tại; đổi tên danh mục có thể đổi tên hiển thị trên lịch sử. Các UUID nguồn/đích/người thực hiện và lý do trong bản ghi vẫn giữ nguyên. Đây khác với phiếu cuối đã đóng, vốn có snapshot riêng.

## 10. Khách sau chuyển

Khách giữ cookie `guest`, mã người tham gia và mã phiên; không phải quét lại QR hoặc đăng nhập lại. Khi lần tải dữ liệu tiếp theo nhận bàn mới, đầu trang đổi sang bàn đó và báo ngắn một lần trong trang đang mở. Giỏ, món và tài khoản tiền được đọc từ cùng phiên.

Màn hình khách hiện hỏi lại khoảng mỗi 3 giây khi tab hiển thị, nên có thể cần một vòng cập nhật mới thấy bàn mới. Không thêm dịch vụ thời gian thực cho riêng chuyển bàn. Phản hồi có phiên bản phiên cũ được bỏ qua để tránh nhảy tên bàn về vị trí trước đó.

## 11. Hóa đơn và phiếu cuối

Không đổi mã phiên hoặc tạo phiếu mới khi chuyển. Phần tiền trong chi tiết được tải lại sau đổi bàn. Khi đóng phiên, snapshot hóa đơn lưu **bàn hiện tại tại thời điểm đóng**. Sau đó đổi tên bàn trong danh mục không đổi lại tên bàn trên phiếu đã chốt. Không in toàn bộ lịch sử chuyển trên phiếu khách thông thường.

## 12. Đồng thời và lỗi

Khóa hàng phiên theo `session_id` ổn định, rồi kiểm tra lại nhà hàng. Hai bàn được khóa theo thứ tự UUID để giảm deadlock; khu vực đích được giữ khóa chia sẻ trong lúc kiểm tra. Các thay đổi phiên, lịch sử và trạng thái bàn cùng transaction: lỗi thì rollback toàn bộ.

Hai nhân viên chuyển cùng một phiên: chỉ một thành công, người sau thấy nguồn đã đổi. Hai phiên vào cùng một bàn trống: chỉ một thắng, người sau thấy bàn bị sử dụng. Lỗi cũ “không tìm thấy” khi JOIN theo bàn cũ trong lúc chờ khóa đã được sửa bằng khóa theo mã phiên rồi đọc bàn hiện tại. Cách sửa dùng chung giúp request khách đang chờ chuyển cũng giữ đúng phiên.

Frontend nhận lỗi sẽ trở về chọn bàn, bỏ lựa chọn cũ, hiển thị lý do và tải lại danh sách. Nếu phiên đã được nhân viên khác chuyển khi hộp thoại đang mở, màn hình báo bàn hiện tại và yêu cầu quay lại chi tiết mới. Nếu chuyển đã thành công nhưng tải lại mất kết nối, thông báo vẫn ghi đã chuyển, kèm hướng dẫn tải lại; không tự gửi lại thao tác chuyển.

## 13. Kiểm thử đã chạy

Kết quả và ảnh của lần chạy cuối được ghi ở [hồ sơ đối chiếu](15-doi-chieu.md) và [biên bản JSON](reference/table-transfer-review-20261002.json). Những lỗi từng phát hiện và sửa trong quá trình kiểm tra được tách khỏi kết quả cuối.

Nhóm API/database kiểm tra: giữ toàn bộ định danh và số tiền; các trạng thái đích; sức chứa; mã lý do; source cũ; hai dạng tranh chấp; target có phiên ACTIVE dù trạng thái bàn sai; quyền; lịch sử không sửa/xóa; snapshot bàn trên phiếu; request khách chờ sau một lần chuyển.

Nhóm trình duyệt kiểm tra: tìm/lọc/thứ tự thẻ; đổi số khách; chọn bằng bàn phím; chữ Đã chọn; lý do OTHER; Hủy chưa ghi dữ liệu; chuyển thật; focus; lịch sử; cùng khách và dòng giỏ; cập nhật trạng thái bàn; đích bị chiếm trước lúc chuyển; phiên được chuyển từ nơi khác. Các kích thước được đối chiếu gồm 320, 768 và 1440 px, cùng các cấu hình Chromium desktop/Android và WebKit mobile trong repository.

[Ảnh chọn bàn trên máy tính](evidence/transfer-picker-desktop.png) · [Chọn bàn trên điện thoại](evidence/transfer-picker-mobile.png) · [Xác nhận trên điện thoại](evidence/transfer-review-mobile.png) · [Timeline lịch sử](evidence/transfer-history-desktop.png). Ảnh dùng database test riêng; mã MT… giúp các dữ liệu kiểm thử không trùng nhau.

## 14. Check, build và giới hạn

Các lệnh, mã thoát và số test thực chạy nằm trong biên bản; không dùng việc đọc code làm bằng chứng test đạt. Test sử dụng database/máy chủ riêng và tự dọn sau khi chạy. Chưa kiểm thử tải dài ngày tại nhà hàng thật, thiết bị POS chuyên dụng hoặc mọi loại mất mạng. Phạm vi hiện tại không có gộp phiên, tách bàn hoặc chuyển riêng từng món.
