import {
  restaurantPolicy,
  assistantRequestSchema,
  assistantDecisionSchema,
  assistantToolNames,
} from '../packages/contracts/src/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from '../apps/api/src/app.js';
import { registerAuth } from '../apps/api/src/auth.js';
import { randomBytes } from 'node:crypto';
import { registerModules } from '../apps/api/src/modules/index.js';
import { createDatabase } from '../packages/database/src/index.js';
const db = createDatabase(process.env.DATABASE_URL!);
const app = buildApp(db);
const id = '00000000-0000-4000-8000-000000000001';
const classifiedAttendance = {
  minutes: 240,
  outcome: 'MISSED_CLOCK',
  approvalMode: 'EXCEPTION',
  note: 'Đã đối chiếu giờ làm với nhân viên và người phụ trách ca.',
  paidPeriods: [
    {
      startsAt: '2026-10-10T22:00:00+07:00',
      endsAt: '2026-10-11T02:00:00+07:00',
      kind: 'REGULAR',
    },
  ],
};
const discountProgram = {
  name: 'Ưu đãi bữa trưa',
  description: 'Giảm 10% cho món lẻ từ 300.000 đ, tối đa 50.000 đ, áp dụng bữa trưa ngày thường.',
  mode: 'CODE',
  code: 'BUATRUA',
  type: 'PERCENT',
  percent: 10,
  fixedAmount: null,
  minEligibleAmount: '300000',
  maxDiscountAmount: '50000',
  startsAt: '2026-11-01T00:00:00+07:00',
  endsAt: '2026-11-30T23:59:59+07:00',
  weekdays: [1, 2, 3, 4, 5],
  startTime: '11:00',
  endTime: '14:00',
  scope: 'ALL',
  productIds: [],
  categoryIds: [],
  excludeCombos: true,
  usageLimit: 100,
  status: 'PAUSED',
};
const promotionChoice = {
  byCode: {
    summary: 'Nhập mã giảm giá',
    value: { requestId: 'MA_MOI_CHO_LUOT_AP_DUNG_MA', code: 'BUATRUA' },
  },
  byProgram: {
    summary: 'Chọn chương trình tự động từ GET promotion',
    value: { requestId: 'MA_MOI_CHO_LUOT_CHON_CHUONG_TRINH', programId: id },
  },
};
const assistantDescriptions: Record<string, string> = {
  'GET /guest/menu-assistant/capabilities':
    'Khách có cookie guest hợp lệ xem contractVersion=2, trạng thái bật/tắt, advisoryOnly và tên ba công cụ đọc. Mặc định OFF; MOCK chỉ là fixture, chưa có model thật. Không cập nhật heartbeat, giỏ, đơn, kho hoặc tiền. Công cụ đọc chỉ được provider gọi trong một lượt tư vấn, không phải endpoint SQL công khai.',
  'POST /guest/menu-assistant/recommendations':
    'Tư vấn chỉ đọc v2, cần guest cookie, Origin và CSRF; body tối đa 32 KiB. message tối đa 1000 ký tự; people/budgetAmount/preferences là gợi ý tùy chọn, history tối đa 8 tin user/assistant, mỗi tin 1000 ký tự. AI tự hiểu câu hỏi, chủ động gọi listCategories/searchMenu/getProducts để đọc menu realtime, chọn món, cân đối ngân sách, giải thích và hỏi lại. API chỉ bảo vệ auth/tenant, quota/concurrency/deadline, kích thước và schema; không sửa ID/tên/giá/tổng/lý do, không chặn lỗi tư vấn về ngân sách/sở thích/khả dụng/kho để làm model luôn đúng. decision là raw advisory, chưa có giá trị đặt món hoặc giao dịch; core kiểm tra lại khi thêm giỏ/gửi đơn. Dị ứng chưa có metadata xác minh: policy yêu cầu AI nói giới hạn và đề nghị hỏi nhân viên. HTTP 200: AVAILABLE có decision; UNAVAILABLE có decision=null và vẫn chọn món thủ công được. Mặc định OFF; chưa model/UI AI thật.',
};
const assistantResponseSchemas: Record<string, unknown> = {
  'GET /guest/menu-assistant/capabilities': {
    type: 'object',
    additionalProperties: false,
    required: [
      'contractVersion',
      'mode',
      'enabled',
      'advisoryOnly',
      'semanticMetadata',
      'maxPeople',
      'maxProducts',
      'supportsAllergySafetyConfirmation',
      'readTools',
    ],
    properties: {
      contractVersion: { type: 'integer', enum: [2] },
      mode: { type: 'string', enum: ['OFF', 'MOCK', 'CUSTOM'] },
      enabled: { type: 'boolean' },
      advisoryOnly: { type: 'boolean', enum: [true] },
      semanticMetadata: { type: 'string', enum: ['UNREVIEWED'] },
      maxPeople: { type: 'integer', enum: [20] },
      maxProducts: { type: 'integer', enum: [6] },
      supportsAllergySafetyConfirmation: { type: 'boolean', enum: [false] },
      readTools: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', enum: assistantToolNames },
      },
    },
  },
  'POST /guest/menu-assistant/recommendations': {
    type: 'object',
    additionalProperties: false,
    required: [
      'contractVersion',
      'mode',
      'status',
      'code',
      'message',
      'advisoryOnly',
      'decision',
      'checkedAt',
    ],
    properties: {
      contractVersion: { type: 'integer', enum: [2] },
      mode: { type: 'string', enum: ['OFF', 'MOCK', 'CUSTOM'] },
      status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
      code: { type: 'string' },
      message: {
        type: 'string',
        description:
          'Thông điệp kỹ thuật của API. Lời tư vấn của AI nằm nguyên trong decision.message.',
      },
      advisoryOnly: { type: 'boolean', enum: [true] },
      decision: {
        ...assistantDecisionSchema,
        nullable: true,
        description:
          'Đầu ra AI được kiểm tra định dạng; không được API sửa nội dung hoặc tính lại. UNAVAILABLE trả null. Giá/tổng/tên/lý do là lời khẳng định tư vấn, core không dùng làm căn cứ giao dịch.',
      },
      checkedAt: {
        type: 'string',
        format: 'date-time',
        description:
          'Thời điểm tạo envelope; không có nghĩa đã kiểm tra lại giá hoặc tồn kho của decision.',
      },
    },
  },
};
const pricingDescriptions: Record<string, string> = {
  'GET /core/admin/discount-programs':
    'ADMIN xem điều kiện, phiên bản, lượt đã dùng và lượt đang giữ của chương trình khuyến mãi.',
  'POST /core/admin/discount-programs':
    'ADMIN tạo chương trình. Ví dụ lưu ở trạng thái PAUSED để kiểm tra trước khi bật. Giảm phần trăm từ 1 đến 50; giảm tiền cố định cần minEligibleAmount ít nhất gấp đôi fixedAmount. excludeCombos luôn true: combo không được giảm thêm và không tính ngưỡng. VND dùng chuỗi số nguyên. Ngày giờ có múi giờ; lịch thứ/giờ tính theo múi giờ nhà hàng, khung giờ trong cùng ngày. Không có ưu đãi cộng dồn.',
  'PATCH /core/admin/discount-programs/:id':
    'ADMIN cập nhật đầy đủ điều kiện và version mới nhất từ GET discount-programs. Version cũ bị chặn 409. Thay đổi không sửa ưu đãi đã chốt hoặc snapshot giao dịch. Không sửa chương trình đã ARCHIVED và không đặt giới hạn thấp hơn số lượt đã dùng/đang giữ.',
  'DELETE /core/admin/discount-programs/:id':
    'ADMIN lưu trữ bằng version mới nhất. Không xóa lịch sử lượt sử dụng hoặc khoản giảm đã chốt; chương trình đã lưu trữ không được bật lại.',
  'GET /core/admin/discount-programs/:id/history':
    'ADMIN tra cứu tối đa 100 lần thay đổi và 100 lượt áp dụng gần nhất. Lịch sử có người/thời điểm/phiên bản và snapshot; lượt áp dụng có bàn, mã phiên, trạng thái và số tiền giảm.',
  'GET /core/admin/tax-policies':
    'ADMIN xem mức VAT mặc định hiện hành, các phiên bản chính sách theo mốc hiệu lực và phân loại thuế của món. Giá thực đơn đã gồm VAT. Không chịu VAT khác với thuế suất 0%.',
  'POST /core/admin/tax-policies':
    'ADMIN lập phiên bản mới với mức 0/5/8/10%, lý do tối thiểu 5 ký tự và thời điểm hiệu lực ít nhất một phút sau hiện tại. Có thể lập phiên bản cao hơn tại cùng mốc tương lai để thay lịch; bản cũ giữ nguyên. Không tính lại VAT món đã gọi/hóa đơn đã chốt. 8% cần đúng nhóm hàng và thời kỳ áp dụng; lịch mặc định chuyển về 10% ngày 01/01/2027.',
  'PATCH /core/products/:id/tax':
    'ADMIN phân loại món và gửi version hiện tại của sản phẩm từ GET tax-policies/catalog. DEFAULT dùng mức của nhà hàng; TAXABLE dùng 0/5/8/10%; EXEMPT là không chịu VAT, ratePercent=null. Phải có lý do tối thiểu 5 ký tự. Chỉ áp dụng lượt gọi mới, không sửa snapshot món đã gọi.',
  'GET /core/sessions/:id/promotion':
    'STAFF/ADMIN xem ưu đãi đủ điều kiện, lý do không áp dụng và quote hóa đơn của đúng phiên. Giá, giảm và VAT do backend tính; không gửi số tiền giảm tự tính từ client.',
  'POST /core/sessions/:id/promotion':
    'STAFF/ADMIN chọn một programId hoặc code, không gửi cả hai. requestId mới cho một hành động mới; giữ nguyên requestId và body khi gửi lại đúng hành động do lỗi mạng. Chỉ đổi ưu đãi trước khi thu tiền và khi không có yêu cầu thanh toán đang chờ. Các lần thu/hoàn dùng khoản giảm được phân bổ và lưu trên từng dòng món.',
  'DELETE /core/sessions/:id/promotion':
    'STAFF/ADMIN bỏ lựa chọn trước thanh toán bằng requestId. Gửi lại cùng requestId/body không thay đổi lần nữa; dùng mã mới cho hành động khác. Bị chặn nếu đã thu tiền hoặc có yêu cầu thu đang chờ.',
  'GET /guest/promotion':
    'Khách đã tham gia phiên bàn xem ưu đãi, điều kiện và quote của đúng bàn qua guest cookie. Không dùng cookie đăng nhập nội bộ để thay cho phiên khách.',
  'POST /guest/promotion':
    'Khách chọn một chương trình AUTO bằng programId hoặc nhập code cho chương trình CODE. Gửi requestId mới cho mỗi hành động; gửi lại đúng body/requestId khi lỗi mạng. Không đổi sau thu tiền hoặc khi yêu cầu thanh toán đang chờ. Combo không được giảm thêm và không tính ngưỡng.',
  'DELETE /guest/promotion':
    'Khách bỏ ưu đãi trước thanh toán. Cần guest cookie, CSRF và requestId; hành động lặp cùng mã/nội dung giữ kết quả cũ. Đã thu tiền hoặc có yêu cầu thu đang chờ thì bị chặn.',
};
const payosDescriptions: Record<string, string> = {
  'POST /guest/payments':
    'Endpoint cũ đã ngừng tạo khoản thu. Cần guest cookie và luôn trả 403; khách dùng POST /guest/payment-requests để gọi nhân viên. Không xóa khoản thu lịch sử.',
  'POST /guest/payment-requests':
    'Khách gọi nhân viên thanh toán bằng requestId UUID; không cần chọn phương thức, không tạo payment intent hoặc ghi tiền. Gửi lại cùng requestId trả về yêu cầu cũ kể cả đã hoàn tất; mã mới có thể tái dùng yêu cầu đang mở. Mã trùng nhưng nội dung khác bị từ chối. method là tùy chọn tương thích client cũ; ONLINE cần payOS đã cấu hình. Nhân viên nhận việc rồi chọn phương thức thu thực tế.',
  'POST /core/sessions/:id/payments':
    'Chỉ STAFF bắt đầu thu tiền trong phiên còn mở. Server kiểm tra số tiền nguyên VND, dư nợ sau giảm/VAT, khoản giữ chỗ, phạm vi khách và quyền phụ trách. ONLINE dùng payOS; gọi SDK ngoài transaction. Giữ cùng requestId/body khi thử lại. Sau create, bill trả online.status/QR/link/số tiền đã nhận và còn cần chuyển; lỗi mạng giữ chỗ để tránh thu trùng.',
  'POST /core/payments/:id/confirm':
    'Chỉ xác nhận thủ công CASH/BANK_TRANSFER sau khi thực nhận. ONLINE luôn bị chặn 403, kể cả đã thành công; webhook/truy vấn payOS xác minh tiền. receivedAmount dùng riêng cho tiền khách đưa và tiền thối.',
  'POST /core/payments/:id/refresh':
    'STAFF phụ trách yêu cầu server đối chiếu payOS. Không nhập số tiền hoặc tự đổi sang PAID; dữ liệu chữ ký và từng tham chiếu ngân hàng phải khớp. Maintenance cũng đối chiếu nền.',
  'POST /core/payments/:id/cancel':
    'STAFF phụ trách yêu cầu hủy. payOS phải xác nhận kết thúc trước khi bỏ giữ chỗ; kết quả mạng chưa rõ vẫn chặn thu thay thế. Tiền đã nhận dùng quy trình admin duyệt hoàn, phục vụ thực trả và xác nhận.',
  'POST /payments/webhooks/payos':
    'Webhook payOS trực tiếp, dùng SDK chính thức xác minh chữ ký data, không dùng chữ ký connector nội bộ hoặc redirect. Không cần auth cookie/Origin/CSRF, nhưng chữ ký bắt buộc. Đối chiếu orderCode/link/VND/từng reference/amount với truy vấn xác thực payOS; duplicate không cộng tiền. 200 nhận/ghi bền vững probe hoặc thông báo chưa khớp; 400 chữ ký không hợp lệ; 503 khi chưa đối chiếu được để nhà cung cấp thử lại. Không gọi endpoint bằng fixture hoặc khóa thật trong tài liệu.',
  'GET /core/admin/payment-reconciliation':
    'ADMIN xem toàn bộ hồ sơ OPEN và tối đa 100 hồ sơ lịch sử của đúng nhà hàng. Tách số yêu cầu, ngân hàng báo, ghi sổ, phân bổ, chưa phân bổ, cần hoàn cả phiên; tham chiếu đã biết chỉ đọc. can_resolve/resolution_blockers dùng cùng điều kiện với mutation. Không trả khóa hoặc raw payload.',
  'POST /core/admin/payment-reconciliation/:id/resolve':
    'ADMIN chỉ đóng RECONCILED sau kiểm tra lại dưới khóa: xác minh provider hoặc chứng từ ngân hàng độc lập đủ điều kiện, không còn tham chiếu chưa xử lý, sổ khớp tiền thực nhận, không còn tiền cách ly/chưa phân bổ hoặc nghĩa vụ hoàn. Ghi chú là tùy chọn, không phải chứng cứ. RETURNED_EXTERNALLY bị chặn vì chưa có connector xác minh chứng từ outbound; nhập reference không chứng minh đã hoàn. Phiếu đóng giữ nguyên; không tự gán PAID hoặc chuyển tiền.',
  'POST /core/admin/payment-reconciliation/:id/refresh':
    'ADMIN yêu cầu backend xác minh lại khoản payOS của đúng nhà hàng. Không cần nhận quyền thu của STAFF, không tạo link hoặc ép ghi sổ. Mọi guard SDK, định danh, tài khoản và tiền vẫn áp dụng; busy409/provider503 giữ trạng thái an toàn.',
  'GET /core/admin/payment-reconciliation/:id/bank-evidence':
    'ADMIN của đúng nhà hàng xem facts readonly, tài khoản nhận đã che, nguồn xác minh và lịch sử chứng từ. Không ghi tiền; không trả thông tin này cho STAFF/GUEST.',
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/proof':
    'ADMIN tải ảnh PNG/JPEG/WebP tối đa 2 MB, base64 chuẩn; server kiểm magic bytes, tạo filename riêng, lưu hash và chỉ cho ADMIN xem. Ảnh không tự chứng minh ngân hàng nhận tiền.',
  'GET /core/admin/payment-reconciliation/:id/bank-evidence/proof/:proofId':
    'Đọc ảnh chứng từ riêng tư trong đúng tenant/intent; ADMIN-only, no-store, nosniff. Không nhận URL/path bên ngoài.',
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/preview':
    'Đối chiếu payOS trước, rồi xem tác động từ chứng cứ ngân hàng độc lập. Token 2 phút ràng buộc actor/tenant/intent/version/proof/hash/facts; chưa ghi sổ. Giờ phải có múi giờ; hết hạn chỉ phục hồi khi có chứng cứ provider đã quan sát đúng hạn. Gross nhận có thể lớn hơn quote nhưng allocation luôn bị giới hạn; phần dư phải hoàn riêng.',
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/confirm':
    'ADMIN xác nhận cuối, server kiểm lại quyền/token/chứng từ/facts/số dư dưới khóa. Shared posting BANK_ADMIN_VERIFIED, claim ngân hàng xuyên nguồn, idempotent; không ép provider PAID hoặc xác nhận đã hoàn. Token cũ hoặc facts thay đổi trả409; replay đã xác nhận trả receipt cũ.',
  'POST /core/admin/payment-reconciliation/:id/acknowledge':
    'ADMIN tiếp nhận hồ sơ OPEN của đúng nhà hàng. Chỉ audit người/thời điểm, idempotent trong cùng bất thường; không xác minh ngân hàng, ghi tiền, hoàn tiền hoặc đóng hồ sơ.',
  'GET /core/admin/payment-webhooks/unmatched':
    'ADMIN xem tối đa 100 thông báo PAYOS có chữ ký, số tiền dương, chưa khớp khoản thu của đúng nhà hàng. Chỉ 6 trường tối thiểu; chỉ đọc, có thể gồm probe đăng ký, không chứng minh tiền trả cho bàn và không tự ghi ledger.',
};
const integerMoney = {
  type: 'string',
  pattern: '^[0-9]{1,12}$',
  description:
    'Số tiền VND nguyên, tối đa 100.000.000.000 đ; không gửi dấu phân cách hoặc số thực.',
};
const versionSchema = { type: 'integer', minimum: 1, maximum: 2147483646 };
const requestIdSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  description: 'Mã mới cho hành động mới; giữ cùng mã và nội dung nếu gửi lại do lỗi mạng.',
};
const discountProperties = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  description: { type: 'string', maxLength: 500 },
  mode: { type: 'string', enum: ['AUTO', 'CODE'] },
  code: {
    type: 'string',
    nullable: true,
    maxLength: 32,
    pattern: '^[A-Z0-9][A-Z0-9_-]{2,31}$',
    description: 'Bắt buộc khi mode=CODE; mode=AUTO dùng null.',
  },
  type: { type: 'string', enum: ['PERCENT', 'FIXED'] },
  percent: {
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 50,
    description: 'Bắt buộc khi type=PERCENT, null khi giảm tiền cố định.',
  },
  fixedAmount: {
    ...integerMoney,
    nullable: true,
    description: 'Dương khi type=FIXED, null khi giảm phần trăm.',
  },
  minEligibleAmount: {
    ...integerMoney,
    description: 'Ngưỡng tổng món đủ điều kiện, không gồm combo. Với FIXED phải >=2×fixedAmount.',
  },
  maxDiscountAmount: {
    ...integerMoney,
    nullable: true,
    description: 'Trần giảm phần trăm, số dương hoặc null nếu không giới hạn.',
  },
  startsAt: { type: 'string', format: 'date-time' },
  endsAt: { type: 'string', format: 'date-time', description: 'Sau startsAt.' },
  weekdays: {
    type: 'array',
    uniqueItems: true,
    maxItems: 7,
    items: { type: 'integer', minimum: 0, maximum: 6 },
    description: '0=Chủ nhật, 1=Thứ Hai…6=Thứ Bảy; [] là mỗi ngày.',
  },
  startTime: { type: 'string', nullable: true, pattern: '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' },
  endTime: {
    type: 'string',
    nullable: true,
    pattern: '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Cả hai giờ đều null hoặc endTime sau startTime trong cùng ngày.',
  },
  scope: { type: 'string', enum: ['ALL', 'PRODUCTS', 'CATEGORIES'] },
  productIds: {
    type: 'array',
    uniqueItems: true,
    maxItems: 200,
    items: { type: 'string', format: 'uuid' },
    description: 'Ít nhất một món khi scope=PRODUCTS; các scope khác dùng [].',
  },
  categoryIds: {
    type: 'array',
    uniqueItems: true,
    maxItems: 200,
    items: { type: 'string', format: 'uuid' },
    description: 'Ít nhất một nhóm khi scope=CATEGORIES; các scope khác dùng [].',
  },
  excludeCombos: { type: 'boolean', enum: [true] },
  usageLimit: { type: 'integer', nullable: true, minimum: 1, maximum: 1000000 },
  status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] },
};
const requestSchemas: Record<string, unknown> = {
  'POST /guest/payment-requests': {
    type: 'object',
    description:
      'Client mới gửi requestId UUID để retry an toàn. method chỉ dành cho tương thích client cũ, không phải chứng cứ đã trả tiền.',
    properties: {
      requestId: { type: 'string', format: 'uuid' },
      method: { type: 'string', enum: ['CASH', 'BANK_TRANSFER', 'ONLINE'] },
    },
  },
  'POST /guest/menu-assistant/recommendations': assistantRequestSchema,
  'POST /core/sessions/:id/payments': {
    type: 'object',
    required: ['requestId', 'method', 'amount'],
    properties: {
      requestId: requestIdSchema,
      method: { enum: ['CASH', 'BANK_TRANSFER', 'ONLINE'] },
      amount: integerMoney,
      collectionScope: { enum: ['TABLE', 'PARTICIPANT'] },
      participantId: { type: 'string', format: 'uuid' },
      supportRequestId: { type: 'string', format: 'uuid' },
    },
  },
  'POST /core/admin/discount-programs': {
    type: 'object',
    additionalProperties: false,
    required: [
      'name',
      'mode',
      'type',
      'minEligibleAmount',
      'startsAt',
      'endsAt',
      'scope',
      'excludeCombos',
      'status',
    ],
    properties: discountProperties,
  },
  'PATCH /core/admin/discount-programs/:id': {
    type: 'object',
    additionalProperties: false,
    required: [
      'name',
      'mode',
      'type',
      'minEligibleAmount',
      'startsAt',
      'endsAt',
      'scope',
      'excludeCombos',
      'status',
      'version',
    ],
    properties: { ...discountProperties, version: versionSchema },
  },
  'DELETE /core/admin/discount-programs/:id': {
    type: 'object',
    additionalProperties: false,
    required: ['version'],
    properties: { version: versionSchema },
  },
  'POST /core/admin/tax-policies': {
    type: 'object',
    additionalProperties: false,
    required: ['effectiveAt', 'defaultRatePercent', 'reason'],
    properties: {
      effectiveAt: { type: 'string', format: 'date-time' },
      defaultRatePercent: { type: 'integer', enum: [0, 5, 8, 10] },
      reason: { type: 'string', minLength: 5, maxLength: 500 },
    },
  },
  'PATCH /core/products/:id/tax': {
    type: 'object',
    additionalProperties: false,
    required: ['treatment', 'ratePercent', 'reason', 'version'],
    properties: {
      treatment: { type: 'string', enum: ['DEFAULT', 'TAXABLE', 'EXEMPT'] },
      ratePercent: {
        type: 'integer',
        nullable: true,
        enum: [null, 0, 5, 8, 10],
        description: 'TAXABLE cần số; DEFAULT và EXEMPT cần null.',
      },
      reason: { type: 'string', minLength: 5, maxLength: 500 },
      version: versionSchema,
    },
  },
};
for (const path of ['/core/sessions/:id/promotion', '/guest/promotion']) {
  requestSchemas['POST ' + path] = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId'],
    oneOf: [
      { required: ['code'], not: { required: ['programId'] } },
      { required: ['programId'], not: { required: ['code'] } },
    ],
    properties: {
      requestId: requestIdSchema,
      code: { type: 'string', minLength: 3, maxLength: 32 },
      programId: { type: 'string', format: 'uuid' },
    },
  };
  requestSchemas['DELETE ' + path] = {
    type: 'object',
    additionalProperties: false,
    required: ['requestId'],
    properties: { requestId: requestIdSchema },
  };
}

