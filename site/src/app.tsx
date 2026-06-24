/** @jsxImportSource @kovojs/server */
import { createApp, createRequestHandler, layout, route, toNodeHandler } from '@kovojs/server';
import { defineCompiledRoutePage } from '@kovojs/server/internal/route';

import { buildSiteRouteData, type SiteRoutePage } from './app-data.js';
import { clientHrefs, siteClientModules } from './client/modules.js';
import { DocsRoutePage } from './components/docs-layout.js';
import { LandingRoutePage } from './components/landing.js';
import { siteDocumentTemplate } from './document-template.js';
import { siteStylesheetsForRoute } from './route-kit.js';

type SiteRoute = ReturnType<typeof route>;

const siteRouteData = await buildSiteRouteData({ clientModules: siteClientModules });

function SiteRouteLayoutShell({ children }: { children?: unknown }): string {
  return <div data-site-route-layout>{children}</div>;
}

const SiteRouteLayout = layout({
  render: (_queries, _state, { children }) => (
    <SiteRouteLayoutShell>{children}</SiteRouteLayoutShell>
  ),
});

const routes: SiteRoute[] = [
  route('/', {
    layout: SiteRouteLayout,
    meta: siteRouteData.landing.meta,
    stylesheets: siteStylesheetsForRoute('/'),
    page: siteRoutePage('/', function landingRoute() {
      return <LandingRoutePage clients={clientHrefs} />;
    }),
  }) as SiteRoute,
  ...siteRouteData.pages.map((page) => docsRoute(page)),
];

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: { lang: 'en', template: siteDocumentTemplate },
  routes,
});

export const siteNodeHandler = toNodeHandler(createRequestHandler(siteStaticExportApp));

export default siteStaticExportApp;

function docsRoute(page: SiteRoutePage): SiteRoute {
  const modulepreloads = [...(page.modulepreloads ?? []), clientHrefs.sidebar];
  return route(page.routePath, {
    layout: SiteRouteLayout,
    meta: page.meta,
    modulepreloads,
    stylesheets: siteStylesheetsForRoute(page.routePath),
    page: siteRoutePage(
      page.routePath,
      function pageRoute() {
        return <DocsRoutePage clients={clientHrefs} page={page.body} />;
      },
      { stampPage: false },
    ),
  }) as SiteRoute;
}

function siteRoutePage<Page extends (...args: never[]) => unknown>(
  routePath: string,
  page: Page,
  options: { stampPage?: boolean } = {},
) {
  const stampPage = options.stampPage ?? true;
  return defineCompiledRoutePage(
    {
      components: [],
      fileName: 'site/src/app.tsx',
      navigationSegments: [
        {
          id: 'layout:SiteRouteLayout',
          kind: 'layout',
          localName: 'SiteRouteLayout',
        },
        ...(stampPage
          ? [
              {
                components: [],
                id: `page:${routePath}`,
                kind: 'page' as const,
                localName: 'page',
              },
            ]
          : []),
      ],
      route: routePath,
    },
    page,
  );
}
