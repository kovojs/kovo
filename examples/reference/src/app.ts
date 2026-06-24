import { csrfField, csrfToken, mutationFormAttributes, route, s, session } from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';
import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  role,
} from '@kovojs/better-auth';

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

interface ReferenceBetterAuthResponse {
  headers: Headers;
  status: number;
}

export type ReferenceBetterAuth = ReturnType<typeof createReferenceBetterAuth>;

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
  secret: exampleDeploymentSecret(
    'KOVO_REFERENCE_AUTH_CSRF_SECRET',
    'EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET',
  ),
  sessionId(request: ReferenceRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
};

const referenceCookieName = 'kovo_reference_session';

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

export function createReferenceBetterAuth() {
  const sessionUserIds = new Map<string, string>();

  return {
    api: {
      getSession(options: { headers: Headers }) {
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
      signInEmail(options: {
        asResponse: true;
        body: { email: string; password: string };
        headers: Headers;
      }) {
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
      signOut(options: { asResponse: true; headers: Headers }) {
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

export const accountRoute = route('/account', {
  guard: authed<ReferenceRequest>(),
  page(_input, request) {
    return trustedHtml(
      `account:${request.session.user.email}${renderReferenceLogoutForm(request)}`,
    );
  },
});

export const adminRoute = route('/admin', {
  guard: role<ReferenceRequest>('admin'),
  page(_input, request) {
    return trustedHtml(
      `admin:${request.session?.user.id ?? 'anonymous'}${renderReferenceLogoutForm(request)}`,
    );
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

  return `<form ${renderReferenceMutationFormAttributes(referenceSignIn)}>${csrfField(
    request,
    referenceAuthCsrf,
  )}<input type="hidden" name="next" value="${escapeAttribute(options.next ?? '/account')}"><input name="email" type="email" autocomplete="email" required><input name="password" type="password" autocomplete="current-password" required>${error}<button type="submit">Sign in</button></form>`;
}

export function renderReferenceLogoutForm(request: ReferenceRequest): string {
  return `<form ${renderReferenceMutationFormAttributes(referenceSignOut)}>${csrfField(
    request,
    referenceAuthCsrf,
  )}<button type="submit">Sign out</button></form>`;
}

function renderReferenceMutationFormAttributes(mutation: { key: string }): string {
  const attrs = mutationFormAttributes(mutation);
  return [
    `method="${attrs.method}"`,
    `action="${escapeAttribute(attrs.action)}"`,
    attrs.enhance ? 'enhance' : '',
    `data-mutation="${escapeAttribute(attrs['data-mutation'])}"`,
  ]
    .filter(Boolean)
    .join(' ');
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

function referenceAuthResponse(
  cookies: readonly string[],
  status = 204,
): ReferenceBetterAuthResponse {
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

function exampleDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
