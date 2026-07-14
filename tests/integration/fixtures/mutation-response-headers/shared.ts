import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const headersDomain = domain('headers');

export const headersQuery = query('headers', {
  reads: [headersDomain],
  load: async (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('mutation response headers query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*)::int as count from header_events`,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  },
});
