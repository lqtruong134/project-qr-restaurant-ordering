# Lưu trữ riêng hai hồ sơ thử payOS A01/A02 — 25/10/2026

## Kết luận và phạm vi

Chọn **lưu trữ logic, giữ nguyên bằng chứng và chặn ghi sổ vĩnh viễn cho đúng hai intent**. Không xóa vật lý: các bảng tài chính có FK RESTRICT, trigger chống xóa và đây là hai khoản đã chuyển tiền thật. Xóa webhook/idempotency còn làm mất khả năng nhận ra lần gửi lại. Không reset PostgreSQL, không đổi allocator SQLite, không đóng giả phiên bàn, không đánh dấu đã thu/hoàn/đối soát.

Baseline mã nguồn: `main` `aa4eb8acaf3fc65ef42639c5e815a1f198ed70b3`, đã merge PR #5. Chủ dự án cung cấp trạng thái production có 39 migration; tác vụ này **không kết nối production**. Bản bổ sung có migration thứ 40 `202610250002_payos_test_case_archive/migration.sql`. Chưa merge/deploy/migrate production, không gọi payOS hoặc ngân hàng thật.

| Hồ sơ | Prefix phiên | Intent | Provider | Đối soát | Audit gốc | Chứng từ |
|---|---|---|---|---|---:|---:|
| A01 | `ffc78214` | 5.000 VND, REQUIRES_RECONCILIATION | PAID | OPEN | 8.789 | 1 |
| A02 | `300659c7` | 5.000 VND, REQUIRES_RECONCILIATION | PAID | OPEN | 10.284 | 0 |

Chưa có UUID đầy đủ và restaurant UUID trong yêu cầu, nên không tự điền hoặc đoán. Dry-run tìm ứng viên theo đúng bàn/prefix trong restaurant đã cấu hình, yêu cầu đúng một intent mỗi phiên, rồi ghi **toàn bộ UUID** vào `plan.json` riêng tư. Người vận hành phải đối chiếu từng UUID trước khi duyệt hash kế hoạch. Lệnh apply không nhận prefix thay UUID, không có `--force`, `--delete` hoặc tùy chọn sửa số đếm. Nếu audit tăng thêm, đã có receipt, thêm webhook/chứng từ hoặc bất kỳ pre-image nào thay đổi: từ chối, điều tra và review phạm vi lại; không sửa kế hoạch bằng tay để vượt kiểm tra.

Lưu trữ chỉ đưa hai ngoại lệ ra khỏi hàng đợi thường. Phiên bàn, đơn món, công nợ, nghĩa vụ đóng bàn và báo cáo tiền giữ nguyên. **A01/A02 không tự được giải phóng để mở phiên mới**, và tiền thật vẫn nằm trong bằng chứng riêng. Nếu cần xử lý nghĩa vụ kế toán của khoản thử hoặc đóng hai phiên, phải review một nghiệp vụ riêng; không dùng công cụ này để xóa nợ hoặc giả lập hoàn tiền. Thông báo chưa khớp khác, kể cả mã 123 nếu còn tồn tại, không thuộc phạm vi này.

## Rà soát liên kết và số audit lớn

Đã đối chiếu Prisma, 39 migration cũ và `pg_constraint` trên PostgreSQL 18 cách ly. Các nhánh FK từ intent/request/receipt/webhook/alert/proof gồm:

- `payos_payment_request`, `idempotency_record`, `payment_transaction`, `payment_bank_proof`, `payment_bank_preview`, `payment_bank_evidence`, `bank_receipt_claim` tham chiếu intent.
- `payment_allocation`, `payment_webhook_event`, `outbox_event`, `refund_case`, preview/evidence/claim tham chiếu receipt; preview/evidence còn tham chiếu proof.
- Request tham chiếu alert. Intent, account, charge, order và alert gắn với phiên/bàn/restaurant. `business_audit_event.resource_id`, JSON webhook/outbox và proof legacy là các liên kết nghiệp vụ cần kiểm tra thêm ngoài FK.

Công cụ đọc catalog FK thực tế, lưu definitions/cột tham chiếu, duyệt các bản ghi con và từ chối nếu gặp nhánh chưa được review có dữ liệu. Receipt, allocation, refund, claim, preview/evidence hoặc outbox liên quan phải bằng 0 cho profile này. Đọc toàn bộ audit intent và audit resource request/webhook/alert/proof; thống kê theo action, thời điểm đầu/cuối và số `details` khác nhau được giữ trong kế hoạch riêng tư.

