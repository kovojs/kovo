import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface RefetchResult {
  [key: string]: unknown;
  message: string;
}

export const refetchDomain = domain('refetch');

export async function readRefetch(db: KovoFixtureRequest['db']): Promise<RefetchResult> {
  const rows = await db.query<RefetchResult>('select message from refetch_state where id = 1');
  return rows[0] ?? { message: 'Initial message' };
}

export const refetchQuery = query('refetch', {
  reads: [refetchDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('refetch query requires request.db');
    return readRefetch(db);
  },
});
