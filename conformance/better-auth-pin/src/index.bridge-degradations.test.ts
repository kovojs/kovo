import { betterAuth, getAuthTables } from 'better-auth';
import {
  auth0,
  bearer,
  captcha,
  customSession,
  emailOTP,
  genericOAuth,
  gumroad,
  haveIBeenPwned,
  hubspot,
  jwt,
  keycloak,
  lastLoginMethod,
  line,
  magicLink,
  microsoftEntraId,
  multiSession,
  oauthPopup,
  oAuthProxy,
  okta,
  oneTap,
  oneTimeToken,
  openAPI,
  patreon,
  slack,
  testUtils,
} from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

import {
  annotateBetterAuthSchemaSource,
  betterAuthOAuthProviderSuccessorImportPaths,
  betterAuthOAuthProviderSuccessorMetadataDegradation,
  betterAuthPasskeyPluginMetadataImportPaths,
  betterAuthSchemaBridge,
  betterAuthSsoPluginMetadataImportPaths,
  betterAuthUnavailablePluginMetadataDegradation,
  validateBetterAuthSchemaBridge,
} from '../../../packages/better-auth/src/index.js';

import {
  betterAuthSchemaSourceFixture,
  createRealAuth,
  importResultMessage,
  requireAuthTable,
} from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('pins OAuth-provider successor metadata absence as an KV406 bridge degradation', async () => {
    const dynamicImport = (specifier: string): Promise<unknown> => import(specifier);
    const importResults = await Promise.allSettled(
      betterAuthOAuthProviderSuccessorImportPaths.map(dynamicImport),
    );

    expect(importResults.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    const [packageImport, packageSubpathImport, pluginSubpathImport] = importResults;

    if (!packageImport || !packageSubpathImport || !pluginSubpathImport) {
      throw new Error('expected three OAuth-provider successor import results');
    }

    expect(importResultMessage(packageImport)).toContain(
      "Cannot find package '@better-auth/oauth-provider'",
    );
    expect(importResultMessage(packageSubpathImport)).toContain(
      '"./oauth-provider" is not exported',
    );
    expect(importResultMessage(pluginSubpathImport)).toContain(
      '"./plugins/oauth-provider" is not exported',
    );
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

  it('pins SSO and passkey metadata absence as KV406 bridge degradations', async () => {
    const dynamicImport = (specifier: string): Promise<unknown> => import(specifier);
    const unavailablePluginCases = [
      {
        expectedMessages: [
          '"./plugins/sso" is not exported',
          '"./sso" is not exported',
          "Cannot find package '@better-auth/sso'",
        ],
        imports: betterAuthSsoPluginMetadataImportPaths,
        packageName: 'better-auth/plugins/sso',
        pluginName: 'sso',
      },
      {
        expectedMessages: [
          '"./plugins/passkey" is not exported',
          '"./passkey" is not exported',
          "Cannot find package '@better-auth/passkey'",
        ],
        imports: betterAuthPasskeyPluginMetadataImportPaths,
        packageName: 'better-auth/plugins/passkey',
        pluginName: 'passkey',
      },
    ] as const;

    for (const pluginCase of unavailablePluginCases) {
      const importResults = await Promise.allSettled(pluginCase.imports.map(dynamicImport));

      expect(
        importResults.map((result) => result.status),
        pluginCase.pluginName,
      ).toEqual(['rejected', 'rejected', 'rejected']);
      expect(
        importResults.map((result) => importResultMessage(result)),
        pluginCase.pluginName,
      ).toEqual(pluginCase.expectedMessages.map((message) => expect.stringContaining(message)));
      expect(
        betterAuthUnavailablePluginMetadataDegradation({
          attemptedImports: pluginCase.imports,
          packageName: pluginCase.packageName,
          pluginName: pluginCase.pluginName,
        }),
        pluginCase.pluginName,
      ).toEqual({
        attemptedImports: pluginCase.imports,
        diagnosticCode: 'KV406',
        manualBridgeSteps: [
          `Install a Better Auth ${pluginCase.pluginName} plugin package/export and inspect getAuthTables(auth.options) with that plugin enabled.`,
          'If the plugin exposes app-visible tables, add schema.ts kovo({ domain, key }) annotations and declared Better Auth API touches before relying on runtime coverage.',
          'If the plugin exposes only protocol/bookkeeping tables, add kovo({ exempt: true }) annotations with a SPEC.md §10.1 rationale and pin the metadata in conformance.',
        ],
        message: `${pluginCase.packageName} metadata is not available from the pinned Better Auth dependency set; ${pluginCase.pluginName} writes remain KV406 until real table metadata is pinned.`,
        packageName: pluginCase.packageName,
        pluginName: pluginCase.pluginName,
        reason: 'plugin-metadata-unavailable',
        schemaBridge: null,
        tableMetadata: null,
      });
    }
  });

  it('pins JWT plugin signing-key metadata as an exempt schema bridge table', () => {
    const { auth } = createRealAuth({
      plugins: [jwt()],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'jwks',
      'session',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'jwks').fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'privateKey',
      'publicKey',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.jwks).toEqual({
      exempt: true,
      rationale:
        'Better Auth JWT signing-key material is adapter bookkeeping; SPEC.md §10.1 forbids app queries from reading exempt tables.',
    });
    expect(result.annotatedTables).toEqual(['account', 'jwks', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const jwks = pgTable('jwks', {}, kovo({ exempt: true }));",
    );
  });

  it('pins database-backed rate-limit metadata as an exempt schema bridge table', () => {
    const { auth } = createRealAuth({
      rateLimit: {
        enabled: true,
        storage: 'database',
      },
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'rateLimit',
      'session',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'rateLimit').fields).sort()).toEqual([
      'count',
      'key',
      'lastRequest',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.rateLimit).toEqual({
      exempt: true,
      rationale:
        'Better Auth database-backed rate-limit counters are adapter enforcement state; SPEC.md §10.1 forbids app queries from reading exempt tables.',
    });
    expect(result.annotatedTables).toEqual([
      'account',
      'rateLimit',
      'session',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const rateLimit = pgTable('rateLimit', {}, kovo({ exempt: true }));",
    );
  });

  it('pins email-OTP metadata as covered by the core verification bridge', () => {
    const { auth } = createRealAuth({
      plugins: [emailOTP({ sendVerificationOTP: async () => {} })],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
    expect(Object.keys(requireAuthTable(tables, 'verification').fields).sort()).toEqual([
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
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.verification).toEqual({
      exempt: true,
      rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
    });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {}, kovo({ exempt: true }));",
    );
  });

  it('pins magic-link metadata as covered by the core verification bridge', () => {
    const { auth } = createRealAuth({
      plugins: [magicLink({ sendMagicLink: async () => {} })],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
    expect(Object.keys(requireAuthTable(tables, 'verification').fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'identifier',
      'updatedAt',
      'value',
    ]);
    // SPEC.md §10.1: magic-link verification tokens are Better Auth-owned
    // protocol state, not an app query surface.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.verification).toEqual({
      exempt: true,
      rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
    });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {}, kovo({ exempt: true }));",
    );
  });

  it('pins one-time-token metadata as covered by the core verification bridge', () => {
    const { auth } = createRealAuth({
      plugins: [oneTimeToken()],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
    expect(Object.keys(requireAuthTable(tables, 'verification').fields).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'identifier',
      'updatedAt',
      'value',
    ]);
    // SPEC.md §10.1: one-time-token rows are verification protocol state,
    // not app query surfaces.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.verification).toEqual({
      exempt: true,
      rationale: 'Better Auth email/token verification bookkeeping is not an app read surface.',
    });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {}, kovo({ exempt: true }));",
    );
  });

  it('pins generic OAuth provider metadata as covered by the core account bridge', () => {
    const { auth } = createRealAuth({
      plugins: [
        genericOAuth({
          config: [
            {
              authorizationUrl: 'https://oauth.example.test/authorize',
              clientId: 'custom-client',
              clientSecret: 'custom-secret',
              providerId: 'custom',
              scopes: ['openid', 'email'],
              tokenUrl: 'https://oauth.example.test/token',
              userInfoUrl: 'https://oauth.example.test/userinfo',
            },
            auth0({
              clientId: 'auth0-client',
              clientSecret: 'auth0-secret',
              domain: 'auth0.example.test',
            }),
            keycloak({
              clientId: 'keycloak-client',
              clientSecret: 'keycloak-secret',
              issuer: 'https://keycloak.example.test/realms/kovo',
            }),
            okta({
              clientId: 'okta-client',
              clientSecret: 'okta-secret',
              issuer: 'https://okta.example.test/oauth2/default',
            }),
            slack({
              clientId: 'slack-client',
              clientSecret: 'slack-secret',
            }),
            gumroad({
              clientId: 'gumroad-client',
              clientSecret: 'gumroad-secret',
            }),
            hubspot({
              clientId: 'hubspot-client',
              clientSecret: 'hubspot-secret',
            }),
            line({
              clientId: 'line-client',
              clientSecret: 'line-secret',
            }),
            microsoftEntraId({
              clientId: 'microsoft-client',
              clientSecret: 'microsoft-secret',
              tenantId: 'common',
            }),
            patreon({
              clientId: 'patreon-client',
              clientSecret: 'patreon-secret',
            }),
          ],
        }),
      ],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
    expect(Object.keys(requireAuthTable(tables, 'account').fields).sort()).toEqual([
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
    // SPEC.md §10.1: OAuth provider account rows, including exported provider
    // config helpers, stay app-owned auth-domain state through account.userId.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.account).toEqual({ domain: 'auth', key: 'userId' });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins remaining tableless plugin metadata as covered by the core bridge', () => {
    const pluginCases: {
      name: string;
      plugins: NonNullable<Parameters<typeof betterAuth>[0]['plugins']>;
    }[] = [
      { name: 'bearer', plugins: [bearer()] },
      {
        name: 'captcha',
        plugins: [captcha({ provider: 'google-recaptcha', secretKey: 'captcha-secret' })],
      },
      {
        name: 'customSession',
        plugins: [
          customSession(async ({ session, user }) => ({
            session,
            user,
          })),
        ],
      },
      { name: 'haveIBeenPwned', plugins: [haveIBeenPwned()] },
      { name: 'lastLoginMethod', plugins: [lastLoginMethod()] },
      { name: 'multiSession', plugins: [multiSession()] },
      { name: 'oauthPopup', plugins: [oauthPopup()] },
      { name: 'oAuthProxy', plugins: [oAuthProxy()] },
      { name: 'oneTap', plugins: [oneTap({ clientId: 'google-client' })] },
      { name: 'openAPI', plugins: [openAPI()] },
      {
        name: 'testUtils',
        plugins: [
          testUtils() as unknown as NonNullable<
            Parameters<typeof betterAuth>[0]['plugins']
          >[number],
        ],
      },
    ];

    for (const pluginCase of pluginCases) {
      const { auth } = createRealAuth({ plugins: pluginCase.plugins });
      const tables = getAuthTables(auth.options);
      const result = annotateBetterAuthSchemaSource(
        betterAuthSchemaSourceFixture(Object.keys(tables)),
        tables,
      );

      // SPEC.md §10.1: these Better Auth plugins do not add app-visible
      // tables in 1.6.17, so B1 stays on the core account/session/user bridge.
      expect(Object.keys(tables).sort(), pluginCase.name).toEqual([
        'account',
        'session',
        'user',
        'verification',
      ]);
      expect(validateBetterAuthSchemaBridge(tables), pluginCase.name).toEqual({
        declaredTouchMismatches: [],
        keyFieldMismatches: [],
        missingTables: [],
        ok: true,
        pluginTableDegradations: [],
        unbridgedTables: [],
      });
      expect(result.annotatedTables, pluginCase.name).toEqual([
        'account',
        'session',
        'user',
        'verification',
      ]);
      expect(result.validation.ok, pluginCase.name).toBe(true);
    }
  });
});
