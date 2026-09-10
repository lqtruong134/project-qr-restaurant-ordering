import pg from 'pg';
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  // Idle connections can fail while PostgreSQL is restarted; readiness reports this safely.
  pool.on('error', () => {});
  return {
    async ping() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); },
  };
}
