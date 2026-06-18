/** @jsxImportSource @kovojs/server */
import { ErrorBoundary } from '@kovojs/core';
import {
  createApp,
  createRequestHandler,
  layout,
  route,
  toNodeHandler,
  type KovoApp,
  type NodeRequestHandler,
  type RequestHandler,
  type ServerErrorHandler,
} from '@kovojs/server';

import {
  addToCart,
  commerceMessages,
  commerceSessionProvider,
  commerceSignIn,
  commerceSignOut,
  commerceStylesheets,
  createCommerceDb,
  renderCommerceLoginForm,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceSession,
} from './app.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import { ProductGrid, ProductGridError } from './components/product-grid.js';

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

function CommerceCartShell({ children }: { children?: unknown }): string {
  return (
    <div data-commerce-shell="cart">
      <main class="mx-auto max-w-4xl">{children}</main>
    </div>
  );
}

function CommerceCartPage({ request }: { request: CommerceShellRequest }): string {
  return (
    <>
      <CartBadge />
      <ErrorBoundary fallback={<ProductGridError />}>
        <ProductGrid />
      </ErrorBoundary>
      {request.session?.user?.id ? (
        <OrderHistory />
      ) : (
        OrderHistory.definition.render({ orderHistory: { items: [] } })
      )}
    </>
  );
}

const CommerceCartLayout = layout({
  render: (_queries, _state, { children }) => <CommerceCartShell>{children}</CommerceCartShell>,
});

export const commerceHomeRoute = route('/', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Kovo Commerce',
  },
  layout: CommerceCartLayout,
  page(_context, request: CommerceShellRequest) {
    return <CommerceCartPage request={request} />;
  },
  stylesheets: commerceStylesheets,
});

export const commerceCartRoute = route('/cart', {
  i18n: commerceMessages,
  meta: {
    description: 'Browse products and checkout with verifiable cart state.',
    title: 'Kovo Commerce',
  },
  layout: CommerceCartLayout,
  page(_context, request: CommerceShellRequest) {
    return <CommerceCartPage request={request} />;
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

export function createCommerceAppShell(options: CommerceAppShellOptions = {}): CommerceAppShell {
  const db = options.db ?? createCommerceDb();
  const app: KovoApp<CommerceSession> = createApp<CommerceSession, CommerceDb>({
    db: () => db,
    document: { lang: 'en-US' },
    mutations: [addToCart, commerceSignIn, commerceSignOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [commerceHomeRoute, commerceCartRoute, commerceLoginRoute],
    sessionProvider: (request) => commerceSessionProvider(request as CommerceShellRequest),
  });
  const requestHandler = createRequestHandler(app);

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

export const commerceAppShell = createCommerceAppShell();
export const commerceRequestHandler = commerceAppShell.requestHandler;
export const commerceNodeHandler = commerceAppShell.nodeHandler;

export default commerceAppShell.app;
