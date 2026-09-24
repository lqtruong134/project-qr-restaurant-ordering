# SỔ KIỂM THỬ NGHIỆM THU THỦ CÔNG — QR RESTAURANT

Phiên bản đối chiếu: mã nguồn a1078cb, ngày 24/09/2026. Phạm vi: 53 bảng nghiệp vụ, bốn vai trò quản trị/phục vụ/bếp/khách. Đây là danh sách để BẠN tự kiểm tra, tất cả ca ban đầu là Chưa thử; không phải tuyên bố đã nghiệm thu toàn hệ thống.

## Cách dùng

Đi theo thứ tự nhóm 01 → 14. Mỗi ca ghi kết quả thực tế và chọn: Đạt / Lỗi / Muốn đổi nghiệp vụ / Bị chặn / Không áp dụng. Có thể vừa có lỗi vừa muốn đổi: chọn Lỗi và ghi cả đề xuất. “Muốn đổi” nghĩa là phần mềm làm đúng thiết kế hiện tại nhưng bạn không chấp nhận cách vận hành đó. Không đánh dấu Đạt chỉ vì không thấy lỗi.

Bản HTML có ô ghi chú, lọc và xuất JSON/CSV. Ghi chú chỉ lưu trong trình duyệt trên máy hiện tại; khi đổi đường dẫn/hồ sơ hoặc xóa dữ liệu trình duyệt có thể mất. Sau mỗi buổi bấm Xuất kết quả JSON và CSV. Không đưa mật khẩu, cookie, token QR còn hiệu lực hoặc thông tin khách thật vào nhận xét.

Mỗi lần thử đặt mã đợt UAT-YYYYMMDD-01. Dùng dữ liệu giả, khu vực/bàn UAT riêng và tài khoản thử. Thu/hoàn/chi lương trong tài liệu là mô phỏng ghi nhận, không yêu cầu chuyển tiền thật. Các bước chốt phiếu, duyệt công, chốt lương/nhập kho lưu lịch sử và không có nút hoàn tác tùy ý; cần thử trên database demo, không trên dữ liệu vận hành thật.

## Chuẩn bị và khởi động

1. Mở Docker Desktop, chờ sẵn sàng. Mở Ubuntu/WSL.
2. Dự án đã được cài và nâng cấp ở máy hiện tại: chạy các lệnh sau. Nếu localhost đã mở được, không chạy thêm dev lần hai.

```sh
cd ~/projects/qr-ordering-thesis
source ~/.nvm/nvm.sh
pnpm db:up
pnpm dev
```

3. Giữ terminal đang chạy. Mở http://localhost:3000. Nếu EADDRINUSE, kiểm tra terminal dev đang có, dùng phiên đang chạy hoặc Ctrl+C đúng terminal đó; không xóa database để sửa lỗi cổng.
4. Chỉ khi cài máy mới hoặc vừa nhận migration mới: làm theo README, gồm pnpm install --frozen-lockfile; pnpm run setup; pnpm db:generate; pnpm db:migrate; pnpm db:seed. Seed bổ sung dữ liệu, không phải nút reset. Không dùng prisma migrate reset, db push, Docker down -v hoặc xóa dữ liệu để bắt đầu lượt thử khác.
5. Nếu muốn một database sạch riêng hoặc cần phục hồi bản cũ, nhờ người phụ trách kỹ thuật tạo và sao lưu trước. Tài liệu này không tự đổi .env hoặc xóa dữ liệu đang có.

## Bố trí cửa sổ

| Ký hiệu | Hồ sơ riêng | Tài khoản/đường vào |
|---|---|---|
| A | Quản trị | quyettruong05 → /login |
| S1 | Phục vụ 1 | pv001 → /login |
| S2 | Phục vụ 2 | pv002 → /login |
| K1 | Bếp | bep001 → /login |
| K2 | Bếp phụ khi thử đồng thời | bep002 → /login |
| G1/G2/G3 | Khách, mỗi người một hồ sơ | Liên kết QR của bàn, nhập tên |

Mật khẩu dùng mật khẩu bạn đã cấu hình; tài liệu không sao chép mật khẩu thật. Các tab cùng hồ sơ chia sẻ đăng nhập. Nhiều cửa sổ ẩn danh của cùng trình duyệt thường vẫn chia sẻ phiên ẩn danh, không coi là nhiều khách độc lập. Dùng hồ sơ Chrome/Edge khác nhau hoặc trình duyệt khác; một tài khoản nhân viên hiện chỉ có một phiên hiện hành.

## Dữ liệu và lịch thử

- Tạo UAT-KV, UAT-A/UAT-B (4 chỗ), hai tài khoản UAT trùng tên khác mã. Ghi giá món thực tế trước khi dùng số mẫu 79.000/55.000/120.000; nếu giá đã đổi, tính lại theo giá đang thấy.
- Một phiên dành cho luồng bình thường; mỗi tình huống hủy/hoàn/thiếu tiền dùng phiên mới. Không nối tất cả ca vào một phiên vì điều kiện sẽ xung đột.
- Kho dùng nguyên liệu/món UAT riêng để tự tính tồn; món mới chưa có công thức/tồn không dùng cho luồng ăn hoàn chỉnh.
- Ca/lương dùng nhân viên và ngày riêng không trùng ca seed. Ca chấm công thực tế cần đợi kết thúc 5–10 phút. Ca lịch sử có thể được quản trị duyệt có giải trình, nhưng phải ghi rõ đây là dữ liệu thử, không giả là đã chấm công thật.
- Buổi 1: khởi động, quyền, danh mục, QR, giỏ. Buổi 2: phục vụ/bếp, hỗ trợ, thu/hoàn/phiếu, chuyển bàn. Buổi 3: kho/rủi ro/báo cáo. Buổi 4: ca/lương, mobile, thử lại các lỗi và đề xuất.
- Chụp giá trị ban đầu trước khi đổi giá/ngưỡng/trạng thái; kết thúc thì khôi phục cấu hình thử. Dọn bàn bằng quy trình đóng/dọn, giữ lịch sử giao dịch; không xóa sổ để làm sạch.

## Thử trên điện thoại

Máy tính và điện thoại cùng Wi-Fi riêng. Dừng đúng terminal dev của bạn trước khi chạy `LAN_HOST=IP_MAY_TINH pnpm dev:lan` trong Ubuntu (thay IP_MAY_TINH bằng IPv4 thật, ví dụ 192.168.1.10). Điện thoại mở http://IP_MAY_TINH:3000. Mở Admin bằng địa chỉ LAN đó khi cấp/xem link QR để QR không trỏ localhost.

Nếu không vào được dù cùng Wi-Fi: WSL NAT có thể cần chuyển tiếp cổng và Windows Firewall; đánh dấu Bị chặn — cấu hình mạng và nhờ kỹ thuật. Không mở cổng PostgreSQL ra mạng. Có thể thử nghiệp vụ trước bằng nhiều hồ sơ trên laptop; DevTools mobile chỉ mô phỏng kích thước, không thay điện thoại thật.

## Quy tắc ghi kết quả

Ghi: mã ca; tài khoản/vai trò; mã bàn/lượt/phiếu; giờ thử; bước đã làm; kết quả thực tế; mong muốn; ảnh; mức ưu tiên P0 mất/sai tiền hoặc lộ dữ liệu, P1 chặn vận hành, P2 khó dùng, P3 thẩm mỹ. Với lỗi tiền/tồn ghi số trước và sau. Nếu không tìm thấy nút, không đoán đường khác: ghi tên màn hình và đánh dấu Bị chặn hoặc Muốn đổi.

Phần “Câu hỏi nghiệp vụ” là gợi ý để bạn quyết định, không khẳng định hệ thống đã có chức năng đó. Một số ca biên có thể phát hiện lỗi chưa biết; giữ nguyên kết quả thực tế thay vì sửa kỳ vọng để cho Đạt.

## 01 · Khởi động, tài khoản và quyền

### UAT-001 — Mở hệ thống đã cài

**Vào đâu:** Ubuntu + trình duyệt

**Chuẩn bị:** Docker Desktop đang chạy; dùng bản dự án hiện tại.

1. Chạy các lệnh ở phần Chuẩn bị
2. Mở localhost:3000
3. Vào trang đăng nhập.

**Kết quả cần đối chiếu:** Trang tải được; không trắng trang hoặc báo lỗi kết nối. Không cần chạy lại setup/seed mỗi lần mở.

**Bạn đánh giá nghiệp vụ:** Trang đầu có giải thích rõ ai dùng và đi đâu không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-002 — Đăng nhập bốn vai trò

**Vào đâu:** /login và liên kết QR

**Chuẩn bị:** Bốn hồ sơ trình duyệt riêng: A quản trị, S phục vụ, K bếp, G khách.

1. A đăng nhập quyettruong05
2. S đăng nhập pv001
3. K đăng nhập bep001
4. G để riêng, vào bằng QR sau.

**Kết quả cần đối chiếu:** Mỗi tài khoản đến đúng không gian; khách không dùng tài khoản nhân viên.

**Bạn đánh giá nghiệp vụ:** Tên vai trò, tên người dùng và nút đăng xuất có dễ nhận biết không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-003 — Sai hoặc thiếu thông tin đăng nhập

**Vào đâu:** /login

**Chuẩn bị:** Một hồ sơ chưa đăng nhập.

1. Bỏ trống tên/mật khẩu rồi bấm đăng nhập
2. Nhập tên không tồn tại
3. Nhập đúng tên nhưng sai mật khẩu một lần.

**Kết quả cần đối chiếu:** Không vào được hệ thống; thông báo dễ hiểu, không lộ mật khẩu hoặc lỗi kỹ thuật.

**Bạn đánh giá nghiệp vụ:** Bạn muốn báo chung hay chỉ rõ trường nhập sai?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-004 — Không được vượt quyền

**Vào đâu:** Hồ sơ S/K/G, thanh địa chỉ

**Chuẩn bị:** S đã đăng nhập phục vụ; K đã đăng nhập bếp.

1. S mở /workspace/admin
2. K mở /workspace/staff
3. G mở /workspace/admin.

**Kết quả cần đối chiếu:** Bị từ chối hoặc yêu cầu đăng nhập; không hiện dữ liệu quản trị. Quản trị hiện không tự động có quyền thao tác thay mọi vai trò.

**Bạn đánh giá nghiệp vụ:** Bạn có muốn quản trị được kiêm thu ngân/phục vụ không? Ghi là đề xuất thay đổi quyền.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-005 — Đăng xuất và nút quay lại

**Vào đâu:** S → Đăng xuất

**Chuẩn bị:** Đang ở màn bàn.

1. Bấm Đăng xuất
2. Bấm Back trình duyệt
3. Tải lại hoặc mở /workspace/staff trực tiếp.

