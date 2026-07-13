import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface IslandResult {
  installed: boolean;
}

export const islandDomain = domain('island');

export const islandQuery = query('island', {
  reads: [islandDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<IslandResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('island query requires request.db');
    const rows = await db.query<{ installed: number }>(
      staticSql`select installed from island_patch where id = 1`,
    );
    return { installed: rows[0]?.installed === 1 };
  },
});
