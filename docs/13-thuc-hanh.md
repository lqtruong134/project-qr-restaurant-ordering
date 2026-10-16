# 13. Bài thực hành và nghiệm thu phần cơ bản

## Điều kiện thực hành

Dùng môi trường demo/test đã xác định, các tài khoản đúng vai trò và dữ liệu có thể thử. Các bước dưới có ghi đơn, kho và tiền; không chạy trên phiên phục vụ khách thật để học. Không dùng số liệu test cũ làm kết quả lần thực hành mới.

Tách phiên trình duyệt cho STAFF, KITCHEN, ADMIN và hai khách. Tài khoản nội bộ dùng mật khẩu hiện có trên máy; bộ tài liệu không lưu mật khẩu. Ghi lại tên database, commit, ngày thử và các bước đã làm.

## Bài 1 — Một bữa ăn đầy đủ

1. ADMIN kiểm tra bàn hoạt động, QR còn hiệu lực và món đủ công thức/kho hoặc không quản lý kho.
2. An và Bình dùng hai phiên trình duyệt quét cùng QR. Kỳ vọng cùng session, khác participant.
3. Mỗi người thêm một món. Thử sửa dòng của người khác qua luồng cho phép quan sát: hệ thống không cho sửa trái chủ.
4. Gửi phần của mình. Nếu PENDING_REVIEW, STAFF duyệt; sau duyệt xuất hiện ở bếp.
5. KITCHEN accept → prepare → ready; STAFF serve. Kiểm tra tên/giá snapshot và mốc trạng thái.
6. STAFF tạo intent, đối chiếu và confirm thu tiền; kiểm tra tiền đưa/thừa nếu CASH.
7. Hoàn tất support/alert, đóng phiên. Kỳ vọng có receipt_snapshot, bàn NEEDS_CLEANING.
8. STAFF clean. Kỳ vọng AVAILABLE và QR có thể dùng cho phiên mới khác ID.

Bạn phải chỉ ra được từng bước ảnh hưởng các bảng nào, không chỉ quay video nút bấm.

## Bài 2 — Hủy trước chế biến

Gửi món đã được chấp nhận nhưng chưa prepare. Cho STAFF hủy; kỳ vọng giữ kho được trả, item CANCELLED, charge REVERSED nếu đã phát sinh. Nếu đã thu tiền, phải có refund_due; lập hồ sơ và ghi nhận hoàn rồi mới kết thúc các việc của phiên.

## Bài 3 — Hủy muộn và miễn tiền

Đưa món tới IN_PREPARATION. Khách/STAFF không hủy trực tiếp theo cách trước chế biến. ADMIN late-cancel với CUSTOMER_CHANGED_MIND; kiểm tra chi phí kho và charge vẫn giữ. Với một món khác, bếp báo lỗi chế biến, ADMIN xác nhận KITCHEN_ERROR; charge bị đảo trong cùng quyết định, không waive thêm. Nếu là complaint sau SERVED, ADMIN waive riêng và vẫn giữ SERVED. Đã trả tiền thì phát sinh cần hoàn. Bài này kiểm tra bạn phân biệt vật chất, đơn hàng và tiền.

## Bài 4 — Thanh toán chia phần và gửi lặp

Tổng ví dụ 140.000; tạo/confirm 100.000 rồi 40.000. Gửi lại cùng requestId cho cùng nội dung và quan sát không tạo intent trùng. Confirm lặp intent thành công không tạo thêm payment transaction. Đổi nội dung mà giữ khóa phải bị từ chối ở các route có kiểm tra khóa.

## Bài 5 — Xung đột giỏ và tồn

Hai khách đọc cùng cartVersion; một người sửa, người kia thao tác bằng version cũ. Kỳ vọng tải lại, không ghi đè im lặng. Cho hai lượt gọi tranh lượng nguyên liệu hạn chế trong môi trường test; tổng giữ không vượt tồn. Kiểm tra lỗi có rollback đầy đủ, không còn order_item hoặc reservation mồ côi.

## Bài 6 — Chuyển bàn và hỗ trợ

Chuyển từ A01 sang bàn AVAILABLE đủ chỗ. Session ID, món và tiền giữ nguyên; có transfer history; bàn cũ chờ dọn. Tạo yêu cầu hỗ trợ, một STAFF claim, gửi đề nghị bàn giao cho STAFF khác với lý do, người nhận bấm “Nhận bàn giao” rồi mới được hoàn tất. Trước khi đồng ý, người gửi vẫn chịu trách nhiệm. Xem [ví dụ bài 22](22-ho-tro-va-ban-giao.md). Thử bàn đích bận hoặc fromTableId cũ phải bị từ chối. [Bài 23](23-chuyen-ban.md) có thao tác giao diện từng bước: chọn thẻ bàn, đổi số khách làm bỏ bàn thiếu chỗ, Hủy chưa chuyển, và theo dõi khách tại bàn mới.

