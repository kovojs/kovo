import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { domain } from './domain.js';
import { guards, session } from './guards.js';
import { renderedHtml } from './html.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { serverResponseToWebResponse } from './response.js';
import { renderRoutePageResponse, route } from './route.js';
import { s } from './schema.js';

describe('route and query guard responses', () => {
  it('stamps non-OK route guard fallback bodies with the document security floor', async () => {
    const limitedRoute = route('/limited', {
      guard: guards.rateLimit({ max: 0, per: 'global', windowMs: 60_000 }),
      page() {
        return renderedHtml('unreachable');
      },
    });

    const response = await renderRoutePageResponse(limitedRoute, {}, {}, String);

    expect(response).toMatchObject({
      body: 'Too Many Requests',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
      },
      status: 429,
    });
  });

  it('resolves app session providers before route and query guards', async () => {
    type AppSession = { user: { id: string; roles: readonly string[] } };
    type AppRequest = { headers: Headers; session?: AppSession | null };
    const events: string[] = [];
    const appSession = session(
      s.object({
        user: s.object({
          id: s.string(),
          roles: s.array(s.string()),
        }),
      }),
    );
    const sessionProvider = appSession.provider((request: AppRequest) => {
      events.push(`provider:${request.headers.get('cookie') ?? 'none'}`);
      return { user: { id: 'u1', roles: ['admin'] } };
    });
    const assertBadProvider = () => {
      // @ts-expect-error SPEC §6.5 keeps provider/session shape compatibility static.
      appSession.provider(() => ({ user: { id: 123, roles: ['admin'] } }));
    };
    expect(assertBadProvider).toBeTypeOf('function');

    const adminRoute = route('/admin', {
      guard(request: AppRequest) {
        events.push(`route-guard:${request.session?.user.id ?? 'anonymous'}`);
        return guards.role<AppRequest>('admin')(request);
      },
      page(_context, request: AppRequest) {
        events.push(`page:${request.session?.user.id ?? 'anonymous'}`);
        return renderedHtml(request.session?.user.id ?? 'anonymous');
      },
    });
    const accountQuery = query('account', {
      guard(request: AppRequest) {
        events.push(`query-guard:${request.session?.user.id ?? 'anonymous'}`);
        return guards.authed<AppRequest>()(request);
      },
      load(_input, { request }: { request: AppRequest }) {
        return { userId: request.session?.user.id ?? 'anonymous' };
      },
      reads: [domain('user')],
    });
    const request = { headers: new Headers({ cookie: 'kovo_session=s1' }) };

    await expect(
      renderRoutePageResponse(adminRoute, {}, request, (value) => `<main>${value}</main>`, {
        sessionProvider,
      }),
    ).resolves.toEqual({
      body: '<main>u1</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
    await expect(
      renderQueryEndpointResponse(accountQuery, {
        request,
        sessionProvider,
      }),
    ).resolves.toEqual({
      body: '<kovo-query name="account">{"userId":"u1"}</kovo-query>',
      // H3 fix: /_q/ 200 responses now carry the private cache posture (SPEC §9.4:895).
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 200,
    });
    expect(events).toEqual([
      'provider:kovo_session=s1',
      'route-guard:u1',
      'page:u1',
      'provider:kovo_session=s1',
      'query-guard:u1',
    ]);
  });

  it('exposes provider sessions through request proxy reflection', async () => {
    type AppSession = { user: { id: string } };
    type AppRequest = {
      headers: Headers;
      readCookie(): string | null;
      session?: AppSession | null;
    };
    const appSession = session(
      s.object({
        user: s.object({
          id: s.string(),
        }),
      }),
    );
    const sessionProvider = appSession.provider((_request: AppRequest) => ({
      user: { id: 'u1' },
    }));
    const inspectedRoute = route('/inspect', {
      page(_context, request: AppRequest) {
        const descriptor = Object.getOwnPropertyDescriptor(request, 'session');
        return {
          cookie: request.readCookie(),
          descriptor: descriptor && {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            value: descriptor.value,
            writable: descriptor.writable,
          },
          hasSession: 'session' in request,
          keys: Object.keys(request),
          spreadSession: { ...request }.session,
          userId: request.session?.user.id,
        };
      },
    });
    const request = {
      headers: new Headers({ cookie: 'kovo_session=s1' }),
      readCookie() {
        return this.headers.get('cookie');
      },
    };

    await expect(
      renderRoutePageResponse(inspectedRoute, {}, request, JSON.stringify, { sessionProvider }),
    ).resolves.toEqual({
      body: JSON.stringify({
        cookie: 'kovo_session=s1',
        descriptor: {
          configurable: true,
          enumerable: true,
          value: { user: { id: 'u1' } },
          writable: false,
        },
        hasSession: true,
        keys: ['headers', 'readCookie', 'session'],
        spreadSession: { user: { id: 'u1' } },
        userId: 'u1',
      }),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('maps route and query guard failures to login redirects and 403 shells', async () => {
    type AppRequest = { session?: { user?: { roles?: readonly string[] } | null } | null };
    const authedRoute = route('/account', {
      guard: guards.authed<AppRequest>(),
      onUnauthenticated({ next }) {
        return { location: `/signin?continue=${encodeURIComponent(next)}`, status: 303 };
      },
      page: () => trustedHtml('account'),
      search: s.object({ tab: s.string() }),
    });
    const adminRoute = route('/admin', {
      guard: guards.role<AppRequest>('admin'),
      page: () => trustedHtml('admin'),
    });
    const accountQuery = query('account', {
      guard: guards.authed<AppRequest>(),
      reads: [domain('user')],
    });
    const adminQuery = query('adminStats', {
      guard: guards.role<AppRequest>('admin'),
      reads: [domain('admin')],
    });

    await expect(
      renderRoutePageResponse(authedRoute, { search: { tab: 'settings' } }, { session: null }),
    ).resolves.toEqual({
      body: '',
      headers: { Location: '/signin?continue=%2Faccount%3Ftab%3Dsettings' },
      status: 303,
    });
    const routeForbidden = await renderRoutePageResponse(
      adminRoute,
      {},
      { session: { user: { roles: ['staff'] } } },
      String,
      {
        renderForbidden: () => '<main>Forbidden</main>',
      },
    );
    expect(routeForbidden).toMatchObject({
      body: '<main>Forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        Vary: 'Cookie',
      },
      status: 403,
    });
    // H3 fix: /_q/ guard-failure responses also carry the private cache posture (SPEC §9.4:895).
    await expect(
      renderQueryEndpointResponse(accountQuery, {
        request: { session: null },
        search: new URLSearchParams([['id', 'u1']]),
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        Location: '/login?next=%2F_q%2Faccount%3Fid%3Du1',
        Vary: 'Cookie',
      },
      status: 303,
    });
    const queryForbidden = await renderQueryEndpointResponse(adminQuery, {
      renderForbidden: () => '<main>Query forbidden</main>',
      request: { session: { user: { roles: ['staff'] } } },
    });
    expect(queryForbidden).toMatchObject({
      body: '<main>Query forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        Vary: 'Cookie',
      },
      status: 403,
    });
  });

  it('preserves query guard redirect Location blessing through cache/build header wrapping', async () => {
    type AppRequest = { session?: { user?: { id: string } | null } | null };
    const accountQuery = query('account', {
      guard: guards.authed<AppRequest>(),
      reads: [domain('user')],
    });

    const endpointResponse = await renderQueryEndpointResponse(accountQuery, {
      buildToken: 'guard-build',
      request: { session: null },
      search: new URLSearchParams([['view', 'summary']]),
    });
    const webResponse = serverResponseToWebResponse(endpointResponse, { method: 'GET' });

    expect(webResponse.status).toBe(303);
    expect(webResponse.headers.get('Location')).toBe(
      '/login?next=%2F_q%2Faccount%3Fview%3Dsummary',
    );
    expect(webResponse.headers.get('Cache-Control')).toBe('private, no-store');
    expect(webResponse.headers.get('Kovo-Build')).toBe('guard-build');
  });
});