**Kết quả cần đối chiếu:** Không tiếp tục dùng dữ liệu/chức năng cần đăng nhập.

**Bạn đánh giá nghiệp vụ:** Cách thông báo phiên hết hạn có phù hợp không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-006 — Một tài khoản mở ở hai nơi

**Vào đâu:** Hai hồ sơ S1/S2

**Chuẩn bị:** Dùng cùng pv001 chỉ trong bài này.

1. S1 đăng nhập pv001
2. S2 đăng nhập pv001
3. S1 tải lại hoặc thực hiện thao tác.

**Kết quả cần đối chiếu:** Phiên cũ mất hiệu lực; một tài khoản có một phiên hiện hành. Sau bài, đăng nhập lại S1 và dùng pv002 ở S2.

**Bạn đánh giá nghiệp vụ:** Nhà hàng có cần một tài khoản dùng đồng thời nhiều máy không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-007 — Khóa nhân viên đang đăng nhập

**Vào đâu:** A → Nhân viên; S2

**Chuẩn bị:** Tạo tài khoản thử riêng, không khóa tài khoản quản trị đang dùng.

1. Đăng nhập nhân viên thử ở S2
2. A ngừng tài khoản đó
3. S2 tải lại và thử thao tác
4. A mở lại.

**Kết quả cần đối chiếu:** Phiên cũ bị thu hồi; nhân viên ngừng không thao tác tiếp; mở lại cần đăng nhập hợp lệ.

**Bạn đánh giá nghiệp vụ:** Có cần ghi lý do khóa hoặc ngày nghỉ việc không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-008 — Mất kết nối và phục hồi

**Vào đâu:** S/G đang mở; Ubuntu

**Chuẩn bị:** Chỉ dừng tiến trình dev do bạn đang chạy, không dừng database.

1. Ctrl+C ở terminal dev
2. Thử tải lại/thao tác
3. Chạy lại pnpm dev
4. Mở/tải lại trang.

**Kết quả cần đối chiếu:** Có báo lỗi thay vì báo thành công giả; dữ liệu đã lưu còn nguyên. Kiểm tra không tạo trùng sau khi thử lại.

**Bạn đánh giá nghiệp vụ:** Thông báo có đủ rõ để nhân viên biết dữ liệu đang cũ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-009 — Khởi động lại không mất dữ liệu

**Vào đâu:** Ubuntu + A/S

**Chuẩn bị:** Ghi tên một bàn/món đã tạo thử.

1. Dừng dev
2. Chạy lại dev
3. Đăng nhập
4. Tìm lại bản ghi.

**Kết quả cần đối chiếu:** Dữ liệu còn; không phải seed lại để phục hồi. Không chạy down -v hoặc reset DB.

**Bạn đánh giá nghiệp vụ:** Quy trình mở đầu ngày có quá nhiều thao tác không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-010 — Hạn chế thử đăng nhập liên tục

**Vào đâu:** /login; thực hiện cuối nhóm

**Chuẩn bị:** Dùng tên thử; tránh làm khóa nhịp kiểm thử chính.

1. Gửi nhiều lần sai liên tiếp cho đến khi hệ thống báo giới hạn
2. Ghi số lần/thời gian
3. Dừng, chờ rồi thử lại.

**Kết quả cần đối chiếu:** Có giới hạn và không lộ dữ liệu; không cần sửa DB để vượt giới hạn.

**Bạn đánh giá nghiệp vụ:** Thời gian chờ và lời nhắc có chấp nhận được với nhân viên không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 02 · Quản trị: nhân viên, bàn và QR

### UAT-011 — Tạo hai nhân viên trùng tên

**Vào đâu:** A → Nhân viên

**Chuẩn bị:** Dùng mã UAT-PV01 và UAT-PV02; mật khẩu thử riêng không ghi vào báo cáo.

1. Tạo hai người cùng họ tên, cùng vai trò phục vụ nhưng khác tên đăng nhập
2. Đăng nhập từng người.

**Kết quả cần đối chiếu:** Cho phép trùng họ tên; phân biệt bằng tên đăng nhập; không lẫn lịch/phiếu lương.

**Bạn đánh giá nghiệp vụ:** Mã nhân viên có đủ dễ nhớ và dễ tra cứu không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-012 — Tên đăng nhập trùng và dữ liệu thiếu

**Vào đâu:** A → Nhân viên

**Chuẩn bị:** Đã tạo UAT-PV01.

1. Tạo tiếp cùng tên đăng nhập
2. Thử bỏ trống tên/mật khẩu
3. Thử tên có khoảng trắng thừa.

**Kết quả cần đối chiếu:** Không tạo hai mã giống nhau hoặc bản ghi thiếu bắt buộc; kiểm tra thông báo tại form.

**Bạn đánh giá nghiệp vụ:** Bạn muốn quy tắc mã tài khoản như thế nào?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-013 — Đổi tên hoặc vai trò nhân viên

**Vào đâu:** A → Nhân viên; nhân viên thử

**Chuẩn bị:** Chỉ dùng người UAT, chưa có ca đang làm.

1. Sửa họ tên
2. Đổi từ phục vụ sang bếp
3. Đăng nhập lại bằng tài khoản đó.

**Kết quả cần đối chiếu:** Tên/quyền mới có hiệu lực; không còn thao tác trái vai trò cũ.

**Bạn đánh giá nghiệp vụ:** Đổi vai trò có nên cần xác nhận hoặc lưu lý do không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-014 — Tạo khu vực và bàn

**Vào đâu:** A → Bàn & QR → Thêm bàn hoặc khu vực

**Chuẩn bị:** Mã khu vực UAT-KV; bàn UAT-A và UAT-B, mỗi bàn 4 chỗ.

1. Tạo khu vực
2. Tạo hai bàn trong khu vực
3. S tải lại Sơ đồ bàn.

**Kết quả cần đối chiếu:** Bàn nằm đúng khu vực, đúng sức chứa; phục vụ thấy để mở bàn.

**Bạn đánh giá nghiệp vụ:** Có cần vị trí bàn dạng sơ đồ kéo thả không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-015 — Kiểm tra mã và sức chứa

**Vào đâu:** A → Bàn & QR

**Chuẩn bị:** Dùng bản ghi mới, không đổi bàn đang có khách.

1. Tạo mã bàn trùng
2. Nhập sức chứa 0, âm, số lẻ hoặc vượt giới hạn form
3. Sửa tên bàn hợp lệ.

**Kết quả cần đối chiếu:** Mã trùng/dữ liệu ngoài giới hạn bị chặn; thay đổi hợp lệ được lưu.

**Bạn đánh giá nghiệp vụ:** Giới hạn sức chứa hiện tại có hợp thực tế phòng riêng/bàn ghép không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-016 — Cấp QR và mở menu đúng bàn

**Vào đâu:** A → Bàn & QR → bàn UAT-A

**Chuẩn bị:** Bàn trống, khu vực đang bật.

1. Cấp QR mới, thay QR cũ
2. Xác nhận
3. Sao chép liên kết Mở thực đơn của bàn
4. Dán vào hồ sơ G.

**Kết quả cần đối chiếu:** G thấy đúng bàn và form tên khách. Không sao chép URL trang quản trị thay cho liên kết QR.

**Bạn đánh giá nghiệp vụ:** Thẻ QR có đủ tên nhà hàng, mã bàn và hướng dẫn quét không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-017 — Xem lại và in QR

**Vào đâu:** A → Bàn & QR → bàn đã có QR

**Chuẩn bị:** Giữ lại link QR hiện tại.

1. Xem QR hiện tại
2. Mở liên kết cũ
3. Tải mã QR để in hoặc mở xem trước bản in.

**Kết quả cần đối chiếu:** Xem/in lại không tự thay token; QR không méo hoặc cắt; bản in không chứa nút quản trị.

**Bạn đánh giá nghiệp vụ:** Kích thước và nội dung thẻ đặt bàn đã dùng được chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-018 — Thay QR làm link cũ hết hiệu lực

**Vào đâu:** A + hồ sơ khách mới

**Chuẩn bị:** Lưu link QR cũ của UAT-A; không dùng phiên khách đã tham gia để kết luận token còn hiệu lực.

1. Cấp QR mới
2. Hồ sơ khách mới mở link cũ
3. Mở link mới.

**Kết quả cần đối chiếu:** Link cũ không cho tham gia mới, link mới dùng được. Phiên khách đã tham gia là tình huống khác cần quan sát riêng.

**Bạn đánh giá nghiệp vụ:** Bạn muốn xử lý khách đang ngồi khi đổi QR ra sao?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-019 — Ngừng bàn/khu vực

**Vào đâu:** A → Bàn & QR; G/S

**Chuẩn bị:** Dùng UAT-KV, kiểm tra cả bàn trống và một phiên đang hoạt động.

1. Tắt bàn hoặc khu vực
2. Hồ sơ khách mới quét QR
3. S xem phiên đang có khách
4. Bật lại sau bài.

**Kết quả cần đối chiếu:** Không nhận khách mới tại nơi ngừng; phiên đang phục vụ vẫn phải xử lý được, không mất đơn/tiền.

**Bạn đánh giá nghiệp vụ:** Ngừng khu vực có nên bị cấm khi còn khách không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-020 — Mở bàn thủ công

**Vào đâu:** S → Sơ đồ bàn → bàn trống

**Chuẩn bị:** UAT-B đang trống.

1. Bấm Mở bàn
2. Mở chi tiết
3. Xem thông tin phiên
4. G quét QR bàn đó.

**Kết quả cần đối chiếu:** Một phiên đang hoạt động tại bàn; khách tham gia đúng phiên, không tạo thêm phiên song song.

**Bạn đánh giá nghiệp vụ:** Có cần nhập số khách ngay lúc mở bàn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 03 · Thực đơn, giá bán và dữ liệu cũ

### UAT-021 — Danh mục và món mới

**Vào đâu:** A → Thực đơn

**Chuẩn bị:** Mã UAT-DM, UAT-MON; giá 55000. Món mới cần công thức/tồn trước khi gửi bếp.

1. Tạo danh mục
2. Tạo món UAT Món thử
3. Nhập mô tả và ảnh
4. G tải lại menu.

**Kết quả cần đối chiếu:** Món xuất hiện đúng nhóm, giá 55.000đ; không lộ mã nội bộ thay tên dễ đọc.

**Bạn đánh giá nghiệp vụ:** Tên, mô tả, ảnh và vị trí nút chọn món đã đủ hấp dẫn chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-022 — Giá và thông tin không hợp lệ

**Vào đâu:** A → Thực đơn

**Chuẩn bị:** Dùng món thử.

1. Thử giá âm, số lẻ, chữ, bỏ trống tên
2. Thử mã trùng
3. Nhập lại hợp lệ.

**Kết quả cần đối chiếu:** Dữ liệu sai bị chặn; giá dùng đồng nguyên; không lưu âm hoặc NaN.

