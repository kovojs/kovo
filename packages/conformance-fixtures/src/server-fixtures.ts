import { htmlElementFacts } from '@kovojs/test/html-fragment';

export interface ServerMutationLifecycleRuntime {
  domain(name: string): unknown;
  mutation(key: string, config: Record<string, unknown>): unknown;
  query(key: string, config: Record<string, unknown>): unknown;
  renderMutationResponse(...args: any[]): Promise<any>;
  runMutation(...args: any[]): Promise<any>;
  s: {
    number(): {
      int(): {
        default(value: number): unknown;
        min(value: number): unknown;
      };
    };
    object(shape: Record<string, unknown>): unknown;
    string(): unknown;
  };
}

export interface ServerCommerceAdoptDontInventRuntime {
  createQueryStore(): unknown;
  domain(name: string): unknown;
  errorBoundary(...args: any[]): unknown;
  guards: any;
  i18n(locale: string, messages: Record<string, string>): unknown;
  metaFromQuery(query: unknown, render: (value: any) => Record<string, string>): unknown;
  mutation(key: string, config: Record<string, unknown>): unknown;
  query(key: string, config: Record<string, unknown>): unknown;
  renderMutationEndpointResponse(...args: any[]): Promise<any>;
  renderPageHints(...args: any[]): any;
  runMutation(...args: any[]): Promise<any>;
  session(schema: unknown): { parse(request: unknown): unknown };
  submitEnhancedMutation: any;
  t: any;
  s: any;
}

export interface ServerCommerceStylesheetRuntime {
  domain(name: string): unknown;
  mutation(key: string, config: Record<string, unknown>): unknown;
  renderDeferredStream(...args: any[]): { body: string };
  renderMutationEndpointResponse(...args: any[]): Promise<any>;
  renderPageHints(...args: any[]): any;
  s: any;
  stylesheetsForTargets(...args: any[]): any[];
}

export interface ServerDataPlaneRuntime extends ServerMutationLifecycleRuntime {
  csrfField(...args: any[]): string;
  csrfToken(...args: any[]): string;
  notFound(): unknown;
  renderQueryEndpointResponse(...args: any[]): Promise<any>;
  renderQueryRegistryEndpointResponse(...args: any[]): Promise<any>;
  renderRoutePageResponse(...args: any[]): Promise<any>;
  route(path: string, config: Record<string, unknown>): unknown;
  runQuery(...args: any[]): Promise<any>;
  runRoutePage(...args: any[]): Promise<any>;
}

export interface ServerPageHintsRuntime {
  renderPageHints(...args: any[]): { earlyHints?: Record<string, string>; html: string };
}

export interface ServerPageHintsBehaviorFact {
  deduplicatedRules: unknown;
  emptyOptInHtml: string;
  renderedHtml: string;
  scriptAttrs: Record<string, string>;
}

export interface ServerMutationLifecycleBehaviorFact {
  failedTransaction: {
    events: string[];
    result: Record<string, unknown>;
  };
  fragmentResponse: Record<string, unknown>;
  successfulTransaction: {
    events: string[];
    result: Record<string, unknown>;
  };
}

export interface ServerDataPlaneBehaviorFact {
  csrf: {
    field: string;
    guardCallsAfterFailure: number;
    guardCallsAfterSuccess: number;
    missingToken: Record<string, unknown>;
    success: Record<string, unknown>;
  };
  query: {
    endpoint: Record<string, unknown>;
    invalidInput: Record<string, unknown>;
    missingRegistryQuery: Record<string, unknown>;
    success: Record<string, unknown>;
    unauthorized: Record<string, unknown>;
  };
  route: {
    notFound: Record<string, unknown>;
    success: Record<string, unknown>;
  };
}

export interface ServerCommerceTransactionBehaviorFact {
  failed: {
    db: Record<string, unknown>;
    result: Record<string, unknown>;
  };
  successful: {
    db: Record<string, unknown>;
    result: Record<string, unknown>;
  };
}

