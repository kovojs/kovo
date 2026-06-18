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
import * as style from '@kovojs/style';

import {
  addToCart,
  commerceMessages,
  commerceSessionProvider,
  commerceSignIn,
  commerceSignOut,
  commerceStylesheets,
  createCommerceDb,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceSession,
} from './domain.js';
import { LoginForm } from './components/auth-forms.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import { ProductGrid, ProductGridError } from './components/product-grid.js';
import { commerceStyles } from './styles.js';

export type CommerceRouteRequest = Request & CommerceAuthRequest;

export interface CommerceAppOptions {
  db?: CommerceDb;
  onError?: ServerErrorHandler;
}

export interface CommerceApp {
  app: KovoApp<CommerceSession>;
  db: CommerceDb;
  nodeHandler: NodeRequestHandler;
  requestHandler: RequestHandler;
}

function CommerceCartShell({ children }: { children?: unknown }): string {
  return (
    <div {...style.attrs(commerceStyles.appRoot)} data-commerce-shell="cart">
      <main {...style.attrs(commerceStyles.cartShell)}>{children}</main>
    </div>
  );
}

function CommerceCartPage({ request }: { request: CommerceRouteRequest }): string {
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
  page(_context, request: CommerceRouteRequest) {
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
  page(_context, request: CommerceRouteRequest) {
    return <CommerceCartPage request={request} />;
  },
  stylesheets: commerceStylesheets,
});

export const commerceLoginRoute = route('/login', {
  meta: {
    description: 'Sign in to the Kovo commerce reference app.',
    title: 'Kovo Commerce Sign In',
  },
  page(context, _request: CommerceRouteRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/cart';
    return (
      <main {...style.attrs(commerceStyles.loginMain)}>
        <LoginForm next={next} />
      </main>
    );
  },
  stylesheets: commerceStylesheets,
});

export function createCommerceApp(options: CommerceAppOptions = {}): CommerceApp {
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
    sessionProvider: (request) => commerceSessionProvider(request as CommerceRouteRequest),
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

export const commerceApp = createCommerceApp();

export default commerceApp.app;
