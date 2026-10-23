# Kế hoạch làm mới dữ liệu vận hành payOS: DB mới và kho lịch sử chỉ đọc

## Trạng thái chuẩn bị M2/M3 — 23/10/2026

Nhánh `feat/payos-payment-platform` đã có allocator M1, shared posting/chứng từ ngân hàng M2 và UI/rehearsal M3. Kết quả cuối xem [bài 15](../15-doi-chieu.md). **Kế hoạch làm sạch vẫn chỉ đọc và giữ dữ liệu mặc định; không có quyền reset hoặc công cụ xóa tự động.** Không cần reset DB để đưa M2 vào dùng: phương án ưu tiên là migrate cộng thêm bốn bảng trên DB hiện tại sau backup/review, giữ nguyên lịch sử tiền thật.

Tài liệu này là **runbook chuẩn bị và các điều kiện dừng**, không phải lệnh reset. Công cụ kèm theo chỉ inventory/dry-run bằng SELECT trong transaction READ ONLY; không có DELETE, DROP, TRUNCATE, reset executor, migration runner hoặc khả năng chấp thuận giao dịch. Chưa truy cập, phân loại hay làm mới production trong phần công việc này.

## 1. Quy tắc giữ dữ liệu

- Mọi payment intent có dấu hiệu payOS/ONLINE, provider reference, payOS request hoặc giao dịch payOS đều được xem là **PROTECTED / UNKNOWN**. Pending, thất bại, hủy hoặc chưa ghi sổ không chứng minh đó là dữ liệu demo; giao dịch có thể đã tới ngân hàng nhưng xử lý chưa hoàn tất.
- Mọi receipt/refund/allocation và tài khoản tài chính phiên đều phải được lưu cùng lịch sử. Nhãn SUCCEEDED trong DB không tự chứng minh ngân hàng đã chuyển/hoàn tiền; đây vẫn là hồ sơ cần bảo toàn.
- Dữ liệu còn lại chưa có chứng cứ nguồn gốc được giữ dưới trạng thái **UNKNOWN / RETAIN**. Không suy luận demo từ tên nhân viên, mã bàn, giá nhỏ, thời điểm seed hoặc tài khoản do người phát triển tạo.
- Công cụ luôn trả `automaticDemoDeleteEligibleCount=0`, `executionSupported=false`, `destructiveResetAuthorized=false`. Không có chế độ `--execute` hoặc `--approve`.
- Mặc định ưu tiên tạo **database vận hành mới**, giữ nguyên database cũ và bản sao lưu đã kiểm chứng. Không “dọn” từng bảng tài chính trong database đang dùng.

## 2. Inventory chỉ đọc

Môi trường chạy phải được người vận hành cấp sẵn DATABASE_URL và RESTAURANT_ID bằng cơ chế riêng tư. Công cụ không đọc tệp env; không truyền URL có mật khẩu qua đối số, không sao chép cấu hình/khóa vào chat hoặc repository. Dùng tài khoản DB chỉ đọc là lớp bảo vệ bổ sung; công cụ tự mở `REPEATABLE READ READ ONLY`, giới hạn statement 5 giây, lock 1 giây và luôn ROLLBACK/release.

Từ thư mục gốc repository trong môi trường kiểm tra đã được cấu hình riêng tư:

```bash
pnpm --filter @thesis/api exec node --import tsx ../../scripts/payos-demo-reset-plan.mjs --dry-run --target-label before-fresh-database
```

Đây là lệnh duy nhất được công cụ hỗ trợ; nó không tạo payment link hoặc gọi payOS. Người vận hành phải kiểm chứng mình đang trỏ đúng môi trường trước khi chạy; target-label là nhãn cho người đọc, **không tự xác thực danh tính database**. Không tự chạy lệnh này trên production khi chưa có quyền đọc cụ thể.

