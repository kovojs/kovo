/** @jsxImportSource @kovojs/server */
import { ErrorBoundary, type ComponentChild } from '@kovojs/core';
import {
  createApp,
  layout,
  publicAccess,
  renderRouteHtml,
  route,
  stylesheet,
  type KovoApp,
  type ServerErrorHandler,
} from '@kovojs/server';

import {
  addToCart,
  cartQuery,
  commerceMessages,
  createCommerceDb,
  orderHistoryQuery,
  productGridQuery,
  type CommerceDb,
  type CommerceSession,
} from './domain.js';
import { createCommerceAuth, type CommerceAuthBindings, type CommerceAuthRequest } from './auth.js';
import * as style from '@kovojs/style';
import { LoginForm, LogoutForm } from './components/auth-forms.js';
import { CartBadge } from './components/cart-badge.js';
import { OrderHistory } from './components/order-history.js';
import { renderOrderHistory } from './components/order-history-view.js';
import { GuestProductGrid, ProductGrid, ProductGridError } from './components/product-grid.js';
import { commerceTheme } from './theme.js';

export type CommerceRouteRequest = Request & CommerceAuthRequest;

export interface CommerceAppOptions {
  authFixture?: Parameters<typeof createCommerceAuth>[1];
  db?: CommerceDb;
  onError?: ServerErrorHandler;
}

export interface CommerceApplication {
  app: KovoApp<CommerceSession>;
  auth: CommerceAuthBindings;
  db: CommerceDb;
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

function CommerceCartShell({ children }: { children?: ComponentChild }): string {
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
      {request.session?.user?.id ? <LogoutForm /> : null}
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

export function createCommerceApplication(options: CommerceAppOptions = {}): CommerceApplication {
  const auth = createCommerceAuth(options.db ?? createCommerceDb(), options.authFixture);
  const db = auth.db;
  const app: KovoApp<CommerceSession> = createApp<CommerceSession, CommerceDb>({
    db: () => db,
    document: { lang: 'en-US' },
    mutations: [addToCart, auth.signIn, auth.signOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [commerceHomeRoute, commerceCartRoute, commerceLoginRoute],
    sessionProvider: auth.sessionProvider as NonNullable<
      KovoApp<CommerceSession>['sessionProvider']
    >,
  });
  return { app, auth, db };
}

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}

export const commerceApp = createCommerceApplication();

export default commerceApp.app;
