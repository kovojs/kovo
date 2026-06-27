import { endpointMatches, runEndpoint } from '@kovojs/server/internal/execution';
import { mount } from '@kovojs/better-auth';
import { getAuthTables } from 'better-auth';
import { deviceAuthorization, oidcProvider, twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

import {
  annotateBetterAuthSchemaSource,
  createBetterAuthDbVerificationConfig,
  generateBetterAuthSchemaSource,
  validateBetterAuthSchemaBridge,
} from '@kovojs/better-auth/internal';

import {
  betterAuthSchemaSourceFixture,
  createRealAuth,
  futureWebAuthnPlugin,
  requestHeaders,
  requireAuthTable,
} from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('degrades real future plugin schema tables with KV406 bridge suggestions', () => {
    const { auth } = createRealAuth({
      plugins: [futureWebAuthnPlugin()],
    });
    const tables = getAuthTables(auth.options);
    const generated = generateBetterAuthSchemaSource(tables);

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'session',
      'user',
      'verification',
      'webauthnChallenge',
      'webauthnCredential',
    ]);
    expect(requireAuthTable(tables, 'webauthnChallenge').modelName).toBe(
      'auth_webauthn_challenges',
    );
    expect(Object.keys(requireAuthTable(tables, 'webauthnChallenge').fields).sort()).toEqual([
      'challenge',
      'expiresAt',
    ]);
    expect(requireAuthTable(tables, 'webauthnCredential').modelName).toBe(
      'auth_webauthn_credentials',
    );
    expect(Object.keys(requireAuthTable(tables, 'webauthnCredential').fields).sort()).toEqual([
      'credentialId',
      'userId',
    ]);

    // SPEC.md §10.1 / §11.2: future Better Auth plugin tables are real
    // metadata, but stay KV406 until schema annotations and declared touches
    // are explicit. Protocol state gets an exempt suggestion; credentials get
    // an auth-domain ownership suggestion.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [
        {
          diagnosticCode: 'KV406',
          fields: ['challenge', 'expiresAt', 'id'],
          manualBridgeSteps: [
            'Inspect webauthnChallenge (physical auth_webauthn_challenges) fields (challenge, expiresAt, id) and decide whether the app reads this table.',
            'Likely Better Auth protocol/bookkeeping state is kovo({ exempt: true }); confirm the app never queries it before adding the bridge.',
            'Add declared Better Auth API touches for writes that can mutate webauthnChallenge; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
          ],
          message:
            'webauthnChallenge (physical auth_webauthn_challenges) is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
          physicalTable: 'auth_webauthn_challenges',
          reason: 'unsupported-plugin-table',
          suggestedAnnotation: {
            exempt: true,
            rationale:
              'Better Auth plugin protocol/bookkeeping state is not an app read surface under SPEC.md §10.1.',
          },
          table: 'webauthnChallenge',
        },
        {
          diagnosticCode: 'KV406',
          fields: ['credentialId', 'id', 'userId'],
          manualBridgeSteps: [
            'Inspect webauthnCredential (physical auth_webauthn_credentials) fields (credentialId, id, userId) and decide whether the app reads this table.',
            "Likely app-visible ownership is kovo({ domain: 'auth', key: 'userId' }); confirm before adding the bridge, otherwise use kovo({ exempt: true }) with a rationale.",
            'Add declared Better Auth API touches for writes that can mutate webauthnCredential; SPEC.md §11.2 keeps observed writes KV406 until declared coverage exists.',
          ],
          message:
            'webauthnCredential (physical auth_webauthn_credentials) is outside the blessed Better Auth schema bridge; add a schema.ts domain/exempt annotation and declared touches before relying on runtime coverage.',
          physicalTable: 'auth_webauthn_credentials',
          reason: 'unsupported-plugin-table',
          suggestedAnnotation: { domain: 'auth', key: 'userId' },
          table: 'webauthnCredential',
        },
      ],
      unbridgedTables: ['webauthnChallenge', 'webauthnCredential'],
    });
    expect(generated.unsupportedPluginTables).toEqual(
      validateBetterAuthSchemaBridge(tables).pluginTableDegradations,
    );
    expect(generated.generatedTables.map((table) => table.table)).toEqual([
      'user',
      'session',
      'account',
      'verification',
    ]);
    expect(generated.source).not.toContain('webauthnChallenge');
    expect(generated.source).not.toContain('webauthnCredential');
  });

  it('rejects bridge extension collisions against real Better Auth core tables', () => {
    const { auth } = createRealAuth();
    const tables = getAuthTables(auth.options);
    const schemaBridge = {
      user: {
        exempt: true,
        rationale: 'attempted downgrade',
      },
    } as const;
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
      { schemaBridge },
    );
    const verifierConfig = createBetterAuthDbVerificationConfig(schemaBridge, tables);

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
    expect(result.validation.ok).toBe(false);
    expect(result.validation.keyFieldMismatches).toEqual([
      'user is a blessed Better Auth schema-bridge table; extension entries may only add plugin tables outside the built-in bridge',
    ]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).not.toContain(
      "export const user = pgTable('user', {}, kovo({ exempt: true }));",
    );
    expect(verifierConfig.domainByTable.user).toBe('user');
    expect(verifierConfig.exemptTables).not.toContain('user');
    expect(verifierConfig.keyByTable.user).toBe('id');
  });

  it('materializes schema.ts annotations and verifier facts from real plugin modelName aliases', () => {
    const { auth } = createRealAuth({
      plugins: [
        oidcProvider({
          loginPage: '/login',
          schema: {
            oauthAccessToken: { modelName: 'auth_oauth_tokens' },
            oauthApplication: { modelName: 'auth_oauth_apps' },
            oauthConsent: { modelName: 'auth_oauth_consents' },
          },
        }),
        twoFactor({ twoFactorTable: 'auth_two_factors' }),
        deviceAuthorization({
          schema: {
            deviceCode: { modelName: 'auth_device_codes' },
          },
        }),
      ],
    });
    const tables = getAuthTables(auth.options);
    const physicalTables = Object.keys(tables)
      .map((table) => requireAuthTable(tables, table).modelName)
      .sort();
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(physicalTables),
      tables,
    );
    const generated = generateBetterAuthSchemaSource(tables);
    const verifierConfig = createBetterAuthDbVerificationConfig({}, tables);

    expect(
      Object.fromEntries(
        Object.entries(tables).map(([table, metadata]) => [table, metadata.modelName]),
      ),
    ).toEqual({
      account: 'account',
      deviceCode: 'auth_device_codes',
      oauthAccessToken: 'auth_oauth_tokens',
      oauthApplication: 'auth_oauth_apps',
      oauthConsent: 'auth_oauth_consents',
      session: 'session',
      twoFactor: 'auth_two_factors',
      user: 'user',
      verification: 'verification',
    });
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual([
      'account',
      'auth_device_codes',
      'auth_oauth_apps',
      'auth_oauth_consents',
      'auth_oauth_tokens',
      'auth_two_factors',
      'session',
      'user',
      'verification',
    ]);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const auth_oauth_apps = pgTable('auth_oauth_apps', {}, kovo({ domain: 'auth', key: 'userId', secret: ['clientSecret'] }));",
    );
    expect(result.source).toContain(
      "export const auth_oauth_tokens = pgTable('auth_oauth_tokens', {}, kovo({ domain: 'auth', key: 'userId', secret: ['accessToken', 'refreshToken'] }));",
    );
    expect(result.source).toContain(
      "export const auth_two_factors = pgTable('auth_two_factors', {}, kovo({ domain: 'auth', key: 'userId', secret: ['secret', 'backupCodes'] }));",
    );
    expect(result.source).toContain(
      "export const auth_device_codes = pgTable('auth_device_codes', {}, kovo({ exempt: true }));",
    );
    expect(generated.validation.ok).toBe(true);
    expect(generated.skippedTables).toEqual([]);
    expect(generated.requiredImports).toEqual([
      "import { kovo } from '@kovojs/drizzle';",
      "import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    ]);
    expect(generated.source).toContain(
      "export const oauthApplication = pgTable('auth_oauth_apps', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  name: text('name'),\n" +
        "  icon: text('icon'),",
    );
    expect(generated.source).toContain(
      "export const deviceCode = pgTable('auth_device_codes', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  deviceCode: text('deviceCode').notNull(),\n" +
        "  userCode: text('userCode').notNull(),\n" +
        "  userId: text('userId'),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  status: text('status').notNull(),\n" +
        "  lastPolledAt: timestamp('lastPolledAt'),\n" +
        "  pollingInterval: integer('pollingInterval'),",
    );
    expect(verifierConfig.domainByTable).toMatchObject({
      auth_oauth_apps: 'auth',
      auth_oauth_consents: 'auth',
      auth_oauth_tokens: 'auth',
      auth_two_factors: 'auth',
    });
    expect(verifierConfig.exemptTables).toEqual(
      expect.arrayContaining(['auth_device_codes', 'deviceCode', 'verification']),
    );
    expect(verifierConfig.keyByTable).toMatchObject({
      auth_oauth_apps: 'userId',
      auth_oauth_consents: 'userId',
      auth_oauth_tokens: 'userId',
      auth_two_factors: 'userId',
    });
  });

  it('reports real aliased plugin declarations through unrecognized schema factories', () => {
    const { auth } = createRealAuth({
      plugins: [
        oidcProvider({
          loginPage: '/login',
          schema: {
            oauthAccessToken: { modelName: 'auth_oauth_tokens' },
            oauthApplication: { modelName: 'auth_oauth_apps' },
            oauthConsent: { modelName: 'auth_oauth_consents' },
          },
        }),
      ],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      [
        "import { table } from './schema-kit';",
        "export const authOauthApps = table('auth_oauth_apps', {});",
      ].join('\n'),
      tables,
    );

    expect(validateBetterAuthSchemaBridge(tables)).toMatchObject({
      keyFieldMismatches: [],
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual([]);
    expect(result.missingSourceTables).toEqual([
      'account',
      'auth_oauth_apps',
      'auth_oauth_consents',
      'auth_oauth_tokens',
      'session',
      'user',
      'verification',
    ]);
    expect(result.unrecognizedSourceTables).toEqual([
      {
        callee: 'table',
        diagnosticCode: 'KV406',
        manualBridgeSteps: [
          'Import the Drizzle table factory that declares auth_oauth_apps, or pass it through tableFactories when the factory is intentionally wrapped.',
          'Add the Better Auth kovo(...) annotation manually if table is not a Drizzle table factory.',
          'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
        ],
        message:
          'oauthApplication (physical auth_oauth_apps) appears in schema.ts through unrecognized table factory table; the Better Auth adapter did not synthesize a schema annotation.',
        physicalTable: 'auth_oauth_apps',
        reason: 'unrecognized-schema-table-declaration',
        table: 'oauthApplication',
      },
    ]);
    expect(result.source).toBe(
      [
        "import { table } from './schema-kit';",
        "export const authOauthApps = table('auth_oauth_apps', {});",
      ].join('\n'),
    );
  });

  it('mounts the real Better Auth handler as an audit-visible prefix endpoint', async () => {
    const { auth } = createRealAuth();
    const authEndpoint = mount('/api/auth', auth, { method: 'GET' });

    expect(authEndpoint.auth).toEqual({ kind: 'custom', name: 'better-auth' });
    expect(authEndpoint.method).toBe('GET');
    expect(authEndpoint.csrf).toEqual({
      exempt: true,
      justification: 'better-auth browser redirect protocol handler',
    });
    expect(
      endpointMatches(authEndpoint, { method: 'GET', pathname: '/api/auth/get-session' }),
    ).toBe(true);
    expect(
      endpointMatches(authEndpoint, { method: 'POST', pathname: '/api/auth/sign-in/email' }),
    ).toBe(false);
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