**Nguồn tăng audit đã tái hiện ở code/lab:** maintenance chạy mỗi 5 giây, request đến hạn polling thường sau 30 giây. `applyLink()` trước đây ghi `PAYOS_PROVIDER_REPORTED` và `PAYOS_PROVIDER_VERIFIED` lặp lại ngay cả khi facts không đổi. Với ngoại lệ nằm trong tập tự phục hồi, việc polling kéo dài có thể tạo hàng nghìn audit. Bản sửa giữ sự kiện đầu, chỉ thêm khi facts thay đổi hoặc có đợt đối soát mới; audit thao tác ADMIN và lịch sử cũ vẫn được giữ. Không dùng dedup này để bỏ qua việc xác minh hoặc ghi sổ.

Không khẳng định toàn bộ 8.789/10.284 sự kiện production đều do cùng nguyên nhân khi chưa đọc thống kê production. Kế hoạch dry-run sẽ cung cấp phân bố thực tế để reviewer xác nhận. Hai số đếm do chủ dự án cung cấp là điều kiện từ chối cứng, không phải số liệu vừa đọc từ production trong tác vụ này.

## Tác động dữ liệu chính xác

| Bảng/tài nguyên | Apply lần đầu cho cả hai hồ sơ | Dữ liệu gốc |
|---|---|---|
| `payos_test_case_archive` | INSERT **2** marker với UUID, reference, order/link, số tiền, hash kế hoạch/archive/backup, actor và lý do | Marker bất biến; chỉ cho phục hồi hiển thị một lần |
| `payos_test_archive_event` | INSERT **2** sự kiện ARCHIVED | Append-only, unique archive/kind/hash; lần gửi lại giống nhau không tăng bản ghi |
| `business_audit_event` | INSERT **2** PAYOS_TEST_CASE_ARCHIVED | Giữ **19.073 audit intent gốc**, các audit resource liên quan và mọi audit khác |
| `payment_intent` | **0 UPDATE/DELETE** | Giữ 2 intent 5.000 VND, trạng thái REQUIRES_RECONCILIATION và proof legacy nếu có |
| `payos_payment_request` | **0 UPDATE/DELETE** | Giữ 2 request PAID/OPEN, orderCode/link/ref và anchor tài khoản |
| `payment_webhook_event` | **0 UPDATE/DELETE** | Giữ 2 webhook gốc, mỗi hồ sơ đúng 1 |
| `idempotency_record` | **0 UPDATE/DELETE** | Giữ 2 record gốc, mỗi hồ sơ đúng 1 |
| `operational_alert` | **0 UPDATE/DELETE** | Giữ 2 alert với trạng thái gốc; chỉ lọc khỏi hàng đợi thường |
| Proof legacy hoặc `payment_bank_proof` và file chứng từ | **0 UPDATE/DELETE** | Giữ đúng 1 chứng từ A01; copy bytes vào archive riêng và kiểm SHA-256 |
| Receipt/allocation/refund/claim/outbox/preview/evidence | **0 INSERT/UPDATE/DELETE** | Phải không có dữ liệu liên quan trước apply; giữ số dư và sổ thu nguyên vẹn |
| `table_session`, `order_batch`, `order_item`, `financial_charge`, `session_financial_account` | **0 UPDATE/DELETE bởi công cụ** | Không hủy món, không đóng bàn, không sửa nợ hay snapshot bill |
| SQLite allocator, sequence PostgreSQL, runtime upload | **Không ghi hoặc khởi tạo** | Giữ nguyên mã đã cấp; không rewind/cấp lại orderCode |
| `_prisma_migrations` | Ngoài thao tác apply | Khi operator được duyệt chạy migration mới, Prisma thêm 1 dòng metadata theo quy trình hiện hữu |

UUID chính xác của từng bản ghi được liệt kê trong `plan.json`/bundle riêng của operator, không đưa vào Git. Cả hai marker và audit/event tương ứng nằm trong **một transaction**; một hồ sơ sai sẽ rollback cả hai. Apply trùng cùng kế hoạch/archive/backup trả no-op, không thêm marker/audit. Backup khác hoặc marker/hiển thị khác kế hoạch bị từ chối.

Sau apply, webhook có chữ ký hợp lệ được đưa vào inbox riêng: `WEBHOOK_REPLAY` nếu order/link/reference/amount/currency/code đều khớp; khác facts là `WEBHOOK_CONFLICT`, hiển thị số cảnh báo mới trong mục archive ADMIN. Kết quả worker đã chạy từ trước lưu thành `PROVIDER_RESULT`, không ghi receipt. Mỗi payload khác nhau có thể thêm sự kiện riêng; đây không phải cam kết bộ đếm inbox luôn bằng 2.

