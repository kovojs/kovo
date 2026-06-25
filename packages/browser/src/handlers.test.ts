import { describe, expect, it, vi } from 'vitest';

import * as runtime from './client.js';
import { dispatchDelegatedEvent } from './handlers.js';
import { FakeElement, FakeStatefulBindingElement } from './runtime-test-fakes.js';

describe('delegated handler reference dispatch', () => {
  it('imports and invokes a url#export handler only when a matching event arrives', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'data-p-item-id': 'i_42',
      'data-p-quantity': '2',
      'kovo-param-types': 'quantity:number',
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

  it('keeps handler reference parsing private to dispatch', async () => {
    const calls: string[] = [];
    const remove = vi.fn(() => {
      calls.push('remove');
    });
    const sync = vi.fn(() => {
      calls.push('sync');
    });
    const importModule = vi.fn(async (url: string) => {
      if (url === '/c/cart.client.js?v=1') return { Cart$remove: remove };
      return { Cart$sync: sync };
    });
    const element = new FakeElement({
      'on:click': '/c/cart.client.js?v=1#Cart$remove  /c/cart.client.js?v=2#Cart$sync',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    // SPEC.md §4.4/§4.7: url#export handler refs are loader internals, not a
    // public parser API; dispatch remains the only runtime behavior surface.
    expect(Object.hasOwn(runtime, 'parseHandlerReference')).toBe(false);
    expect(Object.hasOwn(runtime, 'parseHandlerReferences')).toBe(false);
    expect(importModule).toHaveBeenNthCalledWith(1, '/c/cart.client.js?v=1');
    expect(importModule).toHaveBeenNthCalledWith(2, '/c/cart.client.js?v=2');
    expect(calls).toEqual(['remove', 'sync']);
  });

  it('rejects malformed handler references through delegated dispatch', async () => {
    const element = new FakeElement({ 'on:click': '/c/cart.client.js#' });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, vi.fn()),
    ).rejects.toThrow('Invalid handler reference: /c/cart.client.js#');
  });

  it('rejects non-Kovo dynamic import URLs before importing handler modules', async () => {
    const importModule = vi.fn(async () => ({ missing: vi.fn() }));
    const element = new FakeElement({
      'on:click': 'data:text/javascript,export%20const%20missing%20=%201#missing',
    });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, importModule),
    ).rejects.toThrow('Disallowed Kovo dynamic import URL: data:text/javascript');
    expect(importModule).not.toHaveBeenCalled();
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
      'kovo-state': '{"count":1}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenNthCalledWith(1, '/c/a.js');
    expect(importModule).toHaveBeenNthCalledWith(2, '/c/b.js');
    expect(calls).toEqual(['first:1:false', 'second:2:false']);
    expect(element.getAttribute('kovo-state')).toBe('{"count":3}');
  });

  it('applies state bindings from the final state after chained handlers run', async () => {
    const host = new FakeStatefulBindingElement({
      'kovo-state': '{"count":1}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });
    const output = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: host, textContent: '1' },
    );
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const second = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) => (url === '/c/a.js' ? { first } : { second }));

    await dispatchDelegatedEvent({ target: host, type: 'click' }, importModule);

    expect(host.getAttribute('kovo-state')).toBe('{"count":3}');
    expect(output.textContent).toBe('3');
  });

  it('drains post-commit callbacks after the async derive binding flush (SPEC §4.3)', async () => {
    // Reproduces the menu focus race: a derive `data-bind` reveals content via
    // an awaited dynamic import (a later microtask). A callback scheduled during
    // the handler through the runtime post-commit hook must run only AFTER that
    // flush, otherwise focus would land while the target is still hidden.
    const order: string[] = [];
    const host = new FakeStatefulBindingElement({
      'kovo-state': '{"open":false}',
      'on:click': '/c/menu.js#open',
    });
    // A derive-style binding: `url#exportName` is resolved via importModule and
    // its derive.run() writes the revealed value, recording the flush ordering.
    new FakeStatefulBindingElement(
      { 'data-bind': '/c/menu.js#hiddenDerive' },
      { parent: host, textContent: '' },
    );

    const open = vi.fn((_event, ctx: { state: { open: boolean } }) => {
      ctx.state.open = true;
      // The primitive's default scheduler routes through this global hook.
      const schedule = (globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void })
        .__kovo_postCommitSchedule;
      expect(typeof schedule).toBe('function');
      schedule?.(() => {
        order.push('post-commit-focus');
      });
    });
    const hiddenDerive = {
      run() {
        order.push('derive-flush');
        return 'revealed';
      },
    };
    const importModule = vi.fn(async () => {
      // Resolve on a later microtask, like a real dynamic import.
      await Promise.resolve();
      return { open, hiddenDerive };
    });

    await dispatchDelegatedEvent({ target: host, type: 'click' }, importModule);

    // The deferred focus runs strictly after the binding/derive flush.
    expect(order).toEqual(['derive-flush', 'post-commit-focus']);
    // The global hook is cleaned up after dispatch (no leak across dispatches).
    expect(
      (globalThis as { __kovo_postCommitSchedule?: unknown }).__kovo_postCommitSchedule,
    ).toBeUndefined();
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
      'kovo-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(calls).toEqual([0, 1]);
    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
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
      'kovo-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });
    const secondElement = new FakeElement({
      'kovo-state': '{"count":10}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: firstElement, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: secondElement, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

    expect(handler).toHaveBeenCalledTimes(2);
    await second;
    expect(secondElement.getAttribute('kovo-state')).toBe('{"count":11}');

    releaseFirst?.();
    await first;
    expect(firstElement.getAttribute('kovo-state')).toBe('{"count":1}');
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
      'kovo-state': '{"count":0}',
      'on:click': '/c/fail.client.js#first',
    });

    const failed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    element.setAttribute('on:click', '/c/pass.client.js#second');
    const passed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    releaseFirst?.();
    await expect(failed).rejects.toThrow('boom');
    await passed;

    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
  });

  it('hydrates serialized island state for delegated handlers', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'kovo-state': '{"bouncing":false,"count":2}',
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
      'kovo-state': '{"count":2}',
      'on:click': '/c/counter.client.js#Counter$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(element.getAttribute('kovo-state')).toBe('{"count":3}');
  });

  it('persists delegated handler state before reporting a later handler failure', async () => {
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) => (url === '/c/a.js' ? { first } : {}));
    const element = new FakeElement({
      'kovo-state': '{"count":2}',
      'on:click': '/c/a.js#first /c/b.js#missing',
    });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, importModule),
    ).rejects.toThrow('Handler export not found: /c/b.js#missing');

    expect(element.getAttribute('kovo-state')).toBe('{"count":3}');
  });
});
