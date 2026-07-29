// @kovo-security-classifier-corpus mutation-idem

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { kovo } from '@kovojs/drizzle';
import { scopedKeyFactsFor } from '@kovojs/core/internal/storage';
import { pgTable, text } from 'drizzle-orm/pg-core';

import { createApp, createRequestHandler } from './app.js';
import { mintIdemToken } from './csrf.js';
import { guard } from './guards.js';
import { mutation, renderNoJsMutationResponse } from './mutation.js';
import { createPostgresAppRuntimeDb, postgresSchemaModule } from './postgres-runtime.js';
import { createMemoryMutationReplayStore, type MutationReplayStore } from './replay.js';
import { securitySha256Utf16LeHex } from './response-security-intrinsics.js';
import { s } from './schema.js';

type MachineRequest = Request;
type MachineHandler = ((request: Request) => Promise<Response>) & {
  readonly buildToken: string;
};

function countingReplayStore(): {
  calls(): number;
  store: MutationReplayStore;
} {
  const backing = createMemoryMutationReplayStore();
  let calls = 0;
  return {
    calls: () => calls,
    store: {
      get(...args) {
        calls += 1;
        return backing.get(...args);
      },
      reserve(...args) {
        calls += 1;
        return backing.reserve(...args);
      },
      set(...args) {
        calls += 1;
        return backing.set(...args);
      },
    },
  };
}

function machinePrincipal(request: MachineRequest): string {
  const key = request.headers.get('x-machine-api-key');
  if (key === 'tenant-a-secret') return 'tenant-a';
  if (key === 'tenant-b-secret') return 'tenant-b';
  throw new TypeError('guarded machine request did not carry a recognized caller');
}

function machineWrite(handlerCallers: string[]) {
  return mutation('machine/write', {
    csrf: false,
    csrfJustification: 'machine callers authenticate with an X-Machine-API-Key header',
    guard: guard<MachineRequest>('valid-machine-api-key', (request) => {
      const key = request.headers.get('x-machine-api-key');
      return key === 'tenant-a-secret' || key === 'tenant-b-secret';
    }),
    handler(_input, request) {
      const caller = request.headers.get('x-machine-api-key');
      if (caller === null) throw new TypeError('guarded request lost its machine identity');
      handlerCallers.push(caller);
      return caller;
    },
    input: s.object({ value: s.string() }),
    machineReplayPrincipal: machinePrincipal,
    redirectTo(result) {
      return result.value === 'tenant-a-secret' ? '/tenant-a/done' : '/tenant-b/done';
    },
  });
}

function machineHandler(replayStore: MutationReplayStore, handlerCallers: string[]) {
  const app = createApp({
    mutationReplayStore: replayStore,
    mutations: [machineWrite(handlerCallers)],
  });
  const handler = createRequestHandler(app);
  return Object.assign(handler, { buildToken: app.clientModules.buildToken() });
}

function submitMachine(
  handler: MachineHandler,
  options: {
    apiKey: string;
    enhanced?: boolean;
    idem: string;
    mutationKey?: string;
    value?: string;
  },
): Promise<Response> {
  const body = new FormData();
  body.set('value', options.value ?? 'same-body');
  body.set('Kovo-Idem', options.idem);
  return handler(
    new Request(`https://api.example.test/_m/${options.mutationKey ?? 'machine/write'}`, {
      body,
      headers: {
        ...(options.enhanced
          ? {
              'Kovo-Current-Url': 'https://api.example.test/',
              'Kovo-Build': handler.buildToken,
              'Kovo-Fragment': 'true',
              'Kovo-Idem': options.idem,
            }
          : {}),
        'X-Machine-API-Key': options.apiKey,
      },
      method: 'POST',
    }),
  );
}

