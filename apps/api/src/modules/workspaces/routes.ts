import type { FastifyInstance } from 'fastify';
export function registerWorkspaces(app: FastifyInstance) {
  for (const area of ['staff', 'kitchen', 'admin'] as const) {
    app.get(
      '/workspaces/' + area,
      { config: { permission: area + '.workspace' } },
      async (request) => ({
        area,
        user: request.identity,
        message:
          'Bạn đã được cấp quyền truy cập. Chức năng vận hành sẽ được bổ sung trong các Sprint sau.',
      }),
    );
  }
}
