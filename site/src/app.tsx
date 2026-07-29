/** @jsxImportSource @kovojs/server */
import { defineKovo } from '@kovojs/server';

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

const siteApp = defineKovo({
  appId: '8e1ca1b5-1c2a-4d3f-a08a-638918f0d73e',
  clientModules: siteClientModules,
  document: siteDocument,
});

const siteRouteData = await buildSiteRouteData({ clientModules: siteClientModules });

const SiteRouteLayout = siteApp.layout({
  render: (_queries, _state, { children, regions }) => (
    <DocsRouteLayoutShell regions={regions}>{children}</DocsRouteLayoutShell>
  ),
});

const routes = [
  siteApp.route('/', {
    access: siteApp.publicAccess('public Kovo documentation landing page'),
    layout: SiteRouteLayout,
    meta: siteRouteData.landing.meta,
    stylesheets: siteStylesheetsForRoute('/'),
    page: function landingRoute() {
      return <LandingRoutePage clients={clientHrefs} />;
    },
  }),
  ...siteRouteData.pages.map((page) => docsRoute(page)),
];

export const siteStaticExportApp = siteApp.assemble({
  layouts: [SiteRouteLayout],
  routes,
});

export default siteStaticExportApp;

function docsRoute(page: SiteRoutePage) {
  const modulepreloads = [...(page.modulepreloads ?? []), clientHrefs.sidebar];
  return siteApp.route(page.routePath, {
    access: siteApp.publicAccess('public Kovo documentation page'),
    layout: SiteRouteLayout,
    meta: page.meta,
    modulepreloads,
    stylesheets: siteStylesheetsForRoute(page.routePath),
    regions: {
      header: () => <DocsHeaderRegion clients={clientHrefs} page={page.body} />,
      page: () => <DocsPageRegion page={page.body} />,
      sidebar: () => <DocsSidebarRegion clients={clientHrefs} page={page.body} />,
    },
  });
}
