import Fastify from 'fastify';
import type { ServiceHealth } from '@thesis/contracts';
export function buildApp(database: { ping(): Promise<void> }, logging = false) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    logger: logging
      ? {
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
        }
      : false,
  });
  app.get('/health/live', { config: { public: true } }, async (): Promise<ServiceHealth> => ({
    status: 'ok',
    service: 'api',
  }));
  app.get(
    '/health/ready',
    { config: { public: true } },
    async (_request, reply): Promise<ServiceHealth> => {
      try {
        await database.ping();
        return { status: 'ok', service: 'api', database: 'connected' };
      } catch {
        reply.code(503);
        return { status: 'unavailable', service: 'api', database: 'unavailable' };
      }
    },
  );
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      errorCode: 'NOT_FOUND',
      userMessage: 'Không tìm thấy chức năng.',
      correlationId: _request.id,
    }),
  );
  app.setErrorHandler((error, request, reply) => {
    if (
      error &&
      typeof error === 'object' &&
      (('validation' in error && error.validation) ||
        ('statusCode' in error && error.statusCode === 400))
    )
      return reply.code(400).send({
        errorCode: 'INVALID_INPUT',
        userMessage: 'Vui lòng kiểm tra thông tin đã nhập.',
        correlationId: request.id,
      });
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply.code(error.statusCode).send({
        errorCode: 'INVALID_REQUEST',
        userMessage: 'Yêu cầu không được hỗ trợ hoặc vượt giới hạn.',
        correlationId: request.id,
      });
    request.log.error({ errorCode: 'INTERNAL_ERROR' }, 'Request failed');
    reply.code(500).send({
      errorCode: 'INTERNAL_ERROR',
      userMessage: 'Có lỗi xảy ra. Vui lòng thử lại.',
      correlationId: request.id,
    });
  });
  return app;
}
