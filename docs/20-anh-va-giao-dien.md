# 20. Giao diện, ảnh thật và cách thay ảnh

## Thông báo thao tác có thanh thời gian — 15/10/2026

Thông báo thao tác dùng chung cho khách và nội bộ xuất hiện ở góc phải phía trên, có biểu tượng, nội dung và nút ×. Thành công dùng xanh lá; thông tin như lịch đã tồn tại hoặc chỉ hủy được một phần dùng xanh dương để không báo nhầm thành công toàn bộ. Thanh ở chân thẻ giảm dần và thông báo tự đóng sau khoảng **5 giây**.

Khi rê chuột, đặt focus vào thông báo hoặc chuyển sang tab khác, bộ đếm tạm dừng; quay lại thì chạy tiếp thời gian còn lại. Nút **Đóng thông báo** tắt ngay bằng chuột, chạm hoặc bàn phím. Thông báo mới có đủ 5 giây riêng, không bị bộ đếm của thông báo cũ đóng nhầm. Khi có hộp thoại, thông báo vẫn nằm trên lớp hộp thoại để nút × thao tác được.

Màn hình nhỏ tự xuống dòng trong khung và không che thanh giỏ/điều hướng phía dưới. Chế độ giảm chuyển động bỏ chuyển tiếp của thanh nhưng vẫn giữ thời gian tự đóng. Lỗi nhập liệu vẫn hiển thị tại biểu mẫu; dòng trạng thái món “Từ bếp” vẫn là khu vực cập nhật riêng.

## Đã đủ ảnh thực đơn — 15/10/2026

Đã gắn thêm **5 ảnh PNG** chủ dự án gửi theo đúng thứ tự cho Bún gà sả, Rau cải xào tỏi (phần cơm), Lẩu Thái bò & tôm, Canh rau củ (phần cơm), Rau câu dừa sữa. Hiện **91/91 sản phẩm có ảnh**, không còn món chờ bổ sung ảnh. Các ảnh được dùng minh họa theo lựa chọn của chủ dự án; tên món, thành phần, định lượng, giá và danh mục giữ nguyên.

Giữ nguyên nội dung PNG được gửi, không đổi đuôi giả hoặc chỉnh ảnh. Bản cài đặt ở `packages/database/resources/menu-images`; ảnh được phục vụ từ cùng kho `var/menu-images`, thông qua URL `product.image_url` như ảnh tải từ ADMIN. [Metadata năm ảnh](../packages/database/resources/menu-images/owner-additions-20261015.json) lưu mã món, URL, kích thước và hash; nguồn `USER_PROVIDED`, chưa tự xác minh giấy phép. Xem bảng gắn ảnh phía dưới và [hồ sơ đối chiếu](15-doi-chieu.md).

## Hồ sơ ảnh và phân loại đã cập nhật — 14/10/2026

Trong đợt 14/10 đã xem đủ 33 ảnh trong `img_add_food_2`, bổ sung **28 ảnh**, nâng danh mục lên **86/91 sản phẩm có ảnh** tại thời điểm đó. Ba ảnh trà dâu, vịt kho gừng và gỏi ngó rau củ được chủ dự án xác nhận dùng minh họa. Ảnh combo lẩu gà minh họa món lẩu chính; thành phần chả giò và nước sâm vẫn được ghi đầy đủ, không coi ảnh là toàn bộ khẩu phần. Một số ảnh cơm chỉ chụp món chính; phần cơm được ghi trong mô tả.

Rà toàn bộ 91 sản phẩm, sửa nhóm cho **26 món**, thêm bốn danh mục:

| Nhóm          | Sản phẩm |
| ------------- | -------: |
| Combo         |        5 |
| Khai vị & gỏi |        8 |
| Bánh & cuốn   |        3 |
| Cơm           |        8 |
| Bún, phở & mì |        7 |
| Món mặn       |       19 |
| Rau & đậu hũ  |        3 |
| Canh          |       11 |
| Lẩu           |        5 |
| Tráng miệng   |       13 |
| Thức uống     |        9 |

Canh khổ qua nhồi thịt thuộc **Canh**, lẩu dùng nóng tại bàn thuộc **Lẩu**. Súp bắp gà dạng khai vị giữ trong Khai vị & gỏi. Bánh xèo/mâm cuốn tách khỏi Cơm; rau, nấm và đậu hũ có nhóm riêng. Combo vẫn ngay sau Tất cả trên bộ lọc khách. **Mã là định danh:** LAU-11 vẫn giữ mã cũ để không đổi quan hệ/lịch sử, còn danh mục thực tế là Canh.

Dữ liệu khởi tạo và món nhập qua ADMIN cùng dùng `product.category_id` và `product.image_url`. Giao diện không suy ra danh mục hoặc ảnh từ tiền tố mã món. Nguồn chuẩn là [menu-categories.ts](../packages/database/src/menu-categories.ts); giữ ID bảy danh mục cũ, không reset/seed lại database vận hành.

Ảnh JPEG gốc được giữ nguyên, kể cả watermark. Bản cài đặt nằm trong `packages/database/resources/menu-images`, khi chạy được đưa vào **cùng kho `var/menu-images`** bằng cơ chế upload hiện hành. Filename UUID được tính từ nội dung; URL thực nằm ở database. [Metadata 28 ảnh](../packages/database/resources/menu-images/owner-additions-20261014.json) ghi nguồn chủ dự án cung cấp, không tự gán tác giả/giấy phép chưa xác minh. Thư mục ảnh trên OneDrive không bị chỉnh sửa.

