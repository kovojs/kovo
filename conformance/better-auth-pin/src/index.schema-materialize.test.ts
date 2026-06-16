import { getAuthTables } from 'better-auth';
import { admin, organization } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';

import {
  annotateBetterAuthSchemaSource,
  createBetterAuthDbVerificationConfig,
  generateBetterAuthSchemaSource,
  validateBetterAuthSchemaBridge,
} from '../../../packages/better-auth/src/index.js';

import {
  betterAuthSchemaSourceFixture,
  createRealAuth,
  requireAuthTable,
} from './real-auth-fixtures.js';

describe('Better Auth pinned conformance', () => {
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
      localName: 'kovo',
      shouldAddRequiredImport: false,
      suggestedImport: "import { kovo } from '@kovojs/drizzle';",
    });
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const organization = pgTable('organization', {}, kovo({ domain: 'organization', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const teamMember = pgTable('teamMember', {}, kovo({ domain: 'organization', key: 'teamId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {}, kovo({ exempt: true }));",
    );
  });

  it('generates app schema.ts declarations from real Better Auth table metadata', () => {
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
    const result = generateBetterAuthSchemaSource(tables);

    // SPEC.md §10.1 / §11.2: generated declarations are bounded to the real
    // Better Auth metadata fields and explicit schema-bridge annotations.
    expect(result.validation).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.generatedTables.map((table) => table.table)).toEqual([
      'user',
      'session',
      'account',
      'verification',
      'invitation',
      'member',
      'organization',
      'organizationRole',
      'team',
      'teamMember',
    ]);
    expect(result.skippedTables).toEqual([]);
    expect(result.unsupportedPluginTables).toEqual([]);
    expect(result.requiredImports).toEqual([
      "import { kovo } from '@kovojs/drizzle';",
      "import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    ]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  name: text('name').notNull(),\n" +
        "  email: text('email').notNull(),\n" +
        "  emailVerified: boolean('emailVerified').notNull(),",
    );
    expect(result.source).toContain(
      "  banned: boolean('banned'),\n" +
        "  banReason: text('banReason'),\n" +
        "  banExpires: timestamp('banExpires'),",
    );
    expect(result.source).toContain(
      "export const member = pgTable('member', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  organizationId: text('organizationId').notNull(),\n" +
        "  userId: text('userId').notNull(),\n" +
        "  role: text('role').notNull(),\n" +
        "  createdAt: timestamp('createdAt').notNull(),\n" +
        "}, kovo({ domain: 'organization', key: 'organizationId' }));",
    );
    expect(result.source).toContain(
      "export const verification = pgTable('verification', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  identifier: text('identifier').notNull(),\n" +
        "  value: text('value').notNull(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  createdAt: timestamp('createdAt').notNull(),\n" +
        "  updatedAt: timestamp('updatedAt').notNull(),\n" +
        '}, kovo({ exempt: true }));',
    );
  });

  it('generates real Better Auth fieldName aliases from table metadata', () => {
    const { auth } = createRealAuth({
      session: {
        fields: {
          userId: 'user_id',
        },
      },
      user: {
        fields: {
          email: 'email_address',
        },
      },
    });
    const tables = getAuthTables(auth.options);
    const sessionTable = requireAuthTable(tables, 'session');
    const userTable = requireAuthTable(tables, 'user');
    const result = generateBetterAuthSchemaSource(tables);

    expect(sessionTable.fields.userId?.fieldName).toBe('user_id');
    expect(userTable.fields.email?.fieldName).toBe('email_address');
    // SPEC.md §10.1 / §11.2: generated schema.ts must use Better Auth's
    // physical column metadata while retaining logical bridge keys.
    expect(result.validation.ok).toBe(true);
    expect(result.skippedTables).toEqual([]);
    expect(result.source).toContain(
      "export const user = pgTable('user', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  name: text('name').notNull(),\n" +
        "  email: text('email_address').notNull(),",
    );
    expect(result.source).toContain(
      "export const session = pgTable('session', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  token: text('token').notNull(),\n" +
        "  createdAt: timestamp('createdAt').notNull(),\n" +
        "  updatedAt: timestamp('updatedAt').notNull(),\n" +
        "  ipAddress: text('ipAddress'),\n" +
        "  userAgent: text('userAgent'),\n" +
        "  userId: text('user_id').notNull(),",
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
      "import { kovo } from '@kovojs/drizzle';",
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
      "export const account = authPgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const invitation = sqlite.sqliteTable('invitation', {}, kovo({ domain: 'organization', key: 'organizationId' }));",
    );
    expect(result.source).toContain(
      "export const verification = sqlite.sqliteTable('verification', {}, kovo({ exempt: true }));",
    );
  });

  it('reports duplicate real Better Auth schema.ts declarations without annotating them', () => {
    const { auth } = createRealAuth();
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      [
        "import { kovo } from '@kovojs/drizzle';",
        "import { pgTable } from 'drizzle-orm/pg-core';",
        '',
        "export const user = pgTable('user', {});",
        "export const userShadow = pgTable('user', {});",
        "export const session = pgTable('session', {});",
        "export const account = pgTable('account', {});",
        "export const verification = pgTable('verification', {});",
        '',
      ].join('\n'),
      tables,
    );

    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [],
      missingTables: [],
      ok: true,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.validation.ok).toBe(true);
    expect(result.annotatedTables).toEqual(['account', 'session', 'verification']);
    expect(result.duplicateSourceTables).toEqual(['user']);
    expect(result.missingSourceTables).toEqual([]);
    expect(result.source).toContain(
      "export const account = pgTable('account', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain("export const user = pgTable('user', {});");
    expect(result.source).toContain("export const userShadow = pgTable('user', {});");
    expect(result.source).not.toContain(
      "export const user = pgTable('user', {}, kovo({ domain: 'user', key: 'id' }));",
    );
  });

  it('materializes schema.ts annotations and verifier facts from real Better Auth modelName aliases', () => {
    const { auth } = createRealAuth({
      account: { modelName: 'auth_accounts' },
      plugins: [
        organization({
          schema: {
            invitation: { modelName: 'auth_invitations' },
            member: { modelName: 'auth_members' },
            organization: { modelName: 'auth_organizations' },
          },
        }),
      ],
      session: { modelName: 'auth_sessions' },
      user: { modelName: 'auth_users' },
      verification: { modelName: 'auth_verifications' },
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
      account: 'auth_accounts',
      invitation: 'auth_invitations',
      member: 'auth_members',
      organization: 'auth_organizations',
      session: 'auth_sessions',
      user: 'auth_users',
      verification: 'auth_verifications',
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
      "export const auth_users = pgTable('auth_users', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const auth_sessions = pgTable('auth_sessions', {}, kovo({ domain: 'auth', key: 'userId' }));",
    );
    expect(result.source).toContain(
      "export const auth_organizations = pgTable('auth_organizations', {}, kovo({ domain: 'organization', key: 'id' }));",
    );
    expect(result.source).toContain(
      "export const auth_verifications = pgTable('auth_verifications', {}, kovo({ exempt: true }));",
    );
    expect(generated.validation.ok).toBe(true);
    expect(generated.skippedTables).toEqual([]);
    expect(generated.source).toContain(
      "export const user = pgTable('auth_users', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  name: text('name').notNull(),\n" +
        "  email: text('email').notNull(),",
    );
    expect(generated.source).toContain(
      "export const session = pgTable('auth_sessions', {\n" +
        "  id: text('id').primaryKey(),\n" +
        "  expiresAt: timestamp('expiresAt').notNull(),\n" +
        "  token: text('token').notNull(),",
    );
    expect(verifierConfig.domainByTable).toMatchObject({
      auth_accounts: 'auth',
      auth_invitations: 'organization',
      auth_members: 'organization',
      auth_organizations: 'organization',
      auth_sessions: 'auth',
      auth_users: 'user',
    });
    expect(verifierConfig.exemptTables).toEqual(
      expect.arrayContaining(['auth_verifications', 'verification']),
    );
    expect(verifierConfig.keyByTable).toMatchObject({
      auth_accounts: 'userId',
      auth_invitations: 'organizationId',
      auth_members: 'organizationId',
      auth_organizations: 'id',
      auth_sessions: 'userId',
      auth_users: 'id',
    });
  });

  it('rejects real Better Auth modelName aliases that collide across bridged tables', () => {
    const { auth } = createRealAuth({
      session: { modelName: 'auth_users' },
      user: { modelName: 'auth_users' },
    });
    const tables = getAuthTables(auth.options);
    const result = annotateBetterAuthSchemaSource(
      betterAuthSchemaSourceFixture(['account', 'auth_users', 'verification']),
      tables,
    );
    const verifierConfig = createBetterAuthDbVerificationConfig({}, tables);

    expect(
      Object.fromEntries(
        Object.entries(tables).map(([table, metadata]) => [table, metadata.modelName]),
      ),
    ).toEqual({
      account: 'account',
      session: 'auth_users',
      user: 'auth_users',
      verification: 'verification',
    });
    // SPEC.md §10.1 / §11.2: one physical Drizzle table cannot hide two
    // logical Better Auth tables; P9 table facts would be ambiguous even
    // though both logical tables are otherwise bridged.
    expect(validateBetterAuthSchemaBridge(tables)).toEqual({
      declaredTouchMismatches: [],
      keyFieldMismatches: [
        'Better Auth tables session, user resolve to the same physical table auth_users; modelName aliases must be unique for schema.ts annotations and P9 verification',
      ],
      missingTables: [],
      ok: false,
      pluginTableDegradations: [],
      unbridgedTables: [],
    });
    expect(result.validation.ok).toBe(false);
    expect(result.annotatedTables).toEqual(['account', 'verification']);
    expect(result.source).toContain("export const auth_users = pgTable('auth_users', {});");
    expect(result.source).not.toContain(
      "export const auth_users = pgTable('auth_users', {}, kovo({ domain: 'user', key: 'id' }));",
    );
    expect(verifierConfig.domainByTable).not.toHaveProperty('auth_users');
    expect(verifierConfig.keyByTable).not.toHaveProperty('auth_users');
  });
});
