import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
  type QueryLoadContext,
} from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

type Presence = Record<string, unknown> & {
  status: string;
};

const presenceDomain = domain('presence');

async function readPresence(db: KovoFixtureRequest['db']): Promise<Presence> {
  const rows = await db.query<Presence>('select status from broadcast_presence where id = 1');
  return rows[0] ?? { status: 'offline' };
}

const presenceQuery = query('presence', {
  reads: [presenceDomain],
  load: (_input: unknown, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('presence query requires request.db');
    return readPresence(db);
  },
});

async function renderPresence(db: KovoFixtureRequest['db']): Promise<string> {
  const presence = await readPresence(db);
  return `<section id="presence-panel" kovo-fragment-target="presence-panel" kovo-deps="presence">
    <output data-bind="presence.status">${presence.status}</output>
  </section>`;
}

const publishPresence = mutation('broadcast-channel-sync/publish', {
  csrf: false,
  input: s.object({}),
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec("update broadcast_presence set status = 'online' where id = 1");
    context.invalidate(presenceDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const presence = await readPresence(request.db);
    return `${renderQueryScript({ name: 'presence', value: presence })}
    <script type="module" src="/client.ts"></script>
    <main>
      ${await renderPresence(request.db)}
      <form id="presence-form" method="post" action="/_m/broadcast-channel-sync/publish">
        <button type="submit">Publish presence</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [publishPresence],
  queries: [presenceQuery],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== publishPresence.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderPresence(db), target: 'presence-panel' }],
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table broadcast_presence (id integer primary key, status text not null)',
  seed: (db) => db.exec("insert into broadcast_presence (id, status) values (1, 'offline')"),
});
