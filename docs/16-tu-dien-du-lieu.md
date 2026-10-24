# 16. Từ điển dữ liệu hiện hành

## Bổ sung schema trước AI — 25/10/2026

Source hiện có **72 bảng**, gồm `payment_assistance_submission` lưu retry key của lời gọi nhân viên. Khóa chính `(participant_id,request_id)`, hash nội dung và FK tới support_request giúp trả lại yêu cầu cũ khi retry sau khi hoàn tất. Bảng này không ghi nhận tiền. [Từ điển và ERD vật lý vừa sinh từ database test đã áp 39 migration](database/data-dictionary.md). Các số liệu ngày cũ bên dưới là lịch sử.


## Ràng buộc hoàn tất yêu cầu thu tiền — 17/10/2026

Source bổ sung migration `202610170001_payment_system_resolution` (thứ 37), chưa áp lên production trong task audit. Migration thay CHECK legacy `support_request_check` bằng `support_request_resolution_actor` kiểm tra USER/SYSTEM rõ ràng, đồng thời giữ `support_request_owner_state`: USER phải có đúng người xử lý, SYSTEM phải không giả một USER, actor NULL không hợp lệ. Không thêm bảng/cột, không sửa Prisma model hoặc dữ liệu lịch sử. Dictionary/snapshot vật lý cũ bên dưới là hồ sơ trước migration này; không coi nó là bằng chứng production đã nâng cấp. [Biên bản](15-doi-chieu.md), [quy trình áp dụng an toàn](26-trien-khai-qtruongres.md).

## Bản hiện hành — 14/10/2026

Metadata PostgreSQL của bản đã xác minh có **67 bảng nghiệp vụ, 786 cột và 163 khóa ngoại**; không tính `_prisma_migrations`. Phần này đọc cấu trúc bảng, kiểu, khóa, ràng buộc, chỉ mục và trigger, không đọc hoặc xuất bản ghi khách, nhân viên, chứng từ hay thông tin đăng nhập.

[Từ điển vật lý đầy đủ của 67 bảng](database/data-dictionary.md) - [ERD tương tác: chọn bảng, phóng to và kéo](erd.html) - [Sơ đồ SVG hiện hành](database/physical.svg) - [Nguồn DOT hiện hành](database/physical.dot)

Các tệp trong `docs/database/` được sinh bằng `pnpm docs:database` từ metadata đã migrate. Công cụ đối chiếu danh sách bảng với `schema.prisma` trước khi xuất, nên không coi bảng thiếu migration hoặc bảng shadow là cấu trúc hiện hành. Phần 56 bảng ở cuối bài là hồ sơ ngày **03/10/2026**, giữ để so sánh lịch sử.

## Đọc sơ đồ hiện hành

Sơ đồ vẽ từ bảng cha sang bảng con. Mỗi dòng con cần một cha khi toàn bộ cột FK bắt buộc, hoặc có thể chưa có cha khi cột nullable. Phía con là 0..1 nếu có unique toàn phần phù hợp, nếu không là 0..N. Partial unique chỉ áp dụng cho những dòng thỏa điều kiện, không biến mọi bản ghi lịch sử thành quan hệ 1–1. FK ghép và CHECK cần đọc nguyên định nghĩa SQL.

## Danh sách 67 bảng hiện hành

