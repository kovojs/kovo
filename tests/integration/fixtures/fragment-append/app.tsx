// Append-mode fixture: a mutation returns a kovo-fragment with mode="append",
// so existing keyed rows stay connected while the new row is added (SPEC §9.1).
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

interface FeedRow {
  [key: string]: unknown;
  id: number;
  title: string;
}

async function readRows(db: KovoFixtureRequest['db']): Promise<FeedRow[]> {
  return db.query<FeedRow>('select id, title from feed order by id');
}

function renderRow(row: FeedRow): string {
  return `<article kovo-key="${row.id}" data-row="${row.id}">
    <h2>${row.title}</h2>
  </article>`;
}

async function renderFeed(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await readRows(db);
  return `<section kovo-fragment-target="feed" kovo-deps="feed">
    ${rows.map((row) => renderRow(row)).join('')}
  </section>`;
}

async function renderLastRow(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<FeedRow>('select id, title from feed order by id desc limit 1');
  const row = rows[0];
  if (!row) return '';
  return renderRow(row);
}

export const loadMore = mutation('feed/load-more', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest) => {
    const rows = await request.db.query<{ next_id: number }>(
      'select coalesce(max(id), 0) + 1 as next_id from feed',
    );
    const nextId = rows[0]?.next_id ?? 1;
    await request.db.exec(`insert into feed (id, title) values (${nextId}, 'Item ${nextId}')`);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const feed = await renderFeed(request.db);
    return `<main>
      <kovo-fragment target="feed">${feed}</kovo-fragment>
      <form method="post" action="/_m/feed/load-more" enhance data-mutation="feed/load-more" kovo-deps="feed">
        <button type="submit">Load more</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [loadMore],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== loadMore.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      redirectTo: '/',
      fragmentRenderers: [{ mode: 'append', render: () => renderLastRow(db), target: 'feed' }],
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table feed (id integer primary key, title text not null)',
  seed: (db) => db.exec("insert into feed (id, title) values (1, 'Item 1'), (2, 'Item 2')"),
});
