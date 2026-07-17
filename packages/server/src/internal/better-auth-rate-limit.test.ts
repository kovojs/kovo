import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo } from '@kovojs/drizzle';
import { eq, sql } from 'drizzle-orm';
import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kovojs/better-auth/internal/server-mount-adapter', () => ({
  assertBetterAuthMountAdapter: vi.fn(),
  invokeBetterAuthMountAdapter: vi.fn(),
}));

import { createPostgresAppRuntimeDb, type KovoPostgresAppRuntimeDb } from '../postgres-runtime.js';
import { usePostgresSystemDb } from './postgres-capability.js';
import { createBetterAuthPostgresRateLimitBucketConsumer } from './better-auth.js';

const rateLimit = pgTable(
  'rateLimit',
  {
    count: integer('count').notNull(),
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
  },
  kovo({
    authzPolicy: sql`false`,
    domain: 'auth-rate-limit-test',
    key: 'id',
    secret: true,
  }),
);

const input = { bucketKey: 'kovo-ba-rl-v1:0042', max: 3, windowMs: 10_000 } as const;
const roots: string[] = [];
const runtimes: KovoPostgresAppRuntimeDb[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Better Auth Postgres bounded rate-limit consumer', () => {
  it('admits exactly three concurrent requests across independent consumers', async () => {
    const { first, second, systemDb } = await consumers();

    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? first(input) : second(input))),
    );

    expect(decisions.filter(Boolean)).toHaveLength(3);
    expect(decisions.filter((allowed) => !allowed)).toHaveLength(17);
    await expect(
      usePostgresSystemDb(systemDb, (db) => db.select().from(rateLimit)),
    ).resolves.toEqual([
      expect.objectContaining({
        count: 3,
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        key: input.bucketKey,
      }),
    ]);
  });

  it('resets an expired bucket by the database clock, independent of process time', async () => {
    const { first, second, systemDb } = await consumers();
    await Promise.all([first(input), first(input), first(input)]);
    await usePostgresSystemDb(systemDb, (db) =>
      db.update(rateLimit).set({ lastRequest: 0 }).where(eq(rateLimit.key, input.bucketKey)),
    );
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);

    await expect(second(input)).resolves.toBe(true);
    await expect(
      usePostgresSystemDb(systemDb, (db) => db.select({ count: rateLimit.count }).from(rateLimit)),
    ).resolves.toEqual([{ count: 1 }]);
  });
});

async function consumers() {
  const dataDir = mkdtempSync(join(tmpdir(), 'kovo-better-auth-rate-limit-'));
  roots.push(dataDir);
  const runtime = createPostgresAppRuntimeDb({
    dataDir,
    driver: 'pglite',
    schema: { rateLimit },
  });
  runtimes.push(runtime);
  await runtime.ready;
  const systemDb = runtime.systemDb({
    operation: 'write',
    reason: 'Prove atomic bounded Better Auth rate-limit decisions',
    surface: 'packages/server/src/internal/better-auth-rate-limit.test.ts',
  });
  return {
    first: createBetterAuthPostgresRateLimitBucketConsumer(systemDb, rateLimit),
    second: createBetterAuthPostgresRateLimitBucketConsumer(systemDb, rateLimit),
    systemDb,
  };
}
