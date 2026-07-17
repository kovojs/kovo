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

function typedMutationForm(
  key: string,
  options: { attributes?: Record<string, string | null>; method?: string } = {},
) {
  const action = `/_m/${key}`;
  return {
    action,
    getAttribute(name: string) {
      if (name === 'action') return action;
      if (name === 'data-mutation') return key;
      if (name === 'method') return options.method ?? 'post';
      return options.attributes?.[name] ?? null;
    },
    method: options.method ?? 'post',
  };
}

function fragmentHeaders(read?: (name: string) => string | null) {
  return {
    get(name: string) {
      if (name.toLowerCase() === 'content-type') {
        return 'text/vnd.kovo.fragment+html; charset=utf-8';
      }
      return read?.(name) ?? null;
    },
  };
}

function poisonMutationArrayMethods(): () => void {
  const methods = ['every', 'filter', 'flatMap'] as const;
  const descriptors = methods.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name);
    if (!descriptor) throw new Error(`Missing Array.prototype.${name}`);
    return { descriptor, name };
  });
  for (const { descriptor, name } of descriptors) {
    Object.defineProperty(Array.prototype, name, {
      ...descriptor,
      value: name === 'every' ? () => false : () => [],
    });
  }
  return () => {
    for (const { descriptor, name } of descriptors) {
      Object.defineProperty(Array.prototype, name, descriptor);
    }
  };
}

