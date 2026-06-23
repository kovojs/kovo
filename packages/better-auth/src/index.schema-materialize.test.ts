import { describe, expect, it } from 'vitest';
import {
  annotateBetterAuthSchemaSource,
  createBetterAuthDbVerificationConfig,
  generateBetterAuthSchemaSource,
  validateBetterAuthSchemaBridge,
} from './internal.js';
import { authTable } from './test-fakes.js';

describe('schema.ts materialization', () => {
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
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'auth', key: 'userId' }));",
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

  it('materializes Kovo annotations into an app schema.ts source fixture', () => {
    const source = [
      "import { kovo } from '@kovojs/drizzle';",
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
      localName: 'kovo',
      shouldAddRequiredImport: false,
      suggestedImport: "import { kovo } from '@kovojs/drizzle';",
    });
    expect(result.requiredImport).toEqual({ module: '@kovojs/drizzle', name: 'kovo' });
    expect(result.annotatedTables).toEqual(['account', 'session', 'user', 'verification']);
    expect(result.alreadyAnnotatedTables).toEqual([]);
    expect(result.existingExtraConfigTables).toEqual([]);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  email: text('email').notNull(),\n" +
        "}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "  expiresAt: timestamp('expires_at').notNull(),\n" +
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        '}, kovo({ exempt: true }));',
    );
  });

  it('materializes explicit plugin-table bridge extensions into app schema.ts source', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('keeps token-only plugin metadata under the exempt verification bridge', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        '}, kovo({ exempt: true }));',
    );
  });

  it('materializes a bridged two-factor plugin table into an app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('materializes the device-authorization code table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        '}, kovo({ exempt: true }));',
    );
  });

  it('materializes bridged OIDC provider plugin tables into app schema.ts source fixtures', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('materializes a bridged SIWE wallet table into an app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
  });

  it('keeps plugin-added user fields under the bridged user domain', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "}, kovo({ domain: 'user', key: 'id' }));",
    );
  });

  it('materializes the JWT signing-key table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        '}, kovo({ exempt: true }));',
    );
  });

  it('materializes the database-backed rate-limit table as an exempt app schema.ts source fixture', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        '}, kovo({ exempt: true }));',
    );
  });

  it('reports schema.ts tables it cannot safely annotate', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        'const auditConfig = () => [];',
        "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
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
      "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
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
        diagnosticCode: 'KV406',
        manualBridgeSteps: [
          'Import the Drizzle table factory that declares user, or pass it through tableFactories when the factory is intentionally wrapped.',
          'Add the Better Auth kovo(...) annotation manually if pgTable is not a Drizzle table factory.',
          'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
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
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
  });

  it('does not report column builders as unrecognized schema table declarations', () => {
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
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
        "import { kovo } from '@kovojs/drizzle';",
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
      "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain("export const primaryUser = pgTable('user', {});");
    expect(result.source).toContain("export const auditUser = pgTable('user', {});");
    expect(result.source).not.toContain(
      "export const primaryUser = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
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
      localName: 'kovo',
      shouldAddRequiredImport: false,
      suggestedImport: "import { kovo } from '@kovojs/drizzle';",
    });
    expect(result.source).toBe(
      [
        "import { kovo } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
      ].join('\n'),
    );

    const aliased = annotateBetterAuthSchemaSource(
      [
        "import { kovo as markKovo } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      metadata,
      { annotationCallee: 'markKovo' },
    );

    expect(aliased.importNote).toEqual({
      hasRequiredImport: true,
      insertedImport: false,
      localName: 'markKovo',
      shouldAddRequiredImport: false,
      suggestedImport: "import { kovo as markKovo } from '@kovojs/drizzle';",
    });
    expect(aliased.source).toContain(
      "export const account = pgTable('account', {}, markKovo({ domain: 'auth', key: 'userId' }));",
    );

    const existingKovoModuleImport = annotateBetterAuthSchemaSource(
      [
        "import { domain } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {});",
      ].join('\n'),
      metadata,
    );

    expect(existingKovoModuleImport.importNote).toEqual({
      hasRequiredImport: false,
      insertedImport: true,
      localName: 'kovo',
      shouldAddRequiredImport: false,
      suggestedImport: "import { kovo } from '@kovojs/drizzle';",
    });
    expect(existingKovoModuleImport.source).toBe(
      [
        "import { domain, kovo } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
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
      localName: 'kovo',
    });
    expect(result.source).toContain(
      "export const user = authPgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = sqlite.sqliteTable('session', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = sqlite.sqliteTable('verification', {}, kovo({ exempt: true }));",
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
    // Better Auth fields and explicit Kovo bridge annotations.
    expect(result.validation.ok).toBe(true);
    expect(result.generatedTables.map((table) => table.table)).toEqual([
      'account',
      'session',
      'user',
      'verification',
    ]);
    expect(result.skippedTables).toEqual([]);
    expect(result.requiredImports).toEqual([
      "import { kovo } from '@kovojs/drizzle';",
      "import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    ]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  'profile-url': text('profile_url'),\n" +
        "  email: text('email').notNull(),\n" +
        "  emailVerified: boolean('emailVerified').notNull(),\n" +
        "  name: text('name').notNull(),\n" +
        "}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  token: text('token').notNull(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        "  value: text('value').notNull(),\n" +
        '}, kovo({ exempt: true }));',
    );
  });

  it('generates SQLite Better Auth schema declarations from metadata', () => {
    const result = generateBetterAuthSchemaSource(
      {
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
      },
      { dialect: 'sqlite' },
    );

    // SPEC.md §10.1 / §11.2: the Better Auth bridge emits the same domain
    // annotations for SQLite while using SQLite's blessed type mappings.
    expect(result.validation.ok).toBe(true);
    expect(result.skippedTables).toEqual([]);
    expect(result.requiredImports).toEqual([
      "import { kovo } from '@kovojs/drizzle';",
      "import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';",
    ]);
    expect(result.source).toContain(
      "export const user = sqliteTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  email: text('email').notNull(),\n" +
        "  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),\n" +
        "  name: text('name').notNull(),\n" +
        "}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const session = sqliteTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: text('expiresAt').notNull(),\n" +
        "  token: text('token').notNull(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const verification = sqliteTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: text('expiresAt').notNull(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        "  value: text('value').notNull(),\n" +
        '}, kovo({ exempt: true }));',
    );
  });

  it('generates explicit Better Auth id field aliases and types', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: {
        fields: {
          userId: { fieldName: { fieldName: 'user_id' }, required: true, type: 'string' },
        },
      },
      user: {
        fields: {
          email: { fieldName: { fieldName: 'email_address' }, required: true, type: 'string' },
          id: { fieldName: 'auth_user_id', required: true, type: 'number' },
        },
      },
      verification: authTable(),
    });

    // SPEC.md §10.1 / §11.2: generated schema.ts reflects physical Better
    // Auth metadata, including explicit column aliases on bridge key fields.
    expect(result.validation.ok).toBe(true);
    expect(result.skippedTables).toEqual([]);
    expect(result.requiredImports).toEqual([
      "import { kovo } from '@kovojs/drizzle';",
      "import { integer, pgTable, text } from 'drizzle-orm/pg-core';",
    ]);
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  userId: text('user_id').notNull(),\n" +
        "}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: integer('auth_user_id').primaryKey(),\n" +
        "  email: text('email_address').notNull(),\n" +
        "}, kovo({ domain: 'user', key: 'id' }));",
    );
  });

  it('degrades generated schema.ts when explicit id metadata has an unsupported type', () => {
    const result = generateBetterAuthSchemaSource({
      account: authTable(['userId']),
      session: authTable(['userId']),
      user: {
        fields: {
          id: { fieldName: 'auth_user_id', type: 'json' },
        },
      },
      verification: authTable(),
    });

    expect(result.source).not.toContain('export const user');
    expect(result.skippedTables).toContainEqual({
      diagnosticCode: 'KV406',
      field: 'id',
      fields: ['id'],
      manualBridgeSteps: [
        'Inspect Better Auth metadata for user and write the Drizzle declaration manually.',
        'Verify field id in Better Auth metadata before adding the matching Kovo annotation.',
        'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
      ],
      message: 'user cannot be generated because field id has unsupported Better Auth type json.',
      reason: 'unsupported-field-type',
      table: 'user',
    });
  });

  it('keeps unsupported plugin tables out of generated schema.ts with KV406 facts', () => {
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
      diagnosticCode: 'KV406',
      fields: null,
      manualBridgeSteps: [
        'Inspect Better Auth metadata for session and write the Drizzle declaration manually.',
        'Add the matching kovo({ domain, key }) or kovo({ exempt: true }) annotation once the table declaration is explicit.',
        'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
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
      diagnosticCode: 'KV406',
      field: 'metadata',
      fields: ['id', 'metadata'],
      manualBridgeSteps: [
        'Inspect Better Auth metadata for user and write the Drizzle declaration manually.',
        'Verify field metadata in Better Auth metadata before adding the matching Kovo annotation.',
        'Keep observed writes KV406 until schema.ts and declared Better Auth API touches both cover the table under SPEC.md §11.2.',
      ],
      message:
        'user cannot be generated because field metadata has unsupported Better Auth type json.',
      reason: 'unsupported-field-type',
      table: 'user',
    });
  });
});
