import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface IdemConcurrentResult {
  count: number;
}

export const idemConcurrentDomain = domain('idem');

export const idemConcurrentQuery = query('idem', {
  reads: [idemConcurrentDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<IdemConcurrentResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('concurrent idem query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*)::int as count from concurrent_entries`,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  },
});
