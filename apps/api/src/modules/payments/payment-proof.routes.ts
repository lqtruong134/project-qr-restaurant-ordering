import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { idParam, object, one, reject, session, transaction } from '../shared/core-persistence.js';
import { requireCollectionOwner } from './payment-requests.routes.js';
type Proof = { name: string; sha256: string; mime: string; uploadedBy: string; uploadedAt: string };
const root = () => resolve(process.env.PAYMENT_PROOF_DIR ?? '../../var/payment-proofs');
export function registerPaymentProofs(app: FastifyInstance, db: Database, restaurant: string) {
  app.post(
    '/core/payments/:id/proof',
    { config: { permission: 'staff.workspace' }, bodyLimit: 3 * 1024 * 1024 },
    async (r) => {
      let written: string | undefined;
      try {
        return await transaction(db, async (c) => {
          const ref = await one(c, 'SELECT session_id FROM payment_intent WHERE id=$1', [
            idParam(r),
          ]);
          await session(c, ref.session_id, restaurant);
          const pi = await one(c, 'SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE', [
            idParam(r),
          ]);
          if (
            pi.method !== 'BANK_TRANSFER' ||
            !['CREATED', 'PENDING'].includes(pi.status) ||
            new Date(pi.expires_at).getTime() <= Date.now()
          )
            reject('Chỉ bổ sung chứng từ cho chuyển khoản đang chờ.');
          await requireCollectionOwner(c, pi.session_id, pi.support_request_id, r.identity!.id);
          const data = object(r.body).data;
          if (
            typeof data !== 'string' ||
            !data.length ||
            data.length > 2800000 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
          )
            reject('Chọn ảnh PNG, JPEG hoặc WebP tối đa 2 MB.', 400);
          const bytes = Buffer.from(data, 'base64');
          if (bytes.length > 2 * 1024 * 1024) reject('Ảnh tối đa 2 MB.', 400);
          const ext = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? 'png'
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
              ? 'jpg'
              : bytes.toString('ascii', 0, 4) === 'RIFF' &&
                  bytes.toString('ascii', 8, 12) === 'WEBP'
                ? 'webp'
                : null;
          if (!ext) reject('Chỉ nhận ảnh PNG, JPEG hoặc WebP.', 400);
          const proof: Proof = {
            name: randomUUID() + '.' + ext,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext,
            uploadedBy: r.identity!.id,
            uploadedAt: new Date().toISOString(),
          };
          await mkdir(root(), { recursive: true, mode: 0o700 });
          written = join(root(), proof.name);
          await writeFile(written, bytes, { flag: 'wx', mode: 0o600 });
          await c.query('UPDATE payment_intent SET proof=$2::jsonb,version=version+1 WHERE id=$1', [
            pi.id,
            JSON.stringify(proof),
          ]);
          return { status: 'ok', proofUrl: '/api/core/payments/' + pi.id + '/proof' };
        });
      } catch (e) {
        if (written) await unlink(written).catch(() => {});
        throw e;
      }
    },
  );
  app.get(
    '/core/payments/:id/proof',
    { config: { permission: ['staff.workspace', 'admin.workspace'] } },
    async (r, reply) => {
      const rows = await db.pool.query(
        'SELECT pi.proof FROM payment_intent pi JOIN table_session s ON s.id=pi.session_id JOIN dining_table t ON t.id=s.table_id WHERE pi.id=$1 AND t.restaurant_id=$2',
        [idParam(r), restaurant],
      );
      const proof = rows.rows[0]?.proof as Proof | undefined;
      if (!proof || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(proof.name))
        reject('Không tìm thấy chứng từ.', 404);
      let bytes: Buffer;
      try {
        bytes = await readFile(join(root(), proof.name));
      } catch {
        reject('Không tìm thấy chứng từ.', 404);
      }
      return reply
        .header('Cache-Control', 'private,no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(proof.mime)
        .send(bytes);
    },
  );
}
