import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface ParentResult {
  version: number;
}

export const parentDomain = domain('parent');

export const parentQuery = query('parent', {
  reads: [parentDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<ParentResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('parent query requires request.db');
    const rows = await db.query<{ version: number }>(
      staticSql`select version from nested_island_parent where id = 1`,
    );
    return { version: Number(rows[0]?.version ?? 0) };
  },
});
