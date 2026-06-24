// SPEC §6.4 + §9.1: mutation PRG redirects can be built from typed route targets
// with params/search and still land on a normal document route.
import { redirect, type Redirect } from '@kovojs/core';
import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

declare module '@kovojs/core' {
  interface RouteRegistry {
    '/orders/:id': {
      params: { id: string };
      search: { source?: string; tab?: string };
    };
  }
}

export const placeOrder = mutation('redirect-typed-target/place-order', {
  access: publicAccess('integration fixture mutation redirect-typed-target/place-order has no runtime guard'),
  csrf: false,
  input: s.object({ id: s.string() }),
  handler: (input: { id: string }) =>
    redirect('/orders/:id', {
      params: { id: input.id },
      search: { source: 'mutation', tab: 'receipt' },
    }),
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Checkout</h1>
    <form method="post" action="/_m/redirect-typed-target/place-order" data-mutation="redirect-typed-target/place-order">
      <input name="id" value="ord-42" />
      <button type="submit">Place order</button>
    </form>
  </main>`,
});

const orderRoute = route('/orders/:id', {
  access: publicAccess('integration fixture route /orders/:id has no runtime guard'),
  params: s.object({ id: s.string() }),
  search: s.object({ source: s.string(), tab: s.string() }),
  page: ({ params, search }) =>
    `<main><h1>Order ${params.id}</h1><p data-route>${search.source}:${search.tab}</p></main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [placeOrder],
    routes: [homeRoute, orderRoute],
    mutationResponses: {
      [placeOrder.key]: () => {
        return {
          redirectTo: (result) => (result.value as Redirect).location,
        };
      },
    },
  }),
});
