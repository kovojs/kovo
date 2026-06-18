import {
  type EndpointDeclaration,
  type SessionProvider,
} from '@kovojs/server';
import { endpointMatches, runEndpoint } from '@kovojs/server/internal/execution';
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

describe('betterAuthSession', () => {
  it('maps a Better Auth-like session into the app session provider seam', async () => {
    const auth = new FakeBetterAuth();
    const headers = new Headers({ cookie: 'kovo_session=s1' });
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers })).resolves.toEqual({
      activeOrganizationId: 'org-1',
      id: 'session-1',
      user: {
        email: 'ada@example.com',
        id: 'user-1',
        roles: ['admin', 'member'],
      },
    });
    expect(auth.lastHeaders).toBe(headers);
  });

  it('treats a missing Better Auth session as anonymous', async () => {
    const auth = new FakeBetterAuth();
    const provider = betterAuthSession(auth, mapSession);

    await expect(provider({ headers: new Headers() })).resolves.toBe(null);
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
    const authEndpoint = mount('/auth', auth);

    expect(authEndpoint.path).toBe('/auth');
    expect(authEndpoint.mount).toBe('prefix');
    expect(authEndpoint.method).toBeUndefined();
    expect(authEndpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });
    expect(authEndpoint.csrf).toEqual({
      exempt: true,
      justification: 'better-auth browser redirect protocol handler',
    });
    expect(
      endpointMatches(authEndpoint, { method: 'GET', pathname: '/auth/callback/github' }),
    ).toBe(true);
    expect(endpointMatches(authEndpoint, { method: 'POST', pathname: '/auth/saml/acs' })).toBe(
      true,
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
