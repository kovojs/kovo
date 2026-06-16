import { GeneratedFixtureElement } from './generated-module-fixtures.ts';
import {
  graphComponentTargetFacts,
  graphOptimisticFacts,
  type GraphComponentTargetFact,
  type KovoGraphFixture,
  type KovoGraphOptimisticFact,
} from './graph-fixtures.ts';

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
  installKovoLoader: (options: unknown) => { dispose: () => void; events: string[] };
  refetchQueries: (options: unknown) => Promise<unknown>;
}

export interface OptimismCleanupRuntime {
  OptimisticRebaser: new (store: unknown) => {
    discardPendingOptimism: () => unknown;
    pendingCount: (query: string, key?: string) => number;
  };
  createQueryStore: () => {
    get(name: string, key?: string): unknown;
    set(name: string, value: unknown, key?: string): void;
  };
  installPagehideOptimismCleanup: (options: {
    discardPendingOptimism: () => unknown;
    root: unknown;
  }) => { dispose: () => void } | (() => void);
  stampPendingQueries: (root: unknown, queries: unknown, pending: boolean) => void;
  submitOptimisticEnhancedMutation: (options: unknown) => Promise<{
    appliedFragments: unknown[];
    changes: unknown[];
    fragments: unknown[];
    idem?: string;
    queries: string[];
    targets: unknown[];
  }>;
}

export interface EnhancedMutationRuntime {
  OptimisticRebaser: new (store: unknown) => {
    pendingCount: (query: string, key?: string) => number;
  };
  createQueryStore: () => {
    get(name: string, key?: string): unknown;
    set(name: string, value: unknown, key?: string): void;
  };
  submitEnhancedMutation: (options: unknown) => Promise<{
    changes: Array<{ domain: string; keys?: string[] }>;
    queries: string[];
  }>;
  submitOptimisticEnhancedMutation: (options: unknown) => Promise<{
    changes: Array<{ domain: string; keys?: string[] }>;
    queries: string[];
  }>;
}

export interface MorphFragmentRuntime {
  applyMutationResponseToDom: (options: {
    body: string;
    root: unknown;
    store: {
      get(name: string, key?: string): unknown;
      set(name: string, value: unknown, key?: string): void;
    };
  }) => { appliedFragments: string[] } | Promise<{ appliedFragments: string[] }>;
  createQueryStore: () => {
    get(name: string, key?: string): unknown;
    set(name: string, value: unknown, key?: string): void;
  };
  morphStructuralTree: <T extends { children?: unknown[] }>(current: T, next: T) => T;
}

