import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './index.js';
import type { InlineSourceInstall } from './inline-loader-test-utils.js';
import { applyInlineQueryEventToRuntime, type InlineQueryEvent } from './query-events.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

interface InlineResponseApplyAssertions {
  expect: typeof import('vitest').expect;
  vi: { fn: <T extends (...args: never[]) => unknown>(implementation?: T) => T };
}

export async function expectInlineResponseApplyParity(
  installSource: InlineSourceInstall,
  assertions: InlineResponseApplyAssertions,
): Promise<void> {
  const { expect, vi } = assertions;

  // SPEC.md §4.4: the bootstrap may stay tiny, but its wire effects must match the runtime path.
  const body = [
    '<kovo-query name="cart" key="cart:c1">{"count":1}</kovo-query>',
    '<kovo-query name="productGrid">{"products":[{"id":"p1"}]}</kovo-query>',
    '<kovo-query name="product" key="product&gt;p1">{&quot;stock&quot;:7}</kovo-query>',
    '<kovo-query name="malformed">{</kovo-query>',
    '<kovo-query name="empty"></kovo-query>',
    '<kovo-query>{"ignored":true}</kovo-query>',
    '<kovo-fragment target="cart-badge" mode="append"><cart-badge>1<kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge></kovo-fragment>',
    '<kovo-fragment target="cart-list" mode="append"><li>p1</li></kovo-fragment>',
    '<kovo-fragment target="cart-summary" mode="append"><section kovo-c="cart-summary">summary</section></kovo-fragment>',
  ].join('');
  const modularTargets = new Map([
    [
      'cart-badge',
      {
        html: '',
        appendHtml(html: string) {
          this.html += html;
        },
        replaceWithHtml(html: string) {
          this.html = html;
        },
      },
    ],
    [
      'cart-list',
      {
        html: '<li>existing</li>',
        appendHtml(html: string) {
          this.html += html;
        },
        replaceWithHtml(html: string) {
          this.html = html;
        },
      },
    ],
    [
      'cart-summary',
      {
        html: '',
        appendHtml(html: string) {
          this.html += html;
        },
        replaceWithHtml(html: string) {
          this.html = html;
        },
      },
    ],
  ]);
  const store = createQueryStore();
  const modularResult = applyMutationResponseChunksToRuntime(readMutationResponseBodyChunks(body), {
    root: {
      findFragmentTarget(target: string) {
        return modularTargets.get(target) ?? null;
      },
    },
    store,
  });

  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const originals = {
    CustomEvent: globalRecord.CustomEvent,
    DOMParser: globalRecord.DOMParser,
    FormData: globalRecord.FormData,
    addEventListener: globalRecord.addEventListener,
    dispatchEvent: globalRecord.dispatchEvent,
    document: globalRecord.document,
    fetch: globalRecord.fetch,
    importModule: globalRecord.__kovoInlineImport,
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const dispatched: InlineQueryEvent[] = [];
  interface InlineParityTarget {
    html?: string;
    insertAdjacentHTML?(position: string, html: string): void;
  }

  const inlineTargets = new Map<string, InlineParityTarget>([
    [
      'cart-badge',
      {
        html: '',
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
    [
      'cart-list',
      {
        html: '<li>existing</li>',
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
    [
      'cart-summary',
      {
        html: '',
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
  ]);

  try {
    globalRecord.CustomEvent = class CustomEvent {
      readonly detail: unknown;
      readonly type: string;

      constructor(type: string, init?: InlineQueryEvent) {
        this.detail = init?.detail;
        this.type = type;
      }
    };
    globalRecord.DOMParser = class DOMParser {
      parseFromString() {
        throw new Error('inline mutation response parsing must not use DOMParser');
      }
    };
    globalRecord.FormData = function FormData() {
      return {};
    };
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    };
    globalRecord.dispatchEvent = (event: InlineQueryEvent) => {
      dispatched.push(event);
      return true;
    };
    globalRecord.document = {
      getElementById(id: string) {
        if (id === 'cart-summary') return null;
        return inlineTargets.get(id) ?? null;
      },
      querySelector(selector: string) {
        if (selector === '[kovo-c="cart-summary"]') {
          return inlineTargets.get('cart-summary') ?? null;
        }
        return null;
      },
      querySelectorAll(selector: string) {
        return selector === '[kovo-deps]' ? [] : [];
      },
    };
    globalRecord.fetch = vi.fn(async () => ({
      async text() {
        return body;
      },
    }));

    installSource(
      vi.fn(async () => ({})),
      globalRecord,
    );
    listeners.get('submit')?.({
      preventDefault: vi.fn(),
      target: {
        closest(selector: string) {
          return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
            ? {
                action: '/_m/cart/add',
                getAttribute(name: string) {
                  return name === 'enhance' ? '' : null;
                },
                method: 'post',
              }
            : null;
        },
      },
      type: 'submit',
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const inlineStore = createQueryStore();
    const inlineQueries = dispatched.flatMap((event) =>
      applyInlineQueryEventToRuntime(event, { store: inlineStore }),
    );

    expect(dispatched.map((event) => event.detail)).toEqual([
      {
        queries: [
          { attrs: ' name="cart" key="cart:c1"', content: '{"count":1}' },
          { attrs: ' name="productGrid"', content: '{"products":[{"id":"p1"}]}' },
          { attrs: ' name="product" key="product&gt;p1"', content: '{&quot;stock&quot;:7}' },
          { attrs: ' name="malformed"', content: '{' },
          { attrs: ' name="empty"', content: '' },
          { attrs: '', content: '{"ignored":true}' },
        ],
      },
    ]);
    expect(inlineQueries).toEqual(modularResult.queries);
    expect(inlineStore.get('cart', 'cart:c1')).toEqual(store.get('cart', 'cart:c1'));
    expect(inlineStore.get('productGrid')).toEqual(store.get('productGrid'));
    expect(inlineStore.get('product', 'product>p1')).toEqual(store.get('product', 'product>p1'));
    expect(inlineTargets.get('cart-badge')?.html).toBe(modularTargets.get('cart-badge')?.html);
    expect(inlineTargets.get('cart-list')?.html).toBe(modularTargets.get('cart-list')?.html);
    expect(inlineTargets.get('cart-summary')?.html).toBe(modularTargets.get('cart-summary')?.html);
    expect(modularResult).toEqual({
      appliedFragments: ['cart-badge', 'cart-list', 'cart-summary'],
      fragments: [
        {
          html: '<cart-badge>1<kovo-fragment target="nested"><span>nested</span></kovo-fragment></cart-badge>',
          mode: 'append',
          target: 'cart-badge',
        },
        { html: '<li>p1</li>', mode: 'append', target: 'cart-list' },
        {
          html: '<section kovo-c="cart-summary">summary</section>',
          mode: 'append',
          target: 'cart-summary',
        },
      ],
      queries: ['cart:c1', 'productGrid', 'product:product>p1'],
    });
  } finally {
    Object.assign(globalRecord, {
      CustomEvent: originals.CustomEvent,
      DOMParser: originals.DOMParser,
      FormData: originals.FormData,
      addEventListener: originals.addEventListener,
      dispatchEvent: originals.dispatchEvent,
      document: originals.document,
      fetch: originals.fetch,
    });
    if (originals.importModule === undefined) {
      delete globalRecord.__kovoInlineImport;
    } else {
      globalRecord.__kovoInlineImport = originals.importModule;
    }
  }
}
