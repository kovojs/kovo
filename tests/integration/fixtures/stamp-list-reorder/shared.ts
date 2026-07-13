import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface BoardItem {
  [key: string]: unknown;
  id: string;
  label: string;
  rank: number;
}

export interface BoardResult {
  items: BoardItem[];
}

export const boardDomain = domain('board');

export async function readBoard(db: KovoFixtureRequest['db']): Promise<BoardResult> {
  const items = await db.query<BoardItem>(
    staticSql`select id, label, rank from board_item order by rank asc`,
  );
  return { items };
}

export const boardQuery = query('board', {
  reads: [boardDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('board query requires request.db');
    return readBoard(db);
  },
});
