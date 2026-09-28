# Chấm công và kho: cách vận hành và lý do thiết kế

Đối chiếu mã nguồn ngày 28/09/2026, trên dự án thống nhất qr-ordering-thesis. Tài liệu giải thích phần đã triển khai, không coi số lượng bảng hay một lần test đạt là chứng nhận phần mềm phù hợp mọi nhà hàng. Phạm vi hiện tại phù hợp mô hình một nhà hàng, quản trị duyệt công và quản lý kho, nhân viên tự chấm công. Không bổ sung AI hoặc ngân hàng online trong đợt này.

## 1. Vì sao không chỉ có một ô “số giờ làm”?

Phải phân biệt ba dữ liệu: lịch được phân công, giờ nhân viên thực sự bấm vào/ra và số phút quản trị đồng ý trả lương. Ví dụ ca 09:00–15:00 nghỉ 30 phút; nhân viên đến 08:45 và ra 15:30. Không thể tự kết luận 45 phút ngoài ca đều là làm thêm đã được chấp thuận.

Thiết kế giữ nguyên giờ gốc, gợi ý 330 phút trong lịch và yêu cầu quản trị xác nhận riêng nếu duyệt nhiều hơn. Điều này giúp đối chiếu được ai ghi nhận, ai duyệt và vì sao số phút trả lương khác thời gian có mặt.

## 2. Các phần dữ liệu chấm công phối hợp thế nào?

| Thành phần | Lưu gì? | Vì sao tách riêng? |
|---|---|---|
| work_shift | Ca cụ thể có ngày bắt đầu/kết thúc, giờ nghỉ | Ca đêm phải có hai ngày rõ ràng; không chỉ lưu “22 giờ đến 6 giờ”. |
| shift_assignment | Nhân viên được giao ca nào, khu vực, trạng thái | Một ca có nhiều người; mỗi người có nhiều ca; chặn ca chồng nhau. |
| attendance_record | Giờ vào/ra gốc, kết quả ca, phút được duyệt và người duyệt | Không sửa dấu chấm công gốc để làm số lương có vẻ khớp. |
| employee_pay_rate | Đơn giá giờ và ngày hiệu lực | Đổi lương tương lai không sửa tiền công cũ. |
| payroll_run/slip/line | Kỳ lương, phiếu của từng người, chi tiết | Tách lập nháp, kiểm tra và chốt; mỗi dòng giữ đơn giá đã áp dụng. |
| payroll_payment | Giao dịch ghi nhận đã trả lương | Chốt bảng lương chưa có nghĩa nhân viên đã nhận tiền. |
| business_audit_event | Ai duyệt/điều chỉnh, lúc nào, lý do | Có thể giải thích quyết định, không chỉ nhìn con số cuối. |

## 3. Luồng chấm công nên làm mỗi ngày

1. Quản trị vào Nhân sự → Lịch & chấm công, tạo ca đúng ngày. Ca qua đêm phải chọn ngày kết thúc hôm sau; giờ nghỉ là số phút không tính lương theo lịch đã thỏa thuận.
2. Phân công người và khu vực. Hai ca liền nhau được phép; ca chồng thời gian bị chặn. Khu vực phân công hiện giúp tổ chức công việc, chưa tự giới hạn mọi quyền phục vụ theo khu vực.
3. Nhân viên mở lịch cá nhân và bấm vào ca. Thời gian lấy từ server, không nhận giờ do điện thoại tự gửi. Chỉ vào trong cửa sổ cho phép; nếu còn ca chưa ra thì phải xử lý ca đó trước.
4. Cuối ca bấm ra. Bấm lại do mạng chậm trả về dấu chấm đã ghi, không tạo thêm lần chấm.
5. Sau khi ca kết thúc, quản trị kiểm tra giờ gốc và duyệt. Số phút gợi ý chỉ tính khoảng có mặt nằm trong lịch, trừ nghỉ theo lịch và không âm.
6. Lập lương từ công đã duyệt. Kỳ đã chốt không cho sửa phá lịch sử; khoản điều chỉnh tài chính cần thể hiện thành dòng riêng.

