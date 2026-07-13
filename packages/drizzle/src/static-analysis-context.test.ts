import { describe, expect, it } from 'vitest';

import {
  analyzeSqlSafetyFromProject,
  diagnosticsForQueryFacts,
  directSummaryForFunction,
  extractMassAssignmentFromProject,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  extractQueryWriteReachabilityFromProject,
  extractStaticBuildAnalysisFactsFromProject,
  extractToctouFromProject,
  extractTouchGraphFromProject,
  type ExtractedFunction,
  type TouchGraphProjectOptions,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle static analysis context', () => {
  it('projects the build aggregate from the same facts as the individual passes', () => {
    const project = fixtureProject();
    const queries = extractQueryFactsFromProject(project);
    const ownerAudit = extractOwnerAuditFromProject(project);

    expect(extractStaticBuildAnalysisFactsFromProject(project)).toEqual({
      massAssignmentFacts: extractMassAssignmentFromProject(project),
      ownerDomains: ownerAudit.ownerDomains,
      queries,
      queryWriteReachability: extractQueryWriteReachabilityFromProject(project),
      runtimeTableSecurityManifest: {
        tables: [
          {
            authorizationClassifications: ['reference'],
            columns: [],
            governedColumnKeys: [],
            name: 'carts',
            secretColumnKeys: [],
            secretDeclared: false,
          },
        ],
      },
      scopeAudits: ownerAudit.scopeAudits,
      sqlSafetyDiagnostics: [
        ...analyzeSqlSafetyFromProject(project),
        ...diagnosticsForQueryFacts(queries),
      ],
      toctouFacts: extractToctouFromProject(project),
      touchGraph: extractTouchGraphFromProject(project),
    });
  });

  it('derives canonical runtime table security from source instead of runtime callbacks', () => {
    const facts = extractStaticBuildAnalysisFactsFromProject({
      files: [
        pgDatabaseTypes([]),
        {
          fileName: 'src/schema.ts',
          source: [
            'import { kovo } from "@kovojs/drizzle";',
            'import { pgTable, text } from "drizzle-orm/pg-core";',
            '',
            'export const users = pgTable("user", {',
            '  id: text("user_id").primaryKey(),',
            '  passwordHash: text("password_hash").notNull(),',
            '}, kovo({ domain: "user", key: (t) => t.id, owner: (t) => t.id, secret: [(t) => t.passwordHash] }));',
            '',
            'export const sessions = pgTable("session", {',
            '  id: text("session_id").primaryKey(),',
            '  userId: text("user_id").notNull(),',
            '  token: text("session_token").notNull(),',
            '}, kovo({',
            '  domain: "session",',
            '  key: (t) => t.id,',
            '  ownerVia: { fk: (t) => t.userId, parent: users, parentKey: (t) => t.id },',
            '  governed: [(t) => t.token],',
            '  secret: true,',
            '}));',
          ].join('\n'),
        },
      ],
    });

    expect(facts.runtimeTableSecurityManifest).toEqual({
      tables: [
        {
          authorizationClassifications: ['ownedVia'],
          columns: [
            { key: 'id', name: 'session_id' },
            { key: 'token', name: 'session_token' },
            { key: 'userId', name: 'user_id' },
          ],
          governedColumnKeys: ['id', 'token'],
          name: 'session',
          ownerVia: {
            fkColumnKey: 'userId',
            fkColumnName: 'user_id',
            parentKeyColumnKey: 'id',
            parentKeyColumnName: 'user_id',
            parentTable: 'user',
          },
          secretColumnKeys: ['id', 'token', 'userId'],
          secretDeclared: true,
        },
        {
          authorizationClassifications: ['owned'],
          columns: [
            { key: 'id', name: 'user_id' },
            { key: 'passwordHash', name: 'password_hash' },
          ],
          governedColumnKeys: ['id', 'passwordHash'],
          name: 'user',
          owner: { columnKey: 'id', columnName: 'user_id' },
          secretColumnKeys: ['passwordHash'],
          secretDeclared: true,
        },
      ],
    });
  });

  it('does not surface generated app runtime DB provider construction as app touch graph work', () => {
    const providerSource = [
      'export function appRuntimeDbProvider(request?: unknown): AppDb {',
      '  return appDatabase.db(request);',
      '}',
    ].join('\n');
    const providerFunction: ExtractedFunction = {
      bodyStart: 0,
      key: 'appRuntimeDbProvider',
      localCalls: [],
      name: 'appRuntimeDbProvider',
      readCalls: [],
      receiverNames: [],
      receiverParameters: [],
      unresolvedCalls: [{ index: providerSource.indexOf('appDatabase.db'), name: 'db' }],
      writeCalls: [],
    };

    expect(
      directSummaryForFunction(
        providerFunction,
        { fileName: '_kovo/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ),
    ).toEqual({ reads: [], unresolved: [], writes: [] });
    expect(
      directSummaryForFunction(
        providerFunction,
        { fileName: 'src/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ).unresolved,
    ).toEqual([{ operation: 'db', site: 'src/app-runtime-db.ts:2' }]);
  });

  it('does not surface generated auth adapter construction as app touch graph work', () => {
    const providerSource = [
      'function authAdapterDb(): KovoPostgresSystemDb {',
      '  return getAppDatabase().systemDb({ operation: "write" });',
      '}',
      'export function createAuthAdapter() {',
      '  return usePostgresSystemDb(authAdapterDb(), (db) =>',
      '    drizzleAdapter(db, { provider: "pg", schema: authSchema }),',
      '  );',
      '}',
    ].join('\n');
    const authAdapterDb: ExtractedFunction = {
      bodyStart: providerSource.indexOf('{', providerSource.indexOf('authAdapterDb')) + 1,
      key: 'authAdapterDb',
      localCalls: [],
      name: 'authAdapterDb',
      readCalls: [],
      receiverNames: [],
      receiverParameters: [],
      unresolvedCalls: [
        {
          index:
            providerSource.indexOf('getAppDatabase().systemDb') -
            (providerSource.indexOf('{', providerSource.indexOf('authAdapterDb')) + 1),
          name: 'systemDb',
        },
      ],
      writeCalls: [],
    };
    const createAuthAdapter: ExtractedFunction = {
      bodyStart: providerSource.indexOf('{', providerSource.indexOf('createAuthAdapter')) + 1,
      key: 'createAuthAdapter',
      localCalls: [],
      name: 'createAuthAdapter',
      readCalls: [],
      receiverNames: [],
      receiverParameters: [],
      unresolvedCalls: [
        {
          index:
            providerSource.indexOf('authAdapterDb()') -
            (providerSource.indexOf('{', providerSource.indexOf('createAuthAdapter')) + 1),
          name: 'authAdapterDb',
        },
        {
          index:
            providerSource.indexOf('usePostgresSystemDb') -
            (providerSource.indexOf('{', providerSource.indexOf('createAuthAdapter')) + 1),
          name: 'usePostgresSystemDb',
        },
        {
          index:
            providerSource.indexOf('drizzleAdapter') -
            (providerSource.indexOf('{', providerSource.indexOf('createAuthAdapter')) + 1),
          name: 'drizzleAdapter',
        },
      ],
      writeCalls: [],
    };
    const createAuthAdapterCallback: ExtractedFunction = {
      bodyStart: providerSource.indexOf('=>') + 2,
      key: 'createAuthAdapter.callback',
      localCalls: [],
      name: 'createAuthAdapter.callback',
      readCalls: [],
      receiverNames: [],
      receiverParameters: [],
      unresolvedCalls: [
        {
          index: providerSource.indexOf('drizzleAdapter') - (providerSource.indexOf('=>') + 2),
          name: 'drizzleAdapter',
        },
      ],
      writeCalls: [],
    };

    expect(
      directSummaryForFunction(
        authAdapterDb,
        { fileName: 'src/_kovo/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ),
    ).toEqual({ reads: [], unresolved: [], writes: [] });
    expect(
      directSummaryForFunction(
        createAuthAdapter,
        { fileName: 'src/_kovo/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ),
    ).toEqual({ reads: [], unresolved: [], writes: [] });
    expect(
      directSummaryForFunction(
        createAuthAdapterCallback,
        { fileName: 'src/_kovo/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ),
    ).toEqual({ reads: [], unresolved: [], writes: [] });

    expect(
      directSummaryForFunction(
        authAdapterDb,
        { fileName: 'src/auth.ts', source: providerSource },
        new Map(),
        new Set(),
      ).unresolved,
    ).toEqual([{ operation: 'systemDb', site: 'src/auth.ts:2' }]);
    expect(
      directSummaryForFunction(
        {
          ...createAuthAdapter,
          unresolvedCalls: [...createAuthAdapter.unresolvedCalls, { index: 0, name: 'execute' }],
        },
        { fileName: 'src/_kovo/app-runtime-db.ts', source: providerSource },
        new Map(),
        new Set(),
      ).unresolved,
    ).toEqual([
      { operation: 'authAdapterDb', site: 'src/_kovo/app-runtime-db.ts:1' },
      { operation: 'usePostgresSystemDb', site: 'src/_kovo/app-runtime-db.ts:5' },
      { operation: 'drizzleAdapter', site: 'src/_kovo/app-runtime-db.ts:6' },
      { operation: 'execute', site: 'src/_kovo/app-runtime-db.ts:4' },
    ]);
  });

  it('reports KV435 when a mutation handler returns secret-classified query results to the wire', () => {
    const facts = extractStaticBuildAnalysisFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'src/session.mutations.ts',
          source: [
            'import { trustedReveal, type Secret } from "@kovojs/core";',
            '',
            'export const sessions = pgTable("sessions", {',
            '  id: text("id").primaryKey(),',
            '  name: text("name").notNull(),',
            '  token: text("token").notNull(),',
            '}, kovo({ domain: "session", key: "id", secret: ["token"] }));',
            '',
            'export const leakSession = mutation("session/leak", {',
            '  async handler(_input, request) {',
            '    const rows = await request.db.select({ id: sessions.id, token: sessions.token }).from(sessions);',
            '    return { tokens: rows.map((row) => row.token) };',
            '  },',
            '});',
            '',
            'export const listSessions = mutation("session/list", {',
            '  async handler(_input, request) {',
            '    const rows = await request.db.select({ id: sessions.id, name: sessions.name }).from(sessions);',
            '    return { rows };',
            '  },',
            '});',
            '',
            'export const revealSession = mutation("session/reveal", {',
            '  async handler(_input, request) {',
            '    const rows = await request.db.select({',
            '      id: sessions.id,',
            '      digest: trustedReveal(sessions.token as unknown as Secret<string>, { justification: "audited digest" }),',
            '    }).from(sessions);',
            '    return { rows };',
            '  },',
            '});',
          ].join('\n'),
        },
      ],
    });

    expect(facts.sqlSafetyDiagnostics.filter((diagnostic) => diagnostic.code === 'KV435')).toEqual([
      expect.objectContaining({
        code: 'KV435',
        message: expect.stringContaining('Mutation handler result session/leak'),
        site: 'src/session.mutations.ts:11',
      }),
    ]);
  });
});

function fixtureProject(): TouchGraphProjectOptions {
  return {
    files: [
      pgDatabaseTypes([
        'insert(table: unknown): { values(value: unknown): Promise<void> };',
        'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        'execute(query: unknown): Promise<void>;',
      ]),
      {
        fileName: 'src/cart.domain.ts',
        source: [
          'import { sql } from "@kovojs/drizzle";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          '',
          'export const carts = pgTable("carts", {}, kovo({ domain: "cart", key: "id", reference: true }));',
          '',
          'export const cartQuery = query("cart", {',
          '  output: s.object({ rows: s.array(s.string()) }),',
          '  reads: [carts],',
          '});',
          '',
          'export async function addCart(db: PgAsyncDatabase<any, any>, input: { id: string }) {',
          '  await db.insert(carts).values({ id: input.id });',
          '  await db.execute(sql.raw(input.id));',
          '}',
        ].join('\n'),
      },
    ],
  };
}