export interface ServerCommerceAdoptDontInventBehaviorFact {
  fragmentFailure: Record<string, unknown>;
  graph: {
    cartPage: Record<string, unknown>;
    receiptMutation: Record<string, unknown>;
  };
  guards: {
    authenticatedSession: unknown;
    authedFailure: unknown;
    firstRateLimitPasses: boolean;
    secondRateLimitFailure: string | undefined;
  };
  pageHints: {
    missingQueryMessage: string;
    rendered: Record<string, unknown>;
    translation: string;
  };
  upload: {
    pendingDuringResponse: string | null;
    pendingAfterSubmit: string | null;
    progress: { max: string | null; value: string | null };
    result: Record<string, unknown>;
    stored: Record<string, unknown> | undefined;
  };
}

export interface ServerCommerceStylesheetBehaviorFact {
  deferred: {
    fragmentAttrs: Record<string, string> | undefined;
    linkAttrs: Record<string, string> | undefined;
    sectionAttrs: Record<string, string> | undefined;
    tags: string[];
  };
  failure: Record<string, unknown>;
  pageHints: Record<string, unknown>;
  selectedStylesheets: Array<Record<string, unknown>>;
}

export function serverPageHintsBehaviorFact(
  runtime: ServerPageHintsRuntime,
): ServerPageHintsBehaviorFact {
  // SPEC.md §9.3: prerender/speculation hints are explicit opt-in page hints.
  const emptyOptIn = runtime.renderPageHints({ prefetch: 'moderate', prerenderUrls: ['', ''] });
  const rendered = runtime.renderPageHints({
    prefetch: 'moderate',
    prerenderUrls: ['', '/products', '/products', '/cart'],
  });
  const script = htmlElementFacts(rendered.html, {
    attrs: { type: 'speculationrules' },
    tag: 'script',
  })[0];

  if (!script) {
    throw new Error('Expected renderPageHints to emit a speculationrules script');
  }

  return {
    deduplicatedRules: JSON.parse(script.innerHtml),
    emptyOptInHtml: emptyOptIn.html,
    renderedHtml: rendered.html,
    scriptAttrs: script.attrs,
  };
}

