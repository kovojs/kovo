import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { renderBalanceShell } from './balance-shell';
import { account, balanceQuery } from './shared';

export const deposit = mutation('fragment-slot-hoist/deposit', {
  access: publicAccess('integration fixture mutation fragment-slot-hoist/deposit has no runtime guard'),
  csrf: false,
  input: s.object({ amount: s.number().int().min(1) }),
  registry: {
    queries: [balanceQuery],
    touches: [account],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query('update slot_account set balance = balance + $1 where id = 1', [
      input.amount,
    ]);
    return { amount: input.amount };
  },
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: async (_context, request: KovoFixtureRequest) => {
    const shell = await renderBalanceShell(request.db);
    return `<main>
      <kovo-fragment target="balance-shell">${shell}</kovo-fragment>
      <form method="post" action="/_m/fragment-slot-hoist/deposit" enhance
        data-mutation="fragment-slot-hoist/deposit" kovo-deps="slot_account">
        <input name="amount" type="number" value="7" />
        <button type="submit">Deposit</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [deposit],
  queries: [balanceQuery],
  routes: [homeRoute],
  mutationResponses: {
    [deposit.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        redirectTo: '/',
        fragmentRenderers: [{ render: () => renderBalanceShell(db), target: 'balance-shell' }],
      };
    },
  },
});

export default defineFixture({
  app,
  schema:
    'create table slot_account (id integer primary key, account_id text not null, balance integer not null)',
  seed: (db) =>
    db.exec("insert into slot_account (id, account_id, balance) values (1, 'acct-1', 10)"),
});