Kết quả chỉ gồm số đếm, boolean, trạng thái cố định và `planHash`. Các số đếm gồm phiên/hóa đơn đã chốt, lượt gọi món/món, chứng từ đã gắn, cảnh báo, receipt/allocation/refund và payOS báo nhận chưa ghi sổ đủ (kể cả đã ghi sổ một phần). Không có tài khoản ngân hàng, reference, paymentLinkId, orderCode, tên khách, UUID gốc, credential hoặc lỗi SQL thô. Webhook payOS chưa gắn được nhà hàng/receipt được đếm riêng để không bỏ sót lịch sử chưa định tuyến. Dữ liệu của các nhà hàng khác không được phân loại demo; khi lưu toàn database phải giữ chúng nguyên vẹn.

`planHash` là biên nhận review của phạm vi, snapshot thời gian server và các số đếm. Nó **không phải token thực thi**, không thay thế manifest đầy đủ của backup và không chứng minh từng hàng bất biến. Một thay đổi mới sau inventory đòi hỏi freeze/re-inventory/review lại; công cụ không kiểm chứng backup, order-code high-water, channel mapping hoặc webhook cutover.

## 3. Chuẩn bị backup và thử khôi phục

1. Chốt phạm vi bằng văn bản: môi trường, nhà hàng, commit/schema, mục đích DB mới, phần danh mục/tài khoản quản trị được giữ và ai có quyền phê duyệt. Khoản tiền thật đang tồn đọng vẫn phải có người phụ trách đối soát.
2. Người vận hành lập kế hoạch thời điểm dừng ghi nghiệp vụ/thu tiền mới; chưa thực hiện trong giai đoạn lập kế hoạch. Không dùng việc ngừng UI làm bằng chứng worker/webhook/polling đã dừng ghi.
3. Lưu bản backup đầy đủ DB cùng runtime uploads/chứng từ/ảnh và allocator state theo cơ chế backup hiện có đã được review. M1 nhận đúng file `/data/payos-state/order-codes.sqlite` trong runtime_data; phải cold-copy sau khi mọi allocator/application writer đã dừng. CLI backup từ chối khi migrate hoặc payos-state đang chạy; WAL/SHM/journal hoặc entry lạ làm helper dừng, không được bỏ qua/xóa chúng. Writer ở checkout/máy khác phải được fence riêng. Secret được giữ riêng trong kho bí mật; không đưa env, backup riêng tư hoặc ảnh chứng từ vào Git.
4. Tạo manifest riêng tư gồm checksum SHA-256 của backup và runtime archive, thời điểm, schema/commit, phạm vi, row counts và số liệu tài chính cần đối chiếu. Không công khai dữ liệu gốc trong log.
5. Restore vào môi trường cách ly hoàn toàn, không gắn volume production, không có webhook công khai/worker thu tiền thật và không cấp quyền gọi merchant thật. Kiểm chứng restore kết thúc thành công, khóa ngoại và lịch sử transaction/allocation/refund/account, quyền đọc, ảnh/chứng từ và các tổng đối chiếu. Khôi phục được tệp không đồng nghĩa khôi phục được nghiệp vụ. Đối với allocator, restore gói cũ có thể rewind high-water; cả gói có state cũ và gói legacy thiếu state đều cần upper bound độc lập từ mọi DB/archive/provider và state mới hơn còn giữ. Không bật payOS hoặc initialize từ max của DB vừa restore khi chưa chứng minh được giới hạn đó.
6. Nếu thiếu backup, không khớp checksum, restore chưa đạt hoặc số liệu chưa khớp: **dừng**, không làm mới DB.

Không có bước nào ở đây cho phép xóa database cũ. Bản archive phải có quyền chỉ đọc thật ở DB/storage, không chỉ là tên thư mục “archive”. Chỉ người vận hành đã được phê duyệt mới thực hiện thay đổi hạ tầng theo quy trình triển khai riêng.

## 4. Danh mục được chuyển và mã orderCode không được tái sử dụng

DB mới được tạo riêng, áp dụng migration/schema theo quy trình triển khai được duyệt. Chỉ chuyển danh mục/tài khoản được chủ dự án chốt bằng whitelist và công cụ import có kiểm tra; không copy hay seed hàng loạt giao dịch mô phỏng vào sổ tiền vận hành mới.