export async function serverMutationLifecycleBehaviorFact(
  runtime: ServerMutationLifecycleRuntime,
): Promise<ServerMutationLifecycleBehaviorFact> {
  // SPEC.md §6.3: mutations may define guard, validation, transaction, and fragment contracts.
  const transactionEvents: string[] = [];
  const transactional = runtime.mutation('cart/add', {
    csrf: false,
    guard(request: { user?: string }) {
      transactionEvents.push(`guard:${request.user}`);
      return request.user === 'u1';
    },
    handler(input: { productId: string }, request: { tx?: boolean }) {
      transactionEvents.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
      return input.productId;
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
    async transaction(request: { tx?: boolean }, run: (request: unknown) => Promise<unknown>) {
      transactionEvents.push(`begin:${request.tx === true ? 'tx' : 'plain'}`);
      const value = await run({ ...request, tx: true });
      transactionEvents.push('commit');
      return value;
    },
  });

  const rollbackEvents: string[] = [];
  const failing = runtime.mutation('cart/fail', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: runtime.s.object({
        availableQuantity: runtime.s.number().int().min(0),
      }),
    },
    handler(
      _input: unknown,
      _request: unknown,
      context: { fail(code: string, payload: unknown): unknown },
    ) {
      rollbackEvents.push('handler');
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
    async transaction(request: unknown, run: (request: unknown) => Promise<unknown>) {
      rollbackEvents.push('begin');
      try {
        return await run(request);
      } catch (error) {
        rollbackEvents.push('rollback');
        throw error;
      }
    },
  });

  const cart = runtime.domain('cart');
  const cartQuery = runtime.query('cart', {
    instanceKey: () => 'cart:c1',
    load(_input: unknown, context: { request: { session: { cartId: string } } }) {
      return { cartId: context.request.session.cartId };
    },
    reads: [cart],
  });
  const addToCart = runtime.mutation('cart/add', {
    csrf: false,
    handler(input: { productId: string }, request: { session: { cartId: string } }) {
      return `${request.session.cartId}:${input.productId}`;
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
    registry: {
      queries: [cartQuery],
      touches: [cart],
    },
  });

  return {
    failedTransaction: {
      events: rollbackEvents,
      result: await runtime.runMutation(failing, { productId: 'p1' }, {}),
    },
    fragmentResponse: await runtime.renderMutationResponse(addToCart, {
      buildToken: 'conformance-server-test-build',
      fragment: true,
      rawInput: { productId: 'p1' },
      request: { session: { cartId: 'c1' } },
    }),
    successfulTransaction: {
      events: transactionEvents,
      result: await runtime.runMutation(transactional, { productId: 'p1' }, { user: 'u1' }),
    },
  };
}

export async function serverDataPlaneBehaviorFact(
  runtime: ServerDataPlaneRuntime,
): Promise<ServerDataPlaneBehaviorFact> {
  // SPEC.md §6.4/§9.3: query, route, CSRF, and endpoint helpers are public data-plane APIs.
  const product = runtime.domain('product');
  const productQuery = runtime.query('productDetail', {
    args: runtime.s.object({
      id: runtime.s.string(),
      max: runtime.s.number().int().default(10),
    }),
    guard: (request: { session?: { userId?: string } | null }) => request.session?.userId === 'u1',
    instanceKey: (input: { id: string }) => `product:${input.id}`,
    load(
      input: { id: string; max: number },
      { request }: { request: { session?: { userId?: string } | null } },
    ) {
      return { id: input.id, max: input.max, userId: request.session?.userId };
    },
    reads: [product],
    version: (input: { max: number }) => input.max,
  });

  const productRoute = runtime.route('/products/:id', {
    guard: (request: { session?: { userId?: string } | null }) => request.session?.userId === 'u1',
    page(
      context: { params: { id: string }; search: { tab: string } },
      request: { session: { userId: string } },
    ) {
      if (context.params.id === 'missing') return runtime.notFound();
      return `${request.session.userId}:${context.params.id}:${context.search.tab}`;
    },
    params: runtime.s.object({ id: runtime.s.string() }),
    search: runtime.s.object({ tab: runtime.s.string() }),
  });

  const request = { session: { id: 's1' } };
  const csrf = {
    field: 'csrf',
    secret: 'test-secret',
    sessionId: (candidate: typeof request) => candidate.session.id,
  };
  let guardCalls = 0;
  const addToCart = runtime.mutation('cart/add', {
    csrf,
    guard() {
      guardCalls += 1;
      return true;
    },
    handler(input: { productId: string }) {
      return input.productId;
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
  });
  const token = runtime.csrfToken(request, csrf, { audience: addToCart.key });
  const success = await runtime.runMutation(addToCart, { csrf: token, productId: 'p1' }, request);
  const guardCallsAfterSuccess = guardCalls;
  const missingToken = await runtime.runMutation(addToCart, { productId: 'p1' }, request);

  return {
    csrf: {
      field: runtime.csrfField(request, { ...csrf, audience: addToCart.key }),
      guardCallsAfterFailure: guardCalls,
      guardCallsAfterSuccess,
      missingToken,
      success,
    },
    query: {
      endpoint: await runtime.renderQueryEndpointResponse(productQuery, {
        request: { session: { userId: 'u1' } },
        search: new URLSearchParams([
          ['id', 'p1'],
          ['max', '3'],
        ]),
      }),
      invalidInput: await runtime.runQuery(productQuery, {}, { session: { userId: 'u1' } }),
      missingRegistryQuery: await runtime.renderQueryRegistryEndpointResponse(
        { queries: [productQuery] },
        'missing',
        {
          request: {},
        },
      ),
      success: await runtime.runQuery(productQuery, { id: 'p1' }, { session: { userId: 'u1' } }),
      unauthorized: await runtime.runQuery(productQuery, { id: 'p1' }, { session: null }),
    },
    route: {
      notFound: await runtime.renderRoutePageResponse(
        productRoute,
        { params: { id: 'missing' }, search: { tab: 'details' } },
        { session: { userId: 'u1' } },
      ),
      success: await runtime.runRoutePage(
        productRoute,
        { params: { id: 'p1' }, search: { tab: 'details' } },
        { session: { userId: 'u1' } },
      ),
    },
  };
}

export async function serverCommerceTransactionBehaviorFact(
  runtime: ServerMutationLifecycleRuntime,
): Promise<ServerCommerceTransactionBehaviorFact> {
  const createTransactionalDb = () => {
    const db = {
      commits: 0,
      items: [] as Array<{ productId: string; qty: number }>,
      rollbacks: 0,
      async transaction(
        run: (draft: { items: Array<{ productId: string; qty: number }> }) => Promise<unknown>,
      ) {
        const draft = { items: this.items.map((item) => ({ ...item })) };
        try {
          const result = await run(draft);
          this.items = draft.items;
          this.commits += 1;
          return result;
        } catch (error) {
          this.rollbacks += 1;
          throw error;
        }
      },
    };
    return db;
  };

  const addToCart = runtime.mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: runtime.s.object({
        availableQuantity: runtime.s.number().int().min(0),
      }),
    },
    handler(
      input: { productId: string; quantity: number },
      request: { db: ReturnType<typeof createTransactionalDb> },
      context: { fail(code: string, payload: unknown): unknown },
    ) {
      if (input.quantity > 5) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 5 });
      }

      request.db.items.push({ productId: input.productId, qty: input.quantity });
      return { count: request.db.items.length };
    },
    input: runtime.s.object({
      productId: runtime.s.string(),
      quantity: runtime.s.number().int().min(1),
    }),
    transaction(
      request: { db: ReturnType<typeof createTransactionalDb> },
      run: (request: unknown) => Promise<unknown>,
    ) {
      return request.db.transaction((db) => run({ ...request, db }));
    },
  });

  const db = createTransactionalDb();
  const successful = await runtime.runMutation(addToCart, { productId: 'p1', quantity: 2 }, { db });
  const successfulDb = {
    commits: db.commits,
    items: db.items,
    rollbacks: db.rollbacks,
  };

  const failed = await runtime.runMutation(addToCart, { productId: 'p2', quantity: 99 }, { db });

  return {
    failed: {
      db: {
        commits: db.commits,
        items: db.items,
        rollbacks: db.rollbacks,
      },
      result: failed,
    },
    successful: {
      db: successfulDb,
      result: successful,
    },
  };
}

