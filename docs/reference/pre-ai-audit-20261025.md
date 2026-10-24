# Rà soát hệ thống trước AI — 25/10/2026

## Baseline và ranh giới

Source `main`: `67ad44681e4c43b55478d997ed44ded880034c71`; working tree sạch trước audit; PR #3/#4 đã merge. Branch `chore/pre-ai-system-audit`; giữ checkout detached cũ. Node 24 / pnpm 12.3.4 / Next 16.4.1 / Fastify / PostgreSQL / Prisma; giữ nguyên lockfile, policy dependency, Docker production và guard payOS. Có 38 migration trước audit; bổ sung một migration additive thành 39.

Tài liệu README/00/15/26 có câu trạng thái trước merge/deploy được ghi từ các đợt cũ. Đợt này thêm mốc hiện hành và phân biệt lịch sử; không khẳng định đã đọc hoặc nghiệm thu production DB. Chỉ đọc metadata Docker để tách target: qtruongres live, database dev ở cổng 5433, PostgreSQL test tmpfs riêng cổng 55439. Không dùng DB dev/live cho test.

## Phát hiện và sửa

| Mức | Bằng chứng / nguyên nhân | Xử lý |
| --- | --- | --- |
| P2 | interface.css đặt `.guest-bill-item > div` thành flex, header còn grid | Chỉ đặt grid cho dòng món; giữ mobile header ẩn. Browser kiểm tra tọa độ cột và overflow 1440/768/390/320 |
| P2 | payment-requests bắt `method`; UI chọn phương thức để gọi nhân viên | Client chỉ gửi UUID thao tác, không gán CASH. STAFF chọn lúc thu. Tương thích method cũ và giữ payOS riêng |
| P2 | Không có retry identity sau khi request kết thúc | Mapping bền vững theo guest+UUID; session lock, alias khi tái dùng request, hash nội dung, FK, replay terminal. Không dùng nội dung giống nhau làm idempotency key |
| P2 | GET QR chỉ có ADMIN dù STAFF cần cho khách quét | STAFF đọc đúng QR hiện hành, tenant/active/expiry/no-store; POST tạo/rotate vẫn ADMIN. Không mở phiên khi xem |
| P2 | Phiếu in nhiều khối tiền rỗng/lặp và giải thích nội bộ | Rút gọn presentation, giữ VAT snapshot, phân bổ thật, thiếu tiền, tiền thừa chưa trả, refund và tiền chưa xác minh |
| P2 | Phiếu toàn món EXEMPT vẫn có nhãn “Đã gồm VAT” | Test đỏ trước sửa; nhãn dựa nhóm TAXABLE thực có, không sửa thuế/tiền snapshot |
| P3 | Tài liệu ghi trạng thái cũ lẫn hiện hành | Thêm mốc source/giới hạn và cập nhật API/UX; không gán trạng thái production từ source |

Chưa phát hiện P0/P1 mới trong phạm vi code và các bộ test đã thực hiện. Điều này không chứng minh mọi nhánh nghiệp vụ hoặc cấu hình live đều đã được kiểm tra thủ công.

## Kiểm chứng theo mốc

- A: Hai regression trước sửa thất bại HTTP 400; sau sửa 35/35 payment-collection integration đạt. Bao gồm 6 request đồng thời, alias, replay sau resolve, thao tác mới cùng nội dung, guest khác, key malformed/conflicting; không tạo intent/transaction.
- B: 8/8 test render phiếu: VAT đã gồm, không dòng tiền rỗng, snapshot bất biến, cash tender/change, khoản ngân hàng chưa xác minh, legacy không bịa thuế, nhiều mức VAT và discount, tiền thừa chưa trả.
- C: Hai regression trước sửa bị 403; sau sửa 12/12 table-access integration đạt. Kiểm tra STAFF/admin, kitchen/anonymous, POST bị chặn, hết hạn, inactive/cross-tenant, không đổi token hoặc tạo phiên.
- Unit/check: format/lint/typecheck và 400/400 unit /46 files đạt ở lượt source cuối.
- Quality coverage: 675/675 /47 files, line 92,44%. Đây là API unit + integration, có phần trùng với unit; không cộng các bộ thành số test độc lập.
- Secrets: basic check đạt; audit dependency không có high/critical, còn 5 low/6 moderate. Không đổi ngưỡng/policy để bỏ qua.
- Deployment tool tests: 29 đạt, 0 lỗi, 1 skip smoke image theo cấu hình hiện hữu khi chưa truyền image. Chưa gọi deploy/migrate live.
- Browser: mốc đầu 26/30 desktop; mock còn ép method, nhãn bill cũ và phát hiện mobile header tràn đã được sửa. Mốc sau 95/99; assertion tọa độ mới phát hiện gap header/row lệch 12px, đã đồng nhất gap; một thao tác fill rỗng Safari không lặp lại trong 3 lượt nguyên test. Hai tình huống Safari (layout + tiền) lặp 3 lần đạt 6/6, giữ assertion và code ô tiền. Lượt full đầu được dừng khi phát hiện bill compact làm mất chi tiết cash/refund cần thiết; đã giữ số dư sau hoàn khi có nghĩa vụ tài chính, thêm cash detail gọn cho nhiều khoản thu và giữ kiểm tra 0đ sau hoàn. Hai luồng cash/refund + payOS live giả đạt 6/6 trên ba browser. Full 504 lượt trên snapshot sau sửa đang chạy; chưa gọi PASS.
- Web build: Next 16.4.1 production build trong lab đạt 7 route. API/maintenance image UID10001 và fresh CI đang kiểm chứng; chưa dùng image cũ làm bằng chứng source mới.
- Công cụ safety: 40/40 Node tests với `--import tsx` đạt. Fixture bootstrap trước đây thiếu package.json ESM của API, đã bổ sung đúng môi trường giả; không đổi tool production hoặc gỡ redaction. Lượt gọi thiếu loader trước đó không được tính PASS.
- AI scaffold: TypeScript/Python validators đều đạt 36 mẫu tổng hợp (24/6/6), không đo chất lượng model.

