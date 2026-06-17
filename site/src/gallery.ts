import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { respond, route } from '@kovojs/server';
import ts from 'typescript';
import { createServer } from 'vite-plus';

import { renderSectionIndex } from './components/docs-layout.js';
import { renderGalleryPage, type GalleryRouteView } from './components/gallery.js';
import type { NavGroup } from './content.js';
import { docRoute, routePath, type AnyRoute } from './route-kit.js';

// Gallery section: rendered component fixtures + compiled interactive demos.
//
// CONTRACT (owned by this module): build the gallery routes — the /gallery/
// index, the retired /gallery/interactive/ redirect, and one
// /gallery/components/<name>/ page per fixture — by SSR-loading
// examples/gallery/src fixtures, folding the compiled interactive demo into each
// component page, and registering the interactive demos' client modules into the
// passed registry (so the export replay serves them; SPEC §4.4 — no load-bearing
// import maps, rewrite bare specifiers to versioned /c/ URLs). Ports the previous
// build: scripts/build.mjs (loadGalleryData, renderGalleryPage) and
// scripts/app-shell.mjs (gallery client-module registration).

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const headlessUiSourceRoot = path.join(repoRoot, 'packages/headless-ui/src');
const galleryGeneratedDir = path.join(repoRoot, 'examples/gallery/src/generated/interactive');

const textEncoder = new TextEncoder();

export interface GalleryDeps {
  // The same registry passed to createApp(); register interactive demo modules here.
  clientModules: { put(input: { path: string; source: string; version: string }): string };
  groups: NavGroup[];
}

interface GalleryRoute {
  component: string;
  path: string;
  render: () => string;
  title: string;
}

interface InteractiveDemo {
  name: string;
  render: () => string;
  title: string;
}

interface GalleryData {
  clientHrefs: readonly string[];
  galleryRoutes: readonly GalleryRoute[];
  interactiveDemos: readonly InteractiveDemo[];
  supportClientHrefs: readonly string[];
}

function contentHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

function galleryUrl(galleryRoutePath: string): string {
  return `/gallery${galleryRoutePath}/`;
}

/** SSR-load the gallery fixtures (static styled), the compiled interactive demos,
 * and the support module hrefs from examples/gallery/src/app-shell.ts. gallery.ts
 * itself runs inside the export's vite SSR graph; spinning a nested vite server to
 * load the gallery sources is what scripts/build.mjs did and is acceptable. */
async function loadGalleryData(): Promise<GalleryData> {
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    root: repoRoot,
    server: { middlewareMode: true },
  });

  try {
    const gallery = await vite.ssrLoadModule('/examples/gallery/src/demo-fixtures.tsx');
    const interactive = await vite.ssrLoadModule('/examples/gallery/src/interactive-docs.tsx');
    const appShell = await vite.ssrLoadModule('/examples/gallery/src/app-shell.ts');
    return {
      clientHrefs: appShell.galleryInteractiveClientModuleHrefs,
      galleryRoutes: gallery.galleryRoutes,
      interactiveDemos: interactive.interactiveGalleryDemos,
      supportClientHrefs: appShell.galleryInteractiveSupportClientModuleHrefs,
    };
  } finally {
    await vite.close();
  }
}

interface SupportRegistration {
  primitivesHref: string;
  runtimeHref: string;
}

/** Register the gallery's interactive support modules (the in-memory kovo-runtime
 * shim + the transpiled headless-ui lib/primitives) into the passed registry with
 * the exact path+version the generated server markup references. Ports
 * scripts/app-shell.mjs registerGalleryInteractiveSupportClientModules. */
function registerGalleryInteractiveSupportClientModules(
  clientModules: GalleryDeps['clientModules'],
): SupportRegistration {
  const moduleHrefs = new Map<string, string>();
  const runtimeSource = [
    'export const derive = (inputs, run) => ({ inputs, run });',
    'export const handler = (fn) => fn;',
    'export const kovoStyleProperty = (name, value) => value == null || value === false ? "" : `${name}: ${value}`;',
    '',
  ].join('\n');
  const runtimePath = '/c/examples/gallery/src/generated/kovo-runtime.client.js';
  const runtimeHref = clientModules.put({
    path: runtimePath,
    source: runtimeSource,
    version: contentHash(runtimeSource).slice(0, 8),
  });
  moduleHrefs.set(runtimePath, runtimeHref);

  for (const directory of ['lib', 'primitives']) {
    const dirPath = path.join(headlessUiSourceRoot, directory);
    for (const entry of sortedDirectoryEntries(dirPath)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;

      const pathName = `/c/packages/headless-ui/src/${directory}/${entry.replace(/\.ts$/, '.js')}`;
      const source = readFileSync(path.join(dirPath, entry), 'utf8');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: entry,
      }).outputText;
      const href = clientModules.put({
        path: pathName,
        source: transpiled,
        version: contentHash(transpiled).slice(0, 8),
      });
      moduleHrefs.set(pathName, href);
    }
  }

  const primitivesHref = moduleHrefs.get('/c/packages/headless-ui/src/primitives/index.js');
  if (primitivesHref === undefined) {
    throw new Error('site app shell: missing gallery headless UI primitives client module.');
  }

  return { primitivesHref, runtimeHref };
}