export async function serverCommerceStylesheetBehaviorFact(
  runtime: ServerCommerceStylesheetRuntime,
): Promise<ServerCommerceStylesheetBehaviorFact> {
  // plans/open-design-areas.md / rules/v1-acceptance.md: commerce fragments prove platform stylesheet hints, not app-local wiring.
  const stylesheetManifest = [
    {
      criticalCss: 'cart-badge { color: teal; }</style> cart-badge { display: block; }',
      fragmentTargets: ['cart-badge'],
      href: '/assets/styles.css',
    },
    {
      fragmentTargets: ['recommendations'],
      href: '/assets/recommendations.css',
      preload: false,
    },
  ];
  const selectedStylesheets = runtime.stylesheetsForTargets(stylesheetManifest, ['cart-badge']);
  const pageHints = runtime.renderPageHints({
    stylesheets: runtime.stylesheetsForTargets(stylesheetManifest),
  });
  const deferred = runtime.renderDeferredStream({
    chunks: [
      {
        fragments: [
          {
            html: '<section class="recommendation-panel">Ready</section>',
            stylesheets: runtime.stylesheetsForTargets(stylesheetManifest, ['recommendations']),
            target: 'recommendations',
          },
        ],
      },
    ],
    shell: '<!doctype html><main><kovo-defer target="recommendations"></kovo-defer></main>',
  });
  const deferredElements = htmlElementFacts(deferred.body);
  const cart = runtime.domain('cart');
  const addToCart = runtime.mutation('cart/add', {
    csrf: false,
    errors: {
      OUT_OF_STOCK: runtime.s.object({ availableQuantity: runtime.s.number().int().min(0) }),
    },
    handler(
      _input: unknown,
      _request: unknown,
      context: { fail(code: string, payload: unknown): unknown },
    ) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
    registry: { touches: [cart] },
  });

  return {
    deferred: {
      fragmentAttrs: deferredElements.find((element) => element.tag === 'kovo-fragment')?.attrs,
      linkAttrs: deferredElements.find((element) => element.tag === 'link')?.attrs,
      sectionAttrs: deferredElements.find((element) => element.tag === 'section')?.attrs,
      tags: deferredElements.map((element) => element.tag),
    },
    failure: await runtime.renderMutationEndpointResponse(addToCart, {
      failureStylesheets: ['/assets/styles.css'],
      failureTarget: 'product-form:p2',
      headers: { 'Kovo-Fragment': 'true' },
      rawInput: { productId: 'p2' },
      renderFailureFragment: () =>
        '<form class="cart-form-panel"><output role="alert">Only 0 left.</output></form>',
      request: {},
    }),
    pageHints,
    selectedStylesheets,
  };
}

