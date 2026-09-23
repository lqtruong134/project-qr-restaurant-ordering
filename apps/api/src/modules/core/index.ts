import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { registerCatalog } from './catalog.js';
import { registerGuest } from './guest.js';
import { registerInventory } from './inventory.js';
import { registerOrders } from './orders.js';
import { registerFinance } from './finance.js';
import { registerOperations } from './operations.js';
import { registerMaintenance } from './maintenance.js';
import { registerRisk } from './risk.js';
import { registerUsers } from './users.js';
import { registerWebhooks } from './webhooks.js';
export function registerCore(
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