**Bạn đánh giá nghiệp vụ:** Giá 0 có nên được phép cho món tặng không? Ghi quy tắc bạn muốn.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-023 — Tìm kiếm và lọc danh mục

**Vào đâu:** G → Thực đơn; A → Thực đơn

**Chuẩn bị:** Có món tiếng Việt có dấu.

1. Tìm đầy đủ tên
2. Tìm một phần tên
3. Chọn nhóm
4. Tìm từ không có kết quả
5. Xóa từ tìm.

**Kết quả cần đối chiếu:** Kết quả đúng, có trạng thái rỗng; xóa tìm kiếm khôi phục danh sách.

**Bạn đánh giá nghiệp vụ:** Có cần tìm không dấu, lọc giá hoặc món nổi bật không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-024 — Hết món khác ngừng kinh doanh

**Vào đâu:** A → Thực đơn; G

**Chuẩn bị:** Dùng món UAT đã xem được.

1. Đặt tạm không có sẵn
2. G thử chọn/gửi
3. Mở lại
4. Ngừng món
5. G tải lại.

**Kết quả cần đối chiếu:** Không cho gửi món hiện không bán; đơn đã gửi trước đó vẫn còn lịch sử.

**Bạn đánh giá nghiệp vụ:** Muốn hiện món hết hàng với nhãn hay ẩn hoàn toàn? Ghi nhận lựa chọn.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-025 — Tắt danh mục có món trong giỏ

**Vào đâu:** G thêm món UAT vào giỏ chưa gửi; A

**Chuẩn bị:** Chụp trạng thái trước thay đổi.

1. A ngừng danh mục
2. G gửi giỏ cũ
3. Bật lại danh mục.

**Kết quả cần đối chiếu:** Backend không nhận món thuộc nhóm ngừng; thông báo cần dễ hiểu; không tạo đơn dở dang.

**Bạn đánh giá nghiệp vụ:** Có nên giữ dòng giỏ kèm cảnh báo hay tự bỏ món?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-026 — Tăng giá khi đang có giỏ

**Vào đâu:** G giỏ chưa gửi; A sửa món

**Chuẩn bị:** Giá ban đầu 55000.

1. G thêm 1 món
2. A đổi giá 65000
3. G gửi
4. Làm theo yêu cầu cập nhật/xác nhận giá mới.

**Kết quả cần đối chiếu:** Không âm thầm chốt giá khác mà người dùng không nhận biết; ghi rõ cách màn hình hiện xử lý. Giỏ không phải giá bán đã chốt.

**Bạn đánh giá nghiệp vụ:** Bạn muốn giữ giá lúc thêm giỏ hay giá lúc gửi? Đây là quyết định nghiệp vụ.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-027 — Tăng giá sau khi đã gửi

**Vào đâu:** G/S/K đã gửi món 55000; A

**Chuẩn bị:** Ghi mã lượt và số lượng.

1. A đổi tên/giá thành 65000
2. G/S xem lượt cũ
3. G gửi lượt mới cùng món.

**Kết quả cần đối chiếu:** Lượt cũ giữ tên/giá snapshot; lượt mới dùng giá mới; không sửa lịch sử tiền đã phát sinh.

**Bạn đánh giá nghiệp vụ:** Thông tin trên phiếu có làm rõ hai đơn giá nếu gọi ở hai thời điểm không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-028 — Ảnh thiếu hoặc URL lỗi

**Vào đâu:** A → sửa ảnh món thử; G mobile

**Chuẩn bị:** Lưu lại ảnh cũ để trả về.

1. Để trống ảnh hoặc dùng URL không tải được
2. G mở menu/chi tiết
3. Phục hồi ảnh.

**Kết quả cần đối chiếu:** Không vỡ bố cục hay mất nút chọn; có ảnh thay thế hoặc trạng thái hợp lý.

**Bạn đánh giá nghiệp vụ:** Tỷ lệ ảnh, chiều cao thẻ và tốc độ tải có vừa ý không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 04 · Khách vào bàn và giỏ chung

### UAT-029 — Tham gia bàn bằng tên khách

**Vào đâu:** G → link QR UAT-A

**Chuẩn bị:** Bàn/khu vực bật, QR hợp lệ.

1. Để tên trống thử tiếp tục
2. Nhập Khách UAT 1
3. Xem thực đơn.

**Kết quả cần đối chiếu:** Tên bắt buộc hợp lệ; hiện đúng bàn; không cần tài khoản nhân viên.

**Bạn đánh giá nghiệp vụ:** Có cần số người, số điện thoại hoặc xác nhận bàn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-030 — Hai khách cùng bàn

**Vào đâu:** G1 và G2 là hai hồ sơ riêng

**Chuẩn bị:** Cùng link QR, tên Khách UAT 1 và Khách UAT 2.

1. Mỗi người thêm một món riêng
2. Mở Giỏ món ở hai bên
3. Quan sát chủ dòng.

**Kết quả cần đối chiếu:** Cùng phiên bàn, dòng có chủ; không nhầm món của ai.

**Bạn đánh giá nghiệp vụ:** Khách có nên thấy toàn bộ giỏ hay chỉ giỏ riêng?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-031 — Không sửa/gửi hộ dòng khách khác

**Vào đâu:** G1/G2 → Giỏ món

**Chuẩn bị:** Mỗi khách có một dòng chưa gửi.

1. G1 tìm thao tác sửa/xóa dòng G2
2. G1 gửi các món của tôi
3. G2 xem giỏ.

**Kết quả cần đối chiếu:** G1 chỉ sửa/xóa/gửi phần của mình; dòng G2 chưa gửi vẫn còn.

**Bạn đánh giá nghiệp vụ:** Bạn có muốn trưởng bàn được gửi cả giỏ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-032 — Thêm, tăng, giảm, xóa và ghi chú

**Vào đâu:** G → chọn món → Giỏ món

**Chuẩn bị:** Dùng món có công thức và tồn.

1. Thêm 2 phần kèm ghi chú Không hành
2. Đổi số lượng
3. Xóa một dòng
4. Thêm lại.

**Kết quả cần đối chiếu:** Số lượng/tổng tiền cập nhật đúng; ghi chú đến phục vụ/bếp; không tự nhân đôi món.

**Bạn đánh giá nghiệp vụ:** Ghi chú có dễ nhập và nổi bật đủ cho bếp không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-033 — Số lượng biên và giỏ rỗng

**Vào đâu:** G → chọn món/giỏ

**Chuẩn bị:** Chưa gửi.

1. Thử 0, âm, số lẻ, lớn hơn giới hạn form
2. Xóa hết
3. Thử gửi giỏ trống.

**Kết quả cần đối chiếu:** Chặn dữ liệu sai; giỏ rỗng không tạo lượt gọi rỗng.

**Bạn đánh giá nghiệp vụ:** Giới hạn khách 20 phần mỗi lần chọn có phù hợp bàn đông không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-034 — Hai tab sửa cùng giỏ

**Vào đâu:** G1 mở hai tab cùng hồ sơ

**Chuẩn bị:** Cùng dòng giỏ, tab 2 chưa tải lại sau khi tab 1 sửa.

1. Tab 1 đổi số lượng
2. Ngay sau đó tab 2 đổi số lượng cũ
3. Tải lại cả hai.

**Kết quả cần đối chiếu:** Không mất cập nhật một cách im lặng; xung đột yêu cầu cập nhật lại dữ liệu.

**Bạn đánh giá nghiệp vụ:** Thông báo xung đột có khiến khách biết cần làm gì tiếp không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-035 — Nhấn gửi nhanh nhiều lần

**Vào đâu:** G → Giỏ món

**Chuẩn bị:** Một giỏ mới, ghi số món trước gửi.

1. Bấm gửi liên tiếp nhanh
2. Chờ
3. Mở Món đã gọi và S
4. Gọi món.

**Kết quả cần đối chiếu:** Một lần gửi logic không tạo đơn trùng hoặc trừ tồn hai lần; nút có trạng thái đang xử lý.

**Bạn đánh giá nghiệp vụ:** Phản hồi sau bấm có đủ nhanh/rõ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-036 — Tải lại và mở lại tab

**Vào đâu:** G đã tham gia, có giỏ/món

**Chuẩn bị:** Không xóa cookie.

1. F5
2. Đóng/mở lại link trên cùng hồ sơ
3. Xem giỏ/món.

**Kết quả cần đối chiếu:** Giữ đúng phiên còn hiệu lực và dữ liệu đã lưu; không tự tạo khách/đơn mới mỗi lần.

**Bạn đánh giá nghiệp vụ:** Bạn muốn khách đặt lại tên hoặc thoát phiên ở đâu?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-037 — Khách bàn khác không thấy dữ liệu

**Vào đâu:** G3 → QR UAT-B

**Chuẩn bị:** UAT-A đã có món/tiền.

1. G3 tham gia UAT-B
2. Mở giỏ, món đã gọi, thanh toán.

**Kết quả cần đối chiếu:** Không hiện đơn/tiền/hỗ trợ của UAT-A.

**Bạn đánh giá nghiệp vụ:** Tên bàn có đủ nổi bật để tránh khách quét nhầm?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 05 · Một bữa ăn hoàn chỉnh qua bốn vai trò

### UAT-038 — Lượt đầu cần duyệt

**Vào đâu:** G gửi 1 Cơm tấm sườn nướng; S → Gọi món

**Chuẩn bị:** Phiên mới chưa xác minh; bật duyệt lượt đầu ở A.

1. G gửi
2. S xem bàn cần chú ý
3. K kiểm tra bếp trước duyệt
4. S Duyệt gửi bếp.

**Kết quả cần đối chiếu:** G báo chờ duyệt; K chỉ nhận sau khi duyệt; một lượt không lặp.

**Bạn đánh giá nghiệp vụ:** Lượt đầu luôn chờ duyệt có làm chậm phục vụ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-039 — Bếp nhận và chế biến

**Vào đâu:** K → không gian bếp

**Chuẩn bị:** Lượt đã được duyệt.

1. Bấm Bếp nhận cả lượt
2. Kiểm tra món và ghi chú
3. Bắt đầu chế biến.

**Kết quả cần đối chiếu:** Trạng thái sang đã nhận rồi đang chế biến; bên G/S cập nhật; tồn tiêu hao đúng thời điểm.

**Bạn đánh giá nghiệp vụ:** Bếp cần nhận từng món hay cả lượt? Có cần ưu tiên món?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-040 — Món xong và mang ra bàn

**Vào đâu:** K/S/G

**Chuẩn bị:** Món đang chế biến.

1. K Món đã xong
2. S xem cảnh báo/món chờ mang
3. S Đã mang ra bàn
4. G xem lại.