describe('csrf:false machine replay isolation (SPEC §6.6/§9.1/§10.3)', () => {
  it('hashes the exact UTF-16 code-unit sequence without lone-surrogate aliases', () => {
    expect(securitySha256Utf16LeHex('\uD800')).toBe(
      '205022e3428b7c8276cf247b36e4e512db5651e5cb3472c253d9ee893a8ac750',
    );
    expect(securitySha256Utf16LeHex('\uD801')).toBe(
      '4a9868967003d43ddf0f042f7746934a6e27d3464b9b32ac9d93bab42b295696',
    );
    expect(securitySha256Utf16LeHex('\uD800')).not.toBe(securitySha256Utf16LeHex('\uD801'));
  });

  it('isolates independent callers and replays only to the same caller in memory', async () => {
    const handlerCallers: string[] = [];
    const handler = machineHandler(createMemoryMutationReplayStore(), handlerCallers);
    const idem = mintIdemToken();

    const tenantA = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });
    const tenantAReplay = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });
    const tenantB = await submitMachine(handler, { apiKey: 'tenant-b-secret', idem });
    const tenantBReplay = await submitMachine(handler, { apiKey: 'tenant-b-secret', idem });

    expect(tenantA.headers.get('location')).toBe('/tenant-a/done');
    expect(tenantAReplay.headers.get('location')).toBe('/tenant-a/done');
    expect(tenantB.headers.get('location')).toBe('/tenant-b/done');
    expect(tenantBReplay.headers.get('location')).toBe('/tenant-b/done');
    expect(handlerCallers).toEqual(['tenant-a-secret', 'tenant-b-secret']);
  });

  it('keeps distinct lone-surrogate caller identities in separate replay scopes', async () => {
    const handlerCallers: string[] = [];
    const write = mutation('machine/code-unit-identity', {
      csrf: false,
      csrfJustification: 'machine caller fixture proves exact JavaScript identity hashing',
      guard: guard<Request>('valid-machine-api-key', (request) => {
        const key = request.headers.get('x-machine-api-key');
        return key === 'tenant-a-secret' || key === 'tenant-b-secret';
      }),
      handler(_input, request) {
        const caller = request.headers.get('x-machine-api-key');
        if (caller === null) throw new TypeError('guarded request lost its machine identity');
        handlerCallers.push(caller);
        return { accepted: true };
      },
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: (request) =>
        request.headers.get('x-machine-api-key') === 'tenant-a-secret' ? '\uD800' : '\uD801',
      redirectTo: '/done',
    });
    const handler = createRequestHandler(
      createApp({
        mutationReplayStore: createMemoryMutationReplayStore(),
        mutations: [write],
      }),
    );
    const idem = mintIdemToken();

    const tenantA = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem,
      mutationKey: 'machine/code-unit-identity',
    });
    const tenantB = await submitMachine(handler, {
      apiKey: 'tenant-b-secret',
      idem,
      mutationKey: 'machine/code-unit-identity',
    });
    await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem,
      mutationKey: 'machine/code-unit-identity',
    });
    await submitMachine(handler, {
      apiKey: 'tenant-b-secret',
      idem,
      mutationKey: 'machine/code-unit-identity',
    });

    expect(tenantA.status).toBe(303);
    expect(tenantB.status).toBe(303);
    expect(handlerCallers).toEqual(['tenant-a-secret', 'tenant-b-secret']);
  });

  it('blocks enhanced/no-JS cross-vocabulary retries without executing twice in either direction', async () => {
    const handlerCallers: string[] = [];
    const handler = machineHandler(createMemoryMutationReplayStore(), handlerCallers);
    const idem = mintIdemToken();

    const enhanced = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      enhanced: true,
      idem,
    });
    const noJs = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });
    const enhancedReplay = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      enhanced: true,
      idem,
    });
    const noJsReplay = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });

    expect(enhanced.status).toBe(200);
    expect(enhancedReplay.status).toBe(200);
    expect(noJs.status).toBe(422);
    expect(noJsReplay.status).toBe(422);
    expect(handlerCallers).toEqual(['tenant-a-secret']);

    const reverseIdem = mintIdemToken();
    const noJsFirst = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem: reverseIdem,
    });
    const enhancedFallback = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      enhanced: true,
      idem: reverseIdem,
    });

    expect(noJsFirst.status).toBe(303);
    expect(enhancedFallback.status).toBe(422);
    expect(handlerCallers).toEqual(['tenant-a-secret', 'tenant-a-secret']);
  });

  it('fails closed before the handler when replay has no machine principal declaration', async () => {
    const handlerCallers: string[] = [];
    let guardCalls = 0;
    const replay = countingReplayStore();
    const write = mutation('machine/unbound', {
      csrf: false,
      csrfJustification: 'machine caller fixture intentionally omits replay identity',
      guard: guard<Request>('valid-machine-api-key', () => {
        guardCalls += 1;
        return true;
      }),
      handler() {
        handlerCallers.push('ran');
        return { accepted: true };
      },
      input: s.object({ value: s.string() }),
    });
    const handler = createRequestHandler(
      createApp({
        mutationReplayStore: replay.store,
        mutations: [write],
      }),
    );

    const response = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem: mintIdemToken(),
      mutationKey: 'machine/unbound',
    });

    expect(response.status).toBe(422);
    expect(guardCalls).toBe(1);
    expect(handlerCallers).toEqual([]);
    expect(replay.calls()).toBe(0);
  });

  it('does not evaluate the machine principal selector until its guard succeeds', async () => {
    const selector = vi.fn(() => 'tenant-a');
    const handlerBody = vi.fn(() => ({ accepted: true }));
    const write = mutation('machine/guard-order', {
      csrf: false,
      csrfJustification: 'machine caller fixture proves guard ordering',
      guard: guard<Request>('valid-machine-api-key', () => false),
      handler: handlerBody,
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: selector,
    });
    const handler = createRequestHandler(
      createApp({
        mutationReplayStore: createMemoryMutationReplayStore(),
        mutations: [write],
      }),
    );

    const response = await submitMachine(handler, {
      apiKey: 'invalid',
      idem: mintIdemToken(),
      mutationKey: 'machine/guard-order',
    });

    expect(response.status).toBe(303);
    expect(selector).not.toHaveBeenCalled();
    expect(handlerBody).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['non-string', 42],
    ['empty', ''],
    ['oversized', 'x'.repeat(1_025)],
    ['object wrapper', Object.defineProperty({}, 'toString', { get: () => () => 'tenant-a' })],
  ])('rejects a %s machine principal output without handler work', async (_label, selected) => {
    const handlerBody = vi.fn(() => ({ accepted: true }));
    const replay = countingReplayStore();
    const write = mutation('machine/malformed-principal', {
      csrf: false,
      csrfJustification: 'machine caller fixture exercises replay-principal validation',
      guard: guard<Request>('valid-machine-api-key', () => true),
      handler: handlerBody,
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: (() => selected) as never,
    });
    const handler = createRequestHandler(
      createApp({
        mutationReplayStore: replay.store,
        mutations: [write],
      }),
    );

    const response = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem: mintIdemToken(),
      mutationKey: 'machine/malformed-principal',
    });

    expect(response.status).toBe(422);
    expect(handlerBody).not.toHaveBeenCalled();
    expect(replay.calls()).toBe(0);
  });

  it('collapses selector exceptions to a closed conflict without leaking or using store authority', async () => {
    const rawSecret = 'tenant-a-secret-selector-message';
    const handlerBody = vi.fn(() => ({ accepted: true }));
    const onError = vi.fn();
    const replay = countingReplayStore();
    const write = mutation('machine/rejected-principal', {
      csrf: false,
      csrfJustification: 'machine caller fixture exercises rejected selector handling',
      guard: guard<Request>('valid-machine-api-key', () => true),
      handler: handlerBody,
      input: s.object({ value: s.string() }),
      machineReplayPrincipal() {
        throw new Error(rawSecret);
      },
    });
    const handler = createRequestHandler(
      createApp({ mutationReplayStore: replay.store, mutations: [write], onError }),
    );

    const response = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem: mintIdemToken(),
      mutationKey: 'machine/rejected-principal',
    });
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(body).toContain('IDEMPOTENCY_CONFLICT');
    expect(body).not.toContain(rawSecret);
    expect(onError).not.toHaveBeenCalled();
    expect(handlerBody).not.toHaveBeenCalled();
    expect(replay.calls()).toBe(0);
  });

  it('drains a rejected native promise returned through a cast before the closed conflict', async () => {
    const rawSecret = 'tenant-a-secret-async-selector-message';
    const handlerBody = vi.fn(() => ({ accepted: true }));
    const onError = vi.fn();
    const replay = countingReplayStore();
    const unhandled: unknown[] = [];
    const observeUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', observeUnhandled);
    try {
      const selector = vi.fn(() => Promise.reject(new Error(rawSecret)));
      const write = mutation('machine/async-rejected-principal', {
        csrf: false,
        csrfJustification: 'machine caller fixture exercises async selector rejection handling',
        guard: guard<Request>('valid-machine-api-key', () => true),
        handler: handlerBody,
        input: s.object({ value: s.string() }),
        machineReplayPrincipal: selector as never,
      });
      const handler = createRequestHandler(
        createApp({ mutationReplayStore: replay.store, mutations: [write], onError }),
      );

      const response = await submitMachine(handler, {
        apiKey: 'tenant-a-secret',
        idem: mintIdemToken(),
        mutationKey: 'machine/async-rejected-principal',
      });
      const body = await response.text();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(response.status).toBe(422);
      expect(body).toContain('IDEMPOTENCY_CONFLICT');
      expect(body).not.toContain(rawSecret);
      expect(selector).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
      expect(handlerBody).not.toHaveBeenCalled();
      expect(replay.calls()).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', observeUnhandled);
    }
  });

  it('keeps the raw machine principal out of replay store keys and scope metadata', async () => {
    const rawPrincipal = 'public-tenant-identifier-that-must-not-enter-the-store-key';
    const backing = createMemoryMutationReplayStore();
    const observed: string[] = [];
    const replayStore: MutationReplayStore = {
      get(key, scope, ...rest) {
        observed.push(scopedKeyFactsFor(key).frame, scope);
        return backing.get(key, scope, ...rest);
      },
      reserve(key, scope, ...rest) {
        observed.push(scopedKeyFactsFor(key).frame, scope);
        return backing.reserve(key, scope, ...rest);
      },
      set(key, scope, ...rest) {
        observed.push(scopedKeyFactsFor(key).frame, scope);
        return backing.set(key, scope, ...rest);
      },
    };
    const write = mutation('machine/opaque-principal', {
      csrf: false,
      csrfJustification: 'machine caller fixture exercises opaque replay scope derivation',
      guard: guard<Request>('valid-machine-api-key', () => true),
      handler: () => ({ accepted: true }),
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: () => rawPrincipal,
      redirectTo: '/done',
    });
    const handler = createRequestHandler(
      createApp({ mutationReplayStore: replayStore, mutations: [write] }),
    );

    const response = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem: mintIdemToken(),
      mutationKey: 'machine/opaque-principal',
    });

    expect(response.status).toBe(303);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.join('\n')).not.toContain(rawPrincipal);
    expect(observed.join('\n')).toMatch(/machine:v1:sha256:[0-9a-f]{64}/u);
  });

  it('snapshots one selector result per request and replays a deterministic no-JS failure', async () => {
    const events: string[] = [];
    const selector = vi.fn(() => {
      events.push('selector');
      return 'tenant-a';
    });
    let handlerCalls = 0;
    const rejectWrite = mutation('machine/reject', {
      csrf: false,
      csrfJustification: 'machine callers authenticate with an X-Machine-API-Key header',
      errors: { DENIED: s.object({}) },
      guard: guard<Request>('valid-machine-api-key', (request) => {
        events.push('guard');
        return request.headers.get('x-machine-api-key') === 'tenant-a-secret';
      }),
      handler(_input, _request, context) {
        events.push('handler');
        handlerCalls += 1;
        return context.fail('DENIED', {});
      },
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: selector,
      redirectTo: '/done',
    });
    const handler = createRequestHandler(
      createApp({
        mutationReplayStore: createMemoryMutationReplayStore(),
        mutations: [rejectWrite],
      }),
    );
    const idem = mintIdemToken();

    const first = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem,
      mutationKey: 'machine/reject',
    });
    const replay = await submitMachine(handler, {
      apiKey: 'tenant-a-secret',
      idem,
      mutationKey: 'machine/reject',
    });

    expect(first.status).toBe(422);
    expect(replay.status).toBe(422);
    expect(handlerCalls).toBe(1);
    expect(selector).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['guard', 'selector', 'handler', 'guard', 'selector']);
  });

  it('aborts deterministic failure claims when response rendering or policy resolution throws', async () => {
    for (const failureMode of ['render', 'policy'] as const) {
      let handlerCalls = 0;
      const replayStore = createMemoryMutationReplayStore();
      const rejectWrite = mutation(`machine/${failureMode}-failure`, {
        csrf: false,
        csrfJustification: 'machine caller fixture exercises post-handler replay aborts',
        errors: { DENIED: s.object({}) },
        handler(_input, _request, context) {
          handlerCalls += 1;
          return context.fail('DENIED', {});
        },
        input: s.object({ value: s.string() }),
        machineReplayPrincipal: () => 'tenant-a',
        redirectTo: '/done',
      });
      const idem = mintIdemToken();
      const failed = await renderNoJsMutationResponse(rejectWrite, {
        idem,
        onError() {},
        rawInput: { value: 'same-body' },
        redirectTo: '/done',
        replayStore,
        request: {},
        ...(failureMode === 'render'
          ? {
              renderFailurePage() {
                throw new Error('render failed');
              },
            }
          : {
              resolvePostLifecycleResponse() {
                throw new Error('policy failed');
              },
            }),
      });
      const retry = await renderNoJsMutationResponse(rejectWrite, {
        idem,
        rawInput: { value: 'same-body' },
        redirectTo: '/done',
        replayStore,
        request: {},
      });

      expect(failed.status).toBe(500);
      expect(retry.status).toBe(422);
      expect(handlerCalls).toBe(2);
    }
  });

  it('aborts retryable no-JS failures so a same-token retry may execute again', async () => {
    let handlerCalls = 0;
    let rateLimited = true;
    const retryableWrite = mutation('machine/retryable', {
      csrf: false,
      csrfJustification: 'machine caller fixture exercises retryable failure replay release',
      errors: { RATE_LIMITED: s.object({}) },
      handler(input) {
        handlerCalls += 1;
        if (rateLimited) {
          return {
            error: { code: 'RATE_LIMITED', payload: {} },
            ok: false as const,
            status: 429 as const,
          };
        }
        return input;
      },
      input: s.object({ value: s.string() }),
      machineReplayPrincipal: () => 'tenant-a',
      redirectTo: '/done',
    });
    const replayStore = createMemoryMutationReplayStore();
    const idem = mintIdemToken();
    const request = {
      idem,
      rawInput: { value: 'same-body' },
      redirectTo: '/done',
      replayStore,
      request: {},
    };

    const first = await renderNoJsMutationResponse(retryableWrite, request);
    rateLimited = false;
    const retry = await renderNoJsMutationResponse(retryableWrite, request);

    expect(first.status).toBe(429);
    expect(retry.status).toBe(303);
    expect(handlerCalls).toBe(2);
  });

  it('isolates callers and replays same-caller responses in real PGlite', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-machine-replay-'));
    const replayOwners = pgTable(
      'machine_replay_isolation_test_owners',
      {
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
      },
      kovo((columns) => ({
        domain: 'machine-replay-isolation-tests',
        key: columns.id,
        owner: columns.ownerId,
      })),
    );
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: postgresSchemaModule({ replayOwners }),
    });
    try {
      await runtime.ready;
      const handlerCallers: string[] = [];
      const handler = machineHandler(runtime.mutationReplayStore, handlerCallers);
      const idem = mintIdemToken();

      const tenantA = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });
      const tenantAReplay = await submitMachine(handler, { apiKey: 'tenant-a-secret', idem });
      const tenantB = await submitMachine(handler, { apiKey: 'tenant-b-secret', idem });
      const tenantBReplay = await submitMachine(handler, { apiKey: 'tenant-b-secret', idem });

      expect(tenantA.headers.get('location')).toBe('/tenant-a/done');
      expect(tenantAReplay.status).toBe(303);
      expect(tenantB.headers.get('location')).toBe('/tenant-b/done');
      expect(tenantBReplay.status).toBe(303);
      expect(handlerCallers).toEqual(['tenant-a-secret', 'tenant-b-secret']);
    } finally {
      await runtime.close();
      rmSync(dataDir, { force: true, recursive: true });
    }
  });
});
