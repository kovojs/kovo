import { describe, expect, it } from 'vitest';
import {
  type BetterAuthTable,
  annotateBetterAuthSchemaSource,
  betterAuthAuthDomain,
  betterAuthCredentialMutationDeclaredTableTouches,
  betterAuthCredentialMutationDefaultKeys,
  betterAuthCredentialMutationTouchGraph,
  betterAuthCredentialMutationTouches,
  betterAuthDbVerificationConfig,
  betterAuthOAuthProviderSuccessorImportPaths,
  betterAuthOAuthProviderSuccessorMetadataDegradation,
  betterAuthOrganizationDomain,
  betterAuthPasskeyPluginMetadataImportPaths,
  betterAuthSchemaBridge,
  betterAuthSsoPluginMetadataImportPaths,
  betterAuthTableDomain,
  betterAuthUnavailablePluginMetadataDegradation,
  createBetterAuthCredentialMutationTouchGraph,
  createBetterAuthDbVerificationConfig,
  validateBetterAuthSchemaBridge,
} from './internal.js';
import { authTable } from './test-fakes.js';

describe('schema bridge', () => {
  it('exposes schema bridge annotations and keeps declared touches domain-aligned', () => {
    expect(betterAuthSchemaBridge).toEqual({
      // bugz-3 M6 (SPEC.md §10.1): the credential/token columns of `account`/`session` are
      // classified `secret:` so KV435 brands any projection that reaches them.
      account: {
        domain: 'auth',
        key: 'userId',
        secret: ['password', 'accessToken', 'refreshToken', 'idToken'],
      },
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
      session: { domain: 'auth', key: 'userId', secret: ['token'] },
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
            site: '@kovojs/better-auth:signInEmail',
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
            site: '@kovojs/better-auth:signOut',
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
            site: '@kovojs/better-auth:signUpEmail',
            via: 'user',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@kovojs/better-auth:signUpEmail',
            via: 'account',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@kovojs/better-auth:signUpEmail',
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
          diagnosticCode: 'KV406',
          fields: ['credentialId', 'id', 'userId'],
          manualBridgeSteps: [
            'Inspect webauthnCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
            "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
            'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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
        webauthnChallenge: authTable(['challenge', 'expiresAt']),
        session: authTable(['userId']),
        user: authTable(),
        verification: authTable(),
      }).pluginTableDegradations,
    ).toEqual([
      {
        diagnosticCode: 'KV406',
        fields: ['actorUserId', 'id', 'organizationId'],
        manualBridgeSteps: [
          'Inspect auditLog fields (actorUserId, id, organizationId) and decide whether the app reads this table.',
          "Likely app-visible ownership is kovo({ domain: 'organization', key: 'organizationId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate auditLog; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
        ],
        message:
          'auditLog is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: { domain: 'organization', key: 'organizationId' },
        table: 'auditLog',
      },
      {
        diagnosticCode: 'KV406',
        fields: null,
        manualBridgeSteps: [
          'Inspect ephemeralChallenge fields (unavailable from Better Auth metadata) and decide whether the app reads this table.',
          'If it is app-visible, add a schema.ts kovo({ domain, key }) annotation; otherwise add kovo({ exempt: true }) with a rationale.',
          'Add declared Better Auth API touches for writes that can mutate ephemeralChallenge; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
        ],
        message:
          'ephemeralChallenge is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: null,
        table: 'ephemeralChallenge',
      },
      {
        diagnosticCode: 'KV406',
        fields: ['challenge', 'expiresAt', 'id'],
        manualBridgeSteps: [
          'Inspect webauthnChallenge fields (challenge, expiresAt, id) and decide whether the app reads this table.',
          'Likely Better Auth protocol/bookkeeping state is kovo({ exempt: true }); confirm the app never queries it before adding the bridge.',
          'Add declared Better Auth API touches for writes that can mutate webauthnChallenge; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
        ],
        message:
          'webauthnChallenge is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
        reason: 'unsupported-plugin-table',
        suggestedAnnotation: {
          exempt: true,
          rationale:
            'Better Auth plugin protocol/bookkeeping state is not an app read surface under SPEC.md §10.1.',
        },
        table: 'webauthnChallenge',
      },
    ]);
  });

  it('reports unsupported plugin-table physical aliases in KV406 diagnostics', () => {
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
        diagnosticCode: 'KV406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'Inspect passkeyCredential (physical auth_passkey_credentials) fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate passkeyCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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

  it('reports absent successor OAuth-provider metadata as an KV406 degradation', () => {
    expect(betterAuthOAuthProviderSuccessorMetadataDegradation()).toEqual({
      attemptedImports: betterAuthOAuthProviderSuccessorImportPaths,
      diagnosticCode: 'KV406',
      legacyPlugin: 'oidcProvider',
      manualBridgeSteps: [
        'Install the Better Auth OAuth-provider successor package and inspect getAuthTables(auth.options) with that plugin enabled.',
        'If the successor reuses oauthApplication/oauthAccessToken/oauthConsent with userId ownership, keep the existing auth-domain bridge and pin the package metadata in conformance.',
        'If the successor adds or renames tables, add schema.ts kovo({ domain, key }) or kovo({ exempt: true }) annotations and declared Better Auth API touches before relying on runtime coverage.',
      ],
      message:
        '@better-auth/oauth-provider metadata is not available from the pinned Better Auth dependency set; successor OAuth-provider writes remain KV406 until a real metadata path is pinned.',
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
      diagnosticCode: 'KV406',
      manualBridgeSteps: [
        'Install a Better Auth sso plugin package/export and inspect getAuthTables(auth.options) with that plugin enabled.',
        'If the plugin exposes app-visible tables, add schema.ts kovo({ domain, key }) annotations and declared Better Auth API touches before relying on runtime coverage.',
        'If the plugin exposes only protocol/bookkeeping tables, add kovo({ exempt: true }) annotations with a SPEC.md §10.1 rationale and pin the metadata in conformance.',
      ],
      message:
        'better-auth/plugins/sso metadata is not available from the pinned Better Auth dependency set; sso writes remain KV406 until real table metadata is pinned.',
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
          diagnosticCode: 'KV406',
          fields: ['credentialId', 'id', 'userId'],
          manualBridgeSteps: [
            'Inspect webauthnCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
            "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
            'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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

  it('keeps recognized future plugin tables unbridged with KV406 degradation facts', () => {
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
        diagnosticCode: 'KV406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'Inspect futureCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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
        diagnosticCode: 'KV406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'futureCredential appears in schema.ts through recognized Drizzle table factory pgTable; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.',
          'Inspect futureCredential fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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
    expect(result.source).not.toContain('kovo(');
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

    // SPEC.md §11.2: unsupported Better Auth metadata is an KV406 fact until
    // schema.ts annotations and declared touches are explicit.
    expect(result.validation.ok).toBe(false);
    expect(result.validation.unbridgedTables).toEqual(['futureCredential']);
    expect(result.annotatedTables).toEqual([]);
    expect(result.missingSourceTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.unrecognizedSourceTables).toEqual([]);
    expect(result.unsupportedSourceTables).toEqual([
      {
        callee: 'table',
        diagnosticCode: 'KV406',
        fields: ['credentialId', 'id', 'userId'],
        manualBridgeSteps: [
          'futureCredential (physical auth_future_credentials) appears in schema.ts through unrecognized table factory table; the Better Auth adapter left it unannotated because it is outside the blessed schema bridge.',
          'Inspect futureCredential (physical auth_future_credentials) fields (credentialId, id, userId) and decide whether the app reads this table.',
          "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
          'Add declared Better Auth API touches for writes that can mutate futureCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
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
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
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
            site: '@kovojs/better-auth:signInEmail',
            via: 'session',
          },
          {
            domain: 'auth',
            keys: null,
            site: '@kovojs/better-auth:signInEmail',
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
        diagnosticCode: 'KV406',
        manualBridgeSteps: [
          'Import the Drizzle table factory that declares auth_passkey_credentials, or pass it through tableFactories when the factory is intentionally wrapped.',
          'Add the Better Auth kovo(...) annotation manually if table is not a Drizzle table factory.',
          'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
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
        "import { kovo } from '@kovojs/drizzle';",
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
      "export const authUsers = pgTable('auth_users', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const authSessions = pgTable('auth_sessions', {}, kovo({ domain: 'auth', key: 'userId', secret: ['token'] }));",
    );
    expect(result.source).toContain(
      "export const authOrganizations = pgTable('auth_organizations', {}, kovo({ domain: 'organization', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const authVerifications = pgTable('auth_verifications', {}, kovo({ exempt: true }));",
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
        "import { kovo } from '@kovojs/drizzle';",
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
        "import { kovo } from '@kovojs/drizzle';",
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
});