**Kết quả cần đối chiếu:** Chỉ S xác nhận phục vụ; món chuyển đã phục vụ; báo chờ mang hết sau khi xử lý.

**Bạn đánh giá nghiệp vụ:** Có cần người mang món, thời gian chờ hoặc xác nhận một chạm tất cả không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-041 — Gọi thêm trong cùng bữa

**Vào đâu:** G/S → chi tiết bàn

**Chuẩn bị:** Đã có ít nhất một món được phục vụ.

1. G gửi thêm nước
2. S Gọi thêm món giúp khách gửi một món có ghi chú
3. K xử lý.

**Kết quả cần đối chiếu:** Cùng phiên nhưng các lượt phân biệt; tiền cộng đúng; không mất lượt trước.

**Bạn đánh giá nghiệp vụ:** Cách nhóm theo lượt hay theo món có phù hợp khi bàn gọi nhiều lần không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-042 — Xác minh khách tại bàn

**Vào đâu:** S → chi tiết bàn

**Chuẩn bị:** Phiên chưa xác minh.

1. Bấm Đã xác minh khách tại bàn
2. G gửi lượt nhỏ tiếp theo.

**Kết quả cần đối chiếu:** Trạng thái xác minh thay đổi; lượt tiếp theo đánh giá theo chính sách hiện tại, không mặc định bỏ mọi giới hạn.

**Bạn đánh giá nghiệp vụ:** Nhân viên xác minh cần nhập gì thêm hay một nút là đủ?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-043 — Nhận diện nhiều bàn cùng lúc

**Vào đâu:** S → Sơ đồ bàn/Gọi món; K

**Chuẩn bị:** Tạo đơn ở UAT-A và UAT-B, món giống nhau, ghi chú khác nhau.

1. K làm từng bàn
2. S tìm bàn theo mã và xem chi tiết
3. Đối chiếu G1/G3.

**Kết quả cần đối chiếu:** Không lẫn bàn, ghi chú, số lượng; nút xử lý tác động đúng dòng.

**Bạn đánh giá nghiệp vụ:** Tên bàn và giờ gọi đã đủ nổi bật để tránh mang nhầm không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 06 · Từ chối, hủy và bếp không thể phục vụ

### UAT-044 — Từ chối lượt chờ duyệt

**Vào đâu:** S → Gọi món → Từ chối lượt gọi

**Chuẩn bị:** Phiên thử mới có lượt PENDING_REVIEW.

1. Nhập lý do Khách xác nhận đặt nhầm
2. Từ chối
3. G xem
4. A kiểm tra tồn.

**Kết quả cần đối chiếu:** Không vào bếp; giải phóng phần giữ và không giữ khoản thu sai; lý do có thể tra được.

**Bạn đánh giá nghiệp vụ:** Khách có nên sửa lại đơn bị từ chối hay tạo lượt mới?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-045 — Khách hủy lượt trước bếp nhận

**Vào đâu:** G → Món đã gọi

**Chuẩn bị:** Lượt chờ duyệt/đã gửi, chưa được bếp nhận; G là chủ lượt.

1. Hủy lượt gọi này
2. Thử Hủy trong hộp xác nhận
3. Bấm lại và xác nhận.

**Kết quả cần đối chiếu:** Lần bỏ xác nhận không đổi dữ liệu; xác nhận hủy làm mất việc bếp tương ứng, giữ lịch sử.

**Bạn đánh giá nghiệp vụ:** Có nên cho hủy từng món thay vì cả lượt?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-046 — Phục vụ hủy trước chế biến

**Vào đâu:** S → Gọi món/chi tiết bàn

**Chuẩn bị:** Lượt đã gửi hoặc bếp đã nhận nhưng chưa bắt đầu nấu.

1. Mở Hủy lượt chưa chế biến
2. Nhập lý do
3. Xác nhận hủy.

**Kết quả cần đối chiếu:** Giải phóng giữ nguyên liệu; khoản phải thu được đảo; không còn món chờ làm.

**Bạn đánh giá nghiệp vụ:** Quyền hủy có cần quản trị duyệt không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-047 — Không hủy như món chưa nấu khi đã chế biến

**Vào đâu:** K/S/G

**Chuẩn bị:** K đã bấm Bắt đầu chế biến ít nhất một món.

1. G tìm hủy
2. S thử hủy lượt nếu nút cũ còn ở tab chưa tải
3. Tải lại.

**Kết quả cần đối chiếu:** Không cho lách trạng thái để xóa tiền/tồn như chưa chế biến; có báo lý do.

**Bạn đánh giá nghiệp vụ:** Nhà hàng cần quy trình hủy do khách đổi ý sau khi nấu? Ghi đề xuất riêng.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-048 — Bếp báo không thể làm trước chế biến

**Vào đâu:** K → món đã ACCEPTED → Hủy món

**Chuẩn bị:** Lượt có 2 món, chưa bắt đầu nấu món cần hủy.

1. Nhập lý do nguyên liệu không đạt
2. Xác nhận hủy món
3. Kiểm tra G/S
4. Tiếp tục món còn lại.

**Kết quả cần đối chiếu:** Món lỗi có trạng thái/lý do; món còn lại xử lý bình thường; tiền/tồn của phần không phục vụ được điều chỉnh.

**Bạn đánh giá nghiệp vụ:** Nhãn Hủy món có nên đổi thành Hết món/Không thể phục vụ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-049 — Bấm xử lý đồng thời

**Vào đâu:** K1 bep001/K2 bep002; hoặc S1/S2

**Chuẩn bị:** Hai người mở cùng lượt trước thao tác.

1. Cùng bấm nhận lượt hoặc phục vụ cùng một món
2. Tải lại.

**Kết quả cần đối chiếu:** Một chuyển trạng thái hợp lệ; không tiêu hao/trừ tiền hai lần; bên chậm nhận thông báo hoặc trạng thái mới.

**Bạn đánh giá nghiệp vụ:** Nhân viên có hiểu vì sao thao tác vừa bị từ chối không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 07 · Hỗ trợ, cảnh báo và giảm số lần bấm

### UAT-050 — Mỗi loại yêu cầu hỗ trợ

**Vào đâu:** G → Hỗ trợ; S → Việc cần làm

**Chuẩn bị:** Phiên đang hoạt động.

1. Lần lượt gửi hỗ trợ, nước, dụng cụ, tính tiền, khác với ghi chú riêng
2. S xem.

**Kết quả cần đối chiếu:** Đúng bàn/loại/nội dung; yêu cầu tính tiền ở đây là gọi hỗ trợ, không tự ghi giao dịch đã thu.

**Bạn đánh giá nghiệp vụ:** Các loại yêu cầu đã đúng nhu cầu nhà hàng chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-051 — Tiếp nhận rồi hoàn tất

**Vào đâu:** S → Việc cần làm hoặc chi tiết bàn

**Chuẩn bị:** Một yêu cầu mới.

1. Tôi tiếp nhận
2. Quan sát tên người xử lý
3. Tôi đã hỗ trợ xong
4. G kiểm tra.

**Kết quả cần đối chiếu:** G theo dõi trạng thái; yêu cầu hoàn tất rời danh sách việc mở; không cần đoán ngoài đời ai đang làm.

**Bạn đánh giá nghiệp vụ:** Có cần hiển thị thời gian chờ, cam kết phục vụ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-052 — Hai nhân viên nhận cùng yêu cầu

**Vào đâu:** S1 pv001 và S2 pv002

**Chuẩn bị:** Hai cửa sổ cùng thấy yêu cầu mới.

1. Cùng bấm Tôi tiếp nhận
2. Bên thua tải lại
3. Thử tìm nút hoàn tất hộ.

**Kết quả cần đối chiếu:** Chỉ một người nhận; người khác thấy đồng nghiệp đang xử lý, không hoàn tất hộ theo luồng hiện tại.

**Bạn đánh giá nghiệp vụ:** Có cần chuyển giao yêu cầu khi nhân viên hết ca không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-053 — Âm báo và cập nhật mới

**Vào đâu:** S → Bật âm báo; G

**Chuẩn bị:** Giữ tab S đang hiển thị và âm lượng bật.

1. Bật âm
2. G gửi hỗ trợ hoặc lượt mới
3. Đợi khoảng 3 giây
4. Xử lý
5. G gửi yêu cầu khác.

**Kết quả cần đối chiếu:** Thông báo/âm tương ứng thay đổi mới; không lặp vô hạn mỗi lần tải dữ liệu.

**Bạn đánh giá nghiệp vụ:** Âm có quá nhỏ, quá nhiều hoặc thiếu phân biệt mức ưu tiên không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-054 — Ẩn tab/khóa điện thoại

**Vào đâu:** S mobile; G gửi hỗ trợ

**Chuẩn bị:** Đã bật âm báo.

1. Đưa app xuống nền hoặc khóa máy
2. G gửi
3. Mở lại S và chờ cập nhật.

**Kết quả cần đối chiếu:** Hiện tại không có push nền; khi mở lại phải lấy được việc mới. Ghi nhận giới hạn, không coi có âm khi khóa là đã hỗ trợ.

**Bạn đánh giá nghiệp vụ:** Bạn có bắt buộc nhận thông báo khi tắt màn hình không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-055 — Lọc bàn cần xử lý

**Vào đâu:** S → Sơ đồ bàn

**Chuẩn bị:** Tạo ít nhất bàn chờ duyệt, bàn món xong, bàn chờ thu và bàn trống.

1. Chọn Cần xử lý
2. Tìm một bàn
3. Mở chi tiết và xử lý
4. Quay lại.

**Kết quả cần đối chiếu:** Tín hiệu đúng theo từng bàn; việc đã xong không còn báo sai; tìm kiếm không làm mất bàn vĩnh viễn.

**Bạn đánh giá nghiệp vụ:** Đếm số thao tác: bạn muốn rút bớt bước nào?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-056 — Xác nhận cảnh báo tài chính

**Vào đâu:** S → Việc cần làm

**Chuẩn bị:** Tạo cảnh báo bằng bài hoàn tiền/thiếu tiền bên dưới.

1. Xác nhận đã nhận cảnh báo
2. Xử lý nguyên nhân
3. Đã xử lý cảnh báo
4. Tải lại.

**Kết quả cần đối chiếu:** Phân biệt đã nhận và đã giải quyết; không chỉ ẩn cảnh báo mà bỏ sót tiền cần xử lý.

**Bạn đánh giá nghiệp vụ:** Thông tin hiện có đủ để nhân viên quyết định bước tiếp theo không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 08 · Thu tiền, chia lần và chống thu trùng

### UAT-057 — Tiền mặt và trả tiền thừa

**Vào đâu:** G → Thanh toán; S → chi tiết bàn

**Chuẩn bị:** Bữa ăn tổng 79000 (hoặc dùng tổng thực tế T), món đã phục vụ.

