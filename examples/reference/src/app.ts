import {
  csrfField,
  csrfToken,
  renderRoutePageResponse,
  route,
  runMutation,
  s,
  session,
} from '@jiso/server';
import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  role,
  type BetterAuthLike,
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
} from '@jiso/better-auth';
import type { FwExplainInput } from '@jiso/core';

export type ReferenceRole = 'admin' | 'member';

export interface ReferenceSession {
  id: string;
  user: {
    email: string;
    id: string;
    name: string;
    roles: ReferenceRole[];
  };
}

export interface ReferenceRequest {
  authCsrfId?: string | null;
  headers: Headers;
  session?: ReferenceSession | null;
}

export interface ReferenceBetterAuthSession {
  id: string;
}

export interface ReferenceBetterAuthUser {
  email: string;
  id: string;
  name?: string | null;
  roles?: readonly ReferenceRole[] | null;
}

export type ReferenceBetterAuth = BetterAuthLike<
  ReferenceBetterAuthSession,
  ReferenceBetterAuthUser
> &
  BetterAuthSignInEmailLike &
  BetterAuthSignOutLike;

export type ReferenceAuthBindings = ReturnType<typeof createReferenceAuth>;

export const referenceSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      email: s.string(),
      id: s.string(),
      name: s.string(),
      roles: s.array(s.string()),
    }),
  }),
);

