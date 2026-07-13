/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { BoardList } from './board-list';
import { boardDomain, boardQuery } from './shared';

export const reorderBoard = mutation('stamp-list-reorder/reorder', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [boardQuery],
    tables: ['board_item'],
    touches: [boardDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update board_item set rank = 3, label = 'Alpha moved' where id = 'a'`,
    );
    await request.db.exec(staticSql`update board_item set rank = 1 where id = 'b'`);
    await request.db.exec(staticSql`update board_item set rank = 2 where id = 'c'`);
    context.invalidate(boardDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      {trustedHtml('<script type="module" src="/client.ts"></script>')}
      <BoardList />
      <form mutation={reorderBoard} enhance>
        <button type="submit">Reorder board</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [reorderBoard],
  queries: [boardQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table board_item (id text primary key, label text not null, rank integer not null)',
  seed: async (db) => {
    await db.exec(staticSql`insert into board_item (id, label, rank) values ('a', 'Alpha', 1)`);
    await db.exec(staticSql`insert into board_item (id, label, rank) values ('b', 'Beta', 2)`);
    await db.exec(staticSql`insert into board_item (id, label, rank) values ('c', 'Gamma', 3)`);
  },
});
