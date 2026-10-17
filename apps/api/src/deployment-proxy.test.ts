import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { readTrustedProxies } from './config.js';

describe('deployment proxy trust boundary', () => {
  it('defaults to no proxy trust and accepts only explicit addresses or scoped CIDRs', () => {
    expect(readTrustedProxies(undefined)).toEqual([]);
    expect(readTrustedProxies('')).toEqual([]);
    expect(readTrustedProxies(' 172.30.80.10, 2001:db8::1,172.30.80.10 ')).toEqual([
      '172.30.80.10',
      '2001:db8::1',
    ]);
    expect(readTrustedProxies('172.30.80.0/24')).toEqual(['172.30.80.0/24']);
    for (const value of [
      'true',
      '1',
      '*',
      'private_ranges',
      '0.0.0.0/0',
      '::/0',
      '172.30.80.10/33',
      '2001:db8::1/129',
      '172.30.80.10,',
      '172.30.80.10/24/1',
    ])
      expect(() => readTrustedProxies(value)).toThrow('API_TRUSTED_PROXIES');
  });

  it('ignores forged forwarding metadata when the immediate peer is not trusted', async () => {
    const app = buildApp({ async ping() {} }, false, ['172.30.80.10']);
    app.get('/test-proxy', async (request) => ({
      ip: request.ip,
      protocol: request.protocol,
    }));
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test-proxy',
        remoteAddress: '203.0.113.5',
        headers: {
          'x-forwarded-for': '198.51.100.24',
          'x-forwarded-proto': 'https',
          'cf-connecting-ip': '198.51.100.25',
          forwarded: 'for=198.51.100.26;proto=https',
        },
      });
      expect(response.json()).toEqual({ ip: '203.0.113.5', protocol: 'http' });
    } finally {
      await app.close();
    }
  });

  it('uses canonical forwarded client identity only through the configured Caddy peer', async () => {
    const app = buildApp({ async ping() {} }, false, ['172.30.80.10']);
    app.get('/test-proxy', async (request) => ({
      ip: request.ip,
      protocol: request.protocol,
      hostname: request.hostname,
    }));
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/test-proxy',
        remoteAddress: '172.30.80.10',
        headers: {
          'x-forwarded-for': '198.51.100.24',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'qtruongres.example',
        },
      });
      expect(response.json()).toEqual({
        ip: '198.51.100.24',
        protocol: 'https',
        hostname: 'qtruongres.example',
      });
    } finally {
      await app.close();
    }
  });
});
