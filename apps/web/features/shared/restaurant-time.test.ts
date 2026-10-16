import { afterEach, describe, expect, it, vi } from 'vitest';
import { restaurantDateTime, restaurantTime } from './restaurant-time';

afterEach(() => vi.unstubAllEnvs());

describe('operation timestamps in restaurant time', () => {
  for (const deviceZone of ['UTC', 'America/New_York']) {
    it(`keeps the restaurant date and clock when the device uses ${deviceZone}`, () => {
      vi.stubEnv('TZ', deviceZone);
      const timestamp = '2026-09-30T17:15:00.000Z';
      expect(restaurantDateTime(timestamp)).toContain('1/10/2026');
      expect(restaurantDateTime(timestamp)).toContain('00:15:00');
      expect(restaurantTime(timestamp)).toBe('00:15:00');
      expect(restaurantTime(timestamp, { hour: '2-digit', minute: '2-digit' })).toBe('00:15');
    });
  }
});
