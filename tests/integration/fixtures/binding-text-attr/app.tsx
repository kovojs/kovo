import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { escapeAttribute, escapeHtml, renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { cardDomain, cardQuery, readCard, type CardResult } from './shared';

function renderCard(db: KovoFixtureRequest['db']): Promise<string> {
  return readCard(db).then(renderCardHtml);
}

function renderCardHtml(card: CardResult): string {
  return `<binding-card kovo-deps="card" kovo-fragment-target="binding-card">
    <output data-bind="card.text">${escapeHtml(card.text)}</output>
    <button type="button" aria-label="${escapeAttribute(card.label)}" data-bind:aria-label="card.label" data-state="${escapeAttribute(card.status)}" data-bind:data-state="card.status">Server binding</button>
  </binding-card>`;
}

function renderStateIsland(): string {
  return `<state-binding-panel kovo-state='{"text":"Client initial","label":"Client initial card","status":"idle"}'>
    <output data-bind="state.text">Client initial</output>
    <button type="button" aria-label="Client initial card" data-bind:aria-label="state.label" data-state="idle" data-bind:data-state="state.status" on:click="/state-actions.ts#advanceState">Client binding</button>
  </state-binding-panel>`;
}

export const updateCard = mutation('binding-text-attr/update', {
  access: publicAccess('integration fixture mutation binding-text-attr/update has no runtime guard'),
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [cardQuery],
    touches: [cardDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      "update card_state set text = 'Updated text', label = 'Updated card', status = 'ready' where id = 1",
    );
    context.invalidate(cardDomain);
    return {};
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const card = await readCard(request.db);
    const rendered = await renderCard(request.db);
    return `${renderQueryScript({ name: 'card', value: card })}
    <script type="module" src="/client.ts"></script>
    <main>
      <kovo-fragment target="binding-card">${rendered}</kovo-fragment>
      ${renderStateIsland()}
      <form method="post" action="/_m/binding-text-attr/update" enhance data-mutation="binding-text-attr/update" kovo-deps="card">
        <button type="submit">Update server card</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [updateCard],
  queries: [cardQuery],
  routes: [homeRoute],
  mutationResponses: {
    [updateCard.key]: () => {
      return {
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table card_state (id integer primary key, text text not null, label text not null, status text not null)',
  seed: (db) =>
    db.exec(
      "insert into card_state (id, text, label, status) values (1, 'Initial text', 'Initial card', 'idle')",
    ),
});
