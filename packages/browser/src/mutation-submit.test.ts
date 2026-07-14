import {
  renderedFragmentHtmlContent,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, type EnhancedMutationFetchOptions } from './client.js';
import { installMutationBroadcast } from './broadcast.js';
import { submitEnhancedMutation } from './mutation-submit.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

const TEST_BUILD = 'build-test';

type FragmentSnapshot = {
  html: string;
  mode?: 'append' | 'prepend' | 'replace';
  target: string;
};

function fragmentSnapshots(
  fragments: readonly {
    html: RenderedFragmentHtml;
    mode?: 'append' | 'prepend' | 'replace';
    target: string;
  }[],
): FragmentSnapshot[] {
  return fragments.map((fragment) => ({
    ...fragment,
    html: renderedFragmentHtmlContent(fragment.html),
  }));
}

function mutationSubmitSnapshot<
  Result extends { fragments: readonly { html: RenderedFragmentHtml; target: string }[] },
>(result: Result): Omit<Result, 'fragments'> & { fragments: FragmentSnapshot[] } {
  return {
    ...result,
    fragments: fragmentSnapshots(result.fragments),
  };
}

describe('enhanced mutation submit', () => {
  it('pins principal retirement across in-flight submit option and method mutation', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const replacementClose = vi.fn();
    const replacementBroadcast = { close: replacementClose, publish: vi.fn() };
    let resolveFetch!: (response: {
      headers: { get(name: string): string | null };
      ok: boolean;
      status: number;
      text(): Promise<string>;
    }) => void;
    const reload = vi.fn();
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { reload },
    });
    const options = {
      broadcast,
      fetch: () =>
        new Promise<{
          headers: { get(name: string): string | null };
          ok: boolean;
          status: number;
          text(): Promise<string>;
        }>((resolve) => {
          resolveFetch = resolve;
        }),
      form: { action: '/_m/auth/custom-sign-in', method: 'post' },
      formData: new FormData(),
      root: new FakeMorphRoot(),
      store,
    };

    try {
      const pending = submitEnhancedMutation(options);
      options.broadcast = replacementBroadcast;
      broadcast.close = vi.fn();
      resolveFetch({
        headers: {
          get(name: string) {
            return name.toLowerCase() === 'kovo-session-transition' ? 'reload' : null;
          },
        },
        ok: true,
        status: 200,
        async text() {
          return '';
        },
      });
      await pending;
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
    expect(replacementClose).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('closes the old-principal channel at the transition header before a slow body can apply', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const reload = vi.fn(() => {
      expect(channel.closed).toBe(true);
      expect(channel.onmessage).toBeNull();
    });
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { reload },
    });
    const text = vi.fn(() => new Promise<string>(() => undefined));

    try {
      const result = await submitEnhancedMutation({
        broadcast,
        fetch: async () => ({
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'kovo-session-transition' ? 'reload' : null;
            },
          },
          ok: true,
          status: 200,
          text,
        }),
        form: { action: '/_m/auth/custom-sign-in', method: 'post' },
        formData: new FormData(),
        root,
        store,
      });

      expect(channel.closed).toBe(true);
      expect(channel.onmessage).toBeNull();
      expect(reload).toHaveBeenCalledOnce();
      expect(text).not.toHaveBeenCalled();

      channel.onmessage?.({
        data: {
          body: '<kovo-query name="account">{"owner":"old-principal"}</kovo-query>',
          changes: [],
          type: 'kovo:mutation-response',
        },
      });
      expect(store.get('account')).toBeUndefined();
      expect(result).toEqual({
        appliedFragments: [],
        changes: [],
        fragments: [],
        idem: expect.any(String),
        queries: [],
        targets: [],
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it.each([
    {
      expected: '/',
      response: {
        headers: {
          get(name: string) {
            return name.toLowerCase() === 'location' ? '/' : null;
          },
        },
        status: 303,
      },
      title: 'sign-in-like 303 Location /',
    },
    {
      expected: 'https://kovo.test/login',
      response: {
        headers: {
          get() {
            return null;
          },
        },
        redirected: true,
        status: 200,
        url: 'https://kovo.test/login',
      },
      title: 'sign-out-like followed redirect to /login',
    },
  ])(
    'navigates after a successful enhanced auth redirect: $title',
    async ({ expected, response }) => {
      const store = createQueryStore();
      const channel = new FakeBroadcastChannel();
      const broadcast = installMutationBroadcast({ channel, store });
      const root = new FakeMorphRoot();
      const assign = vi.fn();
      const originalLocation = globalThis.location;
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: {
          assign,
          hash: '',
          href: 'https://kovo.test/cart',
          origin: 'https://kovo.test',
          pathname: '/cart',
          search: '',
        },
      });
      const text = vi.fn(async () => '<kovo-fragment target="auth">stale</kovo-fragment>');
      const fetch = vi.fn(async () => ({
        ...response,
        text,
      }));

      try {
        const result = await submitEnhancedMutation({
          broadcast,
          fetch,
          form: { action: '/_m/auth/sign-in', method: 'post' },
          formData: new FormData(),
          root,
          store,
        });
        expect(result).toEqual({
          appliedFragments: [],
          changes: [],
          fragments: [],
          idem: expect.any(String),
          queries: [],
          targets: [],
        });
      } finally {
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: originalLocation,
        });
      }

      expect(assign).toHaveBeenCalledWith(expected);
      expect(text).not.toHaveBeenCalled();
      expect(channel.closed).toBe(false);
      expect(channel.onmessage).not.toBeNull();
    },
  );

  it('navigates after a successful enhanced auth empty-fragment response', async () => {
    const store = createQueryStore();
    const lifecycleOrder: string[] = [];
    const channel = new (class extends FakeBroadcastChannel {
      override close(): void {
        lifecycleOrder.push('retire');
        super.close();
      }
    })();
    const broadcast = installMutationBroadcast({ channel, store });
    const lateMessageHandler = channel.onmessage;
    const root = new FakeMorphRoot();
    const assign = vi.fn(() => lifecycleOrder.push('navigate'));
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { assign },
    });
    const formData = new FormData();
    formData.set('next', '/dashboard?tab=home');
    const text = vi.fn(async () => '');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'kovo-changes' ? '[{"domain":"auth"}]' : null;
        },
      },
      ok: true,
      status: 200,
      text,
    }));

    try {
      const result = await submitEnhancedMutation({
        broadcast,
        fetch,
        form: { action: '/_m/auth/sign-in', method: 'post' },
        formData,
        root,
        store,
      });
      expect(result).toEqual({
        appliedFragments: [],
        changes: [],
        fragments: [],
        idem: expect.any(String),
        queries: [],
        targets: [],
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(assign).toHaveBeenCalledWith('/dashboard?tab=home');
    expect(text).toHaveBeenCalledTimes(1);
    expect(lifecycleOrder).toEqual(['retire', 'navigate']);
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
    lateMessageHandler?.({
      data: {
        body: '<kovo-query name="account">{"owner":"old-principal"}</kovo-query>',
        changes: [],
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('account')).toBeUndefined();
  });

  it('falls back to the auth sign-in default route after unsafe empty-fragment next values', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const assign = vi.fn();
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { assign },
    });
    const formData = new FormData();
    formData.set('next', 'https://evil.example/account');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'kovo-changes' ? '[{"domain":"auth"}]' : null;
        },
      },
      ok: true,
      status: 200,
      text: vi.fn(async () => ''),
    }));

    try {
      await submitEnhancedMutation({
        fetch,
        form: { action: '/_m/auth/sign-in', method: 'post' },
        formData,
        root,
        store,
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(assign).toHaveBeenCalledWith('/');
  });

  it('follows 401 Kovo-Reauth without applying mutation fragments', async () => {
    const store = createQueryStore();
    const lifecycleOrder: string[] = [];
    const channel = new (class extends FakeBroadcastChannel {
      override close(): void {
        lifecycleOrder.push('retire');
        super.close();
      }
    })();
    const broadcast = installMutationBroadcast({ channel, store });
    const lateMessageHandler = channel.onmessage;
    const root = new FakeMorphRoot();
    const assign = vi.fn(() => lifecycleOrder.push('navigate'));
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { assign },
    });
    const text = vi.fn(async () => '<kovo-fragment target="cart">wrong</kovo-fragment>');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'kovo-reauth' ? '/login?next=%2Fcart' : null;
        },
      },
      status: 401,
      text,
    }));

    try {
      const result = await submitEnhancedMutation({
        broadcast,
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        root,
        store,
      });
      expect(result).toEqual({
        appliedFragments: [],
        changes: [],
        fragments: [],
        idem: expect.any(String),
        queries: [],
        targets: [],
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(assign).toHaveBeenCalledWith('/login?next=%2Fcart');
    expect(text).not.toHaveBeenCalled();
    expect(lifecycleOrder).toEqual(['retire', 'navigate']);
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
    lateMessageHandler?.({
      data: {
        body: '<kovo-query name="account">{"owner":"expired-principal"}</kovo-query>',
        changes: [],
        type: 'kovo:mutation-response',
      },
    });
    expect(store.get('account')).toBeUndefined();
  });

  it.each([
    ['/login?next=%2Fcart', '/login?next=%2Fcart'],
    ['https://evil.example/login', '/'],
    ['//evil.example/login', '/'],
    ['/\\evil.example/login', '/'],
    ['/%0a/login', '/'],
  ])('sanitizes 401 Kovo-Reauth %s before navigation', async (reauth, expected) => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const navigationRetirementStates: boolean[] = [];
    const assign = vi.fn(() => navigationRetirementStates.push(channel.closed));
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { assign },
    });
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'kovo-reauth' ? reauth : null;
        },
      },
      status: 401,
      text: vi.fn(async () => '<kovo-fragment target="cart">wrong</kovo-fragment>'),
    }));

    try {
      await submitEnhancedMutation({
        broadcast,
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        root,
        store,
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(assign).toHaveBeenCalledWith(expected);
    expect(navigationRetirementStates).toEqual([true]);
    expect(channel.closed).toBe(true);
    expect(channel.onmessage).toBeNull();
  });

  it('keeps the mutation principal live for a non-401 response with a stray reauth header', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ buildToken: TEST_BUILD, channel, store });
    const root = new FakeMorphRoot();
    const body = '<kovo-query name="account">{"owner":"same-principal"}</kovo-query>';

    const result = await submitEnhancedMutation({
      broadcast,
      fetch: async () => ({
        headers: {
          get(name: string) {
            const normalized = name.toLowerCase();
            if (normalized === 'kovo-reauth') return '/login';
            return normalized === 'kovo-build' ? TEST_BUILD : null;
          },
        },
        ok: true,
        status: 200,
        text: async () => body,
      }),
      form: { action: '/_m/account/update', method: 'post' },
      formData: new FormData(),
      expectedBuildToken: TEST_BUILD,
      root,
      store,
    });

    expect(result.queries).toEqual(['account']);
    expect(store.get('account')).toEqual({ owner: 'same-principal' });
    expect(channel.closed).toBe(false);
    expect(channel.onmessage).not.toBeNull();
    expect(channel.messages).toEqual([
      {
        body,
        buildToken: TEST_BUILD,
        changes: [],
        type: 'kovo:mutation-response',
      },
    ]);
  });

  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ buildToken: TEST_BUILD, channel, store });
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.deps = [
      {
        component: 'components/cart/cart-badge/cart-badge',
        deps: 'cart',
        token: 'tok_cart',
        id: 'cart-badge',
      },
      {
        component: 'components/recommendations/recommendations',
        deps: 'product:p1',
        props: '{"productId":"p1"}',
        token: 'tok_recommendations',
        target: 'recommendations',
      },
      { deps: 'cart', id: 'cart-badge', token: 'tok_cart' },
    ];
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('recommendations', new FakeMorphTarget());
    const formData = new FormData();
    formData.set('productId', 'p1');
    formData.set('quantity', '1');
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'kovo-build') return TEST_BUILD;
          return name === 'Kovo-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512, total: 1024 });
        return [
          '<kovo-query name="cart">{"count":1}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
          '<kovo-fragment target="recommendations"><section></section></kovo-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      broadcast,
      expectedBuildToken: TEST_BUILD,
      idem: 'idem_01HX',
      morph(target, html) {
        observed.push(
          `morph:${count.textContent}:${summary.textContent}:${host.getAttribute('data-count')}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="cart-host"]',
              select: (value) => (value as { count: number }).count,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_01HX',
        'Kovo-Live-Targets':
          'cart-badge#components/cart/cart-badge/cart-badge@tok_cart:{}; recommendations#components/recommendations/recommendations@tok_recommendations:{"productId":"p1"}',
        'Kovo-Targets': 'cart-badge=cart; recommendations=product:p1',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(mutationSubmitSnapshot(result)).toEqual({
      appliedFragments: ['cart-badge', 'recommendations'],
      fragments: [
        { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
        { html: '<section></section>', target: 'recommendations' },
      ],
      changes: [{ domain: 'cart' }],
      idem: 'idem_01HX',
      queries: ['cart'],
      targets: ['cart-badge=cart', 'recommendations=product:p1'],
    });
    expect(channel.messages).toEqual([
      {
        body: [
          '<kovo-query name="cart">{"count":1}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
          '<kovo-fragment target="recommendations"><section></section></kovo-fragment>',
        ].join('\n'),
        buildToken: TEST_BUILD,
        changes: [{ domain: 'cart' }],
        type: 'kovo:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(observed).toEqual(['morph:1:1 items:1', 'morph:1:1 items:1']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(root.targets.get('recommendations')?.html).toBe('<section></section>');
  });

  it('ignores malformed Kovo-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ buildToken: TEST_BUILD, channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ deps: 'cart', id: 'cart-badge', token: 'tok_cart' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'kovo-build') return TEST_BUILD;
          return name === 'Kovo-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      expectedBuildToken: TEST_BUILD,
      root,
      store,
    });

    expect(result.changes).toEqual([]);
    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(channel.messages).toEqual([
      {
        body: [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join('\n'),
        buildToken: TEST_BUILD,
        changes: [],
        type: 'kovo:mutation-response',
      },
    ]);
  });

  it('reports malformed Kovo-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.deps = [{ deps: 'cart', id: 'cart-badge', token: 'tok_cart' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'Kovo-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      onError,
      root,
      store,
    });

    expect(result.changes).toEqual([]);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('Malformed JSON in Kovo-Changes header');
  });

  it('reports direct enhanced mutation fetch failures and clears pending state', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'kovo-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[kovo-deps]')][0];
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'kovo-pending': '',
      });
      throw error;
    });

    await expect(
      submitEnhancedMutation({
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        onError,
        pendingQueries: ['cart'],
        pendingRoot,
        root,
        store,
      }),
    ).rejects.toBe(error);

    const pending = [...pendingRoot.querySelectorAll('[kovo-deps]')][0];
    expect(onError).toHaveBeenCalledWith(error);
    expect(pending?.attributes).not.toHaveProperty('kovo-pending');
    expect(pending?.attributes).not.toHaveProperty('aria-busy');
  });

  it('does not rebroadcast failed enhanced mutation responses', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      ok: false,
      status: 422,
      async text() {
        return '<kovo-fragment target="cart-form"><form>Out of stock</form></kovo-fragment>';
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      root,
      store,
    });

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(channel.messages).toEqual([]);
  });

  it('applies a typed failure fragment normally when a streaming form receives 422', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('composer', new FakeMorphTarget());
    const text = vi.fn(
      async () =>
        '<kovo-fragment target="composer"><form><output role="alert">failed</output></form></kovo-fragment>',
    );
    const fetch = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>(),
      headers: { get: () => null },
      ok: false,
      status: 422,
      text,
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: {
        action: '/_m/chat/send',
        getAttribute(name: string) {
          return name === 'data-mutation-stream' ? 'true' : null;
        },
        method: 'post',
      },
      formData: new FormData(),
      root,
      store,
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(result.appliedFragments).toEqual(['composer']);
    expect(root.targets.get('composer')?.html).toContain('role="alert"');
  });

  it('streams opted-in enhanced submits from a readable response body', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const streamTarget = new FakeQueryBindingElement(
      { 'data-stream-text': 'assistant:a1' },
      { textContent: '' },
    );
    root.targets.set('messages', new FakeMorphTarget());
    root.querySelectorAll = (selector: string) =>
      selector === '[data-stream-text="assistant:a1"]' ? [streamTarget] : [];
    const text = vi.fn(async () => {
      throw new Error('streaming submit should not buffer text()');
    });
    const fetch = vi.fn(async (_url: string, _options: EnhancedMutationFetchOptions) => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              '<kovo-fragment target="messages" mode="append"><article data-stream-text="assistant:a1"></article></kovo-fragment>',
            ),
          );
          controller.enqueue(
            encoder.encode(
              '<kovo-text target="assistant:a1">Hello</kovo-text><kovo-query name="chat">{"count":1}</kovo-query>',
            ),
          );
          // I1 (SPEC §9.1:810): a confirmed stream terminates with <kovo-done> (reason
          // defaults to "complete"); the server always emits it on a clean completion.
          controller.enqueue(encoder.encode('<kovo-done></kovo-done>'));
          controller.close();
        },
      }),
      headers: {
        get(name: string) {
          return name === 'Kovo-Changes' ? '[{"domain":"chat"}]' : null;
        },
      },
      text,
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: {
        action: '/_m/chat/send',
        getAttribute(name: string) {
          return name === 'data-mutation-stream' ? 'true' : null;
        },
        method: 'post',
      },
      formData: new FormData(),
      idem: 'idem_stream_01',
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledWith('/_m/chat/send', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html; stream=1',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_stream_01',
        'Kovo-Live-Targets': '',
        'Kovo-Stream': 'true',
        'Kovo-Targets': '',
      },
      keepalive: false,
      method: 'POST',
    });
    expect(text).not.toHaveBeenCalled();
    expect(root.targets.get('messages')?.html).toBe(
      '<article data-stream-text="assistant:a1"></article>',
    );
    expect(streamTarget.textContent).toBe('Hello');
    expect(store.get('chat')).toEqual({ count: 1 });
    expect(result).toMatchObject({
      appliedFragments: ['messages'],
      changes: [{ domain: 'chat' }],
      idem: 'idem_stream_01',
      queries: ['chat'],
      streams: ['assistant:a1'],
      targets: [],
    });
  });
});
