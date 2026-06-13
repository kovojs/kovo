import { describe, expect, it, vi } from 'vitest';

import {
  fetchEnhancedMutation,
  isFailedMutationResponse,
  type EnhancedMutationFetchOptions,
} from './mutation-fetch.js';

class FakeTargetElement {
  readonly id?: string;

  constructor(
    id: string | undefined,
    private readonly attrs: Record<string, string | null>,
  ) {
    if (id !== undefined) {
      this.id = id;
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

class FakeTargetRoot {
  constructor(readonly elements: FakeTargetElement[]) {}

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    return selector === '[fw-deps]' ? this.elements : [];
  }
}

describe('enhanced mutation fetch', () => {
  it('builds the enhanced mutation request from live targets and returns sanitized wire metadata', async () => {
    const formData = new FormData();
    const uploadProgress = vi.fn();
    const root = new FakeTargetRoot([
      new FakeTargetElement('cart-badge', { 'fw-deps': 'cart product:p1' }),
      new FakeTargetElement(undefined, {
        'fw-deps': 'recommendations',
        'fw-fragment-target': 'recommendations:p1',
      }),
      new FakeTargetElement('cart-badge', { 'fw-deps': 'cart product:p1' }),
    ]);
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","keys":["c1"],"input":{"unsafe":true}},{"domain":5}]'
            : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 5, total: 10 });
        return '<fw-query name="cart">{"count":1}</fw-query>';
      },
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'patch' },
      formData,
      idem: 'idem_fetch',
      onUploadProgress: uploadProgress,
      root,
    });

    // SPEC.md §9.1: enhanced mutation requests carry idempotency and live DOM
    // target metadata, while FW-Changes exposes only sanitized domain/keys.
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_fetch',
        'FW-Targets': 'cart-badge=cart product:p1; recommendations:p1=recommendations',
      },
      keepalive: true,
      method: 'PATCH',
      onUploadProgress: expect.any(Function),
    });
    expect(uploadProgress).toHaveBeenCalledWith({ loaded: 5, total: 10 });
    expect(fetched).toEqual({
      body: '<fw-query name="cart">{"count":1}</fw-query>',
      changes: [{ domain: 'cart', keys: ['c1'] }],
      idem: 'idem_fetch',
      response: expect.any(Object),
      targets: ['cart-badge=cart product:p1', 'recommendations:p1=recommendations'],
    });
  });

  it('defaults to POST and omits upload progress when no progress hook is configured', async () => {
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      async text() {
        return '';
      },
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add' },
      formData: 'body',
      idem: 'idem_default',
      root: new FakeTargetRoot([]),
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: 'body',
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_default',
        'FW-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(fetched.changes).toEqual([]);
    expect(fetched.targets).toEqual([]);
  });

  it('reports malformed change headers while still returning the response body', async () => {
    const onError = vi.fn();

    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: {
          get(name: string) {
            return name === 'FW-Changes' ? '[' : null;
          },
        },
        async text() {
          return '<fw-fragment target="cart-form"><form></form></fw-fragment>';
        },
      }),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_malformed_changes',
      onError,
      root: new FakeTargetRoot([]),
    });

    expect(fetched.body).toContain('fw-fragment');
    expect(fetched.changes).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('Malformed JSON in FW-Changes header');
  });

  it('classifies enhanced mutation HTTP failures by ok and status', () => {
    expect(isFailedMutationResponse({ ok: false, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 422, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 500, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ ok: true, status: 204, text: async () => '' })).toBe(false);
    expect(isFailedMutationResponse({ text: async () => '' })).toBe(false);
  });
});
