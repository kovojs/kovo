import { domain, publicAccess, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface CardResult {
  [key: string]: unknown;
  label: string;
  status: string;
  text: string;
}

export const cardDomain = domain('card');

export async function readCard(db: KovoFixtureRequest['db']): Promise<CardResult> {
  const rows = await db.query<CardResult>(
    'select text, label, status from card_state where id = 1',
  );
  return rows[0] ?? { label: 'Initial card', status: 'idle', text: 'Initial text' };
}

export const cardQuery = query('card', {
  access: publicAccess('integration fixture query card has no runtime guard'),
  reads: [cardDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('card query requires request.db');
    return readCard(db);
  },
});
