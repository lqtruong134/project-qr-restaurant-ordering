import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { parse } from 'yaml';
const require = createRequire(import.meta.url);
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(web, 'public/api-docs-assets');
mkdirSync(output, { recursive: true });
for (const file of ['swagger-ui-bundle.js', 'swagger-ui.css'])
  copyFileSync(require.resolve('swagger-ui-dist/' + file), resolve(output, file));
const spec = parse(readFileSync(resolve(web, '../../docs/openapi.yaml'), 'utf8'));
spec.servers = [{ url: '/api', description: 'API của ứng dụng đang mở' }];
spec.info.title = 'QR Ordering — Demo API Sprint 1';
spec.info.description =
  'Đăng nhập bằng API login; trình duyệt tự giữ cookie. Không cần nhập token vào Authorize. Mỗi account có một phiên nội bộ. Các thao tác Execute gọi backend thật.';
const descriptions = {
  '/health/live': ['01. Kết nối', 'Kiểm tra API đang chạy', 'live'],
  '/health/ready': ['01. Kết nối', 'Kiểm tra kết nối PostgreSQL', 'ready'],
  '/auth/logout': ['02. Đăng nhập và phiên', 'Đăng xuất — dùng trước và sau demo', 'logout'],
  '/auth/me': ['02. Đăng nhập và phiên', 'Xem tài khoản hiện tại — 401 nếu chưa đăng nhập', 'me'],
  '/auth/login': ['02. Đăng nhập và phiên', 'Đăng nhập Staff / Kitchen / Admin', 'login'],
  '/auth/refresh': [
    '02. Đăng nhập và phiên',
    'Làm mới phiên — xoay vòng refresh cookie',
    'refresh',
  ],
  '/workspaces/{area}': [
    '03. Phân quyền',
    'Kiểm tra quyền vào workspace — 200 hoặc 403',
    'workspace',
  ],
};
for (const [path, operations] of Object.entries(spec.paths))
  for (const [method, operation] of Object.entries(operations)) {
    const [tag, summary, id] = descriptions[path];
    operation.tags = [tag];
    operation.summary = summary;
    operation.operationId = id;
    if (method === 'post')
      for (const parameter of operation.parameters ?? [])
        if (parameter.$ref?.endsWith('/Csrf'))
          parameter.description = 'Đã điền sẵn 1. Swagger tự gửi header chống CSRF.';
  }
spec.components.parameters.Csrf.schema.default = '1';
spec.paths['/auth/login'].post.requestBody.content['application/json'].example = {
  username: 'staff',
  password: 'THAY_BANG_MAT_KHAU_DEMO_TREN_MAY',
};
spec.paths['/workspaces/{area}'].get.parameters[0].schema.default = 'staff';
writeFileSync(resolve(output, 'openapi.json'), JSON.stringify(spec, null, 2));
copyFileSync(resolve(web, 'scripts/swagger-init.js'), resolve(output, 'swagger-init.js'));
writeFileSync(
  resolve(output, 'index.html'),
  `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swagger UI — Sprint 1</title><link rel="stylesheet" href="./swagger-ui.css"><style>body{margin:0;background:#fafcf9}.intro{padding:24px max(20px,calc((100% - 1460px)/2));background:#194c37;color:white;font:16px/1.6 system-ui}.intro h1{margin:0;font-size:25px}.intro p{margin:8px 0}.intro a{color:#d6f4d9}.swagger-ui .scheme-container{box-shadow:none}.swagger-ui .auth-wrapper{display:none}.swagger-ui .curl-command{display:none}.swagger-ui .info{margin:25px 0}.swagger-ui .wrapper{padding:0 20px}</style></head><body><header class="intro"><h1>Demo API · Sprint 1</h1><p>Mở API → Try it out → nhập dữ liệu → Execute → xem Server response.</p><p>Thứ tự: logout → me (401) → login → workspace staff (200) → workspace admin (403) → refresh → logout → me (401).</p><p>Cookie được giữ tự động. Giới hạn login: 5 lần/phút. Không chiếu mật khẩu khi nhập. <a href="/login" target="_top">Mở giao diện đăng nhập</a></p></header><div id="swagger-ui"></div><script src="./swagger-ui-bundle.js"></script><script src="./swagger-init.js"></script></body></html>`,
);
console.log('Prepared local Swagger UI and OpenAPI documentation.');
