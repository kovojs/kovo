import { describe, expect, it } from 'vitest';

import { FRAMEWORK_WIRE_INPUT_GRAMMAR } from '@kovojs/core/internal/wire-input-grammar';

import * as mutationTargetsModule from './mutation-targets.js';
import { readLiveTargetSnapshot, readLiveTargets } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';

class FakeTargetRoot {
  queries = 0;

  constructor(private readonly elements: FakeTargetElement[]) {}

  querySelectorAll(selector: string): Iterable<FakeTargetElement> {
    this.queries += 1;
    return selector === '[kovo-deps]' ? this.elements : [];
  }
}

class FakeTargetElement {
  readonly id?: string;

  constructor(
    private readonly attrs: Record<string, string | null>,
    options: { id?: string } = {},
  ) {
    if (options.id !== undefined) {
      this.id = options.id;
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

describe('mutation targets', () => {
  it('collects live DOM Kovo-Targets in first-seen order with nullish id fallback', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement(
        {
          'kovo-deps': 'cart',
          'kovo-fragment-target': null,
          'kovo-live-component': 'components/cart/cart-badge/cart-badge',
          'kovo-live-token': 'tok_cart',
        },
        { id: 'cart-badge' },
      ),
      new FakeTargetElement({
        'kovo-deps': 'inventory stock',
        'kovo-fragment-target': 'inventory',
        'kovo-live-component': 'components/inventory/inventory',
        'kovo-live-token': 'tok_inventory',
        'kovo-props': '{"warehouseId":"w1"}',
      }),
      new FakeTargetElement({
        'kovo-deps': '',
        'kovo-fragment-target': 'empty-deps',
        'kovo-live-token': 'tok_empty',
      }),
      new FakeTargetElement({
        'kovo-c': 'cart-summary',
        'kovo-deps': 'cart summary',
        'kovo-live-token': 'tok_summary',
      }),
    ]);

    // SPEC.md §9.1: enhanced mutations send Kovo-Targets from live kovo-deps DOM
    // stamps, including component stamps when no explicit target/id exists.
    expect(readLiveTargets(root)).toEqual([
      'cart-badge=cart',
      'inventory=inventory stock',
      'empty-deps',
      'cart-summary=cart summary',
    ]);
    expect(readLiveTargetSnapshot(root).header).toBe(
      'cart-badge=cart; inventory=inventory stock; empty-deps; cart-summary=cart summary',
    );
    expect(readLiveTargetSnapshot(root).liveHeader).toBe(
      'cart-badge#components%2Fcart%2Fcart-badge%2Fcart-badge@tok_cart:{}; inventory#components%2Finventory%2Finventory@tok_inventory:{"warehouseId":"w1"}; empty-deps#empty-deps@tok_empty:{}; cart-summary#cart-summary@tok_summary:{}',
    );
  });

  it('rejects an explicit empty target instead of falling back to a different identity', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({ 'kovo-deps': 'debug', 'kovo-fragment-target': '' }, { id: 'debug' }),
    ]);

