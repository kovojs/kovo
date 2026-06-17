// SPEC.md §9.2: post-commit render failures return a stable render-error fragment.
import { createApp, domain, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const receiptDomain = domain('receipt');

export const createReceipt = mutation('render-error-fragment/create', {
  csrf: false,
  input: s.object({ id: s.string(), secret: s.string() }),
  handler: async (input: { id: string; secret: string }, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      `insert into receipts (id, secret) values ('${input.id.replaceAll("'", "''")}', '${input.secret.replaceAll("'", "''")}')`,
    );
    context.invalidate(receiptDomain, {
      input: { secret: input.secret },
      keys: [input.id],
    });
    return {};
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <kovo-fragment target="receipt"><output data-bind="receipt.status">Ready</output></kovo-fragment>
    <form method="post" action="/_m/render-error-fragment/create" enhance data-mutation="render-error-fragment/create">
      <input name="id" value="r1">
      <input name="secret" value="committed-secret">
      <button type="submit">Create receipt</button>
    </form>
  </main>`,
});

const app = createApp({
  mutations: [createReceipt],
  routes: [homeRoute],
  mutationResponse: ({ key }) => {
    if (key !== createReceipt.key) return undefined;
    return {
      failureTarget: 'receipt',
      fragmentRenderers: [
        {
          render: () => {
            throw new Error('receipt renderer leaked details');
          },
          target: 'receipt',
        },
      ],
      redirectTo: '/',
    };
  },
});

export default defineFixture({
  app,
  schema: 'create table receipts (id text primary key, secret text not null)',
});
