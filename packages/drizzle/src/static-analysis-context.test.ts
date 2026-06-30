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
