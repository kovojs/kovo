import { getAuthTables } from 'better-auth';
import {
  anonymous,
  deviceAuthorization,
  lastLoginMethod,
  mcp,
  oidcProvider,
  phoneNumber,
  siwe,
  twoFactor,
  username,
} from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

import {
  annotateBetterAuthSchemaSource,
  betterAuthSchemaBridge,
  validateBetterAuthSchemaBridge,
} from '../../../packages/better-auth/src/index.js';

import {
  betterAuthSchemaSourceFixture,
  createRealAuth,
  requireAuthTable,
} from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
  it('pins two-factor plugin table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [twoFactor()],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'twoFactor').fields).sort()).toEqual([
      'backupCodes',
      'secret',
      'userId',
      'verified',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(
      validateBetterAuthSchemaBridge(tables, {
        credentialMutationDeclaredTableTouches: {
          signInEmail: [
            { domain: 'auth', table: 'session' },
            { domain: 'auth', table: 'twoFactor' },
          ],
        },
      }),
    ).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.twoFactor).toEqual({ domain: 'auth', key: 'userId' });
    expect(result.annotatedTables).toEqual([
      'account',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const twoFactor = pgTable('twoFactor', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins two-factor OTP and backup-code provider metadata under the same table bridge', () => {
    const { auth } = createRealAuth({
      plugins: [
        twoFactor({
          backupCodeOptions: {
            storeBackupCodes: 'plain',
          },
          otpOptions: {
            sendOTP: async () => {},
          },
        }),
      ],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'twoFactor').fields).sort()).toEqual([
      'backupCodes',
      'secret',
      'userId',
      'verified',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
      'account',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const twoFactor = pgTable('twoFactor', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins device-authorization code metadata as an exempt schema bridge table', () => {
    const { auth } = createRealAuth({
      plugins: [deviceAuthorization({ schema: {} })],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'deviceCode',
      'session',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'deviceCode').fields).sort()).toEqual([
      'clientId',
      'deviceCode',
      'expiresAt',
      'lastPolledAt',
      'pollingInterval',
      'scope',
      'status',
      'userCode',
      'userId',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.deviceCode).toEqual({
      exempt: true,
      rationale:
        'Better Auth device-authorization codes are redirect/device-flow protocol state, not an app read surface under SPEC.md §10.1.',
    });
    expect(result.annotatedTables).toEqual([
      'account',
      'deviceCode',
      'session',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const deviceCode = pgTable('deviceCode', {}, kovo({ exempt: true }));",
    );
  });

  it('pins OIDC provider plugin table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [oidcProvider({ loginPage: '/login' })],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'oauthAccessToken',
      'oauthApplication',
      'oauthConsent',
      'session',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthApplication').fields).sort()).toEqual([
      'clientId',
      'clientSecret',
      'createdAt',
      'disabled',
      'icon',
      'metadata',
      'name',
      'redirectUrls',
      'type',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthAccessToken').fields).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'clientId',
      'createdAt',
      'refreshToken',
      'refreshTokenExpiresAt',
      'scopes',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthConsent').fields).sort()).toEqual([
      'clientId',
      'consentGiven',
      'createdAt',
      'scopes',
      'updatedAt',
      'userId',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.oauthApplication).toEqual({ domain: 'auth', key: 'userId' });
    expect(betterAuthSchemaBridge.oauthAccessToken).toEqual({ domain: 'auth', key: 'userId' });
    expect(betterAuthSchemaBridge.oauthConsent).toEqual({ domain: 'auth', key: 'userId' });
    expect(result.annotatedTables).toEqual([
      'account',
      'oauthAccessToken',
      'oauthApplication',
      'oauthConsent',
      'session',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const oauthApplication = pgTable('oauthApplication', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthAccessToken = pgTable('oauthAccessToken', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthConsent = pgTable('oauthConsent', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins MCP plugin OAuth table metadata as covered by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [mcp({ loginPage: '/login' })],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'oauthAccessToken',
      'oauthApplication',
      'oauthConsent',
      'session',
      'user',
      'verification',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthApplication').fields).sort()).toEqual([
      'clientId',
      'clientSecret',
      'createdAt',
      'disabled',
      'icon',
      'metadata',
      'name',
      'redirectUrls',
      'type',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthAccessToken').fields).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'clientId',
      'createdAt',
      'refreshToken',
      'refreshTokenExpiresAt',
      'scopes',
      'updatedAt',
      'userId',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'oauthConsent').fields).sort()).toEqual([
      'clientId',
      'consentGiven',
      'createdAt',
      'scopes',
      'updatedAt',
      'userId',
    ]);
    // SPEC.md §10.1: MCP authorization state is app-owned auth-domain data
    // keyed by Better Auth's userId bridge, not an unsupported plugin table.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
      'account',
      'oauthAccessToken',
      'oauthApplication',
      'oauthConsent',
      'session',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const oauthApplication = pgTable('oauthApplication', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthAccessToken = pgTable('oauthAccessToken', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthConsent = pgTable('oauthConsent', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins SIWE wallet table metadata used by the schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [
        siwe({
          domain: 'example.test',
          getNonce: async () => 'nonce',
          verifyMessage: async () => true,
        }),
      ],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual([
      'account',
      'session',
      'user',
      'verification',
      'walletAddress',
    ]);
    expect(Object.keys(requireAuthTable(tables, 'walletAddress').fields).sort()).toEqual([
      'address',
      'chainId',
      'createdAt',
      'isPrimary',
      'userId',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.walletAddress).toEqual({ domain: 'auth', key: 'userId' });
    expect(result.annotatedTables).toEqual([
      'account',
      'session',
      'user',
      'verification',
      'walletAddress',
    ]);
    expect(result.source).toContain(
      "export const walletAddress = pgTable('walletAddress', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('pins username plugin user-field metadata as covered by the user schema bridge', () => {
    const { auth } = createRealAuth({
      plugins: [username()],
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
    expect(Object.keys(requireAuthTable(tables, 'user').fields).sort()).toEqual([
      'createdAt',
      'displayUsername',
      'email',
      'emailVerified',
      'image',
      'name',
      'updatedAt',
      'username',
    ]);
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(betterAuthSchemaBridge.user).toEqual({ domain: 'user', key: 'id' });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.source).toContain(
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
  });

  it('pins additional user-field plugin metadata as covered by the user schema bridge', () => {
    const cases = [
      {
        fields: [
          'createdAt',
          'email',
          'emailVerified',
          'image',
          'isAnonymous',
          'name',
          'updatedAt',
        ],
        plugins: [anonymous()],
      },
      {
        fields: [
          'createdAt',
          'email',
          'emailVerified',
          'image',
          'lastLoginMethod',
          'name',
          'updatedAt',
        ],
        plugins: [lastLoginMethod({ storeInDatabase: true })],
      },
      {
        fields: [
          'createdAt',
          'email',
          'emailVerified',
          'image',
          'name',
          'phoneNumber',
          'phoneNumberVerified',
          'updatedAt',
        ],
        plugins: [phoneNumber({ sendOTP: async () => {} })],
      },
    ];

    for (const pluginCase of cases) {
      const { auth } = createRealAuth({ plugins: pluginCase.plugins });
      const tables = getAuthTables(auth.options);
      const result = annotateBetterAuthSchemaSource(
        betterAuthSchemaSourceFixture(Object.keys(tables)),
        tables,
      );

      // SPEC.md §10.1: plugin fields on an app-visible bridged table inherit
      // that table's domain annotation; they are not unsupported plugin tables.
      expect(Object.keys(tables).sort()).toEqual(['account', 'session', 'user', 'verification']);
      expect(Object.keys(requireAuthTable(tables, 'user').fields).sort()).toEqual(
        pluginCase.fields,
      );
      expect(validateBetterAuthSchemaBridge(tables)).toEqual({
        declaredTouchMismatches: [],
        keyFieldMismatches: [],
        missingTables: [],
        ok: true,
        pluginTableDegradations: [],
        unbridgedTables: [],
      });
      expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
      expect(result.source).toContain(
        "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
      );
    }
  });
});
