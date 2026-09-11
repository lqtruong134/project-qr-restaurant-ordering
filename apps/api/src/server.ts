import { createDatabase } from '@thesis/database';
import { buildApp } from './app.js';
import { registerAuth } from './auth.js';
import { readConfig } from './config.js';
const config = readConfig(process.env);
const database = createDatabase(config.databaseUrl);
const app = buildApp(database, true);
await registerAuth(app, database, {
  secret: process.env.AUTH_SECRET ?? '',
  restaurantId: process.env.RESTAURANT_ID ?? '',
  origins: (process.env.APP_ORIGINS ?? '').split(','),
  secure: process.env.NODE_ENV === 'production',
  loginLimit: Number(process.env.LOGIN_LIMIT ?? 5),
});
app.addHook('onClose', async () => {
  await database.close();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port: config.port, host: config.host });
