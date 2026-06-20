import { describe, expect, it } from 'vitest';

import {
  extractOwnerAuditFromProject,
  scopeAuditsFromQueryFacts,
  type QueryFact,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle owner scope-audit producer (SPEC §10.3 IDOR)', () => {
  // The classifier is the security-critical core: a client-arg-keyed owner read is
  // the IDOR signal (`args`); a directly session-anchored read is safe; anything
  // else (e.g. keyed by a local bound from the session) emits NO fact — so a safe
  // app is never false-positived, without needing session data-flow tracing.
  it('emits a fact only for arg-keyed (IDOR) and direct-session owner reads', () => {
    const facts: QueryFact[] = [
      {
        query: 'orderById',
        reads: ['order'],
        instanceKey: { domain: 'order', key: 'arg:id' },
        shape: {},
        site: 'q.ts:1',
      },
      {
        query: 'orderBySession',
        reads: ['order'],
        sessionAnchoredReads: ['order'],
        shape: {},
        site: 'q.ts:2',
      },
      // keyed by a local var (not input.*) -> not the IDOR pattern -> no fact.
      { query: 'orderMine', reads: ['order'], shape: {}, site: 'q.ts:3' },
      // product is not owner-annotated -> never audited.
      {
        query: 'productGrid',
        reads: ['product'],
        instanceKey: { domain: 'product', key: 'arg:id' },
        shape: {},
        site: 'q.ts:4',
      },
    ];

    expect(
      scopeAuditsFromQueryFacts(facts, ['order']).map((a) => ({ name: a.name, scope: a.scope })),
    ).toEqual([
      { name: 'orderById', scope: 'args' },
      { name: 'orderBySession', scope: 'session' },
    ]);
  });

  // End-to-end producer: project source -> ownerDomains + scopeAudits.
  it('extracts ownerDomains + scopeAudits from a project, flagging only the arg-keyed read', () => {
    const audit = extractOwnerAuditFromProject(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'order.queries.ts',
            source: [
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const orders = pgTable("orders", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "order", key: (t) => t.id, owner: (t) => t.userId }));',
              '',
              'export const orderById = query("order", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgDatabase<any, any, any>) {',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, input.id));',
              '  },',
              '});',
              '',
              'export const orderMine = query("orderMine", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgDatabase<any, any, any>) {',
              '    const mineId = "u1";',
              '    return db.select({ id: orders.id }).from(orders).where(eq(orders.userId, mineId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(audit.ownerDomains).toEqual([{ domain: 'order', owner: 'userId' }]);
    // Only the client-arg-keyed read is flagged; the local-var-keyed read emits nothing.
    expect(
      audit.scopeAudits.map((a) => ({ name: a.name, domain: a.domain, scope: a.scope })),
    ).toEqual([{ name: 'order', domain: 'order', scope: 'args' }]);
  });
});
