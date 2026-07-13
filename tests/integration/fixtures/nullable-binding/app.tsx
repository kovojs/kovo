/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { DealCard } from './deal-card';
import { dealDomain, dealQuery, readDeal } from './shared';

export const fillDeal = mutation('nullable-binding/fill', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [dealQuery],
    tables: ['deal'],
    touches: [dealDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update deal set contact_name = 'Server Contact' where id = 1`);
    context.invalidate(dealDomain);
    return {};
  },
});

export const clearDeal = mutation('nullable-binding/clear', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [dealQuery],
    tables: ['deal'],
    touches: [dealDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update deal set contact_name = null where id = 1`);
    context.invalidate(dealDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const deal = await readDeal(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ name: 'deal', value: deal }))}
        <DealCard />
        {trustedHtml(
          '<nullable-state kovo-state=\'{"contact":null}\'><output data-bind="state.contact?.name"></output><a data-bind:href="state.contact?.name" data-bind:aria-label="state.contact?.name">State contact</a><button type="button" on:click="/state-actions.ts#fillContact">Fill state contact</button><button type="button" on:click="/state-actions.ts#clearContact">Clear state contact</button></nullable-state>',
        )}
        <form mutation={fillDeal} enhance>
          <button type="submit">Fill server contact</button>
        </form>
        <form mutation={clearDeal} enhance>
          <button type="submit">Clear server contact</button>
        </form>
      </main>
    );
  },
});

const app = createApp({
  mutations: [fillDeal, clearDeal],
  queries: [dealQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table deal (id integer primary key, contact_name text)',
  seed: (db) => db.exec(staticSql`insert into deal (id, contact_name) values (1, null)`),
});
