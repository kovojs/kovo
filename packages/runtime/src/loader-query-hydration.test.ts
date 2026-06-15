import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';
import { FakeRoot } from './runtime-test-fakes.js';

describe('loader query hydration', () => {
  it('hydrates initial fw-query scripts into the configured query store', () => {
    // SPEC.md §9.4: server-rendered query snapshots hydrate through the runtime query store.
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ importModule: vi.fn(), queryStore: store, root });

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('ignores malformed initial fw-query scripts without aborting loader install', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const importModule = vi.fn();
    const onError = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{"available":true}',
      },
    ];

    installJisoLoader({ importModule, onError, queryStore: store, root });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect([...root.listeners.keys()]).toEqual([
      'click',
      'submit',
      'input',
      'change',
      'keydown',
      'keyup',
      'contextmenu',
      'paste',
      'cancel',
      'beforetoggle',
      'animationend',
      'scroll',
      'focus',
      'blur',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerover',
      'pointerout',
      'jiso:query',
    ]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('retries malformed initial fw-query scripts before visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const cartPlan = vi.fn();
    const script = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{',
    };

    root.scripts = [script];
    store.subscribe('cart', cartPlan);

    installJisoLoader({
      importModule: vi.fn(),
      onError,
      queryStore: store,
      refetchOnFocus,
      root,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });

    script.textContent = '{"count":2}';
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: visible-return hydration retries transiently
    // malformed server query data through the same query-store apply path.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