## Phạm vi nghiệp vụ đã đối chiếu

| Nhóm | Code/kiểm chứng | Giới hạn |
| --- | --- | --- |
| Auth/tenant | auth/index identity đọc user/restaurant/role còn hoạt động; hooks Origin/CSRF, JWT/version, role permission; suite backend | Chưa kiểm cấu hình cookie/tunnel live |
| Bàn/khách/hỗ trợ | session() khóa identity phiên; guest() kiểm trạng thái; table-access/support/transfer tests | Quét camera điện thoại thật chưa nghiệm thu |
| Menu/combo/kho | combo.service, product_catalog_available, recipes/reservation và combo/catalog/inventory/restaurant-history suites | Không xác minh định lượng công thức/ảnh món bằng khảo sát nhà hàng thực tế |
| Đơn/bếp/hủy | transition/charge/reservation tests trong core/review/policy/order-history | Không coi coverage là exhaustive interleaving proof |
| Tiền/VAT/ưu đãi | ledger giữ receipt; outstanding từ allocation; pricing/promotion/payOS/bank-evidence tests | Không phải tư vấn pháp lý hoặc nghiệm thu merchant live |
| Workforce/payroll | backend/SQL guards và workforce/pay/history suites trong coverage | Quy chế lương/thuế/ngày lễ áp dụng thực tế cần chủ dự án xác nhận; không đổi chính sách nhân sự trong audit UX |
| Notifications/close | maintenance không chồng interval; closeReadiness dùng chung preview/mutation, chặn nợ/refund/intents/tasks | Worker cũ có thể được gọi lại; không hardcode bỏ qua bàn lịch sử |
| AI foundation | READ ONLY transaction, guest auth không heartbeat, tools allowlist/projection/minimum data, core ghi tách riêng; assistant/read-surface suites | Không có model/eval chất lượng thực, adapter JS cùng tiến trình phải được tin cậy |

## Dữ liệu cũ: chưa thực hiện trên production

Giữ PostgreSQL hiện hành. Các cảnh báo A01/A02 và webhook chưa khớp trong ảnh không tự được phân loại test từ số tiền/mã bàn. Không chạy DELETE/TRUNCATE, không fake PAID/REFUNDED/RECONCILED và không ẩn nghĩa vụ tài chính. Dùng inventory READ ONLY hiện có trong `scripts/payos-demo-reset-plan.mjs`; kết quả chỉ là hồ sơ review, không cấp quyền ghi. Mặc định UNKNOWN/PROTECTED được giữ nguyên. Chưa có dữ liệu confirmed-test theo từng hàng để vận hành archive executor, nên không xây đường tắt ẩn ngoại lệ.

Operator cần cung cấp inventory đã che dữ liệu riêng và whitelist có căn cứ, phân biệt archive vận hành với financially resolved. Khi chưa có manifest này, phần dọn production là **BLOCKED/NEEDS OPERATOR ACTION**, không phải hoàn tất. Không cần sửa từng giao dịch test để test mới; nhưng các receipt/webhook thật hoặc chưa rõ vẫn được bảo toàn và worker vẫn phải idempotent.

