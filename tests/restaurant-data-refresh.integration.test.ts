import { expect, it } from 'vitest';
import { refreshRestaurantCandidate } from '../scripts/restaurant-data-refresh.js';

it('refuses the live database as a target before connecting or creating any file', async () => {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://localhost:5432/qr_restaurant_ordering';
  try {
    await expect(
      refreshRestaurantCandidate({ mode: 'prepare', candidate: 'qr_restaurant_ordering' }),
    ).rejects.toThrow('distinct, explicit unified candidate');
  } finally {
    process.env.DATABASE_URL = original;
  }
});
it('refuses a remote or differently named source before contacting the database', async () => {
  const original = process.env.DATABASE_URL;
  try {
    for (const source of [
      'postgresql://remote.invalid/qr_restaurant_ordering',
      'postgresql://localhost/other_restaurant',
    ]) {
      process.env.DATABASE_URL = source;
      await expect(
        refreshRestaurantCandidate({
          mode: 'prepare',
          candidate: 'qr_restaurant_unified_20261012_v1',
        }),
      ).rejects.toThrow('exact local source database');
    }
  } finally {
    process.env.DATABASE_URL = original;
  }
});
