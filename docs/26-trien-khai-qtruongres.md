# 26. Triển khai qtruongres trên laptop và chuyển sang VPS

## Review chuyển dư có giới hạn phạm vi — 18/10/2026

Nhánh `fix/payos-payment-flow` bổ sung sửa số dư theo allocation và ngân sách hoàn từng giao dịch. Trước triển khai phải review trường hợp hóa đơn 20.000đ, quote 10.000đ, thực nhận 12.000đ: còn thu 10.000đ, cần hoàn 2.000đ; admin chưa được đóng đối soát khi chưa có hoàn thật. Không tự chuyển 2.000đ vào món còn thiếu. Tiền đã nhận trước đây vẫn đọc từ sổ giao dịch; số dư phiên đang mở được tổng hợp lại, phiếu đã đóng giữ snapshot. Đợt bổ sung **không thêm migration** ngoài `202610170001_payment_system_resolution` đã có trên nhánh. [Nghiệp vụ](06-thanh-toan.md), [kiểm thử và giới hạn](15-doi-chieu.md).

Bước review này không truy cập production DB, không chạy giao dịch/provider thật, không sửa secret, không merge main hoặc deploy. Checklist operator bên dưới là hướng dẫn cho một đợt triển khai riêng, không phải lệnh đã thực hiện trong task này.

## Nâng cấp thanh toán production — 17/10/2026

Người vận hành đã cấu hình domain HTTPS, Named Tunnel và merchant production. Đợt audit này chỉ đọc log HTTP/tổng hợp trạng thái trong transaction READ ONLY, sửa mã và kiểm thử bằng provider giả. **Bản sửa chưa được deploy**, chưa áp migration lên database đang vận hành, chưa tự chuyển tiền hoặc gọi API payOS thật. Các kết quả dựng stack ở cuối bài là hồ sơ đợt chuẩn bị trước, không phải bằng chứng bản sửa mới đang chạy trên domain.

### Phạm vi cần cập nhật

Rebuild **API, web và maintenance image** để nhận mã mới và migration `202610170001_payment_system_resolution`. Caddy/Cloudflare/config merchant không cần đổi cho bản sửa này. CLI build chung vẫn build bốn image tuần tự, phần Caddy không đổi có thể dùng cache. Không thay AUTH_SECRET, RESTAURANT_ID, khóa payOS, callback đã đăng ký hoặc token tunnel. Không đăng ký webhook lại chỉ vì thay code.

Migration thứ **37 trong source** thay CHECK cũ yêu cầu mọi người hoàn tất là USER bằng kiểm tra USER/SYSTEM tường minh, giữ owner-state và chặn SQL NULL bỏ qua quyền người xử lý. Không thêm bảng/cột, không reset/seed hoặc sửa lịch sử. Script dừng nếu định nghĩa CHECK nguồn không đúng phiên bản đã biết; khi đó cần đọc lỗi riêng và rà lịch sử migration, không tự drop constraint để vượt lỗi. Chỉ chạy migration đúng một lần bằng Prisma deploy sau backup.

### Checklist deploy an toàn do operator thực hiện

1. Chọn thời gian ít giao dịch. Ghi lại image/phiên bản cũ, các khoản đang chờ, đối soát mở và kế hoạch bảo trì. Không lập thêm khoản thu trong lúc nâng cấp. Thông báo trước khoảng gián đoạn; Tunnel/webhook có thể tạm không truy cập được.
2. Hoàn tất review và công bố phiên bản mã nguồn theo quy trình Git trước. Task audit không tự commit/push hoặc nâng cấp dịch vụ đang live. Checkout đúng phiên bản đã nghiệm thu; không chạy `update` trên working tree chưa sạch.
3. Kiểm tra tệp production riêng vẫn đúng merchant/nhà hàng và không in nội dung. Giữ bản bí mật/AUTH_SECRET ở nơi riêng. Không nạp `.env` dev hoặc dùng lệnh seed để cập nhật production.
4. Dừng stack rồi tạo backup DB+tệp bằng CLI bên dưới. Kiểm tra manifest và giữ gói ở nơi riêng, ngoài Git/web. CLI backup không chứa env/token hạ tầng nhưng dump/chứng từ vẫn nhạy cảm.
5. Build image mới; áp migration có kiểm soát; nếu lỗi thì giữ app writers dừng và điều tra. Không reset, seed, sửa tay `_prisma_migrations` hoặc restore đè database.
6. Start rồi health; bật lại đúng connector đang dùng nếu lệnh stop đã dừng nó. Kiểm tra trang HTTPS, đăng nhập STAFF/GUEST và số dư trước khi tạo khoản thử.
7. Rà log đã khử bí mật: `RECEIVED → VERIFIED → MATCHED → RECORDED → ACCOUNT_UPDATED`, hoặc nhóm lỗi/busy/retry. Không công bố raw webhook, cookie hoặc thông tin ngân hàng.
8. Nghiệm thu khoản 5.000đ theo checklist dưới, gồm không bấm refresh ở luồng bình thường và không tăng tiền khi kiểm tra lại.
9. Rà riêng các khoản OPEN cũ. Không dùng kết quả unit/browser để đánh dấu một giao dịch thật đã thu hoặc đã hoàn.
10. Nếu cần quay phiên bản, giữ mã/DB tương thích và dùng kế hoạch phục hồi riêng. Không tự chạy image cũ lên schema vừa thay; không xóa volume hoặc restore đè để cứu nhanh.

Từ gốc checkout đã rà soát; tệp môi trường riêng được chỉ định rõ:

```bash
node scripts/deploy.mjs validate --env-file deploy/.env.production
node scripts/deploy.mjs stop --env-file deploy/.env.production
node scripts/deploy.mjs backup --env-file deploy/.env.production
node scripts/deploy.mjs build --env-file deploy/.env.production
node scripts/deploy.mjs migrate --env-file deploy/.env.production
node scripts/deploy.mjs start --env-file deploy/.env.production
node scripts/deploy.mjs health --env-file deploy/.env.production
docker compose --project-name qtruongres --env-file deploy/.env.production \
  -f compose.production.yaml --profile tunnel up -d cloudflared
```

Thay project/env path nếu triển khai thực tế dùng tên khác. Chỉ chạy tuần tự, không mở thêm terminal bảo trì cùng project. Lệnh cuối dùng token đã có, không tạo tunnel mới hoặc thay cấu hình Cloudflare. Không có lệnh nào ở block này đã được tự thực thi lên production trong đợt audit.

