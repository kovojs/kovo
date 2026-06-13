import { describe, expect, it, vi } from 'vitest';

import {
  abortRemovedIslandSignals,
  applyMutationResponseToDom,
  createQueryStore,
  dispatchDelegatedEvent,
  installJisoLoader,
  parseHandlerReference,
  parseHandlerReferences,
} from './index.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handler-context.js';
import {
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeRoot,
} from './runtime-test-fakes.js';

describe('delegated runtime integration', () => {
  it('imports and invokes a url#export handler only when a matching event arrives', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'data-p-item-id': 'i_42',
      'data-p-quantity': '2',
      'fw-param-types': 'quantity:number',
      'on:click': '/c/cart-badge.client.js#CartBadge$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenCalledWith('/c/cart-badge.client.js');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
      expect.objectContaining({
        params: { itemId: 'i_42', quantity: 2 },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('invokes chained handler refs left-to-right with one context and persisted state', async () => {
    const calls: string[] = [];
    const first = vi.fn((_event, ctx: { signal: AbortSignal; state: { count: number } }) => {
      calls.push(`first:${ctx.state.count}:${ctx.signal.aborted}`);
      ctx.state.count += 1;
    });
    const second = vi.fn((_event, ctx: { signal: AbortSignal; state: { count: number } }) => {
      calls.push(`second:${ctx.state.count}:${ctx.signal.aborted}`);
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) => (url === '/c/a.js' ? { first } : { second }));
    const element = new FakeElement({
      'fw-state': '{"count":1}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenNthCalledWith(1, '/c/a.js');
    expect(importModule).toHaveBeenNthCalledWith(2, '/c/b.js');
    expect(calls).toEqual(['first:1:false', 'second:2:false']);
    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('serializes overlapping delegated state writes for the same island', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: number[] = [];
    const handler = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      calls.push(ctx.state.count);
      if (calls.length === 1) {
        await firstCanFinish;
      }
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ increment: handler }));
    const element = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(calls).toEqual([0, 1]);
    expect(element.getAttribute('fw-state')).toBe('{"count":2}');
  });

  it('does not serialize delegated state writes across different islands', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handler = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      if (ctx.state.count === 0) {
        await firstCanFinish;
      }
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ increment: handler }));
    const firstElement = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });
    const secondElement = new FakeElement({
      'fw-state': '{"count":10}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: firstElement, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: secondElement, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

    expect(handler).toHaveBeenCalledTimes(2);
    await second;
    expect(secondElement.getAttribute('fw-state')).toBe('{"count":11}');

    releaseFirst?.();
    await first;
    expect(firstElement.getAttribute('fw-state')).toBe('{"count":1}');
  });

  it('continues the delegated state queue after a handler rejects', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
      await firstCanFinish;
      throw new Error('boom');
    });
    const second = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) =>
      url === '/c/fail.client.js' ? { first } : { second },
    );
    const element = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/fail.client.js#first',
    });

    const failed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    element.setAttribute('on:click', '/c/pass.client.js#second');
    const passed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    releaseFirst?.();
    await expect(failed).rejects.toThrow('boom');
    await passed;

    expect(element.getAttribute('fw-state')).toBe('{"count":2}');
  });

  it('scopes ctx.signal to the island and aborts when fragment morph removes it', async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
    });
    const importModule = vi.fn(async () => ({ CartFilter$mount: handler }));
    const element = new FakeElement({
      'fw-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);
    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);

    expect(
      abortRemovedIslandSignals(
        '<section><cart-filter fw-c="cart-filter"></cart-filter></section>',
        '<section></section>',
      ),
    ).toEqual(['cart-filter']);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('honors explicit abort scopes while a delegated handler runs in another scope', async () => {
    const activeScope = createIslandSignalScope();
    const explicitScope = createIslandSignalScope();
    const activeSignals: AbortSignal[] = [];
    const explicitSignals: AbortSignal[] = [];
    const explicitElement = new FakeElement({
      'fw-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#mount',
    });
    const activeElement = new FakeElement({
      'fw-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#mount',
    });
    const importModule = vi.fn(async () => ({
      mount: (_event: Event, ctx: { signal: AbortSignal }) => {
        explicitSignals.push(ctx.signal);
      },
    }));
    const scopedImportModule = vi.fn(async () => ({
      mount: (_event: Event, ctx: { signal: AbortSignal }) => {
        activeSignals.push(ctx.signal);
        abortRemovedIslandSignals(
          '<section><cart-filter fw-c="cart-filter"></cart-filter></section>',
          '<section></section>',
          explicitScope,
        );
      },
    }));

    try {
      await dispatchDelegatedEvent(
        { target: explicitElement, type: 'visible' },
        importModule,
        explicitScope,
      );
      await dispatchDelegatedEvent(
        { target: activeElement, type: 'visible' },
        scopedImportModule,
        activeScope,
      );

      expect(explicitSignals).toHaveLength(1);
      expect(activeSignals).toHaveLength(1);
      expect(explicitSignals[0]).not.toBe(activeSignals[0]);
      expect(explicitSignals[0]?.aborted).toBe(true);
      expect(activeSignals[0]?.aborted).toBe(false);
    } finally {
      abortIslandSignalScope(activeScope);
      abortIslandSignalScope(explicitScope);
    }
  });

  it('keeps island ctx.signals isolated per loader install and aborts on dispose', async () => {
    const firstRoot = new FakeRoot();
    const secondRoot = new FakeRoot();
    const firstSignals: AbortSignal[] = [];
    const secondSignals: AbortSignal[] = [];
    const firstHandler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      firstSignals.push(ctx.signal);
    });
    const secondHandler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      secondSignals.push(ctx.signal);
    });
    const firstLoader = installJisoLoader({
      importModule: vi.fn(async () => ({ mount: firstHandler })),
      root: firstRoot,
    });
    const secondLoader = installJisoLoader({
      importModule: vi.fn(async () => ({ mount: secondHandler })),
      root: secondRoot,
    });
    const firstElement = new FakeElement({
      'fw-c': 'cart-filter',
      'on:click': '/c/cart-filter.client.js#mount',
    });
    const secondElement = new FakeElement({
      'fw-c': 'cart-filter',
      'on:click': '/c/cart-filter.client.js#mount',
    });

    await firstRoot.listeners.get('click')?.({ target: firstElement, type: 'click' });
    await secondRoot.listeners.get('click')?.({ target: secondElement, type: 'click' });
    const firstClickListener = firstRoot.listeners.get('click');

    expect(firstSignals).toHaveLength(1);
    expect(secondSignals).toHaveLength(1);
    expect(firstSignals[0]).not.toBe(secondSignals[0]);

    firstLoader.dispose();

    expect(firstSignals[0]?.aborted).toBe(true);
    expect(secondSignals[0]?.aborted).toBe(false);

    // SPEC §4.7: ctx.signal is the island lifecycle primitive and must be fresh after teardown.
    await firstClickListener?.({ target: firstElement, type: 'click' });
    expect(firstSignals).toHaveLength(2);
    expect(firstSignals[1]).not.toBe(firstSignals[0]);
    expect(firstSignals[1]?.aborted).toBe(false);

    secondLoader.dispose();
  });

  it('aborts loader-scoped island signals when enhanced fragments remove the island', async () => {
    let signal: AbortSignal | undefined;
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const element = new FakeElement({
      'fw-c': 'cart-filter',
      'on:click': '/c/cart-filter.client.js#mount',
    });
    const form = new FakeFormElement(
      { enhance: '' },
      {
        action: '/_m/cart/filter',
        method: 'post',
      },
    );
    mutationRoot.targets.set(
      'cart-shell',
      new FakeMorphTarget('<section><cart-filter fw-c="cart-filter"></cart-filter></section>'),
    );
    const loader = installJisoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => ({
          headers: {
            get() {
              return null;
            },
          },
          async text() {
            return '<fw-fragment target="cart-shell"><section></section></fw-fragment>';
          },
        })),
        formData: () => new FormData(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(async () => ({
        mount: vi.fn((_event, ctx: { signal: AbortSignal }) => {
          signal = ctx.signal;
        }),
      })),
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('click')?.({ target: element, type: 'click' });
    expect(signal?.aborted).toBe(false);

    await loaderRoot.listeners.get('submit')?.({
      preventDefault: vi.fn(),
      target: form,
      type: 'submit',
    });

    expect(signal?.aborted).toBe(true);
    loader.dispose();
  });

  it('keeps ctx.signal alive when fragment morph preserves the island identity', async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
    });
    const importModule = vi.fn(async () => ({ CartFilter$mount: handler }));
    const element = new FakeElement({
      'fw-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);

    expect(
      abortRemovedIslandSignals(
        '<section><cart-filter fw-c="cart-filter"></cart-filter></section>',
        '<section><cart-filter fw-c="cart-filter">Updated</cart-filter></section>',
      ),
    ).toEqual([]);
    expect(signals[0]?.aborted).toBe(false);

    abortRemovedIslandSignals(
      '<section><cart-filter fw-c="cart-filter"></cart-filter></section>',
      '<section></section>',
    );
  });

  it('aborts removed island ctx.signal during fragment application', async () => {
    let signal: AbortSignal | undefined;
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signal = ctx.signal;
    });
    const importModule = vi.fn(async () => ({ CartFilter$mount: handler }));
    const element = new FakeElement({
      'fw-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });
    const root = new FakeMorphRoot();
    root.targets.set(
      'cart-shell',
      new FakeMorphTarget('<section><cart-filter fw-c="cart-filter"></cart-filter></section>'),
    );

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);
    expect(signal?.aborted).toBe(false);

    applyMutationResponseToDom({
      body: '<fw-fragment target="cart-shell"><section></section></fw-fragment>',
      root,
      store: createQueryStore(),
    });

    expect(signal?.aborted).toBe(true);
  });

  it('keeps repeated keyed island ctx.signals independent', async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
    });
    const importModule = vi.fn(async () => ({ CartRow$mount: handler }));
    const first = new FakeElement({
      'fw-c': 'cart-row',
      'fw-key': 'row-1',
      'on:visible': '/c/cart-row.client.js#CartRow$mount',
    });
    const second = new FakeElement({
      'fw-c': 'cart-row',
      'fw-key': 'row-2',
      'on:visible': '/c/cart-row.client.js#CartRow$mount',
    });

    await dispatchDelegatedEvent({ target: first, type: 'visible' }, importModule);
    await dispatchDelegatedEvent({ target: second, type: 'visible' }, importModule);

    expect(signals[0]).not.toBe(signals[1]);

    expect(
      abortRemovedIslandSignals(
        [
          '<ol>',
          '<li fw-c="cart-row" fw-key="row-1"></li>',
          '<li fw-c="cart-row" fw-key="row-2"></li>',
          '</ol>',
        ].join(''),
        '<ol><li fw-c="cart-row" fw-key="row-2"></li></ol>',
      ),
    ).toEqual(['cart-row\u0000row-1']);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    abortRemovedIslandSignals('<li fw-c="cart-row" fw-key="row-2"></li>', '');
  });

  it('hydrates serialized island state for delegated handlers', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'fw-state': '{"bouncing":false,"count":2}',
      'on:click': '/c/cart-badge.client.js#CartBadge$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'click' }),
      expect.objectContaining({ state: { bouncing: false, count: 2 } }),
    );
  });

  it('persists handler state mutations back to the island host', async () => {
    const handler = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ Counter$button_click: handler }));
    const element = new FakeElement({
      'fw-state': '{"count":2}',
      'on:click': '/c/counter.client.js#Counter$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('persists delegated handler state before reporting a later handler failure', async () => {
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) => (url === '/c/a.js' ? { first } : {}));
    const element = new FakeElement({
      'fw-state': '{"count":2}',
      'on:click': '/c/a.js#first /c/b.js#missing',
    });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, importModule),
    ).rejects.toThrow('Handler export not found: /c/b.js#missing');

    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('reports delegated loader failures through the loader error hook', async () => {
    const loaderRoot = new FakeRoot();
    const onError = vi.fn();
    const element = new FakeElement({
      'on:click': '/c/cart-badge.client.js#missing',
    });

    installJisoLoader({
      importModule: vi.fn(async () => ({})),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('click')?.({
        target: element,
        type: 'click',
      }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      event: { target: element, type: 'click' },
      phase: 'delegated-event',
    });
  });

  it('parses full handler references', () => {
    expect(parseHandlerReference('/c/cart.client.js?v=1#Cart$remove')).toEqual({
      exportName: 'Cart$remove',
      url: '/c/cart.client.js?v=1',
    });
    expect(parseHandlerReferences('/a.js#one  /b.js#two\n/c.js#three')).toEqual([
      '/a.js#one',
      '/b.js#two',
      '/c.js#three',
    ]);
  });
});
