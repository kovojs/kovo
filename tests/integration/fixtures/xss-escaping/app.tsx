import { createApp, mutation, route, s } from '@kovojs/server';
import { escapeAttribute, escapeHtml, renderQueryScript } from '@kovojs/server/internal/html';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

import { payloadQuery, readPayload, xssDomain, type PayloadResult } from './shared';

// Values the mutation writes — exercise the CLIENT update plan (textContent text
// binding + kovoSafeUrl URL-scheme allowlist, packages/browser/src/security-output.ts).
const XSS_TEXT = '<img src=x onerror="alert(1)">';
const XSS_URL = 'javascript:alert(1)';

function renderCardHtml(p: PayloadResult): string {
  return `<xss-card kovo-deps="payload" kovo-fragment-target="xss-card">
    <output data-bind="payload.text">${escapeHtml(p.text)}</output>
    <a data-bind:href="payload.url" href="${escapeAttribute(p.url)}">link</a>
  </xss-card>`;
}

export const updatePayload = mutation('xss/update', {
  csrf: false,
  input: s.object({}),
  registry: {
    queries: [payloadQuery],
    touches: [xssDomain],
  },
  handler: async (_input: unknown, request: KovoFixtureRequest, context) => {
    await request.db.exec(
      `update xss_payload set text = '<img src=x onerror="alert(1)">', url = 'javascript:alert(1)' where id = 1`,
    );
    context.invalidate(xssDomain);
    return {};
  },
});

const homeRoute = route('/', {
  page: async (_context, request: KovoFixtureRequest) => {
    const payload = await readPayload(request.db);
    const rendered = renderCardHtml(payload);
    return `${renderQueryScript({ name: 'payload', value: payload })}
    <script type="module" src="/client.ts"></script>
    <main>
      <kovo-fragment target="xss-card">${rendered}</kovo-fragment>
      <form method="post" action="/_m/xss/update" enhance data-mutation="xss/update" kovo-deps="payload">
        <button type="submit">Inject</button>
      </form>
    </main>`;
  },
});

const app = createApp({
  mutations: [updatePayload],
  queries: [payloadQuery],
  routes: [homeRoute],
  mutationResponses: {
    [updatePayload.key]: () => {
      return {
        redirectTo: '/',
      };
    },
  },
});

export default defineFixture({
  app,
  schema: 'create table xss_payload (id integer primary key, text text not null, url text not null)',
  // Seed text contains a </script><script> break-out attempt so the initial
  // <script type="application/json"> JSON island must escape `<` to < (F8).
  seed: (db) =>
    db.exec(
      `insert into xss_payload (id, text, url) values (1, '</script><script>alert(2)</script>', 'https://example.com')`,
    ),
});

export { XSS_TEXT, XSS_URL };
