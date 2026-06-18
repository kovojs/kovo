import { form, FormError, type FormInput } from '@kovojs/core';
import {
  componentMutationFailureSlots,
  csrfField,
  csrfToken,
  guards,
  i18n,
  metaFromQuery,
  mutation,
  renderComponent,
  renderComponentMutationFailure,
  renderDeferredStream,
  renderMutationEndpointResponse,
  renderMutationFormAttributes,
  renderPageHints,
  renderRoutePageResponse,
  route,
  s,
  session,
  type MutationFail,
} from '@kovojs/server';
import { Fragment, jsx, jsxs } from '@kovojs/server/jsx-runtime';
import { escapeAttribute } from '@kovojs/server/internal/html';
import type { MutationWireHeaderSource } from '@kovojs/server/internal/wire';
import {
  authed as betterAuthAuthed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  type BetterAuthLike,
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
} from '@kovojs/better-auth';
import { count, eq, sql } from 'drizzle-orm';

import { createCommerceDb, type CommerceDb } from './db.js';
import { cart, order, product } from './domains.js';
import { CartBadge } from './generated/cart-badge.js';
import { cartAddDerivedOptimistic } from './generated/optimistic/cart-add.js';
import { OrderHistory } from './generated/order-history.js';
import * as productGridComponent from './generated/product-grid.js';
import { commerceQueryDomains, commerceTouchGraph } from './generated/touch-graph.js';
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
import { cartItems, orders, products } from './schema.js';

export { commerceQueryDomains, commerceTouchGraph } from './generated/touch-graph.js';
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
    return request.session?.id ?? request.authCsrfId ?? 'commerce-shell-login';
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

export { cart, order, product, cartQuery, orderHistoryQuery, productGridQuery };

export const addToCartForm = form('cart/add');
export type AddToCartInput = FormInput<typeof addToCartForm>;

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
): string {
  // SPEC.md section 4.2: the markup comes from the compiled TSX component;
  // kovo-c and kovo-deps are compiler-derived (section 4.8). SPEC.md §6.3/§9.2
  // keeps mutation failures in forms.addToCart.failure, separate from query data.
  const slots = productGridRenderSlots(request, addToCartFailure?.productId);

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
  productId?: string,
): productGridComponent.ProductGridRenderSlots {
  return {
    forms: { addToCart: { failure: null } },
    ...(productId === undefined ? {} : { productId }),
    ...(request === undefined ? {} : { request }),
  };
}

export function renderProductGridAppend(
  result: ProductGridResult,
  request?: CommerceRequest,
): string {
  return renderProductGridItems(result, productGridRenderSlots(request), request);
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
  // Order history is per-user. With no authenticated user we default-deny and
  // render an empty history rather than leaking another user's orders.
  const history: OrderHistoryResult = userId ? await loadOrderHistory(db, userId) : { items: [] };
  return OrderHistory.definition.render({ orderHistory: history });
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
  const pageRequest = commerceCartPageRequest(db, request);
  const pageRoute = route('/cart', {
    page(_context, routeRequest: CommerceRequest) {
      return commerceCartMain(
        jsxs(Fragment, {
          children: [
            jsx(CartBadge, {}),
            jsx(ProductGrid, productGridCartPageSlots(addToCartFailure)),
            routeRequest.session?.user?.id
              ? jsx(OrderHistory, {})
              : OrderHistory.definition.render({ orderHistory: { items: [] } }),
          ],
        }),
      );
    },
  });
  const response = await renderRoutePageResponse(
    pageRoute,
    {},
    pageRequest,
    async (body) =>
      `<html><head>${pageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6">${await body}</body></html>`,
  );
  return response.body;
}

function commerceCartMain(children: unknown): Promise<string> | string {
  return children instanceof Promise
    ? children.then((html) => `<main class="mx-auto max-w-4xl">${html}</main>`)
    : `<main class="mx-auto max-w-4xl">${children}</main>`;
}

function productGridCartPageSlots(
  addToCartFailure: AddToCartFailureState | undefined,
): productGridComponent.ProductGridRenderSlots {
  if (!addToCartFailure) return {};
  return componentMutationFailureSlots(
    'addToCart',
    addToCartFailure.failure,
    productGridRenderSlots(undefined, addToCartFailure.productId),
  ) as productGridComponent.ProductGridRenderSlots;
}

function commerceCartPageRequest(db: CommerceDb, request?: CommerceRequest): CommerceRequest {
  const pageRequest = request ?? ({ db } as CommerceRequest);
  Object.defineProperty(pageRequest, 'db', { configurable: true, value: db });
  return pageRequest;
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
    FormError({
      class: 'text-sm text-red-700',
      code: 'INVALID_CREDENTIALS',
      failure: options.failure ?? null,
      message: 'Invalid email or password.',
    }),
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
export const commerceGraph = createCommerceGraph(
  { count: 0 },
  commerceTouchGraph,
  commerceQueryDomains,
);
