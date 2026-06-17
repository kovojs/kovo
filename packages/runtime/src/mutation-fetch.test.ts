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

class FakeFormElement extends FakeTargetElement {
  constructor(
    id: string | undefined,
    attrs: Record<string, string | null>,
    readonly action: string,
    readonly method?: string,
  ) {
    super(id, attrs);
  }
}

class FakeTargetRoot {
  queries = 0;

  constructor(readonly elements: FakeTargetElement[]) {}

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    this.queries += 1;
    return selector === '[kovo-deps]' ? this.elements : [];
  }
}

describe('enhanced mutation fetch', () => {
  it('builds the enhanced mutation request from live targets and returns sanitized wire metadata', async () => {
    const formData = new FormData();
    const uploadProgress = vi.fn();
    const root = new FakeTargetRoot([
      new FakeTargetElement('cart-badge', { 'kovo-deps': 'cart product:p1' }),
      new FakeTargetElement(undefined, {
        'kovo-deps': 'recommendations',
        'kovo-fragment-target': 'recommendations:p1',
      }),
      new FakeTargetElement('cart-badge', { 'kovo-deps': 'cart product:p1' }),
    ]);
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name === 'Kovo-Changes'
            ? '[{"domain":"cart","keys":["c1"],"input":{"unsafe":true}},{"domain":5}]'
            : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 5, total: 10 });
        return '<kovo-query name="cart">{"count":1}</kovo-query>';
      },
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', getAttribute: () => null, method: 'patch' },
      formData,
      idem: 'idem_fetch',
      onUploadProgress: uploadProgress,
      root,
    });

    // SPEC.md §9.1: enhanced mutation requests carry idempotency and live DOM
    // target metadata, while Kovo-Changes exposes only sanitized domain/keys.
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_fetch',
        'Kovo-Targets': 'cart-badge=cart product:p1; recommendations:p1=recommendations',
      },
      keepalive: true,
      method: 'PATCH',
      onUploadProgress: expect.any(Function),
    });
    expect(uploadProgress).toHaveBeenCalledWith({ loaded: 5, total: 10 });
    expect(fetched).toEqual({
      body: '<kovo-query name="cart">{"count":1}</kovo-query>',
      changes: [{ domain: 'cart', keys: ['c1'] }],
      idem: 'idem_fetch',
      response: expect.any(Object),
      targets: ['cart-badge=cart product:p1', 'recommendations:p1=recommendations'],
    });
    expect(root.queries).toBe(1);
  });

  it('sends the submitted enhanced form target when the form carries runtime identity', async () => {
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      async text() {
        return '<kovo-fragment target="product-form:p1"><form></form></kovo-fragment>';
      },
    }));

    await fetchEnhancedMutation({
      fetch,
      form: new FakeFormElement(
        undefined,
        {
          'kovo-c': 'product-form',
          'kovo-fragment-target': 'product-form:p1',
        },
        '/_m/cart/add',
      ),
      formData: new FormData(),
      idem: 'idem_form_target',
      root: new FakeTargetRoot([]),
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Form-Target': 'product-form:p1',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_form_target',
        'Kovo-Targets': '',
      },
      keepalive: true,
      method: 'POST',
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
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_default',
        'Kovo-Targets': '',
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
            return name === 'Kovo-Changes' ? '[' : null;
          },
        },
        async text() {
          return '<kovo-fragment target="cart-form"><form></form></kovo-fragment>';
        },
      }),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_malformed_changes',
      onError,
      root: new FakeTargetRoot([]),
    });

    expect(fetched.body).toContain('kovo-fragment');
    expect(fetched.changes).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('Malformed JSON in Kovo-Changes header');
  });

  it('classifies enhanced mutation HTTP failures by ok and status', () => {
    expect(isFailedMutationResponse({ ok: false, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 422, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 500, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ ok: true, status: 204, text: async () => '' })).toBe(false);
    expect(isFailedMutationResponse({ text: async () => '' })).toBe(false);
  });

  it('reads the Kovo-Build response header into buildToken (SPEC §9.1.1)', async () => {
    // SPEC §9.1.1: every mutation response carries Kovo-Build so the runtime
    // can validate deltas against the expected page build token.
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: {
          get(name: string) {
            return name === 'Kovo-Build' ? 'build-abc123' : null;
          },
        },
        async text() {
          return '';
        },
      }),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_build',
      root: new FakeTargetRoot([]),
    });

    expect(fetched.buildToken).toBe('build-abc123');
  });

  it('sets buildToken to undefined when Kovo-Build header is absent', async () => {
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: { get: () => null },
        async text() {
          return '';
        },
      }),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_no_build',
      root: new FakeTargetRoot([]),
    });

    expect(fetched.buildToken).toBeUndefined();
  });
});
