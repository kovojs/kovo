// SPEC §9.4 + §10.2: typed read endpoints parse args from search params and
// return chunks keyed by the canonical query instance key.
import { createApp, domain, query, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const productDomain = domain('product');

export const productQuery = query('product', {
  args: s.object({
    id: s.string(),
    max: s.number().int().default(10),
  }),
  instanceKey: (input) => `product:${(input as { id: string }).id}`,
  load: (input: { id: string; max: number }) => ({
    id: input.id,
    max: input.max,
    name: input.id === 'p1' ? 'Trail Boot' : 'Unknown',
  }),
  reads: [productDomain],
});

const homeRoute = route('/', {
  page: () => '<main><h1>Query Args</h1></main>',
});

export default defineFixture({
  app: createApp({ queries: [productQuery], routes: [homeRoute] }),
});