## Bài 7 — Kho

Tạo phiếu nhập nháp: tồn chưa tăng. Sửa nháp đúng version, approve: tồn tăng đúng một lần và có movement. Gửi lại approve không tăng lần hai. COUNT nhập số thực đếm; WASTE nhập lượng loại bỏ; đều có lý do/audit, chặn stale version và tồn dưới reserved.

## Bài 8 — Công và lương

Tạo ca phù hợp thời gian demo, phân nhân viên, vào/ra ca, duyệt công sau kết thúc. Thiếu dấu chấm công phải dùng tình huống thích hợp có lý do. Tạo kỳ nháp sau khi kỳ kết thúc, thêm thưởng/khấu trừ, finalize và ghi nhận paid. Nhân viên chỉ xem phiếu của mình và không xem nháp.

Không đổi đồng hồ máy hoặc sửa database vận hành để giả lập thời gian. Kiểm thử tự động có thể dựng mốc thời gian/dữ liệu riêng phù hợp; demo giao diện cần ca/kỳ đã kết thúc thật.

## Ma trận tình huống cần ổn định

| Tình huống | Kỳ vọng cần kiểm chứng |
|---|---|
| Đăng nhập lại cùng user ở nơi khác | Phiên cũ bị chặn, không hồi sinh màn hình bằng response đến muộn |
| QR thu hồi/hết hạn/khu vực tắt | Chặn tham gia mới đúng thông báo |
| Guest đổi giá/số lượng ở request | Backend tự tính/kiểm tra; không tin giá tự gửi |
| Lượt duyệt hết hạn | Hủy món chờ, trả giữ kho, không phát sinh charge sai |
| Payment intent hết hạn | Không giữ số tiền vô hạn; không confirm thủ công được |
| Hoàn từng phần/lặp request | Không hoàn vượt và không ghi trùng |
| Đổi tên/giá sau đóng phiên | Phiếu thu cũ giữ snapshot |
| Đóng còn cảnh báo/hỗ trợ | Luồng close thường phải chặn |
| Write-off | Chỉ ADMIN, không giả thanh toán, có lý do ngoại lệ |
| Ca chồng giờ và kỳ đã chốt | Không phân trùng; không sửa công/lương lịch sử |

## Dùng test tự động đúng cách

Unit kiểm tra mảnh nhỏ; integration kiểm tra API + PostgreSQL; E2E kiểm tra trình duyệt. Các integration chính tạo database test riêng và dọn sau; vẫn phải đọc runner và DATABASE_URL nền trước khi chạy. Tên test là tài liệu về ý định, không phải kết quả PASS.

Đọc danh sách đầy đủ theo tệp ở [hồ sơ đối chiếu](15-doi-chieu.md). Khi nhận sửa lỗi, chạy lại đúng nhóm kiểm thử bị ảnh hưởng trước, rồi các kiểm tra liên quan. Không cần lặp toàn suite chỉ vì sửa câu chữ tài liệu.

## Phiếu ghi kết quả

| Mã bài | Ngày / người thử | Dữ liệu demo | Kết quả thực tế | PASS/FAIL | Bằng chứng / lỗi |
|---|---|---|---|---|---|
| B01 | Tự điền | Tự điền | Chưa thực hiện | Chưa đánh giá | Không dùng PASS mặc định |

Bạn hoàn thành lộ trình khi tự demo được luồng đầy đủ, tự giải thích ba ngoại lệ tiền/kho và tự lần từ một màn hình đến API/SQL mà không nhờ AI đoán giúp.

## Bài bổ sung — Miễn món đã phục vụ và đọc chứng cứ CSDL

Dùng phiếu mẫu A04 để đọc cách thể hiện món “Miễn tiền”. Với phiên demo mới, đưa món tới SERVED rồi để ADMIN waive trực tiếp. Kỳ vọng món vẫn SERVED, movement tiêu hao không bị đảo, charge không còn ACTIVE, có audit và phiếu thu ghi thành tiền 0. Nếu đã thu, phải xử lý refund trước khi đóng bình thường.

Với trường hợp dữ liệu chéo phiên, không tự INSERT sai vào database đang học. Đọc `tests/review.integration.test.ts`: các ca cố tình gắn refund vào món/allocation phiên khác phải bị PostgreSQL từ chối; test dùng database riêng và dọn sau. Tự giải thích vì sao FK “ID tồn tại” chưa đủ.
