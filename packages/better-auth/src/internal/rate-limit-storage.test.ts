import { describe, expect, it, vi } from 'vitest';

import { createBetterAuthBoundedRateLimitStorage } from './rate-limit-storage.js';

const secret = 'Kovo-Bounded-Rate-Limit-Test-Secret-0a1B2c3D4e5F6g7H8i9J';
const rule = { max: 3, window: 10 };

describe('bounded Better Auth credential rate-limit storage', () => {
  it('declares exact POST-only credential rules and disables every other route', async () => {
    const options = createBetterAuthBoundedRateLimitStorage(secret, async () => true);
    const signInRule = options.customRules?.['/sign-in/email'];
    const signUpRule = options.customRules?.['/sign-up/email'];

    expect(options.enabled).toBe(true);
    expect(options.storage).toBe('database');
    expect(Object.keys(options.customRules ?? {})).toEqual([
      '/sign-in/email',
      '/sign-up/email',
      '/**',
    ]);
    if (typeof signInRule !== 'function' || typeof signUpRule !== 'function') {
      throw new Error('missing exact credential rules');
    }
    expect(await signInRule(new Request('https://app.test/sign-in/email'), rule)).toBe(false);
    expect(
      await signUpRule(new Request('https://app.test/sign-up/email', { method: 'POST' }), rule),
    ).toEqual(rule);
    expect(options.customRules?.['/**']).toBe(false);
  });

  it('maps arbitrary raw identities into a fixed-width bounded HMAC keyspace', async () => {
    const buckets = new Set<string>();
    const options = createBetterAuthBoundedRateLimitStorage(
      secret,
      async ({ bucketKey }) => {
        buckets.add(bucketKey);
        return true;
      },
      { bucketCount: 4 },
    );
    const consume = options.customStorage?.consume;
    expect(consume).toBeTypeOf('function');

    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        consume?.(`198.51.100.${index}|/sign-in/email`, rule),
      ),
    );

    expect(buckets.size).toBeLessThanOrEqual(4);
    expect(buckets.size).toBeGreaterThan(1);
    expect([...buckets].every((key) => /^kovo-ba-rl-v1:000[0-3]$/u.test(key))).toBe(true);
  });

  it('aggregates HMAC collisions so the shared ceiling fails closed', async () => {
    const counts = new Map<string, number>();
    const consumeBucket = vi.fn(async ({ bucketKey }: { bucketKey: string }) => {
      const count = counts.get(bucketKey) ?? 0;
      if (count >= 3) return false;
      counts.set(bucketKey, count + 1);
      return true;
    });
    const options = createBetterAuthBoundedRateLimitStorage(secret, consumeBucket, {
      bucketCount: 1,
    });
    const consume = options.customStorage?.consume;
    if (consume === undefined) throw new Error('missing atomic consume');

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) => consume(`203.0.113.${index}|/sign-in/email`, rule)),
    );

    expect(results.filter(({ allowed }) => allowed)).toHaveLength(3);
    expect(results.filter(({ allowed }) => !allowed)).toEqual([{ allowed: false, retryAfter: 10 }]);
    expect(counts).toEqual(new Map([['kovo-ba-rl-v1:0000', 3]]));
  });

  it('fails loud on fallback, unknown paths, oversized keys, and widened rules', async () => {
    const options = createBetterAuthBoundedRateLimitStorage(secret, async () => true);
    const storage = options.customStorage;
    if (storage?.consume === undefined) throw new Error('missing atomic storage');

    await expect(storage.get('raw')).rejects.toThrow(/fallback is disabled/u);
    await expect(storage.set('raw', { count: 1, key: 'raw', lastRequest: 0 })).rejects.toThrow(
      /fallback is disabled/u,
    );
    await expect(storage.consume('198.51.100.1|/reset-password', rule)).rejects.toThrow(
      /unreviewed credential rate-limit path/u,
    );
    await expect(storage.consume(`${'x'.repeat(1_025)}|/sign-in/email`, rule)).rejects.toThrow(
      /invalid credential rate-limit key/u,
    );
    await expect(
      storage.consume('198.51.100.1|/sign-in/email', { max: 4, window: 10 }),
    ).rejects.toThrow(/unreviewed credential rate-limit rule/u);
  });
});