/** Register the compiled interactive-gallery client modules with the same path +
 * version the folded component pages reference (the version lives in the generated
 * server markup's on:click href). SPEC §4.4 makes load-bearing import maps a
 * non-goal, so rewrite generated bare package imports to registered /c/ URLs.
 * Ports scripts/app-shell.mjs registerGalleryInteractiveClientModules. */
function registerGalleryInteractiveClientModules(
  clientModules: GalleryDeps['clientModules'],
  support: SupportRegistration,
): void {
  if (!existsSync(galleryGeneratedDir)) return;

  for (const entry of sortedDirectoryEntries(galleryGeneratedDir)) {
    if (!entry.endsWith('.client.js')) continue;

    const name = entry.replace(/\.client\.js$/, '');
    const source = rewriteGalleryClientImports(
      readFileSync(path.join(galleryGeneratedDir, entry), 'utf8'),
      support,
    );
    const serverTsx = readFileSync(path.join(galleryGeneratedDir, `${name}.tsx`), 'utf8');
    const pathName = `/c/examples/gallery/src/generated/interactive/${name}.client.js`;
    clientModules.put({
      path: pathName,
      source,
      version: galleryInteractiveClientModuleVersion(serverTsx, pathName, name),
    });
  }
}

function rewriteGalleryClientImports(source: string, support: SupportRegistration): string {
  return source
    .replaceAll("from '@kovojs/runtime/generated';", `from '${support.runtimeHref}';`)
    .replaceAll("from '@kovojs/runtime';", `from '${support.runtimeHref}';`)
    .replaceAll('from "@kovojs/headless-ui/primitives";', `from '${support.primitivesHref}';`)
    .replaceAll("from '@kovojs/headless-ui/primitives';", `from '${support.primitivesHref}';`);
}

function galleryInteractiveClientModuleVersion(
  serverTsx: string,
  modulePath: string,
  name: string,
): string {
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\?v=([0-9a-f]{8})#`, 'g');
  const versions = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(serverTsx)) !== null) versions.add(String(match[1]));

  if (versions.size !== 1) {
    throw new Error(
      `site app shell: expected one generated client version for ${name}, found ${versions.size}.`,
    );
  }
  return [...versions][0]!;
}

function sortedDirectoryEntries(directory: string): string[] {
  return readdirSync(directory).sort((left, right) => left.localeCompare(right));
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** The behavior-contract table (SPEC §4.6 surface) is authored inside each static
 * fixture. When a component renders its interactive demo instead, lift that table
 * out of the fixture so the contract stays on the page. */
function extractBehaviorContract(staticHtml: string): string {
  const match = staticHtml.match(/<table data-gallery-contract[\s\S]*?<\/table>/);
  return match ? match[0] : '';
}

/** Re-root the gallery demo's internal links into the docs /gallery/ namespace so
 * they resolve on the static host (and the W9 link gate passes). */
function rewriteGalleryDemoHrefs(html: string, galleryRoute: GalleryRoute): string {
  return html.replace(
    /\shref="\/(?!assets\/|c\/|docs\/|tutorial\/|guides\/|gallery\/|api\/|spec\/|fonts\/|llms\.txt|$)([^"]*)"/g,
    (_match, href: string) => {
      if (href.startsWith('components/')) return ` href="/gallery/${href}/"`;
      return ` href="${galleryUrl(galleryRoute.path)}"`;
    },
  );
}

/** Static redirect for the retired /gallery/interactive/ URL → gallery index.
 * Meta-refresh + canonical works on any static host and with JS disabled; the
 * visible link keeps check-links happy and gives a manual fallback. Ports
 * scripts/build.mjs renderGalleryInteractiveRedirect. */
