import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { object, reject } from '../shared/core-persistence.js';
export function registerImages(app: FastifyInstance) {
  const root = resolve(process.env.MENU_UPLOAD_DIR ?? '../../var/menu-images');
  app.post(
    '/core/menu-images',
    { config: { permission: 'admin.workspace' }, bodyLimit: 3 * 1024 * 1024 },
    async (r) => {
      const b = object(r.body);
      if (
        typeof b.data !== 'string' ||
        !b.data.length ||
        b.data.length > 2800000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data)
      )
        reject('Ảnh không hợp lệ; chọn PNG, JPEG hoặc WebP tối đa 2 MB.', 400);
      const bytes = Buffer.from(b.data, 'base64');
      if (bytes.length > 2 * 1024 * 1024) reject('Ảnh tối đa 2 MB.', 400);
      const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'jpg'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
            ? 'webp'
            : null;
      if (!ext) reject('Chỉ nhận ảnh PNG, JPEG hoặc WebP.', 400);
      await mkdir(root, { recursive: true });
      const name = randomUUID() + '.' + ext;
      await writeFile(join(root, name), bytes, { flag: 'wx' });
      return { imageUrl: '/api/menu-images/' + name };
    },
  );
  app.get('/menu-images/:name', { config: { public: true } }, async (r, reply) => {
    const name = String(object(r.params).name);
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)) reject('Không tìm thấy ảnh.', 404);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(root, name));
    } catch {
      reject('Không tìm thấy ảnh.', 404);
    }
    const ext = name.split('.').pop();
    return reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public,max-age=31536000,immutable')
      .type(ext === 'jpg' ? 'image/jpeg' : 'image/' + ext)
      .send(bytes);
  });
}
