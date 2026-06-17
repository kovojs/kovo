import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/integration/define';

export interface ProfileResult {
  [key: string]: unknown;
  name: string;
  status: string;
}

export const profileDomain = domain('profile');

export async function readProfile(db: KovoFixtureRequest['db']): Promise<ProfileResult> {
  const rows = await db.query<ProfileResult>('select name, status from profile where id = 1');
  return rows[0] ?? { name: 'Ada', status: 'draft' };
}

export const profileQuery = query('profile', {
  reads: [profileDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('profile query requires request.db');
    return readProfile(db);
  },
});
