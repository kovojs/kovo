import { describe, expect, it, vi } from 'vitest';

import {
  abortRemovedIslandSignals,
  createQueryStore,
  dispatchDelegatedEvent,
  installJisoLoader,
} from './index.js';
import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handler-context.js';
import {
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeRoot,
} from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

describe('delegated runtime integration', () => {
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

    applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<fw-fragment target="cart-shell"><section></section></fw-fragment>',
      ),
      {
        root,
        store: createQueryStore(),
      },
    );

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
});