## Cấu trúc, migration và nguồn dữ liệu

Giữ kiến trúc monorepo hiện có, không đổi framework/DB. Migration mới `202610250001_payment_assistance_retries` chỉ thêm bảng mapping/FK/index, không sửa SQL cũ hoặc snapshots/allocator. Giá/ảnh/thành phần vẫn dùng catalog/runtime store hiện hành; không trộn upload/proofs vào source. Không thêm đường ghi cho AI. Giữ thư mục nguồn đồng bộ chỉ đọc và dữ liệu provenance nghiên cứu.

## Dung lượng máy phát triển

Kiểm kê riêng Windows/WSL/Docker. Chỉ dọn 39 output build Next cũ có marker build, Git-ignore, hơn 24h, đường dẫn tuyệt đối trong apps/web và không có process host dùng. API/web production không bind-mount source. Đã xóa 2.302.969.510 byte apparent; WSL free tăng thực 2.361.290.752 byte trong cửa sổ đo. Không suy thành ổ C tăng bằng đó. Đo Windows trong lúc chuẩn bị lab: 84,54 GiB trống/274,86 GiB; số này biến động khi build/test. Không prune Docker, xóa volumes/image rollback, backup, var, proofs, SQLite hay file cá nhân. Docker báo build cache 34,26GB nhưng ownership/rollback chưa đủ căn cứ để tự dọn.

## Kế hoạch production để review, chưa thực thi

1. Chốt commit/image được nghiệm thu và đọc baseline/migration đã áp dụng của production bằng công cụ chỉ đọc. Giữ DB hiện hành, không seed/reset.
2. Build image tag theo commit trong môi trường build riêng; kiểm non-root/read-only và migration đóng gói đọc được. Build lỗi chưa dừng live.
3. Operator lên lịch cửa sổ phù hợp; fence writers khi backup/cutover yêu cầu. Backup PostgreSQL, menu-images/payment-proofs và SQLite allocator cùng manifest/hash/quyền. Kiểm cả sidecars và các writer ngoài CLI.
4. Diễn tập restore vào target mới cách ly; đối chiếu tiền/snapshot/hash và upper bound orderCode độc lập. Không bật cùng merchant hoặc restore đè live.
5. Review migration additive mới và image maintenance tương thích; chỉ operator áp vào đúng DB sau backup. Không khởi động API mới nhận request UUID trước migration.
6. Start/cutover bằng image đã duyệt; kiểm health, auth, menu/ảnh, guest support, STAFF QR, bill và workflow không tiền. Readiness HTTP không thay kiểm allocator/merchant binding.
7. Giao dịch payOS thật đầu tiên chỉ do operator chủ động duyệt và thực hiện. Tạo phiên mới, đối chiếu ledger/allocation/due, STAFF/GUEST và replay; không dùng test cũ làm bằng chứng hệ thống mới đã đúng.
8. Rollback chỉ về code M2/hotfix chữ-số tương thích và giữ DB/schema additive, mapping, receipt/claim mới, runtime/proofs/allocator. Không restore snapshot cũ đè giao dịch mới hoặc rewind watermark. Phiên bản cũ không dùng UUID mapping nên không bảo đảm retry UX của client mới; phải ngăn request mới trong cửa sổ rollback và review lại.
9. Dọn dữ liệu production là phê duyệt riêng theo manifest; không nằm trong deploy source.

## Nguồn tham khảo

Truy cập 25/10/2026. KiotViet phân biệt phiếu tạm tính/phiếu thanh toán và khổ K80; Sapo POS cho nhóm thông tin món, tiền/thuế, phương thức và tiền thừa. Áp dụng cách tổ chức thông tin, không coi là chuẩn pháp lý hoặc sao chép thương hiệu.

- https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thiet-lap/quan-ly-mau-in/
- https://help.sapo.vn/cau-hinh-mau-in-hoa-don-tai-quay-pos
- https://payos.vn/docs/ — giữ xác minh provider/backend, không tin frontend return.
- Next.js 16.4.1 docs cài kèm `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` và `05-server-and-client-components.md`: CSS scope, client browser APIs và effect cleanup.
- https://docs.docker.com/engine/manage-resources/pruning/ — volume/cache/image có vòng đời khác nhau; không xóa chỉ vì nhãn unused.

## Trạng thái nghiệm thu

Đây là biên bản đang cập nhật. Chỉ đánh dấu PASS cho phạm vi có bằng chứng cuối; production/tiền thật/dọn lịch sử chưa được nghiệm thu. Chưa merge, deploy, đổi secret, migrate live hoặc tạo/chuyển/hoàn tiền thật.