## 4. Những tình huống chấm công cần hiểu đúng

| Tình huống | Cách xử lý trong bản hiện tại |
|---|---|
| Ca 09:00–15:00, nghỉ 30 phút, đến 09:15, ra 14:45 | Gợi ý 300 phút, thay vì mặc định trả đủ 330 phút. Quản trị vẫn quyết định số được duyệt và ghi lý do. |
| Ca 22:00–06:00 hôm sau, nghỉ 30 phút, đủ dấu chấm | Gợi ý 450 phút; tính theo thời điểm đầy đủ nên không ra số giờ âm. |
| Đến sớm/ra muộn | Không tự cộng thành giờ trả lương. Nếu thực sự làm thêm, chọn xác nhận giờ ngoại lệ và ghi lý do. |
| Quên vào hoặc ra | Chọn “Bổ sung do thiếu chấm công”, nhập phút có căn cứ và lý do; không chế tạo giờ vào/ra giả. |
| Không làm / nghỉ | Chọn Vắng mặt hoặc Nghỉ phép; bản hiện tại ghi 0 phút lương giờ. Chưa có cơ chế phép hưởng lương riêng. |
| Nghỉ thực tế khác lịch | Quản trị đối chiếu và ghi rõ trong lý do; hệ thống chưa ghi từng lần nghỉ bằng đồng hồ riêng. |
| Duyệt lặp cùng nội dung | Trả lại kết quả đã duyệt, không tạo công hoặc tiền lần hai. Nội dung khác bị chặn, không âm thầm ghi đè. |

Giới hạn ca, nghỉ, vào sớm và ra muộn có thể cấu hình. Các giới hạn kỹ thuật này không phải tuyên bố về quy định lao động. Cách tính lương hiện là phút được duyệt × đơn giá giờ / 60, làm tròn đồng; chưa có hệ số làm thêm, ngày lễ, bảo hiểm hay thuế lương tự động. Nhà hàng phải thống nhất chính sách tương ứng trước khi dùng để trả lương thật.

## 5. Vì sao kho có ba con số?

Ví dụ kho có 10 kg gà. Có món đã được chấp nhận cần 2 kg nhưng chưa nấu:

| Thời điểm | Hiện có | Đang giữ | Có thể dùng |
|---|---|---|---|
| Chưa có món | 10 kg | 0 kg | 10 kg |
| Giữ 2 kg cho món | 10 kg | 2 kg | 8 kg |
| Bắt đầu nấu 2 kg | 8 kg | 0 kg | 8 kg |

Quan hệ luôn là “Có thể dùng = Hiện có − Đang giữ”. Lúc giữ chưa lấy nguyên liệu ra khỏi tồn vật lý; khi bắt đầu nấu mới tiêu hao. Vì thế hoàn tất món, mang ra bàn hay thanh toán không được trừ nguyên liệu thêm lần nữa.

Đơn chờ duyệt có thể giữ tạm với thời hạn để tránh nhiều khách cùng đặt phần nguyên liệu cuối. Bị từ chối, hết hạn hoặc hủy trước nấu sẽ giải phóng phần giữ. Đã nấu thì nguyên liệu đã dùng: hủy món không thể tự “biến gà chín thành gà sống” trong kho.

## 6. Các phần dữ liệu kho

| Thành phần | Nhiệm vụ |
|---|---|
| ingredient + unit_of_measure | Nguyên liệu và đơn vị cơ sở, ví dụ gà/kg, dầu/lít, trứng/cái. |
| stock_location | Kho vật lý như kho bếp, kho khô. |
| goods_receipt + goods_receipt_item | Phiếu nhập và từng nguyên liệu thực nhận. |
| inventory_balance | Số dư hiện tại của một nguyên liệu tại một kho, dùng kiểm tra nhanh. |
| inventory_movement | Sổ tăng/giảm: nhập, tiêu hao, xuất hủy, điều chỉnh kiểm kê. |
| recipe_bom + recipe_bom_item | Công thức có phiên bản và lượng nguyên liệu cho số phần xác định. |
| inventory_reservation | Nguyên liệu đã dành cho món nhưng chưa tiêu hao. |
| order_item_ingredient_snapshot | Công thức/lượng/giá vốn đã dùng cho món cụ thể. |

