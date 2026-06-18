import { form, FormError, type FormInput } from '@kovojs/core';
import {
  guards,
  i18n,
  metaFromQuery,
  mutation,
  renderPageHints,
  s,
  session,
} from '@kovojs/server';
import { jsx, jsxs } from '@kovojs/server/jsx-runtime';
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
import { commerceCartPageMeta, commerceStylesheets } from './graph.js';
import {
  cart,
  cartQuery,
  order,
  orderHistoryQuery,
  product,
  productGridQuery,
  type CartQueryResult,
} from './queries.js';
import { cartItems, orders, products } from './schema.js';

export { commerceCartPageMeta, commerceStylesheets } from './graph.js';
export { createCommerceDb, type CommerceDb } from './db.js';
export { loadCartQuery, loadProductGrid, loadOrderHistory } from './queries.js';
export type {
  CartQueryResult,
  OrderHistoryResult,
  ProductGridInput,
  ProductGridResult,
} from './queries.js';

export type CommerceRole = 'admin' | 'member';

export interface CommerceSession {
  id: string;
  user: {
    id: string;
    roles?: readonly CommerceRole[];
  };
}

export interface CommerceRequest {
  db: CommerceDb;
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

const addToCartInferredTouches = [
  { domain: 'cart', keys: null },
  { domain: 'order', keys: null },
  { domain: 'product', keys: 'arg:productId' },
] as const;

export const addToCart = mutation('cart/add', {
  csrf: commerceCsrf,
  defaultRedirectTo: '/cart',
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
    inferredTouches: addToCartInferredTouches,
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

export const commerceMessageCatalog = {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
} as const;

export const commerceMessages = i18n('en-US', commerceMessageCatalog);

export const commerceMeta = metaFromQuery(cartQuery, commerceCartPageMeta);

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

export function renderCommerceLoginForm(
  _request: CommerceAuthRequest,
  options: { failure?: CommerceLoginFailureState; next?: string } = {},
): string {
  return jsxs('form', {
    class: 'grid gap-4 rounded border border-slate-200 bg-white p-6',
    mutation: commerceSignIn,
    children: [
      jsx('input', { type: 'hidden', name: 'next', value: options.next ?? '/cart' }),
      jsxs('label', {
        class: 'grid gap-1 text-sm font-medium text-slate-700',
        children: [
          jsx('span', { children: 'Email' }),
          jsx('input', {
            autocomplete: 'email',
            class: 'rounded border border-slate-300 px-3 py-2',
            name: 'email',
            required: true,
            type: 'email',
          }),
        ],
      }),
      jsxs('label', {
        class: 'grid gap-1 text-sm font-medium text-slate-700',
        children: [
          jsx('span', { children: 'Password' }),
          jsx('input', {
            autocomplete: 'current-password',
            class: 'rounded border border-slate-300 px-3 py-2',
            name: 'password',
            required: true,
            type: 'password',
          }),
        ],
      }),
      jsx(FormError, {
        class: 'text-sm text-red-700',
        code: 'INVALID_CREDENTIALS',
        failure: options.failure,
        message: 'Invalid email or password.',
      }),
      jsx('button', {
        class: 'rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white',
        type: 'submit',
        children: 'Sign in',
      }),
    ],
  });
}

export function renderCommerceLogoutForm(_request: CommerceAuthRequest): string {
  return jsxs('form', {
    class: 'inline',
    mutation: commerceSignOut,
    children: [
      jsx('button', {
        class: 'text-sm font-medium text-slate-900',
        type: 'submit',
        children: 'Sign out',
      }),
    ],
  });
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