Tham khảo cách chia nhóm trên thực đơn [Quán Ngon 138](https://quanngon138.com/cua-hang/page/3/) và [Bếp Cuốn](https://bepcuon.net/thuc-don/); các món được đối chiếu trực tiếp với tên/cách phục vụ và công thức của dự án.

## Khu vực khuyến mãi, VAT và phiếu mới — 13/10/2026

ADMIN có nhóm **Khuyến mãi & VAT** riêng: **Chương trình khuyến mãi** quản lý quy tắc giảm tiền thật; **Giá & VAT** quản lý mốc thuế và phân loại từng món. Phần **Thực đơn → Ảnh giới thiệu** vẫn chỉ quản lý banner quảng bá, không tự giảm tiền. Ảnh và dữ liệu món dùng cùng kho đã mô tả bên dưới.

Khách/phục vụ có phần **Khuyến mãi của bàn**, thông báo điều kiện không đạt, ưu đãi đang áp dụng và lý do bị khóa. Khi nhiều món/khách, phần giảm và VAT theo đúng dòng món do API cung cấp. Thu tiền, tiền mặt khách đưa/thối và hoàn do điều chỉnh được tách riêng. Báo cáo admin có dữ liệu giảm/VAT; dữ liệu lịch sử thiếu thuế có thông báo riêng.

Bố cục đã kiểm tra có/không dữ liệu, tên dài, phiếu cũ, nhiều thuế suất, khoản thu chờ, hủy món và khổ in 80mm trên desktop/Android/Safari. [Hướng dẫn tính tiền ở bài 06](06-thanh-toan.md), [thao tác nhân viên ở bài 25](25-thu-tien-tai-ban.md).

## Hồ sơ ảnh trước đợt bổ sung — 13/10/2026

Kho ảnh thống nhất và chức năng **Thực đơn → Ảnh giới thiệu** đã được đưa vào ứng dụng đang chạy. Có 58 sản phẩm gắn ảnh, 33 còn cần ảnh trong bảng phía dưới. Sau kích hoạt đã kiểm tra 57 URL ảnh khác nhau, tất cả trả HTTP 200. Ảnh món cũ ở public được đưa vào bản lưu trữ; thay ảnh qua ADMIN từ nay dùng một kho duy nhất.

Đợt này đạt 33 ca browser ảnh/banner/giỏ trên ba loại thiết bị; 6 ca được chạy lại sau khi sửa cách hiển thị nguồn ảnh. [Nghiệm thu và phạm vi đầy đủ](15-doi-chieu.md).

## Mỗi vai trò nhìn thấy gì?

Bản cập nhật ảnh và thực đơn ngày **13/10/2026** dùng ảnh món Việt và không gian quán ăn, nền kem ấm, thẻ trắng và điểm nhấn xanh rừng trên các màn hình khách và nội bộ. Ảnh giới thiệu nằm trong khối gọn ở đầu màn hình; danh sách món, việc cần xử lý và nút thao tác vẫn là nội dung chính. Nhãn trạng thái luôn có chữ, không cần đoán chỉ bằng màu. Tên nhận diện giữ là **Quyết Trường Bistro**.

Ảnh công khai được chọn theo nội dung phù hợp với từng vai trò; ảnh từ nguồn bên ngoài không phải ảnh chụp tại Quyết Trường Bistro. Nguồn, tác giả, giấy phép và bước chuyển đổi được lưu trong [SOURCES.md](../apps/web/public/images/SOURCES.md) và [photo-metadata.json](../apps/web/public/images/photo-metadata.json). Khi nhà hàng có ảnh riêng, có thể thay theo đúng tên tệp bên dưới.

| Người dùng             | Cách bố trí                                                                                                                                                | Việc nên làm trước                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Khách                  | Danh sách món trên điện thoại; ảnh bên trái, tên/mô tả/giá và nút Thêm bên phải; năm mục ở thanh dưới                                                      | Quét QR, chọn món, vào giỏ rồi gửi     |
| Phục vụ                | Bàn chia theo khu vực; có bộ lọc và dấu hiệu cần xử lý; bốn mục ở thanh dưới trên điện thoại; Việc cần làm gộp thu tiền/hỗ trợ và hiển thị người phụ trách | Xem bàn cần xử lý hoặc Việc cần làm    |
| Bếp                    | Ba nhóm lượt: chờ tiếp nhận, đang chế biến, chờ phục vụ; có nút lọc từng nhóm                                                                              | Nhận món, chế biến, báo món đã xong    |
| Quản trị               | Thanh menu bên trái trên máy tính; số liệu, danh sách và biểu mẫu được tách riêng                                                                          | Chọn đúng nhóm công việc               |
| Nhân viên xem ca/lương | Ba mục cá nhân; ưu tiên ca hiện tại/sắp tới, lịch theo ngày và phiếu lương của mình                                                                        | Vào ca/ra ca khi đến thời điểm phù hợp |

Trên máy tính, banner và lưới món nằm trong cùng cột thực đơn; giỏ ở cột bên phải và được ghim khi cuộn. Trên điện thoại, giỏ được mở bằng thanh dưới hoặc nút tổng giỏ khi đã chọn món. Bảng tuần phân ca cần nhiều cột nên có vùng cuộn riêng; màn hình không ép cả bảng vào chiều rộng điện thoại. Lịch sử chấm công cá nhân dùng thẻ có nhãn trên điện thoại.

Thực đơn quản trị có tìm tên/mã, lọc danh mục và mỗi trang 12 món. Chọn **Chỉnh sửa** để mở ảnh và thông tin của một món. Báo cáo có sáu mục: **Hỗ trợ tại bàn** và **Đối soát phiên**, **Doanh số món**, **Tiền đã thu**, **Hồ sơ thiếu tiền**, **Xử lý món**. Chính sách chia thành **Quy tắc gọi món**, **Bàn & thanh toán**, **Ca & chấm công**.

Trạng thái bán do quản trị chọn và khả năng phục vụ theo kho là hai thông tin khác nhau. Catalog trả `configured_availability_status` là lựa chọn đã lưu, còn `availability_status` phản ánh món đang có đủ nguyên liệu/công thức và thành phần để được gọi hay không. Thiếu kho không tự đổi lựa chọn bán sang tạm ngừng; thay ảnh hoặc sửa thông tin phải giữ đúng lựa chọn đã lưu. Nhập thêm nguyên liệu có thể làm món khả dụng lại mà không cần vô tình bật/tắt một trạng thái bán mới.

### Trang chào và đăng nhập nội bộ

Đường dẫn `/` mở thẳng đăng nhập nội bộ. Khách quét QR để vào `/guest`, xem lời chào và tham gia đúng bàn; thực đơn và banner quảng bá xuất hiện sau khi vào bàn. Giá, trạng thái phục vụ và thành phần combo được đọc từ API.

Màn hình khách vừa quét QR có ảnh bữa ăn, tên bàn/khu vực và biểu mẫu tên/mã bàn bên cạnh trên máy tính, xếp theo chiều dọc trên điện thoại. Mã QR và mã bàn vẫn được kiểm tra bởi API; hình ảnh không thay thế việc xác thực bàn.

Đăng nhập nội bộ dùng **một thẻ đăng nhập trên ảnh nền**, gồm tên đăng nhập, mật khẩu, nút hiện/ẩn mật khẩu và lời nhắc liên hệ quản lý. Không thêm dashboard hoặc giới thiệu nghiệp vụ vào màn hình này. Đăng nhập thành công vẫn dẫn đến đúng không gian quản trị, phục vụ hoặc bếp theo tài khoản được cấp.

## Một kho ảnh món cho cả dữ liệu khởi tạo và admin

Danh mục chuẩn có **86 món lẻ và 5 combo**, sử dụng cùng bảng `product` và công thức kho như món tạo từ giao diện quản trị. Hiện **58 sản phẩm có ảnh**; **33 sản phẩm còn cần ảnh đúng món**. 20 ảnh phù hợp trong thư mục `img_add_food` đã được bổ sung; ba ảnh mạng mới là bún thịt nướng, mì Quảng tôm thịt và thịt kho trứng.

**Kho ảnh được ứng dụng đọc duy nhất là `var/menu-images` tại gốc repository.** Ảnh khởi tạo và ảnh admin tải lên đều đi qua `storeMenuImage()`, đều được lưu dưới tên UUID và đều được ghi vào `product.image_url` bằng URL `/api/menu-images/<UUID>.jpg|png|webp`. Giao diện đọc URL trong database; không còn tìm ảnh dự phòng theo mã CHINH-01, CHINH-02 trong code. Không có URL hoặc ảnh lỗi thì hiện **Ảnh đang cập nhật**.

`packages/database/resources/menu-images` chỉ là bộ tài nguyên cài đặt để đưa ảnh ban đầu vào kho chung. Website không phục vụ ảnh từ thư mục này. `manifest.json` liên kết mã sản phẩm với tệp cài đặt; `importMenuMedia()` dùng cùng hàm lưu với thao tác admin. Như vậy có thể triển khai trên máy mới mà không mất bộ ảnh ban đầu; khi chạy, mọi sản phẩm dùng cùng một kho. Tài nguyên logo, ảnh nền và hình giữ chỗ vẫn ở `apps/web/public/images` vì chúng là giao diện, không phải ảnh gắn với sản phẩm.

Tên UUID được xác định từ nội dung ảnh: cùng một ảnh không tạo thêm bản trùng; ảnh mới có URL mới để tránh trình duyệt giữ ảnh cũ. **Không nên ghi đè nội dung dưới tên UUID cũ hoặc chỉ bỏ một tệp mới vào thư mục.** Hãy thay ảnh từ ADMIN để database nhận URL mới. Đổi mã/tên món không tự đổi ảnh; thêm món mới phải chọn ảnh cho chính món đó. Nếu đưa ảnh thủ công vào kho nhưng chưa ghi URL vào database, ảnh chưa được gắn với món.

Có thể cấu hình `MENU_UPLOAD_DIR` bằng đường dẫn tuyệt đối hoặc đường dẫn tương đối tính từ gốc repository. API đọc ảnh từ kho này, không phụ thuộc chạy lệnh từ `apps/api` hay gốc dự án. Khi triển khai, gắn kho vào volume bền vững và sao lưu cùng database; không lưu ảnh chỉ trong container tạm thời.

### Các sản phẩm đã có ảnh

| Mã         | Tên trong danh mục chuẩn | URL lưu trong database                                       |
| ---------- | ------------------------ | ------------------------------------------------------------ |
| KHAI-01    | Gỏi cuốn tôm thịt        | `/api/menu-images/1935ea03-bf49-8c12-b9c3-9fb7949dde51.webp` |
| KHAI-02    | Chả giò giòn             | `/api/menu-images/c21cbc05-2d3c-898d-9be7-ebc88916572a.webp` |
| KHAI-03    | Gỏi gà rau thơm          | `/api/menu-images/e8a0f7be-856d-8f8c-8a12-b77cdc8dae25.webp` |
| KHAI-04    | Đậu hũ chiên sả          | `/api/menu-images/12d3ce55-1dfc-8c8d-b09c-3458f06da0c0.webp` |
| CHINH-01   | Cơm tấm sườn nướng       | `/api/menu-images/83825c2d-ae64-8076-9291-c5d9256446d8.webp` |
| CHINH-02   | Phở bò tái nạm           | `/api/menu-images/f05af8c1-a962-8a87-ba8b-ad6e7f91a1cd.webp` |
| CHINH-03   | Bún chả Hà Nội           | `/api/menu-images/191b035c-a31a-86dc-83c1-db03a88f3d28.webp` |
| CHINH-04   | Cơm gà lá chanh          | `/api/menu-images/e3449587-0ce0-85d5-af21-738ccb238549.webp` |
| NUONG-01   | Bò nướng sốt tiêu        | `/api/menu-images/2273031e-3524-8ce5-9b2c-18efc6f42fb6.webp` |
| NUONG-02   | Gà nướng lá chanh        | `/api/menu-images/11860099-3b04-803d-819b-a35fbde3d5b6.webp` |
| NUONG-03   | Tôm nướng sả             | `/api/menu-images/b8e4145f-8074-8d37-a162-1438cc51ecf2.webp` |
| NUONG-04   | Heo nướng mật ong        | `/api/menu-images/d4f8f742-1092-8666-b7fd-2ac5bf94b9a1.webp` |
| LAU-01     | Lẩu cá rau vườn          | `/api/menu-images/ea6d6297-727c-886d-9b2f-b066d8aad3dd.webp` |
| LAU-02     | Lẩu gà lá é              | `/api/menu-images/87261f5f-ee36-8bfb-ab82-aee5ac6161e2.webp` |
| LAU-03     | Canh nấm đậu hũ          | `/api/menu-images/5b1f882d-e69b-862e-9c44-fc42c058125d.webp` |
| LAU-04     | Canh gà rau củ           | `/api/menu-images/b81d26d4-4e25-8328-b4df-bb0058d5291a.webp` |
| DRINK-01   | Trà tắc mật ong          | `/api/menu-images/062f14c8-4f73-842a-a8cb-52ca2a9e9eda.webp` |
| DRINK-02   | Cà phê sữa đá            | `/api/menu-images/2c48c9b8-cb5b-8bef-8cfc-0c8f032def5c.webp` |
| DRINK-03   | Nước sâm nhà nấu         | `/api/menu-images/50fcc57a-2418-8693-bf15-09ca7697172e.webp` |
| DRINK-04   | Trà trái cây             | `/api/menu-images/b22c989b-59bd-83a2-9a2c-a2dd6c3e2aa5.webp` |
| DESSERT-01 | Chè khúc bạch            | `/api/menu-images/6882ce76-8c73-8ad6-8f64-881fce85b928.webp` |
| DESSERT-02 | Sữa chua trái cây        | `/api/menu-images/c46fb787-ffda-8e47-9eaa-31be0dafa887.webp` |
| DESSERT-03 | Đĩa trái cây theo mùa    | `/api/menu-images/76f423a4-40f6-83bd-bb18-d226c76960e6.webp` |
| DESSERT-04 | Pudding sữa              | `/api/menu-images/ee01a157-80e0-8eaa-9b81-40ec19563adc.webp` |
| KHAI-06    | Khoai tây chiên          | `/api/menu-images/323ae143-e384-8825-bf61-a7f26548c7f4.webp` |
| KHAI-07    | Súp bắp gà               | `/api/menu-images/e5191817-08ec-83a0-beb8-c8408749a2b6.webp` |
| KHAI-08    | Nấm xào tỏi              | `/api/menu-images/38bfcfe2-ced5-8c05-a4d9-9fdf60366d2f.webp` |
| CHINH-05   | Cơm chiên hải sản        | `/api/menu-images/160cff99-f280-8bcb-9926-89ce14a0ad1e.webp` |
| CHINH-06   | Cơm bò xào hành          | `/api/menu-images/964ca616-59f5-8b76-ac7b-7b4a9721ee61.webp` |
| CHINH-08   | Cơm nấm đậu hũ           | `/api/menu-images/8be183d9-99d0-8357-8ccd-e994b063e81c.webp` |
| NUONG-05   | Mực nướng sả             | `/api/menu-images/36b6b8a0-9ba0-8503-94a7-27004884430d.webp` |
| NUONG-06   | Cá áp chảo sốt cà        | `/api/menu-images/c7278a4a-cb13-88c6-a479-2526a7b1cbe4.webp` |
| NUONG-07   | Gà xào sả ớt nhẹ         | `/api/menu-images/c1c6527e-0694-8503-b11e-5dd333400de8.webp` |
| NUONG-08   | Tôm xào rau củ           | `/api/menu-images/7bdb8ff2-e123-8c62-a413-73c852decf54.webp` |
| LAU-05     | Canh chua cá             | `/api/menu-images/2cfbb1e9-7d35-86d5-895a-7c991c804cb0.webp` |
| LAU-06     | Lẩu hải sản              | `/api/menu-images/7d94f900-0f64-876c-ad2d-af15235c984e.webp` |
| LAU-07     | Lẩu nấm rau củ           | `/api/menu-images/e8eae7f8-b82d-8af0-b273-8bf4904eaf1a.webp` |
| LAU-08     | Canh rau củ đậu hũ       | `/api/menu-images/4731bdbf-36a4-8d52-828c-c9f93f4f861a.webp` |
| DRINK-05   | Nước cam tươi            | `/api/menu-images/11ca0fbd-fc49-871b-ada5-7243b9693b27.webp` |
| DRINK-06   | Nước chanh tươi          | `/api/menu-images/9e07992e-1f27-86db-80c6-61cb386511bc.webp` |
| DRINK-07   | Nước suối 500 ml         | `/api/menu-images/42026e48-e00e-80d2-9062-0de0b7fc42b1.webp` |
| DRINK-08   | Dừa tươi                 | `/api/menu-images/ffe3c0ad-fcb7-849c-a679-f6aafde91fe8.webp` |
| DESSERT-05 | Chè chuối cốt dừa        | `/api/menu-images/86948e98-b69d-81d5-b330-41c987c8df15.webp` |
| DESSERT-06 | Xoài sữa chua            | `/api/menu-images/1940c075-9b78-8c50-aed9-58aff8330ebf.webp` |
| DESSERT-07 | Kem dừa hạnh nhân        | `/api/menu-images/5a62fba0-4698-8a36-963e-c18568d4bab1.webp` |
| DESSERT-08 | Chè bắp cốt dừa          | `/api/menu-images/5e690f9d-0639-89a7-a990-846a4bdd07ca.webp` |
| CHINH-09   | Bánh xèo tôm thịt        | `/api/menu-images/21d1d18c-7131-8054-a978-763007f973d6.webp` |
| CHINH-10   | Bún cá                   | `/api/menu-images/1df68e44-8a5f-81c9-bd18-19f9715213b5.webp` |
| CHINH-11   | Cơm nắm bò sốt tiêu đen  | `/api/menu-images/511b8088-0403-8f79-83d4-f1d2cce061b4.webp` |
| CHINH-12   | Bò sốt tiêu đen          | `/api/menu-images/da4365de-9b24-8f9f-ac1f-469c176bd5a6.webp` |
| NUONG-09   | Ba rọi mắm ruốc          | `/api/menu-images/fcbce45b-6ec6-896c-b45d-2907f28a837e.webp` |
| CHINH-17   | Bún thịt nướng           | `/api/menu-images/5c63ea2f-6d20-8157-9fdd-366d32a1f0dc.jpg`  |
| CHINH-18   | Mì Quảng tôm thịt        | `/api/menu-images/ba74d017-10ce-80b2-bf7f-23ffc334dffb.jpg`  |
| NUONG-11   | Thịt kho trứng nước dừa  | `/api/menu-images/89834677-fcc4-8a5c-adea-125ce567ca1c.jpg`  |
| COMBO-01   | Combo cơm trưa           | `/api/menu-images/83825c2d-ae64-8076-9291-c5d9256446d8.webp` |
| COMBO-02   | Combo cuốn & trà         | `/api/menu-images/1935ea03-bf49-8c12-b9c3-9fb7949dde51.webp` |
| COMBO-04   | Combo cuối tuần          | `/api/menu-images/9b52bf6a-75de-8052-be32-fad55bfc6dc8.webp` |
| COMBO-05   | Set cơm 69k              | `/api/menu-images/4a2fb07a-1986-8756-90f7-00f5df6f2bea.webp` |

Ảnh COMBO-01/02 chỉ đại diện món chính, không phải ảnh chụp trọn combo; màn hình vẫn ghi đầy đủ thành phần. Poster của CHINH-11, COMBO-04/05 giữ toàn bộ chữ bằng khung poster. Ảnh tham khảo không chứng minh khẩu phần hoặc cách trình bày thực tế tại nhà hàng.

### Năm ảnh đã bổ sung theo thứ tự gửi — 15/10/2026

Năm mã từng còn thiếu ngày 14/10 đã được gắn ảnh mới. Thứ tự ảnh do chủ dự án chỉ định:

| Thứ tự | Mã | Món | URL trong database |
| --- | --- | --- | --- |
| 1 | CHINH-07 | Bún gà sả | `/api/menu-images/eeb97815-8ef4-8f2f-af46-67d702aa4ca8.png` |
| 2 | KHAI-09 | Rau cải xào tỏi (phần cơm) | `/api/menu-images/8aa7d80c-3c19-8d0b-b163-2ebaf6f2d88f.png` |
| 3 | LAU-09 | Lẩu Thái bò & tôm | `/api/menu-images/9ce62de5-1acf-8499-bc64-9b782af6a744.png` |
| 4 | LAU-10 | Canh rau củ (phần cơm) | `/api/menu-images/0e542e62-9d87-8a0a-aef5-e91e13eff0f9.png` |
| 5 | DESSERT-13 | Rau câu dừa sữa | `/api/menu-images/16b6af46-d588-8e93-960e-e49f0568b709.png` |

Không còn món chờ bổ sung ảnh. [Metadata năm ảnh](../packages/database/resources/menu-images/owner-additions-20261015.json) và [tình trạng kho ảnh](../packages/database/resources/menu-images/MISSING.md) cùng phản ánh trạng thái này. Có thể thay ảnh bất kỳ qua ADMIN; URL mới được lưu vào database và dùng trong các màn hình liên quan. Những ảnh có watermark từ các đợt trước giữ nguyên; nguồn CC BY/CC BY-SA vẫn giữ metadata và tác giả cạnh ảnh khi nguồn yêu cầu.

### Công thức 24 món Việt bổ sung

Nguyên liệu chính được đối chiếu từ các nguồn dưới đây. Định lượng theo một phần bán, giá bán, giá vốn và tồn đầu kỳ là cấu hình kế hoạch của nhà hàng, không phải giá thị trường do nguồn xác nhận. Kho dùng đúng đơn vị KG/L/PCS; không lấy thịt bò tươi thay khô bò, cá phi lê thay cá lóc còn xương hoặc bún thay mì Quảng.

| Mã         | Món                     | Nguồn công thức                                                                                                     |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| KHAI-11    | Gỏi ngó sen tôm thịt    | [Tham khảo](https://monngonmoingay.com/goi-ngo-sen-tom-thit/)                                                       |
| KHAI-12    | Gỏi đu đủ khô bò        | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-nom-du-du-bo-kho-gion-ngon-kho-cuong-don-gian-tai-13187)   |
| KHAI-13    | Nghêu hấp sả            | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-ngheu-hap-sa-thom-ngon-ngot-nuoc-cuc-hap-dan-00617)        |
| KHAI-14    | Bắp xào tép bơ          | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-bap-xao-tep-bo-don-gian-thom-ngon-tai-nha-00670)           |
| CHINH-15   | Miến măng vịt           | [Tham khảo](https://www.dienmayxanh.com/vao-bep/huong-dan-cach-lam-mieng-mang-vit-thom-ngon-don-gian-tai-nha-01370) |
| CHINH-16   | Cơm thịt kho trứng      | [Tham khảo](https://monngonmoingay.com/mang-huong-vi-tet-vao-nha-voi-tuyet-chieu-lam-mon-thit-kho-trung/)           |
| CHINH-17   | Bún thịt nướng          | [Tham khảo](https://monngonmoingay.com/bun-thit-nuong/)                                                             |
| CHINH-18   | Mì Quảng tôm thịt       | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-mi-quang-tom-thit-thom-ngon-ai-cung-me-chuan-vi-don-06737) |
| NUONG-11   | Thịt kho trứng nước dừa | [Tham khảo](https://monngonmoingay.com/mang-huong-vi-tet-vao-nha-voi-tuyet-chieu-lam-mon-thit-kho-trung/)           |
| NUONG-12   | Cá lóc kho tộ           | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-mon-ca-loc-kho-to-de-nhat-ngon-nhat-00816)                 |
| NUONG-13   | Sườn xào chua ngọt      | [Tham khảo](https://monngonmoingay.com/suon-xao-chua-ngot/)                                                         |
| NUONG-14   | Vịt kho gừng            | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-mon-vit-kho-gung-dua-com-thom-ngon-don-gian-01350)         |
| NUONG-15   | Tôm rim thịt ba rọi     | [Tham khảo](https://monngonmoingay.com/tom-rim-thit-ba-chi/)                                                        |
| NUONG-16   | Mực xào chua ngọt       | [Tham khảo](https://www.dienmayxanh.com/vao-bep/2-cach-lam-mon-muc-xao-chua-ngot-don-gian-ngon-dung-chuan-01530)    |
| LAU-11     | Canh khổ qua nhồi thịt  | [Tham khảo](https://monngonmoingay.com/canh-kho-qua-ham-thit/)                                                      |
| LAU-12     | Canh rau ngót thịt băm  | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-canh-rau-ngot-thit-bam-thanh-mat-don-gian-cho-bua-10653)   |
| LAU-13     | Canh bí đỏ tôm tươi     | [Tham khảo](https://www.dienmayxanh.com/vao-bep/2-cach-nau-canh-bi-do-voi-tom-va-thit-bam-thom-ngon-02271)          |
| LAU-14     | Canh nghêu thì là       | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-canh-ngheu-thi-la-thom-ngon-thanh-mat-dua-com-trong-12323) |
| LAU-15     | Canh cải xanh thịt băm  | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-canh-cai-xanh-thit-bam-thanh-mat-cho-ngay-nong-buc-13338)  |
| LAU-16     | Canh bí đao thịt băm    | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-canh-bi-dao-thit-bam-thom-ngon-thanh-dam-ngay-tai-11767)   |
| DESSERT-10 | Chè đậu xanh hạt sen    | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-che-dau-xanh-hat-sen-thom-mat-bui-ngot-cho-ca-gia-08341)   |
| DESSERT-11 | Chè đậu đỏ nếp cốt dừa  | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-che-dau-do-voi-nep-thom-deo-ngot-bui-am-bung-ngay-08822)   |
| DESSERT-12 | Chè khoai môn đậu xanh  | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-nau-che-khoai-mon-dau-xanh-bui-ngot-thom-ngon-don-gian-08715)  |
| DESSERT-13 | Rau câu dừa sữa         | [Tham khảo](https://www.dienmayxanh.com/vao-bep/cach-lam-rau-cau-dua-ngon-bo-re-tai-nha-00563)                      |

Nhóm `MON-NUONG` được đặt tên **Món mặn & rau** để bao gồm món kho, nướng, xào và rau dùng chung. Các món được mở bán trong bộ dữ liệu mới và có đủ công thức/nguyên liệu; về sau khách chỉ gọi được khi trạng thái bán và kho đều cho phép.

## Thay ảnh bằng giao diện: cách dễ nhất

1. Đăng nhập ADMIN → **Thực đơn**.
2. Tìm món theo tên hoặc mã. Chọn **Chỉnh sửa**.
3. Trong vùng **Thay ảnh món**, chọn ảnh thật trên máy.
4. Chờ thông báo **Đã thay ảnh món**. Ảnh được lưu ngay; không cần bấm “Lưu món” chỉ để lưu ảnh.
5. Mở thực đơn khách để xem lại. Màn hình khách đang mở sẽ đọc dữ liệu mới theo chu kỳ hiện có; có thể tải lại trang để kiểm tra ngay.

PNG, JPEG và WebP được chấp nhận; ảnh tải lên tối đa 2 MB. Gợi ý ảnh khoảng 1200 × 900 px, đặt món ở giữa ảnh. Ảnh giữ tỷ lệ gốc trong khung hiển thị; phần ngoài khung được cắt để ảnh không bị kéo méo. Ảnh dọc vẫn dùng được, nhưng có thể mất phần trên/dưới khi hiển thị trong khung ngang.

**Nếu đang sửa tên/giá/mô tả hoặc thành phần combo mà chưa lưu:** khi chọn ảnh, hệ thống hỏi có bỏ thay đổi chưa lưu không. Chọn **Tiếp tục chỉnh sửa** nếu muốn giữ nội dung đang nhập; lưu thông tin trước rồi tải ảnh. Chọn **Bỏ thay đổi** rồi thay ảnh sẽ khôi phục thông tin và thành phần đã lưu. Sau khi ảnh lưu thành công, dữ liệu món được đọc lại nên phiên bản mới được dùng cho thao tác tiếp theo.

Ảnh lỗi hoặc món chưa có ảnh phù hợp hiển thị hình giữ chỗ có chữ **Ảnh đang cập nhật**. Hình đó không phải ảnh thực tế của món. Không gán ảnh một món khác để lấp đầy danh sách.

## Ảnh đầu trang theo từng vai trò

Sáu đường dẫn dưới đây trỏ tới tệp WebP trong mã nguồn. `apps/web/lib/media.ts` là nơi khai báo URL. Ảnh được phát từ chính website, không cần tải từ website nguồn mỗi lần mở trang.

| Khu vực            | URL ảnh                             | Nội dung ảnh                                                  |
| ------------------ | ----------------------------------- | ------------------------------------------------------------- |
| Chào khách sau QR  | `/images/brand/guest-welcome.webp`  | Ảnh bữa ăn do chủ dự án cung cấp                              |
| Khách xem thực đơn | `/images/banners/guest.webp`        | Mâm món Việt và nguyên liệu                                   |
| Phục vụ            | `/images/banners/staff.webp`        | Mâm món Việt, gắn với công việc tại bàn                       |
| Quản trị           | `/images/banners/admin.webp`        | Không gian quán ăn tại Hà Nội                                 |
| Đăng nhập          | `/images/brand/internal-login.webp` | Không gian cafe/bistro Hà Nội, ảnh Elist Nguyen trên Unsplash |
| Bếp                | `/images/banners/kitchen.webp`      | Nguyên liệu rau củ chuẩn bị cho bếp                           |

Logo `brand/logo.webp` và ảnh chào QR `brand/guest-welcome.webp` lấy từ thư mục do chủ dự án cung cấp. Ảnh nền đăng nhập `brand/internal-login.webp` là bản sao tối ưu của `banners/login.webp`, nguồn [Elist Nguyen trên Unsplash](https://unsplash.com/photos/a-restaurant-with-tables-and-chairs-covered-in-plants-5ByTKbyaeEo); giữ [Unsplash License](https://unsplash.com/license) và thông tin chuyển đổi trong `SOURCES.md`. Đây là ảnh không gian tham khảo, không phải ảnh chụp tại Quyết Trường Bistro. `brand/restaurant-cover.webp` còn trong thư viện nhưng đường dẫn `/` hiện mở thẻ đăng nhập, không dùng trang giới thiệu món ăn trước đây.

Các ảnh vai trò lấy từ Unsplash cũng giữ tác giả và giấy phép trong `SOURCES.md`. Một ảnh có thể được dùng ở hai vai trò khi nội dung phù hợp. Khi thay ảnh, giữ bố cục chính và kiểm tra lại trên điện thoại để ảnh không làm nút công việc bị đẩy xuống quá xa.

## Banner thực đơn gắn với sản phẩm

Các ảnh giới thiệu được lưu trong bảng `menu_promotion` và quản lý tại **ADMIN → Thực đơn → Ảnh giới thiệu**. Bốn poster khởi tạo lần lượt gắn **CHINH-11 Cơm nắm bò sốt tiêu đen**, **NUONG-09 Ba rọi mắm ruốc**, **COMBO-05 Set cơm 69k** và **COMBO-04 Combo cuối tuần**. Banner chỉ xuất hiện khi sản phẩm vẫn hoạt động và có thể phục vụ; tình trạng này do API xác định theo món, danh mục và nguyên liệu.

Ảnh banner cũng lưu trong `var/menu-images` và đọc qua `/api/menu-images/<UUID>.<đuôi>`. Quản trị chọn món/combo, tải ảnh, đặt thứ tự, tiêu đề ngắn và bật/tắt hiển thị; có thể thêm hoặc xóa banner từ giao diện. Xóa banner không xóa món và chạy lại seed thông thường không tự khôi phục banner đã xóa. Poster giữ tỷ lệ bằng `object-fit: contain`, phần chữ trên ảnh được giữ trong khung. Ảnh món Bò sốt tiêu đen CHINH-12 là ảnh đĩa bò riêng, không thay cho poster cơm nắm CHINH-11.

Banner lấy tên, giá và thành phần từ sản phẩm hiện hành. Với poster có chữ giá/thành phần, quản trị xác nhận nội dung ảnh khớp dữ liệu trước khi lưu. `expected_price` và `expected_components` lưu điều kiện khớp; khi món đổi, ảnh cũ bị ẩn cho tới khi quản trị cập nhật và xác nhận lại. Không giới hạn banner vào bốn mã khởi tạo trong code. Poster cơm nắm có chữ **18.000 đ**, poster set cơm có chữ **69.000 đ**, nên chúng bị ẩn nếu giá trong danh mục khác giá đó. Poster combo cũng bị ẩn nếu mã hoặc số lượng thành phần không còn đúng cấu hình. Như vậy quản trị có thể đổi giá/thành phần mà không làm banner tiếp tục quảng cáo nội dung cũ. Bộ lọc **Combo** nằm cạnh **Tất cả**, chỉ chọn sản phẩm có loại `COMBO`, không dựa vào tên danh mục.

Poster bữa sáng của **Cà Phê Trứng3T** chưa được dùng vì mang thương hiệu khác và điều kiện bán chưa được xác nhận. Muốn dùng sau này, cần cung cấp banner thay thương hiệu cùng món, giá và điều kiện bán của nhà hàng. Set cơm 69.000 đ được triển khai cố định với **cả gà, thịt và trứng**, cùng rau, canh và trái cây; khách không chọn một trong ba món hoặc tự đổi thành phần.

Banner nằm trong **cột thực đơn**, phía trên nhóm món; giỏ được ghim ở cột bên phải trên máy tính. Khung ảnh nguyên vẹn cao **240 hoặc 260 px** theo chiều rộng màn hình, đặt cạnh phần tên, mô tả và nút chọn món. Trên điện thoại, ảnh giữ đúng tỷ lệ poster, chữ nằm dưới; chiều cao khung theo ảnh đang hiển thị để tránh cắt ảnh hoặc để dư khoảng trống của poster khác.

Ảnh tự trượt thuận mỗi **3 giây**. Cuối vòng dùng một bản sao ảnh đầu để chuyển liền mạch về đầu, rồi đặt lại vị trí trong dải ảnh. Các chấm tròn chọn ảnh nằm giữa bên dưới; chấm đang chọn lớn hơn. Thiết bị bật **giảm chuyển động** sẽ tắt tự trượt, khách vẫn chọn ảnh bằng chấm. Tên, giá hiện hành, thành phần và nút thao tác nằm trong HTML. Phần chữ đã có sẵn trong poster được giữ nguyên và kiểm tra khớp giá/thành phần như trên.

Ngày 12/10, **27/27 lượt kiểm thử trình duyệt** của đợt banner đạt trên Chrome máy tính, Chrome điện thoại và WebKit: 15 lượt của `guest-banner-layout.spec.ts` và 12 lượt của `guest-refresh.spec.ts`. Đã kiểm tra desktop 900/1024/1366/1440 px với giỏ trống và có món, poster vuông và combo có nội dung dài; mobile 320/390 px với cả bốn poster; danh mục trống và bố cục giỏ ghim. [Biên bản kết quả banner](evidence/guest-banner-layout-20261012.log).

`pnpm check` đạt định dạng, ESLint, TypeScript và **123 kiểm thử unit**. Production build dùng `NEXT_DIST_DIR=.next-build-banner` đạt. Phạm vi trình duyệt của đợt này là banner, giỏ và thực đơn khách; các biên bản kiểm thử trước đây bên dưới giữ nguyên phạm vi và thời điểm của chúng.

## Dòng cập nhật món cho khách

Dải **Từ bếp** nằm ở đầu khu vực khách sau khi đã tham gia bàn. Nó dùng trạng thái món đang được đọc từ API, không tự thay đổi trạng thái hoặc thay thế việc phục vụ đến trao đổi với khách.

- Màn hình đọc lại dữ liệu theo chu kỳ **3 giây**. Lần đọc đầu chỉ ghi nhận trạng thái hiện có; các lần sau mới tạo thông báo khi có thay đổi.
- Nội dung phân biệt **Món của bạn** và **Món của bàn**; cho biết bếp đã nhận, đang chế biến, đã xong, đã mang ra hoặc món bị dừng. Món bị dừng có lời nhắc nhân viên sẽ trao đổi tại bàn.
- Giữ tối đa sáu cập nhật mới trong **hai phút**. Khi không có cập nhật mới, dải hiển thị tình hình món của bàn; chọn **Món đã gọi** để xem từng món.
- Chữ chỉ chạy ngang khi dài hơn vùng hiển thị. Có nút **Dừng/Chạy** và chuyển thông báo; đặt chuột hoặc đưa focus vào dải cũng tạm dừng. Nếu thiết bị bật giảm chuyển động, chữ không chạy và được xuống dòng để đọc.

Việc nhận món, chế biến, phục vụ, báo khách và duyệt hoàn tiền vẫn theo quyền và quy tắc nghiệp vụ hiện có. Dải cập nhật không tự xác nhận khách đã được nhân viên thông báo và không hứa hoàn tiền khi chưa có quyết định.

## Ảnh được lưu ở đâu?

Đường dẫn dưới đây tính từ gốc repository `/home/quyettruong05/projects/qr-ordering-thesis`.

Ngoài các vị trí trong bảng, `apps/web/public/images/combos/` chứa ảnh combo hoặc món chính đại diện; `banners/promotions/` chứa poster quảng bá có chữ. `packages/database/src/menu-media.ts` là ánh xạ mã sản phẩm → URL dùng khi khởi tạo và cập nhật danh mục.

| Vị trí                                                                 | Nội dung                                                  | Bạn dùng khi nào?                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `apps/web/public/images/menu/`                                         | Ảnh món thật đưa cùng mã nguồn                            | Khi muốn tự thêm ảnh bằng code                         |
| `apps/web/public/images/brand/`                                        | Ảnh/đồ họa nhận diện nhà hàng                             | Khi muốn thay hình trang chào                          |
| `apps/web/public/images/banners/`                                      | Ảnh đầu trang cho khách, đăng nhập và ba vai trò nội bộ   | Khi muốn thay ảnh theo khu vực sử dụng                 |
| `apps/web/public/images/placeholders/`                                 | Hình giữ chỗ khi chưa có ảnh                              | Khi muốn đổi cách hiển thị món thiếu ảnh               |
| `apps/web/lib/media.ts`                                                | Danh sách ảnh theo mã món và đường dẫn ảnh dùng chung     | Điểm đầu tiên để tìm ảnh trong code                    |
| `apps/web/public/images/SOURCES.md` và `photo-metadata.json`           | Nguồn ảnh, tác giả, giấy phép, tệp gốc và bước chuyển đổi | Khi bổ sung hoặc thay nguồn ảnh                        |
| `var/menu-images/` ở gốc dự án, hoặc thư mục đặt qua `MENU_UPLOAD_DIR` | File ảnh đã tải từ ADMIN                                  | Khi vận hành API, chuyển máy hoặc cấu hình nơi lưu ảnh |
| Cột `product.image_url` trong PostgreSQL                               | Đường dẫn đến ảnh đã tải                                  | Database không chứa nội dung của file ảnh              |

Ảnh tải lên có tên UUID do máy chủ tạo, ví dụ `/api/menu-images/<tên-tệp>.jpg`. Tên tự sinh giúp tránh ghi đè ảnh của món khác và tránh trình duyệt dùng nhầm ảnh cũ. Bạn chọn món theo tên ở ADMIN nên không phải tự tìm UUID để thay ảnh.

Thư mục `public` được web phát công khai. Thư mục ảnh tải lên do API quản lý; khi đưa hệ thống lên máy chủ thật, cần cấu hình lưu bền vững cho thư mục đó (volume hoặc dịch vụ lưu file phù hợp). Không để ảnh tải lên chỉ nằm trong lớp filesystem tạm của container. Đây là lưu trữ trên filesystem của phiên bản hiện tại; dự án chưa tích hợp S3/Cloudinary.

## Thay ảnh bằng code

Ví dụ dùng món **Cơm tấm sườn nướng**, mã hiện tại **CHINH-01**:

1. Đặt ảnh thật tên `chinh-01.webp` vào `apps/web/public/images/menu/`.
2. Mở `packages/database/src/menu-media.ts`.
3. Thêm dòng vào `menuMedia`:

```ts
export const menuMedia: Record<string, string> = {
  'CHINH-01': '/images/menu/chinh-01.webp',
};
```

Quy ước chung là **mã món viết thường + `.webp`**: `CHINH-01` dùng `chinh-01.webp`, `KHAI-01` dùng `khai-01.webp`. Không ghi chữ `public` trong URL. Đường dẫn file `public/images/menu/chinh-01.webp` tương ứng URL `/images/menu/chinh-01.webp`. Mã món cố định giúp việc đổi tên hiển thị không làm mất ảnh.

Nếu chỉ thay ảnh cho món đã đăng ký, thay nội dung tệp và giữ tên tệp; không đổi mã món hoặc sửa từng màn hình. Nếu bổ sung ảnh cho món khác, thêm ánh xạ vào `menuMedia`, cập nhật nguồn/giấy phép rồi xem trước và áp dụng lệnh cập nhật danh mục bên dưới. `menuPhotos` trong `apps/web/lib/media.ts` là phần dự phòng của giao diện. Khi triển khai bản mới, tải lại trang; nếu vẫn thấy ảnh cũ, kiểm tra cache của trình duyệt hoặc máy chủ phát file.

**Thứ tự ưu tiên:** `product.image_url` hợp lệ, gồm ảnh ADMIN đã tải → ảnh dự phòng theo mã → hình giữ chỗ. Lệnh cập nhật chỉ bổ sung ảnh khi đường dẫn còn trống hoặc là một trong sáu ảnh SVG cũ; không ghi đè ảnh đã chọn và không áp ảnh cho sản phẩm đã đổi tên. Muốn thay món đã có ảnh, dùng chức năng Thay ảnh trong ADMIN. Cột `product.image_url` chứa đường dẫn của cả ảnh thư viện và ảnh tải lên, không chứa nội dung tệp.

Các thành phần hiển thị đều dùng `features/shared/dish-image.tsx`: menu khách, hộp chọn món và thực đơn quản trị. Vì dùng cùng thành phần, khung ảnh và xử lý ảnh lỗi nhất quán. Không cần sửa riêng ba màn hình.

## Dữ liệu thực đơn và kho trong đợt cập nhật

Danh mục khởi tạo hiện có **62 món lẻ, 5 combo, 7 nhóm và 68 nguyên liệu**. Sau hai món Bánh xèo tôm thịt CHINH-09 và Bún cá CHINH-10, đợt poster bổ sung 12 món lẻ và 2 combo dưới đây. Giá, đơn giá nguyên liệu và định lượng khởi tạo là kế hoạch ban đầu; cần kiểm đếm kho, kiểm tra khẩu phần thực tế và xác nhận giá trước khi vận hành thật. Script bổ sung giữ nguyên các sản phẩm/nguyên liệu đã có, vì vậy dữ liệu đang dùng không nhất thiết có đúng số lượng hoặc giá như danh mục khởi tạo.

| Combo                     | Thành phần trong 1 combo                                                                                        | Giá khởi tạo                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| COMBO-01 — Cơm trưa       | 1 cơm tấm + 1 nước sâm                                                                                          | 99.000 đ                                 |
| COMBO-02 — Cuốn & trà     | 2 phần gỏi cuốn + 2 trà tắc mật ong                                                                             | 149.000 đ                                |
| COMBO-03 — Lẩu gà sum vầy | 1 lẩu gà lá é + 1 chả giò + 3 nước sâm                                                                          | 419.000 đ                                |
| COMBO-04 — Cuối tuần      | 1 lẩu Thái bò & tôm + 1 mâm cuốn thịt luộc & chả giò + 2 trà dâu                                                | 499.000 đ; mua lẻ lúc khởi tạo 526.000 đ |
| COMBO-05 — Set cơm 69k    | 1 cơm gà kho gừng + 1 ba rọi mắm ruốc phần cơm + 1 trứng chiên + 1 rau cải xào tỏi + 1 canh rau củ + 1 trái cây | 69.000 đ; mua lẻ lúc khởi tạo 100.000 đ  |

Combo được gọi, chế biến, hủy và hoàn trên cả dòng; chưa hỗ trợ đổi hoặc hoàn riêng một thành phần. Xem [nghiệp vụ combo và giữ kho](04-goi-mon.md). Giá mua lẻ so sánh được tính từ giá hiện hành của các món thành phần, không phải giá gạch ngang tự đặt.

### Khẩu phần và công thức của các món bổ sung

| Mã         | Phần bán                       | Giá khởi tạo | Nguyên liệu chính trong công thức kế hoạch                                 |
| ---------- | ------------------------------ | ------------ | -------------------------------------------------------------------------- |
| CHINH-11   | 1 viên cơm nắm bò sốt tiêu đen | 18.000 đ     | Gạo dẻo 35 g khô, bò 25 g, rong biển 1,5 g và sốt                          |
| CHINH-12   | 1 đĩa bò sốt tiêu đen          | 149.000 đ    | Bò 220 g, hành tây 80 g, rau 100 g và sốt                                  |
| NUONG-09   | 1 đĩa ba rọi mắm ruốc          | 89.000 đ     | Ba rọi 180 g trước nấu, mắm ruốc 22 g, sả và gia vị                        |
| LAU-09     | 1 nồi lẩu Thái cho 2–3 người   | 299.000 đ    | Bò 250 g, tôm 250 g, bún 350 g, nước dùng 1,2 lít, rau và gia vị           |
| CHINH-13   | 1 mâm cuốn cho 2 người         | 149.000 đ    | Ba rọi luộc từ 250 g thịt, 4 chả giò nhân thịt/nấm, bún, bánh tráng và rau |
| DRINK-09   | 1 ly trà dâu                   | 39.000 đ     | Dâu tây 50 g, trà ô long 3 g, đường và chanh                               |
| CHINH-14   | 1 cơm gà kho gừng              | 45.000 đ     | Gà 150 g, gạo tấm 90 g khô, gừng và gia vị                                 |
| KHAI-09    | 1 đĩa rau nhỏ ăn kèm cơm       | 10.000 đ     | Cải thìa 120 g, tỏi, dầu và nước tương                                     |
| LAU-10     | 1 chén canh ăn kèm cơm         | 10.000 đ     | Nước dùng rau củ 250 ml, rau 100 g, nấm 25 g                               |
| DESSERT-09 | 1 phần trái cây nhỏ            | 5.000 đ      | Trái cây theo mùa 80 g                                                     |
| NUONG-10   | 1 đĩa thịt nhỏ ăn kèm cơm      | 20.000 đ     | Ba rọi 60 g trước nấu, mắm ruốc 7,5 g, sả và gia vị                        |
| KHAI-10    | 1 phần trứng ăn kèm cơm        | 10.000 đ     | 1 trứng gà, dầu ăn, nước mắm và tiêu                                       |

Định lượng trên là đầu vào kế hoạch cho một đơn vị bán, không phải cam kết trọng lượng thành phẩm sau nấu. Toàn bộ gia vị và đơn vị nền nằm trong `demo-data.ts`; nước lọc dùng chế biến không bị tạo thành một mặt hàng kho mới. Công thức mâm cuốn ghi cả nguyên liệu làm chả giò, không dùng combo lồng combo. Ảnh đĩa bò có ba miếng bánh phụ chưa xác định loại; danh mục CHINH-12 hiện chỉ tính đĩa bò và chưa có công thức cho những miếng bánh đó.

Nguồn công thức được dùng để đối chiếu loại nguyên liệu, cách phối vị và cách chế biến; các giá và định lượng của dự án được lập riêng, không sao chép chứng từ bán hàng:

- [Ba chỉ rim mắm ruốc — Món Ngon Mỗi Ngày](https://monngonmoingay.com/ba-chi-rim-mam-ruoc/) đối chiếu ba rọi, mắm ruốc, sả, hành tỏi và ớt.
- [Bít tết tiêu đen — Món Ngon Mỗi Ngày](https://monngonmoingay.com/cach-lam-bo-bit-tet/) đối chiếu sốt tiêu đen, dầu hào và nước tương; món trong dự án là bò xào theo mô tả riêng.
- [Cơm nắm rong biển — Món Ngon Mỗi Ngày](https://monngonmoingay.com/com-nam-rong-bien-mayo/) tham khảo cơm dẻo và rong biển; nhân bò của dự án dùng công thức sốt tiêu đen.
- [Lẩu Thái](https://monngonmoingay.com/lau-thai/) và [xốt lẩu Thái của Ajinomoto](https://monngonmoingay.com/aji-quick-xot-hoan-chinh-lau-thai/) đối chiếu nền chua cay, sả, lá chanh, me và riềng. Phần bán của dự án dùng bò và tôm như tên món.
- [Các món thịt heo — Món Ngon Mỗi Ngày](https://monngonmoingay.com/cac-mon-tu-thit-heo/) đối chiếu thịt luộc, bánh tráng và rau trong mâm cuốn; phần chả giò dùng công thức thịt/nấm hiện có của nhà hàng.
- [Trà dâu — Dạy Pha Chế Á Âu](https://dayphache.edu.vn/cach-lam-tra-dau-tay) đối chiếu trà, dâu, đường và chanh.
- [Gà kho gừng — Món Ngon Mỗi Ngày](https://monngonmoingay.com/cach-lam-uc-ga-khong-ngan/) đối chiếu gà, gừng, hành tỏi và gia vị kho.
- [Kỹ thuật xào cải với tỏi](https://monngonmoingay.com/cai-xoong-xao-tom/) và [canh rau củ trong tập công thức Ajinomoto](https://monngonmoingay.com/wp-content/uploads/2015/08/Booklet-56.pdf) tham khảo cách nấu rau; phần rau và canh của dự án có công thức riêng trong bảng trên.

### Bổ sung cho dữ liệu đang dùng

Chạy từ gốc repository sau khi áp dụng migration hiện hành. Hai lệnh đầu chỉ xem trước; không ghi dữ liệu:

```sh
node --env-file=.env --import tsx scripts/seed-menu-extensions.ts
node --env-file=.env --import tsx scripts/seed-catalog-refresh.ts
```

Sau khi kiểm tra danh sách sẽ bổ sung và nguồn ảnh, áp dụng phần thiếu rồi cập nhật trình bày:

```sh
node --env-file=.env --import tsx scripts/seed-menu-extensions.ts --apply --opening-stock
node --env-file=.env --import tsx scripts/seed-catalog-refresh.ts --apply
```

[seed-menu-extensions.ts](../scripts/seed-menu-extensions.ts) chỉ tạo mã còn thiếu trong danh sách 14 món bổ sung, 5 combo và các nguyên liệu mà công thức của chúng cần. Nhóm món và đơn vị được lấy theo từng định nghĩa; không mặc định mọi món đều là món chính hoặc mọi nguyên liệu đều là kg. Không ghi đè tên, giá, công thức, ảnh tự chọn hoặc số tồn của các sản phẩm/nguyên liệu đã có.

Cờ `--opening-stock` chỉ ghi tồn kế hoạch cho **nguyên liệu vừa được tạo trong lần chạy đó**, kèm movement `ADJUSTMENT_IN`, lý do **Tồn đầu kỳ theo kế hoạch thực đơn bổ sung**, người ghi nhận và khóa yêu cầu theo mã nguyên liệu. Đây không phải kết quả kiểm kê thực tế. Ví dụ bột gạo mới bắt đầu 20 kg; 10 nguyên liệu của đợt poster là gạo dẻo 12 kg, rong biển 0,5 kg, ba rọi 8 kg, mắm ruốc 2 kg, dầu hào 3 lít, hành tím 3 kg, gừng 2 kg, dâu 3 kg, cải thìa 10 kg và riềng 1 kg. Chi phí đầu kỳ là giá kế hoạch trong `demoIngredients`.

Nếu cần nhập tồn thực tế bằng nghiệp vụ kho, bỏ cờ này: nguyên liệu mới bắt đầu bằng 0. Chạy lại có cờ cũng không tự bù cho nguyên liệu đã có và không cộng thêm tồn. Vì vậy sau khi đã tạo nguyên liệu tồn 0, phải nhập hàng/kiểm kê bằng nghiệp vụ kho để ghi nguồn phát sinh thực tế.

Nếu COMBO-05 đã được tạo từ phiên bản trước chỉ gồm cơm gà, rau, canh và trái cây, tạo các món còn thiếu trước rồi xem công cụ riêng:

```sh
node --env-file=.env --import tsx scripts/seed-set-menu-refresh.ts
```

Chỉ thêm `--apply` sau khi kết quả là `MATCHED_OLD_TEMPLATE`. Công cụ chỉ nâng **đúng mẫu Set cơm gà cũ**: tên và mô tả cũ, giá 69.000 đ, bốn thành phần cũ đúng thứ tự/số lượng, ảnh poster chuẩn, món/danh mục đang sử dụng, cho phép nhận món và có quản lý kho. Cả sáu món mới phải là món lẻ đang dùng và có công thức hiệu lực. Bản quản trị đã đổi tên, mô tả, giá, ảnh, trạng thái hoặc số phần sẽ bị bỏ qua; phải kiểm tra và sửa bằng giao diện nếu muốn.

Lần áp dụng thành công đổi tên thành **Set cơm 69k**, thêm phần thịt và trứng, tăng phiên bản sản phẩm, tạo công thức tổng mới và nhật ký `REFRESH_RESTAURANT_SET_MENU`. **Các đơn đã gọi giữ nguyên bốn thành phần và định lượng cũ**, cùng tài khoản phiên và thu/hoàn tiền đã ghi; khách có giỏ cũ phải xác nhận nội dung mới trước khi gửi. Chạy lại báo `ALREADY_ALIGNED` và không tạo thêm phiên bản hoặc nhật ký. Công cụ dừng nếu thiếu món/công thức hoặc món thành phần bị ngừng; xung đột khóa khiến giao dịch rollback để thử lại.

[seed-catalog-refresh.ts](../scripts/seed-catalog-refresh.ts) chỉ cập nhật mô tả, danh mục và ảnh mặc định đã nhận diện; lưu trường trước/sau vào nhật ký. Giữ nguyên giá, trạng thái bán, công thức, kho, người dùng, công lương, phiên bàn và thu/hoàn tiền. Món đã đổi tên và ảnh tự chọn được bảo toàn. Không dùng lệnh reset hoặc chạy toàn bộ seed trên dữ liệu vận hành chỉ để thêm ảnh.

[demo-data.ts](../packages/database/src/demo-data.ts) chứa kế hoạch danh mục; tên tệp kỹ thuật không xuất thành nhãn cho khách. Không tự đặt địa chỉ đường phố, số điện thoại, đánh giá khách hàng hoặc chứng từ khi chưa có thông tin được xác nhận.

Ngày 11/10, **52 kiểm thử API/CSDL** của combo, danh mục, gọi món/kho/thanh toán và quyền đều đạt trên cơ sở dữ liệu tạm. Có đối chiếu hash dữ liệu được bảo vệ khi cập nhật danh mục; kiểm thử kiểm tra tệp ảnh tồn tại, không xác nhận chất lượng mỹ thuật của từng màn hình. Kết quả trình duyệt và production build của giao diện mới cần đọc trong hồ sơ nghiệm thu tương ứng.

Ngày 12/10, **19/19 kiểm thử API/CSDL** đạt trên DB tạm: 16 ca combo và 3 ca danh mục. Ba ca bổ sung kiểm tra tạo món/nguyên liệu đúng nhóm và đơn vị, giữ giá/ảnh/kho/chứng từ và dữ liệu nhân sự/tiền đã có, không thêm tồn khi chạy lại, tổng công thức của hai ly trà trong combo cuối tuần và hủy hai combo trả toàn bộ kho nhưng giữ thành phần trong phiếu. [Biên bản đợt poster](evidence/poster-combo-api-20261012.log).

Sau xác nhận set cơm gồm cả gà, thịt và trứng, **21/21 ca API/CSDL** đạt: 18 combo và 3 danh mục. Hai ca thêm kiểm tra nâng đúng mẫu cũ, giữ đơn/bốn thành phần đã gọi, công thức đơn, giữ kho, tài khoản phiên và dòng tiền; bỏ qua các mẫu đã tùy chỉnh và không tạo thêm phiên bản/nhật ký khi chạy lại. Lint và typecheck của phần dữ liệu/test đạt. [Biên bản set cơm đầy đủ](evidence/poster-set-menu-api-20261012.log). Không dùng toàn bộ seed hoặc reset để đổi danh mục đang vận hành; kết quả áp dụng và nghiệm thu giao diện được ghi riêng.

## Muốn đổi màu hoặc bố cục sau này

`apps/web/app/globals.css` cho biết thứ tự các stylesheet. `experience.css` cung cấp thiết kế chung của bốn vai trò; những tệp theo tính năng được nhập phía sau để điều chỉnh giao diện tương ứng. Các biến màu nội bộ và khách tách riêng. `interface.css` giữ thiết kế nền của các thành phần danh mục/biểu mẫu.

Đợt hiện hành dùng `internal-login.css` cho đăng nhập tại `/` và `/login`, `guest-refresh.css` cho màn hình khách và `marketing-carousel.css` cho ảnh trượt. `combo.css` định dạng thành phần combo trong quản trị, gọi hộ, bếp và phiếu. `landing-refresh.css` là stylesheet của trang giới thiệu trước đây; route `/` hiện không còn dùng trang giới thiệu đó. Thay bố cục ở đúng tệp theo tính năng, rồi kiểm tra màn hình nhỏ để tránh quy tắc mới làm lệch vùng khác.

Các tệp `restaurant.css`, `service.css`, `workforce.css`, `inventory.css` vẫn cung cấp quy tắc nền và bố cục nghiệp vụ. `interface.css` được nhập sau các tệp đó để áp dụng thiết kế hiện hành. Phần ảnh và bố cục tách khỏi nghiệp vụ; phần combo có migration `202610110001_fixed_combos` như bài 04 mô tả.

## Nguồn tham khảo thiết kế

- [Cơm Niêu Thiên Lý](https://comnieuthienly.com/menu): nhóm cơm, rau, canh, nước uống và cách ghi khẩu phần.
- [Ngõ Sài Gòn](https://nhahangngo.com.vn/) và [Nhà Hàng Ngon](https://nhahangngon.com.vn/): bố trí nhóm món Việt cho bữa ăn và món dùng chung.
- [Ngon Garden](https://ngongarden.com/menu-Ngon-garden.pdf): phân biệt cuốn, phần và món dùng chung. Các mô tả trong dự án được viết theo món hiện có, không chép giá hoặc thông tin doanh nghiệp khác.
- [Square: gọi món bằng QR](https://squareup.com/us/en/online-ordering/qr-code-ordering): tham khảo cách khách xem thực đơn và thao tác trên điện thoại.
- [Toast: màn hình bếp](https://pos.toasttab.com/hardware/kitchen-display-system): tham khảo phiếu món và cách tổ chức công việc bếp.
- [Restaurant365: danh sách nguyên liệu](https://docs.restaurant365.com/docs/items-grid): tham khảo tìm kiếm, lọc và mở chi tiết từ danh sách.
- [7shifts: xem lịch làm](https://kb.7shifts.com/hc/en-us/articles/4417514375827-Check-Your-Schedule): tham khảo lịch cá nhân và chi tiết ca.
- [Google: bố cục và điều hướng điện thoại](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns): tham khảo tổ chức điều hướng theo màn hình.
- [MDN: đặt ảnh vào khung](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Solve_CSS_problems/Fill_a_box_with_an_image): cơ chế giữ tỷ lệ bằng `object-fit`.

Đây là nguồn định hướng bố trí. Website của dự án không kết nối các sản phẩm này và không tự có các tính năng thanh toán, tự động hóa hoặc báo cáo mà sản phẩm tham khảo cung cấp.

## Xem ảnh giao diện đã kiểm tra

**Combo nội bộ ngày 11/10:** 21 ca trên desktop, Chrome điện thoại và WebKit điện thoại đạt; kiểm tra tạo/sửa, giữ/bỏ thay đổi trước khi tải ảnh, công thức combo chỉ xem, gọi hộ kiểm tra phiên bản và bếp/phiếu giữ thành phần lúc gọi. [Biên bản](evidence/internal-combo-browser-20261011.log) · [Hộp tạo combo desktop](evidence/internal-combo-admin-1440.png) · [Hộp tạo combo 320 px](evidence/internal-combo-admin-320.png) · [Gọi hộ 320 px](evidence/internal-combo-assisted-320.png) · [Bếp](evidence/internal-combo-kitchen.png) · [Phiếu 320 px](evidence/internal-combo-receipt-320.png). Các ảnh này dùng dữ liệu mock riêng cho kiểm thử, không phải hóa đơn hoặc đơn món thật.

Ngày 12/10, **3 ca browser bổ sung** trên cùng ba trình duyệt xác nhận trạng thái bán được giữ khi quản trị sửa giá hoặc thay ảnh trong lúc combo thiếu kho. [Biên bản](evidence/internal-combo-alias-browser-20261012.log). Tổng hai lượt là 24 ca nội bộ; chưa coi đó là kiểm thử toàn bộ hệ thống.

Các ảnh trong bảng dưới là **bằng chứng lịch sử đợt 01–03/10**, chụp ứng dụng với tên/mã thử tự sinh. Chúng không đại diện bộ ảnh món và banner mới ngày 11/10. Phạm vi kiểm tra từng đợt nằm trong [15 — Hồ sơ đối chiếu](15-doi-chieu.md).

| Giao diện               | Ảnh đối chiếu                                 |
| ----------------------- | --------------------------------------------- |
| Khách trên điện thoại   | [Xem ảnh](evidence/redesign-guest-mobile.png) |
| Phục vụ trên điện thoại | [Xem ảnh](evidence/redesign-staff-mobile.png) |
| ADMIN trên điện thoại   | [Xem ảnh](evidence/redesign-admin-mobile.png) |
| Quản trị thực đơn       | [Xem ảnh](evidence/redesign-menu-admin.png)   |
| Bếp                     | [Xem ảnh](evidence/redesign-kitchen.png)      |
| Kho                     | [Xem ảnh](evidence/redesign-inventory.png)    |

[Xem phạm vi và kết quả kiểm tra](15-doi-chieu.md).

## Chuyển bàn — 02/10/2026

Chọn bàn bằng thẻ có tìm mã/tên và lọc khu vực; chỉ hiện bàn sẵn sàng đủ chỗ, cùng khu trước. Desktop nhiều cột, điện thoại một cột; radio có nhãn đầy đủ, chữ Đã chọn và focus bàn phím. Một bước xác nhận trước khi ghi. Lịch sử là timeline mới nhất trước. [Hướng dẫn và bằng chứng bài 23](23-chuyen-ban.md). Không dùng ảnh hoặc sơ đồ sàn giả cho chức năng này.

## Sự cố món và hóa đơn — 02/10/2026

Thanh Việc cần xử lý của ADMIN có mặt ở mọi mục, gom hàng đợi bếp báo theo bàn. STAFF được nhắc đến bàn trao đổi khách và xác nhận riêng; KITCHEN chọn lý do nhanh, ghi chú tùy chọn. Phiếu dùng một dòng tiền/món, các cột thẳng hàng, nhóm hủy/miễn ở cuối và thành tiền 0đ khi đã miễn. Bố cục phần này nằm trong `apps/web/styles/issue.css`, được nhập sau theme chung. [Ảnh và hướng dẫn bài 24](24-su-co-mon-va-phieu-thanh-toan.md).

## Ảnh chứng từ khác ảnh món

Ảnh món/menu được hiển thị công khai để khách xem. Ảnh chuyển khoản chỉ STAFF/ADMIN đọc và nằm trong var/payment-proofs hoặc PAYMENT_PROOF_DIR; không thay qua public/images hoặc lib/media.ts. [Bài 25](25-thu-tien-tai-ban.md) hướng dẫn chọn ảnh, quyền đọc và bố cục thanh toán mới. CSS phần này ở apps/web/styles/payment.css.

## Thẻ bàn và trạng thái số tiền 0 — 03/10/2026

Hàng đợi phục vụ dùng thẻ nền trắng, gom nhiều việc cùng bàn, nhãn màu có chữ và một nút Chi tiết bàn. Desktop có ba cột, màn hình vừa hai cột, điện thoại một cột; nút nhóm chuyển thành lưới hai cột. Thao tác nhận/thu/bàn giao nằm trong chi tiết. Khách chưa gửi món hoặc có món hủy không bị báo đã thanh toán đủ. [Bài 22](22-ho-tro-va-ban-giao.md) · [Bài 25](25-thu-tien-tai-ban.md).

## Bố cục bốn vai trò — đợt cải tiến 03/10

| Vai trò | Nội dung được ưu tiên                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADMIN   | Menu trái sáng trên máy tính, thu gọn vẫn có biểu tượng; điện thoại có dải menu cuộn ngang. Tổng quan bắt đầu bằng bàn sẵn sàng/chờ dọn, hồ sơ thiếu tiền và nguyên liệu hết khả dụng. Thanh Việc cần xử lý còn nhắc hồ sơ thiếu tiền chưa chốt. |
| STAFF   | Ba ô nhanh cho việc cần xử lý, món chờ mang và bàn chờ dọn. Sơ đồ bàn gọn; việc gom theo bàn và mở chi tiết. Điện thoại giữ bốn mục ở thanh dưới.                                                                                                |
| KITCHEN | Số lượt ở từng nhóm chờ nhận/đang nấu/chờ phục vụ, cột và phiếu món rõ ràng. Điện thoại dùng một cột và nút chuyển nhóm. Quyền phục vụ/thu tiền không được cấp cho bếp.                                                                          |
| GUEST   | Phần hướng dẫn ngắn, món và thao tác nổi bật. Máy tính có lưới món/giỏ bên cạnh; điện thoại ảnh bên trái, thông tin bên phải và năm mục ở dưới. Ảnh không kéo méo hoặc đè chữ.                                                                   |

| Ảnh của bản đã kiểm thử | Máy tính                                                      | Điện thoại                                                   |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Quản trị                | [ADMIN](evidence/experience-desktop-admin-experience.png)     | [ADMIN](evidence/experience-mobile-admin-experience.png)     |
| Phục vụ                 | [STAFF](evidence/experience-desktop-staff-experience.png)     | [STAFF](evidence/experience-mobile-staff-experience.png)     |
| Bếp                     | [KITCHEN](evidence/experience-desktop-kitchen-experience.png) | [KITCHEN](evidence/experience-mobile-kitchen-experience.png) |
| Khách                   | [GUEST](evidence/experience-desktop-guest-experience.png)     | [GUEST](evidence/experience-mobile-guest-experience.png)     |

Ảnh đợt 03/10 dùng database kiểm thử riêng nên số liệu và tên thử khác dữ liệu bạn đang thao tác. Bảng này lưu bằng chứng bố cục ở thời điểm đó; ảnh đầu trang và ảnh món hiện hành thực hiện theo hướng dẫn ngày 11/10 phía trên.