Số dư giúp xem nhanh, sổ biến động giúp giải thích vì sao số dư như vậy. Không cho sửa một con số tồn mà không có nghiệp vụ và lịch sử đi kèm.

## 7. Nhập kho đúng cách

Vào Quản trị → Kho, thiết lập nguyên liệu và đơn vị cơ sở trước. Khi nhập hàng, lập phiếu nháp với số phiếu, kho nhận, nhà cung cấp nếu có, lượng thực nhận và đơn giá cho một đơn vị cơ sở. Ví dụ đơn vị là kg thì 500 g phải nhập 0,5 kg, không nhập 500.

Phiếu nháp chưa tăng tồn. Có thể sửa có lý do và kiểm tra phiên bản, hoặc hủy nháp. Duyệt nhập mới tăng tồn và tạo sổ; bấm duyệt lại không cộng thêm. Phiếu đã duyệt không sửa/xóa như nháp. Nếu thực tế có sai lệch, phải ghi nghiệp vụ điều chỉnh có giải thích, không xóa dấu vết phiếu cũ.

Giá vốn bình quân sau nhập = (tồn cũ × giá bình quân cũ + lượng nhập × giá nhập) / (tồn cũ + lượng nhập). Ví dụ 10 kg giá 100.000đ/kg, nhập 10 kg giá 120.000đ/kg thì giá bình quân mới là 110.000đ/kg. Giá vốn món lấy tại lúc tiêu hao và được lưu lại; nhập hàng giá mới không sửa giá vốn món đã nấu.

Tiền từng dòng làm tròn đến đồng; tổng phiếu cộng các dòng đã làm tròn để khớp sổ. Số lượng giữ độ chính xác sáu chữ số thập phân trong database; giao diện có thể rút gọn khi hiển thị.

## 8. Kiểm kê khác xuất hủy thế nào?

Trong bảng Tồn kho, chọn “Kiểm kê / xuất hủy” ở đúng nguyên liệu và kho.

| Loại | Bạn nhập gì? | Hệ thống làm gì? |
|---|---|---|
| Kiểm kê | Tổng lượng thực đếm còn trong kho, gồm phần đang giữ chưa nấu | Ghi chênh lệch so với hiện có thành điều chỉnh tăng/giảm. |
| Xuất hủy | Lượng nguyên liệu hỏng cần loại bỏ | Ghi giảm tồn bằng nghiệp vụ xuất hủy. |

Ví dụ hệ thống có 10 kg, thực đếm còn 9 kg: nhập 9 ở kiểm kê, hệ thống ghi giảm 1 kg. Nếu xác định 1 kg đang hỏng và muốn xuất hủy: chọn xuất hủy, nhập 1. Không làm cả hai cho cùng lượng mất, vì sẽ trừ hai lần.

Mỗi lần bắt buộc lý do, lưu người thực hiện, thời điểm và mã chống gửi trùng. Nếu kho thay đổi trong lúc bạn mở form, thao tác bị chặn để tải lại và kiểm tra, tránh lấy số kiểm kê cũ đè lên nhập/xuất mới. Sau điều chỉnh không được nhỏ hơn lượng đang giữ cho món; cần xử lý món không thể phục vụ trước.

Giá trị điều chỉnh dùng giá bình quân đang có. Chênh lệch tăng không phải mua hàng mới, nên không tự tạo phiếu nhập/chi tiền. Với nguyên liệu chưa có số dư, dùng phiếu nhập để tạo tồn ban đầu và căn cứ giá vốn. Món đã nấu bị bỏ đã có bút toán tiêu hao; dùng luồng hủy muộn món và không xuất hủy nguyên liệu lần nữa.

