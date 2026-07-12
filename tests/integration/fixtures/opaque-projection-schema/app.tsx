import { createApp, domain, query, route, s, type Schema } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { runQuery } from '@kovojs/test/internal/integration/fixture-abi';
import {
  defineFixture,
  type KovoFixtureReaderRequest,
} from '@kovojs/test/internal/integration/define';

const product = domain('product');

const projectionOutput = s.object({
  label: s.string(),
  stock: s.number().int(),
});

const matchingProjection = query('projection-good', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    const rows = await request.db.rawRead<{ label: string; stock: number }>(
      {
        text: "select name || ' (' || sku || ')' as label, stock from products where id = $1",
        values: ['p1'],
      },
      { reads: ['products'] },
    );
    return rows[0] ?? { label: 'missing', stock: 0 };
  },
  output: projectionOutput,
  reads: [product],
});

const driftProjection = query('projection-drift', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    const rows = await request.db.rawRead<{ label: string; stock: string }>(
      {
        text: "select name || ' (' || sku || ')' as label, 'drift' as stock from products where id = $1",
        values: ['p1'],
      },
      { reads: ['products'] },
    );
    return rows[0] ?? { label: 'missing', stock: '0' };
  },
  output: projectionOutput as unknown as Schema<{ label: string; stock: string }>,
  reads: [product],
});

const home = route('/', {
  async page(_params, request: KovoFixtureReaderRequest) {
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
  routeReads: { '/': ['product'] },
  schema: [
    'create table products (id text primary key, sku text not null, name text not null, stock integer not null)',
  ],
  seed: async (db) => {
    await db.query({
      text: 'insert into products (id, sku, name, stock) values ($1, $2, $3, $4)',
      values: ['p1', 'KB-1', 'Keyboard', 7],
    });
  },
  touchGraph: {},
  verification: {
    domainByTable: {
      products: 'product',
    },
  },
});
