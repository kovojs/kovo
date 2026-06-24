// SPEC §6.4 + §7: GET forms coordinate typed route search params through the URL.
import { createApp, publicAccess, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const catalogRoute = route('/catalog', {
  access: publicAccess('integration fixture route /catalog has no runtime guard'),
  search: s.object({
    max: s.number().int().min(1).default(10),
    q: s.string(),
  }),
  page: ({ search }) => `<main>
    <h1>Catalog</h1>
    <form method="get" action="/catalog">
      <label>Query <input name="q" value="${search.q}" /></label>
      <label>Max <input name="max" type="number" value="${search.max}" /></label>
      <button type="submit">Filter</button>
    </form>
    <p data-result>${search.q}:${search.max}</p>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [catalogRoute] }),
});
