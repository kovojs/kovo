import { type EndpointDeclaration, type SessionProvider } from '@kovojs/server';
import {
  endpointMatches,
  resolveLifecycleRequest,
  runEndpoint,
} from '@kovojs/server/internal/execution';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { betterAuthSession, mount, type BetterAuthLike } from './index.js';
import {
  type AppSession,
  type AuthSession,
  type AuthUser,
  FakeBetterAuth,
  FakeMountedAuth,
  type RequestWithHeaders,
  mapSession,
} from './test-fakes.js';

const mappedAppSession: AppSession = {
  activeOrganizationId: 'org-1',
  id: 'session-1',
  user: {
    email: 'ada@example.com',
    id: 'user-1',
    roles: ['admin', 'member'],
  },
};

describe('betterAuthSession', () => {
  it('maps a Better Auth-like session into the app session provider seam', async () => {
    const auth = new FakeBetterAuth();
    const headers = new Headers({ cookie: 'kovo_session=s1' });
    const provider = betterAuthSession(auth, mapSession);

    // part-3 I2 (backward-compat): the provider resolves to the plain mapped value when
    // Better Auth wrote no refresh Set-Cookie (the common case), and only to the additive
    // `{ value, setCookies }` envelope when there ARE cookies to forward — keeping existing
    // SessionProvider consumers (and apps whose getSession ignores returnHeaders) unchanged.
    await expect(provider({ headers })).resolves.toEqual(mappedAppSession);
    expect(auth.lastHeaders).toBe(headers);
  });

  it('treats a missing Better Auth session as anonymous', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers: new Headers() })).resolves.toBeNull();
  });

  it('pins getSession before a late API swap can forge an admin session', async () => {
    const auth = new FakeBetterAuth();
    const originalApi = auth.api;
    const provider = betterAuthSession(auth, mapSession);
    let poisonCalls = 0;
    const forgedGetSession = () => {
      poisonCalls += 1;
      return {
        headers: new Headers({ 'set-cookie': 'attacker_session=forged' }),
        response: {
          session: { activeOrganizationId: 'attacker-org', id: 'attacker-session' },
          user: {
            email: 'evil@example.com',
            id: 'attacker',
            roles: ['admin', 'member'] as const,
          },
        },
      };
    };
    (originalApi as { getSession: typeof forgedGetSession }).getSession = forgedGetSession;
    (auth as unknown as { api: { getSession: typeof forgedGetSession } }).api = {
      getSession: forgedGetSession,
    };

    await expect(
      provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) }),
    ).resolves.toEqual(mappedAppSession);
    expect(poisonCalls).toBe(0);
  });

  it('rejects accessor and inherited session authority at declaration time', () => {
    const apiAccessor = Object.defineProperty({}, 'api', {
      get: () => ({ getSession: () => null }),
    }) as BetterAuthLike<AuthSession, AuthUser>;
    const inheritedMethod = {
      api: Object.create({ getSession: () => null }),
    } as BetterAuthLike<AuthSession, AuthUser>;

    expect(() => betterAuthSession(apiAccessor, mapSession)).toThrow(
      'Better Auth session.api must be a stable own-data object',
    );
    expect(() => betterAuthSession(inheritedMethod, mapSession)).toThrow(
      'Better Auth session.api.getSession must be a stable own-data method',
    );
  });

  it('does not reinterpret a bare session through inherited envelope properties', async () => {
    const auth = {
      api: {
        getSession: () => ({
          session: { activeOrganizationId: 'org-1', id: 'session-1' },
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['admin', 'member'] as const,
          },
        }),
      },
    };
    const attackerPayload = {
      session: { activeOrganizationId: null, id: 'attacker-session' },
      user: { email: 'evil@example.com', id: 'attacker', roles: ['admin'] as const },
    };
    const attackerHeaders = new Headers({ 'set-cookie': 'attacker_session=forged' });
    const provider = betterAuthSession(auth, mapSession);
    try {
      Object.defineProperty(Object.prototype, 'response', {
        configurable: true,
        value: attackerPayload,
      });
      Object.defineProperty(Object.prototype, 'headers', {
        configurable: true,
        value: attackerHeaders,
      });
      await expect(provider({ headers: new Headers() })).resolves.toEqual(mappedAppSession);
    } finally {
      delete (Object.prototype as { response?: unknown }).response;
      delete (Object.prototype as { headers?: unknown }).headers;
    }
  });

  // part-3 I2 (SPEC.md §6.5, §9.1.1:854): with rolling sessions / cookie-cache, Better Auth
  // writes a fresh session Set-Cookie on every authenticated GET. The framework lifecycle
  // MUST set the resolved session AND forward that refresh cookie to the response sink, so a
  // continuously-active user is not hard-logged-out at the original boundary.
  it('forwards Better Auth session-refresh Set-Cookie headers to the lifecycle sink', async () => {
    const auth = new FakeBetterAuth();
    auth.refreshSetCookie =
      'better-auth.session_token=refreshed; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800';
    const provider = betterAuthSession(auth, mapSession);

    const forwarded: string[] = [];
    const lifecycleRequest = await resolveLifecycleRequest<RequestWithHeaders, AppSession>(
      { headers: new Headers({ cookie: 'kovo_session=s1' }) },
      {
        onSessionSetCookie: (cookie) => forwarded.push(cookie),
        sessionProvider: provider,
      },
    );

    // The resolved request still carries the mapped session value (backward compatible).
    expect((lifecycleRequest as { session: AppSession | null }).session).toEqual(mappedAppSession);
    // And the refresh cookie reached the response sink (today: nothing).
    expect(forwarded).toEqual([
      'better-auth.session_token=refreshed; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800',
    ]);
  });

  it('drives no refresh cookies when Better Auth wrote none', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    const forwarded: string[] = [];
    await resolveLifecycleRequest<RequestWithHeaders, AppSession>(
      { headers: new Headers({ cookie: 'kovo_session=s1' }) },
      {
        onSessionSetCookie: (cookie) => forwarded.push(cookie),
        sessionProvider: provider,
      },
    );

    expect(forwarded).toEqual([]);
  });

  it('keeps the mapper total against the declared app session type', () => {
    const auth = new FakeBetterAuth();
    const provider: SessionProvider<RequestWithHeaders, AppSession> = betterAuthSession(
      auth,
      mapSession,
    );

    expectTypeOf(provider).toEqualTypeOf<SessionProvider<RequestWithHeaders, AppSession>>();

    const incompleteMapper = (value: { session: AuthSession; user: AuthUser }) => ({
      activeOrganizationId: value.session.activeOrganizationId,
      id: value.session.id,
      user: {
        id: value.user.id,
        roles: value.user.roles,
      },
    });

    // @ts-expect-error SPEC.md §6.5: dropped declared session fields make the mapper red.
    const incompleteProvider: SessionProvider<RequestWithHeaders, AppSession> = betterAuthSession(
      auth,
      incompleteMapper,
    );
    expect(incompleteProvider).toBeTypeOf('function');
  });
});

