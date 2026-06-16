import {
  errorBoundary,
  route,
  type CsrfValidationOptions,
  type ServerErrorHandler,
} from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import {
  createApp,
  createRequestHandler,
  type RequestHandler,
} from '@kovojs/server/app-shell/core';
import { toNodeHandler } from '@kovojs/server/app-shell/node';
import { eq } from 'drizzle-orm';

import {
  addToCart,
  attachmentDownloadRoute,
  cartQuery,
  commerceAdminRoute,
  commerceAuthCsrf,
  commerceMessages,
  commerceSessionProvider,
  commerceSignIn,
  commerceSignOut,
  commerceStylesheets,
  createCommerceDb,
  loadCartQuery,
  loadProductGrid,
  orderCsvRoute,
  orderHistoryQuery,
  paymentWebhook,
  productFormTarget,
  productGridQuery,
  renderAddToCartError,
  renderAddToCartForm,
  renderCartPage,
  renderCartPageBody,
  renderCommerceLoginForm,
  renderOrderHistory,
  renderProductGrid,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceRequest,
  type CommerceSession,
} from './app.js';
import { CartBadge } from './generated/cart-badge.js';
import { products } from './schema.js';

export type CommerceShellRequest = Request & CommerceAuthRequest;

export interface CommerceAppShellOptions {
  db?: CommerceDb;
  onError?: ServerErrorHandler;
}

export interface CommerceStaticExportShellOptions {
  db?: CommerceDb;
}

const clientModules = createMemoryVersionedClientModuleRegistry();
const shellCommerceAuthCsrf: CsrfValidationOptions<Request> = {
  field: commerceAuthCsrf.field,
  secret: commerceAuthCsrf.secret,
  sessionId(request) {
    return commerceAuthCsrf.sessionId(request as CommerceShellRequest);
  },
};

export const commerceClientModuleHref = clientModules.put({
  path: '/c/commerce.client.js',
  source: [
    'export function Commerce$markReady(event) {',
    '  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target;',
    '  const root = target instanceof HTMLElement ? target.closest("[data-commerce-shell]") : null;',
    '  if (root) root.setAttribute("data-commerce-ready", "true");',
    '}',
    '',
  ].join('\n'),
  version: 'commerce-r7',
});

export const commerceHomeRoute = route('/', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Kovo Commerce',
  },
  async page(_context, request: CommerceShellRequest) {
    return `<div data-commerce-shell="cart">${await renderCartPageBody(request.db, undefined, request)}</div>`;
  },
  stylesheets: commerceStylesheets,
});

export const commerceCartRoute = route('/cart', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Kovo Commerce',
  },
  async page(_context, request: CommerceShellRequest) {
    return `<div data-commerce-shell="cart">${await renderCartPageBody(request.db, undefined, request)}</div>`;
  },
  stylesheets: commerceStylesheets,
});

export const commerceLoginRoute = route('/login', {
  meta: {
    description: 'Sign in to the Kovo commerce reference app.',
    title: 'Kovo Commerce Sign In',
  },
  page(context, request: CommerceShellRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/cart';
    return `<main class="mx-auto max-w-md p-6">${renderCommerceLoginForm(request, { next })}</main>`;
  },
  stylesheets: commerceStylesheets,
});

export function createCommerceStaticExportShell(options: CommerceStaticExportShellOptions = {}) {
  const db = options.db ?? createCommerceDb();
  const app = createApp({
    clientModules,
    document: { lang: 'en-US' },
    routes: [
      route('/', {
        i18n: commerceMessages,
        meta: {
          description: 'Browse products and checkout with verifiable cart state.',
          title: 'Kovo Commerce',
        },
        modulepreloads: [commerceClientModuleHref],
        async page() {
          return `<div data-commerce-shell="cart">${await renderCartPageBody(
            db,
            undefined,
            {
              db,
            },
            { readOnly: true },
          )}</div>`;
        },
        stylesheets: commerceStylesheets,
      }),
      route('/cart', {
        i18n: commerceMessages,
        meta: {
          description: 'Browse products and checkout with verifiable cart state.',
          title: 'Kovo Commerce',
        },
        modulepreloads: [commerceClientModuleHref],
        async page() {
          return `<div data-commerce-shell="cart">${await renderCartPageBody(
            db,
            undefined,
            {
              db,
            },
            { readOnly: true },
          )}</div>`;
        },
        stylesheets: commerceStylesheets,
      }),
      route('/login', {
        meta: {
          description: 'Sign in to the Kovo commerce reference app.',
          title: 'Kovo Commerce Sign In',
        },
        page() {
          return '<main class="mx-auto max-w-md p-6"><h1>Kovo Commerce Sign In</h1><p>Sign in is available on the dynamic commerce server.</p></main>';
        },
        stylesheets: commerceStylesheets,
      }),
    ],
  });

  return { app, db };
}

