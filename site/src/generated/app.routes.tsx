/** @jsxImportSource @kovojs/server */
// Generated TSX route source for the docs site (SPEC.md section 4.5).
// Do not edit; regenerate with `pnpm run emit-routes`.
import {
  createApp,
  createRequestHandler,
  layout,
  route,
  toNodeHandler,
  type RouteDeclaration,
} from '@kovojs/server';

import { buildSiteRouteData, type SiteRoutePage } from '../app-data.js';
import { clientHrefs, siteClientModules } from '../client/modules.js';
import { DocsRouteLayoutShell, DocsRoutePage } from '../components/docs-layout.js';
import { LandingRoutePage } from '../components/landing.js';
import { siteDocumentTemplate } from '../document-template.js';
import { siteStylesheets } from '../route-kit.js';

type SiteRoute = RouteDeclaration<string, undefined, undefined, unknown, unknown, unknown>;

const siteRouteData = await buildSiteRouteData({ clientModules: siteClientModules });

function SiteRouteLayoutShell({ children }: { children?: unknown }): string {
  return <div data-site-route-layout>{children}</div>;
}

const SiteRouteLayout = layout({
  render: (_queries, _state, { children }) => <SiteRouteLayoutShell>{children}</SiteRouteLayoutShell>,
});

const DocsRouteLayout = layout({
  render: (_queries, _state, { children }) => (
    <DocsRouteLayoutShell clients={clientHrefs}>{children}</DocsRouteLayoutShell>
  ),
});

function pageAt(index: number, routePath: string): SiteRoutePage {
  const page = siteRouteData.pages[index];
  if (!page || page.routePath !== routePath) {
    throw new Error(`docs route artifact is stale for ${routePath}; regenerate site routes`);
  }
  return page;
}

