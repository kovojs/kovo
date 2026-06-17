import { createApp, domain, mutation, query, renderQueryScript, route, s } from '@kovojs/server';
import { escapeAttribute, escapeHtml } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const boardDomain = domain('board');

interface BoardItem {
  [key: string]: unknown;
  id: string;
  label: string;
  rank: number;
}

interface BoardResult {
  items: BoardItem[];
}

async function readBoard(db: KovoFixtureRequest['db']): Promise<BoardResult> {
  const items = (await db.query(
    'select id, label, rank from board_item order by rank asc',
  )) as unknown as BoardItem[];
  return { items };
}

function renderRow(item: BoardItem): string {
  return `<li kovo-key="${escapeAttribute(item.id)}" data-row="${escapeAttribute(item.id)}">
    <span data-bind=".rank">${item.rank}</span>
    <span data-bind=".label">${escapeHtml(item.label)}</span>
  </li>`;
}

function renderBoard(board: BoardResult): string {
  return `<ol data-bind-list="board.items" kovo-key="id" aria-label="Board order">
    ${board.items.map(renderRow).join('')}
    <template kovo-stamp>${renderRow({ id: '', label: '', rank: 0 })}</template>
  </ol>`;
}

async function renderBoardList(db: KovoFixtureRequest['db']): Promise<string> {
  const board = await readBoard(db);
  return `<board-list kovo-fragment-target="board-list" kovo-deps="board">${renderBoard(board)}</board-list>`;
}

export const boardQuery = query('board', {
  load: (_input: unknown, context?: { request: KovoFixtureRequest }) =>
    readBoard(context?.request.db as KovoFixtureRequest['db']),
  reads: [boardDomain],
});

export const reorderBoard = mutation('stamp-list-reorder/reorder', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [boardQuery],
    touches: [boardDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec("update board_item set rank = 3, label = 'Alpha moved' where id = 'a'");
    await request.db.exec("update board_item set rank = 1 where id = 'b'");
    await request.db.exec("update board_item set rank = 2 where id = 'c'");
    context.invalidate(boardDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const board = await readBoard(request.db);
    return `${renderQueryScript({ name: 'board', value: board })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderBoardList(request.db)}
      <form method="post" action="/_m/stamp-list-reorder/reorder" enhance data-mutation="stamp-list-reorder/reorder" kovo-deps="board">
        <button type="submit">Reorder board</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [reorderBoard],
  queries: [boardQuery],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== reorderBoard.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderBoardList(db), target: 'board-list' }],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema:
    'create table board_item (id text primary key, label text not null, rank integer not null)',
  seed: async (db) => {
    await db.exec("insert into board_item (id, label, rank) values ('a', 'Alpha', 1)");
    await db.exec("insert into board_item (id, label, rank) values ('b', 'Beta', 2)");
    await db.exec("insert into board_item (id, label, rank) values ('c', 'Gamma', 3)");
  },
});
