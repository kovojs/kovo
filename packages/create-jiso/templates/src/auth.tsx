/** @jsxImportSource @jiso/server */
import { csrfField, guards, s, session, type CsrfValidationOptions } from '@jiso/server';
import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  role,
  type BetterAuthLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
} from '@jiso/better-auth';

export interface StarterSession {
  id: string;
  user: {
    email: string;
    id: string;
    name: string;
    roles: readonly string[];
  };
}

export interface StarterAuthRequest {
  authCsrfId?: string | null;
  headers: Headers;
  session?: StarterSession | null;
}

export interface StarterBetterAuthSession {
  id: string;
}

export interface StarterBetterAuthUser {
  email: string;
  id: string;
  name?: string | null;
  roles?: readonly string[] | null;
}

export type StarterBetterAuth = BetterAuthLike<StarterBetterAuthSession, StarterBetterAuthUser> &
  BetterAuthSignInEmailLike &
  BetterAuthSignOutLike;

export const starterSession = session(
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

// SECURITY (SECURITY_FINDINGS.md M5): the CSRF token is HMAC(secret, sessionId), so
// the secret is the only key material. Read it from the environment and fail closed
// rather than shipping a known constant — `create-jiso` writes a fresh per-project
// secret into .env at scaffold time, and deployments must set their own strong value.
function readStarterCsrfSecret(): string {
  const csrfSecret = process.env.JISO_CSRF_SECRET;

  if (!csrfSecret || csrfSecret === 'replace-with-a-deployed-secret') {
    throw new Error(
      'Set JISO_CSRF_SECRET to a strong random value (e.g. `openssl rand -base64 32`).',
    );
  }

  return csrfSecret;
}

export const starterAuthCsrf = {
  field: 'csrf',
  secret: readStarterCsrfSecret(),
  sessionId(request: StarterAuthRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
} satisfies CsrfValidationOptions<StarterAuthRequest>;

export const starterAdminGuard = role<StarterAuthRequest>('admin');

// SECURITY (SECURITY_FINDINGS.md M7 + M3): brute-force / credential-stuffing guard for
// the unauthenticated sign-in endpoint. The mutation guard only receives the request
// (not the parsed body), so the submitted email is not available here; we instead key
// on a stable per-client identifier derived from forwarding/IP headers. The default
// `per: 'session'` keying would collapse all pre-session sign-in attempts into one
// shared `'anonymous'` bucket, so we use `per: 'global'` with an explicit `key`.
// Behind a proxy these headers are spoofable; replace with a trusted client identifier
// (e.g. the proxy-validated client IP) before relying on this in production.
function starterSignInRateLimitKey(request: StarterAuthRequest): string {
  const headers = request.headers;
  const forwardedFor = headers.get('x-forwarded-for');
  const clientIp =
    forwardedFor?.split(',')[0]?.trim() ||
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('fly-client-ip');

  return clientIp ? `sign-in:${clientIp}` : 'sign-in:unknown-client';
}

export const starterSignInRateLimit = guards.rateLimit<StarterAuthRequest>({
  key: starterSignInRateLimitKey,
  max: 5,
  per: 'global',
  windowMs: 60_000,
});

export function createStarterAuth(auth: StarterBetterAuth) {
  const sessionProvider = betterAuthSession(auth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: {
      email: user.email,
      id: user.id,
      name: user.name ?? user.email,
      roles: user.roles ?? [],
    },
  }));

  const signIn = betterAuthSignInEmailMutation<'auth/sign-in', StarterAuthRequest>(auth, {
    csrf: starterAuthCsrf,
    defaultRedirectTo: '/cart',
    // SECURITY (SECURITY_FINDINGS.md M7): throttle sign-in attempts per client to blunt
    // online password brute-force / credential stuffing.
    guard: starterSignInRateLimit,
  });

  const signOut = betterAuthSignOutMutation<
    'auth/sign-out',
    StarterAuthRequest,
    StarterAuthRequest & { session: StarterSession }
  >(auth, {
    csrf: starterAuthCsrf,
    defaultRedirectTo: '/login',
    guard: authed<StarterAuthRequest>(),
  });

  return {
    sessionProvider,
    signIn,
    signOut,
  };
}

export interface LoginFormOptions {
  failure?: 'INVALID_CREDENTIALS';
  next?: string;
  request?: StarterAuthRequest;
}

// SPEC.md section 6.3 and section 9.1: the auth recipe keeps credential flows
// as ordinary mutation forms. Browsers without JS post directly to /_m/*; the
// `enhance` attribute only upgrades the same form to the fragment wire.
export function renderLoginForm(options: LoginFormOptions = {}): string {
  return (
    <form
      method="post"
      action="/_m/auth/sign-in"
      enhance
      data-mutation="auth/sign-in"
      class="grid gap-4 rounded border border-slate-200 bg-white p-6"
    >
      {options.request ? csrfField(options.request, starterAuthCsrf) : ''}
      <input type="hidden" name="next" value={options.next ?? '/cart'} />
      <label class="grid gap-1 text-sm font-medium text-slate-700">
        <span>Email</span>
        <input
          class="rounded border border-slate-300 px-3 py-2"
          name="email"
          type="email"
          autocomplete="email"
          required
        />
      </label>
      <label class="grid gap-1 text-sm font-medium text-slate-700">
        <span>Password</span>
        <input
          class="rounded border border-slate-300 px-3 py-2"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      {options.failure === 'INVALID_CREDENTIALS' ? (
        <output role="alert" data-error-code="INVALID_CREDENTIALS" class="text-sm text-red-700">
          Invalid email or password.
        </output>
      ) : (
        ''
      )}
      <button class="rounded bg-jiso-accent px-4 py-2 text-sm font-medium text-white" type="submit">
        Sign in
      </button>
    </form>
  );
}

export function renderLogoutForm(request: StarterAuthRequest): string {
  return (
    <form
      method="post"
      action="/_m/auth/sign-out"
      enhance
      data-mutation="auth/sign-out"
      class="inline"
    >
      {csrfField(request, starterAuthCsrf)}
      <button class="text-sm font-medium text-jiso-accent" type="submit">
        Sign out
      </button>
    </form>
  );
}
