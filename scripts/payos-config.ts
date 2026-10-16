import {
  readPayosConfig,
  registerPayosWebhook,
  payosCapabilities,
} from '../apps/api/src/modules/payments/payos-adapter.js';

// No provider request is made by `check`. Registration is an explicit CLI action
// after the operator has configured a public HTTPS endpoint.
const action = process.argv[2] ?? 'check';
const required = [
  'PAYOS_CLIENT_ID',
  'PAYOS_API_KEY',
  'PAYOS_CHECKSUM_KEY',
  'PAYOS_RETURN_URL',
  'PAYOS_CANCEL_URL',
] as const;
try {
  const config = readPayosConfig();
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (action === 'check') {
    console.log(
      config.enabled
        ? 'payOS được bật trong cấu hình.'
        : 'payOS đang tắt; tiền mặt và chuyển khoản thủ công vẫn sử dụng bình thường.',
    );
    console.log(
      missing.length
        ? 'Các biến cần cấu hình: ' + missing.join(', ')
        : 'Đã có đủ biến cấu hình cần thiết. Không in giá trị khóa.',
    );
    console.log(
      config.webhookUrl
        ? 'Đã khai báo PAYOS_WEBHOOK_URL dạng HTTPS.'
        : 'PAYOS_WEBHOOK_URL có thể để trống khi phát triển local; cần HTTPS công khai khi đăng ký webhook.',
    );
    if (config.enabled && !payosCapabilities(config).online) process.exitCode = 1;
  } else if (action === 'register-webhook') {
    if (!config.enabled || !payosCapabilities(config).online || !config.webhookUrl) {
      throw Error('NOT_CONFIGURED');
    }
    const url = new URL(config.webhookUrl);
    if (
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '[::1]' ||
      /^127\./.test(url.hostname)
    )
      throw Error('NOT_PUBLIC');
    await registerPayosWebhook(config);
    console.log(
      'Đã xác nhận URL webhook với payOS. Hãy kiểm tra lại kênh thanh toán trên dashboard.',
    );
  } else throw Error('INVALID_ACTION');
} catch {
  console.error(
    'Chưa hoàn tất cấu hình payOS. Kiểm tra biến môi trường, URL HTTPS công khai và trạng thái kênh; không đăng hoặc chia sẻ nội dung khóa.',
  );
  process.exitCode = 1;
}