    expect(() => readLiveTargetSnapshot(root)).toThrow(
      'Kovo target collection contains an invalid target identity.',
    );
  });

  it('ignores dependency consumers that have no fragment target identity', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({ 'kovo-deps': 'recommendations' }),
      new FakeTargetElement({
        'kovo-deps': 'cart',
        'kovo-fragment-target': 'cart',
        'kovo-live-token': 'tok_cart',
      }),
    ]);

    expect(readLiveTargetSnapshot(root).header).toBe('cart=cart');
    expect(readLiveTargetSnapshot(root).liveHeader).toBe('cart#cart@tok_cart:{}');
  });

  it('rejects duplicate target identities atomically instead of choosing one descriptor', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'inventory',
        'kovo-fragment-target': 'inventory',
        'kovo-live-component': 'components/inventory/first',
        'kovo-live-token': 'tok_first',
      }),
      new FakeTargetElement({
        'kovo-deps': 'inventory',
        'kovo-fragment-target': 'inventory',
        'kovo-live-component': 'components/inventory/substituted',
        'kovo-live-token': 'tok_second',
      }),
    ]);

    expect(() => readLiveTargetSnapshot(root)).toThrow(
      'Kovo target collection contains a duplicate target identity.',
    );
  });

  it('reads one live target snapshot for enhanced mutation request headers', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement(
        { 'kovo-deps': 'cart', 'kovo-fragment-target': null, 'kovo-live-token': 'tok_cart' },
        { id: 'cart' },
      ),
      new FakeTargetElement({
        'kovo-deps': 'reviews',
        'kovo-fragment-target': 'reviews:p1',
        'kovo-live-component': 'components/reviews/reviews',
        'kovo-live-token': 'tok_reviews',
        'kovo-props': '{"productId":"p1"}',
      }),
    ]);

    const snapshot = readLiveTargetSnapshot(root);

    // SPEC.md §9.1: the enhanced mutation request and returned metadata use one
    // live Kovo-Targets snapshot, not separate compatibility serialization passes.
    expect(snapshot).toEqual({
      header: 'cart=cart; reviews%3Ap1=reviews',
      liveHeader:
        'cart#cart@tok_cart:{}; reviews%3Ap1#components%2Freviews%2Freviews@tok_reviews:{"productId":"p1"}',
      liveTargetEntries: [
        { target: 'cart', wireEntry: 'cart#cart@tok_cart:{}' },
        {
          target: 'reviews:p1',
          wireEntry: 'reviews%3Ap1#components%2Freviews%2Freviews@tok_reviews:{"productId":"p1"}',
        },
      ],
      liveTargets: [
        { attestation: 'tok_cart', component: 'cart', props: {}, target: 'cart' },
        {
          attestation: 'tok_reviews',
          component: 'components/reviews/reviews',
          props: { productId: 'p1' },
          target: 'reviews:p1',
        },
      ],
      targetEntries: [
        { target: 'cart', wireEntry: 'cart=cart' },
        { target: 'reviews:p1', wireEntry: 'reviews%3Ap1=reviews' },
      ],
      targets: ['cart=cart', 'reviews%3Ap1=reviews'],
    });
    expect(root.queries).toBe(1);
    expect(Object.hasOwn(mutationTargetsModule, 'serializeLiveTargets')).toBe(false);
    expect(Object.hasOwn(mutationTargetsModule, 'serializeLiveTargetEntries')).toBe(false);
    expect(Object.hasOwn(mutationTargetsModule, 'liveTargetHeaderSeparator')).toBe(false);
  });

  it('prefers the id attribute over shadowable DOM id properties', () => {
    const root = new FakeTargetRoot([
      Object.assign(
        new FakeTargetElement({
          id: 'your-answer',
          'kovo-deps': 'answers question',
          'kovo-live-token': 'tok_answer',
        }),
        { id: { toString: () => '[object HTMLInputElement]' } },
      ) as unknown as FakeTargetElement,
    ]);

    expect(readLiveTargetSnapshot(root)).toMatchObject({
      header: 'your-answer=answers question',
      liveHeader: 'your-answer#your-answer@tok_answer:{}',
      targets: ['your-answer=answers question'],
    });
  });

  it('pins live target JSON controls before application code can replace them', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'public-panel',
        'kovo-live-component': 'components/public/card',
        'kovo-live-token': 'tok_public',
        'kovo-props': '{"scope":"public"}',
      }),
    ]);
    const originalParse = JSON.parse;
    const originalStringify = JSON.stringify;
    const originalIsArray = Array.isArray;
    const originalApply = Reflect.apply;
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      JSON.parse = () => ({ scope: 'admin' });
      JSON.stringify = () => '{"scope":"admin"}';
      Array.isArray = (() => true) as typeof Array.isArray;
      Reflect.apply = () => {
        throw new Error('late poisoned Reflect.apply reached');
      };
      snapshot = readLiveTargetSnapshot(root);
    } finally {
      JSON.parse = originalParse;
      JSON.stringify = originalStringify;
      Array.isArray = originalIsArray;
      Reflect.apply = originalApply;
    }

    // SPEC §6.6 rule 6 / §9.1: the modular browser runtime must serialize the same
    // framework-owned target facts that it parsed from the live DOM.
    expect(snapshot).toMatchObject({
      header: 'public-panel=public',
      liveHeader: 'public-panel#components%2Fpublic%2Fcard@tok_public:{"scope":"public"}',
      liveTargets: [
        {
          attestation: 'tok_public',
          component: 'components/public/card',
          props: { scope: 'public' },
          target: 'public-panel',
        },
      ],
      targets: ['public-panel=public'],
    });
  });

  it('does not let a late Array.flatMap replacement substitute an attested admin target', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'public-panel',
        'kovo-live-component': 'components/public/card',
        'kovo-live-token': 'tok_public',
        'kovo-props': '{"scope":"public"}',
      }),
    ]);
    const flatMapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'flatMap');
    if (!flatMapDescriptor) throw new Error('Array.prototype.flatMap descriptor unavailable');
    let poisonHits = 0;
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      Object.defineProperty(Array.prototype, 'flatMap', {
        ...flatMapDescriptor,
        value() {
          poisonHits += 1;
          return [
            {
              attestation: 'tok_admin',
              component: 'components/admin/card',
              props: { scope: 'admin' },
              target: 'admin-panel',
            },
          ];
        },
      });
      snapshot = readLiveTargetSnapshot(root);
    } finally {
      Object.defineProperty(Array.prototype, 'flatMap', flatMapDescriptor);
    }

    // SPEC §6.6 rule 6 / §9.1: a late authored callback cannot replace the
    // framework-owned live target snapshot sent to the server.
    expect(poisonHits).toBe(0);
    expect(snapshot).toMatchObject({
      header: 'public-panel=public',
      liveHeader: 'public-panel#components%2Fpublic%2Fcard@tok_public:{"scope":"public"}',
      liveTargets: [
        {
          attestation: 'tok_public',
          component: 'components/public/card',
          props: { scope: 'public' },
          target: 'public-panel',
        },
      ],
      targets: ['public-panel=public'],
    });
  });

  it('ignores inherited attestation and JSON callbacks poisoned after module boot', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'unattested-panel',
        'kovo-live-component': 'components/public/unattested',
        'kovo-props': '{"scope":"public"}',
      }),
      new FakeTargetElement({
        'kovo-deps': 'catalog',
        'kovo-fragment-target': 'catalog-panel',
        'kovo-live-component': 'components/public/catalog',
        'kovo-live-token': 'tok_catalog',
        'kovo-props':
          '{"z":1,"nested":{"z":"last","a":[{"z":2,"a":1}]},"a":"first","del":"\u007f","label":"😀 漢字","line":"\u2028\u2029"}',
      }),
    ]);
    const attestationDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'attestation');
    const toJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    let callbackHits = 0;
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      Object.defineProperty(Object.prototype, 'attestation', {
        configurable: true,
        enumerable: true,
        value: 'tok_substituted',
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() {
          callbackHits += 1;
          return { scope: 'admin-substituted' };
        },
      });
      snapshot = readLiveTargetSnapshot(root);
    } finally {
      if (attestationDescriptor) {
        Object.defineProperty(Object.prototype, 'attestation', attestationDescriptor);
      } else {
        delete (Object.prototype as { attestation?: unknown }).attestation;
      }
      if (toJsonDescriptor) {
        Object.defineProperty(Object.prototype, 'toJSON', toJsonDescriptor);
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
    }

    // SPEC §6.6 rule 6 / §9.1: optional browser facts are own-data snapshots and
    // raw props normalization cannot dispatch an inherited serialization callback.
    expect(callbackHits).toBe(0);
    expect(snapshot).toMatchObject({
      header: 'unattested-panel=public; catalog-panel=catalog',
      liveHeader:
        'catalog-panel#components%2Fpublic%2Fcatalog@tok_catalog:{"a":"first","del":"\\u007f","label":"\\ud83d\\ude00 \\u6f22\\u5b57","line":"\\u2028\\u2029","nested":{"a":[{"a":1,"z":2}],"z":"last"},"z":1}',
      liveTargets: [
        {
          component: 'components/public/unattested',
          props: { scope: 'public' },
          target: 'unattested-panel',
        },
        {
          attestation: 'tok_catalog',
          component: 'components/public/catalog',
          props: {
            a: 'first',
            del: '\u007f',
            label: '😀 漢字',
            line: '\u2028\u2029',
            nested: { a: [{ a: 1, z: 2 }], z: 'last' },
            z: 1,
          },
          target: 'catalog-panel',
        },
      ],
      targets: ['unattested-panel=public', 'catalog-panel=catalog'],
    });
    expect(Object.hasOwn(snapshot!.liveTargets[0]!, 'attestation')).toBe(false);
  });

  it('accepts the live-props character bound exactly and rejects one character over it', () => {
    const maximum = FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters;
    const exactRoot = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'exact-panel',
        'kovo-live-token': 'tok_exact',
        'kovo-props': ' '.repeat(maximum - 2) + '{}',
      }),
    ]);
    const oversizedRoot = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': 'public',
        'kovo-fragment-target': 'oversized-panel',
        'kovo-live-token': 'tok_oversized',
        'kovo-props': ' '.repeat(maximum - 1) + '{}',
      }),
    ]);

    expect(readLiveTargetSnapshot(exactRoot).liveHeader).toBe(
      'exact-panel#exact-panel@tok_exact:{}',
    );
    expect(() => readLiveTargetSnapshot(oversizedRoot)).toThrow(
      'Kovo target props exceed the framework header budget.',
    );
  });

  it('keeps target collection closed over boot controls after collection intrinsic poisoning', () => {
    const root = new FakeTargetRoot([
      new FakeTargetElement({
        'kovo-deps': ' public inventory ',
        'kovo-fragment-target': 'public-panel',
        'kovo-live-component': 'components/public/card',
        'kovo-live-token': 'tok_public',
        'kovo-props': '{"scope":"public"}',
      }),
    ]);
    const NativeMap = Map;
    const flatMapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'flatMap');
    const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'map');
    const everyDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'every');
    const filterDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'filter');
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    const splitDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'split');
    const trimDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'trim');
    const mapHasDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'has');
    const mapSetDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'set');
    const mapValuesDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'values');
    const mapSizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'size');
    if (
      !flatMapDescriptor ||
      !mapDescriptor ||
      !everyDescriptor ||
      !filterDescriptor ||
      !iteratorDescriptor ||
      !splitDescriptor ||
      !trimDescriptor ||
      !mapHasDescriptor ||
      !mapSetDescriptor ||
      !mapValuesDescriptor ||
      !mapSizeDescriptor
    ) {
      throw new Error('collection intrinsic descriptors unavailable');
    }
    let poisonHits = 0;
    const poison = () => {
      poisonHits += 1;
      throw new Error('late collection intrinsic poison reached');
    };
    let snapshot: ReturnType<typeof readLiveTargetSnapshot> | undefined;
    try {
      globalThis.Map = function PoisonedMap() {
        return poison();
      } as unknown as MapConstructor;
      Object.defineProperty(Array.prototype, 'flatMap', { ...flatMapDescriptor, value: poison });
      Object.defineProperty(Array.prototype, 'map', { ...mapDescriptor, value: poison });
      Object.defineProperty(Array.prototype, 'every', { ...everyDescriptor, value: poison });
      Object.defineProperty(Array.prototype, 'filter', { ...filterDescriptor, value: poison });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        ...iteratorDescriptor,
        value: poison,
      });
      Object.defineProperty(String.prototype, 'split', { ...splitDescriptor, value: poison });
      Object.defineProperty(String.prototype, 'trim', { ...trimDescriptor, value: poison });
      Object.defineProperty(Map.prototype, 'has', { ...mapHasDescriptor, value: poison });
      Object.defineProperty(Map.prototype, 'set', { ...mapSetDescriptor, value: poison });
      Object.defineProperty(Map.prototype, 'values', { ...mapValuesDescriptor, value: poison });
      Object.defineProperty(Map.prototype, 'size', { ...mapSizeDescriptor, get: poison });
      snapshot = readLiveTargetSnapshot(root);
    } finally {
      globalThis.Map = NativeMap;
      Object.defineProperty(Array.prototype, 'flatMap', flatMapDescriptor);
      Object.defineProperty(Array.prototype, 'map', mapDescriptor);
      Object.defineProperty(Array.prototype, 'every', everyDescriptor);
      Object.defineProperty(Array.prototype, 'filter', filterDescriptor);
      Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
      Object.defineProperty(String.prototype, 'split', splitDescriptor);
      Object.defineProperty(String.prototype, 'trim', trimDescriptor);
      Object.defineProperty(Map.prototype, 'has', mapHasDescriptor);
      Object.defineProperty(Map.prototype, 'set', mapSetDescriptor);
      Object.defineProperty(Map.prototype, 'values', mapValuesDescriptor);
      Object.defineProperty(Map.prototype, 'size', mapSizeDescriptor);
    }

    expect(poisonHits).toBe(0);
    expect(snapshot).toMatchObject({
      header: 'public-panel=public inventory',
      liveHeader: 'public-panel#components%2Fpublic%2Fcard@tok_public:{"scope":"public"}',
      liveTargets: [
        {
          attestation: 'tok_public',
          component: 'components/public/card',
          props: { scope: 'public' },
          target: 'public-panel',
        },
      ],
      targets: ['public-panel=public inventory'],
    });
  });

  it('rejects sparse and over-budget structural target collections', () => {
    const sparse = new Array<FakeTargetElement>(1);
    const overBudget = new Array<FakeTargetElement>(100_001);
    const sparseRoot = {
      querySelectorAll: () => sparse,
    } as TargetCollectorRoot;
    const overBudgetRoot = {
      querySelectorAll: () => overBudget,
    } as TargetCollectorRoot;

    // SPEC §6.6 rule 6 / §9.1: structural seams are copied through bounded
    // own-data indexes; inherited entries and iterable callbacks are not facts.
    expect(() => readLiveTargetSnapshot(sparseRoot)).toThrow(
      'Kovo runtime query collection must contain dense element entries.',
    );
    expect(() => readLiveTargetSnapshot(overBudgetRoot)).toThrow(
      'Kovo runtime query collection must have a bounded own-data length.',
    );
  });
});
