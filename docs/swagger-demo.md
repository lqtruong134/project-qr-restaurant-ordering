# Hướng dẫn demo Sprint 1 bằng Swagger UI

Swagger UI đã được tích hợp vào dự án. Không cần cài Postman hay đăng ký tài khoản Swagger. Trang này gửi request đến API và database thật đang chạy trên máy.

## 1. Mở Swagger UI

Mở Docker Desktop, rồi mở terminal Ubuntu/WSL trong VS Code:

```bash
cd ~/projects/qr-ordering-thesis
pnpm db:up
pnpm dev
```

Nếu `pnpm dev` đã chạy thì không chạy thêm một bản nữa. Mở:

[Swagger UI của dự án](http://localhost:3000/api-docs)

Trang chủ cũng có nút **Demo API — Swagger UI**. Khi chuẩn bị demo hãy dùng một địa chỉ cố định `localhost:3000`; không đổi qua lại với `127.0.0.1:3000` vì cookie của hai hostname khác nhau.

## 2. Hiểu các nút và phần hiển thị

| Nội dung | Ý nghĩa |
|---|---|
| GET màu xanh | Đọc dữ liệu hoặc kiểm tra trạng thái |
| POST | Gửi thao tác như login, refresh, logout |
| Dòng đường dẫn API | Bấm để mở chi tiết API |
| Try it out | Bật chế độ nhập và gọi thử |
| Request body | Dữ liệu bạn gửi, thường là JSON |
| Execute | Gửi yêu cầu thật đến backend |
| Server response → Code | Mã kết quả thật: 200, 401, 403… |
| Response body | Nội dung backend trả về |
| Responses phía dưới | Các kết quả được mô tả trong tài liệu, không phải bằng chứng vừa gọi API |
| Cancel | Thoát chế độ thử API, không phải đăng xuất |

**Nhìn Server response để trình bày kết quả thật.** Danh sách 200/401/403 trong phần mô tả chỉ là hợp đồng API.

Cookie đăng nhập được trình duyệt giữ và gửi tự động. Không cần bấm Authorize hoặc dán token. Header `X-CSRF-Protection` đã có giá trị `1`; giữ nguyên. `Origin` do trình duyệt tự gửi.

## 3. Chuẩn bị tài khoản mẫu

Ba tên tài khoản: `staff`, `kitchen`, `admin`. Mật khẩu lấy từ file riêng đã giao:

```text
outputs/TAI-KHOAN-DEMO-RIENG-TU.txt (bản riêng đã giao trên máy)
```

Bạn cũng có thể xem `SEED_PASSWORD` trong `.env` ở thư mục gốc repository. Đây là mật khẩu website; không dùng `POSTGRES_PASSWORD` của DBeaver.

Ô JSON của Swagger hiển thị mật khẩu rõ khi nhập. Tạm dừng chia sẻ màn hình khi nhập, thực hiện login, rồi sửa ô mật khẩu thành `đã ẩn` mà **không bấm Execute lại**, hoặc thu gọn API login trước khi trình chiếu. Không lưu ảnh/trace chứa mật khẩu.

## 4. Kịch bản demo chính: chưa đăng nhập → đúng quyền → trái quyền

### Bước 1 — Chứng minh kết nối database

Trong nhóm **01. Kết nối**, mở `GET /health/ready` → Try it out → Execute.

Kỳ vọng Code **200**, body có `status: ok`, `database: connected`.

Bạn có thể nói: “API đang chạy và truy vấn được PostgreSQL thật.”

### Bước 2 — Đăng xuất để bắt đầu với phiên trống

Trong nhóm **02. Đăng nhập và phiên**, mở `POST /auth/logout` → Try it out → Execute. Giữ header chống CSRF bằng `1`.

Kỳ vọng **204**, không cần response body. Logout vẫn thành công nếu trước đó chưa đăng nhập.

### Bước 3 — Chứng minh người chưa đăng nhập bị chặn

Mở `GET /auth/me` → Try it out → Execute.

Kỳ vọng **401** cùng thông báo chưa có thông tin đăng nhập hợp lệ.

Bạn có thể nói: “Endpoint này được bảo vệ; chưa đăng nhập thì backend từ chối.”

### Bước 4 — Đăng nhập Staff

Mở `POST /auth/login` → Try it out. Trong Request body, thay mẫu bằng:

```json
{
  "username": "staff",
  "password": "THAY_BANG_MAT_KHAU_DEMO_TREN_MAY"
}
```

Thay đúng giá trị password, giữ dấu ngoặc kép và dấu phẩy. Bấm Execute.

Kỳ vọng **200**; body có `user.role` là `STAFF` và `permissions` có `staff.workspace`. Trình duyệt nhận cookie, bạn không cần sao chép nó.

Sau đó gọi lại `GET /auth/me`, kết quả chuyển từ **401 sang 200**. Đây là cách thể hiện rõ sự khác nhau trước và sau đăng nhập.

### Bước 5 — Staff gọi đúng chức năng được cấp

Trong nhóm **03. Phân quyền**, mở `GET /workspaces/{area}` → Try it out. Chọn `area = staff` → Execute.

Kỳ vọng **200**. Đây là endpoint kiểm tra quyền vào workspace, chưa phải chức năng vận hành POS.

### Bước 6 — Staff gọi chức năng Admin

Ở cùng API trên, đổi `area = admin` → Execute.

Kỳ vọng **403**, `errorCode: FORBIDDEN` và thông báo không có quyền.

Bạn có thể nói: “Tài khoản đã đăng nhập nhưng không có permission của Admin. Backend chặn quyền, không chỉ ẩn nút trên giao diện.”

### Bước 7 — Làm mới phiên

Mở `POST /auth/refresh` → Try it out → Execute.

Kỳ vọng **200**, body `status: ok`. Backend xoay vòng refresh cookie; trình duyệt nhận cookie mới tự động.

Việc token cũ không tái sử dụng được đã có integration test. Không cần lấy token rõ ra để chứng minh trước lớp.

### Bước 8 — Đăng xuất và kiểm tra đã thu hồi phiên

Gọi `POST /auth/logout` → **204**. Sau đó gọi lại `GET /auth/me` → **401**.

Bạn có thể nói: “Đăng xuất đã thu hồi phiên ở backend. Cookie cũ không giúp tiếp tục truy cập.”

## 5. Demo thêm Kitchen, Admin và mật khẩu sai

Đăng xuất rồi login bằng `kitchen`. Chọn workspace `kitchen` → 200; đổi sang `admin` → 403. Tiếp tục logout rồi login `admin`, workspace `admin` → 200.

Muốn demo mật khẩu sai, nhập một mật khẩu sai ở login: kỳ vọng 401 và thông báo chung. Không cố thử liên tiếp nhiều lần: giới hạn hiện là **5 lần/phút theo account và IP**, kể cả lần đăng nhập đúng. Nếu bị 429, đợi một phút rồi tiếp tục.

Một account có một phiên nội bộ đang hiệu lực. Đăng nhập ở trình duyệt khác hoặc chạy E2E có thể thay phiên demo. Website và Swagger trên cùng hostname dùng chung cookie; logout ở Swagger cũng đăng xuất phiên website đó.

## 6. Khi nào là lỗi, khi nào là kết quả demo đúng?

| Kết quả | Cách hiểu và xử lý |
|---|---|
| 200 khi đúng quyền | Thành công |
| 204 ở logout | Thành công, body rỗng là bình thường |
| 401 trước login/sau logout | Kết quả đúng của bài demo bảo vệ phiên |
| 403 Staff → Admin | Kết quả đúng của bài demo RBAC |
| 403 với CSRF_REJECTED ở login/logout | Mở Swagger đúng localhost:3000, giữ header = 1; kiểm tra APP_ORIGINS và restart khi sửa .env |
| 429 | Quá số lần login, chờ một phút |
| 400 | Kiểm tra JSON đúng cú pháp và đủ username/password |
| Failed to fetch hoặc lỗi kết nối | Kiểm tra pnpm dev/API/Docker đang chạy |
| Swagger trắng/404 | Dừng rồi chạy lại pnpm dev để sinh assets; không mở file HTML Swagger bằng file:// |
| Đã login nhưng vẫn 401 | Giữ cùng hostname; đăng nhập lại; tránh chạy test/demo đồng thời |

## 7. Những file mình đã thêm và sửa

Các đường dẫn dưới nằm trong `~/projects/qr-ordering-thesis`. Mở VS Code, Ctrl+P và dán đường dẫn tương đối.

| File | Vai trò |
|---|---|
| `apps/web/app/api-docs/page.tsx` | Trang /api-docs nhúng Swagger cùng nguồn |
| `apps/web/scripts/prepare-docs.mjs` | Đọc OpenAPI, bổ sung mô tả/ví dụ demo, chuẩn bị thư viện local |
| `apps/web/scripts/swagger-init.js` | Cấu hình Swagger, cookie, header CSRF; không gửi sang nguồn ngoài |
| `docs/openapi.yaml` | Nguồn hợp đồng API gốc |
| `apps/web/public/api-docs-assets/` | File được sinh khi dev/build, Git bỏ qua |
| `apps/web/package.json` | Cài swagger-ui-dist/yaml và chạy chuẩn bị docs trước dev/build |
| `apps/web/next.config.ts` | Cho phép iframe cùng nguồn, vẫn chặn nguồn khác |
| `tests/browser/swagger.spec.ts` | Test thao tác Execute thật và các mã 401/200/403/204 |

Không thêm bảng, không sửa cơ chế xác thực backend để bỏ qua bảo mật. Swagger là một cách khác để gửi request đến chính backend đó. Thư viện chạy local, không cần CDN khi demo. Bộ kiểm thử Swagger tương tác chính hiện chạy trên Chromium desktop.

## 8. Cách trình bày gọn với giảng viên

1. Website: đăng nhập và xem không gian theo vai trò.
2. Swagger: trình bày endpoint, input/output, 401 trước login, 200 đúng quyền và 403 trái quyền.
3. DBeaver: xem 14 bảng, truy vấn account–role–permission.
4. Mở `tests/sprint1.integration.test.ts` và báo cáo để chỉ ra các trường hợp khó như refresh đồng thời, thu hồi account và constraint.

Chỉ demo những API hiện có. Các API thêm/sửa/xóa bàn, món, đơn sẽ được bổ sung cùng Sprint tương ứng.
