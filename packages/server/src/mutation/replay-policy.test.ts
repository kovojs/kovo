import { describe, expect, it } from 'vitest';

import type { MutationEndpointReplayResponse, NoJsMutationRequest } from '../mutation-wire.js';
import {
  isEnhancedReplayResponse,
  isNoJsReplayResponse,
  noJsMutationReplayPolicy,
} from './replay-policy.js';

describe('mutation replay response authority', () => {
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