1. G yêu cầu CASH 79000
2. S nhập khách đưa 100000
3. Tôi đã nhận tiền
4. Xem phiếu.

**Kết quả cần đối chiếu:** Đã thu 79000, còn thiếu 0, tiền thừa 21000; không ghi doanh thu 100000.

**Bạn đánh giá nghiệp vụ:** Phiếu/nút xác nhận có đủ nhắc nhân viên đếm tiền chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-058 — Chia thành hai lần thanh toán

**Vào đâu:** G1/G2 hoặc S

**Chuẩn bị:** Tổng đúng 120000 bằng món thử đã có công thức/tồn; nếu khác dùng hai khoản cộng bằng tổng.

1. G1 yêu cầu 55000
2. S nhận
3. G2 yêu cầu 65000
4. S nhận
5. Xem các giao dịch.

**Kết quả cần đối chiếu:** Sau lần đầu còn 65000; cuối cùng còn 0; hai giao dịch, không phân bổ 120000 lặp cho từng món.

**Bạn đánh giá nghiệp vụ:** Bạn muốn chia theo số tiền hay chọn món/người? Hiện đây là chia tiền.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-059 — Nhân viên tạo yêu cầu thu hộ

**Vào đâu:** S → chi tiết → Lập yêu cầu thu tiền

**Chuẩn bị:** Bàn còn thiếu, chưa có yêu cầu giữ toàn bộ số dư.

1. Chọn hình thức và số tiền
2. Lưu
3. Xác nhận khi đã nhận tiền.

**Kết quả cần đối chiếu:** Tạo yêu cầu chưa làm tăng Đã thu; chỉ tăng khi xác nhận.

**Bạn đánh giá nghiệp vụ:** Hai bước lập rồi xác nhận có cần gộp cho tiền mặt không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-060 — Chuyển khoản thủ công

**Vào đâu:** G/S → Thanh toán

**Chuẩn bị:** Chỉ mô phỏng xác nhận, không chuyển tiền thật để test.

1. Tạo yêu cầu Chuyển khoản
2. Thử xác nhận thiếu mã giao dịch
3. Nhập UAT-BANK-001 và xác nhận.

**Kết quả cần đối chiếu:** Thiếu mã bị chặn; mã hợp lệ được lưu. Không có tự xác minh ngân hàng.

**Bạn đánh giá nghiệp vụ:** Bạn muốn người nào được quyền xác nhận chuyển khoản?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-061 — Số tiền không hợp lệ

**Vào đâu:** G/S → tạo yêu cầu

**Chuẩn bị:** Ghi số dư còn trả và khoản đang chờ.

1. Thử 0, âm, số lẻ, vượt số dư
2. Thử tiền mặt khách đưa ít hơn khoản xác nhận.

**Kết quả cần đối chiếu:** Không nhận số sai; không tăng Đã thu/giảm nợ khi thao tác bị từ chối.

**Bạn đánh giá nghiệp vụ:** Thông báo nêu được số tiền tối đa/tối thiểu chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-062 — Hai người cùng yêu cầu trả toàn bộ

**Vào đâu:** G1/G2 cùng bàn

**Chuẩn bị:** Tổng còn thiếu T, chưa có yêu cầu mở.

1. Hai người cùng gửi yêu cầu T
2. S xem danh sách
3. Hủy yêu cầu thử dư nếu có.

**Kết quả cần đối chiếu:** Tổng tiền được giữ cho yêu cầu chờ không vượt nợ; không thu hai lần toàn bộ.

**Bạn đánh giá nghiệp vụ:** Khi người khác đang trả, màn khách đã giải thích đủ rõ chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-063 — Hủy yêu cầu thu chưa nhận

**Vào đâu:** S → Thanh toán chờ xác nhận

**Chuẩn bị:** Có một yêu cầu mới, chưa xác nhận tiền.

1. Hủy yêu cầu thanh toán
2. G xem khoản chờ
3. Tạo yêu cầu mới.

**Kết quả cần đối chiếu:** Khoản chờ được giải phóng; Đã thu vẫn 0; có thể yêu cầu lại.

**Bạn đánh giá nghiệp vụ:** Có cần khách tự hủy yêu cầu do mình gửi không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-064 — Xác nhận cùng yêu cầu hai lần

**Vào đâu:** S1/S2 cùng chi tiết bàn

**Chuẩn bị:** Cùng thấy một yêu cầu chờ.

1. S1 xác nhận
2. S2 bấm nút cũ hoặc bấm nhanh hai lần
3. Tải lại.

**Kết quả cần đối chiếu:** Chỉ một giao dịch thành công, số tiền thu không nhân đôi.

**Bạn đánh giá nghiệp vụ:** Bên xác nhận chậm nhận thông báo đủ rõ chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-065 — Yêu cầu thu hết hạn

**Vào đâu:** S/G → yêu cầu chờ

**Chuẩn bị:** Tạo yêu cầu và ghi giờ. TTL đọc từ cấu hình/code nếu không hiện trên UI; không tự đổi giờ máy.

1. Để yêu cầu quá thời hạn
2. Tải lại
3. Thử xác nhận từ màn cũ
4. Tạo lại.

**Kết quả cần đối chiếu:** Yêu cầu hết hạn không được xác nhận như còn hiệu lực; số dư cho lần mới đúng. Nếu không biết TTL, đánh dấu Cần kỹ thuật hỗ trợ, không đoán.

**Bạn đánh giá nghiệp vụ:** Có cần đồng hồ đếm ngược và nút gia hạn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-066 — Thanh toán khi món chưa hoàn tất

**Vào đâu:** G/S

**Chuẩn bị:** Có món đang chế biến nhưng muốn trả sớm.

1. Thử tạo/thu khoản trả trước
2. Thử đóng phiên ngay
3. Hoàn tất món rồi đóng.

**Kết quả cần đối chiếu:** Thu tiền và hoàn tất phục vụ là hai việc; không đóng bình thường khi còn công việc món chưa xong.

**Bạn đánh giá nghiệp vụ:** Nhà hàng có muốn cấm thu sớm hoặc cho đóng sớm theo quyền riêng không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 09 · Hoàn tiền, thiếu tiền và phiếu chốt

### UAT-067 — Đã thu nhưng bếp không thể làm

**Vào đâu:** G/S/K; phiên riêng

**Chuẩn bị:** Một món 55000, đã thu đủ trước khi nấu; K mới nhận chưa chế biến.

1. K báo không thể chế biến
2. S mở bill
3. Thử đóng
4. Lập hồ sơ hoàn 55000 từ giao dịch gốc
5. Đã hoàn tiền cho khách.

**Kết quả cần đối chiếu:** Khoản phải thu đảo; phát sinh cần hoàn 55000; không đóng khi chưa hoàn; hoàn xong không tạo khoản thu âm sai.

**Bạn đánh giá nghiệp vụ:** Ai được duyệt hoàn? Có cần quản trị xác nhận trước khi thực chi?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-068 — Hoàn bằng chuyển khoản và giới hạn hoàn

**Vào đâu:** S → Lập hồ sơ hoàn tiền

**Chuẩn bị:** Dùng phiên khác có tiền cần hoàn, giao dịch gốc xác định.

1. Thử hoàn vượt tiền cần hoàn
2. Nhập đúng
3. Chọn chuyển khoản không mã rồi có mã
4. Bấm hoàn lại lần nữa.

**Kết quả cần đối chiếu:** Chặn vượt số tiền và thiếu mã; không hoàn hai lần cùng hồ sơ.

**Bạn đánh giá nghiệp vụ:** Có cần hoàn từng phần hoặc hủy hồ sơ hoàn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-069 — Khách rời đi thiếu tiền

**Vào đâu:** S → chi tiết → Khách rời đi khi còn thiếu tiền

**Chuẩn bị:** Bàn đã phục vụ, còn thiếu 55000; dùng phiên thử riêng.

1. Nhập lý do/diễn biến
2. Lập hồ sơ thiếu tiền
3. A mở Báo cáo & thanh toán
4. Xem hồ sơ.

**Kết quả cần đối chiếu:** Lưu đúng bàn, số thiếu, diễn biến; không tự đánh dấu đã thu đủ.

**Bạn đánh giá nghiệp vụ:** Phục vụ cần nút khẩn cấp hoặc gọi quản trị ngay không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-070 — Quản trị chốt tổn thất

**Vào đâu:** A → Báo cáo → hồ sơ thiếu tiền

**Chuẩn bị:** Đã làm bài trước; đây là bước chốt, dùng dữ liệu thử.

1. Nhập lý do xử lý
2. Đóng hồ sơ
3. S xem bàn/phiếu
4. A xem báo cáo.

**Kết quả cần đối chiếu:** Ghi tổn thất/đóng theo quy trình riêng, không biến khoản thiếu thành tiền khách đã trả; phiếu phân biệt.

**Bạn đánh giá nghiệp vụ:** Nút Đóng hồ sơ có cần ghi rõ Chấp nhận mất tiền để tránh hiểu nhầm không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-071 — Đóng phiên còn nợ/hoàn/công việc

**Vào đâu:** S → chi tiết bàn

**Chuẩn bị:** Thử lần lượt ở các phiên còn nợ, còn hoàn và còn món chưa xong.

1. Bấm Đóng phiên sau khi hoàn tất
2. Xác nhận
3. Đọc lý do
4. Giải quyết rồi thử lại.

**Kết quả cần đối chiếu:** Không đóng sai điều kiện. Mỗi lần bị chặn không mất phiên hoặc đơn.

**Bạn đánh giá nghiệp vụ:** Bạn có đồng ý các điều kiện chặn hiện tại không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-072 — Chốt phiên và dọn bàn

**Vào đâu:** S → chi tiết → Đóng phiên

**Chuẩn bị:** Món hoàn tất, tiền cân, không còn vướng mắc.

1. Đóng và xác nhận
2. Xem phiếu chốt
3. Đóng cửa sổ
4. Đã dọn xong.

**Kết quả cần đối chiếu:** Có mã phiếu/giờ ra; bàn chờ dọn rồi trống; không cho khách mới dùng lẫn phiên cũ.

**Bạn đánh giá nghiệp vụ:** Có cần phân biệt thu ngân đóng và phục vụ dọn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-073 — Kiểm tra từng trường trên phiếu

**Vào đâu:** S → Xem phiếu thanh toán

**Chuẩn bị:** Một phiếu tạm và một phiếu đã chốt.

1. Đối chiếu tên/địa chỉ, bàn, mã phiếu, giờ vào/ra, nhân viên, món, SL, giá, thành tiền
2. Cộng tay các dòng
3. Đối chiếu lần thu/hoàn/tiền thừa.

**Kết quả cần đối chiếu:** Tạm tính chưa có giờ ra thật; bản chốt có. Tổng tiền đúng; không in VAT/mã thuế giả. Đây là phiếu nội bộ.

