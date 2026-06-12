import {
  endpointMatches,
  guards as serverGuards,
  runEndpoint,
  runMutation,
  type EndpointDeclaration,
  type Guard,
  type SessionProvider,
} from '@jiso/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  activeOrganization,
  annotateBetterAuthSchemaSource,
  authed,
  betterAuthAuthDomain,
  betterAuthCredentialMutationDefaultKeys,
  betterAuthCredentialMutationDeclaredTableTouches,
  betterAuthCredentialMutationTouchGraph,
  betterAuthCredentialMutationTouches,
  betterAuthDbVerificationConfig,
  createBetterAuthCredentialMutationTouchGraph,
  createBetterAuthDbVerificationConfig,
  betterAuthOAuthProviderSuccessorImportPaths,
  betterAuthOAuthProviderSuccessorMetadataDegradation,
  betterAuthPasskeyPluginMetadataImportPaths,
  betterAuthOrganizationDomain,
  betterAuthSsoPluginMetadataImportPaths,
  betterAuthSchemaBridge,
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  betterAuthSession,
  betterAuthTableDomain,
  betterAuthUnavailablePluginMetadataDegradation,
  generateBetterAuthSchemaSource,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  mount,
  role,
  validateBetterAuthSchemaBridge,
  type ActiveOrganizationRequest,
  type BetterAuthLike,
  type BetterAuthMountLike,
  type BetterAuthResponseLike,
  type BetterAuthTable,
} from './index.js';

type AuthSession = {
  activeOrganizationId: null | string;
  id: string;
};

type AuthUser = {
  email: string;
  id: string;
  roles: readonly ('admin' | 'member')[];
};

type AppSession = {
  activeOrganizationId: null | string;
  id: string;
  user: {
    email: string;
    id: string;
    roles: readonly ('admin' | 'member')[];
  };
};

type RequestWithHeaders = {
  headers: Headers;
};

type AppRequest = {
  session?: AppSession | null;
};

class FakeBetterAuth implements BetterAuthLike<AuthSession, AuthUser> {
  readonly api = {
    getSession: (options: { headers: Headers }) => {
      this.lastHeaders = options.headers;

      if (options.headers.get('cookie') !== 'jiso_session=s1') return null;

      return {
        session: {
          activeOrganizationId: 'org-1',
          id: 'session-1',
        },
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['admin', 'member'] as const,
        },
      };
    },
  };

  lastHeaders: Headers | undefined;
}

class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class FakeCredentialAuth {
  readonly api = {
    signInEmail: async (options: {
      asResponse: true;
      body: { email: string; password: string };
      headers: Headers;
    }): Promise<BetterAuthResponseLike> => {
      this.lastSignIn = options;

      if (options.body.email !== 'ada@example.com' || options.body.password !== 'correct') {
        throw new AuthApiError(401, 'Invalid credentials');
      }

      return responseWithCookies([
        'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
        'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
      ]);
    },
    signOut: async (options: { asResponse: true; headers: Headers }) => {
      this.lastSignOut = options;

      return responseWithCookies([
        'jiso_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        'jiso_session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      ]);
    },
    signUpEmail: async (options: {
      asResponse: true;
      body: { email: string; name: string; password: string };
      headers: Headers;
    }): Promise<BetterAuthResponseLike> => {
      this.lastSignUp = options;

      if (options.body.email === 'taken@example.com') {
        return responseWithCookies([], 400);
      }

      return responseWithCookies(['jiso_session=session-2; Path=/; HttpOnly; SameSite=Lax']);
    },
  };

  lastSignIn:
    | { asResponse: true; body: { email: string; password: string }; headers: Headers }
    | undefined;
  lastSignOut: { asResponse: true; headers: Headers } | undefined;
  lastSignUp:
    | {
        asResponse: true;
        body: { email: string; name: string; password: string };
        headers: Headers;
      }
    | undefined;
}

class FakeMountedAuth implements BetterAuthMountLike {
  lastRequest: Request | undefined;
  sawSession = false;

  readonly handler = async (request: Request): Promise<Response> => {
    this.lastRequest = request;
    this.sawSession = 'session' in request;

    return new Response(new URL(request.url).pathname, {
      headers: { location: '/login/complete' },
      status: 302,
    });
  };
}

function mapSession(value: { session: AuthSession; user: AuthUser }): AppSession {
  return {
    activeOrganizationId: value.session.activeOrganizationId,
    id: value.session.id,
    user: {
      email: value.user.email,
      id: value.user.id,
      roles: value.user.roles,
    },
  };
}

function requestHeaders(cookie?: string): Headers {
  const headers = new Headers({ 'user-agent': 'vitest' });

  if (cookie) headers.set('cookie', cookie);

  return headers;
}

function responseWithCookies(cookies: readonly string[], status = 204): BetterAuthResponseLike {
  const headers = new Headers();

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
}

function authTable(fields: readonly string[] = [], modelName?: string) {
  return {
    fields: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
    ...(modelName === undefined ? {} : { modelName }),
  };
}

