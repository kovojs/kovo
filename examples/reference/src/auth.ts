import {
  guard,
  guards,
  mutation,
  s,
  session,
  type Guard,
  type SessionProvider,
} from '@kovojs/server';

export type ReferenceRole = 'admin' | 'member';

export interface ReferenceSession {
  id: string;
  user: {
    email: string;
    id: string;
    name: string;
    roles: string[];
  };
}

export interface ReferenceRequest {
  authCsrfId?: string | null;
  clientIp?: string;
  db: ReferenceAuthDb;
  headers: Headers;
  session?: ReferenceSession | null;
  url: string;
}

export interface ReferenceAuthFixture {
  readonly sessions: Map<string, { expiresAt: number; sessionId: string; userId: string }>;
  readonly signInRateLimit: Guard<ReferenceRequest>;
}

const referenceAuthFixtureBinding: unique symbol = Symbol('reference.auth.fixture');
const referenceAuthFixtureCapacity = 4_096;
const referenceAuthFixtures = new Map<string, WeakRef<ReferenceAuthFixture>>();
const referenceAuthFixtureFinalizer = new FinalizationRegistry<string>((fixtureId) => {
  referenceAuthFixtures.delete(fixtureId);
});

export interface ReferenceAuthDb {
  readonly [referenceAuthFixtureBinding]: string;
}

export interface ReferenceAuthBindings {
  readonly db: ReferenceAuthDb;
  readonly fixture: ReferenceAuthFixture;
  readonly sessionProvider: SessionProvider<ReferenceRequest, ReferenceSession>;
  readonly signIn: typeof signIn;
  readonly signOut: typeof signOut;
}

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
  secret: localFixtureCsrfSecret(
    'KOVO_REFERENCE_AUTH_CSRF_SECRET',
    'EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET',
  ),
  sessionId(request: ReferenceRequest) {
    return request.session?.id ?? request.authCsrfId ?? undefined;
  },
};

const referenceCookieBaseName = 'kovo_reference_session';
const referenceSessionCapacity = 256;
const referenceSessionTtlSeconds = 60 * 60;
const optionalReferenceString = {
  parse(value: unknown): string | undefined {
    return value === undefined || value === null || value === ''
      ? undefined
      : s.string().parse(value);
  },
};

const referenceUsers = new Map<string, ReferenceSession['user']>([
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

/** In-memory auth state that is usable only from a local test/development process. */
export function createReferenceAuthFixture(): ReferenceAuthFixture {
  return {
    sessions: new Map(),
    signInRateLimit: createReferenceSignInRateLimit(),
  };
}

const localReferenceSignInGuard = guard<ReferenceRequest>(
  'local reference auth fixture with app-owned rate limit',
  (request) => {
    assertReferenceFixtureRequest(request);
    return referenceFixtureFromDb(request.db).signInRateLimit(request);
  },
);

// SPEC §4.1/§10.3: these direct top-level exports are the app-authored source identities.
// `src/auth.ts` + `signIn`/`signOut` derives `auth/sign-in` and `auth/sign-out`.
export const signIn = mutation({
  csrf: referenceAuthCsrf,
  errors: { INVALID_CREDENTIALS: s.object({}) },
  guard: localReferenceSignInGuard,
  input: s.object({
    email: s.string(),
    next: optionalReferenceString,
    password: s.string(),
  }),
  redirectTo: (result: { value: { redirectTo: string } }) => result.value.redirectTo,
  handler(input, request: ReferenceRequest, context) {
    const secure = assertReferenceFixtureRequest(request);
    const user = referenceUsers.get(input.email);
    if (!user || input.password !== referenceFixturePassword()) {
      return context.fail('INVALID_CREDENTIALS', {});
    }
    const token = crypto.randomUUID();
    writeReferenceFixtureSession(referenceFixtureFromDb(request.db), token, user.id);
    context.setCookie?.(referenceCookieName(secure), token, referenceCookieOptions(secure));
    return {
      redirectTo: safeReferenceRedirect(input.next, '/account'),
      status: 'signed-in' as const,
    };
  },
});

export const signOut = mutation({
  csrf: referenceAuthCsrf,
  guard: guards.all(
    guard<ReferenceRequest>('local reference auth fixture', (request) => {
      assertReferenceFixtureRequest(request);
      return true;
    }),
    guards.authed<ReferenceRequest>(),
  ),
  input: s.object({}),
  redirectTo: (result: { value: { redirectTo: string } }) => result.value.redirectTo,
  handler(_input, request: ReferenceRequest, context) {
    const secure = assertReferenceFixtureRequest(request);
    const token = readReferenceSessionCookie(request.headers, secure);
    if (token) referenceFixtureFromDb(request.db).sessions.delete(token);
    context.setCookie?.(referenceCookieName(secure), '', {
      ...referenceCookieOptions(secure),
      maxAge: 0,
    });
    return { redirectTo: '/login', status: 'signed-out' as const };
  },
});

export function createReferenceAuth(
  fixture: ReferenceAuthFixture = createReferenceAuthFixture(),
): ReferenceAuthBindings {
  reclaimReferenceAuthFixtures();
  if (referenceAuthFixtures.size >= referenceAuthFixtureCapacity) {
    throw new Error('Reference auth fixture application capacity exceeded.');
  }
  const fixtureId = crypto.randomUUID();
  referenceAuthFixtures.set(fixtureId, new WeakRef(fixture));
  referenceAuthFixtureFinalizer.register(fixture, fixtureId);
  const db = Object.create(null) as ReferenceAuthDb;
  Object.defineProperty(db, referenceAuthFixtureBinding, {
    configurable: false,
    enumerable: false,
    value: fixtureId,
    writable: false,
  });
  const sessionProvider = referenceSession.provider(
    (request: ReferenceRequest): ReferenceSession | null => {
      const secure = assertReferenceFixtureIngress(request);
      const token = readReferenceSessionCookie(request.headers, secure);
      const storedSession = token ? readReferenceFixtureSession(fixture, token) : undefined;
      const user = storedSession
        ? [...referenceUsers.values()].find((candidate) => candidate.id === storedSession.userId)
        : undefined;
      if (!storedSession || !user) return null;
      return {
        id: storedSession.sessionId,
        user: {
          email: user.email,
          id: user.id,
          name: user.name,
          roles: [...user.roles],
        },
      };
    },
  );
  return { db, fixture, sessionProvider, signIn, signOut };
}

export const referenceAuth = createReferenceAuth();
export const referenceSessionProvider = referenceAuth.sessionProvider;
export const referenceSignIn = signIn;
export const referenceSignOut = signOut;

function referenceCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: referenceSessionTtlSeconds,
    path: '/' as const,
    sameSite: 'lax' as const,
    ...(secure ? { secure: true } : {}),
  };
}

