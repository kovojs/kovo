import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CsrfTotalResult {
  total: number;
}

export const csrfDomain = domain('csrf');

export const csrfQuery = query('csrf', {
  reads: [csrfDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<CsrfTotalResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('csrf query requires request.db');
    const rows = await db.query<{ total: number }>(
      staticSql`select coalesce(sum(amount), 0)::int as total from payments`,
    );
    return { total: Number(rows[0]?.total ?? 0) };
  },
});
