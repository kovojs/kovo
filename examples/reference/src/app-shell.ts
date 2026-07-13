import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  publicAccess,
  renderRouteHtml,
  route,
  toNodeHandler,
  type ServerErrorHandler,
} from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';

import {
  accountRoute,
  adminRoute,
  createReferenceAuth,
  createReferenceBetterAuth,
  type ReferenceAuthBindings,
  type ReferenceRequest,
} from './app.js';
import { ReferenceShellLoginForm } from './shell-auth-form.js';

export type ReferenceShellRequest = Request & ReferenceRequest;

export interface ReferenceAppShellOptions {
  auth?: ReferenceAuthBindings;
  onError?: ServerErrorHandler;
}

const publicClientModules = createMemoryVersionedClientModuleRegistry();

export const referencePublicClientModuleHref = publicClientModules.put({
  path: '/c/reference.client.js',
  source: [
    'export function Reference$markReady(event) {',
    '  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target;',
    '  const root = target instanceof HTMLElement ? target.closest("[data-reference-public-shell]") : null;',
    '  const output = root ? root.querySelector("#reference-status") : null;',
    '  if (output) output.textContent = "Reference shell interaction loaded from /c/.";',
    '}',
    '',
  ].join('\n'),
  version: 'reference-r7',
});

export const referencePublicRoute = route('/', {
  // Unauthenticated landing page — its KV436 access decision is public (SPEC §10.2).
  access: publicAccess('unauthenticated landing page'),
  meta: {
    description: 'A public Kovo reference app shell exported through synthetic replay.',
    title: 'Kovo Reference Public Shell',
  },
  modulepreloads: [referencePublicClientModuleHref],
  page() {
    return trustedHtml(
      [
        '<section data-reference-public-shell>',
        '<h1>Kovo Reference App</h1>',
        '<p>Public route exported by the shared request shell.</p>',
        `<button type="button" on:click="${referencePublicClientModuleHref}#Reference$markReady">Check shell</button>`,
        '<output id="reference-status">Waiting for client module.</output>',
        '</section>',
      ].join(''),
    );
  },
});

export const referenceLoginRoute = route('/login', {
  // The sign-in page must be reachable before authentication — public by design
  // (KV436 access decision, SPEC §10.2).
  access: publicAccess('sign-in page reachable before authentication'),
  meta: {
    description: 'Sign in to the Kovo reference app.',
    title: 'Kovo Reference Sign In',
  },
  page(context) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/account';
    return trustedHtml(`<main>${ReferenceShellLoginForm({ next })}</main>`);
  },
});

export function createReferenceAppShell(options: ReferenceAppShellOptions = {}) {
  const auth = options.auth ?? createReferenceAuth(createReferenceBetterAuth());
  const app = createApp({
    appId: '1f067065-c40a-4579-b35a-7fbcf928e32c',
    document: { lang: 'en-US' },
    mutations: [auth.signIn, auth.signOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    renderRoute(value) {
      return `<main>${routeValueToHtml(value)}</main>`;
    },
    routes: [referenceLoginRoute, accountRoute, adminRoute],
    sessionProvider: (request) => auth.sessionProvider(request as ReferenceShellRequest),
  });
  const requestHandler = createRequestHandler(app);

  return {
    app,
    auth,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export function createReferencePublicAppShell() {
  const app = createApp({
    appId: '1f067065-c40a-4579-b35a-7fbcf928e32c',
    clientModules: publicClientModules,
    document: { lang: 'en-US' },
    renderRoute(value) {
      return `<main>${routeValueToHtml(value)}</main>`;
    },
    routes: [referencePublicRoute],
  });
  const requestHandler = createRequestHandler(app);

  return {
    app,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}

export const referenceAppShell = createReferenceAppShell();
export const referencePublicAppShell = createReferencePublicAppShell();
export const referenceRequestHandler = referenceAppShell.requestHandler;
export const referenceNodeHandler = referenceAppShell.nodeHandler;

export default referenceAppShell.app;
