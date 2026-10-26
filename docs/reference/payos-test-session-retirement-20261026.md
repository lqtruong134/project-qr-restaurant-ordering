# Kết thúc kỹ thuật hai phiên thử A01/A02 — 26/10/2026

## Kết luận và giới hạn

Chọn công cụ bảo trì một lần **RETIRE_ARCHIVED_TEST_SESSION**, chỉ nhận đúng hai session/intent UUID dưới đây. Không thêm nút bỏ qua thanh toán hoặc nới `closeReadiness()` cho các bàn khác. Phiên cũ chuyển `CLOSED` với lý do riêng `ARCHIVED_TEST_RETIRED`; đây **không phải** SETTLED, WRITTEN_OFF, RECONCILED hoặc REFUNDED. Bàn chuyển `NEEDS_CLEANING`, nhân viên dùng bước dọn bàn hiện có rồi mới mở phiên mới.

Baseline: main `b7a889348e5e6910eca5a9cae8525ee020103c5b`, đã merge PR #6. Chủ dự án cho biết production đã triển khai migration 40 và archive; **tác vụ này không kết nối production**, không xác nhận thay operator các UUID restaurant/table, trạng thái thực tế hoặc số blocker còn lại. Những điều kiện đó phải được preflight/dry-run kiểm chứng. Mã và test dùng PostgreSQL lab, provider tổng hợp và ảnh chứng từ tổng hợp.

| Bàn | Session UUID cố định | Intent UUID cố định | Tiền thật trong archive |
|---|---|---|---:|
| A01 | `ffc78214-13d4-4fd3-adae-dd78d01affd5` | `f728d24c-6d31-4c07-89a0-d658832ded69` | 5.000 VND, chưa quyết toán |
| A02 | `300659c7-5fea-4a77-a976-94551b078738` | `85f9d699-e6de-48f1-ad0e-d77ada9423d3` | 5.000 VND, chưa quyết toán |

Restaurant UUID phải truyền đầy đủ và khớp `RESTAURANT_ID` của process. `table_id`, archive UUID và mọi dependency lấy từ DB phải khớp cùng restaurant/bàn/session/intent. Không tìm theo prefix để ghi dữ liệu.

## Nguyên nhân và blocker

PR #6 chỉ tách hai ngoại lệ khỏi hàng đợi và chặn ghi sổ; không thu tiền, xóa công nợ hay đóng bàn. `closeReadiness()` vẫn chặn khoản `REQUIRES_RECONCILIATION`, nợ chưa thu, cảnh báo chưa giải quyết và yêu cầu hỗ trợ còn mở. Đây là bảo vệ đúng cho khách bình thường. Hồ sơ thiếu tiền được tạo nhầm ở A02 còn thêm `OUTSTANDING_CASE` và `ALERT_PAYMENT_SHORTFALL`; dùng write-off để vượt chúng sẽ tạo lịch sử tổn thất không có thật.

Công cụ dùng cùng `closeReadiness()` để **đếm** blocker, không thay kết quả của nó. Chỉ chấp nhận blocker đã review: UNPAID; đúng intent payOS đã archive cần đối soát; đúng cảnh báo payOS gốc; BILL/ACCESS_CODE thử đang NEW/ACKNOWLEDGED; một hồ sơ A02 PENDING_ADMIN_REVIEW và đúng một cảnh báo thiếu tiền tương ứng. A01 phải không có hồ sơ thiếu tiền. Các số lượng support/người tham gia chính xác nằm trong private plan; không đoán từ ảnh hoặc coi production đã PASS.

Lab dùng mỗi hóa đơn 20.000 VND, chưa ghi thu, gồm:

| Blocker lab | A01 | A02 |
|---|---:|---:|
| UNPAID | 1 | 1 |
| PAYMENT_REQUIRES_RECONCILIATION | 1 | 1 |
| ALERT_OTHER gắn đúng archive payOS | 1 | 1 |
| SUPPORT_BILL_NEW | 1 | 1 |
| OUTSTANDING_CASE | 0 | 1 |
| ALERT_PAYMENT_SHORTFALL | 0 | 1 |

Đây là **fixture tổng hợp**, không phải số đo production. Khi dữ liệu thật khác, công cụ từ chối hoặc yêu cầu kế hoạch mới có review; không sửa số tiền hay hàng dữ liệu để làm nó chạy.

