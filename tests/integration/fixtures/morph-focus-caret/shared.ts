import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface ProfileResult {
  version: number;
}

export const profileDomain = domain('profile');

export const profileQuery = query('profile', {
  reads: [profileDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<ProfileResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('profile query requires request.db');
    const rows = await db.query<{ version: number }>(
      staticSql`select version from profile where id = 1`,
    );
    return { version: Number(rows[0]?.version ?? 0) };
  },
});
