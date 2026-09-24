import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from '../apps/api/src/app.js';
import { registerModules } from '../apps/api/src/modules/index.js';
import { createDatabase } from '../packages/database/src/index.js';
const db = createDatabase(process.env.DATABASE_URL!);
const app = buildApp(db);
const id = '00000000-0000-4000-8000-000000000001';
const examples: Record<string, unknown> = {
  'POST /guest/join': { token: 'LAY_TU_MA_QR_MOI', name: 'Khách' },
  'POST /guest/cart': { productId: id, quantity: 1, cartVersion: 1, note: '' },
  'PATCH /guest/cart/:id': { quantity: 2, cartVersion: 2, note: '' },
  'DELETE /guest/cart/:id': { cartVersion: 2 },
  'POST /guest/orders': { requestId: 'MA_MOI_CHO_MOI_LUOT', cartVersion: 2, itemIds: [id] },
  'POST /guest/orders/:id/cancel': { reason: 'Khách đổi ý' },
  'POST /guest/support': { type: 'ASSISTANCE', content: 'Cần hỗ trợ tại bàn' },
  'POST /guest/payments': { requestId: 'MA_MOI_CHO_MOI_LUOT', method: 'CASH', amount: '55000' },
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
    name: 'Nhân viên mới',
    role: 'STAFF',
    password: 'THAY_BANG_MAT_KHAU_RIENG',
  },
  'PATCH /core/users/:id': { name: 'Nhân viên', role: 'STAFF', status: 'ACTIVE' },
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
  'POST /core/payments/:id/confirm': { amount: '55000', reference: 'MA_CHUYEN_KHOAN_NEU_CO' },
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
app.addHook('onRoute', (r) => {
  const method = String(r.method);
  if (method === 'HEAD') return;
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
    tags: [String(permission)],
    summary: method + ' ' + path,
    operationId: 'core_' + method.toLowerCase() + '_' + r.url.replace(/[^a-zA-Z0-9]/g, '_'),
    description: r.config?.externalWebhook
      ? 'Bộ nối thanh toán HMAC riêng; chưa phải endpoint trực tiếp của VNPay/MoMo. Xem docs/core45/PAYMENTS.md.'
      : 'Mã ID trong ví dụ cần thay bằng ID thật lấy từ API GET tương ứng. Mọi thay đổi được backend kiểm tra quyền và phạm vi nhà hàng.',
    parameters,
    security: r.config?.public ? [] : [{ accessCookie: [] }],
    ...(method === 'GET'
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
                example: body,
              },
            },
          },
        }),
    responses: {
      '200': { description: 'Thành công' },
      '400': { description: 'Dữ liệu không hợp lệ' },
      '401': { description: 'Chưa xác thực' },
      '403': { description: 'Không được phép' },
      '404': { description: 'Không tìm thấy' },
      '409': { description: 'Dữ liệu hoặc trạng thái đã thay đổi' },
      '429': { description: 'Quá giới hạn gửi' },
    },
  };
});
registerModules(app, db, process.env.RESTAURANT_ID!);
mkdirSync('docs/core45', { recursive: true });
writeFileSync('docs/core45/openapi-paths.json', JSON.stringify(paths, null, 2) + '\n');
await app.close();
await db.close();
console.log(
  'Generated CORE API reference: ' +
    Object.values(paths).reduce((n, v) => n + Object.keys(v).length, 0) +
    ' operations',
);