## Tác động chính xác khi apply

| Bảng/tài nguyên | Tác động cho đúng hai phiên | Không bị đổi |
|---|---|---|
| `payos_test_session_retirement` | INSERT 2 marker bất biến, financial snapshot, plan/bundle/backup hash, ADMIN, lý do, thời điểm | Không phải chứng từ thu/hoàn |
| `table_session` | UPDATE 2: CLOSED, ARCHIVED_TEST_RETIRED, closed_by/closed_at/version | Giữ financial_status, table_id, mã tham gia cũ, công nợ; không tạo receipt_snapshot/số phiếu thu giả |
| `dining_table` | UPDATE 2: NEEDS_CLEANING, version | Không đổi QR vật lý, mã bàn, restaurant hoặc bàn khác |
| `session_participant` | N người chưa LEFT của hai phiên → LEFT | Giữ danh tính, đơn món và lịch sử tham gia; N phải được review trong plan |
| `support_request` | N BILL/ACCESS_CODE NEW/ACKNOWLEDGED → CANCELLED, actor/thời điểm | Không coi yêu cầu đã thực hiện; audit ghi rõ UUID hủy; loại khác bị từ chối |
| `outstanding_balance_case` | UPDATE đúng 1 hồ sơ A02: CANCELLED, admin_owner, thêm ghi chú “báo cáo thử nhầm” | Giữ invoice_total/paid_total/outstanding_amount/reason_code/evidence và ghi chú cũ; không ghi mất tiền/write-off |
| `operational_alert` | UPDATE đúng 1 cảnh báo PAYMENT_SHORTFALL của báo cáo nhầm A02 → RESOLVED kèm actor/lý do | **Không chạm** 2 cảnh báo payOS bị migration 40 đóng băng |
| `business_audit_event` | INSERT 2 RETIRE_ARCHIVED_TEST_SESSION, chứa số dư trước/sau, UUID các hàng xử lý và xác nhận không có khách thật | Giữ 19.073 audit intent gốc và audit archive cũ; không ghi WRITE_OFF_BALANCE |
| Intent/request/webhook/idempotency/proof/archive/inbox cũ | 0 INSERT/UPDATE/DELETE từ công cụ | Hai khoản 5.000 VND vẫn PAID theo provider, REQUIRES_RECONCILIATION/OPEN trong hồ sơ chưa ghi sổ |
| Ledger/account/charge/allocation/refund/claim, đơn/bếp/kho/promotion | 0 INSERT/UPDATE/DELETE từ công cụ | Số thu, số hoàn, nợ và mọi số liệu báo cáo lịch sử nguyên vẹn |
| SQLite allocator, sequence orderCode, QR/token, runtime files | Không truy cập ghi hoặc khởi tạo | Không cấp lại/rewind mã cũ |

Migration mới: **`202610260001_retire_archived_test_sessions/migration.sql`**, thứ 41, thêm 1 bảng (tổng 75 bảng nghiệp vụ), FK/index/trigger. Không sửa SQL migration 40 hoặc tắt trigger. Prisma chỉ thêm metadata migration khi operator tự chạy quy trình được duyệt.

## Bảo vệ và điều kiện từ chối

