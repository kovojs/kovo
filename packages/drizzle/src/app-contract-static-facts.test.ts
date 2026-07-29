import { describe, expect, it } from 'vitest';

import {
  analyzeSqlSafetyFromProject,
  createProjectExtraction,
  extractStaticBuildAnalysisFactsFromProject,
  isKovoServerCalleeExpression,
  type CompilerOwnedAppContractMemberName,
  type CompilerOwnedAppContractStaticFact,
} from '@kovojs/drizzle/internal/static';
import { SyntaxKind } from 'ts-morph';
import { pgDatabaseTypes } from './test-helpers.js';

const OWNER_KEY = 'app-owner:crm';

describe('@kovojs/drizzle compiler-owned app-contract static facts', () => {
  it('recognizes exact app query/mutation declarations while retaining raw db.query KV422', () => {
    const fileName = 'src/contacts.ts';
    const source = appContractAggregateSource();
    const appContractStaticFacts = factsForMembers(fileName, source, [
      'query',
      'mutation',
      'route',
      'endpoint',
      'publicAccess',
    ]);
    const extraction = createProjectExtraction({
      appContractStaticFacts,
      files: [{ fileName, source }],
    });
    try {
      const queryCall = extraction.sourceFiles[0]!.getDescendantsOfKind(
        SyntaxKind.CallExpression,
      ).find((call) => call.getExpression().getText() === 'app.query');
      expect(queryCall).toBeDefined();
      expect(isKovoServerCalleeExpression(queryCall!.getExpression(), 'query')).toBe(true);
    } finally {
      extraction.dispose();
    }
    const facts = extractStaticBuildAnalysisFactsFromProject({
      appContractStaticFacts,
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'query(query: unknown): Promise<unknown>;',
          'select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
        ]),
        { fileName, source },
      ],
    });

    // SPEC §10.2/§10.3: the app facade feeds the same query/touch extraction as the canonical
    // declaration factories. It does not create a second registry or a weaker spelling matcher.
    expect(facts.queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query: 'contacts/list',
          reads: ['contact'],
        }),
      ]),
    );
    expect(facts.touchGraph['contacts/save']).toMatchObject({
      touches: [
        expect.objectContaining({
          domain: 'contact',
          via: 'contacts',
        }),
      ],
      unresolved: [],
    });

    const kv422 = facts.sqlSafetyDiagnostics.filter(({ code }) => code === 'KV422');
    expect(kv422).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('query() receives'),
        site: siteFor(source, fileName, 'await db.query(input.sql)'),
      }),
    ]);
    for (const appCall of [
      'app.query(',
      'app.mutation(',
      'app.route(',
      'app.endpoint(',
      'app.publicAccess(',
    ]) {
      expect(kv422).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ site: siteFor(source, fileName, appCall) }),
        ]),
      );
    }
  });

  it('does not retain app authority after the exact project extraction is disposed', () => {
    const fileName = 'src/contacts.ts';
    const source = appContractAggregateSource();
    const files = [
      pgDatabaseTypes(['query(query: unknown): Promise<unknown>;']),
      { fileName, source },
    ];

    expect(
      analyzeSqlSafetyFromProject({
        appContractStaticFacts: factsForMembers(fileName, source, [
          'query',
          'mutation',
          'route',
          'endpoint',
          'publicAccess',
        ]),
        files,
      }).filter(
        ({ code, site }) => code === 'KV422' && site === siteFor(source, fileName, 'app.route('),
      ),
    ).toEqual([]);

    expect(
      analyzeSqlSafetyFromProject({ files }).filter(
        ({ code, site }) => code === 'KV422' && site === siteFor(source, fileName, 'app.route('),
      ),
    ).toHaveLength(1);
  });

  it('rejects stale snapshots, filename guessing, bad spans, members, owners, and overlaps', () => {
    const fileName = 'src/app.ts';
    const source = [
      'declare const app: { query(config: unknown): unknown };',
      'app.query({});',
    ].join('\n');
    const valid = factForMember(fileName, source, 'query');
    const analyze = (appContractStaticFacts: readonly CompilerOwnedAppContractStaticFact[]) => () =>
      analyzeSqlSafetyFromProject({
        appContractStaticFacts,
        files: [{ fileName, source }],
      });

    expect(analyze([{ ...valid, source: `${source}\n// stale` }])).toThrow(
      /stale source snapshot/u,
    );
    expect(analyze([{ ...valid, fileName: 'app.ts' }])).toThrow(/not an exact project filename/u);
    expect(analyze([{ ...valid, start: valid.start + 1 }])).toThrow(/does not name the exact/u);
    expect(
      analyze([
        {
          ...valid,
          memberName: 'route',
        },
      ]),
    ).toThrow(/does not name the exact \.route/u);
    expect(
      analyze([
        {
          ...valid,
          memberName: 'execute' as CompilerOwnedAppContractMemberName,
        },
      ]),
    ).toThrow(/unsupported member execute/u);
    expect(analyze([{ ...valid, ownerKey: '   ' }])).toThrow(/invalid owner key/u);
    expect(analyze([valid, { ...valid }])).toThrow(/duplicate facts/u);
    expect(
      analyze([
        valid,
        {
          ...valid,
          end: valid.end + 1,
          memberName: 'route',
          start: valid.start + 1,
        },
      ]),
    ).toThrow(/overlapping facts/u);
  });

  it('rejects computed members and unbounded property-access claims', () => {
    const fileName = 'src/computed.ts';
    const computedSource = [
      'declare const app: { query(config: unknown): unknown };',
      "app['query']({});",
    ].join('\n');
    const computedStart = computedSource.indexOf("app['query']");
    expect(() =>
      analyzeSqlSafetyFromProject({
        appContractStaticFacts: [
          {
            end: computedStart + "app['query']".length,
            fileName,
            memberName: 'query',
            ownerKey: OWNER_KEY,
            source: computedSource,
            start: computedStart,
          },
        ],
        files: [{ fileName, source: computedSource }],
      }),
    ).toThrow(/does not name the exact/u);

    const prefix = ' '.repeat(4_100);
    const unboundedSource = `${prefix}app.query({});`;
    expect(() =>
      analyzeSqlSafetyFromProject({
        appContractStaticFacts: [
          {
            end: prefix.length + 'app.query'.length,
            fileName,
            memberName: 'query',
            ownerKey: OWNER_KEY,
            source: unboundedSource,
            start: 0,
          },
        ],
        files: [{ fileName, source: unboundedSource }],
      }),
    ).toThrow(/invalid or unbounded span/u);
  });
});

