# 09. Ca làm, chấm công và lương

## Lịch và lương trong bộ dữ liệu hiện hành — 13/10/2026

Mẫu ca dùng mã **CA-SANG, CA-CHIEU, CA-TOI và CA-DEM**. Mẫu xác định giờ làm/nghỉ, không đặt đơn giá chung để mọi người nhận bằng nhau. Đơn giá cơ bản lưu ở từng nhân viên: bếp trưởng 65.000 đ/giờ, nhân viên bếp 42.000 đ/giờ, trưởng nhóm phục vụ 45.000 đ/giờ và phục vụ 35.000 đ/giờ trong bộ cấu hình kế hoạch. Quản trị có thể thêm mốc đơn giá mới theo thỏa thuận; không dùng mức này như mức lương thị trường đã được xác minh.

Ca sáng 07:00–16:00 nghỉ 09:00–10:00 có 8 giờ công; ca tối 15:00–23:00 nghỉ 16:00–17:00 có 7 giờ công, trong đó 22:00–23:00 là giờ đêm. Bộ lịch sử sử dụng cùng lịch trực với người nhận món/thu tiền/hoàn tiền, không phân ADMIN vào ca nhân viên. Ca đêm 22:00–02:00 (+1 ngày) là mẫu qua nửa đêm, không có nghĩa nhà hàng nhất thiết đóng cửa đúng 02:00.

Công được duyệt dùng **previewPay**, cùng hàm với ADMIN khi duyệt công, lưu khoảng làm/nghỉ, đơn giá, chính sách và các thành phần tiền. Có trường hợp đi muộn, bổ sung chấm công và làm thêm được duyệt với căn cứ; không tự trừ tiền phạt vì đi muộn. Lễ 02/09 được cấu hình trong lịch. Kỳ tháng 8 và 9 chỉ chốt/ghi nhận chi sau khi tháng kết thúc; tháng 10 giữ nháp. Công đã duyệt và kỳ đã chốt giữ snapshot để sau này sửa chính sách không đổi số tiền cũ.

Ca có giờ nghỉ và chính sách tính đêm/lễ cần mở từng ca, ghi rõ các khoảng công trước khi duyệt. Chúng không nằm trong nhóm duyệt hàng loạt theo lịch vì chỉ một số phút tổng không xác định được phần nào thuộc giờ đêm/ngày lễ. Seed thường chỉ tạo cấu hình và lịch dự kiến; bộ lịch sử là công cụ nghiệm thu riêng, không tự thêm công/lương mỗi lần khởi động.

Bài này mô tả mã nguồn hiện hành sau đợt cải tiến tính công ngày **10/10/2026**. Kết quả kiểm thử và trạng thái triển khai được ghi riêng tại [15 — Hồ sơ đối chiếu](15-doi-chieu.md); các ví dụ tiền dưới đây giải thích cách tính, không phải chứng từ chi lương thật.

## Vì sao tách lương nhân viên khỏi ca làm?

Bếp trưởng và phụ bếp có thể làm cùng một ca nhưng có lương cơ bản khác nhau. Nếu đặt ca đêm 50.000 đ/giờ và áp cho tất cả, sự khác biệt đó bị mất. Thiết kế mới tách ba phần:

| Phần quản lý              | Quản trị khai báo gì?                                        | Dùng để làm gì?                                         |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Đơn giá nhân viên         | Lương cơ bản một giờ, thời điểm áp dụng, lý do/thỏa thuận    | Mỗi người giữ được mức lương riêng                      |
| Chính sách tính lương     | Ngày áp dụng, tỷ lệ làm đêm, làm thêm, ngày nghỉ, ngày lễ    | Cùng một quy tắc được áp dụng trên lương của từng người |
| Lịch ngày lễ và ngày nghỉ | Ngày lễ của nhà hàng; ngày nghỉ hằng tuần của từng nhân viên | Xác định từng khoảng giờ thuộc loại ngày nào            |

