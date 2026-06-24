/** @jsxImportSource @kovojs/server */
import { createApp, createRequestHandler, layout, route, toNodeHandler } from '@kovojs/server';

import { buildSiteRouteData, type SiteRoutePage } from './app-data.js';
import { clientHrefs, siteClientModules } from './client/modules.js';
import {
  DocsHeaderRegion,
  DocsPageRegion,
  DocsRouteLayoutShell,
  DocsSidebarRegion,
} from './components/docs-layout.js';
import { LandingRoutePage } from './components/landing.js';
import { siteDocument } from './document-template.js';
import { siteStylesheetsForRoute } from './route-kit.js';

type SiteRoute = ReturnType<typeof route>;

const siteRouteData = await buildSiteRouteData({ clientModules: siteClientModules });

const SiteRouteLayout = layout({
  render: (_queries, _state, { children, regions }) => (
    <DocsRouteLayoutShell regions={regions}>{children}</DocsRouteLayoutShell>
  ),
});

const routes: SiteRoute[] = [
  route('/', {
    layout: SiteRouteLayout,
    meta: siteRouteData.landing.meta,
    stylesheets: siteStylesheetsForRoute('/'),
    page: function landingRoute() {
      return <LandingRoutePage clients={clientHrefs} />;
    },
  }) as SiteRoute,
  ...siteRouteData.pages.map((page) => docsRoute(page)),
];

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: siteDocument,
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
    regions: {
      header: () => <DocsHeaderRegion clients={clientHrefs} page={page.body} />,
      page: () => <DocsPageRegion page={page.body} />,
      sidebar: () => <DocsSidebarRegion clients={clientHrefs} page={page.body} />,
    },
  }) as SiteRoute;
}
