import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/integration/define';

export interface DealResult {
  contact: { name: string } | null;
}

export const dealDomain = domain('deal');

export async function readDeal(db: KovoFixtureRequest['db']): Promise<DealResult> {
  const rows = await db.query<{ contact_name: string | null }>(
    'select contact_name from deal where id = 1',
  );
  const name = rows[0]?.contact_name ?? null;
  return { contact: name === null ? null : { name } };
}

export const dealQuery = query('deal', {
  reads: [dealDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('deal query requires request.db');
    return readDeal(db);
  },
});
