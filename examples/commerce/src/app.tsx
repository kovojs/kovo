/** @jsxImportSource @kovojs/server */
import { ErrorBoundary } from '@kovojs/core';
import {
  createApp,
  createRequestHandler,
  layout,
  publicAccess,
  renderRouteHtml,
  route,
  stylesheet,
  toNodeHandler,
  type KovoApp,
  type NodeRequestHandler,
  type RequestHandler,
  type ServerErrorHandler,
} from '@kovojs/server';

import {
  addToCart,
  cartQuery,
  commerceMessages,
  commerceSessionProvider,
  commerceSignIn,
  commerceSignOut,
  createCommerceDb,
  orderHistoryQuery,
  productGridQuery,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceSession,
} from './domain.js';
import * as style from '@kovojs/style';
import { LoginForm } from './components/auth-forms.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import { renderOrderHistory } from './components/order-history-view.js';
import { GuestProductGrid, ProductGrid, ProductGridError } from './components/product-grid.js';
import { commerceTheme } from './theme.js';

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

const commerceAppStyles = style.create({
  appRoot: {
    backgroundColor: style.tokens.sys.color.surface,
    color: style.tokens.sys.color.onSurface,
    minHeight: '100dvh',
  },
  cartShell: {
    marginInline: 'auto',
    maxWidth: 896,
  },
  loginMain: {
    marginInline: 'auto',
    maxWidth: 448,
    padding: 24,
  },
});

export const commerceStylesheets = [
  stylesheet('./styles.css', {
    theme: commerceTheme,
  }),
] as const;

function CommerceCartShell({ children }: { children?: unknown }): string {
  return (
    <div style={commerceAppStyles.appRoot} data-commerce-shell="cart">
      <main style={commerceAppStyles.cartShell}>{children}</main>
    </div>
  );
}

function CommerceCartPage({ request }: { request: CommerceRouteRequest }): string {
  return (
    <section data-commerce-page="cart">
      <CartBadge />
      <ErrorBoundary fallback={<ProductGridError />}>
        {request.session?.user?.id ? <ProductGrid /> : <GuestProductGrid />}
      </ErrorBoundary>
      {request.session?.user?.id ? <OrderHistory /> : renderOrderHistory({ items: [] })}
    </section>
  );
}

// The storefront (home + cart) is public browsing — no auth wall on catalog/cart
// reads. The layout carries the public access decision each child route inherits
// (KV436, SPEC §10.2); checkout-class mutations stay guarded.
const CommerceCartLayout = layout({
  access: publicAccess('public storefront browsing'),
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
  // Sign-in page reachable before authentication — public by design (KV436, §10.2).
  access: publicAccess('sign-in page reachable before authentication'),
  meta: {
    description: 'Sign in to the Kovo commerce reference app.',
    title: 'Kovo Commerce Sign In',
  },
  page(context, _request: CommerceRouteRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/cart';
    return (
      <main style={commerceAppStyles.loginMain}>
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
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [commerceHomeRoute, commerceCartRoute, commerceLoginRoute],
    sessionProvider: commerceSessionProvider as NonNullable<
      KovoApp<CommerceSession>['sessionProvider']
    >,
  });
  const requestHandler = createRequestHandler(app);

  return {
    app,
    db,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}

export const commerceApp = createCommerceApp();

export default commerceApp.app;
