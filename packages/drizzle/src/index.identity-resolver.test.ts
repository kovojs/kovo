import { describe, expect, it } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';

import {
  analyzeSqlSafetyFromProject,
  createProjectExtraction,
  expressionResolvesToFrameworkExport,
  extractMassAssignmentFromProject,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  extractTouchGraphFromProject,
  frameworkExport,
  frameworkIdentityExpressionKindRows,
  isDrizzleDatabaseType,
  type SourceFileInput,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

const DB = pgDatabaseTypes([
  'execute(query: unknown): Promise<void>;',
  'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
  'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
]);

const bridgeFile: SourceFileInput = {
  fileName: 'framework.ts',
  source: [
    'export { domain as makeDomain, mutation as mutate, query as read, task as runTask, write as writer } from "@kovojs/server";',
    'export type { Reader as AppReader } from "@kovojs/server";',
    'export { kovo as annotate, sql as ksql, trustedSql as trust } from "@kovojs/drizzle";',
  ].join('\n'),
};

const kovoServerReaderTypes: SourceFileInput = {
  fileName: 'kovo-server-reader-types.d.ts',
  source: [
    'declare module "@kovojs/server" {',
    '  export type Reader<Db> = Omit<Db, "insert" | "update" | "delete" | "execute" | "run" | "batch">;',
    '}',
  ].join('\n'),
};

const schemaViaBridge: SourceFileInput = {
  fileName: 'schema.ts',
  source: [
    'import * as framework from "./framework";',
    'const { annotate } = framework;',
    '',
    'export const accounts = pgTable("accounts", {',
    '  id: text("id").primaryKey(),',
    '  ownerId: text("owner_id").notNull(),',
    '  role: text("role").notNull(),',
    '}, annotate({ domain: "account", key: "id", owner: "ownerId", governed: ["role"] }));',
  ].join('\n'),
};

const usageViaBridge: SourceFileInput = {
  fileName: 'account.domain.ts',
  source: [
    'import { eq } from "drizzle-orm";',
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import * as framework from "./framework";',
    'import { accounts } from "./schema";',
    'const { makeDomain: domainAlias, writer: writeAlias, read: queryAlias, mutate: mutationAlias, ksql: sqlAlias, trust: trustedAlias } = framework;',
    '',
    'export const account = domainAlias({',
    '  promote: writeAlias(async (db: PgAsyncDatabase<any, any>, input: { id: string; role: string }) => {',
    '    await db.update(accounts).set({ role: input.role }).where(eq(accounts.id, input.id));',
    '  }),',
    '});',
    '',
    'export const accountQuery = queryAlias("account/reexported", {',
    '  load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
    '    return db.select({ id: accounts.id, role: accounts.role }).from(accounts).where(eq(accounts.id, input.id));',
    '  },',
    '});',
    '',
    'export const saveAccount = mutationAlias("save-account", {',
    '  async handler(input: { id: string; role: string }, request: { db: PgAsyncDatabase<any, any> }) {',
    '    await request.db.update(accounts).set({ role: input.role }).where(eq(accounts.id, input.id));',
    '  },',
    '});',
  ].join('\n'),
};

const sqlUsageViaBridge: SourceFileInput = {
  fileName: 'report.ts',
  source: [
    'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
    'import * as framework from "./framework";',
    'const { ksql: sqlAlias, trust: trustedAlias } = framework;',
    '',
    'export async function report(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
    '  await db.execute(trustedAlias(sqlAlias`select * from accounts where id = ${input.id}`, { justification: "parameterized report" }));',
    '}',
  ].join('\n'),
};

function expectedExpressionSyntaxKinds(): readonly SyntaxKind[] {
  return [
    SyntaxKind.PropertyAccessExpression,
    SyntaxKind.ElementAccessExpression,
    SyntaxKind.NewExpression,
    SyntaxKind.CallExpression,
    SyntaxKind.JsxElement,
    SyntaxKind.JsxSelfClosingElement,
    SyntaxKind.JsxFragment,
    SyntaxKind.TaggedTemplateExpression,
    SyntaxKind.ArrayLiteralExpression,
    SyntaxKind.ParenthesizedExpression,
    SyntaxKind.ObjectLiteralExpression,
    SyntaxKind.ClassExpression,
    SyntaxKind.FunctionExpression,
    SyntaxKind.Identifier,
    SyntaxKind.PrivateIdentifier,
    SyntaxKind.RegularExpressionLiteral,
    SyntaxKind.NumericLiteral,
    SyntaxKind.BigIntLiteral,
    SyntaxKind.StringLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateExpression,
    SyntaxKind.FalseKeyword,
    SyntaxKind.NullKeyword,
    SyntaxKind.ThisKeyword,
    SyntaxKind.TrueKeyword,
    SyntaxKind.SuperKeyword,
    SyntaxKind.NonNullExpression,
    SyntaxKind.ExpressionWithTypeArguments,
    SyntaxKind.MetaProperty,
    SyntaxKind.ImportKeyword,
    SyntaxKind.MissingDeclaration,
    SyntaxKind.PrefixUnaryExpression,
    SyntaxKind.PostfixUnaryExpression,
    SyntaxKind.DeleteExpression,
    SyntaxKind.TypeOfExpression,
    SyntaxKind.VoidExpression,
    SyntaxKind.AwaitExpression,
    SyntaxKind.TypeAssertionExpression,
    SyntaxKind.ConditionalExpression,
    SyntaxKind.YieldExpression,
    SyntaxKind.ArrowFunction,
    SyntaxKind.BinaryExpression,
    SyntaxKind.SpreadElement,
    SyntaxKind.AsExpression,
    SyntaxKind.OmittedExpression,
    SyntaxKind.CommaListExpression,
    SyntaxKind.PartiallyEmittedExpression,
    SyntaxKind.SatisfiesExpression,
  ];
}

describe('@kovojs/drizzle static framework identity resolver', () => {
  it('exposes expression-kind resolver coverage with an explicit default row', () => {
    const expressionRows = frameworkIdentityExpressionKindRows.filter(
      (row) => row.kind !== 'default',
    );
    const resolutionByKind = new Map(expressionRows.map((row) => [row.kind, row.resolution]));
    const statusByKind = new Map(expressionRows.map((row) => [row.kind, row.status]));

    expect(frameworkIdentityExpressionKindRows.at(-1)).toEqual({
      kind: 'default',
      resolution: 'fail-closed',
      status: 'fails-closed',
    });
    expect(new Set(expressionRows.map((row) => row.kind))).toEqual(
      new Set(expectedExpressionSyntaxKinds()),
    );
    expect(frameworkIdentityExpressionKindRows).toHaveLength(
      expectedExpressionSyntaxKinds().length + 1,
    );
    expect(new Set(frameworkIdentityExpressionKindRows.map((row) => row.status))).toEqual(
      new Set(['resolved', 'fails-closed']),
    );
    expect(resolutionByKind.get(SyntaxKind.Identifier)).toBe('resolve-identifier');
    expect(statusByKind.get(SyntaxKind.Identifier)).toBe('resolved');
    expect(resolutionByKind.get(SyntaxKind.PropertyAccessExpression)).toBe(
      'resolve-property-access',
    );
    expect(statusByKind.get(SyntaxKind.PropertyAccessExpression)).toBe('resolved');
    expect(resolutionByKind.get(SyntaxKind.ElementAccessExpression)).toBe('resolve-element-access');
    expect(statusByKind.get(SyntaxKind.ElementAccessExpression)).toBe('resolved');
    expect(resolutionByKind.get(SyntaxKind.ParenthesizedExpression)).toBe('unwrap-expression');
    expect(statusByKind.get(SyntaxKind.ParenthesizedExpression)).toBe('resolved');
    expect(resolutionByKind.get(SyntaxKind.AsExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(SyntaxKind.SatisfiesExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(SyntaxKind.TypeAssertionExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(SyntaxKind.NonNullExpression)).toBe('unwrap-expression');
    expect(resolutionByKind.get(SyntaxKind.CallExpression)).toBe('fail-closed');
    expect(statusByKind.get(SyntaxKind.CallExpression)).toBe('fails-closed');
    expect(resolutionByKind.get(SyntaxKind.BinaryExpression)).toBe('fail-closed');
    expect(statusByKind.get(SyntaxKind.BinaryExpression)).toBe('fails-closed');
  });

  it('recognizes re-exported, destructured, and aliased framework constructs', () => {
    const files = [DB, bridgeFile, schemaViaBridge, usageViaBridge];

    const graph = extractTouchGraphFromProject(withPgDatabaseTypes({ files }));
    expect(Object.keys(graph).sort()).toEqual(['account.promote', 'save-account']);
    expect(graph['account.promote']?.touches).toEqual([
      expect.objectContaining({ domain: 'account', keys: 'arg:id', via: 'accounts' }),
    ]);
    expect(graph['save-account']?.touches).toEqual([
      expect.objectContaining({ domain: 'account', keys: 'arg:id', via: 'accounts' }),
    ]);

    expect(extractQueryFactsFromProject(withPgDatabaseTypes({ files }))).toEqual([
      expect.objectContaining({ query: 'account/reexported', reads: ['account'] }),
    ]);

    expect(extractOwnerAuditFromProject(withPgDatabaseTypes({ files })).ownerDomains).toEqual([
      { domain: 'account', owner: 'ownerId' },
    ]);

    const massAssignmentFacts = extractMassAssignmentFromProject(
      withPgDatabaseTypes({ files }),
    ).map((fact) => ({
      column: fact.column,
      name: fact.name,
      provenance: fact.provenance,
      via: fact.via,
    }));
    expect(massAssignmentFacts).toHaveLength(2);
    expect(massAssignmentFacts).toEqual(
      expect.arrayContaining([
        { column: 'role', name: 'account.promote', provenance: 'input', via: 'set' },
      ]),
    );
    expect(massAssignmentFacts.every((fact) => fact.provenance === 'input')).toBe(true);

    expect(
      analyzeSqlSafetyFromProject(
        withPgDatabaseTypes({ files: [DB, bridgeFile, sqlUsageViaBridge] }),
      ),
    ).toEqual([]);
  });

  it('does not trust local lookalikes with framework export names', () => {
    const files = [
      DB,
      {
        fileName: 'fake.ts',
        source: [
          'import { eq } from "drizzle-orm";',
          'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
          'function kovo<T>(value: T): T { return value; }',
          'function query(_name: string, definition: unknown): unknown { return definition; }',
          'function trustedSql<T>(value: T): T { return value; }',
          'export const accounts = pgTable("accounts", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), role: text("role").notNull() }, kovo({ domain: "account", key: "id", owner: "ownerId", governed: ["role"] }));',
          'export const fakeQuery = query("fake", {',
          '  load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
          '    return db.select({ id: accounts.id, role: accounts.role }).from(accounts).where(eq(accounts.id, input.id));',
          '  },',
          '});',
          'export async function report(input: { clause: string }, db: PgAsyncDatabase<any, any>) {',
          '  await db.execute(trustedSql("select * from accounts where " + input.clause));',
          '}',
        ].join('\n'),
      },
    ];

    expect(extractQueryFactsFromProject(withPgDatabaseTypes({ files }))).toEqual([]);
    expect(extractOwnerAuditFromProject(withPgDatabaseTypes({ files })).ownerDomains).toEqual([]);
    expect(extractMassAssignmentFromProject(withPgDatabaseTypes({ files }))).toEqual([]);
    expect(analyzeSqlSafetyFromProject(withPgDatabaseTypes({ files }))).toEqual([
      expect.objectContaining({ code: 'KV422' }),
    ]);
  });

  it('recognizes re-exported Reader type identity for Drizzle receiver proof', () => {
    const extraction = createProjectExtraction({
      files: [
        DB,
        kovoServerReaderTypes,
        bridgeFile,
        {
          fileName: 'reader.ts',
          source: [
            'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
            'import type { AppReader } from "./framework";',
            'type AppDb = PgAsyncDatabase<any, any>;',
            'declare const db: AppReader<AppDb>;',
          ].join('\n'),
        },
      ],
    });

    try {
      const sourceFile = extraction.sourceFiles.find((file) => file.getBaseName() === 'reader.ts');
      expect(sourceFile).toBeDefined();
      const type = sourceFile!.getVariableDeclarationOrThrow('db').getType();
      expect(isDrizzleDatabaseType(type)).toBe(true);
    } finally {
      extraction.dispose();
    }
  });

  it('resolves task through re-export and destructuring without trusting local shadows', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/app/framework.ts', bridgeFile.source);
    const sourceFile = project.createSourceFile(
      '/app/tasks.ts',
      [
        'import * as framework from "./framework";',
        'const { runTask: taskAlias } = framework;',
        'export const cleanup = taskAlias("cleanup", { run() {} });',
        'function task(_key: string, definition: unknown): unknown { return definition; }',
        'export const fake = task("fake", { run() {} });',
      ].join('\n'),
    );

    const taskIdentity = frameworkExport('@kovojs/server', 'task');
    const taskCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === 'taskAlias');
    const localShadowCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === 'task');

    expect(taskCall).toBeDefined();
    expect(localShadowCall).toBeDefined();
    expect(expressionResolvesToFrameworkExport(taskCall!.getExpression(), taskIdentity)).toBe(true);
    expect(
      expressionResolvesToFrameworkExport(localShadowCall!.getExpression(), taskIdentity),
    ).toBe(false);
  });

  it('recognizes catalog-backed root, subpath, and local re-export identities', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      '/app/framework.ts',
      [
        'export { query as dataQuery, s as dataSchema } from "@kovojs/server/api/data";',
        'export { trustedAssign as grantInput } from "@kovojs/server/write-governance";',
        'export { sql as kovoSql, trustedSql as reviewedSql } from "@kovojs/drizzle";',
      ].join('\n'),
    );
    const sourceFile = project.createSourceFile(
      '/app/catalog.ts',
      [
        'import { query as rootQuery, s as rootSchema } from "@kovojs/server";',
        'import * as framework from "./framework";',
        'const { dataQuery, dataSchema, grantInput, kovoSql, reviewedSql } = framework;',
        '',
        'export const fromRoot = rootQuery({ output: rootSchema.object({ id: rootSchema.string() }), load: () => ({ id: "1" }) });',
        'export const fromSubpath = dataQuery({ output: dataSchema.object({ id: dataSchema.string() }), load: () => ({ id: "1" }) });',
        'export const role = grantInput("admin", "catalog identity test");',
        'export const statement = reviewedSql(kovoSql`select 1`, { justification: "catalog identity test" });',
        'function query(value: unknown): unknown { return value; }',
        'export const fake = query({ load: () => ({}) });',
      ].join('\n'),
    );

    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const expressionByText = new Map(calls.map((call) => [call.getExpression().getText(), call]));

    expect(
      expressionResolvesToFrameworkExport(
        expressionByText.get('rootQuery')!.getExpression(),
        frameworkExport('@kovojs/server', 'query'),
      ),
    ).toBe(true);
    expect(
      expressionResolvesToFrameworkExport(
        expressionByText.get('dataQuery')!.getExpression(),
        frameworkExport('@kovojs/server', 'query'),
      ),
    ).toBe(true);
    expect(
      expressionResolvesToFrameworkExport(
        expressionByText.get('grantInput')!.getExpression(),
        frameworkExport('@kovojs/server', 'trustedAssign'),
      ),
    ).toBe(true);
    expect(
      expressionResolvesToFrameworkExport(
        expressionByText.get('reviewedSql')!.getExpression(),
        frameworkExport('@kovojs/drizzle', 'trustedSql'),
      ),
    ).toBe(true);
    expect(
      expressionResolvesToFrameworkExport(
        expressionByText.get('query')!.getExpression(),
        frameworkExport('@kovojs/server', 'query'),
      ),
    ).toBe(false);
  });

  it('resolves literal element namespace members and star barrels without trusting computed keys', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      '/app/server-root.ts',
      'export { task as runTask } from "@kovojs/server";',
    );
    project.createSourceFile('/app/server-barrel.ts', 'export * from "./server-root";');
    const sourceFile = project.createSourceFile(
      '/app/tasks.ts',
      [
        'import * as framework from "./server-barrel.js";',
        'const method = "runTask";',
        'export const cleanup = framework["runTask"]("cleanup", { run() {} });',
        'export const opaque = framework[method]("opaque", { run() {} });',
      ].join('\n'),
    );

    const taskIdentity = frameworkExport('@kovojs/server', 'task');
    const taskCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === 'framework["runTask"]');
    const computedCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getExpression().getText() === 'framework[method]');

    expect(taskCall).toBeDefined();
    expect(computedCall).toBeDefined();
    expect(expressionResolvesToFrameworkExport(taskCall!.getExpression(), taskIdentity)).toBe(true);
    expect(expressionResolvesToFrameworkExport(computedCall!.getExpression(), taskIdentity)).toBe(
      false,
    );
  });
});
