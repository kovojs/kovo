import { describe, expect, it } from 'vitest';

import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';
import { applyFragments, morphStructuralTree, type StructuralMorphNode } from './morph.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot, FakeMorphTarget } from './runtime-test-fakes.js';

function keyedListRow(key: string, text: string): StructuralMorphNode {
  return {
    key,
    props: { 'data-row': key },
    text,
    type: 'li',
  };
}

describe('fragment morph runtime', () => {
  it('applies fragment chunks through the morph adapter', () => {
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>old</cart-badge>'));

    expect(
      applyFragments(root, [
        { html: '<cart-badge>new</cart-badge>', target: 'cart-badge' },
        { html: '<aside>ignored</aside>', target: 'missing' },
      ]),
    ).toEqual(['cart-badge']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>new</cart-badge>');
  });

  it('appends fragment chunks when the wire mode is append', () => {
    const root = new FakeMorphRoot();
    root.targets.set('product-grid', new FakeMorphTarget('<article kovo-key="p1"></article>'));
    const store = createQueryStore();

    const result = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-fragment target="product-grid" mode="append"><article kovo-key="p2"></article></kovo-fragment>',
      ),
      {
        root,
        store,
      },
    );

    expect(result.fragments).toEqual([
      {
        html: '<article kovo-key="p2"></article>',
        mode: 'append',
        target: 'product-grid',
      },
    ]);
    expect(result.appliedFragments).toEqual(['product-grid']);
    expect(root.targets.get('product-grid')?.html).toBe(
      '<article kovo-key="p1"></article><article kovo-key="p2"></article>',
    );
  });

  it('prepends fragment chunks at the START when the wire mode is prepend (SPEC §9.3)', () => {
    const root = new FakeMorphRoot();
    root.targets.set('chat-log', new FakeMorphTarget('<article kovo-key="m2"></article>'));
    const store = createQueryStore();

    const result = applyMutationResponseChunksToRuntime(
      readMutationResponseBodyChunks(
        '<kovo-fragment target="chat-log" mode="prepend"><article kovo-key="m1"></article></kovo-fragment>',
      ),
      { root, store },
    );

    expect(result.fragments).toEqual([
      { html: '<article kovo-key="m1"></article>', mode: 'prepend', target: 'chat-log' },
    ]);
    expect(result.appliedFragments).toEqual(['chat-log']);
    // The older row (m1) lands BEFORE the held row (m2).
    expect(root.targets.get('chat-log')?.html).toBe(
      '<article kovo-key="m1"></article><article kovo-key="m2"></article>',
    );
  });
});

