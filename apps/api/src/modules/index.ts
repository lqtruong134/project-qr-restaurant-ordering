import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { registerCatalog } from './catalog/catalog.routes.js';
import { registerGuest } from './sessions/guest.routes.js';
import { registerInventory } from './inventory/inventory.routes.js';
import { registerOrders } from './orders/orders.routes.js';
import { registerFinance } from './payments/payments.routes.js';
import { registerOperations } from './dining/dining.routes.js';
import { registerMaintenance } from './notifications/maintenance.js';
import { registerRisk } from './risk/risk.routes.js';
import { registerUsers } from './staff-access/staff-access.routes.js';
import { registerWebhooks } from './payments/webhooks.routes.js';
export function registerModules(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  secure = false,
) {
  registerCatalog(app, db, restaurant);
  registerGuest(app, db, restaurant, secure);
  registerInventory(app, db, restaurant);
  registerOrders(app, db, restaurant);
  registerFinance(app, db, restaurant);
  registerOperations(app, db, restaurant);
  registerRisk(app, db, restaurant);
  registerUsers(app, db, restaurant);
  registerWebhooks(app, db, restaurant);
  registerMaintenance(app, db, restaurant);
}
