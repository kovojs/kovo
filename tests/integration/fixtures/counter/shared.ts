// Shared query + domain for the counter fixture. This module declares no Kovo
// components, so the compiler plugin leaves it untouched.
import { domain, publicAccess, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CountResult {
  count: number;
}

// SPEC §10.1: the domain links the query's `reads` to the mutation's touch set.
export const counter = domain('counter');

export async function readCount(db: KovoFixtureRequest['db']): Promise<CountResult> {
  const rows = await db.query<{ value: number }>('select value from counter where id = 1');
  return { count: Number(rows[0]?.value ?? 0) };
}

export const countQuery = query('count', {
  access: publicAccess('integration fixture query count has no runtime guard'),
  reads: [counter],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>): Promise<CountResult> => {
    const db = context?.request?.db;
    if (!db) throw new Error('count query requires request.db');
    return readCount(db);
  },
});
