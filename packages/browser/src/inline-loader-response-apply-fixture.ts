import {
  renderedFragmentHtmlContent,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';

import { applyMutationResponseChunksToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './client.js';
import type { InlineSourceInstall } from './inline-loader-test-utils.js';
import { applyInlineMutationResponseChunks } from './inline-response-apply.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { applyInlineQueryEventToRuntime } from './query-events.js';
import type { InlineQueryEvent } from './query-events.js';
import type { HtmlResponseFragmentApplyTarget } from './response-fragment-apply.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';
import { readInlineMutationResponseBodyChunks } from './wire-response-scanner.js';
import { crossPackageOracleFixture } from '../../conformance-fixtures/src/oracle-fixtures.js';

interface InlineResponseApplyAssertions {
  expect: (actual: unknown) => {
    toBe(expected: unknown): unknown;
    toContainEqual(expected: unknown): unknown;
    toEqual(expected: unknown): unknown;
  };
  vi: { fn: <T extends (...args: never[]) => unknown>(implementation?: T) => T };
}

type FragmentSnapshot = {
  html: string;
  mode?: 'append' | 'prepend' | 'replace';
  target: string;
};

// SPEC §10.3: this parity fixture models a server-rendered enhanced form, whose
// hidden retry token supplies the timestamp retained by the fresh submit nonce.
function serverStampedMutationIdem(): string {
  return `v1_${Date.now()}_0123456789abcdef0123456789abcdef`;
}

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
    location: globalRecord.location,
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
      const values = new Map<string, unknown>([['Kovo-Idem', serverStampedMutationIdem()]]);
      return {
        get(name: string) {
          return values.get(name) ?? null;
        },
        set(name: string, value: unknown) {
          values.set(name, value);
        },
      };
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
      headers: {
        get(name: string) {
          return name.toLowerCase() === 'content-type' ? 'text/vnd.kovo.fragment+html' : null;
        },
      },
      async text() {
        return body;
      },
      url: 'https://kovo.test/_m/cart/add',
    }));
    globalRecord.location = {
      href: 'https://kovo.test/cart',
      origin: 'https://kovo.test',
      pathname: '/cart',
      search: '',
    };

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
                  if (name === 'data-mutation') return 'cart/add';
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
    expect({
      ...modularResult,
      fragments: fragmentSnapshots(modularResult.fragments),
    }).toEqual({
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
      location: originals.location,
    });
    if (originals.importModule === undefined) {
      delete globalRecord.__kovoInlineImport;
    } else {
      globalRecord.__kovoInlineImport = originals.importModule;
    }
  }
}

export function expectInlineOracleResponseApplyContract(
  assertions: Pick<InlineResponseApplyAssertions, 'expect'>,
): void {
  const { expect } = assertions;
  const fixture = crossPackageOracleFixture();
  const globalRecord = globalThis as unknown as { document?: unknown };
  const originalDocument = globalRecord.document;
  const modularTargets = new Map([
    [
      fixture.component.fragmentTarget,
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
  const modularStore = createQueryStore();
  const modularResult = applyMutationResponseChunksToRuntime(
    readMutationResponseBodyChunks(fixture.runtime.body),
    {
      root: {
        findFragmentTarget(target: string) {
          return modularTargets.get(target) ?? null;
        },
      } as never,
      store: modularStore,
    },
  );
  const inlineTargets = new Map([
    [
      fixture.component.fragmentTarget,
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

  try {
    globalRecord.document = {
      createElement(name: string) {
        if (name !== 'template') throw new Error(`unexpected inline test element: ${name}`);
        const template = {
          content: { childNodes: [] as unknown[], children: [] as unknown[] },
          set innerHTML(value: string) {
            const element = {
              attributes: [] as Array<{ name: string; value: string }>,
              outerHTML: value,
              querySelectorAll() {
                return [];
              },
              toString() {
                return value;
              },
            };
            this.content.childNodes = [element];
            this.content.children = [element];
          },
        };
        return template;
      },
    };
    const inlineResult = applyInlineMutationResponseChunks(
      readInlineMutationResponseBodyChunks(fixture.runtime.body),
      {
        createHTML: (html) => html,
        findFragmentTarget(target) {
          return (
            (inlineTargets.get(target) as unknown as HtmlResponseFragmentApplyTarget | undefined) ??
            null
          );
        },
        security: createBrowserNavigationSecurityControls(),
      },
    );

    expect(modularResult.appliedFragments).toEqual(fixture.runtime.expectedAppliedFragments);
    expect(inlineResult).toEqual(fixture.runtime.expectedAppliedFragments);
    expect(modularTargets.get(fixture.component.fragmentTarget)?.html).toBe(
      fixture.runtime.fragmentHtml,
    );
    expect(inlineTargets.get(fixture.component.fragmentTarget)?.html).toBe(
      fixture.runtime.fragmentHtml,
    );
  } finally {
    globalRecord.document = originalDocument;
  }
}
