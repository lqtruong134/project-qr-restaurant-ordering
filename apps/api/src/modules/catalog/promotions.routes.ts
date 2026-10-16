import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  listMenuPromotions,
  MenuPromotionError,
  saveMenuPromotion,
} from '@thesis/database/menu-promotions';
import { MenuImageError } from '@thesis/database/menu-images';
import type { MenuPromotion } from '@thesis/contracts';
import { idParam, integer, object, one, reject, transaction } from '../shared/core-persistence.js';

export function registerMenuPromotions(app: FastifyInstance, db: Database, restaurant: string) {
  const config = { permission: 'admin.workspace' };
  app.get('/core/menu-promotions', { config }, () => listMenuPromotions(db.pool, restaurant));
  app.post('/core/menu-promotions', { config }, (r) =>
    transaction(db, async (c) => {
      try {
        return await saveMenuPromotion(c, restaurant, object(r.body));
      } catch (error) {
        if (error instanceof MenuPromotionError) reject(error.message, error.status);
        if (error instanceof MenuImageError) reject(error.message, 400);
        throw error;
      }
    }),
  );
  app.patch('/core/menu-promotions/:id', { config }, (r) =>
    transaction(db, async (c) => {
      const existing = await one(
        c,
        'SELECT *,expected_price::text FROM menu_promotion WHERE id=$1 AND restaurant_id=$2 AND NOT is_deleted FOR UPDATE',
        [idParam(r), restaurant],
      );
      try {
        return await saveMenuPromotion(c, restaurant, object(r.body), existing as MenuPromotion);
      } catch (error) {
        if (error instanceof MenuPromotionError) reject(error.message, error.status);
        if (error instanceof MenuImageError) reject(error.message, 400);
        throw error;
      }
    }),
  );
  app.delete('/core/menu-promotions/:id', { config }, (r) =>
    transaction(db, async (c) => {
      const existing = await one(
        c,
        'SELECT id,version FROM menu_promotion WHERE id=$1 AND restaurant_id=$2 AND NOT is_deleted FOR UPDATE',
        [idParam(r), restaurant],
      );
      if (existing.version !== integer(object(r.body).version, 1, 2147483646))
        reject('Ảnh giới thiệu đã thay đổi. Vui lòng tải lại.', 409);
      await c.query(
        'UPDATE menu_promotion SET is_deleted=true,is_active=false,version=version+1 WHERE id=$1 AND restaurant_id=$2',
        [existing.id, restaurant],
      );
      return { id: existing.id, deleted: true };
    }),
  );
}
