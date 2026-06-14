import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { route } from '@jiso/server';
import { createMemoryVersionedClientModuleRegistry } from '@jiso/server/app-shell/client-modules';
import { createApp, createRequestHandler } from '@jiso/server/app-shell/core';
import { toNodeHandler } from '@jiso/server/app-shell/node';

import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const galleryGeneratedRoot = fileURLToPath(new URL('./generated/interactive/', import.meta.url));
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

// SPEC.md §4.4: load-bearing import maps are a non-goal — "the compiler and server emit full module
// URLs". Generated client modules `import { handler } from '@jiso/runtime'` (an identity wrapper), a
// bare specifier the browser cannot resolve. Serve a minimal runtime module at a resolvable /c/ URL
// and rewrite the bare import to it so the static export is interactive without an import map.
const galleryRuntimeModulePath = '/c/examples/gallery/src/generated/jiso-runtime.client.js';
const galleryRuntimeModuleSource = 'export const handler = (fn) => fn;\n';
const galleryRuntimeModuleHref = galleryInteractiveClientModules.put({
  path: galleryRuntimeModulePath,
  source: galleryRuntimeModuleSource,
  version: createHash('sha256').update(galleryRuntimeModuleSource).digest('hex').slice(0, 8),
});

export const galleryInteractiveClientModuleHrefs = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);

export const galleryInteractiveRoute = route('/gallery/interactive', {
  meta: {
    description: 'Compiled Jiso UI primitive demos with generated client handlers.',
    title: 'Jiso Interactive Gallery',
  },
  // Include the shared runtime module first so the static export writes it (the demo modules
  // import it) and the browser preloads it before the handler modules.
  modulepreloads: [galleryRuntimeModuleHref, ...galleryInteractiveClientModuleHrefs],
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
  const generatedClientSource = rewriteRuntimeImport(
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

function readGeneratedInteractiveArtifact(fileName: string): string {
  return readFileSync(new URL(fileName, `file://${galleryGeneratedRoot}`), 'utf8');
}

// SPEC.md §4.4: rewrite the bare `@jiso/runtime` specifier to the served runtime module URL so the
// browser can resolve it without an import map.
function rewriteRuntimeImport(source: string): string {
  return source.replaceAll("from '@jiso/runtime';", `from '${galleryRuntimeModuleHref}';`);
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
