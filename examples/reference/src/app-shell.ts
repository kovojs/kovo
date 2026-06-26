import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  publicAccess,
  route,
  toNodeHandler,
  type CsrfValidationOptions,
  type RequestHandler,
  type ServerErrorHandler,
} from '@kovojs/server';
import { trustedHtml, type BrowserTrustedHTML, type TrustedHtml } from '@kovojs/browser';

import {
  accountRoute,
  adminRoute,
  createReferenceAuth,
  createReferenceBetterAuth,
  referenceAuthCsrf,
  referenceSignIn,
  referenceSignOut,
  renderReferenceLoginForm,
  type ReferenceAuthBindings,
  type ReferenceRequest,
} from './app.js';

export type ReferenceShellRequest = Request & ReferenceRequest;

export interface ReferenceAppShellOptions {
  auth?: ReferenceAuthBindings;
  onError?: ServerErrorHandler;
}

export const referenceShellAuthCsrfId = 'reference-shell-login';
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

const shellReferenceAuthCsrf: CsrfValidationOptions<Request> = {
  field: referenceAuthCsrf.field,
  secret: referenceAuthCsrf.secret,
  sessionId(request) {
    return referenceAuthCsrf.sessionId(request as ReferenceShellRequest);
  },
};

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
  page(context, request: ReferenceShellRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/account';
    return trustedHtml(`<main>${renderReferenceLoginForm(request, { next })}</main>`);
  },
});

export function createReferenceAppShell(options: ReferenceAppShellOptions = {}) {
  const auth = options.auth ?? createReferenceAuth(createReferenceBetterAuth());
  const app = createApp({
    document: { lang: 'en-US' },
    mutationResponses: {
      [referenceSignIn.key]: ({ rawInput, request }) => {
        return {
          csrf: shellReferenceAuthCsrf,
          redirectTo: (result) => authRedirectTo(result.value),
          renderFailurePage: (failure) =>
            `<!doctype html><html><body><main>${renderReferenceLoginForm(
              request as ReferenceShellRequest,
              {
                ...(failure.error.code === 'INVALID_CREDENTIALS'
                  ? { failure: 'INVALID_CREDENTIALS' as const }
                  : {}),
                next: nextFromRawInput(rawInput) ?? '/account',
              },
            )}</main></body></html>`,
        };
      },
      [referenceSignOut.key]: {
        csrf: shellReferenceAuthCsrf,
        redirectTo: (result) => authRedirectTo(result.value),
      },
    },
    mutations: [auth.signIn, auth.signOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    renderRoute(value) {
      return `<main>${routeValueToHtml(value)}</main>`;
    },
    routes: [referenceLoginRoute, accountRoute, adminRoute],
    sessionProvider: {
      justification:
        'The reference app delegates validation, rotation, expiry, and revocation to its auth fixture.',
      lifecycle: 'delegated',
      provider: (request) => auth.sessionProvider(request as ReferenceShellRequest),
    },
  });
  const requestHandler = withReferenceRequestContext(createRequestHandler(app));

  return {
    app,
    auth,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export function createReferencePublicAppShell() {
  const app = createApp({
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

function withReferenceRequestContext(handler: RequestHandler): RequestHandler {
  return (request) => handler(attachReferenceRequestContext(request));
}

function attachReferenceRequestContext(request: Request): ReferenceShellRequest {
  Object.defineProperties(request, {
    authCsrfId: {
      configurable: true,
      value: referenceShellAuthCsrfId,
    },
  });

  return request as ReferenceShellRequest;
}

function routeValueToHtml(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (isFrameworkRenderedHtml(value)) return value.html;
  const trusted = trustedRouteHtmlContent(value);
  if (trusted !== '') return trusted;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function trustedRouteHtmlContent(value: unknown): string {
  if (isKovoTrustedHtml(value)) return trustedHtmlValueContent(value.value);
  if (isBrowserTrustedHtml(value)) return value.toString();
  return '';
}

function isKovoTrustedHtml(value: unknown): value is TrustedHtml {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __kovoTrustedHtml?: unknown }).__kovoTrustedHtml === true
  );
}

function isBrowserTrustedHtml(value: unknown): value is BrowserTrustedHTML {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'TrustedHTML' &&
    typeof (value as { toString?: unknown }).toString === 'function'
  );
}

function trustedHtmlValueContent(value: string | BrowserTrustedHTML): string {
  return typeof value === 'string' ? value : value.toString();
}

function isFrameworkRenderedHtml(value: unknown): value is { html: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[Symbol.for('kovo.renderedHtml')] === true &&
    typeof (value as { html?: unknown }).html === 'string'
  );
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

  return '/account';
}

export const referenceAppShell = createReferenceAppShell();
export const referencePublicAppShell = createReferencePublicAppShell();
export const referenceRequestHandler = referenceAppShell.requestHandler;
export const referenceNodeHandler = referenceAppShell.nodeHandler;

export default referenceAppShell.app;