export async function serverCommerceAdoptDontInventBehaviorFact(
  runtime: ServerCommerceAdoptDontInventRuntime,
  graph: {
    mutations: Array<Record<string, unknown>>;
    pages: Array<Record<string, unknown>>;
  },
): Promise<ServerCommerceAdoptDontInventBehaviorFact> {
  // plans/open-design-areas.md and rules/v1-acceptance.md: commerce covers platform features without custom client/state seams.
  const cartPage = graph.pages.find((page) => page.route === '/cart');
  const receiptMutation = graph.mutations.find((item) => item.key === 'order/receipt');

  const cartQuery = runtime.query('cart', {
    load: () => ({ count: 1 }),
    reads: [runtime.domain('cart')],
  });
  const cartMeta = runtime.metaFromQuery(cartQuery, (cart: { count: number }) => ({
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Kovo Commerce (${cart.count})`,
  }));
  const messages = runtime.i18n('en-US', {
    cartLabel: 'Cart ({count})',
    productStock: '{stock} in stock',
  });

  let missingQueryMessage = '';
  try {
    runtime.renderPageHints({ meta: cartMeta });
  } catch (error) {
    missingQueryMessage = error instanceof Error ? error.message : String(error);
  }

  const commerceSession = runtime.session(
    runtime.s.object({
      id: runtime.s.string(),
      user: runtime.s.object({ id: runtime.s.string() }),
    }),
  );
  const authenticatedRequest = { session: { id: 's1', user: { id: 'u1' } } };
  const guarded = runtime.guards.all(
    runtime.guards.authed(),
    runtime.guards.rateLimit({ max: 1, per: 'session' }),
  );
  const firstRateLimit = await guarded(authenticatedRequest);
  const secondRateLimit = await guarded(authenticatedRequest);

  const storedObjects = new Map<string, Record<string, unknown>>();
  const storage = {
    async get(key: string) {
      return storedObjects.get(key);
    },
    async put(
      key: string,
      body: ArrayBuffer | ArrayBufferView | string,
      options: { contentType?: string; metadata?: unknown } = {},
    ) {
      const bytes =
        body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : ArrayBuffer.isView(body)
            ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
            : new TextEncoder().encode(String(body));
      const stored = {
        body: bytes,
        contentType: options.contentType,
        key,
        metadata: options.metadata,
        size: bytes.byteLength,
      };
      storedObjects.set(key, stored);
      return stored;
    },
    async stat(key: string) {
      return storedObjects.get(key);
    },
    async stream(key: string) {
      const stored = storedObjects.get(key);
      return stored ? { ...stored, body: new Blob([stored.body as BlobPart]).stream() } : undefined;
    },
  };
  const uploadReceipt = runtime.mutation('order/receipt', {
    csrf: false,
    handler(input: any, request: unknown) {
      const session = commerceSession.parse(request) as { user: { id: string } };
      return {
        orderId: input.orderId,
        session: session.user.id,
        storageKey: input.receipt.storage.key,
      };
    },
    input: runtime.s.object({
      orderId: runtime.s.string(),
      // KV428: the storage key is server-minted under the `receipts` namespace; the client filename
      // is sanitized metadata only. The accepted-type allowlist is checked against sniffed bytes.
      receipt: runtime.s.file({ maxBytes: 64 * 1024 }).store({ keyPrefix: 'receipts', storage }),
    }),
    registry: { touches: [runtime.domain('attachment')] },
  });
  const receiptForm = new FormData();
  receiptForm.set('orderId', 'o1');
  // Real PDF magic bytes (`%PDF-`) so the KV428 sniffer mints `application/pdf` (server truth).
  receiptForm.set(
    'receipt',
    new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e])], {
      type: 'application/pdf',
    }),
    'receipt.pdf',
  );

  const uploadResult = await runtime.runMutation(uploadReceipt, receiptForm, authenticatedRequest);

  const element = (initialAttributes: Record<string, string>) => {
    const attributes = { ...initialAttributes };
    return {
      getAttribute(name: string) {
        return attributes[name] ?? null;
      },
      removeAttribute(name: string) {
        delete attributes[name];
      },
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
    };
  };
  const progressElement = element({ 'kovo-upload-progress': '', max: '100', value: '0' });
  const pendingElement = element({ 'kovo-deps': 'order' });
  const form = {
    ...element({ 'data-mutation': 'order/receipt', enhance: '', 'kovo-deps': 'order' }),
    action: '/_m/order/receipt',
    method: 'post',
    querySelectorAll(selector: string) {
      return selector === '[kovo-upload-progress]' ? [progressElement] : [];
    },
  };
  const mutationRoot = {
    findFragmentTarget() {
      return null;
    },
    querySelectorAll(selector: string) {
      return selector === '[kovo-deps]' ? [pendingElement] : [];
    },
  };
  let pendingDuringResponse: string | null = null;

  await runtime.submitEnhancedMutation({
    fetch: async (_url: unknown, options: { onUploadProgress?: (progress: any) => void }) => ({
      headers: { get: () => null },
      async text() {
        options.onUploadProgress?.({ loaded: 32, total: 64 });
        pendingDuringResponse = pendingElement.getAttribute('kovo-pending');
        return '<kovo-query name="receipt">{"ok":true}</kovo-query>';
      },
    }),
    form,
    formData: receiptForm,
    onUploadProgress(progress: { loaded: number; total?: number }) {
      const total = progress.total ?? 0;
      progressElement.setAttribute('max', '100');
      progressElement.setAttribute('value', String(Math.round((progress.loaded / total) * 100)));
    },
    pendingQueries: ['order'],
    pendingRoot: mutationRoot,
    root: mutationRoot,
    store: runtime.createQueryStore(),
  });

  const fragmentFailure = runtime.mutation('product-grid/reload', {
    csrf: false,
    handler(input: unknown) {
      return input;
    },
    input: runtime.s.object({ productId: runtime.s.string() }),
  });
  const failureResponse = await runtime.renderMutationEndpointResponse(fragmentFailure, {
    buildToken: 'conformance-server-test-build',
    fragmentRenderers: [
      runtime.errorBoundary(
        {
          render() {
            throw new Error('fragment failed');
          },
          stylesheets: ['/assets/styles.css'],
          target: 'product-grid',
        },
        {
          render(error: Error) {
            return `<section role="alert">${error.message}</section>`;
          },
          target: 'product-grid-error',
        },
      ),
    ],
    headers: { 'Kovo-Fragment': 'true', 'Kovo-Targets': 'product-grid' },
    rawInput: { productId: 'p1' },
    request: {},
  });

  return {
    fragmentFailure: failureResponse,
    graph: {
      cartPage: cartPage ?? {},
      receiptMutation: receiptMutation ?? {},
    },
    guards: {
      authenticatedSession: commerceSession.parse(authenticatedRequest),
      authedFailure: await runtime.guards.authed()({ session: null }),
      firstRateLimitPasses: firstRateLimit === true,
      secondRateLimitFailure:
        typeof secondRateLimit === 'object' && secondRateLimit !== null
          ? String((secondRateLimit as { kind?: unknown }).kind)
          : undefined,
    },
    pageHints: {
      missingQueryMessage,
      rendered: runtime.renderPageHints(
        { i18n: messages, meta: cartMeta },
        { queries: { cart: { count: 1 } } },
      ),
      translation: runtime.t(messages, 'cartLabel', { count: 1 }),
    },
    upload: {
      pendingAfterSubmit: pendingElement.getAttribute('kovo-pending'),
      pendingDuringResponse,
      progress: {
        max: progressElement.getAttribute('max'),
        value: progressElement.getAttribute('value'),
      },
      result: uploadResult,
      stored: await storage.stat(uploadedReceiptKey(uploadResult)),
    },
  };
}

/** Extract the server-minted receipt key from the upload mutation result (KV428). */
function uploadedReceiptKey(result: unknown): string {
  const value = (result as { value?: { storageKey?: unknown } })?.value;
  return typeof value?.storageKey === 'string' ? value.storageKey : 'receipts/missing';
}
