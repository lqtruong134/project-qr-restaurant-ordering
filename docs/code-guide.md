# Cách đọc và phát triển code dự án QR Restaurant

Phiên bản sau rà soát ngày 11/09/2026. Tài liệu dành cho người mới học code và người tiếp tục Sprint 2. Đây là hướng dẫn cấu trúc thực tế, không khẳng định hệ thống đã hoàn chỉnh để vận hành thương mại.

## 1. Đọc từ đâu trước?

Bạn không cần đọc mọi file cùng lúc. Hãy theo một hành động: người dùng nhập tài khoản, bấm đăng nhập, vào đúng không gian, rồi đăng xuất. Đọc các file theo luồng này sẽ dễ hiểu hơn đọc theo thứ tự thư mục.

1. `apps/web/app/login/page.tsx`: form đăng nhập và thông báo cho người dùng.
2. `apps/web/lib/api-client.ts`: gửi yêu cầu từ trình duyệt đến API.
3. `apps/web/next.config.ts`: chuyển `/api/*` đến Fastify.
4. `apps/api/src/server.ts`: đọc cấu hình, tạo database và ghép các chức năng backend.
5. `apps/api/src/modules/auth/index.ts`: kiểm tra tài khoản, lưu phiên và kiểm tra quyền.
6. `apps/api/src/modules/auth/session-cookies.ts`: tạo access token và đặt cookie.
7. `apps/api/src/modules/workspaces/routes.ts`: endpoint chứng minh quyền từng vai trò.
8. `tests/sprint1.integration.test.ts`: xem những điều hệ thống phải làm đúng.

Trong VS Code, bấm Ctrl+P và nhập đường dẫn tương đối ở trên. Bấm F12 tại tên hàm để đi đến định nghĩa, hoặc Ctrl+Shift+F để tìm nơi sử dụng. Các đường dẫn code trong tài liệu tính từ thư mục gốc repository.

## 2. Bản đồ hệ thống

Trình duyệt chạy giao diện Next.js ở cổng 3000. Yêu cầu `/api/...` được Next chuyển sang Fastify ở cổng 4000. Fastify kiểm tra quyền và truy cập PostgreSQL thông qua package database. PostgreSQL dự án được Docker đưa ra cổng 5433 trên máy để DBeaver có thể kết nối.

```text
Trình duyệt
  → Next.js: giao diện, điều hướng, chuyển tiếp /api
  → Fastify: xác thực, phân quyền, nghiệp vụ, transaction
  → packages/database: Prisma + PostgreSQL pool
  → PostgreSQL: dữ liệu, khóa ngoại, unique/check, trigger
```

Đây là một repository nhiều package, phục vụ một ứng dụng có web và API tách biệt. Với quy mô luận văn một người, cấu trúc này đủ rõ để mở rộng mà chưa cần microservices. “Chuẩn doanh nghiệp” không phải một cây thư mục cố định: điều quan trọng là ranh giới trách nhiệm, kiểm thử, khả năng truy vết và vận hành phù hợp.

## 3. Vai trò từng thư mục