const page0 = pageAt(0, "/docs");
const page1 = pageAt(1, "/docs/why-kovo");
const page2 = pageAt(2, "/docs/quickstart");
const page3 = pageAt(3, "/docs/mental-model");
const page4 = pageAt(4, "/docs/installation");
const page5 = pageAt(5, "/docs/project-structure");
const page6 = pageAt(6, "/docs/stability");
const page7 = pageAt(7, "/tutorial");
const page8 = pageAt(8, "/tutorial/01-first-page");
const page9 = pageAt(9, "/tutorial/02-islands");
const page10 = pageAt(10, "/tutorial/03-queries");
const page11 = pageAt(11, "/tutorial/04-mutations");
const page12 = pageAt(12, "/tutorial/05-optimistic");
const page13 = pageAt(13, "/tutorial/06-streaming");
const page14 = pageAt(14, "/tutorial/07-verification");
const page15 = pageAt(15, "/tutorial/08-wrap-up");
const page16 = pageAt(16, "/guides");
const page17 = pageAt(17, "/guides/queries");
const page18 = pageAt(18, "/guides/mutations");
const page19 = pageAt(19, "/guides/optimistic");
const page20 = pageAt(20, "/guides/styling");
const page21 = pageAt(21, "/guides/deployment");
const page22 = pageAt(22, "/guides/testing");
const page23 = pageAt(23, "/guides/kovo-explain");
const page24 = pageAt(24, "/guides/streaming");
const page25 = pageAt(25, "/guides/compiler-internals");
const page26 = pageAt(26, "/guides/accessibility");
const page27 = pageAt(27, "/guides/components");
const page28 = pageAt(28, "/api");
const page29 = pageAt(29, "/api/core");
const page30 = pageAt(30, "/api/server");
const page31 = pageAt(31, "/api/runtime");
const page32 = pageAt(32, "/api/test");
const page33 = pageAt(33, "/api/drizzle");
const page34 = pageAt(34, "/api/style");
const page35 = pageAt(35, "/api/better-auth");
const page36 = pageAt(36, "/api/cli");
const page37 = pageAt(37, "/reference");
const page38 = pageAt(38, "/reference/diagnostics");
const page39 = pageAt(39, "/gallery");
const page40 = pageAt(40, "/gallery/interactive");
const page41 = pageAt(41, "/gallery/components/accordion");
const page42 = pageAt(42, "/gallery/components/alert");
const page43 = pageAt(43, "/gallery/components/alert-dialog");
const page44 = pageAt(44, "/gallery/components/autocomplete");
const page45 = pageAt(45, "/gallery/components/avatar");
const page46 = pageAt(46, "/gallery/components/badge");
const page47 = pageAt(47, "/gallery/components/breadcrumb");
const page48 = pageAt(48, "/gallery/components/button");
const page49 = pageAt(49, "/gallery/components/card");
const page50 = pageAt(50, "/gallery/components/checkbox");
const page51 = pageAt(51, "/gallery/components/checkbox-group");
const page52 = pageAt(52, "/gallery/components/collapsible");
const page53 = pageAt(53, "/gallery/components/combobox");
const page54 = pageAt(54, "/gallery/components/command");
const page55 = pageAt(55, "/gallery/components/context-menu");
const page56 = pageAt(56, "/gallery/components/dialog");
const page57 = pageAt(57, "/gallery/components/disclosure");
const page58 = pageAt(58, "/gallery/components/drawer");
const page59 = pageAt(59, "/gallery/components/dropdown-menu");
const page60 = pageAt(60, "/gallery/components/field");
const page61 = pageAt(61, "/gallery/components/hover-card");
const page62 = pageAt(62, "/gallery/components/kbd");
const page63 = pageAt(63, "/gallery/components/menubar");
const page64 = pageAt(64, "/gallery/components/meter");
const page65 = pageAt(65, "/gallery/components/navigation-menu");
const page66 = pageAt(66, "/gallery/components/number-field");
const page67 = pageAt(67, "/gallery/components/otp-field");
const page68 = pageAt(68, "/gallery/components/popover");
const page69 = pageAt(69, "/gallery/components/progress");
const page70 = pageAt(70, "/gallery/components/radio-group");
const page71 = pageAt(71, "/gallery/components/scroll-area");
const page72 = pageAt(72, "/gallery/components/select");
const page73 = pageAt(73, "/gallery/components/separator");
const page74 = pageAt(74, "/gallery/components/sheet");
const page75 = pageAt(75, "/gallery/components/skeleton");
const page76 = pageAt(76, "/gallery/components/slider");
const page77 = pageAt(77, "/gallery/components/switch");
const page78 = pageAt(78, "/gallery/components/table");
const page79 = pageAt(79, "/gallery/components/tabs");
const page80 = pageAt(80, "/gallery/components/toast");
const page81 = pageAt(81, "/gallery/components/toggle");
const page82 = pageAt(82, "/gallery/components/toggle-group");
const page83 = pageAt(83, "/gallery/components/toolbar");
const page84 = pageAt(84, "/gallery/components/tooltip");
const page85 = pageAt(85, "/examples");
const page86 = pageAt(86, "/examples/commerce");
const page87 = pageAt(87, "/examples/crm");
const page88 = pageAt(88, "/examples/stackoverflow");
const page89 = pageAt(89, "/spec");