describe('structural morph runtime', () => {
  it('morphs a structural tree to the next tree shape without DOM APIs', () => {
    const current: StructuralMorphNode = {
      children: [
        { key: 'total', text: 'Cart total: $4', type: 'span' },
        { text: 'stale helper', type: 'small' },
      ],
      props: { role: 'status' },
      type: 'cart-badge',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          key: 'total',
          props: { 'data-bind': 'cart.total' },
          text: 'Cart total: $7',
          type: 'span',
        },
        { key: 'count', text: '2 items', type: 'strong' },
      ],
      props: { role: 'status', 'aria-live': 'polite' },
      type: 'cart-badge',
    };

    const result = morphStructuralTree(current, next);

    expect(result).toBe(current);
    expect(result).toEqual(next);
    expect(result.children?.[1]).not.toBe(next.children?.[1]);
  });

  it('preserves keyed structural node identity when sibling order changes', () => {
    const first: StructuralMorphNode = {
      children: [{ text: '$4', type: 'span' }],
      key: 'line:1',
      props: { 'data-id': 'line:1' },
      text: 'Coffee',
      type: 'li',
    };
    const second: StructuralMorphNode = {
      children: [{ text: '$3', type: 'span' }],
      key: 'line:2',
      props: { 'data-id': 'line:2' },
      text: 'Tea',
      type: 'li',
    };
    const current: StructuralMorphNode = {
      children: [first, second],
      type: 'ul',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          children: [{ text: '$5', type: 'span' }],
          key: 'line:2',
          props: { 'data-id': 'line:2', 'data-selected': 'true' },
          text: 'Tea',
          type: 'li',
        },
        {
          children: [{ text: '$4', type: 'span' }],
          key: 'line:1',
          props: { 'data-id': 'line:1' },
          text: 'Coffee',
          type: 'li',
        },
      ],
      type: 'ul',
    };

    const result = morphStructuralTree(current, next);

    // SPEC.md §4.8/§13.2: kovo-key is the shared keyed identity contract for
    // stamps, morph, and optimistic reordering.
    expect(result).toEqual(next);
    expect(result.children?.[0]).toBe(second);
    expect(result.children?.[1]).toBe(first);
  });

  it('preserves keyed browser state across fragment morphs and reorders', () => {
    const input: StructuralMorphNode = {
      browserState: {
        focused: true,
        islandState: { draftQuantity: 2 },
        scroll: { left: 4, top: 24 },
        selection: { direction: 'forward', end: 3, start: 1 },
      },
      key: 'line:input',
      props: { name: 'quantity' },
      text: '2',
      type: 'input',
    };
    const current: StructuralMorphNode = {
      children: [{ key: 'line:label', text: 'Quantity', type: 'label' }, input],
      type: 'form',
    };
    const next: StructuralMorphNode = {
      children: [
        {
          key: 'line:input',
          props: { name: 'quantity', value: '3' },
          text: '3',
          type: 'input',
        },
        { key: 'line:label', text: 'Updated quantity', type: 'label' },
      ],
      type: 'form',
    };

    const result = morphStructuralTree(current, next);

    expect(result.children?.[0]).toBe(input);
    expect(result.children?.[0]?.browserState).toEqual({
      focused: true,
      islandState: { draftQuantity: 2 },
      scroll: { left: 4, top: 24 },
      selection: { direction: 'forward', end: 3, start: 1 },
    });
    expect(result.children?.[0]).toMatchObject({
      props: { name: 'quantity', value: '3' },
      text: '3',
    });
  });

  it('clones browser state for newly inserted structural nodes', () => {
    const current: StructuralMorphNode = { children: [], type: 'form' };
    const nextChild: StructuralMorphNode = {
      browserState: { scroll: { left: 0, top: 10 } },
      key: 'new-panel',
      text: 'New',
      type: 'section',
    };

    const result = morphStructuralTree(current, {
      children: [nextChild],
      type: 'form',
    });

    expect(result.children?.[0]).not.toBe(nextChild);
    expect(result.children?.[0]?.browserState).toEqual({ scroll: { left: 0, top: 10 } });
    expect(result.children?.[0]?.browserState).not.toBe(nextChild.browserState);
  });

  it('preserves keyed list identity across append fragments and later reorders', () => {
    const first = keyedListRow('product:1', 'Coffee');
    const second = keyedListRow('product:2', 'Tea');
    const current: StructuralMorphNode = {
      children: [first, second],
      type: 'ul',
    };
    const appended: StructuralMorphNode = {
      children: [
        keyedListRow('product:1', 'Coffee'),
        keyedListRow('product:2', 'Tea'),
        keyedListRow('product:3', 'Milk'),
        keyedListRow('product:4', 'Honey'),
      ],
      type: 'ul',
    };

    const appendResult = morphStructuralTree(current, appended);
    const third = appendResult.children?.[2];
    const fourth = appendResult.children?.[3];

    expect(appendResult.children).toEqual(appended.children);
    expect(appendResult.children?.[0]).toBe(first);
    expect(appendResult.children?.[1]).toBe(second);
    expect(third).not.toBe(appended.children?.[2]);
    expect(fourth).not.toBe(appended.children?.[3]);

    const reordered: StructuralMorphNode = {
      children: [
        keyedListRow('product:2', 'Tea'),
        keyedListRow('product:4', 'Honey'),
        keyedListRow('product:5', 'Jam'),
        keyedListRow('product:1', 'Coffee'),
        keyedListRow('product:3', 'Milk'),
      ],
      type: 'ul',
    };

    const reorderResult = morphStructuralTree(appendResult, reordered);

    expect(reorderResult.children).toEqual(reordered.children);
    expect(reorderResult.children?.[0]).toBe(second);
    expect(reorderResult.children?.[1]).toBe(fourth);
    expect(reorderResult.children?.[2]).not.toBe(reordered.children?.[2]);
    expect(reorderResult.children?.[3]).toBe(first);
    expect(reorderResult.children?.[4]).toBe(third);
  });
});
