import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface IdemResult {
  count: number;
}

export const idemDomain = domain('idem');

export const idemQuery = query('idem', {
  reads: [idemDomain],
  async load(_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>): Promise<IdemResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('idem query requires request.db');
    const rows = await db.query<{ count: number }>(
      staticSql`select count(*)::int as count from ledger_entries`,
    );
    return { count: Number(rows[0]?.count ?? 0) };
  },
});
