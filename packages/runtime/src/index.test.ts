import { describe, expect, it, vi } from 'vitest';
import { runInThisContext } from 'node:vm';
import { form, type Route } from '@jiso/core';

import {
  applyDeferredChunk,
  applyDeferredChunkToDom,
  applyDeferredStreamResponseToDom,
  applyFragments,
  applyCompiledQueryUpdatePlan,
  applyOptimisticTransforms,
  abortRemovedIslandSignals,
  applyMutationResponseToDom,
  applyQueryBindings,
  createInlineJisoLoaderSource,
  createQueryStore,
  derive,
  dispatchDelegatedEvent,
  installInlineJisoLoader,
  installMutationBroadcast,
  installPagehideOptimismCleanup,
  installJisoLoader,
  jisoLoaderSource,
  MutationQueue,
  morphStructuralTree,
  OptimisticRebaser,
  parseHandlerReference,
  parseHandlerReferences,
  readElementParams,
  readElementState,
  stampPendingQueries,
  submitEnhancedMutation,
  submitOptimisticEnhancedMutation,
  type DelegatedEvent,
  type EnhancedMutationFetchOptions,
  type EventElementLike,
  type MutationBroadcast,
  type OptimisticFor,
  type StructuralMorphNode,
} from './index.js';
import { abortIslandSignalScope, createIslandSignalScope } from './handlers.js';

declare module '@jiso/core' {
  interface InvalidationSets {
    'cart/add': 'cart' | 'productGrid';
  }

  interface QueryRegistry {
    cart: { count: number };
    productGrid: { products: { id: string; pending: boolean }[] };
  }

  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
}

class FakeRoot {
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
  elements = new Map<string, FakeElement[]>();
  scripts: QueryScript[] = [];
  visibilityState: 'hidden' | 'visible' = 'visible';

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
  ): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(selector: string): Iterable<QueryScript | FakeElement> {
    return selector === 'script[fw-query]' ? this.scripts : (this.elements.get(selector) ?? []);
  }
}

interface QueryScript {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

class FakeElement implements EventElementLike {
  attributes: { name: string; value: string }[];

  constructor(attributes: Record<string, string>) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
  }

  closest(_selector: string): FakeElement {
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

class FakeFormElement extends FakeElement {
  action: string;
  method: string | undefined;
  progressElements: FakeElement[] = [];

  constructor(attributes: Record<string, string>, options: { action: string; method?: string }) {
    super(attributes);
    this.action = options.action;
    this.method = options.method;
  }

  querySelectorAll(selector: string): Iterable<FakeElement> {
    return selector === '[fw-upload-progress]' ? this.progressElements : [];
  }
}

class FakeBroadcastChannel {
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly hub?: FakeBroadcastHub) {
    hub?.connect(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    this.hub?.deliver(this, message);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeBroadcastHub {
  private readonly channels = new Set<FakeBroadcastChannel>();

  connect(channel: FakeBroadcastChannel): void {
    this.channels.add(channel);
  }

  deliver(sender: FakeBroadcastChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel === sender) continue;
      channel.onmessage?.({ data: message });
    }
  }
}

class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }

  appendHtml(html: string): void {
    this.html += html;
  }

  readHtml(): string {
    return this.html;
  }
}

class FakeMorphRoot {
  bindings: FakeQueryBindingElement[] = [];
  deps: { deps?: string; id?: string; target?: string }[] = [];
  planElements: FakeQueryPlanElement[] = [];
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(_selector: string): Iterable<
    | FakeQueryBindingElement
    | FakeQueryPlanElement
    | {
        getAttribute(name: string): string | null;
        id?: string;
      }
  > {
    if (_selector === '[data-bind]') return this.bindings;
    if (_selector === '*') return [...this.bindings, ...this.planElements];
    const planElements = this.planElements.filter((element) => element.matches(_selector));
    if (planElements.length > 0) return planElements;

    return this.deps.map((dep) => ({
      getAttribute: (name) => {
        if (name === 'fw-fragment-target') return dep.target ?? null;
        if (name === 'fw-deps') return dep.deps ?? null;
        return null;
      },
      ...(dep.id ? { id: dep.id } : {}),
    }));
  }
}

class FakeQueryPlanElement {
  attributes: { name: string; value: string }[];
  textContent: string | null;
  value?: string;