**Không cho sequence orderCode quay về đầu khi vẫn dùng cùng kênh payOS.** Phải có manifest riêng tư bao trùm mọi mã đã phát hành trên các DB cũ của kênh đó, kể cả CREATE_PENDING, thất bại, link hủy và kết quả mạng không xác định. Giá trị lớn nhất trong mỗi DB có thể chưa phản ánh toàn bộ lịch sử provider.

M1 đã chọn hướng allocator ngoài vòng đời DB ứng dụng: production cố định `PAYOS_ORDER_CODE_STORE=/data/payos-state/order-codes.sqlite` trên runtime_data, dev mặc định repo/var/payos-state/order-codes.sqlite ổn định theo import.meta.url. Sequence PostgreSQL cũ được giữ lại nhưng service mới dùng SQLite; M1 không thêm migration. Trước cutover vẫn phải kiểm chứng đầy đủ thiết kế, mount persistent, namespace và watermark:

- Bộ cấp mã đơn bền vững dùng chung ngoài vòng đời DB mới, giữ high-water đã xác nhận và không bao giờ cấp lại mã lịch sử; hoặc
- Kênh thanh toán mới hoàn toàn với danh tính/khóa và routing tách biệt do người vận hành chủ động thiết lập và phê duyệt. Thay kênh không được làm mất đường xử lý link/webhook của kênh cũ.

Không suy ra high-water từ các số đếm trong dry-run. Công cụ inventory không cấp mã, đọc/xuất mã đầy đủ hoặc thay sequence. CLI initializer riêng `scripts/payos-order-code-store.ts` chỉ chạy action initialize tường minh với watermark số nguyên an toàn do operator đã kiểm chứng cùng `--confirm-channel-history`; không tự chọn DB max hoặc mặc định lịch sử merchant là trống. Nó đọc max DB trong transaction READ ONLY/ROLLBACK, từ chối watermark thấp hơn DB rồi đóng kết nối trước khi ghi allocator; existing namespace không bị hạ xuống. Cờ confirm chỉ là attestation của operator, không xác minh archive/provider tự động. Nếu namespace/high-water chưa sẵn sàng, **chưa được chuyển DB**.

### Xem trợ giúp maintenance, chưa phải khởi tạo

Service `payos-state` dùng maintenance image UID 10001, root filesystem read-only và runtime_data mount. Lệnh mặc định chỉ in --help; không tự initialize hoặc chạy cùng API. Có thể xem hướng dẫn trong môi trường/image đã chuẩn bị:

```bash
docker compose --env-file deploy/.env.production -f compose.production.yaml --profile maintenance run --rm --no-deps payos-state
```

Không có DB/store write hoặc provider call trong --help; Compose vẫn chạy một container maintenance ngắn và không tự bật PostgreSQL nhờ --no-deps. Mẫu initialize có placeholder và các điều kiện dừng được giữ tại [bài 26](../26-trien-khai-qtruongres.md), không đưa số watermark đoán hoặc giá trị 0 cho kênh hiện hành vào runbook này. Trước initialize phải fence mọi old/new writer, kiểm chứng upper bound đầy đủ và có phê duyệt riêng cho đúng hồ sơ cutover. Store mất/hỏng không được tự tạo lại chỉ vì DB vừa được làm mới.

## 5. Webhook đến muộn và nguyên tắc một writer

Trước chuyển DB phải có registry riêng tư, bất biến, liên kết **channel/restaurant + orderCode + paymentLinkId** với miền dữ liệu cũ/mới; reference ngân hàng dùng cho idempotency. Không định tuyến bằng mã bàn, tên khách, số tiền hoặc chỉ orderCode khi namespace có thể trùng.

Chỉ có **một endpoint/writer đang hoạt động cho mỗi kênh**. Endpoint xác minh chữ ký trước, tra registry rồi:

