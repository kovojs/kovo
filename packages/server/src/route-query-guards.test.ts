import { describe, expect, it } from 'vitest';

import {
  domain,
  guards,
  query,
  route,
  renderQueryEndpointResponse,
  renderRoutePageResponse,
  s,
  session,
} from './index.js';

describe('route and query guard responses', () => {
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
        return request.session?.user.id ?? 'anonymous';
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
    const request = { headers: new Headers({ cookie: 'jiso_session=s1' }) };

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
      body: '<fw-query name="account">{"userId":"u1"}</fw-query>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
    expect(events).toEqual([
      'provider:jiso_session=s1',
      'route-guard:u1',
      'page:u1',
      'provider:jiso_session=s1',
      'query-guard:u1',
    ]);
  });

  it('maps route and query guard failures to login redirects and 403 shells', async () => {
    type AppRequest = { session?: { user?: { roles?: readonly string[] } | null } | null };
    const authedRoute = route('/account', {
      guard: guards.authed<AppRequest>(),
      onUnauthenticated({ next }) {
        return { location: `/signin?continue=${encodeURIComponent(next)}`, status: 303 };
      },
      page: () => 'account',
      search: s.object({ tab: s.string() }),
    });
    const adminRoute = route('/admin', {
      guard: guards.role<AppRequest>('admin'),
      page: () => 'admin',
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
    await expect(
      renderRoutePageResponse(adminRoute, {}, { session: { user: { roles: ['staff'] } } }, String, {
        renderForbidden: () => '<main>Forbidden</main>',
      }),
    ).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });
    await expect(
      renderQueryEndpointResponse(accountQuery, {
        request: { session: null },
        search: new URLSearchParams([['id', 'u1']]),
      }),
    ).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2F_q%2Faccount%3Fid%3Du1' },
      status: 303,
    });
    await expect(
      renderQueryEndpointResponse(adminQuery, {
        renderForbidden: () => '<main>Query forbidden</main>',
        request: { session: { user: { roles: ['staff'] } } },
      }),
    ).resolves.toEqual({
      body: '<main>Query forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });
  });
});