function renderGalleryInteractiveRedirect(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gallery · Kovo</title>
    <meta name="description" content="The interactive gallery has moved into the component gallery." />
    <link rel="canonical" href="/gallery/" />
    <meta http-equiv="refresh" content="0; url=/gallery/" />
  </head>
  <body>
    <p>The interactive gallery is now part of the <a href="/gallery/">component gallery</a>.</p>
  </body>
</html>
`;
}

export async function buildGalleryRoutes({
  clientModules,
  groups,
}: GalleryDeps): Promise<AnyRoute[]> {
  const { clientHrefs, galleryRoutes, interactiveDemos, supportClientHrefs } =
    await loadGalleryData();

  // Register the interactive demos' client modules into the same registry
  // createApp() serves, so the static-export replay can serve and copy them
  // (else KV229). Support modules (runtime shim + primitives) first, then the
  // per-demo compiled handlers.
  const support = registerGalleryInteractiveSupportClientModules(clientModules);
  registerGalleryInteractiveClientModules(clientModules, support);

  // Map gallery component → its compiled interactive demo. Demo names are the
  // component plus a `-demo` suffix; client-module hrefs are index-aligned with
  // the demo list. pure-markup-demo has no component route and is dropped.
  const interactiveByComponent = new Map(
    interactiveDemos.map((demo, index) => [
      demo.name.replace(/-demo$/, ''),
      {
        modulepreloads: [...supportClientHrefs, clientHrefs[index]!],
        name: demo.name,
        render: demo.render,
      },
    ]),
  );

  const routeViews: GalleryRouteView[] = galleryRoutes.map((galleryRoute) => ({
    path: galleryRoute.path,
    title: galleryRoute.title,
  }));

  const routes: AnyRoute[] = [];

  // 1. The /gallery/ index route.
  routes.push(
    docRoute(
      '/gallery/',
      {
        description: 'Kovo component gallery — rendered headless and styled component fixtures.',
        title: 'Gallery · Kovo',
      },
      {
        activePath: '/gallery/',
        contentHtml: renderSectionIndex({
          key: 'gallery',
          pages: galleryRoutes.map((galleryRoute) => ({
            title: galleryRoute.title,
            url: galleryUrl(galleryRoute.path),
          })),
          title: 'Gallery',
        }),
        groups,
        prose: false,
      },
    ),
  );

  // 2. The retired /gallery/interactive/ redirect — a standalone HTML document,
  // returned as raw bytes (disposition inline) so the app-shell document template
  // does not wrap it. Static export writes any 200 text/html route document.
  const redirectHtml = renderGalleryInteractiveRedirect();
  routes.push(
    route(routePath('/gallery/interactive/'), {
      meta: {
        description: 'The interactive gallery has moved into the component gallery.',
        title: 'Gallery · Kovo',
      },
      page() {
        return respond.stream(textEncoder.encode(redirectHtml), {
          contentType: 'text/html; charset=utf-8',
          disposition: 'inline',
        });
      },
    }) as AnyRoute,
  );

  // 3. One /gallery/components/<path>/ route per fixture: render the compiled
  // interactive demo when one exists (with the behavior-contract table lifted from
  // the static fixture) else the static styled fixture; set modulepreloads on
  // pages with an interactive demo.
  for (const galleryRoute of galleryRoutes) {
    const interactive = interactiveByComponent.get(galleryRoute.component);
    const staticHtml = galleryRoute.render();
    // Wrap with the demo's id (as the standalone interactive page did) so any
    // in-demo self-anchor (e.g. hover-card → #hover-card-demo) still resolves.
    const demoSource = interactive
      ? `<div data-gallery-interactive-route="${escapeHtmlAttribute(
          interactive.name,
        )}" id="${escapeHtmlAttribute(
          interactive.name,
        )}">${interactive.render()}${extractBehaviorContract(staticHtml)}</div>`
      : staticHtml;
    const demoHtml = rewriteGalleryDemoHrefs(demoSource, galleryRoute);
    const url = galleryUrl(galleryRoute.path);

    routes.push(
      docRoute(
        url,
        {
          description: `${galleryRoute.title} component gallery fixture.`,
          title: `${galleryRoute.title} · Gallery · Kovo`,
        },
        {
          activePath: url,
          contentHtml: renderGalleryPage({
            demoHtml,
            interactive: Boolean(interactive),
            route: { path: galleryRoute.path, title: galleryRoute.title },
            routes: routeViews,
          }),
          groups,
          prose: false,
        },
        interactive ? { modulepreloads: interactive.modulepreloads } : {},
      ),
    );
  }

  return routes;
}
