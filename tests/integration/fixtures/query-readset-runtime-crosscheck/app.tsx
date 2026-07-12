import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, domain, query, route } from '@kovojs/server';
import {
  defineFixture,
  type KovoFixtureReaderRequest,
} from '@kovojs/test/internal/integration/define';

const product = domain('product');

const goodReadset = query('readset-good', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    const rows = await request.db.rawRead<{ name: string }>(
      staticSql`select name from products order by id limit 1`,
      { reads: ['products'] },
    );
    return { name: rows[0]?.name ?? null };
  },
  reads: [product],
});

const badReadset = query('readset-bad', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureReaderRequest;
    const rows = await request.db.rawRead<{ event: string }>(
      {
        text: 'select event from audit_log where event = $1 order by event limit 1',
        values: ['private-audit'],
      },
      { reads: ['audit_log'] },
    );
    return { event: rows[0]?.event ?? null };
  },
  reads: [product],
});

const home = route('/', {
  page: () => '<main><h1>Readset fixture</h1></main>',
});

export default defineFixture({
  app: createApp({
    queries: [goodReadset, badReadset],
    routes: [home],
  }),
  schema: [
    'create table products (id text primary key, name text not null)',
    'create table audit_log (event text not null)',
  ],
  seed: async (db) => {
    await db.query({
      text: 'insert into products (id, name) values ($1, $2)',
      values: ['p1', 'Keyboard'],
    });
    await db.query({
      text: 'insert into audit_log (event) values ($1)',
      values: ['private-audit'],
    });
  },
  touchGraph: {},
  verification: {
    domainByTable: {
      audit_log: 'audit',
      products: 'product',
    },
  },
});
