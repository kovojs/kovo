// Morph survival fixture: a keyed scroll container keeps browser-owned
// scrollTop while server-truth content is reconciled (SPEC §9.1).
/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, Document, Head, InlineStyle, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { ScrollPanel } from './scroll-panel';
import { scrollDomain, scrollQuery } from './shared';

const SCROLL_REGION_CSS =
  '[data-scroll-region]{height:110px;overflow:auto;border:1px solid currentColor}' +
  '[data-scroll-region] [data-row]{height:24px;margin:0}';

export const refreshScroll = mutation('scroll/refresh', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { queries: [scrollQuery], tables: ['scroll_state'], touches: [scrollDomain] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update scroll_state set version = version + 1 where id = 1`);
    context.invalidate(scrollDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <ScrollPanel />
      <form mutation={refreshScroll} enhance>
        <button type="submit">Refresh content</button>
      </form>
    </main>
  ),
});

const app = createApp({
  document: (
    <Document>
      <Head>
        <InlineStyle
          id="morph-scroll-region"
          source="tests/integration/fixtures/morph-scroll/app.tsx"
        >
          {SCROLL_REGION_CSS}
        </InlineStyle>
      </Head>
    </Document>
  ),
  mutations: [refreshScroll],
  queries: [scrollQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table scroll_state (id integer primary key, version integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into scroll_state (id, version) values (1, 0)`),
});