## Cơ chế bảo vệ

- Mặc định READ ONLY REPEATABLE READ và ROLLBACK; không tự nạp `.env`, không gọi provider, không import/khởi tạo allocator. `--restaurant-id` phải là UUID đầy đủ và khớp `RESTAURANT_ID` của process.
- Kế hoạch có database identity, toàn bộ UUID/pre-image/FK, số đếm và SHA-256. Apply kiểm lại dưới khóa phiên → intent → request, rồi khóa tham chiếu theo thứ tự ổn định. Có lock/statement timeout; không retry ghi vô hạn.
- Archive ở **ngoài repository**, thư mục 700, file 600, không symlink, không ghi đè; kế hoạch, chứng từ và manifest được fsync trước commit. Gói nhạy cảm, không gửi công khai hoặc đưa vào Docker build context/Git. SHA-256 kiểm toàn vẹn, không thay thế quyền truy cập và việc operator xác nhận đúng dữ liệu.
- Apply đòi ADMIN đang ACTIVE đúng restaurant, lý do, hash kế hoạch, gói backup đã kiểm checksum và cờ xác nhận **hai khoản thử có tiền thật**. Backup phải được tạo sau bundle, cùng thời gian đã fence writers. Checksum không tự chứng minh backup đúng nguồn/khôi phục được: reviewer vẫn phải đối chiếu bản restore.
- Worker loại marker khỏi tập polling, kể cả sau rollback hiển thị. Refresh, cancel, đóng đối soát, xác minh ngân hàng và replay create/idempotency của intent đã archive đều bị chặn.
- Chữ ký webhook vẫn được SDK xác minh trước inbox. Có kiểm tra lần nữa dưới khóa để xử lý archive đến đồng thời. Chỉ trả ACK sau lưu bằng chứng bền vững; ACK **không** có nghĩa đã thanh toán/đối soát.
- Trigger DB đóng băng intent/request/webhook/alert/proof và idempotency, chặn receipt/claim dùng intent hoặc tham chiếu đã archive, kể cả đường ghi từ code cũ. Chặn audit polling mới cho intent đó. Chặn webhook lọt vào inbox thường; webhook mới dùng cùng thứ tự khóa phiên trước tham chiếu để tránh deadlock với refresh.
- Không lọc archive khỏi tổng tài chính, eligibility hoàn tiền hoặc các blocker đóng bàn. GUEST/STAFF không nhận proof, reference ngân hàng hay tài khoản. Endpoint ADMIN chỉ trả metadata đã chọn, không trả raw evidence.