export interface CommerceKeyedOptimisticRuntime {
  OptimisticRebaser: new (store: unknown) => unknown;
  createQueryStore: () => {
    get(name: string, key?: string): unknown;
    set(name: string, value: unknown, key?: string): void;
  };
  domain(name: string): unknown;
  morphStructuralTree: <T extends { children?: unknown[] }>(current: T, next: T) => T;
  mutation(key: string, config: Record<string, unknown>): unknown;
  query(key: string, config: Record<string, unknown>): unknown;
  renderMutationEndpointResponse(...args: any[]): Promise<any>;
  runMutation(...args: any[]): Promise<any>;
  s: {
    object(shape: Record<string, unknown>): unknown;
    string(): unknown;
  };
  submitOptimisticEnhancedMutation: (options: unknown) => Promise<{
    appliedFragments: string[];
    queries: string[];
  }>;
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

export interface OptimismCleanupBehaviorFact {
  disposedLifecycleListeners: string[];
  fetchOptions: {
    bodyIsFormData: boolean;
    formDataQuantity: FormDataEntryValue | null;
    headers: unknown;
    keepalive: unknown;
    method: unknown;
  };
  listenerStates: {
    afterInstall: {
      pagehide: boolean;
      unload: boolean;
    };
    afterDispose: {
      pagehide: boolean;
    };
  };
  pendingAttributes: {
    afterSubmit: Record<string, string>;
    afterPagehide: Record<string, string>;
  };
  pendingCounts: {
    afterSubmit: number;
    afterPagehide: number;
    afterResponse: number;
  };
  result: {
    appliedFragments: unknown[];
    changes: unknown[];
    fragments: unknown[];
    idem?: string;
    queries: string[];
    targets: unknown[];
  };
  storeValues: {
    afterSubmit: unknown;
    afterPagehide: unknown;
    afterResponse: unknown;
  };
}

export interface EnhancedMutationBehaviorFact {
  broadcast: {
    events: Array<{
      body: string;
      changes: Array<{ domain: string; keys?: string[] }>;
    }>;
    fetchHeaders: unknown;
    resultChanges: Array<{ domain: string; keys?: string[] }>;
    resultQueries: string[];
    storeValue: unknown;
  };
  malformedHeader: {
    errorCount: number;
    errorMessagePrefixMatches: boolean;
    resultChanges: Array<{ domain: string; keys?: string[] }>;
    resultQueries: string[];
  };
  optimistic: {
    fetchIdemHeader: unknown;
    pendingAfterResponse: string | null;
    pendingDuringFetch: string | null;
    resultChanges: Array<{ domain: string; keys?: string[] }>;
    resultQueries: string[];
    storeAfterResponse: unknown;
    storeDuringFetch: unknown;
  };
}

export interface MorphFragmentBehaviorFact {
  appliedFragments: string[];
  ignoredMissingTarget: boolean;
  keyedIdentity: {
    firstItemReusedAfterReorder: boolean;
    secondItemReusedAtFront: boolean;
  };
  preservedBrowserState: unknown;
  queryStoreValue: unknown;
  renderedTargetHtml: string;
  reorderedText: string | undefined;
}

export interface CommerceKeyedOptimisticBehaviorFact {
  graph: {
    componentTargets: GraphComponentTargetFact[];
    optimistic: KovoGraphOptimisticFact[];
  };
  keyedMorph: {
    appendedKeys: string[];
    firstProductReusedAfterReorder: boolean;
    reorderedBrowserState: unknown;
    reorderedKeys: string[];
  };
  mutationEndpoint: {
    body: string;
    headers: Record<string, string>;
    result: Record<string, unknown>;
    status: number;
  };
  optimisticReview: {
    appliedFragments: string[];
    fetchStoreDuringOptimism: unknown;
    fragmentHtml: string;
    queries: string[];
    storeAfterResponse: unknown;
  };
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

