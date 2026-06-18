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
  createCommerceDb,
  type CommerceAuthRequest,
  type CommerceDb,
  type CommerceSession,
} from './domain.js';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';
import { LoginForm, authFormStyleCss } from './components/auth-forms.js';
import { CartBadge, cartBadgeStyleCss } from './components/cart-badge.js';
import { OrderHistory, orderHistoryStyleCss } from './components/order-history.js';
import { ProductGrid, ProductGridError, productGridStyleCss } from './components/product-grid.js';
import { commerceThemeCss } from './theme.js';

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

const commerceAppStyles = style.create(
  {
    appRoot: {
      backgroundColor: tokens.sys.color.surface,
      color: tokens.sys.color.onSurface,
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
  },
  { namespace: 'commerce-app', source: 'examples/commerce/src/app.tsx' },
);

export const commerceAppStyleCss = style.emitAtomicCss(
  Object.values(commerceAppStyles).flatMap((entry) => entry.__rules ?? []),
);

export const commerceStylesheets = [
  {
    criticalCss: `${commerceThemeCss}\n${commerceAppStyleCss}\n${authFormStyleCss}\n${cartBadgeStyleCss}\n${orderHistoryStyleCss}\n${productGridStyleCss}`,
    href: '/assets/styles.css',
  },
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