- Dry-run mở transaction **READ ONLY REPEATABLE READ**, cuối cùng ROLLBACK; không recalculate tài chính, không gọi provider/allocator và không tự load `.env`.
- Private plan có UUID đầy đủ, toàn bộ pre-image SQL JSON giữ chính xác microsecond/bigint, database identity, catalog FK, dependency graph và SHA-256. Bundle ở ngoài Git, thư mục 700/file 600, không symlink/ghi đè, fsync trước apply. Plan có hash credential/ciphertext mã tham gia và bằng chứng nhạy cảm; **không gửi plan, dump hoặc runtime archive lên PR/chat công khai**.
- Apply yêu cầu đúng hai UUID bằng `--confirm-sessions`, ADMIN ACTIVE đúng tenant, lý do ≥20 ký tự, plan hash, backup manifest hash và hai xác nhận riêng: tiền thật chưa quyết toán; đã kiểm tra trực tiếp không còn khách/công việc thật. Dữ liệu `last_seen_at` không đủ chứng minh khách đã rời đi.
- Khóa hai session theo thứ tự ổn định, hai table và các pre-image có thể sửa; dùng NOWAIT để từ chối cạnh tranh thay vì chờ vòng deadlock với mở/chuyển bàn. Đọc lại và so hash dưới khóa; drift hoặc bất kỳ hồ sơ sai đều rollback cả hai. Chạy lại cùng xác nhận là no-op, kể cả bàn đã có phiên mới.
- Yêu cầu đúng archive marker ẩn, đúng intent/request 5.000 VND PAID/OPEN/RRECON và không worker lease. Phải không có receipt, allocation, refund, bank claim/preview/evidence, khoản thu khác hoặc chuyển bàn. Account phải khớp charge ledger và không có tiền thu/hoàn/reservation.
- Món/batch chưa terminal, giỏ còn món, kho đang reserve, review chưa xong, outbox chưa publish, chuyển giao support đang chờ, support loại khác, cảnh báo khác hoặc A02 đã IN_RECOVERY/RECOVERED/WRITTEN_OFF: **từ chối**. Không tự phục vụ/hủy món, xác nhận hoàn, hủy giao dịch mới hoặc ghi thiệt hại để vượt điều kiện.
- Trigger mới chỉ cho technical close khi marker đúng scope; không cho thay financial_status, mở lại/chuyển phiên cũ hoặc sửa/xóa marker. Thời điểm đóng lấy trực tiếp từ marker PostgreSQL, không đi vòng JavaScript Date mất microsecond. Constraint deferred chặn marker treo trên phiên ACTIVE hoặc hồ sơ A02 chưa CANCELLED.
- Migration 40 giữ nguyên: webhook vẫn kiểm chữ ký rồi vào inbox riêng, polling/refresh/reference reuse vẫn bị chặn. Marker retirement còn ngăn rollback visibility cũ đưa ngoại lệ của phiên đã retire trở lại hàng đợi. Archive/lịch sử vẫn đọc được, có nhãn “Tiền thật chưa quyết toán”.
- Đọc bill phiên retired dùng account lịch sử, không recalculate/increment version hoặc tạo phiếu thu. CLOSED chỉ có nghĩa kết thúc vận hành; tổng đã thu vẫn lấy từ receipt thực, không từ trạng thái phiên.

## Quy trình operator — chưa thực hiện trên production

Mỗi bước dưới đây cần người vận hành review kết quả trước khi bước tiếp; không chạy thành script tự deploy. Giữ bộ archive PR #6, chứng từ, audit và backup cũ. Tham chiếu [runbook archive](payos-test-archive-20261025.md), [triển khai](../26-trien-khai-qtruongres.md), [PostgreSQL locking](https://www.postgresql.org/docs/18/explicit-locking.html), [backup/restore chính thức](https://www.postgresql.org/docs/18/backup-dump.html).

### 1. Chuẩn bị image và preflight chỉ đọc trên schema 40

Review branch/commit/CI và diff migration 41. Build image maintenance/API/Web từ đúng commit đã duyệt, **chưa start**. Tác vụ này không cung cấp lệnh tự merge. Dùng overlay opt-in PR #6; runtime `/data` read-only, UID10001, read-only root/cap-drop/no-new-privileges và PAYOS_ENABLED=false giữ nguyên. Không truyền API/checksum key trên CLI hoặc in `docker compose config`/`.env` ra log.

```bash
export PAYOS_ARCHIVE_DIR=/srv/qtruongres-private/session-retirement-20261026
sudo install -d -o 10001 -g 10001 -m 700 "$PAYOS_ARCHIVE_DIR"
export ARCHIVE_RESTAURANT_ID='UUID-DAY-DU-CUA-RESTAURANT'

retire_dc=(docker compose --project-name qtruongres \
  --env-file deploy/.env.production -f compose.production.yaml \
  -f deploy/compose.payos-test-archive.yaml --profile maintenance)

"${retire_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-session-retirement.ts --help
"${retire_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-session-retirement.ts \
  --restaurant-id "$ARCHIVE_RESTAURANT_ID" --output /archive/preflight-40
```

