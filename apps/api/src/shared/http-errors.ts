import type { FastifyReply } from 'fastify';
export const authMessages = {
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
  ACCOUNT_LOCKED: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn hoặc tài khoản được đăng nhập trên thiết bị khác.',
  PERMISSION_DENIED: 'Bạn không có quyền thực hiện thao tác này.',
} as const;
export function fail(reply: FastifyReply, code: number, errorCode: string, userMessage: string) {
  return reply.code(code).send({ errorCode, userMessage, correlationId: reply.request.id });
}
export const unauthorized = (reply: FastifyReply) =>
  fail(reply, 401, 'SESSION_EXPIRED', authMessages.SESSION_EXPIRED);
