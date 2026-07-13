import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface PanelResult {
  value: number;
}

export const panelDomain = domain('panel');

export const panelQuery = query('panel', {
  reads: [panelDomain],
  async load(
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<PanelResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('panel query requires request.db');
    const rows = await db.query<{ value: number }>(staticSql`select value from panel where id = 1`);
    return { value: Number(rows[0]?.value ?? 0) };
  },
});
