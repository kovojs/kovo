import { createBetterAuthSqliteRateLimitBucketConsumer } from '@kovojs/server/internal/better-auth';
import type { KovoSqliteSystemDb } from '@kovojs/server/sqlite';

import { createBetterAuthBoundedRateLimitStorage } from './rate-limit-storage.js';

/** Private SQLite binding for Kovo's bounded Better Auth credential limiter. */
export function createBetterAuthSqliteRateLimitStorage(
  secret: string,
  systemDb: KovoSqliteSystemDb,
  rateLimitTable: unknown,
) {
  return createBetterAuthBoundedRateLimitStorage(
    secret,
    createBetterAuthSqliteRateLimitBucketConsumer(systemDb, rateLimitTable),
  );
}
