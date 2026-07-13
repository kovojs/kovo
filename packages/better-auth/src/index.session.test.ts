import { type EndpointDeclaration, type SessionProvider } from '@kovojs/server';
import {
  endpointMatches,
  resolveLifecycleRequest,
  runEndpoint,
} from '@kovojs/server/internal/execution';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { betterAuthSession, mount, type BetterAuthLike } from './index.js';
import { betterAuthMountOperationContract } from './internal.js';
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

  it('reconstructs the mapper payload without Better Auth credential-shaped fields', async () => {
    // SPEC §10.3 C9: Better Auth's real session payload contains the live bearer `token`.
    // The app-authored mapper is not a trusted plaintext sink, so it may receive only a
    // reconstructed projection with credential-shaped fields removed.
    const auth = {
      api: {
        getSession: () => ({
          session: {
            activeOrganizationId: 'org-1',
            id: 'session-1',
            refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
            token: 'LIVE_BETTER_AUTH_BEARER_TOKEN',
          },
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            passwordHash: 'STORED_PASSWORD_HASH',
            roles: ['admin'] as const,
          },
        }),
      },
    };
    let mapperPayload: unknown;
    const provider = betterAuthSession(auth, (value) => {
      if (false) {
        // @ts-expect-error Better Auth's live bearer credential is not mapper-readable.
        value.session.token;
        // @ts-expect-error Credential-shaped plugin fields are not mapper-readable.
        value.user.passwordHash;
      }
      mapperPayload = value;
      return value;
    });

    await provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) });

    expect(mapperPayload).toEqual({
      session: {
        activeOrganizationId: 'org-1',
        id: 'session-1',
        refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      },
      user: {
        email: 'ada@example.com',
        id: 'user-1',
        roles: ['admin'],
      },
    });
  });

  it('recursively strips JSON credentials and isolates provider objects across requests', async () => {
    // Better Auth additional fields may be JSON/array/date values. The app mapper must not receive
    // nested credential fields or a live reference into provider/cache state that another request
    // can mutate (SPEC §6.5/§10.3 C9).
    const providerPayload = {
      session: {
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        id: 'session-1',
      },
      user: {
        id: 'user-1',
        profile: {
          apiToken: 'NESTED_PLUGIN_BEARER',
          preferences: { theme: 'light' },
          roles: ['member'],
        },
      },
    };
    const auth = { api: { getSession: () => providerPayload } };
    const observations: unknown[] = [];
    const provider = betterAuthSession(auth, (value) => {
      if (false) {
        // @ts-expect-error Nested credential-shaped JSON fields are not mapper-readable.
        value.user.profile.apiToken;
      }
      observations.push({
        expiresAt: value.session.expiresAt,
        hasApiToken: 'apiToken' in value.user.profile,
        preferencesTheme: value.user.profile.preferences.theme,
        roles: Array.from(value.user.profile.roles),
      });
      value.user.profile.preferences.theme = 'mapper-mutated';
      value.user.profile.roles.push('mapper-mutated');
      return value;
    });

    await provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) });
    await provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) });

    expect(providerPayload.user.profile).toEqual({
      apiToken: 'NESTED_PLUGIN_BEARER',
      preferences: { theme: 'light' },
      roles: ['member'],
    });
    expect(observations).toEqual([
      {
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        hasApiToken: false,
        preferencesTheme: 'light',
        roles: ['member'],
      },
      {
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        hasApiToken: false,
        preferencesTheme: 'light',
        roles: ['member'],
      },
    ]);
    expect((observations[0] as { expiresAt: Date }).expiresAt).not.toBe(
      providerPayload.session.expiresAt,
    );
  });

  it('rejects cyclic provider values before they can reach session serialization', async () => {
    const profile: Record<string, unknown> = { displayName: 'Ada' };
    profile.self = profile;
    const auth = {
      api: {
        getSession: () => ({
          session: { id: 'session-1' },
          user: { id: 'user-1', profile },
        }),
      },
    };
    const provider = betterAuthSession(auth, (value) => value);

    await expect(provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) })).rejects.toThrow(
      'Better Auth session provider failed inside the trusted plaintext boundary.',
    );
  });

  it('does not let deferred session-header failures carry secrets out of the boundary', async () => {
    const secret = 'LIVE_REFRESH_COOKIE_MUST_NOT_ESCAPE';
    const auth = {
      api: {
        getSession: () => ({
          headers: {
            getSetCookie() {
              throw new Error(`refresh parsing failed for ${secret}`);
            },
          } as unknown as Headers,
          response: {
            session: { id: 'session-1' },
            user: { id: 'user-1' },
          },
        }),
      },
    };
    const provider = betterAuthSession(auth, (value) => value);
    const result = await provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) });

    expect(result).toEqual({
      session: { id: 'session-1' },
      user: { id: 'user-1' },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
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
      reservedHeaders: ['Location', 'Set-Cookie'],
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

  it('delegates browser credentials only through the pinned Better Auth mount', async () => {
    let received:
      | { authorization: string | null; cookie: string | null; session: boolean }
      | undefined;
    const authEndpoint = mount(
      '/auth',
      (request) => {
        received = {
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
          session: 'session' in request,
        };
        return new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            Location: '/signed-in',
            'Set-Cookie':
              'better-auth.session_token=rotated; Path=/; Secure; HttpOnly; SameSite=Lax',
          },
          status: 302,
        });
      },
      { method: 'GET' },
    );
    const request = new Request('https://example.test/auth/callback/provider', {
      headers: {
        Authorization: 'Bearer callback-token',
        Cookie: 'better-auth.state=oauth-secret; better-auth.session_token=old',
      },
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 'ambient-kovo-session' },
    });

    const response = await runEndpoint(authEndpoint, request);

    expect(received).toEqual({
      authorization: 'Bearer callback-token',
      cookie: 'better-auth.state=oauth-secret; better-auth.session_token=old',
      session: false,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signed-in');
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=rotated');
  });

  it('keeps explicitly unauthenticated mounts browser-credential neutral', async () => {
    let received: { authorization: string | null; cookie: string | null } | undefined;
    const magicLink = mount(
      '/auth/magic-link',
      (request) => {
        received = {
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        };
        return new Response('verified');
      },
      {
        auth: { justification: 'magic-link token is carried in the URL', kind: 'none' },
        csrfJustification: 'magic-link token is carried in the URL',
        method: 'GET',
      },
    );

    await runEndpoint(
      magicLink,
      new Request('https://example.test/auth/magic-link/verify?token=opaque', {
        headers: { Authorization: 'Bearer ambient', Cookie: 'sid=ambient' },
      }),
    );

    expect(received).toEqual({ authorization: null, cookie: null });
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

  it('does not let mounted handler failures carry request cookies out', async () => {
    const secret = 'MOUNT_COOKIE_SECRET_MUST_NOT_ESCAPE';
    const endpoint = mount(
      '/auth',
      (request) => {
        throw new Error(`provider callback failed for ${secret}: ${request.headers.get('cookie')}`);
      },
      { method: 'GET' },
    );
    let thrown: unknown;
    try {
      await runEndpoint(
        endpoint,
        new Request('https://example.test/auth/callback/provider', {
          headers: { cookie: `better-auth.session_token=${secret}` },
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'Better Auth mounted handler failed inside the trusted plaintext boundary.',
    );
    expect(`${String((thrown as Error).stack)} ${JSON.stringify(thrown)}`).not.toContain(secret);
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

  it('does not let the exported mount contract downgrade later endpoint posture', () => {
    // SPEC §6.6/§10.3 C9: the internal contract is an observability surface, not mutable
    // authorization authority for public `mount()` calls made later in the same process.
    const contract = betterAuthMountOperationContract as unknown as {
      access: unknown;
      auth: unknown;
      csrf: { justification: string };
    };
    const saved = {
      access: contract.access,
      auth: contract.auth,
      csrfJustification: contract.csrf.justification,
    };
    try {
      Reflect.set(contract, 'access', {
        kind: 'public',
        reason: 'attacker-forged access posture',
      });
      Reflect.set(contract, 'auth', { justification: 'attacker downgrade', kind: 'none' });
      Reflect.set(contract.csrf, 'justification', 'attacker downgrade');
      const endpoint = mount('/auth', new FakeMountedAuth(), { method: 'GET' });

      expect(endpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });
      expect(endpoint.access).toEqual({
        kind: 'public',
        reason: 'better-auth provider redirect protocol handled by Better Auth state',
      });
      expect(endpoint.csrf).toEqual({
        exempt: true,
        justification: 'better-auth browser redirect protocol handler',
      });
    } finally {
      Reflect.set(contract, 'access', saved.access);
      Reflect.set(contract, 'auth', saved.auth);
      Reflect.set(contract.csrf, 'justification', saved.csrfJustification);
    }
  });
});
