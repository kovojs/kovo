import { createApp, domain, query, route } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const audit = domain('audit');

const auditQuery = query('audit-read', {
  async load(_input, context) {
    const request = context?.request as KovoFixtureRequest;
    const rows = await request.db.query<{ event: string }>(
      'select event from audit_log order by event limit 1',
    );
    return { event: rows[0]?.event ?? null };
  },
  reads: [audit],
});

const home = route('/', {
  page: () => '<main><h1>Exempt table fixture</h1></main>',
});

export default defineFixture({
  app: createApp({
    queries: [auditQuery],
    routes: [home],
  }),
  schema: 'create table audit_log (event text not null)',
  seed: (db) => db.query('insert into audit_log (event) values ($1)', ['private-audit']),
  touchGraph: {},
  verification: {
    domainByTable: {},
    exemptTables: ['audit_log'],
  },
});