Ca làm lưu giờ bắt đầu, kết thúc và thời gian nghỉ. Từ ngày áp dụng chính sách mới, đơn giá riêng cũ của mẫu ca không thay thế lương nhân viên. Các bản công cũ đã duyệt vẫn giữ nguyên.

Ví dụ chính sách làm đêm cộng 30%, ca 22:00–02:00 đủ 4 giờ tính công:

| Người làm     | Lương cơ bản | Lương một giờ đêm | Tiền công 4 giờ |
| ------------- | -----------: | ----------------: | --------------: |
| Nhân viên bếp | 40.000 đ/giờ |          52.000 đ |       208.000 đ |
| Bếp trưởng    | 80.000 đ/giờ |         104.000 đ |       416.000 đ |

Hai người cùng quyền Bếp nhưng có mức lương riêng. Không cần tạo thêm một quyền đăng nhập chỉ để phân biệt lương.

## Các bước sử dụng

### 1. Chuẩn bị đơn giá, chính sách và lịch nghỉ

Trong **Ca làm & lương → Đơn giá & chính sách**, quản trị đặt đơn giá cơ bản cho từng người. Khi tăng lương, thêm mức mới và thời điểm áp dụng; không sửa đè lịch sử. Hệ thống chọn mức có hiệu lực tại từng khoảng tính công. Nếu mức lương đổi giữa ca, phần trước và sau mốc đó được tách ra khi tính.

Chính sách tính lương có ngày bắt đầu áp dụng và các tỷ lệ. Mức mặc định là làm đêm cộng 30%; làm thêm ngày thường 150%; ngày nghỉ hằng tuần 200%; ngày lễ 300%. Quản trị có thể đặt mức cao hơn. Chính sách được bổ sung theo mốc ngày tiếp theo, không sửa/xóa bản đã lưu và không tính lại công đã duyệt.

Migration khởi tạo chính sách mặc định từ ngày được áp dụng tại múi giờ nhà hàng. Với cài đặt mới chưa có nhà hàng lúc migrate, seed khởi tạo chính sách từ ngày tạo dữ liệu. Chỉ thêm khi chưa có chính sách; ca trước ngày đó và các bản công/phiếu đã lưu giữ cách tính lịch sử. Việc khởi tạo không thay lương cơ bản hay lịch ca đã có.

Lịch ngày lễ áp dụng cho nhà hàng, còn lịch nghỉ hằng tuần gắn với từng người. **Chủ nhật không tự được coi là ngày nghỉ**: nhà hàng có thể xếp người làm Chủ nhật và nghỉ thứ Hai. Ghi từng ngày lễ, Tết và ngày nghỉ bù thực tế trước khi duyệt công liên quan. Nếu một ngày vừa là lễ vừa là ngày nghỉ hằng tuần, hệ thống ưu tiên loại ngày lễ, không cộng cả hai tỷ lệ.

Ngày nghỉ chưa dùng để duyệt công có thể được gỡ khi ghi nhầm. Ngày đã có công được duyệt hoặc thuộc kỳ lương đã chốt không được đổi để tránh thay căn cứ tính lương sau khi đã sử dụng.

### 2. Lập mẫu ca, lịch và phân công

Trong **Quản lý ca làm**, lưu các mẫu giờ thường dùng. **Lịch phân ca** chọn ngày, mẫu ca và nhân viên. Một ca giao được nhiều người, mỗi người có một phân công riêng.

Ca qua đêm cần giờ kết thúc thuộc ngày hôm sau. Cùng một người không được nhận hai ca chồng giờ; hai ca liền nhau có thể được phân công. Khi lập lại lịch đã có, hệ thống thông báo phần đã tồn tại và không tạo thêm bản ghi. Gửi đồng thời vẫn có kiểm tra tại máy chủ và cơ sở dữ liệu.

Lịch ngày cho thấy ca đang tiếp tục từ hôm trước. Lịch tuần theo ca và theo nhân viên xếp theo ngày bắt đầu ca. Số nhân viên tính người khác nhau; số lượt phân công tính từng ca của từng người. “Ca chưa có người” chỉ là ca rỗng, chưa phải kết luận đủ hoặc thiếu định biên.