- Giao dịch thuộc miền vận hành mới: chuyển tới luồng ghi sổ hiện hành, vẫn giữ đầy đủ identity, amount, recipient, allocation và idempotency.
- Giao dịch thuộc archive: lưu vào inbox/queue vận hành **append-only riêng**, không ghi trở lại DB archive chỉ đọc và không trộn vào hóa đơn của DB mới. Chỉ ACK thành công khi sự kiện đã được giữ bền vững. Việc xử lý tiếp theo thuộc luồng đối soát có chứng cứ; không tự sửa phiếu đã chốt.
- Chữ ký hợp lệ nhưng chưa định tuyến được: giữ nguyên bằng chứng trong vùng cách ly có kiểm soát, đưa vào ADMIN để xác minh. Không gọi đó là demo, không bỏ sự kiện và không ép thành công.
- Chữ ký không hợp lệ: từ chối theo quy tắc bảo mật; không tạo receipt, allocation hoặc mapping tin cậy.

Worker/polling/instance cũ không được tiếp tục ghi song song vào archive. Quyền chỉ đọc phải được áp dụng cho tất cả đường ghi cũ, không chỉ webhook. Cần thử trước trên dữ liệu giả: link cũ trả tiền sau cutover, webhook lặp, refresh lặp và sự kiện chưa định tuyến.

Runbook này **không triển khai registry/dispatcher/inbox**. Nếu các thành phần đó chưa có và chưa kiểm thử, kế hoạch phải dừng tại đây dù backup đã đạt.

## 6. Phê duyệt thủ công cuối cùng

Trước thao tác tạo/chuyển DB, chủ dự án cần chốt một hồ sơ review cụ thể gồm:

- Plan hash mới nhất, nhãn/phạm vi đúng, commit/schema và thời điểm cutoff đã được xác nhận.
- Checksum manifest backup/runtime; biên bản restore cách ly đạt và các số liệu đối chiếu.
- Whitelist danh mục/tài khoản được import; bảng phân loại lịch sử chưa rõ và cách giữ nguyên.
- Thiết kế order-code namespace/high-water, registry/routing digest, một webhook writer và đường nhận sự kiện cũ.
- Danh sách khoản thật chưa giải quyết; người phụ trách và cách bảo toàn chứng cứ.
- Lịch chuyển đổi, người thực hiện, tiêu chí thành công/dừng và phương án rollback.

Phải có **đồng ý rõ ràng của người dùng với hồ sơ này** trước thay đổi hạ tầng/dữ liệu. Yêu cầu làm công cụ, câu “tiếp tục” hoặc việc đọc planHash không phải phê duyệt reset. Công cụ không nhận phê duyệt và không có khả năng thực thi ngay cả khi đã có chữ ký con người.

## 7. Nghiệm thu và rollback

Sau cutover được thực hiện riêng bởi người vận hành, kiểm chứng người dùng/quyền truy cập, danh mục, QR, trạng thái không thu lại tiền, tổng thu/phân bổ/hoàn, chứng từ, inbox và định tuyến link cũ. Chỉ thử giao dịch tiền thật khi chủ dự án phê duyệt riêng.

Nếu chưa có nghiệp vụ/tiền mới, rollback có thể quay lại snapshot/routing cũ theo kế hoạch đã duyệt. Nếu đã có giao dịch mới, **không restore đè DB cũ rồi tiếp tục bán hàng**: việc đó có thể mất tiền đã nhận và dẫn tới thu trùng. Cần giữ cả hai lịch sử, freeze ghi có kiểm soát, bảo toàn inbox mới, đối chiếu các sự kiện bằng khóa provider/idempotency rồi lập kế hoạch phục hồi được duyệt. Không xóa transaction hoặc tự sửa tổng account để làm số liệu khớp. Tuyệt đối không rewind allocator theo rollback DB; một store từ backup cũ có thể thấp hơn các mã đã reserve/phát hành sau snapshot. Phải giữ state mới hơn hoặc khôi phục upper bound độc lập đã chứng minh trước khi cho tạo mã tiếp. Nếu thiếu nguồn chứng minh thì giữ writer dừng, không initialize từ sequence/DB max mới.

