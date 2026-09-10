import { createDatabase } from '@thesis/database';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
const config = readConfig(process.env);
const database = createDatabase(config.databaseUrl);
const app = buildApp(database, true);
app.addHook('onClose', async () => { await database.close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ port: config.port, host: config.host });
