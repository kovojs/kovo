// SPEC §10.3/§10.4 (plans/bugs-and-testing.md C6; testing-audit §5.2): two DISTINCT
// mutations writing overlapping data concurrently must both land — no lost update from
// a read-modify-write race across concurrent request lifecycles/transactions.
import { createApp, domain, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const counterDomain = domain('counter');

async function readCount(db: KovoFixtureRequest['db']): Promise<number> {
  const rows = await db.query<{ count: number }>('select count from counter where id = 1');
  return rows[0]?.count ?? 0;
}

function renderPanel(count: number): string {
  return `<output kovo-fragment-target="counter" kovo-deps="counter" data-testid="count">${count}</output>`;
}

// A small delay before the atomic increment forces the two requests to overlap.
function bump(key: string, amount: number) {
  return mutation(`concurrent-distinct-writes/${key}`, {
    access: publicAccess('integration fixture mutation concurrent-distinct-writes/${key} has no runtime guard'),
    csrf: false,
    input: s.object({}),
    handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await request.db.exec(`update counter set count = count + ${amount} where id = 1`);
      context.invalidate(counterDomain);
      return {};
    },
  });
}

const bumpA = bump('a', 10);
const bumpB = bump('b', 1);

const home = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) =>
    `<main><kovo-fragment target="counter">${renderPanel(await readCount(request.db))}</kovo-fragment></main>`,
});

const app = createApp({
  mutations: [bumpA, bumpB],
  routes: [home],
  mutationResponses: {
    [bumpA.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          { render: async () => renderPanel(await readCount(db)), target: 'counter' },
        ],
        redirectTo: '/',
      };
    },
    [bumpB.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [
          { render: async () => renderPanel(await readCount(db)), target: 'counter' },
        ],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table counter (id integer primary key, count integer not null)',
  seed: (db) => db.exec('insert into counter (id, count) values (1, 0)'),
});
