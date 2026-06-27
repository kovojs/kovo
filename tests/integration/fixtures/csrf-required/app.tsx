// SPEC.md §6.6/§9.1: mutation POSTs validate CSRF before parsing or guards.
import { createApp, csrfField, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const csrf = {
  secret: 'csrf-required-secret-at-least-32-bytes',
  sessionId: () => 'csrf-required-session',
};

async function renderTotal(db: KovoFixtureRequest['db']): Promise<string> {
  const rows = await db.query<{ total: number }>(
    'select coalesce(sum(amount), 0)::int as total from payments',
  );
  return `<section kovo-fragment-target="csrf-total" kovo-deps="csrf"><output data-bind="csrf.total">${rows[0]?.total ?? 0}</output></section>`;
}

export const deposit = mutation('csrf-required/deposit', {
  input: s.object({ amount: s.number().int().min(1) }),
  handler: async (input: { amount: number }, request: KovoFixtureRequest) => {
    await request.db.exec(`insert into payments (amount) values (${input.amount})`);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => `<main>
    <kovo-fragment target="csrf-total">${await renderTotal(request.db)}</kovo-fragment>
    <form method="post" action="/_m/csrf-required/deposit" enhance data-mutation="csrf-required/deposit" kovo-deps="csrf">
      ${csrfField(request, { ...csrf, audience: deposit.key })}
      <input type="number" name="amount" value="1">
      <button type="submit">Deposit with csrf</button>
    </form>
  </main>`,
});

const app = createApp({
  csrf,
  mutations: [deposit],
  routes: [homeRoute],
  mutationResponses: {
    [deposit.key]: ({ request }) => {
      const db = (request as unknown as KovoFixtureRequest).db;
      return {
        failureTarget: 'csrf-total',
        fragmentRenderers: [{ render: () => renderTotal(db), target: 'csrf-total' }],
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table payments (id serial primary key, amount integer not null)',
});