Không có `--apply` là chỉ đọc DB. Schema 40 được phép preflight với `migrationReady=false`, **không dùng plan đó để apply**. Kiểm tra riêng các UUID/table/intent/marker, blocker và tài chính trước/sau trong private plan. Nếu trả REFUSED: dừng, cung cấp mã lỗi/số đếm đã che thông tin cho reviewer; không tự sửa DB/plan hoặc bỏ guard.

### 2. Fence writers, backup và thử restore

Operator xác nhận trực tiếp A01/A02 không có khách thật; không còn bếp/kho/support thực sự đang làm. Trong cửa sổ bảo trì được duyệt, fence toàn bộ API/worker/maintenance/webhook writer, kể cả binary cũ/tiến trình ngầm. Công cụ không tự dừng hoặc restart dịch vụ.

Dùng quy trình backup hiện có sau fence:

```bash
pnpm deploy backup --env-file deploy/.env.production \
  --backup-dir /srv/qtruongres-private/backup-before-retirement
```

Lưu dump PostgreSQL, runtime archive, SQLite allocator và cấu hình bí mật riêng. Xác minh SHA-256, chứng từ đúng hash của archive PR #6, high-water allocator và thử restore sang DB/volume **cách ly, rỗng**. Đối chiếu 40 migration, UUID/counts, sổ tiền, audit và 2 marker archive. Không restore đè DB đang vận hành.

### 3. Migration 41 và kế hoạch cuối

Sau phê duyệt migration riêng, dùng maintenance image đúng commit chạy migrate deploy theo bài 26; **không seed/reset**. Xác nhận đủ 41 migration và vẫn fence writers. Không sửa migration 40. Chạy lại dry-run, thư mục mới:

```bash
"${retire_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-session-retirement.ts \
  --restaurant-id "$ARCHIVE_RESTAURANT_ID" --output /archive/final-plan-41
```

Plan phải `migrationReady=true`. Reviewer đối chiếu mọi UUID, số lượng support/người tham gia, hồ sơ A02 đúng là báo cáo thử nhầm chưa được phê duyệt thu hồi/miễn thu, tiền và bằng chứng PR #6. Không có khách/công việc thật là điều kiện xác nhận của người vận hành, không suy ra từ ACTIVE hoặc timestamp.

Sau plan, tạo **backup mới hơn bundle**, thử restore và so target snapshot. Chép ba file vào thư mục riêng để UID10001 đọc, giữ bản gốc:

```bash
export RETIRE_BACKUP_SOURCE='/duong-dan/backup-41-moi-da-thu-restore'
sudo install -d -o 10001 -g 10001 -m 700 "$PAYOS_ARCHIVE_DIR/backup-confirmed"
for retirement_file in manifest.json database.dump runtime-files.jsonl; do
  sudo install -o 10001 -g 10001 -m 600 \
    "$RETIRE_BACKUP_SOURCE/$retirement_file" "$PAYOS_ARCHIVE_DIR/backup-confirmed/$retirement_file"
done
sudo sha256sum "$PAYOS_ARCHIVE_DIR/backup-confirmed/manifest.json"
```

Checksum không tự chứng minh đúng nguồn/restore được: operator phải ghi nhận nguồn backup và kết quả restore. Dry-run đọc phải giống trạng thái đã được duyệt; nếu writer đã thay đổi dữ liệu, tạo lại kế hoạch/backup sau review, không ép hash.

### 4. Apply có xác nhận

Chỉ operator sau phê duyệt riêng mới chạy. Điền plan hash, backup hash và ADMIN UUID đã xác minh:

```bash
export RETIRE_PLAN_SHA='SHA256-PLAN-DA-DUYET'
export RETIRE_BACKUP_SHA='SHA256-MANIFEST-BACKUP-DA-DUYET'
export RETIRE_ADMIN_ID='UUID-ADMIN-ACTIVE-DUNG-RESTAURANT'
"${retire_dc[@]}" run --rm --no-deps payos-state \
  node --import tsx scripts/payos-test-session-retirement.ts --apply \
  --restaurant-id "$ARCHIVE_RESTAURANT_ID" --from /archive/final-plan-41 \
  --confirm "$RETIRE_PLAN_SHA" --operator-id "$RETIRE_ADMIN_ID" \
  --reason 'Chủ dự án duyệt kết thúc đúng hai phiên thử A01/A02, hủy báo cáo A02 tạo nhầm; tiền thật và công nợ chưa quyết toán.' \
  --backup /archive/backup-confirmed --confirm-backup "$RETIRE_BACKUP_SHA" \
  --confirm-sessions ffc78214-13d4-4fd3-adae-dd78d01affd5,300659c7-5fea-4a77-a976-94551b078738 \
  --confirm-no-active-guests --ack-real-test-funds
```

