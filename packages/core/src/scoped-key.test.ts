import { describe, expect, it } from 'vitest';

import { publicScopedKey, type ScopedKey } from './index.js';
import {
  createMemoryStorage,
  frameworkScopedKey,
  isScopedKey,
  principalScopedKey,
  restoreScopedKey,
  scopedKeyFactsFor,
  scopedKeysEqual,
} from './internal/storage.js';

describe('ScopedKey owner provenance (SPEC §6.6 C9)', () => {
  it('frames posture, authority, and app key without delimiter or NUL collisions', () => {
    const principal = principalScopedKey('tenant:one\0admin', 'invoices/1:latest\0');
    const publicKey = publicScopedKey('invoices/1:latest\0');
    const shifted = principalScopedKey('tenant', 'one\0admin:invoices/1:latest\0');

    expect(scopedKeyFactsFor(principal)).toMatchObject({
      authority: 'tenant:one\0admin',
      key: 'invoices/1:latest\0',
      posture: 'principal',
    });
    expect(scopedKeyFactsFor(principal).frame).not.toBe(scopedKeyFactsFor(publicKey).frame);
    expect(scopedKeyFactsFor(principal).frame).not.toBe(scopedKeyFactsFor(shifted).frame);
  });

  it('round-trips only canonical persisted frames and finite system postures', () => {
    const original = frameworkScopedKey('durable-task-cron', 'nightly:2026-07-19');
    const restored = restoreScopedKey(scopedKeyFactsFor(original).frame);

    expect(scopedKeysEqual(original, restored)).toBe(true);
    expect(scopedKeyFactsFor(restored)).toMatchObject({
      key: 'nightly:2026-07-19',
      posture: 'system',
      systemPosture: 'durable-task-cron',
    });
    expect(() => restoreScopedKey('01:x')).toThrow(/KV450/u);
    expect(() => restoreScopedKey('18:kovo-scoped-key-v16:system7:unknown1:k')).toThrow(/KV450/u);
    expect(() => frameworkScopedKey('app-reason' as never, 'k')).toThrow(/KV450/u);
  });

  it('bounds the registered replay composite by the complete canonical frame', () => {
    const maximum = frameworkScopedKey('mutation-replay', 'r'.repeat(4_044));
    const frame = scopedKeyFactsFor(maximum).frame;

    expect(frame).toHaveLength(4_096);
    expect(frame).toBe(`18:kovo-scoped-key-v16:system15:mutation-replay4044:${'r'.repeat(4_044)}`);
    expect(scopedKeysEqual(maximum, restoreScopedKey(frame))).toBe(true);
    expect(() => frameworkScopedKey('mutation-replay', 'r'.repeat(4_045))).toThrow(
      /frame must be at most 4096 code units/u,
    );
    expect(() => publicScopedKey('r'.repeat(1_025))).toThrow(
      /app key must be a 1\.\.1024 code-unit string/u,
    );
    expect(() => frameworkScopedKey('better-auth-rate-limit', 'r'.repeat(1_025))).toThrow(
      /app key must be a 1\.\.1024 code-unit string/u,
    );
  });

  it('rejects bare strings, structural lookalikes, proxies, and TypeScript casts at the sink', async () => {
    const storage = createMemoryStorage();
    const forged = Object.freeze(Object.create(null)) as ScopedKey;
    const proxy = new Proxy(publicScopedKey('safe'), {});

    const compileOnly = () => {
      // @ts-expect-error Storage keys require a framework-minted ScopedKey.
      void storage.get('bare-string');
    };
    void compileOnly;
    await expect(storage.get('bare-string' as unknown as ScopedKey)).rejects.toThrow(/KV450/u);
    await expect(storage.get(forged)).rejects.toThrow(/KV450/u);
    await expect(storage.get(proxy)).rejects.toThrow(/KV450/u);
    expect(isScopedKey(forged)).toBe(false);
    expect(isScopedKey(proxy)).toBe(false);
  });

  it('keeps the public value opaque while authenticating it in the originating runtime', () => {
    const key = publicScopedKey('shared/catalog.json');

    expect(isScopedKey(key)).toBe(true);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Reflect.ownKeys(key)).toEqual([]);
    expect(scopedKeyFactsFor(key)).toMatchObject({
      authority: 'public',
      key: 'shared/catalog.json',
      posture: 'public',
    });
  });
});
