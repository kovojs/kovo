import { describe, expect, it, vi } from 'vitest';

import { createIslandSignalScope } from './handler-context.js';
import {
  addLoaderListener,
  installDelegatedEventLifecycle,
  installExecutionTriggers,
} from './loader-lifecycle.js';
import { createQueryStore } from './query-store.js';
import { FakeElement, FakeFormElement, FakeRoot } from './runtime-test-fakes.js';

describe('loader lifecycle', () => {
  it('registers loader listeners with matching disposer options', () => {
    const root = new FakeRoot();
    const listener = vi.fn();
    const disposers: Array<() => void> = [];

    addLoaderListener(root, 'click', listener, disposers, { capture: true });

    expect(root.listeners.get('click')).toBe(listener);
    disposers[0]?.();
    expect(root.listeners.has('click')).toBe(false);
  });

  it('routes delegated event failures through the delegated lifecycle phase', async () => {
    const root = new FakeRoot();
    const element = new FakeElement({ 'on:click': '/c/cart.js#missing' });
    const importModule = vi.fn(async () => ({}));
    const onError = vi.fn();

    const dispose = installDelegatedEventLifecycle({
      events: ['click'],
      importModule,
      islandSignalScope: createIslandSignalScope(),
      onError,
      root,
    });

    await root.listeners.get('click')?.({ target: element, type: 'click' });

    expect(importModule).toHaveBeenCalledWith('/c/cart.js');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      event: expect.objectContaining({ type: 'click' }),
      phase: 'delegated-event',
    });

    dispose();
    expect(root.listeners.has('click')).toBe(false);
  });

  it('intercepts enhanced submits without falling through to delegated handlers', async () => {
    // SPEC.md section 9.1: enhanced mutations own submitted forms before normal on:* dispatch.
    const root = new FakeRoot();
    const form = new FakeFormElement(
      {
        enhance: '',
        'on:submit': '/c/cart.js#submit',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const fetchError = new Error('offline');
    const fetch = vi.fn(async () => {
      throw fetchError;
    });
    const importModule = vi.fn(async () => ({ submit: vi.fn() }));
    const onError = vi.fn();
    const preventDefault = vi.fn();

    installDelegatedEventLifecycle({
      enhancedMutations: {
        fetch,
        formData: () => new URLSearchParams([['sku', 'sku_1']]),
        root: root as never,
        store: createQueryStore(),
      },
      events: ['submit'],
      importModule,
      islandSignalScope: createIslandSignalScope(),
      onError,
      root,
    });

    await root.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', expect.objectContaining({ method: 'POST' }));
    expect(form.submitted).toBe(true);
    expect(importModule).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(fetchError, {
      event: expect.objectContaining({ type: 'submit' }),
      phase: 'enhanced-mutation',
    });
  });

  it('does not run idle handler after dispose (K5 post-dispose guard)', async () => {
    // K5: a queued idle callback that fires after dispose() must not import or run
    // the handler module — the loader is already torn down.
    const root = new FakeRoot();
    const idleElement = new FakeElement({ 'on:idle': '/c/idle.js#warm' });
    const idleCallbacks: Array<() => void> = [];
    const importModule = vi.fn(async () => ({ warm: vi.fn() }));

    root.elements.set('[on\\:idle]', [idleElement]);

    const dispose = installExecutionTriggers(
      {
        importModule,
        requestIdle: (callback) => {
          idleCallbacks.push(callback);
        },
        root,
      },
      createIslandSignalScope(),
    );

    // dispose before the queued idle callback fires
    dispose();
    idleCallbacks[0]?.();

    // handler module must never be imported
    await Promise.resolve(); // flush microtasks
    expect(importModule).not.toHaveBeenCalled();
  });

  it('installs declared load, idle, and visible execution triggers', async () => {
    // SPEC.md section 4.4: execution triggers are part of the always-loaded runtime path.
    const root = new FakeRoot();
    const loadElement = new FakeElement({ 'on:load': '/c/load.js#start' });
    const idleElement = new FakeElement({ 'on:idle': '/c/idle.js#warm' });
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const idleCallbacks: Array<() => void> = [];
    let visibleCallback: (
      entries: { isIntersecting: boolean; target: FakeElement }[],
    ) => void = () => {};
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const handlers = {
      mount: vi.fn(),
      start: vi.fn(),
      warm: vi.fn(),
    };
    const importModule = vi.fn(async (url: string) => {
      if (url === '/c/load.js') return { start: handlers.start };
      if (url === '/c/idle.js') return { warm: handlers.warm };
      return { mount: handlers.mount };
    });

    root.elements.set('[on\\:load]', [loadElement]);
    root.elements.set('[on\\:idle]', [idleElement]);
    root.elements.set('[on\\:visible]', [visibleElement]);

    const dispose = installExecutionTriggers(
      {
        importModule,
        requestIdle: (callback) => {
          idleCallbacks.push(callback);
        },
        root,
        visibleObserver: (callback) => {
          visibleCallback = callback as typeof visibleCallback;
          return observer;
        },
      },
      createIslandSignalScope(),
    );

    await vi.waitFor(() => expect(handlers.start).toHaveBeenCalledTimes(1));
    expect(handlers.warm).not.toHaveBeenCalled();
    idleCallbacks[0]?.();
    await vi.waitFor(() => expect(handlers.warm).toHaveBeenCalledTimes(1));

    expect(observer.observe).toHaveBeenCalledWith(visibleElement);
    visibleCallback([{ isIntersecting: false, target: visibleElement }]);
    expect(handlers.mount).not.toHaveBeenCalled();
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    await vi.waitFor(() => expect(handlers.mount).toHaveBeenCalledTimes(1));
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
    expect(handlers.mount).toHaveBeenCalledTimes(1);

    dispose();
    expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
  });
});
