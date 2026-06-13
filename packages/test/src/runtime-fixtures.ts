import { GeneratedFixtureElement } from './generated-module-fixtures.ts';

export interface LoaderSmokeRuntime {
  applyCompiledQueryUpdatePlan: (
    root: unknown,
    queryName: string,
    value: unknown,
    plan: unknown,
  ) => { templateStamps?: string[] };
  createQueryStore: () => {
    get(name: string, key?: string): unknown;
  };
  installJisoLoader: (options: unknown) => { dispose: () => void; events: string[] };
  refetchQueries: (options: unknown) => Promise<unknown>;
}

export interface LoaderSmokeBehaviorFact {
  appliedTemplateStamps: string[];
  calls: Array<[string, boolean]>;
  disposedListenerEvents: string[];
  initialImportCount: number;
  listenerEvents: string[];
  listenerOptions: Record<string, { capture?: boolean }>;
  observer: {
    observedCount: number;
    unobservedCount: number;
  };
  reconciledItems: Array<Record<string, unknown> & { html: string }>;
  refetched: unknown;
  storeValues: {
    cart: unknown;
  };
}

interface ListenerFact {
  listener: (event: unknown) => unknown;
  options?: { capture?: boolean };
}

export async function loaderSmokeBehaviorFact(
  runtime: LoaderSmokeRuntime,
): Promise<LoaderSmokeBehaviorFact> {
  // SPEC.md §4.4/§4.8/§9.3: the loader owns delegated triggers,
  // refetch-on-focus, and DOM-walked query update plans.
  const listeners = new Map<string, ListenerFact>();
  const rootElements = new Map<string, GeneratedFixtureElement[]>();
  const root = {
    addEventListener(
      type: string,
      listener: ListenerFact['listener'],
      options?: ListenerFact['options'],
    ) {
      listeners.set(type, options === undefined ? { listener } : { listener, options });
    },
    removeEventListener(type: string, listener: ListenerFact['listener']) {
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
    querySelectorAll(selector: string) {
      return rootElements.get(selector) ?? [];
    },
    visibilityState: 'visible',
  };
  const calls: LoaderSmokeBehaviorFact['calls'] = [];
  const waitForCalls = async (count: number) => {
    for (let attempts = 0; attempts < 10 && calls.length < count; attempts += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };
  const handlers = {
    idle(_event: unknown, context: { signal: unknown }) {
      calls.push(['idle', context.signal instanceof AbortSignal]);
    },
    load(_event: unknown, context: { signal: unknown }) {
      calls.push(['load', context.signal instanceof AbortSignal]);
    },
    visible(_event: unknown, context: { signal: unknown }) {
      calls.push(['visible', context.signal instanceof AbortSignal]);
    },
  };
  const loadElement = new GeneratedFixtureElement({ 'on:load': '/loader.js#load' });
  const idleElement = new GeneratedFixtureElement({ 'on:idle': '/loader.js#idle' });
  const visibleElement = new GeneratedFixtureElement({ 'on:visible': '/loader.js#visible' });
  const idleCallbacks: Array<() => void> = [];
  let visibleCallback:
    | ((entries: Array<{ isIntersecting: boolean; target: unknown }>) => void)
    | undefined;
  const observer = {
    observed: [] as unknown[],
    unobserved: [] as unknown[],
    observe(element: unknown) {
      this.observed.push(element);
    },
    unobserve(element: unknown) {
      this.unobserved.push(element);
    },
  };
  rootElements.set('[on\\:load]', [loadElement]);
  rootElements.set('[on\\:idle]', [idleElement]);
  rootElements.set('[on\\:visible]', [visibleElement]);
  let importCount = 0;

  const loader = runtime.installJisoLoader({
    importModule: async () => {
      importCount += 1;
      return handlers;
    },
    requestIdle(callback: () => void) {
      idleCallbacks.push(callback);
    },
    root,
    visibleObserver(callback: typeof visibleCallback) {
      visibleCallback = callback;
      return observer;
    },
  });
  const initialImportCount = importCount;
  await waitForCalls(1);

  idleCallbacks[0]?.();
  await waitForCalls(2);

  visibleCallback?.([{ isIntersecting: true, target: visibleElement }]);
  await waitForCalls(3);
  const listenerOptions = Object.fromEntries(
    [...listeners.entries()].map(([event, { options }]) => [event, { ...options }]),
  );
  visibleCallback?.([{ isIntersecting: true, target: visibleElement }]);

  const store = runtime.createQueryStore();
  const refetched = await runtime.refetchQueries({
    fetch: async (url: string, options: unknown) => {
      if (url !== '/_q/cart') throw new Error(`Expected cart refetch URL; got ${url}`);
      assertRefetchOptions(options);
      return {
        ok: true,
        status: 200,
        async text() {
          return '<fw-query name="cart">{"count":2}</fw-query>';
        },
      };
    },
    queries: ['cart'],
    queryStore: store,
  });

  let reconciledItems: LoaderSmokeBehaviorFact['reconciledItems'] = [];
  const templateHost = {
    getAttribute() {
      return null;
    },
    reconcileTemplateStamp(items: LoaderSmokeBehaviorFact['reconciledItems']) {
      reconciledItems = items.map((item) => ({ ...item }));
    },
  };
  const applied = runtime.applyCompiledQueryUpdatePlan(
    {
      querySelectorAll(selector: string) {
        return selector === '[data-list]' ? [templateHost] : [];
      },
    },
    'cart',
    { items: [{ id: 'p1', qty: 2 }] },
    {
      templateStamps: [
        {
          key: 'id',
          list: 'items',
          render: (item: { id: string; qty: number }) => `<li>${item.id}:${item.qty}</li>`,
          selector: '[data-list]',
        },
      ],
    },
  );

  loader.dispose();

  return {
    appliedTemplateStamps: applied.templateStamps ?? [],
    calls,
    disposedListenerEvents: [...listeners.keys()],
    initialImportCount,
    listenerEvents: loader.events,
    listenerOptions,
    observer: {
      observedCount: observer.observed.length,
      unobservedCount: observer.unobserved.length,
    },
    reconciledItems,
    refetched,
    storeValues: {
      cart: store.get('cart'),
    },
  };
}

function assertRefetchOptions(options: unknown): void {
  const expected = {
    headers: {
      Accept: 'text/html',
      'FW-Fragment': 'true',
    },
    method: 'GET',
  };

  if (JSON.stringify(options) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected cart refetch options: ${JSON.stringify(options)}`);
  }
}