describe('enhanced mutation fetch', () => {
  it('retires the old auth session after late mutation-array prototype poisoning', async () => {
    const originalLocation = globalThis.location;
    const assign = vi.fn();
    const onSessionTransition = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        assign,
        hash: '',
        href: 'https://kovo.test/login',
        origin: 'https://kovo.test',
        pathname: '/login',
        search: '',
      },
    });

    const pending = fetchEnhancedMutation({
      fetch: async () => ({
        headers: fragmentHeaders((name) =>
          name === 'Kovo-Changes' ? '[{"domain":"auth"}]' : null,
        ),
        ok: true,
        status: 200,
        text: async () => '',
        url: 'https://kovo.test/_m/auth/sign-in',
      }),
      form: typedMutationForm('auth/sign-in'),
      formData: new FormData(),
      idem: 'idem_late_array_poison',
      onSessionTransition,
      root: new FakeTargetRoot([]),
      transport: {
        action: '/_m/auth/sign-in',
        method: 'POST',
        origin: 'https://kovo.test',
        sourceUrl: 'https://kovo.test/login',
      },
    });
    const restoreArrays = poisonMutationArrayMethods();
    let fetched;
    try {
      fetched = await pending;
    } finally {
      restoreArrays();
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    // SPEC §9.3: a successful empty auth fragment retires old-principal
    // broadcast authority before navigation, even after app code mutates prototypes.
    expect(onSessionTransition).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/');
    expect(fetched.changes).toEqual([]);
  });

  it('keeps auth-success navigation same-origin after late decode poisoning', async () => {
    const lifecycleOrder: string[] = [];
    const assign = vi.fn(() => lifecycleOrder.push('navigate'));
    const originalLocation = globalThis.location;
    const originalDecodeURIComponent = globalThis.decodeURIComponent;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        assign,
        hash: '',
        href: 'https://kovo.test/login',
        origin: 'https://kovo.test',
        pathname: '/login',
        search: '',
      },
    });
    const formData = new FormData();
    formData.set('next', '/\\evil.example/phish');

    try {
      const fetched = fetchEnhancedMutation({
        fetch: async () => ({
          headers: fragmentHeaders((name) =>
            name === 'Kovo-Changes' ? '[{"domain":"auth"}]' : null,
          ),
          ok: true,
          status: 200,
          text: async () => '',
          url: 'https://kovo.test/_m/auth/sign-in',
        }),
        form: typedMutationForm('auth/sign-in'),
        formData,
        idem: 'idem_late_decode',
        onSessionTransition: () => lifecycleOrder.push('retire'),
        root: new FakeTargetRoot([]),
        transport: {
          action: '/_m/auth/sign-in',
          method: 'POST',
          origin: 'https://kovo.test',
          sourceUrl: 'https://kovo.test/login',
        },
      });
      Object.defineProperty(globalThis, 'decodeURIComponent', {
        configurable: true,
        value: () => '/',
      });

      await fetched;
      expect(assign).toHaveBeenCalledWith('/');
      expect(lifecycleOrder).toEqual(['retire', 'navigate']);
    } finally {
      Object.defineProperty(globalThis, 'decodeURIComponent', {
        configurable: true,
        value: originalDecodeURIComponent,
      });
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('retires at the session-transition header without reading buffered response truth', async () => {
    const onSessionTransition = vi.fn();
    const text = vi.fn(async () => '<kovo-query name="account">{"private":true}</kovo-query>');
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: {
          get(name: string) {
            const normalized = name.toLowerCase();
            if (normalized === 'content-type') return 'text/vnd.kovo.fragment+html';
            return normalized === 'kovo-session-transition' ? 'reload' : null;
          },
        },
        ok: true,
        status: 200,
        text,
        url: 'http://localhost/_m/auth/custom-sign-in',
      }),
      form: typedMutationForm('auth/custom-sign-in'),
      formData: new FormData(),
      idem: 'idem_session_transition',
      onSessionTransition,
      root: new FakeTargetRoot([]),
    });

    expect(fetched.sessionTransition).toBe(true);
    expect(fetched.body).toBe('');
    expect(fetched.changes).toEqual([]);
    expect(onSessionTransition).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it('retires a streaming transition before exposing or consuming its body', async () => {
    const onSessionTransition = vi.fn();
    const text = vi.fn(async () => 'must not be read');
    const streamBody = {} as ReadableStream<Uint8Array>;
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        body: streamBody,
        headers: {
          get(name: string) {
            const normalized = name.toLowerCase();
            if (normalized === 'content-type') return 'text/vnd.kovo.fragment+html';
            return normalized === 'kovo-session-transition' ? 'reload' : null;
          },
        },
        ok: true,
        status: 200,
        text,
        url: 'http://localhost/_m/auth/custom-sign-in',
      }),
      form: typedMutationForm('auth/custom-sign-in'),
      formData: new FormData(),
      onSessionTransition,
      root: new FakeTargetRoot([]),
      streaming: true,
    });

    expect(onSessionTransition).toHaveBeenCalledOnce();
    expect(fetched).not.toHaveProperty('streamBody');
    expect(text).not.toHaveBeenCalled();
  });

  it('builds the enhanced mutation request from live targets and returns sanitized wire metadata', async () => {
    const formData = new FormData();
    const uploadProgress = vi.fn();
    const root = new FakeTargetRoot([
      new FakeTargetElement('cart-badge', { 'kovo-deps': 'cart product:p1' }),
      new FakeTargetElement(undefined, {
        'kovo-deps': 'recommendations',
        'kovo-fragment-target': 'recommendations:p1',
        'kovo-live-component': 'components/recommendations/recommendations',
        'kovo-live-token': 'tok_rec',
        'kovo-props': '{"productId":"p1"}',
      }),
      new FakeTargetElement('cart-badge', { 'kovo-deps': 'cart product:p1' }),
    ]);
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders((name) => {
        return name === 'Kovo-Changes'
          ? '[{"domain":"cart","keys":["c1"],"input":{"unsafe":true}},{"domain":5}]'
          : null;
      }),
      async text() {
        options.onUploadProgress?.({ loaded: 5, total: 10 });
        return '<kovo-query name="cart">{"count":1}</kovo-query>';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: typedMutationForm('cart/add'),
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
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_fetch',
        'Kovo-Live-Targets':
          'recommendations:p1#components/recommendations/recommendations@tok_rec:{"productId":"p1"}',
        'Kovo-Targets': 'cart-badge=cart product:p1; recommendations:p1=recommendations',
      },
      keepalive: true,
      method: 'POST',
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

  it('sends canonical current URL without the browser fragment', async () => {
    const originalLocation = globalThis.location;
    const fetch = vi.fn(async () => ({
      headers: fragmentHeaders(),
      text: async () => '',
      url: 'https://kovo.test/_m/cart/add',
    }));
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL('https://kovo.test/cart?tab=summary#private-panel'),
    });
    try {
      await fetchEnhancedMutation({
        fetch,
        form: typedMutationForm('cart/add'),
        formData: new FormData(),
        root: new FakeTargetRoot([]),
        transport: {
          action: '/_m/cart/add',
          method: 'POST',
          origin: 'https://kovo.test',
          sourceUrl: 'https://kovo.test/cart?tab=summary',
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        '/_m/cart/add',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Kovo-Current-Url': 'https://kovo.test/cart?tab=summary',
          }),
        }),
      );
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it.each(['data:/_m/chat', 'blob:/_m/chat', 'file:/_m/chat'])(
    'rejects opaque-origin direct mutation action %s before credential-bearing fetch',
    async (action) => {
      const originalLocation = globalThis.location;
      const fetch = vi.fn();
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: new URL('about:srcdoc'),
      });
      try {
        await expect(
          fetchEnhancedMutation({
            fetch,
            form: {
              action,
              getAttribute(name: string) {
                if (name === 'action') return action;
                if (name === 'method') return 'post';
                return null;
              },
              method: 'post',
            },
            formData: new FormData(),
            root: new FakeTargetRoot([]),
          }),
        ).rejects.toThrow(/enhanced mutation transport is invalid/u);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: originalLocation,
        });
      }
    },
  );

  it('rejects a caller-supplied opaque-origin mutation transport', async () => {
    const fetch = vi.fn();

    await expect(
      fetchEnhancedMutation({
        fetch,
        form: typedMutationForm('chat'),
        formData: new FormData(),
        root: new FakeTargetRoot([]),
        transport: {
          action: '/_m/chat',
          method: 'POST',
          origin: 'null',
          sourceUrl: 'about:srcdoc',
        },
      }),
    ).rejects.toThrow(/enhanced mutation transport is invalid/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http:', 'https:'])(
    'preserves ordinary %s direct enhanced mutation transport',
    async (protocol) => {
      const originalLocation = globalThis.location;
      const origin = `${protocol}//kovo.test`;
      const fetch = vi.fn(async () => ({
        headers: fragmentHeaders(),
        ok: true,
        status: 204,
        text: async () => '',
        url: `${origin}/_m/chat`,
      }));
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: new URL(`${origin}/chat?room=security#private`),
      });
      try {
        await fetchEnhancedMutation({
          fetch,
          form: {
            action: '/_m/chat',
            getAttribute(name: string) {
              if (name === 'action') return '/_m/chat';
              if (name === 'method') return 'post';
              return null;
            },
            method: 'post',
          },
          formData: new FormData(),
          root: new FakeTargetRoot([]),
        });

        expect(fetch).toHaveBeenCalledWith(
          '/_m/chat',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Kovo-Current-Url': `${origin}/chat?room=security`,
            }),
            method: 'POST',
          }),
        );
      } finally {
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: originalLocation,
        });
      }
    },
  );

  it('rejects cross-origin final responses and non-mutation media before body apply', async () => {
    const crossOriginText = vi.fn(async () => '<kovo-fragment target="cart">bad</kovo-fragment>');
    await expect(
      fetchEnhancedMutation({
        fetch: async () => ({
          headers: fragmentHeaders(),
          text: crossOriginText,
          url: 'https://evil.example/_m/cart/add',
        }),
        form: typedMutationForm('cart/add'),
        formData: new FormData(),
        root: new FakeTargetRoot([]),
      }),
    ).rejects.toThrow(/same-origin URL proof/u);
    expect(crossOriginText).not.toHaveBeenCalled();

    const wrongMediaText = vi.fn(async () => '<html>not mutation wire</html>');
    await expect(
      fetchEnhancedMutation({
        fetch: async () => ({
          headers: { get: () => 'text/html; charset=utf-8' },
          text: wrongMediaText,
          url: 'http://localhost/_m/cart/add',
        }),
        form: typedMutationForm('cart/add'),
        formData: new FormData(),
        root: new FakeTargetRoot([]),
      }),
    ).rejects.toThrow(/non-fragment enhanced mutation response/u);
    expect(wrongMediaText).not.toHaveBeenCalled();
  });

  it('replaces the hidden Kovo-Idem form field with a fresh enhanced-submit token', async () => {
    const formData = new FormData();
    const renderedIdem = 'v1_1750000000000_000102030405060708090a0b0c0d0e0f';
    formData.set('Kovo-Idem', renderedIdem);
    const root = new FakeTargetRoot([]);
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders(),
      async text() {
        return '';
      },
      url: 'http://localhost/_m/comment/post',
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: typedMutationForm('comment/post'),
      formData,
      root,
    });

    expect(fetch).toHaveBeenCalledWith(
      '/_m/comment/post',
      expect.objectContaining({
        body: formData,
        headers: expect.objectContaining({
          'Kovo-Idem': expect.stringMatching(/^v1_1750000000000_[0-9a-f]{32}$/u),
        }),
      }),
    );
    expect(fetched.idem).not.toBe(renderedIdem);
    expect(formData.get('Kovo-Idem')).toBe(fetched.idem);
  });

  it('rejects a read-only custom body that carries stale idempotency authority', async () => {
    const fetch = vi.fn();

    await expect(
      fetchEnhancedMutation({
        fetch,
        form: typedMutationForm('comment/post'),
        formData: {
          get: () => 'v1_1750000000000_000102030405060708090a0b0c0d0e0f',
        },
        root: new FakeTargetRoot([]),
      }),
    ).rejects.toThrow(/form-data setter control is unavailable/u);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps selector-hostile identities but skips delimiter-unsafe live target headers', async () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement('target"bad\\id', {
        'kovo-deps': 'cart product:p1',
        'kovo-live-component': 'components/cart/cart-panel',
        'kovo-live-token': 'tok_cart',
      }),
      new FakeTargetElement(undefined, {
        'kovo-deps': 'cart',
        'kovo-fragment-target': 'bad#target',
        'kovo-live-component': 'components/cart/bad',
      }),
      new FakeTargetElement(undefined, {
        'kovo-c': 'bad-component',
        'kovo-deps': 'bad;dep',
        'kovo-fragment-target': 'bad-dep',
      }),
      new FakeTargetElement(undefined, {
        'kovo-c': 'bad#component',
        'kovo-deps': 'cart',
        'kovo-fragment-target': 'safe-target',
      }),
      new FakeTargetElement(undefined, {
        'kovo-c': 'bad:component',
        'kovo-deps': 'cart',
        'kovo-fragment-target': 'safe-target-with-bad-component',
      }),
    ]);
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders(),
      async text() {
        return '';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: typedMutationForm('cart/add'),
      formData: new FormData(),
      idem: 'idem_header_safe',
      root,
    });

    // SPEC.md §9.1: live target headers are delimiter-based, so the browser
    // collector rejects only identities that would corrupt those headers.
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_header_safe',
        'Kovo-Live-Targets': 'target"bad\\id#components/cart/cart-panel@tok_cart:{}',
        'Kovo-Targets':
          'target"bad\\id=cart product:p1; safe-target=cart; safe-target-with-bad-component=cart',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(fetched.targets).toEqual([
      'target"bad\\id=cart product:p1',
      'safe-target=cart',
      'safe-target-with-bad-component=cart',
    ]);
  });

  it('sends the submitted enhanced form target when the form carries runtime identity', async () => {
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders(),
      async text() {
        return '<kovo-fragment target="product-form:p1"><form></form></kovo-fragment>';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    await fetchEnhancedMutation({
      fetch,
      form: new FakeFormElement(
        undefined,
        {
          'data-mutation': 'cart/add',
          'kovo-c': 'product-form',
          'kovo-fragment-target': 'product-form:p1',
        },
        '/_m/cart/add',
        'post',
      ),
      formData: new FormData(),
      idem: 'idem_form_target',
      root: new FakeTargetRoot([]),
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Form-Target': 'product-form:p1',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_form_target',
        'Kovo-Live-Targets': '',
        'Kovo-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });
  });

  it('reads submitted form targets from attributes before shadowable DOM properties', async () => {
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders(),
      async text() {
        return '<kovo-fragment target="your-answer"><form></form></kovo-fragment>';
      },
      url: 'http://localhost/_m/postAnswer',
    }));

    await fetchEnhancedMutation({
      fetch,
      form: {
        action: '/_m/postAnswer',
        getAttribute(name: string) {
          if (name === 'action') return '/_m/postAnswer';
          if (name === 'data-mutation') return 'postAnswer';
          if (name === 'method') return 'post';
          if (name === 'id') return 'your-answer';
          return null;
        },
        id: { toString: () => '[object HTMLInputElement]' },
      },
      formData: new FormData(),
      idem: 'idem_shadowed_id',
      root: new FakeTargetRoot([]),
    });

    expect(fetch).toHaveBeenCalledWith('/_m/postAnswer', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Form-Target': 'your-answer',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_shadowed_id',
        'Kovo-Live-Targets': '',
        'Kovo-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });
  });

  it('defaults to POST and omits upload progress when no progress hook is configured', async () => {
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      headers: fragmentHeaders(),
      async text() {
        return '';
      },
      url: 'http://localhost/_m/cart/add',
    }));

    const fetched = await fetchEnhancedMutation({
      fetch,
      form: typedMutationForm('cart/add'),
      formData: 'body',
      idem: 'idem_default',
      root: new FakeTargetRoot([]),
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: 'body',
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Current-Url': 'http://localhost/',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_default',
        'Kovo-Live-Targets': '',
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
        headers: fragmentHeaders((name) => (name === 'Kovo-Changes' ? '[' : null)),
        async text() {
          return '<kovo-fragment target="cart-form"><form></form></kovo-fragment>';
        },
        url: 'http://localhost/_m/cart/add',
      }),
      form: typedMutationForm('cart/add'),
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

  it('rejects inherited response carriers through the modular mutation transport', async () => {
    const inherited = Object.create({
      headers: { get: () => null },
      text: async () => '<kovo-query name="cart">{"count":99}</kovo-query>',
    });

    await expect(
      fetchEnhancedMutation({
        fetch: async () => inherited,
        form: typedMutationForm('cart/add'),
        formData: new FormData(),
        idem: 'idem_inherited_response',
        root: new FakeTargetRoot([]),
      }),
    ).rejects.toThrow(/invalid response carrier/);
  });

  it('classifies enhanced mutation HTTP failures by ok and status', () => {
    expect(isFailedMutationResponse({ ok: false, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 422, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ status: 500, text: async () => '' })).toBe(true);
    expect(isFailedMutationResponse({ ok: true, status: 204, text: async () => '' })).toBe(false);
    expect(isFailedMutationResponse({ text: async () => '' })).toBe(false);
  });

  it('retains the witnessed failure classification after response-carrier mutation', async () => {
    const response = {
      headers: fragmentHeaders(),
      ok: false,
      status: 500,
      text: async () => '',
      url: 'http://localhost/_m/cart/add',
    };
    const fetched = await fetchEnhancedMutation({
      fetch: async () => response,
      form: typedMutationForm('cart/add'),
      formData: new FormData(),
      idem: 'idem_failure_snapshot',
      root: new FakeTargetRoot([]),
    });

    response.ok = true;
    response.status = 200;

    // SPEC §6.6/§9.1: response success is a membrane-bound fact. Optimistic publication and
    // rollback run after transport/body awaits and must not reclassify a retained mutable carrier.
    expect(isFailedMutationResponse(fetched.response)).toBe(true);
  });

  it('does not invoke inherited or accessor response facts in direct classification', () => {
    const inherited = Object.create({ ok: false, status: 500 }) as {
      text(): Promise<string>;
    };
    inherited.text = async () => '';
    const status = vi.fn(() => 500);
    const accessor = { text: async () => '' };
    Object.defineProperty(accessor, 'status', { get: status });

    expect(isFailedMutationResponse(inherited)).toBe(false);
    expect(isFailedMutationResponse(accessor)).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });

  it('reads the Kovo-Build response header into buildToken (SPEC §9.1.1)', async () => {
    // SPEC §9.1.1: every mutation response carries Kovo-Build so the runtime
    // can validate deltas against the expected page build token.
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: fragmentHeaders((name) => (name === 'Kovo-Build' ? 'build-abc123' : null)),
        async text() {
          return '';
        },
        url: 'http://localhost/_m/cart/add',
      }),
      form: typedMutationForm('cart/add'),
      formData: new FormData(),
      idem: 'idem_build',
      root: new FakeTargetRoot([]),
    });

    expect(fetched.buildToken).toBe('build-abc123');
  });

  it('sets buildToken to undefined when Kovo-Build header is absent', async () => {
    const fetched = await fetchEnhancedMutation({
      fetch: async () => ({
        headers: fragmentHeaders(),
        async text() {
          return '';
        },
        url: 'http://localhost/_m/cart/add',
      }),
      form: typedMutationForm('cart/add'),
      formData: new FormData(),
      idem: 'idem_no_build',
      root: new FakeTargetRoot([]),
    });

    expect(fetched.buildToken).toBeUndefined();
  });
});
