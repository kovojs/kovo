import type { KovoPostgresSystemDb } from '@kovojs/server';
import { createBetterAuthPostgresRateLimitBucketConsumer } from '@kovojs/server/internal/better-auth';

import { createBetterAuthBoundedRateLimitStorage } from './rate-limit-storage.js';

/** Private Postgres binding for Kovo's bounded Better Auth credential limiter. */
export function createBetterAuthPostgresRateLimitStorage(
  secret: string,
  systemDb: KovoPostgresSystemDb,
  rateLimitTable: unknown,
) {
  return createBetterAuthBoundedRateLimitStorage(
    secret,
    createBetterAuthPostgresRateLimitBucketConsumer(systemDb, rateLimitTable),
  );
}
