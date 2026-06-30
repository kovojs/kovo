import {
  renderedFragmentHtmlContent,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { describe, expect, it, vi } from 'vitest';

import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './client.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

type FragmentSnapshot = {
  html: string;
  mode?: 'append' | 'prepend' | 'replace';
  target: string;
};

function fragmentSnapshots(
  fragments: readonly {
    html: RenderedFragmentHtml;
    mode?: 'append' | 'prepend' | 'replace';
    target: string;
  }[],
): FragmentSnapshot[] {
  return fragments.map((fragment) => ({
    ...fragment,
    html: renderedFragmentHtmlContent(fragment.html),
  }));
}

function applySnapshot<
  Result extends { fragments: readonly { html: RenderedFragmentHtml; target: string }[] },
>(result: Result): Omit<Result, 'fragments'> & { fragments: FragmentSnapshot[] } {
  return {
    ...result,
    fragments: fragmentSnapshots(result.fragments),
  };
}

describe('parsed mutation response wire apply', () => {
  it('reports keyed query chunks with their canonical typed-read key', () => {
    const store = createQueryStore();
    const plan = vi.fn();

    store.subscribe('product', plan, 'p1');
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-query name="product" key="p1">{"stock":4}</kovo-query>',
      ),
      { store },
    );

    // SPEC.md §9.4: query instance keys are the shared currency for store, wire,
    // optimistic transforms, and refetch-on-focus typed reads.
    expect(store.get('product', 'p1')).toEqual({ stock: 4 });
    expect(store.get('product')).toBeUndefined();
    expect(plan).toHaveBeenCalledWith({ stock: 4 });
    expect(applySnapshot(applied)).toEqual({
      fragments: [],
      queries: ['product:p1'],
    });
  });

  it('accepts escaped JSON from text/html-compatible kovo-query chunks', () => {
    const store = createQueryStore();

    applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-query name="cart">{&quot;count&quot;:4,&quot;label&quot;:&quot;Alice&#39;s &amp; Bob&apos;s&quot;}</kovo-query>',
      ),
      { store },
    );

    expect(store.get('cart')).toEqual({ count: 4, label: "Alice's & Bob's" });
  });

  it('accepts single-quoted chunk attributes', () => {
    const store = createQueryStore();
    const body = [
      "<kovo-query name='cart' key='cart:c1'>{\"count\":4}</kovo-query>",
      "<kovo-fragment target='cart-list' mode='append'><li>p1</li></kovo-fragment>",
    ].join('');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('cart', 'cart:c1')).toEqual({ count: 4 });
    expect(applySnapshot(applied)).toEqual({
      fragments: [{ html: '<li>p1</li>', mode: 'append', target: 'cart-list' }],
      queries: ['cart:c1'],
    });
  });

  it('keeps quoted query attribute tag closers on the store apply path', () => {
    const store = createQueryStore();
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-query name="product" key="product>p1">{"stock":7}</kovo-query>',
      ),
      { store },
    );

    // SPEC.md §9.4: keyed query chunks must hydrate the same instance key that
    // inline DOM parsing exposes from the wire attribute.
    expect(store.get('product', 'product>p1')).toEqual({ stock: 7 });
    expect(applySnapshot(applied)).toEqual({
      fragments: [],
      queries: ['product:product>p1'],
    });
  });

  it('reports malformed chunks on the runtime store-only apply path', () => {
    const store = createQueryStore();
    const onError = vi.fn();

    // SPEC.md §9.1 keeps query and fragment chunks in one response body; the
    // store-only runtime path should still parse both through the shared reader.
    const body = [
      '<kovo-query name="cart">{</kovo-query>',
      '<kovo-query name="inventory">{"available":true}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge>Ready</cart-badge>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(body, onError),
      { onError, store },
    );

    expect(applySnapshot(applied)).toEqual({
      fragments: [],
      queries: ['inventory'],
    });
    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map(([error]) => String(error.message))).toEqual([
      expect.stringContaining('Malformed JSON in kovo-query cart'),
      expect.stringContaining('Malformed kovo-fragment chunk'),
    ]);
  });

  it('skips malformed mutation query chunks and continues applying valid chunks', () => {
    const store = createQueryStore();
    const body = [
      '<kovo-query name="cart">{</kovo-query>',
      '<kovo-query name="inventory">{"available":true}</kovo-query>',
      '<kovo-fragment target="cart-badge"><cart-badge>Ready</cart-badge></kovo-fragment>',
    ].join('\n');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect(applySnapshot(applied)).toEqual({
      fragments: [{ html: '<cart-badge>Ready</cart-badge>', target: 'cart-badge' }],
      queries: ['inventory'],
    });
  });

  it('keeps nested kovo-fragment children inside their parent fragment chunk', () => {
    const store = createQueryStore();
    const body = [
      '<kovo-fragment target="cart-badge">',
      '<cart-badge><span>1</span><kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge>',
      '</kovo-fragment>',
    ].join('');
    const applied = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
      store,
    });

    expect(applySnapshot(applied)).toEqual({
      fragments: [
        {
          html: '<cart-badge><span>1</span><kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: [],
    });
  });
});
