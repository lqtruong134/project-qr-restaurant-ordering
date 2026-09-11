import type { FastifyReply } from 'fastify';
export function fail(reply: FastifyReply, code: number, errorCode: string, userMessage: string) {
  return reply.code(code).send({ errorCode, userMessage, correlationId: reply.request.id });
}

export const unauthorized = (reply: FastifyReply) =>
  fail(reply, 401, 'UNAUTHORIZED', 'Thông tin đăng nhập không hợp lệ hoặc phiên đã hết hạn.');