## 8. Phạm vi kiểm chứng của phần chuẩn bị

Các test inventory dùng fake DB, kiểm tra READ ONLY/timeouts/ROLLBACK, scope, phân loại PROTECTED/UNKNOWN, redaction, fail-closed và việc từ chối mọi cờ thực thi. Allocator/initializer có unit tests bằng store tạm và DB giả; cold backup/restore state có kiểm thử riêng. Kết quả thực chạy và giới hạn được chốt tại bài 15, không suy từ văn bản runbook. Chúng không chứng minh dữ liệu production đã được phân loại hay backup/restore production đã đạt. Các bước hạ tầng, chuyển DB, provider routing và giao dịch thật ở trên đều là điều kiện cần review, không phải thao tác đã thực hiện.

## 9. Rehearsal bảo toàn chứng từ ngân hàng — 23/10/2026

Có công cụ tái hiện **chỉ dành cho lab tổng hợp**: `scripts/payos-platform-rehearsal.mjs`. Công cụ không đọc `.env`, không nhận backup/volume/database tùy ý, không gọi merchant/payOS và không chạy Compose hay start/stop container. Trước kết nối, nó kiểm tra Docker socket local, tên và nhãn lab, tmpfs không có volume/bind mount, cổng loopback khớp DATABASE_URL và credential cố định chỉ dành cho fixture. Database do công cụ tạo có prefix `thesis_platform_` + mã ngẫu nhiên; cuối lượt chỉ xóa đúng các database vừa tạo và thư mục tạm riêng.

Lượt đã chạy dùng container `qtruongres-payos-receipt-lab-20261023`, nhãn `codex.task=payos-receipt-m2-20261023`, PostgreSQL ghim digest trong dự án, cổng loopback `64374` và tmpfs. Nếu tái chạy, phải có lab tương ứng; không đổi tên/nhãn container production để vượt guard. Lệnh chạy từ repository trong Linux/WSL với Node đã chọn:

```bash
env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL='postgresql://isolated_test:isolated_platform_test_only@127.0.0.1:64374/postgres' \
  node --import tsx scripts/payos-platform-rehearsal.mjs \
  --isolated-rehearsal --container qtruongres-payos-receipt-lab-20261023
```

Credential trong lệnh là fixture công khai, không phải cấu hình vận hành. Công cụ từ chối credential khác và mọi DATABASE_URL không trỏ đúng lab tmpfs đã kiểm tra. Nó không tạo container; việc chuẩn bị/xóa lab thuộc người chạy, không dùng project Compose production. Output gồm boolean, số đếm và vị trí source nếu lỗi; không in SQL, account, reference, ảnh, token preview hoặc nội dung database.

| Kiểm chứng thực chạy | Kết quả |
| --- | --- |
| `pg_dump --format=custom` và `pg_restore --single-transaction --exit-on-error` trên database tổng hợp | Khôi phục đủ **71 bảng**; hash toàn bộ hàng/bảng và số đếm trước/sau bằng nhau |
| Chứng từ mới | Giữ nguyên `payment_bank_proof`, `payment_bank_preview`, `payment_bank_evidence`, `bank_receipt_claim`, receipt/allocation/outbox/audit; fixture có một chứng cứ đã xác nhận và một canonical claim |
| Dữ liệu tài chính | Đã ghi sổ 10.000đ, còn phải thu 10.000đ, cần hoàn 0đ trước/sau bằng nhau; `provider_status=PENDING` vẫn giữ riêng nguồn ADMIN, không bị sửa thành provider PAID |
| Tệp chứng từ/runtime | SHA-256 proof khớp descriptor trong DB; file backup/proof 600, thư mục proof 700; allocator đi cùng cold archive |
| Restore vào database/runtime đã có dữ liệu | Bị từ chối trước khi ghi đè; không có tùy chọn overwrite |
| Lỗi restore file sau khi database đã restore | Báo rõ tài nguyên có thể đã khôi phục một phần, writer không được tự chạy; dữ liệu DB khôi phục còn nguyên để kiểm tra; chỉ thử lại bằng target rỗng mới |
| Archive/backup bị sửa | Checksum không khớp bị từ chối trước restore |
| Kho lịch sử READ ONLY | PostgreSQL từ chối UPDATE bằng SQLSTATE 25006 trong transaction READ ONLY |
| Rollback allocator | Restore đè runtime đang giữ state mới bị từ chối; state live tiếp tục tăng. Bản restore cũ chỉ được đưa lên trên high-water mới đã chứng minh từ state live tổng hợp, không tiếp tục cấp mã từ watermark cũ |

