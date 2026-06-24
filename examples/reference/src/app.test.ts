import { describe, expect, it } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { runMutation } from '@kovojs/server/internal/execution';
import { renderRoutePageResponse } from '@kovojs/server/internal/route';

import { kovoCheck, kovoExplain } from '../../../packages/cli/src/index.js';
import {
  accountRoute,
  adminRoute,
  createReferenceAuth,
  referenceAuth,
  referenceAuthCsrf,
  referenceGraph,
  referenceAuthRequest,
  referenceAuthToken,
  referenceSessionProvider,
  renderReferenceLoginForm,
  renderReferenceLogoutForm,
  type ReferenceAuthBindings,
  type ReferenceBetterAuth,
  type ReferenceRequest,
} from './app.js';

function headerValues(headers: Record<string, string | string[]>, name: string): string[] {
  const values = headers[name];
  if (!values) return [];

  return Array.isArray(values) ? values : [values];
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
}

async function submitReferenceSignInNoJs(
  input: { csrf: string; email: string; next?: string; password: string },
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  const result = await runMutation(auth.signIn, input, request, {
    csrf: referenceAuthCsrf,
  });

  if (!result.ok) {
    const formOptions: { failure?: 'INVALID_CREDENTIALS'; next?: string } = {};
    if (result.error.code === 'INVALID_CREDENTIALS') {
      formOptions.failure = 'INVALID_CREDENTIALS';
    }
    if (typeof input.next === 'string') {
      formOptions.next = input.next;
    }

    return {
      body: renderReferenceLoginForm(request, formOptions),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: result.status,
    };
  }

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: result.value.redirectTo,
      ...result.responseHeaders,
    },
    status: 303,
  };
}

async function submitReferenceSignOutNoJs(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  const result = await runMutation(auth.signOut, { csrf: referenceAuthToken(request) }, request, {
    sessionProvider: auth.sessionProvider,
  });

  if (!result.ok) {
    return {
      body: 'Unauthorized',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: result.status,
    };
  }

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: result.value.redirectTo,
      ...result.responseHeaders,
    },
    status: 303,
  };
}

function renderReferenceAccountRoute(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  return renderRoutePageResponse(accountRoute, {}, request, (value) => `<main>${value}</main>`, {
    onUnauthenticated({ next }) {
      return { location: `/login?next=${encodeURIComponent(next)}`, status: 303 };
    },
    sessionProvider: auth.sessionProvider,
  });
}

function renderReferenceAdminRoute(
  request: ReferenceRequest,
  auth: ReferenceAuthBindings = referenceAuth,
) {
  return renderRoutePageResponse(adminRoute, {}, request, (value) => `<main>${value}</main>`, {
    onUnauthenticated({ next }) {
      return { location: `/login?next=${encodeURIComponent(next)}`, status: 303 };
    },
    renderForbidden: () => '<main>Forbidden</main>',
    sessionProvider: auth.sessionProvider,
  });
}

