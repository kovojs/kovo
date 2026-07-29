import { afterAll, describe, expect, it, vi } from 'vitest';

import * as runtime from './generated.js';
import { dispatchDelegatedEvent, handler, securityHandler } from './handlers.js';
import type { HandlerContext } from './handler-context.js';
import {
  FakeElement,
  FakeStatefulBindingElement,
  installTestClientModuleManifest,
} from './runtime-test-fakes.js';

const restoreClientModuleManifest = installTestClientModuleManifest([
  '/c/a.js',
  '/c/b.js',
  '/c/cart-badge.client.js',
  '/c/cart.client.js',
  '/c/cart.client.js?v=1',
  '/c/cart.client.js?v=2',
  '/c/counter.client.js',
  '/c/fail.client.js',
  '/c/menu.js',
  '/c/pass.client.js',
]);
afterAll(restoreClientModuleManifest);

// SPEC §4.3: the authoring helper rejects promise-like and value-returning implementations even
// though TypeScript intentionally permits those shapes when assigning directly to a void callback.
if (false) {
  const sync = (_event: Event, _ctx: HandlerContext<unknown>) => {};
  handler(sync);
  handler<{ count: number }>((_event, ctx) => {
    ctx.state.count += 1;
  });
  // @ts-expect-error Browser handlers cannot create an async continuation.
  handler(async () => {});
  // @ts-expect-error Explicit state typing must not reopen async handler returns.
  handler<{ count: number }>(async () => {});
  // @ts-expect-error A directly returned promise is asynchronous even without async syntax.
  handler(() => Promise.resolve());
  const maybeAsync = (): void | Promise<void> => {};
  // @ts-expect-error Maybe-async implementations are not synchronous handler proofs.
  handler(maybeAsync);
  // @ts-expect-error Browser handler outcomes are discarded and must remain void.
  handler(() => 1);
}

describe('generated finite security-operation manifest', () => {
  const invokeGeneratedHandler = (operations: unknown) =>
    Reflect.apply(securityHandler, undefined, [operations, vi.fn()]);

  it('accepts an exact compiler-owned browser operation and preserves handler identity', () => {
    const implementation = vi.fn();
    const operation = Object.freeze({
      door: 'compiler-state' as const,
      kind: 'browser.state.write' as const,
      target: 'state.count',
    });

    expect(securityHandler(Object.freeze([operation]), implementation)).toBe(implementation);
  });

  it('fails closed for unknown/server operations and mismatched reviewed doors', () => {
    for (const operation of [
      { door: 'compiler-state', kind: 'browser.unknown' },
      { door: 'managed-db', kind: 'server.database.write' },
      { door: 'delegated-event', kind: 'browser.state.write' },
    ]) {
      expect(() => invokeGeneratedHandler([operation])).toThrow(
        'KV449: generated browser security operation 0 is invalid.',
      );
    }
  });

  it('rejects sparse, accessor, extra-key, and oversized generated manifests', () => {
    expect(() => invokeGeneratedHandler(new Array(1))).toThrow(
      'KV449: generated browser security operation 0 is not own data.',
    );

    const getter = vi.fn(() => 'browser.state.write');
    const accessorOperation = { door: 'compiler-state' };
    Object.defineProperty(accessorOperation, 'kind', { enumerable: true, get: getter });
    expect(() => invokeGeneratedHandler([accessorOperation])).toThrow(
      'KV449: generated browser security operation kind must be own data.',
    );
    expect(getter).not.toHaveBeenCalled();

    expect(() =>
      invokeGeneratedHandler([
        { door: 'compiler-state', extra: true, kind: 'browser.state.write' },
      ]),
    ).toThrow('KV449: generated browser security operation 0 has extra data.');

    expect(() =>
      invokeGeneratedHandler(
        Array.from({ length: 257 }, () => ({
          door: 'compiler-state',
          kind: 'browser.state.write',
        })),
      ),
    ).toThrow('KV449: invalid generated browser security-operation manifest.');
  });
});

