import { registerMenuAssistant, type MenuAssistantOptions } from './assistant/assistant.routes.js';
import { PayosService } from './payments/payos.service.js';
import type { PayosOptions } from './payments/payos-adapter.js';
import { registerHistory } from './shared/history.routes.js';
import { registerAdminOverview } from './admin/overview.routes.js';
import { registerAdminReports } from './admin/reports.routes.js';
import { registerSupport } from './support/support.routes.js';
import { registerItemIssues } from './orders/issue.routes.js';
import { registerOrderExceptions } from './orders/exception.routes.js';
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { registerCatalog } from './catalog/catalog.routes.js';
import { registerTableAccess } from './sessions/table-access.routes.js';
import { registerGuest } from './sessions/guest.routes.js';
import { registerInventory } from './inventory/inventory.routes.js';
import { registerOrders } from './orders/orders.routes.js';
import { registerFinance } from './payments/payments.routes.js';
import { registerOperations } from './dining/dining.routes.js';
import { registerMaintenance } from './notifications/maintenance.js';
import { registerRisk } from './risk/risk.routes.js';
import { registerUsers } from './staff-access/staff-access.routes.js';
import { registerWebhooks } from './payments/webhooks.routes.js';
import { registerWorkforce } from './workforce/workforce.routes.js';
import { registerPayroll } from './workforce/payroll.routes.js';
import { registerTableTransfer } from './dining/table-transfer.routes.js';
export function registerModules(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  secure = false,
  payosOptions: PayosOptions = {},
  assistantOptions: MenuAssistantOptions = {},
) {
  const payos = new PayosService(db, restaurant, payosOptions);
  registerHistory(app, db, restaurant);
  registerAdminOverview(app, db, restaurant);
  registerAdminReports(app, db, restaurant);
  registerWorkforce(app, db, restaurant);
  registerPayroll(app, db, restaurant);
  registerTableTransfer(app, db, restaurant);
  registerCatalog(app, db, restaurant);
  registerTableAccess(app, db, restaurant, secure);
  registerGuest(app, db, restaurant, secure);
  registerMenuAssistant(app, db, restaurant, assistantOptions);
  registerInventory(app, db, restaurant);
  registerOrders(app, db, restaurant);
  registerOrderExceptions(app, db, restaurant);
  registerItemIssues(app, db, restaurant);
  registerFinance(app, db, restaurant, payos);
  registerPricing(app, db, restaurant);
  registerOperations(app, db, restaurant);
  registerSupport(app, db, restaurant);
  registerRisk(app, db, restaurant);
  registerUsers(app, db, restaurant);
  registerWebhooks(app, db, restaurant);
  registerMaintenance(app, db, restaurant, payos);
}

import { registerPricing } from './finance/pricing.routes.js';
