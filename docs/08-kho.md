# 08. Kho nguyên liệu và công thức món

## Bắt đầu từ màn hình kho

Đăng nhập ADMIN → chọn **Kho & công thức**. Giao diện được chia theo việc cần làm:

| Mục | Bạn dùng để làm gì? |
|---|---|
| Tồn kho | Xem từng nguyên liệu còn dùng được bao nhiêu tại mỗi kho; kiểm kê hoặc xuất hủy ngay ở dòng đó |
| Phiếu nhập | Lập phiếu, kiểm tra hàng, sửa/hủy nháp và duyệt nhập kho |
| Công thức món | Đọc nguyên liệu và định lượng của món; mở biểu mẫu thay công thức khi cần |
| Lịch sử kho | Tra tăng/giảm nguyên liệu, thời điểm, người thực hiện và lý do |
| Danh mục | Xem/thêm nguyên liệu, kho lưu trữ và đơn vị tính; đây không phải chỗ nhập số tồn |

Bạn không cần đọc hết các mục trong một lần. Nếu muốn biết “hôm nay còn gì để nấu?”, bắt đầu tại **Tồn kho**. Chọn kho, tìm nguyên liệu và đọc cột **Còn dùng**. Chọn tên nguyên liệu để xem chi tiết. Mỗi trang danh sách có tối đa 12 dòng; nút mũi tên ở cuối chuyển trang. Trên điện thoại, một dòng chuyển thành khối có nhãn để dễ đọc.

Ba con số cần phân biệt: **Hiện có** là lượng đang trong kho; **Giữ cho món** là phần dành cho món đã gọi nhưng chưa nấu; **Còn dùng = hiện có − giữ cho món**. Các số đều có đơn vị bên cạnh. Không cộng kg, lít và cái thành một “tổng số lượng”. Thống kê đầu màn hình đếm loại nguyên liệu và dòng nguyên liệu/kho, không cộng các đơn vị khác nhau.

**Hết khả dụng** nghĩa là lượng còn dùng bằng 0. **Cần bổ sung** nghĩa là lượng còn dùng tại kho đó chạm hoặc thấp hơn mức tối thiểu của nguyên liệu, khi mức này lớn hơn 0. Mức 0 được hiểu là chưa đặt cảnh báo tối thiểu. Màu cảnh báo giúp người quản trị xem lại, không tự gửi đơn mua hàng.

## Ví dụ nhập hàng trên giao diện

Giả sử bạn nhận **3 kg gạo, giá 40.000 đ/kg**:

1. Chọn **Lập phiếu nhập**. Chọn kho nhận, nhập số phiếu và nhà cung cấp nếu có.
2. Trong phần hàng nhận, chọn gạo, nhập số lượng **3** và đơn giá **40000**. Nút **Thêm nguyên liệu** tạo thêm dòng nếu cùng chuyến còn hàng khác.
3. Nhấn **Lưu phiếu nhập nháp**. Phiếu xuất hiện trong **Phiếu nhập**, trạng thái **Chờ nhập kho**; tồn gạo chưa tăng.
4. Chọn **Xem phiếu** để đối chiếu hàng. Tổng tiền ví dụ này là **120.000 đ**. Nếu nhập sai, dùng **Sửa phiếu nháp**, ghi lý do rồi lưu. Nếu không nhận hàng, dùng **Hủy phiếu nháp** và ghi lý do.
5. Khi hàng đã nhận đúng, chọn **Duyệt nhập kho** và xác nhận. Tồn gạo tăng 3 kg. Phiếu chuyển thành **Đã nhập kho**; không còn thao tác sửa/hủy như nháp.
6. Sang **Lịch sử kho**, lọc **Nhập kho** hoặc tìm gạo để thấy dòng tăng tồn. Chỉ tối đa 100 biến động mới nhất của toàn nhà hàng được tải ở đây; bộ lọc áp dụng trên danh sách đã tải. Danh sách phiếu cũng gồm tối đa 100 phiếu mới nhất.