function appContractAggregateSource(): string {
  return [
    'import { kovo } from "@kovojs/drizzle";',
    'import { pgTable, text, type PgAsyncDatabase } from "drizzle-orm/pg-core";',
    '',
    'declare const app: {',
    '  readonly db: PgAsyncDatabase<any, any>;',
    '  query(name: string, config: unknown): unknown;',
    '  mutation(name: string, config: unknown): unknown;',
    '  route(path: string, config: unknown): unknown;',
    '  endpoint(path: string, config: unknown): unknown;',
    '  publicAccess(reason: string): unknown;',
    '};',
    '',
    'interface ManagedDbCarrier {',
    '  readonly proof: { readonly db: PgAsyncDatabase<any, any> };',
    '  insert(table: unknown): { values(value: unknown): Promise<void> };',
    '  select(value?: unknown): { from(table: unknown): Promise<unknown[]> };',
    '}',
    '',
    'export const contacts = pgTable("contacts", {',
    '  id: text("id").primaryKey(),',
    '}, kovo((columns) => ({ domain: "contact", key: "id", reference: true })));',
    '',
    'export const contactList = app.query("contacts/list", {',
    '  async load(_input: unknown, context: { db: ManagedDbCarrier }) {',
    '    const db = context.db;',
    '    return db.select().from(contacts);',
    '  },',
    '});',
    '',
    'export const saveContact = app.mutation("contacts/save", {',
    '  async handler(input: { id: string }, request: { db: ManagedDbCarrier }) {',
    '    await request.db.insert(contacts).values({ id: input.id });',
    '  },',
    '});',
    '',
    'app.route("/contacts", {});',
    'app.endpoint("/status", {});',
    'app.publicAccess("anonymous");',
    '',
    'export async function unsafe(input: { sql: string }, db: PgAsyncDatabase<any, any>) {',
    '  await db.query(input.sql);',
    '}',
  ].join('\n');
}

function factsForMembers(
  fileName: string,
  source: string,
  memberNames: readonly CompilerOwnedAppContractMemberName[],
): CompilerOwnedAppContractStaticFact[] {
  return memberNames.map((memberName) => factForMember(fileName, source, memberName));
}

function factForMember(
  fileName: string,
  source: string,
  memberName: CompilerOwnedAppContractMemberName,
): CompilerOwnedAppContractStaticFact {
  const expression = `app.${memberName}`;
  const start = source.indexOf(expression);
  if (start < 0) throw new Error(`Missing ${expression} in fixture`);
  return {
    end: start + expression.length,
    fileName,
    memberName,
    ownerKey: OWNER_KEY,
    source,
    start,
  };
}

function siteFor(source: string, fileName: string, needle: string): string {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Missing ${needle} in fixture`);
  return `${fileName}:${source.slice(0, index).split('\n').length}`;
}
