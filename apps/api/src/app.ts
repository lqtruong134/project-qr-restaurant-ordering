import Fastify from 'fastify';
import type { ServiceHealth } from '@thesis/contracts';
export function buildApp(database: { ping(): Promise<void> }, logging = false) {
  const app = Fastify({ logger: logging ? {
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
  } : false });
  app.get('/health/live', async (): Promise<ServiceHealth> => ({ status: 'ok', service: 'api' }));
  app.get('/health/ready', async (_request, reply): Promise<ServiceHealth> => {
    try {
      await database.ping();
      return { status: 'ok', service: 'api', database: 'connected' };
    } catch {
      reply.code(503);
      return { status: 'unavailable', service: 'api', database: 'unavailable' };
    }
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ errorCode: 'NOT_FOUND', userMessage: 'Không tìm thấy chức năng.', correlationId: _request.id }));
  app.setErrorHandler((_error, request, reply) => {
    request.log.error({ errorCode: 'INTERNAL_ERROR' }, 'Request failed');
    reply.code(500).send({ errorCode: 'INTERNAL_ERROR', userMessage: 'Có lỗi xảy ra. Vui lòng thử lại.', correlationId: request.id });
  });
  return app;
}
