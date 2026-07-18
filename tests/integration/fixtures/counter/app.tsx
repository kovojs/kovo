/** @jsxImportSource @kovojs/server */
// I3 fixture entry: the click → server-mutation → DOM-morph round trip. This module
// declares no Kovo components (they live in count-badge.tsx), so the compiler plugin
// leaves its exports — including `export default defineFixture(...)` — intact. NOTE:
// the plugin claims any module whose source contains the call token for a Kovo
// component (vite.ts), so keep that token out of comments in non-component modules.
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { CountBadge } from './count-badge';
import { counter } from './shared';

export const increment = mutation('counter/increment', {
  // Fixture: skip the CSRF/session dance (plans/integration-test-suite.md).
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: { tables: ['counter'], touches: [counter] },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(staticSql`update counter set value = value + 1 where id = 1`);
    context.invalidate(counter);
    return {};
  },
});

const homeRoute = route('/', {
  page: () => (
    <main>
      <CountBadge />
      {/* SPEC §6.2/§6.3: direct mutation provenance lets KV242 own the transport stamps. */}
      <form mutation={increment} enhance>
        <button type="submit">Increment</button>
      </form>
    </main>
  ),
});

const app = createApp({
  mutations: [increment],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema: 'create table counter (id integer primary key, value integer not null default 0)',
  seed: (db) => db.exec(staticSql`insert into counter (id, value) values (1, 0)`),
});
