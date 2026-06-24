import { createApp, domain, publicAccess, query, route, s, type Schema } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/server/internal/html';
import { runQuery } from '@kovojs/server/internal/execution';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const product = domain('product');

const projectionOutput = s.object({
  label: s.string(),
  stock: s.number().int(),
});

const matchingProjection = query('projection-good', {
  access: publicAccess('integration fixture query projection-good has no runtime guard'),
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    const rows = await request.db.query<{ label: string; stock: number }>(
      "select name || ' (' || sku || ')' as label, stock from products where id = $1",
      ['p1'],
    );
    return rows[0] ?? { label: 'missing', stock: 0 };
  },
  output: projectionOutput,
  reads: [product],
});

const driftProjection = query('projection-drift', {
  access: publicAccess('integration fixture query projection-drift has no runtime guard'),
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    const rows = await request.db.query<{ label: string; stock: string }>(
      "select name || ' (' || sku || ')' as label, 'drift' as stock from products where id = $1",
      ['p1'],
    );
    return rows[0] ?? { label: 'missing', stock: '0' };
  },
  output: projectionOutput as unknown as Schema<{ label: string; stock: string }>,
  reads: [product],
});

const home = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  async page(_params, request: KovoFixtureRequest) {
    const result = await runQuery(matchingProjection, {}, request);
    if (!result.ok) throw new Error(`Projection query failed: ${result.error.code}`);

    return `<!doctype html>
      <main>
        ${renderQueryScript({
          name: matchingProjection.key,
          value: result.value,
        })}
        <section kovo-deps="${product.key}">
          <output data-bind="projection-good.label">${result.value.label}</output>
          <output data-bind="projection-good.stock">${result.value.stock}</output>
        </section>
      </main>`;
  },
});

export default defineFixture({
  app: createApp({
    queries: [matchingProjection, driftProjection],
    routes: [home],
  }),
  schema: [
    'create table products (id text primary key, sku text not null, name text not null, stock integer not null)',
  ],
  seed: async (db) => {
    await db.query('insert into products (id, sku, name, stock) values ($1, $2, $3, $4)', [
      'p1',
      'KB-1',
      'Keyboard',
      7,
    ]);
  },
  touchGraph: {},
  verification: {
    domainByTable: {
      products: 'product',
    },
  },
});
