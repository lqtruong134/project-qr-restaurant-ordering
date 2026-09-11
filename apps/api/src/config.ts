export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(ql)?:/.test(databaseUrl))
    throw new Error('DATABASE_URL must be configured; run pnpm run setup.');
  const port = Number(env.API_PORT ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('API_PORT must be a valid port.');
  return { databaseUrl, port, host: env.API_HOST ?? '127.0.0.1' };
}
