// Mutation wire fixture for SPEC.md §10.3: enhanced mutation responses rerun
// invalidated queries after commit, so fragments and <kovo-query> carry truth.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

import { BalanceBadge } from './balance-badge';
import { account, balanceQuery, readBalance } from './shared';

function renderBadge(db: KovoFixtureRequest['db']): Promise<string> {
  return readBalance(db).then(
    (balance) => BalanceBadge.definition.render({ balance }) as unknown as string,
  );
}

export const deposit = mutation('account/deposit', {
  csrf: false,
  input: s.object({ amount: s.number().int().min(1) }),
  registry: {
    queries: [balanceQuery],
    touches: [account],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query('update account set balance = balance + $1 where id = 1', [
      input.amount,
    ]);
    return { amount: input.amount };
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const badge = await renderBadge(request.db);
    return `<main>
      <kovo-fragment target="balance-badge">${badge}</kovo-fragment>
      <form method="post" action="/_m/account/deposit" enhance data-mutation="account/deposit"
        kovo-deps="account">
        <input name="amount" type="number" value="5" />
        <button type="submit">Deposit</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [deposit],
  queries: [balanceQuery],
  routes: [homeRoute],
  mutationResponse: ({ key, request }) => {
    if (key !== deposit.key) return undefined;
    const db = (request as unknown as KovoFixtureRequest).db;
    return {
      redirectTo: '/',
      fragmentRenderers: [{ render: () => renderBadge(db), target: 'balance-badge' }],
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table account (id integer primary key, balance integer not null default 0)',
  seed: (db) => db.exec('insert into account (id, balance) values (1, 10)'),
});
