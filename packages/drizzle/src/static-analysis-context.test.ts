import { describe, expect, it } from 'vitest';

import {
  analyzeSqlSafetyFromProject,
  diagnosticsForQueryFacts,
  extractMassAssignmentFromProject,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  extractQueryWriteReachabilityFromProject,
  extractStaticBuildAnalysisFactsFromProject,
  extractToctouFromProject,
  extractTouchGraphFromProject,
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
      scopeAudits: ownerAudit.scopeAudits,
      sqlSafetyDiagnostics: [
        ...analyzeSqlSafetyFromProject(project),
        ...diagnosticsForQueryFacts(queries),
      ],
      toctouFacts: extractToctouFromProject(project),
      touchGraph: extractTouchGraphFromProject(project),
    });
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
          'export const carts = pgTable("carts", {}, kovo({ domain: "cart", key: "id" }));',
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