| Đường dẫn | Trách nhiệm | Khi nào bạn mở? |
|---|---|---|
| apps/web/app | Các trang và bố cục Next.js | Sửa form, nội dung, điều hướng |
| apps/web/lib | Hàm dùng chung phía giao diện | Gửi API, xử lý refresh |
| apps/web/scripts | Chuẩn bị tài nguyên Swagger | Thay cách xuất tài liệu API |
| apps/api/src/server.ts | Khởi động và đóng dịch vụ | Sửa cách ghép module hoặc cấu hình |
| apps/api/src/app.ts | Fastify, health check, lỗi chung | Kiểm tra readiness và HTTP error |
| apps/api/src/modules/auth | Đăng nhập, phiên, bảo vệ route | Học xác thực và phân quyền |
| apps/api/src/modules/workspaces | API chứng minh quyền | Mẫu route bảo vệ đơn giản |
| apps/api/src/shared | Hàm dùng chung backend | Mẫu lỗi trả cho giao diện |
| packages/database | Prisma, migration, seed và kết nối | Xem cấu trúc và thao tác dữ liệu |
| packages/contracts | Kiểu dữ liệu chung hiện có | Xem contract health; bổ sung contract khi cần |
| packages/ui | Thành phần UI dùng chung hiện có | Tái sử dụng giao diện nhỏ |
| packages/config | Cấu hình TypeScript nền | Hiểu quy tắc kiểm tra kiểu |
| scripts | Lệnh vận hành và kiểm chứng | Chạy seed, ERD, rehearsal |
| tests/browser | Kiểm thử người dùng bằng trình duyệt | Đọc kịch bản demo |
| tests/*.integration.test.ts | Kiểm thử với PostgreSQL thật | Xem quyền và constraint được kiểm chứng |
| docs | Tài liệu kỹ thuật đi cùng commit | Đọc quyết định và hướng dẫn của phiên bản code |

## 4. Luồng đăng nhập, từng bước thực tế

Ở trang login, React dùng state `busy` để khóa nút khi đang gửi và state `error` để hiển thị thông báo. FormData lấy username/password từ form. Password chỉ được gửi trong yêu cầu, không ghi vào tài liệu hay log.

`postApi('/auth/login', body)` thêm header JSON và `X-CSRF-Protection: 1`. Trình duyệt gửi cookie theo cùng origin. Next chuyển request đến Fastify; backend vẫn là nơi quyết định quyền, không dựa vào việc giao diện ẩn hay hiện nút.

Trong module auth, hook `onRequest` kiểm tra Origin và header chống CSRF cho phương thức có thể thay đổi dữ liệu. Schema của route login từ chối payload sai định dạng và trường không được khai báo. Tên đăng nhập được chuẩn hóa chữ thường.

`login-limiter.ts` giới hạn số lần thử theo cả username và IP trong một phút. Hệ thống tìm user trong đúng nhà hàng và dùng Argon2id kiểm tra password hash. Khi tài khoản không tồn tại, vẫn kiểm tra với hash giả để giảm khác biệt xử lý giữa các trường hợp.

Nếu hợp lệ, backend tạo refresh token ngẫu nhiên, chỉ lưu hash của token vào `app_user`, đặt hạn tuyệt đối bảy ngày và tăng `auth_version`. Điều kiện update giúp tránh ghi đè một thay đổi phiên hoặc mật khẩu xảy ra đồng thời.

`session-cookies.ts` ký access JWT ngắn hạn 15 phút và đặt cookie access/refresh. Cookie là HttpOnly, SameSite Strict; bật Secure ở production. Frontend nhận thông tin vai trò và chuyển sang workspace tương ứng.

## 5. Kiểm tra quyền mỗi request

Hook `preHandler` đọc cấu hình của route. Route public được bỏ qua phần kiểm tra đăng nhập; các route khác phải có access token hợp lệ và user còn hoạt động, đúng nhà hàng, đúng `auth_version`, chưa hết phiên.

Quyền được đọc lại từ database, vì vậy thu hồi vai trò hoặc khóa tài khoản có hiệu lực với các request tiếp theo. Sau khi xác thực, backend gắn danh tính vào `request.identity`.

```ts
// Route chỉ cần đăng nhập:
config: { authenticated: true }

// Route yêu cầu một quyền cụ thể:
config: { permission: 'staff.workspace' }
```

Route không khai báo chính sách hợp lệ bị từ chối theo mặc định. Nếu khai báo đồng thời `authenticated` và `permission`, quyền cụ thể vẫn phải được kiểm tra. Đây là điểm đã bổ sung test trong lần rà soát này.

Hiện mỗi vai trò chỉ được không gian theo các quyền đã seed. Không tự hiểu Admin có mọi quyền chỉ vì tên vai trò là Admin. Các quyền nghiệp vụ mới phải được xác định theo SRS và thêm có chủ đích.

## 6. Refresh và logout

`getAuthenticated()` chỉ tự retry yêu cầu GET sau khi nhận 401 và refresh thành công. Nhiều GET trong cùng tab dùng chung một Promise refresh, tránh gửi nhiều lần đổi cùng một refresh token. Yêu cầu thay đổi dữ liệu không tự retry, vì tương lai có thể gây gửi món hoặc thanh toán trùng.

Backend đổi refresh bằng một câu UPDATE có điều kiện theo hash cũ. Hai yêu cầu dùng cùng token chỉ có một yêu cầu thắng. Logout xóa thông tin refresh trong database, tăng `auth_version` và xóa cookie.

Cơ chế chia sẻ Promise hiện chỉ trong một tab. Nhiều tab cùng refresh vẫn là trường hợp cần thiết kế thêm nếu sản phẩm yêu cầu. Hệ thống hiện cũng chỉ lưu một phiên đăng nhập hiện hành trên mỗi tài khoản; đây là giới hạn được giữ nguyên của Sprint 1.

## 7. Xem database và schema ở đâu?

`packages/database/prisma/schema.prisma` là schema hiện hành để Prisma đọc. `packages/database/prisma/migrations/202609100001_c0_c1/migration.sql` chứa DDL, constraint và trigger của 14 bảng. Những ràng buộc như “chỉ một QR ACTIVE” hoặc “chỉ một phiên đang mở trên bàn” phải xem SQL, không chỉ nhìn đường nối ORM.

`packages/database/src/seed.ts` chuẩn bị dữ liệu mẫu theo Sprint 1. `packages/database/src/index.ts` tạo connection pool, Prisma client, kiểm tra kết nối và đóng tài nguyên. Migration đã dùng không được sửa lại để che lịch sử; Sprint sau tạo migration mới.

Trong DBeaver, dùng kết nối PostgreSQL dự án tại `localhost:5433`, database `thesis_dev`. Mật khẩu lấy từ môi trường riêng đã thiết lập, không nằm trong tài liệu công khai này. Container cũ ở cổng 5432 là môi trường khác.

ERD CORE 45 bảng nằm trong kho tài liệu bên ngoài dự án. Nó phục vụ góp ý thiết kế; không copy file `CORE-45.prisma` đè lên schema hiện hành và không chạy migration từ file đó.

## 8. Swagger nằm ở đâu?

Mở `/api-docs` trên web local. Trang `apps/web/app/api-docs/page.tsx` hiển thị giao diện Swagger. `docs/openapi.yaml` là nguồn mô tả endpoint; `prepare-docs.mjs` tạo tài nguyên UI trước dev/build; `swagger-init.js` cấu hình gửi cookie và header cần thiết.

Tài nguyên sinh ra trong `apps/web/public/api-docs-assets` có thể tái tạo, không chỉnh trực tiếp. Khi thêm endpoint Sprint sau, cập nhật OpenAPI và test trước khi demo.

## 9. Những thay đổi trong lần rà soát 11/09

- Tách auth thành module với các file riêng cho kiểu dữ liệu, cookie/token và giới hạn đăng nhập. Route workspace được tách khỏi phần auth.
- Giữ `apps/api/src/auth.ts` làm đầu vào tương thích để caller/test cũ không phải đổi hàng loạt.
- Đưa lời gọi API frontend vào `apps/web/lib/api-client.ts`, thống nhất POST và chia sẻ refresh trong một tab.
- Xóa trạng thái workspace cũ khi chuyển area; tránh hiển thị thông tin của trang trước trong lúc tải trang mới.
- Quyền cụ thể luôn được thực thi dù route cũng đánh dấu authenticated.
- Giữ đúng lỗi HTTP 413/415 và các lỗi 4xx được framework cung cấp, không biến thành lỗi 500.
- Bổ sung Prettier, lệnh format/check và định dạng code để mỗi bước dễ đọc.
- Sửa thông báo thiết lập thành `pnpm run setup`, tránh nhầm với lệnh setup có sẵn của pnpm.
- Cập nhật phạm vi coverage để các file auth sau khi tách vẫn được đo.

Không thêm nghiệp vụ QR, Order, Payment, BOM hoặc bảng mới vào database.

## 10. Kiểm tra code trước khi push

```bash
pnpm format
pnpm check
pnpm db:up
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm check:secrets
```

`check` gồm kiểm tra định dạng, lint, TypeScript và unit test. `test:coverage` chạy nhóm test backend và integration; test nghiệp vụ chính tạo database test riêng rồi dọn database đó. Không thay thế test thực tế bằng tỷ lệ coverage.

Kết quả lần rà soát: 6 unit test đạt; nhóm coverage đạt 18 test, gồm 4 unit backend và 14 integration, coverage dòng backend 94,4%; E2E 5 đạt, 1 bỏ qua theo cấu hình Swagger mobile hiện có. Build, lint, TypeScript và secret scan cơ bản đạt. Đây là kiểm tra local, không tự suy ra CI trên GitHub đã thành công.

## 11. Cách bổ sung một chức năng Sprint 2

Ví dụ tiếp theo là quản trị menu, nhưng phải xác nhận item của Sprint trước khi triển khai. Trước hết đọc AC trong backlog, xác định ai được thao tác và dữ liệu nào thuộc nhà hàng.

1. Thêm module tương ứng dưới `apps/api/src/modules`, ví dụ `menu`. Ban đầu có thể dùng `routes.ts` và `schema.ts`; chỉ tách service khi logic nghiệp vụ đủ lớn, không tạo các lớp rỗng để có vẻ phức tạp.
2. Route khai báo validation và permission; đặt transaction trong phần xử lý nghiệp vụ khi cần nhiều thay đổi nguyên tử.
3. Truy vấn database trong đúng phạm vi nhà hàng; không tin restaurant_id hoặc user_id do trình duyệt gửi là bằng chứng quyền.
4. Thêm contract chia sẻ nếu nhiều phía sử dụng; TypeScript không thay thế kiểm tra payload runtime.
5. Thêm trang hoặc component ở web; gọi qua API client. Backend vẫn quyết định quyền cuối cùng.
6. Nếu cần đổi schema, tạo migration mới, seed tối thiểu, test constraint và cập nhật ERD vật lý.
7. Cập nhật OpenAPI, test allow/deny, validation và luồng chính bằng E2E. Chạy quality gate trước push.

Không tự thêm repository pattern, dependency injection framework, Redis hoặc queue nếu chưa có nhu cầu kiểm chứng được. Khi triển khai thanh toán/đơn hàng, cần thiết kế idempotency và transaction theo AC, không dựa vào retry chung của frontend.

## 12. Giới hạn còn lại cần nhớ

Đây là nền tảng local-first, một nhà hàng, một API process. Rate limiter đang nằm trong RAM; cần kho chia sẻ trước khi chạy nhiều instance. Chưa có audit nghiệp vụ đầy đủ, reset password, MFA hoặc quản lý đa phiên. Logging hiện tối giản và che credential; chưa phải hệ thống giám sát vận hành hoàn chỉnh.

`auth/index.ts` vẫn ghép các route auth của một module; việc tách tiếp query/service chỉ nên thực hiện khi có nhu cầu thay đổi hoặc kiểm thử rõ ràng. Các file cấu hình sinh tự động như `next-env.d.ts` có thể đổi giữa dev/build; không học bằng cách chỉnh những file đó.

## 13. Bài tập học trong 45 phút

Trong 10 phút đầu, mở login và api-client, tự nói lại form gửi dữ liệu đi đâu. Trong 15 phút tiếp, đọc login route, identity lookup và session-cookies, chỉ ra nơi password được kiểm tra và nơi cookie được tạo. Trong 10 phút sau, mở test quyền, đọc một trường hợp 200 và một trường hợp 403. Cuối cùng dùng Swagger thực hiện login → workspace đúng quyền → workspace sai quyền → logout, rồi đối chiếu với code.

Khi muốn thử sửa giao diện, chọn một dòng chữ nhỏ, chạy check và xem kết quả. Không bắt đầu bằng sửa migration, auth token hoặc logic tiền. Mục tiêu đầu tiên là truy được một hành động từ giao diện đến API, đến bảng dữ liệu và đến test chứng minh hành vi đó.