**Bạn đánh giá nghiệp vụ:** Ghi rõ trường muốn thêm: số khách, ghi chú, số điện thoại, người thu từng lần…

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-074 — In và xem lại phiếu

**Vào đâu:** S → Phiếu đã chốt → Xem / in lại

**Chuẩn bị:** Có phiên vừa đóng.

1. Mở phiếu
2. In thông tin thanh toán
3. Xem trước bản in/PDF
4. Đóng và mở lại.

**Kết quả cần đối chiếu:** Chỉ phiếu, không nút/sidebar; chữ/số không cắt. Thiết kế 80mm cần kiểm tra thêm máy in thật; PDF không thay kiểm tra giấy.

**Bạn đánh giá nghiệp vụ:** Cỡ chữ, khoảng cách, logo/lời cảm ơn đã hợp nhà hàng chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-075 — Phiếu cũ không đổi khi sửa món

**Vào đâu:** A sửa tên/giá món; S mở phiếu đã chốt mới

**Chuẩn bị:** Lưu PDF/ảnh phiếu trước; dùng phiếu được chốt sau nâng cấp snapshot.

1. A sửa món
2. S mở lại phiếu
3. So sánh ảnh cũ.

**Kết quả cần đối chiếu:** Tên/giá/tổng/giờ của phiếu chốt không thay đổi. Phiếu đóng trước nâng cấp là dữ liệu cũ, không suy ra đã có snapshot.

**Bạn đánh giá nghiệp vụ:** Có cần tìm phiếu theo ngày, số phiếu, bàn hoặc xuất hàng loạt không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-076 — Khách cũ sau khi đóng và khách mới

**Vào đâu:** G cũ và G mới → cùng QR

**Chuẩn bị:** Bàn đã đóng và dọn; QR còn hiệu lực.

1. G cũ tải lại/thử gửi
2. G mới quét và tham gia
3. Xem giỏ/món.

**Kết quả cần đối chiếu:** G cũ không tiếp tục tác động phiên đóng; phiên mới không chứa đơn/tiền bữa trước.

**Bạn đánh giá nghiệp vụ:** Thông báo kết thúc bữa và lời mời quay lại đã phù hợp chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 10 · Chuyển bàn và cạnh tranh thao tác

### UAT-077 — Chuyển cả phiên đang phục vụ

**Vào đâu:** S → chi tiết UAT-A → Chuyển bàn & lịch sử

**Chuẩn bị:** UAT-A có giỏ, món và một lần thu; UAT-B trống.

1. Ghi tổng tiền/mã lượt
2. Chọn UAT-B, số khách 4, lý do
3. Lưu
4. S/G/K tải lại.

**Kết quả cần đối chiếu:** Giữ phiên/giỏ/món/tiền; bàn đích có khách, bàn cũ chờ dọn; lịch sử ghi người/giờ/lý do.

**Bạn đánh giá nghiệp vụ:** Khách có cần thông báo nổi bật khi chuyển bàn không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-078 — Không chuyển vào bàn không phù hợp

**Vào đâu:** S → Chuyển bàn

**Chuẩn bị:** Chuẩn bị bàn có khách, bàn ngừng và bàn sức chứa nhỏ.

1. Xem danh sách đích
2. Thử số khách vượt sức chứa bàn trống
3. Bỏ trống lý do.

**Kết quả cần đối chiếu:** Không chuyển vào bàn bận/ngừng hoặc không đủ chỗ; lỗi không làm mất bàn cũ.

**Bạn đánh giá nghiệp vụ:** Thực tế có cho vượt chỗ hoặc ghép bàn không? Hiện chưa gộp/tách phiên.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-079 — Hai phiên tranh một bàn trống

**Vào đâu:** S1 và S2

**Chuẩn bị:** Hai phiên nguồn khác nhau, cùng chọn một bàn đích trống.

1. Mở form cả hai trước
2. Cùng lưu chuyển
3. Tải lại.

**Kết quả cần đối chiếu:** Chỉ một phiên chiếm bàn đích; phiên thất bại ở nguyên nguồn; tiền/đơn không trộn.

**Bạn đánh giá nghiệp vụ:** Thông báo bàn vừa có người sử dụng có hướng dẫn chọn lại không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-080 — Theo dõi hỗ trợ/cảnh báo sau chuyển

**Vào đâu:** S/G

**Chuẩn bị:** Có hỗ trợ hoặc cảnh báo đang mở ở phiên nguồn.

1. Chuyển bàn
2. Mở Việc cần làm
3. Xử lý yêu cầu
4. Xem lịch sử chuyển.

**Kết quả cần đối chiếu:** Nhân viên được dẫn tới bàn hiện tại; lịch sử vẫn truy được nơi phát sinh; không mất yêu cầu.

**Bạn đánh giá nghiệp vụ:** Có cần hiển thị cả bàn cũ và mới ngay trên thẻ việc không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 11 · Kho, nhập hàng và công thức

### UAT-081 — Tạo dữ liệu nguyên liệu riêng

**Vào đâu:** A → Kho & công thức → Thiết lập nguyên liệu và kho

**Chuẩn bị:** Mã UAT-DV (COUNT), UAT-NL, UAT-KHO.

1. Thêm đơn vị
2. Thêm nguyên liệu dùng đơn vị đó
3. Thêm kho
4. Thử mã trùng.

**Kết quả cần đối chiếu:** Tạo đúng đơn vị/kho; mã trùng bị chặn; không lẫn với tồn món demo.

**Bạn đánh giá nghiệp vụ:** Có cần nhóm nguyên liệu, nhà cung cấp và hạn dùng? Hiện chưa đầy đủ.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-082 — Phiếu nhập nháp chưa tăng tồn

**Vào đâu:** A → Nhập kho hoặc cập nhật công thức

**Chuẩn bị:** Nguyên liệu UAT-NL, kho thử.

1. Thêm dòng số lượng 10 đơn giá 10000
2. Số phiếu UAT-NHAP-01
3. Lưu phiếu nhập nháp
4. Xem tồn.

**Kết quả cần đối chiếu:** Nháp chưa tăng hàng; tổng giá trị 100000; số phiếu nhận diện được.

**Bạn đánh giá nghiệp vụ:** Có cần xem/sửa từng dòng phiếu nháp trước duyệt không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-083 — Duyệt phiếu nhập một lần

**Vào đâu:** A → Phiếu nhập

**Chuẩn bị:** Phiếu nháp bài trước.

1. Duyệt nhập kho
2. Tải lại
3. Thử thao tác cũ lần nữa nếu còn tab cũ.

**Kết quả cần đối chiếu:** Hiện có tăng 10; không tăng 20 do duyệt lặp; phiếu chuyển đã nhập.

**Bạn đánh giá nghiệp vụ:** Có cần người duyệt khác người lập không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-084 — Nhập liệu kho không hợp lệ

**Vào đâu:** A → Lập phiếu nhập kho

**Chuẩn bị:** Dùng số phiếu mới.

1. Lưu chưa có dòng
2. Thêm cùng nguyên liệu hai lần
3. Nhập số lượng 0/âm
4. Thử số phiếu đã tồn tại.

**Kết quả cần đối chiếu:** Chặn phiếu rỗng/trùng dòng/số lượng sai/số phiếu trùng; không đổi tồn.

**Bạn đánh giá nghiệp vụ:** Đơn vị và số lẻ có dễ nhập đúng không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-085 — Công thức cho món thử

**Vào đâu:** A → Thay công thức món

**Chuẩn bị:** Món UAT 55000; nguyên liệu đã duyệt tồn 10.

1. Chọn UAT-NL số lượng 1, hao hụt 0
2. Món UAT, số phần tạo ra 1
3. Lưu phiên bản công thức mới.

**Kết quả cần đối chiếu:** Có công thức cho món; gửi món thử sử dụng đúng 1 đơn vị mỗi phần.

**Bạn đánh giá nghiệp vụ:** Có cần xem lịch sử công thức và so sánh phiên bản ngay trên giao diện không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-086 — Giữ rồi tiêu hao nguyên liệu

**Vào đâu:** G/S/K; A → Tồn kho

**Chuẩn bị:** Dùng món thử công thức 1, tồn 10; không có đơn khác dùng nguyên liệu thử.

1. G gửi 2 phần
2. A tải lại tồn
3. K nhận rồi Bắt đầu chế biến
4. A tải lại.

**Kết quả cần đối chiếu:** Sau gửi: hiện có 10, giữ 2, có thể dùng 8; sau bắt đầu: hiện có 8, giữ 0, có thể dùng 8. Nếu chờ duyệt, ghi thời điểm giữ thực tế theo hệ thống.

**Bạn đánh giá nghiệp vụ:** Bạn muốn trừ kho khi nhận đơn, nấu hay phục vụ?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-087 — Hủy trước nấu trả phần giữ

**Vào đâu:** G/S; A → Tồn kho

**Chuẩn bị:** Tồn 8, gửi mới 2 phần chưa nấu.

1. G/S hủy hợp lệ
2. A tải lại tồn.

**Kết quả cần đối chiếu:** Giữ trở về 0, hiện có vẫn 8; không cộng hàng đã tiêu hao từ lượt trước.

**Bạn đánh giá nghiệp vụ:** Có cần giải thích số Đang giữ ngay ở màn kho không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-088 — Không đủ tồn và gửi đồng thời

**Vào đâu:** G1/G2; món thử

**Chuẩn bị:** Tồn thử còn 1; nếu chưa có cách giảm qua UI, dùng các đơn thật thử để tiêu hao, không sửa SQL.

1. Hai phiên cùng gửi 1 phần
2. Xem kết quả/tồn.

**Kết quả cần đối chiếu:** Không bán vượt phần tồn khả dụng; một bên được chặn hoặc phải xử lý rõ. Không tự dùng nguyên liệu từ kho khác trái quy tắc.

**Bạn đánh giá nghiệp vụ:** Khi hết nguyên liệu, muốn tự ẩn món hay chỉ báo lúc gửi?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-089 — Đổi công thức và giá nhập giữ lịch sử

**Vào đâu:** A/K

**Chuẩn bị:** Đã có món chế biến với công thức/giá vốn cũ.

1. Nhập thêm nguyên liệu giá khác
2. Lưu công thức mới
3. Gửi/chế biến lượt mới
4. Xem báo cáo cũ và mới.

**Kết quả cần đối chiếu:** Giá vốn món đã tiêu hao không bị tính lại theo giá hiện tại; công thức mới áp dụng lượt phù hợp, không sửa lịch sử.

**Bạn đánh giá nghiệp vụ:** Cần màn giải thích giá vốn bình quân/phiên bản không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-090 — Món chưa có công thức

**Vào đâu:** A tạo món UAT-NOBOM; G

**Chuẩn bị:** Không tạo công thức cho món này.

