import {
  endpointMatches,
  renderRoutePageResponse,
  route,
  runEndpoint,
  runMutation,
} from '@jiso/server';
import { betterAuth, getAuthTables } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { admin, organization } from 'better-auth/plugins';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  authed,
  betterAuthCredentialMutationDeclaredTableTouches,
  betterAuthCredentialMutationTouches,
  betterAuthSchemaBridge,
  betterAuthSession,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  mount,
  role,
  validateBetterAuthSchemaBridge,
  type BetterAuthLike,
  type BetterAuthCoreTable,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
  type BetterAuthSignUpEmailLike,
  type BetterAuthTable,
} from '../../../packages/better-auth/src/index.js';

type AuthDatabase = Record<BetterAuthCoreTable, Record<string, unknown>[]>;

interface AppSession {
  email: string;
  sessionId: string;
  userId: string;
}

interface ReferenceSession {
  id: string;
  user: {
    email: string;
    id: string;
    name: string;
    roles: readonly ('admin' | 'member')[];
  };
}

interface ReferenceRequest {
  headers: Headers;
  session?: ReferenceSession | null;
}

const authSecret = '0123456789abcdef0123456789abcdef';
const baseURL = 'https://example.test/api/auth';
const password = 'correct horse battery staple';

describe('Better Auth pinned conformance', () => {
  it('pins the real better-auth server API shape consumed by the adapter', () => {
    const { auth } = createRealAuth();

    expect(typeof auth.api.getSession).toBe('function');
    expect(typeof auth.api.signInEmail).toBe('function');
    expect(typeof auth.api.signOut).toBe('function');
    expect(typeof auth.api.signUpEmail).toBe('function');
    expect(typeof auth.handler).toBe('function');

    expectTypeOf(auth).toMatchTypeOf<BetterAuthLike<unknown, unknown>>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignInEmailLike>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignOutLike>();
    expectTypeOf(auth).toMatchTypeOf<BetterAuthSignUpEmailLike>();
  });

  it('pins Better Auth table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth();
    const tables = getAuthTables(auth.options);
    const userTable = requireAuthTable(tables, 'user');
    const sessionTable = requireAuthTable(tables, 'session');
    const accountTable = requireAuthTable(tables, 'account');
    const verificationTable = requireAuthTable(tables, 'verification');

    expect(
      Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.order])),
    ).toEqual({
      account: 3,
      session: 2,
      user: 1,
      verification: 4,
    });
    expect(Object.keys(userTable.fields).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'image',
      'name',
      'updatedAt',
    ]);
    expect(Object.keys(sessionTable.fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'ipAddress',
      'token',
      'updatedAt',
      'userAgent',
      'userId',
    ]);
    expect(Object.keys(accountTable.fields).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'accountId',
      'createdAt',
      'idToken',
      'password',
      'providerId',
      'refreshToken',
      'refreshTokenExpiresAt',
      'scope',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(verificationTable.fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'identifier',
      'updatedAt',
      'value',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.user).toEqual({ domain: 'user', key: 'id' });
    expect(betterAuthSchemaBridge.verification).toEqual({
      exempt: true,
      rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
    });
  });

  it('pins blessed plugin table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [
        admin(),
        organization({
          dynamicAccessControl: { enabled: true },
          teams: { enabled: true },
        }),
      ],
    });
    const tables = getAuthTables(auth.options);

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'invitation',
      'member',
      'organization',
      'organizationRole',
      'session',
      'team',
      'teamMember',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'user').fields).sort()).toEqual([
      'banExpires',
      'banReason',
      'banned',
      'createdAt',
      'email',
      'emailVerified',
      'image',
      'name',
      'role',
      'updatedAt',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'session').fields).sort()).toEqual([
      'activeOrganizationId',
      'activeTeamId',
      'createdAt',
      'expiresAt',
      'impersonatedBy',
      'ipAddress',
      'token',
      'updatedAt',
      'userAgent',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'organization').fields).sort()).toEqual([
      'createdAt',
      'logo',
      'metadata',
      'name',
      'slug',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'member').fields).sort()).toEqual([
      'createdAt',
      'organizationId',
      'role',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'invitation').fields).sort()).toEqual([
      'createdAt',
      'email',
      'expiresAt',
      'inviterId',
      'organizationId',
      'role',
      'status',
      'teamId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'team').fields).sort()).toEqual([
      'createdAt',
      'name',
      'organizationId',
      'updatedAt',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'teamMember').fields).sort()).toEqual([
      'createdAt',
      'teamId',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'organizationRole').fields).sort()).toEqual([
      'createdAt',
      'organizationId',
      'permission',
      'role',
      'updatedAt',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.organization).toEqual({ domain: 'organization', key: 'id' });
    expect(betterAuthSchemaBridge.member).toEqual({
      domain: 'organization',
      key: 'organizationId',
    });
    expect(betterAuthSchemaBridge.teamMember).toEqual({
      domain: 'organization',
      key: 'teamId',
    });
  });

  it('maps a real Better Auth session through the Jiso session provider seam', async () => {
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

  it('wraps real sign-up, sign-in, and sign-out auth.api responses as Jiso mutations', async () => {
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

  it('mounts the real Better Auth handler as an audit-visible prefix endpoint', async () => {
    const { auth } = createRealAuth();
    const authEndpoint = mount('/api/auth', auth);

    expect(authEndpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });
    expect(authEndpoint.csrf).toEqual({
      exempt: true,
      justification: 'better-auth browser redirect protocol handler',
    });
    expect(
      endpointMatches(authEndpoint, { method: 'GET', pathname: '/api/auth/get-session' }),
    ).toBe(true);
    expect(
      endpointMatches(authEndpoint, { method: 'POST', pathname: '/api/auth/sign-in/email' }),
    ).toBe(true);
    expect(
      endpointMatches(authEndpoint, { method: 'GET', pathname: '/api/authish/get-session' }),
    ).toBe(false);

    const response = await runEndpoint(
      authEndpoint,
      new Request('https://example.test/api/auth/get-session', { headers: requestHeaders() }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('null');
  });
});

function createRealAuth(options: { plugins?: Parameters<typeof betterAuth>[0]['plugins'] } = {}) {
  const db: AuthDatabase = {
    account: [],
    session: [],
    user: [],
    verification: [],
  };
  const auth = betterAuth({
    advanced: {
      disableCSRFCheck: true,
    },
    baseURL,
    database: memoryAdapter(db),
    emailAndPassword: {
      enabled: true,
    },
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    secret: authSecret,
  });

  return { auth, db };
}

function requestHeaders(cookie?: string): Headers {
  const headers = new Headers({
    origin: 'https://example.test',
    'user-agent': 'vitest',
  });

  if (cookie) headers.set('cookie', cookie);

  return headers;
}

function responseCookies(cookies: string[] | string | undefined): string {
  const values = typeof cookies === 'string' ? [cookies] : (cookies ?? []);

  return values.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

function sessionCookie(response: { headers: Headers }): string {
  return responseCookies(response.headers.getSetCookie());
}

async function expectObservedTables(
  api: keyof typeof betterAuthCredentialMutationDeclaredTableTouches,
  db: AuthDatabase,
  run: () => Promise<void>,
): Promise<void> {
  const before = snapshotTables(db);

  await run();

  const observed = changedTables(before, snapshotTables(db));
  const declaredTables: Set<BetterAuthTable> = new Set(
    betterAuthCredentialMutationDeclaredTableTouches[api].map((touch) => touch.table),
  );

  expect(observed.filter((table) => !declaredTables.has(table))).toEqual([]);
  expect(
    [
      ...new Set(
        betterAuthCredentialMutationDeclaredTableTouches[api].map((touch) => touch.domain),
      ),
    ].sort(),
  ).toEqual(betterAuthCredentialMutationTouches[api].map((domain) => domain.key).sort());
}

function snapshotTables(db: AuthDatabase): Record<BetterAuthCoreTable, string> {
  return {
    account: stableRows(db.account),
    session: stableRows(db.session),
    user: stableRows(db.user),
    verification: stableRows(db.verification),
  };
}

function changedTables(
  before: Record<BetterAuthCoreTable, string>,
  after: Record<BetterAuthCoreTable, string>,
): BetterAuthCoreTable[] {
  return (Object.keys(before) as BetterAuthCoreTable[]).filter(
    (table) => before[table] !== after[table],
  );
}

function stableRows(rows: readonly Record<string, unknown>[]): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => key !== 'id' && key !== 'token' && key !== 'password')
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
  );
}

function requireAuthTable(
  tables: ReturnType<typeof getAuthTables>,
  table: BetterAuthTable,
): NonNullable<ReturnType<typeof getAuthTables>[BetterAuthTable]> {
  const value = tables[table];

  if (!value) throw new Error(`better-auth table metadata missing: ${table}`);

  return value;
}
