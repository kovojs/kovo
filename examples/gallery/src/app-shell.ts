import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
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
  galleryPrimitiveActionsGeneratedImportManifest,
  galleryPrimitiveActionsGeneratedModuleSpecifier,
  galleryHeadlessGeneratedModuleSpecifier,
  galleryRuntimeModuleSource,
  galleryRuntimeModuleSpecifier,
  rebaseGalleryClientModuleManifest,
  resolveGalleryClientModuleSpecifiers,
  rewriteGalleryClientModuleHrefs,
  type GalleryClientModuleManifest,
  type GalleryClientModuleHrefRewrite,
} from './client-module-manifest.js';
import { galleryHandlerCompilerProjectFiles } from './compiler-project.js';
import { interactiveGalleryDemos, renderInteractiveGalleryRoute } from './interactive-docs.js';

const headlessUiSourceRoot = fileURLToPath(
  new URL('../../../packages/headless-ui/src/', import.meta.url),
);
const galleryInteractiveClientModules = createMemoryVersionedClientModuleRegistry();

// SPEC.md §4.4: load-bearing import maps are a non-goal. Generated client modules carry a manifest
// of package dependencies; the gallery resolves those entries to served /c/ URLs.
const galleryRuntimeModulePath = '/c/examples/gallery/src/generated/kovo-runtime.client.js';
const galleryRuntimeModuleHref = galleryInteractiveClientModules.put({
  path: galleryRuntimeModulePath,
  source: galleryRuntimeModuleSource,
});
const galleryHeadlessUiClientModuleHrefMap = registerHeadlessUiClientModules();
export const galleryHeadlessUiClientModuleHrefs = Object.freeze([
  ...galleryHeadlessUiClientModuleHrefMap.values(),
]);
const galleryPrimitiveActionsGeneratedClientModuleHref =
  registerPrimitiveActionsGeneratedClientModule();
const galleryPrimitiveActionsClientModuleHref = registerPrimitiveActionsClientModule();
export const galleryInteractiveSupportClientModuleHrefs = Object.freeze([
  galleryRuntimeModuleHref,
  galleryPrimitiveActionsGeneratedClientModuleHref,
  galleryPrimitiveActionsClientModuleHref,
  ...galleryHeadlessUiClientModuleHrefs,
]);

export const galleryInteractiveClientModuleBindings = Object.freeze(
  interactiveGalleryDemos.map((demo) => registerGalleryInteractiveClientModule(demo.name)),
);
export const galleryInteractiveClientModuleHrefs = Object.freeze(
  galleryInteractiveClientModuleBindings.map(({ href }) => href),
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
  async page() {
    return rewriteGalleryClientModuleHrefs(
      await renderInteractiveGalleryRoute(),
      galleryInteractiveClientModuleBindings,
    );
  },
  // SPEC §13.1: the document head delivers the stylesheet. The gallery is
  // exported into the docs dist alongside exportSiteStaticApp, which copies the
  // built docs stylesheet to /assets/site.css, so without this hint the demos
  // render unstyled. Matches the docs pages' link.
  stylesheets: ['/assets/site.css'],
});

export function createGalleryInteractiveApplication() {
  const app = createApp({
    appId: 'a6a65802-25f9-40ce-a2ad-5ab960ff3277',
    clientModules: galleryInteractiveClientModules,
    document: { lang: 'en-US' },
    renderRoute(value) {
      return routeValueToHtml(value);
    },
    routes: [galleryInteractiveRoute],
  });
  return { app };
}

export function createGalleryInteractiveAppShell() {
  const application = createGalleryInteractiveApplication();
  const requestHandler = createRequestHandler(application.app);
  return { ...application, nodeHandler: toNodeHandler(requestHandler), requestHandler };
}

export const galleryInteractiveAppShell = createGalleryInteractiveApplication();

export default galleryInteractiveAppShell.app;

export interface GalleryInteractiveClientModuleBinding extends GalleryClientModuleHrefRewrite {
  readonly demoName: string;
}

function registerGalleryInteractiveClientModule(
  demoName: string,
): GalleryInteractiveClientModuleBinding {
  const {
    compiledHref,
    manifest,
    modulePath,
    source: rawClientSource,
  } = galleryInteractiveClientModule(demoName);
  const generatedClientSource = resolveGalleryClientModuleSpecifiers(
    rawClientSource,
    manifest,
    resolveGalleryClientModuleSpecifier,
  );
  const href = galleryInteractiveClientModules.put({
    path: modulePath,
    source: generatedClientSource,
  });
  return Object.freeze({ compiledHref, demoName, href });
}