Mong đợi `retired=2`, `financiallySettled=false`, `ledgerChanged=false`, `archivedEvidenceChanged=false`, `allocatorAccessed=false`, `tableStatus=NEEDS_CLEANING`. Chạy lại cùng plan/backup/actor/lý do trả `alreadyProcessed=true`, không đụng bàn/phiên mới. Không tự retry lỗi lock/drift/backup; review rồi quyết định.

### 5. Kiểm tra sau apply, cập nhật API/Web và nghiệm thu

Chỉ đọc: đúng 2 retirement marker; 2 phiên CLOSED/ARCHIVED_TEST_RETIRED; financial_status/account/charge/receipt/allocation/refund/intent/request/webhook/19.073 audit gốc không đổi. Đúng 1 outstanding case A02 CANCELLED, không WRITTEN_OFF, không WRITE_OFF_BALANCE; một shortfall alert của báo cáo nhầm kết thúc, cảnh báo payOS gốc không đổi. Support trong plan CANCELLED, người trong plan LEFT. Hai table NEEDS_CLEANING, QR và allocator hash giữ nguyên.

Tạo và thử restore **backup sau retirement**, chứa đủ schema 41, archive/retirement marker, trigger và runtime. Chỉ sau kiểm tra này operator mới cập nhật/khởi động API/Web bằng image cùng commit đã review theo bài 26, kiểm health và mở lại writer/webhook. Không dùng binary PR #6 cũ để đọc/ghi phiên đã retirement. Không có lệnh tự start/stop trong công cụ.

STAFF xác nhận dọn từng bàn qua giao diện hiện hữu (`POST /core/tables/{tableId}/clean`), bàn AVAILABLE; mở phiên mới (`POST /core/tables/{tableId}/open`). Ghi lại session UUID mới và mã mới khác phiên trước, QR bàn giữ nguyên. Cookie/mã phiên cũ không truy cập phiên mới. Danh sách việc thường không còn blocker test cũ; archive và lịch sử còn nhãn chưa quyết toán. Nghiệm thu gọi món, bếp, kho, bill và thanh toán bình thường trên phiên mới bằng quy trình được duyệt riêng; tác vụ này không giao dịch tiền thật.

### 6. Khôi phục sự cố

Trước apply: có thể giữ schema 41 cộng thêm nhưng chưa có marker, giữ writer fence và quay lại image tương thích PR #6 theo quy trình đã review nếu cần. Sau apply: ưu tiên **roll forward image tương thích 41**, không DELETE marker, không mở lại phiên cũ, không đổi CLOSED thành PAID và không chạy rollback visibility PR #6 cho hai hồ sơ retired.

Nếu có giao dịch/phiên mới sau backup, **không restore backup cũ đè chúng** và không phục hồi SQLite cũ làm lùi watermark. Clone backup mới nhất vào target cách ly, đối chiếu mọi phát sinh sau backup, merge/cutover chỉ sau review tài chính và allocator. Khôi phục hạ tầng bằng backup sau retirement giữ đầy đủ hai lớp marker/trigger. Nếu operator cho rằng đã chọn sai phiên hoặc sai xác nhận, fence writers và review pre-image/audit; không có cờ undo/force/write-off tự động. Kết thúc vận hành không giải quyết quyền sở hữu hai khoản 5.000 VND; quyết toán chúng là nghiệp vụ riêng cần bằng chứng/phê duyệt.

## Kiểm chứng và trạng thái bàn giao

Kết quả cuối cùng và các giới hạn được ghi trong [bằng chứng kiểm thử](payos-test-session-retirement-verification.json). Test mới dùng đúng UUID cố định nhưng **toàn bộ nội dung tổng hợp**, không nạp dữ liệu production. Giữ nguyên Quality Gate, không bỏ test/giảm assertion. Chưa merge/deploy/migrate hoặc đóng phiên production; mọi thao tác production thuộc cổng phê duyệt của operator.
