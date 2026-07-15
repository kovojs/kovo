import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileComponentModule } from '../../packages/compiler/src/compile.ts';
import { assertRequestSafeRuntimeRealmLocked } from '@kovojs/core/internal/classifier-verdict';
import ts from 'typescript';
import { createServer as createViteServer } from 'vite-plus';

import {
  galleryHeadlessGeneratedModuleSpecifier,
  galleryPrimitiveActionsGeneratedImportManifest,
  galleryPrimitiveActionsGeneratedModuleSpecifier,
  galleryPrimitiveActionsImportManifest,
  galleryRuntimeModuleSpecifier,
  rebaseGalleryClientModuleManifest,
  resolveGalleryClientModuleSpecifiers,
  type GalleryClientModuleManifest,
} from '../../examples/gallery/src/client-module-manifest.js';
import { galleryComponentCatalog } from '../../examples/gallery/src/component-catalog.js';
import { galleryHandlerCompilerProjectFiles } from '../../examples/gallery/src/compiler-project.js';

import type { GalleryRouteView } from './components/gallery.js';
import type { DocsRouteContent } from './route-data.js';

// Authored one-liner per component (component-catalog.ts), used on the /components/
// index and surfaced to agents via aux.ts. Kept 1:1 with galleryRoutes by
// component-catalog.test.ts.
const gallerySummaries = new Map<string, string>(
  galleryComponentCatalog.map((entry) => [entry.component, entry.summary]),
);

// Components section: rendered component fixtures + compiled interactive demos.
//
// CONTRACT (owned by this module): build route-page data for the /components/
// index, the retired /components/interactive/ page, and one /components/<name>/
// page per fixture by SSR-loading examples/gallery/src fixtures, folding the
// compiled interactive demo into each component page, and registering the
// interactive demos' client modules into the passed registry (so the export
// replay serves them; SPEC §4.4 — no load-bearing import maps, manifest-resolve
// generated dependencies to versioned /c/ URLs).

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const galleryRoot = path.join(repoRoot, 'examples/gallery');
const headlessUiSourceRoot = path.join(repoRoot, 'packages/headless-ui/src');

export interface GalleryDeps {
  // The same registry passed to createApp(); register interactive demo modules here.
  clientModules: { put(input: { path: string; source: string; version: string }): string };
}

export interface GalleryRoutePageData {
  activePath: string;
  content: DocsRouteContent;
  markdownMirror?: string;
  meta: { description: string; title: string };
  modulepreloads?: readonly string[];
  url: string;
}

interface GalleryRoute {
  component: string;
  path: string;
  render: () => Promise<string> | string;
  title: string;
}

