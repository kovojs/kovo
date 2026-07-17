import { describe, expect, it } from 'vitest';

// @kovo-security-classifier-corpus mutation-idem

import { registerFrameworkSessionPrincipalSnapshot } from '../auth-principal.js';
import { csrfToken, KOVO_IDEM_FIELD_NAME } from '../csrf.js';
import { mintMutationIdemToken } from '../mutation-idem.js';
import { MutationReplayConflictError } from '../replay.js';
import type {
  MutationEndpointReplayResponse,
  MutationWireRequest,
  NoJsMutationRequest,
} from '../mutation-wire.js';
import {
  enhancedMutationReplayPolicy,
  isEnhancedReplayResponse,
  isNoJsReplayResponse,
  noJsMutationReplayPolicy,
} from './replay-policy.js';

describe('mutation replay response authority', () => {
  it.each(['enhanced', 'no-js'] as const)(
    'rejects a missing %s token when replay storage is configured',
    (mode) => {
      let storeCalls = 0;
      const replayStore = {
        get() {
          storeCalls += 1;
          return undefined;
        },
        reserve() {
          storeCalls += 1;
          return undefined;
        },
        set() {
          storeCalls += 1;
        },
      };
      const policy =
        mode === 'enhanced'
          ? enhancedMutationReplayPolicy({
              csrf: false,
              mutationKey: 'settings/update',
              request: {
                rawInput: {},
                replayStore,
                request: {},
              } as MutationWireRequest<object>,
            })
          : noJsMutationReplayPolicy({
              csrf: false,
              mutationKey: 'settings/update',
              request: {
                rawInput: {},
                redirectTo: '/',
                replayStore,
                request: {},
              } as NoJsMutationRequest<object, unknown>,
            });

      expect(() => policy?.read()).toThrow(MutationReplayConflictError);
      expect(storeCalls).toBe(0);
    },
  );

  it.each([
    ['empty', ''],
    ['oversized', 'a'.repeat(1_025)],
    ['legacy timeless', 'idem_0123456789abcdef0123456789abcdef'],
    ['stale', 'v1_1000000000000_0123456789abcdef0123456789abcdef'],
    ['far-future', 'v1_9999999999999_0123456789abcdef0123456789abcdef'],
  ])('rejects a supplied %s no-JS token before replay-store access', async (_label, idem) => {
    let storeCalls = 0;
    const replayStore = {
      get() {
        storeCalls += 1;
        return undefined;
      },
      reserve() {
        storeCalls += 1;
        return undefined;
      },
      set() {
        storeCalls += 1;
      },
    };
    const request = {
      rawInput: { [KOVO_IDEM_FIELD_NAME]: idem },
      redirectTo: '/',
      replayStore,
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    expect(() => policy?.read()).toThrow(MutationReplayConflictError);
    expect(storeCalls).toBe(0);
  });

  it.each([
    ['non-string', 42],
    ['duplicated', ['first', 'second']],
  ])('rejects a supplied %s no-JS field shape', async (_label, idem) => {
    const request = {
      rawInput: { [KOVO_IDEM_FIELD_NAME]: idem },
      redirectTo: '/',
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    expect(() => policy?.read()).toThrow(MutationReplayConflictError);
  });

  it('rejects an accessor-backed no-JS field without invoking it or trusting a header fallback', () => {
    let reads = 0;
    const rawInput = Object.defineProperty({}, KOVO_IDEM_FIELD_NAME, {
      enumerable: true,
      get() {
        reads += 1;
        return 'attacker-idem';
      },
    });
    const request = {
      idem: mintMutationIdemToken(),
      rawInput,
      redirectTo: '/',
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    expect(() => policy?.read()).toThrow(MutationReplayConflictError);
    expect(reads).toBe(0);
  });

  it('rejects an invalid supplied token even when replay storage is disabled', async () => {
    const request = {
      rawInput: { [KOVO_IDEM_FIELD_NAME]: 'a'.repeat(1_025) },
      redirectTo: '/',
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    expect(() => policy?.read()).toThrow(MutationReplayConflictError);
  });

  it('admits one canonical fresh token to replay storage', async () => {
    let observedIdem: string | undefined;
    const replayStore = {
      get(_scope: string, idem: string) {
        observedIdem = idem;
        return undefined;
      },
      reserve() {
        return undefined;
      },
      set() {},
    };
    const idem = mintMutationIdemToken();
    const request = {
      rawInput: { [KOVO_IDEM_FIELD_NAME]: idem },
      redirectTo: '/',
      replayStore,
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    await expect(policy?.read()).resolves.toBeUndefined();
    expect(observedIdem).toBe(idem);
  });

  it('keeps the maximum framework identity within the no-JS durable scope budget', async () => {
    type PrincipalRequest = {
      session: { id: string; user: { id: string } };
    };
    const mutationKey = 'm'.repeat(1_024);
    const request: PrincipalRequest = {
      session: {
        id: 's'.repeat(1_024),
        user: { id: 'p'.repeat(1_024) },
      },
    };
    registerFrameworkSessionPrincipalSnapshot(request, request.session);
    const csrf = {
      secret: 'nojs-replay-scope-budget-secret-0123456789abcdef',
      sessionId: (candidate: PrincipalRequest) => candidate.session.id,
    };
    const idem = mintMutationIdemToken();
    let observedScope: string | undefined;
    const replayStore = {
      get(scope: string) {
        observedScope = scope;
        return undefined;
      },
      reserve() {
        return undefined;
      },
      set() {},
    };
    const policy = noJsMutationReplayPolicy({
      csrf,
      mutationKey,
      request: {
        rawInput: {
          [KOVO_IDEM_FIELD_NAME]: idem,
          'kovo-csrf': csrfToken(request, csrf, { audience: mutationKey }),
        },
        redirectTo: '/',
        replayStore,
        request,
      } as NoJsMutationRequest<PrincipalRequest, unknown>,
    });

    await expect(policy?.read()).resolves.toBeUndefined();
    expect(observedScope).toHaveLength(3_163);
  });

  it('rejects an oversized mutation identity before no-JS replay-store access', async () => {
    let storeCalls = 0;
    const replayStore = {
      get() {
        storeCalls += 1;
        return undefined;
      },
      reserve() {
        storeCalls += 1;
        return undefined;
      },
      set() {
        storeCalls += 1;
      },
    };
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'm'.repeat(1_025),
      request: {
        rawInput: { [KOVO_IDEM_FIELD_NAME]: mintMutationIdemToken() },
        redirectTo: '/',
        replayStore,
        request: {},
      } as NoJsMutationRequest<object, unknown>,
    });

    await expect(policy?.read()).rejects.toThrow(
      /Mutation replay identity must be a 1\.\.1024-code-unit string/u,
    );
    expect(storeCalls).toBe(0);
  });

  it('classifies only stable own-data response vocabulary under poisoned string intrinsics', () => {
    const originalStartsWith = String.prototype.startsWith;
    let noJs = true;
    let enhanced = true;
    try {
      String.prototype.startsWith = () => true;
      const response = {
        body: '',
        headers: { 'Content-Type': 'application/json' },
        status: 422,
      } as unknown as MutationEndpointReplayResponse;
      noJs = isNoJsReplayResponse(response);
      enhanced = isEnhancedReplayResponse(response);
    } finally {
      String.prototype.startsWith = originalStartsWith;
    }

    expect(noJs).toBe(false);
    expect(enhanced).toBe(false);
  });

  it('does not execute response or header accessors while classifying replay vocabulary', () => {
    let reads = 0;
    const response = Object.defineProperties(
      {},
      {
        body: { enumerable: true, value: '' },
        headers: {
          enumerable: true,
          get() {
            reads += 1;
            return { 'Content-Type': 'text/html; charset=utf-8' };
          },
        },
        status: {
          enumerable: true,
          get() {
            reads += 1;
            return 303;
          },
        },
      },
    ) as MutationEndpointReplayResponse;

    expect(isNoJsReplayResponse(response)).toBe(false);
    expect(isEnhancedReplayResponse(response)).toBe(false);
    expect(reads).toBe(0);
  });

  it('snapshots a custom-store no-JS replay response before vocabulary classification', async () => {
    let reads = 0;
    const response = Object.defineProperties(
      {},
      {
        body: { enumerable: true, value: '' },
        headers: {
          enumerable: true,
          get() {
            reads += 1;
            return { 'Content-Type': 'text/html; charset=utf-8' };
          },
        },
        status: { enumerable: true, value: 422 },
      },
    ) as MutationEndpointReplayResponse;
    const replayStore = {
      get() {
        return response;
      },
      reserve() {
        return undefined;
      },
      set() {},
    };
    const request = {
      idem: mintMutationIdemToken(),
      rawInput: {},
      redirectTo: '/',
      replayStore,
      request: {},
    } as NoJsMutationRequest<object, unknown>;
    const policy = noJsMutationReplayPolicy({
      csrf: false,
      mutationKey: 'settings/update',
      request,
    });

    await expect(policy?.read()).rejects.toThrow(/headers must be an own data property/u);
    expect(reads).toBe(0);
  });
});
