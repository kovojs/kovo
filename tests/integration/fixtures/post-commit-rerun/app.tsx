/** @jsxImportSource @kovojs/server */
// Mutation wire fixture for SPEC.md §10.3: enhanced mutation responses rerun
// invalidated queries after commit, so fragments and <kovo-query> carry truth.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { BalanceBadge } from './balance-badge';
import { account, balanceQuery } from './shared';

export const deposit = mutation('account/deposit', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({ amount: s.number().int().min(1) }),
  registry: {
    queries: [balanceQuery],
    tables: ['account'],
    touches: [account],
  },
  handler: async (input, request: KovoFixtureRequest) => {
    await request.db.query({
      text: 'update account set balance = balance + $1 where id = 1',
      values: [input.amount],
    });
    return { amount: input.amount };
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <BalanceBadge />
      <form mutation={deposit} enhance>
        <input name="amount" type="number" value="5" />
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
  schema: 'create table account (id integer primary key, balance integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into account (id, balance) values (1, 10)`),
});
