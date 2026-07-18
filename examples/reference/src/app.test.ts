import { describe, expect, it } from 'vitest';
import { runMutation } from '@kovojs/server/internal/execution';
import { renderRoutePageResponse } from '@kovojs/server/internal/route';

import {
  accountRoute,
  adminRoute,
  createReferenceAuth,
  referenceAuth,
  referenceAuthCsrf,
  referenceAuthRequest,
  referenceAuthToken,
  referenceSessionProvider,
  referenceSignIn,
  renderReferenceLoginForm,
  renderReferenceLogoutForm,
  type ReferenceAuthBindings,
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
  const boundRequest = { ...request, db: auth.db };
  const result = await runMutation(auth.signIn, input, boundRequest, {
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
  const boundRequest = { ...request, db: auth.db };
  const result = await runMutation(
    auth.signOut,
    { csrf: referenceAuthToken(boundRequest, auth.signOut) },
    boundRequest,
    {
      sessionProvider: auth.sessionProvider,
    },
  );

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

function sessionValue<T>(value: T | { value: T } | null): T | null {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
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

  it('maps fixture cookies into the declared reference session', async () => {
    const request = referenceAuthRequest();
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request, referenceSignIn),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const cookie = cookiePair(headerValues(signIn.headers, 'Set-Cookie')[0] ?? '');
    const token = cookie.split('=', 2)[1] ?? '';

    const session = sessionValue(await referenceSessionProvider(referenceAuthRequest(cookie)));
    expect(session).toEqual({
      id: expect.any(String),
      user: {
        email: 'ada@example.com',
        id: 'u1',
        name: 'Ada Lovelace',
        roles: ['admin', 'member'],
      },
    });
    expect(session?.id).not.toBe(token);
  });

  it('uses only the exact __Host session cookie on HTTPS', async () => {
    const httpsUrl = 'https://localhost/account';
    const request = referenceAuthRequest(undefined, httpsUrl);
    const signIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(request, referenceSignIn),
        email: 'ada@example.com',
        password: 'correct',
      },
      request,
    );
    const setCookie = headerValues(signIn.headers, 'Set-Cookie')[0] ?? '';
    expect(setCookie).toMatch(
      /^__Host-kovo_reference_session=[0-9a-f-]+; Max-Age=3600; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
    );
    const httpsLoopbackPair = cookiePair(setCookie);
    const token = httpsLoopbackPair.split('=', 2)[1] ?? '';

    await expect(
      referenceSessionProvider(referenceAuthRequest(`kovo_reference_session=${token}`, httpsUrl)),
    ).resolves.toBeNull();
    const session = sessionValue(
      await referenceSessionProvider(referenceAuthRequest(httpsLoopbackPair, httpsUrl)),
    );
    expect(session).toEqual({
      id: expect.any(String),
      user: {
        email: 'ada@example.com',
        id: 'u1',
        name: 'Ada Lovelace',
        roles: ['admin', 'member'],
      },
    });
    expect(session?.id).not.toBe(token);
  });

  it('rejects every non-loopback origin before the auth mutation can emit a cookie', async () => {
    const auth = createReferenceAuth();
    const request = referenceAuthRequest(undefined, 'http://reference.test/login');

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request, auth.signIn),
          email: 'ada@example.com',
          password: 'correct',
        },
        request,
        auth,
      ),
    ).rejects.toThrow('requires an exact loopback request URL');

    const remoteHttps = referenceAuthRequest(undefined, 'https://reference.test/login');
    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(remoteHttps, auth.signIn),
          email: 'ada@example.com',
          password: 'correct',
        },
        remoteHttps,
        auth,
      ),
    ).rejects.toThrow('requires an exact loopback request URL');
  });

  it('refuses the local fixture in production even when deployment secrets are configured', async () => {
    const previousMode = process.env.NODE_ENV;
    const previousSecret = process.env.KOVO_REFERENCE_AUTH_CSRF_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.KOVO_REFERENCE_AUTH_CSRF_SECRET = 'configured-production-secret';
    try {
      const auth = createReferenceAuth();
      const request = referenceAuthRequest(undefined, undefined, auth.db);
      await expect(
        submitReferenceSignInNoJs(
          {
            csrf: referenceAuthToken(request, auth.signIn),
            email: 'ada@example.com',
            password: 'correct',
          },
          request,
          auth,
        ),
      ).rejects.toThrow('explicit local-only development capability');
    } finally {
      restoreEnv('NODE_ENV', previousMode);
      restoreEnv('KOVO_REFERENCE_AUTH_CSRF_SECRET', previousSecret);
    }
  });

  it('requires an operator-chosen development password instead of the fixed test credential', async () => {
    const previousMode = process.env.NODE_ENV;
    const previousCapability = process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE;
    const previousPassword = process.env.KOVO_LOCAL_AUTH_FIXTURE_PASSWORD;
    process.env.NODE_ENV = 'development';
    process.env.KOVO_ENABLE_LOCAL_AUTH_FIXTURE = 'I_UNDERSTAND_THIS_IS_LOCAL_ONLY';
    process.env.KOVO_LOCAL_AUTH_FIXTURE_PASSWORD = 'unique-local-password-123';
    try {
      const auth = createReferenceAuth();
      const fixedRequest = referenceAuthRequest(undefined, undefined, auth.db);
      await expect(
        submitReferenceSignInNoJs(
          {
            csrf: referenceAuthToken(fixedRequest, auth.signIn),
            email: 'ada@example.com',
            password: 'correct',
          },
          fixedRequest,
          auth,
        ),
      ).resolves.toMatchObject({ status: 422 });

      const chosenRequest = referenceAuthRequest(undefined, undefined, auth.db);
      await expect(
        submitReferenceSignInNoJs(
          {
            csrf: referenceAuthToken(chosenRequest, auth.signIn),
            email: 'ada@example.com',
            password: 'unique-local-password-123',
          },
          chosenRequest,
          auth,
        ),
      ).resolves.toMatchObject({ status: 303 });
    } finally {
      restoreEnv('NODE_ENV', previousMode);
      restoreEnv('KOVO_ENABLE_LOCAL_AUTH_FIXTURE', previousCapability);
      restoreEnv('KOVO_LOCAL_AUTH_FIXTURE_PASSWORD', previousPassword);
    }
  });

  it('falls back from hostile post-login redirect values', async () => {
    for (const next of ['https://evil.test', '//evil.test', '/\\evil.test']) {
      const auth = createReferenceAuth();
      const request = referenceAuthRequest(undefined, undefined, auth.db);
      await expect(
        submitReferenceSignInNoJs(
          {
            csrf: referenceAuthToken(request, auth.signIn),
            email: 'ada@example.com',
            next,
            password: 'correct',
          },
          request,
          auth,
        ),
      ).resolves.toMatchObject({ headers: { Location: '/account' }, status: 303 });
    }

    const auth = createReferenceAuth();
    const request = referenceAuthRequest(undefined, undefined, auth.db);
    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request, auth.signIn),
          email: 'ada@example.com',
          next: '/account\nInjected',
          password: 'correct',
        },
        request,
        auth,
      ),
    ).resolves.toMatchObject({ status: 422 });
  });

  it('runs sign-in failures and successes through the blessed adapter mutation', async () => {
    const request = referenceAuthRequest();

    await expect(
      submitReferenceSignInNoJs(
        {
          csrf: referenceAuthToken(request, referenceSignIn),
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
          csrf: referenceAuthToken(request, referenceSignIn),
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
        'Set-Cookie': [
          expect.stringMatching(
            /^kovo_reference_session=[0-9a-f-]+; Max-Age=3600; Path=\/; HttpOnly; SameSite=Lax$/u,
          ),
        ],
      },
      status: 303,
    });
  });

  it('renders authed and role guards through the reference app flow', async () => {
    await expect(renderReferenceAccountRoute(referenceAuthRequest())).resolves.toMatchObject({
      body: '',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        Location: '/login?next=%2Faccount',
        Vary: 'Cookie',
      }),
      status: 303,
    });

    const memberRequest = referenceAuthRequest();
    const memberSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(memberRequest, referenceSignIn),
        email: 'grace@example.com',
        password: 'correct',
      },
      memberRequest,
    );
    const memberCookie = cookiePair(headerValues(memberSignIn.headers, 'Set-Cookie')[0] ?? '');

    await expect(
      renderReferenceAdminRoute(referenceAuthRequest(memberCookie)),
    ).resolves.toMatchObject({
      body: '<main>Forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      status: 403,
    });

    const adminRequest = referenceAuthRequest();
    const adminSignIn = await submitReferenceSignInNoJs(
      {
        csrf: referenceAuthToken(adminRequest, referenceSignIn),
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
        csrf: referenceAuthToken(request, referenceSignIn),
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
        'Set-Cookie': ['kovo_reference_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
