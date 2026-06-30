import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileComponentModule } from '../../../packages/compiler/src/compile.ts';
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  createRequestHandler,
  publicAccess,
  renderRouteHtml,
  route,
  toNodeHandler,
} from '@kovojs/server';
import ts from 'typescript';

import {
  galleryPrimitiveActionsImportManifest,
  galleryHeadlessGeneratedModuleSpecifier,
  galleryHeadlessPrimitiveModuleSpecifier,
  galleryRuntimeModuleSpecifier,
  rebaseGalleryClientModuleManifest,
  resolveGalleryClientModuleSpecifiers,
  type GalleryClientModuleManifest,
} from './client-module-manifest.js';
import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const headlessUiSourceRoot = fileURLToPath(
  new URL('../../../packages/headless-ui/src/', import.meta.url),
);
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

// SPEC.md §4.4: load-bearing import maps are a non-goal. Generated client modules carry a manifest
// of package dependencies; the gallery resolves those entries to served /c/ URLs.
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
const galleryPrimitiveActionsClientModuleHref = registerPrimitiveActionsClientModule();
export const galleryInteractiveSupportClientModuleHrefs = Object.freeze([
  galleryRuntimeModuleHref,
  galleryPrimitiveActionsClientModuleHref,
  ...galleryHeadlessUiClientModuleHrefs,
]);

export const galleryInteractiveClientModuleHrefs = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);

export const galleryInteractiveRoute = route('/gallery/interactive', {
  // A public UI-primitive demo page (KV436 access decision, SPEC §10.2).
  access: publicAccess('public UI primitive demo gallery'),
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
  const {
    manifest,
    modulePath,
    source: rawClientSource,
    version,
  } = galleryInteractiveClientModule(demoName);
  const generatedClientSource = resolveGalleryClientModuleSpecifiers(
    rawClientSource,
    manifest,
    resolveGalleryClientModuleSpecifier,
  );
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
  manifest: GalleryClientModuleManifest;
  version: string;
} {
  const generatedClientUrl = new URL(
    `./generated/interactive/${demoName}.client.js`,
    import.meta.url,
  );
  if (existsSync(generatedClientUrl)) {
    const compiled = compileGalleryInteractiveClientModule(
      demoName,
      `src/generated/interactive/${demoName}.tsx`,
    );
    const generatedServerSource = readFileSync(
      new URL(`./generated/interactive/${demoName}.tsx`, import.meta.url),
      'utf8',
    );
    const { modulePath, version } = parseGalleryCompiledClientRef(demoName, generatedServerSource);
    return {
      manifest: rebaseMovedGalleryInteractiveClientManifest(compiled.manifest),
      modulePath,
      source: readFileSync(generatedClientUrl, 'utf8'),
      version,
    };
  }

  return compileGalleryInteractiveClientModule(demoName, `src/interactive/${demoName}.tsx`);
}

function rebaseMovedGalleryInteractiveClientManifest(
  manifest: GalleryClientModuleManifest,
): GalleryClientModuleManifest {
  return rebaseGalleryClientModuleManifest(
    manifest,
    new Map([['../primitive-actions.js', '../../primitive-actions.js']]),
  );
}

function compileGalleryInteractiveClientModule(
  demoName: string,
  fileName: string,
): {
  manifest: GalleryClientModuleManifest;
  modulePath: string;
  source: string;
  version: string;
} {
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
  return {
    manifest: result.clientModuleImportManifest,
    modulePath,
    source: clientSource,
    version,
  };
}

function registerHeadlessUiClientModules(): ReadonlyMap<string, string> {
  const hrefs = new Map<string, string>();
  const modules: Array<{ modulePath: string; source: string }> = [];

  for (const sourcePath of ['generated.ts', 'primitive-internal.ts']) {
    modules.push(headlessUiClientModuleSource(sourcePath));
  }

  for (const directory of ['lib', 'primitives']) {
    for (const fileName of readdirSync(
      new URL(`${directory}/`, `file://${headlessUiSourceRoot}`),
    )) {
      if (!fileName.endsWith('.ts') || fileName.endsWith('.test.ts')) continue;

      const sourcePath = `${directory}/${fileName}`;
      modules.push(headlessUiClientModuleSource(sourcePath));
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

function headlessUiClientModuleSource(sourcePath: string): { modulePath: string; source: string } {
  const modulePath = `/c/packages/headless-ui/src/${sourcePath.replace(/\.ts$/, '.js')}`;
  const source = readFileSync(new URL(sourcePath, `file://${headlessUiSourceRoot}`), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  return { modulePath, source: transpiled };
}

function registerPrimitiveActionsClientModule(): string {
  const modulePath = '/c/examples/gallery/src/primitive-actions.js';
  const rawSource = readFileSync(new URL('./primitive-actions.ts', import.meta.url), 'utf8');
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
    resolveGalleryClientModuleSpecifier,
  );

  return galleryInteractiveClientModules.put({
    path: modulePath,
    source,
    version: createHash('sha256').update(source).digest('hex').slice(0, 8),
  });
}

function resolveGalleryClientModuleSpecifier(moduleSpecifier: string): string {
  if (moduleSpecifier === galleryRuntimeModuleSpecifier) return galleryRuntimeModuleHref;
  if (moduleSpecifier === '../primitive-actions.js') return galleryPrimitiveActionsClientModuleHref;
  if (moduleSpecifier === '../../primitive-actions.js')
    return galleryPrimitiveActionsClientModuleHref;
  if (moduleSpecifier === galleryHeadlessGeneratedModuleSpecifier) {
    return headlessUiClientModuleHref('generated');
  }
  if (moduleSpecifier === galleryHeadlessPrimitiveModuleSpecifier) {
    return headlessUiClientModuleHref('primitive-internal');
  }

  const family = moduleSpecifier.match(/^@kovojs\/(?:headless-ui|ui)\/([a-z0-9-]+)$/)?.[1];
  if (family !== undefined) return headlessUiClientModuleHref(`primitives/${family}`);

  throw new Error(`Missing gallery client module resolver entry for ${moduleSpecifier}.`);
}

function headlessUiClientModuleHref(sourcePathWithoutExtension: string): string {
  const href = galleryHeadlessUiClientModuleHrefMap.get(
    `/c/packages/headless-ui/src/${sourcePathWithoutExtension}.js`,
  );
  if (href === undefined) {
    throw new Error(`Missing gallery headless UI client module for ${sourcePathWithoutExtension}.`);
  }
  return href;
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

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}