interface InteractiveDemo {
  name: string;
  render: () => Promise<string> | string;
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

// Component route paths are already authored as `/components/<name>` in
// demo-fixtures.tsx, so the docs URL is the path plus a trailing slash. The
// section was renamed from "gallery" to "components"; the index lives at
// `/components/`.
function galleryUrl(galleryRoutePath: string): string {
  return `${galleryRoutePath}/`;
}

/** SSR-load the gallery fixtures (static styled), the compiled interactive demos,
 * and the support module hrefs from examples/gallery/src/app-shell.ts. gallery.ts
 * itself runs inside the export's locked Vite SSR graph; the nested server reuses and
 * reasserts that established boundary so this module cannot become an unbootstrapped entrypoint. */
async function loadGalleryData(): Promise<GalleryData> {
  // This module is evaluated by the outer supported site runner after compiler/server lockdown.
  // Reassert that established realm state before compiler/filesystem work and before reusing Vite
  // for the nested gallery graph. Do not import the bootstrap runner here: Vite may instantiate
  // this transformed module again, and a second copy must never request late node:module loader
  // authority (SPEC §6.6 rule 6).
  assertRequestSafeRuntimeRealmLocked();
  const cleanupGeneratedServerArtifacts = await ensureGalleryInteractiveServerArtifacts();
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;

  try {
    vite = await createViteServer({
      appType: 'custom',
      configFile: path.join(galleryRoot, 'vite.config.ts'),
      logLevel: 'error',
      root: galleryRoot,
      server: { hmr: false, middlewareMode: true, watch: null, ws: false },
    });
    const gallery = await vite.ssrLoadModule('/src/demo-fixtures.tsx');
    const interactive = await vite.ssrLoadModule('/src/interactive-docs.tsx');
    const appShell = await vite.ssrLoadModule('/src/app-shell.ts');
    return {
      clientHrefs: appShell.galleryInteractiveClientModuleHrefs,
      galleryRoutes: gallery.galleryRoutes,
      interactiveDemos: interactive.interactiveGalleryDemos,
      supportClientHrefs: appShell.galleryInteractiveSupportClientModuleHrefs,
    };
  } finally {
    await vite?.close();
    cleanupGeneratedServerArtifacts();
  }
}

async function ensureGalleryInteractiveServerArtifacts(): Promise<() => void> {
  const generatedDir = path.join(repoRoot, 'examples/gallery/src/generated/interactive');
  if (existsSync(generatedDir)) return () => {};

  mkdirSync(generatedDir, { recursive: true });
  for (const fileName of sortedDirectoryEntries(
    path.join(repoRoot, 'examples/gallery/src/interactive'),
  )) {
    if (!fileName.endsWith('-demo.tsx')) continue;

    const source = readFileSync(
      path.join(repoRoot, 'examples/gallery/src/interactive', fileName),
      'utf8',
    );
    const serverSource = compileGalleryInteractiveServerModule(
      `src/interactive/${fileName}`,
      source,
    );

    const { renderSource } = (await import(
      `data:text/javascript;base64,${Buffer.from(serverSource).toString('base64')}`
    )) as { renderSource: () => string };
    writeFileSync(
      path.join(generatedDir, fileName),
      normalizeMovedGalleryInteractiveArtifact(renderSource()),
      'utf8',
    );
  }

  return () => {
    rmSync(path.join(repoRoot, 'examples/gallery/src/generated'), {
      force: true,
      recursive: true,
    });
  };
}

/** @internal Build the temporary gallery server artifact with the same finite handler-project
 * provenance as the registered client module. SPEC §5.2.1 and §9.5 require the rendered handler
 * href and the immutable module served during export replay to name one production version. */
export function compileGalleryInteractiveServerModule(fileName: string, source: string): string {
  const result = compileComponentModule({
    extraFiles: galleryHandlerCompilerProjectFiles(),
    fileName,
    source,
  } as Parameters<typeof compileComponentModule>[0] & {
    extraFiles: readonly { fileName: string; source: string }[];
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `site app shell: gallery interactive demo ${fileName} failed compilation:\n${errors
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  const serverFile = result.files.find((file) => file.kind === 'server');
  if (serverFile === undefined) {
    throw new Error(
      `site app shell: gallery interactive demo ${fileName} produced no server module.`,
    );
  }
  return serverFile.source;
}

interface SupportRegistration {
  headlessUiModuleHrefs: ReadonlyMap<string, string>;
  primitiveActionsGeneratedHref: string;
  primitiveActionsHref: string;
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

  const modules: Array<{ pathName: string; source: string }> = [];
  for (const sourcePath of ['client-helper-abi.ts', 'generated.ts']) {
    modules.push(headlessUiClientModuleSource(sourcePath));
  }
  for (const directory of ['lib', 'primitives']) {
    const dirPath = path.join(headlessUiSourceRoot, directory);
    for (const entry of sortedDirectoryEntries(dirPath)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;

      modules.push(headlessUiClientModuleSource(`${directory}/${entry}`));
    }
  }

  const graphVersion = contentHash(
    modules.map((module) => `${module.pathName}\n${module.source}`).join('\n'),
  ).slice(0, 8);

  for (const module of modules) {
    const href = clientModules.put({
      path: module.pathName,
      source: module.source,
      version: graphVersion,
    });
    moduleHrefs.set(module.pathName, href);
  }

  const primitiveActionsGeneratedHref = registerPrimitiveActionsGeneratedClientModule(
    clientModules,
    moduleHrefs,
  );
  const primitiveActionsHref = registerPrimitiveActionsClientModule(
    clientModules,
    moduleHrefs,
    primitiveActionsGeneratedHref,
  );

  return {
    headlessUiModuleHrefs: moduleHrefs,
    primitiveActionsGeneratedHref,
    primitiveActionsHref,
    runtimeHref,
  };
}

function headlessUiClientModuleSource(sourcePath: string): { pathName: string; source: string } {
  const pathName = `/c/packages/headless-ui/src/${sourcePath.replace(/\.ts$/, '.js')}`;
  const source = readFileSync(path.join(headlessUiSourceRoot, sourcePath), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  return { pathName, source: transpiled };
}

function registerPrimitiveActionsClientModule(
  clientModules: GalleryDeps['clientModules'],
  headlessUiModuleHrefs: ReadonlyMap<string, string>,
  primitiveActionsGeneratedHref: string,
): string {
  const pathName = '/c/examples/gallery/src/primitive-actions.js';
  const rawSource = readFileSync(
    path.join(repoRoot, 'examples/gallery/src/primitive-actions.ts'),
    'utf8',
  );
  const source = resolveGalleryClientModuleSpecifiers(
    ts.transpileModule(rawSource, {
      compilerOptions: {
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'primitive-actions.ts',
    }).outputText,
    galleryPrimitiveActionsImportManifest(),
    (moduleSpecifier) =>
      resolveGalleryClientModuleSpecifier(moduleSpecifier, {
        headlessUiModuleHrefs,
        primitiveActionsGeneratedHref,
        primitiveActionsHref: '',
        runtimeHref: '',
      }),
  );

  return clientModules.put({
    path: pathName,
    source,
    version: contentHash(source).slice(0, 8),
  });
}

function registerPrimitiveActionsGeneratedClientModule(
  clientModules: GalleryDeps['clientModules'],
  headlessUiModuleHrefs: ReadonlyMap<string, string>,
): string {
  const pathName = '/c/examples/gallery/src/primitive-actions.generated.js';
  const rawSource = readFileSync(
    path.join(repoRoot, 'examples/gallery/src/primitive-actions.generated.ts'),
    'utf8',
  );
  const source = resolveGalleryClientModuleSpecifiers(
    ts.transpileModule(rawSource, {
      compilerOptions: {
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'primitive-actions.generated.ts',
    }).outputText,
    galleryPrimitiveActionsGeneratedImportManifest(),
    (moduleSpecifier) =>
      resolveGalleryClientModuleSpecifier(moduleSpecifier, {
        headlessUiModuleHrefs,
        primitiveActionsGeneratedHref: '',
        primitiveActionsHref: '',
        runtimeHref: '',
      }),
  );

  return clientModules.put({
    path: pathName,
    source,
    version: contentHash(source).slice(0, 8),
  });
}

/** Register the compiled interactive-gallery client modules with the same path +
 * version the folded component pages reference. SPEC §4.4 makes load-bearing import maps a
 * non-goal, so resolve manifest-declared dependencies to registered /c/ URLs. Mirrors
 * examples/gallery/src/app-shell.ts registerGalleryInteractiveClientModule. */
function registerGalleryInteractiveClientModules(
  clientModules: GalleryDeps['clientModules'],
  support: SupportRegistration,
  demos: readonly InteractiveDemo[],
  expectedHrefs: readonly string[],
): void {
  for (const [index, demo] of demos.entries()) {
    const compiled = galleryInteractiveClientModule(demo.name);
    const expected = clientModuleRegistrationFromHref(expectedHrefs[index]);
    const pathName = expected?.pathName ?? compiled.pathName;
    const rawClientSource = compiled.source;
    const source = resolveGalleryClientModuleSpecifiers(
      rawClientSource,
      compiled.manifest,
      (moduleSpecifier) => resolveGalleryClientModuleSpecifier(moduleSpecifier, support),
    );
    clientModules.put({
      path: pathName,
      source,
      version: expected?.version ?? galleryInteractiveClientModuleVersion(rawClientSource),
    });
  }
}

function clientModuleRegistrationFromHref(
  href: string | undefined,
): { pathName: string; version: string } | null {
  if (!href) return null;
  const prefix = '/c/__v/';
  if (!href.startsWith(prefix)) {
    throw new Error(`site app shell: unexpected gallery client href: ${href}`);
  }
  const versionEnd = href.indexOf('/', prefix.length);
  if (versionEnd === -1) {
    throw new Error(`site app shell: malformed gallery client href: ${href}`);
  }
  const pathEnd = href.search(/[?#]/);
  return {
    pathName: `/c/${href.slice(versionEnd + 1, pathEnd === -1 ? href.length : pathEnd)}`,
    version: decodeURIComponent(href.slice(prefix.length, versionEnd)),
  };
}

function galleryInteractiveClientModule(demoName: string): {
  manifest: GalleryClientModuleManifest;
  pathName: string;
  source: string;
} {
  const generatedClientPath = path.join(
    repoRoot,
    'examples/gallery/src/generated/interactive',
    `${demoName}.client.js`,
  );
  if (existsSync(generatedClientPath)) {
    const compiled = compileGalleryInteractiveClientModule(
      demoName,
      `src/generated/interactive/${demoName}.tsx`,
    );
    return {
      manifest: rebaseMovedGalleryInteractiveClientManifest(compiled.manifest),
      pathName: `/c/examples/gallery/src/generated/interactive/${demoName}.client.js`,
      source: readFileSync(generatedClientPath, 'utf8'),
    };
  }

  const compiled = compileGalleryInteractiveClientModule(
    demoName,
    `src/interactive/${demoName}.tsx`,
  );
  return {
    manifest: compiled.manifest,
    pathName: `/c/src/interactive/${demoName}.client.js`,
    source: compiled.source,
  };
}

function rebaseMovedGalleryInteractiveClientManifest(
  manifest: GalleryClientModuleManifest,
): GalleryClientModuleManifest {
  return rebaseGalleryClientModuleManifest(
    manifest,
    new Map([['../primitive-actions.js', '../../primitive-actions.js']]),
  );
}

/** @internal Compile a gallery client artifact with the same finite handler-project provenance as
 * the server artifact. SPEC §5.2 requires a referenced handler export and its served module to be
 * produced by one fail-closed compilation contract. */
export function compileGalleryInteractiveClientModule(
  demoName: string,
  fileName: string,
): { manifest: GalleryClientModuleManifest; source: string } {
  const source = readFileSync(
    path.join(repoRoot, 'examples/gallery/src/interactive', `${demoName}.tsx`),
    'utf8',
  );
  const projectDirectory = path.posix.dirname(path.posix.dirname(fileName));
  const result = compileComponentModule({
    extraFiles: galleryHandlerCompilerProjectFiles(projectDirectory),
    fileName,
    source,
  } as Parameters<typeof compileComponentModule>[0] & {
    extraFiles: readonly { fileName: string; source: string }[];
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `site app shell: gallery interactive demo ${demoName} client compilation failed:\n${errors
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }
  const clientSource = result.files.find((file) => file.kind === 'client')?.source;
  if (clientSource === undefined) {
    throw new Error(
      `site app shell: gallery interactive demo ${demoName} produced no client module.`,
    );
  }

  return { manifest: result.clientModuleImportManifest, source: clientSource };
}

function normalizeMovedGalleryInteractiveArtifact(source: string): string {
  return source.replaceAll('../primitive-actions.js', '../../primitive-actions.js');
}

function resolveGalleryClientModuleSpecifier(
  moduleSpecifier: string,
  support: SupportRegistration,
): string {
  if (moduleSpecifier === galleryRuntimeModuleSpecifier) return support.runtimeHref;
  if (moduleSpecifier === '../primitive-actions.js') return support.primitiveActionsHref;
  if (moduleSpecifier === '../../primitive-actions.js') return support.primitiveActionsHref;
  if (moduleSpecifier === galleryPrimitiveActionsGeneratedModuleSpecifier) {
    return support.primitiveActionsGeneratedHref;
  }
  if (moduleSpecifier === galleryHeadlessGeneratedModuleSpecifier) {
    return headlessUiClientModuleHref(support.headlessUiModuleHrefs, 'generated');
  }
  const family = moduleSpecifier.match(/^@kovojs\/(?:headless-ui|ui)\/([a-z0-9-]+)$/)?.[1];
  if (family !== undefined) {
    return headlessUiClientModuleHref(support.headlessUiModuleHrefs, `primitives/${family}`);
  }

  throw new Error(`site app shell: missing gallery client module resolver for ${moduleSpecifier}.`);
}

function headlessUiClientModuleHref(
  headlessUiModuleHrefs: ReadonlyMap<string, string>,
  sourcePathWithoutExtension: string,
): string {
  const href = headlessUiModuleHrefs.get(
    `/c/packages/headless-ui/src/${sourcePathWithoutExtension}.js`,
  );
  if (href === undefined) {
    throw new Error(
      `site app shell: missing gallery headless UI client module for ${sourcePathWithoutExtension}.`,
    );
  }
  return href;
}

function galleryInteractiveClientModuleVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
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

function renderedValueToHtml(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  if (typeof value === 'object' && typeof (value as { html?: unknown }).html === 'string') {
    return (value as { html: string }).html;
  }

  return JSON.stringify(value) ?? '';
}

/** Re-root the gallery demo's internal links into the docs /components/ namespace
 * so they resolve on the static host (and the W9 link gate passes). Component
 * links are authored as `/components/<name>` and need only a trailing slash. */
function rewriteGalleryDemoHrefs(html: string, galleryRoute: GalleryRoute): string {
  return html.replace(
    /\shref="\/(?!assets\/|c\/|docs\/|tutorial\/|guides\/|examples\/|api\/|reference\/|spec\/|fonts\/|llms\.txt|$)([^"]*)"/g,
    (_match, href: string) => {
      if (href.startsWith('components/')) return ` href="/${href}/"`;
      return ` href="${galleryUrl(galleryRoute.path)}"`;
    },
  );
}

export async function buildGalleryRoutePages({
  clientModules,
}: GalleryDeps): Promise<GalleryRoutePageData[]> {
  const { clientHrefs, galleryRoutes, interactiveDemos, supportClientHrefs } =
    await loadGalleryData();

  // Register the interactive demos' client modules into the same registry
  // createApp() serves, so the static-export replay can serve and copy them
  // (else KV229). Support modules (runtime shim + primitives) first, then the
  // per-demo compiled handlers.
  const support = registerGalleryInteractiveSupportClientModules(clientModules);
  registerGalleryInteractiveClientModules(clientModules, support, interactiveDemos, clientHrefs);

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

  const pages: GalleryRoutePageData[] = [];

  // 1. The /components/ index route.
  pages.push({
    activePath: '/components/',
    content: {
      kind: 'section-index',
      section: {
        key: 'components',
        pages: galleryRoutes.map((galleryRoute) => ({
          description: gallerySummaries.get(galleryRoute.component),
          title: galleryRoute.title,
          url: galleryUrl(galleryRoute.path),
        })),
        title: 'Components',
      },
    },
    meta: {
      description: 'Kovo components — rendered headless and styled component fixtures.',
      title: 'Components · Kovo',
    },
    url: '/components/',
  });

  // 2. The retired /components/interactive/ URL remains a normal TSX docs route
  // so enhanced navigation has route/page metadata on every docs-site document.
  pages.push({
    activePath: '/components/',
    content: {
      kind: 'section-index',
      section: {
        key: 'components',
        pages: [
          {
            description: 'The interactive gallery now lives inside each component fixture.',
            title: 'Components',
            url: '/components/',
          },
        ],
        title: 'Components moved',
      },
    },
    meta: {
      description: 'The interactive gallery has moved into the component pages.',
      title: 'Components · Kovo',
    },
    url: '/components/interactive/',
  });

  // 3. One /components/<path>/ route per fixture: render the compiled
  // interactive demo when one exists (with the behavior-contract table lifted from
  // the static fixture) else the static styled fixture; set modulepreloads on
  // pages with an interactive demo.
  for (const galleryRoute of galleryRoutes) {
    const interactive = interactiveByComponent.get(galleryRoute.component);
    const staticHtml = renderedValueToHtml(await galleryRoute.render());
    const interactiveHtml = interactive ? renderedValueToHtml(await interactive.render()) : '';
    // Wrap with the demo's id (as the standalone interactive page did) so any
    // in-demo self-anchor (e.g. hover-card → #hover-card-demo) still resolves.
    const demoSource = interactive
      ? `<div data-gallery-interactive-route="${escapeHtmlAttribute(
          interactive.name,
        )}" id="${escapeHtmlAttribute(
          interactive.name,
        )}">${interactiveHtml}${extractBehaviorContract(staticHtml)}</div>`
      : staticHtml;
    const demoHtml = rewriteGalleryDemoHrefs(demoSource, galleryRoute);
    const url = galleryUrl(galleryRoute.path);

    pages.push({
      activePath: url,
      content: {
        gallery: {
          component: galleryRoute.component,
          demoHtml,
          interactive: Boolean(interactive),
          route: { path: galleryRoute.path, title: galleryRoute.title },
          routes: routeViews,
          source: {
            fixture: 'examples/gallery/src/demo-fixtures.tsx',
            interactiveDemo: interactive
              ? `examples/gallery/src/interactive/${interactive.name}.tsx`
              : undefined,
            packageSource: `packages/ui/src/${galleryRoute.component}.tsx`,
          },
          summary: gallerySummaries.get(galleryRoute.component) ?? '',
        },
        kind: 'gallery',
      },
      meta: {
        description: `${galleryRoute.title} component gallery fixture.`,
        title: `${galleryRoute.title} · Gallery · Kovo`,
      },
      markdownMirror: `/components/${galleryRoute.component}.md`,
      ...(interactive ? { modulepreloads: interactive.modulepreloads } : {}),
      url,
    });
  }

  return pages;
}