### 3. Nhân viên tự chấm vào, ra

Phục vụ và bếp mở **Lịch làm & lương của tôi**, bấm **Vào ca** và **Ra ca**. Máy chủ ghi thời gian, nhân viên không tự nhập giờ quá khứ. Các mốc cho phép vào sớm, ra muộn và chênh lệch được quản lý trong chính sách chấm công; ca đã lập giữ cấu hình đã lưu.

Giờ vào, ra là bằng chứng hiện diện, chưa phải số tiền được trả. Chấm ra muộn không tự chuyển thành làm thêm. Đi muộn/về sớm ảnh hưởng công được đề xuất, không tự tạo khoản phạt tiền. Nếu thiếu giờ vào/ra, quản trị đối chiếu thực tế và bổ sung khoảng tính công; giờ gốc vẫn giữ nguyên.

### 4. Đối chiếu và duyệt công

Sau khi ca kết thúc, quản trị mở **Chấm công & duyệt** và chọn phân công cần kiểm tra. Công theo chính sách mới có các lựa chọn:

| Lựa chọn                             | Cách xử lý                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Tính đủ ca                           | Dùng công chuẩn sau thời gian nghỉ, cần đủ dấu vào/ra                            |
| Tính theo thời gian thực tế trong ca | Chỉ dùng phần nằm trong lịch và bằng chứng vào/ra                                |
| Nhập khoảng tính công sau kiểm tra   | Nhập rõ giờ bắt đầu/kết thúc của từng khoảng làm việc; có lý do                  |
| Nghỉ lễ hưởng lương                  | Ghi khoản hưởng theo chế độ trên ngày đã khai báo là lễ; không tạo giờ chấm công |
| Không tính công                      | Ghi vắng hoặc nghỉ không lương, 0 phút                                           |

Ca có nghỉ không tính công phải chọn **giờ bắt đầu và kết thúc nghỉ**. Ví dụ ca 20:00–24:00 nghỉ 21:00–21:30: công thường 90 phút, công đêm 120 phút. Nếu nghỉ 22:00–22:30 thì công thường 120 phút, công đêm 90 phút. Chỉ biết “nghỉ 30 phút” chưa đủ để tính tiền đêm chính xác.

Khi nhập công sau đối chiếu, chỉ nhập các khoảng có làm việc, bỏ khoảng nghỉ. Giờ làm thêm trước/sau ca được khai riêng; quản trị xác nhận đã thống nhất với nhân viên và ghi lý do. Những khoảng làm việc cùng nhóm không được trùng nhau hoặc trùng công đã duyệt ở ca khác.

Dấu chấm công giữ cả giây. Với công thực tế, khoảng duyệt chỉ lấy phút trọn nằm bên trong bằng chứng: vào 09:10:30, ra 14:55:45 thì khoảng phút là 09:11–14:55. Phần giây không bị sửa thành dấu chấm công mới.

Trước khi duyệt, giao diện yêu cầu máy chủ **tính tiền công dự kiến** từ các khoảng đã chọn. Thay thời gian, loại công hoặc lý do sẽ làm kết quả cũ hết hiệu lực. Lỗi tính tiền giữ nguyên dữ liệu nhập và có nút tính lại; không thể dùng kết quả cũ để duyệt nội dung đã thay đổi.

Nếu đơn giá hoặc lịch nghỉ được người khác cập nhật sau khi xem dự kiến, máy chủ tính lại lúc xác nhận. Số tiền khác kết quả đã xem sẽ chặn duyệt và giao diện tải lại dự kiến; quản trị phải xem số tiền mới rồi xác nhận lại.

Hệ thống lưu người duyệt, thời điểm, lý do, các khoảng công, phiên bản chính sách, đơn giá cá nhân, lịch nghỉ và từng khoản tiền. Công đã duyệt không được ghi đè; API kiểm tra lại dữ liệu khi xác nhận, không tin số tiền do giao diện gửi lên.

