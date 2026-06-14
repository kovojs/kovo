import { createMemoryStorage, form, stripeSignature } from '@jiso/core';
import {
  createMemoryMutationReplayStore,
  errorBoundary,
  csrfField,
  csrfToken,
  escapeAttribute,
  escapeHtml,
  guards,
  i18n,
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
import { and, count, eq, sql } from 'drizzle-orm';

import { createCommerceDb, type CommerceDb } from './db.js';
import { attachment, cart, order, product } from './domains.js';
import { CartBadge } from './generated/cart-badge.js';
import { cartAddDerivedOptimistic } from './generated/optimistic/cart-add.js';
import { OrderHistory } from './generated/order-history.js';
import * as productGridComponent from './generated/product-grid.js';
import { commerceTouchGraph } from './generated/touch-graph.js';
import { commerceStylesheets, createCommerceGraph } from './graph.js';
import { commerceCartPageMeta } from './page-meta.js';
import {
  cartQuery,
  loadCartQuery,
  loadOrderHistory,
  loadProductGrid,
  orderHistoryQuery,
  productGridQuery,
  type CartQueryResult,
  type OrderHistoryResult,
  type ProductGridInput,
  type ProductGridResult,
} from './queries.js';
import { attachments, cartItems, orders, products } from './schema.js';

export { commerceTouchGraph } from './generated/touch-graph.js';
export { commerceStylesheets } from './graph.js';
export { commerceCartPageMeta } from './page-meta.js';
export { createCommerceDb, type CommerceDb } from './db.js';
export { loadCartQuery, loadProductGrid, loadOrderHistory } from './queries.js';
export type {
  CartQueryResult,
  OrderHistoryResult,
  ProductGridInput,
  ProductGridResult,
} from './queries.js';

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

export type AddToCartFailure = MutationFail<string, unknown>;
export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string;
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
    return request.db.transaction((tx) => run({ ...request, db: tx as unknown as CommerceDb }));
  },
  // SPEC.md §10.5 Stage 1: the static extractor lowers these real Drizzle writes
  // into the symbolic effect IR (insert cart_items{qty}, insert orders{…}, update
  // products SET stock = stock - quantity WHERE id = productId). Destructuring the
  // input binds `productId`/`quantity` to `$input` paths; `const db = request.db`
  // is the proven Drizzle receiver the write extractor follows.
  async handler({ productId, quantity }, request: CommerceRequest, context) {
    const currentSession = commerceSession.parse(request);
    const db = request.db;
    const found = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!found || found.stock < quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    const existingOrders = await db.select({ value: count() }).from(orders);
    const orderId = `order-${Number(existingOrders[0]?.value ?? 0) + 1}`;

    await db.insert(cartItems).values({
      productId: productId,
      qty: quantity,
      unitPrice: found.unitPrice,
    });
    await db.insert(orders).values({
      id: orderId,
      productId: productId,
      qty: quantity,
      total: found.unitPrice * quantity,
      userId: currentSession.user.id,
    });
    await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${quantity}` })
      .where(eq(products.id, productId));
    return { productId: productId, quantity: quantity };
  },
});

// SPEC.md §10.4/§10.5: optimism for cart/add is now compiler-DERIVED. The
// generated/optimistic/cart-add.ts transforms (count += quantity, push the new
// order row with placeholders, decrement the matched product's stock) supersede
// the previously hand-written `cart` transform and the `await-fragment` punts on
// orderHistory/productGrid. Deleting a transform there lets you hand-write an
// override; regenerating restores derivation (the §10.4 pair-by-pair contract).
export const addToCartOptimistic = cartAddDerivedOptimistic;

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
  async handler(input: UploadReceiptInput, request: CommerceRequest) {
    const currentSession = commerceSession.parse(request);
    const db = request.db;
    const existing = await db.select({ value: count() }).from(attachments);
    const attachmentId = `attachment-${Number(existing[0]?.value ?? 0) + 1}`;

    await db.insert(attachments).values({
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
    return request.db.transaction((tx) => run(tx as unknown as CommerceDb));
  },
  async handler(input: PaymentWebhookInput, context) {
    if (input.type !== 'checkout.session.completed') {
      return context.fail('IGNORED_EVENT', { type: input.type }, { status: 422 });
    }

    const paid = input.data.object;
    const tx = context.tx as CommerceDb;
    await tx.insert(orders).values({
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
  async page(_context, request) {
    const allOrders = await loadOrdersForCsv(request.db);
    return respond.stream(ordersCsvStream(allOrders, request.session.user.id), {
      contentType: 'text/csv; charset=utf-8',
      etag: `"orders-${allOrders.length}"`,
      filename: 'orders.csv',
    });
  },
});

export const attachmentDownloadRoute = route('/attachments/:id', {
  guard: betterAuthAuthed<CommerceRequest>(),
  async page(context, request) {
    const db = request.db;
    const found = (
      await db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, context.params.id),
            eq(attachments.userId, request.session.user.id),
          ),
        )
        .limit(1)
    )[0];
    if (!found) return notFound();

    const stored = await commerceAttachmentStorage.stream(found.storageKey);
    if (!stored) return notFound();

    return respond.stream(stored.body, {
      contentType: found.contentType,
      disposition: 'inline',
      filename: found.filename,
      ...(stored.etag ? { etag: stored.etag } : {}),
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

export const commerceMessageCatalog = {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
} as const;

export const commerceMessages = i18n('en-US', commerceMessageCatalog);

export const commerceMeta = metaFromQuery(cartQuery, commerceCartPageMeta);

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
  options: { readOnly?: boolean | undefined } = {},
): string {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component;
  // fw-c and fw-deps are compiler-derived (section 4.8). SPEC.md section
  // 10.2 keeps query data separate from request-only form failure context.
  return ProductGrid.definition.render(
    { productGrid: result },
    { failure: addToCartFailure, readOnly: options.readOnly, request },
  );
}

export function renderProductGridAppend(
  result: ProductGridResult,
  request?: CommerceRequest,
): string {
  return renderProductGridItems(result, undefined, request);
}

export async function renderProductGridPageFragment(
  db: CommerceDb,
  input: ProductGridInput = {},
): Promise<string> {
  return `<fw-fragment target="product-grid" mode="append">${renderProductGridAppend(await loadProductGrid(db, input))}</fw-fragment>`;
}

export async function renderProductGridDeferredStream(
  db: CommerceDb,
  input: ProductGridInput = {},
) {
  const productGrid = await loadProductGrid(db, input);

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

export async function renderOrderHistory(db: CommerceDb): Promise<string> {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component
  // (src/components/order-history.tsx); fw-c and fw-deps are compiler-derived.
  const history = await loadOrderHistory(db);
  return OrderHistory.definition.render({ orderHistory: history });
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

async function loadOrdersForCsv(db: CommerceDb): Promise<OrderHistoryResult['items']> {
  return (await loadOrderHistory(db)).items;
}

function ordersCsvStream(
  orders: OrderHistoryResult['items'],
  userId: string,
): ReadableStream<Uint8Array> {
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

export function renderCommercePageHints(cart: CartQueryResult = { count: 0 }) {
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

export async function renderCartPage(
  db = createCommerceDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: CommerceRequest,
): Promise<string> {
  const pageHints = renderCommercePageHints(await loadCartQuery(db));
  return `<html><head>${pageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6">${await renderCartPageBody(db, addToCartFailure, request)}</body></html>`;
}

export async function renderCartPageBody(
  db = createCommerceDb(),
  addToCartFailure?: AddToCartFailureState,
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
): Promise<string> {
  const cartBadge = CartBadge.definition.render({ cart: await loadCartQuery(db) });
  const productGrid = renderProductGrid(
    await loadProductGridForRequest(db, undefined, request),
    request,
    addToCartFailure,
    { readOnly: options.readOnly },
  );
  const receiptForm = options.readOnly ? '' : renderReceiptUploadForm();
  return `<main class="mx-auto max-w-4xl"><fw-fragment target="cart-badge">${cartBadge}</fw-fragment><fw-fragment target="product-grid">${productGrid}</fw-fragment><fw-fragment target="order-history">${await renderOrderHistory(db)}${receiptForm}</fw-fragment></main>`;
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
        render: async () => CartBadge.definition.render({ cart: await loadCartQuery(request.db) }),
        stylesheets: commerceStylesheets,
        target: 'cart-badge',
      },
      errorBoundary(
        {
          render: async () =>
            renderProductGrid(
              await loadProductGridForRequest(request.db, undefined, request),
              request,
            ),
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

async function loadProductForFailure(
  db: CommerceDb,
  productId: string,
): Promise<{ id: string; stock: number; unitPrice: number } | undefined> {
  return (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
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

async function loadProductGridForRequest(
  db: CommerceDb,
  input?: ProductGridInput,
  request?: CommerceRequest,
): Promise<ProductGridResult> {
  const productGridError = request?.renderFaults?.productGrid?.();
  if (productGridError) throw productGridError;

  return loadProductGrid(db, input);
}

async function renderAddToCartFailureFragment(
  db: CommerceDb,
  rawInput: unknown,
  failure: AddToCartFailure,
  request: CommerceRequest,
): Promise<string> {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? await loadProductForFailure(db, productId) : undefined;

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

// A fresh, unmodified database has an empty cart (count 0); the demo graph is a
// module-load static, so it uses that starter value rather than awaiting a read.
export const commerceGraph = createCommerceGraph({ count: 0 }, commerceTouchGraph);
