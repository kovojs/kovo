import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CAPABILITY_TTL_MS,
  createMemoryCapabilityReplayStore,
  MAX_CAPABILITY_AUDIENCE_LENGTH,
  MAX_CAPABILITY_KEY_LENGTH,
  MAX_CAPABILITY_PAYLOAD_BYTES,
  MAX_CAPABILITY_SCOPE_LENGTH,
  MAX_CAPABILITY_TOKEN_LENGTH,
  MAX_CAPABILITY_TTL_MS,
  signCapability,
  verifyCapability,
} from './capability-url.js';
import { createSigningKeyRing } from './keyring.js';

const SECRET = 'capability-url-test-secret-at-least-32-characters-long';
const OLD_SECRET = 'old-capability-secret-at-least-32-bytes';
const NEW_SECRET = 'new-capability-secret-at-least-32-bytes';

function legacyV2OneTimeCapabilityToken(key: string, expiry: number): string {
  const version = 'v2';
  const keyId = 'current';
  const method = 'GET';
  const nonce = Buffer.alloc(12, 0x2a).toString('base64url');
  const fields = [version, keyId, method, key, String(expiry), '', '1', nonce];
  const canonical = fields
    .map((field) => `${String(Buffer.byteLength(field, 'utf8'))}:${field}`)
    .join('|');
  const ring = createSigningKeyRing({
    keys: [{ id: keyId, secret: SECRET, state: 'active' }],
  });
  const signed = ring.sign({
    audience: 'storage-download',
    payload: Buffer.from(canonical, 'utf8'),
    purpose: 'capability-url',
  });
  const payload = `{"v":"${version}","i":"${keyId}","m":"${method}","k":"${key}","e":${String(expiry)},"o":1,"n":"${nonce}"}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signed.signature}`;
}

