import { describe, expect, it, vi } from 'vitest';

import {
  createQueryStore,
  installMutationBroadcast,
  submitEnhancedMutation,
  type EnhancedMutationFetchOptions,
} from './index.js';
import {
  FakeBroadcastChannel,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

describe('enhanced mutation submit', () => {
  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.deps = [
      { deps: 'cart', id: 'cart-badge' },
      { deps: 'product:p1', target: 'recommendations' },
      { deps: 'cart', id: 'cart-badge' },
    ];
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('recommendations', new FakeMorphTarget());
    const formData = new FormData();
    formData.set('productId', 'p1');
    formData.set('quantity', '1');
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512, total: 1024 });
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      broadcast,
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
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_01HX',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result).toEqual({
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
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(observed).toEqual(['morph:1:1 items:1', 'morph:1:1 items:1']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(root.targets.get('recommendations')?.html).toBe('<section></section>');
  });

  it('ignores malformed FW-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join('\n');
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

    expect(result.changes).toEqual([]);
    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    ]);
  });

  it('reports malformed FW-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
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
    expect(String(onError.mock.calls[0]?.[0])).toContain('Malformed JSON in FW-Changes header');
  });

  it('reports direct enhanced mutation fetch failures and clears pending state', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'fw-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
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

    const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
    expect(onError).toHaveBeenCalledWith(error);
    expect(pending?.attributes).not.toHaveProperty('fw-pending');
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
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
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
});