describe('betterAuthSession', () => {
  it('maps a Better Auth-like session into the app session provider seam', async () => {
    const auth = new FakeBetterAuth();
    const headers = new Headers({ cookie: 'jiso_session=s1' });
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

describe('credential mutation helpers', () => {
  it('exposes schema bridge annotations and keeps declared touches domain-aligned', () => {
    expect(betterAuthSchemaBridge).toEqual({
      account: { domain: 'auth', key: 'userId' },
      deviceCode: {
        exempt: true,
        rationale:
          'Better Auth device-authorization codes are redirect/device-flow protocol state, not an app read surface under SPEC.md §10.1.',
      },
      invitation: { domain: 'organization', key: 'organizationId' },
      jwks: {
        exempt: true,
        rationale:
          'Better Auth JWT signing-key material is adapter bookkeeping; SPEC.md §10.1 forbids app queries from reading exempt tables.',
      },
      member: { domain: 'organization', key: 'organizationId' },
      oauthAccessToken: { domain: 'auth', key: 'userId' },
      oauthApplication: { domain: 'auth', key: 'userId' },
      oauthConsent: { domain: 'auth', key: 'userId' },
      organization: { domain: 'organization', key: 'id' },
      organizationRole: { domain: 'organization', key: 'organizationId' },
      rateLimit: {
        exempt: true,
        rationale:
          'Better Auth database-backed rate-limit counters are adapter enforcement state; SPEC.md §10.1 forbids app queries from reading exempt tables.',
      },
      session: { domain: 'auth', key: 'userId' },
      team: { domain: 'organization', key: 'organizationId' },
      teamMember: { domain: 'organization', key: 'teamId' },
      twoFactor: { domain: 'auth', key: 'userId' },
      user: { domain: 'user', key: 'id' },
      verification: {
        exempt: true,
        rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
      },
      walletAddress: { domain: 'auth', key: 'userId' },
    });
    expect(betterAuthOrganizationDomain.key).toBe('organization');
    expect(betterAuthTableDomain('user')).toBe('user');
    expect(betterAuthTableDomain('organization')).toBe('organization');
    expect(betterAuthTableDomain('verification')).toBe(null);
    expect(betterAuthCredentialMutationDefaultKeys).toEqual({
      signInEmail: 'auth/sign-in',
      signOut: 'auth/sign-out',
      signUpEmail: 'auth/sign-up',
    });
    expect(betterAuthCredentialMutationTouchGraph).toEqual({
      'auth/sign-in': {
        touches: [
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signInEmail',
            via: 'session',
          },
        ],
        unresolved: [],
      },
      'auth/sign-out': {
        touches: [
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signOut',
            via: 'session',
          },
        ],
        unresolved: [],
      },
      'auth/sign-up': {
        touches: [
          {
            domain: 'user',
            keys: null,
            site: '@jiso/better-auth:signUpEmail',
            via: 'user',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signUpEmail',
            via: 'account',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signUpEmail',
            via: 'session',
          },
        ],
        unresolved: [],
      },
    });
    expect(betterAuthDbVerificationConfig).toEqual({
      domainByTable: {
        account: 'auth',
        invitation: 'organization',
        member: 'organization',
        oauthAccessToken: 'auth',
        oauthApplication: 'auth',
        oauthConsent: 'auth',
        organization: 'organization',
        organizationRole: 'organization',
        session: 'auth',
        team: 'organization',
        teamMember: 'organization',
        twoFactor: 'auth',
        user: 'user',
        walletAddress: 'auth',
      },
      exemptTables: ['deviceCode', 'jwks', 'rateLimit', 'verification'],
      keyByTable: {
        account: 'userId',
        invitation: 'organizationId',
        member: 'organizationId',
        oauthAccessToken: 'userId',
        oauthApplication: 'userId',
        oauthConsent: 'userId',
        organization: 'id',
        organizationRole: 'organizationId',
        session: 'userId',
        team: 'organizationId',
        teamMember: 'teamId',
        twoFactor: 'userId',
        user: 'id',
        walletAddress: 'userId',
      },
    });
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        deviceCode: authTable([
          'clientId',
          'deviceCode',
          'expiresAt',
          'lastPolledAt',
          'pollingInterval',
          'scope',
          'status',
          'userCode',
          'userId',
        ]),
        invitation: authTable(['organizationId']),
        jwks: authTable(['privateKey', 'publicKey']),
        member: authTable(['organizationId']),
        oauthAccessToken: authTable(['userId']),
        oauthApplication: authTable(['userId']),
        oauthConsent: authTable(['userId']),
        organization: authTable(),
        organizationRole: authTable(['organizationId']),
        rateLimit: authTable(['count', 'key', 'lastRequest']),
        session: authTable(['userId']),
        team: authTable(['organizationId']),
        teamMember: authTable(['teamId']),
        twoFactor: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
        walletAddress: authTable(['userId']),
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });

    for (const [api, touches] of Object.entries(betterAuthCredentialMutationDeclaredTableTouches)) {
      const declaredDomains = new Set(touches.map((touch) => touch.domain));
      const registryDomains = betterAuthCredentialMutationTouches[
        api as keyof typeof betterAuthCredentialMutationTouches
      ].map((touch) => touch.key);

      expect([...declaredDomains].sort()).toEqual(registryDomains.sort());
      for (const touch of touches) {
        expect(betterAuthTableDomain(touch.table)).toBe(touch.domain);
      }
    }
  });

  it('reports Better Auth table metadata that is missing or outside the bridge', () => {
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        webauthnCredential: authTable(['credentialId', 'userId']),
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: ['verification'] satisfies BetterAuthTable[],
      ok: false,
      pluginTableDegradations: [
        {
          diagnosticCode: 'FW406',
          fields: ['credentialId', 'id', 'userId'],
          manualBridgeSteps: [
            'Inspect webauthnCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
            "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
            'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
          ],
          message:
            'webauthnCredential is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
          reason: 'unsupported-plugin-table',
          suggestedAnnotation: { domain: 'auth', key: 'userId' },
          table: 'webauthnCredential',
        },
      ],
      unbridgedTables: ['webauthnCredential'],
    });
  });

  it('suggests ownership annotations for unsupported plugin-table diagnostics', () => {
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        auditLog: authTable(['organizationId', 'actorUserId']),
        ephemeralChallenge: {},
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }).pluginTableDegradations,
    ).toEqual([
      {
        diagnosticCode: 'FW406',
        fields: ['actorUserId', 'id', 'organizationId'],
        manualBridgeSteps: [
          'Inspect auditLog fields (actorUserId, id, organizationId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'organization', key: 'organizationId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate auditLog; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'auditLog is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: { domain: 'organization', key: 'organizationId' },
        table: 'auditLog',
      },
      {
        diagnosticCode: 'FW406',
        fields: null,
        manualBridgeSteps: [
          'Inspect ephemeralChallenge fields (unavailable from Better Auth metadata) and decide whether the app reads this table.',
          'If it is app-visible, add a schema.ts jiso({ domain, key }) annotation; otherwise add jiso({ exempt: true }) with a rationale.',
          'Add declared Better Auth API touches for writes that can mutate ephemeralChallenge; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'ephemeralChallenge is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: null,
        table: 'ephemeralChallenge',
      },
    ]);
  });

  it('reports unsupported plugin-table physical aliases in FW406 diagnostics', () => {
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        passkeyCredential: authTable(['credentialId', 'userId'], 'auth_passkey_credentials'),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }).pluginTableDegradations,
    ).toEqual([
      {
        diagnosticCode: 'FW406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'Inspect passkeyCredential (physical auth_passkey_credentials) fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate passkeyCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'passkeyCredential (physical auth_passkey_credentials) is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        physicalTable: 'auth_passkey_credentials',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: { domain: 'auth', key: 'userId' },
        table: 'passkeyCredential',
      },
    ]);
  });

  it('reports absent successor OAuth-provider metadata as an FW406 degradation', () => {
    expect(betterAuthOAuthProviderSuccessorMetadataDegradation()).toEqual({
      attemptedImports: betterAuthOAuthProviderSuccessorImportPaths,
      diagnosticCode: 'FW406',
      legacyPlugin: 'oidcProvider',
      manualBridgeSteps: [
        'Install the Better Auth OAuth-provider successor package and inspect getAuthTables(auth.options) with that plugin enabled.',
        'If the successor reuses oauthApplication/oauthAccessToken/oauthConsent with userId ownership, keep the existing auth-domain bridge and pin the package metadata in conformance.',
        'If the successor adds or renames tables, add schema.ts jiso({ domain, key }) or jiso({ exempt: true }) annotations and declared Better Auth API touches before relying on runtime coverage.',
      ],
      message:
        '@better-auth/oauth-provider metadata is not available from the pinned Better Auth dependency set; successor OAuth-provider writes remain FW406 until a real metadata path is pinned.',
      packageName: '@better-auth/oauth-provider',
      reason: 'oauth-provider-successor-metadata-unavailable',
      schemaBridge: null,
      tableMetadata: null,
    });
  });

  it('reports unavailable plugin metadata without fabricating schema mappings', () => {
    expect(
      betterAuthUnavailablePluginMetadataDegradation({
        attemptedImports: betterAuthSsoPluginMetadataImportPaths,
        packageName: 'better-auth/plugins/sso',
        pluginName: 'sso',
      }),
    ).toEqual({
      attemptedImports: betterAuthSsoPluginMetadataImportPaths,
      diagnosticCode: 'FW406',
      manualBridgeSteps: [
        'Install a Better Auth sso plugin package/export and inspect getAuthTables(auth.options) with that plugin enabled.',
        'If the plugin exposes app-visible tables, add schema.ts jiso({ domain, key }) annotations and declared Better Auth API touches before relying on runtime coverage.',
        'If the plugin exposes only protocol/bookkeeping tables, add jiso({ exempt: true }) annotations with a SPEC.md §10.1 rationale and pin the metadata in conformance.',
      ],
      message:
        'better-auth/plugins/sso metadata is not available from the pinned Better Auth dependency set; sso writes remain FW406 until real table metadata is pinned.',
      packageName: 'better-auth/plugins/sso',
      pluginName: 'sso',
      reason: 'plugin-metadata-unavailable',
      schemaBridge: null,
      tableMetadata: null,
    });
    expect(
      betterAuthUnavailablePluginMetadataDegradation({
        attemptedImports: betterAuthPasskeyPluginMetadataImportPaths,
        packageName: 'better-auth/plugins/passkey',
        pluginName: 'passkey',
      }).schemaBridge,
    ).toBe(null);
  });

  it('reports bridged domain keys that drift from Better Auth table metadata', () => {
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable([]),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [
        'account.userId is a schema-bridge key but Better Auth table metadata does not expose that field',
      ],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
  });

  it('reports bridged domain-key drift with Better Auth modelName aliases', () => {
    expect(
      validateBetterAuthSchemaBridge({
        account: authTable(['userId']),
        oauthApplication: authTable([], 'auth_oauth_apps'),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [
        'oauthApplication.userId (physical auth_oauth_apps.userId) is a schema-bridge key but Better Auth table metadata does not expose that field',
      ],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
  });

  it('reports mutation registry touches that drift from declared table touches', () => {
    expect(
      validateBetterAuthSchemaBridge(
        {
          account: authTable(['userId']),
          session: authTable(['userId']),
          user: authTable(),
          verification: authTable(),
        },
        {
          credentialMutationTouches: {
            signUpEmail: [betterAuthAuthDomain],
          },
        },
      ),
    ).toEqual({
      declaredTouchMismatches: [
        'signUpEmail mutation registry domains [auth] do not match declared table-touch domains [auth, user]',
      ],
      keyFieldMismatches: [],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
  });

  it('reports declared plugin table touches when plugin metadata is absent', () => {
    expect(
      validateBetterAuthSchemaBridge(
        {
          account: authTable(['userId']),
          session: authTable(['userId']),
          user: authTable(),
          verification: authTable(),
        },
        {
          credentialMutationDeclaredTableTouches: {
            signInEmail: [
              { domain: 'auth', table: 'session' },
              { domain: 'auth', table: 'twoFactor' },
            ],
          },
        },
      ),
    ).toEqual({
      declaredTouchMismatches: [
        'signInEmail.twoFactor is declared touched but Better Auth table metadata is missing that table',
      ],
      keyFieldMismatches: [],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
  });

  it('reports declared plugin table touches that are outside the schema bridge', () => {
    expect(
      validateBetterAuthSchemaBridge(
        {
          account: authTable(['userId']),
          session: authTable(['userId']),
          user: authTable(),
          verification: authTable(),
          webauthnCredential: authTable(['credentialId', 'userId']),
        },
        {
          credentialMutationDeclaredTableTouches: {
            signInEmail: [
              { domain: 'auth', table: 'session' },
              { domain: 'auth', table: 'webauthnCredential' },
            ],
          },
        },
      ),
    ).toEqual({
      declaredTouchMismatches: [
        'signInEmail.webauthnCredential is declared touched but outside the Better Auth schema bridge',
      ],
      keyFieldMismatches: [],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [
        {
          diagnosticCode: 'FW406',
          fields: ['credentialId', 'id', 'userId'],
          manualBridgeSteps: [
            'Inspect webauthnCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
            "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
            'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
          ],
          message:
            'webauthnCredential is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
          reason: 'unsupported-plugin-table',
          suggestedAnnotation: { domain: 'auth', key: 'userId' },
          table: 'webauthnCredential',
        },
      ],
      unbridgedTables: ['webauthnCredential'],
    });
  });

  it('accepts explicit schema bridge extensions for unsupported plugin tables', () => {
    const tables = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
      webauthnCredential: authTable(['credentialId', 'userId']),
    };
    const schemaBridge = {
      webauthnCredential: { domain: 'auth', key: 'userId' },
    } as const;

    expect(
      validateBetterAuthSchemaBridge(tables, {
        credentialMutationDeclaredTableTouches: {
          signInEmail: [
            { domain: 'auth', table: 'session' },
            { domain: 'auth', table: 'webauthnCredential' },
          ],
        },
        schemaBridge,
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthTableDomain('webauthnCredential')).toBe(null);
    expect(betterAuthTableDomain('webauthnCredential', schemaBridge)).toBe('auth');
  });

  it('keeps recognized future plugin tables unbridged with FW406 degradation facts', () => {
    const tables = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
      futureCredential: authTable(['credentialId', 'userId']),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const futureCredential = pgTable('futureCredential', {});",
      ].join('\n'),
      tables,
    );

    expect(result.validation.ok).toBe(false);
    expect(result.validation.unbridgedTables).toEqual(['futureCredential']);
    expect(result.validation.pluginTableDegradations).toEqual([
      {
        diagnosticCode: 'FW406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'Inspect futureCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'futureCredential is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: { domain: 'auth', key: 'userId' },
        table: 'futureCredential',
      },
    ]);
    expect(result.annotatedTables).toEqual([]);
    expect(result.unrecognizedSourceTables).toEqual([]);
    expect(result.unsupportedSourceTables).toEqual([
      {
        callee: 'pgTable',
        diagnosticCode: 'FW406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'futureCredential appears in schema.ts through recognized Drizzle table factory pgTable; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.',
          'Inspect futureCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'futureCredential appears in schema.ts but is outside the blessed Better Auth schema bridge; the adapter did not synthesize a fabricated mapping.',
        reason: 'unsupported-plugin-table-source',
        sourceFactory: 'recognized-drizzle-table',
        suggestedAnnotation: { domain: 'auth', key: 'userId' },
        table: 'futureCredential',
      },
    ]);
    expect(result.source).toContain("pgTable('futureCredential', {})");
    expect(result.source).not.toContain('jiso(');
  });

  it('reports aliased future plugin source declarations without fabricating mappings', () => {
    const tables = {
      account: authTable(['userId']),
      futureCredential: authTable(['credentialId', 'userId'], 'auth_future_credentials'),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { table } from './schema-kit';",
        "export const futureCredential = table('auth_future_credentials', {});",
      ].join('\n'),
      tables,
    );

    // SPEC.md §11.2: unsupported Better Auth metadata is an FW406 fact until
    // schema.ts annotations and declared touches are explicit.
    expect(result.validation.ok).toBe(false);
    expect(result.validation.unbridgedTables).toEqual(['futureCredential']);
    expect(result.annotatedTables).toEqual([]);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.unrecognizedSourceTables).toEqual([]);
    expect(result.unsupportedSourceTables).toEqual([
      {
        callee: 'table',
        diagnosticCode: 'FW406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'futureCredential (physical auth_future_credentials) appears in schema.ts through unrecognized table factory table; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.',
          'Inspect futureCredential (physical auth_future_credentials) fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'futureCredential (physical auth_future_credentials) appears in schema.ts but is outside the blessed Better Auth schema bridge; the adapter did not synthesize a fabricated mapping.',
        physicalTable: 'auth_future_credentials',
        reason: 'unsupported-plugin-table-source',
        sourceFactory: 'unrecognized-table-factory',
        suggestedAnnotation: { domain: 'auth', key: 'userId' },
        table: 'futureCredential',
      },
    ]);
    expect(result.source).toBe(
      [
        "import { table } from './schema-kit';",
        "export const futureCredential = table('auth_future_credentials', {});",
      ].join('\n'),
    );
  });

  it('rejects schema bridge extensions that collide with blessed built-in tables', () => {
    const tables = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const schemaBridge = {
      user: {
        exempt: true,
        rationale: 'attempted downgrade',
      },
    } as const;

    expect(validateBetterAuthSchemaBridge(tables, { schemaBridge })).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [
        'user is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge',
      ],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthTableDomain('user', schemaBridge)).toBe('user');
    expect(createBetterAuthDbVerificationConfig(schemaBridge).domainByTable.user).toBe('user');

    const result = annotateBetterAuthSchemaSource(
      [
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const user = pgTable('user', {});",
      ].join('\n'),
      tables,
      { schemaBridge },
    );

    expect(result.validation.ok).toBe(false);
    expect(result.validation.keyFieldMismatches).toEqual([
      'user is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge',
    ]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
    );
  });

  it('materializes explicit plugin-table extensions into P9 verifier facts', () => {
    const tables = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
      webauthnCredential: authTable(['credentialId', 'userId']),
      webauthnChallenge: authTable(['challenge', 'expiresAt']),
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

    expect(
      validateBetterAuthSchemaBridge(tables, {
        credentialMutationDeclaredTableTouches: declaredTouches,
        schemaBridge,
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(
      createBetterAuthCredentialMutationTouchGraph({
        apis: ['signInEmail'],
        credentialMutationDeclaredTableTouches: declaredTouches,
        keys: { signInEmail: 'auth/passkey-sign-in' },
      }),
    ).toMatchObject({
      'auth/passkey-sign-in': {
        touches: [
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signInEmail',
            via: 'session',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@jiso/better-auth:signInEmail',
            via: 'webauthnCredential',
          },
        ],
        unresolved: [],
      },
    });
    expect(createBetterAuthDbVerificationConfig(schemaBridge)).toMatchObject({
      domainByTable: {
        account: 'auth',
        session: 'auth',
        user: 'user',
        webauthnCredential: 'auth',
      },
      exemptTables: expect.arrayContaining(['verification', 'webauthnChallenge']),
      keyByTable: {
        account: 'userId',
        session: 'userId',
        user: 'id',
        webauthnCredential: 'userId',
      },
    });
  });

  it('materializes explicit plugin-table extension aliases into schema and verifier facts', () => {
    const tables = {
      account: authTable(['userId']),
      passkeyCredential: authTable(['credentialId', 'userId'], 'auth_passkey_credentials'),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const schemaBridge = {
      passkeyCredential: { domain: 'auth', key: 'userId' },
    } as const;
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const authPasskeyCredentials = pgTable('auth_passkey_credentials', {",
        "  id: text('id').primaryKey(),",
        "  credentialId: text('credential_id').notNull(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
      ].join('\n'),
      tables,
      { schemaBridge },
    );

    // SPEC.md §10.1 / §11.2: extension bridges follow Better Auth modelName
    // aliases exactly like blessed built-in table mappings.
    expect(validateBetterAuthSchemaBridge(tables, { schemaBridge })).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['auth_passkey_credentials']);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const authPasskeyCredentials = pgTable('auth_passkey_credentials', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  credentialId: text('credential_id').notNull(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(createBetterAuthDbVerificationConfig(schemaBridge, tables)).toMatchObject({
      domainByTable: {
        account: 'auth',
        auth_passkey_credentials: 'auth',
        passkeyCredential: 'auth',
        session: 'auth',
        user: 'user',
      },
      keyByTable: {
        account: 'userId',
        auth_passkey_credentials: 'userId',
        passkeyCredential: 'userId',
        session: 'userId',
        user: 'id',
      },
    });
  });

  it('reports explicit plugin-table bridge declarations through unrecognized factories', () => {
    const tables = {
      account: authTable(['userId']),
      passkeyCredential: authTable(['credentialId', 'userId'], 'auth_passkey_credentials'),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const schemaBridge = {
      passkeyCredential: { domain: 'auth', key: 'userId' },
    } as const;
    const result = annotateBetterAuthSchemaSource(
      [
        "import { table } from './local-schema-kit';",
        "export const authPasskeyCredentials = table('auth_passkey_credentials', {});",
      ].join('\n'),
      tables,
      { schemaBridge },
    );

    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual([]);
    expect(result.missingSourceTables).toEqual([
      'account',
      'auth_passkey_credentials',
      'session',
      'user',
      'verification',
    ]);
    expect(result.unrecognizedSourceTables).toEqual([
      {
        callee: 'table',
        diagnosticCode: 'FW406',
        manualBridgeSteps: [
          'Import the Drizzle table factory that declares auth_passkey_credentials, or pass it through tableFactories when the factory is intentionally wrapped.',
          'Add the Better Auth jiso(...) annotation manually if table is not a Drizzle table factory.',
          'Keep observed writes FW406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
        ],
        message:
          'passkeyCredential (physical auth_passkey_credentials) appears in schema.ts through unrecognized table factory table; the Better Auth adapter did not synthesize a schema annotation.',
        physicalTable: 'auth_passkey_credentials',
        reason: 'unrecognized-schema-table-declaration',
        table: 'passkeyCredential',
      },
    ]);
    expect(result.source).toBe(
      [
        "import { table } from './local-schema-kit';",
        "export const authPasskeyCredentials = table('auth_passkey_credentials', {});",
      ].join('\n'),
    );
  });

  it('uses Better Auth modelName aliases for schema.ts and P9 verifier table facts', () => {
    const tables = {
      account: authTable(['userId'], 'auth_accounts'),
      invitation: authTable(['organizationId'], 'auth_invitations'),
      member: authTable(['organizationId'], 'auth_members'),
      organization: authTable([], 'auth_organizations'),
      session: authTable(['userId'], 'auth_sessions'),
      user: authTable([], 'auth_users'),
      verification: authTable([], 'auth_verifications'),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        '',
        "export const authUsers = pgTable('auth_users', {});",
        "export const authSessions = pgTable('auth_sessions', {});",
        "export const authAccounts = pgTable('auth_accounts', {});",
        "export const authVerifications = pgTable('auth_verifications', {});",
        "export const authOrganizations = pgTable('auth_organizations', {});",
        "export const authMembers = pgTable('auth_members', {});",
        "export const authInvitations = pgTable('auth_invitations', {});",
      ].join('\n'),
      tables,
    );

    // SPEC.md §10.1 / §11.2: Better Auth declared touches stay on logical
    // tables, while app schema and runtime SQL verification use modelName.
    expect(result.validation).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
      'auth_accounts',
      'auth_invitations',
      'auth_members',
      'auth_organizations',
      'auth_sessions',
      'auth_users',
      'auth_verifications',
    ]);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const authUsers = pgTable('auth_users', {}, jiso({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const authSessions = pgTable('auth_sessions', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const authOrganizations = pgTable('auth_organizations', {}, jiso({ domain: 'organization', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const authVerifications = pgTable('auth_verifications', {}, jiso({ exempt: true }));",
    );
    expect(createBetterAuthDbVerificationConfig({}, tables)).toEqual({
      domainByTable: expect.objectContaining({
        account: 'auth',
        auth_accounts: 'auth',
        auth_invitations: 'organization',
        auth_members: 'organization',
        auth_organizations: 'organization',
        auth_sessions: 'auth',
        auth_users: 'user',
        invitation: 'organization',
        member: 'organization',
        organization: 'organization',
        session: 'auth',
        user: 'user',
      }),
      exemptTables: expect.arrayContaining(['auth_verifications', 'verification']),
      keyByTable: expect.objectContaining({
        auth_accounts: 'userId',
        auth_invitations: 'organizationId',
        auth_members: 'organizationId',
        auth_organizations: 'id',
        auth_sessions: 'userId',
        auth_users: 'id',
      }),
    });

    const staleLogicalSource = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const user = pgTable('user', {});",
      ].join('\n'),
      { user: authTable([], 'auth_users') },
    );

    expect(staleLogicalSource.annotatedTables).toEqual([]);
    expect(staleLogicalSource.missingSourceTables).toEqual(['auth_users']);
  });

  it('rejects Better Auth modelName aliases that collide across logical tables', () => {
    const tables = {
      account: authTable(['userId']),
      session: authTable(['userId'], 'auth_session_state'),
      twoFactor: authTable(['userId'], 'auth_session_state'),
      user: authTable(),
      verification: authTable(),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const authSessionState = pgTable('auth_session_state', {});",
      ].join('\n'),
      tables,
    );
    const verifierConfig = createBetterAuthDbVerificationConfig({}, tables);

    // SPEC.md §10.1 / §11.2: physical table aliases feed both schema.ts
    // annotations and P9 verification, so one physical name cannot carry two
    // Better Auth logical tables.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [
        'Better Auth tables session, twoFactor resolve to the same physical table auth_session_state; modelName aliases must be unique for schema.ts annotations and P9 verification',
      ],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.validation.ok).toBe(false);
    expect(result.annotatedTables).toEqual([]);
    expect(result.source).toContain("pgTable('auth_session_state', {})");
    expect(verifierConfig.domainByTable).not.toHaveProperty('auth_session_state');
    expect(verifierConfig.keyByTable).not.toHaveProperty('auth_session_state');
  });

  it('materializes Jiso annotations into an app schema.ts source fixture', () => {
    const source = [
      "import { jiso } from '@jiso/drizzle';",
      "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
      '',
      "export const user = pgTable('user', {",
      "  id: text('id').primaryKey(),",
      "  email: text('email').notNull(),",
      '});',
      '',
      "export const session = pgTable('session', {",
      "  id: text('id').primaryKey(),",
      "  userId: text('user_id').notNull(),",
      "  expiresAt: timestamp('expires_at').notNull(),",
      '});',
      '',
      "export const account = pgTable('account', {",
      "  id: text('id').primaryKey(),",
      "  userId: text('user_id').notNull(),",
      '});',
      '',
      "export const verification = pgTable('verification', {",
      "  id: text('id').primaryKey(),",
      "  identifier: text('identifier').notNull(),",
      '});',
      '',
    ].join('\n');
    const result = annotateBetterAuthSchemaSource(source, {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    });

    expect(result.validation.ok).toBe(true);
    expect(result.importNote).toEqual({
      hasRequiredImport: true,
      insertedImport: false,
      localName: 'jiso',
      shouldAddRequiredImport: false,
      suggestedImport: "import { jiso } from '@jiso/drizzle';",
    });
    expect(result.requiredImport).toEqual({ module: '@jiso/drizzle', name: 'jiso' });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.alreadyAnnotatedTables).toEqual([]);
    expect(result.existingExtraConfigTables).toEqual([]);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  email: text('email').notNull(),\n" +
        "}, jiso({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "  expiresAt: timestamp('expires_at').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('materializes explicit plugin-table bridge extensions into app schema.ts source', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const webauthnCredential = pgTable('webauthnCredential', {",
        "  id: text('id').primaryKey(),",
        "  credentialId: text('credential_id').notNull(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
        webauthnCredential: authTable(['credentialId', 'userId']),
      },
      {
        schemaBridge: {
          webauthnCredential: { domain: 'auth', key: 'userId' },
        },
      },
    );

    expect(result.validation.ok).toBe(true);
    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['webauthnCredential']);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const webauthnCredential = pgTable('webauthnCredential', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  credentialId: text('credential_id').notNull(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('keeps token-only plugin metadata under the exempt verification bridge', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
        '',
        "export const account = pgTable('account', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
        "export const session = pgTable('session', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
        "export const user = pgTable('user', {",
        "  id: text('id').primaryKey(),",
        "  email: text('email').notNull(),",
        '});',
        '',
        "export const verification = pgTable('verification', {",
        "  id: text('id').primaryKey(),",
        "  identifier: text('identifier').notNull(),",
        "  value: text('value').notNull(),",
        "  expiresAt: timestamp('expires_at').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(['email']),
        verification: authTable(['expiresAt', 'identifier', 'value']),
      },
    );

    // SPEC.md §10.1: one-time verification tokens are Better Auth protocol
    // state and must stay write-side-only through the exempt verification table.
    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        "  value: text('value').notNull(),\n" +
        "  expiresAt: timestamp('expires_at').notNull(),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('materializes a bridged two-factor plugin table into an app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const twoFactor = pgTable('twoFactor', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        "  secret: text('secret').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        twoFactor: authTable(['userId', 'secret']),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['twoFactor']);
    expect(result.source).toContain(
      "export const twoFactor = pgTable('twoFactor', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "  secret: text('secret').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('materializes the device-authorization code table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
        '',
        "export const deviceCode = pgTable('deviceCode', {",
        "  id: text('id').primaryKey(),",
        "  deviceCode: text('device_code').notNull(),",
        "  userCode: text('user_code').notNull(),",
        "  userId: text('user_id'),",
        "  expiresAt: timestamp('expires_at').notNull(),",
        "  status: text('status').notNull(),",
        "  lastPolledAt: timestamp('last_polled_at'),",
        "  pollingInterval: integer('polling_interval'),",
        "  clientId: text('client_id'),",
        "  scope: text('scope'),",
        '});',
        '',
      ].join('\n'),
      {
        deviceCode: authTable([
          'clientId',
          'deviceCode',
          'expiresAt',
          'lastPolledAt',
          'pollingInterval',
          'scope',
          'status',
          'userCode',
          'userId',
        ]),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['deviceCode']);
    expect(result.source).toContain(
      "export const deviceCode = pgTable('deviceCode', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  deviceCode: text('device_code').notNull(),\n" +
        "  userCode: text('user_code').notNull(),\n" +
        "  userId: text('user_id'),\n" +
        "  expiresAt: timestamp('expires_at').notNull(),\n" +
        "  status: text('status').notNull(),\n" +
        "  lastPolledAt: timestamp('last_polled_at'),\n" +
        "  pollingInterval: integer('polling_interval'),\n" +
        "  clientId: text('client_id'),\n" +
        "  scope: text('scope'),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('materializes bridged OIDC provider plugin tables into app schema.ts source fixtures', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const oauthApplication = pgTable('oauthApplication', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
        "export const oauthAccessToken = pgTable('oauthAccessToken', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
        "export const oauthConsent = pgTable('oauthConsent', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        oauthAccessToken: authTable(['userId']),
        oauthApplication: authTable(['userId']),
        oauthConsent: authTable(['userId']),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
      'oauthAccessToken',
      'oauthApplication',
      'oauthConsent',
    ]);
    expect(result.source).toContain(
      "export const oauthApplication = pgTable('oauthApplication', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('materializes a bridged SIWE wallet table into an app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const walletAddress = pgTable('walletAddress', {",
        "  id: text('id').primaryKey(),",
        "  userId: text('user_id').notNull(),",
        "  address: text('address').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        walletAddress: authTable(['userId', 'address']),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['walletAddress']);
    expect(result.source).toContain(
      "export const walletAddress = pgTable('walletAddress', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "  address: text('address').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('keeps plugin-added user fields under the bridged user domain', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { boolean, pgTable, text } from 'drizzle-orm/pg-core';",
        '',
        "export const user = pgTable('user', {",
        "  id: text('id').primaryKey(),",
        "  email: text('email').notNull(),",
        "  username: text('username'),",
        "  displayUsername: text('display_username'),",
        "  isAnonymous: boolean('is_anonymous'),",
        "  lastLoginMethod: text('last_login_method'),",
        "  phoneNumber: text('phone_number'),",
        "  phoneNumberVerified: boolean('phone_number_verified'),",
        '});',
        '',
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable([
          'displayUsername',
          'email',
          'isAnonymous',
          'lastLoginMethod',
          'phoneNumber',
          'phoneNumberVerified',
          'username',
        ]),
        verification: authTable(),
      },
    );

    // SPEC.md §10.1: field extensions on an app-visible bridged table inherit
    // the table domain annotation; they are not unsupported plugin tables.
    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['user']);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'verification']);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  email: text('email').notNull(),\n" +
        "  username: text('username'),\n" +
        "  displayUsername: text('display_username'),\n" +
        "  isAnonymous: boolean('is_anonymous'),\n" +
        "  lastLoginMethod: text('last_login_method'),\n" +
        "  phoneNumber: text('phone_number'),\n" +
        "  phoneNumberVerified: boolean('phone_number_verified'),\n" +
        "}, jiso({ domain: 'user', key: 'id' }));",
    );
  });

  it('materializes the JWT signing-key table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
        '',
        "export const jwks = pgTable('jwks', {",
        "  id: text('id').primaryKey(),",
        "  publicKey: text('public_key').notNull(),",
        "  privateKey: text('private_key').notNull(),",
        "  expiresAt: timestamp('expires_at'),",
        '});',
        '',
      ].join('\n'),
      {
        jwks: authTable(['createdAt', 'expiresAt', 'privateKey', 'publicKey']),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['jwks']);
    expect(result.source).toContain(
      "export const jwks = pgTable('jwks', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  publicKey: text('public_key').notNull(),\n" +
        "  privateKey: text('private_key').notNull(),\n" +
        "  expiresAt: timestamp('expires_at'),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('materializes the database-backed rate-limit table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
        '',
        "export const rateLimit = pgTable('rateLimit', {",
        "  id: text('id').primaryKey(),",
        "  key: text('key').notNull(),",
        "  count: integer('count').notNull(),",
        "  lastRequest: timestamp('last_request').notNull(),",
        '});',
        '',
      ].join('\n'),
      {
        rateLimit: authTable(['count', 'key', 'lastRequest']),
      },
    );

    expect(result.validation).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual(['rateLimit']);
    expect(result.source).toContain(
      "export const rateLimit = pgTable('rateLimit', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  key: text('key').notNull(),\n" +
        "  count: integer('count').notNull(),\n" +
        "  lastRequest: timestamp('last_request').notNull(),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('reports schema.ts tables it cannot safely annotate', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        'const auditConfig = () => [];',
        "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
        "export const session = pgTable('session', {}, auditConfig);",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      },
    );

    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual(['account']);
    expect(result.alreadyAnnotatedTables).toEqual(['user']);
    expect(result.duplicateSourceTables).toEqual([]);
    expect(result.existingExtraConfigTables).toEqual(['session']);
    expect(result.missingSourceTables).toEqual(['verification']);
    expect(result.source).toContain(
      "export const account = pgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain("export const session = pgTable('session', {}, auditConfig);");
  });

  it('bounds schema.ts annotations to imported or explicit Drizzle table factories', () => {
    const metadata = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const source = [
      'const pgTable = makeLocalTableFactory();',
      "export const user = pgTable('user', {});",
    ].join('\n');
    const result = annotateBetterAuthSchemaSource(source, metadata);
    const explicit = annotateBetterAuthSchemaSource(source, metadata, {
      tableFactories: ['pgTable'],
    });

    // SPEC.md §10.1 / §11.2: generated schema annotations become P9 table
    // facts, so local helpers are surfaced instead of treated as Drizzle.
    expect(result.annotatedTables).toEqual([]);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.unrecognizedSourceTables).toEqual([
      {
        callee: 'pgTable',
        diagnosticCode: 'FW406',
        manualBridgeSteps: [
          'Import the Drizzle table factory that declares user, or pass it through tableFactories when the factory is intentionally wrapped.',
          'Add the Better Auth jiso(...) annotation manually if pgTable is not a Drizzle table factory.',
          'Keep observed writes FW406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
        ],
        message:
          'user appears in schema.ts through unrecognized table factory pgTable; the Better Auth adapter did not synthesize a schema annotation.',
        reason: 'unrecognized-schema-table-declaration',
        table: 'user',
      },
    ]);
    expect(result.source).toBe(source);
    expect(explicit.annotatedTables).toEqual(['user']);
    expect(explicit.unrecognizedSourceTables).toEqual([]);
    expect(explicit.source).toContain(
      "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
    );
  });

  it('does not report column builders as unrecognized schema table declarations', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable, text } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {",
        "  user: text('user'),",
        '});',
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      },
    );

    expect(result.annotatedTables).toEqual(['account']);
    expect(result.missingSourceTables).toEqual(['session', 'user', 'verification']);
    expect(result.unrecognizedSourceTables).toEqual([]);
  });

  it('reports duplicate schema.ts table declarations without annotating ambiguous tables', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        '',
        "export const primaryUser = pgTable('user', {});",
        "export const auditUser = pgTable('user', {});",
        "export const account = pgTable('account', {});",
        "export const product = pgTable('product', {});",
        "export const productArchive = pgTable('product', {});",
      ].join('\n'),
      {
        account: authTable(['userId']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      },
    );

    // SPEC.md §10.1 / §11.2: generated schema annotations feed P9 table
    // facts, so duplicate physical table declarations must stay manual.
    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual(['account']);
    expect(result.duplicateSourceTables).toEqual(['user']);
    expect(result.missingSourceTables).toEqual(['session', 'verification']);
    expect(result.source).toContain(
      "export const account = pgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain("export const primaryUser = pgTable('user', {});");
    expect(result.source).toContain("export const auditUser = pgTable('user', {});");
    expect(result.source).not.toContain(
      "export const primaryUser = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
    );
  });

  it('reports generated schema.ts import notes for default and aliased annotation callees', () => {
    const metadata = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      metadata,
    );

    expect(result.importNote).toEqual({
      hasRequiredImport: false,
      insertedImport: true,
      localName: 'jiso',
      shouldAddRequiredImport: false,
      suggestedImport: "import { jiso } from '@jiso/drizzle';",
    });
    expect(result.source).toBe(
      [
        "import { jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
      ].join('\n'),
    );

    const aliased = annotateBetterAuthSchemaSource(
      [
        "import { jiso as markJiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      metadata,
      { annotationCallee: 'markJiso' },
    );

    expect(aliased.importNote).toEqual({
      hasRequiredImport: true,
      insertedImport: false,
      localName: 'markJiso',
      shouldAddRequiredImport: false,
      suggestedImport: "import { jiso as markJiso } from '@jiso/drizzle';",
    });
    expect(aliased.source).toContain(
      "export const account = pgTable('account', {}, markJiso({ domain: 'auth', key: 'userId' }));",
    );

    const existingJisoModuleImport = annotateBetterAuthSchemaSource(
      [
        "import { domain } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      metadata,
    );

    expect(existingJisoModuleImport.importNote).toEqual({
      hasRequiredImport: false,
      insertedImport: true,
      localName: 'jiso',
      shouldAddRequiredImport: false,
      suggestedImport: "import { jiso } from '@jiso/drizzle';",
    });
    expect(existingJisoModuleImport.source).toBe(
      [
        "import { domain, jiso } from '@jiso/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
      ].join('\n'),
    );
  });

  it('infers aliased and namespace Drizzle table factories when annotating schema.ts', () => {
    const metadata = {
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
    };
    const result = annotateBetterAuthSchemaSource(
      [
        "import { pgTable as authPgTable } from 'drizzle-orm/pg-core';",
        "import * as sqlite from 'drizzle-orm/sqlite-core';",
        '',
        "export const user = authPgTable('user', {});",
        "export const session = sqlite.sqliteTable('session', {});",
        "export const account = authPgTable('account', {});",
        "export const verification = sqlite.sqliteTable('verification', {});",
      ].join('\n'),
      metadata,
    );

    // SPEC.md §14: generated app schema annotations must not miss Better
    // Auth tables just because Drizzle table factories were imported safely.
    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.importNote).toMatchObject({
      insertedImport: true,
      localName: 'jiso',
    });
    expect(result.source).toContain(
      "export const user = authPgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = sqlite.sqliteTable('session', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = sqlite.sqliteTable('verification', {}, jiso({ exempt: true }));",
    );
  });

  it('generates bounded app schema.ts declarations from Better Auth metadata', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: {
        fields: {
          expiresAt: { required: true, type: 'date' },
          token: { required: true, type: 'string' },
          userId: { fieldName: 'user_id', required: true, type: 'string' },
        },
      },
      user: {
        fields: {
          'profile-url': { fieldName: 'profile_url', type: 'string' },
          email: { required: true, type: 'string' },
          emailVerified: { required: true, type: 'boolean' },
          name: { required: true, type: 'string' },
        },
      },
      verification: {
        fields: {
          expiresAt: { required: true, type: 'date' },
          identifier: { required: true, type: 'string' },
          value: { required: true, type: 'string' },
        },
      },
    });

    // SPEC.md §10.1 / §11.2: generated schema.ts is bounded to real
    // Better Auth fields and explicit Jiso bridge annotations.
    expect(result.validation.ok).toBe(true);
    expect(result.generatedTables.map((table) => table.table)).toEqual([
      'account',
      'session',
      'user',
      'verification',
    ]);
    expect(result.skippedTables).toEqual([]);
    expect(result.requiredImports).toEqual([
      "import { jiso } from '@jiso/drizzle';",
      "import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    ]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  'profile-url': text('profile_url'),\n" +
        "  email: text('email').notNull(),\n" +
        "  emailVerified: boolean('emailVerified').notNull(),\n" +
        "  name: text('name').notNull(),\n" +
        "}, jiso({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  token: text('token').notNull(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        "  value: text('value').notNull(),\n" +
        '}, jiso({ exempt: true }));',
    );
  });

  it('keeps unsupported plugin tables out of generated schema.ts with FW406 facts', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: authTable(),
      verification: authTable(),
      webauthnCredential: authTable(['credentialId', 'userId']),
    });

    expect(result.validation.ok).toBe(false);
    expect(result.generatedTables.map((table) => table.table)).toEqual([
      'account',
      'session',
      'user',
      'verification',
    ]);
    expect(result.source).not.toContain('webauthnCredential');
    expect(result.unsupportedPluginTables).toEqual([
      {
        diagnosticCode: 'FW406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'Inspect webauthnCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is jiso({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use jiso({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes FW406 until declared coverage exists.',
        ],
        message:
          'webauthnCredential is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: { domain: 'auth', key: 'userId' },
        table: 'webauthnCredential',
      },
    ]);
  });

  it('degrades generated schema.ts tables when field metadata is unavailable', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: {},
      user: authTable(),
      verification: authTable(),
    });

    expect(result.generatedTables.map((table) => table.table)).toEqual([
      'account',
      'user',
      'verification',
    ]);
    expect(result.source).not.toContain('export const session');
    expect(result.skippedTables).toContainEqual({
      diagnosticCode: 'FW406',
      fields: null,
      manualBridgeSteps: [
        'Inspect Better Auth metadata for session and write the Drizzle declaration manually.',
        'Add the matching jiso({ domain, key }) or jiso({ exempt: true }) annotation once the table declaration is explicit.',
        'Keep observed writes FW406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
      ],
      message:
        'session cannot be generated because Better Auth table field metadata is unavailable.',
      reason: 'table-field-metadata-unavailable',
      table: 'session',
    });
  });

  it('degrades generated schema.ts tables with unsupported Better Auth field types', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: {
        fields: {
          metadata: { type: 'json' },
        },
      },
      verification: authTable(),
    });

    expect(result.source).not.toContain('export const user');
    expect(result.skippedTables).toContainEqual({
      diagnosticCode: 'FW406',
      field: 'metadata',
      fields: ['id', 'metadata'],
      manualBridgeSteps: [
        'Inspect Better Auth metadata for user and write the Drizzle declaration manually.',
        'Verify field metadata in Better Auth metadata before adding the matching Jiso annotation.',
        'Keep observed writes FW406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
      ],
      message:
        'user cannot be generated because field metadata has unsupported Better Auth type json.',
      reason: 'unsupported-field-type',
      table: 'user',
    });
  });

  it('wraps signInEmail as an ordinary mutation and forwards Better Auth cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders();
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      {
        email: 'ada@example.com',
        next: '/account',
        password: 'correct',
      },
      { headers },
    );

    expect(auth.lastSignIn).toEqual({
      asResponse: true,
      body: {
        email: 'ada@example.com',
        password: 'correct',
      },
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
          'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/account',
        status: 'signed-in',
      },
    });
  });

  it('maps invalid sign-in credentials to the declared mutation failure path', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, { csrf: false });

    const result = await runMutation(
      signIn,
      {
        email: 'ada@example.com',
        password: 'wrong',
      },
      { headers: requestHeaders() },
    );

    expect(result).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
  });

  it('wraps signUpEmail with a typed body and typed credential failure', async () => {
    const auth = new FakeCredentialAuth();
    const signUp = betterAuthSignUpEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/welcome',
    });
    const headers = requestHeaders();

    await expect(
      runMutation(
        signUp,
        {
          email: 'grace@example.com',
          name: 'Grace Hopper',
          password: 'correct',
        },
        { headers },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['jiso_session=session-2; Path=/; HttpOnly; SameSite=Lax'],
      },
      value: {
        redirectTo: '/welcome',
        status: 'signed-up',
      },
    });
    expect(auth.lastSignUp).toEqual({
      asResponse: true,
      body: {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        password: 'correct',
      },
      headers,
    });

    await expect(
      runMutation(
        signUp,
        {
          email: 'taken@example.com',
          name: 'Taken',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
  });

  it('wraps signOut and forwards clearing cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders('jiso_session=session-1');
    const signOut = betterAuthSignOutMutation(auth, { csrf: false });

    const result = await runMutation(signOut, {}, { headers });

    expect(auth.lastSignOut).toEqual({
      asResponse: true,
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          'jiso_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
          'jiso_session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/login',
        status: 'signed-out',
      },
    });
  });

  it('keeps redirect targets on same-origin paths', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, {
      csrf: false,
      defaultRedirectTo: '/dashboard',
    });

    await expect(
      runMutation(
        signIn,
        {
          email: 'ada@example.com',
          next: 'https://evil.example/account',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        redirectTo: '/dashboard',
      },
    });
  });

  it('exposes small helpers for Better Auth response quirks', () => {
    const headers = responseWithCookies([
      'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]).headers;

    expect(getBetterAuthSetCookie(headers)).toEqual([
      'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(403, 'Forbidden'))).toBe(true);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(500, 'Broken'))).toBe(false);
  });
});

describe('guard bindings', () => {
  it('keeps adapter guard failures aligned with the server guard contract', async () => {
    type ServerSessionRequest = {
      session?: {
        user?: {
          roles?: readonly string[];
        } | null;
      } | null;
    };

    const anonymous = { session: null } satisfies AppRequest;
    const memberOnly = {
      session: {
        activeOrganizationId: null,
        id: 'session-1',
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['member'],
        },
      },
    } satisfies AppRequest;

    // SPEC.md §6.5 and §10.3: @jiso/server does not export guard-failure constants, so this
    // package pins the adapter literals against the canonical server guards instead.
    expect(await role<AppRequest>('admin')(anonymous)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(anonymous),
    );
    expect(await role<AppRequest>('admin')(memberOnly)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(memberOnly),
    );
    expect(await activeOrganization<AppRequest>()(memberOnly)).toEqual(
      await serverGuards.role<ServerSessionRequest>('admin')(memberOnly),
    );
  });

  it('uses the core authed guard contract over the mapped session', async () => {
    const guard = authed<AppRequest>();

    expect(await guard({ session: null })).toEqual({
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await guard({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toBe(true);
  });

  it('binds role checks to typed session role names', async () => {
    const admin = role<AppRequest>('admin');
    const memberOnly: AppRequest = {
      session: {
        activeOrganizationId: null,
        id: 'session-1',
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['member'],
        },
      },
    };

    expect(await admin(memberOnly)).toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await admin({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['admin'],
          },
        },
      }),
    ).toBe(true);

    // @ts-expect-error Better Auth admin-plugin role changes make stale guards red.
    const staleGuard = role<AppRequest>('billing');
    expect(staleGuard).toBeTypeOf('function');
  });

  it('guards organization-scoped surfaces with activeOrganizationId', async () => {
    const scoped = activeOrganization<AppRequest>();
    const typedGuard: Guard<AppRequest, ActiveOrganizationRequest<AppRequest>> = scoped;

    expect(
      await typedGuard({
        session: {
          activeOrganizationId: null,
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
    expect(
      await typedGuard({
        session: {
          activeOrganizationId: 'org-1',
          id: 'session-1',
          user: {
            email: 'ada@example.com',
            id: 'user-1',
            roles: ['member'],
          },
        },
      }),
    ).toBe(true);
  });
});
