import { type EndpointDeclaration, type SessionProvider } from '@kovojs/server';
import {
  endpointMatches,
  resolveLifecycleRequest,
  runEndpoint,
} from '@kovojs/server/internal/execution';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { betterAuthSession, mount } from './index.js';
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

  it('maps an opaque Better Auth browser session cookie by default', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    await expect(
      provider({
        headers: new Headers({ cookie: 'better-auth.session_token=opaque-session-1' }),
      }),
    ).resolves.toEqual(mappedAppSession);
  });

  it('fails closed when Better Auth returns a payload without a browser session cookie', async () => {
    const auth = new FakeBetterAuth();
    auth.forceAuthenticated = true;
    const provider = betterAuthSession(auth, () => {
      throw new Error('delegated non-cookie payloads must not be mapped');
    });

    await expect(provider({ headers: new Headers() })).resolves.toBeNull();
  });

  it('treats a missing Better Auth session as anonymous', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers: new Headers() })).resolves.toBeNull();
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

  it('treats a Better Auth session-clearing Set-Cookie as immediate revocation', async () => {
    const auth = new FakeBetterAuth();
    auth.refreshSetCookie = 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
    const provider = betterAuthSession(auth, () => {
      throw new Error('revoked sessions must not be mapped');
    });

    const forwarded: string[] = [];
    const lifecycleRequest = await resolveLifecycleRequest<RequestWithHeaders, AppSession>(
      { headers: new Headers({ cookie: 'kovo_session=s1' }) },
      {
        onSessionSetCookie: (cookie) => forwarded.push(cookie),
        sessionProvider: provider,
      },
    );

    expect((lifecycleRequest as { session: AppSession | null }).session).toBeNull();
    expect(forwarded).toEqual([
      'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ]);
  });

  it('recognizes prefixed Better Auth session-token clearing cookies as revoked', async () => {
    const auth = new FakeBetterAuth();
    auth.refreshSetCookie =
      '__Host-better-auth.session_token=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax';
    const provider = betterAuthSession(auth, mapSession);

    await expect(
      provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) }),
    ).resolves.toEqual({
      setCookies: [
        '__Host-better-auth.session_token=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
      ],
      value: null,
    });
  });

  it('treats any Better Auth session-clearing cookie in a refresh batch as revocation', async () => {
    const auth = new FakeBetterAuth();
    auth.refreshSetCookie = [
      'better-auth.session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
      'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ];
    const provider = betterAuthSession(auth, () => {
      throw new Error('mixed revocation batches must not map a stale session payload');
    });

    await expect(
      provider({ headers: new Headers({ cookie: 'kovo_session=s1' }) }),
    ).resolves.toEqual({
      setCookies: [
        'better-auth.session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
        'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      ],
      value: null,
    });
  });

  it('treats JWT-shaped Better Auth session cookies as anonymous by default', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, () => {
      throw new Error('JWT-backed sessions must not be mapped without opt-in');
    });

    await expect(
      provider({
        headers: new Headers({
          cookie: `kovo_session=s1; better-auth.session_token=${jwtSessionValue()}`,
        }),
      }),
    ).resolves.toBeNull();
  });

  it('maps JWT-shaped Better Auth session cookies only with explicit opt-in', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession, { sessionCookieMode: 'jwt' });

    await expect(
      provider({
        headers: new Headers({
          cookie: `kovo_session=s1; better-auth.session_token=${jwtSessionValue()}`,
        }),
      }),
    ).resolves.toEqual(mappedAppSession);
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

function jwtSessionValue(): string {
  return `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({ sub: 'user-1' }),
  )}.signature`;
}

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

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
});