describe('reference auth adoption', () => {
  it('represents authenticated reference flows in the graph audits', () => {
    expect(kovoCheck(referenceGraph)).toEqual({
      exitCode: 0,
      output: 'kovo-check/v1\nOK\n',
    });
    expect(kovoExplain(referenceGraph, { kind: 'page', target: '/account' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'PAGE /account',
        'prefetch: false',
        'modulepreloads: -',
        'stylesheets: -',
        'queries: -',
        'view-transitions: -',
        '',
      ].join('\n'),
    });
    expect(kovoExplain(referenceGraph, { kind: 'mutation', target: 'auth/sign-out' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION auth/sign-out',
        'guards: authed',
        'session: referenceSession',
        'input-fields: -',
        'writes: auth',
        'invalidates: auth',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(kovoExplain(referenceGraph, { kind: 'mutation', target: 'auth/sign-in' })).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'MUTATION auth/sign-in',
        'guards: -',
        'auth: custom:better-auth-credential',
        'session: referenceSession',
        'input-fields: email,password,next',
        'writes: auth',
        'invalidates: auth',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(kovoExplain(referenceGraph, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'kovo-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
    expect(kovoExplain(referenceGraph, { unscoped: true })).toEqual({
      exitCode: 0,
      output: 'kovo-explain/v1\nUNSCOPED\nSUMMARY total=0\n',
    });
  });

  it('ships no-JS login and logout forms backed by Kovo credential mutations', () => {
    const request = referenceAuthRequest();

    expect(renderReferenceLoginForm(request, { next: '/admin' })).toContain(
      'data-mutation="auth/sign-in"',
    );
    expect(
      renderReferenceLogoutForm({
        ...request,
        session: {
          id: 'session-u1',
          user: { email: 'ada@example.com', id: 'u1', name: 'Ada Lovelace', roles: ['admin'] },
        },
      }),
    ).toContain('data-mutation="auth/sign-out"');
  });

  it('maps Better Auth cookies into the declared reference session', async () => {
    const request = referenceAuthRequest();
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const cookie = cookiePair(headerValues(signIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(referenceSessionProvider(referenceAuthRequest(cookie))).resolves.toEqual({
      id: 'session-u1',
      user: {
        email: 'ada@example.com',
        id: 'u1',
        name: 'Ada Lovelace',
        roles: ['admin', 'member'],
      },
    });
  });

  it('runs sign-in failures and successes through the blessed adapter mutation', async () => {
    const request = referenceAuthRequest();

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request),
          email: 'ada@example.com',
          next: '/admin',
          password: 'wrong',
        },
        request,
      ),
    ).resolves.toMatchObject({
      body: expect.stringContaining('data-error-code="INVALID_CREDENTIALS"'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    });

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request),
          email: 'ada@example.com',
          next: '/admin',
          password: 'correct',
        },
        request,
      ),
    ).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/admin',
        'Set-Cookie': ['kovo_reference_session=session-u1; Path=/; HttpOnly; Secure; SameSite=Lax'],
      },
      status: 303,
    });
  });

  it('renders authed and role guards through the reference app flow', async () => {
    await expect(renderReferenceAccountRoute(referenceAuthRequest())).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Faccount' },
      status: 303,
    });

    const memberRequest = referenceAuthRequest();
    const memberSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(memberRequest),
        email: 'grace@example.com',
        password: 'correct',
      },
      memberRequest,
    );
    const memberCookie = cookiePair(headerValues(memberSignIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(renderReferenceAdminRoute(referenceAuthRequest(memberCookie))).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminRequest = referenceAuthRequest();
    const adminSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(adminRequest),
        email: 'ada@example.com',
        password: 'correct',
      },
      adminRequest,
    );
    const adminCookie = cookiePair(headerValues(adminSignIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(renderReferenceAdminRoute(referenceAuthRequest(adminCookie))).resolves.toEqual({
      body: expect.stringContaining('admin:u1<form method="post" action="/_m/auth/sign-out"'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('clears the reference auth cookie through guarded sign-out', async () => {
    const request = referenceAuthRequest();
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const cookie = cookiePair(headerValues(signIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(submitReferenceSignOutNoJs(referenceAuthRequest(cookie))).resolves.toMatchObject({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': [
          'kovo_reference_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
        ],
      },
      status: 303,
    });
  });

  it('drives the reference app bindings with real pinned Better Auth', async () => {
    const realAuth = createRealReferenceAuth();
    const auth = createReferenceAuth(realAuth as unknown as ReferenceBetterAuth);

    await realAuth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'member@example.com',
        name: 'Member User',
        password: 'correct horse battery staple',
      },
      headers: referenceAuthRequest().headers,
    });
    await realAuth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'admin@example.com',
        name: 'Admin User',
        password: 'correct horse battery staple',
      },
      headers: referenceAuthRequest().headers,
    });

    const anonymous = referenceAuthRequest();
    await expect(renderReferenceAccountRoute(anonymous, auth)).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Faccount' },
      status: 303,
    });

    const memberRequest = referenceAuthRequest();
    const memberSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(memberRequest),
        email: 'member@example.com',
        password: 'correct horse battery staple',
      },
      memberRequest,
      auth,
    );
    const memberCookie = responseCookies(headerValues(memberSignIn.headers, 'Set-Cookie'));

    await expect(
      renderReferenceAccountRoute(referenceAuthRequest(memberCookie), auth),
    ).resolves.toEqual({
      body: expect.stringContaining('account:member@example.com'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
    await expect(
      renderReferenceAdminRoute(referenceAuthRequest(memberCookie), auth),
    ).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminRequest = referenceAuthRequest();
    const adminSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(adminRequest),
        email: 'admin@example.com',
        next: '/admin',
        password: 'correct horse battery staple',
      },
      adminRequest,
      auth,
    );
    const adminCookie = responseCookies(headerValues(adminSignIn.headers, 'Set-Cookie'));

    await expect(
      renderReferenceAdminRoute(referenceAuthRequest(adminCookie), auth),
    ).resolves.toEqual({
      body: expect.stringContaining('admin:'),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
    await expect(
      submitReferenceSignOutNoJs(referenceAuthRequest(adminCookie), auth),
    ).resolves.toMatchObject({
      headers: {
        Location: '/login',
        'Set-Cookie': [
          expect.stringContaining('better-auth.session_token=;'),
          expect.stringContaining('better-auth.session_data=;'),
          expect.stringContaining('better-auth.dont_remember=;'),
        ],
      },
      status: 303,
    });
  });
});

function createRealReferenceAuth() {
  const auth = betterAuth({
    advanced: {
      disableCSRFCheck: true,
    },
    baseURL: 'https://reference.test/api/auth',
    database: memoryAdapter({
      account: [],
      session: [],
      user: [],
      verification: [],
    }),
    emailAndPassword: {
      enabled: true,
    },
    secret: '0123456789abcdef0123456789abcdef',
  });

  return auth;
}

function responseCookies(cookies: readonly string[]): string {
  return cookies.map(cookiePair).join('; ');
}
