import { guard, guards, mutation, s, type Guard, type SessionProvider } from '@kovojs/server';

import {
  commerceSession,
  type CommerceDb,
  type CommerceRequest,
  type CommerceRole,
  type CommerceSession,
} from './domain.js';

export interface CommerceAuthRequest extends CommerceRequest {
  authCsrfId?: string | null;
  clientIp?: string;
  headers: Headers;
  url: string;
}

interface CommerceAuthFixtureUser {
  email: string;
  id: string;
  roles: readonly CommerceRole[];
}

export interface CommerceAuthFixture {
  readonly sessions: Map<string, { expiresAt: number; sessionId: string; userId: string }>;
  readonly signInRateLimit: Guard<CommerceAuthRequest>;
}

export interface CommerceAuthBindings {
  readonly db: CommerceDb;
  readonly fixture: CommerceAuthFixture;
  readonly sessionProvider: SessionProvider<CommerceAuthRequest, CommerceSession>;
  readonly signIn: typeof signIn;
  readonly signOut: typeof signOut;
}

export const EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET = 'EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET';

export const commerceAuthCsrf = {
  field: 'csrf',
  secret: localFixtureCsrfSecret(
    'KOVO_COMMERCE_AUTH_CSRF_SECRET',
    EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
  ),
  sessionId(request: CommerceAuthRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
};

const commerceAuthFixtureBinding: unique symbol = Symbol('commerce.auth.fixture');
const commerceAuthFixtureCapacity = 4_096;
const commerceAuthFixtures = new Map<string, WeakRef<CommerceAuthFixture>>();
const commerceAuthFixtureFinalizer = new FinalizationRegistry<string>((fixtureId) => {
  commerceAuthFixtures.delete(fixtureId);
});
const commerceAuthCookieBaseName = 'kovo_commerce_session';
const commerceSessionCapacity = 256;
const commerceSessionTtlSeconds = 60 * 60;
const optionalCommerceString = {
  parse(value: unknown): string | undefined {
    return value === undefined || value === null || value === ''
      ? undefined
      : s.string().parse(value);
  },
};

const commerceAuthUsers = new Map<string, CommerceAuthFixtureUser & { name: string }>([
  [
    'ada@example.com',
    {
      email: 'ada@example.com',
      id: 'u1',
      name: 'Ada Lovelace',
      roles: ['admin', 'member'],
    },
  ],
  [
    'grace@example.com',
    {
      email: 'grace@example.com',
      id: 'u2',
      name: 'Grace Hopper',
      roles: ['member'],
    },
  ],
]);

export function createCommerceAuthFixture(): CommerceAuthFixture {
  return {
    sessions: new Map(),
    signInRateLimit: createCommerceSignInRateLimit(),
  };
}

const localCommerceSignInGuard = guard<CommerceAuthRequest>(
  'local commerce auth fixture with app-owned rate limit',
  (request) => {
    assertCommerceFixtureRequest(request);
    return commerceFixtureFromDb(request.db).signInRateLimit(request);
  },
);

// SPEC §4.1/§10.3: `src/auth.ts` plus these direct exports derives the stable auth keys.
export const signIn = mutation({
  csrf: commerceAuthCsrf,
  errors: { INVALID_CREDENTIALS: s.object({}) },
  guard: localCommerceSignInGuard,
  input: s.object({
    email: s.string(),
    next: optionalCommerceString,
    password: s.string(),
  }),
  redirectTo: (result: { value: { redirectTo: string } }) => result.value.redirectTo,
  // The local fixture writes only its bounded in-memory Map. Preserve the app-bound carrier
  // instead of substituting a Drizzle transaction handle that cannot own auth-fixture authority.
  transaction(request: CommerceAuthRequest, run) {
    return run(request);
  },
  handler(input, request: CommerceAuthRequest, context) {
    const secure = assertCommerceFixtureRequest(request);
    const user = commerceAuthUsers.get(input.email);
    if (!user || input.password !== commerceFixturePassword()) {
      return context.fail('INVALID_CREDENTIALS', {});
    }
    const token = crypto.randomUUID();
    writeCommerceFixtureSession(commerceFixtureFromDb(request.db), token, user.id);
    context.setCookie?.(commerceAuthCookieName(secure), token, commerceAuthCookieOptions(secure));
    return {
      redirectTo: safeCommerceRedirect(input.next, '/cart'),
      status: 'signed-in' as const,
    };
  },
});

export const signOut = mutation({
  csrf: commerceAuthCsrf,
  guard: guards.all(
    guard<CommerceAuthRequest>('local commerce auth fixture', (request) => {
      assertCommerceFixtureRequest(request);
      return true;
    }),
    guards.authed<CommerceAuthRequest>(),
  ),
  input: s.object({}),
  redirectTo: (result: { value: { redirectTo: string } }) => result.value.redirectTo,
  transaction(request: CommerceAuthRequest, run) {
    return run(request);
  },
  handler(_input, request: CommerceAuthRequest, context) {
    const secure = assertCommerceFixtureRequest(request);
    const token = readCommerceSessionCookie(request.headers, secure);
    if (token) commerceFixtureFromDb(request.db).sessions.delete(token);
    context.setCookie?.(commerceAuthCookieName(secure), '', {
      ...commerceAuthCookieOptions(secure),
      maxAge: 0,
    });
    return { redirectTo: '/login', status: 'signed-out' as const };
  },
});

export const commerceSignIn = signIn;
export const commerceSignOut = signOut;

export function createCommerceAuth(
  rawDb: CommerceDb,
  fixture: CommerceAuthFixture = createCommerceAuthFixture(),
): CommerceAuthBindings {
  reclaimCommerceAuthFixtures();
  if (commerceAuthFixtures.size >= commerceAuthFixtureCapacity) {
    throw new Error('Commerce auth fixture application capacity exceeded.');
  }
  const fixtureId = crypto.randomUUID();
  commerceAuthFixtures.set(fixtureId, new WeakRef(fixture));
  commerceAuthFixtureFinalizer.register(fixture, fixtureId);
  const carrier = Object.create(rawDb) as CommerceDb;
  Object.defineProperty(carrier, commerceAuthFixtureBinding, {
    configurable: false,
    enumerable: false,
    value: fixtureId,
    writable: false,
  });
  const db = carrier;
  const sessionProvider = commerceSession.provider(
    (request: CommerceAuthRequest): CommerceSession | null => {
      const secure = assertCommerceFixtureIngress(request);
      const token = readCommerceSessionCookie(request.headers, secure);
      const storedSession = token ? readCommerceFixtureSession(fixture, token) : undefined;
      const user = storedSession
        ? [...commerceAuthUsers.values()].find((candidate) => candidate.id === storedSession.userId)
        : undefined;
      if (!storedSession || !user) return null;
      return { id: storedSession.sessionId, user: { id: user.id, roles: user.roles } };
    },
  );
  return { db, fixture, sessionProvider, signIn, signOut };
}

function commerceFixtureFromDb(db: CommerceDb): CommerceAuthFixture {
  const fixtureId = Reflect.get(db, commerceAuthFixtureBinding);
  const fixture =
    typeof fixtureId === 'string' ? commerceAuthFixtures.get(fixtureId)?.deref() : undefined;
  if (!fixture)
    throw new TypeError('Commerce auth request is not bound to an application fixture.');
  return fixture;
}

function reclaimCommerceAuthFixtures(): void {
  for (const [fixtureId, fixture] of commerceAuthFixtures) {
    if (fixture.deref() === undefined) commerceAuthFixtures.delete(fixtureId);
  }
}

function createCommerceSignInRateLimit(): Guard<CommerceAuthRequest> {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (request) => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
    const key = request.clientIp;
    if (!key) throw new TypeError('Commerce auth rate limit requires a resolved client IP.');
    const existing = attempts.get(key);
    if (existing) {
      if (existing.count >= 5) {
        return {
          kind: 'rateLimited',
          retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
        };
      }
      existing.count += 1;
      return true;
    }
    if (attempts.size >= 1_024) return { kind: 'rateLimited', retryAfter: 60 };
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  };
}

function commerceAuthCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: commerceSessionTtlSeconds,
    path: '/' as const,
    sameSite: 'lax' as const,
    ...(secure ? { secure: true } : {}),
  };
}

function readCommerceSessionCookie(headers: Headers, secure: boolean): string | undefined {
  return readCookie(headers, commerceAuthCookieName(secure));
}

function commerceAuthCookieName(secure: boolean): string {
  return secure ? `__Host-${commerceAuthCookieBaseName}` : commerceAuthCookieBaseName;
}

function assertCommerceFixtureRequest(request: CommerceAuthRequest): boolean {
  const secure = assertCommerceFixtureIngress(request);
  if (!commerceAddressIsLoopback(request.clientIp)) {
    throw new TypeError(
      'The commerce auth fixture requires a framework-resolved loopback client IP.',
    );
  }
  return secure;
}

function assertCommerceFixtureIngress(request: Pick<CommerceAuthRequest, 'url'>): boolean {
  if (
    process.env.NODE_ENV !== 'test' &&
    !(
      process.env.NODE_ENV === 'development' &&
      process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE === 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY'
    )
  ) {
    throw new TypeError(
      'The commerce auth fixture requires test mode or the explicit local-only development capability.',
    );
  }
  const parsed = new URL(request.url);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !commerceAddressIsLoopback(parsed.hostname)
  ) {
    throw new TypeError('The commerce auth fixture requires an exact loopback request URL.');
  }
  return parsed.protocol === 'https:';
}

