import { isIP } from 'node:net';

/** Only explicit proxy addresses/ranges; never trust arbitrary forwarded headers or hop counts. */
export function readTrustedProxies(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const entries = value.split(',').map((item) => item.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address ?? '');
    const bits = version === 4 ? 32 : 128;
    if (
      !version ||
      address === '0.0.0.0' ||
      address === '::' ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^[0-9]{1,3}$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits))
    )
      throw new Error('API_TRUSTED_PROXIES must contain explicit proxy IPs or scoped CIDRs.');
  }
  return [...new Set(entries)];
}
export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(ql)?:/.test(databaseUrl))
    throw new Error('DATABASE_URL must be configured; run pnpm run setup.');
  const port = Number(env.API_PORT ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('API_PORT must be a valid port.');
  return {
    databaseUrl,
    port,
    host: env.API_HOST ?? '127.0.0.1',
    trustedProxies: readTrustedProxies(env.API_TRUSTED_PROXIES),
  };
}
