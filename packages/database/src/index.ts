import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
export { hash, verify, argon2id } from 'argon2';
export function createDatabase(connectionString: string) {
 const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000, query_timeout: 5000 });
 pool.on('error', () => {});
 const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
 return { pool, prisma,
  async ping() { await pool.query('SELECT 1'); },
  async close() { await prisma.$disconnect(); await pool.end(); },
 };
}
export type Database = ReturnType<typeof createDatabase>;
