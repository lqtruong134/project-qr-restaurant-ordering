// Public entry point retained for existing callers and tests.
import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import { registerAuth as registerAuthentication } from './modules/auth/index.js';
import { registerWorkspaces } from './modules/workspaces/routes.js';
import type { AuthOptions } from './modules/auth/types.js';
export type { AuthOptions } from './modules/auth/types.js';
export { fail } from './shared/http-errors.js';
export async function registerAuth(app: FastifyInstance, db: Database, options: AuthOptions) {
  await registerAuthentication(app, db, options);
  registerWorkspaces(app);
}