export function createCommerceAppShell(options: CommerceAppShellOptions = {}) {
  const db = options.db ?? createCommerceDb();
  const app = createApp<CommerceSession>({
    clientModules,
    document: { lang: 'en-US' },
    endpoints: [paymentWebhook],
    mutationResponse({ key, rawInput, request }) {
      if (key === commerceSignIn.key) {
        return {
          csrf: shellCommerceAuthCsrf,
          redirectTo: (result) => authRedirectTo(result.value),
          renderFailurePage: (failure) =>
            `<!doctype html><html><body><main class="mx-auto max-w-md p-6">${renderCommerceLoginForm(
              request as CommerceShellRequest,
              {
                ...(failure.error.code === 'INVALID_CREDENTIALS'
                  ? { failure: { code: 'INVALID_CREDENTIALS' as const } }
                  : {}),
                next: nextFromRawInput(rawInput) ?? '/cart',
              },
            )}</main></body></html>`,
        };
      }

      if (key === commerceSignOut.key) {
        return {
          csrf: shellCommerceAuthCsrf,
          redirectTo: (result) => authRedirectTo(result.value),
        };
      }

      if (key !== addToCart.key) return undefined;

      const commerceRequest = request as CommerceShellRequest;
      const productId = productIdFromRawInput(rawInput);
      return {
        failureTarget: productId ? productFormTarget(productId) : 'product-form',
        failureStylesheets: commerceStylesheets,
        fragmentRenderers: [
          {
            render: async () => CartBadge.definition.render({ cart: await loadCartQuery(db) }),
            stylesheets: commerceStylesheets,
            target: 'cart-badge',
          },
          errorBoundary(
            {
              render: async () => renderProductGrid(await loadProductGrid(db), commerceRequest),
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
            // SECURITY (SECURITY_FINDINGS.md M9): scope order history to the
            // authenticated session user resolved onto the mutation request.
            render: () => renderOrderHistory(db, commerceRequest.session?.user?.id),
            stylesheets: commerceStylesheets,
            target: 'order-history',
          },
        ],
        redirectTo: '/cart',
        renderFailureFragment: (failure) =>
          renderAddToCartFailureFragment(db, rawInput, failure, commerceRequest),
        renderFailurePage: (failure) =>
          renderCartPage(
            db,
            {
              failure,
              ...(productId ? { productId } : {}),
            },
            commerceRequest,
          ),
      };
    },
    mutations: [addToCart, commerceSignIn, commerceSignOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
    renderRoute(value, context) {
      if (context.route === commerceAdminRoute) return `<main>${routeValueToHtml(value)}</main>`;
      return routeValueToHtml(value);
    },
    routes: [
      commerceHomeRoute,
      commerceCartRoute,
      commerceLoginRoute,
      commerceAdminRoute,
      orderCsvRoute,
      attachmentDownloadRoute,
    ],
    sessionProvider: (request) => commerceSessionProvider(request as CommerceShellRequest),
  });
  const requestHandler = withCommerceRequestContext(createRequestHandler(app), db);

  return {
    app,
    db,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

function routeValueToHtml(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function withCommerceRequestContext(handler: RequestHandler, db: CommerceDb): RequestHandler {
  return (request) => handler(attachCommerceRequestContext(request, db));
}

function attachCommerceRequestContext(request: Request, db: CommerceDb): CommerceShellRequest {
  Object.defineProperties(request, {
    authCsrfId: {
      configurable: true,
      value: 'commerce-shell-login',
    },
    db: {
      configurable: true,
      value: db,
    },
  });

  return request as CommerceShellRequest;
}

async function renderAddToCartFailureFragment(
  db: CommerceDb,
  rawInput: unknown,
  failure: Parameters<typeof renderAddToCartError>[0],
  request: CommerceRequest,
): Promise<string> {
  const productId = productIdFromRawInput(rawInput);
  const product = productId
    ? (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0]
    : undefined;

  if (!product) return renderAddToCartError(failure);
  return renderAddToCartForm(product, failure, request);
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (rawInput instanceof FormData) {
    const productId = rawInput.get('productId');
    return typeof productId === 'string' ? productId : undefined;
  }

  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }

  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}

function nextFromRawInput(rawInput: unknown): string | undefined {
  if (rawInput instanceof FormData) {
    const value = rawInput.get('next');
    return typeof value === 'string' ? value : undefined;
  }

  if (typeof rawInput !== 'object' || rawInput === null || !('next' in rawInput)) {
    return undefined;
  }

  const value = rawInput.next;
  return typeof value === 'string' ? value : undefined;
}

function authRedirectTo(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'redirectTo' in value) {
    const redirectTo = value.redirectTo;
    if (typeof redirectTo === 'string') return redirectTo;
  }

  return '/cart';
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const commerceAppShell = createCommerceAppShell();
export const commerceRequestHandler = commerceAppShell.requestHandler;
export const commerceNodeHandler = commerceAppShell.nodeHandler;
export const commerceStaticExportShell = createCommerceStaticExportShell();
export const commerceStaticExportApp = commerceStaticExportShell.app;

export default commerceAppShell.app;