describe('browser redirect protocol mount', () => {
  it('declares a prefix endpoint for Better Auth-owned redirect protocols', async () => {
    const auth = new FakeMountedAuth();
    const authEndpoint = mount('/auth', auth, { method: 'GET' });

    expect(authEndpoint.path).toBe('/auth');
    expect(authEndpoint.mount).toBe('prefix');
    expect(authEndpoint.method).toBe('GET');
    expect(authEndpoint.mountJustification).toBe(
      'better-auth owns provider callback subpaths under this mount',
    );
    expect(authEndpoint.reason).toBe('better-auth provider redirect and callback mount');
    expect(authEndpoint.response).toEqual({
      appOwnedSafety: true,
      body: 'redirect',
      cache: 'no-store',
    });
    expect(authEndpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });
    expect(authEndpoint.access).toEqual({
      kind: 'public',
      reason: 'better-auth provider redirect protocol handled by Better Auth state',
    });
    expect(authEndpoint.csrf).toEqual({
      exempt: true,
      justification: 'better-auth browser redirect protocol handler',
    });
    expect(
      endpointMatches(authEndpoint, { method: 'GET', pathname: '/auth/callback/github' }),
    ).toBe(true);
    expect(endpointMatches(authEndpoint, { method: 'POST', pathname: '/auth/saml/acs' })).toBe(
      false,
    );
    expect(endpointMatches(authEndpoint, { method: 'GET', pathname: '/authish/callback' })).toBe(
      false,
    );

    const request = new Request('https://example.test/auth/callback/github');
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 's1' },
    });
    const response = await runEndpoint(authEndpoint, request);

    await expect(response.text()).resolves.toBe('/auth/callback/github');
    expect(response.status).toBe(302);
    expect(auth.lastRequest).toBeDefined();
    expect(auth.sawSession).toBe(false);
  });

  it('accepts a direct handler and explicit audit metadata', async () => {
    const magicLink = mount('/auth/magic-link', (request) => new Response(request.method), {
      auth: { justification: 'magic-link verification token', kind: 'none' },
      csrfJustification: 'magic-link verification token',
      method: 'GET',
    });
    const typedEndpoint: EndpointDeclaration<'/auth/magic-link', 'GET', 'prefix'> = magicLink;

    expect(typedEndpoint.auth).toEqual({
      justification: 'magic-link verification token',
      kind: 'none',
    });
    expect(typedEndpoint.csrf).toEqual({
      exempt: true,
      justification: 'magic-link verification token',
    });
    expect(
      endpointMatches(typedEndpoint, { method: 'GET', pathname: '/auth/magic-link/verify' }),
    ).toBe(true);
    expect(
      endpointMatches(typedEndpoint, { method: 'POST', pathname: '/auth/magic-link/verify' }),
    ).toBe(false);
    await expect(
      (
        await runEndpoint(typedEndpoint, new Request('https://example.test/auth/magic-link'))
      ).text(),
    ).resolves.toBe('GET');
  });

  it('pins an own mount handler with its receiver and rejects substitutions', async () => {
    let poisonCalls = 0;
    const auth = {
      handled: false,
      handler(this: { handled: boolean }, request: Request) {
        this.handled = true;
        return new Response(new URL(request.url).pathname);
      },
    };
    const endpoint = mount('/auth', auth, { method: 'GET' });
    auth.handler = () => {
      poisonCalls += 1;
      return new Response('attacker');
    };

    const response = await runEndpoint(
      endpoint,
      new Request('https://example.test/auth/callback/provider'),
    );
    await expect(response.text()).resolves.toBe('/auth/callback/provider');
    expect(auth.handled).toBe(true);
    expect(poisonCalls).toBe(0);

    const accessor = Object.defineProperty({}, 'handler', {
      get: () => () => new Response('attacker'),
    }) as FakeMountedAuth;
    const inherited = Object.create({ handler: () => new Response('attacker') }) as FakeMountedAuth;
    expect(() => mount('/auth/accessor', accessor, { method: 'GET' })).toThrow(
      'Better Auth mount.handler must be a stable own-data method',
    );
    expect(() => mount('/auth/inherited', inherited, { method: 'GET' })).toThrow(
      'Better Auth mount.handler must be a stable own-data method',
    );
  });

  it('does not inherit mount auth authority and rejects option accessors', () => {
    const auth = new FakeMountedAuth();
    Object.defineProperty(Object.prototype, 'auth', {
      configurable: true,
      value: { justification: 'attacker downgrade', kind: 'none' },
    });
    let endpoint: ReturnType<typeof mount<'/auth', 'GET'>>;
    try {
      endpoint = mount('/auth', auth, { method: 'GET' });
    } finally {
      delete (Object.prototype as { auth?: unknown }).auth;
    }
    expect(endpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });

    let reads = 0;
    const options = Object.defineProperties(
      {},
      {
        auth: {
          get() {
            reads += 1;
            return { justification: 'attacker downgrade', kind: 'none' };
          },
        },
        method: { value: 'GET' },
      },
    );
    expect(() => mount('/auth', auth, options as never)).toThrow(
      'Better Auth mount option auth must be an own-data property',
    );
    expect(reads).toBe(0);
  });
});
