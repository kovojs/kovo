import {
  createApp,
  escapeAttribute,
  escapeHtml,
  mutation,
  renderQueryScript,
  route,
  s,
} from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

import { dealDomain, dealQuery, readDeal, type DealResult } from './shared';

function renderDeal(db: KovoFixtureRequest['db']): Promise<string> {
  return readDeal(db).then(renderDealHtml);
}

function renderDealHtml(deal: DealResult): string {
  const name = deal.contact?.name;
  const contactAttrs =
    name === undefined
      ? ''
      : ` href="${escapeAttribute(name)}" aria-label="${escapeAttribute(name)}"`;
  return `<deal-card kovo-deps="deal" kovo-fragment-target="deal-card">
    <output data-bind="deal.contact?.name">${escapeHtml(name ?? '')}</output>
    <a${contactAttrs} data-bind:href="deal.contact?.name" data-bind:aria-label="deal.contact?.name">Contact</a>
  </deal-card>`;
}

function renderStateIsland(): string {
  return `<nullable-state kovo-state='{"contact":null}'>
    <output data-bind="state.contact?.name"></output>
    <a data-bind:href="state.contact?.name" data-bind:aria-label="state.contact?.name">State contact</a>
    <button type="button" on:click="/state-actions.ts#fillContact">Fill state contact</button>
    <button type="button" on:click="/state-actions.ts#clearContact">Clear state contact</button>
  </nullable-state>`;
}

export const fillDeal = mutation('nullable-binding/fill', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [dealQuery],
    touches: [dealDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec("update deal set contact_name = 'Server Contact' where id = 1");
    context.invalidate(dealDomain);
    return {};
  },
});

export const clearDeal = mutation('nullable-binding/clear', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [dealQuery],
    touches: [dealDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec('update deal set contact_name = null where id = 1');
    context.invalidate(dealDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const deal = await readDeal(request.db);
    const rendered = await renderDeal(request.db);
    return `${renderQueryScript({ name: 'deal', value: deal })}
    <main>
      <kovo-fragment target="deal-card">${rendered}</kovo-fragment>
      ${renderStateIsland()}
      <form method="post" action="/_m/nullable-binding/fill" enhance data-mutation="nullable-binding/fill" kovo-deps="deal">
        <button type="submit">Fill server contact</button>
      </form>
      <form method="post" action="/_m/nullable-binding/clear" enhance data-mutation="nullable-binding/clear" kovo-deps="deal">
        <button type="submit">Clear server contact</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [fillDeal, clearDeal],
  queries: [dealQuery],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== fillDeal.key && key !== clearDeal.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      fragmentRenderers: [{ render: () => renderDeal(db), target: 'deal-card' }],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table deal (id integer primary key, contact_name text)',
  seed: (db) => db.exec('insert into deal (id, contact_name) values (1, null)'),
});