function commerceFixturePassword(): string {
  if (process.env.NODE_ENV === 'test') return 'correct';
  const password = process.env.KOVO_LOCAL_AUTH_FIXTURE_PASSWORD;
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE === 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY' &&
    typeof password === 'string' &&
    password.length >= 16 &&
    password !== 'correct'
  ) {
    return password;
  }
  throw new TypeError(
    'The commerce auth fixture requires a nondefault KOVO_LOCAL_AUTH_FIXTURE_PASSWORD of at least 16 characters.',
  );
}

function commerceAddressIsLoopback(value: string | undefined): boolean {
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '[::1]') return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

function readCommerceFixtureSession(
  fixture: CommerceAuthFixture,
  token: string,
): { sessionId: string; userId: string } | undefined {
  const entry = fixture.sessions.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    fixture.sessions.delete(token);
    return undefined;
  }
  return { sessionId: entry.sessionId, userId: entry.userId };
}

function writeCommerceFixtureSession(
  fixture: CommerceAuthFixture,
  token: string,
  userId: string,
): void {
  const now = Date.now();
  for (const [candidate, entry] of fixture.sessions) {
    if (entry.expiresAt <= now) fixture.sessions.delete(candidate);
  }
  while (fixture.sessions.size >= commerceSessionCapacity) {
    const oldest = fixture.sessions.keys().next().value;
    if (typeof oldest !== 'string') break;
    fixture.sessions.delete(oldest);
  }
  fixture.sessions.set(token, {
    expiresAt: now + commerceSessionTtlSeconds * 1_000,
    sessionId: crypto.randomUUID(),
    userId,
  });
}

function safeCommerceRedirect(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return fallback;
  }
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

function readCookie(headers: Headers, name: string): string | undefined {
  const cookie = headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=');
  }
  return undefined;
}

function localFixtureCsrfSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  // Auth operations are denied outside test/explicit local development by
  // assertCommerceFixtureIngress. Keep build-time imports side-effect free in production mode;
  // this value never authorizes the disabled fixture there.
  return fallback;
}
