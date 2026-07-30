/** @jsxImportSource @kovojs/server */
// SPEC §9.4 + §10.2: typed read endpoints parse args from search params and
// return chunks keyed by the canonical query instance key.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp } from '@kovojs/test/internal/integration/fixture-abi';
import { route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { ProductCard } from './product-card';
import { productQuery } from './shared';

const homeRoute = route('/', {
  search: s.object({ id: s.string(), max: s.number().int().min(1).default(9999) }),
  page: ({ search }) => (
    <main>
      <ProductCard id={search.id} max={search.max} />
    </main>
  ),
});

export default defineFixture({
  app: createApp({ queries: [productQuery], routes: [homeRoute] }),
  schema: 'create table product (id text primary key, name text not null, price integer not null)',
  seed: async (db) => {
    await db.exec(staticSql`insert into product (id, name, price) values ('p1', 'Pen', 199)`);
    await db.exec(staticSql`insert into product (id, name, price) values ('p2', 'Notebook', 799)`);
  },
});