Tài liệu tham chiếu: [payOS Webhook](https://payos.vn/docs/du-lieu-tra-ve/webhook/), [SDK Node chính thức](https://payos.vn/docs/sdks/back-end/node/), [PostgreSQL explicit/advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html). Quy tắc archive là nghiệp vụ riêng được chủ dự án yêu cầu; không trình bày nó như tính năng thanh toán/hoàn tiền của payOS.

## Hướng dẫn operator — chỉ thực hiện sau review/cho phép riêng

Các lệnh dưới đây **chưa được chạy trên production**. Không gộp thành script tự deploy. Mỗi bước phải xác nhận kết quả trước khi qua bước tiếp theo.

### 1. Chuẩn bị và backup trước thay đổi

1. Review PR/commit và kết quả test, xác nhận đúng project/DB/restaurant, 39 migration gốc, hai khoản thực nhận và actor ADMIN. Không dùng credential test lên production, không đổi secrets.
2. Theo quy trình bảo trì đã được duyệt, chặn request mới và fence **tất cả** writer: API/worker/maintenance cũ, các bản chạy ngầm và webhook. Không để binary cũ tiếp tục polling trong lúc lập kế hoạch. Công cụ tự từ chối worker lease còn hiệu lực nhưng không thể tự chứng minh mọi writer đã dừng.
3. Khi writer đã dừng, dùng backup hiện hữu (`pnpm deploy backup --env-file deploy/.env.production --backup-dir ABS_PRIVATE_BACKUP_ROOT`), giữ PostgreSQL dump + runtime archive + SQLite allocator và giữ secrets triển khai riêng. Không cat `.env`/`docker compose config` ra log. Backup command phải chạy sau fence để không tự khôi phục một writer vốn đang chạy.
4. Thử restore vào DB/volume **cách ly, rỗng**; xác minh schema, UUID, số đếm, ledger, chứng từ và allocator. Không restore đè production, không rewind allocator của kênh thật.
5. Build image commit đã review. Chỉ sau phê duyệt riêng mới áp migration 40 bằng maintenance UID10001 và xác nhận đủ 40 migration. Giữ writer dừng. Công cụ archive cần hai bảng mới; không chạy nó lên schema 39 rồi bỏ qua lỗi thiếu bảng.

### 2. Chuẩn bị thư mục riêng và maintenance CLI

Ví dụ cho Linux/WSL, chạy ở checkout commit đã được duyệt. Xác nhận project name thực tế trước khi dùng ví dụ `qtruongres`. Thư mục archive nằm ngoài Git và thuộc UID10001, không đổi chủ/quyền volume runtime.

```bash
export PAYOS_ARCHIVE_DIR=/srv/qtruongres-private/payos-test-20261025
sudo install -d -o 10001 -g 10001 -m 700 "$PAYOS_ARCHIVE_DIR"

archive_dc=(docker compose --project-name qtruongres \
  --env-file deploy/.env.production -f compose.production.yaml \
  -f deploy/compose.payos-test-archive.yaml --profile maintenance)

"${archive_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-case-archive.ts --help
```

Overlay là opt-in, không được deployment thường tự load. Nó giữ UID10001, read-only root, security options và network database hiện hữu; mount runtime `/data` **read-only**, bind archive `/archive`, payOS của process này OFF. Không khởi động PostgreSQL bằng lệnh này (`--no-deps`). Không truyền API/checksum key trong CLI và không dùng API runtime image thay maintenance image.

### 3. Dry-run và review UUID

Điền đúng restaurant UUID, không lấy prefix phiên làm UUID:

```bash
export ARCHIVE_RESTAURANT_ID='UUID-DAY-DU-CUA-RESTAURANT'
"${archive_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-case-archive.ts \
  --restaurant-id "$ARCHIVE_RESTAURANT_ID" \
  --proof-dir /data/payment-proofs --output /archive/plan-a01-a02
```

Không có `--apply` nghĩa là chỉ đọc DB. stdout chỉ có bảng/số đếm/hash; `plan.json` và bản sao chứng từ ở thư mục riêng. Reviewer mở chúng **tại máy operator**, đối chiếu restaurant UUID, session UUID, intent UUID, request UUID, webhook/alert/idempotency/proof UUID, exact order/link/reference, 5.000 VND mỗi khoản, trạng thái, số đếm và bằng chứng tiền thật. Không đăng raw plan hoặc chứng từ lên PR/chat công khai. Ghi lại `planHash`, `caseSnapshotHash`, `bundleHash` trong biên bản riêng.

Nếu lệch bất kỳ điều kiện nào: dừng, giữ writer dừng hoặc khôi phục vận hành theo quy trình đã review. Không cập nhật số audit trong SQL/plan một cách cơ học và không ép dữ liệu khớp profile.

### 4. Backup xác nhận, thực thi và kiểm tra

Sau khi tạo bundle, vẫn trong cửa sổ đã fence, tạo **backup mới** (không dùng gói trước migration hoặc gói cũ hơn bundle). Thử restore/đối chiếu lại. Case snapshot trên bản restore phải khớp, dù database identity/planHash của DB cách ly sẽ khác. Chép đúng ba file đã xác minh vào thư mục mới, chỉ đổi quyền bản sao riêng:

```bash
export ARCHIVE_BACKUP_SOURCE='/duong-dan-tuyet-doi/backup-moi-da-thu-restore'
sudo install -d -o 10001 -g 10001 -m 700 "$PAYOS_ARCHIVE_DIR/backup-confirmed"
for archive_backup_file in manifest.json database.dump runtime-files.jsonl; do
  sudo install -o 10001 -g 10001 -m 600 \
    "$ARCHIVE_BACKUP_SOURCE/$archive_backup_file" \
    "$PAYOS_ARCHIVE_DIR/backup-confirmed/$archive_backup_file"
done
sudo sha256sum "$PAYOS_ARCHIVE_DIR/backup-confirmed/manifest.json"
```

Nhập hash kế hoạch/backup đã review và UUID ADMIN. Đây là xác nhận cuối có chủ đích, không có mặc định đồng ý:

```bash
export ARCHIVE_PLAN_SHA='SHA256-KE-HOACH-DA-DUYET'
export ARCHIVE_BACKUP_SHA='SHA256-MANIFEST-BACKUP-DA-DUYET'
export ARCHIVE_ADMIN_ID='UUID-DAY-DU-ADMIN-DANG-ACTIVE'
"${archive_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-case-archive.ts --apply \
  --restaurant-id "$ARCHIVE_RESTAURANT_ID" --proof-dir /data/payment-proofs \
  --from /archive/plan-a01-a02 --confirm "$ARCHIVE_PLAN_SHA" \
  --operator-id "$ARCHIVE_ADMIN_ID" \
  --reason 'Đã đối chiếu hai khoản thử có tiền thật A01/A02, duyệt archive riêng và backup đã thử restore.' \
  --ack-real-test-funds --backup /archive/backup-confirmed \
  --confirm-backup "$ARCHIVE_BACKUP_SHA"
```

Kết quả mong đợi: `dryRun=false`, `archived=2`, `originalRecordsDeleted=0`, `ledgerChanged=false`, `postingBlocked=true`, `financiallyResolved=false`. Khi chạy lại đúng xác nhận phải là `alreadyProcessed=true`. Không tự retry khi báo drift/lock/backup/proof/admin/schema; lưu mã lỗi và review.

Kiểm tra chỉ đọc: đúng 2 marker và 2 audit ARCHIVED, giữ 19.073 audit gốc và các bản ghi liên quan; không có receipt/allocation mới cho hai intent; account/charge/refund của mọi phiên không thay đổi; checksum chứng từ/allocator đúng baseline; hai case/alert rời hàng đợi thường, ADMIN thấy **Hồ sơ thử đã lưu trữ**. Các lần webhook sau có thể tăng inbox riêng nhưng không tăng receipt/audit polling hoặc đổi trạng thái gốc. Trước khi mở writer, tạo và kiểm một **backup sau archive**, chứa đủ hai marker/inbox/trigger, giữ riêng backup trước archive và bundle. Backup trước archive không có tombstone: không được bật worker ngay sau khi restore gói đó; cần phục hồi marker bằng kế hoạch mới đã review trước khi cho chạy. Chỉ operator mới khởi động writer phiên bản đã review sau khi các kiểm tra này đạt.

### 5. Rollback an toàn

Rollback của công cụ là **phục hồi hiển thị để kiểm tra**, không tháo chặn ghi tiền. Tạo bundle mới bằng cùng lệnh dry-run, thêm `--restore-visibility`, đổi output thành `/archive/visibility-review`. Review UUID, dữ liệu hiện tại và toàn bộ inbox archive; tạo/thử restore một backup mới hơn bundle này. Sau phê duyệt, dùng lệnh apply với `--restore-visibility`, `--from /archive/visibility-review`, hash kế hoạch và backup mới, lý do rollback.

Tác động: UPDATE đúng 2 marker `visible_in_operations=false→true` cùng actor/lý do/thời điểm, INSERT 2 audit PAYOS_TEST_VISIBILITY_RESTORED và 2 sự kiện riêng. Case/alert xuất hiện lại nhưng intent/request/webhook/ledger vẫn như cũ, worker/refresh/ghi sổ vẫn bị chặn. Rollback hiển thị chỉ cho phép một lần; không bật/tắt qua lại để né audit.

Không DROP marker/trigger, không xóa archive, không hạ xuống binary không hiểu tombstone, không restore backup cũ đè giao dịch mới và không phục hồi SQLite cũ làm lùi watermark. Nếu cần phục hồi sự cố hạ tầng, clone backup sang target cách ly, giữ lịch sử phát sinh sau backup và xác minh watermark mới nhất theo runbook deployment trước khi quyết định cutover. Tái phân loại hai khoản tiền thật để ghi sổ trong tương lai là nhiệm vụ tài chính riêng, cần review và bằng chứng mới; không nằm trong rollback này.

## Kiểm thử và giới hạn nghiệm thu — hoàn tất 26/10/2026

Test dùng PostgreSQL 18 tmpfs có nhãn riêng, cổng loopback 55441, database tên ngẫu nhiên, tiền/chữ ký/QR/chứng từ tổng hợp. Không nạp production `.env`, không có network merchant thật. Mỗi suite dọn đúng DB của mình; không dọn volume hoặc cache production.

- 41 test archive mới và 172 test payOS/ngân hàng hiện hữu nằm trong bộ API coverage **716/716 đạt**, lines **92,53%**, gồm scope/count/FK/drift/lease, private SHA/proof/backup/symlink, ADMIN, apply đồng thời, webhook đến trong transaction archive, M2 proof và legacy, idempotency, worker, chống tham chiếu cũ bị gán sang khoản khác, thanh toán mới và rollback hiển thị.
- Lượt đầu hồi quy thiếu khóa QR tổng hợp bắt buộc của runner; đã chạy lại bằng `AUTH_SECRET` tổng hợp. Một lỗi thứ tự lock do trigger mới được test concurrency phát hiện và đã sửa tận gốc bằng session-before-reference; lượt 716/716 giữ nguyên assertion và timeout của test payOS hiện hữu.
- Test provider-facts xác nhận polling lặp không tăng audit giống nhau, giữ timestamp đầu và ghi fact mới khi số tiền/tham chiếu thay đổi. Không xóa test hoặc lịch sử để giảm số audit.
- `pnpm check`: format, ESLint, toàn bộ typecheck và **400 unit tests đạt**. Deployment-tool tests: **29 đạt, 1 bài Docker opt-in có sẵn không được chọn**; các Docker smoke dưới đây đã chạy riêng.
- Browser trọng tâm: **6/6 đạt** (2 kịch bản × desktop/Android/Safari iPhone), kiểm tra archive chỉ đọc, thông báo mới, không có thao tác ghi sổ và không tràn ngang. Không chạy lại toàn bộ Playwright suite tại máy này; Quality Gate GitHub giữ nguyên.
- Dockerfile web production (Turbopack) build đạt 7 route. Maintenance build và CLI import/help đạt bằng UID10001, root read-only, không mạng/volume/DB. Bản CLI cuối được smoke lại trên image maintenance với đúng mã hiện tại. Lượt build Webpack thử ở bản sao symlink gặp lỗi BigInt của môi trường lab; không sửa framework hoặc che lỗi, không dùng lượt đó làm bằng chứng PASS. Build theo Dockerfile chuẩn đạt.
- Rehearsal **pg_dump → pg_restore** thực trên container tmpfs cách ly: giữ **74 bảng**, **2 marker**, **19.073 audit gốc**, proof và SQLite hash; FK khớp, số dư/phiên khác giữ nguyên, trigger vẫn chặn receipt và webhook lặp sau restore ghi **0** giao dịch cho hai intent. Test rehearsal chọn riêng một kịch bản; 39 test archive ở thời điểm đó đã chạy riêng và đạt, không xóa/bỏ qua test trong source commit.
- Có lượt test bị tranh tài nguyên khi Docker build chạy đồng thời. Đã tách fixture phá file/symlink thành thư mục riêng để lỗi không làm nhiễm test sau, đặt ngân sách I/O 30 giây chỉ cho file archive chứa 19.073 audit, rồi chạy tuần tự **212/212**. Không sửa assertion, timeout hoặc loại bỏ test payOS cũ.
- Kết quả tổng hợp ở [biên bản kiểm thử máy đọc được](payos-test-archive-verification.json). GitHub Quality Gate gắn với commit PR riêng; chưa dùng nó để khẳng định production đã an toàn. Operator vẫn phải review private plan, bản restore, full UUID và số đếm production trước quyết định thực thi.

### Sửa fixture sau CI lần đầu

[Quality Gate run 67](https://github.com/lqtruong134/project-qr-restaurant-ordering/actions/runs/40218118081) đạt 714 bài và lỗi 1 tại kiểm tra snapshot sau archive đồng thời; secret/audit/code/migration/seed đều đạt. Đây không phải lỗi hạ ngưỡng coverage. Fixture bật worker thật mỗi 5 giây, còn intent không thuộc hai hồ sơ sẽ đến hạn polling sau 30 giây. Coverage chạy lâu làm worker cập nhật đúng projection của intent khác giữa hai snapshot.

Fixture nay lập lịch intent ngoài phạm vi ở tương lai, giữ nguyên worker thật; test riêng chủ động cho intent đó đến hạn, kiểm chứng projection thay đổi và chờ lease được trả trước khi đo pre-image đã fence. Hai hồ sơ mục tiêu vẫn có lịch đến hạn quá khứ để kiểm tra bộ lọc archive. Assertion SHA giữ nguyên và thêm đối chiếu từng dòng, không bỏ timestamp/version. Không sửa code thanh toán, timer production, ngưỡng coverage hoặc test cũ. Chạy lại toàn bộ API coverage cách ly đạt **716/716, lines 92,53%**; CI tiếp theo của cùng PR phải được xem theo commit mới nhất, không dùng run lỗi này làm PASS.
