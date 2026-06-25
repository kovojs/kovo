import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CAPABILITY_TTL_MS,
  createMemoryCapabilityReplayStore,
  signCapability,
  verifyCapability,
} from './capability-url.js';
import { createSigningKeyRing } from './keyring.js';

const SECRET = 'capability-url-test-secret-at-least-32-characters-long';

describe('capability-url: sign + constant-time verify before any storage read', () => {
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

  it('ignores untrusted token alg fields and keeps verification pinned to the KeyRing type', async () => {
    const { token } = await signCapability(SECRET, { key: 'a.pdf' }, 0);
    const tokenWithAlgNone = withPayloadField(token, 'alg', 'none');

    await expect(
      verifyCapability(SECRET, tokenWithAlgNone, { key: 'a.pdf', method: 'GET' }, { now: 1 }),
    ).resolves.toEqual({
      ok: true,
      claims: { expiry: DEFAULT_CAPABILITY_TTL_MS, key: 'a.pdf', method: 'GET' },
    });
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
      keys: [{ id: 'old', secret: 'old-capability-secret', state: 'active' }],
    });
    const { token: previousToken } = await signCapability(previousSigner, { key: 'a.pdf' }, 0);
    const rotated = createSigningKeyRing({
      keys: [
        { id: 'new', secret: 'new-capability-secret', state: 'active' },
        { id: 'old', secret: 'old-capability-secret', state: 'previous' },
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
      keys: [{ id: 'old', secret: 'old-capability-secret', state: 'active' }],
    });
    const { token } = await signCapability(
      oldSigner,
      { audience: 'storage-download:/files', key: 'a.pdf' },
      0,
    );
    const revoked = createSigningKeyRing({
      keys: [
        { id: 'new', secret: 'new-capability-secret', state: 'active' },
        { id: 'old', secret: 'old-capability-secret', state: 'revoked' },
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
});

function withPayloadField(token: string, key: string, value: unknown): string {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new Error(`malformed test token: ${token}`);
  const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  json[key] = value;
  return `${Buffer.from(JSON.stringify(json), 'utf8').toString('base64url')}.${signature}`;
}

describe('capability-url: one-time tokens via a replay store', () => {
  it('a one-time token verifies once, then is rejected as replayed', async () => {
    const store = createMemoryCapabilityReplayStore();
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
    const store = createMemoryCapabilityReplayStore();
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
});
