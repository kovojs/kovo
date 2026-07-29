import { trustedHtml } from '@kovojs/browser';
import { defineKovo } from '@kovojs/server';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
import { renderRouteHtml } from '@kovojs/server/rendering';

const publicClientModules = createMemoryVersionedClientModuleRegistry();
const app = defineKovo({
  appId: '86fecd0f-8d2a-48bb-bed2-00e91209d058',
  clientModules: publicClientModules,
  document: { lang: 'en-US' },
  renderRoute(value) {
    return `<main>${renderRouteHtml(value)}</main>`;
  },
});

export const referencePublicClientModuleHref = publicClientModules.put({
  path: '/c/reference.client.js',
  source: [
    'export function Reference$markReady(event) {',
    '  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target;',
    '  const root = target instanceof HTMLElement ? target.closest("[data-reference-public-shell]") : null;',
    '  const output = root ? root.querySelector("#reference-status") : null;',
    '  if (output) output.textContent = "Reference shell interaction loaded from /c/.";',
    '}',
    '',
  ].join('\n'),
});

export const referencePublicRoute = app.route('/', {
  // Unauthenticated landing page — its KV436 access decision is public (SPEC §10.2).
  access: app.publicAccess('unauthenticated landing page'),
  meta: {
    description: 'A public Kovo reference app shell exported through synthetic replay.',
    title: 'Kovo Reference Public Shell',
  },
  modulepreloads: [referencePublicClientModuleHref],
  page() {
    return trustedHtml(
      [
        '<section data-reference-public-shell>',
        '<h1>Kovo Reference App</h1>',
        '<p>Public route exported by the shared request shell.</p>',
        `<button type="button" on:click="${referencePublicClientModuleHref}#Reference$markReady">Check shell</button>`,
        '<output id="reference-status">Waiting for client module.</output>',
        '</section>',
      ].join(''),
      {
        reason: 'reference route assembles reviewed static shell markup',
        source: 'examples/reference/src/public-app.ts',
      },
    );
  },
});

export const referencePublicApp = app.assemble({
  routes: [referencePublicRoute],
});

export default referencePublicApp;
