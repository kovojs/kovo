/** @jsxImportSource @kovojs/server */
import {
  route,
  type CsrfValidationOptions,
  type ServerErrorHandler,
} from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/app-shell/client-modules';
import {
  createApp,
  createRequestHandler,
  type KovoApp,
  type RequestHandler,
} from '@kovojs/server/app-shell/core';
import { toNodeHandler, type NodeRequestHandler } from '@kovojs/server/app-shell/node';
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
  orderCsvRoute,
  orderHistoryQuery,
  paymentWebhook,
  productGridQuery,
  renderAddToCartMutationFailureError,
  renderAddToCartMutationFailureForm,
  renderCartPage,
  renderCartPageBody,
  renderCommerceLoginForm,
  renderReceiptUploadForm,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceRequest,
  type CommerceSession,
} from './app.js';
import { CartBadge } from './generated/cart-badge.js';
import { OrderHistory } from './generated/order-history.js';
import { ProductGrid } from './generated/product-grid.js';
import { products } from './schema.js';

export type CommerceShellRequest = Request & CommerceAuthRequest;

export interface CommerceAppShellOptions {
  db?: CommerceDb;
  onError?: ServerErrorHandler;
}

export interface CommerceAppShell {
  app: KovoApp<CommerceSession>;
  db: CommerceDb;
  nodeHandler: NodeRequestHandler;
  requestHandler: RequestHandler;
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
  page(_context, request: CommerceShellRequest) {
    return renderCommerceCartShell(
      <>
        <CartBadge />
        <ProductGrid />
        {request.session?.user?.id ? (
          <OrderHistory />
        ) : (
          OrderHistory.definition.render({ orderHistory: { items: [] } })
        )}
        {renderReceiptUploadForm()}
      </>,
    );
  },
  stylesheets: commerceStylesheets,
});

export const commerceCartRoute = route('/cart', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Kovo Commerce',
  },
  page(_context, request: CommerceShellRequest) {
    return renderCommerceCartShell(
      <>
        <CartBadge />
        <ProductGrid />
        {request.session?.user?.id ? (
          <OrderHistory />
        ) : (
          OrderHistory.definition.render({ orderHistory: { items: [] } })
        )}
        {renderReceiptUploadForm()}
      </>,
    );
  },
  stylesheets: commerceStylesheets,
});

async function renderCommerceCartShell(children: unknown): Promise<string> {
  return `<div data-commerce-shell="cart"><main class="mx-auto max-w-4xl">${await children}</main></div>`;
}

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

export function createCommerceAppShell(options: CommerceAppShellOptions = {}): CommerceAppShell {
  const db = options.db ?? createCommerceDb();
  const app: KovoApp<CommerceSession> = createApp<CommerceSession>({
    clientModules,
    document: { lang: 'en-US' },
    endpoints: [paymentWebhook],
    mutationResponses: {
      [commerceSignIn.key]: ({ rawInput, request }) => {
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
      },
      [commerceSignOut.key]: () => {
        return {
          csrf: shellCommerceAuthCsrf,
          redirectTo: (result) => authRedirectTo(result.value),
        };
      },
      [addToCart.key]: ({ rawInput, request }) => {
        const productId = productIdFromRawInput(rawInput);
        return {
          redirectTo: '/cart',
          renderFailureFragment: (failure) =>
            renderAddToCartFailureFragment(db, rawInput, failure, request as CommerceShellRequest),
          renderFailurePage: (failure) =>
            renderCartPage(
              db,
              {
                failure,
                ...(productId ? { productId } : {}),
              },
              request as CommerceShellRequest,
            ),
        };
      },
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
  failure: Parameters<typeof renderAddToCartMutationFailureError>[0],
  request: CommerceRequest,
): Promise<string> {
  const productId = productIdFromRawInput(rawInput);
  const product = productId
    ? (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0]
    : undefined;

  if (!product) return renderAddToCartMutationFailureError(failure);
  return renderAddToCartMutationFailureForm(product, failure, request);
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

export const commerceAppShell = createCommerceAppShell();
export const commerceRequestHandler = commerceAppShell.requestHandler;
export const commerceNodeHandler = commerceAppShell.nodeHandler;
export const commerceStaticExportShell = createCommerceStaticExportShell();
export const commerceStaticExportApp = commerceStaticExportShell.app;

export default commerceAppShell.app;
