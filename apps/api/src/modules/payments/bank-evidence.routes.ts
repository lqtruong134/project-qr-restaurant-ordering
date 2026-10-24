import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { idParam, object, uuid } from '../shared/core-persistence.js';
import type { PayosService } from './payos.service.js';
import { BankEvidenceService } from './bank-evidence.service.js';

export function registerBankEvidence(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  payos: PayosService,
) {
  const service = new BankEvidenceService(db, restaurant, payos);
  const config = { permission: 'admin.workspace' };
  const path = '/core/admin/payment-reconciliation/:id/bank-evidence';
  app.get(path, { config }, (r) => service.context(idParam(r), r.identity!.id));
  app.post(path + '/proof', { config, bodyLimit: 3 * 1024 * 1024 }, (r) =>
    service.upload(idParam(r), r.identity!.id, object(r.body).data),
  );
  app.get(path + '/proof/:proofId', { config }, async (r, reply) => {
    const { p, bytes } = await service.readProof(
      idParam(r),
      uuid(object(r.params).proofId),
      r.identity!.id,
    );
    return reply
      .header('Cache-Control', 'private,no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline')
      .type(p.mime)
      .send(bytes);
  });
  app.post(path + '/preview', { config }, (r) =>
    service.preview(idParam(r), r.identity!.id, object(r.body)),
  );
  app.post(path + '/confirm', { config }, (r) =>
    service.confirm(idParam(r), r.identity!.id, object(r.body)),
  );
}
