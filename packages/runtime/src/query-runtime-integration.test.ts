import { describe, expect, it, vi } from 'vitest';

import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import {
  applyDeferredStreamResponseToRuntime,
  applyCompiledQueryUpdatePlan,
  applyMutationResponseToDom,
  applyQueryBindings,
  createQueryStore,
  derive,
  installMutationBroadcast,
  installPagehideOptimismCleanup,
  submitEnhancedMutation,
} from './index.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
  FakeRoot,
  FakeTemplateStampHost,
} from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

describe('query runtime integration', () => {
  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
  });

  it('applies query update bindings from mutation chunks without requiring a fragment', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const total = new FakeQueryBindingElement('cart.total', { value: '1499' });
    const product = new FakeQueryBindingElement('product.name', { textContent: 'Coffee' });
    root.bindings.push(count, total, product);

    const result = applyMutationResponseToDom({
      body: '<fw-query name="cart">{"count":2,"total":2998}</fw-query>',
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: [],
      fragments: [],
      queries: ['cart'],
    });
    expect(count.textContent).toBe('2');
    expect(total.value).toBe('2998');
    expect(product.textContent).toBe('Coffee');
  });

  it('applies query update bindings from deferred chunks before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":4}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`binding:${count.textContent}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['binding:4']);
  });

  it('exposes a DOM-light data-bind update plan helper', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const items = new FakeQueryBindingElement('cart.items', { textContent: '' });
    root.bindings.push(count, items);

    expect(applyQueryBindings(root, 'cart', { count: 3, items: [{ id: 'p1' }] })).toEqual([
      'cart.count',
      'cart.items',
    ]);
    expect(count.textContent).toBe('3');
    expect(items.textContent).toBe('[{"id":"p1"}]');
  });

  it('applies optional binding path segments and removes empty attribute bindings', () => {
    const root = new FakeMorphRoot();
    const name = new FakeQueryBindingElement('deal.contact?.name', { textContent: 'Ada' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'Ada',
      'data-bind:aria-label': 'deal.contact?.name',
    });
    root.bindings.push(name);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'deal', { contact: null })).toEqual([
      'deal.contact?.name',
      'deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'deal', { contact: { name: 'Grace' } });
    expect(name.textContent).toBe('Grace');
    expect(label.getAttribute('aria-label')).toBe('Grace');
  });

  it('runs compiled query update plans in bindings -> named derives -> stamps order', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement(
      { 'data-derive': 'cart.summary' },
      { textContent: '1 item' },
    );
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      { count: 2 },
      {
        derives: [
          {
            name: 'summary',
            select(value) {
              observed.push(`derive sees binding:${count.textContent}`);
              return `${(value as { count: number }).count} items`;
            },
          },
        ],
        stamps: [
          {
            attr: 'data-cart-summary',
            selector: '[data-plan="cart-host"]',
            select() {
              observed.push(`stamp sees derive:${summary.textContent}`);
              return summary.textContent;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: ['cart.count'],
      derives: ['summary'],
      stamps: ['data-cart-summary'],
      templateStamps: [],
    });
    expect(observed).toEqual(['derive sees binding:2', 'stamp sees derive:2 items']);
    expect(count.textContent).toBe('2');
    expect(summary.textContent).toBe('2 items');
    expect(host.getAttribute('data-cart-summary')).toBe('2 items');
  });

  it('removes compiled attribute stamps when the selected value is empty', () => {
    const root = new FakeMorphRoot();
    const host = new FakeQueryPlanElement({ 'aria-label': 'Ada', 'data-plan': 'deal-host' });
    root.planElements.push(host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'deal',
      { contact: null },
      {
        bindings: false,
        stamps: [
          {
            attr: 'aria-label',
            selector: '[data-plan="deal-host"]',
            select(value) {
              return (value as { contact: { name: string } | null }).contact?.name;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: ['aria-label'],
      templateStamps: [],
    });
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('declares named derive inputs beside the pure derive function', () => {
    const isEmpty = derive(['cart'], (cart) => (cart as { count: number }).count === 0);

    expect(isEmpty.inputs).toEqual(['cart']);
    expect(isEmpty.run({ count: 0 })).toBe(true);
    expect(isEmpty.run({ count: 2 })).toBe(false);
  });

  it('reconciles compiled template stamps with keyed item descriptors', () => {
    const root = new FakeMorphRoot();
    const list = new FakeTemplateStampHost({
      'data-bind-list': 'cart.items',
      'fw-key': 'productId',
    });
    root.planElements.push(list);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      {
        items: [
          { name: 'Mug', productId: 'p1', qty: 2 },
          { name: 'Beans', productId: 'p2', qty: 1 },
        ],
      },
      {
        bindings: false,
        templateStamps: [
          {
            key: 'productId',
            list: 'items',
            render(item) {
              const product = item as { name: string; qty: number };
              return `<li><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: [],
      templateStamps: ['[data-bind-list="cart.items"]'],
    });
    expect(list.items.map((item) => item.key)).toEqual(['p1', 'p2']);
    expect(list.items.map((item) => item.index)).toEqual([0, 1]);
    expect(list.textContent).toBe(
      '<li><span data-bind=".qty">2</span> x <span data-bind=".name">Mug</span></li><li><span data-bind=".qty">1</span> x <span data-bind=".name">Beans</span></li>',
    );
  });

  it('applies mutation query chunks through compiled update plans before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
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

    expect(observed).toEqual(['morph:5:5 items:5']);
  });

  it('lets mutation DOM apply interpose query writes before compiled plans run', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const observedQueries: string[] = [];
    root.bindings.push(count);

    const result = applyMutationResponseToDom({
      applyQuery(query) {
        observedQueries.push(`${query.name}:${query.key ?? ''}`);
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      body: '<fw-query name="cart">{"count":5}</fw-query>',
      queryPlans: { cart: { bindings: true } },
      root,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(observedQueries).toEqual(['cart:']);
    expect(store.get('cart')).toEqual({ count: 15 });
    expect(count.textContent).toBe('15');
  });

  it('applies deferred stream chunks through the same query and fragment parser', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.subscribe('reviews', plan, 'product:p1');

    const body = [
      '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
      '<fw-fragment target="reviews:p1"><section fw-c="reviews">Ready</section></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1', rating: 5 }] });
    expect(plan).toHaveBeenCalledWith({ items: [{ id: 'r1', rating: 5 }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section fw-c="reviews">Ready</section>', target: 'reviews:p1' }],
      queries: ['reviews:product:p1'],
    });
  });

  it('skips malformed deferred query chunks while applying valid fragments', () => {
    const store = createQueryStore();
    const body = [
      '<fw-query name="reviews">{</fw-query>',
      '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
      '<fw-fragment target="reviews:p1"><section>Ready</section></fw-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('recommendations')).toEqual({ items: [{ id: 'p2' }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section>Ready</section>', target: 'reviews:p1' }],
      queries: ['recommendations'],
    });
  });

  it('keeps keyed query chunks isolated by instance key', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', p1Plan, 'product:p1');
    store.subscribe('reviews', p2Plan, 'product:p2');
    store.subscribe('reviews', unkeyedPlan);

    const body = [
      '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
      '<fw-query name="reviews" key="product:p2">{"items":[{"id":"r2"}]}</fw-query>',
    ].join('\n');
    applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(store.get('reviews', 'product:p2')).toEqual({ items: [{ id: 'r2' }] });
    expect(p1Plan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(p2Plan).toHaveBeenCalledWith({ items: [{ id: 'r2' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('updates deferred query data before morphing deferred fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`plan:${JSON.stringify(value)}`);
    });

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`morph:${JSON.stringify(store.get('reviews'))}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['plan:{"items":[{"id":"r1"}]}', 'morph:{"items":[{"id":"r1"}]}']);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1'],
      fragments: [
        {
          html: '<link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section>',
          target: 'reviews:p1',
        },
      ],
      queries: ['reviews'],
    });
    expect(root.targets.get('reviews:p1')?.html).toContain('/assets/reviews.css');
  });

  it('applies full deferred stream responses in boundary order', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    const reviewsSummary = new FakeQueryPlanElement({ 'data-derive': 'reviews.summary' });
    const recommendationsHost = new FakeQueryPlanElement({ 'data-plan': 'recommendations-host' });
    root.planElements.push(reviewsSummary, recommendationsHost);
    root.targets.set('reviews:p1', new FakeMorphTarget());
    root.targets.set('recommendations:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`reviews-plan:${JSON.stringify(value)}`);
    });
    store.subscribe('recommendations', (value) => {
      observed.push(`recommendations-plan:${JSON.stringify(value)}`);
    });

    const result = applyDeferredStreamResponseToRuntime({
      body: [
        '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
        '<fw-fragment target="recommendations:p1"><section>Recommendations ready</section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${html}:${reviewsSummary.textContent}:${recommendationsHost.getAttribute(
            'data-count',
          )}:${JSON.stringify({
            recommendations: store.get('recommendations'),
            reviews: store.get('reviews'),
          })}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        recommendations: {
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="recommendations-host"]',
              select: (value) => (value as { items: unknown[] }).items.length,
            },
          ],
        },
        reviews: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { items: unknown[] }).items.length} review`,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual([
      'reviews-plan:{"items":[{"id":"r1"}]}',
      'morph:<section>Reviews ready</section>:1 review:null:{"reviews":{"items":[{"id":"r1"}]}}',
      'recommendations-plan:{"items":[{"id":"p2"}]}',
      'morph:<section>Recommendations ready</section>:1 review:1:{"recommendations":{"items":[{"id":"p2"}]},"reviews":{"items":[{"id":"r1"}]}}',
    ]);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1', 'recommendations:p1'],
      chunks: [
        {
          appliedFragments: ['reviews:p1'],
          fragments: [{ html: '<section>Reviews ready</section>', target: 'reviews:p1' }],
          queries: ['reviews'],
        },
        {
          appliedFragments: ['recommendations:p1'],
          fragments: [
            {
              html: '<section>Recommendations ready</section>',
              target: 'recommendations:p1',
            },
          ],
          queries: ['recommendations'],
        },
      ],
      fragments: [
        { html: '<section>Reviews ready</section>', target: 'reviews:p1' },
        { html: '<section>Recommendations ready</section>', target: 'recommendations:p1' },
      ],
      queries: ['reviews', 'recommendations'],
    });
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
    expect(root.targets.get('recommendations:p1')?.html).toBe(
      '<section>Recommendations ready</section>',
    );
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({ channel, onChanges, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ] as never);
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":6}</fw-query>',
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('rebroadcasts keyed query chunks to the matching keyed store entry', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const keyedPlan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', keyedPlan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);
    installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
        changes: [{ domain: 'product', keys: ['p1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(keyedPlan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('morphs rebroadcast mutation fragments when a root is configured', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

    installMutationBroadcast({
      channel,
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}`);
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
        },
      },
      root,
      store,
    });

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":6}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>6</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(observed).toEqual(['morph:6:6 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>6</cart-badge>');
  });

  it('syncs mutation responses from one tab to another over BroadcastChannel', () => {
    const hub = new FakeBroadcastHub();
    const channelA = new FakeBroadcastChannel(hub);
    const channelB = new FakeBroadcastChannel(hub);
    const storeA = createQueryStore();
    const storeB = createQueryStore();
    const onChangesA = vi.fn();
    const onChangesB = vi.fn();
    const rootB = new FakeMorphRoot();
    rootB.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>1</cart-badge>'));

    const broadcastA = installMutationBroadcast({
      channel: channelA,
      onChanges: onChangesA,
      store: storeA,
    });
    installMutationBroadcast({
      channel: channelB,
      onChanges: onChangesB,
      root: rootB,
      store: storeB,
    });

    broadcastA.publish(
      [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
      ].join('\n'),
      [{ domain: 'cart', keys: ['cart_1'] }],
    );

    expect(channelA.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":5}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(channelB.messages).toEqual([]);
    expect(storeA.get('cart')).toBeUndefined();
    expect(onChangesA).not.toHaveBeenCalled();
    expect(storeB.get('cart')).toEqual({ count: 5 });
    expect(rootB.targets.get('cart-badge')?.html).toBe('<cart-badge>5</cart-badge>');
    expect(onChangesB).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('updates query data and morphs fragments from one mutation response', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">7</span></cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [
        {
          html: '<cart-badge><span data-bind="cart.count">7</span></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(root.targets.get('cart-badge')?.html).toContain('data-bind="cart.count"');
  });

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
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
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