  const loader = runtime.installKovoLoader({
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
          return '<kovo-query name="cart">{"count":2}</kovo-query>';
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

export async function morphFragmentBehaviorFact(
  runtime: MorphFragmentRuntime,
): Promise<MorphFragmentBehaviorFact> {
  // SPEC.md §4.4/§9.3: server-owned query and fragment responses must update
  // the client tree while preserving keyed browser state.
  interface FixtureMorphNode {
    browserState?: unknown;
    children?: FixtureMorphNode[];
    key: string;
    text?: string;
    type: string;
  }

  const first: FixtureMorphNode = {
    browserState: {
      focused: true,
      scroll: { left: 4, top: 24 },
      selection: { direction: 'forward', end: 3, start: 1 },
    },
    children: [{ key: 'label', text: 'Alpha', type: 'span' }],
    key: 'p1',
    type: 'article',
  };
  const second: FixtureMorphNode = {
    children: [{ key: 'label', text: 'Beta', type: 'span' }],
    key: 'p2',
    type: 'article',
  };
  const current: { children: FixtureMorphNode[]; type: string } = {
    children: [first, second],
    type: 'section',
  };

  runtime.morphStructuralTree(current, {
    children: [
      {
        children: [{ key: 'label', text: 'Beta next', type: 'span' }],
        key: 'p2',
        type: 'article',
      },
      {
        children: [{ key: 'label', text: 'Alpha next', type: 'span' }],
        key: 'p1',
        type: 'article',
      },
      { key: 'p3', text: 'Gamma', type: 'article' },
    ],
    type: 'section',
  });

  const target = {
    html: '<article kovo-key="p1">Old</article>',
    appendHtml(html: string) {
      this.html += html;
    },
    readHtml() {
      return this.html;
    },
    replaceWithHtml(html: string) {
      this.html = html;
    },
  };
  const root = {
    findFragmentTarget(fragmentTarget: string) {
      return fragmentTarget === 'products' ? target : null;
    },
  };
  const store = runtime.createQueryStore();
  const result = await runtime.applyMutationResponseToDom({
    body: [
      '<kovo-query name="productGrid" key="category:all">{"count":2}</kovo-query>',
      '<kovo-fragment target="products" mode="append"><article kovo-key="p2">New</article></kovo-fragment>',
      '<kovo-fragment target="missing"><article>Ignored</article></kovo-fragment>',
    ].join('\n'),
    root,
    store,
  });

  return {
    appliedFragments: result.appliedFragments,
    ignoredMissingTarget: !target.html.includes('Ignored'),
    keyedIdentity: {
      firstItemReusedAfterReorder: current.children[1] === first,
      secondItemReusedAtFront: current.children[0] === second,
    },
    preservedBrowserState: current.children[1]?.browserState,
    queryStoreValue: store.get('productGrid', 'category:all'),
    renderedTargetHtml: target.html,
    reorderedText: current.children[1]?.children?.[0]?.text,
  };
}

export async function commerceKeyedOptimisticBehaviorFact(options: {
  graph: KovoGraphFixture;
  runtime: CommerceKeyedOptimisticRuntime;
}): Promise<CommerceKeyedOptimisticBehaviorFact> {
  // SPEC.md §4.4/§4.8/§9.3: keyed fragments, keyed query instances, and
  // optimistic transforms preserve browser state while server truth wins.
  const { graph, runtime } = options;
  const currentGrid = {
    children: [
      { browserState: { islandState: { pendingMutation: 'cart/add' } }, key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  };
  const firstProduct = currentGrid.children[0];
  const appendedGrid = runtime.morphStructuralTree(currentGrid, {
    children: [
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
      { key: 'p3', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });
  const appendedKeys = appendedGrid.children.map((child) => child.key);
  const reorderedGrid = runtime.morphStructuralTree(appendedGrid, {
    children: [
      { key: 'p3', type: 'card' },
      { key: 'p1', type: 'card' },
      { key: 'p2', type: 'card' },
    ],
    key: 'product-grid',
    type: 'section',
  });

  const productDomain = runtime.domain('product');
  const productP1 = runtime.query('productDetail', {
    instanceKey: () => 'product:p1',
    load: () => ({ id: 'p1', stock: 0 }),
    reads: [productDomain],
  });
  const productP2 = runtime.query('productDetail', {
    instanceKey: () => 'product:p2',
    load: () => ({ id: 'p2', stock: 10 }),
    reads: [productDomain],
  });
  const reserveProduct = runtime.mutation('product/reserve', {
    csrf: false,
    csrfJustification: 'kovo-check synthetic keyed invalidation fixture',
    handler(input: { productId: string }) {
      return input.productId;
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
    registry: {
      inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
      queries: [productP1, productP2],
    },
  });
  const mutationResult = await runtime.runMutation(reserveProduct, { productId: 'p1' }, {});
  const mutationResponse = await runtime.renderMutationEndpointResponse(reserveProduct, {
    fragmentRenderers: [],
    headers: { 'Kovo-Fragment': 'true' },
    rawInput: { productId: 'p1' },
    redirectTo: '/products/p1',
    request: {},
  });

  const store = runtime.createQueryStore();
  const rebaser = new runtime.OptimisticRebaser(store);
  const target = {
    html: '',
    replaceWithHtml(html: string) {
      this.html = html;
    },
  };
  let fetchStoreDuringOptimism: unknown;
  store.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const optimisticResult = await runtime.submitOptimisticEnhancedMutation({
    fetch: async () => {
      fetchStoreDuringOptimism = store.get('reviews', 'product:p1');
      return {
        async text() {
          return [
            '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</kovo-query>',
            '<kovo-fragment target="reviews:p1"><section>Reviews ready</section></kovo-fragment>',
          ].join('\n');
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', input: { reviewId: 'draft' }, keys: ['p1'] },
    idem: 'idem_keyed_optimistic',
    input: { reviewId: 'ignored' },
    optimistic: {
      keys: { reviews: (change: { keys?: string[] }) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current: { items: unknown[] }, input: { reviewId: string }) {
          return { items: [...current.items, { id: input.reviewId }] };
        },
      },
    },
    rebaser,
    root: {
      findFragmentTarget(fragmentTarget: string) {
        return fragmentTarget === 'reviews:p1' ? target : null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  return {
    graph: {
      componentTargets: graphComponentTargetFacts(graph),
      optimistic: graphOptimisticFacts(graph),
    },
    keyedMorph: {
      appendedKeys,
      firstProductReusedAfterReorder: reorderedGrid.children[1] === firstProduct,
      reorderedBrowserState: reorderedGrid.children[1]?.browserState,
      reorderedKeys: reorderedGrid.children.map((child) => child.key),
    },
    mutationEndpoint: {
      body: mutationResponse.body,
      headers: mutationResponse.headers,
      result: mutationResult,
      status: mutationResponse.status,
    },
    optimisticReview: {
      appliedFragments: optimisticResult.appliedFragments,
      fetchStoreDuringOptimism,
      fragmentHtml: target.html,
      queries: optimisticResult.queries,
      storeAfterResponse: store.get('reviews', 'product:p1'),
    },
  };
}

export async function optimismCleanupBehaviorFact(
  runtime: OptimismCleanupRuntime,
): Promise<OptimismCleanupBehaviorFact> {
  // SPEC.md §4.8/§9.3: navigation lifecycle cleanup must discard pending
  // optimistic query state and remove pending stamps without waiting on fetch.
  const listeners = new Map<string, (event: unknown) => void>();
  const lifecycleRoot = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const pendingElement = new GeneratedFixtureElement({ 'kovo-deps': 'cart' });
  const pendingRoot = {
    querySelectorAll(selector: string) {
      return selector === '[kovo-deps]' ? [pendingElement] : [];
    },
  };
  const store = runtime.createQueryStore();
  const rebaser = new runtime.OptimisticRebaser(store);
  store.set('cart', { count: 1 });

  const dispose = runtime.installPagehideOptimismCleanup({
    discardPendingOptimism() {
      const discarded = rebaser.discardPendingOptimism();
      runtime.stampPendingQueries(pendingRoot, discarded, false);
      return discarded;
    },
    root: lifecycleRoot,
  });
  const listenerStates = {
    afterInstall: {
      pagehide: listeners.has('pagehide'),
      unload: listeners.has('unload'),
    },
    afterDispose: {
      pagehide: false,
    },
  };

  let fetchOptions: unknown;
  let releaseFetch: (() => void) | undefined;
  const formData = new FormData();
  formData.set('quantity', '2');
  const submit = runtime.submitOptimisticEnhancedMutation({
    fetch(_url: string, options: unknown) {
      fetchOptions = options;
      return new Promise((resolve) => {
        releaseFetch = () => {
          resolve({
            headers: { get: () => null },
            async text() {
              return '<kovo-query name="cart">{"count":2}</kovo-query>';
            },
          });
        };
      });
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData,
    idem: 'idem_bfcache',
    input: { quantity: 2 },
    optimistic: {
      transforms: {
        cart(current: { count: number }, input: { quantity: number }) {
          return { count: current.count + input.quantity };
        },
      },
    },
    pendingRoot,
    rebaser,
    root: {
      findFragmentTarget() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    store,
  });

  const storeAfterSubmit = store.get('cart');
  const pendingCountAfterSubmit = rebaser.pendingCount('cart');
  const pendingAttributesAfterSubmit = elementAttributes(pendingElement);

  listeners.get('pagehide')?.({ target: null, type: 'pagehide' });
  const storeAfterPagehide = store.get('cart');
  const pendingCountAfterPagehide = rebaser.pendingCount('cart');
  const pendingAttributesAfterPagehide = elementAttributes(pendingElement);

  releaseFetch?.();
  const result = await submit;
  const storeAfterResponse = store.get('cart');
  const pendingCountAfterResponse = rebaser.pendingCount('cart');

  if (typeof dispose === 'function') {
    dispose();
  } else {
    dispose.dispose();
  }
  listenerStates.afterDispose.pagehide = listeners.has('pagehide');

  return {
    disposedLifecycleListeners: [...listeners.keys()],
    fetchOptions: optimismFetchOptionsFact(fetchOptions),
    listenerStates,
    pendingAttributes: {
      afterSubmit: pendingAttributesAfterSubmit,
      afterPagehide: pendingAttributesAfterPagehide,
    },
    pendingCounts: {
      afterSubmit: pendingCountAfterSubmit,
      afterPagehide: pendingCountAfterPagehide,
      afterResponse: pendingCountAfterResponse,
    },
    result,
    storeValues: {
      afterSubmit: storeAfterSubmit,
      afterPagehide: storeAfterPagehide,
      afterResponse: storeAfterResponse,
    },
  };
}

export async function enhancedMutationBehaviorFact(
  runtime: EnhancedMutationRuntime,
): Promise<EnhancedMutationBehaviorFact> {
  // SPEC.md §4.8/§9.3: enhanced mutations publish valid change records,
  // update keyed query state, and clear pending optimistic stamps after settle.
  const noFragmentRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const broadcastEvents: EnhancedMutationBehaviorFact['broadcast']['events'] = [];
  const enhancedStore = runtime.createQueryStore();
  let enhancedFetchHeaders: unknown;
  const enhancedResult = await runtime.submitEnhancedMutation({
    broadcast: {
      close() {},
      publish(body: string, changes: Array<{ domain: string; keys?: string[] }>) {
        broadcastEvents.push({ body, changes });
      },
    },
    fetch: async (_url: string, options: { headers?: unknown }) => {
      enhancedFetchHeaders = options.headers;
      return {
        headers: {
          get(name: string) {
            return name === 'Kovo-Changes'
              ? '[{"domain":"cart","keys":["c1"],"input":"ignored"},{"domain":"bad","keys":[7]},{"keys":["missing-domain"]}]'
              : null;
          },
        },
        async text() {
          return '<kovo-query name="cart" key="cart:c1">{"count":2}</kovo-query>';
        },
      };
    },
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    idem: 'idem_change_record',
    root: noFragmentRoot,
    store: enhancedStore,
  });

  const malformedHeaderErrors: Error[] = [];
  const malformedResult = await runtime.submitEnhancedMutation({
    fetch: async () => ({
      headers: {
        get(name: string) {
          return name === 'Kovo-Changes' ? '{bad json' : null;
        },
      },
      async text() {
        return '<kovo-query name="cart">{"count":3}</kovo-query>';
      },
    }),
    form: { action: '/_m/cart/add', method: 'post' },
    formData: new FormData(),
    onError(error: Error) {
      malformedHeaderErrors.push(error);
    },
    root: noFragmentRoot,
    store: runtime.createQueryStore(),
  });

  const optimisticStore = runtime.createQueryStore();
  optimisticStore.set('reviews', { items: [{ id: 'r1' }] }, 'product:p1');
  const rebaser = new runtime.OptimisticRebaser(optimisticStore);
  const pendingElement = new GeneratedFixtureElement({ 'kovo-deps': 'reviews' });
  let optimisticFetchIdemHeader: unknown;
  let optimisticStoreDuringFetch: unknown;
  let optimisticPendingDuringFetch: string | null = null;
  const optimisticResult = await runtime.submitOptimisticEnhancedMutation({
    fetch: async (_url: string, options: { headers?: Record<string, unknown> }) => {
      optimisticFetchIdemHeader = options.headers?.['Kovo-Idem'];
      optimisticStoreDuringFetch = optimisticStore.get('reviews', 'product:p1');
      optimisticPendingDuringFetch = pendingElement.getAttribute('kovo-pending');
      return {
        headers: {
          get(name: string) {
            return name === 'Kovo-Changes' ? '[{"domain":"product","keys":["p1"]}]' : null;
          },
        },
        async text() {
          return '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1"},{"id":"server"}]}</kovo-query>';
        },
      };
    },
    form: { action: '/_m/reviews/add', method: 'post' },
    formData: new FormData(),
    change: { domain: 'product', keys: ['p1'], input: { reviewId: 'draft' } },
    idem: 'idem_optimistic_change',
    input: { reviewId: 'unused' },
    optimistic: {
      keys: { reviews: (change: { keys?: string[] }) => `product:${change.keys?.[0]}` },
      transforms: {
        reviews(current: { items: unknown[] }, input: { reviewId: string }) {
          return { items: [...current.items, { id: input.reviewId }] };
        },
      },
    },
    pendingRoot: {
      querySelectorAll(selector: string) {
        return selector === '[kovo-deps]' ? [pendingElement] : [];
      },
    },
    rebaser,
    root: noFragmentRoot,
    store: optimisticStore,
  });

  return {
    broadcast: {
      events: broadcastEvents,
      fetchHeaders: enhancedFetchHeaders,
      resultChanges: enhancedResult.changes,
      resultQueries: enhancedResult.queries,
      storeValue: enhancedStore.get('cart', 'cart:c1'),
    },
    malformedHeader: {
      errorCount: malformedHeaderErrors.length,
      errorMessagePrefixMatches:
        malformedHeaderErrors[0]?.message.startsWith('Malformed JSON in Kovo-Changes header:') ??
        false,
      resultChanges: malformedResult.changes,
      resultQueries: malformedResult.queries,
    },
    optimistic: {
      fetchIdemHeader: optimisticFetchIdemHeader,
      pendingAfterResponse: pendingElement.getAttribute('kovo-pending'),
      pendingDuringFetch: optimisticPendingDuringFetch,
      resultChanges: optimisticResult.changes,
      resultQueries: optimisticResult.queries,
      storeAfterResponse: optimisticStore.get('reviews', 'product:p1'),
      storeDuringFetch: optimisticStoreDuringFetch,
    },
  };
}

function assertRefetchOptions(options: unknown): void {
  const expected = {
    headers: {
      Accept: 'text/html',
      'Kovo-Fragment': 'true',
    },
    method: 'GET',
  };

  if (JSON.stringify(options) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected cart refetch options: ${JSON.stringify(options)}`);
  }
}

function elementAttributes(element: GeneratedFixtureElement): Record<string, string> {
  return Object.fromEntries(element.attributes.map(({ name, value }) => [name, value]));
}

function optimismFetchOptionsFact(options: unknown): OptimismCleanupBehaviorFact['fetchOptions'] {
  const fetchOptions = options as {
    body?: unknown;
    headers?: unknown;
    keepalive?: unknown;
    method?: unknown;
  };
  return {
    bodyIsFormData: fetchOptions.body instanceof FormData,
    formDataQuantity:
      fetchOptions.body instanceof FormData ? fetchOptions.body.get('quantity') : null,
    headers: fetchOptions.headers,
    keepalive: fetchOptions.keepalive,
    method: fetchOptions.method,
  };
}
