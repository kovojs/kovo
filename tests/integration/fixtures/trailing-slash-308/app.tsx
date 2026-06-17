// SPEC §9.5: trailing slashes normalize to the canonical route before matching.
import { createApp, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  search: s.object({ tab: s.string() }),
  page: ({ params, search }) =>
    `<main><h1>Product ${params.id}</h1><p data-tab>${search.tab}</p></main>`,
});

export default defineFixture({
  app: createApp({ routes: [productRoute] }),
});
