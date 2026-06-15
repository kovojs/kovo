import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { route } from '@jiso/server';
import { createMemoryVersionedClientModuleRegistry } from '@jiso/server/app-shell/client-modules';
import { createApp, createRequestHandler } from '@jiso/server/app-shell/core';
import { toNodeHandler } from '@jiso/server/app-shell/node';
import ts from 'typescript';

import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const galleryGeneratedRoot = fileURLToPath(new URL('./generated/interactive/', import.meta.url));
const headlessUiSourceRoot = fileURLToPath(
  new URL('../../../packages/headless-ui/src/', import.meta.url),
);
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

// SPEC.md §4.4: load-bearing import maps are a non-goal — "the compiler and server emit full module
// URLs". Generated client modules import tiny declaration helpers from `@jiso/runtime`, a bare
// specifier the browser cannot resolve. Serve a minimal runtime module at a resolvable /c/ URL and
// rewrite the bare import to it so the static export is interactive without an import map.
const galleryRuntimeModulePath = '/c/examples/gallery/src/generated/jiso-runtime.client.js';
const galleryRuntimeModuleSource = [
  'export const derive = (inputs, run) => ({ inputs, run });',
  'export const handler = (fn) => fn;',
  '',
].join('\n');
const galleryRuntimeModuleHref = galleryInteractiveClientModules.put({
  path: galleryRuntimeModulePath,
  source: galleryRuntimeModuleSource,
  version: createHash('sha256').update(galleryRuntimeModuleSource).digest('hex').slice(0, 8),
});
const galleryHeadlessPrimitivesModulePath = '/c/packages/headless-ui/src/primitives/index.js';
const galleryHeadlessUiClientModuleHrefMap = registerHeadlessUiClientModules();
export const galleryHeadlessUiClientModuleHrefs = Object.freeze([
  ...galleryHeadlessUiClientModuleHrefMap.values(),
]);
const galleryHeadlessPrimitivesModuleHref = galleryHeadlessUiClientModuleHrefMap.get(
  galleryHeadlessPrimitivesModulePath,
);
if (galleryHeadlessPrimitivesModuleHref === undefined) {
  throw new Error('Missing gallery headless UI primitives client module.');
}

export const galleryInteractiveClientModuleHrefs = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);

export const galleryInteractiveRoute = route('/gallery/interactive', {
  meta: {
    description: 'Compiled Jiso UI primitive demos with generated client handlers.',
    title: 'Jiso Interactive Gallery',
  },
  // Include the shared runtime module first so the static export writes it (the demo modules
  // import it), then the primitive modules imported by generated handlers, before demo handlers.
  modulepreloads: [
    galleryRuntimeModuleHref,
    ...galleryHeadlessUiClientModuleHrefs,
    ...galleryInteractiveClientModuleHrefs,
  ],
  page() {
    return renderInteractiveGalleryRoute();
  },
  // SPEC §13.1: the document head delivers the stylesheet. The gallery is
  // exported into the docs dist alongside exportSiteStaticApp, which copies the
  // Tailwind build to /assets/site.css (it @sources examples/gallery/src), so
  // without this hint the demos render unstyled. Matches the docs pages' link.
  stylesheets: ['/assets/site.css'],
});

export function createGalleryInteractiveAppShell() {
  const app = createApp({
    clientModules: galleryInteractiveClientModules,
    document: { lang: 'en-US' },
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [galleryInteractiveRoute],
  });
  const requestHandler = createRequestHandler(app);

  return {
    app,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export const galleryInteractiveAppShell = createGalleryInteractiveAppShell();
export const galleryInteractiveNodeHandler = galleryInteractiveAppShell.nodeHandler;

export default galleryInteractiveAppShell.app;

function registerGalleryInteractiveClientModule(demoName: string): string {
  const modulePath = `/c/examples/gallery/src/generated/interactive/${demoName}.client.js`;
  const generatedServerTsx = readGeneratedInteractiveArtifact(`${demoName}.tsx`);
  const generatedClientSource = rewriteGalleryClientImports(
    readGeneratedInteractiveArtifact(`${demoName}.client.js`),
  );
  const version = generatedClientModuleVersion(generatedServerTsx, modulePath, demoName);
  const href = galleryInteractiveClientModules.put({
    path: modulePath,
    source: generatedClientSource,
    version,
  });

  if (href !== `${modulePath}?v=${version}`) {
    throw new Error(`Unexpected gallery client module href for ${demoName}: ${href}`);
  }

  return href;
}

function registerHeadlessUiClientModules(): ReadonlyMap<string, string> {
  const hrefs = new Map<string, string>();

  for (const directory of ['lib', 'primitives']) {
    for (const fileName of readdirSync(
      new URL(`${directory}/`, `file://${headlessUiSourceRoot}`),
    )) {
      if (!fileName.endsWith('.ts') || fileName.endsWith('.test.ts')) continue;

      const sourcePath = `${directory}/${fileName}`;
      const modulePath = `/c/packages/headless-ui/src/${sourcePath.replace(/\.ts$/, '.js')}`;
      const source = readFileSync(new URL(sourcePath, `file://${headlessUiSourceRoot}`), 'utf8');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
        fileName,
      }).outputText;
      const href = galleryInteractiveClientModules.put({
        path: modulePath,
        source: transpiled,
        version: createHash('sha256').update(transpiled).digest('hex').slice(0, 8),
      });

      hrefs.set(modulePath, href);
    }
  }

  return hrefs;
}

function readGeneratedInteractiveArtifact(fileName: string): string {
  return readFileSync(new URL(fileName, `file://${galleryGeneratedRoot}`), 'utf8');
}

// SPEC.md §4.4: rewrite bare specifiers to served module URLs so the browser can resolve the
// generated client module graph without an import map.
function rewriteGalleryClientImports(source: string): string {
  return source
    .replaceAll("from '@jiso/runtime';", `from '${galleryRuntimeModuleHref}';`)
    .replaceAll(
      'from "@jiso/headless-ui/primitives";',
      `from '${galleryHeadlessPrimitivesModuleHref}';`,
    )
    .replaceAll(
      "from '@jiso/headless-ui/primitives';",
      `from '${galleryHeadlessPrimitivesModuleHref}';`,
    );
}

function generatedClientModuleVersion(
  source: string,
  modulePath: string,
  demoName: string,
): string {
  const escapedModulePath = escapeRegExp(modulePath);
  const versionPattern = new RegExp(`${escapedModulePath}\\?v=([0-9a-f]{8})#`, 'g');
  const versions = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = versionPattern.exec(source)) !== null) {
    versions.add(String(match[1]));
  }

  if (versions.size !== 1) {
    throw new Error(
      `Expected one generated client version for ${demoName}, found ${versions.size}.`,
    );
  }

  const version = versions.values().next().value;
  if (version === undefined) {
    throw new Error(`Missing generated client version for ${demoName}.`);
  }

  return version;
}

function routeValueToHtml(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