const examples: Record<string, unknown> = {
  'POST /guest/menu-assistant/recommendations': {
    message: 'Tôi đi 3 người, ngân sách 500.000đ và muốn có một món rau.',
    history: [{ role: 'user', content: 'Tôi muốn chọn món cho bữa trưa.' }],
    preferences: { include: ['VEGETABLE'] },
  },
  'POST /core/admin/discount-programs': discountProgram,
  'PATCH /core/admin/discount-programs/:id': { ...discountProgram, status: 'ACTIVE', version: 1 },
  'DELETE /core/admin/discount-programs/:id': { version: 2 },
  'POST /core/admin/tax-policies': {
    effectiveAt: '2027-01-01T00:00:00+07:00',
    defaultRatePercent: 10,
    reason: 'Áp dụng mức VAT thông thường từ ngày 01/01/2027.',
  },
  'PATCH /core/products/:id/tax': {
    treatment: 'TAXABLE',
    ratePercent: 8,
    reason: 'Đối chiếu món thuộc nhóm hàng đủ điều kiện giảm VAT trong năm 2026.',
    version: 1,
  },
  'POST /core/sessions/:id/promotion': promotionChoice.byCode.value,
  'DELETE /core/sessions/:id/promotion': { requestId: 'MA_MOI_CHO_LUOT_BO_UU_DAI' },
  'POST /guest/promotion': promotionChoice.byCode.value,
  'DELETE /guest/promotion': { requestId: 'MA_MOI_CHO_LUOT_BO_UU_DAI' },

  'POST /core/workforce/pay-rates': {
    userId: id,
    effectiveFrom: '2026-11-01T00:00:00+07:00',
    hourlyRate: '40000',
    reason: 'Áp dụng mức lương đã thỏa thuận từ tháng 11.',
  },
  'POST /core/workforce/pay-policies': {
    effectiveFrom: '2026-11-01',
    nightPremiumPercent: 30,
    overtimeWeekdayPercent: 150,
    restDayPercent: 200,
    holidayPercent: 300,
  },
  'POST /core/workforce/calendar': {
    date: '2026-11-01',
    kind: 'WEEKLY_REST',
    userId: id,
    name: 'Ngày nghỉ tuần đã phân công',
  },
  'POST /core/workforce/assignments/:id/pay-preview': classifiedAttendance,
  'POST /core/workforce/assignments/:id/approve': {
    ...classifiedAttendance,
    expectedAmount: '208000',
  },
  'POST /core/alerts/:id/guest-notified': {},
  'POST /core/items/:id/report-issue': {
    reasonCode: 'KITCHEN_ERROR',
    note: 'Món cháy, bếp dừng phục vụ',
  },
  'POST /core/inventory/adjustments': {
    balanceId: id,
    expectedVersion: 1,
    requestId: 'MA_MOI_MOI_LAN_DIEU_CHINH',
    mode: 'WASTE',
    quantity: '0.5',
    reason: 'Nguyên liệu hỏng, kiểm tra đầu ca',
  },
  'PATCH /guest/profile': { name: 'Tên khách mới' },
  'POST /guest/items/cancel': { itemIds: [id] },
  'POST /core/items/cancel': { itemIds: [id], reason: 'Khách đổi món trước chế biến' },
  'POST /core/sessions/:id/serve-items': { itemIds: [id] },
  'POST /core/support/:id/handoffs/:handoffId/accept': {},
  'POST /core/support/:id/handoffs/:handoffId/decline': { reason: 'Đang thu tiền bàn khác' },
  'POST /core/support/:id/handoffs/:handoffId/cancel': { reason: 'Tiếp tục tự xử lý' },
  'POST /core/support/:id/reassign': { userId: id, reason: 'Bàn giao ca phục vụ' },
  'POST /core/items/:id/late-cancel': {
    reasonCode: 'KITCHEN_ERROR',
    note: 'Đối chiếu bếp xác nhận lỗi chế biến',
  },
  'POST /core/items/:id/waive': { reason: 'Quản trị miễn khoản thu món lỗi' },

  'POST /core/sessions/:id/transfer': {
    tableId: id,
    fromTableId: '00000000-0000-4000-8000-000000000002',
    partySize: 4,
    reasonCode: 'AREA_CHANGE',
    note: 'Khách muốn chuyển sang khu vực yên tĩnh',
  },
  'POST /core/workforce/shifts': {
    code: 'CA-SANG-20260925',
    name: 'Ca sáng',
    startsAt: '2026-09-25T07:00:00+07:00',
    endsAt: '2026-09-25T15:00:00+07:00',
    breakMinutes: 30,
  },

  'POST /guest/join': {
    token: 'LAY_TU_MA_QR_MOI',
    name: 'Khách',
    acceptedPolicyVersion: restaurantPolicy.version,
  },
  'POST /guest/cart': { productId: id, quantity: 1, cartVersion: 1, note: '' },
  'PATCH /guest/cart/:id': { quantity: 2, cartVersion: 2, note: '' },
  'DELETE /guest/cart/:id': { cartVersion: 2 },
  'POST /guest/orders': { requestId: 'MA_MOI_CHO_MOI_LUOT', cartVersion: 2, itemIds: [id] },
  'POST /guest/orders/:id/cancel': { reason: 'Khách đổi ý' },
  'POST /guest/support': { type: 'ASSISTANCE', content: 'Cần hỗ trợ tại bàn' },
  // Legacy endpoint remains authenticated but returns 403: guests only request staff collection.
  'POST /core/categories': { code: 'MON-CHINH', name: 'Món chính' },
  'PATCH /core/categories/:id': { name: 'Món chính', sortOrder: 0, active: true },
  'POST /core/areas': { code: 'TANG-1', name: 'Tầng 1' },
  'PATCH /core/areas/:id': { name: 'Tầng 1', sortOrder: 0, active: true },
  'POST /core/tables': { code: 'A05', name: 'Bàn A05', areaId: id, capacity: 4 },
  'PATCH /core/tables/:id': { name: 'Bàn A05', areaId: id, capacity: 4, active: true, version: 1 },
  'POST /core/products': { code: 'BUN-BO', name: 'Bún bò Huế', categoryId: id, price: '69000' },
  'PATCH /core/products/:id': {
    name: 'Bún bò Huế',
    categoryId: id,
    description: 'Bún bò nóng, dùng cùng rau thơm.',
    imageUrl: '/menu/rice.svg',
    price: '75000',
    active: true,
    availability: 'AVAILABLE',
    version: 1,
  },
  'POST /core/users': {
    username: 'pv005',
    staffCode: 'NV005',
    name: 'Nhân viên mới',
    role: 'STAFF',
    password: 'THAY_BANG_MAT_KHAU_RIENG',
  },
  'PATCH /core/users/:id': {
    name: 'Nhân viên',
    role: 'STAFF',
    status: 'ACTIVE',
    reason: 'Cập nhật phân công nhân viên',
  },
  'POST /core/risk': { LINE_QTY_REVIEW: 5 },
  'POST /core/units': { code: 'KG', name: 'Kilogram', dimension: 'MASS' },
  'POST /core/ingredients': { code: 'GAO', name: 'Gạo', unitId: id, minStock: '2' },
  'POST /core/locations': { code: 'KHO-BEP', name: 'Kho bếp' },
  'POST /core/products/:id/bom': {
    yield: '1',
    lines: [{ ingredientId: id, quantity: '0.2', waste: '0' }],
  },
  'POST /core/receipts': {
    locationId: id,
    number: 'PN-001',
    supplier: 'Nhà cung cấp',
    lines: [{ ingredientId: id, quantity: '10', unitCost: '20000' }],
  },
  'POST /core/sessions/:id/orders': {
    requestId: 'MA_MOI_CHO_MOI_LUOT',
    lines: [{ productId: id, quantity: 1, note: '' }],
  },
  'POST /core/orders/:id/review': { approve: true, reason: 'Đã kiểm tra' },
  'POST /core/orders/:id/cancel': { reason: 'Khách yêu cầu hủy' },
  'POST /core/sessions/:id/payments': {
    requestId: 'MA_MOI_CHO_MOI_LUOT',
    method: 'CASH',
    amount: '55000',
  },
  'POST /core/payments/:id/confirm': { amount: '55000', receivedAmount: '100000' },
  'POST /guest/payment-requests': { requestId: id },
  'POST /core/payments/:id/refresh': {},
  'POST /core/payments/:id/cancel': {},
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/proof': {
    data: 'BASE64_CUA_ANH_CHUNG_TU_PNG_JPEG_WEBP',
  },
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/preview': {
    proofId: id,
    reference: 'MA_GIAO_DICH_TREN_SAO_KE',
    amount: '10000',
    bankTransactionAt: '2026-10-23T10:00:00+07:00',
    reason: 'Đã kiểm tra trực tiếp giao dịch tiền vào trên ngân hàng nhà hàng.',
    attested: true,
  },
  'POST /core/admin/payment-reconciliation/:id/bank-evidence/confirm': {
    token: 'TOKEN_DO_PREVIEW_TRA_VE',
    attested: true,
  },
  'POST /core/admin/payment-reconciliation/:id/refresh': {},
  'POST /core/admin/payment-reconciliation/:id/acknowledge': {},
  'POST /core/admin/payment-reconciliation/:id/resolve': {
    resolution: 'RECONCILED',
    reason: 'Đã đối chiếu đủ trạng thái ngân hàng và xử lý khoản hoàn.',
  },
  'POST /core/sessions/:id/refunds': { paymentId: id, amount: '55000', reason: 'Hoàn món hủy' },
  'POST /core/refunds/:id/complete': { method: 'CASH', reference: '' },
  'POST /core/sessions/:id/outstanding': {
    reason: 'LEFT_WITHOUT_PAYING',
    notes: 'Diễn biến sự việc',
  },
  'POST /core/outstanding/:id/write-off': { reason: 'Đã xác minh không thu hồi được' },
  'POST /core/outstanding/:id/recovered': { reason: 'Đã đối chiếu thu đủ' },
};
const paths: Record<string, Record<string, unknown>> = {};
const authOperations = new Set<string>();
app.addHook('onRoute', (r) => {
  const method = String(r.method);
  if (method === 'HEAD') return;
  const operationKey = method + ' ' + r.url;
  if (r.url.startsWith('/auth/') || r.url.startsWith('/workspaces/')) {
    authOperations.add(operationKey);
    return;
  }
  const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
  const permission =
    r.config?.permission ?? (r.config?.public ? 'Khách/connector' : 'Đã đăng nhập');
  const parameters: unknown[] = Array.from(r.url.matchAll(/:([A-Za-z]+)/g)).map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }));
  if (method !== 'GET' && !r.config?.externalWebhook)
    parameters.push({ $ref: '#/components/parameters/Csrf' });
  const body = examples[method + ' ' + r.url] ?? {};
  paths[path] ??= {};
  paths[path]![method.toLowerCase()] = {
    tags: assistantDescriptions[operationKey]
      ? ['Trợ lý thực đơn · nền tảng tùy chọn']
      : payosDescriptions[operationKey]
        ? ['Thu tiền và payOS']
        : pricingDescriptions[operationKey]
          ? [
              r.url.includes('tax')
                ? 'VAT · quản trị'
                : r.url.startsWith('/guest/')
                  ? 'Khuyến mãi · khách'
                  : r.url.includes('/admin/')
                    ? 'Khuyến mãi · quản trị'
                    : 'Khuyến mãi · phục vụ và quản trị',
            ]
          : [String(permission)],
    summary: method + ' ' + path,
    operationId: 'core_' + method.toLowerCase() + '_' + r.url.replace(/[^a-zA-Z0-9]/g, '_'),
    description:
      assistantDescriptions[operationKey] ??
      payosDescriptions[operationKey] ??
      pricingDescriptions[operationKey] ??
      (r.url === '/core/workforce/assignments/:id/approve'
        ? 'Duyệt sau khi gọi pay-preview. Giữ nguyên các khoảng công và lấy expectedAmount từ amount của kết quả xem trước; không dùng số tiền ví dụ nếu căn cứ thực tế khác. Khoảng công phải kết thúc, đúng giờ nghỉ và có căn cứ; công đã duyệt không được sửa đè.'
        : r.url === '/core/workforce/assignments/:id/pay-preview'
          ? 'Tính tiền dự kiến trên đơn giá, chính sách và lịch nghỉ có hiệu lực. Không ghi công đã duyệt. Ca có nghỉ cần khai báo các khoảng được tính công sau khi trừ nghỉ; giờ làm thêm cần approveExtra=true và lý do.'
          : r.config?.externalWebhook
            ? 'Bộ nối thanh toán HMAC riêng; chưa phải endpoint trực tiếp của VNPay/MoMo. Xem docs/core45/PAYMENTS.md.'
            : 'Mã ID trong ví dụ cần thay bằng ID thật lấy từ API GET tương ứng. Mọi thay đổi được backend kiểm tra quyền và phạm vi nhà hàng.'),
    parameters,
    security: [
      '/guest/promotion',
      '/guest/payments',
      '/guest/payment-requests',
      '/guest/menu-assistant/capabilities',
      '/guest/menu-assistant/recommendations',
    ].includes(r.url)
      ? [{ guestCookie: [] }]
      : r.config?.public
        ? []
        : [{ accessCookie: [] }],
    ...(method === 'GET'
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: requestSchemas[operationKey] ?? {
                  type: 'object',
                  additionalProperties: true,
                },
                ...(method === 'POST' && r.url.endsWith('/promotion')
                  ? { examples: promotionChoice }
                  : { example: body }),
              },
            },
          },
        }),
    responses: {
      '200': {
        description: assistantDescriptions[operationKey]
          ? 'Xem status/advisoryOnly; HTTP 200 không xác nhận chất lượng tư vấn hoặc tạo giao dịch.'
          : 'Thành công',
        ...(assistantResponseSchemas[operationKey]
          ? { content: { 'application/json': { schema: assistantResponseSchemas[operationKey] } } }
          : {}),
      },
      '400': { description: 'Dữ liệu không hợp lệ' },
      '401': { description: 'Chưa xác thực' },
      '403': { description: 'Không được phép' },
      '404': { description: 'Không tìm thấy' },
      '409': { description: 'Dữ liệu hoặc trạng thái đã thay đổi' },
      '429': { description: 'Quá giới hạn gửi' },
    },
  };
});
// Registration only: this app never listens or executes handlers. The ephemeral auth key is not a deployed credential.
await registerAuth(app, db, {
  secret: randomBytes(32).toString('hex'),
  restaurantId: process.env.RESTAURANT_ID!,
  origins: ['http://localhost:3000'],
  secure: false,
});
registerModules(app, db, process.env.RESTAURANT_ID!);
mkdirSync('docs/core45', { recursive: true });
writeFileSync('docs/core45/openapi-paths.json', JSON.stringify(paths, null, 2) + '\n');
const businessCount = Object.values(paths).reduce((n, v) => n + Object.keys(v).length, 0);
const healthCount = ['/health/live', '/health/ready'].filter((url) =>
  app.hasRoute({ method: 'GET', url }),
).length;
await app.close();
await db.close();
console.log(
  `Generated API reference: ${businessCount} business operations; ${businessCount + authOperations.size + healthCount} registered total (${authOperations.size} auth/workspace, ${healthCount} health; automatic HEAD excluded).`,
);