describe('delegated handler reference dispatch', () => {
  it('keeps handler ref selection pinned after string and regexp prototype poisoning', async () => {
    const pass = vi.fn();
    const privileged = vi.fn();
    const source = '/c/pass.client.js#pass';
    const originalSplit = String.prototype.split;
    const originalSlice = String.prototype.slice;
    const originalLastIndexOf = String.prototype.lastIndexOf;
    const originalExec = RegExp.prototype.exec;
    const originalTest = RegExp.prototype.test;
    const element = new FakeElement({ 'on:click': source });
    const importModule = vi.fn(async () => ({ pass, privileged }));
    try {
      String.prototype.split = function (separator, limit) {
        return this === source
          ? ['/c/pass.client.js#privileged']
          : Reflect.apply(originalSplit, this, [separator, limit]);
      };
      String.prototype.slice = function (start, end) {
        return this === source
          ? '/c/pass.client.js#privileged'
          : Reflect.apply(originalSlice, this, [start, end]);
      };
      String.prototype.lastIndexOf = function (search, position) {
        return this === source ? 1 : Reflect.apply(originalLastIndexOf, this, [search, position]);
      };
      RegExp.prototype.exec = () => null;
      RegExp.prototype.test = () => false;

      await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    } finally {
      String.prototype.split = originalSplit;
      String.prototype.slice = originalSlice;
      String.prototype.lastIndexOf = originalLastIndexOf;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype.test = originalTest;
    }

    expect(pass).toHaveBeenCalledOnce();
    expect(privileged).not.toHaveBeenCalled();
  });

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

  it('does not synthesize an empty state stamp for a stateless handler', async () => {
    const inspect = vi.fn();
    const element = new FakeStatefulBindingElement({
      'on:click': '/c/pass.client.js#inspect',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, async () => ({ inspect }));

    expect(inspect).toHaveBeenCalledOnce();
    expect(element.getAttribute('kovo-state')).toBeNull();
  });

  it('rejects malformed handler references through delegated dispatch', async () => {
    const element = new FakeElement({ 'on:click': '/c/cart.client.js#' });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, vi.fn()),
    ).rejects.toThrow('Invalid handler reference: /c/cart.client.js#');
  });

  it('rejects inherited and accessor handler exports without invoking them', async () => {
    const inherited = vi.fn();
    const inheritedCarrier = Object.create({ pass: inherited }) as Record<string, unknown>;
    const inheritedElement = new FakeElement({ 'on:click': '/c/pass.client.js#pass' });

    await expect(
      dispatchDelegatedEvent(
        { target: inheritedElement, type: 'click' },
        async () => inheritedCarrier,
      ),
    ).rejects.toThrow('Handler export not found: /c/pass.client.js#pass');
    expect(inherited).not.toHaveBeenCalled();

    const getter = vi.fn(() => inherited);
    const accessorCarrier: Record<string, unknown> = {};
    Object.defineProperty(accessorCarrier, 'pass', { configurable: true, get: getter });
    const accessorElement = new FakeElement({ 'on:click': '/c/pass.client.js#pass' });
    await expect(
      dispatchDelegatedEvent(
        { target: accessorElement, type: 'click' },
        async () => accessorCarrier,
      ),
    ).rejects.toThrow('Handler export not found: /c/pass.client.js#pass');
    expect(getter).not.toHaveBeenCalled();
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

  it('gives every chained handler a fresh own-data state snapshot', async () => {
    const first = vi.fn((_event, ctx: { state: Record<string, unknown> }) => {
      expect(Object.getPrototypeOf(ctx.state)).toBeNull();
      expect(Object.getPrototypeOf(ctx.state.nested)).toBeNull();
      expect(Object.hasOwn(ctx.state, '__proto__')).toBe(true);
      expect(ctx.state.toString).toBeUndefined();
      expect(ctx.state.constructor).toBeUndefined();
      expect((ctx.state['__proto__'] as Record<string, unknown>).admin).toBe(true);
      ctx.state = { count: 2 };
    });
    const second = vi.fn((_event, ctx: { state: Record<string, unknown> }) => {
      expect(Object.getPrototypeOf(ctx.state)).toBeNull();
      expect(ctx.state.constructor).toBeUndefined();
      ctx.state.count = 3;
    });
    const importModule = vi.fn(async () => ({ first, second }));
    const element = new FakeElement({
      'kovo-state': '{"__proto__":{"admin":true},"nested":{"value":1}}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(element.getAttribute('kovo-state')).toBe('{"count":3}');
  });

  it('never assimilates a synchronous handler return as a thenable', async () => {
    const then = vi.fn(() => {
      throw new Error('handler thenable executed');
    });
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
      return { then };
    });
    const second = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ first, second }));
    const element = new FakeElement({
      'kovo-state': '{"count":0}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(then).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
  });

  it('fails closed before a later chained handler can observe invalid state', async () => {
    let accessorCalls = 0;
    const invalidStateFactories: Array<[string, () => unknown]> = [
      ['function', () => () => undefined],
      ['class instance', () => new Date()],
      ['undefined', () => undefined],
      ['BigInt', () => 1n],
      ['non-finite number', () => Number.POSITIVE_INFINITY],
      [
        'accessor',
        () => {
          const value = {};
          Object.defineProperty(value, 'secret', {
            enumerable: true,
            get() {
              accessorCalls += 1;
              return 'secret';
            },
          });
          return value;
        },
      ],
      ['sparse array', () => new Array(1)],
      [
        'cycle',
        () => {
          const value: Record<string, unknown> = {};
          value.self = value;
          return value;
        },
      ],
      [
        'deep graph',
        () => {
          let value: Record<string, unknown> = {};
          for (let depth = 0; depth < 65; depth += 1) value = { child: value };
          return value;
        },
      ],
      ['value budget', () => Array.from({ length: 10_000 }, () => 0)],
      ['text budget', () => 'x'.repeat(1_000_001)],
      [
        'hostile proxy',
        () =>
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('hostile ownKeys trap');
              },
            },
          ),
      ],
    ];

    for (const [label, createInvalidState] of invalidStateFactories) {
      accessorCalls = 0;
      const second = vi.fn();
      const first = (_event: unknown, context: { state: unknown }) => {
        context.state = createInvalidState();
      };
      const importModule = vi.fn(async () => ({ first, second }));
      const element = new FakeElement({
        'kovo-state': '{"safe":true}',
        'on:click': '/c/a.js#first /c/b.js#second',
      });

      await expect(
        dispatchDelegatedEvent({ target: element, type: 'click' }, importModule),
        label,
      ).rejects.toThrow('KV449: handler state must be bounded recursive own-data JsonValue.');
      expect(second, label).not.toHaveBeenCalled();
      expect(element.getAttribute('kovo-state'), label).toBe('{"safe":true}');
      expect(accessorCalls, label).toBe(0);
    }
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

  it('keeps state, direct sinks, derives, and post-commit effects unchanged on a late derive import failure', async () => {
    const deferredEffect = vi.fn();
    const firstRun = vi.fn(() => 'new-first');
    const host = new FakeStatefulBindingElement({
      'kovo-state': '{"value":"old"}',
      'on:click': '/c/a.js#change',
    });
    const direct = new FakeStatefulBindingElement(
      { 'data-bind': 'state.value' },
      { parent: host, textContent: 'old-direct' },
    );
    const first = new FakeStatefulBindingElement(
      { 'data-bind': '/c/a.js#first' },
      { parent: host, textContent: 'old-first' },
    );
    new FakeStatefulBindingElement(
      { 'data-bind': '/c/b.js#second' },
      { parent: host, textContent: 'old-second' },
    );
    const change = (_event: unknown, ctx: { state: { value: string } }) => {
      ctx.state.value = 'new';
      (
        globalThis as { __kovo_postCommitSchedule?: (callback: () => void) => void }
      ).__kovo_postCommitSchedule?.(deferredEffect);
    };

    await expect(
      dispatchDelegatedEvent({ target: host, type: 'click' }, async (url) => {
        if (url === '/c/a.js') return { change, first: { run: firstRun } };
        throw new Error('late derive import failed');
      }),
    ).rejects.toThrow('late derive import failed');

    expect(firstRun).not.toHaveBeenCalled();
    expect(host.getAttribute('kovo-state')).toBe('{"value":"old"}');
    expect(direct.textContent).toBe('old-direct');
    expect(first.textContent).toBe('old-first');
    expect(deferredEffect).not.toHaveBeenCalled();
  });

  it.each([
    ['missing export', {}],
    ['invalid export', { derived: vi.fn() }],
    ['missing run', { derived: {} }],
    ['invalid run', { derived: { run: 'not-a-function' } }],
  ])('fails closed on a %s in the owned state derive module', async (_label, deriveModule) => {
    const deferredEffect = vi.fn();
    const host = new FakeStatefulBindingElement({
      'kovo-state': '{"value":"old"}',
      'on:click': '/c/a.js#change',
    });
    const output = new FakeStatefulBindingElement(
      { 'data-bind': '/c/b.js#derived' },
      { parent: host, textContent: 'old-output' },
    );
    const change = (_event: unknown, ctx: { state: { value: string } }) => {
      ctx.state.value = 'new';
      (
        globalThis as { __kovo_postCommitSchedule?: (callback: () => void) => void }
      ).__kovo_postCommitSchedule?.(deferredEffect);
    };

    await expect(
      dispatchDelegatedEvent({ target: host, type: 'click' }, async (url) =>
        url === '/c/a.js' ? { change } : deriveModule,
      ),
    ).rejects.toThrow(/Kovo state derive (?:export|run export) is missing or invalid/u);

    expect(host.getAttribute('kovo-state')).toBe('{"value":"old"}');
    expect(output.textContent).toBe('old-output');
    expect(deferredEffect).not.toHaveBeenCalled();
  });

  it('does not apply earlier direct/derive sinks or commit state when a later derive throws', async () => {
    const deferredEffect = vi.fn();
    const firstRun = vi.fn(() => 'new-first');
    const host = new FakeStatefulBindingElement({
      'kovo-state': '{"value":"old"}',
      'on:click': '/c/a.js#change',
    });
    const direct = new FakeStatefulBindingElement(
      { 'data-bind': 'state.value' },
      { parent: host, textContent: 'old-direct' },
    );
    const first = new FakeStatefulBindingElement(
      { 'data-bind': '/c/a.js#first' },
      { parent: host, textContent: 'old-first' },
    );
    const second = new FakeStatefulBindingElement(
      { 'data-bind': '/c/b.js#second' },
      { parent: host, textContent: 'old-second' },
    );
    const change = (_event: unknown, ctx: { state: { value: string } }) => {
      ctx.state.value = 'new';
      (
        globalThis as { __kovo_postCommitSchedule?: (callback: () => void) => void }
      ).__kovo_postCommitSchedule?.(deferredEffect);
    };

    await expect(
      dispatchDelegatedEvent({ target: host, type: 'click' }, async (url) =>
        url === '/c/a.js'
          ? { change, first: { run: firstRun } }
          : {
              second: {
                run() {
                  throw new Error('late derive run failed');
                },
              },
            },
      ),
    ).rejects.toThrow('late derive run failed');

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(host.getAttribute('kovo-state')).toBe('{"value":"old"}');
    expect(direct.textContent).toBe('old-direct');
    expect(first.textContent).toBe('old-first');
    expect(second.textContent).toBe('old-second');
    expect(deferredEffect).not.toHaveBeenCalled();
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
    const direct = new FakeStatefulBindingElement(
      { 'data-bind': 'state.open' },
      { parent: host, textContent: 'false' },
    );
    const derived = new FakeStatefulBindingElement(
      { 'data-bind': '/c/menu.js#hiddenDerive' },
      { parent: host, textContent: 'old-derived' },
    );

    const open = vi.fn((_event, ctx: { state: { open: boolean } }) => {
      ctx.state.open = true;
      // The primitive's default scheduler routes through this global hook.
      const schedule = (globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void })
        .__kovo_postCommitSchedule;
      expect(typeof schedule).toBe('function');
      schedule?.(() => {
        order.push(
          `post-commit:${host.getAttribute('kovo-state')}:${direct.textContent}:${derived.textContent}`,
        );
      });
    });
    const hiddenDerive = {
      run() {
        order.push(
          `derive-prepare:${host.getAttribute('kovo-state')}:${direct.textContent}:${derived.textContent}`,
        );
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
    expect(order).toEqual([
      'derive-prepare:{"open":false}:false:old-derived',
      'post-commit:{"open":true}:true:revealed',
    ]);
    // The global hook is cleaned up after dispatch (no leak across dispatches).
    expect(
      (globalThis as { __kovo_postCommitSchedule?: unknown }).__kovo_postCommitSchedule,
    ).toBeUndefined();
  });

  it('serializes overlapping delegated state writes for the same island', async () => {
    let releaseFirstImport: (() => void) | undefined;
    const firstImportCanFinish = new Promise<void>((resolve) => {
      releaseFirstImport = resolve;
    });
    const calls: number[] = [];
    const handler = vi.fn((_event, ctx: { state: { count: number } }) => {
      calls.push(ctx.state.count);
      ctx.state.count += 1;
    });
    let importCalls = 0;
    const importModule = vi.fn(async () => {
      importCalls += 1;
      if (importCalls === 1) await firstImportCanFinish;
      return { increment: handler };
    });
    const element = new FakeElement({
      'kovo-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));

    expect(handler).not.toHaveBeenCalled();
    releaseFirstImport?.();
    await Promise.all([first, second]);

    expect(calls).toEqual([0, 1]);
    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
  });

  it('retains delegated state continuation after late Promise method poisoning', async () => {
    let handlerCalls = 0;
    const handler = (_event: unknown, ctx: { state: { count: number } }) => {
      handlerCalls += 1;
      ctx.state.count += 1;
    };
    const importModule = async () => ({ increment: handler });
    const element = new FakeElement({
      'kovo-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });
    const names = ['catch', 'then', 'finally'] as const;
    const descriptors = names.map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, name);
      if (!descriptor) throw new Error(`Missing Promise.prototype.${name}`);
      return { descriptor, name };
    });
    const resolve = Object.getOwnPropertyDescriptor(Promise, 'resolve');
    if (!resolve) throw new Error('Missing Promise.resolve');
    const poison = new Error('ambient Promise method invoked');
    Object.defineProperty(Promise, 'resolve', {
      ...resolve,
      value: () => {
        throw poison;
      },
    });
    for (const { descriptor, name } of descriptors) {
      Object.defineProperty(Promise.prototype, name, {
        ...descriptor,
        value: () => {
          throw poison;
        },
      });
    }
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    try {
      first = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
      second = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    } finally {
      Object.defineProperty(Promise, 'resolve', resolve);
      for (const { descriptor, name } of descriptors) {
        Object.defineProperty(Promise.prototype, name, descriptor);
      }
    }
    if (!first || !second) throw new Error('Missing delegated dispatch completions');
    await first;
    await second;

    // SPEC §4.3/§6.6: per-island state serialization is framework-owned continuation truth;
    // authored Promise method replacement cannot suppress a handler or reorder the next writer.
    expect(handlerCalls).toBe(2);
    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
  });

  it('does not serialize delegated state writes across different islands', async () => {
    let releaseFirstImport: (() => void) | undefined;
    const firstImportCanFinish = new Promise<void>((resolve) => {
      releaseFirstImport = resolve;
    });
    const handler = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    let importCalls = 0;
    const importModule = vi.fn(async () => {
      importCalls += 1;
      if (importCalls === 1) await firstImportCanFinish;
      return { increment: handler };
    });
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
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledTimes(1);
    await second;
    expect(secondElement.getAttribute('kovo-state')).toBe('{"count":11}');

    releaseFirstImport?.();
    await first;
    expect(firstElement.getAttribute('kovo-state')).toBe('{"count":1}');
  });

  it('rolls back a failed handler state transaction before continuing the delegated queue', async () => {
    const deferredEffect = vi.fn();
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
      (
        globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void }
      ).__kovo_postCommitSchedule?.(deferredEffect);
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
    const failure = expect(failed).rejects.toThrow('boom');
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    element.setAttribute('on:click', '/c/pass.client.js#second');
    const passed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    await failure;
    await passed;

    expect(element.getAttribute('kovo-state')).toBe('{"count":1}');
    expect(deferredEffect).not.toHaveBeenCalled();
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

  it('rolls back the whole delegated chain when a later handler cannot resolve', async () => {
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

    expect(element.getAttribute('kovo-state')).toBe('{"count":2}');
  });
});
