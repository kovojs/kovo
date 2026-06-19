import { describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './client.js';
import { dispatchDelegatedEvent } from './handlers.js';
import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import {
  abortIslandSignalScope,
  abortRemovedIslandSignals,
  createIslandSignalScope,
} from './handler-context.js';
import { FakeElement, FakeMorphRoot, FakeMorphTarget } from './runtime-test-fakes.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

// SPEC.md §4.7: ctx.signal is the island lifecycle primitive. Delegated event
// dispatch creates one stable signal per island identity, fragment morphing
// aborts signals for islands removed/replaced by a new identity while preserving
// signals for matching identities, and keyed islands keep independent signals.
// The loader-install lifecycle (per-install isolation, dispose, enhanced
// submit/error hooks) lives in the sibling delegated-loader-lifecycle.test.ts file.
describe('delegated island ctx.signal abort', () => {
  it('scopes ctx.signal to the island and aborts when fragment morph removes it', async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
    });
    const importModule = vi.fn(async () => ({ CartFilter$mount: handler }));
    const element = new FakeElement({
      'kovo-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);
    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);

    expect(
      abortRemovedIslandSignals(
        '<section><cart-filter kovo-c="cart-filter"></cart-filter></section>',
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
      'kovo-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#mount',
    });
    const activeElement = new FakeElement({
      'kovo-c': 'cart-filter',
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
          '<section><cart-filter kovo-c="cart-filter"></cart-filter></section>',
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

  it('keeps ctx.signal alive when fragment morph preserves the island identity', async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn((_event, ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
    });
    const importModule = vi.fn(async () => ({ CartFilter$mount: handler }));
    const element = new FakeElement({
      'kovo-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);

    expect(
      abortRemovedIslandSignals(
        '<section><cart-filter kovo-c="cart-filter"></cart-filter></section>',
        '<section><cart-filter kovo-c="cart-filter">Updated</cart-filter></section>',
      ),
    ).toEqual([]);
    expect(signals[0]?.aborted).toBe(false);

    abortRemovedIslandSignals(
      '<section><cart-filter kovo-c="cart-filter"></cart-filter></section>',
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
      'kovo-c': 'cart-filter',
      'on:visible': '/c/cart-filter.client.js#CartFilter$mount',
    });
    const root = new FakeMorphRoot();
    root.targets.set(
      'cart-shell',
      new FakeMorphTarget('<section><cart-filter kovo-c="cart-filter"></cart-filter></section>'),
    );

    await dispatchDelegatedEvent({ target: element, type: 'visible' }, importModule);
    expect(signal?.aborted).toBe(false);

    applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-fragment target="cart-shell"><section></section></kovo-fragment>',
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
      'kovo-c': 'cart-row',
      'kovo-key': 'row-1',
      'on:visible': '/c/cart-row.client.js#CartRow$mount',
    });
    const second = new FakeElement({
      'kovo-c': 'cart-row',
      'kovo-key': 'row-2',
      'on:visible': '/c/cart-row.client.js#CartRow$mount',
    });

    await dispatchDelegatedEvent({ target: first, type: 'visible' }, importModule);
    await dispatchDelegatedEvent({ target: second, type: 'visible' }, importModule);

    expect(signals[0]).not.toBe(signals[1]);

    expect(
      abortRemovedIslandSignals(
        [
          '<ol>',
          '<li kovo-c="cart-row" kovo-key="row-1"></li>',
          '<li kovo-c="cart-row" kovo-key="row-2"></li>',
          '</ol>',
        ].join(''),
        '<ol><li kovo-c="cart-row" kovo-key="row-2"></li></ol>',
      ),
    ).toEqual(['cart-row\0row-1']);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    abortRemovedIslandSignals('<li kovo-c="cart-row" kovo-key="row-2"></li>', '');
  });
});
