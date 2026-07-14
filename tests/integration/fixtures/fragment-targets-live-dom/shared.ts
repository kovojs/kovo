import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const wireDomain = domain('wire');

export const wireQuery = query('wire', {
  reads: [wireDomain],
  load: async (
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<{ stage: number }> => {
    const db = context?.request?.db;
    if (!db) throw new Error('live DOM wire query requires request.db');
    const rows = await db.query<{ stage: number }>(
      staticSql`select stage from live_dom_state where id = 1`,
    );
    return { stage: Number(rows[0]?.stage ?? 0) };
  },
});
