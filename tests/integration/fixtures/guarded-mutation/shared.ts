import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export const guardedCount = domain('guardedCount');

export async function readGuardedCount(db: KovoFixtureRequest['db']): Promise<{ count: number }> {
  const rows = await db.query<{ count: number }>(
    staticSql`select count from guarded_counter where id = 1`,
  );
  return { count: Number(rows[0]?.count ?? 0) };
}

export const guardedCountQuery = query('guardedCount', {
  reads: [guardedCount],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('guarded count query requires request.db');
    return readGuardedCount(db);
  },
});
