import { createApp, publicAccess, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { CatalogCard } from './catalog-card';
import { ProductHero } from './product-hero';
import { productRecord } from './shared';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Catalog</h1>
    ${CatalogCard.definition.render({ product: productRecord }) as unknown as string}
  </main>`,
});

const productRoute = route('/products/:id', {
  access: publicAccess('integration fixture route /products/:id has no runtime guard'),
  params: s.object({ id: s.string() }),
  page: ({ params }) => `<main>
    <a href="/">Back to catalog</a>
    ${ProductHero.definition.render({ product: { ...productRecord, id: params.id } }) as unknown as string}
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute, productRoute] }),
});