const routes: SiteRoute[] = [
  route('/', {
    layout: SiteRouteLayout,
    meta: siteRouteData.landing.meta,
    stylesheets: siteStylesheets,
    page() {
      return (
        <LandingRoutePage
          clients={clientHrefs}
          loaderGzipBytes={siteRouteData.landing.loaderGzipBytes}
        />
      );
    },
  }) as SiteRoute,
  route("/docs", {
    layout: DocsRouteLayout,
    meta: page0.meta,
    ...(page0.modulepreloads ? { modulepreloads: page0.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page0.body} />;
    },
  }) as SiteRoute,
  route("/docs/why-kovo", {
    layout: DocsRouteLayout,
    meta: page1.meta,
    ...(page1.modulepreloads ? { modulepreloads: page1.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page1.body} />;
    },
  }) as SiteRoute,
  route("/docs/quickstart", {
    layout: DocsRouteLayout,
    meta: page2.meta,
    ...(page2.modulepreloads ? { modulepreloads: page2.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page2.body} />;
    },
  }) as SiteRoute,
  route("/docs/mental-model", {
    layout: DocsRouteLayout,
    meta: page3.meta,
    ...(page3.modulepreloads ? { modulepreloads: page3.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page3.body} />;
    },
  }) as SiteRoute,
  route("/docs/installation", {
    layout: DocsRouteLayout,
    meta: page4.meta,
    ...(page4.modulepreloads ? { modulepreloads: page4.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page4.body} />;
    },
  }) as SiteRoute,
  route("/docs/project-structure", {
    layout: DocsRouteLayout,
    meta: page5.meta,
    ...(page5.modulepreloads ? { modulepreloads: page5.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page5.body} />;
    },
  }) as SiteRoute,
  route("/docs/stability", {
    layout: DocsRouteLayout,
    meta: page6.meta,
    ...(page6.modulepreloads ? { modulepreloads: page6.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page6.body} />;
    },
  }) as SiteRoute,
  route("/tutorial", {
    layout: DocsRouteLayout,
    meta: page7.meta,
    ...(page7.modulepreloads ? { modulepreloads: page7.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page7.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/01-first-page", {
    layout: DocsRouteLayout,
    meta: page8.meta,
    ...(page8.modulepreloads ? { modulepreloads: page8.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page8.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/02-islands", {
    layout: DocsRouteLayout,
    meta: page9.meta,
    ...(page9.modulepreloads ? { modulepreloads: page9.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page9.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/03-queries", {
    layout: DocsRouteLayout,
    meta: page10.meta,
    ...(page10.modulepreloads ? { modulepreloads: page10.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page10.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/04-mutations", {
    layout: DocsRouteLayout,
    meta: page11.meta,
    ...(page11.modulepreloads ? { modulepreloads: page11.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page11.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/05-optimistic", {
    layout: DocsRouteLayout,
    meta: page12.meta,
    ...(page12.modulepreloads ? { modulepreloads: page12.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page12.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/06-streaming", {
    layout: DocsRouteLayout,
    meta: page13.meta,
    ...(page13.modulepreloads ? { modulepreloads: page13.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page13.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/07-verification", {
    layout: DocsRouteLayout,
    meta: page14.meta,
    ...(page14.modulepreloads ? { modulepreloads: page14.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page14.body} />;
    },
  }) as SiteRoute,
  route("/tutorial/08-wrap-up", {
    layout: DocsRouteLayout,
    meta: page15.meta,
    ...(page15.modulepreloads ? { modulepreloads: page15.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page15.body} />;
    },
  }) as SiteRoute,
  route("/guides", {
    layout: DocsRouteLayout,
    meta: page16.meta,
    ...(page16.modulepreloads ? { modulepreloads: page16.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page16.body} />;
    },
  }) as SiteRoute,
  route("/guides/queries", {
    layout: DocsRouteLayout,
    meta: page17.meta,
    ...(page17.modulepreloads ? { modulepreloads: page17.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page17.body} />;
    },
  }) as SiteRoute,
  route("/guides/mutations", {
    layout: DocsRouteLayout,
    meta: page18.meta,
    ...(page18.modulepreloads ? { modulepreloads: page18.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page18.body} />;
    },
  }) as SiteRoute,
  route("/guides/optimistic", {
    layout: DocsRouteLayout,
    meta: page19.meta,
    ...(page19.modulepreloads ? { modulepreloads: page19.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page19.body} />;
    },
  }) as SiteRoute,
  route("/guides/styling", {
    layout: DocsRouteLayout,
    meta: page20.meta,
    ...(page20.modulepreloads ? { modulepreloads: page20.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page20.body} />;
    },
  }) as SiteRoute,
  route("/guides/deployment", {
    layout: DocsRouteLayout,
    meta: page21.meta,
    ...(page21.modulepreloads ? { modulepreloads: page21.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page21.body} />;
    },
  }) as SiteRoute,
  route("/guides/testing", {
    layout: DocsRouteLayout,
    meta: page22.meta,
    ...(page22.modulepreloads ? { modulepreloads: page22.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page22.body} />;
    },
  }) as SiteRoute,
  route("/guides/kovo-explain", {
    layout: DocsRouteLayout,
    meta: page23.meta,
    ...(page23.modulepreloads ? { modulepreloads: page23.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page23.body} />;
    },
  }) as SiteRoute,
  route("/guides/streaming", {
    layout: DocsRouteLayout,
    meta: page24.meta,
    ...(page24.modulepreloads ? { modulepreloads: page24.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page24.body} />;
    },
  }) as SiteRoute,
  route("/guides/compiler-internals", {
    layout: DocsRouteLayout,
    meta: page25.meta,
    ...(page25.modulepreloads ? { modulepreloads: page25.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page25.body} />;
    },
  }) as SiteRoute,
  route("/guides/accessibility", {
    layout: DocsRouteLayout,
    meta: page26.meta,
    ...(page26.modulepreloads ? { modulepreloads: page26.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page26.body} />;
    },
  }) as SiteRoute,
  route("/guides/components", {
    layout: DocsRouteLayout,
    meta: page27.meta,
    ...(page27.modulepreloads ? { modulepreloads: page27.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page27.body} />;
    },
  }) as SiteRoute,
  route("/api", {
    layout: DocsRouteLayout,
    meta: page28.meta,
    ...(page28.modulepreloads ? { modulepreloads: page28.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page28.body} />;
    },
  }) as SiteRoute,
  route("/api/core", {
    layout: DocsRouteLayout,
    meta: page29.meta,
    ...(page29.modulepreloads ? { modulepreloads: page29.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page29.body} />;
    },
  }) as SiteRoute,
  route("/api/server", {
    layout: DocsRouteLayout,
    meta: page30.meta,
    ...(page30.modulepreloads ? { modulepreloads: page30.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page30.body} />;
    },
  }) as SiteRoute,
  route("/api/runtime", {
    layout: DocsRouteLayout,
    meta: page31.meta,
    ...(page31.modulepreloads ? { modulepreloads: page31.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page31.body} />;
    },
  }) as SiteRoute,
  route("/api/test", {
    layout: DocsRouteLayout,
    meta: page32.meta,
    ...(page32.modulepreloads ? { modulepreloads: page32.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page32.body} />;
    },
  }) as SiteRoute,
  route("/api/drizzle", {
    layout: DocsRouteLayout,
    meta: page33.meta,
    ...(page33.modulepreloads ? { modulepreloads: page33.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page33.body} />;
    },
  }) as SiteRoute,
  route("/api/style", {
    layout: DocsRouteLayout,
    meta: page34.meta,
    ...(page34.modulepreloads ? { modulepreloads: page34.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page34.body} />;
    },
  }) as SiteRoute,
  route("/api/better-auth", {
    layout: DocsRouteLayout,
    meta: page35.meta,
    ...(page35.modulepreloads ? { modulepreloads: page35.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page35.body} />;
    },
  }) as SiteRoute,
  route("/api/cli", {
    layout: DocsRouteLayout,
    meta: page36.meta,
    ...(page36.modulepreloads ? { modulepreloads: page36.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page36.body} />;
    },
  }) as SiteRoute,
  route("/reference", {
    layout: DocsRouteLayout,
    meta: page37.meta,
    ...(page37.modulepreloads ? { modulepreloads: page37.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page37.body} />;
    },
  }) as SiteRoute,
  route("/reference/diagnostics", {
    layout: DocsRouteLayout,
    meta: page38.meta,
    ...(page38.modulepreloads ? { modulepreloads: page38.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page38.body} />;
    },
  }) as SiteRoute,
  route("/gallery", {
    layout: DocsRouteLayout,
    meta: page39.meta,
    ...(page39.modulepreloads ? { modulepreloads: page39.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page39.body} />;
    },
  }) as SiteRoute,
  route("/gallery/interactive", {
    layout: DocsRouteLayout,
    meta: page40.meta,
    ...(page40.modulepreloads ? { modulepreloads: page40.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page40.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/accordion", {
    layout: DocsRouteLayout,
    meta: page41.meta,
    ...(page41.modulepreloads ? { modulepreloads: page41.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page41.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/alert", {
    layout: DocsRouteLayout,
    meta: page42.meta,
    ...(page42.modulepreloads ? { modulepreloads: page42.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page42.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/alert-dialog", {
    layout: DocsRouteLayout,
    meta: page43.meta,
    ...(page43.modulepreloads ? { modulepreloads: page43.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page43.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/autocomplete", {
    layout: DocsRouteLayout,
    meta: page44.meta,
    ...(page44.modulepreloads ? { modulepreloads: page44.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page44.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/avatar", {
    layout: DocsRouteLayout,
    meta: page45.meta,
    ...(page45.modulepreloads ? { modulepreloads: page45.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page45.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/badge", {
    layout: DocsRouteLayout,
    meta: page46.meta,
    ...(page46.modulepreloads ? { modulepreloads: page46.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page46.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/breadcrumb", {
    layout: DocsRouteLayout,
    meta: page47.meta,
    ...(page47.modulepreloads ? { modulepreloads: page47.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page47.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/button", {
    layout: DocsRouteLayout,
    meta: page48.meta,
    ...(page48.modulepreloads ? { modulepreloads: page48.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page48.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/card", {
    layout: DocsRouteLayout,
    meta: page49.meta,
    ...(page49.modulepreloads ? { modulepreloads: page49.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page49.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/checkbox", {
    layout: DocsRouteLayout,
    meta: page50.meta,
    ...(page50.modulepreloads ? { modulepreloads: page50.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page50.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/checkbox-group", {
    layout: DocsRouteLayout,
    meta: page51.meta,
    ...(page51.modulepreloads ? { modulepreloads: page51.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page51.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/collapsible", {
    layout: DocsRouteLayout,
    meta: page52.meta,
    ...(page52.modulepreloads ? { modulepreloads: page52.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page52.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/combobox", {
    layout: DocsRouteLayout,
    meta: page53.meta,
    ...(page53.modulepreloads ? { modulepreloads: page53.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page53.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/command", {
    layout: DocsRouteLayout,
    meta: page54.meta,
    ...(page54.modulepreloads ? { modulepreloads: page54.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page54.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/context-menu", {
    layout: DocsRouteLayout,
    meta: page55.meta,
    ...(page55.modulepreloads ? { modulepreloads: page55.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page55.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/dialog", {
    layout: DocsRouteLayout,
    meta: page56.meta,
    ...(page56.modulepreloads ? { modulepreloads: page56.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page56.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/disclosure", {
    layout: DocsRouteLayout,
    meta: page57.meta,
    ...(page57.modulepreloads ? { modulepreloads: page57.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page57.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/drawer", {
    layout: DocsRouteLayout,
    meta: page58.meta,
    ...(page58.modulepreloads ? { modulepreloads: page58.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page58.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/dropdown-menu", {
    layout: DocsRouteLayout,
    meta: page59.meta,
    ...(page59.modulepreloads ? { modulepreloads: page59.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page59.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/field", {
    layout: DocsRouteLayout,
    meta: page60.meta,
    ...(page60.modulepreloads ? { modulepreloads: page60.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page60.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/hover-card", {
    layout: DocsRouteLayout,
    meta: page61.meta,
    ...(page61.modulepreloads ? { modulepreloads: page61.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page61.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/kbd", {
    layout: DocsRouteLayout,
    meta: page62.meta,
    ...(page62.modulepreloads ? { modulepreloads: page62.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page62.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/menubar", {
    layout: DocsRouteLayout,
    meta: page63.meta,
    ...(page63.modulepreloads ? { modulepreloads: page63.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page63.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/meter", {
    layout: DocsRouteLayout,
    meta: page64.meta,
    ...(page64.modulepreloads ? { modulepreloads: page64.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page64.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/navigation-menu", {
    layout: DocsRouteLayout,
    meta: page65.meta,
    ...(page65.modulepreloads ? { modulepreloads: page65.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page65.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/number-field", {
    layout: DocsRouteLayout,
    meta: page66.meta,
    ...(page66.modulepreloads ? { modulepreloads: page66.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page66.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/otp-field", {
    layout: DocsRouteLayout,
    meta: page67.meta,
    ...(page67.modulepreloads ? { modulepreloads: page67.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page67.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/popover", {
    layout: DocsRouteLayout,
    meta: page68.meta,
    ...(page68.modulepreloads ? { modulepreloads: page68.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page68.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/progress", {
    layout: DocsRouteLayout,
    meta: page69.meta,
    ...(page69.modulepreloads ? { modulepreloads: page69.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page69.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/radio-group", {
    layout: DocsRouteLayout,
    meta: page70.meta,
    ...(page70.modulepreloads ? { modulepreloads: page70.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page70.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/scroll-area", {
    layout: DocsRouteLayout,
    meta: page71.meta,
    ...(page71.modulepreloads ? { modulepreloads: page71.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page71.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/select", {
    layout: DocsRouteLayout,
    meta: page72.meta,
    ...(page72.modulepreloads ? { modulepreloads: page72.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page72.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/separator", {
    layout: DocsRouteLayout,
    meta: page73.meta,
    ...(page73.modulepreloads ? { modulepreloads: page73.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page73.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/sheet", {
    layout: DocsRouteLayout,
    meta: page74.meta,
    ...(page74.modulepreloads ? { modulepreloads: page74.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page74.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/skeleton", {
    layout: DocsRouteLayout,
    meta: page75.meta,
    ...(page75.modulepreloads ? { modulepreloads: page75.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page75.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/slider", {
    layout: DocsRouteLayout,
    meta: page76.meta,
    ...(page76.modulepreloads ? { modulepreloads: page76.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page76.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/switch", {
    layout: DocsRouteLayout,
    meta: page77.meta,
    ...(page77.modulepreloads ? { modulepreloads: page77.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page77.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/table", {
    layout: DocsRouteLayout,
    meta: page78.meta,
    ...(page78.modulepreloads ? { modulepreloads: page78.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page78.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/tabs", {
    layout: DocsRouteLayout,
    meta: page79.meta,
    ...(page79.modulepreloads ? { modulepreloads: page79.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page79.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/toast", {
    layout: DocsRouteLayout,
    meta: page80.meta,
    ...(page80.modulepreloads ? { modulepreloads: page80.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page80.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/toggle", {
    layout: DocsRouteLayout,
    meta: page81.meta,
    ...(page81.modulepreloads ? { modulepreloads: page81.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page81.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/toggle-group", {
    layout: DocsRouteLayout,
    meta: page82.meta,
    ...(page82.modulepreloads ? { modulepreloads: page82.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page82.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/toolbar", {
    layout: DocsRouteLayout,
    meta: page83.meta,
    ...(page83.modulepreloads ? { modulepreloads: page83.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page83.body} />;
    },
  }) as SiteRoute,
  route("/gallery/components/tooltip", {
    layout: DocsRouteLayout,
    meta: page84.meta,
    ...(page84.modulepreloads ? { modulepreloads: page84.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page84.body} />;
    },
  }) as SiteRoute,
  route("/examples", {
    layout: DocsRouteLayout,
    meta: page85.meta,
    ...(page85.modulepreloads ? { modulepreloads: page85.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page85.body} />;
    },
  }) as SiteRoute,
  route("/examples/commerce", {
    layout: DocsRouteLayout,
    meta: page86.meta,
    ...(page86.modulepreloads ? { modulepreloads: page86.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page86.body} />;
    },
  }) as SiteRoute,
  route("/examples/crm", {
    layout: DocsRouteLayout,
    meta: page87.meta,
    ...(page87.modulepreloads ? { modulepreloads: page87.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page87.body} />;
    },
  }) as SiteRoute,
  route("/examples/stackoverflow", {
    layout: DocsRouteLayout,
    meta: page88.meta,
    ...(page88.modulepreloads ? { modulepreloads: page88.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page88.body} />;
    },
  }) as SiteRoute,
  route("/spec", {
    layout: DocsRouteLayout,
    meta: page89.meta,
    ...(page89.modulepreloads ? { modulepreloads: page89.modulepreloads } : {}),
    stylesheets: siteStylesheets,
    page() {
      return <DocsRoutePage page={page89.body} />;
    },
  }) as SiteRoute,
];

export const siteStaticExportApp = createApp({
  clientModules: siteClientModules,
  document: { lang: 'en', template: siteDocumentTemplate },
  routes,
});

export const siteNodeHandler = toNodeHandler(createRequestHandler(siteStaticExportApp));

export default siteStaticExportApp;
