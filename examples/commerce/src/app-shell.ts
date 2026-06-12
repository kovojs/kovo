import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  route,
  toNodeHandler,
  type RequestHandler,
  type ServerErrorHandler,
} from '@jiso/server';

import {
  attachmentDownloadRoute,
  cartQuery,
  commerceAdminRoute,
  commerceMessages,
  commerceSessionProvider,
  commerceStylesheets,
  createCommerceDb,
  orderCsvRoute,
  orderHistoryQuery,
  paymentWebhook,
  productGridQuery,
  renderCartPageBody,
  renderCommerceLoginForm,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceSession,
} from './app.js';

export type CommerceShellRequest = Request & CommerceAuthRequest;

export interface CommerceAppShellOptions {
  db?: CommerceDb;
  onError?: ServerErrorHandler;
}

const clientModules = createMemoryVersionedClientModuleRegistry();

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

export const commerceAppShell = createCommerceAppShell();
export const commerceRequestHandler = commerceAppShell.requestHandler;
export const commerceNodeHandler = commerceAppShell.nodeHandler;

export default commerceAppShell.app;