  constructor(
    attributes: Record<string, string>,
    options: { textContent?: string | null; value?: string } = {},
  ) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) {
      this.value = options.value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

class FakeTemplateStampHost extends FakeQueryPlanElement {
  items: Array<{ html: string; index: number; key: string; value: unknown }> = [];

  reconcileTemplateStamp(
    items: readonly { html: string; index: number; key: string; value: unknown }[],
  ): void {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

class FakeQueryBindingElement {
  textContent: string | null;
  value?: string;

  constructor(
    private readonly path: string,
    options: { textContent?: string | null; value?: string } = {},
  ) {
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) {
      this.value = options.value;
    }
  }

  getAttribute(name: string): string | null {
    return name === 'data-bind' ? this.path : null;
  }
}

class FakePendingElement {
  attributes: Record<string, string>;

  constructor(attributes: Record<string, string>) {
    this.attributes = { ...attributes };
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

class FakePendingRoot {
  constructor(readonly elements: FakePendingElement[]) {}

  querySelectorAll(_selector: string): Iterable<FakePendingElement> {
    return this.elements;
  }
}

function keyedListRow(key: string, text: string): StructuralMorphNode {
  return {
    key,
    props: { 'data-row': key },
    text,
    type: 'li',
  };
}

type InlineLoaderInstaller = (
  importModule: (url: string) => Promise<Record<string, unknown>>,
  globalRecord: Record<string, unknown>,
) => void;

const inlineLoaderCases: readonly [string, InlineLoaderInstaller][] = [
  [
    'generated bootstrap source',
    (importModule, globalRecord) => {
      globalRecord.__jisoInlineImport = importModule;
      runInThisContext(createInlineJisoLoaderSource('globalThis.__jisoInlineImport'));
    },
  ],
  ['shared inline loader source', (importModule) => installInlineJisoLoader(importModule)],
] as const;

async function dispatchInlineDelegatedClick(
  element: unknown,
  importModule: (url: string) => Promise<Record<string, unknown>>,
  installLoader: InlineLoaderInstaller,
): Promise<void> {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const originals = {
    addEventListener: globalRecord.addEventListener,
    document: globalRecord.document,
    importModule: globalRecord.__jisoInlineImport,
  };
  const listeners = new Map<string, (event: unknown) => Promise<void>>();

  try {
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => Promise<void>) => {
      listeners.set(type, listener);
    };
    globalRecord.document = {
      querySelectorAll() {
        return [];
      },
    };

    installLoader(importModule, globalRecord);

    await listeners.get('click')?.({
      target: element,
      type: 'click',
    });
  } finally {
    Object.assign(globalRecord, {
      addEventListener: originals.addEventListener,
      document: originals.document,
    });
    if (originals.importModule === undefined) {
      delete globalRecord.__jisoInlineImport;
    } else {
      globalRecord.__jisoInlineImport = originals.importModule;
    }
  }
}

describe('runtime loader', () => {
  it.each([
    ['generated bootstrap source', () => runInThisContext(jisoLoaderSource)],
    ['shared inline loader source', () => installInlineJisoLoader(vi.fn(async () => ({})))],
  ])('ships an inline enhanced form round trip through %s', async (_name, installLoader) => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      CustomEvent: globalRecord.CustomEvent,
      DOMParser: globalRecord.DOMParser,
      FormData: globalRecord.FormData,
      addEventListener: globalRecord.addEventListener,
      dispatchEvent: globalRecord.dispatchEvent,
      document: globalRecord.document,
      fetch: globalRecord.fetch,
    };
    const listeners = new Map<string, (event: unknown) => void>();
    const dispatched: unknown[] = [];
    const fragmentTarget = { innerHTML: '' };
    const appendTarget = { insertAdjacentHTML: vi.fn() };
    const formData = { kind: 'form-data' };
    const form = {
      action: '/_m/cart/add',
      method: 'post',
    };
    const depElements = [
      {
        id: 'cart-badge',
        getAttribute(name: string) {
          if (name === 'fw-deps') return 'cart';
          if (name === 'fw-fragment-target') return null;
          return null;
        },
      },
      {
        id: 'inventory-panel',
        getAttribute(name: string) {
          if (name === 'fw-deps') return 'inventory stock';
          if (name === 'fw-fragment-target') return 'inventory';
          return null;
        },
      },
      {
        id: 'empty-fragment-target-fallback',
        getAttribute(name: string) {
          if (name === 'fw-deps') return 'debug';
          if (name === 'fw-fragment-target') return '';
          return null;
        },
      },
    ];
    const fetch = vi.fn(async () => ({
      async text() {
        return [
          '<fw-query name="cart" key="cart:c1">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="cart-list" mode="append"><li>2</li></fw-fragment>',
        ].join('\n');
      },
    }));

    try {
      globalRecord.CustomEvent = class CustomEvent {
        constructor(
          readonly type: string,
          readonly init?: { detail?: unknown },
        ) {}

        get detail(): unknown {
          return this.init?.detail;
        }
      };
      globalRecord.DOMParser = class DOMParser {
        parseFromString(body: string) {
          const queryMatch = /<fw-query\b([^>]*)>([\s\S]*?)<\/fw-query>/.exec(body);
          const fragmentMatches = [
            ...body.matchAll(/<fw-fragment\b([^>]*)>([\s\S]*?)<\/fw-fragment>/g),
          ];
          const queryAttributes = queryMatch?.[1] ?? '';
          const queryElement = queryMatch
            ? {
                getAttribute(name: string) {
                  if (name === 'name') return /name="([^"]+)"/.exec(queryAttributes)?.[1] ?? null;
                  if (name === 'key') return /key="([^"]+)"/.exec(queryAttributes)?.[1] ?? null;
                  return null;
                },
                textContent: queryMatch[2],
              }
            : null;
          const fragmentElements = fragmentMatches.map((fragmentMatch) => {
            const fragmentAttributes = fragmentMatch[1] ?? '';
            return {
              getAttribute(name: string) {
                if (name === 'target') {
                  return /target="([^"]+)"/.exec(fragmentAttributes)?.[1] ?? null;
                }
                if (name === 'mode') {
                  return /mode="([^"]+)"/.exec(fragmentAttributes)?.[1] ?? null;
                }
                return null;
              },
              innerHTML: fragmentMatch[2],
            };
          });

          return {
            querySelectorAll(selector: string) {
              if (selector === 'fw-query') return queryElement ? [queryElement] : [];
              if (selector === 'fw-fragment') return fragmentElements;
              return [];
            },
          };
        }
      };
      globalRecord.FormData = function FormData() {
        return formData;
      };
      globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      };
      globalRecord.dispatchEvent = (event: unknown) => {
        dispatched.push(event);
        return true;
      };
      globalRecord.document = {
        getElementById(id: string) {
          return id === 'cart-badge' ? fragmentTarget : null;
        },
        querySelector(selector: string) {
          return selector === '[fw-fragment-target="cart-list"]' ? appendTarget : null;
        },
        querySelectorAll(selector: string) {
          return selector === '[fw-deps]' ? depElements : [];
        },
        visibilityState: 'visible',
      };
      globalRecord.fetch = fetch;

      installLoader();
      listeners.get('submit')?.({
        preventDefault: vi.fn(),
        target: {
          closest(selector: string) {
            return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
              ? form
              : null;
          },
        },
        type: 'submit',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
        body: formData,
        headers: {
          Accept: 'text/vnd.jiso.fragment+html',
          'FW-Fragment': 'true',
          'FW-Idem': expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          'FW-Targets': 'cart-badge=cart; inventory=inventory stock',
        },
        keepalive: true,
        method: 'POST',
      });
      expect(dispatched).toEqual([
        expect.objectContaining({
          detail: { body: '{"count":1}', key: 'cart:c1', name: 'cart' },
          type: 'jiso:query',
        }),
      ]);
      expect(fragmentTarget.innerHTML).toBe('<cart-badge>1</cart-badge>');
      expect(appendTarget.insertAdjacentHTML).toHaveBeenCalledWith('beforeend', '<li>2</li>');
    } finally {
      Object.assign(globalRecord, originals);
    }
  });

  it.each(inlineLoaderCases)(
    'keeps inline response application in parity with the modular DOM apply path through %s',
    async (_name, installLoader) => {
      // SPEC.md §4.4: the bootstrap may stay tiny, but its wire effects must match the runtime path.
      const body = [
        '<fw-query name="cart" key="cart:c1">{"count":1}</fw-query>',
        '<fw-query name="productGrid">{"products":[{"id":"p1"}]}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        '<fw-fragment target="cart-list" mode="append"><li>p1</li></fw-fragment>',
      ].join('');
      const modularTargets = new Map([
        [
          'cart-badge',
          {
            html: '',
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
      ]);
      const store = createQueryStore();
      const modularResult = applyMutationResponseToDom({
        body,
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
        importModule: globalRecord.__jisoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const dispatched: Array<{ detail?: { body?: string; key?: string; name?: string } }> = [];
      interface InlineParityTarget {
        html?: string;
        innerHTML?: string;
        insertAdjacentHTML?(position: string, html: string): void;
      }

      const inlineTargets = new Map<string, InlineParityTarget>([
        ['cart-badge', { innerHTML: '' }],
        [
          'cart-list',
          {
            html: '<li>existing</li>',
            insertAdjacentHTML(_position: string, html: string) {
              this.html += html;
            },
          },
        ],
      ]);

      try {
        globalRecord.CustomEvent = class CustomEvent {
          constructor(
            readonly type: string,
            readonly init?: { detail?: unknown },
          ) {}

          get detail(): unknown {
            return this.init?.detail;
          }
        };
        globalRecord.DOMParser = class DOMParser {
          parseFromString(source: string) {
            const queryElements = [
              ...source.matchAll(/<fw-query\b([^>]*)>([\s\S]*?)<\/fw-query>/g),
            ].map((match) => {
              const attributes = match[1] ?? '';
              return {
                getAttribute(name: string) {
                  if (name === 'name') return /name="([^"]+)"/.exec(attributes)?.[1] ?? null;
                  if (name === 'key') return /key="([^"]+)"/.exec(attributes)?.[1] ?? null;
                  return null;
                },
                textContent: match[2],
              };
            });
            const fragmentElements = [
              ...source.matchAll(/<fw-fragment\b([^>]*)>([\s\S]*?)<\/fw-fragment>/g),
            ].map((match) => {
              const attributes = match[1] ?? '';
              return {
                getAttribute(name: string) {
                  if (name === 'target') return /target="([^"]+)"/.exec(attributes)?.[1] ?? null;
                  if (name === 'mode') return /mode="([^"]+)"/.exec(attributes)?.[1] ?? null;
                  return null;
                },
                innerHTML: match[2],
              };
            });

            return {
              querySelectorAll(selector: string) {
                if (selector === 'fw-query') return queryElements;
                if (selector === 'fw-fragment') return fragmentElements;
                return [];
              },
            };
          }
        };
        globalRecord.FormData = function FormData() {
          return {};
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = (event: { detail?: unknown }) => {
          dispatched.push(event as { detail?: { body?: string; key?: string; name?: string } });
          return true;
        };
        globalRecord.document = {
          getElementById(id: string) {
            return inlineTargets.get(id) ?? null;
          },
          querySelector() {
            return null;
          },
          querySelectorAll(selector: string) {
            return selector === '[fw-deps]' ? [] : [];
          },
        };
        globalRecord.fetch = vi.fn(async () => ({
          async text() {
            return body;
          },
        }));

        installLoader(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? { action: '/_m/cart/add', method: 'post' }
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(
          dispatched.map((event) => ({
            key: event.detail?.key,
            name: event.detail?.name,
            value: JSON.parse(event.detail?.body ?? 'null'),
          })),
        ).toEqual([
          { key: 'cart:c1', name: 'cart', value: store.get('cart', 'cart:c1') },
          { key: undefined, name: 'productGrid', value: store.get('productGrid') },
        ]);
        expect(inlineTargets.get('cart-badge')?.innerHTML).toBe(
          modularTargets.get('cart-badge')?.html,
        );
        expect(inlineTargets.get('cart-list')?.html).toBe(modularTargets.get('cart-list')?.html);
        expect(modularResult).toEqual({
          appliedFragments: ['cart-badge', 'cart-list'],
          fragments: [
            { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
            { html: '<li>p1</li>', mode: 'append', target: 'cart-list' },
          ],
          queries: ['cart', 'productGrid'],
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
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineLoaderCases)(
    'keeps inline delegated params and state in parity through %s',
    async (_name, installLoader) => {
      // SPEC.md §4.4: delegated handler semantics must not drift between the inline and modular loaders.
      const attrs = {
        'data-p-featured': 'false',
        'data-p-item-id': 'i_42',
        'data-p-missing-type': 'kept-as-string',
        'data-p-quantity': '2',
        'fw-param-types': 'quantity:number featured:boolean missingType',
        'fw-state': '{"count":1}',
        'on:click': '/c/cart.js#add /c/cart.js#finish',
      };
      const expectedCalls = [
        {
          handler: 'add',
          params: {
            featured: false,
            itemId: 'i_42',
            missingType: 'kept-as-string',
            quantity: 2,
          },
          signalAborted: false,
          state: { count: 1 },
        },
        {
          handler: 'finish',
          params: {
            featured: false,
            itemId: 'i_42',
            missingType: 'kept-as-string',
            quantity: 2,
          },
          signalAborted: false,
          state: { count: 2 },
        },
      ];
      const runDelegatedHandlers = async (
        element: FakeElement,
        dispatch: (
          importModule: (url: string) => Promise<Record<string, unknown>>,
        ) => Promise<void>,
      ) => {
        const calls: unknown[] = [];
        const add = vi.fn(
          (_event, ctx: { params: unknown; signal: AbortSignal; state: { count: number } }) => {
            calls.push({
              handler: 'add',
              params: ctx.params,
              signalAborted: ctx.signal.aborted,
              state: { ...ctx.state },
            });
            ctx.state.count += 1;
          },
        );
        const finish = vi.fn(
          (
            _event,
            ctx: { params: unknown; signal: AbortSignal; state: { count: number; done?: boolean } },
          ) => {
            calls.push({
              handler: 'finish',
              params: ctx.params,
              signalAborted: ctx.signal.aborted,
              state: { ...ctx.state },
            });
            ctx.state.done = true;
          },
        );
        const importModule = vi.fn(async () => ({ add, finish }));

        await dispatch(importModule);

        expect(importModule).toHaveBeenCalledWith('/c/cart.js');
        expect(calls).toEqual(expectedCalls);
        expect(element.getAttribute('fw-state')).toBe('{"count":2,"done":true}');
      };
      const modularElement = new FakeElement(attrs);
      const inlineElement = new FakeElement(attrs);

      await runDelegatedHandlers(modularElement, (importModule) =>
        dispatchDelegatedEvent({ target: modularElement, type: 'click' }, importModule),
      );
      await runDelegatedHandlers(inlineElement, (importModule) =>
        dispatchInlineDelegatedClick(inlineElement, importModule, installLoader),
      );
    },
  );

  it.each(inlineLoaderCases)(
    'keeps inline delegated error messages in parity through %s',
    async (_name, installLoader) => {
      // SPEC.md §4.4: handler resolution failures are part of the shipped loader contract.
      const assertErrorParity = async (ref: string) => {
        const modularElement = new FakeElement({ 'on:click': ref });
        const inlineElement = new FakeElement({ 'on:click': ref });
        const importModule = vi.fn(async () => ({}));
        const capture = async (dispatch: () => Promise<void>) =>
          dispatch().then(
            () => undefined,
            (error: unknown) => error,
          );

        const modularError = await capture(() =>
          dispatchDelegatedEvent({ target: modularElement, type: 'click' }, importModule),
        );
        const inlineError = await capture(() =>
          dispatchInlineDelegatedClick(inlineElement, importModule, installLoader),
        );

        expect(inlineError).toBeInstanceOf(Error);
        expect((inlineError as Error).message).toBe((modularError as Error).message);
      };

      await assertErrorParity('/c/cart.js');
      await assertErrorParity('/c/cart.js#missing');
    },
  );

  it('stamps inline enhanced forms when fetch fails without native submit', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      FormData: globalRecord.FormData,
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      fetch: globalRecord.fetch,
    };
    const listeners = new Map<string, (event: unknown) => void>();
    const attributes = new Map<string, string>();
    const form = {
      action: '/_m/cart/add',
      method: 'post',
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    };

    try {
      globalRecord.FormData = function FormData() {
        return {};
      };
      globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      };
      globalRecord.document = {
        querySelectorAll(selector: string) {
          return selector === '[fw-deps]' ? [] : [];
        },
      };
      globalRecord.fetch = vi.fn(async () => {
        throw new Error('network down');
      });

      runInThisContext(jisoLoaderSource);
      listeners.get('submit')?.({
        preventDefault: vi.fn(),
        target: {
          closest(selector: string) {
            return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
              ? form
              : null;
          },
        },
        type: 'submit',
      });
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(attributes).toEqual(
        new Map([
          ['data-error-code', 'NETWORK_ERROR'],
          ['fw-error', ''],
        ]),
      );
    } finally {
      Object.assign(globalRecord, originals);
    }
  });

  it('throws from the inline loader when a handler export is missing', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
    };
    const listeners = new Map<string, (event: unknown) => Promise<void>>();
    const handlerUrl = `data:text/javascript,${encodeURIComponent('export const present = true;')}#missing`;
    const attributes = new Map<string, string>([['on:click', handlerUrl]]);
    const element = {
      attributes: [],
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      closest(selector: string) {
        return selector === '[on\\:click]' ? this : null;
      },
    };

    try {
      globalRecord.addEventListener = (
        type: string,
        listener: (event: unknown) => Promise<void>,
      ) => {
        listeners.set(type, listener);
      };
      globalRecord.document = {
        querySelectorAll() {
          return [];
        },
      };
      installInlineJisoLoader(vi.fn(async () => ({})));

      await expect(
        listeners.get('click')?.({
          target: element,
          type: 'click',
        }),
      ).rejects.toThrow(`Handler export not found: ${handlerUrl}`);
    } finally {
      Object.assign(globalRecord, originals);
    }
  });

  it('registers delegated capture listeners without importing handler modules', () => {
    const root = new FakeRoot();
    const importModule = vi.fn();

    const loader = installJisoLoader({ importModule, root });

    expect(loader.events).toEqual(['click', 'submit', 'input', 'change']);
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(importModule).not.toHaveBeenCalled();
  });

  it('hydrates initial fw-query scripts into the configured query store', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const plan = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":2}',
      },
    ];
    store.subscribe('cart', plan);

    installJisoLoader({ importModule: vi.fn(), queryStore: store, root });

    expect(store.get('cart')).toEqual({ count: 2 });
    expect(plan).toHaveBeenCalledWith({ count: 2 });
  });

  it('ignores malformed initial fw-query scripts without aborting loader install', () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const importModule = vi.fn();
    const onError = vi.fn();
    root.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{',
      },
      {
        getAttribute: (name) => (name === 'fw-query' ? 'inventory' : null),
        textContent: '{"available":true}',
      },
    ];

    installJisoLoader({ importModule, onError, queryStore: store, root });

    expect(store.get('cart')).toBeUndefined();
    expect(store.get('inventory')).toEqual({ available: true });
    expect([...root.listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('intercepts enhanced form submits through the loader bridge', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'fw-deps': 'order' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const uploadProgress = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
        'fw-deps': 'order',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'fw-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    mutationRoot.targets.set('cart-badge', new FakeMorphTarget());
    formData.set('productId', 'p1');
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[{"domain":"cart","input":{"productId":"p1"}}]' : null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512, total: 1024 });
        expect(pendingForm.attributes).toMatchObject({
          'aria-busy': 'true',
          'fw-pending': '',
        });
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
        ].join('\n');
      },
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        idem: () => 'idem_loader',
        onUploadProgress: uploadProgress,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(importModule).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_loader',
        'FW-Targets': 'cart-badge=cart',
      },
      keepalive: true,
      method: 'POST',
      onUploadProgress: expect.any(Function),
    });
    expect(uploadProgress).toHaveBeenCalledWith({ loaded: 512, total: 1024 }, form);
    expect(progressElement.getAttribute('value')).toBe('50');
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(mutationRoot.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(pendingForm.attributes).not.toHaveProperty('fw-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('renders upload progress as indeterminate when total bytes are unknown', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'cart/add',
      },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );
    const progressElement = new FakeElement({ 'fw-upload-progress': '', max: '100', value: '0' });
    form.progressElements = [progressElement];
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => ({
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        options.onUploadProgress?.({ loaded: 512 });
        return '<fw-query name="cart">{"count":1}</fw-query>';
      },
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault,
      target: form,
      type: 'submit',
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(progressElement.getAttribute('value')).toBeNull();
    expect(progressElement.getAttribute('max')).toBe('100');
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('reports enhanced loader submit failures after preventing native submit', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const pendingForm = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([pendingForm]);
    const store = createQueryStore();
    const loaderOnError = vi.fn();
    const preventDefault = vi.fn();
    const importModule = vi.fn();
    const onError = vi.fn();
    const submit = vi.fn();
    const error = new Error('network down');
    const formData = new FormData();
    const form = Object.assign(
      new FakeFormElement(
        {
          enhance: '',
          'fw-deps': 'cart',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { submit },
    );
    mutationRoot.deps = [{ deps: 'cart', id: 'cart-badge' }];
    const fetch = vi.fn(async () => {
      expect(pendingForm.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });
      throw error;
    });

    installJisoLoader({
      enhancedMutations: {
        fetch,
        formData: () => formData,
        onError,
        pendingRoot,
        root: mutationRoot,
        store,
      },
      importModule,
      onError: loaderOnError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, form);
    expect(loaderOnError).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(importModule).not.toHaveBeenCalled();
    expect(pendingForm.attributes).not.toHaveProperty('fw-pending');
    expect(pendingForm.attributes).not.toHaveProperty('aria-busy');
  });

  it('reports enhanced loader submit failures through the loader error hook', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const error = new Error('network down');
    const form = new FakeFormElement(
      { enhance: '' },
      {
        action: '/_m/cart/add',
        method: 'post',
      },
    );

    installJisoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => {
          throw error;
        }),
        formData: () => new FormData(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });

  it('falls back to native submit when unhandled enhanced submits fail', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const preventDefault = vi.fn();
    const onError = vi.fn();
    const submit = vi.fn();
    const error = new Error('network down');
    const form = Object.assign(
      new FakeFormElement(
        { enhance: '' },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      ),
      { submit },
    );

    installJisoLoader({
      enhancedMutations: {
        fetch: vi.fn(async () => {
          throw error;
        }),
        formData: () => new FormData(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      onError,
      root: loaderRoot,
    });

    await expect(
      loaderRoot.listeners.get('submit')?.({
        preventDefault,
        target: form,
        type: 'submit',
      }),
    ).resolves.toBeUndefined();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      event: { preventDefault, target: form, type: 'submit' },
      phase: 'enhanced-mutation',
    });
  });

  it('auto-wires enhanced mutation broadcasts through the loader bridge', async () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const hub = new FakeBroadcastHub();
    const channelNames: string[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor(name: string) {
        channelNames.push(name);
        super(hub);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;

    try {
      const loaderRootA = new FakeRoot();
      const loaderRootB = new FakeRoot();
      const mutationRootA = new FakeMorphRoot();
      const mutationRootB = new FakeMorphRoot();
      const storeA = createQueryStore();
      const storeB = createQueryStore();
      const formData = new FormData();
      const form = new FakeFormElement(
        {
          enhance: '',
          'data-mutation': 'cart/add',
        },
        {
          action: '/_m/cart/add',
          method: 'post',
        },
      );
      const fetch = vi.fn(async () => ({
        headers: { get: () => null },
        async text() {
          return [
            '<fw-query name="cart">{"count":4}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
          ].join('\n');
        },
      }));

      mutationRootA.deps = [{ deps: 'cart', id: 'cart-badge' }];
      mutationRootB.deps = [{ deps: 'cart', id: 'cart-badge' }];
      mutationRootA.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));
      mutationRootB.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

      installJisoLoader({
        enhancedMutations: {
          fetch,
          formData: () => formData,
          idem: () => 'idem_auto_broadcast',
          root: mutationRootB,
          store: storeB,
        },
        importModule: vi.fn(),
        root: loaderRootB,
      });
      installJisoLoader({
        enhancedMutations: {
          fetch,
          formData: () => formData,
          idem: () => 'idem_auto_broadcast',
          root: mutationRootA,
          store: storeA,
        },
        importModule: vi.fn(),
        root: loaderRootA,
      });

      await loaderRootA.listeners.get('submit')?.({
        preventDefault: vi.fn(),
        target: form,
        type: 'submit',
      });

      expect(channelNames).toEqual(['jiso:mutation-response', 'jiso:mutation-response']);
      expect(storeA.get('cart')).toEqual({ count: 4 });
      expect(storeB.get('cart')).toEqual({ count: 4 });
      expect(mutationRootA.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
      expect(mutationRootB.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('imports and invokes a url#export handler only when a matching event arrives', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'data-p-item-id': 'i_42',
      'data-p-quantity': '2',
      'fw-param-types': 'quantity:number',
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
      'fw-state': '{"count":1}',
      'on:click': '/c/a.js#first /c/b.js#second',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(importModule).toHaveBeenNthCalledWith(1, '/c/a.js');
    expect(importModule).toHaveBeenNthCalledWith(2, '/c/b.js');
    expect(calls).toEqual(['first:1:false', 'second:2:false']);
    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('serializes overlapping delegated state writes for the same island', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: number[] = [];
    const handler = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      calls.push(ctx.state.count);
      if (calls.length === 1) {
        await firstCanFinish;
      }
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ increment: handler }));
    const element = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    expect(handler).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(calls).toEqual([0, 1]);
    expect(element.getAttribute('fw-state')).toBe('{"count":2}');
  });

  it('does not serialize delegated state writes across different islands', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const handler = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      if (ctx.state.count === 0) {
        await firstCanFinish;
      }
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async () => ({ increment: handler }));
    const firstElement = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/counter.client.js#increment',
    });
    const secondElement = new FakeElement({
      'fw-state': '{"count":10}',
      'on:click': '/c/counter.client.js#increment',
    });

    const first = dispatchDelegatedEvent({ target: firstElement, type: 'click' }, importModule);
    const second = dispatchDelegatedEvent({ target: secondElement, type: 'click' }, importModule);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));

    expect(handler).toHaveBeenCalledTimes(2);
    await second;
    expect(secondElement.getAttribute('fw-state')).toBe('{"count":11}');

    releaseFirst?.();
    await first;
    expect(firstElement.getAttribute('fw-state')).toBe('{"count":1}');
  });

  it('continues the delegated state queue after a handler rejects', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = vi.fn(async (_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
      await firstCanFinish;
      throw new Error('boom');
    });
    const second = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) =>
      url === '/c/fail.client.js' ? { first } : { second },
    );
    const element = new FakeElement({
      'fw-state': '{"count":0}',
      'on:click': '/c/fail.client.js#first',
    });

    const failed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    element.setAttribute('on:click', '/c/pass.client.js#second');
    const passed = dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    releaseFirst?.();
    await expect(failed).rejects.toThrow('boom');
    await passed;

    expect(element.getAttribute('fw-state')).toBe('{"count":2}');
  });

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

    applyMutationResponseToDom({
      body: '<fw-fragment target="cart-shell"><section></section></fw-fragment>',
      root,
      store: createQueryStore(),
    });

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

  it('hydrates serialized island state for delegated handlers', async () => {
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ CartBadge$button_click: handler }));
    const element = new FakeElement({
      'fw-state': '{"bouncing":false,"count":2}',
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
      'fw-state': '{"count":2}',
      'on:click': '/c/counter.client.js#Counter$button_click',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
  });

  it('persists delegated handler state before reporting a later handler failure', async () => {
    const first = vi.fn((_event, ctx: { state: { count: number } }) => {
      ctx.state.count += 1;
    });
    const importModule = vi.fn(async (url: string) => (url === '/c/a.js' ? { first } : {}));
    const element = new FakeElement({
      'fw-state': '{"count":2}',
      'on:click': '/c/a.js#first /c/b.js#missing',
    });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, importModule),
    ).rejects.toThrow('Handler export not found: /c/b.js#missing');

    expect(element.getAttribute('fw-state')).toBe('{"count":3}');
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

  it('defaults missing or malformed serialized state to an empty object', () => {
    expect(readElementState(new FakeElement({}))).toEqual({});
    expect(readElementState(new FakeElement({ 'fw-state': '{' }))).toEqual({});
  });

  it('parses full handler references and data params', () => {
    expect(parseHandlerReference('/c/cart.client.js?v=1#Cart$remove')).toEqual({
      exportName: 'Cart$remove',
      url: '/c/cart.client.js?v=1',
    });
    expect(parseHandlerReferences('/a.js#one  /b.js#two\n/c.js#three')).toEqual([
      '/a.js#one',
      '/b.js#two',
      '/c.js#three',
    ]);
    expect(readElementParams(new FakeElement({ 'data-p-product-id': 'p1' }))).toEqual({
      productId: 'p1',
    });
    expect(
      readElementParams(
        new FakeElement({
          'data-p-featured': 'false',
          'data-p-product-id': 'p1',
          'data-p-quantity': '2',
          'fw-param-types': 'quantity:number featured:boolean',
        }),
      ),
    ).toEqual({
      featured: false,
      productId: 'p1',
      quantity: 2,
    });
  });

  it('installs declared load, idle, and visible execution triggers', async () => {
    const root = new FakeRoot();
    const loadElement = new FakeElement({ 'on:load': '/c/load.js#start' });
    const idleElement = new FakeElement({ 'on:idle': '/c/idle.js#warm' });
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const idleCallbacks: Array<() => void> = [];
    let visibleCallback: (
      entries: { isIntersecting: boolean; target: FakeElement }[],
    ) => void = () => {};
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const handlers = {
      mount: vi.fn(),
      start: vi.fn(),
      warm: vi.fn(),
    };
    const importModule = vi.fn(async (url: string) => {
      if (url === '/c/load.js') return { start: handlers.start };
      if (url === '/c/idle.js') return { warm: handlers.warm };
      return { mount: handlers.mount };
    });

    root.elements.set('[on\\:load]', [loadElement]);
    root.elements.set('[on\\:idle]', [idleElement]);
    root.elements.set('[on\\:visible]', [visibleElement]);

    installJisoLoader({
      importModule,
      requestIdle: (callback) => {
        idleCallbacks.push(callback);
      },
      root,
      visibleObserver: (callback) => {
        visibleCallback = callback as typeof visibleCallback;
        return observer;
      },
    });

    await vi.waitFor(() => expect(handlers.start).toHaveBeenCalledTimes(1));
    expect(handlers.warm).not.toHaveBeenCalled();
    idleCallbacks[0]?.();
    await vi.waitFor(() => expect(handlers.warm).toHaveBeenCalledTimes(1));

    expect(observer.observe).toHaveBeenCalledWith(visibleElement);
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    await vi.waitFor(() => expect(handlers.mount).toHaveBeenCalledTimes(1));
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
    expect(handlers.mount).toHaveBeenCalledTimes(1);
  });

  it('disposes loader listeners, visible observers, and auto-created broadcasts', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const root = new FakeRoot();
    const focusTarget = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const discardPendingOptimism = vi.fn();
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;
    root.elements.set('[on\\:visible]', [visibleElement]);

    try {
      const loader = installJisoLoader({
        discardPendingOptimism,
        enhancedMutations: {
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        focusTarget,
        importModule: vi.fn(),
        queryRefetch: { fetch: vi.fn() },
        queryStore: store,
        root,
        visibleObserver: () => observer,
      });

      expect(root.listeners.has('click')).toBe(true);
      expect(root.listeners.has('visibilitychange')).toBe(true);
      expect(root.listeners.has('pagehide')).toBe(true);
      expect(focusTarget.listeners.has('focus')).toBe(false);
      expect(observer.observe).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(false);

      loader.dispose();

      expect(root.listeners.size).toBe(0);
      expect(focusTarget.listeners.size).toBe(0);
      expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(true);
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('does not close caller-owned mutation broadcasts on dispose', () => {
    const root = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const close = vi.fn();
    const broadcast: MutationBroadcast = {
      close,
      publish: vi.fn(),
    };

    const loader = installJisoLoader({
      enhancedMutations: {
        broadcast,
        fetch: vi.fn(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      root,
    });

    loader.dispose();

    expect(close).not.toHaveBeenCalled();
  });
});

describe('query store', () => {
  it('makes queries introduced by enhanced mutations eligible for visible-return refetch', async () => {
    const loaderRoot = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const refetchOnFocus = vi.fn();
    const formData = new FormData();
    const form = new FakeFormElement(
      {
        enhance: '',
        'data-mutation': 'recommendations/refresh',
      },
      {
        action: '/_m/recommendations/refresh',
        method: 'post',
      },
    );
    loaderRoot.scripts = [
      {
        getAttribute: (name) => (name === 'fw-query' ? 'cart' : null),
        textContent: '{"count":1}',
      },
    ];
    const mutationFetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      async text() {
        return '<fw-query name="recommendations">{"items":["p1"]}</fw-query>';
      },
    }));
    const refetchFetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () =>
        url === '/_q/cart'
          ? '<fw-query name="cart">{"count":2}</fw-query>'
          : '<fw-query name="recommendations">{"items":["p2"]}</fw-query>',
    }));

    installJisoLoader({
      enhancedMutations: {
        fetch: mutationFetch,
        formData: () => formData,
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      queryRefetch: { fetch: refetchFetch },
      queryStore: store,
      refetchOnFocus,
      root: loaderRoot,
    });

    await loaderRoot.listeners.get('submit')?.({
      preventDefault: vi.fn(),
      target: form,
      type: 'submit',
    });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(store.get('recommendations')).toEqual({ items: ['p1'] });

    loaderRoot.visibilityState = 'visible';
    await loaderRoot.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    expect(refetchOnFocus).toHaveBeenCalledWith(['cart', 'recommendations']);
    expect(refetchFetch).toHaveBeenNthCalledWith(1, '/_q/cart', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(refetchFetch).toHaveBeenNthCalledWith(2, '/_q/recommendations', {
      headers: { Accept: 'text/html', 'FW-Fragment': 'true' },
      method: 'GET',
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(store.get('recommendations')).toEqual({ items: ['p2'] });
  });

  it('registers pagehide optimism cleanup without unload handlers', () => {
    const root = new FakeRoot();
    const discardPendingOptimism = vi.fn();

    installPagehideOptimismCleanup({ discardPendingOptimism, root });

    expect(root.listeners.has('pagehide')).toBe(true);
    expect(root.listeners.has('unload')).toBe(false);

    void root.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(discardPendingOptimism).toHaveBeenCalledTimes(1);
  });

  it('applies query update bindings from mutation chunks without requiring a fragment', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const total = new FakeQueryBindingElement('cart.total', { value: '1499' });
    const product = new FakeQueryBindingElement('product.name', { textContent: 'Coffee' });
    root.bindings.push(count, total, product);

    const result = applyMutationResponseToDom({
      body: '<fw-query name="cart">{"count":2,"total":2998}</fw-query>',
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: [],
      fragments: [],
      queries: ['cart'],
    });
    expect(count.textContent).toBe('2');
    expect(total.value).toBe('2998');
    expect(product.textContent).toBe('Coffee');
  });

  it('applies query update bindings from deferred chunks before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyDeferredChunkToDom({
      body: [
        '<fw-query name="cart">{"count":4}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`binding:${count.textContent}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['binding:4']);
  });

  it('exposes a DOM-light data-bind update plan helper', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const items = new FakeQueryBindingElement('cart.items', { textContent: '' });
    root.bindings.push(count, items);

    expect(applyQueryBindings(root, 'cart', { count: 3, items: [{ id: 'p1' }] })).toEqual([
      'cart.count',
      'cart.items',
    ]);
    expect(count.textContent).toBe('3');
    expect(items.textContent).toBe('[{"id":"p1"}]');
  });

  it('applies optional binding path segments and removes empty attribute bindings', () => {
    const root = new FakeMorphRoot();
    const name = new FakeQueryBindingElement('deal.contact?.name', { textContent: 'Ada' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'Ada',
      'data-bind:aria-label': 'deal.contact?.name',
    });
    root.bindings.push(name);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'deal', { contact: null })).toEqual([
      'deal.contact?.name',
      'deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'deal', { contact: { name: 'Grace' } });
    expect(name.textContent).toBe('Grace');
    expect(label.getAttribute('aria-label')).toBe('Grace');
  });

  it('runs compiled query update plans in bindings -> named derives -> stamps order', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement(
      { 'data-derive': 'cart.summary' },
      { textContent: '1 item' },
    );
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      { count: 2 },
      {
        derives: [
          {
            name: 'summary',
            select(value) {
              observed.push(`derive sees binding:${count.textContent}`);
              return `${(value as { count: number }).count} items`;
            },
          },
        ],
        stamps: [
          {
            attr: 'data-cart-summary',
            selector: '[data-plan="cart-host"]',
            select() {
              observed.push(`stamp sees derive:${summary.textContent}`);
              return summary.textContent;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: ['cart.count'],
      derives: ['summary'],
      stamps: ['data-cart-summary'],
      templateStamps: [],
    });
    expect(observed).toEqual(['derive sees binding:2', 'stamp sees derive:2 items']);
    expect(count.textContent).toBe('2');
    expect(summary.textContent).toBe('2 items');
    expect(host.getAttribute('data-cart-summary')).toBe('2 items');
  });

  it('removes compiled attribute stamps when the selected value is empty', () => {
    const root = new FakeMorphRoot();
    const host = new FakeQueryPlanElement({ 'aria-label': 'Ada', 'data-plan': 'deal-host' });
    root.planElements.push(host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'deal',
      { contact: null },
      {
        bindings: false,
        stamps: [
          {
            attr: 'aria-label',
            selector: '[data-plan="deal-host"]',
            select(value) {
              return (value as { contact: { name: string } | null }).contact?.name;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: ['aria-label'],
      templateStamps: [],
    });
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('declares named derive inputs beside the pure derive function', () => {
    const isEmpty = derive(['cart'], (cart) => (cart as { count: number }).count === 0);

    expect(isEmpty.inputs).toEqual(['cart']);
    expect(isEmpty.run({ count: 0 })).toBe(true);
    expect(isEmpty.run({ count: 2 })).toBe(false);
  });

  it('reconciles compiled template stamps with keyed item descriptors', () => {
    const root = new FakeMorphRoot();
    const list = new FakeTemplateStampHost({
      'data-bind-list': 'cart.items',
      'fw-key': 'productId',
    });
    root.planElements.push(list);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      {
        items: [
          { name: 'Mug', productId: 'p1', qty: 2 },
          { name: 'Beans', productId: 'p2', qty: 1 },
        ],
      },
      {
        bindings: false,
        templateStamps: [
          {
            key: 'productId',
            list: 'items',
            render(item) {
              const product = item as { name: string; qty: number };
              return `<li><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: [],
      templateStamps: ['[data-bind-list="cart.items"]'],
    });
    expect(list.items.map((item) => item.key)).toEqual(['p1', 'p2']);
    expect(list.items.map((item) => item.index)).toEqual([0, 1]);
    expect(list.textContent).toBe(
      '<li><span data-bind=".qty">2</span> x <span data-bind=".name">Mug</span></li><li><span data-bind=".qty">1</span> x <span data-bind=".name">Beans</span></li>',
    );
  });

  it('applies mutation query chunks through compiled update plans before morphing', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.targets.set('cart-badge', new FakeMorphTarget());

    applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>Ready</cart-badge></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${count.textContent}:${summary.textContent}:${host.getAttribute('data-count')}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="cart-host"]',
              select: (value) => (value as { count: number }).count,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual(['morph:5:5 items:5']);
  });

  it('lets mutation DOM apply interpose query writes before compiled plans run', () => {
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const observedQueries: string[] = [];
    root.bindings.push(count);

    const result = applyMutationResponseToDom({
      applyQuery(query) {
        observedQueries.push(`${query.name}:${query.key ?? ''}`);
        store.set(query.name, { count: (query.value as { count: number }).count + 10 }, query.key);
        return { value: store.get(query.name, query.key) };
      },
      body: '<fw-query name="cart">{"count":5}</fw-query>',
      queryPlans: { cart: { bindings: true } },
      root,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(observedQueries).toEqual(['cart:']);
    expect(store.get('cart')).toEqual({ count: 15 });
    expect(count.textContent).toBe('15');
  });

  it('applies deferred stream chunks through the same query and fragment parser', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.subscribe('reviews', plan, 'product:p1');

    const applied = applyDeferredChunk(
      store,
      [
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section fw-c="reviews">Ready</section></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1', rating: 5 }] });
    expect(plan).toHaveBeenCalledWith({ items: [{ id: 'r1', rating: 5 }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section fw-c="reviews">Ready</section>', target: 'reviews:p1' }],
      queries: ['reviews'],
    });
  });

  it('skips malformed deferred query chunks while applying valid fragments', () => {
    const store = createQueryStore();
    const applied = applyDeferredChunk(
      store,
      [
        '<fw-query name="reviews">{</fw-query>',
        '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section>Ready</section></fw-fragment>',
      ].join('\n'),
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('recommendations')).toEqual({ items: [{ id: 'p2' }] });
    expect(applied).toEqual({
      fragments: [{ html: '<section>Ready</section>', target: 'reviews:p1' }],
      queries: ['recommendations'],
    });
  });

  it('keeps keyed query chunks isolated by instance key', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const p2Plan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', p1Plan, 'product:p1');
    store.subscribe('reviews', p2Plan, 'product:p2');
    store.subscribe('reviews', unkeyedPlan);

    applyDeferredChunk(
      store,
      [
        '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-query name="reviews" key="product:p2">{"items":[{"id":"r2"}]}</fw-query>',
      ].join('\n'),
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(store.get('reviews', 'product:p2')).toEqual({ items: [{ id: 'r2' }] });
    expect(p1Plan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(p2Plan).toHaveBeenCalledWith({ items: [{ id: 'r2' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('updates deferred query data before morphing deferred fragments', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`plan:${JSON.stringify(value)}`);
    });

    const result = applyDeferredChunkToDom({
      body: [
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section></fw-fragment>',
      ].join('\n'),
      morph(target, html) {
        observed.push(`morph:${JSON.stringify(store.get('reviews'))}`);
        target.replaceWithHtml(html);
      },
      root,
      store,
    });

    expect(observed).toEqual(['plan:{"items":[{"id":"r1"}]}', 'morph:{"items":[{"id":"r1"}]}']);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1'],
      fragments: [
        {
          html: '<link rel="stylesheet" href="/assets/reviews.css"><section>Ready</section>',
          target: 'reviews:p1',
        },
      ],
      queries: ['reviews'],
    });
    expect(root.targets.get('reviews:p1')?.html).toContain('/assets/reviews.css');
  });

  it('applies full deferred stream responses in boundary order', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const observed: string[] = [];
    const reviewsSummary = new FakeQueryPlanElement({ 'data-derive': 'reviews.summary' });
    const recommendationsHost = new FakeQueryPlanElement({ 'data-plan': 'recommendations-host' });
    root.planElements.push(reviewsSummary, recommendationsHost);
    root.targets.set('reviews:p1', new FakeMorphTarget());
    root.targets.set('recommendations:p1', new FakeMorphTarget());
    store.subscribe('reviews', (value) => {
      observed.push(`reviews-plan:${JSON.stringify(value)}`);
    });
    store.subscribe('recommendations', (value) => {
      observed.push(`recommendations-plan:${JSON.stringify(value)}`);
    });

    const result = applyDeferredStreamResponseToDom({
      body: [
        '<!doctype html><html><body><fw-defer target="reviews:p1"></fw-defer>',
        '--jiso-boundary',
        '<fw-query name="reviews">{"items":[{"id":"r1"}]}</fw-query>',
        '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
        '--jiso-boundary',
        '<fw-query name="recommendations">{"items":[{"id":"p2"}]}</fw-query>',
        '<fw-fragment target="recommendations:p1"><section>Recommendations ready</section></fw-fragment>',
        '--jiso-boundary--',
        '</body></html>',
      ].join('\n'),
      morph(target, html) {
        observed.push(
          `morph:${html}:${reviewsSummary.textContent}:${recommendationsHost.getAttribute(
            'data-count',
          )}:${JSON.stringify({
            recommendations: store.get('recommendations'),
            reviews: store.get('reviews'),
          })}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        recommendations: {
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="recommendations-host"]',
              select: (value) => (value as { items: unknown[] }).items.length,
            },
          ],
        },
        reviews: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { items: unknown[] }).items.length} review`,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(observed).toEqual([
      'reviews-plan:{"items":[{"id":"r1"}]}',
      'morph:<section>Reviews ready</section>:1 review:null:{"reviews":{"items":[{"id":"r1"}]}}',
      'recommendations-plan:{"items":[{"id":"p2"}]}',
      'morph:<section>Recommendations ready</section>:1 review:1:{"recommendations":{"items":[{"id":"p2"}]},"reviews":{"items":[{"id":"r1"}]}}',
    ]);
    expect(result).toEqual({
      appliedFragments: ['reviews:p1', 'recommendations:p1'],
      chunks: [
        {
          appliedFragments: ['reviews:p1'],
          fragments: [{ html: '<section>Reviews ready</section>', target: 'reviews:p1' }],
          queries: ['reviews'],
        },
        {
          appliedFragments: ['recommendations:p1'],
          fragments: [
            {
              html: '<section>Recommendations ready</section>',
              target: 'recommendations:p1',
            },
          ],
          queries: ['recommendations'],
        },
      ],
      fragments: [
        { html: '<section>Reviews ready</section>', target: 'reviews:p1' },
        { html: '<section>Recommendations ready</section>', target: 'recommendations:p1' },
      ],
      queries: ['reviews', 'recommendations'],
    });
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
    expect(root.targets.get('recommendations:p1')?.html).toBe(
      '<section>Recommendations ready</section>',
    );
  });

  it('rebroadcasts and applies mutation responses for same-user tab sync', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const onChanges = vi.fn();
    const broadcast = installMutationBroadcast({ channel, onChanges, store });

    broadcast.publish('<fw-query name="cart">{"count":5}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
    ] as never);
    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":5}</fw-query>',
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":6}</fw-query>',
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('rebroadcasts keyed query chunks to the matching keyed store entry', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const keyedPlan = vi.fn();
    const unkeyedPlan = vi.fn();

    store.subscribe('reviews', keyedPlan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);
    installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"}]}</fw-query>',
        changes: [{ domain: 'product', keys: ['p1'] }],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
    expect(keyedPlan).toHaveBeenCalledWith({ items: [{ id: 'r1' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();
  });

  it('morphs rebroadcast mutation fragments when a root is configured', () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>0</cart-badge>'));

    installMutationBroadcast({
      channel,
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}`);
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
        },
      },
      root,
      store,
    });

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":6}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>6</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    });

    expect(store.get('cart')).toEqual({ count: 6 });
    expect(observed).toEqual(['morph:6:6 items']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>6</cart-badge>');
  });

  it('syncs mutation responses from one tab to another over BroadcastChannel', () => {
    const hub = new FakeBroadcastHub();
    const channelA = new FakeBroadcastChannel(hub);
    const channelB = new FakeBroadcastChannel(hub);
    const storeA = createQueryStore();
    const storeB = createQueryStore();
    const onChangesA = vi.fn();
    const onChangesB = vi.fn();
    const rootB = new FakeMorphRoot();
    rootB.targets.set('cart-badge', new FakeMorphTarget('<cart-badge>1</cart-badge>'));

    const broadcastA = installMutationBroadcast({
      channel: channelA,
      onChanges: onChangesA,
      store: storeA,
    });
    installMutationBroadcast({
      channel: channelB,
      onChanges: onChangesB,
      root: rootB,
      store: storeB,
    });

    broadcastA.publish(
      [
        '<fw-query name="cart">{"count":5}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
      ].join('\n'),
      [{ domain: 'cart', keys: ['cart_1'] }],
    );

    expect(channelA.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":5}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>5</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart', keys: ['cart_1'] }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(channelB.messages).toEqual([]);
    expect(storeA.get('cart')).toBeUndefined();
    expect(onChangesA).not.toHaveBeenCalled();
    expect(storeB.get('cart')).toEqual({ count: 5 });
    expect(rootB.targets.get('cart-badge')?.html).toBe('<cart-badge>5</cart-badge>');
    expect(onChangesB).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart_1'] }]);
  });

  it('applies hand-written optimistic transforms through query update plans', () => {
    const store = createQueryStore();
    const plan = vi.fn();
    store.set('cart', { count: 1 });
    store.subscribe('cart', plan);

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(plan).toHaveBeenLastCalledWith({ count: 3 });
    pending.commit();
    expect(pending.snapshot.size).toBe(0);
  });

  it('applies hand-written optimistic transforms to keyed query instances', () => {
    const store = createQueryStore();
    const p1Plan = vi.fn();
    const unkeyedPlan = vi.fn();
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    store.subscribe('reviews', p1Plan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);

    const pending = applyOptimisticTransforms(
      store,
      { reviewId: 'draft' },
      {
        keys: { reviews: 'product:p1' },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft' }],
    });
    expect(p1Plan).toHaveBeenLastCalledWith({ items: [{ id: 'r1' }, { id: 'draft' }] });
    expect(unkeyedPlan).not.toHaveBeenCalled();

    pending.restore();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
  });

  it('applies optimistic transforms from unified change records and derives query keys', () => {
    const store = createQueryStore();
    const keyedPlan = vi.fn();
    const unkeyedPlan = vi.fn();
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    store.subscribe('reviews', keyedPlan, 'product:p1');
    store.subscribe('reviews', unkeyedPlan);

    const pending = applyOptimisticTransforms(
      store,
      { reviewId: 'ignored' },
      {
        keys: {
          reviews: (change) => `product:${change.keys?.[0]}`,
        },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
      {
        domain: 'product',
        input: { reviewId: 'draft-from-change' },
        keys: ['p1'],
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft-from-change' }],
    });
    expect(keyedPlan).toHaveBeenLastCalledWith({
      items: [{ id: 'r1' }, { id: 'draft-from-change' }],
    });
    expect(unkeyedPlan).not.toHaveBeenCalled();

    pending.restore();
    expect(store.get('reviews', 'product:p1')).toEqual({ items: [{ id: 'r1' }] });
  });

  it('types hand-written optimistic plans from mutation forms and query shapes', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current, input) {
          return {
            count: current.count + input.quantity,
            productIds: [...current.productIds, input.productId],
          };
        },
      },
    } satisfies OptimisticFor<typeof addToCart, { cart: { count: number; productIds: string[] } }>;

    expect(
      optimistic.transforms.cart(
        { count: 1, productIds: [] },
        {
          productId: 'p1',
          quantity: 2,
        },
      ),
    ).toEqual({
      count: 3,
      productIds: ['p1'],
    });
  });

  it('requires optimistic coverage from generated invalidation sets by default', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const optimistic = {
      transforms: {
        cart(current, input) {
          return {
            count: current.count + input.quantity,
          };
        },
        productGrid: 'await-fragment',
      },
    } satisfies OptimisticFor<typeof addToCart>;

    expect(optimistic.transforms.productGrid).toBe('await-fragment');

    const assertMissingCoverageRejected = () => {
      ({
        // @ts-expect-error productGrid is invalidated by cart/add and needs a transform or await-fragment.
        transforms: {
          cart(current, input) {
            return {
              count: current.count + input.quantity,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart>;
    };

    expect(assertMissingCoverageRejected).toBeTypeOf('function');
  });

  it('rejects optimistic plans that do not match mutation input or query values', () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const assertWrongInputRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error sku is not part of the mutation input schema.
              count: current.count + input.sku,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };
    const assertWrongQueryValueRejected = () => {
      ({
        transforms: {
          cart(current, input) {
            return {
              // @ts-expect-error missingCount is not part of the cart query value.
              count: current.missingCount + input.quantity,
            };
          },
        },
      }) satisfies OptimisticFor<typeof addToCart, { cart: { count: number } }>;
    };

    expect(assertWrongInputRejected).toBeTypeOf('function');
    expect(assertWrongQueryValueRejected).toBeTypeOf('function');
  });

  it('restores optimistic snapshots on mutation error', () => {
    const store = createQueryStore();
    store.set('cart', { count: 1 });

    const pending = applyOptimisticTransforms(
      store,
      { quantity: 2 },
      {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
    );

    expect(store.get('cart')).toEqual({ count: 3 });
    pending.restore();
    expect(store.get('cart')).toEqual({ count: 1 });
  });

  it('stamps and clears pending state on islands consuming optimistic queries', () => {
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const recommendations = new FakePendingElement({ 'fw-deps': 'product:p1 cart' });
    const profile = new FakePendingElement({ 'fw-deps': 'profile' });
    const root = new FakePendingRoot([cartBadge, recommendations, profile]);

    expect(stampPendingQueries(root, ['cart'], true)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(recommendations.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
    expect(profile.attributes).not.toHaveProperty('fw-pending');

    expect(stampPendingQueries(root, ['cart'], false)).toEqual(['cart', 'product:p1,cart']);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(recommendations.attributes).not.toHaveProperty('fw-pending');
    expect(recommendations.attributes).not.toHaveProperty('aria-busy');
  });

  it('rebases pending optimistic transforms over arriving server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });

    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(2);

    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    rebaser.settle('m1');
    rebaser.applyServerTruth('cart', { count: 11 });

    expect(store.get('cart')).toEqual({ count: 13 });
    expect(rebaser.pendingCount('cart')).toBe(1);
  });

  it('rebases pending optimistic transforms over keyed server truth', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
    const transform = (current: unknown, input: { reviewId: string }) => {
      const reviews = current as { items: { id: string }[] };
      return { items: [...reviews.items, { id: input.reviewId }] };
    };

    rebaser.add(
      'm1',
      { reviewId: 'draft-1' },
      {
        keys: { reviews: 'product:p1' },
        transforms: { reviews: transform },
      },
    );
    rebaser.add(
      'm2',
      { reviewId: 'draft-2' },
      {
        keys: { reviews: 'product:p1' },
        transforms: { reviews: transform },
      },
    );

    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'draft-1' }, { id: 'draft-2' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(2);

    rebaser.applyServerTruth('reviews', { items: [{ id: 'r1' }, { id: 'server' }] }, 'product:p1');

    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }, { id: 'draft-1' }, { id: 'draft-2' }],
    });

    rebaser.settle('m1');
    rebaser.applyServerTruth('reviews', { items: [{ id: 'r1' }, { id: 'server' }] }, 'product:p1');

    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }, { id: 'draft-2' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(1);
  });

  it('discards pending optimistic transforms back to server truth on pagehide', () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    store.set('cart', { count: 0 });
    const transform = (current: unknown, input: { quantity: number }) => {
      const cart = current as { count: number };
      return { count: cart.count + input.quantity };
    };

    rebaser.add('m1', { quantity: 1 }, { transforms: { cart: transform } });
    rebaser.add('m2', { quantity: 2 }, { transforms: { cart: transform } });
    rebaser.applyServerTruth('cart', { count: 10 });

    expect(store.get('cart')).toEqual({ count: 13 });

    expect(rebaser.discardPendingOptimism()).toEqual(['cart']);

    expect(store.get('cart')).toEqual({ count: 10 });
    expect(rebaser.pendingCount('cart')).toBe(0);
  });

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
    root.targets.set('product-grid', new FakeMorphTarget('<article fw-key="p1"></article>'));
    const store = createQueryStore();

    const result = applyMutationResponseToDom({
      body: '<fw-fragment target="product-grid" mode="append"><article fw-key="p2"></article></fw-fragment>',
      root,
      store,
    });

    expect(result.fragments).toEqual([
      {
        html: '<article fw-key="p2"></article>',
        mode: 'append',
        target: 'product-grid',
      },
    ]);
    expect(result.appliedFragments).toEqual(['product-grid']);
    expect(root.targets.get('product-grid')?.html).toBe(
      '<article fw-key="p1"></article><article fw-key="p2"></article>',
    );
  });

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

  it('updates query data and morphs fragments from one mutation response', () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    root.targets.set('cart-badge', new FakeMorphTarget());

    const result = applyMutationResponseToDom({
      body: [
        '<fw-query name="cart">{"count":7}</fw-query>',
        '<fw-fragment target="cart-badge"><cart-badge><span data-bind="cart.count">7</span></cart-badge></fw-fragment>',
      ].join('\n'),
      root,
      store,
    });

    expect(result).toEqual({
      appliedFragments: ['cart-badge'],
      fragments: [
        {
          html: '<cart-badge><span data-bind="cart.count">7</span></cart-badge>',
          target: 'cart-badge',
        },
      ],
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 7 });
    expect(root.targets.get('cart-badge')?.html).toContain('data-bind="cart.count"');
  });

  it('submits enhanced mutation forms with live targets and applies the fragment response', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host);
    root.deps = [
      { deps: 'cart', id: 'cart-badge' },
      { deps: 'product:p1', target: 'recommendations' },
      { deps: 'cart', id: 'cart-badge' },
    ];
    root.targets.set('cart-badge', new FakeMorphTarget());
    root.targets.set('recommendations', new FakeMorphTarget());
    const formData = new FormData();
    formData.set('productId', 'p1');
    formData.set('quantity', '1');
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes'
            ? '[{"domain":"cart","input":{"productId":"p1","quantity":"1"}}]'
            : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      broadcast,
      idem: 'idem_01HX',
      morph(target, html) {
        observed.push(
          `morph:${count.textContent}:${summary.textContent}:${host.getAttribute('data-count')}`,
        );
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
          stamps: [
            {
              attr: 'data-count',
              selector: '[data-plan="cart-host"]',
              select: (value) => (value as { count: number }).count,
            },
          ],
        },
      },
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_01HX',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result).toEqual({
      appliedFragments: ['cart-badge', 'recommendations'],
      fragments: [
        { html: '<cart-badge>1</cart-badge>', target: 'cart-badge' },
        { html: '<section></section>', target: 'recommendations' },
      ],
      changes: [{ domain: 'cart' }],
      idem: 'idem_01HX',
      queries: ['cart'],
      targets: ['cart-badge=cart', 'recommendations=product:p1'],
    });
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":1}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
          '<fw-fragment target="recommendations"><section></section></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(observed).toEqual(['morph:1:1 items:1', 'morph:1:1 items:1']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>1</cart-badge>');
    expect(root.targets.get('recommendations')?.html).toBe('<section></section>');
  });

  it('ignores malformed FW-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      root,
      store,
    });

    expect(result.changes).toEqual([]);
    expect(result.queries).toEqual(['cart']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [],
        type: 'jiso:mutation-response',
      },
    ]);
  });

  it('reports malformed FW-Changes headers while applying successful mutation bodies', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    root.deps = [{ deps: 'cart', id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get(name: string) {
          return name === 'FW-Changes' ? '[' : null;
        },
      },
      async text() {
        return [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join('\n');
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      onError,
      root,
      store,
    });

    expect(result.changes).toEqual([]);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>2</cart-badge>');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('Malformed JSON in FW-Changes header');
  });

  it('reports direct enhanced mutation fetch failures and clears pending state', async () => {
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const pendingRoot = new FakePendingRoot([new FakePendingElement({ 'fw-deps': 'cart' })]);
    const onError = vi.fn();
    const error = new Error('network down');
    const fetch = vi.fn(async () => {
      const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
      expect(pending?.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });
      throw error;
    });

    await expect(
      submitEnhancedMutation({
        fetch,
        form: { action: '/_m/cart/add', method: 'post' },
        formData: new FormData(),
        onError,
        pendingQueries: ['cart'],
        pendingRoot,
        root,
        store,
      }),
    ).rejects.toBe(error);

    const pending = [...pendingRoot.querySelectorAll('[fw-deps]')][0];
    expect(onError).toHaveBeenCalledWith(error);
    expect(pending?.attributes).not.toHaveProperty('fw-pending');
    expect(pending?.attributes).not.toHaveProperty('aria-busy');
  });

  it('does not rebroadcast failed enhanced mutation responses', async () => {
    const store = createQueryStore();
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    const fetch = vi.fn(async () => ({
      headers: {
        get() {
          return null;
        },
      },
      ok: false,
      status: 422,
      async text() {
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
      },
    }));

    const result = await submitEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      root,
      store,
    });

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(channel.messages).toEqual([]);
  });

  it('submits enhanced mutations with optimistic transforms and reconciles server truth', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const channel = new FakeBroadcastChannel();
    const broadcast = installMutationBroadcast({ channel, store });
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 1 });

    const fetch = vi.fn(async () => {
      expect(store.get('cart')).toEqual({ count: 3 });
      expect(cartBadge.attributes).toMatchObject({
        'aria-busy': 'true',
        'fw-pending': '',
      });

      return {
        headers: {
          get(name: string) {
            return name === 'FW-Changes'
              ? '[{"domain":"cart","input":{"productId":"p1","quantity":2}}]'
              : null;
          },
        },
        async text() {
          return [
            '<fw-query name="cart">{"count":4}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
          ].join('\n');
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      broadcast,
      idem: 'idem_optimistic',
      input: { quantity: 2 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual(['cart']);
    expect(result.changes).toEqual([{ domain: 'cart' }]);
    expect(channel.messages).toEqual([
      {
        body: [
          '<fw-query name="cart">{"count":4}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>4</cart-badge></fw-fragment>',
        ].join('\n'),
        changes: [{ domain: 'cart' }],
        type: 'jiso:mutation-response',
      },
    ]);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>4</cart-badge>');
  });

  it('cleans up mid-flight optimistic navigation while the keepalive mutation continues', async () => {
    const lifecycleRoot = new FakeRoot();
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    let releaseFetch: (() => void) | undefined;
    store.set('cart', { count: 1 });

    installPagehideOptimismCleanup({
      discardPendingOptimism() {
        const discarded = rebaser.discardPendingOptimism();
        stampPendingQueries(pendingRoot, discarded, false);
        return discarded;
      },
      root: lifecycleRoot,
    });

    const fetch = vi.fn(
      async (_url: string, options: EnhancedMutationFetchOptions) =>
        new Promise<{
          text(): Promise<string>;
        }>((resolve) => {
          expect(options.keepalive).toBe(true);
          releaseFetch = () => {
            resolve({
              async text() {
                return '<fw-query name="cart">{"count":2}</fw-query>';
              },
            });
          };
        }),
    );

    const formData = new FormData();
    formData.set('quantity', '2');
    const submit = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData,
      idem: 'idem_bfcache',
      input: { quantity: 2 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });

    // SPEC.md §8/§10.4: pagehide is the bfcache-safe teardown point; the
    // optimistic log dies with the document while the POST continues keepalive.
    void lifecycleRoot.listeners.get('pagehide')?.({ target: null, type: 'pagehide' });

    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: formData,
      headers: {
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_bfcache',
        'FW-Targets': '',
      },
      keepalive: true,
      method: 'POST',
    });

    releaseFetch?.();

    await expect(submit).resolves.toMatchObject({
      idem: 'idem_bfcache',
      queries: ['cart'],
    });
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
  });

  it('reconciles keyed optimistic enhanced submits with keyed query chunks', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    root.targets.set('reviews:p1', new FakeMorphTarget());
    store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');

    const fetch = vi.fn(async () => {
      expect(store.get('reviews')).toBeUndefined();
      expect(store.get('reviews', 'product:p1')).toEqual({
        items: [{ id: 'r1' }, { id: 'draft' }],
      });

      return {
        async text() {
          return [
            '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</fw-query>',
            '<fw-fragment target="reviews:p1"><section>Reviews ready</section></fw-fragment>',
          ].join('\n');
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/reviews/add', method: 'post' },
      formData: new FormData(),
      change: {
        domain: 'product',
        input: { reviewId: 'draft' },
        keys: ['p1'],
      },
      idem: 'idem_keyed_optimistic',
      input: { reviewId: 'ignored' },
      optimistic: {
        keys: { reviews: (change) => `product:${change.keys?.[0]}` },
        transforms: {
          reviews(current, input) {
            const reviews = current as { items: { id: string }[] };
            return { items: [...reviews.items, { id: input.reviewId }] };
          },
        },
      },
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual(['reviews']);
    expect(store.get('reviews')).toBeUndefined();
    expect(store.get('reviews', 'product:p1')).toEqual({
      items: [{ id: 'r1' }, { id: 'server' }],
    });
    expect(rebaser.pendingCount('reviews', 'product:p1')).toBe(0);
    expect(root.targets.get('reviews:p1')?.html).toBe('<section>Reviews ready</section>');
  });

  it('runs optimistic enhanced submits with the same named queue sequentially', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const queue = new MutationQueue();
    const root = new FakeMorphRoot();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    store.set('cart', { count: 0 });

    const optimistic = {
      queue: 'cart',
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          order.push(`${input.quantity}:optimistic`);
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const quantityEntry = (options.body as FormData).get('quantity');
      const quantity = typeof quantityEntry === 'string' ? quantityEntry : '';
      order.push(`${quantity}:fetch`);

      if (quantity === '1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('1:released');
      }

      return {
        async text() {
          return `<fw-query name="cart">{"count":${quantity === '1' ? 1 : 3}}</fw-query>`;
        },
      };
    });

    const firstFormData = new FormData();
    firstFormData.set('quantity', '1');
    const secondFormData = new FormData();
    secondFormData.set('quantity', '2');

    const first = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: firstFormData,
      idem: 'idem_first',
      input: { quantity: 1 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });
    const second = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: secondFormData,
      idem: 'idem_second',
      input: { quantity: 2 },
      optimistic,
      queue,
      rebaser,
      root,
      store,
    });

    await Promise.resolve();

    expect(order).toEqual(['1:optimistic', '1:fetch']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(queue.pending('cart')).toBe(true);

    releaseFirst?.();

    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { idem: 'idem_first', queries: ['cart'] },
      { idem: 'idem_second', queries: ['cart'] },
    ]);
    expect(order).toEqual(['1:optimistic', '1:fetch', '1:released', '2:optimistic', '2:fetch']);
    expect(store.get('cart')).toEqual({ count: 3 });
    expect(queue.pending('cart')).toBe(false);
  });

  it('starts unqueued optimistic enhanced submits directly', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    store.set('cart', { count: 0 });
    const fetch = vi.fn(async () => ({
      async text() {
        return '<fw-query name="cart">{"count":2}</fw-query>';
      },
    }));

    const result = submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_direct',
      input: { quantity: 1 },
      optimistic: {
        queue: 'cart',
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      rebaser,
      root,
      store,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get('cart')).toEqual({ count: 1 });

    await expect(result).resolves.toMatchObject({ idem: 'idem_direct', queries: ['cart'] });
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('rebases other pending optimism while reconciling an optimistic submit', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    root.deps = [{ id: 'cart-badge' }];
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async () => {
      rebaser.add('idem_second', { quantity: 5 }, optimistic);
      expect(store.get('cart')).toEqual({ count: 7 });

      return {
        async text() {
          return [
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>server</cart-badge></fw-fragment>',
          ].join('\n');
        },
      };
    });

    await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}:${html}`);
        target.replaceWithHtml(html);
      },
      optimistic,
      pendingRoot,
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
        },
      },
      rebaser,
      root,
      store,
    });

    expect(store.get('cart')).toEqual({ count: 7 });
    expect(count.textContent).toBe('7');
    expect(summary.textContent).toBe('7 items');
    expect(observed).toEqual(['morph:7:7 items:<cart-badge>server</cart-badge>']);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>server</cart-badge>');
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('reports omitted optimistic server truth and preserves other pending transforms', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });
    const optimistic = {
      transforms: {
        cart(current: unknown, input: { quantity: number }) {
          const cart = current as { count: number };
          return { count: cart.count + input.quantity };
        },
      },
    };
    const fetch = vi.fn(async () => {
      rebaser.add('idem_second', { quantity: 5 }, optimistic);
      expect(store.get('cart')).toEqual({ count: 7 });

      return {
        async text() {
          return '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>';
        },
      };
    });

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_first',
      input: { quantity: 2 },
      onError,
      optimistic,
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
    expect(store.get('cart')).toEqual({ count: 5 });
    expect(rebaser.pendingCount('cart')).toBe(1);
    expect(cartBadge.attributes).toMatchObject({
      'aria-busy': 'true',
      'fw-pending': '',
    });
  });

  it('reports malformed optimistic server query chunks while applying unrelated fragments', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartBadge = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartBadge]);
    const onError = vi.fn();
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    store.set('cart', { count: 0 });

    const result = await submitOptimisticEnhancedMutation({
      fetch: vi.fn(async () => ({
        async text() {
          return [
            '<fw-query name="cart">{</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>stale</cart-badge></fw-fragment>',
          ].join('\n');
        },
      })),
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      idem: 'idem_malformed_optimistic',
      input: { quantity: 2 },
      onError,
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.queries).toEqual([]);
    expect(root.targets.get('cart-badge')?.html).toBe('<cart-badge>stale</cart-badge>');
    expect(store.get('cart')).toEqual({ count: 0 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartBadge.attributes).not.toHaveProperty('fw-pending');
    expect(cartBadge.attributes).not.toHaveProperty('aria-busy');
    expect(onError).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringContaining('Malformed JSON in fw-query cart'),
      }),
    );
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Optimistic transform for cart was not covered by server query truth.',
      }),
    );
  });

  it('discards optimistic state on enhanced mutation errors and applies the error fragment', async () => {
    const store = createQueryStore();
    const rebaser = new OptimisticRebaser(store);
    const root = new FakeMorphRoot();
    const cartForm = new FakePendingElement({ 'fw-deps': 'cart' });
    const pendingRoot = new FakePendingRoot([cartForm]);
    root.deps = [{ id: 'cart-form' }];
    root.targets.set('cart-form', new FakeMorphTarget());
    store.set('cart', { count: 1 });
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      async text() {
        return '<fw-fragment target="cart-form"><form>Out of stock</form></fw-fragment>';
      },
    }));

    const result = await submitOptimisticEnhancedMutation({
      fetch,
      form: { action: '/_m/cart/add', method: 'post' },
      formData: new FormData(),
      input: { quantity: 2 },
      optimistic: {
        transforms: {
          cart(current, input) {
            const cart = current as { count: number };
            return { count: cart.count + input.quantity };
          },
        },
      },
      pendingRoot,
      rebaser,
      root,
      store,
    });

    expect(result.appliedFragments).toEqual(['cart-form']);
    expect(store.get('cart')).toEqual({ count: 1 });
    expect(rebaser.pendingCount('cart')).toBe(0);
    expect(cartForm.attributes).not.toHaveProperty('fw-pending');
    expect(cartForm.attributes).not.toHaveProperty('aria-busy');
    expect(root.targets.get('cart-form')?.html).toBe('<form>Out of stock</form>');
  });
});
