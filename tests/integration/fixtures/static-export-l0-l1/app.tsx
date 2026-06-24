// SPEC.md §9.5: static export replays L0/L1 routes through the app shell.
import { createApp, createMemoryVersionedClientModuleRegistry, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

export interface StaticExportRenderCounter {
  renders: number;
}

export function createStaticExportL0L1App(counter: StaticExportRenderCounter = { renders: 0 }) {
  const clientModules = createMemoryVersionedClientModuleRegistry();
  const analyticsHref = clientModules.put({
    path: '/c/static-export-analytics.client.js',
    source: 'export const staticExportAnalytics = true;',
    version: 'static-export-analytics-1',
  });
  const docsHref = clientModules.put({
    path: '/c/static-export-docs.client.js',
    source: 'export const staticExportDocs = true;',
    version: 'static-export-docs-1',
  });

  return createApp({
    clientModules,
    document: { lang: 'en-US' },
    renderRoute: (value) => String(value),
    routes: [
      route('/', {
        access: publicAccess('integration fixture route / has no runtime guard'),
        meta: { title: 'Static Export Home' },
        modulepreloads: [analyticsHref],
        page: () => {
          counter.renders += 1;
          return `<main data-page="home">
            <h1>Static Export Home</h1>
            <a id="docs-link" href="/docs/" on:click="${docsHref}#Docs$open">Read docs</a>
            <form method="get" action="/search">
              <input name="q" value="kovo">
              <button type="submit">Search</button>
            </form>
          </main>`;
        },
      }),
      route('/docs', {
        access: publicAccess('integration fixture route /docs has no runtime guard'),
        meta: { title: 'Static Export Docs' },
        page: () => {
          counter.renders += 1;
          return '<main data-page="docs"><h1>Exported Docs</h1><a href="/">Home</a></main>';
        },
      }),
      route('/search', {
        access: publicAccess('integration fixture route /search has no runtime guard'),
        meta: { title: 'Static Export Search' },
        page: () => {
          counter.renders += 1;
          return '<main data-page="search"><h1>Exported Search</h1></main>';
        },
      }),
    ],
  });
}

export default defineFixture({ app: createStaticExportL0L1App() });
