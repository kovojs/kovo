import { describe, expect, it } from 'vitest';

// @kovo-security-classifier-corpus mutation-idem

import { KOVO_IDEM_FIELD_NAME } from '../csrf.js';
import { MutationReplayConflictError } from '../replay.js';
import type { MutationEndpointReplayResponse, NoJsMutationRequest } from '../mutation-wire.js';
import {
  isEnhancedReplayResponse,
  isNoJsReplayResponse,
  noJsMutationReplayPolicy,
} from './replay-policy.js';

describe('mutation replay response authority', () => {
  it.each([
    ['empty', ''],
    ['oversized', 'a'.repeat(1_025)],
    ['non-base64url', 'idem with spaces'],
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
      idem: 'valid_header_fallback',
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

  it('admits the 1,024-character base64url boundary to replay storage', async () => {
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
    const idem = 'a'.repeat(1_024);
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
      idem: 'idem-1',
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
