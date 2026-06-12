import { createMemoryStorage, form, stripeSignature } from '@jiso/core';
import type { OptimisticFor } from '@jiso/runtime';
import {
  createMemoryMutationReplayStore,
  errorBoundary,
  csrfField,
  csrfToken,
  escapeAttribute,
  escapeHtml,
  guards,
  i18n,
  meta,
  metaFromQuery,
  mutation,
  notFound,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderPageHints,
  renderRoutePageResponse,
  respond,
  route,
  runWebhook,
  s,
  session,
  webhook,
  type MutationFail,
  type MutationWireHeaderSource,
  type StoredFileUpload,
} from '@jiso/server';
import {
  authed as betterAuthAuthed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  role as betterAuthRole,
  type BetterAuthLike,
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
} from '@jiso/better-auth';
import type { FwExplainInput } from '@jiso/core';
import { attachment, cart, order, product } from './domains.js';
import { CartBadge } from './generated/cart-badge.js';
import { OrderHistory } from './generated/order-history.js';
import * as productGridComponent from './generated/product-grid.js';
import { commerceTouchGraph } from './generated/touch-graph.js';
import { cartQuery, orderHistoryQuery, productGridQuery } from './queries.js';

export { commerceTouchGraph } from './generated/touch-graph.js';

export interface CommerceDb {
  attachments: {
    contentType: string;
    filename: string;
    id: string;
    orderId: string;
    size: number;
    storageKey: string;
    userId: string;
  }[];
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  orders: { id: string; productId: string; qty: number; total: number; userId: string }[];
  products: Map<string, { id: string; stock: number; unitPrice: number }>;
  read(table: string): unknown[];
  transaction<Result>(run: (db: CommerceDb) => Promise<Result>): Promise<Result>;
  write(table: string, value: unknown): void;
}

export interface ProductGridInput {
  after?: string;
  limit?: number;
}

export interface ProductGridResult {
  items: { id: string; stock: number; unitPrice: number }[];
  nextCursor: string | null;
}

export type CommerceRole = 'admin' | 'member';

export interface CommerceRenderFaults {
  productGrid?: () => Error;
}

export interface CommerceSession {
  id: string;
  user: {
    id: string;
    roles?: readonly CommerceRole[];
  };
}

export interface CommerceRequest {
  db: CommerceDb;
  renderFaults?: CommerceRenderFaults;
  session?: CommerceSession | null;
}

export interface CommerceAuthRequest extends CommerceRequest {
  authCsrfId?: string | null;
  headers: Headers;
}

export interface CommerceBetterAuthSession {
  id: string;
}

export interface CommerceBetterAuthUser {
  email: string;
  id: string;
  roles: readonly CommerceRole[];
}

export type CommerceBetterAuth = BetterAuthLike<CommerceBetterAuthSession, CommerceBetterAuthUser> &
  BetterAuthSignInEmailLike &
  BetterAuthSignOutLike;

export interface CommerceLoginFailureState {
  code: 'INVALID_CREDENTIALS';
}

export const commerceSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
    }),
  }),
);

export const EXAMPLE_ONLY_COMMERCE_CSRF_SECRET = 'EXAMPLE_ONLY_COMMERCE_CSRF_SECRET';
export const EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET = 'EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET';

export const commerceCsrf = {
  field: 'csrf',
  secret: EXAMPLE_ONLY_COMMERCE_CSRF_SECRET,
  sessionId(request: CommerceRequest) {
    return request.session?.id;
  },
};