### Xử lý khoản đang đối soát từ phiên bản cũ

Audit chỉ đọc đã xác nhận một nhánh chặn tiền vì tài khoản nhận không khớp. Bản sửa đối chiếu chính xác cả primary và virtual account sau xác minh chữ ký, theo [FAQ payOS](https://payos.vn/docs/cau-hoi-thuong-gap/); **không bỏ kiểm tra tài khoản**, không suy ra mọi sai lệch đều là virtual account. Không gọi provider thật trong audit để đoán dữ liệu giao dịch hiện hành.

Sau deploy, mở **khoản cũ** và dùng Kiểm tra trạng thái làm phục hồi có chủ đích. HTTP409 nghĩa đang có worker giữ lease; HTTP503 kèm Retry-After: 3 nghĩa chưa đối chiếu được hoặc snapshot provider chưa đủ. Chờ rồi kiểm tra lại, không tạo link mới hay thu thêm bằng tiền mặt khi chưa rõ. Background có thể ghi đúng tiền sau khi xác minh, nhưng hồ sơ đối soát OPEN không tự đóng.

Admin đối chiếu dashboard/sao kê với số đã ghi sổ. Chỉ lưu RECONCILED khi provider đã kết thúc, ledger khớp số ngân hàng và khoản cần hoàn đã xử lý. Tiền đến sau phiên đóng phải đi luồng giữ riêng/hoàn bên ngoài; phiếu cũ không đổi. Không UPDATE status hoặc INSERT payment_transaction thủ công. Lưu hồ sơ không tự chuyển tiền hoàn.

### Checklist thử thật 5.000đ sau deploy

1. Chủ dự án chủ động chuẩn bị phiên riêng, số dư còn phải trả ít nhất 5.000đ và hai thiết bị STAFF/GUEST; có thể dùng 4G/5G cho khách. Nếu hóa đơn lớn hơn 5.000đ thì đây là thanh toán một phần, không kỳ vọng bàn đã trả đủ.
2. Khách báo nhân viên thu tiền; STAFF nhận đúng yêu cầu, tạo khoản ONLINE 5.000đ. Kiểm tra bàn/mã phiên, thời hạn và số tiền trên QR/link. Không bấm nút xác nhận tiền mặt cho khoản online.
3. Người thử tự chuyển đúng 5.000đ trên ứng dụng ngân hàng. Không bấm Kiểm tra trạng thái hoặc reload trong luồng bình thường. Khi backend xác minh được, chờ khoảng một nhịp đọc 3 giây ở tab đang mở; mạng/provider có thể làm lâu hơn.
4. STAFF/GUEST phải hiển thị đã nhận đúng 5.000đ, QR không còn để trả tiếp, tổng và số còn thiếu đúng. Yêu cầu gắn khoản thu tự hoàn tất; việc đóng bàn vẫn phụ thuộc checklist khác. Không đòi cả bàn hết nợ nếu chỉ trả một phần.
5. Chuyển tab đi rồi quay lại: tự tải số liệu mới. Thử nút Kiểm tra trạng thái sau thành công và tải lại trang: vẫn cùng khoản/mã, không thêm giao dịch 5.000đ lần nữa.
6. Đối chiếu sao kê/payOS với đúng một giao dịch ghi sổ và allocation. Không mô phỏng webhook thật bằng secret, không tự sửa số liệu hoặc dùng tiền thật cho test tự động.
7. Nếu chậm/lỗi/đối soát: dừng chuyển thêm, giữ khoản cũ và để operator kiểm tra. Nếu muốn hoàn khoản thử, làm đúng admin duyệt → nhân viên thực trả → xác nhận; đây là tiền thật, không chỉ bấm nút để coi là đã hoàn.
8. Giữ bằng chứng nghiệm thu riêng, che cookie/keys/PII/số tài khoản. Test tự động đã đạt không thay cho checklist kênh thật này.

### Trạng thái và các thao tác vẫn cần con người

Webhook chính thức + GET có chữ ký đi cùng một đường ghi sổ idempotent. `payment_intent` biểu diễn khoản thu/phạm vi/giữ chỗ; `payos_payment_request` là lifecycle provider; transaction/allocation và financial account mới là tiền đã ghi nhận. Tiền ngân hàng mới thấy nhưng chưa ghi sổ được tách rõ để không báo paid giả. Không tin return URL, ảnh chụp hoặc frontend gửi PAID.

Không có SSE/WebSocket subscriber cho trình duyệt hiện tại; outbox `pg_notify` chưa phải kết nối push tới khách. Bản sửa tái dùng snapshot polling: một scheduler chung, online chưa kết thúc 3 giây, GET có timeout 10 giây, backoff tối đa 30 giây, pause tab ẩn/offline, focus đọc lại và cleanup khi unmount. Khi online terminal, nhịp nhanh dừng; Guest vẫn đọc đơn/hỗ trợ 5 giây và bill đang mở 10 giây theo nghiệp vụ chung, phiên đóng dừng timer. UI không gọi provider hoặc tự POSTrefresh liên tục.

Hoàn tiền, tiền mặt/chuyển khoản thủ công, chuyển dư, tiền đến muộn, sai tham chiếu, hồ sơ đối soát và đóng bàn còn blocker đều cần người có quyền. **Chưa deploy bản sửa, chưa thử tiền thật**, không có cam kết realtime tức thời hoặc khả năng bỏ qua gián đoạn ngân hàng/mạng. [Kết quả kiểm thử](15-doi-chieu.md), [nghiệp vụ](06-thanh-toan.md), [thao tác tại bàn](25-thu-tien-tai-ban.md).


Bản hướng dẫn ngày **17/10/2026**. Đây là stack triển khai riêng; không thay `compose.yaml` hoặc `.env` phát triển. `qtruongres.example` chỉ là tên minh họa, chưa phải domain đã mua. Đọc [vận hành](12-van-hanh.md), [thanh toán](06-thanh-toan.md) và [biên bản kiểm tra](15-doi-chieu.md) trước khi dùng dữ liệu đang vận hành.

## Kiến trúc và giới hạn

```text
Trình duyệt / payOS
  → HTTPS qtruongres.<domain>
  → Cloudflare Named Tunnel do người vận hành quản lý
  → cloudflared (profile tunnel, kết nối đi ra ngoài)
  → Caddy :8080 trong Docker
       /api/* → Fastify :4000, bỏ đúng tiền tố /api
       /*     → Next.js :3000
  → Fastify → PostgreSQL :5432 trong mạng database riêng
```

Cùng Compose/Dockerfile dùng trên Windows + WSL2 hoặc Ubuntu VPS; khác nhau ở cấu hình, secrets, domain và dữ liệu. Không có nhánh nghiệp vụ riêng cho laptop. Laptop phải bật, Docker hoạt động và có Internet; sleep, tắt máy, mất mạng hoặc Docker dừng thì website ngừng. Đây không phải dịch vụ có cam kết thời gian hoạt động hoặc hệ thống dự phòng.

| Thành phần | Nơi chạy và quyền truy cập |
| --- | --- |
| Next.js, Fastify | Container không chạy root; không publish cổng host 3000/4000 |
| PostgreSQL 18.6 | Chỉ mạng Docker `database` có `internal: true`; không publish 5432 |
| Caddy | Chỉ bind `127.0.0.1:8088` mặc định; cổng host thay bằng `QTRUONGRES_CADDY_PORT` |
| cloudflared | Profile tùy chọn `tunnel`; không publish cổng host hoặc endpoint metrics 2000 |
| Ollama/model | Không có service, không cài đặt, không mở cổng 11434; AI vẫn OFF |

Caddy không tự quản TLS công khai trong cấu hình này; Cloudflare nhận HTTPS bên ngoài. API chỉ tin địa chỉ Caddy cụ thể; Caddy chỉ nhận thông tin client đáng tin từ địa chỉ connector đã cấu hình. Caddy dựng lại `X-Forwarded-For`/`X-Forwarded-Proto`, bỏ `Forwarded`, `X-Real-IP`, `CF-Connecting-IP` trước khi chuyển tiếp. Không bật `trustProxy=true` cho mọi nguồn. Scheme HTTPS chỉ gán cho peer cloudflared đã định trước; request kiểm tra trực tiếp localhost vẫn là HTTP. Khi có domain, phải bật chuyển hướng HTTPS ở Cloudflare trước khi đăng nhập hoặc nhận webhook.

`/api/payments/webhooks/payos` được chuyển thành `/payments/webhooks/payos` đúng route backend hiện có. Caddy giới hạn body 4MB; Fastify tiếp tục áp giới hạn nhỏ hơn theo route. Các header `nosniff`, `SAMEORIGIN`, `same-origin` được giữ; không coi những header này là toàn bộ bảo mật ứng dụng.

## 1. Chuẩn bị Windows, WSL và Docker

Dùng Docker Desktop ở chế độ Linux containers, backend WSL2 và bật tích hợp cho Ubuntu đang chứa repository. Cần Node 24 để chạy CLI; pnpm 12.3.4 cho kiểm tra/phát triển. Build container tự cài toolchain đã khai báo trong Dockerfile. Nên để source trên filesystem Linux của WSL, có đủ dung lượng cho image, volume, backup và bản khôi phục. Máy 16GB cần dành RAM hợp lý cho Docker, đóng ứng dụng nặng; CLI build lần lượt API → maintenance → web → Caddy để tránh chạy Next.js song song với build dependency.

Trong Ubuntu, kiểm tra trước:

```bash
node --version
docker version
docker compose version
```

Nếu Docker báo không có socket `/var/run/docker.sock` hoặc đường dẫn Docker Desktop `ubuntu.sock`, sửa **Docker Desktop → Settings → Resources → WSL Integration**, chọn đúng Ubuntu rồi khởi động lại WSL/Docker khi không có công việc cần giữ. Không mở Docker daemon qua TCP không xác thực để né lỗi socket. Không tự tắt WSL khi database/app đang chạy mà chưa dừng an toàn.

Trong đợt chuẩn bị này, Ubuntu từng thiếu socket Docker. Việc kiểm tra Windows dùng một bản source thử riêng và Node/Docker Windows là cách nghiệm thu thay thế, không chứng minh tích hợp WSL đã được sửa. CLI hỗ trợ `DOCKER_BIN` là một đường dẫn executable, không kèm flags; giữ các biến thư mục cài Windows cần để Docker tìm Compose. Ví dụ trong PowerShell có Node/Docker trên PATH:

```powershell
node scripts/deploy.mjs validate --env-file deploy/.env.production
```

Không chạy đồng thời hai bản checkout trỏ cùng project production. Bản rehearsal dùng `QTRUONGRES_PROJECT_NAME=qtruongres-rehearsal-20261016`, port/subnet riêng và dữ liệu thử; tên này giữ nguyên vì phiên nghiệm thu bắt đầu ngày 16/10. CLI chỉ chấp nhận `qtruongres` hoặc tên phụ giới hạn trong namespace `qtruongres-...`, không cho nhầm sang project dev `qr-ordering-thesis`.

## 2. Tạo cấu hình production riêng

Tại gốc repository, chỉ khi tệp production chưa tồn tại:

```bash
umask 077
cp -n deploy/.env.example deploy/.env.production
chmod 600 deploy/.env.production
```

Không sửa/copy đè `.env` phát triển. Dùng trình soạn thảo cục bộ để hoàn thiện tệp riêng; không gửi nội dung tệp vào chat, Git hoặc ảnh chụp. Trên Windows đặt ACL chỉ cho tài khoản vận hành; `chmod` trong WSL có ý nghĩa rõ hơn khi tệp nằm trên filesystem Linux.

| Nhóm | Biến và cách dùng |
| --- | --- |
| Cấu hình có thể công bố | `PUBLIC_APP_URL`, tên project, port proxy, subnet/IP proxy, tên image; URL mẫu phải thay bằng HTTPS origin thực khi mở Internet |
| Bí mật | `POSTGRES_PASSWORD`, `DATABASE_URL` có mật khẩu, `AUTH_SECRET`, khóa payOS, token tunnel; chỉ lưu cục bộ/kho bí mật riêng |
| Danh tính dữ liệu | `RESTAURANT_ID` phải đúng nhà hàng trong database sẽ restore; không chọn UUID mới khi nhập dữ liệu cũ |
| Mặc định giai đoạn này | `MENU_ASSISTANT_MODE=OFF`, `PAYOS_ENABLED=false`; khóa/callback payOS để trống tới bước cấu hình riêng |

Đối với dữ liệu cũ, **giữ nguyên AUTH_SECRET của nguồn** và chuyển nó riêng qua kênh bí mật. Khóa này còn mã hóa AES-GCM cho token QR trong database; tạo khóa mới chỉ vì đổi server sẽ làm mất khả năng giải mã QR cũ. Không đưa khóa vào gói backup dữ liệu. `RESTAURANT_ID` lấy từ cấu hình/nhà hàng nguồn đã kiểm tra.

Mật khẩu PostgreSQL cho server mới có thể tạo mới độc lập; cần ít nhất 32 ký tự ngẫu nhiên và phải khớp `DATABASE_URL`. Ví dụ dưới đây chỉ điền mật khẩu/URL vào **bản template mới chưa dùng để tạo volume**; không in giá trị ra terminal và không đổi AUTH_SECRET:

```bash
node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
const file = 'deploy/.env.production';
let text = await readFile(file, 'utf8');
const config = parseEnv(text);
if (!config.POSTGRES_PASSWORD?.startsWith('REPLACE_')) throw Error('Dừng: không tạo lại mật khẩu của cấu hình đã dùng.');
const password = randomBytes(32).toString('hex');
const url = new URL('postgresql://postgres:5432/');
url.username = config.POSTGRES_USER;
url.password = password;
url.pathname = '/' + config.POSTGRES_DB;
text = text.replace(/^POSTGRES_PASSWORD=.*$/m, 'POSTGRES_PASSWORD=' + password)
  .replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + url.href);
await writeFile(file, text, { mode: 0o600 });
console.log('Đã lưu mật khẩu/URL mới vào cấu hình riêng; không hiển thị giá trị.');
NODE
```

URL API trong container phải dùng hostname `postgres:5432`, không dùng localhost hoặc cổng dev 5433. Nếu nhập mật khẩu khác chứa ký tự đặc biệt, dùng URL encoding phù hợp. Không thay riêng biến POSTGRES_PASSWORD trên volume đã khởi tạo rồi kỳ vọng PostgreSQL tự đổi mật khẩu role.

```bash
node scripts/deploy.mjs validate
```

Lệnh kiểm tra môi trường và `docker compose config --quiet`, không in toàn bộ cấu hình đã nội suy. CLI không nhận `.env` dev, dùng giá trị tệp production thay cho biến ứng dụng/Compose kế thừa từ terminal. `--env-file /duong-dan/private.env` chọn tệp khác có chủ đích. `qtruongres.example` giúp chuẩn bị offline; nó chưa chứng minh DNS/HTTPS hoạt động.

## 3. Sao lưu dữ liệu nguồn trước lần chuyển đầu

Không gắn trực tiếp volume PostgreSQL dev vào project production. Tạo database/volume mới và nhập bản backup nhất quán. Trước khi xuất: dừng `pnpm dev` bằng Ctrl+C, đợi API/web thoát; không chạy seed, job dữ liệu hay người dùng khác ghi nguồn. Giữ container PostgreSQL nguồn hoạt động để dump. Ghi lại commit nguồn và các đường dẫn upload đã cấu hình.

Các lệnh bên dưới là **hướng dẫn người vận hành tự thực hiện**, không phải hành động đã chạy trên database thật trong task này. Ví dụ dành cho dev compose hiện hành, project `qr-ordering-thesis`. Nó đọc `.env` nguồn cục bộ để chọn đúng database/path nhưng không sửa hoặc in bí mật. Cần đầy đủ dependency phát triển và Node 24. Chọn thư mục mới, đủ chỗ trống; nếu tên đã tồn tại thì đổi tên, không ghi đè.

```bash
umask 077
mkdir -p var/backups/qtruongres
chmod 700 var/backups/qtruongres
node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import { createWriteStream, openSync, closeSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { backupRuntimeFiles, validateRuntimeArchive } from './deploy/runtime-files.mjs';
import { hashFile } from './scripts/deploy.mjs';
const source = parseEnv(await readFile('.env', 'utf8'));
const destination = resolve('var/backups/qtruongres/import-from-dev-20261017');
await mkdir(destination, { recursive: false, mode: 0o700 });
const databaseFile = join(destination, 'database.dump');
const descriptor = openSync(databaseFile, 'wx', 0o600);
try {
  const dump = spawnSync(process.env.DOCKER_BIN || 'docker', [
    'compose', '--project-name', 'qr-ordering-thesis', '--env-file', '.env', '-f', 'compose.yaml',
    'exec', '-T', 'postgres', 'pg_dump', '--no-password', '--username', source.POSTGRES_USER,
    '--dbname', source.POSTGRES_DB, '--format=custom', '--no-owner', '--no-privileges',
  ], { env: { ...process.env, ...source }, stdio: ['ignore', descriptor, 'inherit'] });
  if (dump.error || dump.status !== 0) throw Error('Dump chưa hoàn tất; không restore thư mục này.');
} finally { closeSync(descriptor); }
const staging = join(destination, 'runtime-source');
await mkdir(staging, { mode: 0o700 });
const roots = {
  'menu-images': resolve(source.MENU_UPLOAD_DIR || 'var/menu-images'),
  'payment-proofs': resolve('apps/api', source.PAYMENT_PROOF_DIR || '../../var/payment-proofs'),
};
for (const [name, path] of Object.entries(roots)) {
  try { await stat(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(join(staging, name), { mode: 0o700 }); continue; }
  await cp(path, join(staging, name), { recursive: true, dereference: false, force: false, errorOnExist: true });
}
const runtimeFile = join(destination, 'runtime-files.jsonl');
const output = createWriteStream(runtimeFile, { flags: 'wx', mode: 0o600 });
try { await backupRuntimeFiles(staging, output); output.end(); await once(output, 'finish'); }
catch (error) { output.destroy(); throw error; }
await validateRuntimeArchive(runtimeFile);
const version = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (version.status !== 0) throw Error('Không xác định được commit nguồn.');
const manifest = {
  format: 'qtruongres-backup-v1', project: 'qtruongres', sourceProject: 'qr-ordering-thesis',
  postgresMajor: 18, createdAt: new Date().toISOString(), gitCommit: version.stdout.trim(),
  files: { 'database.dump': await hashFile(databaseFile), 'runtime-files.jsonl': await hashFile(runtimeFile) },
};
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Đã tạo gói backup riêng. Không chia sẻ gói này hoặc AUTH_SECRET.');
NODE
```

Tạo trước thư mục cha riêng nếu chưa có: `mkdir -p var/backups/qtruongres`, quyền 700. Kiểm tra source path nếu môi trường dev dùng working directory khác `apps/api`; PAYMENT_PROOF_DIR tương đối phụ thuộc working directory, MENU_UPLOAD_DIR tương đối tính từ gốc repo. Không tự bỏ qua thư mục ảnh đã tồn tại mà không đọc được. Thư mục `runtime-source` là bản copy riêng giúp chuẩn hóa hai store; vẫn chứa dữ liệu nhạy cảm và không cần chuyển khi đã có hai payload/manifest hợp lệ. Gói chưa có manifest hoàn tất là gói chưa được chấp nhận.

Dump chỉ chọn database ứng dụng, không dùng `pg_dumpall` để xuất role/password hạ tầng. Tuy nhiên dump vẫn có password hash, credential hash, thông tin khách, lương và thanh toán; ảnh chứng từ cũng riêng tư. **Không thể gọi backup này là không chứa dữ liệu nhạy cảm.** Không đưa nó vào Git/public, email công khai hoặc bộ dữ liệu AI; bảo vệ thiết bị lưu, cân nhắc mã hóa ổ/gói bằng công cụ được quản lý riêng và giữ một bản ngoài laptop.

## 4. Build và chuẩn bị production

Caddy dùng image riêng `qtruongres-caddy:local`, build từ bản chính thức `caddy:2.11.7-alpine` đã ghim digest trong Compose và `deploy/Dockerfile.caddy`. Binary của image chính thức có file capability `cap_net_bind_service` cho cổng thấp 80/443; stack này chỉ nghe 8080 nên bước build xóa capability đó bằng `setcap -r`. Cách này tránh lỗi thực thi binary khi chạy UID 1000 cùng `cap_drop: ALL`, đồng thời giữ `no-new-privileges` và filesystem chỉ đọc. Không cần cấp thêm quyền bind cổng thấp. Khi nâng phiên bản, đổi `QTRUONGRES_CADDY_BASE_IMAGE` sang digest đã kiểm tra rồi build lại; `QTRUONGRES_CADDY_IMAGE` là tên image kết quả riêng của dự án, không đặt thành tag upstream. Nguồn đối chiếu: [Dockerfile Caddy chính thức](https://github.com/caddyserver/caddy-docker/blob/master/2.11/alpine/Dockerfile).

Sau khi `validate` đạt:

```bash
node scripts/deploy.mjs build
```

CLI build tuần tự bốn image. API runtime cài dependency production và Prisma Client đã sinh, chạy UID/GID 10001, không chạy migrate/seed lúc khởi động. Next.js dùng production standalone; không chạy `next dev`. Maintenance image là công cụ quản trị có chủ đích, không phải service tự khởi chạy. Migration gọi Prisma CLI trực tiếp bằng Node; không chạy package manager trong container production để tránh pnpm tự thay đổi dependency theo NODE_ENV.

**Nếu chuyển dữ liệu cũ**, restore vào đích trống trước khi migrate:

```bash
node scripts/deploy.mjs restore --from var/backups/qtruongres/import-from-dev-20261017
node scripts/deploy.mjs migrate
node scripts/deploy.mjs start
```

Restore tự khởi động riêng PostgreSQL production nếu cần, kiểm tra database chưa có user object và hai store trống. Nó nạp `_prisma_migrations` cùng dữ liệu nguồn; sau đó migrate deploy chỉ áp migration mới còn thiếu. Không migrate trước rồi restore vào database đã có bảng.

Nếu đã có production vận hành thì dùng quy trình update, không restore đè. Nếu cần một nhà hàng hoàn toàn mới, task này chưa cung cấp service seed production tự động; cần kế hoạch bootstrap được duyệt riêng. Không chạy seed thông qua service migrate hiện tại vì service đó không gắn volume file runtime. Không dùng seed để thay thế dữ liệu cũ.

## 5. Kiểm tra local trước Internet

```bash
node scripts/deploy.mjs status
node scripts/deploy.mjs health
```

Health kiểm tra PostgreSQL bằng truy vấn thật, trang web HTTP 200, API live/ready qua Caddy. `/health/ready` phải kết nối được database; process đang chạy không đủ để coi ready. Local health không chứng minh schema, dữ liệu nhập đúng, đăng nhập HTTPS, DNS hay webhook đã nghiệm thu. Kiểm tra thêm đúng số liệu/ảnh và đăng nhập trên public HTTPS ở bước sau.

Mở `http://127.0.0.1:8088` để xem trang và kiểm tra đường đi proxy; thay port nếu cấu hình khác. Cookie production có cờ Secure, nên localhost HTTP chỉ phục vụ kiểm tra hạ tầng; không tắt Secure cookie để thử đăng nhập. Không public cổng 3000/4000/5432. Trường hợp app unhealthy, xem logs trước khi mở tunnel.

## 6. Chuẩn bị Cloudflare Named Tunnel

Đây là bước thủ công sau khi có tài khoản/domain. Task không đăng nhập Cloudflare, không tạo tunnel thật, không yêu cầu token. Dùng **remotely managed Named Tunnel**, tên dễ nhớ `qtruongres`; không dùng Quick Tunnel làm cấu hình cuối. Trong dashboard Cloudflare One chọn tạo tunnel Cloudflared, ghi nhận cấu hình ở tài khoản của chủ dự án theo [hướng dẫn chính thức](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).

Tạo nơi chứa token riêng, rồi dùng editor cục bộ đặt token connector vào file; không dán token vào command line/history:

```bash
umask 077
mkdir -p var/deploy
chmod 700 var/deploy
# Chỉ tạo tệp mới; nếu đã có token thì giữ nguyên và mở bằng editor riêng.
( set -o noclobber; : > var/deploy/cloudflared-token )
chmod 600 var/deploy/cloudflared-token
```

`CLOUDFLARED_TOKEN_FILE` trỏ tới file này; `QTRUONGRES_TUNNEL_UID/GID` phải khớp chủ sở hữu cho container đọc được. Mặc định 1000:1000 phù hợp nhiều tài khoản Ubuntu, không áp dụng mù quáng: kiểm tra `id -u`, `id -g`. Không mở quyền 777 để sửa lỗi đọc token. Cấu hình connector mẫu nằm ở `deploy/cloudflared/config.example.yml`, không chứa ingress domain/UUID/token vì route được quản lý trên dashboard. Secret được gắn read-only, sử dụng `--token-file`; [tham số cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).

## 7. Gắn domain và bật connector

Sau khi domain thuộc tài khoản Cloudflare được cấu hình đúng, tạo published application route:

| Trường | Giá trị |
| --- | --- |
| Public hostname | `qtruongres.<domain-cua-ban>`; không gõ nguyên dấu ngoặc |
| Service type | HTTP |
| Service URL | `http://caddy:8080` |
| Hostname không khai báo | Giữ từ chối, không thêm wildcard tới các service khác |

Trong container cloudflared, `localhost:8088` trỏ về chính connector, **không phải** Caddy. Bản này dùng connector trong Docker và địa chỉ cố định của nó để giới hạn header tin cậy; không tự đổi sang cloudflared host nếu chưa điều chỉnh lại boundary proxy.

Đổi `PUBLIC_APP_URL` trong production env thành HTTPS origin thật; mặc định APP_ORIGINS lấy origin này. Giữ `PAYOS_ENABLED=false`. Chạy lại validate và tạo lại app container để cập nhật environment:

```bash
node scripts/deploy.mjs validate
node scripts/deploy.mjs start
```

Trong terminal sạch, không export biến ứng dụng/COMPOSE khác ghi đè file production, bật riêng profile đã có token:

```bash
docker compose --project-name qtruongres --env-file deploy/.env.production \
  -f compose.production.yaml --profile tunnel up -d cloudflared
```

Nếu dùng project phụ, thay `--project-name` bằng đúng QTRUONGRES_PROJECT_NAME. Không có token thì không bật profile này. Không chạy `docker compose config` không có `--quiet` rồi công bố output vì cấu hình nội suy có thể chứa mật khẩu.

Bật chuyển hướng public HTTP sang HTTPS trong Cloudflare, kiểm tra chứng chỉ và connector healthy. Tunnel tạo kết nối đi ra; không cần port forwarding router hoặc public PostgreSQL. Chưa có domain/token thì chỉ dừng ở chuẩn bị local, không khẳng định website đã public.

## 8. Nghiệm thu bằng điện thoại 4G/5G

Tắt Wi-Fi trên điện thoại, mở HTTPS domain thật. Kiểm tra trang/ảnh thực đơn, đăng nhập nội bộ, QR đúng host mới, guest nhập tên/chính sách, menu/state và các vai trò được phép. QR đã in bằng host localhost/LAN cần xuất hoặc in lại URL public; token bàn đang dùng không cần tự ý đổi chỉ vì chuyển host.

Kiểm tra phiên/cookie Secure, lỗi 401/403 đúng tình huống, CSRF/Origin và không rò dữ liệu nội bộ. Dùng dữ liệu thử có chủ đích; không coi truy cập được trang chủ là nghiệm thu đơn/tiền/kho. Không bấm xác nhận thu/hoàn thật chỉ để kiểm tra giao diện. Nếu đưa nhà hàng có người dùng thật vào chạy thì thống nhất thời gian bảo trì và quy trình nghiệm thu riêng.

## 9. payOS sau khi HTTPS ổn định

Giữ merchant tắt trong task này và automated tests. Khi chủ dự án sẵn sàng, cấu hình riêng khóa mới trên đúng kênh và các URL:

```text
PAYOS_RETURN_URL=https://qtruongres.<domain>/workspace/staff
PAYOS_CANCEL_URL=https://qtruongres.<domain>/workspace/staff
PAYOS_WEBHOOK_URL=https://qtruongres.<domain>/api/payments/webhooks/payos
```

Sau khi có đủ cấu hình đúng mới đặt PAYOS_ENABLED=true, validate và tạo lại container API. Trước khi đăng ký, kiểm tra URL webhook đi đúng qua Caddy và không bị trang đăng nhập Cloudflare Access hoặc challenge chặn provider; không gỡ xác minh chữ ký của backend để né lỗi proxy. Nếu bảo vệ đường dẫn nhân viên bằng Access, thiết kế ngoại lệ webhook cụ thể, không khóa toàn bộ luồng khách hoặc mở database.

Dùng maintenance image và env production đã hoàn thiện để kiểm tra/đăng ký riêng, không dùng script root vốn tự nạp `.env` dev:

```bash
docker compose --project-name qtruongres --env-file deploy/.env.production \
  -f compose.production.yaml --profile maintenance run --rm migrate \
  node --import tsx scripts/payos-config.ts check
```

`check` không gọi merchant hoặc in khóa. Maintenance mặc định chỉ ở mạng database nội bộ, vì vậy **không dùng container này để đăng ký webhook ra Internet**. Dùng Node 24 và dependency đã cài ở một máy quản trị tin cậy có outbound; wrapper sau lấy đúng cấu hình production, không dùng `.env` dev và không cần public PostgreSQL:

```bash
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseEnvironment, validateEnvironment, buildChildEnvironment } from './scripts/deploy.mjs';
const config = parseEnvironment(await readFile('deploy/.env.production', 'utf8'));
validateEnvironment(config);
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/payos-config.ts', 'check'], {
  env: { ...buildChildEnvironment(process.env, config), NODE_ENV: 'production' }, stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
NODE
```

Chỉ khi chủ dự án chủ động cho phép mới đổi đối số `check` trong wrapper thành `register-webhook`; đó là thao tác gọi payOS thật. Task hiện tại chưa thực hiện bước này. Sau đăng ký, người vận hành nghiệm thu giao dịch nhỏ theo [bài 12](12-van-hanh.md), không chạy tiền thật trong automated tests. Redirect của trình duyệt không xác nhận đã nhận tiền; webhook/reconciliation hiện có vẫn authoritative.

## 10. Start, stop, status và logs

Tất cả lệnh sau chạy ở gốc repo, dùng production env riêng mặc định; thêm `--env-file PATH` khi dùng cấu hình khác:

| Việc | Lệnh |
| --- | --- |
| Kiểm tra cấu hình | `node scripts/deploy.mjs validate` |
| Build tuần tự | `node scripts/deploy.mjs build` |
| Khởi động/recreate cấu hình mới | `node scripts/deploy.mjs start` |
| Dừng an toàn, giữ volume | `node scripts/deploy.mjs stop` |
| Xem service | `node scripts/deploy.mjs status` |
| Xem 100 dòng log cuối | `node scripts/deploy.mjs logs` |
| Theo dõi log | `node scripts/deploy.mjs logs --follow` |
| Kiểm tra qua proxy | `node scripts/deploy.mjs health` |
| Migration có kiểm soát | `node scripts/deploy.mjs migrate` khi writers đã dừng |

Có thể dùng `pnpm run deploy` để gọi script; không dùng `pnpm deploy` vì đó là lệnh đóng gói có sẵn của pnpm. `stop` không xóa volume; không thêm `down -v`, không xóa thủ công volume để sửa lỗi. `start` không seed/migrate. Lệnh start chính không tự bật lại profile tunnel đã dừng; khi cần, khởi động connector bằng lệnh ở bước 7 sau khi Caddy healthy. `restart: unless-stopped` giúp container phục hồi khi Docker hoạt động lại, không bật máy hoặc đánh thức laptop thay người vận hành.

Log có redaction các giá trị hạ tầng đã biết, nhưng vẫn có thể chứa thông tin vận hành riêng. Không công bố toàn bộ log, dump hoặc `docker inspect` môi trường. Dừng dịch vụ trước khi chủ động shutdown laptop; tránh forced power-off khi PostgreSQL đang ghi.

## 11. Cập nhật phiên bản

Kiểm tra nhánh/remote và working tree sạch. Tạo backup riêng trước các thay đổi quan trọng. Chạy:

```bash
node scripts/deploy.mjs update
```

CLI dừng writers → backup nhất quán → `git pull --ff-only` → build tuần tự → migrate deploy → start → health. Không force reset source, không tự xử lý conflict và không seed. Khi lỗi, writers giữ dừng để operator kiểm tra backup/migration; không tự chạy bản app cũ lên schema có thể đã thay đổi. Database/files là hai tài nguyên riêng, không có rollback giao dịch chung cho toàn bộ update.

Muốn thao tác từng bước: stop → backup → tự cập nhật source → build → migrate → start → health. Kiểm tra tunnel đã hoạt động lại nếu đã dừng toàn stack. Không dùng restore đè để quay phiên bản vội; chọn bản code tương thích và database/volume khôi phục riêng theo kế hoạch đã rà.

Chỉ chạy một thao tác thay đổi trạng thái stack tại một thời điểm. CLI chưa có khóa liên tiến trình: không chạy `backup`, `restore`, `migrate`, `update`, `start` hoặc `stop` đồng thời từ nhiều terminal/checkout trên cùng project.

## 12. Backup và restore production

```bash
node scripts/deploy.mjs backup
node scripts/deploy.mjs backup --backup-dir /duong-dan/luu-rieng
```

Mỗi lần tạo thư mục timestamp/ngẫu nhiên mới, quyền 700, payload/manifest quyền 600. CLI từ chối nếu migration đang chạy, dừng app writers đang hoạt động rồi dump PostgreSQL và hai store; sau backup nó khởi động lại đúng các writer trước đó, kể cả khi backup lỗi mà dữ liệu nguồn không đổi. Nếu restore/update lỗi thì giữ writers dừng. Backup có thể gây gián đoạn ngắn, cần chọn thời điểm ít thao tác.

| Payload | Nội dung |
| --- | --- |
| `database.dump` | Custom-format dump của database ứng dụng, không xuất role/global password; restore bỏ owner/ACL cũ |
| `runtime-files.jsonl` | Header phiên bản và từng file `{path,size,sha256,data:base64}` của menu-images/payment-proofs |
| `manifest.json` | Phiên bản format, project logic qtruongres, sourceProject, commit, thời gian, size/checksum payload |

Giới hạn archive file hiện hành: 2MiB/file, tối đa 10.000 file và 1GiB toàn gói JSONL. Base64 tăng kích thước khoảng một phần ba. Tên chỉ chấp nhận UUID `.png/.jpg/.webp` trong đúng hai thư mục; từ chối traversal, symlink, dòng trùng, checksum sai. File không hợp lệ làm backup thất bại thay vì bỏ qua âm thầm. Gói lỗi không có manifest hoàn tất; giữ riêng để chẩn đoán, không restore như gói tốt.

Khôi phục khi thực sự cần, trên project đích có volume mới/trống:

```bash
node scripts/deploy.mjs stop
node scripts/deploy.mjs restore --from /duong-dan/goi-backup
node scripts/deploy.mjs migrate
node scripts/deploy.mjs start
node scripts/deploy.mjs health
```

`stop` **không làm rỗng dữ liệu**. Nếu project đang có dữ liệu, restore sẽ từ chối; không có cờ overwrite. Để rehearsal/recovery, tạo cấu hình project qtruongres-* mới với port/subnet riêng hoặc yêu cầu người quản trị chuẩn bị volume mới sau khi kiểm tra mục tiêu. Không xóa volume hiện hành chỉ để vượt guard.

Host kiểm tra manifest, hash và toàn archive trước khi nạp. PostgreSQL restore dùng `--single-transaction --exit-on-error`; helper file dùng scratch riêng `/data/.restore-*` trên persistent volume thay vì tmpfs 64MiB, kiểm tra đích rỗng rồi ghi exclusive. Cần đủ chỗ cho archive tạm và file đã giải mã; không chỉ tính kích thước ảnh gốc. Scratch được dọn khi kết thúc/lỗi.

**DB và filesystem không có transaction chung.** Nếu DB restore xong nhưng file thất bại, database có thể đã có dữ liệu; writers vẫn dừng. Không retry ghi đè hoặc bật web ngay. Giữ backup gốc, đọc thông báo/log riêng và khôi phục lại vào đích mới trống sau khi sửa dung lượng/quyền/phiên bản. Checksum phát hiện thay đổi/hỏng, không chứng minh backup đến từ nguồn đáng tin: chỉ restore gói do mình quản lý, vì dump có thể chứa SQL thực thi.

Volume `postgres_data` giữ database, `runtime_data` giữ upload và chứng từ; tên Docker đầy đủ gắn project thực tế. `/tmp`, Next cache và log luân chuyển không phải nguồn backup nghiệp vụ. `.env`, token tunnel và khóa merchant được giữ/tái lập riêng; mất AUTH_SECRET nguồn có thể làm hỏng giải mã QR dù dump còn nguyên.

## 13. Chuyển sang VPS/Ubuntu VM

Cài Docker Engine/Compose và Node 24, clone đúng commit/tag đã nghiệm thu. Không copy `node_modules`, cache `.next`, data directory PostgreSQL đang chạy hoặc credential từ image layer. Tạo production env riêng trên máy mới; giữ AUTH_SECRET/RESTAURANT_ID nguồn, chọn mật khẩu database đích và encode URL đúng. Chuyển gói backup qua kênh riêng, kiểm tra hash; build → restore vào volume mới trống → migrate → start → health.

Có thể tiếp tục dùng cùng remotely managed Named Tunnel và service URL `http://caddy:8080`; cấp token connector đúng tài khoản/tunnel trên máy mới. Dừng connector/mọi writer của máy cũ theo kế hoạch chuyển để tránh hai database độc lập cùng nhận đơn dưới một domain. Kiểm tra 4G/5G, QR, ảnh, đăng nhập và payOS theo đúng môi trường mới trước khi nhận giao dịch. Laptop cũ không tự đồng bộ giao dịch với VPS.

Giữ firewall host chỉ mở những dịch vụ quản trị thực sự cần; stack này không cần public 80/443/3000/4000/5432 vì dùng Tunnel. Không đổi proxy trust thành toàn Internet. Nếu sau này chọn Caddy public TLS trực tiếp thay Tunnel, đó là một phương án ingress khác cần rà soát DNS, TLS, firewall và header trust riêng, không bật bằng cách sửa bừa port mapping.

AI vẫn OFF. API có đường outbound cần cho payOS; sau này có thể thiết kế một endpoint model private/container riêng nhưng không mở 11434 ra Internet. Task deployment không cài Ollama, Qwen hoặc GPU stack.

## Trạng thái kiểm tra của bản hướng dẫn

Đã nghiệm thu cục bộ ngày **17/10/2026**, từ working tree deployment dựa trên commit `8ba8b3a`. Bốn production image API, maintenance, Next.js và Caddy build đạt; build Next.js có 7 route. Caddy dùng image đã bỏ file capability thừa, giữ non-root/read-only/cap-drop. Migration được gọi có chủ đích và áp đủ **36 migration** vào database thử mới; không migrate/seed hoặc nhập dữ liệu vào database đang dùng.

| Kiểm tra thực tế | Kết quả |
| --- | --- |
| Mã nguồn | `pnpm check` đạt format/lint/TypeScript, **213 unit / 34 tệp**; tăng 3 ca proxy, không bỏ unit AI v2 |
| Vận hành và nghiệp vụ | **18/18 node:test**, **373/373 integration / 26 tệp** đạt; assertion nghiệp vụ giữ nguyên |
| Stack local | PostgreSQL/API/web/Caddy đều healthy; qua proxy trang web, API live/ready trả 200; truy vấn PostgreSQL thật đạt |
| Quyền và network | API/web UID/GID 10001, Caddy 1000; ba service read-only và bỏ capabilities; chỉ Caddy bind loopback 18088 ở rehearsal; database network internal; không host port 3000/4000/5432 |
| Persistence | Ghi bằng UID không root; hàng DB thử và checksum ảnh món/chứng từ vẫn đúng sau force-recreate container |
| Tệp riêng tư | Ảnh món public trả đúng bytes; đường dẫn chứng từ thử không trả file khi chưa xác thực |
| Backup/restore Docker | Dump + archive thật, phục hồi vào project trống khác; giữ hàng DB, 36 migration và hai hash tệp; backup khởi động lại đúng writers trước đó |
| Guard restore | Từ chối khi writers đang chạy và khi DB đích không trống; không overwrite hoặc tự reset |
| Readiness | Dừng PostgreSQL thử: API live 200, ready 503; khởi động database lại thì ready phục hồi |
| Proxy trust | Header IP giả từ localhost không được tin; peer thử ở đúng IP connector chỉ chuyển IP đã chuẩn hóa. Đây là mô phỏng peer Docker, chưa chạy Cloudflare thật |
| Bảo toàn | `.env` thật và compose dev không đổi hash; không sửa schema/migrations/AI; secret check cơ bản đạt; biên bản ghi trước bước công bố Git, dùng commit chứa tài liệu để đối chiếu |

Rehearsal chạy bằng **Node/Docker Windows trên checkout riêng**, project `qtruongres-rehearsal-20261016` và `qtruongres-recovery-20261017`, port/subnet/volume riêng. Các stack thử đã dừng, giữ volume/gói dữ liệu thử riêng. Ubuntu WSL vẫn cần người vận hành sửa Docker integration; kết quả trên không chứng minh socket WSL đã được sửa, dữ liệu nhà hàng thật đã chuyển hoặc website đã lên Internet. Bản build standalone riêng cũng đã phục vụ trang chủ và Swagger HTTP 200.

[Biên bản và giới hạn](reference/qtruongres-deployment-20261017.json) · [Check](evidence/qtruongres-check-20261017.txt) · [18 kiểm thử vận hành](evidence/qtruongres-ops-20261017.txt) · [373 tích hợp](evidence/qtruongres-integration-20261017.txt) · [Build API/maintenance/web](evidence/qtruongres-docker-build-20261017.txt) · [Migration thử](evidence/qtruongres-migrate-20261017.txt). Build Caddy và kết quả runtime được ghi trong biên bản; [bài 15](15-doi-chieu.md) tổng hợp cùng phạm vi xác minh.

**Chưa nghiệm thu:** domain/DNS, Cloudflare account/Named Tunnel thật, public HTTPS, đăng nhập production qua HTTPS, QR/đặt món từ điện thoại 4G/5G, import dữ liệu đang vận hành, đăng ký webhook/giao dịch payOS thật và cập nhật production bằng git pull. Những bước này cần cấu hình/tài khoản của chủ dự án theo hướng dẫn trên. Không cài/chạy model hoặc AI UI; `MENU_ASSISTANT_MODE=OFF`, merchant payOS tắt.

Nguồn chính: [Cloudflare Named Tunnel qua dashboard](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/), [cloudflared token-file và tham số](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/), [Caddy reverse proxy và header tin cậy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [PostgreSQL 18 pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html). Kiểm tra lại hướng dẫn nhà cung cấp khi đổi phiên bản.
