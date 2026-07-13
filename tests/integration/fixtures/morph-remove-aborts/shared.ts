import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export type MorphStage = 'active' | 'removed';

export interface MorphAbortResult {
  stage: MorphStage;
}

export const morphAbortDomain = domain('morph-abort');

export const morphAbortQuery = query('morphAbort', {
  reads: [morphAbortDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<MorphAbortResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('morph abort query requires request.db');
    const rows = await db.query<{ stage: MorphStage }>(
      staticSql`select stage from morph_abort_state where id = 1`,
    );
    return { stage: rows[0]?.stage ?? 'active' };
  },
});
