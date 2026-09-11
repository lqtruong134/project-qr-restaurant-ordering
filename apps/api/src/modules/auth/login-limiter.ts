// In-memory, single API process only. Use shared storage before scaling to multiple instances.
export function createLoginLimiter(limit: number, now: () => number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid login limit');
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    consume(username: string, ip: string) {
      const time = now();
      for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
      const keys = ['account:' + username, 'ip:' + ip];
      if (keys.some((key) => (attempts.get(key)?.count ?? 0) >= limit) || attempts.size > 10000)
        return false;
      for (const key of keys) {
        const old = attempts.get(key);
        attempts.set(key, { count: (old?.count ?? 0) + 1, until: old?.until ?? time + 60000 });
      }
      return true;
    },
  };
}