function rewritePayload(token: string, update: (payload: Record<string, unknown>) => void): string {
  const dot = token.indexOf('.');
  const payload = JSON.parse(
    Buffer.from(token.slice(0, dot), 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  update(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}${token.slice(dot)}`;
}

describe('capability-url: sign + constant-time verify before any storage read', () => {
  it('mints v3 and rejects a valid pre-watermark v2 token before replay-store access', async () => {
    const now = 1_000;
    const expiry = now + 60_000;
    const legacyToken = legacyV2OneTimeCapabilityToken('legacy.pdf', expiry);
    let legacyConsumeCalls = 0;
    await expect(
      verifyCapability(
        SECRET,
        legacyToken,
        { key: 'legacy.pdf', method: 'GET' },
        {
          now,
          replayStore: {
            consume() {
              legacyConsumeCalls += 1;
              return true;
            },
          },
        },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
    expect(legacyConsumeCalls).toBe(0);

    const current = await signCapability(
      SECRET,
      { expiresIn: 60_000, key: 'current.pdf', oneTime: true },
      now,
    );
    const rewrittenV2 = rewritePayload(current.token, (rewritten) => {
      rewritten.v = 'v2';
    });
    let rewrittenConsumeCalls = 0;
    await expect(
      verifyCapability(
        SECRET,
        rewrittenV2,
        { key: 'current.pdf', method: 'GET' },
        {
          now: now + 1,
          replayStore: {
            consume() {
              rewrittenConsumeCalls += 1;
              return true;
            },
          },
        },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
    expect(rewrittenConsumeCalls).toBe(0);

    const payload = JSON.parse(
      Buffer.from(current.token.slice(0, current.token.indexOf('.')), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(payload.v).toBe('v3');
    const consumed: Array<{ expiresAt: number; id: string }> = [];
    await expect(
      verifyCapability(
        SECRET,
        current.token,
        { key: 'current.pdf', method: 'GET' },
        {
          now: now + 1,
          replayStore: {
            consume(id, expiresAt) {
              consumed.push({ expiresAt, id });
              return true;
            },
          },
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(consumed).toEqual([
      { expiresAt: current.claims.expiry, id: expect.stringMatching(/^v3:current\.pdf:/u) },
    ]);
  });

  it('round-trips: a token signed for key+method+scope verifies against the same expected claims', async () => {
    const now = 1_000_000;
    const { token, claims } = await signCapability(
      SECRET,
      { key: 'receipts/ord_1.pdf', method: 'GET', scope: 'tenant_42', expiresIn: 60_000 },
      now,
    );
    expect(claims.expiry).toBe(now + 60_000);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'receipts/ord_1.pdf', method: 'GET', scope: 'tenant_42' },
      { now: now + 1000 },
    );
    expect(result.ok).toBe(true);
  });

  it('defaults to a short TTL and GET method', async () => {
    const now = 0;
    const { claims } = await signCapability(SECRET, { key: 'a.pdf' }, now);
    expect(claims.method).toBe('GET');
    expect(claims.expiry).toBe(DEFAULT_CAPABILITY_TTL_MS);
  });

  it('keeps capability byte encoding exact after typed-array length poisoning', async () => {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length');
    expect(descriptor?.get).toBeTypeOf('function');
    Object.defineProperty(typedArrayPrototype, 'length', {
      configurable: true,
      get: () => 0,
    });
    try {
      const signed = await signCapability(
        SECRET,
        { key: 'receipts/poison-resistant.pdf', oneTime: true },
        1_000,
      );
      await expect(
        verifyCapability(
          SECRET,
          signed.token,
          { key: signed.claims.key, method: signed.claims.method },
          {
            now: 1_001,
            replayStore: createMemoryCapabilityReplayStore({ now: () => 1_001 }),
          },
        ),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      Object.defineProperty(typedArrayPrototype, 'length', descriptor!);
    }
  });

  it('bounds signed claims, TTL, payload allocation, and untrusted wire tokens', async () => {
    const key = 'k'.repeat(MAX_CAPABILITY_KEY_LENGTH);
    const scope = 's'.repeat(MAX_CAPABILITY_SCOPE_LENGTH);
    const audience = 'a'.repeat(MAX_CAPABILITY_AUDIENCE_LENGTH);
    const signed = await signCapability(
      SECRET,
      { audience, expiresIn: MAX_CAPABILITY_TTL_MS, key, scope },
      0,
    );
    expect(signed.token.length).toBeLessThanOrEqual(MAX_CAPABILITY_TOKEN_LENGTH);
    await expect(
      verifyCapability(SECRET, signed.token, { key, method: 'GET', scope }, { audience, now: 1 }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      signCapability(SECRET, { key: 'k'.repeat(MAX_CAPABILITY_KEY_LENGTH + 1) }, 0),
    ).rejects.toThrow(/bounded claims/);
    await expect(
      signCapability(
        SECRET,
        { key: 'a.pdf', scope: 's'.repeat(MAX_CAPABILITY_SCOPE_LENGTH + 1) },
        0,
      ),
    ).rejects.toThrow(/bounded claims/);
    await expect(
      signCapability(
        SECRET,
        {
          audience: 'a'.repeat(MAX_CAPABILITY_AUDIENCE_LENGTH + 1),
          key: 'a.pdf',
        },
        0,
      ),
    ).rejects.toThrow(/bounded claims/);
    await expect(
      signCapability(SECRET, { expiresIn: MAX_CAPABILITY_TTL_MS + 1, key: 'a.pdf' }, 0),
    ).rejects.toThrow(/bounded claims/);

    await expect(
      verifyCapability(
        SECRET,
        'x'.repeat(MAX_CAPABILITY_TOKEN_LENGTH + 1),
        { key: 'a.pdf', method: 'GET' },
        { now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
    const oversizedPayload = Buffer.alloc(MAX_CAPABILITY_PAYLOAD_BYTES + 1).toString('base64url');
    await expect(
      verifyCapability(
        SECRET,
        `${oversizedPayload}.${'A'.repeat(43)}`,
        { key: 'a.pdf', method: 'GET' },
        { now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: 'k'.repeat(MAX_CAPABILITY_KEY_LENGTH + 1), method: 'GET', scope },
        { audience, now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'malformed' });
  });

  it('REJECTS a token used for a different key (object substitution)', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf', scope: 't1' }, 0);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'b.pdf', method: 'GET', scope: 't1' },
      { now: 1 },
    );
    expect(result).toEqual({ ok: false, reason: 'claim-mismatch' });
  });

  it('REJECTS a GET token used for a different method', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf', method: 'GET' }, 0);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'HEAD' },
      { now: 1 },
    );
    expect(result).toEqual({ ok: false, reason: 'claim-mismatch' });
  });

  it('REJECTS a token whose scope does not match the route scope (cross-tenant)', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf', scope: 'tenant_1' }, 0);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'GET', scope: 'tenant_2' },
      { now: 1 },
    );
    expect(result).toEqual({ ok: false, reason: 'claim-mismatch' });
  });

  it.each(['unknown', 'unresolved', 'anonymous', ''])(
    'REJECTS unresolved principal scope %j even when the signature matches',
    async (scope) => {
      const { token } = await signCapability(SECRET, { key: 'a.pdf', scope }, 0);
      const result = await verifyCapability(
        SECRET,
        token,
        { key: 'a.pdf', method: 'GET', scope },
        { now: 1 },
      );
      expect(result).toEqual({ ok: false, reason: 'claim-mismatch' });
    },
  );

  it('REJECTS an expired token', async () => {
    const now = 1000;
    const { token } = await signCapability(SECRET, { key: 'a.pdf', expiresIn: 50 }, now);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'GET' },
      { now: now + 51 },
    );
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('REJECTS a tampered signature', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const [payload, sig] = token.split('.');
    const tampered = `${payload}.${sig!.slice(0, -2)}AA`;
    const result = await verifyCapability(SECRET, tampered, { key: 'a.pdf', method: 'GET' });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('bad-signature');
  });

  it('REJECTS a token signed with a different secret', async () => {
    const { token } = await signCapability(
      'secret-A-padding-padding-padding-pad',
      { key: 'a.pdf' },
      0,
    );
    const result = await verifyCapability('secret-B-padding-padding-padding-pad', token, {
      key: 'a.pdf',
      method: 'GET',
    });
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('signs with the current KeyRing key and verifies tokens from a previous valid key', async () => {
    const previousSigner = createSigningKeyRing({
      keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
    });
    const { token: previousToken } = await signCapability(previousSigner, { key: 'a.pdf' }, 0);
    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: NEW_SECRET, state: 'active' },
        { id: 'old', secret: OLD_SECRET, state: 'previous' },
      ],
    });

    await expect(
      verifyCapability(rotated, previousToken, { key: 'a.pdf', method: 'GET' }, { now: 1 }),
    ).resolves.toEqual({
      ok: true,
      claims: { expiry: DEFAULT_CAPABILITY_TTL_MS, key: 'a.pdf', method: 'GET' },
    });

    const { token: currentToken } = await signCapability(rotated, { key: 'a.pdf' }, 0);
    await expect(
      verifyCapability(rotated, currentToken, { key: 'a.pdf', method: 'GET' }, { now: 1 }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects revoked KeyRing material and wrong verify audience', async () => {
    const oldSigner = createSigningKeyRing({
      keys: [{ id: 'old', secret: OLD_SECRET, state: 'active' }],
    });
    const { token } = await signCapability(
      oldSigner,
      { audience: 'storage-download:/files', key: 'a.pdf' },
      0,
    );
    const revoked = createSigningKeyRing({
      keys: [
        { id: 'new', secret: NEW_SECRET, state: 'active' },
        { id: 'old', secret: OLD_SECRET, state: 'revoked' },
      ],
    });

    await expect(
      verifyCapability(
        revoked,
        token,
        { key: 'a.pdf', method: 'GET' },
        { audience: 'storage-download:/files', now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad-signature' });
    await expect(
      verifyCapability(
        oldSigner,
        token,
        { key: 'a.pdf', method: 'GET' },
        { audience: 'storage-download:/other', now: 1 },
      ),
    ).resolves.toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('REJECTS malformed tokens without crashing', async () => {
    for (const bad of ['', 'no-dot', '.', 'a.', '.b', '!!!.???']) {
      const result = await verifyCapability(SECRET, bad, { key: 'a.pdf', method: 'GET' });
      expect(result.ok).toBe(false);
    }
  });

  it('canonicalization is collision-resistant across the key/scope boundary', async () => {
    // (key="ab", scope="c") and (key="a", scope="bc") must NOT produce interchangeable tokens.
    const a = await signCapability(SECRET, { key: 'ab', scope: 'c' }, 0);
    const cross = await verifyCapability(SECRET, a.token, { key: 'a', method: 'GET', scope: 'bc' });
    expect(cross.ok).toBe(false);
  });

  it('does not let a late UTF-8 encoder override collapse distinct signed claims', async () => {
    const originalEncode = TextEncoder.prototype.encode;
    try {
      TextEncoder.prototype.encode = function (value = ''): Uint8Array {
        if (/^\d+:[^|]+\|\d+:GET\|/u.test(value)) return new Uint8Array();
        return originalEncode.call(this, value);
      };
      const { token } = await signCapability(SECRET, { key: 'reports/open.txt' }, 0);
      const substituted = rewritePayload(token, (payload) => {
        payload.k = 'reports/restricted.txt';
      });

      await expect(
        verifyCapability(
          SECRET,
          substituted,
          { key: 'reports/restricted.txt', method: 'GET' },
          { now: 1 },
        ),
      ).resolves.toEqual({ ok: false, reason: 'bad-signature' });
    } finally {
      TextEncoder.prototype.encode = originalEncode;
    }
  });

  it('uses the boot-pinned clock when a late Date.now override rolls time backward', async () => {
    const { token } = await signCapability(SECRET, { expiresIn: 5, key: 'a.pdf' }, 0);
    const originalNow = Date.now;
    try {
      Date.now = () => 0;
      await expect(
        verifyCapability(SECRET, token, { key: 'a.pdf', method: 'GET' }),
      ).resolves.toEqual({ ok: false, reason: 'expired' });
    } finally {
      Date.now = originalNow;
    }
  });

  it('keeps token parsing pinned after a late JSON parser override', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const originalParse = JSON.parse;
    try {
      JSON.parse = () => ({ e: Number.MAX_SAFE_INTEGER, k: 'forged', m: 'GET', v: 'v2' });
      await expect(
        verifyCapability(SECRET, token, { key: 'a.pdf', method: 'GET' }, { now: 1 }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      JSON.parse = originalParse;
    }
  });

  it('rejects non-canonical and type-confused payload encodings before authorization', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const variants = [
      rewritePayload(token, (payload) => {
        payload.extra = 'ignored';
      }),
      rewritePayload(token, (payload) => {
        payload.e = 1.5;
      }),
      rewritePayload(token, (payload) => {
        payload.o = 1;
      }),
    ];
    for (const variant of variants) {
      await expect(
        verifyCapability(SECRET, variant, { key: 'a.pdf', method: 'GET' }, { now: 1 }),
      ).resolves.toEqual({ ok: false, reason: 'malformed' });
    }
  });
});

describe('capability-url: one-time tokens via a replay store', () => {
  it('a one-time token verifies once, then is rejected as replayed', async () => {
    const store = createMemoryCapabilityReplayStore({ now: () => 1 });
    const { token } = await signCapability(
      SECRET,
      { key: 'a.pdf', oneTime: true, expiresIn: 60_000 },
      0,
    );
    const first = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'GET' },
      { now: 1, replayStore: store },
    );
    expect(first.ok).toBe(true);
    const second = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'GET' },
      { now: 2, replayStore: store },
    );
    expect(second).toEqual({ ok: false, reason: 'replayed' });
  });

  it('does not let a late Map.has override resurrect a consumed token', async () => {
    const store = createMemoryCapabilityReplayStore({ now: () => 1 });
    const { token } = await signCapability(
      SECRET,
      { expiresIn: 60_000, key: 'once.pdf', oneTime: true },
      0,
    );
    await expect(
      verifyCapability(
        SECRET,
        token,
        { key: 'once.pdf', method: 'GET' },
        { now: 1, replayStore: store },
      ),
    ).resolves.toMatchObject({ ok: true });

    const originalHas = Map.prototype.has;
    try {
      Map.prototype.has = () => false;
      await expect(
        verifyCapability(
          SECRET,
          token,
          { key: 'once.pdf', method: 'GET' },
          { now: 2, replayStore: store },
        ),
      ).resolves.toEqual({ ok: false, reason: 'replayed' });
    } finally {
      Map.prototype.has = originalHas;
    }
  });

  it('C243 does not let an inherited entry setter evict an unexpired replay id', () => {
    let now = 1;
    const store = createMemoryCapabilityReplayStore({ now: () => now });
    expect(store.consume('token-id', 100)).toBe(true);
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (Array.isArray(value) && value[0] === 'token-id') {
            poisonHits += 1;
            nativeDefineProperty(this, '0', {
              configurable: true,
              enumerable: true,
              value: ['token-id', 0],
              writable: true,
            });
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      now = 2;
      expect(store.size()).toBe(1);
      expect(store.consume('token-id', 100)).toBe(false);
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalDescriptor);
    }
    expect(poisonHits).toBe(0);
  });

  it('a one-time token fails closed when no replay store is provided', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf', oneTime: true }, 0);
    const result = await verifyCapability(
      SECRET,
      token,
      { key: 'a.pdf', method: 'GET' },
      { now: 1 },
    );
    expect(result).toEqual({ ok: false, reason: 'replayed' });
  });

  it('two one-time tokens for the same key are independent (distinct nonces)', async () => {
    const store = createMemoryCapabilityReplayStore({ now: () => 1 });
    const t1 = await signCapability(SECRET, { key: 'a.pdf', oneTime: true }, 0);
    const t2 = await signCapability(SECRET, { key: 'a.pdf', oneTime: true }, 0);
    expect(t1.token).not.toBe(t2.token);
    const r1 = await verifyCapability(
      SECRET,
      t1.token,
      { key: 'a.pdf', method: 'GET' },
      { now: 1, replayStore: store },
    );
    const r2 = await verifyCapability(
      SECRET,
      t2.token,
      { key: 'a.pdf', method: 'GET' },
      { now: 1, replayStore: store },
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('fails closed at active replay capacity without reopening a consumed nonce', () => {
    let now = 1;
    const store = createMemoryCapabilityReplayStore({ maxEntries: 2, now: () => now });

    expect(store.consume('nonce-a', 100)).toBe(true);
    expect(store.consume('nonce-b', 100)).toBe(true);
    for (let index = 0; index < 1_000; index += 1) {
      expect(store.consume(`churn-${index}`, 100)).toBe(false);
      expect(store.size()).toBe(2);
    }
    expect(store.consume('nonce-a', 100)).toBe(false);

    now = 100;
    expect(store.consume('nonce-c', 200)).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('rejects invalid replay-store capacity without invoking accessors', () => {
    expect(() => createMemoryCapabilityReplayStore({ maxEntries: -1 })).toThrow(
      /maxEntries.*non-negative integer/u,
    );

    let getterCalls = 0;
    const accessor = {} as { maxEntries?: number };
    Object.defineProperty(accessor, 'maxEntries', {
      configurable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    expect(() => createMemoryCapabilityReplayStore(accessor)).toThrow();
    expect(getterCalls).toBe(0);
  });

  it('keeps one-time nonce entropy pinned after a late RNG method override', async () => {
    const cryptoPrototype = Object.getPrototypeOf(globalThis.crypto) as {
      getRandomValues: typeof globalThis.crypto.getRandomValues;
    };
    const originalGetRandomValues = cryptoPrototype.getRandomValues;
    try {
      cryptoPrototype.getRandomValues = function <Value extends ArrayBufferView | null>(
        value: Value,
      ): Value {
        if (value !== null) {
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
        }
        return value;
      };
      const first = await signCapability(SECRET, { key: 'a.pdf', oneTime: true }, 0);
      const second = await signCapability(SECRET, { key: 'a.pdf', oneTime: true }, 0);
      expect(first.token).not.toBe(second.token);
    } finally {
      cryptoPrototype.getRandomValues = originalGetRandomValues;
    }
  });

  it('evicts one-time replay ids at the signed token expiry', async () => {
    let currentTime = 0;
    const store = createMemoryCapabilityReplayStore({ now: () => currentTime });
    const { token } = await signCapability(
      SECRET,
      { key: 'a.pdf', oneTime: true, expiresIn: 1000 },
      0,
    );

    await expect(
      verifyCapability(
        SECRET,
        token,
        { key: 'a.pdf', method: 'GET' },
        { now: 1, replayStore: store },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(store.size()).toBe(1);

    currentTime = 999;
    expect(store.size()).toBe(1);

    currentTime = 1000;
    expect(store.size()).toBe(0);
  });

  it('never reopens a reclaimed one-time nonce after clock rollback', () => {
    let now = 1;
    const store = createMemoryCapabilityReplayStore({ now: () => now });

    expect(store.consume('v1:key:nonce', 10)).toBe(true);
    now = 10;
    expect(store.size()).toBe(0);

    now = 5;
    expect(store.consume('v1:key:nonce', 10)).toBe(false);
    expect(store.consume('another-old-window', 9)).toBe(false);
    expect(store.consume('newer-window', 11)).toBe(true);
  });
});