1. Cho món xuất hiện
2. G gửi
3. Đọc thông báo và xem S/K/tồn.

**Kết quả cần đối chiếu:** Ghi chính xác cách hệ thống xử lý; không xem hiển thị trên menu là đã sẵn sàng bán. Nếu gửi bị chặn, không được tạo đơn dở dang.

**Bạn đánh giá nghiệp vụ:** Muốn cấm bật bán khi chưa có công thức hay cho món không quản lý kho?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 12 · Chính sách rủi ro và báo cáo

### UAT-091 — Ngưỡng cần duyệt

**Vào đâu:** A → Kiểm soát gọi món; G/S

**Chuẩn bị:** Chụp tất cả ngưỡng cũ; dùng món đủ tồn, phiên đã xác minh để tách ảnh hưởng lượt đầu.

1. Đặt ngưỡng số lượng cần duyệt thấp
2. G gửi quanh ngưỡng n−1, n, n+1 trên các lượt riêng
3. S xem.

**Kết quả cần đối chiếu:** Ghi ranh giới thực tế; lượt vượt ngưỡng phải chờ duyệt, không tự vào bếp; không nhầm với ngưỡng cứng.

**Bạn đánh giá nghiệp vụ:** Ngưỡng theo dòng/lượt/phiên đã phù hợp bàn đông chưa?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-092 — Giới hạn cứng và cấu hình sai

**Vào đâu:** A → Kiểm soát gọi món; G

**Chuẩn bị:** Giữ ngưỡng review không cao hơn hard limit.

1. Thử cấu hình review cao hơn tối đa
2. Gửi số lượng vượt hard nhưng trong giới hạn form, nếu không được dùng bài kỹ thuật
3. Trả ngưỡng về cũ.

**Kết quả cần đối chiếu:** Cấu hình mâu thuẫn/gửi vượt cứng bị chặn; không tạo khoản thu hay giữ kho thừa.

**Bạn đánh giá nghiệp vụ:** Có cần quản trị được cấp ngoại lệ cho tiệc đông người?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-093 — Từ chối/hết hạn chờ duyệt

**Vào đâu:** S/G

**Chuẩn bị:** Một lượt chờ duyệt; ghi thời điểm.

1. Thử từ chối có lý do; ở lượt khác chờ quá TTL thực tế rồi tải lại
2. Quan sát tiền/tồn.

**Kết quả cần đối chiếu:** Không duyệt một lượt đã hết hiệu lực; dọn tiền/giữ kho đúng. TTL không hiện thì đánh dấu cần kỹ thuật xác định.

**Bạn đánh giá nghiệp vụ:** Có cần đồng hồ chờ và nhắc nhân viên khi sắp hết hạn?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-094 — Đối chiếu doanh số với tiền thu

**Vào đâu:** A → Báo cáo

**Chuẩn bị:** Chụp báo cáo trước; tạo đúng một bữa thử đã phục vụ/thu tiền.

1. Ghi chênh lệch số lượng/doanh số/giá vốn
2. So với phiếu
3. Thử thêm một khoản hoàn hoặc thiếu tiền ở phiên khác.

**Kết quả cần đối chiếu:** Doanh số món đã phục vụ khác khái niệm tổng giao dịch đã thu; không mặc định báo cáo là hôm nay hoặc tiền ròng sau hoàn.

**Bạn đánh giá nghiệp vụ:** Bạn muốn lọc ngày/ca và tách thu, hoàn, tiền ròng, tổn thất không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-095 — Tổng quan và báo cáo cùng nguồn

**Vào đâu:** A → Tổng quan → các ô thống kê

**Chuẩn bị:** Không có thao tác mới giữa hai lần xem.

1. Ghi số bàn, nhân viên, doanh số, đã thu
2. Bấm lối tắt sang mục chi tiết
3. Đối chiếu.

**Kết quả cần đối chiếu:** Cùng phạm vi dữ liệu thì số phải khớp; số lịch sử không gắn nhãn hôm nay sai.

**Bạn đánh giá nghiệp vụ:** Ô nào quan trọng nhất cho chủ quán đầu/cuối ngày?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 13 · Ca làm, chấm công và lương

### UAT-096 — Tạo ca ngày/qua đêm

**Vào đâu:** A → Ca làm & lương → Lịch & chấm công → Tạo ca làm

**Chuẩn bị:** Dùng mã UAT-CA-01, ngày riêng không trùng seed.

1. Tạo 08:00–16:00 nghỉ 30
2. Tạo ca 22:00–06:00 ngày hôm sau
3. Thử giờ kết thúc trước bắt đầu.

**Kết quả cần đối chiếu:** Lưu ca hợp lệ theo giờ Việt Nam; chặn thời lượng sai, quá giới hạn 16 giờ và nghỉ ngoài 0–240 phút.

**Bạn đánh giá nghiệp vụ:** Bạn cần mẫu ca lặp tuần hay ca ngày cụ thể hiện tại đủ?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-097 — Phân công và lịch cá nhân

**Vào đâu:** A → Phân công nhân viên; S2 → Lịch làm & lương của tôi

**Chuẩn bị:** Dùng nhân viên UAT chưa có lịch hoặc ngày tương lai riêng.

1. Chọn ca, nhân viên, khu vực
2. Lưu
3. Nhân viên tải lại lịch.

**Kết quả cần đối chiếu:** Đúng người/ngày/giờ/khu vực; quản trị không nằm trong danh sách nhân viên được phân ca theo thiết kế hiện tại.

**Bạn đánh giá nghiệp vụ:** Phân khu vực chỉ là lịch; bạn có muốn giới hạn quyền phục vụ theo khu vực không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-098 — Chặn trùng ca

**Vào đâu:** A → Phân công

**Chuẩn bị:** Nhân viên có ca 08:00–16:00.

1. Gán lại cùng ca
2. Tạo/gán ca 15:00–18:00 cùng người
3. Gán cho người khác.

**Kết quả cần đối chiếu:** Chặn trùng cùng người; người khác có thể cùng làm; không tạo hai lịch trùng.

**Bạn đánh giá nghiệp vụ:** Có cần ca thay thế/đổi ca giữa hai nhân viên không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-099 — Hủy phân công

**Vào đâu:** A → lịch → Hủy phân công

**Chuẩn bị:** Một phân công tương lai chưa chấm công.

1. Nhập lý do và hủy
2. Nhân viên tải lại
3. Thử hủy bản đã có chấm công ở ca khác.

**Kết quả cần đối chiếu:** Lịch hủy được thể hiện; không cho xóa lịch sử công bằng hủy tùy tiện.

**Bạn đánh giá nghiệp vụ:** Có cần nhân viên xác nhận đã biết ca bị hủy không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-100 — Vào ca và ra ca thực tế

**Vào đâu:** S2 → Lịch làm & lương của tôi

**Chuẩn bị:** Tạo ca ngắn thử 5–10 phút bắt đầu gần giờ hiện tại, nghỉ 0; tránh ca seed trùng.

1. Trong thời gian cho phép bấm Vào ca
2. Tải lại
3. Cuối bài bấm Ra ca
4. Tải lại.

**Kết quả cần đối chiếu:** Giờ lấy từ máy chủ, lưu một lượt vào/ra; không cho vào sớm hơn 30 phút hoặc vào ca đã hết.

**Bạn đánh giá nghiệp vụ:** Có cần vị trí/Wi-Fi/chống chấm công hộ không? Hiện chưa bảo đảm điều đó.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-101 — Quên chấm công và duyệt 0 phút

**Vào đâu:** A → lịch → Duyệt giờ công

**Chuẩn bị:** Ca thử đã kết thúc; một nhân viên không chấm.

1. Nhập 0 phút và lý do Vắng ca thử
2. Lưu
3. Nhân viên xem lại.

**Kết quả cần đối chiếu:** Có bản duyệt 0, không tạo lương khống; vẫn giữ dữ liệu vào/ra gốc nếu đã có.

**Bạn đánh giá nghiệp vụ:** Có cần phân biệt nghỉ phép, vắng, quên chấm bằng trạng thái riêng không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-102 — Duyệt công hợp lệ và dữ liệu sai

**Vào đâu:** A → Duyệt giờ công

**Chuẩn bị:** Ca đã kết thúc, có đơn giá hiệu lực trước đầu ca.

1. Thử duyệt ca chưa kết thúc
2. Thử phút âm/quá giới hạn/thiếu lý do
3. Nhập 480 phút với lý do thử rõ ràng.

**Kết quả cần đối chiếu:** Chặn sai; bản hợp lệ giữ giờ gốc và số phút duyệt riêng; bản đã duyệt không tùy tiện sửa.

**Bạn đánh giá nghiệp vụ:** Quản trị được duyệt khác thời gian chấm có cần người thứ hai kiểm tra?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-103 — Đơn giá theo thời điểm

**Vào đâu:** A → Ca làm & lương → Đơn giá giờ

**Chuẩn bị:** Nhân viên thử riêng; thêm 35000/giờ có hiệu lực trước đầu ca và chưa có công duyệt liên quan.

1. Duyệt 480 phút
2. Thêm giá 40000 hiệu lực cho ca sau
3. Xem bản công/lương cũ.

**Kết quả cần đối chiếu:** Công cũ giữ 280000; giá mới không đổi khoản đã chốt; thay đổi hồi tố ảnh hưởng công duyệt bị chặn.

**Bạn đánh giá nghiệp vụ:** Bạn có cần lương tháng, tăng ca, phụ cấp theo ca? Hiện chỉ lương giờ cơ bản.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-104 — Tạo kỳ lương nháp

**Vào đâu:** A → Ca làm & lương → Bảng lương

**Chuẩn bị:** Chọn một ngày thử không có lịch seed chưa duyệt; duyệt hoặc hủy hợp lệ mọi phân công trong kỳ.

1. Từ ngày D đến trước D+1
2. Lưu
3. Xem bảng lương.

**Kết quả cần đối chiếu:** Chỉ công đủ điều kiện được đưa vào; còn công chưa duyệt phải được báo; không lập kỳ chồng nhau.

**Bạn đánh giá nghiệp vụ:** Cách nhập Đến trước ngày có khó hiểu? Muốn đổi sang Đến hết ngày?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-105 — Thưởng, khấu trừ và tính tay

**Vào đâu:** A → Chi tiết bảng lương nháp

**Chuẩn bị:** Một người có 480 phút × 35000 = 280000.

1. Thêm thưởng 20000
2. Thêm khấu trừ 10000 có lý do
3. Xem thực nhận
4. Thử khấu trừ vượt tổng.

**Kết quả cần đối chiếu:** Thực nhận 290000; số nhập dương nhưng loại khấu trừ làm giảm tổng; không chốt lương âm.