Bốn unit test riêng trong `scripts/payos-platform-rehearsal.test.mjs` kiểm parser, tên/nhãn/URL/cổng/mount và việc lỗi sớm không lộ cấu hình. Mười integration test của shared posting/DB guards kiểm tiền dư, cross-provider duplicate, concurrency, rollback giao dịch, tenant scope và lịch sử chứng cứ bất biến. Các kiểm thử này dùng dữ liệu tổng hợp; **không chứng minh backup production đã chạy hoặc số liệu production đã đối chiếu**.

Inventory chỉ đọc hiện đếm thêm `admin_bank_proof_records`, `bank_preview_records`, `bank_evidence_records`, `bank_receipt_claims`. Chứng từ chưa xác nhận và preview hết hạn cũng được giữ trong inventory; không tự suy luận được phép xóa vì chưa ghi sổ. Full DB backup giữ cả bốn bảng; runtime archive giữ file ADMIN proof trong cùng `payment-proofs` có kiểm soát quyền, không đưa vào ảnh công khai.

Rehearsal không thực hiện chuyển database, đổi webhook writer, archive routing hoặc rollback production. Với hồ sơ chưa đủ chứng minh dòng nào là demo hoặc chưa có mapping link cũ, phương án an toàn là giữ nguyên lịch sử vận hành và hoãn làm sạch. Không dùng kết quả PASS của lab làm quyền reset DB hoặc mất lịch sử tiền thật.

## 10. Quyết định làm sạch trước production

Ưu tiên **giữ DB vận hành hiện tại và toàn bộ lịch sử tài chính**, đưa ảnh/dữ liệu thử vào danh sách review riêng; không reset để sửa lỗi payOS. Inventory đếm cả bank_proof/preview/evidence/claim và luôn giữ trạng thái UNKNOWN/PROTECTED. Muốn xóa một bản ghi phi tài chính phải có manifest từng hàng, xác nhận nguồn gốc và kiểm tra liên kết; chưa có manifest từ dữ liệu thật thì không có danh sách được phép xóa. Không suy luận demo từ tên/tuổi/giá.

Nếu chủ dự án sau này chọn DB mới, các điều kiện ở phần 3–8 là cổng bắt buộc: backup restore đã đối chiếu, khoản provider/tiền thật/hoàn chưa xử lý bằng 0 hoặc giữ hồ sơ xử lý có trách nhiệm, archive quyền đọc, mapping order/link được lưu, một writer duy nhất, unknown webhook giữ inbox và allocator không lùi. Hiện chưa có dispatcher archive tự động; không được cutover cùng channel và coi dữ liệu cũ đã hết trách nhiệm. Có thể giữ DB hiện tại cho tới khi kế hoạch routing/archive bổ sung được nghiệm thu, hoặc dùng channel độc lập đã được chủ dự án cấu hình riêng. Không chạy reset/drop/truncate từ tài liệu này.

Bản backup phải giữ đồng bộ bốn bảng M2, ledger/allocation/refund/audit/webhook và tệp proof private. Preview là credential ngắn hạn nên archive phải được bảo vệ như dữ liệu ngân hàng. Không đưa dump/proof/SQLite vào Git. Sau khi có BANK_ADMIN_VERIFIED, rollback code chỉ tới phiên bản M2 tương thích; lỗi triển khai giữ writer dừng, không restore snapshot cũ đè khoản thu/hoàn mới và không hạ allocator.
