import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export type Presence = Record<string, unknown> & {
  status: string;
};

export const presenceDomain = domain('presence');

export async function readPresence(db: KovoFixtureRequest['db']): Promise<Presence> {
  const rows = await db.query<Presence>(
    staticSql`select status from broadcast_presence where id = 1`,
  );
  return rows[0] ?? { status: 'offline' };
}

export const presenceQuery = query('presence', {
  reads: [presenceDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('presence query requires request.db');
    return readPresence(db);
  },
});
