import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type QueryLoadContext,
  publicAccess,
} from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type NavCounter = Record<string, unknown> & {
  value: number;
};

async function readCounter(db: KovoFixtureRequest['db']): Promise<NavCounter> {
  const rows = await db.query<NavCounter>('select value from nav_lifecycle_counter where id = 1');
  return rows[0] ?? { value: 0 };
}

const counterDomain = domain('nav_lifecycle_counter');

const counterQuery = query('navCounter', {
  access: publicAccess('integration fixture query navCounter has no runtime guard'),
  reads: [counterDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('bfcache counter query requires request.db');
    return readCounter(db);
  },
});

async function renderCounterPanel(db: KovoFixtureRequest['db']): Promise<string> {
  const counter = await readCounter(db);
  return `<section id="counter-panel" kovo-fragment-target="counter-panel" kovo-deps="navCounter">
    <output id="counter-value" data-bind="navCounter.value">${counter.value}</output>
  </section>`;
}

const increment = mutation('nav-lifecycle/increment', {
  access: publicAccess('integration fixture mutation nav-lifecycle/increment has no runtime guard'),
  csrf: false,
  input: s.object({ quantity: s.number() }),
  handler: async (input: { quantity: number }, request: KovoFixtureRequest, context) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await request.db.exec(
      `update nav_lifecycle_counter set value = value + ${input.quantity} + 1 where id = 1`,
    );
    context.invalidate(counterDomain);
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const counter = await readCounter(request.db);
    return `${renderQueryScript({ name: 'navCounter', value: counter })}
    <script type="module" src="/client.ts"></script>
    <main>
      <h1>Navigation lifecycle</h1>
      ${await renderCounterPanel(request.db)}
      <form id="optimistic-form" method="post" action="/_m/nav-lifecycle/increment">
        <input type="hidden" name="quantity" value="2">
        <button type="submit">Increment optimistically</button>
      </form>
      <a href="/away">Leave page</a>
    </main>`;
  },
});

const awayRoute = route('/away', {
  access: publicAccess('integration fixture route /away has no runtime guard'),
  page: () => '<main><h1>Away</h1><a href="/">Return</a></main>',
});

const app = createApp({
  mutations: [increment],
  queries: [counterQuery],
  routes: [homeRoute, awayRoute],
  mutationResponses: {
    [increment.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        fragmentRenderers: [{ render: () => renderCounterPanel(db), target: 'counter-panel' }],
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table nav_lifecycle_counter (id integer primary key, value integer not null default 1)',
  seed: (db) => db.exec('insert into nav_lifecycle_counter (id, value) values (1, 1)'),
});
