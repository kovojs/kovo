// SPEC §9.4 + §10.2: typed read endpoints parse args from search params and
// return chunks keyed by the canonical query instance key.
import { createApp, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ProductCard } from './product-card';
import { productQuery, readProduct } from './shared';

const homeRoute = route('/', {
  search: s.object({ id: s.string(), max: s.number().int().min(1).default(9999) }),
  page: async ({ search }, request: KovoFixtureRequest) => {
    const product = await readProduct(request.db, search);
    return `<main>${ProductCard.definition.render({ product }) as string}</main>`;
  },
});

export default defineFixture({
  app: createApp({ queries: [productQuery], routes: [homeRoute] }),
  schema: 'create table product (id text primary key, name text not null, price integer not null)',
  seed: async (db) => {
    await db.exec("insert into product (id, name, price) values ('p1', 'Pen', 199)");
    await db.exec("insert into product (id, name, price) values ('p2', 'Notebook', 799)");
  },
});