export const commerceAuthCsrf = {
  field: 'csrf',
  secret: EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
  sessionId(request: CommerceAuthRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
};

const commerceAuthCookieName = 'jiso_commerce_session';

const commerceAuthUsers = new Map<
  string,
  CommerceBetterAuthUser & { name: string; password: string }
>([
  [
    'ada@example.com',
    {
      email: 'ada@example.com',
      id: 'u1',
      name: 'Ada Lovelace',
      password: 'correct',
      roles: ['admin', 'member'],
    },
  ],
  [
    'grace@example.com',
    {
      email: 'grace@example.com',
      id: 'u2',
      name: 'Grace Hopper',
      password: 'correct',
      roles: ['member'],
    },
  ],
]);

export function createCommerceBetterAuth(): CommerceBetterAuth {
  const sessionUserIds = new Map<string, string>();

  return {
    api: {
      getSession(options) {
        const token = readCookie(options.headers, commerceAuthCookieName);
        const userId = token ? sessionUserIds.get(token) : undefined;
        const user = userId
          ? [...commerceAuthUsers.values()].find((candidate) => candidate.id === userId)
          : undefined;

        if (!token || !user) return null;

        return {
          session: { id: token },
          user: {
            email: user.email,
            id: user.id,
            roles: user.roles,
          },
        };
      },
      signInEmail(options) {
        const user = commerceAuthUsers.get(options.body.email);
        if (!user || user.password !== options.body.password) {
          return commerceAuthResponse([], 401);
        }

        const token = `session-${user.id}`;
        sessionUserIds.set(token, user.id);

        return commerceAuthResponse([
          `${commerceAuthCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax`,
        ]);
      },
      signOut(options) {
        const token = readCookie(options.headers, commerceAuthCookieName);
        if (token) sessionUserIds.delete(token);

        return commerceAuthResponse([
          `${commerceAuthCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        ]);
      },
    },
  };
}

export const commerceBetterAuth = createCommerceBetterAuth();

export const commerceSessionProvider = commerceSession.provider(
  betterAuthSession<
    CommerceBetterAuthSession,
    CommerceBetterAuthUser,
    CommerceSession,
    CommerceAuthRequest
  >(commerceBetterAuth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: {
      id: user.id,
      roles: user.roles,
    },
  })),
);

export const commerceAdminGuard = betterAuthRole<CommerceAuthRequest>('admin');

export const commerceSignIn = betterAuthSignInEmailMutation<'auth/sign-in', CommerceAuthRequest>(
  commerceBetterAuth,
  {
    csrf: commerceAuthCsrf,
    defaultRedirectTo: '/cart',
  },
);

export const commerceSignOut = betterAuthSignOutMutation<
  'auth/sign-out',
  CommerceAuthRequest,
  CommerceAuthRequest & { session: CommerceSession }
>(commerceBetterAuth, {
  csrf: commerceAuthCsrf,
  defaultRedirectTo: '/login',
  guard: betterAuthAuthed<CommerceAuthRequest>(),
});

export function createCommerceDb(): CommerceDb {
  const db: CommerceDb = {
    attachments: [],
    cartItems: [],
    orders: [],
    products: new Map([
      ['p1', { id: 'p1', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', stock: 8, unitPrice: 399 }],
    ]),
    read(table) {
      if (table === 'cart_items') return db.cartItems;
      if (table === 'attachments') return db.attachments;
      if (table === 'orders') return db.orders;
      if (table === 'products') return [...db.products.values()];
      return [];
    },
    async transaction(run) {
      const draft = cloneCommerceDb(db);
      const result = await run(draft);

      db.cartItems = draft.cartItems;
      db.orders = draft.orders;
      db.products = draft.products;

      return result;
    },
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as { productId: string; qty: number; unitPrice: number });
      }
      if (table === 'attachments') {
        db.attachments.push(value as CommerceDb['attachments'][number]);
      }
      if (table === 'orders') {
        db.orders.push(
          value as { id: string; productId: string; qty: number; total: number; userId: string },
        );
      }
      if (table === 'products') {
        const product = value as { id: string; stock: number; unitPrice: number };
        db.products.set(product.id, product);
      }
    },
  };
  return db;
}

function cloneCommerceDb(source: CommerceDb): CommerceDb {
  const clone = createCommerceDb();

  clone.attachments = source.attachments.map((item) => ({ ...item }));
  clone.cartItems = source.cartItems.map((item) => ({ ...item }));
  clone.orders = source.orders.map((item) => ({ ...item }));
  clone.products = new Map(
    [...source.products.entries()].map(([key, value]) => [key, { ...value }]),
  );

  return clone;
}

export { attachment, cart, order, product, cartQuery, orderHistoryQuery, productGridQuery };

export type AddToCartInput = {
  productId: string;
  quantity: number;
};

export const addToCartForm = form<'cart/add', AddToCartInput>('cart/add');

export interface UploadReceiptInput {
  orderId: string;
  receipt: StoredFileUpload;
}

export interface PaymentWebhookInput {
  data: {
    object: {
      id: string;
      productId: string;
      quantity: number;
      total: number;
      userId: string;
    };
  };
  id: string;
  type: string;
}

export const commerceAttachmentStorage = createMemoryStorage();
export const commercePaymentWebhookSecret = 'whsec_commerce_reference_app';
export const commercePaymentReplayStore = createMemoryMutationReplayStore();

export interface CartQueryResult {
  count: number;
}

export type AddToCartFailure = MutationFail<string, unknown>;
export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string;
}

export const commerceStylesheets = ['/assets/tailwind.css'] as const;

export function loadProductGrid(db: CommerceDb, input: ProductGridInput = {}): ProductGridResult {
  const limit = input.limit ?? 2;
  const products = [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id));
  const start = input.after
    ? Math.max(products.findIndex((item) => item.id === input.after) + 1, 0)
    : 0;
  const items = products.slice(start, start + limit);
  const next = products[start + limit];

  return {
    items,
    nextCursor: next ? (items.at(-1)?.id ?? null) : null,
  };
}

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  guard: guards.all(
    betterAuthAuthed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  registry: {
    inferredTouches: commerceTouchGraph['cart.addItem'].touches,
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
  },
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request: CommerceRequest, context) {
    const currentSession = commerceSession.parse(request);
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.write('cart_items', {
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.write('orders', {
      id: `order-${request.db.orders.length + 1}`,
      productId: input.productId,
      qty: input.quantity,
      total: found.unitPrice * input.quantity,
      userId: currentSession.user.id,
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});

export const addToCartOptimistic = {
  queue: 'cart',
  transforms: {
    cart(current, input) {
      return {
        count: (current?.count ?? 0) + input.quantity,
      };
    },
    orderHistory: 'await-fragment',
    productGrid: 'await-fragment',
  },
} satisfies OptimisticFor<typeof addToCartForm>;

export const uploadReceipt = mutation('order/receipt', {
  input: s.object({
    orderId: s.string(),
    receipt: s.file({ maxBytes: 64 * 1024, mime: ['application/pdf', 'image/png'] }).store({
      key: (file) => `receipts/${file.name}`,
      metadata: (file) => ({ filename: file.name }),
      storage: commerceAttachmentStorage,
    }),
  }),
  guard: guards.all(
    betterAuthAuthed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 5, per: 'session' }),
  ),
  registry: {
    inferredTouches: commerceTouchGraph['order.receipt'].touches,
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
  },
  handler(input: UploadReceiptInput, request: CommerceRequest) {
    const currentSession = commerceSession.parse(request);
    const attachmentId = `attachment-${request.db.attachments.length + 1}`;

    request.db.write('attachments', {
      contentType: input.receipt.storage.contentType ?? input.receipt.file.type,
      filename: input.receipt.file.name,
      id: attachmentId,
      orderId: input.orderId,
      size: input.receipt.storage.size,
      storageKey: input.receipt.key,
      userId: currentSession.user.id,
    });

    return {
      attachmentId,
      fileName: input.receipt.file.name,
      orderId: input.orderId,
      size: input.receipt.storage.size,
      uploadedBy: currentSession.user.id,
    };
  },
});

export const paymentWebhook = webhook('payment/stripe', {
  path: '/webhooks/stripe',
  verify: stripeSignature({ secret: commercePaymentWebhookSecret }),
  input: s.object({
    data: s.object({
      object: s.object({
        id: s.string(),
        productId: s.string(),
        quantity: s.number().int().min(1),
        total: s.number().int().min(0),
        userId: s.string(),
      }),
    }),
    id: s.string(),
    type: s.string(),
  }),
  idempotency: (input) => input.id,
  replayStore: commercePaymentReplayStore,
  transaction(context, run) {
    const request = context.request as Request & { db?: CommerceDb };
    if (!request.db) throw new Error('commerce payment webhook requires db on request');
    return request.db.transaction((db) => run(db));
  },
  handler(input: PaymentWebhookInput, context) {
    if (input.type !== 'checkout.session.completed') {
      return context.fail('IGNORED_EVENT', { type: input.type }, { status: 422 });
    }

    const paid = input.data.object;
    const tx = context.tx as CommerceDb;
    tx.write('orders', {
      id: paid.id,
      productId: paid.productId,
      qty: paid.quantity,
      total: paid.total,
      userId: paid.userId,
    });
    context.recordChange(order, {
      input: { eventId: input.id, orderId: paid.id },
      keys: [paid.id],
      reason: 'payment webhook',
    });

    return { orderId: paid.id };
  },
});

export const orderCsvRoute = route('/exports/orders.csv', {
  guard: betterAuthAuthed<CommerceRequest>(),
  page(_context, request) {
    return respond.stream(ordersCsvStream(request.db.orders, request.session.user.id), {
      contentType: 'text/csv; charset=utf-8',
      etag: `"orders-${request.db.orders.length}"`,
      filename: 'orders.csv',
    });
  },
});

export const attachmentDownloadRoute = route('/attachments/:id', {
  guard: betterAuthAuthed<CommerceRequest>(),
  page(context, request) {
    const found = request.db.attachments.find(
      (item) => item.id === context.params.id && item.userId === request.session.user.id,
    );
    if (!found) return notFound();

    return commerceAttachmentStorage.stream(found.storageKey).then((stored) => {
      if (!stored) return notFound();

      return respond.stream(stored.body, {
        contentType: found.contentType,
        disposition: 'inline',
        filename: found.filename,
        ...(stored.etag ? { etag: stored.etag } : {}),
      });
    });
  },
});

export const commerceAdminRoute = route('/admin', {
  guard: commerceAdminGuard,
  page(_context, request: CommerceAuthRequest) {
    const currentSession = commerceSession.parse(request);
    return `admin:${currentSession.user.id}${renderCommerceLogoutForm(request)}`;
  },
});

export function renderOrderCsvRoute(request: CommerceRequest) {
  return renderRoutePageResponse(orderCsvRoute, {}, request);
}

export function renderAttachmentDownloadRoute(
  db: CommerceDb,
  id: string,
  request: CommerceRequest,
) {
  return renderRoutePageResponse(attachmentDownloadRoute, { params: { id } }, { ...request, db });
}

export function runPaymentWebhook(request: Request & { db?: CommerceDb }) {
  return runWebhook(paymentWebhook, request);
}

export function renderCommerceAdminRoute(request: CommerceAuthRequest) {
  return renderRoutePageResponse(
    commerceAdminRoute,
    {},
    request,
    (value) => `<main>${value}</main>`,
    {
      loginPath: '/login',
      renderForbidden: () => '<main>Forbidden</main>',
      sessionProvider: commerceSessionProvider,
    },
  );
}

export const commerceMessages = i18n('en-US', {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
});

export const commerceMeta = metaFromQuery(cartQuery, (cart) =>
  meta({
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Jiso Commerce (${cart.count})`,
  }),
);

export function loadCartQuery(db: CommerceDb): CartQueryResult {
  return {
    count: db.cartItems.reduce((total, item) => total + item.qty, 0),
  };
}

// The product grid (cards, no-JS add-to-cart forms, failure output) is
// authored as a TSX component in src/components/product-grid.tsx and compiled
// through @jiso/compiler (SPEC.md sections 3, 4.1, 5.2); the app imports its
// committed lowered IR from src/generated/. Bound via a namespace import so
// the import block stays one line: the committed touch graph pins the
// mutation handlers' write-site line numbers in this file.
export const {
  ProductGrid,
  productFormTarget,
  renderAddToCartError,
  renderAddToCartForm,
  renderProductGridItems,
} = productGridComponent;

export function renderProductGrid(
  result: ProductGridResult,
  request?: CommerceRequest,
  addToCartFailure?: AddToCartFailureState,
): string {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component;
  // fw-c and fw-deps are compiler-derived (section 4.8). SPEC.md section
  // 10.2 keeps query data separate from request-only form failure context.
  return ProductGrid.definition.render(
    { productGrid: result },
    { failure: addToCartFailure, request },
  );
}

export function renderProductGridAppend(
  result: ProductGridResult,
  request?: CommerceRequest,
): string {
  return renderProductGridItems(result, undefined, request);
}

export function renderProductGridPageFragment(
  db: CommerceDb,
  input: ProductGridInput = {},
): string {
  return `<fw-fragment target="product-grid" mode="append">${renderProductGridAppend(loadProductGrid(db, input))}</fw-fragment>`;
}

export function renderProductGridDeferredStream(db: CommerceDb, input: ProductGridInput = {}) {
  const productGrid = loadProductGrid(db, input);

  return renderDeferredStream({
    closeHtml: '</main></body></html>',
    chunks: [
      {
        fragments: [
          {
            html: renderProductGrid(productGrid),
            stylesheets: commerceStylesheets,
            target: 'product-grid',
          },
        ],
        queries: [{ name: 'productGrid', value: productGrid }],
      },
    ],
    shell:
      '<!doctype html><html><body><main class="min-h-dvh bg-slate-50 p-6"><fw-defer target="product-grid" state="pending"></fw-defer>',
  });
}

export function renderOrderHistory(db: CommerceDb): string {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component
  // (src/components/order-history.tsx); fw-c and fw-deps are compiler-derived.
  return OrderHistory.definition.render({ orderHistory: { items: db.orders } });
}

export function renderReceiptUploadForm(orderId = 'order-1'): string {
  return [
    '<form method="post" action="/_m/order/receipt" enhance data-mutation="order/receipt" enctype="multipart/form-data" fw-deps="order" class="mt-4 grid gap-2 rounded border border-slate-200 bg-white p-4" aria-busy="false">',
    `<input type="hidden" name="orderId" value="${escapeAttribute(orderId)}">`,
    '<label class="grid gap-1 text-sm font-medium text-slate-700"><span>Receipt</span>',
    '<input name="receipt" type="file" accept="application/pdf,image/png" class="rounded border border-slate-300 px-2 py-1">',
    '</label>',
    '<progress fw-upload-progress value="0" max="100" class="h-2 w-full" aria-label="Receipt upload progress"></progress>',
    '<button class="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">Upload receipt</button>',
    '</form>',
  ].join('');
}

function ordersCsvStream(orders: CommerceDb['orders'], userId: string): ReadableStream<Uint8Array> {
  const lines = [
    'id,productId,qty,total,userId',
    ...orders
      .filter((order) => order.userId === userId)
      .map((order) =>
        [order.id, order.productId, String(order.qty), String(order.total), order.userId]
          .map(csvCell)
          .join(','),
      ),
    '',
  ];
  const body = new TextEncoder().encode(lines.join('\n'));

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// CartBadge and OrderHistory are authored as TSX components under
// src/components/ and compiled through @jiso/compiler (SPEC.md sections 3,
// 4.1, 5.2); the app imports their committed lowered IR from src/generated/.
export { CartBadge, OrderHistory };

export function renderCommercePageHints(cart: CartQueryResult = loadCartQuery(createCommerceDb())) {
  return renderPageHints(
    {
      i18n: commerceMessages,
      meta: commerceMeta,
      stylesheets: commerceStylesheets,
    },
    { queries: { cart } },
  );
}

export const commercePageHints = renderCommercePageHints();

export function renderCartPage(
  db = createCommerceDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: CommerceRequest,
): string {
  const pageHints = renderCommercePageHints(loadCartQuery(db));
  return `<html><head>${pageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6">${renderCartPageBody(db, addToCartFailure, request)}</body></html>`;
}

export function renderCartPageBody(
  db = createCommerceDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: CommerceRequest,
): string {
  const cartBadge = CartBadge.definition.render({ cart: loadCartQuery(db) });
  const productGrid = renderProductGrid(
    loadProductGridForRequest(db, undefined, request),
    request,
    addToCartFailure,
  );
  return `<main class="mx-auto max-w-4xl"><fw-fragment target="cart-badge">${cartBadge}</fw-fragment><fw-fragment target="product-grid">${productGrid}</fw-fragment><fw-fragment target="order-history">${renderOrderHistory(db)}${renderReceiptUploadForm()}</fw-fragment></main>`;
}

export function submitAddToCartNoJs(rawInput: unknown, request: CommerceRequest) {
  return submitAddToCart(rawInput, request, {});
}

export function submitAddToCart(
  rawInput: unknown,
  request: CommerceRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  const submittedInput = appendCommerceCsrf(rawInput, request);
  return renderMutationEndpointResponse(addToCart, {
    csrf: commerceCsrf,
    failureTarget: productId ? productFormTarget(productId) : 'product-form',
    failureStylesheets: commerceStylesheets,
    fragmentRenderers: [
      {
        render: () => CartBadge.definition.render({ cart: loadCartQuery(request.db) }),
        stylesheets: commerceStylesheets,
        target: 'cart-badge',
      },
      errorBoundary(
        {
          render: () =>
            renderProductGrid(loadProductGridForRequest(request.db, undefined, request), request),
          stylesheets: commerceStylesheets,
          target: 'product-grid',
        },
        {
          render(error) {
            return `<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: ${escapeHtml((error as Error).message)}</section>`;
          },
        },
      ),
      {
        render: () => renderOrderHistory(request.db),
        stylesheets: commerceStylesheets,
        target: 'order-history',
      },
    ],
    headers,
    rawInput: submittedInput,
    redirectTo: '/cart',
    renderFailureFragment: (failure) =>
      renderAddToCartFailureFragment(request.db, rawInput, failure, request),
    renderFailurePage: (failure) =>
      renderCartPage(
        request.db,
        {
          failure,
          ...(productId ? { productId } : {}),
        },
        request,
      ),
    request,
  });
}

export function renderCommerceLoginForm(
  request: CommerceAuthRequest,
  options: { failure?: CommerceLoginFailureState; next?: string } = {},
): string {
  return [
    '<form method="post" action="/_m/auth/sign-in" enhance data-mutation="auth/sign-in" class="grid gap-4 rounded border border-slate-200 bg-white p-6">',
    csrfField(request, commerceAuthCsrf),
    `<input type="hidden" name="next" value="${escapeAttribute(options.next ?? '/cart')}">`,
    '<label class="grid gap-1 text-sm font-medium text-slate-700"><span>Email</span>',
    '<input class="rounded border border-slate-300 px-3 py-2" name="email" type="email" autocomplete="email" required>',
    '</label>',
    '<label class="grid gap-1 text-sm font-medium text-slate-700"><span>Password</span>',
    '<input class="rounded border border-slate-300 px-3 py-2" name="password" type="password" autocomplete="current-password" required>',
    '</label>',
    options.failure?.code === 'INVALID_CREDENTIALS'
      ? '<output role="alert" data-error-code="INVALID_CREDENTIALS" class="text-sm text-red-700">Invalid email or password.</output>'
      : '',
    '<button class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">Sign in</button>',
    '</form>',
  ].join('');
}

export function renderCommerceLogoutForm(request: CommerceAuthRequest): string {
  return [
    '<form method="post" action="/_m/auth/sign-out" enhance data-mutation="auth/sign-out" class="inline">',
    csrfField(request, commerceAuthCsrf),
    '<button class="text-sm font-medium text-slate-900" type="submit">Sign out</button>',
    '</form>',
  ].join('');
}

export function submitCommerceSignInNoJs(rawInput: unknown, request: CommerceAuthRequest) {
  const next = nextFromRawInput(rawInput);

  return renderMutationEndpointResponse(commerceSignIn, {
    csrf: commerceAuthCsrf,
    headers: {},
    rawInput,
    redirectTo: (result) => result.value.redirectTo,
    renderFailurePage: (failure) => {
      const failureState =
        failure.error.code === 'INVALID_CREDENTIALS'
          ? ({ failure: { code: 'INVALID_CREDENTIALS' } } as const)
          : {};

      return `<!doctype html><html><body>${renderCommerceLoginForm(request, {
        ...failureState,
        ...(next === undefined ? {} : { next }),
      })}</body></html>`;
    },
    request,
  });
}

export function submitCommerceSignOutNoJs(request: CommerceAuthRequest) {
  return renderMutationEndpointResponse(commerceSignOut, {
    csrf: commerceAuthCsrf,
    headers: {},
    rawInput: { csrf: csrfToken(request, commerceAuthCsrf) },
    redirectTo: (result) => result.value.redirectTo,
    request,
    sessionProvider: commerceSessionProvider,
  });
}

export function commerceCsrfInput(rawInput: unknown, request: CommerceRequest): unknown {
  return appendCommerceCsrf(rawInput, request);
}

function appendCommerceCsrf(rawInput: unknown, request: CommerceRequest): unknown {
  if (typeof rawInput !== 'object' || rawInput === null) return rawInput;
  if ('csrf' in rawInput) return rawInput;
  if (!request.session?.id) return rawInput;
  return {
    ...rawInput,
    csrf: csrfToken(request, commerceCsrf),
  };
}

function loadProductGridForRequest(
  db: CommerceDb,
  input?: ProductGridInput,
  request?: CommerceRequest,
): ProductGridResult {
  const productGridError = request?.renderFaults?.productGrid?.();
  if (productGridError) throw productGridError;

  return loadProductGrid(db, input);
}

function renderAddToCartFailureFragment(
  db: CommerceDb,
  rawInput: unknown,
  failure: AddToCartFailure,
  request: CommerceRequest,
): string {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? db.products.get(productId) : undefined;

  if (!product) return renderAddToCartError(failure);

  return renderAddToCartForm(product, failure, request);
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }
  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}

function nextFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('next' in rawInput)) {
    return undefined;
  }
  const next = rawInput.next;
  return typeof next === 'string' ? next : undefined;
}

function readCookie(headers: Headers, name: string): string | undefined {
  const cookie = headers.get('cookie');
  if (!cookie) return undefined;

  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=');
  }

  return undefined;
}

function commerceAuthResponse(cookies: readonly string[], status = 204): BetterAuthResponseLike {
  const headers = new Headers();

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
}

export const commerceGraph = {
  components: [
    {
      fragments: ['cart-badge'],
      name: 'CartBadge',
      queries: ['cart'],
    },
    {
      fragments: ['product-grid'],
      name: 'ProductGrid',
      queries: ['productGrid'],
    },
    {
      fragments: ['order-history'],
      name: 'OrderHistory',
      queries: ['orderHistory'],
    },
  ],
  endpoints: [
    {
      auth: 'verifier:stripe:v1:hmac-sha256',
      csrf: 'exempt',
      csrfJustification: 'payment/stripe webhook verifier stripe:v1:hmac-sha256',
      method: 'POST',
      name: 'payment/stripe',
      path: '/webhooks/stripe',
      writes: ['order'],
    },
    {
      auth: 'authed',
      csrf: 'checked',
      method: 'GET',
      name: 'orders/export',
      path: '/exports/orders.csv',
    },
    {
      auth: 'authed',
      csrf: 'checked',
      method: 'GET',
      name: 'attachments/download',
      path: '/attachments/:id',
    },
  ],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
    {
      enctype: 'multipart/form-data',
      fileFields: ['receipt'],
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['orderId', 'receipt'],
      key: 'order/receipt',
      session: 'commerceSession',
      writes: ['attachment'],
    },
    {
      guards: ['authed'],
      inputFields: [],
      key: 'auth/sign-out',
      session: 'commerceSession',
      writes: ['auth'],
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  ownerDomains: [{ domain: 'attachment', owner: 'userId' }],
  pages: [
    {
      guards: ['role:admin'],
      modulepreloads: [],
      prefetch: false,
      queries: [],
      route: '/admin',
      stylesheets: [...commerceStylesheets],
    },
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 0 verifiable cart item.',
        title: 'Jiso Commerce (0)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: [...commerceStylesheets],
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  scopeAudits: [
    {
      detail: 'attachment download filters id plus session user',
      domain: 'attachment',
      kind: 'query',
      name: 'attachments/download',
      scope: 'session',
      site: 'examples/commerce/src/app.ts:attachmentDownloadRoute',
    },
  ],
  touchGraph: commerceTouchGraph,
} satisfies FwExplainInput;
