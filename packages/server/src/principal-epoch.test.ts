import { describe, expect, it, vi } from 'vitest';

import { signCapability, verifyCapability } from './capability-url.js';
import { csrfToken } from './csrf.js';
import { createFrameworkManagedDbProvider } from './guards.js';
import { mutation, renderMutationEndpointResponse, runMutation } from './mutation.js';
import { mintMutationIdemToken } from './mutation-idem.js';
import { createPostgresPrincipalEpochStoreFromExecutor } from './postgres-principal-epoch.js';
import {
  advancePrincipalEpoch,
  currentPrincipalEpoch,
  createMemoryPrincipalEpochStore,
  initializePrincipalEpoch,
  PrincipalEpochStaleError,
  PrincipalEpochUnavailableError,
  tombstonePrincipalEpoch,
  type PrincipalEpochAdvanceReason,
} from './principal-epoch.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { resolveKovoLifecycleRequest } from './response-posture.js';
import { s } from './schema.js';

const SECRET = 'principal-epoch-capability-secret-at-least-32-bytes';

describe('persistent principal epoch authority', () => {
  it('advances strictly monotonically and keeps tombstones permanent', async () => {
    let now = 100;
    const store = createMemoryPrincipalEpochStore({ now: () => now });
    const created = await initializePrincipalEpoch(store, 'u1');
    await expect(initializePrincipalEpoch(store, 'u1')).resolves.toEqual(created);
    now = 100;
    const changed = await advancePrincipalEpoch(store, 'u1', 'role-change');
    const deleted = await tombstonePrincipalEpoch(store, 'u1', 'principal-deletion');
    const afterDelete = await advancePrincipalEpoch(store, 'u1', 'admin-change');

    expect(created).toEqual({ changedAtMs: 100, epoch: 1, status: 'active' });
    expect(changed).toEqual({ changedAtMs: 101, epoch: 2, status: 'active' });
    expect(deleted).toEqual({ changedAtMs: 102, epoch: 3, status: 'tombstoned' });
    expect(afterDelete).toEqual({ changedAtMs: 103, epoch: 4, status: 'tombstoned' });
    await expect(initializePrincipalEpoch(store, 'u1')).rejects.toBeInstanceOf(
      PrincipalEpochStaleError,
    );
  });

  it('initializes an existing Postgres principal with one indexed read and no write', async () => {
    const execute = vi.fn(async () => ({
      rows: [{ changed_at_ms: '100', epoch: '7', status: 'active' }],
    }));
    const store = createPostgresPrincipalEpochStoreFromExecutor({ execute });

    await expect(initializePrincipalEpoch(store, 'u1')).resolves.toEqual({
      changedAtMs: 100,
      epoch: 7,
      status: 'active',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].text).toMatch(/^SELECT epoch/u);
  });

  it('fails closed on missing, malformed, rejected, and over-budget authoritative lookup', async () => {
    const base = {
      advance: () => ({ changedAtMs: 1, epoch: 1, status: 'active' as const }),
      initialize: () => ({ changedAtMs: 1, epoch: 1, status: 'active' as const }),
      tombstone: () => ({ changedAtMs: 2, epoch: 2, status: 'tombstoned' as const }),
    };
    await expect(
      currentPrincipalEpoch({ ...base, current: () => undefined }, 'u1'),
    ).rejects.toBeInstanceOf(PrincipalEpochUnavailableError);
    await expect(
      currentPrincipalEpoch(
        { ...base, current: () => ({ changedAtMs: -1, epoch: 0, status: 'active' as const }) },
        'u1',
      ),
    ).rejects.toBeInstanceOf(PrincipalEpochUnavailableError);
    await expect(
      currentPrincipalEpoch(
        {
          ...base,
          current: () => {
            throw new Error('provider outage');
          },
        },
        'u1',
      ),
    ).rejects.toBeInstanceOf(PrincipalEpochUnavailableError);
    await expect(
      currentPrincipalEpoch({ ...base, current: () => new Promise(() => undefined) }, 'u1'),
    ).rejects.toThrow(/exceeded 1000ms/u);
  });

  it('embeds and rechecks capability epochs without a positive cache or replay-store burn', async () => {
    let now = 1_700_000_000_000;
    let lookups = 0;
    let outage = false;
    const memory = createMemoryPrincipalEpochStore({ now: () => now });
    await advancePrincipalEpoch(memory, 'tenant-1', 'principal-created');
    const store = Object.freeze({
      advance: memory.advance,
      current(principal: string, options: { signal: AbortSignal }) {
        lookups += 1;
        if (outage) throw new Error('identity provider unavailable');
        return memory.current(principal, options);
      },
      initialize: memory.initialize,
      tombstone: memory.tombstone,
    });
    now += 10;
    const signed = await signCapability(
      SECRET,
      { key: 'private.pdf', principalEpochStore: store, scope: 'tenant-1' },
      now,
    );
    expect(signed.claims.principalEpoch).toBe(1);

    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: 'private.pdf', method: 'GET', scope: 'tenant-1' },
        { now: now + 1, principalEpochStore: store },
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: 'private.pdf', method: 'GET', scope: 'tenant-1' },
        { now: now + 2, principalEpochStore: store },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(lookups).toBe(3);

    outage = true;
    const consume = vi.fn(() => true);
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: 'private.pdf', method: 'GET', scope: 'tenant-1' },
        { now: now + 3, principalEpochStore: store, replayStore: { consume } },
      ),
    ).resolves.toEqual({ ok: false, reason: 'principal-stale' });
    expect(consume).not.toHaveBeenCalled();

    outage = false;
    now += 100;
    await advancePrincipalEpoch(store, 'tenant-1', 'provider-revocation');
    await expect(
      verifyCapability(
        SECRET,
        signed.token,
        { key: 'private.pdf', method: 'GET', scope: 'tenant-1' },
        { now: now + 1, principalEpochStore: store },
      ),
    ).resolves.toEqual({ ok: false, reason: 'principal-stale' });
  });

  it('routes explicit privilege-changing mutation declarations through the epoch door', async () => {
    let now = 10;
    const store = createMemoryPrincipalEpochStore({ now: () => now });
    await advancePrincipalEpoch(store, 'u1', 'principal-created');
    const changeRole = mutation('account/change-role', {
      csrf: false,
      csrfJustification: 'test invokes the non-browser mutation API directly',
      handler: () => ({ changed: true }),
      input: s.object({ principal: s.string() }),
      principalEpoch: {
        action: 'advance',
        principal: (input) => input.principal,
        reason: 'role-change',
      },
    });
    now = 20;
    await expect(
      runMutation(changeRole, { principal: 'u1' }, {}, { csrf: false, principalEpochStore: store }),
    ).resolves.toMatchObject({ ok: true });
    await expect(currentPrincipalEpoch(store, 'u1')).resolves.toEqual({
      changedAtMs: 20,
      epoch: 2,
      status: 'active',
    });
  });

  it('rolls back when a provider revocation races an explicit Kovo epoch transition', async () => {
    let now = 10;
    const memory = createMemoryPrincipalEpochStore({ now: () => now });
    await initializePrincipalEpoch(memory, 'u1');
    let injectProviderRevocation = true;
    const store = Object.freeze({
      async advance(principal: string, reason: PrincipalEpochAdvanceReason) {
        if (injectProviderRevocation) {
          injectProviderRevocation = false;
          now = 20;
          await advancePrincipalEpoch(memory, principal, 'provider-revocation');
        }
        now = 30;
        return memory.advance(principal, reason);
      },
      current: memory.current,
      initialize: memory.initialize,
      tombstone: memory.tombstone,
    });
    let transactionCommitted = false;
    const request = {
      db: {
        async transaction<Value>(run: (transactionDb: object) => Promise<Value>): Promise<Value> {
          const value = await run({});
          transactionCommitted = true;
          return value;
        },
      },
    };
    const changeRole = mutation('account/change-role-provider-race', {
      csrf: false,
      csrfJustification: 'test invokes the non-browser mutation API directly',
      handler: () => ({ changed: true }),
      input: s.object({ principal: s.string() }),
      principalEpoch: {
        action: 'advance',
        principal: (input) => input.principal,
        reason: 'role-change',
      },
    });

    await expect(
      runMutation(changeRole, { principal: 'u1' }, request, {
        csrf: false,
        principalEpochStore: store,
      }),
    ).rejects.toThrow(/exactly one monotone step/u);
    expect(transactionCommitted).toBe(false);
  });

  it('runs the epoch transition before the default mutation transaction can commit', async () => {
    let transactionCommitted = false;
    const request = {
      db: {
        async transaction<Value>(run: (transactionDb: object) => Promise<Value>): Promise<Value> {
          const value = await run({});
          transactionCommitted = true;
          return value;
        },
      },
    };
    const unavailableStore = {
      advance: () => ({ changedAtMs: 2, epoch: 2, status: 'active' as const }),
      current: () => {
        throw new Error('identity store outage');
      },
      initialize: () => ({ changedAtMs: 1, epoch: 1, status: 'active' as const }),
      tombstone: () => ({ changedAtMs: 2, epoch: 2, status: 'tombstoned' as const }),
    };
    const changeRole = mutation('account/change-role-rollback', {
      csrf: false,
      csrfJustification: 'test invokes the non-browser mutation API directly',
      handler: () => ({ changed: true }),
      input: s.object({ principal: s.string() }),
      principalEpoch: {
        action: 'advance',
        principal: (input) => input.principal,
        reason: 'role-change',
      },
    });

    await expect(
      runMutation(changeRole, { principal: 'u1' }, request, {
        csrf: false,
        principalEpochStore: unavailableStore,
      }),
    ).rejects.toBeInstanceOf(PrincipalEpochUnavailableError);
    expect(transactionCommitted).toBe(false);
  });

  it('rolls back an authenticated mutation when an out-of-band revocation wins before commit', async () => {
    let now = 100;
    const store = createMemoryPrincipalEpochStore({ now: () => now });
    await initializePrincipalEpoch(store, 'u1');
    let transactionCommitted = false;
    const db = {
      async transaction<Value>(run: (transactionDb: object) => Promise<Value>): Promise<Value> {
        const value = await run({});
        transactionCommitted = true;
        return value;
      },
    };
    const request = await resolveKovoLifecycleRequest(
      new Request('https://example.test/_m/account/save', { method: 'POST' }),
      {
        csrf: { mode: 'protected' },
        db: createFrameworkManagedDbProvider(() => db),
        sessionProvider: () => ({ id: 'rotation-1', user: { id: 'u1' } }),
        surface: 'mutation',
      },
    );
    const save = mutation('account/save-after-revocation', {
      csrf: false,
      csrfJustification: 'test supplies an already resolved framework lifecycle request',
      async handler() {
        now = 200;
        await advancePrincipalEpoch(store, 'u1', 'provider-revocation');
        return { saved: true };
      },
      input: s.object({}),
    });

    await expect(
      runMutation(save, {}, request, { csrf: false, principalEpochStore: store }),
    ).rejects.toBeInstanceOf(PrincipalEpochStaleError);
    expect(transactionCommitted).toBe(false);
  });

  it('binds handler admission to the epoch that won the replay reservation', async () => {
    let now = Date.now() - 1_000;
    const principalEpochStore = createMemoryPrincipalEpochStore({ now: () => now });
    await initializePrincipalEpoch(principalEpochStore, 'u1');
    const request = await resolveKovoLifecycleRequest(
      new Request('https://example.test/_m/account/save', {
        headers: { Origin: 'https://example.test' },
        method: 'POST',
      }),
      {
        csrf: { mode: 'protected' },
        idempotency: { mode: 'replay-store' },
        sessionProvider: () => ({ id: 'rotation-1', user: { id: 'u1' } }),
        surface: 'mutation',
      },
    );
    const abort = vi.fn();
    const issuedAt = Date.now();
    const replayStore = {
      get() {
        return undefined;
      },
      async reserve() {
        now = issuedAt + 1;
        await advancePrincipalEpoch(principalEpochStore, 'u1', 'provider-revocation');
        return { abort, commit() {} };
      },
      set() {},
    };
    const handler = vi.fn(() => ({ saved: true }));
    const csrf = { secret: SECRET, sessionId: () => 'rotation-1' };
    const save = mutation('account/save-reservation-race', {
      csrf,
      handler,
      input: s.object({}),
    });
    const rawInput = new FormData();
    rawInput.set('Kovo-Idem', mintMutationIdemToken(issuedAt));
    rawInput.set('kovo-csrf', csrfToken(request, csrf, { mutation: save }));

    const response = await renderMutationEndpointResponse(save, {
      headers: {},
      principalEpochStore,
      rawInput,
      redirectTo: '/done',
      replayStore,
      request,
    });

    expect(response.status).toBe(422);
    expect(response.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(handler).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });

  it('releases a reserved replay key when an epoch outage rolls back the mutation', async () => {
    const memory = createMemoryPrincipalEpochStore();
    await initializePrincipalEpoch(memory, 'u1');
    let outage = false;
    const principalEpochStore = Object.freeze({
      advance: memory.advance,
      current(principal: string, options: { signal: AbortSignal }) {
        if (outage) throw new Error('identity provider unavailable');
        return memory.current(principal, options);
      },
      initialize: memory.initialize,
      tombstone: memory.tombstone,
    });
    const request = await resolveKovoLifecycleRequest(
      new Request('https://example.test/_m/account/save', {
        headers: { Origin: 'https://example.test' },
        method: 'POST',
      }),
      {
        csrf: { mode: 'protected' },
        idempotency: { mode: 'replay-store' },
        sessionProvider: () => ({ id: 'rotation-1', user: { id: 'u1' } }),
        surface: 'mutation',
      },
    );
    const abort = vi.fn();
    const replayStore = {
      get() {
        return undefined;
      },
      reserve() {
        return { abort, commit() {} };
      },
      set() {},
    };
    const csrf = { secret: SECRET, sessionId: () => 'rotation-1' };
    const save = mutation('account/save-outage', {
      csrf,
      handler() {
        outage = true;
        return { saved: true };
      },
      input: s.object({}),
    });
    const rawInput = new FormData();
    rawInput.set('Kovo-Idem', mintMutationIdemToken());
    rawInput.set('kovo-csrf', csrfToken(request, csrf, { mutation: save }));

    const response = await renderMutationEndpointResponse(save, {
      headers: {},
      principalEpochStore,
      rawInput,
      redirectTo: '/done',
      replayStore,
      request,
    });

    expect(response.status).toBe(429);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('makes an old durable replay receipt unreachable after an out-of-band epoch change', async () => {
    let now = Date.now() - 1_000;
    const principalEpochStore = createMemoryPrincipalEpochStore({ now: () => now });
    await advancePrincipalEpoch(principalEpochStore, 'u1', 'principal-created');
    const request = await resolveKovoLifecycleRequest(
      new Request('https://example.test/_m/account/save', {
        headers: { Origin: 'https://example.test' },
        method: 'POST',
      }),
      {
        csrf: { mode: 'protected' },
        idempotency: { mode: 'replay-store' },
        sessionProvider: () => ({ id: 'rotation-1', user: { id: 'u1' } }),
        surface: 'mutation',
      },
    );
    let runs = 0;
    const csrf = { secret: SECRET, sessionId: () => 'rotation-1' };
    const save = mutation('account/save', {
      csrf,
      handler: () => ({ runs: ++runs }),
      input: s.object({}),
    });
    const replayStore = createMemoryMutationReplayStore();
    const issuedAt = Date.now();
    const idem = mintMutationIdemToken(issuedAt);
    const submit = () => {
      const rawInput = new FormData();
      rawInput.set('Kovo-Idem', idem);
      rawInput.set('kovo-csrf', csrfToken(request, csrf, { mutation: save }));
      return renderMutationEndpointResponse(save, {
        headers: {},
        principalEpochStore,
        rawInput,
        redirectTo: '/done',
        replayStore,
        request,
      });
    };

    const first = await submit();
    expect(first).toMatchObject({ status: 303 });
    now = issuedAt + 1;
    await advancePrincipalEpoch(principalEpochStore, 'u1', 'provider-revocation');
    const stale = await submit();
    expect(stale).toMatchObject({ status: 422 });
    expect(stale.body).toContain('IDEMPOTENCY_CONFLICT');
    expect(runs).toBe(1);
  });
});
