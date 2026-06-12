import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  errorBoundary,
  route,
  toNodeHandler,
  type CsrfValidationOptions,
  type RequestHandler,
  type ServerErrorHandler,
} from '@jiso/server';

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

export type CommerceShellRequest = Request & CommerceAuthRequest;

export interface CommerceAppShellOptions {
  db?: CommerceDb;
  onError?: ServerErrorHandler;
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

export const commerceCartRoute = route('/cart', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Jiso Commerce',
  },
  page(_context, request: CommerceShellRequest) {
    return `<div data-commerce-shell="cart">${renderCartPageBody(request.db, undefined, request)}</div>`;
  },
  stylesheets: commerceStylesheets,
});

export const commerceLoginRoute = route('/login', {
  meta: {
    description: 'Sign in to the Jiso commerce reference app.',
    title: 'Jiso Commerce Sign In',
  },
  page(context, request: CommerceShellRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/cart';
    return `<main class="mx-auto max-w-md p-6">${renderCommerceLoginForm(request, { next })}</main>`;
  },
  stylesheets: commerceStylesheets,
});

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
            render: () => CartBadge.definition.render({ cart: loadCartQuery(db) }),
            stylesheets: commerceStylesheets,
            target: 'cart-badge',
          },
          errorBoundary(
            {
              render: () => renderProductGrid(loadProductGrid(db), commerceRequest),
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
            render: () => renderOrderHistory(db),
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

function renderAddToCartFailureFragment(
  db: CommerceDb,
  rawInput: unknown,
  failure: Parameters<typeof renderAddToCartError>[0],
  request: CommerceRequest,
): string {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? db.products.get(productId) : undefined;

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

export default commerceAppShell.app;
