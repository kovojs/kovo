/** @jsxImportSource @kovojs/server */
import { renderQueryScript, staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { BindingCard } from './binding-card';
import { cardDomain, cardQuery, readCard } from './shared';

function renderStateIsland(): string {
  return `<state-binding-panel kovo-state='{"text":"Client initial","label":"Client initial card","status":"idle"}'>
    <output data-bind="state.text">Client initial</output>
    <button type="button" aria-label="Client initial card" data-bind:aria-label="state.label" data-state="idle" data-bind:data-state="state.status" on:click="/state-actions.ts#advanceState">Client binding</button>
  </state-binding-panel>`;
}

export const updateCard = mutation('binding-text-attr/update', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [cardQuery],
    tables: ['card_state'],
    touches: [cardDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update card_state set text = 'Updated text', label = 'Updated card', status = 'ready' where id = 1`,
    );
    context.invalidate(cardDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const card = await readCard(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ name: 'card', value: card }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <BindingCard />
        {trustedHtml(renderStateIsland())}
      </main>
    );
  },
});

const app = createApp({
  mutations: [updateCard],
  queries: [cardQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table card_state (id integer primary key, text text not null, label text not null, status text not null)',
  seed: (db) =>
    db.exec(
      staticSql`insert into card_state (id, text, label, status) values (1, 'Initial text', 'Initial card', 'idle')`,
    ),
});