Trong **Công thức món**, chọn **Xem công thức** để đọc định lượng và số phần. Chọn **Thay công thức** nếu cần; biểu mẫu điền sẵn công thức đang áp dụng. Lưu tạo phiên bản mới, không sửa định lượng đã ghi trên món cũ. Mục này chỉ liệt kê món có bật quản lý kho.

[Ảnh tồn kho](evidence/inventory-stock.png) · [Chi tiết phiếu nhập](evidence/inventory-receipt.png) · [Danh sách công thức](evidence/inventory-recipes.png) · [Kho trên điện thoại](evidence/inventory-mobile.png). Các ảnh này dùng database kiểm thử riêng của đợt đổi giao diện, không phải bản ghi vận hành của bạn.

## Phân biệt món bán và nguyên liệu

`product` là thứ khách mua. `ingredient` là thứ kho quản lý. `recipe_bom` là phiên bản công thức một món; `recipe_bom_item` là từng nguyên liệu trong công thức. `stock_location` là nơi giữ hàng. `inventory_balance` là số dư của một nguyên liệu tại một vị trí.

Món có `stock_managed=false` được gọi mà không cần giữ/trừ nguyên liệu. Món `is_complimentary=true` có thể là món tặng giá 0. Hai cờ độc lập: món tặng vẫn có thể tiêu hao kho. Giá 0 không được tự suy ra là không quản lý kho.

## Công thức lượng cần giữ

```text
Lượng cần = lượng trong công thức × số phần gọi / sản lượng công thức
           × (1 + tỷ lệ hao hụt / 100)
```

Code làm tròn lên đến 6 chữ số thập phân. Ví dụ công thức một phần cơm cần 0,2 kg gạo, hao hụt 5%; hai phần cần 0,42 kg. Hệ thống chọn một vị trí kho hoạt động có đủ lượng cho từng nguyên liệu; không tự cộng nhiều vị trí nhỏ để đáp ứng một nguyên liệu trong lần giữ này.

Đổi công thức tạo version mới và nghỉ version ACTIVE cũ. Dòng món có snapshot định lượng để hiểu công thức/chi phí tại thời điểm xử lý; đừng sửa lịch sử theo công thức mới.

## Nhập kho: nháp chưa tăng tồn

ADMIN tạo goods_receipt và các dòng goods_receipt_item. Phiếu DRAFT có thể sửa với expectedVersion, hoặc hủy có lý do. Chỉ approve mới tăng on_hand và available, tạo inventory_movement và cập nhật giá vốn bình quân.

```text
Giá vốn mới = (tồn cũ × giá vốn cũ + lượng nhập × giá nhập)
              / (tồn cũ + lượng nhập)
```

Hiện luồng nhập dùng đơn vị cơ sở của nguyên liệu; không nên mô tả như đã có bộ quy đổi thùng/gói/kg hoàn chỉnh chỉ vì schema có unit_id. Phiếu APPROVED không được hủy như một phiếu nháp. Gọi lại approve trả phiếu đã duyệt, tránh tăng tồn lần hai.

## Theo một lượng gạo qua bốn bước

| Bước | Có thực tế on_hand | Đang giữ reserved | Có thể bán available |
|---|---:|---:|---:|
| Nhập 10 kg đã duyệt | 10 | 0 | 10 |
| Giữ 0,42 kg cho hai cơm | 10 | 0,42 | 9,58 |
| Bếp bắt đầu nấu | 9,58 | 0 | 9,58 |
| Hủy muộn sau nấu | 9,58 | 0 | 9,58 |

Nếu hủy **trước** nấu thì reserved giảm và available tăng lại, on_hand giữ nguyên 10. Nhận món ACCEPTED chưa tiêu hao; thao tác prepare mới gọi `consume`.

## Kiểm kê và xuất hủy

COUNT nhận **số tồn thực tế đếm được**, backend tính chênh lệch so với on_hand. WASTE nhận **lượng cần loại bỏ**, backend dùng delta âm. Cả hai cần `balanceId`, `expectedVersion`, `requestId`, quantity và reason.

