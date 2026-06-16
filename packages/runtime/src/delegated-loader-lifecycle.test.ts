import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installKovoLoader } from './index.js';
import {
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakeRoot,
} from './runtime-test-fakes.js';

// SPEC.md §4.4/§4.7: each loader install owns an isolated island ctx.signal
// scope that aborts on dispose, enhanced-mutation fragments that remove an
// island abort its loader-scoped signal, and delegated handler failures report
// through the loader error hook. The dispatch-level signal abort behavior lives
// in the sibling delegated-island-signal-abort.test.ts file.
describe('delegated loader lifecycle', () => {
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
    const firstLoader = installKovoLoader({
      importModule: vi.fn(async () => ({ mount: firstHandler })),
      root: firstRoot,
    });
    const secondLoader = installKovoLoader({
      importModule: vi.fn(async () => ({ mount: secondHandler })),
      root: secondRoot,
    });
    const firstElement = new FakeElement({
      'kovo-c': 'cart-filter',
      'on:click': '/c/cart-filter.client.js#mount',
    });
    const secondElement = new FakeElement({
      'kovo-c': 'cart-filter',
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
      'kovo-c': 'cart-filter',
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
      new FakeMorphTarget('<section><cart-filter kovo-c="cart-filter"></cart-filter></section>'),
    );
    const loader = installKovoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => ({
          headers: {
            get() {
              return null;
            },
          },
          async text() {
            return '<kovo-fragment target="cart-shell"><section></section></kovo-fragment>';
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

  it('reports delegated loader failures through the loader error hook', async () => {
    const loaderRoot = new FakeRoot();
    const onError = vi.fn();
    const element = new FakeElement({
      'on:click': '/c/cart-badge.client.js#missing',
    });

    installKovoLoader({
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