| Bảng                                                                                         | Số cột | Vai trò                                                                                                                   |
| -------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------- |
| [app_user](database/data-dictionary.md#app_user)                                             |     13 | Tài khoản nội bộ, mã nhân viên, trạng thái và thông tin xác thực.                                                         |
| [attendance_record](database/data-dictionary.md#attendance_record)                           |     20 | Giờ chấm công gốc và kết quả duyệt với các khoảng giờ, đơn giá, chính sách và tiền snapshot.                              |
| [business_audit_event](database/data-dictionary.md#business_audit_event)                     |     10 | Dấu truy vết nghiệp vụ ngoại lệ/quản trị, ai làm và vì sao.                                                               |
| [cart_item](database/data-dictionary.md#cart_item)                                           |     12 | Dòng giỏ chưa gửi, thuộc một người tham gia; giá ở đây là giá xem trước.                                                  |
| [dining_area](database/data-dictionary.md#dining_area)                                       |      8 | Khu vực bố trí bàn.                                                                                                       |
| [dining_table](database/data-dictionary.md#dining_table)                                     |     11 | Bàn vật lý; trạng thái sẵn sàng, có khách, chờ dọn.                                                                       |
| [discount_program](database/data-dictionary.md#discount_program)                             |     26 | Chương trình giảm tiền thực: điều kiện, phạm vi, lịch, mã, số lượt và phiên bản.                                          |
| [employee_pay_rate](database/data-dictionary.md#employee_pay_rate)                           |      8 | Đơn giá lương giờ có ngày hiệu lực.                                                                                       |
| [financial_charge](database/data-dictionary.md#financial_charge)                             |     13 | Giá món gốc bất biến, phần giảm và VAT snapshot; tiền thực phải trả = amount − discount_amount.                           |
| [goods_receipt](database/data-dictionary.md#goods_receipt)                                   |     13 | Phiếu nhập kho nháp/đã duyệt/đã hủy; chỉ duyệt mới tăng tồn.                                                              |
| [goods_receipt_item](database/data-dictionary.md#goods_receipt_item)                         |     11 | Dòng nguyên liệu của phiếu nhập.                                                                                          |
| [idempotency_record](database/data-dictionary.md#idempotency_record)                         |     15 | Khóa và snapshot kết quả chống tạo order/payment intent trùng.                                                            |
| [ingredient](database/data-dictionary.md#ingredient)                                         |     10 | Nguyên liệu được quản lý trong kho của nhà hàng.                                                                          |
| [inventory_balance](database/data-dictionary.md#inventory_balance)                           |     10 | Số dư một nguyên liệu tại một vị trí: tồn, giữ, khả dụng và giá vốn.                                                      |
| [inventory_movement](database/data-dictionary.md#inventory_movement)                         |     15 | Lịch sử tăng/giảm kho do nhập, chế biến, kiểm kê hoặc xuất hủy.                                                           |
| [inventory_reservation](database/data-dictionary.md#inventory_reservation)                   |     10 | Lượng nguyên liệu giữ cho dòng món trước chế biến.                                                                        |
| [menu_category](database/data-dictionary.md#menu_category)                                   |      9 | Nhóm món trên menu.                                                                                                       |
| [menu_promotion](database/data-dictionary.md#menu_promotion)                                 |     17 | Ảnh giới thiệu trên thực đơn khách do quản trị quản lý.                                                                   |
| [operational_alert](database/data-dictionary.md#operational_alert)                           |     14 | Cảnh báo vận hành cần theo dõi, như thiếu tiền hoặc cần hoàn.                                                             |
| [order_batch](database/data-dictionary.md#order_batch)                                       |     16 | Một lượt gọi; tổng tiền gốc và quyết định rủi ro được chụp khi tạo.                                                       |
| [order_item](database/data-dictionary.md#order_item)                                         |     26 | Món/combo đã gọi; snapshot tên, giá, thành phần và VAT tại thời điểm gửi.                                                 |
| [order_item_ingredient_snapshot](database/data-dictionary.md#order_item_ingredient_snapshot) |      9 | Định lượng và chi phí nguyên liệu chụp theo dòng món.                                                                     |
| [order_review](database/data-dictionary.md#order_review)                                     |     11 | Quyết định duyệt/từ chối lượt gọi cần kiểm tra.                                                                           |
| [order_risk_assessment](database/data-dictionary.md#order_risk_assessment)                   |     10 | Kết quả bộ quy tắc rủi ro cùng metric, lý do và cấu hình tại thời điểm gửi.                                               |
| [order_status_history](database/data-dictionary.md#order_status_history)                     |     11 | Lịch sử chuyển trạng thái lượt gọi/dòng món và tác nhân.                                                                  |
| [outbox_event](database/data-dictionary.md#outbox_event)                                     |     13 | Sự kiện nghiệp vụ lưu cùng transaction, được bảo trì phát sau.                                                            |
| [outstanding_balance_case](database/data-dictionary.md#outstanding_balance_case)             |     14 | Hồ sơ thiếu tiền để thu hồi hoặc quản trị ghi nhận không thu được.                                                        |
| [payos_payment_request](database/data-dictionary.md#payos_payment_request)                   |     24 | QR/link payOS và trạng thái đối soát của khoản thu; không lưu khóa.                                                       |
| [payment_allocation](database/data-dictionary.md#payment_allocation)                         |      7 | Phân bổ tiền của giao dịch vào khoản phải thu, theo dõi phần đã đảo.                                                      |
| [payment_intent](database/data-dictionary.md#payment_intent)                                 |     17 | Yêu cầu thanh toán; API hiện tạo CASH hoặc BANK_TRANSFER.                                                                 |
| [payment_transaction](database/data-dictionary.md#payment_transaction)                       |     14 | Ghi nhận tiền đã nhận; không đồng nghĩa một yêu cầu chờ.                                                                  |
| [payment_webhook_event](database/data-dictionary.md#payment_webhook_event)                   |     13 | Thông báo từ connector thanh toán; phần nền, chưa phải tích hợp trực tiếp một cổng cụ thể.                                |
| [payroll_line](database/data-dictionary.md#payroll_line)                                     |     14 | Dòng công, thưởng hoặc khấu trừ; dòng công giữ nguyên căn cứ và các khoản tiền đã duyệt.                                  |
| [payroll_payment](database/data-dictionary.md#payroll_payment)                               |      7 | Dấu ghi nhận đã chi tiền lương và tham chiếu.                                                                             |
| [payroll_run](database/data-dictionary.md#payroll_run)                                       |     13 | Kỳ lương DRAFT/FINALIZED/PAID, khoảng ngày kết thúc không bao gồm.                                                        |
| [payroll_slip](database/data-dictionary.md#payroll_slip)                                     |      7 | Phiếu lương của một nhân viên trong kỳ, giữ tên/mã đăng nhập snapshot.                                                    |
| [permission](database/data-dictionary.md#permission)                                         |      7 | Các quyền chức năng backend kiểm tra.                                                                                     |
| [product](database/data-dictionary.md#product)                                               |     18 | Danh mục món/combo: giá gồm VAT, ảnh, kho và phân loại VAT cho món mới.                                                   |
| [product_combo_item](database/data-dictionary.md#product_combo_item)                         |      6 | Món thành phần và số phần trong một combo cố định.                                                                        |
| [promotion_request](database/data-dictionary.md#promotion_request)                           |      8 | Khóa request và kết quả chống ghi nhận lựa chọn/gỡ ưu đãi trùng.                                                          |
| [recipe_bom](database/data-dictionary.md#recipe_bom)                                         |      9 | Phiên bản công thức định lượng của một món.                                                                               |
| [recipe_bom_item](database/data-dictionary.md#recipe_bom_item)                               |      7 | Nguyên liệu và lượng/hao hụt trong công thức.                                                                             |
| [refund_case](database/data-dictionary.md#refund_case)                                       |     14 | Hồ sơ cần hoàn tiền, gắn giao dịch gốc và phiên.                                                                          |
| [refund_transaction](database/data-dictionary.md#refund_transaction)                         |     11 | Một lần ghi nhận hoàn tiền, có thể là một phần của hồ sơ.                                                                 |
| [restaurant](database/data-dictionary.md#restaurant)                                         |      8 | Nhà hàng: gốc phạm vi dữ liệu và múi giờ vận hành.                                                                        |
| [restaurant_tax_policy](database/data-dictionary.md#restaurant_tax_policy)                   |      9 | Chính sách VAT có mốc hiệu lực và phiên bản; giá đã gồm VAT, bản cũ bất biến.                                             |
| [risk_policy_config](database/data-dictionary.md#risk_policy_config)                         |     11 | Lịch sử cấu hình ngưỡng kiểm soát rủi ro của nhà hàng.                                                                    |
| [role](database/data-dictionary.md#role)                                                     |      6 | Ba vai trò hiện có ADMIN, STAFF, KITCHEN.                                                                                 |
| [role_permission](database/data-dictionary.md#role_permission)                               |      6 | Gắn quyền cho vai trò.                                                                                                    |
| [session_cart](database/data-dictionary.md#session_cart)                                     |      5 | Giỏ duy nhất của phiên, có cart_version chống thay đổi từ màn hình cũ.                                                    |
| [session_financial_account](database/data-dictionary.md#session_financial_account)           |     11 | Tổng hợp tài chính phiên, được tính lại từ charge/payment/refund/intent.                                                  |
| [session_participant](database/data-dictionary.md#session_participant)                       |     14 | Một khách trong phiên bàn; credential và trạng thái kiểm soát thao tác của khách.                                         |
| [session_promotion](database/data-dictionary.md#session_promotion)                           |     11 | Một lựa chọn/giữ lượt/ưu đãi đã dùng của phiên bàn; khóa khi thu thành công.                                              |
| [shift_assignment](database/data-dictionary.md#shift_assignment)                             |     12 | Phân công người vào ca, có kiểm tra chồng giờ.                                                                            |
| [shift_template](database/data-dictionary.md#shift_template)                                 |     15 | Mẫu ca dùng lại cho nhiều ngày; ca thực tế giữ bản sao giờ và cấu hình.                                                   |
| [stock_location](database/data-dictionary.md#stock_location)                                 |      7 | Vị trí kho hoạt động trong nhà hàng.                                                                                      |
| [support_request](database/data-dictionary.md#support_request)                               |     18 | Yêu cầu hỗ trợ của khách, người tiếp nhận/giải quyết.                                                                     |
| [support_request_handoff](database/data-dictionary.md#support_request_handoff)               |     11 | Mỗi đề nghị bàn giao hỗ trợ; chỉ đổi người phụ trách khi target đồng ý. Một yêu cầu có nhiều lịch sử, tối đa một PENDING. |
| [table_access_limit](database/data-dictionary.md#table_access_limit)                         |      4 | Bộ đếm giới hạn thao tác mã vào bàn theo khóa đã băm.                                                                     |
| [table_qr_token](database/data-dictionary.md#table_qr_token)                                 |     11 | Các phiên bản QR bàn; token hash để kiểm tra, ciphertext để quản trị lấy lại QR.                                          |
| [table_session](database/data-dictionary.md#table_session)                                   |     19 | Một lượt phục vụ tại bàn; gắn khách, đơn và tài chính; có snapshot phiếu khi đóng.                                        |
| [table_transfer_history](database/data-dictionary.md#table_transfer_history)                 |      8 | Lịch sử chuyển một phiên từ bàn này sang bàn khác.                                                                        |
| [unit_of_measure](database/data-dictionary.md#unit_of_measure)                               |      8 | Đơn vị cơ sở và nhóm đơn vị cho nguyên liệu.                                                                              |
| [user_role](database/data-dictionary.md#user_role)                                           |      7 | Lịch sử gán vai trò; revoked_at rỗng là gán còn hiệu lực.                                                                 |
| [work_shift](database/data-dictionary.md#work_shift)                                         |     17 | Ca làm thực tế theo ngày, có snapshot mẫu ca và các khoảng cho phép chấm công.                                            |
| [workforce_calendar_day](database/data-dictionary.md#workforce_calendar_day)                 |      8 | Ngày lễ của nhà hàng và ngày nghỉ hằng tuần riêng từng nhân viên.                                                         |
| [workforce_pay_policy](database/data-dictionary.md#workforce_pay_policy)                     |      9 | Chính sách tiền đêm, làm thêm, ngày nghỉ và ngày lễ có ngày hiệu lực.                                                     |

## Bảng payOS và chủ thể hệ thống bổ sung 14/10

Bảng [payos_payment_request](database/data-dictionary.md#payos_payment_request) lưu mã/order, payload tạo link bất biến, QR/link, số tiền thực nhận, lease kiểm tra và đối soát. Không lưu khóa merchant. Quan hệ 1–1 với payment_intent; một intent PAYOS có thể có nhiều payment_transaction ngân hàng thật theo tham chiếu duy nhất. Audit và kết thúc lời gọi tự động ghi SYSTEM, không giả người dùng xác nhận. Chi tiết CHECK/index/trigger đọc từ từ điển vật lý.

## Bốn bảng khuyến mãi và VAT bổ sung 13/10

`discount_program` chứa cấu hình, `session_promotion` giữ lựa chọn và lượt đã dùng, `promotion_request` bảo vệ thao tác gửi lại, `restaurant_tax_policy` giữ các phiên bản thuế theo mốc hiệu lực. Không gộp giảm tiền với `menu_promotion` (banner giới thiệu). Các khóa ngoại và trigger bảo vệ phạm vi nhà hàng/phiên, số lượt, phần giảm tối đa, khóa sau thu và VAT snapshot. Phiếu đóng cũ không thêm thuế hồi tố. [Bài 06 có ví dụ tiền](06-thanh-toan.md).

## Sáu bảng bổ sung so với hồ sơ 03/10

Đối chiếu danh sách vật lý cho thấy sáu bảng thêm là `product_combo_item`, `shift_template`, `table_access_limit`, `workforce_pay_policy`, `workforce_calendar_day` và `menu_promotion`. `table_transfer_history` đã có trước đó; phần chuyển bàn được trình bày lại bên dưới để đọc cùng cấu trúc hiện tại.

## product_combo_item

Món thành phần và số phần trong một combo cố định.

Một combo liên kết nhiều món lẻ qua bảng này. Unique trên cặp combo/món ngăn thêm cùng món thành hai dòng; quantity biểu thị số phần. Trigger kiểm tra món cha là COMBO, món con là DISH và cùng nhà hàng; kiểm tra hoàn chỉnh yêu cầu từ 2 đến 20 món thành phần. Không tạo combo lồng combo.

Bảng có 6 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột                  | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                      |
| -------------------- | ------------------------ | ----- | ---- | ----------------- | -------------------------------------------- |
| id                   | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                    |
| combo_product_id     | uuid                     | Không | FK   | —                 | Sản phẩm combo chứa món thành phần.          |
| component_product_id | uuid                     | Không | FK   | —                 | Món lẻ thuộc combo.                          |
| quantity             | integer                  | Không | —    | —                 | Số phần món lẻ trong một combo; từ 1 đến 20. |
| sort_order           | integer                  | Không | —    | 0                 | Thứ tự món trong combo; từ 0 đến 20.         |
| created_at           | timestamp with time zone | Không | —    | now()             | Thời điểm tạo do máy chủ ghi.                |

### Ràng buộc và khóa ngoại

```sql
product_combo_item_check: CHECK ((combo_product_id <> component_product_id))
product_combo_item_quantity_check: CHECK (((quantity >= 1) AND (quantity <= 20)))
product_combo_item_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 20)))
product_combo_item_combo_product_id_fkey: FOREIGN KEY (combo_product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_combo_item_component_product_id_fkey: FOREIGN KEY (component_product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_combo_item_pkey: PRIMARY KEY (id)
product_combo_items_complete: TRIGGER DEFERRABLE INITIALLY DEFERRED
product_combo_item_combo_product_id_component_product_id_key: UNIQUE (combo_product_id, component_product_id)
```

### Chỉ mục

```sql
CREATE INDEX product_combo_component_idx ON public.product_combo_item USING btree (component_product_id);
CREATE UNIQUE INDEX product_combo_item_combo_product_id_component_product_id_key ON public.product_combo_item USING btree (combo_product_id, component_product_id);
CREATE UNIQUE INDEX product_combo_item_pkey ON public.product_combo_item USING btree (id);
```

### Trigger

```sql
CREATE CONSTRAINT TRIGGER product_combo_items_complete AFTER INSERT OR DELETE OR UPDATE ON public.product_combo_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_product_combo_complete();
CREATE TRIGGER product_combo_member BEFORE INSERT OR UPDATE ON public.product_combo_item FOR EACH ROW EXECUTE FUNCTION check_product_combo_member();
```

## shift_template

Mẫu ca dùng lại cho nhiều ngày; ca thực tế giữ bản sao giờ và cấu hình.

Mẫu ca xác định khung giờ dùng lại cho nhiều ngày. Khi tạo work_shift, hệ thống lưu ngày, phiên bản mẫu và giờ thực tế; thay mẫu không tự đổi lịch đã tạo. CHECK yêu cầu thời lượng ca lớn hơn thời gian nghỉ và không vượt 16 giờ. Đơn giá và cách tính công hiện hành xem bài 09.

Bảng có 15 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột                  | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                                     |
| -------------------- | ------------------------ | ----- | ---- | ----------------- | ----------------------------------------------------------- |
| id                   | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                                   |
| restaurant_id        | uuid                     | Không | FK   | —                 | Nhà hàng sở hữu dữ liệu.                                    |
| code                 | text                     | Không | —    | —                 | Mã dùng để nhận biết trong nhà hàng.                        |
| name                 | text                     | Không | —    | —                 | Tên hiển thị.                                               |
| start_time           | time without time zone   | Không | —    | —                 | Giờ bắt đầu lặp lại theo giờ địa phương của nhà hàng.       |
| end_time             | time without time zone   | Không | —    | —                 | Giờ kết thúc của mẫu ca.                                    |
| ends_next_day        | boolean                  | Không | —    | false             | Ca kết thúc vào ngày hôm sau khi bật.                       |
| break_minutes        | integer                  | Không | —    | 0                 | Số phút nghỉ dự kiến; 0 nghĩa là không trừ phút nghỉ.       |
| hourly_rate_override | bigint                   | Có    | —    | —                 | Đơn giá giờ tùy chọn được lưu trên mẫu ca; có thể để trống. |
| is_active            | boolean                  | Không | —    | true              | Mẫu ca còn được chọn để tạo lịch mới hay không.             |
| sort_order           | integer                  | Không | —    | 0                 | Thứ tự hiển thị.                                            |
| version              | integer                  | Không | —    | 1                 | Phiên bản dùng để phát hiện cập nhật từ màn hình đã cũ.     |
| created_by           | uuid                     | Không | FK   | —                 | Tài khoản tạo bản ghi.                                      |
| created_at           | timestamp with time zone | Không | —    | now()             | Thời điểm tạo do máy chủ ghi.                               |
| updated_at           | timestamp with time zone | Không | —    | now()             | Thời điểm cập nhật.                                         |

### Ràng buộc và khóa ngoại

```sql
shift_template_break_minutes_check: CHECK (((break_minutes >= 0) AND (break_minutes <= 240)))
shift_template_check: CHECK ((((end_time - start_time) +
CASE
    WHEN ends_next_day THEN '24:00:00'::interval
    ELSE '00:00:00'::interval
END) > ((break_minutes)::double precision * '00:01:00'::interval)))
shift_template_check1: CHECK ((((end_time - start_time) +
CASE
    WHEN ends_next_day THEN '24:00:00'::interval
    ELSE '00:00:00'::interval
END) <= '16:00:00'::interval))
shift_template_code_check: CHECK (((length(btrim(code)) >= 1) AND (length(btrim(code)) <= 64)))
shift_template_hourly_rate_override_check: CHECK (((hourly_rate_override >= 1000) AND (hourly_rate_override <= 10000000)))
shift_template_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
shift_template_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 10000)))
shift_template_version_check: CHECK ((version > 0))
shift_template_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_template_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
shift_template_pkey: PRIMARY KEY (id)
shift_template_id_restaurant_id_key: UNIQUE (id, restaurant_id)
shift_template_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục

```sql
CREATE INDEX shift_template_active_order ON public.shift_template USING btree (restaurant_id, is_active, sort_order, name);
CREATE UNIQUE INDEX shift_template_id_restaurant_id_key ON public.shift_template USING btree (id, restaurant_id);
CREATE UNIQUE INDEX shift_template_pkey ON public.shift_template USING btree (id);
CREATE UNIQUE INDEX shift_template_restaurant_id_code_key ON public.shift_template USING btree (restaurant_id, code);
```

## table_access_limit

Bộ đếm giới hạn thao tác mã vào bàn theo khóa đã băm.

API dùng bộ đếm lưu trong database để các tiến trình cùng áp dụng giới hạn khi nhập mã hoặc gửi yêu cầu. bucket_hash không phải mã 4 số của bàn. Mã tham gia nằm trong table_session.access_code_ciphertext. Bảng bộ đếm có PK trên bucket_hash, CHECK attempts không âm và index theo started_at; metadata không có FK từ restaurant_id.

Bảng có 4 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa | Default | Ý nghĩa                                                             |
| ------------- | --------------------------- | ----- | ---- | ------- | ------------------------------------------------------------------- |
| bucket_hash   | text                        | Không | PK   | —       | Khóa đã băm của nhà hàng, loại thao tác và đối tượng được giới hạn. |
| restaurant_id | uuid                        | Không | —    | —       | Mã nhà hàng trong bộ đếm; cột này không có FK ở bảng này.           |
| attempts      | integer                     | Không | —    | 0       | Số lần ghi nhận trong cửa sổ giới hạn; không âm.                    |
| started_at    | timestamp(6) with time zone | Không | —    | now()   | Mốc bắt đầu cửa sổ đếm.                                             |

### Ràng buộc và khóa ngoại

```sql
table_access_limit_attempts_check: CHECK ((attempts >= 0))
table_access_limit_pkey: PRIMARY KEY (bucket_hash)
```

### Chỉ mục

```sql
CREATE INDEX table_access_limit_expiry ON public.table_access_limit USING btree (started_at);
CREATE UNIQUE INDEX table_access_limit_pkey ON public.table_access_limit USING btree (bucket_hash);
```

## workforce_pay_policy

Chính sách tiền đêm, làm thêm, ngày nghỉ và ngày lễ có ngày hiệu lực.

Mỗi nhà hàng có các chính sách theo ngày hiệu lực; một ngày chỉ có một chính sách. Tỷ lệ phần trăm có CHECK giới hạn. Trigger chặn sửa/xóa chính sách đã tạo, nên thay đổi được ghi bằng phiên bản có ngày áp dụng mới. Công đã duyệt giữ chính sách và kết quả tính trong snapshot.

Bảng có 9 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột                      | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                   |
| ------------------------ | ------------------------ | ----- | ---- | ----------------- | ----------------------------------------- |
| id                       | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                 |
| restaurant_id            | uuid                     | Không | FK   | —                 | Nhà hàng sở hữu dữ liệu.                  |
| effective_from           | date                     | Không | —    | —                 | Ngày bắt đầu áp dụng chính sách.          |
| night_premium_percent    | integer                  | Không | —    | 30                | Tỷ lệ cộng thêm khi làm đêm.              |
| overtime_weekday_percent | integer                  | Không | —    | 150               | Tỷ lệ tiền làm thêm ngày thường.          |
| rest_day_percent         | integer                  | Không | —    | 200               | Tỷ lệ tiền làm trong ngày nghỉ hằng tuần. |
| holiday_percent          | integer                  | Không | —    | 300               | Tỷ lệ tiền làm trong ngày lễ.             |
| created_by               | uuid                     | Không | FK   | —                 | Tài khoản tạo bản ghi.                    |
| created_at               | timestamp with time zone | Không | —    | now()             | Thời điểm tạo do máy chủ ghi.             |

### Ràng buộc và khóa ngoại

```sql
workforce_pay_policy_holiday_percent_check: CHECK (((holiday_percent >= 300) AND (holiday_percent <= 1000)))
workforce_pay_policy_night_premium_percent_check: CHECK (((night_premium_percent >= 30) AND (night_premium_percent <= 300)))
workforce_pay_policy_overtime_weekday_percent_check: CHECK (((overtime_weekday_percent >= 150) AND (overtime_weekday_percent <= 1000)))
workforce_pay_policy_rest_day_percent_check: CHECK (((rest_day_percent >= 200) AND (rest_day_percent <= 1000)))
workforce_pay_policy_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_pay_policy_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
workforce_pay_policy_pkey: PRIMARY KEY (id)
workforce_pay_policy_restaurant_id_effective_from_key: UNIQUE (restaurant_id, effective_from)
```

### Chỉ mục

```sql
CREATE UNIQUE INDEX workforce_pay_policy_pkey ON public.workforce_pay_policy USING btree (id);
CREATE UNIQUE INDEX workforce_pay_policy_restaurant_id_effective_from_key ON public.workforce_pay_policy USING btree (restaurant_id, effective_from);
```

### Trigger

```sql
CREATE TRIGGER workforce_policy_immutable BEFORE DELETE OR UPDATE ON public.workforce_pay_policy FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
```

## workforce_calendar_day

Ngày lễ của nhà hàng và ngày nghỉ hằng tuần riêng từng nhân viên.

Ngày lễ dùng chung nhà hàng nên user_id rỗng; ngày nghỉ hằng tuần phải chỉ rõ nhân viên. Hai partial unique ngăn trùng ngày lễ và trùng ngày nghỉ của cùng người. Không mặc định Chủ nhật là ngày nghỉ. Trigger chặn cập nhật trực tiếp bản đã tạo; API còn kiểm tra ảnh hưởng tới công đã duyệt trước thao tác quản lý lịch.

Bảng có 8 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                                    |
| ------------- | ------------------------ | ----- | ---- | ----------------- | ---------------------------------------------------------- |
| id            | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                                  |
| restaurant_id | uuid                     | Không | FK   | —                 | Nhà hàng sở hữu dữ liệu.                                   |
| date          | date                     | Không | —    | —                 | Ngày được nhà hàng xác nhận trong lịch.                    |
| kind          | text                     | Không | —    | —                 | HOLIDAY cho ngày lễ; WEEKLY_REST cho ngày nghỉ hằng tuần.  |
| user_id       | uuid                     | Có    | FK   | —                 | Nhân viên được nghỉ hằng tuần; để trống với ngày lễ chung. |
| name          | text                     | Không | —    | —                 | Tên ngày lễ hoặc ghi chú ngày nghỉ, tối đa 120 ký tự.      |
| created_by    | uuid                     | Không | FK   | —                 | Tài khoản tạo bản ghi.                                     |
| created_at    | timestamp with time zone | Không | —    | now()             | Thời điểm tạo do máy chủ ghi.                              |

### Ràng buộc và khóa ngoại

```sql
workforce_calendar_day_check: CHECK ((((kind = 'HOLIDAY'::text) AND (user_id IS NULL)) OR ((kind = 'WEEKLY_REST'::text) AND (user_id IS NOT NULL))))
workforce_calendar_day_kind_check: CHECK ((kind = ANY (ARRAY['HOLIDAY'::text, 'WEEKLY_REST'::text])))
workforce_calendar_day_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
workforce_calendar_day_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_calendar_day_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
workforce_calendar_day_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
workforce_calendar_day_pkey: PRIMARY KEY (id)
```

### Chỉ mục

```sql
CREATE UNIQUE INDEX workforce_calendar_day_pkey ON public.workforce_calendar_day USING btree (id);
CREATE UNIQUE INDEX workforce_calendar_holiday_unique ON public.workforce_calendar_day USING btree (restaurant_id, date) WHERE (kind = 'HOLIDAY'::text);
CREATE INDEX workforce_calendar_lookup ON public.workforce_calendar_day USING btree (restaurant_id, date, user_id);
CREATE UNIQUE INDEX workforce_calendar_rest_unique ON public.workforce_calendar_day USING btree (restaurant_id, date, user_id) WHERE (kind = 'WEEKLY_REST'::text);
```

### Trigger

```sql
CREATE TRIGGER workforce_calendar_fixed BEFORE UPDATE ON public.workforce_calendar_day FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
```

## menu_promotion

Ảnh giới thiệu trên thực đơn khách do quản trị quản lý.

Đây là dữ liệu quản lý tại ADMIN → Thực đơn → Ảnh giới thiệu, không phải danh sách banner cố định trong frontend. Mỗi món có tối đa một bản ghi ảnh giới thiệu trong nhà hàng. Máy chủ kiểm tra file ảnh tồn tại, định dạng và kích thước; ảnh dùng cùng kho với product.image_url. expected_price và expected_components giúp ẩn nội dung đã sai giá hoặc phần ăn cho tới khi quản trị cập nhật. Xóa trên giao diện đánh dấu is_deleted, không xóa món hoặc file ảnh.

Bảng có 17 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột                 | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                                         |
| ------------------- | ------------------------ | ----- | ---- | ----------------- | --------------------------------------------------------------- |
| id                  | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                                       |
| restaurant_id       | uuid                     | Không | FK   | —                 | Nhà hàng sở hữu dữ liệu.                                        |
| product_id          | uuid                     | Không | FK   | —                 | Món hoặc combo được giới thiệu.                                 |
| image_url           | text                     | Không | —    | —                 | URL ảnh trong kho chung /api/menu-images/UUID.ext.              |
| image_width         | integer                  | Không | —    | —                 | Chiều rộng ảnh được máy chủ đọc từ file.                        |
| image_height        | integer                  | Không | —    | —                 | Chiều cao ảnh được máy chủ đọc từ file.                         |
| presentation        | text                     | Không | —    | 'PHOTO'::text     | PHOTO là ảnh món; POSTER là ảnh có sẵn chữ.                     |
| eyebrow             | text                     | Có    | —    | —                 | Dòng giới thiệu ngắn, tối đa 80 ký tự.                          |
| image_note          | text                     | Có    | —    | —                 | Ghi chú dưới ảnh, tối đa 300 ký tự.                             |
| expected_price      | bigint                   | Có    | —    | —                 | Giá in trên ảnh để đối chiếu với giá hiện tại; có thể để trống. |
| expected_components | jsonb                    | Không | —    | '[]'::jsonb       | Thành phần combo chụp khi xác nhận ảnh.                         |
| sort_order          | integer                  | Không | —    | 0                 | Thứ tự hiển thị.                                                |
| is_active           | boolean                  | Không | —    | true              | Ảnh được bật hiển thị với khách hay không.                      |
| is_deleted          | boolean                  | Không | —    | false             | Dấu đã xóa để chạy lại khởi tạo không tự phục hồi ảnh.          |
| version             | integer                  | Không | —    | 1                 | Phiên bản dùng để phát hiện cập nhật từ màn hình đã cũ.         |
| created_at          | timestamp with time zone | Không | —    | now()             | Thời điểm tạo do máy chủ ghi.                                   |
| updated_at          | timestamp with time zone | Không | —    | now()             | Thời điểm cập nhật.                                             |

### Ràng buộc và khóa ngoại

```sql
menu_promotion_expected_components_check: CHECK (((jsonb_typeof(expected_components) = 'array'::text) AND (jsonb_array_length(expected_components) <= 20)))
menu_promotion_expected_price_check: CHECK ((expected_price >= 0))
menu_promotion_eyebrow_check: CHECK ((char_length(eyebrow) <= 80))
menu_promotion_image_height_check: CHECK (((image_height >= 1) AND (image_height <= 20000)))
menu_promotion_image_note_check: CHECK ((char_length(image_note) <= 300))
menu_promotion_image_url_check: CHECK ((image_url ~ '^/api/menu-images/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$'::text))
menu_promotion_image_width_check: CHECK (((image_width >= 1) AND (image_width <= 20000)))
menu_promotion_presentation_check: CHECK ((presentation = ANY (ARRAY['PHOTO'::text, 'POSTER'::text])))
menu_promotion_sort_order_check: CHECK (((sort_order >= 0) AND (sort_order <= 1000)))
menu_promotion_version_check: CHECK ((version > 0))
menu_promotion_product_tenant_fk: FOREIGN KEY (product_id, restaurant_id) REFERENCES product(id, restaurant_id) ON UPDATE RESTRICT ON DELETE CASCADE
menu_promotion_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
menu_promotion_pkey: PRIMARY KEY (id)
menu_promotion_restaurant_id_product_id_key: UNIQUE (restaurant_id, product_id)
```

### Chỉ mục

```sql
CREATE INDEX menu_promotion_active_order ON public.menu_promotion USING btree (restaurant_id, is_active, sort_order, id);
CREATE UNIQUE INDEX menu_promotion_pkey ON public.menu_promotion USING btree (id);
CREATE UNIQUE INDEX menu_promotion_restaurant_id_product_id_key ON public.menu_promotion USING btree (restaurant_id, product_id);
```

### Trigger

```sql
CREATE TRIGGER menu_promotion_updated BEFORE UPDATE ON public.menu_promotion FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## Chuyển bàn: table_transfer_history hiện hành

Lịch sử chuyển một phiên từ bàn này sang bàn khác.

Bảng này đã có trong bản 03/10; phần dưới đối chiếu lại metadata hiện hành. Mỗi lần chuyển giữ nguyên session_id, người tham gia, giỏ, món và tiền; chỉ ghi bàn nguồn/đích, nhân viên, lý do và thời điểm. Các FK, CHECK và trigger bên dưới bảo vệ phạm vi dữ liệu và lịch sử chuyển.

Bảng có 8 cột. Kiểu, NULL/default và ràng buộc dưới đây lấy trực tiếp từ metadata ngày 13/10/2026.

| Cột            | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa                                     |
| -------------- | ------------------------ | ----- | ---- | ----------------- | ------------------------------------------- |
| id             | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh của bản ghi.                   |
| restaurant_id  | uuid                     | Không | FK   | —                 | Nhà hàng sở hữu dữ liệu.                    |
| session_id     | uuid                     | Không | FK   | —                 | Phiên bàn được chuyển; không tạo phiên mới. |
| from_table_id  | uuid                     | Không | FK   | —                 | Bàn trước khi chuyển.                       |
| to_table_id    | uuid                     | Không | FK   | —                 | Bàn sau khi chuyển.                         |
| transferred_by | uuid                     | Không | FK   | —                 | Nhân viên thực hiện chuyển.                 |
| reason         | text                     | Không | —    | —                 | Lý do chuyển bàn.                           |
| transferred_at | timestamp with time zone | Không | —    | now()             | Thời điểm chuyển thành công.                |

### Ràng buộc và khóa ngoại

```sql
table_transfer_history_check: CHECK ((from_table_id <> to_table_id))
table_transfer_history_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
table_transfer_history_from_table_id_restaurant_id_fkey: FOREIGN KEY (from_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
table_transfer_history_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id)
table_transfer_history_to_table_id_restaurant_id_fkey: FOREIGN KEY (to_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_transferred_by_restaurant_id_fkey: FOREIGN KEY (transferred_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
table_transfer_history_pkey: PRIMARY KEY (id)
```

### Chỉ mục

```sql
CREATE UNIQUE INDEX table_transfer_history_pkey ON public.table_transfer_history USING btree (id);
CREATE INDEX table_transfer_history_session_idx ON public.table_transfer_history USING btree (session_id, transferred_at);
```

### Trigger

```sql
CREATE TRIGGER workforce_immutable BEFORE DELETE OR UPDATE ON public.table_transfer_history FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
```

## Snapshot thành phần combo nằm trong order_item

Không có bảng riêng tên `order_item_component_snapshot` trong cấu trúc đã kiểm tra. Mỗi dòng món lưu loại sản phẩm trong `product_kind_snapshot`; combo lưu mảng thành phần trong `combo_components_snapshot`. Các phần tử chụp `product_id`, `code`, `name` và `quantity` tại lúc gửi món. Giá phải trả của combo nằm trong `unit_price_snapshot` của dòng món, không cộng lại giá món lẻ khi xem đơn cũ.

| Cột của order_item        | Kiểu  | NULL? | Default      | Vai trò                                   |
| ------------------------- | ----- | ----- | ------------ | ----------------------------------------- |
| product_kind_snapshot     | text  | Không | 'DISH'::text | DISH hoặc COMBO tại thời điểm gửi.        |
| combo_components_snapshot | jsonb | Không | '[]'::jsonb  | Mảng thành phần cố định của combo đã gọi. |

```sql
order_combo_snapshot_matches_kind: CHECK ((((product_kind_snapshot = 'DISH'::text) AND (jsonb_array_length(combo_components_snapshot) = 0)) OR ((product_kind_snapshot = 'COMBO'::text) AND ((jsonb_array_length(combo_components_snapshot) >= 2) AND (jsonb_array_length(combo_components_snapshot) <= 20)))))
order_item_combo_components_snapshot_check: CHECK ((jsonb_typeof(combo_components_snapshot) = 'array'::text))
order_item_product_kind_snapshot_check: CHECK ((product_kind_snapshot = ANY (ARRAY['DISH'::text, 'COMBO'::text])))
```

Đổi cấu hình combo trong `product_combo_item` không viết lại mảng đã chụp trên đơn. `order_item_ingredient_snapshot` là bảng riêng cho định lượng và giá vốn nguyên liệu, không phải danh sách món thành phần của combo.

## Phạm vi đối chiếu 13/10/2026

Đã đọc metadata trên bản CSDL đã xác minh, đối chiếu danh sách bảng với Prisma/migration và xem mã xử lý combo, ca làm, mã vào bàn, banner. Đã sinh lại từ điển vật lý, DOT/SVG và ERD tương tác từ cùng cấu trúc. Số cột/FK là số đếm cấu trúc tại lần kiểm tra này; không chứng minh mọi luồng giao diện đã được nghiệm thu tại nhà hàng. Kết quả kiểm thử ứng dụng xem [bài 15](15-doi-chieu.md).

## Phụ lục lịch sử — metadata ngày 03/10/2026

**Toàn bộ phần 56 bảng bên dưới thuộc lần đọc ngày 03/10/2026.** Số cột, ràng buộc, trigger và liên kết mã nguồn trong phần này là ảnh chụp của phiên bản đó. Để tra cấu trúc đang dùng, mở từ điển 62 bảng ở đầu bài; không dùng phần lịch sử thay cho metadata hiện hành.

Nguồn: metadata PostgreSQL đọc ngày 03/10/2026 từ database qr_restaurant_ordering. Đủ 56 bảng, 613 cột, 138 khóa ngoại. Không chứa bản ghi nghiệp vụ hoặc bí mật.

Mô tả nghiệp vụ được biên soạn lại theo code. DDL, kiểu, null/default, constraint, index và trigger là kết quả đọc metadata. Cột tồn tại không tự chứng minh giao diện đã có chức năng tương ứng.

## Đọc sơ đồ và quan hệ

Mỗi FK đi từ bảng con đến cha; sơ đồ vẽ cha → con. Mỗi con có một cha khi tất cả cột FK bắt buộc, có thể không có cha khi nullable. Mỗi cha có 0..1 con nếu khóa FK được bảo vệ bằng unique toàn phần thích hợp, nếu không là 0..N. Partial unique không làm lịch sử thành 1–1. Constraint phức tạp và FK ghép cần đọc nguyên DDL.

[Ảnh SVG lịch sử 03/10: 56 bảng](assets/erd-56.svg) - [DOT lịch sử 03/10](assets/erd-56.dot)

## Mục lục bảng

- [app_user](#app_user) — Tài khoản nội bộ, mã nhân viên, trạng thái và thông tin xác thực.
- [attendance_record](#attendance_record) — Dấu giờ vào/ra gốc và kết quả duyệt công cùng đơn giá/tiền snapshot.
- [business_audit_event](#business_audit_event) — Dấu truy vết nghiệp vụ ngoại lệ/quản trị, ai làm và vì sao.
- [cart_item](#cart_item) — Dòng giỏ chưa gửi, thuộc một người tham gia; giá ở đây là giá xem trước.
- [dining_area](#dining_area) — Khu vực bố trí bàn.
- [dining_table](#dining_table) — Bàn vật lý; trạng thái sẵn sàng, có khách, chờ dọn.
- [employee_pay_rate](#employee_pay_rate) — Đơn giá lương giờ có ngày hiệu lực.
- [financial_charge](#financial_charge) — Khoản phải thu gắn phiên và thường gắn dòng món; đảo bằng trạng thái REVERSED.
- [goods_receipt](#goods_receipt) — Phiếu nhập kho nháp/đã duyệt/đã hủy; chỉ duyệt mới tăng tồn.
- [goods_receipt_item](#goods_receipt_item) — Dòng nguyên liệu của phiếu nhập.
- [idempotency_record](#idempotency_record) — Khóa và snapshot kết quả chống tạo order/payment intent trùng.
- [ingredient](#ingredient) — Nguyên liệu được quản lý trong kho của nhà hàng.
- [inventory_balance](#inventory_balance) — Số dư một nguyên liệu tại một vị trí: tồn, giữ, khả dụng và giá vốn.
- [inventory_movement](#inventory_movement) — Lịch sử tăng/giảm kho do nhập, chế biến, kiểm kê hoặc xuất hủy.
- [inventory_reservation](#inventory_reservation) — Lượng nguyên liệu giữ cho dòng món trước chế biến.
- [menu_category](#menu_category) — Nhóm món trên menu.
- [operational_alert](#operational_alert) — Cảnh báo vận hành cần theo dõi, như thiếu tiền hoặc cần hoàn.
- [order_batch](#order_batch) — Một lượt gọi; tổng tiền gốc và quyết định rủi ro được chụp khi tạo.
- [order_item](#order_item) — Một dòng món trong lượt gọi, tên/giá và vòng đời xử lý riêng.
- [order_item_ingredient_snapshot](#order_item_ingredient_snapshot) — Định lượng và chi phí nguyên liệu chụp theo dòng món.
- [order_review](#order_review) — Quyết định duyệt/từ chối lượt gọi cần kiểm tra.
- [order_risk_assessment](#order_risk_assessment) — Kết quả bộ quy tắc rủi ro cùng metric, lý do và cấu hình tại thời điểm gửi.
- [order_status_history](#order_status_history) — Lịch sử chuyển trạng thái lượt gọi/dòng món và tác nhân.
- [outbox_event](#outbox_event) — Sự kiện nghiệp vụ lưu cùng transaction, được bảo trì phát sau.
- [outstanding_balance_case](#outstanding_balance_case) — Hồ sơ thiếu tiền để thu hồi hoặc quản trị ghi nhận không thu được.
- [payment_allocation](#payment_allocation) — Phân bổ tiền của giao dịch vào khoản phải thu, theo dõi phần đã đảo.
- [payment_intent](#payment_intent) — Yêu cầu thanh toán; API hiện tạo CASH hoặc BANK_TRANSFER.
- [payment_transaction](#payment_transaction) — Ghi nhận tiền đã nhận; không đồng nghĩa một yêu cầu chờ.
- [payment_webhook_event](#payment_webhook_event) — Thông báo từ connector thanh toán; phần nền, chưa phải tích hợp trực tiếp một cổng cụ thể.
- [payroll_line](#payroll_line) — Dòng công, thưởng hoặc khấu trừ trên phiếu lương.
- [payroll_payment](#payroll_payment) — Dấu ghi nhận đã chi tiền lương và tham chiếu.
- [payroll_run](#payroll_run) — Kỳ lương DRAFT/FINALIZED/PAID, khoảng ngày kết thúc không bao gồm.
- [payroll_slip](#payroll_slip) — Phiếu lương của một nhân viên trong kỳ, giữ tên/mã đăng nhập snapshot.
- [permission](#permission) — Các quyền chức năng backend kiểm tra.
- [product](#product) — Món bán hiện hành: giá, danh mục, trạng thái, ảnh, quản lý kho và món tặng.
- [recipe_bom](#recipe_bom) — Phiên bản công thức định lượng của một món.
- [recipe_bom_item](#recipe_bom_item) — Nguyên liệu và lượng/hao hụt trong công thức.
- [refund_case](#refund_case) — Hồ sơ cần hoàn tiền, gắn giao dịch gốc và phiên.
- [refund_transaction](#refund_transaction) — Một lần ghi nhận hoàn tiền, có thể là một phần của hồ sơ.
- [restaurant](#restaurant) — Nhà hàng: gốc phạm vi dữ liệu và múi giờ vận hành.
- [risk_policy_config](#risk_policy_config) — Các phiên bản cấu hình ngưỡng; hiện chưa có override trong database được kiểm tra.
- [role](#role) — Ba vai trò hiện có ADMIN, STAFF, KITCHEN.
- [role_permission](#role_permission) — Gắn quyền cho vai trò.
- [session_cart](#session_cart) — Giỏ duy nhất của phiên, có cart_version chống thay đổi từ màn hình cũ.
- [session_financial_account](#session_financial_account) — Tổng hợp tài chính phiên, được tính lại từ charge/payment/refund/intent.
- [session_participant](#session_participant) — Một khách trong phiên bàn; credential và trạng thái kiểm soát thao tác của khách.
- [shift_assignment](#shift_assignment) — Phân công người vào ca, có kiểm tra chồng giờ.
- [stock_location](#stock_location) — Vị trí kho hoạt động trong nhà hàng.
- [support_request](#support_request) — Yêu cầu hỗ trợ của khách, người tiếp nhận/giải quyết.
- [support_request_handoff](#support_request_handoff) — Mỗi đề nghị bàn giao hỗ trợ; chỉ đổi người phụ trách khi target đồng ý. Một yêu cầu có nhiều lịch sử, tối đa một PENDING.
- [table_qr_token](#table_qr_token) — Các phiên bản QR bàn; token hash để kiểm tra, ciphertext để quản trị lấy lại QR.
- [table_session](#table_session) — Một lượt phục vụ tại bàn; gắn khách, đơn và tài chính; có snapshot phiếu khi đóng.
- [table_transfer_history](#table_transfer_history) — Lịch sử chuyển một phiên từ bàn này sang bàn khác.
- [unit_of_measure](#unit_of_measure) — Đơn vị cơ sở và nhóm đơn vị cho nguyên liệu.
- [user_role](#user_role) — Lịch sử gán vai trò; revoked_at rỗng là gán còn hiệu lực.
- [work_shift](#work_shift) — Khoảng thời gian ca và phút nghỉ.

## app_user

Tài khoản nội bộ, mã nhân viên, trạng thái và thông tin xác thực.

Có 13 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột                | Kiểu PostgreSQL          | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                   |
| ------------------ | ------------------------ | ----- | --------------- | ----------------- | ------------------------------------------------------------------ |
| id                 | uuid                     | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id      | uuid                     | Không | FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| username           | character varying(64)    | Không | —               | —                 | Tên đăng nhập chữ thường, duy nhất trong nhà hàng                  |
| password_hash      | text                     | Không | —               | —                 | Argon2id hash; không chứa mật khẩu rõ                              |
| display_name       | text                     | Không | —               | —                 | Tên hiển thị                                                       |
| status             | text                     | Không | —               | 'ACTIVE'::text    | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| last_login_at      | timestamp with time zone | Có    | —               | —                 | Lần đăng nhập thành công gần nhất                                  |
| refresh_token_hash | text                     | Có    | —               | —                 | SHA256 refresh opaque; chỉ lưu hash                                |
| refresh_expires_at | timestamp with time zone | Có    | —               | —                 | Hạn tuyệt đối của phiên đăng nhập                                  |
| auth_version       | integer                  | Không | —               | 0                 | Tăng khi đăng nhập/thu hồi phiên                                   |
| created_at         | timestamp with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at         | timestamp with time zone | Không | —               | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |
| staff_code         | text                     | Không | —               | —                 | Mã nhân viên trong nhà hàng, phân biệt với tên hiển thị.           |

### Quan hệ của app_user

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của app_user

```sql
app_user_auth_version_check: CHECK ((auth_version >= 0))
app_user_check: CHECK (((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL)))
app_user_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
app_user_username_check: CHECK (((username)::text ~ '^[a-z0-9_.-]{3,64}$'::text))
app_user_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
app_user_auth_version_not_null: NOT NULL auth_version
app_user_created_at_not_null: NOT NULL created_at
app_user_display_name_not_null: NOT NULL display_name
app_user_id_not_null: NOT NULL id
app_user_password_hash_not_null: NOT NULL password_hash
app_user_restaurant_id_not_null: NOT NULL restaurant_id
app_user_staff_code_not_null: NOT NULL staff_code
app_user_status_not_null: NOT NULL status
app_user_updated_at_not_null: NOT NULL updated_at
app_user_username_not_null: NOT NULL username
app_user_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
app_user_id_restaurant_key: UNIQUE (id, restaurant_id)
app_user_refresh_token_hash_key: UNIQUE (refresh_token_hash)
app_user_restaurant_id_username_key: UNIQUE (restaurant_id, username)
```

### Chỉ mục của app_user

```sql
CREATE UNIQUE INDEX app_user_id_restaurant_key ON public.app_user USING btree (id, restaurant_id);
CREATE UNIQUE INDEX app_user_pkey ON public.app_user USING btree (id);
CREATE UNIQUE INDEX app_user_refresh_token_hash_key ON public.app_user USING btree (refresh_token_hash);
CREATE UNIQUE INDEX app_user_restaurant_id_username_key ON public.app_user USING btree (restaurant_id, username);
CREATE UNIQUE INDEX app_user_restaurant_staff_code ON public.app_user USING btree (restaurant_id, staff_code);
```

### Trigger của app_user

```sql
CREATE TRIGGER app_user_revoke BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION revoke_changed_account();
CREATE TRIGGER app_user_updated BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.app_user DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id');
CREATE TRIGGER app_user_staff_code_default BEFORE INSERT OR UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION app_user_staff_code_default();
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## attendance_record

Dấu giờ vào/ra gốc và kết quả duyệt công cùng đơn giá/tiền snapshot.

Có 15 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột                  | Kiểu PostgreSQL          | NULL? | Khóa                                                  | Default           | Ý nghĩa hiện tại                                                   |
| -------------------- | ------------------------ | ----- | ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| id                   | uuid                     | Không | PK                                                    | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id        | uuid                     | Không | FK → app_user; FK → shift_assignment; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| assignment_id        | uuid                     | Không | FK → shift_assignment                                 | —                 | Phân công ca được chấm công.                                       |
| checked_in_at        | timestamp with time zone | Có    | —                                                     | —                 | Thời điểm vào ca gốc do máy chủ ghi.                               |
| checked_out_at       | timestamp with time zone | Có    | —                                                     | —                 | Thời điểm ra ca gốc do máy chủ ghi.                                |
| status               | text                     | Không | —                                                     | 'RECORDED'::text  | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| approved_minutes     | integer                  | Có    | —                                                     | —                 | Số phút được quản trị duyệt để tính công.                          |
| hourly_rate_snapshot | bigint                   | Có    | —                                                     | —                 | Đơn giá giờ chụp khi duyệt/tạo dòng công.                          |
| amount               | bigint                   | Có    | —                                                     | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.      |
| approved_by          | uuid                     | Có    | FK → app_user                                         | —                 | Tài khoản thực hiện duyệt.                                         |
| approved_at          | timestamp with time zone | Có    | —                                                     | —                 | Thời điểm duyệt.                                                   |
| review_note          | text                     | Có    | —                                                     | —                 | Lý do/ghi chú duyệt công.                                          |
| created_at           | timestamp with time zone | Không | —                                                     | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at           | timestamp with time zone | Không | —                                                     | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |
| outcome              | text                     | Không | —                                                     | 'WORKED'::text    | Phân loại công: WORKED, ABSENT, LEAVE, MISSED_CLOCK.               |

### Quan hệ của attendance_record

- FOREIGN KEY (approved_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (assignment_id, restaurant_id) REFERENCES shift_assignment(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..1 con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của attendance_record

```sql
attendance_outcome_allowed: CHECK ((outcome = ANY (ARRAY['WORKED'::text, 'ABSENT'::text, 'LEAVE'::text, 'MISSED_CLOCK'::text])))
attendance_outcome_minutes: CHECK (((status <> 'APPROVED'::text) OR ((outcome = ANY (ARRAY['ABSENT'::text, 'LEAVE'::text])) AND (approved_minutes = 0)) OR ((outcome = ANY (ARRAY['WORKED'::text, 'MISSED_CLOCK'::text])) AND (approved_minutes > 0))))
attendance_record_amount_check: CHECK ((amount >= 0))
attendance_record_approved_minutes_check: CHECK (((approved_minutes >= 0) AND (approved_minutes <= 960)))
attendance_record_check: CHECK (((checked_out_at IS NULL) OR ((checked_in_at IS NOT NULL) AND (checked_out_at >= checked_in_at))))
attendance_record_check1: CHECK ((((status = 'RECORDED'::text) AND (approved_minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount IS NULL) AND (approved_by IS NULL) AND (approved_at IS NULL)) OR ((status = 'APPROVED'::text) AND (approved_minutes IS NOT NULL) AND (hourly_rate_snapshot IS NOT NULL) AND (amount IS NOT NULL) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL) AND (length(btrim(COALESCE(review_note, ''::text))) > 0))))
attendance_record_check2: CHECK ((amount = ((((approved_minutes)::bigint * hourly_rate_snapshot) + 30) / 60)))
attendance_record_hourly_rate_snapshot_check: CHECK (((hourly_rate_snapshot >= 1000) AND (hourly_rate_snapshot <= 10000000)))
attendance_record_status_check: CHECK ((status = ANY (ARRAY['RECORDED'::text, 'APPROVED'::text])))
attendance_record_approved_by_restaurant_id_fkey: FOREIGN KEY (approved_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
attendance_record_assignment_id_restaurant_id_fkey: FOREIGN KEY (assignment_id, restaurant_id) REFERENCES shift_assignment(id, restaurant_id)
attendance_record_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
attendance_record_assignment_id_not_null: NOT NULL assignment_id
attendance_record_created_at_not_null: NOT NULL created_at
attendance_record_id_not_null: NOT NULL id
attendance_record_outcome_not_null: NOT NULL outcome
attendance_record_restaurant_id_not_null: NOT NULL restaurant_id
attendance_record_status_not_null: NOT NULL status
attendance_record_updated_at_not_null: NOT NULL updated_at
attendance_record_pkey: PRIMARY KEY (id)
attendance_record_assignment_id_key: UNIQUE (assignment_id)
attendance_record_assignment_id_restaurant_id_key: UNIQUE (assignment_id, restaurant_id)
```

### Chỉ mục của attendance_record

```sql
CREATE UNIQUE INDEX attendance_record_assignment_id_key ON public.attendance_record USING btree (assignment_id);
CREATE UNIQUE INDEX attendance_record_assignment_id_restaurant_id_key ON public.attendance_record USING btree (assignment_id, restaurant_id);
CREATE UNIQUE INDEX attendance_record_pkey ON public.attendance_record USING btree (id);
```

### Trigger của attendance_record

```sql
CREATE TRIGGER workforce_attendance_guard BEFORE DELETE OR UPDATE ON public.attendance_record FOR EACH ROW EXECUTE FUNCTION workforce_attendance_guard();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.attendance_record FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## business_audit_event

Dấu truy vết nghiệp vụ ngoại lệ/quản trị, ai làm và vì sao.

Có 9 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/payments/refund-context.service.ts](../apps/api/src/modules/payments/refund-context.service.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa                           | Default           | Ý nghĩa hiện tại                                                     |
| ------------- | ------------------------ | ----- | ------------------------------ | ----------------- | -------------------------------------------------------------------- |
| id            | uuid                     | Không | PK                             | gen_random_uuid() | Mã định danh chính của bản ghi.                                      |
| restaurant_id | uuid                     | Không | FK → app_user; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                     |
| actor_id      | uuid                     | Không | FK → app_user                  | —                 | Tài khoản gây ra thao tác audit.                                     |
| action        | text                     | Không | —                              | —                 | Loại thao tác được ghi nhận.                                         |
| resource_type | text                     | Không | —                              | —                 | Loại đối tượng được tham chiếu; không tự suy ra là FK.               |
| resource_id   | uuid                     | Không | —                              | —                 | Mã đối tượng audit theo resource_type; kiểm tra FK thực tế bên dưới. |
| reason        | text                     | Không | —                              | —                 | Lý do nghiệp vụ của thao tác.                                        |
| details       | jsonb                    | Không | —                              | '{}'::jsonb       | Chi tiết JSON phục vụ truy vết; cấu trúc tùy action.                 |
| created_at    | timestamp with time zone | Không | —                              | now()             | Thời điểm tạo bản ghi.                                               |

### Quan hệ của business_audit_event

- FOREIGN KEY (actor_id, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của business_audit_event

```sql
business_audit_event_reason_check: CHECK ((length(btrim(reason)) > 0))
business_audit_event_actor_id_restaurant_id_fkey: FOREIGN KEY (actor_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
business_audit_event_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
business_audit_event_action_not_null: NOT NULL action
business_audit_event_actor_id_not_null: NOT NULL actor_id
business_audit_event_created_at_not_null: NOT NULL created_at
business_audit_event_details_not_null: NOT NULL details
business_audit_event_id_not_null: NOT NULL id
business_audit_event_reason_not_null: NOT NULL reason
business_audit_event_resource_id_not_null: NOT NULL resource_id
business_audit_event_resource_type_not_null: NOT NULL resource_type
business_audit_event_restaurant_id_not_null: NOT NULL restaurant_id
business_audit_event_pkey: PRIMARY KEY (id)
```

### Chỉ mục của business_audit_event

```sql
CREATE UNIQUE INDEX business_audit_event_pkey ON public.business_audit_event USING btree (id);
CREATE INDEX business_audit_resource ON public.business_audit_event USING btree (resource_type, resource_id, created_at);
```

### Trigger của business_audit_event

```sql
CREATE TRIGGER business_audit_immutable BEFORE DELETE OR UPDATE ON public.business_audit_event FOR EACH ROW EXECUTE FUNCTION core_immutable();
```

## cart_item

Dòng giỏ chưa gửi, thuộc một người tham gia; giá ở đây là giá xem trước.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                  | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                          |
| -------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------------- |
| id                   | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                           |
| cart_id              | uuid                        | Không | FK → session_cart        | —                 | Giỏ chứa dòng món.                                                        |
| owner_participant_id | uuid                        | Có    | FK → session_participant | —                 | Người tham gia sở hữu dòng; có thể rỗng với dòng nhân viên tạo.           |
| product_id           | uuid                        | Không | FK → product             | —                 | Món hiện hành được tham chiếu.                                            |
| quantity             | integer                     | Không | —                        | —                 | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân. |
| note                 | text                        | Có    | —                        | —                 | Ghi chú dòng món.                                                         |
| unit_price_preview   | bigint                      | Không | —                        | —                 | Giá xem trước trong giỏ, kiểm tra lại khi gửi.                            |
| selected             | boolean                     | Không | —                        | false             | Cờ chọn lưu trong cấu trúc giỏ; submit hiện dùng itemIds từ request.      |
| version              | integer                     | Không | —                        | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng.       |
| created_at           | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                                    |
| updated_at           | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.        |

### Quan hệ của cart_item

- FOREIGN KEY (cart_id) REFERENCES session_cart(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của cart_item

```sql
cart_item_quantity_check: CHECK ((quantity > 0))
cart_item_unit_price_preview_check: CHECK ((unit_price_preview >= 0))
cart_item_version_check: CHECK ((version > 0))
core_cart_item_f1: FOREIGN KEY (cart_id) REFERENCES session_cart(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_cart_item_f2: FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_cart_item_f3: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
cart_item_cart_id_not_null: NOT NULL cart_id
cart_item_created_at_not_null: NOT NULL created_at
cart_item_id_not_null: NOT NULL id
cart_item_product_id_not_null: NOT NULL product_id
cart_item_quantity_not_null: NOT NULL quantity
cart_item_selected_not_null: NOT NULL selected
cart_item_unit_price_preview_not_null: NOT NULL unit_price_preview
cart_item_updated_at_not_null: NOT NULL updated_at
cart_item_version_not_null: NOT NULL version
cart_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của cart_item

```sql
CREATE UNIQUE INDEX cart_item_pkey ON public.cart_item USING btree (id);
CREATE INDEX core_cart_item_fk1 ON public.cart_item USING btree (cart_id);
CREATE INDEX core_cart_item_fk2 ON public.cart_item USING btree (owner_participant_id);
CREATE INDEX core_cart_item_fk3 ON public.cart_item USING btree (product_id);
```

### Trigger của cart_item

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.cart_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.cart_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('session_cart', 'cart_id', 'session_participant', 'owner_participant_id', 'product', 'product_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.cart_item FOR EACH ROW EXECUTE FUNCTION core_session_guard();
```

## dining_area

Khu vực bố trí bàn.

Có 8 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | ------------------------ | ----- | --------------- | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                     | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id | uuid                     | Không | FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| code          | text                     | Không | —               | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name          | text                     | Không | —               | —                 | Tên hiển thị đối tượng.                                            |
| sort_order    | integer                  | Không | —               | 0                 | Thứ tự hiển thị                                                    |
| is_active     | boolean                  | Không | —               | true              | Cờ hoạt động của danh mục/đối tượng.                               |
| created_at    | timestamp with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp with time zone | Không | —               | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của dining_area

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của dining_area

```sql
dining_area_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_area_code_not_null: NOT NULL code
dining_area_created_at_not_null: NOT NULL created_at
dining_area_id_not_null: NOT NULL id
dining_area_is_active_not_null: NOT NULL is_active
dining_area_name_not_null: NOT NULL name
dining_area_restaurant_id_not_null: NOT NULL restaurant_id
dining_area_sort_order_not_null: NOT NULL sort_order
dining_area_updated_at_not_null: NOT NULL updated_at
dining_area_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
dining_area_id_restaurant_id_key: UNIQUE (id, restaurant_id)
dining_area_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của dining_area

```sql
CREATE UNIQUE INDEX dining_area_id_restaurant_id_key ON public.dining_area USING btree (id, restaurant_id);
CREATE UNIQUE INDEX dining_area_pkey ON public.dining_area USING btree (id);
CREATE UNIQUE INDEX dining_area_restaurant_id_code_key ON public.dining_area USING btree (restaurant_id, code);
```

### Trigger của dining_area

```sql
CREATE TRIGGER dining_area_updated BEFORE UPDATE ON public.dining_area FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.dining_area DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.dining_area FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## dining_table

Bàn vật lý; trạng thái sẵn sàng, có khách, chờ dọn.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa                              | Default           | Ý nghĩa hiện tại                                                    |
| ------------- | ------------------------ | ----- | --------------------------------- | ----------------- | ------------------------------------------------------------------- |
| id            | uuid                     | Không | PK                                | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| restaurant_id | uuid                     | Không | FK → dining_area; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                    |
| area_id       | uuid                     | Không | FK → dining_area                  | —                 | Khu vực bàn/phân công.                                              |
| code          | text                     | Không | —                                 | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                    |
| name          | text                     | Không | —                                 | —                 | Tên hiển thị đối tượng.                                             |
| capacity      | integer                  | Không | —                                 | —                 | Số chỗ > 0                                                          |
| table_status  | text                     | Không | —                                 | 'AVAILABLE'::text | Trạng thái: AVAILABLE, OCCUPIED, NEEDS_CLEANING                     |
| is_active     | boolean                  | Không | —                                 | true              | Cờ hoạt động của danh mục/đối tượng.                                |
| version       | integer                  | Không | —                                 | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at    | timestamp with time zone | Không | —                                 | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at    | timestamp with time zone | Không | —                                 | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của dining_table

- FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của dining_table

```sql
dining_table_capacity_check: CHECK ((capacity > 0))
dining_table_table_status_check: CHECK ((table_status = ANY (ARRAY['AVAILABLE'::text, 'OCCUPIED'::text, 'NEEDS_CLEANING'::text])))
dining_table_version_check: CHECK ((version > 0))
dining_table_area_id_restaurant_id_fkey: FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_table_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
dining_table_area_id_not_null: NOT NULL area_id
dining_table_capacity_not_null: NOT NULL capacity
dining_table_code_not_null: NOT NULL code
dining_table_created_at_not_null: NOT NULL created_at
dining_table_id_not_null: NOT NULL id
dining_table_is_active_not_null: NOT NULL is_active
dining_table_name_not_null: NOT NULL name
dining_table_restaurant_id_not_null: NOT NULL restaurant_id
dining_table_table_status_not_null: NOT NULL table_status
dining_table_updated_at_not_null: NOT NULL updated_at
dining_table_version_not_null: NOT NULL version
dining_table_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
dining_table_id_restaurant_key: UNIQUE (id, restaurant_id)
dining_table_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của dining_table

```sql
CREATE INDEX dining_table_area_idx ON public.dining_table USING btree (area_id, restaurant_id);
CREATE UNIQUE INDEX dining_table_id_restaurant_key ON public.dining_table USING btree (id, restaurant_id);
CREATE UNIQUE INDEX dining_table_pkey ON public.dining_table USING btree (id);
CREATE UNIQUE INDEX dining_table_restaurant_id_code_key ON public.dining_table USING btree (restaurant_id, code);
```

### Trigger của dining_table

```sql
CREATE TRIGGER dining_table_updated BEFORE UPDATE ON public.dining_table FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.dining_table DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_area', 'area_id', 'restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.dining_table FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## employee_pay_rate

Đơn giá lương giờ có ngày hiệu lực.

Có 8 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts).

| Cột            | Kiểu PostgreSQL          | NULL? | Khóa                                          | Default           | Ý nghĩa hiện tại                     |
| -------------- | ------------------------ | ----- | --------------------------------------------- | ----------------- | ------------------------------------ |
| id             | uuid                     | Không | PK                                            | gen_random_uuid() | Mã định danh chính của bản ghi.      |
| restaurant_id  | uuid                     | Không | FK → app_user; FK → restaurant; FK → app_user | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.     |
| user_id        | uuid                     | Không | FK → app_user                                 | —                 | Tài khoản nhân viên được tham chiếu. |
| effective_from | timestamp with time zone | Không | —                                             | —                 | Thời điểm bắt đầu hiệu lực.          |
| hourly_rate    | bigint                   | Không | —                                             | —                 | Đơn giá VND cho một giờ làm.         |
| reason         | text                     | Không | —                                             | —                 | Lý do nghiệp vụ của thao tác.        |
| created_by     | uuid                     | Không | FK → app_user                                 | —                 | Tài khoản tạo bản ghi.               |
| created_at     | timestamp with time zone | Không | —                                             | now()             | Thời điểm tạo bản ghi.               |

### Quan hệ của employee_pay_rate

- FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của employee_pay_rate

```sql
employee_pay_rate_hourly_rate_check: CHECK (((hourly_rate >= 1000) AND (hourly_rate <= 10000000)))
employee_pay_rate_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
employee_pay_rate_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
employee_pay_rate_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
employee_pay_rate_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
employee_pay_rate_created_at_not_null: NOT NULL created_at
employee_pay_rate_created_by_not_null: NOT NULL created_by
employee_pay_rate_effective_from_not_null: NOT NULL effective_from
employee_pay_rate_hourly_rate_not_null: NOT NULL hourly_rate
employee_pay_rate_id_not_null: NOT NULL id
employee_pay_rate_reason_not_null: NOT NULL reason
employee_pay_rate_restaurant_id_not_null: NOT NULL restaurant_id
employee_pay_rate_user_id_not_null: NOT NULL user_id
employee_pay_rate_pkey: PRIMARY KEY (id)
employee_pay_rate_user_id_effective_from_key: UNIQUE (user_id, effective_from)
```

### Chỉ mục của employee_pay_rate

```sql
CREATE INDEX employee_pay_rate_lookup_idx ON public.employee_pay_rate USING btree (user_id, effective_from DESC);
CREATE UNIQUE INDEX employee_pay_rate_pkey ON public.employee_pay_rate USING btree (id);
CREATE UNIQUE INDEX employee_pay_rate_user_id_effective_from_key ON public.employee_pay_rate USING btree (user_id, effective_from);
```

### Trigger của employee_pay_rate

```sql
CREATE TRIGGER workforce_immutable BEFORE DELETE OR UPDATE ON public.employee_pay_rate FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
```

## financial_charge

Khoản phải thu gắn phiên và thường gắn dòng món; đảo bằng trạng thái REVERSED.

Có 9 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/refund-context.service.ts](../apps/api/src/modules/payments/refund-context.service.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa               | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | --------------------------- | ----- | ------------------ | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                        | Không | PK                 | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| session_id    | uuid                        | Không | FK → table_session | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                    |
| order_item_id | uuid                        | Có    | FK → order_item    | —                 | Dòng món liên quan.                                                |
| charge_type   | text                        | Không | —                  | —                 | Loại khoản phải thu; luồng hiện chủ yếu ITEM.                      |
| amount        | bigint                      | Không | —                  | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.      |
| status        | text                        | Không | —                  | 'ACTIVE'::text    | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| created_at    | timestamp(6) with time zone | Không | —                  | now()             | Thời điểm tạo bản ghi.                                             |
| reversed_at   | timestamp(6) with time zone | Có    | —                  | —                 | Thời điểm đảo khoản phải thu.                                      |
| updated_at    | timestamp(6) with time zone | Không | —                  | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của financial_charge

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của financial_charge

```sql
financial_charge_amount_check: CHECK ((amount >= 0))
financial_charge_charge_type_check: CHECK ((charge_type = ANY (ARRAY['ITEM'::text, 'ADJUSTMENT'::text])))
financial_charge_charge_type_check1: CHECK ((length(btrim(charge_type)) > 0))
financial_charge_check: CHECK (((charge_type <> 'ITEM'::text) OR (order_item_id IS NOT NULL)))
financial_charge_check1: CHECK (((status <> 'REVERSED'::text) OR (reversed_at IS NOT NULL)))
financial_charge_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVERSED'::text])))
financial_charge_status_check1: CHECK ((length(btrim(status)) > 0))
core_financial_charge_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_financial_charge_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
financial_charge_amount_not_null: NOT NULL amount
financial_charge_charge_type_not_null: NOT NULL charge_type
financial_charge_created_at_not_null: NOT NULL created_at
financial_charge_id_not_null: NOT NULL id
financial_charge_session_id_not_null: NOT NULL session_id
financial_charge_status_not_null: NOT NULL status
financial_charge_updated_at_not_null: NOT NULL updated_at
financial_charge_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của financial_charge

```sql
CREATE INDEX core_financial_charge_fk1 ON public.financial_charge USING btree (session_id);
CREATE INDEX core_financial_charge_fk2 ON public.financial_charge USING btree (order_item_id);
CREATE UNIQUE INDEX financial_charge_pkey ON public.financial_charge USING btree (id);
CREATE UNIQUE INDEX pdm_item_charge ON public.financial_charge USING btree (order_item_id) WHERE (charge_type = 'ITEM'::text);
```

### Trigger của financial_charge

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.financial_charge FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.financial_charge FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.financial_charge DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'order_item', 'order_item_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.financial_charge FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_charge_snapshot BEFORE UPDATE ON public.financial_charge FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id', 'order_item_id', 'charge_type', 'amount');
```

## goods_receipt

Phiếu nhập kho nháp/đã duyệt/đã hủy; chỉ duyệt mới tăng tồn.

Có 12 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts).

| Cột                    | Kiểu PostgreSQL             | NULL? | Khóa                | Default           | Ý nghĩa hiện tại                                                    |
| ---------------------- | --------------------------- | ----- | ------------------- | ----------------- | ------------------------------------------------------------------- |
| id                     | uuid                        | Không | PK                  | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| location_id            | uuid                        | Không | FK → stock_location | —                 | Vị trí kho liên quan.                                               |
| receipt_no             | text                        | Không | —                   | —                 | Số phiếu nhập kho.                                                  |
| status                 | text                        | Không | —                   | 'DRAFT'::text     | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.       |
| received_at            | timestamp(6) with time zone | Có    | —                   | —                 | Thời điểm tiếp nhận: duyệt nhập kho hoặc bếp nhận món tùy bảng.     |
| total_value            | bigint                      | Không | —                   | —                 | Tổng giá trị VND của phiếu nhập.                                    |
| created_by             | uuid                        | Không | FK → app_user       | —                 | Tài khoản tạo bản ghi.                                              |
| approved_by            | uuid                        | Có    | FK → app_user       | —                 | Tài khoản thực hiện duyệt.                                          |
| supplier_name_snapshot | text                        | Có    | —                   | —                 | Tên nhà cung cấp được ghi nhận trên phiếu.                          |
| created_at             | timestamp(6) with time zone | Không | —                   | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at             | timestamp(6) with time zone | Không | —                   | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |
| version                | integer                     | Không | —                   | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |

### Quan hệ của goods_receipt

- FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (approved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của goods_receipt

```sql
goods_receipt_check: CHECK (((status <> 'APPROVED'::text) OR ((approved_by IS NOT NULL) AND (received_at IS NOT NULL))))
goods_receipt_receipt_no_check: CHECK ((length(btrim(receipt_no)) > 0))
goods_receipt_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'CANCELLED'::text])))
goods_receipt_status_check1: CHECK ((length(btrim(status)) > 0))
goods_receipt_total_value_check: CHECK ((total_value >= 0))
goods_receipt_version_check: CHECK ((version > 0))
core_goods_receipt_f1: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_f2: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_f3: FOREIGN KEY (approved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
goods_receipt_created_at_not_null: NOT NULL created_at
goods_receipt_created_by_not_null: NOT NULL created_by
goods_receipt_id_not_null: NOT NULL id
goods_receipt_location_id_not_null: NOT NULL location_id
goods_receipt_receipt_no_not_null: NOT NULL receipt_no
goods_receipt_status_not_null: NOT NULL status
goods_receipt_total_value_not_null: NOT NULL total_value
goods_receipt_updated_at_not_null: NOT NULL updated_at
goods_receipt_version_not_null: NOT NULL version
goods_receipt_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
goods_receipt_location_id_receipt_no_key: UNIQUE (location_id, receipt_no)
```

### Chỉ mục của goods_receipt

```sql
CREATE INDEX core_goods_receipt_fk1 ON public.goods_receipt USING btree (location_id);
CREATE INDEX core_goods_receipt_fk2 ON public.goods_receipt USING btree (created_by);
CREATE INDEX core_goods_receipt_fk3 ON public.goods_receipt USING btree (approved_by);
CREATE UNIQUE INDEX goods_receipt_location_id_receipt_no_key ON public.goods_receipt USING btree (location_id, receipt_no);
CREATE UNIQUE INDEX goods_receipt_pkey ON public.goods_receipt USING btree (id);
```

### Trigger của goods_receipt

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.goods_receipt FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.goods_receipt FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.goods_receipt DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('stock_location', 'location_id', 'app_user', 'created_by', 'app_user', 'approved_by');
CREATE TRIGGER receipt_header_guard BEFORE UPDATE ON public.goods_receipt FOR EACH ROW EXECUTE FUNCTION receipt_header_guard();
```

## goods_receipt_item

Dòng nguyên liệu của phiếu nhập.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa                 | Default           | Ý nghĩa hiện tại                                                          |
| ------------- | --------------------------- | ----- | -------------------- | ----------------- | ------------------------------------------------------------------------- |
| id            | uuid                        | Không | PK                   | gen_random_uuid() | Mã định danh chính của bản ghi.                                           |
| receipt_id    | uuid                        | Không | FK → goods_receipt   | —                 | Phiếu nhập chứa dòng nguyên liệu.                                         |
| ingredient_id | uuid                        | Không | FK → ingredient      | —                 | Nguyên liệu liên quan.                                                    |
| quantity      | numeric(18,6)               | Không | —                    | —                 | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân. |
| unit_id       | uuid                        | Không | FK → unit_of_measure | —                 | Đơn vị của dòng nhập; luồng hiện dùng đơn vị cơ sở.                       |
| base_quantity | numeric(18,6)               | Không | —                    | —                 | Lượng theo đơn vị cơ sở; route nhập hiện gán bằng quantity.               |
| unit_cost     | numeric(18,6)               | Không | —                    | —                 | Giá vốn trên một đơn vị cơ sở.                                            |
| lot_no        | text                        | Có    | —                    | —                 | Mã lô có trong schema; route nhập hiện chưa nhận dữ liệu lô.              |
| expiry_date   | date                        | Có    | —                    | —                 | Hạn sử dụng có trong schema; route nhập hiện chưa nhận trường này.        |
| created_at    | timestamp(6) with time zone | Không | —                    | now()             | Thời điểm tạo bản ghi.                                                    |
| updated_at    | timestamp(6) with time zone | Không | —                    | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.        |

### Quan hệ của goods_receipt_item

- FOREIGN KEY (receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của goods_receipt_item

```sql
goods_receipt_item_base_quantity_check: CHECK ((base_quantity > (0)::numeric))
goods_receipt_item_quantity_check: CHECK ((quantity > (0)::numeric))
goods_receipt_item_unit_cost_check: CHECK ((unit_cost >= (0)::numeric))
core_goods_receipt_item_f1: FOREIGN KEY (receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_item_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_goods_receipt_item_f3: FOREIGN KEY (unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT
goods_receipt_item_base_quantity_not_null: NOT NULL base_quantity
goods_receipt_item_created_at_not_null: NOT NULL created_at
goods_receipt_item_id_not_null: NOT NULL id
goods_receipt_item_ingredient_id_not_null: NOT NULL ingredient_id
goods_receipt_item_quantity_not_null: NOT NULL quantity
goods_receipt_item_receipt_id_not_null: NOT NULL receipt_id
goods_receipt_item_unit_cost_not_null: NOT NULL unit_cost
goods_receipt_item_unit_id_not_null: NOT NULL unit_id
goods_receipt_item_updated_at_not_null: NOT NULL updated_at
goods_receipt_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của goods_receipt_item

```sql
CREATE INDEX core_goods_receipt_item_fk1 ON public.goods_receipt_item USING btree (receipt_id);
CREATE INDEX core_goods_receipt_item_fk2 ON public.goods_receipt_item USING btree (ingredient_id);
CREATE INDEX core_goods_receipt_item_fk3 ON public.goods_receipt_item USING btree (unit_id);
CREATE UNIQUE INDEX goods_receipt_item_pkey ON public.goods_receipt_item USING btree (id);
```

### Trigger của goods_receipt_item

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.goods_receipt_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.goods_receipt_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('goods_receipt', 'receipt_id', 'ingredient', 'ingredient_id');
CREATE TRIGGER receipt_line_draft_guard BEFORE INSERT OR DELETE OR UPDATE ON public.goods_receipt_item FOR EACH ROW EXECUTE FUNCTION receipt_line_draft_guard();
```

## idempotency_record

Khóa và snapshot kết quả chống tạo order/payment intent trùng.

Có 15 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/shared/idempotency.ts](../apps/api/src/modules/shared/idempotency.ts).

| Cột                  | Kiểu PostgreSQL             | NULL? | Khóa                     | Default            | Ý nghĩa hiện tại                                                    |
| -------------------- | --------------------------- | ----- | ------------------------ | ------------------ | ------------------------------------------------------------------- |
| id                   | uuid                        | Không | PK                       | gen_random_uuid()  | Mã định danh chính của bản ghi.                                     |
| scope                | text                        | Không | —                        | —                  | Phạm vi khóa chống lặp, ví dụ order:sessionId.                      |
| idempotency_key      | text                        | Không | —                        | —                  | Khóa chống gửi lặp do client cấp.                                   |
| request_hash         | text                        | Không | —                        | —                  | Hash nội dung yêu cầu để phát hiện dùng lại khóa với nội dung khác. |
| resource_type        | text                        | Không | —                        | —                  | Loại đối tượng được tham chiếu; không tự suy ra là FK.              |
| response_snapshot    | jsonb                       | Có    | —                        | —                  | Kết quả thành công đã lưu để trả lại khi gửi lặp.                   |
| expires_at           | timestamp(6) with time zone | Không | —                        | —                  | Thời điểm hết hiệu lực; cách xử lý tùy đối tượng/job.               |
| actor_type           | text                        | Không | —                        | —                  | Loại tác nhân; đọc CHECK cho từng bảng.                             |
| actor_user_id        | uuid                        | Có    | FK → app_user            | —                  | Tài khoản nội bộ khi tác nhân là USER.                              |
| actor_participant_id | uuid                        | Có    | FK → session_participant | —                  | Người tham gia khi tác nhân là GUEST.                               |
| order_batch_id       | uuid                        | Có    | FK → order_batch         | —                  | Lượt gọi liên quan.                                                 |
| payment_intent_id    | uuid                        | Có    | FK → payment_intent      | —                  | Yêu cầu thanh toán liên quan.                                       |
| status               | text                        | Không | —                        | 'PROCESSING'::text | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.       |
| created_at           | timestamp(6) with time zone | Không | —                        | now()              | Thời điểm tạo bản ghi.                                              |
| updated_at           | timestamp(6) with time zone | Không | —                        | now()              | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của idempotency_record

- FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của idempotency_record

```sql
idempotency_record_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
idempotency_record_actor_type_check1: CHECK ((length(btrim(actor_type)) > 0))
idempotency_record_check: CHECK (((((actor_type = 'USER'::text) AND (actor_user_id IS NOT NULL) AND (actor_participant_id IS NULL)) OR ((actor_type = 'GUEST'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NULL))) IS TRUE))
idempotency_record_check1: CHECK (((((resource_type = 'ORDER_BATCH'::text) AND (payment_intent_id IS NULL)) OR ((resource_type = 'PAYMENT_INTENT'::text) AND (order_batch_id IS NULL))) IS TRUE))
idempotency_record_check2: CHECK (((status <> 'SUCCEEDED'::text) OR ((num_nonnulls(order_batch_id, payment_intent_id) = 1) AND (response_snapshot IS NOT NULL))))
idempotency_record_check3: CHECK ((expires_at > created_at))
idempotency_record_idempotency_key_check: CHECK ((length(btrim(idempotency_key)) > 0))
idempotency_record_request_hash_check: CHECK ((length(btrim(request_hash)) > 0))
idempotency_record_resource_type_check: CHECK ((resource_type = ANY (ARRAY['ORDER_BATCH'::text, 'PAYMENT_INTENT'::text])))
idempotency_record_resource_type_check1: CHECK ((length(btrim(resource_type)) > 0))
idempotency_record_scope_check: CHECK ((length(btrim(scope)) > 0))
idempotency_record_status_check: CHECK ((status = ANY (ARRAY['PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text])))
idempotency_record_status_check1: CHECK ((length(btrim(status)) > 0))
core_idempotency_record_f1: FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f2: FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_idempotency_record_f5: FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT
idempotency_record_actor_type_not_null: NOT NULL actor_type
idempotency_record_created_at_not_null: NOT NULL created_at
idempotency_record_expires_at_not_null: NOT NULL expires_at
idempotency_record_id_not_null: NOT NULL id
idempotency_record_idempotency_key_not_null: NOT NULL idempotency_key
idempotency_record_request_hash_not_null: NOT NULL request_hash
idempotency_record_resource_type_not_null: NOT NULL resource_type
idempotency_record_scope_not_null: NOT NULL scope
idempotency_record_status_not_null: NOT NULL status
idempotency_record_updated_at_not_null: NOT NULL updated_at
idempotency_record_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của idempotency_record

```sql
CREATE INDEX core_idempotency_record_fk1 ON public.idempotency_record USING btree (actor_user_id);
CREATE INDEX core_idempotency_record_fk2 ON public.idempotency_record USING btree (actor_participant_id);
CREATE INDEX core_idempotency_record_fk4 ON public.idempotency_record USING btree (order_batch_id);
CREATE INDEX core_idempotency_record_fk5 ON public.idempotency_record USING btree (payment_intent_id);
CREATE UNIQUE INDEX idempotency_record_pkey ON public.idempotency_record USING btree (id);
CREATE INDEX pdm_idem_expiry ON public.idempotency_record USING btree (expires_at);
CREATE UNIQUE INDEX pdm_idem_guest ON public.idempotency_record USING btree (scope, actor_participant_id, idempotency_key) WHERE (actor_type = 'GUEST'::text);
CREATE UNIQUE INDEX pdm_idem_system ON public.idempotency_record USING btree (scope, idempotency_key) WHERE (actor_type = 'SYSTEM'::text);
CREATE UNIQUE INDEX pdm_idem_user ON public.idempotency_record USING btree (scope, actor_user_id, idempotency_key) WHERE (actor_type = 'USER'::text);
```

### Trigger của idempotency_record

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.idempotency_record FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.idempotency_record DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'actor_user_id', 'session_participant', 'actor_participant_id', 'order_batch', 'order_batch_id', 'payment_intent', 'payment_intent_id');
```

## ingredient

Nguyên liệu được quản lý trong kho của nhà hàng.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa                 | Default           | Ý nghĩa hiện tại                                                              |
| ------------- | --------------------------- | ----- | -------------------- | ----------------- | ----------------------------------------------------------------------------- |
| id            | uuid                        | Không | PK                   | gen_random_uuid() | Mã định danh chính của bản ghi.                                               |
| restaurant_id | uuid                        | Không | FK → restaurant      | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                              |
| code          | text                        | Không | —                    | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                              |
| name          | text                        | Không | —                    | —                 | Tên hiển thị đối tượng.                                                       |
| base_unit_id  | uuid                        | Không | FK → unit_of_measure | —                 | Đơn vị cơ sở của nguyên liệu.                                                 |
| min_stock     | numeric(18,6)               | Không | —                    | 0                 | Ngưỡng tồn tối thiểu được lưu; không tự suy ra có quy trình đặt hàng tự động. |
| is_active     | boolean                     | Không | —                    | true              | Cờ hoạt động của danh mục/đối tượng.                                          |
| version       | integer                     | Không | —                    | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng.           |
| created_at    | timestamp(6) with time zone | Không | —                    | now()             | Thời điểm tạo bản ghi.                                                        |
| updated_at    | timestamp(6) with time zone | Không | —                    | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.            |

### Quan hệ của ingredient

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (base_unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của ingredient

```sql
ingredient_code_check: CHECK ((length(btrim(code)) > 0))
ingredient_min_stock_check: CHECK ((min_stock >= (0)::numeric))
ingredient_name_check: CHECK ((length(btrim(name)) > 0))
ingredient_version_check: CHECK ((version > 0))
core_ingredient_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_ingredient_f2: FOREIGN KEY (base_unit_id) REFERENCES unit_of_measure(id) ON UPDATE RESTRICT ON DELETE RESTRICT
ingredient_base_unit_id_not_null: NOT NULL base_unit_id
ingredient_code_not_null: NOT NULL code
ingredient_created_at_not_null: NOT NULL created_at
ingredient_id_not_null: NOT NULL id
ingredient_is_active_not_null: NOT NULL is_active
ingredient_min_stock_not_null: NOT NULL min_stock
ingredient_name_not_null: NOT NULL name
ingredient_restaurant_id_not_null: NOT NULL restaurant_id
ingredient_updated_at_not_null: NOT NULL updated_at
ingredient_version_not_null: NOT NULL version
ingredient_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
ingredient_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của ingredient

```sql
CREATE INDEX core_ingredient_fk1 ON public.ingredient USING btree (restaurant_id);
CREATE INDEX core_ingredient_fk2 ON public.ingredient USING btree (base_unit_id);
CREATE UNIQUE INDEX ingredient_pkey ON public.ingredient USING btree (id);
CREATE UNIQUE INDEX ingredient_restaurant_id_code_key ON public.ingredient USING btree (restaurant_id, code);
```

### Trigger của ingredient

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.ingredient FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.ingredient DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.ingredient FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id', 'base_unit_id');
```

## inventory_balance

Số dư một nguyên liệu tại một vị trí: tồn, giữ, khả dụng và giá vốn.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa                | Default           | Ý nghĩa hiện tại                                                    |
| ------------- | --------------------------- | ----- | ------------------- | ----------------- | ------------------------------------------------------------------- |
| id            | uuid                        | Không | PK                  | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| location_id   | uuid                        | Không | FK → stock_location | —                 | Vị trí kho liên quan.                                               |
| ingredient_id | uuid                        | Không | FK → ingredient     | —                 | Nguyên liệu liên quan.                                              |
| on_hand_qty   | numeric(18,6)               | Không | —                   | 0                 | Lượng tồn thực tế ghi sổ.                                           |
| reserved_qty  | numeric(18,6)               | Không | —                   | 0                 | Lượng đang giữ cho các món chưa tiêu hao.                           |
| available_qty | numeric(18,6)               | Không | —                   | —                 | Lượng khả dụng để giữ tiếp, bằng tồn trừ giữ theo ràng buộc.        |
| avg_cost      | numeric(18,6)               | Không | —                   | 0                 | Giá vốn bình quân của nguyên liệu tại vị trí.                       |
| version       | integer                     | Không | —                   | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at    | timestamp(6) with time zone | Không | —                   | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at    | timestamp(6) with time zone | Không | —                   | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của inventory_balance

- FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của inventory_balance

```sql
inventory_balance_available_qty_check: CHECK ((available_qty >= (0)::numeric))
inventory_balance_avg_cost_check: CHECK ((avg_cost >= (0)::numeric))
inventory_balance_check: CHECK (((available_qty = (on_hand_qty - reserved_qty)) AND (reserved_qty <= on_hand_qty)))
inventory_balance_on_hand_qty_check: CHECK ((on_hand_qty >= (0)::numeric))
inventory_balance_reserved_qty_check: CHECK ((reserved_qty >= (0)::numeric))
inventory_balance_version_check: CHECK ((version > 0))
core_inventory_balance_f1: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_balance_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_balance_available_qty_not_null: NOT NULL available_qty
inventory_balance_avg_cost_not_null: NOT NULL avg_cost
inventory_balance_created_at_not_null: NOT NULL created_at
inventory_balance_id_not_null: NOT NULL id
inventory_balance_ingredient_id_not_null: NOT NULL ingredient_id
inventory_balance_location_id_not_null: NOT NULL location_id
inventory_balance_on_hand_qty_not_null: NOT NULL on_hand_qty
inventory_balance_reserved_qty_not_null: NOT NULL reserved_qty
inventory_balance_updated_at_not_null: NOT NULL updated_at
inventory_balance_version_not_null: NOT NULL version
inventory_balance_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
inventory_balance_location_id_ingredient_id_key: UNIQUE (location_id, ingredient_id)
```

### Chỉ mục của inventory_balance

```sql
CREATE INDEX core_inventory_balance_fk1 ON public.inventory_balance USING btree (location_id);
CREATE INDEX core_inventory_balance_fk2 ON public.inventory_balance USING btree (ingredient_id);
CREATE UNIQUE INDEX inventory_balance_location_id_ingredient_id_key ON public.inventory_balance USING btree (location_id, ingredient_id);
CREATE UNIQUE INDEX inventory_balance_pkey ON public.inventory_balance USING btree (id);
```

### Trigger của inventory_balance

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.inventory_balance FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.inventory_balance DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('stock_location', 'location_id', 'ingredient', 'ingredient_id');
```

## inventory_movement

Lịch sử tăng/giảm kho do nhập, chế biến, kiểm kê hoặc xuất hủy.

Có 15 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts).

| Cột              | Kiểu PostgreSQL             | NULL? | Khóa                | Default           | Ý nghĩa hiện tại                                                          |
| ---------------- | --------------------------- | ----- | ------------------- | ----------------- | ------------------------------------------------------------------------- |
| id               | uuid                        | Không | PK                  | gen_random_uuid() | Mã định danh chính của bản ghi.                                           |
| location_id      | uuid                        | Không | FK → stock_location | —                 | Vị trí kho liên quan.                                                     |
| ingredient_id    | uuid                        | Không | FK → ingredient     | —                 | Nguyên liệu liên quan.                                                    |
| movement_type    | text                        | Không | —                   | —                 | Loại biến động: nhập, tiêu hao, điều chỉnh hoặc xuất hủy.                 |
| quantity         | numeric(18,6)               | Không | —                   | —                 | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân. |
| unit_cost        | numeric(18,6)               | Không | —                   | —                 | Giá vốn trên một đơn vị cơ sở.                                            |
| value            | bigint                      | Không | —                   | —                 | Giá trị VND có dấu của biến động kho.                                     |
| source_type      | text                        | Không | —                   | —                 | Nguồn gây ra biến động kho.                                               |
| occurred_at      | timestamp(6) with time zone | Không | —                   | now()             | Thời điểm biến động xảy ra.                                               |
| created_by       | uuid                        | Có    | FK → app_user       | —                 | Tài khoản tạo bản ghi.                                                    |
| goods_receipt_id | uuid                        | Có    | FK → goods_receipt  | —                 | Phiếu nhập gây ra biến động.                                              |
| order_item_id    | uuid                        | Có    | FK → order_item     | —                 | Dòng món liên quan.                                                       |
| created_at       | timestamp(6) with time zone | Không | —                   | now()             | Thời điểm tạo bản ghi.                                                    |
| request_key      | text                        | Có    | —                   | —                 | Khóa chống ghi lặp riêng cho luồng tương ứng; xem unique/index.           |
| reason           | text                        | Có    | —                   | —                 | Lý do nghiệp vụ của thao tác.                                             |

### Quan hệ của inventory_movement

- FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của inventory_movement

```sql
inventory_movement_check: CHECK (((((source_type = 'GOODS_RECEIPT'::text) AND (goods_receipt_id IS NOT NULL) AND (order_item_id IS NULL)) OR ((source_type = 'ORDER_ITEM'::text) AND (goods_receipt_id IS NULL) AND (order_item_id IS NOT NULL)) OR ((source_type = 'MANUAL'::text) AND (goods_receipt_id IS NULL) AND (order_item_id IS NULL))) IS TRUE))
inventory_movement_check1: CHECK ((((movement_type = ANY (ARRAY['RECEIPT'::text, 'ADJUSTMENT_IN'::text, 'TRANSFER_IN'::text])) AND (quantity > (0)::numeric) AND (value >= 0)) OR ((movement_type = ANY (ARRAY['CONSUMPTION'::text, 'WASTE'::text, 'ADJUSTMENT_OUT'::text, 'TRANSFER_OUT'::text])) AND (quantity < (0)::numeric) AND (value <= 0))))
inventory_movement_movement_type_check: CHECK ((movement_type = ANY (ARRAY['RECEIPT'::text, 'CONSUMPTION'::text, 'WASTE'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'TRANSFER_IN'::text, 'TRANSFER_OUT'::text])))
inventory_movement_movement_type_check1: CHECK ((length(btrim(movement_type)) > 0))
inventory_movement_quantity_check: CHECK ((quantity <> (0)::numeric))
inventory_movement_source_type_check: CHECK ((source_type = ANY (ARRAY['GOODS_RECEIPT'::text, 'ORDER_ITEM'::text, 'MANUAL'::text])))
inventory_movement_source_type_check1: CHECK ((length(btrim(source_type)) > 0))
inventory_movement_unit_cost_check: CHECK ((unit_cost >= (0)::numeric))
core_inventory_movement_f1: FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipt(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f4: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f5: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_movement_f6: FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_movement_created_at_not_null: NOT NULL created_at
inventory_movement_id_not_null: NOT NULL id
inventory_movement_ingredient_id_not_null: NOT NULL ingredient_id
inventory_movement_location_id_not_null: NOT NULL location_id
inventory_movement_movement_type_not_null: NOT NULL movement_type
inventory_movement_occurred_at_not_null: NOT NULL occurred_at
inventory_movement_quantity_not_null: NOT NULL quantity
inventory_movement_source_type_not_null: NOT NULL source_type
inventory_movement_unit_cost_not_null: NOT NULL unit_cost
inventory_movement_value_not_null: NOT NULL value
inventory_movement_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của inventory_movement

```sql
CREATE UNIQUE INDEX core_consumption_line ON public.inventory_movement USING btree (order_item_id, ingredient_id, location_id) WHERE (movement_type = 'CONSUMPTION'::text);
CREATE INDEX core_inventory_movement_fk1 ON public.inventory_movement USING btree (goods_receipt_id);
CREATE INDEX core_inventory_movement_fk2 ON public.inventory_movement USING btree (order_item_id);
CREATE INDEX core_inventory_movement_fk4 ON public.inventory_movement USING btree (location_id);
CREATE INDEX core_inventory_movement_fk5 ON public.inventory_movement USING btree (ingredient_id);
CREATE INDEX core_inventory_movement_fk6 ON public.inventory_movement USING btree (created_by);
CREATE UNIQUE INDEX inventory_manual_request_key ON public.inventory_movement USING btree (location_id, request_key) WHERE (request_key IS NOT NULL);
CREATE UNIQUE INDEX inventory_movement_pkey ON public.inventory_movement USING btree (id);
```

### Trigger của inventory_movement

```sql
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER core_immutable BEFORE UPDATE ON public.inventory_movement FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.inventory_movement DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('goods_receipt', 'goods_receipt_id', 'order_item', 'order_item_id', 'stock_location', 'location_id', 'ingredient', 'ingredient_id', 'app_user', 'created_by');
```

## inventory_reservation

Lượng nguyên liệu giữ cho dòng món trước chế biến.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts).

| Cột              | Kiểu PostgreSQL             | NULL? | Khóa                | Default             | Ý nghĩa hiện tại                                                          |
| ---------------- | --------------------------- | ----- | ------------------- | ------------------- | ------------------------------------------------------------------------- |
| id               | uuid                        | Không | PK                  | gen_random_uuid()   | Mã định danh chính của bản ghi.                                           |
| order_item_id    | uuid                        | Không | FK → order_item     | —                   | Dòng món liên quan.                                                       |
| ingredient_id    | uuid                        | Không | FK → ingredient     | —                   | Nguyên liệu liên quan.                                                    |
| location_id      | uuid                        | Không | FK → stock_location | —                   | Vị trí kho liên quan.                                                     |
| reservation_type | text                        | Không | —                   | —                   | Giữ tạm PROVISIONAL hoặc xác nhận CONFIRMED.                              |
| quantity         | numeric(18,6)               | Không | —                   | —                   | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân. |
| status           | text                        | Không | —                   | 'PROVISIONAL'::text | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.             |
| expires_at       | timestamp(6) with time zone | Có    | —                   | —                   | Thời điểm hết hiệu lực; cách xử lý tùy đối tượng/job.                     |
| created_at       | timestamp(6) with time zone | Không | —                   | now()               | Thời điểm tạo bản ghi.                                                    |
| updated_at       | timestamp(6) with time zone | Không | —                   | now()               | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.        |

### Quan hệ của inventory_reservation

- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của inventory_reservation

```sql
inventory_reservation_quantity_check: CHECK ((quantity > (0)::numeric))
inventory_reservation_reservation_type_check: CHECK ((reservation_type = ANY (ARRAY['PROVISIONAL'::text, 'CONFIRMED'::text])))
inventory_reservation_reservation_type_check1: CHECK ((length(btrim(reservation_type)) > 0))
inventory_reservation_status_check: CHECK ((status = ANY (ARRAY['PROVISIONAL'::text, 'ACTIVE'::text, 'CONSUMED'::text, 'RELEASED'::text, 'EXPIRED'::text])))
inventory_reservation_status_check1: CHECK ((length(btrim(status)) > 0))
core_inventory_reservation_f1: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_reservation_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_inventory_reservation_f3: FOREIGN KEY (location_id) REFERENCES stock_location(id) ON UPDATE RESTRICT ON DELETE RESTRICT
inventory_reservation_created_at_not_null: NOT NULL created_at
inventory_reservation_id_not_null: NOT NULL id
inventory_reservation_ingredient_id_not_null: NOT NULL ingredient_id
inventory_reservation_location_id_not_null: NOT NULL location_id
inventory_reservation_order_item_id_not_null: NOT NULL order_item_id
inventory_reservation_quantity_not_null: NOT NULL quantity
inventory_reservation_reservation_type_not_null: NOT NULL reservation_type
inventory_reservation_status_not_null: NOT NULL status
inventory_reservation_updated_at_not_null: NOT NULL updated_at
inventory_reservation_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của inventory_reservation

```sql
CREATE INDEX core_inventory_reservation_fk1 ON public.inventory_reservation USING btree (order_item_id);
CREATE INDEX core_inventory_reservation_fk2 ON public.inventory_reservation USING btree (ingredient_id);
CREATE INDEX core_inventory_reservation_fk3 ON public.inventory_reservation USING btree (location_id);
CREATE UNIQUE INDEX core_reservation_line ON public.inventory_reservation USING btree (order_item_id, ingredient_id, location_id);
CREATE UNIQUE INDEX inventory_reservation_pkey ON public.inventory_reservation USING btree (id);
```

### Trigger của inventory_reservation

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.inventory_reservation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.inventory_reservation DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_item', 'order_item_id', 'ingredient', 'ingredient_id', 'stock_location', 'location_id');
```

## menu_category

Nhóm món trên menu.

Có 9 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | ------------------------ | ----- | --------------- | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                     | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id | uuid                     | Không | FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| code          | text                     | Không | —               | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name          | text                     | Không | —               | —                 | Tên hiển thị đối tượng.                                            |
| description   | text                     | Có    | —               | —                 | Mô tả nghiệp vụ của bản ghi.                                       |
| sort_order    | integer                  | Không | —               | 0                 | Thứ tự hiển thị                                                    |
| is_active     | boolean                  | Không | —               | true              | Cờ hoạt động của danh mục/đối tượng.                               |
| created_at    | timestamp with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp with time zone | Không | —               | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của menu_category

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của menu_category

```sql
menu_category_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
menu_category_code_not_null: NOT NULL code
menu_category_created_at_not_null: NOT NULL created_at
menu_category_id_not_null: NOT NULL id
menu_category_is_active_not_null: NOT NULL is_active
menu_category_name_not_null: NOT NULL name
menu_category_restaurant_id_not_null: NOT NULL restaurant_id
menu_category_sort_order_not_null: NOT NULL sort_order
menu_category_updated_at_not_null: NOT NULL updated_at
menu_category_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
menu_category_id_restaurant_id_key: UNIQUE (id, restaurant_id)
menu_category_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của menu_category

```sql
CREATE UNIQUE INDEX menu_category_id_restaurant_id_key ON public.menu_category USING btree (id, restaurant_id);
CREATE UNIQUE INDEX menu_category_pkey ON public.menu_category USING btree (id);
CREATE UNIQUE INDEX menu_category_restaurant_id_code_key ON public.menu_category USING btree (restaurant_id, code);
```

### Trigger của menu_category

```sql
CREATE TRIGGER menu_category_updated BEFORE UPDATE ON public.menu_category FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.menu_category DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.menu_category FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## operational_alert

Cảnh báo vận hành cần theo dõi, như thiếu tiền hoặc cần hoàn.

Có 14 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                | Kiểu PostgreSQL             | NULL? | Khóa               | Default           | Ý nghĩa hiện tại                                                                |
| ------------------ | --------------------------- | ----- | ------------------ | ----------------- | ------------------------------------------------------------------------------- |
| id                 | uuid                        | Không | PK                 | gen_random_uuid() | Mã định danh chính của bản ghi.                                                 |
| session_id         | uuid                        | Có    | FK → table_session | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                                 |
| table_id           | uuid                        | Không | FK → dining_table  | —                 | Bàn liên quan; với phiên đây là bàn hiện tại.                                   |
| alert_type         | text                        | Không | —                  | —                 | Loại cảnh báo nghiệp vụ.                                                        |
| severity           | text                        | Không | —                  | —                 | Mức độ cảnh báo.                                                                |
| outstanding_amount | bigint                      | Không | —                  | 0                 | Số tiền còn thiếu hoặc số dư được chụp tại hồ sơ/cảnh báo.                      |
| status             | text                        | Không | —                  | 'NEW'::text       | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                   |
| acknowledged_by    | uuid                        | Có    | FK → app_user      | —                 | Nhân viên đã tiếp nhận cảnh báo; không phải người phụ trách yêu cầu hỗ trợ.     |
| escalated_at       | timestamp(6) with time zone | Có    | —                  | —                 | Thời điểm nâng mức xử lý nếu được ghi; không suy ra job nâng cấp tự động đã có. |
| resolved_at        | timestamp(6) with time zone | Có    | —                  | —                 | Thời điểm giải quyết xong.                                                      |
| created_at         | timestamp(6) with time zone | Không | —                  | now()             | Thời điểm tạo bản ghi.                                                          |
| updated_at         | timestamp(6) with time zone | Không | —                  | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.              |
| resolution_note    | text                        | Có    | —                  | —                 | Ghi chú xử lý cảnh báo.                                                         |
| resolved_by        | uuid                        | Có    | FK → app_user      | —                 | Tài khoản hoàn tất xử lý.                                                       |

### Quan hệ của operational_alert

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của operational_alert

```sql
operational_alert_alert_type_check: CHECK ((alert_type = ANY (ARRAY['PAYMENT_SHORTFALL'::text, 'REFUND_REQUIRED'::text, 'RISK_REVIEW'::text, 'OTHER'::text])))
operational_alert_alert_type_check1: CHECK ((length(btrim(alert_type)) > 0))
operational_alert_check: CHECK (((alert_type <> 'PAYMENT_SHORTFALL'::text) OR (session_id IS NOT NULL)))
operational_alert_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
operational_alert_severity_check: CHECK ((severity = ANY (ARRAY['INFO'::text, 'WARNING'::text, 'CRITICAL'::text])))
operational_alert_severity_check1: CHECK ((length(btrim(severity)) > 0))
operational_alert_status_check: CHECK ((status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text, 'ESCALATED'::text, 'RESOLVED'::text])))
operational_alert_status_check1: CHECK ((length(btrim(status)) > 0))
core_operational_alert_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_operational_alert_f2: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_operational_alert_f3: FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
operational_alert_resolved_by_fkey: FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON DELETE RESTRICT
operational_alert_alert_type_not_null: NOT NULL alert_type
operational_alert_created_at_not_null: NOT NULL created_at
operational_alert_id_not_null: NOT NULL id
operational_alert_outstanding_amount_not_null: NOT NULL outstanding_amount
operational_alert_severity_not_null: NOT NULL severity
operational_alert_status_not_null: NOT NULL status
operational_alert_table_id_not_null: NOT NULL table_id
operational_alert_updated_at_not_null: NOT NULL updated_at
operational_alert_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
uat_alert_resolver_tenant: TRIGGER DEFERRABLE
```

### Chỉ mục của operational_alert

```sql
CREATE INDEX alert_resolved_by_lookup ON public.operational_alert USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);
CREATE INDEX core_operational_alert_fk1 ON public.operational_alert USING btree (session_id);
CREATE INDEX core_operational_alert_fk2 ON public.operational_alert USING btree (table_id);
CREATE INDEX core_operational_alert_fk3 ON public.operational_alert USING btree (acknowledged_by);
CREATE UNIQUE INDEX operational_alert_pkey ON public.operational_alert USING btree (id);
CREATE UNIQUE INDEX pdm_alert_shortfall ON public.operational_alert USING btree (session_id) WHERE ((alert_type = 'PAYMENT_SHORTFALL'::text) AND (status <> 'RESOLVED'::text) AND (session_id IS NOT NULL));
```

### Trigger của operational_alert

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.operational_alert FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.operational_alert DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'dining_table', 'table_id', 'app_user', 'acknowledged_by');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.operational_alert FOR EACH ROW EXECUTE FUNCTION table_incident_guard();
CREATE CONSTRAINT TRIGGER uat_alert_resolver_tenant AFTER INSERT OR UPDATE ON public.operational_alert DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'resolved_by');
```

## order_batch

Một lượt gọi; tổng tiền gốc và quyết định rủi ro được chụp khi tạo.

Có 16 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/cancellation.service.ts](../apps/api/src/modules/orders/cancellation.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                       | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                    |
| ------------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------- |
| id                        | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| session_id                | uuid                        | Không | FK → table_session       | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                     |
| created_by_type           | text                        | Không | —                        | —                 | Loại người tạo lượt gọi USER/GUEST.                                 |
| client_request_id         | text                        | Không | —                        | —                 | Mã yêu cầu từ client lưu tại đối tượng nghiệp vụ.                   |
| status                    | text                        | Không | —                        | 'SUBMITTED'::text | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.       |
| subtotal                  | bigint                      | Không | —                        | —                 | Tổng tiền gốc trước các xử lý đảo charge về sau.                    |
| total_amount              | bigint                      | Không | —                        | —                 | Tổng tiền lượt gọi tại lúc tạo; không phải số dư cần thu hiện tại.  |
| risk_decision             | text                        | Có    | —                        | —                 | Quyết định bộ quy tắc tại lúc gửi.                                  |
| config_version            | integer                     | Có    | —                        | —                 | Phiên bản cấu hình tại lúc đánh giá.                                |
| submitted_at              | timestamp(6) with time zone | Có    | —                        | —                 | Thời điểm gửi lượt gọi.                                             |
| accepted_at               | timestamp(6) with time zone | Có    | —                        | —                 | Mốc nhận lượt gọi; vòng đời dòng món còn có received_at riêng.      |
| version                   | integer                     | Không | —                        | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_by_user_id        | uuid                        | Có    | FK → app_user            | —                 | Nhân viên tạo lượt gọi.                                             |
| created_by_participant_id | uuid                        | Có    | FK → session_participant | —                 | Khách tạo lượt gọi.                                                 |
| created_at                | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at                | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của order_batch

- FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (created_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_batch

```sql
order_batch_check: CHECK (((((created_by_type = 'USER'::text) AND (created_by_user_id IS NOT NULL) AND (created_by_participant_id IS NULL)) OR ((created_by_type = 'GUEST'::text) AND (created_by_user_id IS NULL) AND (created_by_participant_id IS NOT NULL))) IS TRUE))
order_batch_client_request_id_check: CHECK ((length(btrim(client_request_id)) > 0))
order_batch_config_version_check: CHECK ((config_version >= 0))
order_batch_created_by_type_check: CHECK ((created_by_type = ANY (ARRAY['USER'::text, 'GUEST'::text])))
order_batch_created_by_type_check1: CHECK ((length(btrim(created_by_type)) > 0))
order_batch_risk_decision_check: CHECK ((risk_decision = ANY (ARRAY['ALLOW'::text, 'REVIEW'::text, 'BLOCK'::text])))
order_batch_status_check: CHECK ((status = ANY (ARRAY['PENDING_REVIEW'::text, 'SUBMITTED'::text, 'ACCEPTED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
order_batch_status_check1: CHECK ((length(btrim(status)) > 0))
order_batch_subtotal_check: CHECK ((subtotal >= 0))
order_batch_total_amount_check: CHECK ((total_amount >= 0))
order_batch_version_check: CHECK ((version > 0))
core_order_batch_f1: FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_batch_f2: FOREIGN KEY (created_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_batch_f4: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_batch_client_request_id_not_null: NOT NULL client_request_id
order_batch_created_at_not_null: NOT NULL created_at
order_batch_created_by_type_not_null: NOT NULL created_by_type
order_batch_id_not_null: NOT NULL id
order_batch_session_id_not_null: NOT NULL session_id
order_batch_status_not_null: NOT NULL status
order_batch_subtotal_not_null: NOT NULL subtotal
order_batch_total_amount_not_null: NOT NULL total_amount
order_batch_updated_at_not_null: NOT NULL updated_at
order_batch_version_not_null: NOT NULL version
order_batch_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của order_batch

```sql
CREATE INDEX core_order_batch_fk1 ON public.order_batch USING btree (created_by_user_id);
CREATE INDEX core_order_batch_fk2 ON public.order_batch USING btree (created_by_participant_id);
CREATE INDEX core_order_batch_fk4 ON public.order_batch USING btree (session_id);
CREATE UNIQUE INDEX order_batch_pkey ON public.order_batch USING btree (id);
CREATE UNIQUE INDEX pdm_order_guest_request ON public.order_batch USING btree (session_id, created_by_participant_id, client_request_id) WHERE (created_by_type = 'GUEST'::text);
CREATE UNIQUE INDEX pdm_order_user_request ON public.order_batch USING btree (session_id, created_by_user_id, client_request_id) WHERE (created_by_type = 'USER'::text);
```

### Trigger của order_batch

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.order_batch FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_batch FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_batch DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'created_by_user_id', 'session_participant', 'created_by_participant_id', 'table_session', 'session_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.order_batch FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_batch_snapshot BEFORE UPDATE ON public.order_batch FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id', 'created_by_type', 'created_by_user_id', 'created_by_participant_id', 'client_request_id', 'subtotal', 'total_amount', 'config_version', 'risk_decision');
```

## order_item

Một dòng món trong lượt gọi, tên/giá và vòng đời xử lý riêng.

Có 23 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/refund-context.service.ts](../apps/api/src/modules/payments/refund-context.service.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/cancellation.service.ts](../apps/api/src/modules/orders/cancellation.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                         | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                                                                                                |
| --------------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| id                          | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                                                                                                 |
| order_batch_id              | uuid                        | Không | FK → order_batch         | —                 | Lượt gọi liên quan.                                                                                                                             |
| owner_participant_id        | uuid                        | Có    | FK → session_participant | —                 | Người tham gia sở hữu dòng; có thể rỗng với dòng nhân viên tạo.                                                                                 |
| product_id                  | uuid                        | Không | FK → product             | —                 | Món hiện hành được tham chiếu.                                                                                                                  |
| product_name_snapshot       | text                        | Không | —                        | —                 | Tên món tại lúc tạo dòng đơn.                                                                                                                   |
| quantity                    | integer                     | Không | —                        | —                 | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân.                                                                       |
| unit_price_snapshot         | bigint                      | Không | —                        | —                 | Đơn giá VND tại lúc tạo dòng đơn.                                                                                                               |
| line_total                  | bigint                      | Không | —                        | —                 | Thành tiền gốc của dòng món.                                                                                                                    |
| note                        | text                        | Có    | —                        | —                 | Ghi chú dòng món.                                                                                                                               |
| status                      | text                        | Không | —                        | 'SUBMITTED'::text | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                                                                                   |
| cancel_reason               | text                        | Có    | —                        | —                 | Lý do hủy/báo không thể phục vụ.                                                                                                                |
| version                     | integer                     | Không | —                        | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng.                                                                             |
| cancelled_by_type           | text                        | Có    | —                        | —                 | Loại tác nhân hủy.                                                                                                                              |
| cancelled_by_user_id        | uuid                        | Có    | FK → app_user            | —                 | Tài khoản nội bộ hủy.                                                                                                                           |
| cancelled_by_participant_id | uuid                        | Có    | FK → session_participant | —                 | Khách hủy món.                                                                                                                                  |
| created_at                  | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                                                                                                          |
| updated_at                  | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.                                                                              |
| received_at                 | timestamp with time zone    | Có    | —                        | —                 | Thời điểm tiếp nhận: duyệt nhập kho hoặc bếp nhận món tùy bảng.                                                                                 |
| preparation_started_at      | timestamp with time zone    | Có    | —                        | —                 | Thời điểm bắt đầu chế biến và tiêu hao kho.                                                                                                     |
| ready_at                    | timestamp with time zone    | Có    | —                        | —                 | Thời điểm món sẵn sàng.                                                                                                                         |
| served_at                   | timestamp with time zone    | Có    | —                        | —                 | Thời điểm xác nhận phục vụ.                                                                                                                     |
| stock_managed_snapshot      | boolean                     | Không | —                        | true              | Chụp cờ quản lý kho khi tạo dòng món.                                                                                                           |
| cancel_reason_code          | text                        | Có    | —                        | —                 | Mã lý do xử lý món chuẩn; đọc cùng cancel_reason, trạng thái và audit để biết giữ/bỏ tiền. NULL khi chưa có mã hoặc dữ liệu trước migration 24. |

### Quan hệ của order_item

- FOREIGN KEY (cancelled_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (cancelled_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_item

```sql
order_item_cancellation_check: CHECK (((status <> ALL (ARRAY['CANCELLED'::text, 'UNAVAILABLE'::text])) OR ((cancel_reason IS NOT NULL) AND (length(btrim(cancel_reason)) > 0) AND (cancelled_by_type IS NOT NULL))))
order_item_cancelled_by_type_check: CHECK ((cancelled_by_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
order_item_check: CHECK (((((cancelled_by_type = 'USER'::text) AND (cancelled_by_user_id IS NOT NULL) AND (cancelled_by_participant_id IS NULL)) OR ((cancelled_by_type = 'GUEST'::text) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NOT NULL)) OR ((cancelled_by_type = 'SYSTEM'::text) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NULL)) OR ((cancelled_by_type IS NULL) AND (cancelled_by_user_id IS NULL) AND (cancelled_by_participant_id IS NULL))) IS TRUE))
order_item_check1: CHECK (((line_total)::numeric = ((quantity)::numeric * (unit_price_snapshot)::numeric)))
order_item_line_total_check: CHECK ((line_total >= 0))
order_item_product_name_snapshot_check: CHECK ((length(btrim(product_name_snapshot)) > 0))
order_item_quantity_check: CHECK ((quantity > 0))
order_item_reason_code: CHECK (((cancel_reason_code IS NULL) OR (cancel_reason_code = ANY (ARRAY['CUSTOMER_CHANGED_MIND'::text, 'OUT_OF_STOCK'::text, 'KITCHEN_ERROR'::text, 'QUALITY_ISSUE'::text, 'WRONG_ITEM'::text, 'CUSTOMER_COMPLAINT'::text, 'OTHER'::text]))))
order_item_status_check: CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'ACCEPTED'::text, 'IN_PREPARATION'::text, 'READY'::text, 'SERVED'::text, 'UNAVAILABLE'::text, 'CANCELLED'::text])))
order_item_status_check1: CHECK ((length(btrim(status)) > 0))
order_item_unit_price_snapshot_check: CHECK ((unit_price_snapshot >= 0))
order_item_version_check: CHECK ((version > 0))
core_order_item_f1: FOREIGN KEY (cancelled_by_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f2: FOREIGN KEY (cancelled_by_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f5: FOREIGN KEY (owner_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_f6: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_item_created_at_not_null: NOT NULL created_at
order_item_id_not_null: NOT NULL id
order_item_line_total_not_null: NOT NULL line_total
order_item_order_batch_id_not_null: NOT NULL order_batch_id
order_item_product_id_not_null: NOT NULL product_id
order_item_product_name_snapshot_not_null: NOT NULL product_name_snapshot
order_item_quantity_not_null: NOT NULL quantity
order_item_status_not_null: NOT NULL status
order_item_stock_managed_snapshot_not_null: NOT NULL stock_managed_snapshot
order_item_unit_price_snapshot_not_null: NOT NULL unit_price_snapshot
order_item_updated_at_not_null: NOT NULL updated_at
order_item_version_not_null: NOT NULL version
order_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của order_item

```sql
CREATE INDEX core_order_item_fk1 ON public.order_item USING btree (cancelled_by_user_id);
CREATE INDEX core_order_item_fk2 ON public.order_item USING btree (cancelled_by_participant_id);
CREATE INDEX core_order_item_fk4 ON public.order_item USING btree (order_batch_id);
CREATE INDEX core_order_item_fk5 ON public.order_item USING btree (owner_participant_id);
CREATE INDEX core_order_item_fk6 ON public.order_item USING btree (product_id);
CREATE UNIQUE INDEX order_item_pkey ON public.order_item USING btree (id);
```

### Trigger của order_item

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.order_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_item FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'cancelled_by_user_id', 'session_participant', 'cancelled_by_participant_id', 'order_batch', 'order_batch_id', 'session_participant', 'owner_participant_id', 'product', 'product_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.order_item FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_order_snapshot BEFORE UPDATE ON public.order_item FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('order_batch_id', 'owner_participant_id', 'product_id', 'product_name_snapshot', 'quantity', 'unit_price_snapshot', 'line_total');
```

## order_item_ingredient_snapshot

Định lượng và chi phí nguyên liệu chụp theo dòng món.

Có 9 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts).

| Cột                | Kiểu PostgreSQL             | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                    |
| ------------------ | --------------------------- | ----- | --------------- | ----------------- | ------------------------------------------------------------------- |
| id                 | uuid                        | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| order_item_id      | uuid                        | Không | FK → order_item | —                 | Dòng món liên quan.                                                 |
| recipe_bom_id      | uuid                        | Không | FK → recipe_bom | —                 | Phiên bản công thức liên quan.                                      |
| ingredient_id      | uuid                        | Không | FK → ingredient | —                 | Nguyên liệu liên quan.                                              |
| planned_qty        | numeric(18,6)               | Không | —               | —                 | Lượng nguyên liệu dự kiến đã tính cho dòng món.                     |
| consumed_qty       | numeric(18,6)               | Không | —               | —                 | Lượng nguyên liệu đã tiêu hao.                                      |
| unit_cost_snapshot | numeric(18,6)               | Không | —               | —                 | Giá vốn một đơn vị chụp cho món; cập nhật theo giá vốn lúc consume. |
| cogs_value         | bigint                      | Không | —               | —                 | Giá vốn VND của nguyên liệu đã tiêu hao cho dòng món.               |
| created_at         | timestamp(6) with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                              |

### Quan hệ của order_item_ingredient_snapshot

- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_item_ingredient_snapshot

```sql
order_item_ingredient_snapshot_cogs_value_check: CHECK ((cogs_value >= 0))
order_item_ingredient_snapshot_consumed_qty_check: CHECK ((consumed_qty >= (0)::numeric))
order_item_ingredient_snapshot_planned_qty_check: CHECK ((planned_qty >= (0)::numeric))
order_item_ingredient_snapshot_unit_cost_snapshot_check: CHECK ((unit_cost_snapshot >= (0)::numeric))
core_order_item_ingredient_snapshot_f1: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_ingredient_snapshot_f2: FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_item_ingredient_snapshot_f3: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_item_ingredient_snapshot_cogs_value_not_null: NOT NULL cogs_value
order_item_ingredient_snapshot_consumed_qty_not_null: NOT NULL consumed_qty
order_item_ingredient_snapshot_created_at_not_null: NOT NULL created_at
order_item_ingredient_snapshot_id_not_null: NOT NULL id
order_item_ingredient_snapshot_ingredient_id_not_null: NOT NULL ingredient_id
order_item_ingredient_snapshot_order_item_id_not_null: NOT NULL order_item_id
order_item_ingredient_snapshot_planned_qty_not_null: NOT NULL planned_qty
order_item_ingredient_snapshot_recipe_bom_id_not_null: NOT NULL recipe_bom_id
order_item_ingredient_snapshot_unit_cost_snapshot_not_null: NOT NULL unit_cost_snapshot
order_item_ingredient_snapshot_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
order_item_ingredient_snapsho_order_item_id_recipe_bom_id_i_key: UNIQUE (order_item_id, recipe_bom_id, ingredient_id)
```

### Chỉ mục của order_item_ingredient_snapshot

```sql
CREATE INDEX core_order_item_ingredient_snapshot_fk1 ON public.order_item_ingredient_snapshot USING btree (order_item_id);
CREATE INDEX core_order_item_ingredient_snapshot_fk2 ON public.order_item_ingredient_snapshot USING btree (recipe_bom_id);
CREATE INDEX core_order_item_ingredient_snapshot_fk3 ON public.order_item_ingredient_snapshot USING btree (ingredient_id);
CREATE UNIQUE INDEX order_item_ingredient_snapsho_order_item_id_recipe_bom_id_i_key ON public.order_item_ingredient_snapshot USING btree (order_item_id, recipe_bom_id, ingredient_id);
CREATE UNIQUE INDEX order_item_ingredient_snapshot_pkey ON public.order_item_ingredient_snapshot USING btree (id);
```

### Trigger của order_item_ingredient_snapshot

```sql
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_item_ingredient_snapshot FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_item_ingredient_snapshot DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_item', 'order_item_id', 'recipe_bom', 'recipe_bom_id', 'ingredient', 'ingredient_id');
CREATE TRIGGER core_snapshot_guard BEFORE UPDATE ON public.order_item_ingredient_snapshot FOR EACH ROW EXECUTE FUNCTION core_snapshot_guard();
```

## order_review

Quyết định duyệt/từ chối lượt gọi cần kiểm tra.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts).

| Cột             | Kiểu PostgreSQL             | NULL? | Khóa             | Default           | Ý nghĩa hiện tại                                                    |
| --------------- | --------------------------- | ----- | ---------------- | ----------------- | ------------------------------------------------------------------- |
| id              | uuid                        | Không | PK               | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| order_batch_id  | uuid                        | Không | FK → order_batch | —                 | Lượt gọi liên quan.                                                 |
| status          | text                        | Không | —                | 'PENDING'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.       |
| requested_at    | timestamp(6) with time zone | Không | —                | now()             | Thời điểm lượt gọi được đưa vào quy trình chờ duyệt.                |
| expires_at      | timestamp(6) with time zone | Không | —                | —                 | Thời điểm hết hiệu lực; cách xử lý tùy đối tượng/job.               |
| reviewer_id     | uuid                        | Có    | FK → app_user    | —                 | Nhân viên quyết định duyệt/từ chối.                                 |
| decided_at      | timestamp(6) with time zone | Có    | —                | —                 | Thời điểm có quyết định.                                            |
| decision_reason | text                        | Có    | —                | —                 | Lý do quyết định duyệt/từ chối/hết hạn.                             |
| version         | integer                     | Không | —                | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at      | timestamp(6) with time zone | Không | —                | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at      | timestamp(6) with time zone | Không | —                | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của order_review

- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (reviewer_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_review

```sql
order_review_check: CHECK ((expires_at > requested_at))
order_review_check1: CHECK (((status <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text])) OR ((reviewer_id IS NOT NULL) AND (decided_at IS NOT NULL))))
order_review_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text])))
order_review_status_check1: CHECK ((length(btrim(status)) > 0))
order_review_version_check: CHECK ((version > 0))
core_order_review_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_review_f2: FOREIGN KEY (reviewer_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_review_created_at_not_null: NOT NULL created_at
order_review_expires_at_not_null: NOT NULL expires_at
order_review_id_not_null: NOT NULL id
order_review_order_batch_id_not_null: NOT NULL order_batch_id
order_review_requested_at_not_null: NOT NULL requested_at
order_review_status_not_null: NOT NULL status
order_review_updated_at_not_null: NOT NULL updated_at
order_review_version_not_null: NOT NULL version
order_review_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của order_review

```sql
CREATE INDEX core_order_review_fk1 ON public.order_review USING btree (order_batch_id);
CREATE INDEX core_order_review_fk2 ON public.order_review USING btree (reviewer_id);
CREATE UNIQUE INDEX order_review_pkey ON public.order_review USING btree (id);
CREATE UNIQUE INDEX pdm_review_pending ON public.order_review USING btree (order_batch_id) WHERE (status = 'PENDING'::text);
```

### Trigger của order_review

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.order_review FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_review FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_review DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch', 'order_batch_id', 'app_user', 'reviewer_id');
```

## order_risk_assessment

Kết quả bộ quy tắc rủi ro cùng metric, lý do và cấu hình tại thời điểm gửi.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts).

| Cột             | Kiểu PostgreSQL             | NULL? | Khóa             | Default           | Ý nghĩa hiện tại                                                                |
| --------------- | --------------------------- | ----- | ---------------- | ----------------- | ------------------------------------------------------------------------------- |
| id              | uuid                        | Không | PK               | gen_random_uuid() | Mã định danh chính của bản ghi.                                                 |
| order_batch_id  | uuid                        | Không | FK → order_batch | —                 | Lượt gọi liên quan.                                                             |
| decision        | text                        | Không | —                | —                 | Kết quả đánh giá ALLOW/REVIEW theo luồng hiện hành.                             |
| score           | numeric(18,6)               | Có    | —                | —                 | Cột điểm trong schema; submit hiện dựa reason_codes/ngưỡng, không tính điểm AI. |
| metric_snapshot | jsonb                       | Không | —                | —                 | Các chỉ số được chụp lúc đánh giá như tổng lượng/tiền.                          |
| reason_codes    | jsonb                       | Không | —                | —                 | Danh sách mã lý do phải duyệt.                                                  |
| config_version  | integer                     | Có    | —                | —                 | Phiên bản cấu hình tại lúc đánh giá.                                            |
| config_snapshot | jsonb                       | Không | —                | —                 | Bộ cấu hình chụp lúc đánh giá.                                                  |
| evaluated_at    | timestamp(6) with time zone | Không | —                | now()             | Thời điểm đánh giá rủi ro.                                                      |
| created_at      | timestamp(6) with time zone | Không | —                | now()             | Thời điểm tạo bản ghi.                                                          |

### Quan hệ của order_risk_assessment

- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_risk_assessment

```sql
order_risk_assessment_config_version_check: CHECK ((config_version >= 0))
order_risk_assessment_decision_check: CHECK ((decision = ANY (ARRAY['ALLOW'::text, 'REVIEW'::text, 'BLOCK'::text])))
order_risk_assessment_decision_check1: CHECK ((length(btrim(decision)) > 0))
core_order_risk_assessment_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_risk_assessment_config_snapshot_not_null: NOT NULL config_snapshot
order_risk_assessment_created_at_not_null: NOT NULL created_at
order_risk_assessment_decision_not_null: NOT NULL decision
order_risk_assessment_evaluated_at_not_null: NOT NULL evaluated_at
order_risk_assessment_id_not_null: NOT NULL id
order_risk_assessment_metric_snapshot_not_null: NOT NULL metric_snapshot
order_risk_assessment_order_batch_id_not_null: NOT NULL order_batch_id
order_risk_assessment_reason_codes_not_null: NOT NULL reason_codes
order_risk_assessment_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của order_risk_assessment

```sql
CREATE INDEX core_order_risk_assessment_fk1 ON public.order_risk_assessment USING btree (order_batch_id);
CREATE UNIQUE INDEX order_risk_assessment_pkey ON public.order_risk_assessment USING btree (id);
```

### Trigger của order_risk_assessment

```sql
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_risk_assessment FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER core_immutable BEFORE UPDATE ON public.order_risk_assessment FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_risk_assessment DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch', 'order_batch_id');
```

## order_status_history

Lịch sử chuyển trạng thái lượt gọi/dòng món và tác nhân.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts).

| Cột                  | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                        |
| -------------------- | --------------------------- | ----- | ------------------------ | ----------------- | --------------------------------------- |
| id                   | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.         |
| order_batch_id       | uuid                        | Không | FK → order_batch         | —                 | Lượt gọi liên quan.                     |
| order_item_id        | uuid                        | Có    | FK → order_item          | —                 | Dòng món liên quan.                     |
| old_status           | text                        | Có    | —                        | —                 | Trạng thái trước chuyển đổi.            |
| new_status           | text                        | Không | —                        | —                 | Trạng thái sau chuyển đổi.              |
| actor_type           | text                        | Không | —                        | —                 | Loại tác nhân; đọc CHECK cho từng bảng. |
| reason               | text                        | Có    | —                        | —                 | Lý do nghiệp vụ của thao tác.           |
| changed_at           | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm thay đổi trạng thái.          |
| actor_user_id        | uuid                        | Có    | FK → app_user            | —                 | Tài khoản nội bộ khi tác nhân là USER.  |
| actor_participant_id | uuid                        | Có    | FK → session_participant | —                 | Người tham gia khi tác nhân là GUEST.   |
| created_at           | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                  |

### Quan hệ của order_status_history

- FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của order_status_history

```sql
order_status_history_actor_type_check: CHECK ((actor_type = ANY (ARRAY['USER'::text, 'GUEST'::text, 'SYSTEM'::text])))
order_status_history_actor_type_check1: CHECK ((length(btrim(actor_type)) > 0))
order_status_history_check: CHECK (((((actor_type = 'USER'::text) AND (actor_user_id IS NOT NULL) AND (actor_participant_id IS NULL)) OR ((actor_type = 'GUEST'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NOT NULL)) OR ((actor_type = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (actor_participant_id IS NULL))) IS TRUE))
order_status_history_new_status_check: CHECK ((length(btrim(new_status)) > 0))
core_order_status_history_f1: FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f2: FOREIGN KEY (actor_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f4: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_order_status_history_f5: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
order_status_history_actor_type_not_null: NOT NULL actor_type
order_status_history_changed_at_not_null: NOT NULL changed_at
order_status_history_created_at_not_null: NOT NULL created_at
order_status_history_id_not_null: NOT NULL id
order_status_history_new_status_not_null: NOT NULL new_status
order_status_history_order_batch_id_not_null: NOT NULL order_batch_id
order_status_history_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của order_status_history

```sql
CREATE INDEX core_order_status_history_fk1 ON public.order_status_history USING btree (actor_user_id);
CREATE INDEX core_order_status_history_fk2 ON public.order_status_history USING btree (actor_participant_id);
CREATE INDEX core_order_status_history_fk4 ON public.order_status_history USING btree (order_batch_id);
CREATE INDEX core_order_status_history_fk5 ON public.order_status_history USING btree (order_item_id);
CREATE UNIQUE INDEX order_status_history_pkey ON public.order_status_history USING btree (id);
```

### Trigger của order_status_history

```sql
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER core_immutable BEFORE UPDATE ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.order_status_history DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'actor_user_id', 'session_participant', 'actor_participant_id', 'order_batch', 'order_batch_id', 'order_item', 'order_item_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION core_session_guard();
```

## outbox_event

Sự kiện nghiệp vụ lưu cùng transaction, được bảo trì phát sau.

Có 13 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts).

| Cột                    | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                   |
| ---------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------ |
| id                     | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| aggregate_type         | text                        | Không | —                        | —                 | Loại đối tượng nghiệp vụ phát sinh sự kiện.                        |
| event_type             | text                        | Không | —                        | —                 | Tên sự kiện nghiệp vụ.                                             |
| payload                | jsonb                       | Không | —                        | —                 | Nội dung sự kiện JSON.                                             |
| status                 | text                        | Không | —                        | 'PENDING'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| attempts               | integer                     | Không | —                        | 0                 | Số lần xử lý được ghi cho sự kiện.                                 |
| available_at           | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm sự kiện đủ điều kiện được phát.                          |
| published_at           | timestamp(6) with time zone | Có    | —                        | —                 | Thời điểm outbox được đánh dấu PUBLISHED.                          |
| order_batch_id         | uuid                        | Có    | FK → order_batch         | —                 | Lượt gọi liên quan.                                                |
| payment_transaction_id | uuid                        | Có    | FK → payment_transaction | —                 | Giao dịch thu tiền liên quan.                                      |
| created_at             | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at             | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |
| support_request_id     | uuid                        | Có    | FK → support_request     | —                 | Yêu cầu hỗ trợ gốc; khóa ngoại, giữ quan hệ với phiên và nhà hàng. |

### Quan hệ của outbox_event

- FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của outbox_event

```sql
outbox_event_aggregate_type_check: CHECK ((aggregate_type = ANY (ARRAY['ORDER_BATCH'::text, 'PAYMENT_TRANSACTION'::text, 'SUPPORT_REQUEST'::text])))
outbox_event_aggregate_type_check1: CHECK ((length(btrim(aggregate_type)) > 0))
outbox_event_attempts_check: CHECK ((attempts >= 0))
outbox_event_check: CHECK (((((aggregate_type = 'ORDER_BATCH'::text) AND (order_batch_id IS NOT NULL) AND (payment_transaction_id IS NULL) AND (support_request_id IS NULL)) OR ((aggregate_type = 'PAYMENT_TRANSACTION'::text) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NOT NULL) AND (support_request_id IS NULL)) OR ((aggregate_type = 'SUPPORT_REQUEST'::text) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NULL) AND (support_request_id IS NOT NULL))) IS TRUE))
outbox_event_check1: CHECK (((status <> 'PUBLISHED'::text) OR (published_at IS NOT NULL)))
outbox_event_event_type_check: CHECK ((length(btrim(event_type)) > 0))
outbox_event_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'PUBLISHED'::text, 'FAILED'::text])))
outbox_event_status_check1: CHECK ((length(btrim(status)) > 0))
outbox_support_aggregate: CHECK ((((aggregate_type = 'SUPPORT_REQUEST'::text) AND (support_request_id IS NOT NULL) AND (order_batch_id IS NULL) AND (payment_transaction_id IS NULL)) OR ((aggregate_type <> 'SUPPORT_REQUEST'::text) AND (support_request_id IS NULL))))
core_outbox_event_f1: FOREIGN KEY (order_batch_id) REFERENCES order_batch(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outbox_event_f2: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outbox_event_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outbox_event_aggregate_type_not_null: NOT NULL aggregate_type
outbox_event_attempts_not_null: NOT NULL attempts
outbox_event_available_at_not_null: NOT NULL available_at
outbox_event_created_at_not_null: NOT NULL created_at
outbox_event_event_type_not_null: NOT NULL event_type
outbox_event_id_not_null: NOT NULL id
outbox_event_payload_not_null: NOT NULL payload
outbox_event_status_not_null: NOT NULL status
outbox_event_updated_at_not_null: NOT NULL updated_at
outbox_event_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
outbox_support_tenant: TRIGGER DEFERRABLE
```

### Chỉ mục của outbox_event

```sql
CREATE INDEX core_outbox_event_fk1 ON public.outbox_event USING btree (order_batch_id);
CREATE INDEX core_outbox_event_fk2 ON public.outbox_event USING btree (payment_transaction_id);
CREATE UNIQUE INDEX outbox_event_pkey ON public.outbox_event USING btree (id);
CREATE INDEX outbox_support_request ON public.outbox_event USING btree (support_request_id);
CREATE INDEX pdm_outbox_ready ON public.outbox_event USING btree (status, available_at);
```

### Trigger của outbox_event

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.outbox_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.outbox_event DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('order_batch', 'order_batch_id', 'payment_transaction', 'payment_transaction_id');
CREATE CONSTRAINT TRIGGER outbox_support_tenant AFTER INSERT OR UPDATE ON public.outbox_event DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('support_request', 'support_request_id');
```

## outstanding_balance_case

Hồ sơ thiếu tiền để thu hồi hoặc quản trị ghi nhận không thu được.

Có 14 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts).

| Cột                | Kiểu PostgreSQL             | NULL? | Khóa               | Default                      | Ý nghĩa hiện tại                                                   |
| ------------------ | --------------------------- | ----- | ------------------ | ---------------------------- | ------------------------------------------------------------------ |
| id                 | uuid                        | Không | PK                 | gen_random_uuid()            | Mã định danh chính của bản ghi.                                    |
| session_id         | uuid                        | Không | FK → table_session | —                            | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                    |
| table_id           | uuid                        | Không | FK → dining_table  | —                            | Bàn liên quan; với phiên đây là bàn hiện tại.                      |
| invoice_total      | bigint                      | Không | —                  | —                            | Tổng phải thu chụp khi lập hồ sơ thiếu tiền.                       |
| paid_total         | bigint                      | Không | —                  | 0                            | Tổng giao dịch nhận tiền thành công; hồ sơ có thể giữ snapshot.    |
| outstanding_amount | bigint                      | Không | —                  | 0                            | Số tiền còn thiếu hoặc số dư được chụp tại hồ sơ/cảnh báo.         |
| reason_code        | text                        | Không | —                  | —                            | Mã phân loại nguyên nhân thiếu tiền.                               |
| status             | text                        | Không | —                  | 'PENDING_ADMIN_REVIEW'::text | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| reported_by        | uuid                        | Không | FK → app_user      | —                            | Nhân viên báo cáo sự việc.                                         |
| admin_owner        | uuid                        | Có    | FK → app_user      | —                            | Quản trị xử lý hồ sơ.                                              |
| evidence_ref       | text                        | Có    | —                  | —                            | Tham chiếu bằng chứng nghiệp vụ nếu có.                            |
| notes              | text                        | Có    | —                  | —                            | Ghi chú/diễn biến xử lý.                                           |
| created_at         | timestamp(6) with time zone | Không | —                  | now()                        | Thời điểm tạo bản ghi.                                             |
| updated_at         | timestamp(6) with time zone | Không | —                  | now()                        | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của outstanding_balance_case

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (reported_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (admin_owner) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của outstanding_balance_case

```sql
outstanding_balance_case_invoice_total_check: CHECK ((invoice_total >= 0))
outstanding_balance_case_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
outstanding_balance_case_paid_total_check: CHECK ((paid_total >= 0))
outstanding_balance_case_reason_code_check: CHECK ((length(btrim(reason_code)) > 0))
outstanding_balance_case_status_check: CHECK ((status = ANY (ARRAY['PENDING_ADMIN_REVIEW'::text, 'IN_RECOVERY'::text, 'PARTIALLY_RECOVERED'::text, 'RECOVERED'::text, 'WRITTEN_OFF'::text, 'CANCELLED'::text])))
outstanding_balance_case_status_check1: CHECK ((length(btrim(status)) > 0))
core_outstanding_balance_case_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f2: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f3: FOREIGN KEY (reported_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_outstanding_balance_case_f4: FOREIGN KEY (admin_owner) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
outstanding_balance_case_created_at_not_null: NOT NULL created_at
outstanding_balance_case_id_not_null: NOT NULL id
outstanding_balance_case_invoice_total_not_null: NOT NULL invoice_total
outstanding_balance_case_outstanding_amount_not_null: NOT NULL outstanding_amount
outstanding_balance_case_paid_total_not_null: NOT NULL paid_total
outstanding_balance_case_reason_code_not_null: NOT NULL reason_code
outstanding_balance_case_reported_by_not_null: NOT NULL reported_by
outstanding_balance_case_session_id_not_null: NOT NULL session_id
outstanding_balance_case_status_not_null: NOT NULL status
outstanding_balance_case_table_id_not_null: NOT NULL table_id
outstanding_balance_case_updated_at_not_null: NOT NULL updated_at
outstanding_balance_case_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của outstanding_balance_case

```sql
CREATE INDEX core_outstanding_balance_case_fk1 ON public.outstanding_balance_case USING btree (session_id);
CREATE INDEX core_outstanding_balance_case_fk2 ON public.outstanding_balance_case USING btree (table_id);
CREATE INDEX core_outstanding_balance_case_fk3 ON public.outstanding_balance_case USING btree (reported_by);
CREATE INDEX core_outstanding_balance_case_fk4 ON public.outstanding_balance_case USING btree (admin_owner);
CREATE UNIQUE INDEX outstanding_balance_case_pkey ON public.outstanding_balance_case USING btree (id);
CREATE UNIQUE INDEX pdm_outstanding_open ON public.outstanding_balance_case USING btree (session_id) WHERE (status <> ALL (ARRAY['RECOVERED'::text, 'WRITTEN_OFF'::text, 'CANCELLED'::text]));
```

### Trigger của outstanding_balance_case

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.outstanding_balance_case DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'dining_table', 'table_id', 'app_user', 'reported_by', 'app_user', 'admin_owner');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.outstanding_balance_case FOR EACH ROW EXECUTE FUNCTION table_incident_guard();
```

## payment_allocation

Phân bổ tiền của giao dịch vào khoản phải thu, theo dõi phần đã đảo.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts).

| Cột                    | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                   |
| ---------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------ |
| id                     | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| payment_transaction_id | uuid                        | Không | FK → payment_transaction | —                 | Giao dịch thu tiền liên quan.                                      |
| financial_charge_id    | uuid                        | Không | FK → financial_charge    | —                 | Khoản phải thu được phân bổ tiền.                                  |
| allocated_amount       | bigint                      | Không | —                        | —                 | Số VND đã phân bổ từ giao dịch vào khoản thu.                      |
| reversed_amount        | bigint                      | Không | —                        | 0                 | Phần phân bổ đã đảo sau hủy/miễn.                                  |
| created_at             | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at             | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của payment_allocation

- FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (financial_charge_id) REFERENCES financial_charge(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của payment_allocation

```sql
payment_allocation_allocated_amount_check: CHECK ((allocated_amount >= 0))
payment_allocation_check: CHECK ((reversed_amount <= allocated_amount))
payment_allocation_reversed_amount_check: CHECK ((reversed_amount >= 0))
core_payment_allocation_f1: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_allocation_f2: FOREIGN KEY (financial_charge_id) REFERENCES financial_charge(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_allocation_allocated_amount_not_null: NOT NULL allocated_amount
payment_allocation_created_at_not_null: NOT NULL created_at
payment_allocation_financial_charge_id_not_null: NOT NULL financial_charge_id
payment_allocation_id_not_null: NOT NULL id
payment_allocation_payment_transaction_id_not_null: NOT NULL payment_transaction_id
payment_allocation_reversed_amount_not_null: NOT NULL reversed_amount
payment_allocation_updated_at_not_null: NOT NULL updated_at
payment_allocation_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_allocation_payment_transaction_id_financial_charge__key: UNIQUE (payment_transaction_id, financial_charge_id)
```

### Chỉ mục của payment_allocation

```sql
CREATE INDEX core_payment_allocation_fk1 ON public.payment_allocation USING btree (payment_transaction_id);
CREATE INDEX core_payment_allocation_fk2 ON public.payment_allocation USING btree (financial_charge_id);
CREATE UNIQUE INDEX payment_allocation_payment_transaction_id_financial_charge__key ON public.payment_allocation USING btree (payment_transaction_id, financial_charge_id);
CREATE UNIQUE INDEX payment_allocation_pkey ON public.payment_allocation USING btree (id);
```

### Trigger của payment_allocation

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.payment_allocation DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_transaction', 'payment_transaction_id', 'financial_charge', 'financial_charge_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_allocation_snapshot BEFORE UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('payment_transaction_id', 'financial_charge_id', 'allocated_amount');
CREATE TRIGGER core_allocation_guard BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION core_allocation_guard();
```

## payment_intent

Yêu cầu thanh toán; API hiện tạo CASH hoặc BANK_TRANSFER.

Có 17 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts).

| Cột                  | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                                                                                                    |
| -------------------- | --------------------------- | ----- | ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                   | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                                                                                                     |
| session_id           | uuid                        | Không | FK → table_session       | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                                                                                                     |
| payer_participant_id | uuid                        | Có    | FK → session_participant | —                 | Khách đề nghị thanh toán; có thể rỗng khi nhân viên tạo.                                                                                            |
| method               | text                        | Không | —                        | —                 | Phương thức tiền; các route hiện giới hạn theo nghiệp vụ.                                                                                           |
| amount               | bigint                      | Không | —                        | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.                                                                                       |
| currency             | text                        | Không | —                        | 'VND'::text       | Mã tiền tệ, hiện VND.                                                                                                                               |
| status               | text                        | Không | —                        | 'CREATED'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                                                                                       |
| client_request_id    | text                        | Không | —                        | —                 | Mã yêu cầu từ client lưu tại đối tượng nghiệp vụ.                                                                                                   |
| provider             | text                        | Có    | —                        | —                 | Tên bộ kết nối/cổng thanh toán nếu có.                                                                                                              |
| provider_reference   | text                        | Có    | —                        | —                 | Mã tham chiếu ở phía provider; chưa có luồng checkout online đầy đủ.                                                                                |
| expires_at           | timestamp(6) with time zone | Không | —                        | —                 | Thời điểm hết hiệu lực; cách xử lý tùy đối tượng/job.                                                                                               |
| version              | integer                     | Không | —                        | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng.                                                                                 |
| created_at           | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                                                                                                              |
| updated_at           | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.                                                                                  |
| collection_scope     | text                        | Không | —                        | 'TABLE'::text     | Phạm vi TABLE hoặc PARTICIPANT của khoản thu; mặc định TABLE với giao dịch cũ.                                                                      |
| support_request_id   | uuid                        | Có    | FK → support_request     | —                 | Lời gọi BILL đang được khoản thu xử lý; NULL khi thu trực tiếp và không có lời gọi BILL đang mở; khi có lời gọi phải nhận và liên kết đúng yêu cầu. |
| proof                | jsonb                       | Có    | —                        | —                 | Metadata ảnh chứng từ do server tạo: tên tệp riêng, SHA256, MIME, người tải và thời gian; không chứa base64 toàn ảnh.                               |

### Quan hệ của payment_intent

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (payer_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của payment_intent

```sql
payment_collection_scope: CHECK (((collection_scope = ANY (ARRAY['TABLE'::text, 'PARTICIPANT'::text])) AND ((collection_scope <> 'PARTICIPANT'::text) OR (payer_participant_id IS NOT NULL))))
payment_intent_amount_check: CHECK ((amount > 0))
payment_intent_check: CHECK ((expires_at > created_at))
payment_intent_client_request_id_check: CHECK ((length(btrim(client_request_id)) > 0))
payment_intent_currency_check: CHECK ((length(btrim(currency)) > 0))
payment_intent_currency_check1: CHECK ((currency = 'VND'::text))
payment_intent_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'ONLINE'::text])))
payment_intent_method_check1: CHECK ((length(btrim(method)) > 0))
payment_intent_status_check: CHECK ((status = ANY (ARRAY['CREATED'::text, 'PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'EXPIRED'::text, 'CANCELLED'::text, 'REQUIRES_RECONCILIATION'::text])))
payment_intent_status_check1: CHECK ((length(btrim(status)) > 0))
payment_intent_version_check: CHECK ((version > 0))
core_payment_intent_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_intent_f2: FOREIGN KEY (payer_participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_intent_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON DELETE RESTRICT
payment_intent_amount_not_null: NOT NULL amount
payment_intent_client_request_id_not_null: NOT NULL client_request_id
payment_intent_collection_scope_not_null: NOT NULL collection_scope
payment_intent_created_at_not_null: NOT NULL created_at
payment_intent_currency_not_null: NOT NULL currency
payment_intent_expires_at_not_null: NOT NULL expires_at
payment_intent_id_not_null: NOT NULL id
payment_intent_method_not_null: NOT NULL method
payment_intent_session_id_not_null: NOT NULL session_id
payment_intent_status_not_null: NOT NULL status
payment_intent_updated_at_not_null: NOT NULL updated_at
payment_intent_version_not_null: NOT NULL version
payment_intent_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_intent_session_id_client_request_id_key: UNIQUE (session_id, client_request_id)
```

### Chỉ mục của payment_intent

```sql
CREATE INDEX core_payment_intent_fk1 ON public.payment_intent USING btree (session_id);
CREATE INDEX core_payment_intent_fk2 ON public.payment_intent USING btree (payer_participant_id);
CREATE UNIQUE INDEX payment_intent_pkey ON public.payment_intent USING btree (id);
CREATE UNIQUE INDEX payment_intent_session_id_client_request_id_key ON public.payment_intent USING btree (session_id, client_request_id);
CREATE INDEX payment_intent_support_request ON public.payment_intent USING btree (support_request_id);
CREATE UNIQUE INDEX pdm_pending_online ON public.payment_intent USING btree (session_id) WHERE ((method = 'ONLINE'::text) AND (status = ANY (ARRAY['CREATED'::text, 'PENDING'::text])));
```

### Trigger của payment_intent

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.payment_intent FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.payment_intent FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.payment_intent DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'session_participant', 'payer_participant_id');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.payment_intent FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_intent_snapshot BEFORE UPDATE ON public.payment_intent FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id', 'payer_participant_id', 'method', 'amount', 'currency', 'client_request_id');
```

## payment_transaction

Ghi nhận tiền đã nhận; không đồng nghĩa một yêu cầu chờ.

Có 14 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts).

| Cột                     | Kiểu PostgreSQL             | NULL? | Khóa                | Default           | Ý nghĩa hiện tại                                                                    |
| ----------------------- | --------------------------- | ----- | ------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| id                      | uuid                        | Không | PK                  | gen_random_uuid() | Mã định danh chính của bản ghi.                                                     |
| payment_intent_id       | uuid                        | Có    | FK → payment_intent | —                 | Yêu cầu thanh toán liên quan.                                                       |
| session_id              | uuid                        | Không | FK → table_session  | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                                     |
| method                  | text                        | Không | —                   | —                 | Phương thức tiền; các route hiện giới hạn theo nghiệp vụ.                           |
| provider                | text                        | Có    | —                   | —                 | Tên bộ kết nối/cổng thanh toán nếu có.                                              |
| provider_transaction_id | text                        | Có    | —                   | —                 | Mã giao dịch provider dùng đối soát/chống trùng.                                    |
| amount                  | bigint                      | Không | —                   | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.                       |
| currency                | text                        | Không | —                   | 'VND'::text       | Mã tiền tệ, hiện VND.                                                               |
| status                  | text                        | Không | —                   | 'PENDING'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                       |
| confirmed_by            | uuid                        | Có    | FK → app_user       | —                 | Nhân viên xác nhận nhận tiền nếu thủ công.                                          |
| confirmed_at            | timestamp(6) with time zone | Có    | —                   | —                 | Thời điểm ghi nhận tiền.                                                            |
| metadata                | jsonb                       | Có    | —                   | —                 | Chi tiết bổ sung JSON; tiền mặt/chuyển khoản lưu tham chiếu, tiền đưa và tiền thừa. |
| created_at              | timestamp(6) with time zone | Không | —                   | now()             | Thời điểm tạo bản ghi.                                                              |
| updated_at              | timestamp(6) with time zone | Không | —                   | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.                  |

### Quan hệ của payment_transaction

- FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (confirmed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của payment_transaction

```sql
core_success_confirmation: CHECK (((status <> 'SUCCEEDED'::text) OR (confirmed_at IS NOT NULL)))
payment_transaction_amount_check: CHECK ((amount > 0))
payment_transaction_check: CHECK (((provider IS NULL) = (provider_transaction_id IS NULL)))
payment_transaction_currency_check: CHECK ((length(btrim(currency)) > 0))
payment_transaction_currency_check1: CHECK ((currency = 'VND'::text))
payment_transaction_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text, 'ONLINE'::text])))
payment_transaction_method_check1: CHECK ((length(btrim(method)) > 0))
payment_transaction_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])))
payment_transaction_status_check1: CHECK ((length(btrim(status)) > 0))
core_payment_transaction_f1: FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_transaction_f2: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_payment_transaction_f3: FOREIGN KEY (confirmed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_transaction_amount_not_null: NOT NULL amount
payment_transaction_created_at_not_null: NOT NULL created_at
payment_transaction_currency_not_null: NOT NULL currency
payment_transaction_id_not_null: NOT NULL id
payment_transaction_method_not_null: NOT NULL method
payment_transaction_session_id_not_null: NOT NULL session_id
payment_transaction_status_not_null: NOT NULL status
payment_transaction_updated_at_not_null: NOT NULL updated_at
payment_transaction_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của payment_transaction

```sql
CREATE UNIQUE INDEX core_intent_capture ON public.payment_transaction USING btree (payment_intent_id) WHERE ((payment_intent_id IS NOT NULL) AND (status = 'SUCCEEDED'::text));
CREATE INDEX core_payment_transaction_fk1 ON public.payment_transaction USING btree (payment_intent_id);
CREATE INDEX core_payment_transaction_fk2 ON public.payment_transaction USING btree (session_id);
CREATE INDEX core_payment_transaction_fk3 ON public.payment_transaction USING btree (confirmed_by);
CREATE UNIQUE INDEX payment_transaction_pkey ON public.payment_transaction USING btree (id);
CREATE UNIQUE INDEX pdm_provider_tx ON public.payment_transaction USING btree (provider, provider_transaction_id) WHERE (provider IS NOT NULL);
```

### Trigger của payment_transaction

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.payment_transaction FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.payment_transaction FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.payment_transaction DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_intent', 'payment_intent_id', 'table_session', 'session_id', 'app_user', 'confirmed_by');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.payment_transaction FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE TRIGGER core_payment_snapshot BEFORE UPDATE ON public.payment_transaction FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('payment_intent_id', 'session_id', 'method', 'amount', 'currency', 'provider', 'provider_transaction_id');
```

## payment_webhook_event

Thông báo từ connector thanh toán; phần nền, chưa phải tích hợp trực tiếp một cổng cụ thể.

Có 13 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts).

| Cột                     | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                   |
| ----------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------ |
| id                      | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| provider                | text                        | Không | —                        | —                 | Tên bộ kết nối/cổng thanh toán nếu có.                             |
| provider_event_id       | text                        | Không | —                        | —                 | Mã sự kiện provider để chống webhook trùng.                        |
| provider_transaction_id | text                        | Có    | —                        | —                 | Mã giao dịch provider dùng đối soát/chống trùng.                   |
| payload_hash            | text                        | Không | —                        | —                 | Hash nội dung webhook chuẩn hóa.                                   |
| payload_snapshot        | jsonb                       | Không | —                        | —                 | Nội dung webhook chuẩn hóa đã nhận.                                |
| signature_valid         | boolean                     | Không | —                        | —                 | Kết quả xác minh chữ ký ở luồng connector.                         |
| processing_status       | text                        | Không | —                        | 'RECEIVED'::text  | Trạng thái xử lý webhook: xem CHECK và code.                       |
| received_at             | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tiếp nhận: duyệt nhập kho hoặc bếp nhận món tùy bảng.    |
| processed_at            | timestamp(6) with time zone | Có    | —                        | —                 | Thời điểm xử lý hoàn tất.                                          |
| payment_transaction_id  | uuid                        | Có    | FK → payment_transaction | —                 | Giao dịch thu tiền liên quan.                                      |
| created_at              | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at              | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của payment_webhook_event

- FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của payment_webhook_event

```sql
payment_webhook_event_check: CHECK (((processing_status <> 'PROCESSED'::text) OR ((signature_valid IS TRUE) AND (payment_transaction_id IS NOT NULL) AND (processed_at IS NOT NULL))))
payment_webhook_event_payload_hash_check: CHECK ((length(btrim(payload_hash)) > 0))
payment_webhook_event_processing_status_check: CHECK ((processing_status = ANY (ARRAY['RECEIVED'::text, 'UNMATCHED'::text, 'PROCESSED'::text, 'REJECTED'::text, 'FAILED'::text])))
payment_webhook_event_processing_status_check1: CHECK ((length(btrim(processing_status)) > 0))
payment_webhook_event_provider_event_id_check: CHECK ((length(btrim(provider_event_id)) > 0))
core_payment_webhook_event_f1: FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
payment_webhook_event_created_at_not_null: NOT NULL created_at
payment_webhook_event_id_not_null: NOT NULL id
payment_webhook_event_payload_hash_not_null: NOT NULL payload_hash
payment_webhook_event_payload_snapshot_not_null: NOT NULL payload_snapshot
payment_webhook_event_processing_status_not_null: NOT NULL processing_status
payment_webhook_event_provider_event_id_not_null: NOT NULL provider_event_id
payment_webhook_event_provider_not_null: NOT NULL provider
payment_webhook_event_received_at_not_null: NOT NULL received_at
payment_webhook_event_signature_valid_not_null: NOT NULL signature_valid
payment_webhook_event_updated_at_not_null: NOT NULL updated_at
payment_webhook_event_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
payment_webhook_event_provider_provider_event_id_key: UNIQUE (provider, provider_event_id)
```

### Chỉ mục của payment_webhook_event

```sql
CREATE INDEX core_payment_webhook_event_fk1 ON public.payment_webhook_event USING btree (payment_transaction_id);
CREATE UNIQUE INDEX payment_webhook_event_pkey ON public.payment_webhook_event USING btree (id);
CREATE UNIQUE INDEX payment_webhook_event_provider_provider_event_id_key ON public.payment_webhook_event USING btree (provider, provider_event_id);
```

### Trigger của payment_webhook_event

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.payment_webhook_event FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.payment_webhook_event FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.payment_webhook_event DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('payment_transaction', 'payment_transaction_id');
```

## payroll_line

Dòng công, thưởng hoặc khấu trừ trên phiếu lương.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts).

| Cột                  | Kiểu PostgreSQL          | NULL? | Khóa                                              | Default           | Ý nghĩa hiện tại                                              |
| -------------------- | ------------------------ | ----- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| id                   | uuid                     | Không | PK                                                | gen_random_uuid() | Mã định danh chính của bản ghi.                               |
| restaurant_id        | uuid                     | Không | FK → app_user; FK → payroll_slip; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                              |
| payroll_slip_id      | uuid                     | Không | FK → payroll_slip                                 | —                 | Phiếu lương chứa dòng/ghi nhận chi.                           |
| attendance_id        | uuid                     | Có    | FK → attendance_record                            | —                 | Bản ghi công nguồn của dòng lương WORK.                       |
| line_type            | text                     | Không | —                                                 | —                 | Loại dòng lương WORK/BONUS/DEDUCTION.                         |
| description          | text                     | Không | —                                                 | —                 | Mô tả nghiệp vụ của bản ghi.                                  |
| minutes              | integer                  | Có    | —                                                 | —                 | Số phút công đưa vào dòng lương.                              |
| hourly_rate_snapshot | bigint                   | Có    | —                                                 | —                 | Đơn giá giờ chụp khi duyệt/tạo dòng công.                     |
| amount               | bigint                   | Không | —                                                 | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK. |
| created_by           | uuid                     | Không | FK → app_user                                     | —                 | Tài khoản tạo bản ghi.                                        |
| created_at           | timestamp with time zone | Không | —                                                 | now()             | Thời điểm tạo bản ghi.                                        |

### Quan hệ của payroll_line

- FOREIGN KEY (attendance_id) REFERENCES attendance_record(id); mỗi dòng con → 0..1 cha; mỗi cha → 0..1 con.
- FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của payroll_line

```sql
payroll_line_amount_check: CHECK (((amount >= '-100000000000'::bigint) AND (amount <= '100000000000'::bigint)))
payroll_line_check: CHECK ((((line_type = 'WORK'::text) AND (attendance_id IS NOT NULL) AND (minutes >= 0) AND (minutes IS NOT NULL) AND (hourly_rate_snapshot IS NOT NULL) AND (amount >= 0)) OR ((line_type = 'BONUS'::text) AND (attendance_id IS NULL) AND (minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount > 0)) OR ((line_type = 'DEDUCTION'::text) AND (attendance_id IS NULL) AND (minutes IS NULL) AND (hourly_rate_snapshot IS NULL) AND (amount < 0))))
payroll_line_description_check: CHECK (((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 500)))
payroll_line_line_type_check: CHECK ((line_type = ANY (ARRAY['WORK'::text, 'BONUS'::text, 'DEDUCTION'::text])))
payroll_line_attendance_id_fkey: FOREIGN KEY (attendance_id) REFERENCES attendance_record(id)
payroll_line_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_line_payroll_slip_id_restaurant_id_fkey: FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id)
payroll_line_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_line_amount_not_null: NOT NULL amount
payroll_line_created_at_not_null: NOT NULL created_at
payroll_line_created_by_not_null: NOT NULL created_by
payroll_line_description_not_null: NOT NULL description
payroll_line_id_not_null: NOT NULL id
payroll_line_line_type_not_null: NOT NULL line_type
payroll_line_payroll_slip_id_not_null: NOT NULL payroll_slip_id
payroll_line_restaurant_id_not_null: NOT NULL restaurant_id
payroll_line_pkey: PRIMARY KEY (id)
payroll_line_attendance_id_key: UNIQUE (attendance_id)
```

### Chỉ mục của payroll_line

```sql
CREATE UNIQUE INDEX payroll_line_attendance_id_key ON public.payroll_line USING btree (attendance_id);
CREATE UNIQUE INDEX payroll_line_pkey ON public.payroll_line USING btree (id);
CREATE INDEX payroll_line_slip_idx ON public.payroll_line USING btree (payroll_slip_id);
```

### Trigger của payroll_line

```sql
CREATE TRIGGER payroll_guard BEFORE INSERT OR DELETE OR UPDATE ON public.payroll_line FOR EACH ROW EXECUTE FUNCTION payroll_guard();
```

## payroll_payment

Dấu ghi nhận đã chi tiền lương và tham chiếu.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts).

| Cột             | Kiểu PostgreSQL          | NULL? | Khóa                                              | Default           | Ý nghĩa hiện tại                                              |
| --------------- | ------------------------ | ----- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| id              | uuid                     | Không | PK                                                | gen_random_uuid() | Mã định danh chính của bản ghi.                               |
| restaurant_id   | uuid                     | Không | FK → app_user; FK → payroll_slip; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                              |
| payroll_slip_id | uuid                     | Không | FK → payroll_slip                                 | —                 | Phiếu lương chứa dòng/ghi nhận chi.                           |
| amount          | bigint                   | Không | —                                                 | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK. |
| reference       | text                     | Không | —                                                 | —                 | Tham chiếu chuyển/chi tiền thủ công.                          |
| paid_by         | uuid                     | Không | FK → app_user                                     | —                 | Người ghi nhận đã chi lương.                                  |
| paid_at         | timestamp with time zone | Không | —                                                 | now()             | Thời điểm ghi nhận chi lương.                                 |

### Quan hệ của payroll_payment

- FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..1 con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của payroll_payment

```sql
payroll_payment_amount_check: CHECK ((amount > 0))
payroll_payment_reference_check: CHECK ((length(btrim(reference)) > 0))
payroll_payment_paid_by_restaurant_id_fkey: FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_payment_payroll_slip_id_restaurant_id_fkey: FOREIGN KEY (payroll_slip_id, restaurant_id) REFERENCES payroll_slip(id, restaurant_id)
payroll_payment_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_payment_amount_not_null: NOT NULL amount
payroll_payment_id_not_null: NOT NULL id
payroll_payment_paid_at_not_null: NOT NULL paid_at
payroll_payment_paid_by_not_null: NOT NULL paid_by
payroll_payment_payroll_slip_id_not_null: NOT NULL payroll_slip_id
payroll_payment_reference_not_null: NOT NULL reference
payroll_payment_restaurant_id_not_null: NOT NULL restaurant_id
payroll_payment_pkey: PRIMARY KEY (id)
payroll_payment_payroll_slip_id_key: UNIQUE (payroll_slip_id)
```

### Chỉ mục của payroll_payment

```sql
CREATE UNIQUE INDEX payroll_payment_payroll_slip_id_key ON public.payroll_payment USING btree (payroll_slip_id);
CREATE UNIQUE INDEX payroll_payment_pkey ON public.payroll_payment USING btree (id);
```

### Trigger của payroll_payment

```sql
CREATE TRIGGER payroll_payment_guard BEFORE INSERT ON public.payroll_payment FOR EACH ROW EXECUTE FUNCTION payroll_payment_guard();
CREATE TRIGGER payroll_payment_immutable BEFORE DELETE OR UPDATE ON public.payroll_payment FOR EACH ROW EXECUTE FUNCTION core_immutable();
```

## payroll_run

Kỳ lương DRAFT/FINALIZED/PAID, khoảng ngày kết thúc không bao gồm.

Có 13 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột               | Kiểu PostgreSQL          | NULL? | Khóa                                                         | Default           | Ý nghĩa hiện tại                                                   |
| ----------------- | ------------------------ | ----- | ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------ |
| id                | uuid                     | Không | PK                                                           | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id     | uuid                     | Không | FK → app_user; FK → app_user; FK → app_user; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| period_start      | date                     | Không | —                                                            | —                 | Ngày đầu kỳ lương, có tính vào kỳ.                                 |
| period_end        | date                     | Không | —                                                            | —                 | Ngày kết thúc kỳ lương, không tính vào kỳ.                         |
| status            | text                     | Không | —                                                            | 'DRAFT'::text     | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| created_by        | uuid                     | Không | FK → app_user                                                | —                 | Tài khoản tạo bản ghi.                                             |
| finalized_by      | uuid                     | Có    | FK → app_user                                                | —                 | Quản trị chốt kỳ.                                                  |
| finalized_at      | timestamp with time zone | Có    | —                                                            | —                 | Thời điểm chốt kỳ.                                                 |
| paid_by           | uuid                     | Có    | FK → app_user                                                | —                 | Người ghi nhận đã chi lương.                                       |
| paid_at           | timestamp with time zone | Có    | —                                                            | —                 | Thời điểm ghi nhận chi lương.                                      |
| payment_reference | text                     | Có    | —                                                            | —                 | Tham chiếu ghi nhận chi toàn kỳ lương.                             |
| created_at        | timestamp with time zone | Không | —                                                            | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at        | timestamp with time zone | Không | —                                                            | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của payroll_run

- FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (finalized_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của payroll_run

```sql
payroll_run_check: CHECK (((period_end > period_start) AND (period_end <= (period_start + 62))))
payroll_run_check1: CHECK ((((status = 'DRAFT'::text) AND (finalized_at IS NULL) AND (finalized_by IS NULL) AND (paid_at IS NULL) AND (paid_by IS NULL) AND (payment_reference IS NULL)) OR ((status = 'FINALIZED'::text) AND (finalized_at IS NOT NULL) AND (finalized_by IS NOT NULL) AND (paid_at IS NULL) AND (paid_by IS NULL) AND (payment_reference IS NULL)) OR ((status = 'PAID'::text) AND (finalized_at IS NOT NULL) AND (finalized_by IS NOT NULL) AND (paid_at IS NOT NULL) AND (paid_by IS NOT NULL) AND (length(btrim(COALESCE(payment_reference, ''::text))) > 0))))
payroll_run_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'FINALIZED'::text, 'PAID'::text])))
payroll_run_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_finalized_by_restaurant_id_fkey: FOREIGN KEY (finalized_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_paid_by_restaurant_id_fkey: FOREIGN KEY (paid_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_run_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_run_created_at_not_null: NOT NULL created_at
payroll_run_created_by_not_null: NOT NULL created_by
payroll_run_id_not_null: NOT NULL id
payroll_run_period_end_not_null: NOT NULL period_end
payroll_run_period_start_not_null: NOT NULL period_start
payroll_run_restaurant_id_not_null: NOT NULL restaurant_id
payroll_run_status_not_null: NOT NULL status
payroll_run_updated_at_not_null: NOT NULL updated_at
payroll_run_pkey: PRIMARY KEY (id)
payroll_run_id_restaurant_id_key: UNIQUE (id, restaurant_id)
payroll_run_restaurant_id_daterange_excl: EXCLUDE USING gist (restaurant_id WITH =, daterange(period_start, period_end, '[)'::text) WITH &&)
```

### Chỉ mục của payroll_run

```sql
CREATE UNIQUE INDEX payroll_run_id_restaurant_id_key ON public.payroll_run USING btree (id, restaurant_id);
CREATE UNIQUE INDEX payroll_run_pkey ON public.payroll_run USING btree (id);
CREATE INDEX payroll_run_restaurant_id_daterange_excl ON public.payroll_run USING gist (restaurant_id, daterange(period_start, period_end, '[)'::text));
```

### Trigger của payroll_run

```sql
CREATE TRIGGER payroll_guard BEFORE DELETE OR UPDATE ON public.payroll_run FOR EACH ROW EXECUTE FUNCTION payroll_guard();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.payroll_run FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## payroll_slip

Phiếu lương của một nhân viên trong kỳ, giữ tên/mã đăng nhập snapshot.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts).

| Cột                    | Kiểu PostgreSQL          | NULL? | Khóa                                             | Default           | Ý nghĩa hiện tại                     |
| ---------------------- | ------------------------ | ----- | ------------------------------------------------ | ----------------- | ------------------------------------ |
| id                     | uuid                     | Không | PK                                               | gen_random_uuid() | Mã định danh chính của bản ghi.      |
| restaurant_id          | uuid                     | Không | FK → payroll_run; FK → restaurant; FK → app_user | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.     |
| payroll_run_id         | uuid                     | Không | FK → payroll_run                                 | —                 | Kỳ lương chứa phiếu.                 |
| user_id                | uuid                     | Không | FK → app_user                                    | —                 | Tài khoản nhân viên được tham chiếu. |
| employee_name_snapshot | text                     | Không | —                                                | —                 | Tên nhân viên tại lúc tạo phiếu.     |
| username_snapshot      | text                     | Không | —                                                | —                 | Tên đăng nhập chụp trên phiếu.       |
| created_at             | timestamp with time zone | Không | —                                                | now()             | Thời điểm tạo bản ghi.               |

### Quan hệ của payroll_slip

- FOREIGN KEY (payroll_run_id, restaurant_id) REFERENCES payroll_run(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của payroll_slip

```sql
payroll_slip_payroll_run_id_restaurant_id_fkey: FOREIGN KEY (payroll_run_id, restaurant_id) REFERENCES payroll_run(id, restaurant_id)
payroll_slip_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
payroll_slip_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
payroll_slip_created_at_not_null: NOT NULL created_at
payroll_slip_employee_name_snapshot_not_null: NOT NULL employee_name_snapshot
payroll_slip_id_not_null: NOT NULL id
payroll_slip_payroll_run_id_not_null: NOT NULL payroll_run_id
payroll_slip_restaurant_id_not_null: NOT NULL restaurant_id
payroll_slip_user_id_not_null: NOT NULL user_id
payroll_slip_username_snapshot_not_null: NOT NULL username_snapshot
payroll_slip_pkey: PRIMARY KEY (id)
payroll_slip_id_restaurant_id_key: UNIQUE (id, restaurant_id)
payroll_slip_payroll_run_id_user_id_key: UNIQUE (payroll_run_id, user_id)
```

### Chỉ mục của payroll_slip

```sql
CREATE UNIQUE INDEX payroll_slip_id_restaurant_id_key ON public.payroll_slip USING btree (id, restaurant_id);
CREATE UNIQUE INDEX payroll_slip_payroll_run_id_user_id_key ON public.payroll_slip USING btree (payroll_run_id, user_id);
CREATE UNIQUE INDEX payroll_slip_pkey ON public.payroll_slip USING btree (id);
```

### Trigger của payroll_slip

```sql
CREATE TRIGGER payroll_guard BEFORE INSERT OR DELETE OR UPDATE ON public.payroll_slip FOR EACH ROW EXECUTE FUNCTION payroll_guard();
```

## permission

Các quyền chức năng backend kiểm tra.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts), [apps/api/src/modules/auth/types.ts](../apps/api/src/modules/auth/types.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/catalog/images.routes.ts](../apps/api/src/modules/catalog/images.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workspaces/routes.ts](../apps/api/src/modules/workspaces/routes.ts).

| Cột         | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa hiện tại                                                   |
| ----------- | ------------------------ | ----- | ---- | ----------------- | ------------------------------------------------------------------ |
| id          | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| code        | text                     | Không | —    | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| module      | text                     | Không | —    | —                 | Phân hệ                                                            |
| action      | text                     | Không | —    | —                 | Loại thao tác được ghi nhận.                                       |
| description | text                     | Có    | —    | —                 | Mô tả nghiệp vụ của bản ghi.                                       |
| created_at  | timestamp with time zone | Không | —    | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at  | timestamp with time zone | Không | —    | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của permission

Không có FK khai báo trực tiếp trong metadata.

### Ràng buộc của permission

```sql
permission_action_not_null: NOT NULL action
permission_code_not_null: NOT NULL code
permission_created_at_not_null: NOT NULL created_at
permission_id_not_null: NOT NULL id
permission_module_not_null: NOT NULL module
permission_updated_at_not_null: NOT NULL updated_at
permission_pkey: PRIMARY KEY (id)
permission_code_key: UNIQUE (code)
```

### Chỉ mục của permission

```sql
CREATE UNIQUE INDEX permission_code_key ON public.permission USING btree (code);
CREATE UNIQUE INDEX permission_pkey ON public.permission USING btree (id);
```

### Trigger của permission

```sql
CREATE TRIGGER permission_updated BEFORE UPDATE ON public.permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## product

Món bán hiện hành: giá, danh mục, trạng thái, ảnh, quản lý kho và món tặng.

Có 15 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                 | Kiểu PostgreSQL          | NULL? | Khóa                                | Default           | Ý nghĩa hiện tại                                                    |
| ------------------- | ------------------------ | ----- | ----------------------------------- | ----------------- | ------------------------------------------------------------------- |
| id                  | uuid                     | Không | PK                                  | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| restaurant_id       | uuid                     | Không | FK → menu_category; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                    |
| category_id         | uuid                     | Không | FK → menu_category                  | —                 | Danh mục cùng nhà hàng; FK ghép                                     |
| code                | text                     | Không | —                                   | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                    |
| name                | text                     | Không | —                                   | —                 | Tên hiển thị đối tượng.                                             |
| description         | text                     | Có    | —                                   | —                 | Mô tả nghiệp vụ của bản ghi.                                        |
| image_url           | text                     | Có    | —                                   | —                 | Đường dẫn ảnh tùy chọn                                              |
| base_price          | bigint                   | Không | —                                   | —                 | Giá VND nguyên không âm                                             |
| availability_status | text                     | Không | —                                   | 'AVAILABLE'::text | Trạng thái: AVAILABLE, UNAVAILABLE                                  |
| is_active           | boolean                  | Không | —                                   | true              | Cờ hoạt động của danh mục/đối tượng.                                |
| version             | integer                  | Không | —                                   | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at          | timestamp with time zone | Không | —                                   | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at          | timestamp with time zone | Không | —                                   | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |
| stock_managed       | boolean                  | Không | —                                   | true              | Món cần giữ/tiêu hao nguyên liệu hay không.                         |
| is_complimentary    | boolean                  | Không | —                                   | false             | Cho phép món có giá 0 theo ràng buộc.                               |

### Quan hệ của product

- FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_category(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của product

```sql
product_availability_status_check: CHECK ((availability_status = ANY (ARRAY['AVAILABLE'::text, 'UNAVAILABLE'::text])))
product_base_price_check: CHECK ((base_price >= 0))
product_free_price: CHECK (((base_price > 0) OR is_complimentary))
product_version_check: CHECK ((version > 0))
product_category_id_restaurant_id_fkey: FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_category(id, restaurant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
product_availability_status_not_null: NOT NULL availability_status
product_base_price_not_null: NOT NULL base_price
product_category_id_not_null: NOT NULL category_id
product_code_not_null: NOT NULL code
product_created_at_not_null: NOT NULL created_at
product_id_not_null: NOT NULL id
product_is_active_not_null: NOT NULL is_active
product_is_complimentary_not_null: NOT NULL is_complimentary
product_name_not_null: NOT NULL name
product_restaurant_id_not_null: NOT NULL restaurant_id
product_stock_managed_not_null: NOT NULL stock_managed
product_updated_at_not_null: NOT NULL updated_at
product_version_not_null: NOT NULL version
product_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
product_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của product

```sql
CREATE INDEX product_category_idx ON public.product USING btree (category_id, restaurant_id);
CREATE UNIQUE INDEX product_pkey ON public.product USING btree (id);
CREATE UNIQUE INDEX product_restaurant_id_code_key ON public.product USING btree (restaurant_id, code);
```

### Trigger của product

```sql
CREATE TRIGGER product_updated BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.product DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('menu_category', 'category_id', 'restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.product FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## recipe_bom

Phiên bản công thức định lượng của một món.

Có 9 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột            | Kiểu PostgreSQL             | NULL? | Khóa         | Default           | Ý nghĩa hiện tại                                                   |
| -------------- | --------------------------- | ----- | ------------ | ----------------- | ------------------------------------------------------------------ |
| id             | uuid                        | Không | PK           | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| product_id     | uuid                        | Không | FK → product | —                 | Món hiện hành được tham chiếu.                                     |
| version_no     | integer                     | Không | —            | 1                 | Số phiên bản nghiệp vụ của QR/công thức/cấu hình.                  |
| yield_quantity | numeric(18,6)               | Không | —            | —                 | Số phần/sản lượng mà một công thức định lượng tạo ra.              |
| status         | text                        | Không | —            | 'DRAFT'::text     | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| effective_from | timestamp(6) with time zone | Không | —            | now()             | Thời điểm bắt đầu hiệu lực.                                        |
| effective_to   | timestamp(6) with time zone | Có    | —            | —                 | Thời điểm kết thúc hiệu lực nếu có.                                |
| created_at     | timestamp(6) with time zone | Không | —            | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at     | timestamp(6) with time zone | Không | —            | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của recipe_bom

- FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của recipe_bom

```sql
recipe_bom_check: CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
recipe_bom_status_check: CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'RETIRED'::text])))
recipe_bom_status_check1: CHECK ((length(btrim(status)) > 0))
recipe_bom_version_no_check: CHECK ((version_no > 0))
recipe_bom_yield_quantity_check: CHECK ((yield_quantity > (0)::numeric))
core_recipe_bom_f1: FOREIGN KEY (product_id) REFERENCES product(id) ON UPDATE RESTRICT ON DELETE RESTRICT
recipe_bom_created_at_not_null: NOT NULL created_at
recipe_bom_effective_from_not_null: NOT NULL effective_from
recipe_bom_id_not_null: NOT NULL id
recipe_bom_product_id_not_null: NOT NULL product_id
recipe_bom_status_not_null: NOT NULL status
recipe_bom_updated_at_not_null: NOT NULL updated_at
recipe_bom_version_no_not_null: NOT NULL version_no
recipe_bom_yield_quantity_not_null: NOT NULL yield_quantity
recipe_bom_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
recipe_bom_product_id_version_no_key: UNIQUE (product_id, version_no)
```

### Chỉ mục của recipe_bom

```sql
CREATE UNIQUE INDEX core_active_bom ON public.recipe_bom USING btree (product_id) WHERE (status = 'ACTIVE'::text);
CREATE INDEX core_recipe_bom_fk1 ON public.recipe_bom USING btree (product_id);
CREATE UNIQUE INDEX recipe_bom_pkey ON public.recipe_bom USING btree (id);
CREATE UNIQUE INDEX recipe_bom_product_id_version_no_key ON public.recipe_bom USING btree (product_id, version_no);
```

### Trigger của recipe_bom

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.recipe_bom FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.recipe_bom DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('product', 'product_id');
```

## recipe_bom_item

Nguyên liệu và lượng/hao hụt trong công thức.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                          |
| ------------- | --------------------------- | ----- | --------------- | ----------------- | ------------------------------------------------------------------------- |
| id            | uuid                        | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                           |
| recipe_bom_id | uuid                        | Không | FK → recipe_bom | —                 | Phiên bản công thức liên quan.                                            |
| ingredient_id | uuid                        | Không | FK → ingredient | —                 | Nguyên liệu liên quan.                                                    |
| quantity      | numeric(18,6)               | Không | —               | —                 | Số lượng; đọc kiểu để phân biệt số phần nguyên với nguyên liệu thập phân. |
| waste_percent | numeric(18,6)               | Không | —               | 0                 | Phần trăm hao hụt cộng vào lượng nguyên liệu cần giữ.                     |
| created_at    | timestamp(6) with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                                    |
| updated_at    | timestamp(6) with time zone | Không | —               | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.        |

### Quan hệ của recipe_bom_item

- FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của recipe_bom_item

```sql
recipe_bom_item_quantity_check: CHECK ((quantity > (0)::numeric))
recipe_bom_item_waste_percent_check: CHECK ((waste_percent >= (0)::numeric))
recipe_bom_item_waste_percent_check1: CHECK ((waste_percent <= (100)::numeric))
core_recipe_bom_item_f1: FOREIGN KEY (recipe_bom_id) REFERENCES recipe_bom(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_recipe_bom_item_f2: FOREIGN KEY (ingredient_id) REFERENCES ingredient(id) ON UPDATE RESTRICT ON DELETE RESTRICT
recipe_bom_item_created_at_not_null: NOT NULL created_at
recipe_bom_item_id_not_null: NOT NULL id
recipe_bom_item_ingredient_id_not_null: NOT NULL ingredient_id
recipe_bom_item_quantity_not_null: NOT NULL quantity
recipe_bom_item_recipe_bom_id_not_null: NOT NULL recipe_bom_id
recipe_bom_item_updated_at_not_null: NOT NULL updated_at
recipe_bom_item_waste_percent_not_null: NOT NULL waste_percent
recipe_bom_item_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
recipe_bom_item_recipe_bom_id_ingredient_id_key: UNIQUE (recipe_bom_id, ingredient_id)
```

### Chỉ mục của recipe_bom_item

```sql
CREATE INDEX core_recipe_bom_item_fk1 ON public.recipe_bom_item USING btree (recipe_bom_id);
CREATE INDEX core_recipe_bom_item_fk2 ON public.recipe_bom_item USING btree (ingredient_id);
CREATE UNIQUE INDEX recipe_bom_item_pkey ON public.recipe_bom_item USING btree (id);
CREATE UNIQUE INDEX recipe_bom_item_recipe_bom_id_ingredient_id_key ON public.recipe_bom_item USING btree (recipe_bom_id, ingredient_id);
```

### Trigger của recipe_bom_item

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.recipe_bom_item FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.recipe_bom_item DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('recipe_bom', 'recipe_bom_id', 'ingredient', 'ingredient_id');
```

## refund_case

Hồ sơ cần hoàn tiền, gắn giao dịch gốc và phiên.

Có 14 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                           | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                    |
| ----------------------------- | --------------------------- | ----- | ------------------------ | ----------------- | ------------------------------------------------------------------- |
| id                            | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| session_id                    | uuid                        | Không | FK → table_session       | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                     |
| order_item_id                 | uuid                        | Có    | FK → order_item          | —                 | Dòng món liên quan.                                                 |
| source_payment_transaction_id | uuid                        | Có    | FK → payment_transaction | —                 | Giao dịch thu gốc của hồ sơ hoàn.                                   |
| source_allocation_id          | uuid                        | Có    | FK → payment_allocation  | —                 | Phân bổ nguồn nếu có; route lập hồ sơ hiện chủ yếu gắn payment gốc. |
| amount                        | bigint                      | Không | —                        | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.       |
| reason                        | text                        | Có    | —                        | —                 | Lý do nghiệp vụ của thao tác.                                       |
| status                        | text                        | Không | —                        | 'OPEN'::text      | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.       |
| resolution_method             | text                        | Có    | —                        | —                 | Cách hoàn/xử lý đã ghi nhận trong hồ sơ.                            |
| assigned_staff_id             | uuid                        | Có    | FK → app_user            | —                 | Nhân viên nhận xử lý hồ sơ hoàn.                                    |
| evidence_ref                  | text                        | Có    | —                        | —                 | Tham chiếu bằng chứng nghiệp vụ nếu có.                             |
| created_at                    | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at                    | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |
| request_key                   | text                        | Có    | —                        | —                 | Khóa chống ghi lặp riêng cho luồng tương ứng; xem unique/index.     |

### Quan hệ của refund_case

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (source_payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (source_allocation_id) REFERENCES payment_allocation(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (assigned_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của refund_case

```sql
refund_case_amount_check: CHECK ((amount > 0))
refund_case_resolution_method_check: CHECK ((resolution_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))
refund_case_status_check: CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'RESOLVED_CASH'::text, 'RESOLVED_TRANSFER'::text, 'CANCELLED'::text])))
refund_case_status_check1: CHECK ((length(btrim(status)) > 0))
core_refund_case_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f2: FOREIGN KEY (order_item_id) REFERENCES order_item(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f3: FOREIGN KEY (source_payment_transaction_id) REFERENCES payment_transaction(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f4: FOREIGN KEY (source_allocation_id) REFERENCES payment_allocation(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_case_f5: FOREIGN KEY (assigned_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
refund_case_amount_not_null: NOT NULL amount
refund_case_created_at_not_null: NOT NULL created_at
refund_case_id_not_null: NOT NULL id
refund_case_session_id_not_null: NOT NULL session_id
refund_case_status_not_null: NOT NULL status
refund_case_updated_at_not_null: NOT NULL updated_at
refund_case_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của refund_case

```sql
CREATE INDEX core_refund_case_fk1 ON public.refund_case USING btree (session_id);
CREATE INDEX core_refund_case_fk2 ON public.refund_case USING btree (order_item_id);
CREATE INDEX core_refund_case_fk3 ON public.refund_case USING btree (source_payment_transaction_id);
CREATE INDEX core_refund_case_fk4 ON public.refund_case USING btree (source_allocation_id);
CREATE INDEX core_refund_case_fk5 ON public.refund_case USING btree (assigned_staff_id);
CREATE UNIQUE INDEX refund_case_pkey ON public.refund_case USING btree (id);
CREATE UNIQUE INDEX refund_case_request_key ON public.refund_case USING btree (session_id, request_key) WHERE (request_key IS NOT NULL);
```

### Trigger của refund_case

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.refund_case DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'order_item', 'order_item_id', 'payment_transaction', 'source_payment_transaction_id', 'payment_allocation', 'source_allocation_id', 'app_user', 'assigned_staff_id');
CREATE TRIGGER core_refund_snapshot BEFORE UPDATE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id', 'source_payment_transaction_id', 'amount');
CREATE TRIGGER core_refund_source_guard BEFORE INSERT OR UPDATE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION core_refund_source_guard();
CREATE TRIGGER review_refund_relationships BEFORE INSERT OR UPDATE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION review_refund_relationships();
CREATE TRIGGER review_refund_source_fixed BEFORE UPDATE ON public.refund_case FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('order_item_id', 'source_allocation_id', 'request_key');
```

## refund_transaction

Một lần ghi nhận hoàn tiền, có thể là một phần của hồ sơ.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột            | Kiểu PostgreSQL             | NULL? | Khóa             | Default           | Ý nghĩa hiện tại                                                   |
| -------------- | --------------------------- | ----- | ---------------- | ----------------- | ------------------------------------------------------------------ |
| id             | uuid                        | Không | PK               | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| refund_case_id | uuid                        | Không | FK → refund_case | —                 | Hồ sơ chứa lần hoàn tiền.                                          |
| method         | text                        | Không | —                | —                 | Phương thức tiền; các route hiện giới hạn theo nghiệp vụ.          |
| amount         | bigint                      | Không | —                | —                 | Số tiền VND của bản ghi; dấu/giới hạn tùy loại dòng và CHECK.      |
| reference      | text                        | Có    | —                | —                 | Tham chiếu chuyển/chi tiền thủ công.                               |
| status         | text                        | Không | —                | 'PENDING'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| processed_by   | uuid                        | Không | FK → app_user    | —                 | Người ghi nhận xử lý hoàn tiền.                                    |
| processed_at   | timestamp(6) with time zone | Có    | —                | —                 | Thời điểm xử lý hoàn tất.                                          |
| created_at     | timestamp(6) with time zone | Không | —                | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at     | timestamp(6) with time zone | Không | —                | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |
| request_key    | text                        | Có    | —                | —                 | Khóa chống ghi lặp riêng cho luồng tương ứng; xem unique/index.    |

### Quan hệ của refund_transaction

- FOREIGN KEY (refund_case_id) REFERENCES refund_case(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (processed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của refund_transaction

```sql
refund_transaction_amount_check: CHECK ((amount > 0))
refund_transaction_check: CHECK (((status <> 'SUCCEEDED'::text) OR (processed_at IS NOT NULL)))
refund_transaction_method_check: CHECK ((method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))
refund_transaction_method_check1: CHECK ((length(btrim(method)) > 0))
refund_transaction_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text])))
refund_transaction_status_check1: CHECK ((length(btrim(status)) > 0))
core_refund_transaction_f1: FOREIGN KEY (refund_case_id) REFERENCES refund_case(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_refund_transaction_f2: FOREIGN KEY (processed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
refund_transaction_amount_not_null: NOT NULL amount
refund_transaction_created_at_not_null: NOT NULL created_at
refund_transaction_id_not_null: NOT NULL id
refund_transaction_method_not_null: NOT NULL method
refund_transaction_processed_by_not_null: NOT NULL processed_by
refund_transaction_refund_case_id_not_null: NOT NULL refund_case_id
refund_transaction_status_not_null: NOT NULL status
refund_transaction_updated_at_not_null: NOT NULL updated_at
refund_transaction_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của refund_transaction

```sql
CREATE INDEX core_refund_transaction_fk1 ON public.refund_transaction USING btree (refund_case_id);
CREATE INDEX core_refund_transaction_fk2 ON public.refund_transaction USING btree (processed_by);
CREATE INDEX refund_bank_reference_lookup ON public.refund_transaction USING btree (reference) WHERE ((method = 'BANK_TRANSFER'::text) AND (status = 'SUCCEEDED'::text));
CREATE UNIQUE INDEX refund_request_once ON public.refund_transaction USING btree (refund_case_id, request_key) WHERE (request_key IS NOT NULL);
CREATE UNIQUE INDEX refund_transaction_pkey ON public.refund_transaction USING btree (id);
```

### Trigger của refund_transaction

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.refund_transaction FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.refund_transaction FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.refund_transaction DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('refund_case', 'refund_case_id', 'app_user', 'processed_by');
CREATE TRIGGER core_refund_immutable BEFORE UPDATE ON public.refund_transaction FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE TRIGGER refund_amount_guard BEFORE INSERT ON public.refund_transaction FOR EACH ROW EXECUTE FUNCTION refund_amount_guard();
CREATE TRIGGER review_refund_bank_reference BEFORE INSERT ON public.refund_transaction FOR EACH ROW EXECUTE FUNCTION review_refund_bank_reference();
```

## restaurant

Nhà hàng: gốc phạm vi dữ liệu và múi giờ vận hành.

Có 8 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/dish-notice.routes.ts](../apps/api/src/modules/dining/dish-notice.routes.ts), [apps/api/src/modules/orders/issue.routes.ts](../apps/api/src/modules/orders/issue.routes.ts), [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts), [apps/api/src/modules/payments/payment-requests.routes.ts](../apps/api/src/modules/payments/payment-requests.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/index.ts](../apps/api/src/modules/index.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/cancellation.service.ts](../apps/api/src/modules/orders/cancellation.service.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/item-lifecycle.service.ts](../apps/api/src/modules/orders/item-lifecycle.service.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/risk/policy.service.ts](../apps/api/src/modules/risk/policy.service.ts), [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột        | Kiểu PostgreSQL          | NULL? | Khóa | Default                  | Ý nghĩa hiện tại                                                   |
| ---------- | ------------------------ | ----- | ---- | ------------------------ | ------------------------------------------------------------------ |
| id         | uuid                     | Không | PK   | gen_random_uuid()        | Mã định danh chính của bản ghi.                                    |
| name       | text                     | Không | —    | —                        | Tên hiển thị đối tượng.                                            |
| address    | text                     | Có    | —    | —                        | Địa chỉ                                                            |
| currency   | text                     | Không | —    | 'VND'::text              | Mã tiền tệ, hiện VND.                                              |
| timezone   | text                     | Không | —    | 'Asia/Ho_Chi_Minh'::text | Múi giờ hiển thị                                                   |
| status     | text                     | Không | —    | 'ACTIVE'::text           | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| created_at | timestamp with time zone | Không | —    | now()                    | Thời điểm tạo bản ghi.                                             |
| updated_at | timestamp with time zone | Không | —    | now()                    | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của restaurant

Không có FK khai báo trực tiếp trong metadata.

### Ràng buộc của restaurant

```sql
restaurant_currency_check: CHECK ((currency = 'VND'::text))
restaurant_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
restaurant_created_at_not_null: NOT NULL created_at
restaurant_currency_not_null: NOT NULL currency
restaurant_id_not_null: NOT NULL id
restaurant_name_not_null: NOT NULL name
restaurant_status_not_null: NOT NULL status
restaurant_timezone_not_null: NOT NULL timezone
restaurant_updated_at_not_null: NOT NULL updated_at
restaurant_pkey: PRIMARY KEY (id)
```

### Chỉ mục của restaurant

```sql
CREATE UNIQUE INDEX restaurant_pkey ON public.restaurant USING btree (id);
```

### Trigger của restaurant

```sql
CREATE TRIGGER restaurant_updated BEFORE UPDATE ON public.restaurant FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## risk_policy_config

Các phiên bản cấu hình ngưỡng; hiện chưa có override trong database được kiểm tra.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/risk/policy.service.ts](../apps/api/src/modules/risk/policy.service.ts), [apps/api/src/modules/risk/risk.routes.ts](../apps/api/src/modules/risk/risk.routes.ts).

| Cột            | Kiểu PostgreSQL             | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                              |
| -------------- | --------------------------- | ----- | --------------- | ----------------- | ------------------------------------------------------------- |
| id             | uuid                        | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                               |
| restaurant_id  | uuid                        | Không | FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                              |
| config_key     | text                        | Không | —               | —                 | Tên khóa cấu hình chính sách.                                 |
| value_type     | text                        | Không | —               | —                 | Loại dữ liệu của cấu hình.                                    |
| value_json     | jsonb                       | Không | —               | —                 | Giá trị cấu hình dạng JSON.                                   |
| allowed_min    | numeric(18,6)               | Có    | —               | —                 | Giới hạn dưới có trong schema; route hiện kiểm tra theo code. |
| allowed_max    | numeric(18,6)               | Có    | —               | —                 | Giới hạn trên có trong schema; route hiện kiểm tra theo code. |
| version_no     | integer                     | Không | —               | 1                 | Số phiên bản nghiệp vụ của QR/công thức/cấu hình.             |
| effective_from | timestamp(6) with time zone | Không | —               | now()             | Thời điểm bắt đầu hiệu lực.                                   |
| changed_by     | uuid                        | Không | FK → app_user   | —                 | Người thay cấu hình.                                          |
| created_at     | timestamp(6) with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                        |

### Quan hệ của risk_policy_config

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (changed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của risk_policy_config

```sql
risk_policy_config_check: CHECK (((allowed_min IS NULL) OR (allowed_max IS NULL) OR (allowed_min <= allowed_max)))
risk_policy_config_config_key_check: CHECK ((length(btrim(config_key)) > 0))
risk_policy_config_value_type_check: CHECK ((value_type = ANY (ARRAY['NUMBER'::text, 'BOOLEAN'::text, 'STRING'::text, 'JSON'::text])))
risk_policy_config_value_type_check1: CHECK ((length(btrim(value_type)) > 0))
risk_policy_config_version_no_check: CHECK ((version_no > 0))
core_risk_policy_config_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_risk_policy_config_f2: FOREIGN KEY (changed_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
risk_policy_config_changed_by_not_null: NOT NULL changed_by
risk_policy_config_config_key_not_null: NOT NULL config_key
risk_policy_config_created_at_not_null: NOT NULL created_at
risk_policy_config_effective_from_not_null: NOT NULL effective_from
risk_policy_config_id_not_null: NOT NULL id
risk_policy_config_restaurant_id_not_null: NOT NULL restaurant_id
risk_policy_config_value_json_not_null: NOT NULL value_json
risk_policy_config_value_type_not_null: NOT NULL value_type
risk_policy_config_version_no_not_null: NOT NULL version_no
risk_policy_config_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
risk_policy_config_restaurant_id_config_key_version_no_key: UNIQUE (restaurant_id, config_key, version_no)
```

### Chỉ mục của risk_policy_config

```sql
CREATE INDEX core_risk_policy_config_fk1 ON public.risk_policy_config USING btree (restaurant_id);
CREATE INDEX core_risk_policy_config_fk2 ON public.risk_policy_config USING btree (changed_by);
CREATE UNIQUE INDEX risk_policy_config_pkey ON public.risk_policy_config USING btree (id);
CREATE UNIQUE INDEX risk_policy_config_restaurant_id_config_key_version_no_key ON public.risk_policy_config USING btree (restaurant_id, config_key, version_no);
```

### Trigger của risk_policy_config

```sql
CREATE TRIGGER core_no_delete BEFORE DELETE ON public.risk_policy_config FOR EACH ROW EXECUTE FUNCTION core_no_delete();
CREATE TRIGGER core_immutable BEFORE UPDATE ON public.risk_policy_config FOR EACH ROW EXECUTE FUNCTION core_immutable();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.risk_policy_config DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id', 'app_user', 'changed_by');
```

## role

Ba vai trò hiện có ADMIN, STAFF, KITCHEN.

Có 6 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts), [apps/api/src/modules/auth/types.ts](../apps/api/src/modules/auth/types.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột         | Kiểu PostgreSQL          | NULL? | Khóa | Default           | Ý nghĩa hiện tại                                                   |
| ----------- | ------------------------ | ----- | ---- | ----------------- | ------------------------------------------------------------------ |
| id          | uuid                     | Không | PK   | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| code        | text                     | Không | —    | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name        | text                     | Không | —    | —                 | Tên hiển thị đối tượng.                                            |
| description | text                     | Có    | —    | —                 | Mô tả nghiệp vụ của bản ghi.                                       |
| created_at  | timestamp with time zone | Không | —    | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at  | timestamp with time zone | Không | —    | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của role

Không có FK khai báo trực tiếp trong metadata.

### Ràng buộc của role

```sql
role_code_check: CHECK ((code = ANY (ARRAY['STAFF'::text, 'KITCHEN'::text, 'ADMIN'::text])))
role_code_not_null: NOT NULL code
role_created_at_not_null: NOT NULL created_at
role_id_not_null: NOT NULL id
role_name_not_null: NOT NULL name
role_updated_at_not_null: NOT NULL updated_at
role_pkey: PRIMARY KEY (id)
role_code_key: UNIQUE (code)
```

### Chỉ mục của role

```sql
CREATE UNIQUE INDEX role_code_key ON public.role USING btree (code);
CREATE UNIQUE INDEX role_pkey ON public.role USING btree (id);
```

### Trigger của role

```sql
CREATE TRIGGER role_updated BEFORE UPDATE ON public.role FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## role_permission

Gắn quyền cho vai trò.

Có 6 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa            | Default            | Ý nghĩa hiện tại                                                   |
| ------------- | ------------------------ | ----- | --------------- | ------------------ | ------------------------------------------------------------------ |
| id            | uuid                     | Không | PK              | gen_random_uuid()  | Mã định danh chính của bản ghi.                                    |
| role_id       | uuid                     | Không | FK → role       | —                  | Tham chiếu role; không xóa lịch sử                                 |
| permission_id | uuid                     | Không | FK → permission | —                  | Tham chiếu permission; không xóa lịch sử                           |
| scope         | text                     | Không | —               | 'RESTAURANT'::text | Phạm vi khóa chống lặp, ví dụ order:sessionId.                     |
| created_at    | timestamp with time zone | Không | —               | now()              | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp with time zone | Không | —               | now()              | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của role_permission

- FOREIGN KEY (permission_id) REFERENCES permission(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của role_permission

```sql
role_permission_scope_check: CHECK ((scope = 'RESTAURANT'::text))
role_permission_permission_id_fkey: FOREIGN KEY (permission_id) REFERENCES permission(id) ON UPDATE RESTRICT ON DELETE RESTRICT
role_permission_role_id_fkey: FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT
role_permission_created_at_not_null: NOT NULL created_at
role_permission_id_not_null: NOT NULL id
role_permission_permission_id_not_null: NOT NULL permission_id
role_permission_role_id_not_null: NOT NULL role_id
role_permission_scope_not_null: NOT NULL scope
role_permission_updated_at_not_null: NOT NULL updated_at
role_permission_pkey: PRIMARY KEY (id)
role_permission_role_id_permission_id_key: UNIQUE (role_id, permission_id)
```

### Chỉ mục của role_permission

```sql
CREATE INDEX role_permission_permission_idx ON public.role_permission USING btree (permission_id);
CREATE UNIQUE INDEX role_permission_pkey ON public.role_permission USING btree (id);
CREATE UNIQUE INDEX role_permission_role_id_permission_id_key ON public.role_permission USING btree (role_id, permission_id);
```

### Trigger của role_permission

```sql
CREATE TRIGGER role_permission_updated BEFORE UPDATE ON public.role_permission FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## session_cart

Giỏ duy nhất của phiên, có cart_version chống thay đổi từ màn hình cũ.

Có 5 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/orders/orders.service.ts](../apps/api/src/modules/orders/orders.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột          | Kiểu PostgreSQL          | NULL? | Khóa               | Default           | Ý nghĩa hiện tại                                                   |
| ------------ | ------------------------ | ----- | ------------------ | ----------------- | ------------------------------------------------------------------ |
| id           | uuid                     | Không | PK                 | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| session_id   | uuid                     | Không | FK → table_session | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                    |
| cart_version | integer                  | Không | —                  | 1                 | Phiên bản giỏ                                                      |
| created_at   | timestamp with time zone | Không | —                  | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at   | timestamp with time zone | Không | —                  | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của session_cart

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..1 con.

### Ràng buộc của session_cart

```sql
session_cart_cart_version_check: CHECK ((cart_version > 0))
session_cart_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_cart_cart_version_not_null: NOT NULL cart_version
session_cart_created_at_not_null: NOT NULL created_at
session_cart_id_not_null: NOT NULL id
session_cart_session_id_not_null: NOT NULL session_id
session_cart_updated_at_not_null: NOT NULL updated_at
session_cart_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_cart_session_id_key: UNIQUE (session_id)
```

### Chỉ mục của session_cart

```sql
CREATE UNIQUE INDEX session_cart_pkey ON public.session_cart USING btree (id);
CREATE UNIQUE INDEX session_cart_session_id_key ON public.session_cart USING btree (session_id);
```

### Trigger của session_cart

```sql
CREATE TRIGGER session_cart_updated BEFORE UPDATE ON public.session_cart FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.session_cart DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id');
CREATE TRIGGER review_cart_session_fixed BEFORE UPDATE ON public.session_cart FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id');
```

## session_financial_account

Tổng hợp tài chính phiên, được tính lại từ charge/payment/refund/intent.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột                     | Kiểu PostgreSQL             | NULL? | Khóa               | Default           | Ý nghĩa hiện tại                                                    |
| ----------------------- | --------------------------- | ----- | ------------------ | ----------------- | ------------------------------------------------------------------- |
| id                      | uuid                        | Không | PK                 | gen_random_uuid() | Mã định danh chính của bản ghi.                                     |
| session_id              | uuid                        | Không | FK → table_session | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                     |
| charge_total            | bigint                      | Không | —                  | 0                 | Tổng charge ACTIVE của phiên.                                       |
| paid_total              | bigint                      | Không | —                  | 0                 | Tổng giao dịch nhận tiền thành công; hồ sơ có thể giữ snapshot.     |
| refunded_total          | bigint                      | Không | —                  | 0                 | Tổng refund_transaction thành công của phiên.                       |
| reserved_payment_amount | bigint                      | Không | —                  | 0                 | Tổng intent chờ còn hạn đang giữ phần dư nợ.                        |
| outstanding_amount      | bigint                      | Không | —                  | 0                 | Số tiền còn thiếu hoặc số dư được chụp tại hồ sơ/cảnh báo.          |
| refund_due_amount       | bigint                      | Không | —                  | 0                 | Số cần hoàn: max(đã thu - đã hoàn - phải thu, 0).                   |
| version                 | integer                     | Không | —                  | 1                 | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at              | timestamp(6) with time zone | Không | —                  | now()             | Thời điểm tạo bản ghi.                                              |
| updated_at              | timestamp(6) with time zone | Không | —                  | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |

### Quan hệ của session_financial_account

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..1 con.

### Ràng buộc của session_financial_account

```sql
session_financial_account_charge_total_check: CHECK ((charge_total >= 0))
session_financial_account_outstanding_amount_check: CHECK ((outstanding_amount >= 0))
session_financial_account_paid_total_check: CHECK ((paid_total >= 0))
session_financial_account_refund_due_amount_check: CHECK ((refund_due_amount >= 0))
session_financial_account_refunded_total_check: CHECK ((refunded_total >= 0))
session_financial_account_reserved_payment_amount_check: CHECK ((reserved_payment_amount >= 0))
session_financial_account_version_check: CHECK ((version > 0))
core_session_financial_account_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_financial_account_charge_total_not_null: NOT NULL charge_total
session_financial_account_created_at_not_null: NOT NULL created_at
session_financial_account_id_not_null: NOT NULL id
session_financial_account_outstanding_amount_not_null: NOT NULL outstanding_amount
session_financial_account_paid_total_not_null: NOT NULL paid_total
session_financial_account_refund_due_amount_not_null: NOT NULL refund_due_amount
session_financial_account_refunded_total_not_null: NOT NULL refunded_total
session_financial_account_reserved_payment_amount_not_null: NOT NULL reserved_payment_amount
session_financial_account_session_id_not_null: NOT NULL session_id
session_financial_account_updated_at_not_null: NOT NULL updated_at
session_financial_account_version_not_null: NOT NULL version
session_financial_account_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_financial_account_session_id_key: UNIQUE (session_id)
```

### Chỉ mục của session_financial_account

```sql
CREATE UNIQUE INDEX session_financial_account_pkey ON public.session_financial_account USING btree (id);
CREATE UNIQUE INDEX session_financial_account_session_id_key ON public.session_financial_account USING btree (session_id);
```

### Trigger của session_financial_account

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.session_financial_account FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.session_financial_account DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id');
```

## session_participant

Một khách trong phiên bàn; credential và trạng thái kiểm soát thao tác của khách.

Có 14 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts).

| Cột                     | Kiểu PostgreSQL          | NULL? | Khóa               | Default           | Ý nghĩa hiện tại                                                                                                                  |
| ----------------------- | ------------------------ | ----- | ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| id                      | uuid                     | Không | PK                 | gen_random_uuid() | Mã định danh chính của bản ghi.                                                                                                   |
| session_id              | uuid                     | Không | FK → table_session | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                                                                                   |
| guest_id                | uuid                     | Không | —                  | —                 | Định danh khách opaque trong phiên                                                                                                |
| display_name            | text                     | Có    | —                  | —                 | Tên khách tùy chọn                                                                                                                |
| credential_hash         | text                     | Không | —                  | —                 | Hash credential khách                                                                                                             |
| device_session_hash     | text                     | Có    | —                  | —                 | Hash định danh thiết bị trong phiên                                                                                               |
| status                  | text                     | Không | —                  | 'ACTIVE'::text    | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                                                                     |
| blocked_until           | timestamp with time zone | Có    | —                  | —                 | Hạn chặn tùy chọn                                                                                                                 |
| joined_at               | timestamp with time zone | Không | —                  | now()             | Thời điểm tham gia                                                                                                                |
| last_seen_at            | timestamp with time zone | Không | —                  | now()             | Hoạt động gần nhất                                                                                                                |
| created_at              | timestamp with time zone | Không | —                  | now()             | Thời điểm tạo bản ghi.                                                                                                            |
| updated_at              | timestamp with time zone | Không | —                  | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.                                                                |
| accepted_policy_version | text                     | Có    | —                  | —                 | Phiên bản quy định được khách xác nhận khi tham gia; NULL ở dữ liệu cũ không có bằng chứng. Cặp version/thời gian không được sửa. |
| accepted_policy_at      | timestamp with time zone | Có    | —                  | —                 | Thời điểm máy chủ ghi khách chấp nhận quy định; cùng có hoặc cùng NULL với accepted_policy_version.                               |

### Quan hệ của session_participant

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của session_participant

```sql
participant_policy_ack_pair: CHECK ((((accepted_policy_version IS NULL) AND (accepted_policy_at IS NULL)) OR ((accepted_policy_version IS NOT NULL) AND (accepted_policy_version ~ '^[0-9]{4}-[0-9]{2}-v[0-9]+$'::text) AND (accepted_policy_at IS NOT NULL))))
session_participant_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'BLOCKED'::text, 'LEFT'::text])))
session_participant_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
session_participant_created_at_not_null: NOT NULL created_at
session_participant_credential_hash_not_null: NOT NULL credential_hash
session_participant_guest_id_not_null: NOT NULL guest_id
session_participant_id_not_null: NOT NULL id
session_participant_joined_at_not_null: NOT NULL joined_at
session_participant_last_seen_at_not_null: NOT NULL last_seen_at
session_participant_session_id_not_null: NOT NULL session_id
session_participant_status_not_null: NOT NULL status
session_participant_updated_at_not_null: NOT NULL updated_at
session_participant_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
session_participant_credential_hash_key: UNIQUE (credential_hash)
session_participant_session_id_guest_id_key: UNIQUE (session_id, guest_id)
```

### Chỉ mục của session_participant

```sql
CREATE UNIQUE INDEX session_participant_credential_hash_key ON public.session_participant USING btree (credential_hash);
CREATE UNIQUE INDEX session_participant_pkey ON public.session_participant USING btree (id);
CREATE UNIQUE INDEX session_participant_session_id_guest_id_key ON public.session_participant USING btree (session_id, guest_id);
```

### Trigger của session_participant

```sql
CREATE TRIGGER session_participant_updated BEFORE UPDATE ON public.session_participant FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.session_participant DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id');
CREATE TRIGGER review_guest_session_fixed BEFORE UPDATE ON public.session_participant FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('session_id', 'credential_hash');
CREATE TRIGGER participant_policy_ack_immutable BEFORE UPDATE OF accepted_policy_version, accepted_policy_at ON public.session_participant FOR EACH ROW EXECUTE FUNCTION guard_participant_policy_ack();
```

## shift_assignment

Phân công người vào ca, có kiểm tra chồng giờ.

Có 12 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột                 | Kiểu PostgreSQL          | NULL? | Khóa                                                                             | Default           | Ý nghĩa hiện tại                                                   |
| ------------------- | ------------------------ | ----- | -------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| id                  | uuid                     | Không | PK                                                                               | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id       | uuid                     | Không | FK → dining_area; FK → app_user; FK → restaurant; FK → work_shift; FK → app_user | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| shift_id            | uuid                     | Không | FK → work_shift                                                                  | —                 | Ca được phân công.                                                 |
| user_id             | uuid                     | Không | FK → app_user                                                                    | —                 | Tài khoản nhân viên được tham chiếu.                               |
| area_id             | uuid                     | Có    | FK → dining_area                                                                 | —                 | Khu vực bàn/phân công.                                             |
| starts_at           | timestamp with time zone | Không | —                                                                                | —                 | Thời điểm bắt đầu ca/phân công.                                    |
| ends_at             | timestamp with time zone | Không | —                                                                                | —                 | Thời điểm kết thúc ca/phân công.                                   |
| status              | text                     | Không | —                                                                                | 'ASSIGNED'::text  | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.      |
| assigned_by         | uuid                     | Không | FK → app_user                                                                    | —                 | Quản trị phân công.                                                |
| cancellation_reason | text                     | Có    | —                                                                                | —                 | Lý do hủy phân công.                                               |
| created_at          | timestamp with time zone | Không | —                                                                                | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at          | timestamp with time zone | Không | —                                                                                | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của shift_assignment

- FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id); mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (assigned_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (shift_id, restaurant_id) REFERENCES work_shift(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của shift_assignment

```sql
shift_assignment_check: CHECK ((ends_at > starts_at))
shift_assignment_status_check: CHECK ((status = ANY (ARRAY['ASSIGNED'::text, 'CANCELLED'::text])))
shift_assignment_area_id_restaurant_id_fkey: FOREIGN KEY (area_id, restaurant_id) REFERENCES dining_area(id, restaurant_id)
shift_assignment_assigned_by_restaurant_id_fkey: FOREIGN KEY (assigned_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_assignment_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
shift_assignment_shift_id_restaurant_id_fkey: FOREIGN KEY (shift_id, restaurant_id) REFERENCES work_shift(id, restaurant_id)
shift_assignment_user_id_restaurant_id_fkey: FOREIGN KEY (user_id, restaurant_id) REFERENCES app_user(id, restaurant_id)
shift_assignment_assigned_by_not_null: NOT NULL assigned_by
shift_assignment_created_at_not_null: NOT NULL created_at
shift_assignment_ends_at_not_null: NOT NULL ends_at
shift_assignment_id_not_null: NOT NULL id
shift_assignment_restaurant_id_not_null: NOT NULL restaurant_id
shift_assignment_shift_id_not_null: NOT NULL shift_id
shift_assignment_starts_at_not_null: NOT NULL starts_at
shift_assignment_status_not_null: NOT NULL status
shift_assignment_updated_at_not_null: NOT NULL updated_at
shift_assignment_user_id_not_null: NOT NULL user_id
shift_assignment_pkey: PRIMARY KEY (id)
shift_assignment_id_restaurant_id_key: UNIQUE (id, restaurant_id)
shift_assignment_shift_id_user_id_key: UNIQUE (shift_id, user_id)
shift_assignment_user_id_tstzrange_excl: EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((status = 'ASSIGNED'::text))
```

### Chỉ mục của shift_assignment

```sql
CREATE UNIQUE INDEX shift_assignment_id_restaurant_id_key ON public.shift_assignment USING btree (id, restaurant_id);
CREATE UNIQUE INDEX shift_assignment_pkey ON public.shift_assignment USING btree (id);
CREATE INDEX shift_assignment_restaurant_start_idx ON public.shift_assignment USING btree (restaurant_id, starts_at);
CREATE UNIQUE INDEX shift_assignment_shift_id_user_id_key ON public.shift_assignment USING btree (shift_id, user_id);
CREATE INDEX shift_assignment_user_id_tstzrange_excl ON public.shift_assignment USING gist (user_id, tstzrange(starts_at, ends_at, '[)'::text)) WHERE (status = 'ASSIGNED'::text);
```

### Trigger của shift_assignment

```sql
CREATE TRIGGER workforce_assignment_guard BEFORE INSERT OR UPDATE ON public.shift_assignment FOR EACH ROW EXECUTE FUNCTION workforce_assignment_guard();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.shift_assignment FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## stock_location

Vị trí kho hoạt động trong nhà hàng.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts), [apps/api/src/modules/inventory/inventory.service.ts](../apps/api/src/modules/inventory/inventory.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa            | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | --------------------------- | ----- | --------------- | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                        | Không | PK              | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id | uuid                        | Không | FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| code          | text                        | Không | —               | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name          | text                        | Không | —               | —                 | Tên hiển thị đối tượng.                                            |
| is_active     | boolean                     | Không | —               | true              | Cờ hoạt động của danh mục/đối tượng.                               |
| created_at    | timestamp(6) with time zone | Không | —               | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp(6) with time zone | Không | —               | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của stock_location

- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của stock_location

```sql
stock_location_code_check: CHECK ((length(btrim(code)) > 0))
stock_location_name_check: CHECK ((length(btrim(name)) > 0))
core_stock_location_f1: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
stock_location_code_not_null: NOT NULL code
stock_location_created_at_not_null: NOT NULL created_at
stock_location_id_not_null: NOT NULL id
stock_location_is_active_not_null: NOT NULL is_active
stock_location_name_not_null: NOT NULL name
stock_location_restaurant_id_not_null: NOT NULL restaurant_id
stock_location_updated_at_not_null: NOT NULL updated_at
stock_location_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
stock_location_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của stock_location

```sql
CREATE INDEX core_stock_location_fk1 ON public.stock_location USING btree (restaurant_id);
CREATE UNIQUE INDEX stock_location_pkey ON public.stock_location USING btree (id);
CREATE UNIQUE INDEX stock_location_restaurant_id_code_key ON public.stock_location USING btree (restaurant_id, code);
```

### Trigger của stock_location

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.stock_location FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.stock_location DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('restaurant', 'restaurant_id');
CREATE TRIGGER review_tenant_fixed BEFORE UPDATE ON public.stock_location FOR EACH ROW EXECUTE FUNCTION core_fixed_columns('restaurant_id');
```

## support_request

Yêu cầu hỗ trợ của khách, người tiếp nhận/giải quyết.

Có 13 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/dining/close-readiness.ts](../apps/api/src/modules/dining/close-readiness.ts), [apps/api/src/modules/payments/payment-requests.routes.ts](../apps/api/src/modules/payments/payment-requests.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts).

| Cột             | Kiểu PostgreSQL             | NULL? | Khóa                     | Default           | Ý nghĩa hiện tại                                                                                                            |
| --------------- | --------------------------- | ----- | ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| id              | uuid                        | Không | PK                       | gen_random_uuid() | Mã định danh chính của bản ghi.                                                                                             |
| session_id      | uuid                        | Không | FK → table_session       | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập.                                                                             |
| participant_id  | uuid                        | Có    | FK → session_participant | —                 | Khách phát sinh yêu cầu hỗ trợ.                                                                                             |
| request_type    | text                        | Không | —                        | —                 | Loại hỗ trợ: gọi người, nước, dụng cụ, tính tiền, khác.                                                                     |
| content         | text                        | Có    | —                        | —                 | Nội dung khách yêu cầu hỗ trợ.                                                                                              |
| status          | text                        | Không | —                        | 'NEW'::text       | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.                                                               |
| acknowledged_by | uuid                        | Có    | FK → app_user            | —                 | Người phụ trách hỗ trợ hiện tại; có thể đổi khi bàn giao được nhận.                                                         |
| resolved_by     | uuid                        | Có    | FK → app_user            | —                 | Tài khoản hoàn tất xử lý.                                                                                                   |
| created_at      | timestamp(6) with time zone | Không | —                        | now()             | Thời điểm tạo bản ghi.                                                                                                      |
| updated_at      | timestamp(6) with time zone | Không | —                        | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.                                                          |
| acknowledged_at | timestamp(6) with time zone | Có    | —                        | —                 | Thời điểm nhận hỗ trợ lần đầu; giữ nguyên qua các lần bàn giao.                                                             |
| resolved_at     | timestamp(6) with time zone | Có    | —                        | —                 | Thời điểm giải quyết xong.                                                                                                  |
| payment_method  | text                        | Có    | —                        | —                 | Hình thức CASH/BANK_TRANSFER của lời gọi thu tiền loại BILL; NULL với hỗ trợ thông thường hoặc BILL cũ chưa chọn hình thức. |

### Quan hệ của support_request

- FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của support_request

```sql
support_payment_method: CHECK (((payment_method IS NULL) OR ((request_type = 'BILL'::text) AND (payment_method = ANY (ARRAY['CASH'::text, 'BANK_TRANSFER'::text])))))
support_request_check: CHECK (((status <> 'RESOLVED'::text) OR ((resolved_by IS NOT NULL) AND (resolved_at IS NOT NULL))))
support_request_owner_state: CHECK ((((status = 'NEW'::text) AND (acknowledged_by IS NULL) AND (acknowledged_at IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL)) OR ((status = 'ACKNOWLEDGED'::text) AND (acknowledged_by IS NOT NULL) AND (acknowledged_at IS NOT NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL)) OR ((status = 'RESOLVED'::text) AND (acknowledged_by IS NOT NULL) AND (acknowledged_at IS NOT NULL) AND (resolved_by = acknowledged_by) AND (resolved_at IS NOT NULL)) OR (status = 'CANCELLED'::text)))
support_request_request_type_check: CHECK ((request_type = ANY (ARRAY['ASSISTANCE'::text, 'WATER'::text, 'UTENSILS'::text, 'BILL'::text, 'OTHER'::text])))
support_request_request_type_check1: CHECK ((length(btrim(request_type)) > 0))
support_request_status_check: CHECK ((status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text, 'RESOLVED'::text, 'CANCELLED'::text])))
support_request_status_check1: CHECK ((length(btrim(status)) > 0))
core_support_request_f1: FOREIGN KEY (session_id) REFERENCES table_session(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f2: FOREIGN KEY (participant_id) REFERENCES session_participant(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f3: FOREIGN KEY (acknowledged_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
core_support_request_f4: FOREIGN KEY (resolved_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_created_at_not_null: NOT NULL created_at
support_request_id_not_null: NOT NULL id
support_request_request_type_not_null: NOT NULL request_type
support_request_session_id_not_null: NOT NULL session_id
support_request_status_not_null: NOT NULL status
support_request_updated_at_not_null: NOT NULL updated_at
support_request_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
support_pending_owner: TRIGGER DEFERRABLE INITIALLY DEFERRED
```

### Chỉ mục của support_request

```sql
CREATE INDEX core_support_request_fk1 ON public.support_request USING btree (session_id);
CREATE INDEX core_support_request_fk2 ON public.support_request USING btree (participant_id);
CREATE INDEX core_support_request_fk3 ON public.support_request USING btree (acknowledged_by);
CREATE INDEX core_support_request_fk4 ON public.support_request USING btree (resolved_by);
CREATE UNIQUE INDEX support_request_active_participant ON public.support_request USING btree (session_id, participant_id, request_type) WHERE ((participant_id IS NOT NULL) AND (status = ANY (ARRAY['NEW'::text, 'ACKNOWLEDGED'::text])));
CREATE UNIQUE INDEX support_request_pkey ON public.support_request USING btree (id);
CREATE INDEX support_request_queue ON public.support_request USING btree (status, created_at);
```

### Trigger của support_request

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.support_request FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.support_request DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('table_session', 'session_id', 'session_participant', 'participant_id', 'app_user', 'acknowledged_by', 'app_user', 'resolved_by');
CREATE TRIGGER core_same_session BEFORE INSERT OR UPDATE ON public.support_request FOR EACH ROW EXECUTE FUNCTION core_session_guard();
CREATE CONSTRAINT TRIGGER support_pending_owner AFTER INSERT OR UPDATE ON public.support_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_handoff_guard();
```

## support_request_handoff

Mỗi đề nghị bàn giao hỗ trợ; chỉ đổi người phụ trách khi target đồng ý. Một yêu cầu có nhiều lịch sử, tối đa một PENDING.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts).

| Cột                | Kiểu PostgreSQL             | NULL? | Khóa                 | Default           | Ý nghĩa hiện tại                                                           |
| ------------------ | --------------------------- | ----- | -------------------- | ----------------- | -------------------------------------------------------------------------- |
| id                 | uuid                        | Không | PK                   | gen_random_uuid() | Mã định danh chính của bản ghi.                                            |
| support_request_id | uuid                        | Không | FK → support_request | —                 | Yêu cầu hỗ trợ gốc; khóa ngoại, giữ quan hệ với phiên và nhà hàng.         |
| from_staff_id      | uuid                        | Không | FK → app_user        | —                 | Nhân viên phụ trách gửi đề nghị; còn chịu trách nhiệm khi PENDING.         |
| to_staff_id        | uuid                        | Không | FK → app_user        | —                 | Đồng nghiệp được chỉ định, chỉ người này được đồng ý/từ chối.              |
| reason             | text                        | Không | —                    | —                 | Lý do nghiệp vụ của thao tác.                                              |
| status             | text                        | Không | —                    | 'PENDING'::text   | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.              |
| requested_at       | timestamp(6) with time zone | Không | —                    | now()             | Thời điểm máy chủ ghi đề nghị bàn giao.                                    |
| responded_at       | timestamp(6) with time zone | Có    | —                    | —                 | Thời điểm nhận/từ chối/rút/đóng; NULL khi PENDING.                         |
| responded_by       | uuid                        | Có    | FK → app_user        | —                 | Nhân viên phản hồi; target cho ACCEPTED/DECLINED, người gửi cho CANCELLED. |
| response_reason    | text                        | Có    | —                    | —                 | Lý do từ chối/rút/đóng hoặc lời xác nhận nhận trách nhiệm.                 |

### Quan hệ của support_request_handoff

- FOREIGN KEY (from_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (responded_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (to_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của support_request_handoff

```sql
support_request_handoff_check: CHECK ((from_staff_id <> to_staff_id))
support_request_handoff_check1: CHECK ((((status = 'PENDING'::text) AND (responded_at IS NULL) AND (responded_by IS NULL) AND (response_reason IS NULL)) OR ((status <> 'PENDING'::text) AND (responded_at IS NOT NULL) AND (responded_at >= requested_at) AND (responded_by IS NOT NULL) AND ((length(btrim(response_reason)) >= 1) AND (length(btrim(response_reason)) <= 500)))))
support_request_handoff_check2: CHECK (((status <> ALL (ARRAY['ACCEPTED'::text, 'DECLINED'::text])) OR (responded_by = to_staff_id)))
support_request_handoff_check3: CHECK (((status <> 'CANCELLED'::text) OR (responded_by = from_staff_id)))
support_request_handoff_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
support_request_handoff_status_check: CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'DECLINED'::text, 'CANCELLED'::text])))
support_request_handoff_from_staff_id_fkey: FOREIGN KEY (from_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_responded_by_fkey: FOREIGN KEY (responded_by) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_support_request_id_fkey: FOREIGN KEY (support_request_id) REFERENCES support_request(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_to_staff_id_fkey: FOREIGN KEY (to_staff_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
support_request_handoff_from_staff_id_not_null: NOT NULL from_staff_id
support_request_handoff_id_not_null: NOT NULL id
support_request_handoff_reason_not_null: NOT NULL reason
support_request_handoff_requested_at_not_null: NOT NULL requested_at
support_request_handoff_status_not_null: NOT NULL status
support_request_handoff_support_request_id_not_null: NOT NULL support_request_id
support_request_handoff_to_staff_id_not_null: NOT NULL to_staff_id
support_request_handoff_pkey: PRIMARY KEY (id)
support_handoff_tenant: TRIGGER DEFERRABLE
support_pending_owner: TRIGGER DEFERRABLE INITIALLY DEFERRED
```

### Chỉ mục của support_request_handoff

```sql
CREATE INDEX support_handoff_from ON public.support_request_handoff USING btree (from_staff_id);
CREATE INDEX support_handoff_incoming ON public.support_request_handoff USING btree (to_staff_id, status);
CREATE UNIQUE INDEX support_handoff_one_pending ON public.support_request_handoff USING btree (support_request_id) WHERE (status = 'PENDING'::text);
CREATE INDEX support_handoff_request_history ON public.support_request_handoff USING btree (support_request_id, requested_at);
CREATE INDEX support_handoff_responder ON public.support_request_handoff USING btree (responded_by);
CREATE UNIQUE INDEX support_request_handoff_pkey ON public.support_request_handoff USING btree (id);
```

### Trigger của support_request_handoff

```sql
CREATE TRIGGER support_handoff_history BEFORE UPDATE ON public.support_request_handoff FOR EACH ROW EXECUTE FUNCTION support_handoff_immutable();
CREATE TRIGGER support_handoff_keep_history BEFORE DELETE ON public.support_request_handoff FOR EACH ROW EXECUTE FUNCTION support_handoff_keep_history();
CREATE CONSTRAINT TRIGGER support_handoff_tenant AFTER INSERT OR UPDATE ON public.support_request_handoff DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('support_request', 'support_request_id', 'app_user', 'from_staff_id', 'app_user', 'to_staff_id', 'app_user', 'responded_by');
CREATE CONSTRAINT TRIGGER support_pending_owner AFTER INSERT OR UPDATE ON public.support_request_handoff DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION support_handoff_guard();
```

## table_qr_token

Các phiên bản QR bàn; token hash để kiểm tra, ciphertext để quản trị lấy lại QR.

Có 11 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts).

| Cột              | Kiểu PostgreSQL          | NULL? | Khóa              | Default           | Ý nghĩa hiện tại                                                     |
| ---------------- | ------------------------ | ----- | ----------------- | ----------------- | -------------------------------------------------------------------- |
| id               | uuid                     | Không | PK                | gen_random_uuid() | Mã định danh chính của bản ghi.                                      |
| table_id         | uuid                     | Không | FK → dining_table | —                 | Bàn liên quan; với phiên đây là bàn hiện tại.                        |
| token_hash       | text                     | Không | —                 | —                 | SHA256 token opaque; không lưu token rõ                              |
| version_no       | integer                  | Không | —                 | —                 | Số phiên bản nghiệp vụ của QR/công thức/cấu hình.                    |
| status           | text                     | Không | —                 | 'ACTIVE'::text    | Trạng thái bản ghi; các giá trị được phép xem CHECK bên dưới.        |
| issued_at        | timestamp with time zone | Không | —                 | now()             | Thời điểm phát hành                                                  |
| expires_at       | timestamp with time zone | Có    | —                 | —                 | Thời điểm hết hiệu lực; cách xử lý tùy đối tượng/job.                |
| revoked_at       | timestamp with time zone | Có    | —                 | —                 | Thời điểm thu hồi                                                    |
| created_at       | timestamp with time zone | Không | —                 | now()             | Thời điểm tạo bản ghi.                                               |
| updated_at       | timestamp with time zone | Không | —                 | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.   |
| token_ciphertext | text                     | Có    | —                 | —                 | Token QR mã hóa để có thể lấy lại, khác token_hash chỉ để đối chiếu. |

### Quan hệ của table_qr_token

- FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của table_qr_token

```sql
table_qr_token_check: CHECK (((expires_at IS NULL) OR (expires_at > issued_at)))
table_qr_token_check1: CHECK (((status = 'REVOKED'::text) = (revoked_at IS NOT NULL)))
table_qr_token_status_check: CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text, 'EXPIRED'::text])))
table_qr_token_version_no_check: CHECK ((version_no > 0))
table_qr_token_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
table_qr_token_created_at_not_null: NOT NULL created_at
table_qr_token_id_not_null: NOT NULL id
table_qr_token_issued_at_not_null: NOT NULL issued_at
table_qr_token_status_not_null: NOT NULL status
table_qr_token_table_id_not_null: NOT NULL table_id
table_qr_token_token_hash_not_null: NOT NULL token_hash
table_qr_token_updated_at_not_null: NOT NULL updated_at
table_qr_token_version_no_not_null: NOT NULL version_no
table_qr_token_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
table_qr_token_table_id_version_no_key: UNIQUE (table_id, version_no)
table_qr_token_token_hash_key: UNIQUE (token_hash)
```

### Chỉ mục của table_qr_token

```sql
CREATE UNIQUE INDEX table_qr_one_active ON public.table_qr_token USING btree (table_id) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX table_qr_token_pkey ON public.table_qr_token USING btree (id);
CREATE UNIQUE INDEX table_qr_token_table_id_version_no_key ON public.table_qr_token USING btree (table_id, version_no);
CREATE UNIQUE INDEX table_qr_token_token_hash_key ON public.table_qr_token USING btree (token_hash);
```

### Trigger của table_qr_token

```sql
CREATE TRIGGER table_qr_token_updated BEFORE UPDATE ON public.table_qr_token FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.table_qr_token DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_table', 'table_id');
```

## table_session

Một lượt phục vụ tại bàn; gắn khách, đơn và tài chính; có snapshot phiếu khi đóng.

Có 17 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/payments/collection.service.ts](../apps/api/src/modules/payments/collection.service.ts), [apps/api/src/modules/payments/payment-proof.routes.ts](../apps/api/src/modules/payments/payment-proof.routes.ts), [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/dining.routes.ts](../apps/api/src/modules/dining/dining.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts), [apps/api/src/modules/finance/ledger.service.ts](../apps/api/src/modules/finance/ledger.service.ts), [apps/api/src/modules/notifications/maintenance.ts](../apps/api/src/modules/notifications/maintenance.ts), [apps/api/src/modules/orders/exception.routes.ts](../apps/api/src/modules/orders/exception.routes.ts), [apps/api/src/modules/orders/orders.routes.ts](../apps/api/src/modules/orders/orders.routes.ts), [apps/api/src/modules/payments/payments.routes.ts](../apps/api/src/modules/payments/payments.routes.ts), [apps/api/src/modules/payments/receipt.service.ts](../apps/api/src/modules/payments/receipt.service.ts), [apps/api/src/modules/payments/webhooks.routes.ts](../apps/api/src/modules/payments/webhooks.routes.ts), [apps/api/src/modules/sessions/guest.routes.ts](../apps/api/src/modules/sessions/guest.routes.ts), [apps/api/src/modules/shared/core-persistence.ts](../apps/api/src/modules/shared/core-persistence.ts).

| Cột                 | Kiểu PostgreSQL          | NULL? | Khóa              | Default            | Ý nghĩa hiện tại                                                    |
| ------------------- | ------------------------ | ----- | ----------------- | ------------------ | ------------------------------------------------------------------- |
| id                  | uuid                     | Không | PK                | gen_random_uuid()  | Mã định danh chính của bản ghi.                                     |
| table_id            | uuid                     | Không | FK → dining_table | —                  | Bàn liên quan; với phiên đây là bàn hiện tại.                       |
| session_status      | text                     | Không | —                 | 'ACTIVE'::text     | Trạng thái: ACTIVE, CLOSED, CANCELLED                               |
| verification_status | text                     | Không | —                 | 'UNVERIFIED'::text | Trạng thái: UNVERIFIED, VERIFIED, SUSPENDED                         |
| opened_at           | timestamp with time zone | Không | —                 | now()              | Thời điểm mở                                                        |
| verified_at         | timestamp with time zone | Có    | —                 | —                  | Thời điểm xác minh                                                  |
| closed_at           | timestamp with time zone | Có    | —                 | —                  | Thời điểm kết thúc                                                  |
| close_reason        | text                     | Có    | —                 | —                  | Lý do kết thúc                                                      |
| version             | integer                  | Không | —                 | 1                  | Phiên bản bản ghi, dùng ở các thao tác kiểm tra xung đột tương ứng. |
| created_at          | timestamp with time zone | Không | —                 | now()              | Thời điểm tạo bản ghi.                                              |
| updated_at          | timestamp with time zone | Không | —                 | now()              | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật.  |
| financial_status    | text                     | Không | —                 | 'UNPAID'::text     | Trạng thái tài chính của phiên, tách với trạng thái phục vụ.        |
| risk_status         | text                     | Không | —                 | 'NORMAL'::text     | Trạng thái rủi ro của phiên.                                        |
| receipt_number      | text                     | Có    | —                 | —                  | Số phiếu thu cấp khi đóng phiên.                                    |
| closed_by           | uuid                     | Có    | FK → app_user     | —                  | Nhân viên/quản trị đóng phiên.                                      |
| receipt_snapshot    | jsonb                    | Có    | —                 | —                  | Bản chụp nội dung phiếu khi đóng, được dùng khi xem lại.            |
| verified_by         | uuid                     | Có    | FK → app_user     | —                  | Nhân viên xác minh phiên bàn.                                       |

### Quan hệ của table_session

- FOREIGN KEY (closed_by) REFERENCES app_user(id); mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (verified_by) REFERENCES app_user(id) ON DELETE RESTRICT; mỗi dòng con → 0..1 cha; mỗi cha → 0..N con.

### Ràng buộc của table_session

```sql
core_financial_status: CHECK ((financial_status = ANY (ARRAY['UNPAID'::text, 'PARTIALLY_PAID'::text, 'SETTLED'::text, 'REFUND_DUE'::text, 'OUTSTANDING_EXCEPTION'::text])))
core_risk_status: CHECK ((risk_status = ANY (ARRAY['NORMAL'::text, 'REVIEW_REQUIRED'::text, 'BLOCKED'::text])))
receipt_snapshot_closed: CHECK (((receipt_snapshot IS NULL) OR ((session_status = 'CLOSED'::text) AND (closed_at IS NOT NULL) AND (closed_by IS NOT NULL) AND (receipt_number IS NOT NULL))))
table_session_check: CHECK (((session_status = 'ACTIVE'::text) = (closed_at IS NULL)))
table_session_check1: CHECK (((closed_at IS NULL) OR (closed_at >= opened_at)))
table_session_session_status_check: CHECK ((session_status = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text, 'CANCELLED'::text])))
table_session_verification_status_check: CHECK ((verification_status = ANY (ARRAY['UNVERIFIED'::text, 'VERIFIED'::text, 'SUSPENDED'::text])))
table_session_version_check: CHECK ((version > 0))
table_session_closed_by_fkey: FOREIGN KEY (closed_by) REFERENCES app_user(id)
table_session_table_id_fkey: FOREIGN KEY (table_id) REFERENCES dining_table(id) ON UPDATE RESTRICT ON DELETE RESTRICT
table_session_verified_by_fkey: FOREIGN KEY (verified_by) REFERENCES app_user(id) ON DELETE RESTRICT
table_session_created_at_not_null: NOT NULL created_at
table_session_financial_status_not_null: NOT NULL financial_status
table_session_id_not_null: NOT NULL id
table_session_opened_at_not_null: NOT NULL opened_at
table_session_risk_status_not_null: NOT NULL risk_status
table_session_session_status_not_null: NOT NULL session_status
table_session_table_id_not_null: NOT NULL table_id
table_session_updated_at_not_null: NOT NULL updated_at
table_session_verification_status_not_null: NOT NULL verification_status
table_session_version_not_null: NOT NULL version
table_session_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
uat_verifier_tenant: TRIGGER DEFERRABLE
table_session_receipt_number_key: UNIQUE (receipt_number)
```

### Chỉ mục của table_session

```sql
CREATE INDEX session_closed_by_lookup ON public.table_session USING btree (closed_by) WHERE (closed_by IS NOT NULL);
CREATE INDEX session_verified_by_lookup ON public.table_session USING btree (verified_by) WHERE (verified_by IS NOT NULL);
CREATE UNIQUE INDEX table_session_one_open ON public.table_session USING btree (table_id) WHERE (session_status <> ALL (ARRAY['CLOSED'::text, 'CANCELLED'::text]));
CREATE UNIQUE INDEX table_session_pkey ON public.table_session USING btree (id);
CREATE UNIQUE INDEX table_session_receipt_number_key ON public.table_session USING btree (receipt_number);
CREATE INDEX table_session_table_idx ON public.table_session USING btree (table_id);
```

### Trigger của table_session

```sql
CREATE TRIGGER table_session_updated BEFORE UPDATE ON public.table_session FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.table_session DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('dining_table', 'table_id');
CREATE TRIGGER receipt_snapshot_guard BEFORE UPDATE ON public.table_session FOR EACH ROW EXECUTE FUNCTION receipt_snapshot_guard();
CREATE CONSTRAINT TRIGGER uat_verifier_tenant AFTER INSERT OR UPDATE ON public.table_session DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'verified_by');
```

## table_transfer_history

Lịch sử chuyển một phiên từ bàn này sang bàn khác.

Có 8 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/catalog/catalog.routes.ts](../apps/api/src/modules/catalog/catalog.routes.ts), [apps/api/src/modules/dining/table-transfer.routes.ts](../apps/api/src/modules/dining/table-transfer.routes.ts).

| Cột            | Kiểu PostgreSQL          | NULL? | Khóa                                                                 | Default           | Ý nghĩa hiện tại                                |
| -------------- | ------------------------ | ----- | -------------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| id             | uuid                     | Không | PK                                                                   | gen_random_uuid() | Mã định danh chính của bản ghi.                 |
| restaurant_id  | uuid                     | Không | FK → dining_table; FK → restaurant; FK → dining_table; FK → app_user | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                |
| session_id     | uuid                     | Không | FK → table_session                                                   | —                 | Phiên bàn sở hữu dữ liệu, khác phiên đăng nhập. |
| from_table_id  | uuid                     | Không | FK → dining_table                                                    | —                 | Bàn nguồn trong lịch sử chuyển.                 |
| to_table_id    | uuid                     | Không | FK → dining_table                                                    | —                 | Bàn đích trong lịch sử chuyển.                  |
| transferred_by | uuid                     | Không | FK → app_user                                                        | —                 | Nhân viên chuyển bàn.                           |
| reason         | text                     | Không | —                                                                    | —                 | Lý do nghiệp vụ của thao tác.                   |
| transferred_at | timestamp with time zone | Không | —                                                                    | now()             | Thời điểm chuyển bàn.                           |

### Quan hệ của table_transfer_history

- FOREIGN KEY (from_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (session_id) REFERENCES table_session(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (to_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (transferred_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của table_transfer_history

```sql
table_transfer_history_check: CHECK ((from_table_id <> to_table_id))
table_transfer_history_reason_check: CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
table_transfer_history_from_table_id_restaurant_id_fkey: FOREIGN KEY (from_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
table_transfer_history_session_id_fkey: FOREIGN KEY (session_id) REFERENCES table_session(id)
table_transfer_history_to_table_id_restaurant_id_fkey: FOREIGN KEY (to_table_id, restaurant_id) REFERENCES dining_table(id, restaurant_id)
table_transfer_history_transferred_by_restaurant_id_fkey: FOREIGN KEY (transferred_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
table_transfer_history_from_table_id_not_null: NOT NULL from_table_id
table_transfer_history_id_not_null: NOT NULL id
table_transfer_history_reason_not_null: NOT NULL reason
table_transfer_history_restaurant_id_not_null: NOT NULL restaurant_id
table_transfer_history_session_id_not_null: NOT NULL session_id
table_transfer_history_to_table_id_not_null: NOT NULL to_table_id
table_transfer_history_transferred_at_not_null: NOT NULL transferred_at
table_transfer_history_transferred_by_not_null: NOT NULL transferred_by
table_transfer_history_pkey: PRIMARY KEY (id)
```

### Chỉ mục của table_transfer_history

```sql
CREATE UNIQUE INDEX table_transfer_history_pkey ON public.table_transfer_history USING btree (id);
CREATE INDEX table_transfer_history_session_idx ON public.table_transfer_history USING btree (session_id, transferred_at);
```

### Trigger của table_transfer_history

```sql
CREATE TRIGGER workforce_immutable BEFORE DELETE OR UPDATE ON public.table_transfer_history FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
```

## unit_of_measure

Đơn vị cơ sở và nhóm đơn vị cho nguyên liệu.

Có 8 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/inventory/inventory.routes.ts](../apps/api/src/modules/inventory/inventory.routes.ts).

| Cột           | Kiểu PostgreSQL             | NULL? | Khóa | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | --------------------------- | ----- | ---- | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                        | Không | PK   | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| code          | text                        | Không | —    | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name          | text                        | Không | —    | —                 | Tên hiển thị đối tượng.                                            |
| dimension     | text                        | Không | —    | —                 | Nhóm đơn vị MASS/VOLUME/COUNT.                                     |
| decimal_scale | integer                     | Không | —    | —                 | Số chữ số thập phân đơn vị hỗ trợ.                                 |
| is_active     | boolean                     | Không | —    | true              | Cờ hoạt động của danh mục/đối tượng.                               |
| created_at    | timestamp(6) with time zone | Không | —    | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp(6) with time zone | Không | —    | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của unit_of_measure

Không có FK khai báo trực tiếp trong metadata.

### Ràng buộc của unit_of_measure

```sql
unit_of_measure_code_check: CHECK ((length(btrim(code)) > 0))
unit_of_measure_decimal_scale_check: CHECK ((decimal_scale >= 0))
unit_of_measure_decimal_scale_check1: CHECK ((decimal_scale <= 6))
unit_of_measure_dimension_check: CHECK ((dimension = ANY (ARRAY['MASS'::text, 'VOLUME'::text, 'COUNT'::text])))
unit_of_measure_dimension_check1: CHECK ((length(btrim(dimension)) > 0))
unit_of_measure_name_check: CHECK ((length(btrim(name)) > 0))
unit_of_measure_code_not_null: NOT NULL code
unit_of_measure_created_at_not_null: NOT NULL created_at
unit_of_measure_decimal_scale_not_null: NOT NULL decimal_scale
unit_of_measure_dimension_not_null: NOT NULL dimension
unit_of_measure_id_not_null: NOT NULL id
unit_of_measure_is_active_not_null: NOT NULL is_active
unit_of_measure_name_not_null: NOT NULL name
unit_of_measure_updated_at_not_null: NOT NULL updated_at
unit_of_measure_pkey: PRIMARY KEY (id)
unit_of_measure_code_key: UNIQUE (code)
```

### Chỉ mục của unit_of_measure

```sql
CREATE UNIQUE INDEX unit_of_measure_code_key ON public.unit_of_measure USING btree (code);
CREATE UNIQUE INDEX unit_of_measure_pkey ON public.unit_of_measure USING btree (id);
```

### Trigger của unit_of_measure

```sql
CREATE TRIGGER core_touch BEFORE UPDATE ON public.unit_of_measure FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## user_role

Lịch sử gán vai trò; revoked_at rỗng là gán còn hiệu lực.

Có 7 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/support/support.routes.ts](../apps/api/src/modules/support/support.routes.ts), [apps/api/src/modules/support/support.service.ts](../apps/api/src/modules/support/support.service.ts), [apps/api/src/modules/auth/index.ts](../apps/api/src/modules/auth/index.ts), [apps/api/src/modules/staff-access/staff-access.routes.ts](../apps/api/src/modules/staff-access/staff-access.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột         | Kiểu PostgreSQL          | NULL? | Khóa          | Default           | Ý nghĩa hiện tại                                                   |
| ----------- | ------------------------ | ----- | ------------- | ----------------- | ------------------------------------------------------------------ |
| id          | uuid                     | Không | PK            | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| user_id     | uuid                     | Không | FK → app_user | —                 | Tài khoản nhân viên được tham chiếu.                               |
| role_id     | uuid                     | Không | FK → role     | —                 | Tham chiếu role; không xóa lịch sử                                 |
| assigned_at | timestamp with time zone | Không | —             | now()             | Thời điểm cấp                                                      |
| revoked_at  | timestamp with time zone | Có    | —             | —                 | Null khi còn hiệu lực                                              |
| created_at  | timestamp with time zone | Không | —             | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at  | timestamp with time zone | Không | —             | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của user_role

- FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT; mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của user_role

```sql
user_role_check: CHECK (((revoked_at IS NULL) OR (revoked_at >= assigned_at)))
user_role_role_id_fkey: FOREIGN KEY (role_id) REFERENCES role(id) ON UPDATE RESTRICT ON DELETE RESTRICT
user_role_user_id_fkey: FOREIGN KEY (user_id) REFERENCES app_user(id) ON UPDATE RESTRICT ON DELETE RESTRICT
user_role_assigned_at_not_null: NOT NULL assigned_at
user_role_created_at_not_null: NOT NULL created_at
user_role_id_not_null: NOT NULL id
user_role_role_id_not_null: NOT NULL role_id
user_role_updated_at_not_null: NOT NULL updated_at
user_role_user_id_not_null: NOT NULL user_id
user_role_pkey: PRIMARY KEY (id)
core_tenant_check: TRIGGER DEFERRABLE
```

### Chỉ mục của user_role

```sql
CREATE UNIQUE INDEX user_role_one_active ON public.user_role USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX user_role_pkey ON public.user_role USING btree (id);
CREATE INDEX user_role_role_idx ON public.user_role USING btree (role_id);
```

### Trigger của user_role

```sql
CREATE TRIGGER user_role_updated BEFORE UPDATE ON public.user_role FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER core_tenant_check AFTER INSERT OR UPDATE ON public.user_role DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION core_tenant_guard('app_user', 'user_id');
```

## work_shift

Khoảng thời gian ca và phút nghỉ.

Có 10 cột. Tham chiếu tên bảng trong backend: [apps/api/src/modules/workforce/payroll.routes.ts](../apps/api/src/modules/workforce/payroll.routes.ts), [apps/api/src/modules/workforce/workforce.routes.ts](../apps/api/src/modules/workforce/workforce.routes.ts), [apps/api/src/modules/workforce/workforce.service.ts](../apps/api/src/modules/workforce/workforce.service.ts).

| Cột           | Kiểu PostgreSQL          | NULL? | Khóa                           | Default           | Ý nghĩa hiện tại                                                   |
| ------------- | ------------------------ | ----- | ------------------------------ | ----------------- | ------------------------------------------------------------------ |
| id            | uuid                     | Không | PK                             | gen_random_uuid() | Mã định danh chính của bản ghi.                                    |
| restaurant_id | uuid                     | Không | FK → app_user; FK → restaurant | —                 | Nhà hàng sở hữu/phạm vi dữ liệu.                                   |
| code          | text                     | Không | —                              | —                 | Mã nghiệp vụ, phạm vi duy nhất xem UNIQUE/index.                   |
| name          | text                     | Không | —                              | —                 | Tên hiển thị đối tượng.                                            |
| starts_at     | timestamp with time zone | Không | —                              | —                 | Thời điểm bắt đầu ca/phân công.                                    |
| ends_at       | timestamp with time zone | Không | —                              | —                 | Thời điểm kết thúc ca/phân công.                                   |
| break_minutes | integer                  | Không | —                              | 0                 | Phút nghỉ của ca, trừ khi gợi ý thời gian công.                    |
| created_by    | uuid                     | Không | FK → app_user                  | —                 | Tài khoản tạo bản ghi.                                             |
| created_at    | timestamp with time zone | Không | —                              | now()             | Thời điểm tạo bản ghi.                                             |
| updated_at    | timestamp with time zone | Không | —                              | now()             | Mốc cập nhật bản ghi; xem default/trigger để biết cơ chế cập nhật. |

### Quan hệ của work_shift

- FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.
- FOREIGN KEY (restaurant_id) REFERENCES restaurant(id); mỗi dòng con → 1 cha; mỗi cha → 0..N con.

### Ràng buộc của work_shift

```sql
work_shift_break_minutes_check: CHECK (((break_minutes >= 0) AND (break_minutes <= 240)))
work_shift_check: CHECK (((ends_at > starts_at) AND (ends_at <= (starts_at + '16:00:00'::interval))))
work_shift_check1: CHECK ((((break_minutes)::double precision * '00:01:00'::interval) < (ends_at - starts_at)))
work_shift_code_check: CHECK (((length(btrim(code)) >= 1) AND (length(btrim(code)) <= 64)))
work_shift_name_check: CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)))
work_shift_created_by_restaurant_id_fkey: FOREIGN KEY (created_by, restaurant_id) REFERENCES app_user(id, restaurant_id)
work_shift_restaurant_id_fkey: FOREIGN KEY (restaurant_id) REFERENCES restaurant(id)
work_shift_break_minutes_not_null: NOT NULL break_minutes
work_shift_code_not_null: NOT NULL code
work_shift_created_at_not_null: NOT NULL created_at
work_shift_created_by_not_null: NOT NULL created_by
work_shift_ends_at_not_null: NOT NULL ends_at
work_shift_id_not_null: NOT NULL id
work_shift_name_not_null: NOT NULL name
work_shift_restaurant_id_not_null: NOT NULL restaurant_id
work_shift_starts_at_not_null: NOT NULL starts_at
work_shift_updated_at_not_null: NOT NULL updated_at
work_shift_pkey: PRIMARY KEY (id)
work_shift_id_restaurant_id_key: UNIQUE (id, restaurant_id)
work_shift_restaurant_id_code_key: UNIQUE (restaurant_id, code)
```

### Chỉ mục của work_shift

```sql
CREATE UNIQUE INDEX work_shift_id_restaurant_id_key ON public.work_shift USING btree (id, restaurant_id);
CREATE UNIQUE INDEX work_shift_pkey ON public.work_shift USING btree (id);
CREATE UNIQUE INDEX work_shift_restaurant_id_code_key ON public.work_shift USING btree (restaurant_id, code);
```

### Trigger của work_shift

```sql
CREATE TRIGGER workforce_immutable BEFORE DELETE OR UPDATE ON public.work_shift FOR EACH ROW EXECUTE FUNCTION workforce_immutable();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.work_shift FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```