Tồn sau điều chỉnh không được thấp hơn lượng đang giữ cho món. Cùng requestId/nội dung trả movement cũ; cùng requestId đổi nội dung bị chặn. Ghi inventory_movement và business_audit_event giúp biết ai điều chỉnh, lý do, trước/sau. Không sửa thẳng inventory_balance để “cho số đẹp”, vì sẽ mất dấu truy vết.

## Dấu hiệu cần xem lại khi ổn định

Menu chỉ là dự báo còn phục vụ tại lúc đọc. Tồn có thể thay đổi trước lúc gửi. Một món hiện AVAILABLE không bảo đảm còn đủ cho số lượng bất kỳ. Lỗi thiếu kho lúc submit là kết quả kiểm tra lại hợp lệ; cần hướng dẫn người dùng giảm số lượng hoặc gọi nhân viên.

Cột `ingredient.current_avg_cost` đã được bỏ trong migration 202609300001 vì không được luồng vận hành cập nhật. Giá vốn hiện hành nằm ở `inventory_balance.avg_cost` theo từng vị trí; giá vốn lịch sử nằm trong movement và snapshot nguyên liệu của món.

## Mở mã nguồn và bài tập

Đọc `apps/api/src/modules/inventory/inventory.routes.ts` (phiếu nhập, điều chỉnh), `inventory.service.ts` (reserve/release/consume), `apps/web/features/admin/inventory-panel.tsx` và `stock-adjustment.tsx`.

Giao diện mới ghép các mục tại `inventory-panel.tsx`; hộp phiếu ở `inventory-receipt-detail.tsx`, công thức ở `inventory-recipes.tsx`, biểu mẫu nhập/công thức dùng `inventory-lines-form.tsx`. `GET /core/inventory` bổ sung hai danh sách đọc: `recipes` là công thức đang áp dụng, `recipeItems` là các dòng nguyên liệu tương ứng. Các thao tác ghi, quyền và quy tắc giữ/tiêu hao kho vẫn dùng API hiện có; không thêm bảng hoặc migration cho việc đổi bố cục này.

Nếu on_hand=10, reserved=3, quản trị kiểm kê chỉ còn 2 thì API từ chối vì tồn sau chỉnh thấp hơn lượng đã hứa cho đơn. Cần xử lý các món/giữ kho liên quan theo nghiệp vụ trước; không cố vượt ràng buộc bằng SQL.

## Lựa chọn thực tế và giới hạn quản lý kho

Công thức món nối nguyên liệu và lượng sử dụng để hỗ trợ giá vốn/tồn là mô hình thực tế; Toast cũng mô tả quản lý nguyên liệu và recipe costing. Đây là nguồn tham khảo cách tổ chức nghiệp vụ, không phải định lượng nấu ăn được chứng nhận. [Toast: công thức và giá vốn](https://support.toasttab.com/en/article/Get-Started-With-Recipes).

Dự án chọn **bình quân gia quyền di động theo kho** và tiêu hao khi bếp bắt đầu prepare. Không gọi đây là cách duy nhất của doanh nghiệp: sản phẩm khác có thể dùng FIFO và mốc tiêu hao khác. Hiện chưa theo lô/hạn dùng, chưa có điều chuyển tồn giữa kho; reserve cần đủ một nguyên liệu tại một vị trí, không cộng dồn hai kho thiếu lẻ để tự tách reservation. [Toast: phạm vi quản lý tồn](https://support.toasttab.com/en/article/Toast-IQ-Inventory-Overview).

Seed bố trí mỗi nguyên liệu ở một vị trí để cả 48 món có thể nhận đơn bằng luồng hiện tại. KG/L là đơn vị nền, chai nước/trứng/dừa dùng PCS; công thức demo là định lượng minh họa, cần bếp thực tế hiệu chỉnh khi dùng ngoài luận văn.
