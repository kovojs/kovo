import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface ScrollResult {
  version: number;
}

export const scrollDomain = domain('scroll');

export const scrollQuery = query('scroll', {
  reads: [scrollDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<ScrollResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('scroll query requires request.db');
    const rows = await db.query<{ version: number }>(
      staticSql`select version from scroll_state where id = 1`,
    );
    return { version: Number(rows[0]?.version ?? 0) };
  },
});
