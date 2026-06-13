import { describe, expect, it, vi } from 'vitest';
import { runInThisContext } from 'node:vm';
import type { Route } from '@jiso/core';

import {
  createInlineJisoLoaderSource,
  createQueryStore,
  dispatchDelegatedEvent,
  installInlineJisoLoader,
  installJisoLoader,
  jisoLoaderSource,
  type EnhancedMutationFetchOptions,
  type MutationBroadcast,
} from './index.js';
import {
  FakeBroadcastChannel,
  FakeBroadcastHub,
  FakeElement,
  FakeFormElement,
  FakeMorphRoot,
  FakeMorphTarget,
  FakePendingElement,
  FakePendingRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

declare module '@jiso/core' {
  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
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
      getAttribute(name: string) {
        return name === 'data-enhance' ? '' : null;
      },
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
        readonly detail: unknown;
        readonly type: string;

        constructor(type: string, init?: { detail?: unknown }) {
          this.detail = init?.detail;
          this.type = type;
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
          detail: {
            attrs: ' name="cart" key="cart:c1"',
            content: '{"count":1}',
          },
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
      getAttribute(name: string) {
        return name === 'data-enhance' ? '' : null;
      },
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
    expect([...root.listeners.keys()]).toEqual([
      'click',
      'submit',
      'input',
      'change',
      'jiso:query',
    ]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });
  });

  it('retries malformed initial fw-query scripts before visible-return refetch', async () => {
    const root = new FakeRoot();
    const store = createQueryStore();
    const onError = vi.fn();
    const refetchOnFocus = vi.fn();
    const cartPlan = vi.fn();
    const script = {
      getAttribute: (name: string) => (name === 'fw-query' ? 'cart' : null),
      textContent: '{',
    };

    root.scripts = [script];
    store.subscribe('cart', cartPlan);

    installJisoLoader({
      importModule: vi.fn(),
      onError,
      queryStore: store,
      refetchOnFocus,
      root,
    });

    expect(store.get('cart')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'query-hydration' });

    script.textContent = '{"count":2}';
    root.visibilityState = 'visible';
    await root.listeners.get('visibilitychange')?.({
      target: null,
      type: 'visibilitychange',
    });

    // SPEC.md §4.4/§9.4: visible-return hydration retries transiently
    // malformed server query data through the same query-store apply path.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(cartPlan).toHaveBeenCalledWith({ count: 2 });
    expect(refetchOnFocus).toHaveBeenCalledWith(['cart']);
    expect(onError).toHaveBeenCalledTimes(1);
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
