import {
  createApp,
  createRequestHandler,
  route,
  toNodeHandler,
  type CsrfValidationOptions,
  type RequestHandler,
  type ServerErrorHandler,
} from '@jiso/server';

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

const shellReferenceAuthCsrf: CsrfValidationOptions<Request> = {
  field: referenceAuthCsrf.field,
  secret: referenceAuthCsrf.secret,
  sessionId(request) {
    return referenceAuthCsrf.sessionId(request as ReferenceShellRequest);
  },
};

export const referenceLoginRoute = route('/login', {
  meta: {
    description: 'Sign in to the Jiso reference app.',
    title: 'Jiso Reference Sign In',
  },
  page(context, request: ReferenceShellRequest) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/account';
    return `<main>${renderReferenceLoginForm(request, { next })}</main>`;
  },
});

export function createReferenceAppShell(options: ReferenceAppShellOptions = {}) {
  const auth = options.auth ?? createReferenceAuth(createReferenceBetterAuth());
  const app = createApp({
    document: { lang: 'en-US' },
    mutationResponse({ key, rawInput, request }) {
      if (key === referenceSignIn.key) {
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
      }

      if (key !== referenceSignOut.key) return undefined;

      return {
        csrf: shellReferenceAuthCsrf,
        redirectTo: (result) => authRedirectTo(result.value),
      };
    },
    mutations: [auth.signIn, auth.signOut],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    renderRoute(value) {
      return `<main>${routeValueToHtml(value)}</main>`;
    },
    routes: [referenceLoginRoute, accountRoute, adminRoute],
    sessionProvider: (request) => auth.sessionProvider(request as ReferenceShellRequest),
  });
  const requestHandler = withReferenceRequestContext(createRequestHandler(app));

  return {
    app,
    auth,
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
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
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
export const referenceRequestHandler = referenceAppShell.requestHandler;
export const referenceNodeHandler = referenceAppShell.nodeHandler;

export default referenceAppShell.app;
