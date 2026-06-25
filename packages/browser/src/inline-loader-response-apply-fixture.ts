import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './client.js';
import type { InlineSourceInstall } from './inline-loader-test-utils.js';
import { applyInlineQueryEventToRuntime } from './query-events.js';
import type { InlineQueryEvent } from './query-events.js';
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
    DOMParser: globalRecord.DOMParser,
    FormData: globalRecord.FormData,
    CustomEvent: globalRecord.CustomEvent,
    addEventListener: globalRecord.addEventListener,
    dispatchEvent: globalRecord.dispatchEvent,
    document: globalRecord.document,
    fetch: globalRecord.fetch,
    importModule: globalRecord.__kovoInlineImport,
  };
  const listeners = new Map<string, (event: unknown) => void>();
  interface InlineParityTarget {
    append?(...nodes: unknown[]): void;
    html?: string;
    insertAdjacentHTML?(position: string, html: string): void;
  }
  interface InlineBindingAttribute {
    name: string;
    value: string;
  }
  interface InlineBinding {
    attributes: InlineBindingAttribute[];
    textContent: string;
    closest?(selector: string): unknown;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
  }

  const inlineTargets = new Map<string, InlineParityTarget>([
    [
      'cart-badge',
      {
        html: '',
        append(...nodes: unknown[]) {
          this.html += nodes.join('');
        },
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
    [
      'cart-list',
      {
        html: '<li>existing</li>',
        append(...nodes: unknown[]) {
          this.html += nodes.join('');
        },
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
    [
      'cart-summary',
      {
        html: '',
        append(...nodes: unknown[]) {
          this.html += nodes.join('');
        },
        insertAdjacentHTML(_position: string, html: string) {
          this.html += html;
        },
      },
    ],
  ]);
  const scopedDeps = (deps: string) => ({
    getAttribute(name: string) {
      return name === 'kovo-deps' ? deps : null;
    },
  });
  const inlineBindings: InlineBinding[] = [
    {
      attributes: [],
      textContent: '',
      closest(selector: string) {
        return selector === '[kovo-deps]' ? scopedDeps('cart:c1') : null;
      },
      getAttribute(name: string) {
        return name === 'data-bind' ? 'cart.count' : null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.push({ name, value });
      },
    },
    {
      attributes: [{ name: 'data-bind:aria-label', value: 'product.stock' }],
      textContent: '',
      closest(selector: string) {
        return selector === '[kovo-deps]' ? scopedDeps('product:product>p1') : null;
      },
      getAttribute(name: string) {
        return name === 'data-bind' ? null : null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.push({ name, value });
      },
    },
    {
      attributes: [],
      textContent: 'unchanged',
      closest(selector: string) {
        return selector === '[kovo-deps]' ? scopedDeps('product>p2') : null;
      },
      getAttribute(name: string) {
        return name === 'data-bind' ? 'product.stock' : null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.push({ name, value });
      },
    },
    {
      attributes: [],
      textContent: '',
      getAttribute(name: string) {
        return name === 'data-bind' ? 'productGrid.products' : null;
      },
      setAttribute(name: string, value: string) {
        this.attributes.push({ name, value });
      },
    },
  ];

  try {
    globalRecord.DOMParser = class DOMParser {
      parseFromString() {
        throw new Error('inline mutation response parsing must not use DOMParser');
      }
    };
    globalRecord.FormData = function FormData() {
      return {};
    };
    globalRecord.CustomEvent = class CustomEvent {
      detail: unknown;
      type: string;

      constructor(type: string, init: { detail?: unknown } = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    };
    globalRecord.dispatchEvent = (event: { type: string }) => {
      listeners.get(event.type)?.(event);
      return true;
    };
    globalRecord.document = {
      createElement(name: string) {
        if (name !== 'template') throw new Error(`unexpected inline test element: ${name}`);
        const template = {
          content: { childNodes: [] as unknown[], children: [] as unknown[] },
          set innerHTML(value: string) {
            this.content.childNodes = [value];
          },
        };
        return template;
      },
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
        if (selector === '[data-bind]') {
          return inlineBindings.filter((binding) => binding.getAttribute('data-bind') !== null);
        }
        if (selector === '*') return inlineBindings;
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
    listeners.set('kovo:query', (event) => {
      applyInlineQueryEventToRuntime(event as InlineQueryEvent, {
        root: globalRecord.document,
        store: createQueryStore(),
      });
    });
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

    expect(inlineBindings[0]?.textContent).toBe('1');
    expect(inlineBindings[1]?.attributes).toContainEqual({ name: 'aria-label', value: '7' });
    expect(inlineBindings[2]?.textContent).toBe('unchanged');
    expect(inlineBindings[3]?.textContent).toBe('[{"id":"p1"}]');
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
