import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLoaderQueryRuntime } from './loader-query.js';
import { createQueryStore } from './query-store.js';
import { FakeRoot } from './runtime-test-fakes.js';

describe('loader query runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hydrates scripts and inline query events through the same loader query seam', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const cartPlan = vi.fn();
    const inventoryPlan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'kovo-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', cartPlan);
    store.subscribe('inventory', inventoryPlan);

    const runtime = installLoaderQueryRuntime({ queryStore: store, root });
    void root.listeners.get('kovo:query')?.({
      detail: {
        queries: [{ attrs: ' name="inventory"', content: '{"available":true}' }],
      },
    } as never);

    // SPEC.md §4.4/§9.4: loader-owned script hydration and inline query
    // events share one query runtime owner rather than separate loader cases.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('inventory')).toEqual({ available: true });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(inventoryPlan).toHaveBeenCalledWith({ available: true });

    runtime.dispose();
    expect(root.listeners.has('kovo:query')).toBe(false);
  });

  it('threads loader query hydration errors through the runtime context reporter', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const onError = vi.fn();

    installLoaderQueryRuntime({ onError, queryStore: store, root });
    void root.listeners.get('kovo:query')?.({
      detail: {
        queries: [{ attrs: ' name="cart"', content: '{' }],
      },
    } as never);

    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('remembers applied mutation queries for visible-return refetch', async () => {
    const root = new FakeRoot();
    const refetchOnFocus = vi.fn();
    const runtime = installLoaderQueryRuntime({ refetchOnFocus, root });

    runtime.rememberAppliedQueries(['cart']);
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: mutation query applications feed the same
    // visible-return ledger as hydrated query scripts.
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);

    runtime.dispose();
    expect(root.listeners.has('visibilitychange')).toBe(false);
  });

  it('scopes clock scheduling to each loader root and cleans up its listeners', () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const firstRoot = new FakeRoot();
    const secondRoot = new FakeRoot();
    const firstUpdates: number[] = [];
    const secondUpdates: number[] = [];

    const firstRuntime = installLoaderQueryRuntime({
      clockUpdatePlans: [
        {
          clocks: { first: { every: '1s' } },
          update(_root, now) {
            firstUpdates.push(now.first?.getTime() ?? 0);
          },
        },
      ],
      root: firstRoot,
    });
    const secondRuntime = installLoaderQueryRuntime({
      clockUpdatePlans: [
        {
          clocks: { second: { every: '1s' } },
          update(_root, now) {
            secondUpdates.push(now.second?.getTime() ?? 0);
          },
        },
      ],
      root: secondRoot,
    });

    while (frames.length > 0) frames.shift()?.(Date.now());
    expect(firstUpdates).toEqual([20_000]);
    expect(secondUpdates).toEqual([20_000]);

    firstRoot.visibilityState = 'hidden';
    firstRoot.listeners.get('visibilitychange')?.({
      target: firstRoot,
      type: 'visibilitychange',
    });
    expect(frames).toHaveLength(0);

    secondRoot.listeners.get('visibilitychange')?.({
      target: secondRoot,
      type: 'visibilitychange',
    });
    expect(frames).toHaveLength(1);
    vi.setSystemTime(21_000);
    frames.shift()?.(21_000);
    expect(firstUpdates).toEqual([20_000]);
    expect(secondUpdates).toEqual([20_000, 21_000]);

    firstRuntime.dispose();
    expect(firstRoot.listeners.has('visibilitychange')).toBe(false);
    expect(secondRoot.listeners.has('visibilitychange')).toBe(true);

    secondRuntime.dispose();
    expect(secondRoot.listeners.has('visibilitychange')).toBe(false);
  });
});
