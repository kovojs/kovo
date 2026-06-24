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

describe('enhanced mutation submit', () => {
  it('follows 401 Kovo-Reauth without applying mutation fragments', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const assign = vi.fn();
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
  });

  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    store.setVersion('cart', '7');
    store.setVersion('product', '12', 'product:p1');
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
      {
        component: 'components/cart/cart-badge/cart-badge',
        deps: 'cart',
        id: 'cart-badge',
      },
      {
        component: 'components/recommendations/recommendations',
        deps: 'product:p1',
        props: '{"productId":"p1"}',
        target: 'recommendations',
      },
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
          'cart-badge#components/cart/cart-badge/cart-badge:{}; recommendations#components/recommendations/recommendations:{"productId":"p1"}',
        'Kovo-Query-Versions': '{"cart":"7","product:p1":"12"}',
        'Kovo-Targets': 'cart-badge=cart; recommendations=product:p1',
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
          '<kovo-query name="cart">{"count":1}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>1</cart-badge></kovo-fragment>',
          '<kovo-fragment target="recommendations"><section></section></kovo-fragment>',
        ].join('\n'),
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
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
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
          '<kovo-query name="cart">{"count":2}</kovo-query>',
          '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
        ].join('\n'),
        changes: [],
        type: 'kovo:mutation-response',
      },
    ]);
  });

  it('reports malformed Kovo-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
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
