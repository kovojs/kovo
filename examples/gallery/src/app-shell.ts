import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileComponentModule } from '../../../packages/compiler/src/compile.ts';
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  route,
  toNodeHandler,
} from '@kovojs/server';
import ts from 'typescript';

import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const headlessUiSourceRoot = fileURLToPath(
  new URL('../../../packages/headless-ui/src/', import.meta.url),
);
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

// SPEC.md §4.4: load-bearing import maps are a non-goal — "the compiler and server emit full module
// URLs". Generated client modules import tiny declaration helpers from `@kovojs/browser/generated`,
// a bare specifier the browser cannot resolve. Serve a minimal runtime module at a resolvable /c/
// URL and rewrite the bare import to it so the static export is interactive without an import map.
const galleryRuntimeModulePath = '/c/examples/gallery/src/generated/kovo-runtime.client.js';
const galleryRuntimeModuleSource = [
  'export const derive = (inputs, run) => ({ inputs, run });',
  'export const handler = (fn) => fn;',
  'export const kovoStyleProperty = (name, value) => value == null || value === false ? "" : `${name}: ${value}`;',
  '',
].join('\n');
const galleryRuntimeModuleHref = galleryInteractiveClientModules.put({
  path: galleryRuntimeModulePath,
  source: galleryRuntimeModuleSource,
  version: createHash('sha256').update(galleryRuntimeModuleSource).digest('hex').slice(0, 8),
});
const galleryHeadlessUiClientModuleHrefMap = registerHeadlessUiClientModules();
export const galleryHeadlessUiClientModuleHrefs = Object.freeze([
  ...galleryHeadlessUiClientModuleHrefMap.values(),
]);
export const galleryInteractiveSupportClientModuleHrefs = Object.freeze([
  galleryRuntimeModuleHref,
  ...galleryHeadlessUiClientModuleHrefs,
]);

export const galleryInteractiveClientModuleHrefs = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);

export const galleryInteractiveRoute = route('/gallery/interactive', {
  meta: {
    description: 'Compiled Kovo UI primitive demos with generated client handlers.',
    title: 'Kovo Interactive Gallery',
  },
  // Include the shared runtime module first so the static export writes it (the demo modules
  // import it), then the primitive modules imported by generated handlers, before demo handlers.
  modulepreloads: [
    ...galleryInteractiveSupportClientModuleHrefs,
    ...galleryInteractiveClientModuleHrefs,
  ],
  page() {
    return renderInteractiveGalleryRoute();
  },
  // SPEC §13.1: the document head delivers the stylesheet. The gallery is
  // exported into the docs dist alongside exportSiteStaticApp, which copies the
  // built docs stylesheet to /assets/site.css, so without this hint the demos
  // render unstyled. Matches the docs pages' link.
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
  const { modulePath, source: rawClientSource, version } = galleryInteractiveClientModule(demoName);
  const generatedClientSource = rewriteGalleryClientImports(rawClientSource);
  const href = galleryInteractiveClientModules.put({
    path: modulePath,
    source: generatedClientSource,
    version,
  });

  if (href !== `/c/__v/${version}/${modulePath.slice('/c/'.length)}`) {
    throw new Error(`Unexpected gallery client module href for ${demoName}: ${href}`);
  }

  return href;
}

function galleryInteractiveClientModule(demoName: string): {
  modulePath: string;
  source: string;
  version: string;
} {
  const generatedClientUrl = new URL(
    `./generated/interactive/${demoName}.client.js`,
    import.meta.url,
  );
  if (existsSync(generatedClientUrl)) {
    const generatedServerSource = readFileSync(
      new URL(`./generated/interactive/${demoName}.tsx`, import.meta.url),
      'utf8',
    );
    const { modulePath, version } = parseGalleryCompiledClientRef(demoName, generatedServerSource);
    return {
      modulePath,
      source: readFileSync(generatedClientUrl, 'utf8'),
      version,
    };
  }

  return compileGalleryInteractiveClientModule(demoName, `src/interactive/${demoName}.tsx`);
}

function compileGalleryInteractiveClientModule(
  demoName: string,
  fileName: string,
): { modulePath: string; source: string; version: string } {
  const source = readFileSync(new URL(`./interactive/${demoName}.tsx`, import.meta.url), 'utf8');
  const result = compileComponentModule({ fileName, source });
  const clientSource = result.files.find((file) => file.kind === 'client')?.source;
  if (clientSource === undefined) {
    throw new Error(`Gallery interactive demo ${demoName} produced no client module.`);
  }

  const serverSource = result.files.find((file) => file.kind === 'server')?.source;
  if (serverSource === undefined) {
    throw new Error(`Gallery interactive demo ${demoName} produced no server module.`);
  }

  const { modulePath, version } = parseGalleryCompiledClientRef(demoName, serverSource);
  return { modulePath, source: clientSource, version };
}

function registerHeadlessUiClientModules(): ReadonlyMap<string, string> {
  const hrefs = new Map<string, string>();
  const modules: Array<{ modulePath: string; source: string }> = [];

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
      modules.push({ modulePath, source: transpiled });
    }
  }

  const graphVersion = createHash('sha256')
    .update(modules.map((module) => `${module.modulePath}\n${module.source}`).join('\n'))
    .digest('hex')
    .slice(0, 8);

  for (const module of modules) {
    const href = galleryInteractiveClientModules.put({
      path: module.modulePath,
      source: module.source,
      version: graphVersion,
    });

    hrefs.set(module.modulePath, href);
  }

  return hrefs;
}

// SPEC.md §4.4: rewrite bare specifiers to served module URLs so the browser can resolve the
// generated client module graph without an import map.
function rewriteGalleryClientImports(source: string): string {
  return source
    .replaceAll("from '@kovojs/browser/generated';", `from '${galleryRuntimeModuleHref}';`)
    .replaceAll("from '@kovojs/browser';", `from '${galleryRuntimeModuleHref}';`)
    .replace(
      /from (["'])@kovojs\/(?:headless-ui|ui)\/([a-z0-9-]+)\1;/g,
      (_match, _quote: string, family: string) => {
        const href = galleryHeadlessUiClientModuleHrefMap.get(
          `/c/packages/headless-ui/src/primitives/${family}.js`,
        );
        if (href === undefined) {
          throw new Error(`Missing gallery headless UI client module for ${family}.`);
        }
        return `from '${href}';`;
      },
    );
}

function parseGalleryCompiledClientRef(
  demoName: string,
  source: string,
): { modulePath: string; version: string } {
  const pattern = new RegExp(
    String.raw`/c/__v/([^/"#?]+)/([^"'#?]*${escapeRegExp(demoName)}\.client\.js)#`,
  );
  const match = pattern.exec(source);
  if (match === null) {
    throw new Error(`Gallery interactive demo ${demoName} produced no client handler ref.`);
  }

  return {
    modulePath: `/c/${match[2] ?? ''}`,
    version: decodeURIComponent(match[1] ?? ''),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function routeValueToHtml(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}