## Tiền từng loại giờ được tính thế nào?

Giờ đêm là 22:00–06:00. Các mức tối thiểu và cách tách tiền đêm/làm thêm được đối chiếu theo Điều 98, 106 của [Bộ luật Lao động 2019](https://vanban.chinhphu.vn/?docid=198540&lang=vi&pageid=27160) và Điều 55–57 [Nghị định 145/2020/NĐ-CP](https://chinhphu.vn/default.aspx?docid=201967&pageid=27160).

Gọi **B** là lương cơ bản một giờ của nhân viên. Với chính sách mặc định:

| Khoảng làm việc                                              | Công thức một giờ                   | Tỷ lệ tổng |
| ------------------------------------------------------------ | ----------------------------------- | ---------: |
| Giờ thường ngày làm việc                                     | B                                   |       100% |
| Giờ đêm thông thường                                         | B + 30% × B                         |       130% |
| Làm thêm ban ngày, ngày thường                               | 150% × B                            |       150% |
| Làm ban ngày, ngày nghỉ hằng tuần                            | 200% × B                            |       200% |
| Làm ban ngày, ngày lễ                                        | 300% × B                            |       300% |
| Làm thêm đêm ngày thường, chưa có làm thêm ban ngày trước đó | 150% × B + 30% × B + 20% × B        |       200% |
| Làm thêm đêm ngày thường, đã làm thêm ban ngày trước đó      | 150% × B + 30% × B + 20% × 150% × B |       210% |
| Làm thêm đêm ngày nghỉ hằng tuần                             | 200% × B + 30% × B + 20% × 200% × B |       270% |
| Làm thêm đêm ngày lễ                                         | 300% × B + 30% × B + 20% × 300% × B |       390% |

Các tỷ lệ trên là ví dụ mặc định; khi nhà hàng đặt mức cao hơn, máy chủ dùng chính sách tương ứng. Mức 300%/390% là tiền làm việc trong ngày lễ, chưa gộp khoản nghỉ lễ hưởng lương riêng. [Hướng dẫn tính tiền làm thêm ngày lễ](https://chinhsachonline.chinhphu.vn/cach-tinh-tien-luong-lam-them-gio-ngay-nghi-le-71682.htm) phân biệt hai khoản này.

Máy chủ tách khoảng công khi qua nửa đêm, 06:00, 22:00, mốc đơn giá và mốc chính sách. Ca 20:00–24:00 không được tính toàn bộ là ca đêm. Ca từ ngày thường sang ngày lễ chỉ phần thuộc ngày lễ mới mang loại ngày lễ.

Ví dụ B = 40.000 đ/giờ, ca 20:00–24:00 không nghỉ: 2 giờ thường × 40.000 + 2 giờ đêm × 52.000 = **184.000 đ**. Bếp trưởng B = 80.000 nhận **368.000 đ** cho cùng khoảng công.

### Đọc các dòng tiền

Phiếu hiển thị tiền công cơ bản và **phần trả thêm**. Ví dụ 1 giờ làm thêm ngày thường, B = 40.000: cơ bản 40.000, trả thêm làm thêm 20.000, tổng 60.000. Không cộng thêm 60.000 vào cơ bản lần nữa.

Các nhóm phút có thể giao nhau: 1 giờ làm thêm đêm ngày lễ vừa là giờ đêm, vừa thuộc ngày lễ. Không cộng tổng các ô “giờ đêm”, “giờ làm thêm”, “giờ lễ” để suy ra thời gian hiện diện. Chi tiết từng khoảng cho biết loại ngày, mức lương và tỷ lệ đã dùng.

Tiền được làm tròn đến đồng và phân bổ phần làm tròn để tổng từng khoản, tổng các khoảng và số tiền được duyệt khớp nhau.

### Nghỉ lễ hưởng lương

Khoản `PAID_HOLIDAY` là giờ nghỉ lễ được hưởng theo chế độ, tách khỏi giờ làm thực tế. Người nghỉ lễ có thể được duyệt khoản này mà không có dấu vào/ra. Người làm trong ngày lễ có thể đồng thời được ghi khoản hưởng ngày lễ phù hợp với chế độ của mình; hai khoảng có thể trùng thời gian vì đại diện hai căn cứ trả tiền khác nhau.

Quản trị phải kiểm tra quyền hưởng trước khi ghi nhận. Hệ thống kiểm tra ngày lễ đã khai báo, khoảng trong lịch phân công, công chuẩn của ca và giới hạn 8 giờ hưởng lễ/người/ngày; chặn ghi hưởng trùng ở ca khác. Hệ thống chưa tự suy ra quyền hưởng từ hợp đồng hay loại hình lao động và chưa tạo khoản nghỉ lễ cho người chưa có phân công.

## Lập bảng lương, chốt và chi riêng từng người

Kỳ lương dùng khoảng **[ngày bắt đầu, ngày kết thúc)**. Nhập từ 01/09 đến trước 01/10 là toàn bộ tháng 9. Kỳ phải kết thúc và không dài quá 62 ngày. Ca được xếp vào kỳ theo ngày bắt đầu tại múi giờ nhà hàng, kể cả ca qua tháng; việc tính tiền bên trong ca vẫn tách theo từng ngày.

Tất cả phân công còn hiệu lực trong kỳ phải được duyệt, kể cả vắng/nghỉ 0 công. Bản nháp sao chép các khoản và căn cứ của công đã duyệt, chưa hiển thị cho nhân viên. Quản trị thêm thưởng hoặc khấu trừ có lý do; tổng phiếu không được âm.

Chốt kỳ khóa số liệu và cho từng nhân viên xem phiếu của chính mình. Nếu nháp cần lập lại, xóa nháp giữ nguyên công đã duyệt nhưng các dòng thưởng/khấu trừ của nháp cần nhập lại. Không sửa công đã duyệt bằng cách xóa bảng lương.

Sau khi trả tiền thực tế, quản trị chọn **phiếu của đúng nhân viên**, nhập chứng từ/nội dung và ghi nhận đã chi đủ phiếu đó. Các người khác chưa chi vẫn ở trạng thái chờ. Kỳ chuyển sang đã chi đủ khi mọi phiếu cần trả đã có ghi nhận; phiếu 0 đồng không tạo giao dịch chi.

Đây là ghi nhận chi bên ngoài hệ thống, không tự chuyển khoản ngân hàng. Mỗi phiếu được ghi nhận chi đủ một lần; chưa có trả từng phần hoặc nhiều đợt.

## Dữ liệu và mã nguồn

| Bảng                       | Nội dung giữ lại                                                 |
| -------------------------- | ---------------------------------------------------------------- |
| shift_template, work_shift | Mẫu ca và lịch giờ cụ thể; cấu hình nghỉ/chấm công đã lưu        |
| shift_assignment           | Người được phân vào ca, khu vực, trạng thái                      |
| attendance_record          | Dấu vào/ra gốc, công đã duyệt, tiền và căn cứ tính               |
| employee_pay_rate          | Các mốc lương cơ bản cá nhân                                     |
| workforce_pay_policy       | Các phiên bản chính sách theo ngày áp dụng, chỉ bổ sung          |
| workforce_calendar_day     | Ngày lễ toàn nhà hàng và ngày nghỉ từng người                    |
| payroll_run, payroll_slip  | Kỳ lương và phiếu riêng từng người                               |
| payroll_line               | Công và các khoản thưởng/khấu trừ; sao chép căn cứ công đã duyệt |
| payroll_payment            | Ghi nhận chi đủ phiếu với người thực hiện, thời gian, tham chiếu |

`paid_periods` lưu khoảng `REGULAR`, `OVERTIME`, `PAID_HOLIDAY`; `pay_components` lưu tiền cơ bản, các phần trả thêm và tổng; `pay_snapshot` lưu phiên bản, múi giờ, khoảng tách, đơn giá, chính sách và lịch nghỉ đã dùng. Công và phiếu cũ không bị tính lại khi các danh mục thay đổi.

Nhân viên dùng `/core/workforce/me` và `/core/payroll/me` để xem dữ liệu của mình. Quản trị sử dụng `/core/workforce/pay-settings`, `/pay-policies`, `/calendar`, `/assignments/:id/pay-preview`, `/assignments/:id/approve` và các route bảng lương. Giao diện web thêm tiền tố `/api`; tài liệu viết theo đường dẫn backend.

Mở `apps/api/src/modules/workforce/pay-calculation.ts`, `pay.service.ts`, `pay.routes.ts`, `workforce.routes.ts`, `payroll.routes.ts`; giao diện ở `apps/web/features/workforce/`. Migration `202610100001_classified_workforce_pay` bổ sung chính sách, lịch nghỉ và căn cứ công/lương; trạng thái áp dụng thực tế xem bài 15.

## Ví dụ và bằng chứng lịch sử trước chính sách mới

Phần này chỉ giúp đọc công cũ và ảnh kiểm thử trước ngày 10/10, **không dùng để mô tả công thức mới cho ca đêm/ngày lễ**. Trước ngày áp dụng chính sách, công dùng đơn giá đã lưu lúc bắt đầu ca, có thể là đơn giá riêng của ca, chưa có các khoản trả thêm mới.

Ví dụ học tập của bản trước: pv001 có đơn giá 35.000 đ/giờ, công được duyệt 330 phút ngày 05/01 và 300 phút ngày 06/01. Tiền theo cách cũ là 192.500 + 175.000 = 367.500 đ; thưởng 50.000, khấu trừ hoàn ứng 17.500 cho phiếu **400.000 đ**. Ca đêm của ví dụ này chưa tính hệ số; không lấy nó làm mẫu cho lương đêm hiện hành.

Công thức cũ đã lưu:

```text
amount = floor((approved_minutes × hourly_rate + 30) / 60)
```

Ảnh và biên bản cũ: [lịch phân ca](evidence/workforce-admin.png), [phiếu lương](evidence/workforce-payroll.png), [điện thoại](evidence/workforce-mobile.png), [ngày theo ca](evidence/staffing-day-admin.png), [tuần theo ca](evidence/staffing-week-shifts.png), [lịch cá nhân](evidence/staffing-personal-day.png), [biên bản 30/09](reference/workforce-review-20260930.json), [biên bản giao diện 30/09](reference/workforce-ui-20260930.json), [biên bản 01/10](reference/staffing-ui-20261001.json). Đây là dữ liệu của môi trường kiểm thử ở thời điểm tương ứng, không phải bằng chứng bản mới đã chạy lại toàn bộ các tình huống.

## Giới hạn hiện tại và bài tập

Ứng dụng quản lý lương giờ nội bộ. Chưa tự tính thuế, bảo hiểm, số dư phép, quyền nghỉ theo hợp đồng, phụ cấp bắt buộc của từng loại hợp đồng, hoặc chuyển tiền ngân hàng. Chưa có GPS/vân tay, chấm nghỉ giữa ca, tự xác định định biên, hoặc kiểm soát đầy đủ hạn mức làm thêm theo ngày/tháng/năm. Giới hạn nhập khoảng công của phần mềm không thay cho hạn mức làm thêm theo quy định; quản trị vẫn phải kiểm tra lịch và thỏa thuận thực tế.

Hãy tự giải thích ba tình huống: bếp trưởng và phụ bếp cùng ca đêm; ca 20:00–24:00 nghỉ 21:00–21:30; nhân viên vừa làm ngày lễ vừa có quyền hưởng tiền nghỉ lễ. Với mỗi tình huống, chỉ ra đơn giá, chính sách, lịch nghỉ, các khoảng công và từng dòng tiền được lưu ở đâu. Sau chốt, đổi lương hiện tại phải giữ nguyên phiếu đã chốt.
