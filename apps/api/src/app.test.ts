import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
describe('Service health', () => {
  it('reports readiness only after the database query succeeds', async () => {
    const app = buildApp({ async ping() {} });
    try {
      expect((await app.inject('/health/ready')).json()).toEqual({ status: 'ok', service: 'api', database: 'connected' });
      expect((await app.inject('/health/live')).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('returns 503 without exposing credentials when database is unavailable', async () => {
    const app = buildApp({ async ping() { throw new Error('private connection details'); } });
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('private connection');
      expect((await app.inject('/health/live')).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('rejects missing database configuration and invalid ports', () => {
    expect(() => readConfig({})).toThrow('DATABASE_URL');
    expect(() => readConfig({ DATABASE_URL: 'postgresql://localhost/test', API_PORT: '-1' })).toThrow('API_PORT');
  });
});
