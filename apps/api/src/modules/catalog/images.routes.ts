import type { FastifyInstance } from 'fastify';
import {
  decodeMenuImage,
  MenuImageError,
  readMenuImage,
  storeMenuImage,
} from '@thesis/database/menu-images';
import { object, reject } from '../shared/core-persistence.js';

export function registerImages(app: FastifyInstance) {
  app.post(
    '/core/menu-images',
    { config: { permission: 'admin.workspace' }, bodyLimit: 3 * 1024 * 1024 },
    async (r) => {
      try {
        const stored = await storeMenuImage(decodeMenuImage(object(r.body).data));
        return { imageUrl: stored.imageUrl };
      } catch (error) {
        if (error instanceof MenuImageError) reject(error.message, 400);
        throw error;
      }
    },
  );
  app.get('/menu-images/:name', { config: { public: true } }, async (r, reply) => {
    let image: Awaited<ReturnType<typeof readMenuImage>>;
    try {
      image = await readMenuImage(String(object(r.params).name));
    } catch {
      reject('Không tìm thấy ảnh.', 404);
    }
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public,max-age=31536000,immutable')
      .type(image.mimeType)
      .send(image.bytes);
  });
}
