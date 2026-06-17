import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface EngineResult extends Record<string, unknown> {
  message: string;
}

export const engineDomain = domain('engine_matrix_state');

export async function readEngineState(db: KovoFixtureRequest['db']): Promise<EngineResult> {
  const rows = await db.query<EngineResult>('select message from engine_matrix_state where id = 1');
  return rows[0] ?? { message: 'Initial message' };
}

export const engineQuery = query('engine', {
  reads: [engineDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('engine matrix query requires request.db');
    return readEngineState(db);
  },
});
