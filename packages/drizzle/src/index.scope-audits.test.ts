import { describe, expect, it } from 'vitest';

import {
  extractQueryFactsFromProject as extractQueryFactsFromProjectBase,
  scopeAuditsFromQueryFacts,
  type QueryFact,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes, withPgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle owner scope-audit producer (SPEC §10.3 IDOR)', () => {
  // The classifier is the security-critical core: it turns query facts into
  // scope-audit facts the CLI enforces as KV414. Test it directly on facts so the
  // classification is pinned independent of extraction details.
  it('classifies owner-domain reads: args (IDOR) / session (safe) / unscoped (fail-closed)', () => {
    const facts: QueryFact[] = [
      {
        query: 'cartByArg',
        reads: ['cart'],
        instanceKey: { domain: 'cart', key: 'arg:cartId' },
        shape: {},
        site: 'q.ts:1',
      },
      {
        query: 'cartBySession',
        reads: ['cart'],
        sessionAnchoredReads: ['cart'],
        shape: {},
        site: 'q.ts:2',
      },
      { query: 'cartUnscoped', reads: ['cart'], shape: {}, site: 'q.ts:3' },
      // product is not an owner domain -> never audited, even when arg-keyed.
      {
        query: 'productGrid',
        reads: ['product'],
        instanceKey: { domain: 'product', key: 'arg:id' },
        shape: {},
        site: 'q.ts:4',
      },
    ];

    expect(
      scopeAuditsFromQueryFacts(facts, ['cart']).map((audit) => ({
        name: audit.name,
        scope: audit.scope,
      })),
    ).toEqual([
      { name: 'cartByArg', scope: 'args' },
      { name: 'cartBySession', scope: 'session' },
      { name: 'cartUnscoped', scope: 'unscoped' },
    ]);
  });

  // The extractor populates `sessionAnchoredReads` for a DIRECT `req.session.*`
  // predicate. (Apps that bind the session into a local first need data-flow
  // tracing — tracked as the remaining producer work; this detects the direct form.)
  it('detects a direct req.session-anchored owner read in extraction', () => {
    const facts = extractQueryFactsFromProjectBase(
      withPgDatabaseTypes({
        files: [
          pgDatabaseTypes([
            'select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          ]),
          {
            fileName: 'cart.queries.ts',
            source: [
              'import type { PgDatabase } from "drizzle-orm/pg-core";',
              '',
              'export const carts = pgTable("carts", { id: text("id").primaryKey(), userId: text("user_id").notNull() }, kovo({ domain: "cart", owner: (t) => t.userId }));',
              '',
              'export const cartQuery = query("cart", {',
              '  output: s.object({ id: s.string() }),',
              '  async load(input, db: PgDatabase<any, any, any>) {',
              '    return db.select({ id: carts.id }).from(carts).where(eq(carts.id, input.session.cartId));',
              '  },',
              '});',
            ].join('\n'),
          },
        ],
      }),
    );

    // `input.session.cartId` is rooted at `input` (an args field named session),
    // so it is NOT treated as the trusted principal — fail-closed to unscoped.
    expect(facts[0]?.sessionAnchoredReads).toBeUndefined();
    expect(scopeAuditsFromQueryFacts(facts, ['cart']).map((a) => a.scope)).toEqual(['unscoped']);
  });
});
