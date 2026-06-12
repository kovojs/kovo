import {
  endpointMatches,
  renderRoutePageResponse,
  route,
  runEndpoint,
  runMutation,
} from '@jiso/server';
import { createJisoTestHarness } from '@jiso/test';
import { betterAuth, getAuthTables } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import {
  admin,
  anonymous,
  auth0,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  gumroad,
  hubspot,
  jwt,
  keycloak,
  lastLoginMethod,
  line,
  magicLink,
  mcp,
  microsoftEntraId,
  oidcProvider,
  okta,
  oneTimeToken,
  organization,
  patreon,
  phoneNumber,
  siwe,
  slack,
  twoFactor,
  username,
} from 'better-auth/plugins';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  annotateBetterAuthSchemaSource,
  authed,
  betterAuthCredentialMutationDeclaredTableTouches,
  betterAuthCredentialMutationTouchGraph,
  betterAuthCredentialMutationTouches,
  betterAuthDbVerificationConfig,
  betterAuthOAuthProviderSuccessorImportPaths,
  betterAuthOAuthProviderSuccessorMetadataDegradation,
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
  type BetterAuthResponseLike,
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

interface AuthVerifierDb {
  writes: { table: BetterAuthTable; value: unknown }[];
  write(table: BetterAuthTable, value: unknown): void;
}

interface AuthVerifierRequest {
  db: AuthVerifierDb;
  headers: Headers;
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
      pluginTableDegradations: [],
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
      pluginTableDegradations: [],
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

  it('materializes app schema.ts annotations from real Better Auth table metadata', () => {
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
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(Object.keys(tables)),
      tables,
    );

    expect(result.validation).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
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
    expect(result.importNote).toEqual({
      hasRequiredImport: true,
      insertedImport: false,
      localName: 'jiso',
      shouldAddRequiredImport: false,
      suggestedImport: "import { jiso } from '@jiso/drizzle';",
    });
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const organization = pgTable('organization', {}, jiso({ domain: 'organization', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const teamMember = pgTable('teamMember', {}, jiso({ domain: 'organization', key: 'teamId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {}, jiso({ exempt: true }));",
    );
  });

  it('materializes real Better Auth metadata when schema.ts aliases Drizzle table factories', () => {
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
    const tableNames = Object.keys(tables).sort();
    const source = [
      "import { jiso } from '@jiso/drizzle';",
      "import { pgTable as authPgTable } from 'drizzle-orm/pg-core';",
      "import * as sqlite from 'drizzle-orm/sqlite-core';",
      '',
      ...tableNames.map((table, index) =>
        index % 2 === 0
          ? `export const ${table} = authPgTable('${table}', {});`
          : `export const ${table} = sqlite.sqliteTable('${table}', {});`,
      ),
      '',
    ].join('\n');
    const result = annotateBetterAuthSchemaSource(source, tables);

    expect(result.validation).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.annotatedTables).toEqual([
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
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const account = authPgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const invitation = sqlite.sqliteTable('invitation', {}, jiso({ domain: 'organization', key: 'organizationId' }));",
    );
    expect(result.source).toContain(
      "export const verification = sqlite.sqliteTable('verification', {}, jiso({ exempt: true }));",
    );
  });

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
    expect(betterAuthSchemaBridge.twoFactor).toEqual({ domain: 'auth', key: 'userId' });
    expect(result.annotatedTables).toEqual([
      'account',
      'session',
      'twoFactor',
      'user',
      'verification',
    ]);
    expect(result.source).toContain(
      "export const twoFactor = pgTable('twoFactor', {}, jiso({ domain: 'auth', key: 'userId' }));",
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
      "export const deviceCode = pgTable('deviceCode', {}, jiso({ exempt: true }));",
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
      "export const oauthApplication = pgTable('oauthApplication', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthAccessToken = pgTable('oauthAccessToken', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthConsent = pgTable('oauthConsent', {}, jiso({ domain: 'auth', key: 'userId' }));",
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
      "export const oauthApplication = pgTable('oauthApplication', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthAccessToken = pgTable('oauthAccessToken', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const oauthConsent = pgTable('oauthConsent', {}, jiso({ domain: 'auth', key: 'userId' }));",
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
      "export const walletAddress = pgTable('walletAddress', {}, jiso({ domain: 'auth', key: 'userId' }));",
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
      "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
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
        "export const user = pgTable('user', {}, jiso({ domain: 'user', key: 'id' }));",
      );
    }
  });

  it('pins OAuth-provider successor metadata absence as an FW406 bridge degradation', async () => {
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
    });
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
      "export const jwks = pgTable('jwks', {}, jiso({ exempt: true }));",
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
      "export const rateLimit = pgTable('rateLimit', {}, jiso({ exempt: true }));",
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
      "export const verification = pgTable('verification', {}, jiso({ exempt: true }));",
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
      "export const verification = pgTable('verification', {}, jiso({ exempt: true }));",
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
      "export const verification = pgTable('verification', {}, jiso({ exempt: true }));",
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
              issuer: 'https://keycloak.example.test/realms/jiso',
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
      "export const account = pgTable('account', {}, jiso({ domain: 'auth', key: 'userId' }));",
    );
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

  it('verifies adapter credential wrappers through the P9 observed-write harness', async () => {
    const harness = createJisoTestHarness<AuthVerifierDb>({
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

function createRealAuth(
  options: {
    plugins?: Parameters<typeof betterAuth>[0]['plugins'];
    rateLimit?: Parameters<typeof betterAuth>[0]['rateLimit'];
  } = {},
) {
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
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    secret: authSecret,
  });

  return { auth, db };
}

function betterAuthSchemaSourceFixture(tables: readonly string[]): string {
  return [
    "import { jiso } from '@jiso/drizzle';",
    "import { pgTable } from 'drizzle-orm/pg-core';",
    '',
    ...[...tables].sort().map((table) => `export const ${table} = pgTable('${table}', {});`),
    '',
  ].join('\n');
}

class ObservedCredentialAuth
  implements BetterAuthSignInEmailLike, BetterAuthSignOutLike, BetterAuthSignUpEmailLike
{
  readonly api = {
    signInEmail: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('session', { action: 'signInEmail' });

      return responseWithCookies(['better-auth.session_token=verified-sign-in; Path=/; HttpOnly']);
    },
    signOut: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('session', { action: 'signOut' });

      return responseWithCookies(['better-auth.session_token=; Path=/; Max-Age=0; HttpOnly']);
    },
    signUpEmail: async (): Promise<BetterAuthResponseLike> => {
      this.db.write('user', { action: 'signUpEmail' });
      this.db.write('account', { action: 'signUpEmail' });
      this.db.write('session', { action: 'signUpEmail' });

      return responseWithCookies(['better-auth.session_token=verified-sign-up; Path=/; HttpOnly']);
    },
  };

  constructor(private readonly db: AuthVerifierDb) {}
}

function createAuthVerifierDb(): AuthVerifierDb {
  const writes: { table: BetterAuthTable; value: unknown }[] = [];

  return {
    writes,
    write(table, value) {
      writes.push({ table, value });
    },
  };
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

function responseWithCookies(cookies: readonly string[], status = 204): BetterAuthResponseLike {
  const headers = new Headers();

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
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

function importResultMessage(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'fulfilled';

  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

function requireAuthTable(
  tables: ReturnType<typeof getAuthTables>,
  table: string,
): NonNullable<ReturnType<typeof getAuthTables>[string]> {
  const value = tables[table];

  if (!value) throw new Error(`better-auth table metadata missing: ${table}`);

  return value;
}