## 9. Phân quyền và những giới hạn còn lại

Quản trị tạo/duyệt công, quản lý kho và ghi điều chỉnh. Nhân viên tự chấm công của mình. Phục vụ/bếp ảnh hưởng kho thông qua trạng thái món, không được tự sửa tồn. Backend kiểm tra quyền và trạng thái ngay cả khi ai đó dùng màn hình cũ.

Phần này chưa phải ERP đầy đủ: chưa có quản lý lô/hạn dùng/FEFO, chuyển kho có phiếu, trả nhà cung cấp, kiểm kê nguyên kho theo đợt, tự quy đổi bao/thùng/kg, nhiều lần nghỉ/vào-ra trong một ca, phép hưởng lương hoặc quy trình sửa công đã duyệt. Công đã duyệt giữ nguyên; điều chỉnh tiền trong kỳ nháp là dòng lương riêng có lý do, không làm giả dữ liệu công. Khi cần sửa bản thân kết quả công đã duyệt phải bổ sung quy trình hiệu chỉnh có phiên bản, không sửa trực tiếp DB.

Một nguyên liệu của một món hiện được giữ từ một kho đủ lượng, chưa chia cùng nguyên liệu qua nhiều kho. Danh sách biến động trên giao diện hiện lấy 100 dòng gần nhất. Các giới hạn này cần được cân nhắc nếu triển khai quy mô lớn hơn; không gọi chúng là đã hoàn thiện chỉ vì bảng dữ liệu có sẵn.

## 10. Checklist tự thử

1. Tạo ca qua đêm và ca chồng nhau: ca đêm hợp lệ; phân công chồng bị chặn.
2. Chấm vào/ra, bấm lặp: dấu thời gian giữ nguyên. Thử tài khoản khác không được chấm hộ.
3. Đến sớm/ra muộn: kiểm tra gợi ý chỉ trong ca. Duyệt vượt gợi ý khi chưa xác nhận phải bị chặn; xác nhận kèm lý do mới được duyệt.
4. Thử quên chấm công và vắng: chọn đúng kết quả; không sinh giờ gốc giả, không ghi vắng thành làm việc 0 phút.
5. Lập phiếu nhập nháp, sửa, hủy: tồn không đổi. Duyệt một phiếu khác hai lần: tồn chỉ tăng một lần.
6. Gửi món rồi bắt đầu nấu: phân biệt phần giữ và phần tiêu hao. Hủy trước nấu trả phần giữ; hủy muộn không trả tồn.
7. Kiểm kê 10 thành 9: chỉ giảm 1. Xuất hủy riêng 0,5: giảm thêm 0,5; xem người/lý do trên sổ.
8. Mở hai tab điều chỉnh cùng số dư: tab lưu sau phải nhận xung đột. Giảm dưới lượng đang giữ phải bị chặn.
9. Kiểm tra điện thoại: mở form, chọn đúng nguyên liệu/đơn vị, hủy form không thay tồn; tên dài và bảng cuộn không che nút.

## 11. Nguồn tham khảo thiết kế

Đối chiếu nguyên tắc quản trị công và công chưa đầy đủ với tài liệu chính thức Odoo “Work approvals and overtime”: https://www.odoo.com/documentation/19.0/applications/hr/attendances/management.html . Đây là tham khảo cách tách giờ ghi nhận và phê duyệt, không sao chép toàn bộ sản phẩm.

Đối chiếu kiểm kê tạo bút toán chênh lệch với “Inventory adjustments”: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html . Đối chiếu loại bỏ nguyên liệu không còn sử dụng với “Scrap inventory”: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/scrap_inventory.html . Phần triển khai của dự án dùng sổ biến động hiện có và quyền quản trị, không triển khai kho ảo hay kế toán của Odoo.

Nguồn quyết định cuối là code API, migration và các kiểm thử của dự án. Các ví dụ trong tài liệu là tình huống giả định để học và nghiệm thu.
