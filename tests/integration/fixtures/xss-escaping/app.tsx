/** @jsxImportSource @kovojs/server */
import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { createApp, mutation, route, s, trustedHtml } from '@kovojs/server';
import { renderQueryScript } from '@kovojs/test/internal/integration/fixture-abi';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { payloadQuery, readPayload, xssDomain } from './shared';
import { XssCard, XssResponseAuthority } from './xss-card';

// Values the mutation writes — exercise the CLIENT update plan (textContent text
// binding + kovoSafeUrl URL-scheme allowlist, packages/browser/src/security-output.ts).
const XSS_TEXT = '<img src=x onerror="alert(1)">';
const XSS_URL = 'javascript:alert(1)';

export const updatePayload = mutation('xss/update', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  defaultRedirectTo: '/',
  input: s.object({}),
  registry: {
    queries: [payloadQuery],
    tables: ['xss_payload'],
    touches: [xssDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      staticSql`update xss_payload set text = '<img src=x onerror="alert(1)">', url = 'javascript:alert(1)' where id = 1`,
    );
    context.invalidate(xssDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const payload = await readPayload(request.db);
    return (
      <main>
        {trustedHtml(renderQueryScript({ name: 'payload', value: payload }))}
        {trustedHtml('<script type="module" src="/client.ts"></script>')}
        <XssCard />
        <XssResponseAuthority />
        <form mutation={updatePayload} enhance>
          <button type="submit">Inject</button>
        </form>
      </main>
    );
  },
});

const app = createApp({
  mutations: [updatePayload],
  queries: [payloadQuery],
  routes: [homeRoute],
});

export default defineFixture({
  app,
  schema:
    'create table xss_payload (id integer primary key, text text not null, url text not null)',
  // Seed text contains a </script><script> break-out attempt so the initial
  // <script type="application/json"> JSON island must escape `<` to < (F8).
  seed: (db) =>
    db.exec(
      staticSql`insert into xss_payload (id, text, url) values (1, '</script><script>alert(2)</script>', 'https://example.com')`,
    ),
});

export { XSS_TEXT, XSS_URL };
