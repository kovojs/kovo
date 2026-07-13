/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { BalanceShell } from './balance-shell';
import { account, balanceQuery } from './shared';

export const deposit = mutation('fragment-slot-hoist/deposit', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ amount: s.number().int().min(1) }),
  registry: {
    queries: [balanceQuery],
    tables: ['slot_account'],
    touches: [account],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'update slot_account set balance = balance + $1 where id = 1',
      values: [input.amount],
    });
    return { amount: input.amount };
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <BalanceShell />
      <form
        method="post"
        action="/_m/fragment-slot-hoist/deposit"
        enhance
        data-mutation="fragment-slot-hoist/deposit"
      >
        <input name="amount" type="number" value="7" />
        <button type="submit">Deposit</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [deposit],
  queries: [balanceQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table slot_account (id integer primary key, account_id text not null, balance integer not null)',
  seed: (db) =>
    db.exec(staticSql`insert into slot_account (id, account_id, balance) values (1, 'acct-1', 10)`),
});