**Bạn đánh giá nghiệp vụ:** Có cần phân loại tiền ăn, chuyên cần và ứng lương riêng?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-106 — Xóa nháp rồi lập lại

**Vào đâu:** A → Bảng lương nháp

**Chuẩn bị:** Ghi thưởng/khấu trừ trước khi xóa.

1. Xóa bản nháp và xác nhận
2. Tạo lại cùng kỳ
3. So sánh.

**Kết quả cần đối chiếu:** Công đã duyệt còn; thưởng/khấu trừ nháp bị xóa như lời xác nhận, cần nhập lại; không nhân đôi công.

**Bạn đánh giá nghiệp vụ:** Có cần sửa từng khoản nháp thay vì xóa cả kỳ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-107 — Chốt lương và quyền riêng tư

**Vào đâu:** A + hai nhân viên thử

**Chuẩn bị:** Kỳ nháp đã kiểm tra số tiền.

1. Chốt bảng lương
2. Nhân viên mở lịch/lương
3. Người khác kiểm tra phiếu của mình
4. A tìm sửa bản chốt.

**Kết quả cần đối chiếu:** Nhân viên chỉ thấy phiếu mình sau chốt; bản chốt không sửa trực tiếp; không lộ lương đồng nghiệp.

**Bạn đánh giá nghiệp vụ:** Cần nhân viên xác nhận đã xem hoặc khiếu nại phiếu không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-108 — Ghi nhận đã trả lương

**Vào đâu:** A → kỳ đã chốt

**Chuẩn bị:** Đây là mô phỏng chi tiền, không chuyển ngân hàng thật.

1. Nhập chứng từ UAT-LUONG-001
2. Lưu đã chi
3. Nhân viên tải lại.

**Kết quả cần đối chiếu:** Kỳ chuyển đã ghi nhận chi, giữ chứng từ; không phát sinh chuyển tiền tự động.

**Bạn đánh giá nghiệp vụ:** Cần trả từng người/từng phần thay vì xác nhận toàn kỳ không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## 14 · Điện thoại, khả năng sử dụng và lỗi giao diện

### UAT-109 — Khách trên màn hình nhỏ

**Vào đâu:** G trên điện thoại hoặc DevTools 390px, thêm 320px

**Chuẩn bị:** Một phiên thử có món.

1. Đi hết Thực đơn, Giỏ món, Món đã gọi, Hỗ trợ, Thanh toán
2. Mở bàn phím
3. Xoay ngang/dọc.

**Kết quả cần đối chiếu:** Không cuộn ngang toàn trang, nút không bị bàn phím/nav che, tiền/tên dài không đè nhau.

**Bạn đánh giá nghiệp vụ:** Ghi màn nào chữ quá nhỏ/to, quá nhiều khoảng trống hoặc thao tác khó chạm.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-110 — Phục vụ thao tác một tay

**Vào đâu:** S mobile

**Chuẩn bị:** Có nhiều bàn và việc cần xử lý.

1. Dùng nav dưới
2. Lọc bàn
3. Mở chi tiết
4. Duyệt/thu tiền
5. Đóng bằng X
6. Cuộn danh sách.

**Kết quả cần đối chiếu:** Không cần phóng to để bấm; modal có lối thoát; nút quan trọng không bị nav che.

**Bạn đánh giá nghiệp vụ:** Đếm số lần bấm cho nhận hỗ trợ, phục vụ món, thu tiền; ghi mục tiêu mong muốn.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-111 — Menu quản trị thu gọn

**Vào đâu:** A laptop và mobile

**Chuẩn bị:** Không có form đang nhập dở.

1. Thu/mở menu trái
2. Chọn từng mục
3. Trên mobile mở menu rồi chọn mục
4. Dùng bàn phím Tab.

**Kết quả cần đối chiếu:** Biết mục đang chọn, biểu tượng có tên; mobile menu thu sau chọn, không che nội dung mãi.

**Bạn đánh giá nghiệp vụ:** Có mục nào cần đưa lên đầu hoặc đổi tên cho dễ hiểu không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-112 — Bếp với tên/ghi chú dài

**Vào đâu:** K laptop/mobile

**Chuẩn bị:** Đặt món ghi chú dài, nhiều món cùng lượt.

1. Xem danh sách chờ/đang làm/xong
2. Bấm xử lý
3. Đối chiếu bàn và ghi chú.

**Kết quả cần đối chiếu:** Thông tin không bị cắt đến mất ý; nút không nhảy khiến bấm nhầm món.

**Bạn đánh giá nghiệp vụ:** Có cần giao diện bếp toàn màn hình, chữ to hơn, sắp theo thời gian chờ?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-113 — Form và thông báo lỗi

**Vào đâu:** Mọi vai trò

**Chuẩn bị:** Mỗi form chọn một trường bắt buộc.

1. Để trống rồi lưu
2. Nhập sai
3. Sửa lại
4. Kiểm tra dữ liệu đã nhập còn không.

**Kết quả cần đối chiếu:** Lỗi gắn đúng vấn đề; không trắng trang, không mất toàn bộ form không cần thiết.

**Bạn đánh giá nghiệp vụ:** Lời báo lỗi có dùng từ kỹ thuật khó hiểu không? Ghi nguyên câu.

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-114 — Zoom, tên dài và số tiền lớn

**Vào đâu:** A/S/G trên desktop

**Chuẩn bị:** Dùng zoom trình duyệt 125% và 200%, dữ liệu thử tên dài.

1. Đi qua bảng tồn, lương, modal bill và menu
2. Cuộn vùng bảng nếu cần.

**Kết quả cần đối chiếu:** Không mất nút quan trọng; bảng rộng được cuộn trong vùng riêng; số tiền vẫn đọc được.

**Bạn đánh giá nghiệp vụ:** Phông/cỡ chữ có nhất quán giữa các vai trò không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-115 — Nút hủy/đóng hộp thoại

**Vào đâu:** A/S trên form và xác nhận

**Chuẩn bị:** Dữ liệu thử chưa chốt.

1. Mở hộp thoại
2. Bấm X/Escape/Hủy
3. Mở lại
4. Xác nhận một thao tác thực.

**Kết quả cần đối chiếu:** Bỏ xác nhận không đổi dữ liệu; đóng modal không làm kẹt cuộn trang hoặc mất khả năng bấm.

**Bạn đánh giá nghiệp vụ:** Có cần cảnh báo khi đóng form đang nhập dở?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

### UAT-116 — Điện thoại thật và Wi-Fi chậm

**Vào đâu:** G/S điện thoại cùng mạng

**Chuẩn bị:** Làm theo phần LAN; không dùng localhost trên điện thoại.

1. Quét QR thật
2. Thử bàn phím/camera
3. Đi qua chỗ sóng yếu
4. Thử lại sau khi mạng hồi.

**Kết quả cần đối chiếu:** Không tạo đơn/thu trùng vì bấm lại; khi mạng yếu không báo thành công giả. Ghi model máy/trình duyệt.

**Bạn đánh giá nghiệp vụ:** Thời gian chờ và phản hồi có đủ dùng trong giờ đông khách không?

**Kết quả của bạn:** Chưa thử.

**Ghi nhận thực tế / thay đổi mong muốn:** …

## Ranh giới bao phủ và phần cần kỹ thuật hỗ trợ

Danh sách bao phủ các màn hình và luồng nghiệp vụ hiện có, gồm đường thành công, từ chối, đồng thời, quyền và hiển thị. Không thể bảo đảm “mọi lỗi có thể xảy ra” chỉ bằng thao tác UI.

| Phần không có màn riêng | Cách kiểm chứng |
|---|---|
| Chống gửi trùng, phiên bản giỏ, phân bổ tiền, giữ/tiêu hao kho | Các ca bấm lặp/đồng thời và đối chiếu số tiền/tồn ở trên; backend test kiểm tra thêm |
| idempotency_record, outbox_event, audit log | Không thao tác trực tiếp các bảng. Nhờ kỹ thuật đối chiếu request/mã đơn khi có nghi vấn; chưa có màn quản lý hàng đợi |
| Cookie, CSRF, refresh, truy cập ID nhà hàng khác, sửa request thủ công | Cần kiểm thử API/kỹ thuật; kiểm tra UI không chứng minh bảo mật toàn diện |
| Hết hạn QR/đơn/yêu cầu thu | Dùng TTL thật, chờ hoặc môi trường kiểm thử riêng; nếu UI không hiện thời hạn thì ghi Bị chặn, không đổi đồng hồ máy |
| Hiệu năng nhiều bàn đồng thời, mất điện, phục hồi backup | Cần buổi kiểm thử tải và phục hồi riêng; không suy từ vài hồ sơ trình duyệt |
| AI, ngân hàng tự động, webhook nhà cung cấp thật | Chưa triển khai; không kiểm thử như tính năng đã có |
| Hóa đơn điện tử thuế, lương thuế/BHXH, tăng ca/ngày lễ | Ngoài phạm vi hiện tại; ghi yêu cầu tương lai riêng |
| Gộp/tách bàn có khách, chia tiền theo từng món, chuyển kho/kiểm kê/lô hạn dùng toàn diện | Không mặc định đã có; ghi đề xuất nghiệp vụ |

Kỹ thuật có thể chạy `pnpm check`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm demo:rehearse`, `pnpm build`. Đây là kiểm thử tự động bổ sung; không thay nhận xét của bạn về cách vận hành. API docs ở /api-docs: Execute gửi yêu cầu thật, không phải trang mô phỏng để bấm ngẫu nhiên.

## Phiếu phản hồi để gửi lại

Mã ca: UAT-…
Kết quả: Lỗi / Muốn đổi nghiệp vụ / Bị chặn
Thiết bị và trình duyệt:
Vai trò, tài khoản thử, bàn/lượt/phiếu:
Các bước tôi đã làm:
Hiện tại hệ thống làm:
Tôi muốn đổi thành:
Vì sao trong nhà hàng cần như vậy:
Quy tắc ngoại lệ/quyền cần có:
Ảnh minh họa và thời gian thử:
Ưu tiên P0/P1/P2/P3:

## Kết thúc một đợt thử

1. Xuất JSON và CSV từ HTML, cất cùng ảnh theo mã UAT. Kiểm tra mở được file xuất trước khi đóng trang.
2. Đếm ca đã thử, lỗi, muốn đổi, bị chặn và chưa thử. Không ghi “hệ thống đạt” nếu còn chưa thử/bị chặn ở luồng quan trọng.
3. Khôi phục giá/ngưỡng/trạng thái thử; hoàn tất các phiên bàn còn mở theo quy trình. Giữ nguyên chứng từ và lịch sử thử.
4. Gửi lại các mã ca cùng mô tả thực tế/mong muốn. Sau khi sửa, thử lại đúng ca và một luồng liên quan (ví dụ sửa hoàn tiền phải kiểm tra cả đóng phiên và phiếu).