function readReferenceSessionCookie(headers: Headers, secure: boolean): string | undefined {
  return readCookie(headers, referenceCookieName(secure));
}

function referenceCookieName(secure: boolean): string {
  return secure ? `__Host-${referenceCookieBaseName}` : referenceCookieBaseName;
}

function assertReferenceFixtureRequest(request: ReferenceRequest): boolean {
  const secure = assertReferenceFixtureIngress(request);
  if (!referenceAddressIsLoopback(request.clientIp)) {
    throw new TypeError(
      'The reference auth fixture requires a framework-resolved loopback client IP.',
    );
  }
  return secure;
}

function assertReferenceFixtureIngress(request: Pick<ReferenceRequest, 'url'>): boolean {
  if (
    process.env.NODE_ENV !== 'test' &&
    !(
      process.env.NODE_ENV === 'development' &&
      process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE === 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY'
    )
  ) {
    throw new TypeError(
      'The reference auth fixture requires test mode or the explicit local-only development capability.',
    );
  }
  const parsed = new URL(request.url);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !referenceAddressIsLoopback(parsed.hostname)
  ) {
    throw new TypeError('The reference auth fixture requires an exact loopback request URL.');
  }
  return parsed.protocol === 'https:';
}

function referenceFixturePassword(): string {
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
    'The reference auth fixture requires a nondefault KOVO_LOCAL_AUTH_FIXTURE_PASSWORD of at least 16 characters.',
  );
}

function referenceAddressIsLoopback(value: string | undefined): boolean {
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '[::1]') return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

function referenceFixtureFromDb(db: ReferenceAuthDb): ReferenceAuthFixture {
  const fixtureId = db[referenceAuthFixtureBinding];
  const fixture =
    typeof fixtureId === 'string' ? referenceAuthFixtures.get(fixtureId)?.deref() : undefined;
  if (!fixture)
    throw new TypeError('Reference auth request is not bound to an application fixture.');
  return fixture;
}

function reclaimReferenceAuthFixtures(): void {
  for (const [fixtureId, fixture] of referenceAuthFixtures) {
    if (fixture.deref() === undefined) referenceAuthFixtures.delete(fixtureId);
  }
}

function createReferenceSignInRateLimit(): Guard<ReferenceRequest> {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (request) => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
    const key = request.clientIp;
    if (!key) throw new TypeError('Reference auth rate limit requires a resolved client IP.');
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

function readReferenceFixtureSession(
  fixture: ReferenceAuthFixture,
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

function writeReferenceFixtureSession(
  fixture: ReferenceAuthFixture,
  token: string,
  userId: string,
): void {
  const now = Date.now();
  for (const [candidate, entry] of fixture.sessions) {
    if (entry.expiresAt <= now) fixture.sessions.delete(candidate);
  }
  while (fixture.sessions.size >= referenceSessionCapacity) {
    const oldest = fixture.sessions.keys().next().value;
    if (typeof oldest !== 'string') break;
    fixture.sessions.delete(oldest);
  }
  fixture.sessions.set(token, {
    expiresAt: now + referenceSessionTtlSeconds * 1_000,
    sessionId: crypto.randomUUID(),
    userId,
  });
}

function safeReferenceRedirect(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return fallback;
  }
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

export function referenceAuthRequest(
  cookie?: string,
  url = 'http://localhost/reference-auth-test',
  db: ReferenceAuthDb = referenceAuth.db,
): ReferenceRequest {
  const headers = new Headers({
    origin: new URL(url).origin,
    'user-agent': 'reference-auth-test',
  });
  if (cookie) headers.set('cookie', cookie);
  return {
    authCsrfId: 'login-csrf',
    clientIp: nextReferenceTestIp(),
    db,
    headers,
    url,
  };
}

let referenceTestRequestCount = 0;

function nextReferenceTestIp(): string {
  referenceTestRequestCount = (referenceTestRequestCount % 250) + 1;
  return `127.0.0.${referenceTestRequestCount}`;
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

function localFixtureCsrfSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  // Auth operations are denied outside test/explicit local development by
  // assertReferenceFixtureIngress. Keep static/public-shell imports side-effect free in
  // production mode; this value never authorizes the disabled fixture there.
  return fallback;
}
