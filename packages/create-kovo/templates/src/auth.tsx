/** @jsxImportSource @kovojs/server */
import { FieldError, FormError } from '@kovojs/core';
import { csrfField, guards, s, session, type CsrfValidationOptions } from '@kovojs/server';
import * as style from '@kovojs/style';
import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  role,
} from '@kovojs/better-auth';

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

type MaybePromise<Value> = Value | Promise<Value>;

interface StarterBetterAuthResponse {
  headers: Headers;
  status: number;
}

export interface StarterBetterAuth {
  api: {
    getSession(options: { headers: Headers }): MaybePromise<
      | {
          session: StarterBetterAuthSession;
          user: StarterBetterAuthUser;
        }
      | null
      | undefined
    >;
    signInEmail(options: {
      asResponse: true;
      body: { email: string; password: string };
      headers: Headers;
    }): MaybePromise<StarterBetterAuthResponse>;
    signOut(options: {
      asResponse: true;
      headers: Headers;
    }): MaybePromise<StarterBetterAuthResponse>;
  };
}

export type StarterAuthBindings = ReturnType<typeof createStarterAuth>;

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
// rather than shipping a known constant — `create-kovo` writes a fresh per-project
// secret into .env at scaffold time, and deployments must set their own strong value.
function readStarterCsrfSecret(): string {
  const csrfSecret = process.env.KOVO_CSRF_SECRET;

  if (!csrfSecret || csrfSecret === 'replace-with-a-deployed-secret') {
    throw new Error(
      'Set KOVO_CSRF_SECRET to a strong random value (e.g. `openssl rand -base64 32`).',
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

const authStyles = style.create(
  {
    error: {
      color: '#b91c1c',
      fontSize: 14,
    },
    field: {
      display: 'grid',
      fontSize: 14,
      fontWeight: 500,
      color: '#334155',
      rowGap: 4,
    },
    form: {
      backgroundColor: '#ffffff',
      borderColor: '#e2e8f0',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      padding: 24,
      rowGap: 16,
    },
    input: {
      borderColor: '#cbd5e1',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      paddingBlock: 8,
      paddingInline: 12,
    },
    primaryAction: {
      backgroundColor: '#0f8b8d',
      borderRadius: 6,
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 500,
      paddingBlock: 8,
      paddingInline: 16,
    },
    secondaryAction: {
      color: '#0f8b8d',
      fontSize: 14,
      fontWeight: 500,
    },
  },
  { namespace: 'starterAuth', source: 'src/auth.tsx' },
);

export const starterAuthStyleCss = style.emitAtomicCss(
  Object.values(authStyles).flatMap((entry) => entry.__rules ?? []),
);

// SPEC.md section 6.3 and section 9.1: the auth recipe keeps credential flows
// as ordinary mutation forms. Browsers without JS post directly to /_m/*; the
// `enhance` attribute only upgrades the same form to the fragment wire.
export function renderLoginForm(auth: StarterAuthBindings, options: LoginFormOptions = {}): string {
  const failure = options.failure ? { code: options.failure } : null;

  return (
    <form enhance mutation={auth.signIn} {...style.attrs(authStyles.form)}>
      {options.request ? csrfField(options.request, starterAuthCsrf) : ''}
      <input type="hidden" name="next" value={options.next ?? '/cart'} />
      <label {...style.attrs(authStyles.field)}>
        <span>Email</span>
        <input
          {...style.attrs(authStyles.input)}
          name="email"
          type="email"
          autocomplete="email"
          required
        />
        {FieldError({ failure: null, name: 'email', ...style.attrs(authStyles.error) })}
      </label>
      <label {...style.attrs(authStyles.field)}>
        <span>Password</span>
        <input
          {...style.attrs(authStyles.input)}
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
        {FieldError({ failure: null, name: 'password', ...style.attrs(authStyles.error) })}
      </label>
      {FormError({
        ...style.attrs(authStyles.error),
        children: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS',
        failure,
      })}
      <button {...style.attrs(authStyles.primaryAction)} type="submit">
        Sign in
      </button>
    </form>
  ) as string;
}

export function renderLogoutForm(auth: StarterAuthBindings, request: StarterAuthRequest): string {
  return (
    <form enhance mutation={auth.signOut}>
      {csrfField(request, starterAuthCsrf)}
      <button {...style.attrs(authStyles.secondaryAction)} type="submit">
        Sign out
      </button>
    </form>
  ) as string;
}