function galleryInteractiveClientModule(demoName: string): {
  compiledHref: string;
  modulePath: string;
  source: string;
  manifest: GalleryClientModuleManifest;
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
    const compiledIdentity = parseGalleryCompiledClientIdentity(demoName, generatedServerSource);
    return {
      compiledHref: compiledIdentity.compiledHref,
      manifest: rebaseMovedGalleryInteractiveClientManifest(compiled.manifest),
      modulePath: compiledIdentity.modulePath,
      source: readFileSync(generatedClientUrl, 'utf8'),
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
  compiledHref: string;
  manifest: GalleryClientModuleManifest;
  modulePath: string;
  source: string;
} {
  const source = readFileSync(new URL(`./interactive/${demoName}.tsx`, import.meta.url), 'utf8');
  const generatedDirectory = fileName.includes('/generated/interactive/') ? 'src/generated' : 'src';
  // SPEC §5.2: local handler barrels are accepted only through finite compiler project provenance.
  // Supply the authored adapter graph explicitly; the compiler emits the canonical reviewed
  // Headless UI identity rather than trusting or shipping the relative barrel path.
  const result = compileComponentModule({
    extraFiles: galleryHandlerCompilerProjectFiles(generatedDirectory),
    fileName,
    source,
  } as Parameters<typeof compileComponentModule>[0] & {
    extraFiles: readonly { fileName: string; source: string }[];
  });
  const clientSource = result.files.find((file) => file.kind === 'client')?.source;
  if (clientSource === undefined) {
    throw new Error(`Gallery interactive demo ${demoName} produced no client module.`);
  }

  const serverSource = result.files.find((file) => file.kind === 'server')?.source;
  if (serverSource === undefined) {
    throw new Error(`Gallery interactive demo ${demoName} produced no server module.`);
  }

  const compiledIdentity = parseGalleryCompiledClientIdentity(demoName, serverSource);
  return {
    compiledHref: compiledIdentity.compiledHref,
    manifest: result.clientModuleImportManifest,
    modulePath: compiledIdentity.modulePath,
    source: clientSource,
  };
}

function registerHeadlessUiClientModules(): ReadonlyMap<string, string> {
  const hrefs = new Map<string, string>();
  const modules = new Map<string, string>();

  for (const sourcePath of ['client-helper-abi.ts', 'generated.ts']) {
    const module = headlessUiClientModuleSource(sourcePath);
    modules.set(module.modulePath, module.source);
  }

  for (const directory of ['lib', 'primitives']) {
    for (const fileName of readdirSync(
      new URL(`${directory}/`, `file://${headlessUiSourceRoot}`),
    )) {
      if (!fileName.endsWith('.ts') || fileName.endsWith('.test.ts')) continue;

      const sourcePath = `${directory}/${fileName}`;
      const module = headlessUiClientModuleSource(sourcePath);
      modules.set(module.modulePath, module.source);
    }
  }

  const visiting = new Set<string>();
  const register = (modulePath: string): string => {
    const existing = hrefs.get(modulePath);
    if (existing !== undefined) return existing;
    if (visiting.has(modulePath)) {
      throw new Error(`Cyclic gallery headless UI client module graph at ${modulePath}.`);
    }
    const rawSource = modules.get(modulePath);
    if (rawSource === undefined) {
      throw new Error(`Missing gallery headless UI client module source for ${modulePath}.`);
    }

    visiting.add(modulePath);
    const imports = galleryClientModuleImports(rawSource);
    const source = resolveGalleryClientModuleSpecifiers(
      rawSource,
      imports.map((moduleSpecifier) => ({ imports: [], moduleSpecifier })),
      (moduleSpecifier) => {
        if (!moduleSpecifier.startsWith('.')) {
          throw new Error(`Unexpected headless UI browser import ${moduleSpecifier}.`);
        }
        const dependencyPath = posix.normalize(
          posix.join(posix.dirname(modulePath), moduleSpecifier),
        );
        return register(dependencyPath);
      },
    );
    const href = galleryInteractiveClientModules.put({
      path: modulePath,
      source,
    });
    visiting.delete(modulePath);
    hrefs.set(modulePath, href);
    return href;
  };

  for (const modulePath of modules.keys()) {
    register(modulePath);
  }

  return hrefs;
}

function galleryClientModuleImports(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'gallery-headless-ui-client.js',
    source,
    ts.ScriptTarget.Latest,
  );
  const imports: string[] = [];
  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
      imports.push(moduleSpecifier.text);
    }
  }
  return imports;
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
  });
}

function registerPrimitiveActionsGeneratedClientModule(): string {
  const modulePath = '/c/examples/gallery/src/primitive-actions.generated.js';
  const rawSource = readFileSync(
    new URL('./primitive-actions.generated.ts', import.meta.url),
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
    resolveGalleryClientModuleSpecifier,
  );

  return galleryInteractiveClientModules.put({
    path: modulePath,
    source,
  });
}

function resolveGalleryClientModuleSpecifier(moduleSpecifier: string): string {
  if (moduleSpecifier === galleryRuntimeModuleSpecifier) return galleryRuntimeModuleHref;
  if (moduleSpecifier === '../primitive-actions.js') return galleryPrimitiveActionsClientModuleHref;
  if (moduleSpecifier === '../../primitive-actions.js')
    return galleryPrimitiveActionsClientModuleHref;
  if (moduleSpecifier === galleryPrimitiveActionsGeneratedModuleSpecifier) {
    return galleryPrimitiveActionsGeneratedClientModuleHref;
  }
  if (moduleSpecifier === galleryHeadlessGeneratedModuleSpecifier) {
    return headlessUiClientModuleHref('generated');
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

function parseGalleryCompiledClientIdentity(
  demoName: string,
  source: string,
): { compiledHref: string; modulePath: string } {
  const pattern = new RegExp(
    String.raw`(/c/__v/[0-9a-f]{64}/([^"'#?]*${escapeRegExp(demoName)}\.client\.js))#`,
  );
  const match = pattern.exec(source);
  if (match === null) {
    throw new Error(`Gallery interactive demo ${demoName} produced no client handler ref.`);
  }

  return {
    compiledHref: match[1] ?? '',
    modulePath: `/c/${match[2] ?? ''}`,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}
