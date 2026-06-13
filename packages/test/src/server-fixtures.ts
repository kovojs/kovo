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
  const token = runtime.csrfToken(request, csrf);
  const success = await runtime.runMutation(addToCart, { csrf: token, productId: 'p1' }, request);
  const guardCallsAfterSuccess = guardCalls;
  const missingToken = await runtime.runMutation(addToCart, { productId: 'p1' }, request);

  return {
    csrf: {
      field: runtime.csrfField(request, csrf),
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
