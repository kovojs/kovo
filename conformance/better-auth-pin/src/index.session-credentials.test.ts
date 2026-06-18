import { renderRoutePageResponse, route } from '@kovojs/server';
import { runMutation } from '@kovojs/server/internal/execution';
import { createKovoTestHarness } from '@kovojs/test/harness';
import { describe, expect, it } from 'vitest';

import {
  authed,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  role,
} from '@kovojs/better-auth';
import {
  betterAuthCredentialMutationTouchGraph,
  betterAuthDbVerificationConfig,
  createBetterAuthCredentialMutationTouchGraph,
  createBetterAuthDbVerificationConfig,
} from '@kovojs/better-auth/internal';

import {
  authTable,
  createAuthVerifierDb,
  createRealAuth,
  ObservedCredentialAuth,
  ObservedPluginCredentialAuth,
  password,
  requestHeaders,
  responseCookies,
  sessionCookie,
  expectObservedTables,
  type AppSession,
  type AuthVerifierDb,
  type AuthVerifierRequest,
  type ReferenceRequest,
  type ReferenceSession,
} from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('maps a real Better Auth session through the Kovo session provider seam', async () => {
    const { auth } = createRealAuth();
    const signUp = await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        password,
      },
      headers: requestHeaders(),
    });
    const provider = betterAuthSession(auth, (value): AppSession => {
      return {
        email: value.user.email,
        sessionId: value.session.id,
        userId: value.user.id,
      };
    });

    await expect(provider({ headers: requestHeaders(sessionCookie(signUp)) })).resolves.toEqual({
      email: 'ada@example.com',
      sessionId: expect.any(String),
      userId: expect.any(String),
    });
    await expect(provider({ headers: requestHeaders() })).resolves.toBe(null);
  });

  it('wraps real sign-up, sign-in, and sign-out auth.api responses as Kovo mutations', async () => {
    const { auth } = createRealAuth();
    const signUp = betterAuthSignUpEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/welcome',
    });
    const signIn = betterAuthSignInEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/account',
    });
    const signOut = betterAuthSignOutMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/login',
    });

    expect(signUp.registry?.touches?.map((item) => item.key)).toEqual(['user', 'auth']);
    expect(signIn.registry?.touches?.map((item) => item.key)).toEqual(['auth']);
    expect(signOut.registry?.touches?.map((item) => item.key)).toEqual(['auth']);

    const signUpResult = await runMutation(
      signUp,
      {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        password,
      },
      { headers: requestHeaders() },
    );

    expect(signUpResult).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [expect.stringContaining('better-auth.session_token=')],
      },
      value: {
        redirectTo: '/welcome',
        status: 'signed-up',
      },
    });

    const invalidSignIn = await runMutation(
      signIn,
      {
        email: 'grace@example.com',
        password: 'wrong',
      },
      { headers: requestHeaders() },
    );

    expect(invalidSignIn).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });

    const signInResult = await runMutation(
      signIn,
      {
        email: 'grace@example.com',
        password,
      },
      { headers: requestHeaders() },
    );

    expect(signInResult).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [expect.stringContaining('better-auth.session_token=')],
      },
      value: {
        redirectTo: '/account',
        status: 'signed-in',
      },
    });

    if (!signInResult.ok) throw new Error('expected sign-in to succeed');

    const signOutResult = await runMutation(
      signOut,
      {},
      { headers: requestHeaders(responseCookies(signInResult.responseHeaders?.['Set-Cookie'])) },
    );

    expect(signOutResult).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          expect.stringContaining('better-auth.session_token=;'),
          expect.stringContaining('better-auth.session_data=;'),
          expect.stringContaining('better-auth.dont_remember=;'),
        ],
      },
      value: {
        redirectTo: '/login',
        status: 'signed-out',
      },
    });
  });

  it('proves the starter/reference recipe can drive real Better Auth sessions through adapter route guards', async () => {
    const { auth } = createRealAuth();
    const sessionProvider = betterAuthSession(
      auth,
      ({ session, user }): ReferenceSession => ({
        id: session.id,
        user: {
          email: user.email,
          id: user.id,
          name: user.name ?? user.email,
          roles: user.email.startsWith('admin@') ? ['admin'] : ['member'],
        },
      }),
    );
    const signIn = betterAuthSignInEmailMutation<'auth/sign-in', ReferenceRequest>(auth, {
      csrf: false,
      defaultRedirectTo: '/account',
    });

    // SPEC.md §6.5/§10.3: route guards consume the typed session populated by
    // the request lifecycle, and anonymous vs unauthorized failures are distinct.
    const accountRoute = route('/account', {
      guard: authed<ReferenceRequest>(),
      page: (_context, request) => `account:${request.session.user.email}`,
    });
    const adminRoute = route('/admin', {
      guard: role<ReferenceRequest>('admin'),
      page: (_context, request) => `admin:${request.session?.user.email ?? 'missing'}`,
    });

    await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'member@example.com',
        name: 'Member User',
        password,
      },
      headers: requestHeaders(),
    });
    await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: 'admin@example.com',
        name: 'Admin User',
        password,
      },
      headers: requestHeaders(),
    });

    await expect(
      renderRoutePageResponse(accountRoute, {}, { headers: requestHeaders() }, String, {
        currentUrl: '/account',
        sessionProvider,
      }),
    ).resolves.toEqual({
      body: '',
      headers: { Location: '/login?next=%2Faccount' },
      status: 303,
    });

    const memberSignIn = await runMutation(
      signIn,
      {
        email: 'member@example.com',
        password,
      },
      { headers: requestHeaders() },
    );

    expect(memberSignIn).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [expect.stringContaining('better-auth.session_token=')],
      },
      value: {
        redirectTo: '/account',
        status: 'signed-in',
      },
    });
    if (!memberSignIn.ok) throw new Error('expected member sign-in to succeed');

    const memberRequest = {
      headers: requestHeaders(responseCookies(memberSignIn.responseHeaders?.['Set-Cookie'])),
    };

    await expect(
      renderRoutePageResponse(accountRoute, {}, memberRequest, String, { sessionProvider }),
    ).resolves.toEqual({
      body: 'account:member@example.com',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
    await expect(
      renderRoutePageResponse(adminRoute, {}, memberRequest, String, {
        renderForbidden: () => '<main>Forbidden</main>',
        sessionProvider,
      }),
    ).resolves.toEqual({
      body: '<main>Forbidden</main>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 403,
    });

    const adminSignIn = await runMutation(
      signIn,
      {
        email: 'admin@example.com',
        password,
      },
      { headers: requestHeaders() },
    );

    expect(adminSignIn).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [expect.stringContaining('better-auth.session_token=')],
      },
    });
    if (!adminSignIn.ok) throw new Error('expected admin sign-in to succeed');

    await expect(
      renderRoutePageResponse(
        adminRoute,
        {},
        { headers: requestHeaders(responseCookies(adminSignIn.responseHeaders?.['Set-Cookie'])) },
        String,
        { sessionProvider },
      ),
    ).resolves.toEqual({
      body: 'admin:admin@example.com',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });
  });

  it('pins declared table touches against real Better Auth memory-adapter writes', async () => {
    const { auth, db } = createRealAuth();

    await expectObservedTables('signUpEmail', db, async () => {
      await auth.api.signUpEmail({
        asResponse: true,
        body: {
          email: 'touches@example.com',
          name: 'Touch Bridge',
          password,
        },
        headers: requestHeaders(),
      });
    });

    await expectObservedTables('signInEmail', db, async () => {
      await auth.api.signInEmail({
        asResponse: true,
        body: {
          email: 'touches@example.com',
          password,
        },
        headers: requestHeaders(),
      });
    });

    const signIn = await auth.api.signInEmail({
      asResponse: true,
      body: {
        email: 'touches@example.com',
        password,
      },
      headers: requestHeaders(),
    });

    await expectObservedTables('signOut', db, async () => {
      await auth.api.signOut({
        asResponse: true,
        headers: requestHeaders(sessionCookie(signIn)),
      });
    });
  });

  it('verifies adapter credential wrappers through the P9 observed-write harness', async () => {
    const harness = createKovoTestHarness<AuthVerifierDb>({
      db: createAuthVerifierDb(),
      request: {
        headers: requestHeaders(),
      },
      touchGraph: betterAuthCredentialMutationTouchGraph,
      verification: betterAuthDbVerificationConfig,
    });
    const auth = new ObservedCredentialAuth(harness.db);
    const signUp = betterAuthSignUpEmailMutation<'auth/sign-up', AuthVerifierRequest>(auth, {
      csrf: false,
    });
    const signIn = betterAuthSignInEmailMutation<'auth/sign-in', AuthVerifierRequest>(auth, {
      csrf: false,
    });
    const signOut = betterAuthSignOutMutation<'auth/sign-out', AuthVerifierRequest>(auth, {
      csrf: false,
    });

    await expect(
      harness.exec(
        signUp,
        {
          email: 'verified@example.com',
          name: 'Verified User',
          password,
        },
        { touchGraphKey: 'auth/sign-up' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=verified-sign-up; Path=/; HttpOnly'],
      },
      value: {
        status: 'signed-up',
      },
    });
    await expect(
      harness.exec(
        signIn,
        {
          email: 'verified@example.com',
          password,
        },
        { touchGraphKey: 'auth/sign-in' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=verified-sign-in; Path=/; HttpOnly'],
      },
      value: {
        status: 'signed-in',
      },
    });
    await expect(
      harness.exec(signOut, {}, { touchGraphKey: 'auth/sign-out' }),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=; Path=/; Max-Age=0; HttpOnly'],
      },
      value: {
        status: 'signed-out',
      },
    });

    expect(harness.db.writes.map((write) => write.table)).toEqual([
      'user',
      'account',
      'session',
      'session',
      'session',
    ]);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });

  it('verifies explicit plugin-table bridge extensions through the P9 harness', async () => {
    const tables = {
      webauthnChallenge: authTable(['challenge', 'expiresAt'], 'auth_webauthn_challenges'),
      webauthnCredential: authTable(['credentialId', 'userId'], 'auth_webauthn_credentials'),
    };
    const schemaBridge = {
      webauthnChallenge: {
        exempt: true,
        rationale: 'Better Auth WebAuthn challenges are protocol state, not app query state.',
      },
      webauthnCredential: { domain: 'auth', key: 'userId' },
    } as const;
    const declaredTouches = {
      signInEmail: [
        { domain: 'auth', table: 'session' },
        { domain: 'auth', table: 'webauthnCredential' },
      ],
    } as const;
    type PluginVerifierDb = {
      writes: { table: string; value: unknown }[];
      write(table: string, value: unknown): void;
    };
    type PluginVerifierRequest = {
      db: PluginVerifierDb;
      headers: Headers;
    };
    const harness = createKovoTestHarness<PluginVerifierDb>({
      db: {
        writes: [],
        write(table, value) {
          this.writes.push({ table, value });
        },
      },
      request: {
        headers: requestHeaders(),
      },
      touchGraph: createBetterAuthCredentialMutationTouchGraph({
        apis: ['signInEmail'],
        credentialMutationDeclaredTableTouches: declaredTouches,
        keys: { signInEmail: 'auth/passkey-sign-in' },
      }),
      verification: createBetterAuthDbVerificationConfig(schemaBridge, tables),
    });
    const signIn = betterAuthSignInEmailMutation<'auth/passkey-sign-in', PluginVerifierRequest>(
      new ObservedPluginCredentialAuth(harness.db, 'auth_webauthn_credentials'),
      {
        csrf: false,
        key: 'auth/passkey-sign-in',
      },
    );

    await expect(
      harness.exec(
        signIn,
        {
          email: 'verified-passkey@example.com',
          password,
        },
        { touchGraphKey: 'auth/passkey-sign-in' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=verified-plugin-sign-in; Path=/; HttpOnly'],
      },
      value: {
        status: 'signed-in',
      },
    });
    expect(harness.db.writes.map((write) => write.table)).toEqual([
      'session',
      'auth_webauthn_credentials',
    ]);
    expect(harness.verificationDiagnostics()).toEqual([]);
  });
});