export const referenceAuthCsrf = {
  field: 'csrf',
  secret: 'EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET',
  sessionId(request: ReferenceRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
};

const referenceCookieName = 'jiso_reference_session';

const referenceUsers = new Map<string, ReferenceBetterAuthUser & { password: string }>([
  [
    'ada@example.com',
    {
      email: 'ada@example.com',
      id: 'u1',
      name: 'Ada Lovelace',
      password: 'correct',
      roles: ['admin', 'member'],
    },
  ],
  [
    'grace@example.com',
    {
      email: 'grace@example.com',
      id: 'u2',
      name: 'Grace Hopper',
      password: 'correct',
      roles: ['member'],
    },
  ],
]);

export function createReferenceBetterAuth(): ReferenceBetterAuth {
  const sessionUserIds = new Map<string, string>();

  return {
    api: {
      getSession(options) {
        const token = readCookie(options.headers, referenceCookieName);
        const userId = token ? sessionUserIds.get(token) : undefined;
        const user = userId
          ? [...referenceUsers.values()].find((candidate) => candidate.id === userId)
          : undefined;

        if (!token || !user) return null;

        return {
          session: { id: token },
          user: {
            email: user.email,
            id: user.id,
            name: user.name ?? user.email,
            roles: user.roles ?? defaultRolesForEmail(user.email),
          },
        };
      },
      signInEmail(options) {
        const user = referenceUsers.get(options.body.email);
        if (!user || user.password !== options.body.password) {
          return referenceAuthResponse([], 401);
        }

        const token = `session-${user.id}`;
        sessionUserIds.set(token, user.id);

        return referenceAuthResponse([
          `${referenceCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax`,
        ]);
      },
      signOut(options) {
        const token = readCookie(options.headers, referenceCookieName);
        if (token) sessionUserIds.delete(token);

        return referenceAuthResponse([
          `${referenceCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        ]);
      },
    },
  };
}

export const referenceBetterAuth = createReferenceBetterAuth();

export function createReferenceAuth(auth: ReferenceBetterAuth) {
  const sessionProvider = referenceSession.provider(
    betterAuthSession<
      ReferenceBetterAuthSession,
      ReferenceBetterAuthUser,
      ReferenceSession,
      ReferenceRequest
    >(auth, ({ session: authSession, user }) => ({
      id: authSession.id,
      user: {
        email: user.email,
        id: user.id,
        name: user.name ?? user.email,
        roles: [...(user.roles ?? defaultRolesForEmail(user.email))],
      },
    })),
  );
  const signIn = betterAuthSignInEmailMutation<'auth/sign-in', ReferenceRequest>(auth, {
    csrf: referenceAuthCsrf,
    defaultRedirectTo: '/account',
  });
  const signOut = betterAuthSignOutMutation<
    'auth/sign-out',
    ReferenceRequest,
    ReferenceRequest & { session: ReferenceSession }
  >(auth, {
    csrf: referenceAuthCsrf,
    defaultRedirectTo: '/login',
    guard: authed<ReferenceRequest>(),
  });

  return {
    sessionProvider,
    signIn,
    signOut,
  };
}

export const referenceAuth = createReferenceAuth(referenceBetterAuth);
export const referenceSessionProvider = referenceAuth.sessionProvider;
export const referenceSignIn = referenceAuth.signIn;
export const referenceSignOut = referenceAuth.signOut;

export const referenceGraph = {
  mutations: [
    {
      guards: ['authed'],
      invalidates: ['auth'],
      inputFields: [],
      key: 'auth/sign-out',
      session: 'referenceSession',
      writes: ['auth'],
    },
  ],
  ownerDomains: [{ domain: 'user', owner: 'session.user.id' }],
  pages: [
    {
      guards: ['authed'],
      queries: [],
      route: '/account',
    },
    {
      guards: ['role:admin'],
      queries: [],
      route: '/admin',
    },
  ],
  scopeAudits: [
    {
      detail: 'account page reads the active mapped session user',
      domain: 'user',
      kind: 'query',
      name: '/account',
      scope: 'session',
      site: 'examples/reference/src/app.ts:accountRoute',
    },
    {
      detail: 'admin page reads the active mapped session user after role guard',
      domain: 'user',
      kind: 'query',
      name: '/admin',
      scope: 'session',
      site: 'examples/reference/src/app.ts:adminRoute',
    },
  ],
} as const satisfies FwExplainInput;

export const accountRoute = route('/account', {
  guard: authed<ReferenceRequest>(),
  page(_input, request) {
    return `account:${request.session.user.email}${renderReferenceLogoutForm(request)}`;
  },
});

export const adminRoute = route('/admin', {
  guard: role<ReferenceRequest>('admin'),
  page(_input, request) {
    return `admin:${request.session?.user.id ?? 'anonymous'}${renderReferenceLogoutForm(request)}`;
  },
});

export function renderReferenceLoginForm(
  request: ReferenceRequest,
  options: { failure?: 'INVALID_CREDENTIALS'; next?: string } = {},
): string {
  const error =
    options.failure === 'INVALID_CREDENTIALS'
      ? '<output role="alert" data-error-code="INVALID_CREDENTIALS">Invalid email or password.</output>'
      : '';

  return `<form method="post" action="/_m/auth/sign-in" enhance data-mutation="auth/sign-in">${csrfField(
    request,
    referenceAuthCsrf,
  )}<input type="hidden" name="next" value="${escapeAttribute(options.next ?? '/account')}"><input name="email" type="email" autocomplete="email" required><input name="password" type="password" autocomplete="current-password" required>${error}<button type="submit">Sign in</button></form>`;
}

export function renderReferenceLogoutForm(request: ReferenceRequest): string {
  return `<form method="post" action="/_m/auth/sign-out" enhance data-mutation="auth/sign-out">${csrfField(
    request,
    referenceAuthCsrf,
  )}<button type="submit">Sign out</button></form>`;
}

export async function renderReferenceAccountRoute(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  return renderRoutePageResponse(accountRoute, {}, request, (value) => `<main>${value}</main>`, {
    onUnauthenticated({ next }) {
      return { location: `/login?next=${encodeURIComponent(next)}`, status: 303 };
    },
    sessionProvider: auth.sessionProvider,
  });
}

export async function renderReferenceAdminRoute(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  return renderRoutePageResponse(adminRoute, {}, request, (value) => `<main>${value}</main>`, {
    onUnauthenticated({ next }) {
      return { location: `/login?next=${encodeURIComponent(next)}`, status: 303 };
    },
    renderForbidden: () => '<main>Forbidden</main>',
    sessionProvider: auth.sessionProvider,
  });
}

export async function submitReferenceSignInNoJs(
  input: { csrf: string; email: string; next?: string; password: string },
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  const result = await runMutation(auth.signIn, input, request, {
    csrf: referenceAuthCsrf,
  });

  if (!result.ok) {
    const formOptions: { failure?: 'INVALID_CREDENTIALS'; next?: string } = {};
    if (result.error.code === 'INVALID_CREDENTIALS') {
      formOptions.failure = 'INVALID_CREDENTIALS';
    }
    if (typeof input.next === 'string') {
      formOptions.next = input.next;
    }

    return {
      body: renderReferenceLoginForm(request, formOptions),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: result.status,
    };
  }

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: result.value.redirectTo,
      ...result.responseHeaders,
    },
    status: 303,
  };
}

export async function submitReferenceSignOutNoJs(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  const result = await runMutation(
    auth.signOut,
    { csrf: csrfToken(request, referenceAuthCsrf) },
    request,
    {
      sessionProvider: auth.sessionProvider,
    },
  );

  if (!result.ok) {
    return {
      body: 'Unauthorized',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: result.status,
    };
  }

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: result.value.redirectTo,
      ...result.responseHeaders,
    },
    status: 303,
  };
}

export function referenceAuthRequest(cookie?: string): ReferenceRequest {
  const headers = new Headers({
    origin: 'https://reference.test',
    'user-agent': 'reference-auth-test',
  });
  if (cookie) headers.set('cookie', cookie);

  return {
    authCsrfId: 'login-csrf',
    headers,
  };
}

export function referenceAuthToken(request: ReferenceRequest): string {
  return csrfToken(request, referenceAuthCsrf);
}

function referenceAuthResponse(cookies: readonly string[], status = 204): BetterAuthResponseLike {
  const headers = new Headers();

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
}

function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie');
  if (!raw) return undefined;

  for (const cookie of raw.split(';')) {
    const [cookieName, ...valueParts] = cookie.trim().split('=');
    if (cookieName === name) return valueParts.join('=');
  }

  return undefined;
}

function defaultRolesForEmail(email: string): readonly ReferenceRole[] {
  return email.startsWith('admin@') ? ['admin'] : ['member'];
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
