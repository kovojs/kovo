import { readFile, stat } from 'node:fs/promises';

import { clientModulePath } from '@kovojs/core/internal/client-module-url';
import {
  createFrameworkOutputFileSystemBoundary,
  type ConfinedFileSystemEntry,
  type FrameworkOutputFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import type { KovoApp } from './app-types.js';
import {
  buildOwnDataProperty,
  buildSecurityPathDirname,
  buildSecurityPathIsAbsolute,
  buildSecurityPathJoin,
  buildSecurityPathRelative,
  buildSecurityPathResolve,
  buildSecurityPathSeparator,
  buildSecuritySourceLiteral,
  buildSecurityUrlSnapshot,
  commitBuildArrayValue,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import { versionedClientModuleHref, type VersionedClientModuleInput } from './client-modules.js';
import { stylesheetSourceFile, stylesheetSourcePath, type StylesheetAsset } from './hints.js';
import { exportStaticApp } from './static-export.js';
import type { StaticExportAssetInput } from './static-export-types.js';
import type { StaticExportDiagnostic } from './static-export-diagnostics.js';
import { staticExportRoutePlan, type StaticExportRouteTarget } from './static-export-route-plan.js';
import { resolvedFileSystemPath, viteDistSourcePath } from './vite-build-assets.js';
import {
  createKovoAppShellViteBuild,
  createKovoAppShellViteBuildFromManifestFile,
  type KovoAppShellBuiltClientModule,
  type KovoAppShellCompiledClientModule,
  type KovoAppShellRouteBuildHints,
} from './vite-build.js';
import { writeKovoAppShellViteBuildOutput } from './vite-build-output.js';
import { normalizedDistFile, type KovoAppShellRouteEntryMap } from './vite-manifest.js';
import { witnessReflectApply } from './security-witness-intrinsics.js';
import {
  createSecurityMap,
  securityArrayJoin,
  securityMapForEach,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityStringEndsWith,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.js';

const neutralBuildVersion = 'kovo-neutral-build/v1';

/**
 * Inputs for writing Kovo's platform-neutral deployment artifact.
 *
 * @internal
 */
export interface WriteKovoNeutralBuildOptions {
  /** App aggregate produced by `createApp()`. */
  app: KovoApp;
  /** Optional public base path used to resolve manifest asset hrefs. */
  base?: string;
  /**
   * Build-owned CSS fragments to materialize into declared stylesheet assets, such as
   * first-party package component CSS extracted by `kovo build` (SPEC.md §13.1).
   */
  buildStylesheetCss?: readonly {
    /** CSS text to merge into the stylesheet asset. */
    css: string;
    /** Public stylesheet href that receives this CSS. */
    href: string;
  }[];
  /** Compiler-produced client modules that should be emitted under `client/c/`. */
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  /** Vite manifest file used to derive asset inventory and per-route hints. */
  manifestFile?: string | URL;
  /** Target neutral artifact directory, conventionally `dist/.kovo`. */
  outDir: string | URL;
  /** Route path to Vite entry mapping used for route hints. */
  routeEntryMap?: KovoAppShellRouteEntryMap;
  /** Optional pre-bundled handler source to write to `server/handler.mjs`. */
  serverHandlerSource?: string;
  /** App module directory fallback for local `stylesheet('./file.css')` declarations. */
  stylesheetSourceRoot?: string | URL;
}

/**
 * Facts returned after writing the platform-neutral deployment artifact.
 *
 * @internal
 */
export interface KovoNeutralBuild {
  /** Absolute path to the neutral client directory. */
  clientDir: string;
  /** Versioned client modules emitted under `client/c/`. */
  clientModules: readonly KovoAppShellBuiltClientModule[];
  /** Absolute path to the neutral manifest JSON file. */
  manifestPath: string;
  /** Absolute path to the neutral meta JSON file. */
  metaPath: string;
  /** Absolute path to the neutral build root. */
  outDir: string;
  /** Public-root assets copied from Vite output for dynamic preset serving. */
  publicAssetDir?: string;
  /** Per-route Vite hints merged into the built app shell. */
  routeHints: readonly KovoAppShellRouteBuildHints[];
  /** Absolute path to the neutral routes JSON file. */
  routesPath: string;
  /** Absolute path to the neutral server directory. */
  serverDir: string;
  /** Absolute path to `server/handler.mjs` when a handler source was supplied. */
  serverHandlerPath?: string;
  /** Static assets discovered from the Vite manifest. */
  staticAssets: readonly {
    file: string;
    href: string;
    path: string;
  }[];
  /** Durable task declarations that require a preset JobRunner capability (SPEC §9.6). */
  tasks: readonly {
    key: string;
  }[];
  /** Fully static output when every route was proven exportable. */
  staticOutput?: {
    /** Absolute path to the neutral static export directory. */
    dir: string;
    /** Whether every route was exported without route-level diagnostics. */
    complete: boolean;
    /** Route-level diagnostics produced while exporting the static subtree. */
    diagnostics: readonly StaticExportDiagnostic[];
    /** Absolute path to the static export manifest JSON file. */
    manifestPath: string;
    /** Concrete route documents written into the static subtree. */
    routeDocuments: readonly StaticExportRouteTarget[];
  };
  /** Whether this build can be deployed without a server/function fallback. */
  staticOnly: boolean;
  /** Neutral artifact schema version. */
  version: typeof neutralBuildVersion;
}

function neutralOptionsObject(value: unknown): object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Neutral build options must be an own-data object.');
  }
  return value;
}

function requiredNeutralOption(options: object, property: PropertyKey): unknown {
  const field = buildOwnDataProperty(
    options,
    property,
    `neutral build options.${String(property)}`,
  );
  if (!field.present || field.value === undefined) {
    throw new TypeError(`Neutral build option ${String(property)} is required.`);
  }
  return field.value;
}

function optionalNeutralOption(options: object, property: PropertyKey): unknown {
  const field = buildOwnDataProperty(
    options,
    property,
    `neutral build options.${String(property)}`,
  );
  return field.present ? field.value : undefined;
}

function snapshotNeutralBuildStylesheetCss(
  value: readonly { css: string; href: string }[] | undefined,
): readonly { css: string; href: string }[] {
  if (value === undefined) return [];
  const source = snapshotBuildArray(value, 'neutral build stylesheet CSS');
  const snapshot: { css: string; href: string }[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError(`Neutral build stylesheet CSS entry ${index} must be an object.`);
    }
    commitBuildArrayValue(
      snapshot,
      {
        css: requiredNeutralString(entry, 'css', `neutral build stylesheet CSS ${index}.css`),
        href: requiredNeutralString(entry, 'href', `neutral build stylesheet CSS ${index}.href`),
      },
      'neutral build stylesheet CSS snapshot',
    );
  }
  return snapshotBuildArray(snapshot, 'pinned neutral build stylesheet CSS');
}

/**
 * Write Kovo's platform-neutral deployment artifact.
 *
 * This Phase 0 API reuses the existing app-shell Vite manifest/client-module pipeline
 * and creates the `dist/.kovo`-style metadata layout. The server bundle step is still
 * supplied by callers as `serverHandlerSource` until `kovo build` owns bundling.
 *
 * @internal
 */
export async function writeKovoNeutralBuild(
  options: WriteKovoNeutralBuildOptions,
): Promise<KovoNeutralBuild> {
  const source = neutralOptionsObject(options);
  const app = requiredNeutralOption(source, 'app') as KovoApp;
  const outDir = resolvedFileSystemPath(requiredNeutralOption(source, 'outDir') as string | URL);
  const base = optionalNeutralOption(source, 'base') as string | undefined;
  const clientModules = optionalNeutralOption(source, 'clientModules') as
    | readonly KovoAppShellCompiledClientModule[]
    | undefined;
  const manifestFile = optionalNeutralOption(source, 'manifestFile') as string | URL | undefined;
  const routeEntryMap = optionalNeutralOption(source, 'routeEntryMap') as
    | KovoAppShellRouteEntryMap
    | undefined;
  const serverHandlerSource = optionalNeutralOption(source, 'serverHandlerSource') as
    | string
    | undefined;
  const stylesheetSourceRootOption = optionalNeutralOption(source, 'stylesheetSourceRoot') as
    | string
    | URL
    | undefined;
  const buildStylesheetCss = snapshotNeutralBuildStylesheetCss(
    optionalNeutralOption(source, 'buildStylesheetCss') as
      | readonly { css: string; href: string }[]
      | undefined,
  );
  const neutralOutput = createFrameworkOutputFileSystemBoundary(outDir);
  await neutralOutput.ensureDirectory();
  const clientDir = neutralPathJoin(outDir, 'client');
  const serverDir = neutralPathJoin(outDir, 'server');
  const manifestFilePath =
    manifestFile === undefined ? undefined : resolvedFileSystemPath(manifestFile);
  const stylesheetSourceRoot =
    stylesheetSourceRootOption === undefined
      ? undefined
      : resolvedFileSystemPath(stylesheetSourceRootOption);
  const manifestDistDir =
    manifestFilePath === undefined
      ? undefined
      : neutralPathDirname(neutralPathDirname(manifestFilePath));
  const registeredClientModules = registeredClientModuleBuildArtifacts(app.clientModules.entries());
  const appShellBuild =
    manifestFilePath === undefined
      ? createKovoAppShellViteBuild({
          app,
          ...(base === undefined ? {} : { base }),
          ...(clientModules === undefined ? {} : { clientModules }),
          ...(routeEntryMap === undefined ? {} : { routeEntryMap }),
        })
      : await createKovoAppShellViteBuildFromManifestFile({
          app,
          ...(base === undefined ? {} : { base }),
          ...(clientModules === undefined ? {} : { clientModules }),
          manifestFile: manifestFilePath,
          ...(routeEntryMap === undefined ? {} : { routeEntryMap }),
        });
  const buildClientModules = concatenateNeutralBuildArrays(
    appShellBuild.clientModules,
    registeredClientModules,
    'neutral build client modules',
  );
  const buildWithRegisteredClientModules = {
    app: appShellBuild.app,
    assets: snapshotBuildArray(appShellBuild.assets, 'neutral build assets'),
    clientModules: buildClientModules,
    routeHints: snapshotBuildArray(appShellBuild.routeHints, 'neutral build route hints'),
  };

  await writeKovoAppShellViteBuildOutput(buildWithRegisteredClientModules, {
    outDir: clientDir,
    staticExport: false,
  });
  const serverHandlerPath =
    serverHandlerSource === undefined ? undefined : neutralPathJoin(serverDir, 'handler.mjs');
  if (serverHandlerSource !== undefined && serverHandlerPath !== undefined) {
    await neutralOutput.writeFile('server/handler.mjs', serverHandlerSource);
  }
  await copyNeutralStaticAssets(appShellBuild.assets, clientDir, manifestDistDir);
  await materializeNeutralStylesheetAssets({
    app: appShellBuild.app,
    assets: appShellBuild.assets,
    buildStylesheetCss,
    manifestDistDir,
    rootDir: clientDir,
    stylesheetSourceRoot,
  });

  const manifestPath = neutralPathJoin(outDir, 'manifest.json');
  const routesPath = neutralPathJoin(outDir, 'routes.json');
  const metaPath = neutralPathJoin(outDir, 'meta.json');
  const staticOutput = await writeNeutralStaticOutput({
    app: buildWithRegisteredClientModules.app,
    assets: buildWithRegisteredClientModules.assets,
    base,
    manifestDistDir,
    outDir,
  });
  const publicAssetDir = await writeNeutralPublicAssets(
    manifestDistDir,
    neutralPathJoin(outDir, 'public'),
  );
  if (staticOutput !== undefined) {
    await materializeNeutralStylesheetAssets({
      app: buildWithRegisteredClientModules.app,
      assets: buildWithRegisteredClientModules.assets,
      buildStylesheetCss,
      manifestDistDir,
      rootDir: staticOutput.dir,
      stylesheetSourceRoot,
    });
  }
  // SPEC §6.6/§9.5: static replay above executes authored code in this realm. Commit the deployment
  // authority ledgers below through boot-pinned own-data operations, including their array copies.
  const tasks = neutralBuildTasks(buildWithRegisteredClientModules.app);
  const neutral: KovoNeutralBuild = {
    clientDir,
    clientModules: buildWithRegisteredClientModules.clientModules,
    manifestPath,
    metaPath,
    outDir,
    ...(publicAssetDir === undefined ? {} : { publicAssetDir }),
    routeHints: buildWithRegisteredClientModules.routeHints,
    routesPath,
    serverDir,
    ...(serverHandlerPath === undefined ? {} : { serverHandlerPath }),
    staticAssets: buildWithRegisteredClientModules.assets,
    tasks,
    ...(staticOutput === undefined ? {} : { staticOutput }),
    staticOnly: neutralBuildIsStaticOnly(buildWithRegisteredClientModules.app, staticOutput, tasks),
    version: neutralBuildVersion,
  };

  await writeJsonTo(neutralOutput, 'manifest.json', {
    assets: buildWithRegisteredClientModules.assets,
    clientModules: neutralBuildClientModuleMetadata(buildWithRegisteredClientModules.clientModules),
    routeHints: buildWithRegisteredClientModules.routeHints,
    tasks: neutral.tasks,
    version: neutralBuildVersion,
  });
  await writeJsonTo(neutralOutput, 'routes.json', {
    routes: neutralBuildRouteEntries(buildWithRegisteredClientModules.app, staticOutput),
    version: neutralBuildVersion,
  });
  await writeJsonTo(neutralOutput, 'meta.json', {
    hasServerHandler: serverHandlerPath !== undefined,
    staticOnly: neutral.staticOnly,
    tasks: neutral.tasks,
    version: neutralBuildVersion,
  });

  return neutral;
}

function registeredClientModuleBuildArtifacts(
  modules: readonly VersionedClientModuleInput[],
): KovoAppShellBuiltClientModule[] {
  const source = snapshotBuildArray(modules, 'registered client modules');
  const builtModules: KovoAppShellBuiltClientModule[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const module = snapshotRegisteredClientModule(source[index]!, index);
    const href = versionedClientModuleHref(module.path, module.version);
    const pathname = clientModulePath(href);
    const built: KovoAppShellBuiltClientModule = {
      file: normalizedDistFile(pathname),
      href,
      path: pathname,
      source: module.source,
      version: module.version,
    };
    commitBuildArrayValue(
      builtModules,
      module.contentType === undefined ? built : { ...built, contentType: module.contentType },
      'registered client module build artifact',
    );
  }
  return builtModules;
}

function snapshotRegisteredClientModule(
  value: VersionedClientModuleInput,
  index: number,
): VersionedClientModuleInput {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Registered client module ${index} must be an object.`);
  }
  const path = requiredNeutralString(value, 'path', `registered client module ${index}.path`);
  const source = requiredNeutralString(value, 'source', `registered client module ${index}.source`);
  const version = requiredNeutralString(
    value,
    'version',
    `registered client module ${index}.version`,
  );
  const contentType = optionalNeutralString(
    value,
    'contentType',
    `registered client module ${index}.contentType`,
  );
  return {
    ...(contentType === undefined ? {} : { contentType }),
    path,
    source,
    version,
  };
}

function neutralBuildClientModuleMetadata(
  modules: readonly KovoAppShellBuiltClientModule[],
): readonly Omit<KovoAppShellBuiltClientModule, 'source'>[] {
  const source = snapshotBuildArray(modules, 'neutral build client module metadata');
  const metadata: Omit<KovoAppShellBuiltClientModule, 'source'>[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const module = source[index];
    if (typeof module !== 'object' || module === null) {
      throw new TypeError(`Neutral build client module ${index} must be an object.`);
    }
    const contentType = optionalNeutralString(
      module,
      'contentType',
      `neutral build client module ${index}.contentType`,
    );
    commitBuildArrayValue(
      metadata,
      {
        ...(contentType === undefined ? {} : { contentType }),
        file: requiredNeutralString(module, 'file', `neutral build client module ${index}.file`),
        href: requiredNeutralString(module, 'href', `neutral build client module ${index}.href`),
        path: requiredNeutralString(module, 'path', `neutral build client module ${index}.path`),
        version: requiredNeutralString(
          module,
          'version',
          `neutral build client module ${index}.version`,
        ),
      },
      'neutral build client module metadata',
    );
  }
  return snapshotBuildArray(metadata, 'pinned neutral build client module metadata');
}

function neutralBuildTasks(app: KovoApp): readonly { key: string }[] {
  const source = snapshotBuildArray(app.tasks, 'neutral build tasks');
  const tasks: { key: string }[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const declaration = source[index];
    if (typeof declaration !== 'object' || declaration === null) {
      throw new TypeError(`Neutral build task ${index} must be an object.`);
    }
    commitBuildArrayValue(
      tasks,
      {
        key: requiredNeutralString(declaration, 'key', `neutral build task ${index}.key`),
      },
      'neutral build task metadata',
    );
  }
  return snapshotBuildArray(tasks, 'pinned neutral build tasks');
}

function requiredNeutralString(value: object, property: PropertyKey, label: string): string {
  const field = buildOwnDataProperty(value, property, label);
  if (!field.present || typeof field.value !== 'string') {
    throw new TypeError(`${label} must be a string.`);
  }
  return field.value;
}

function optionalNeutralString(
  value: object,
  property: PropertyKey,
  label: string,
): string | undefined {
  const field = buildOwnDataProperty(value, property, label);
  if (!field.present || field.value === undefined) return undefined;
  if (typeof field.value !== 'string') {
    throw new TypeError(`${label} must be a string.`);
  }
  return field.value;
}

function concatenateNeutralBuildArrays<Value>(
  first: readonly Value[],
  second: readonly Value[],
  label: string,
): readonly Value[] {
  const pinnedFirst = snapshotBuildArray(first, `${label} first`);
  const pinnedSecond = snapshotBuildArray(second, `${label} second`);
  const combined: Value[] = [];
  for (let index = 0; index < pinnedFirst.length; index += 1) {
    commitBuildArrayValue(combined, pinnedFirst[index]!, `${label} combined values`);
  }
  for (let index = 0; index < pinnedSecond.length; index += 1) {
    commitBuildArrayValue(combined, pinnedSecond[index]!, `${label} combined values`);
  }
  return snapshotBuildArray(combined, label);
}

interface NeutralStaticOutputOptions {
  app: KovoApp;
  assets: readonly KovoNeutralBuild['staticAssets'][number][];
  base: string | undefined;
  manifestDistDir: string | undefined;
  outDir: string;
}

async function writeNeutralStaticOutput({
  app,
  assets,
  base,
  manifestDistDir,
  outDir,
}: NeutralStaticOutputOptions): Promise<KovoNeutralBuild['staticOutput'] | undefined> {
  if (app.mutations.length > 0 || app.queries.length > 0) {
    return undefined;
  }

  const staticDir = neutralPathJoin(outDir, 'static');
  const routePlan = staticExportRoutePlan(app);

  try {
    const result = await exportStaticApp(app, {
      ...(manifestDistDir === undefined
        ? {}
        : {
            assets: neutralStaticExportAssets(assets, manifestDistDir),
            ...(base === undefined ? {} : { publicAssetBase: base }),
            publicAssetRoot: manifestDistDir,
          }),
      onNonExportable: 'skip',
      outDir: staticDir,
    });
    const artifacts = snapshotBuildArray(result.artifacts, 'neutral static export artifacts');
    if (artifacts.length === 0) {
      await rmNeutralStaticOutput(staticDir);
      return undefined;
    }

    const diagnostics = snapshotBuildArray(result.diagnostics, 'neutral static export diagnostics');
    const targets = snapshotBuildArray(routePlan.targets, 'neutral static export route targets');
    const routeDocuments: StaticExportRouteTarget[] = [];
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex]!;
      let hasDiagnostic = false;
      for (let diagnosticIndex = 0; diagnosticIndex < diagnostics.length; diagnosticIndex += 1) {
        if (diagnostics[diagnosticIndex]!.routePath === target.routePath) {
          hasDiagnostic = true;
          break;
        }
      }
      if (!hasDiagnostic) {
        commitBuildArrayValue(
          routeDocuments,
          target,
          'neutral static export route document metadata',
        );
      }
    }
    const manifestPath = neutralPathJoin(staticDir, 'kovo-static-manifest.json');
    await writeJson(manifestPath, {
      version: neutralBuildVersion,
    });
    return {
      complete: diagnostics.length === 0,
      diagnostics,
      dir: staticDir,
      manifestPath,
      routeDocuments: snapshotBuildArray(routeDocuments, 'neutral static route documents'),
    };
  } catch {
    await rmNeutralStaticOutput(staticDir);
    return undefined;
  }
}

function neutralBuildIsStaticOnly(
  app: KovoApp,
  staticOutput: KovoNeutralBuild['staticOutput'] | undefined,
  tasks: readonly { key: string }[],
): boolean {
  return (
    staticOutput?.complete === true &&
    snapshotBuildArray(app.endpoints, 'neutral build endpoints').length === 0 &&
    snapshotBuildArray(app.mutations, 'neutral build mutations').length === 0 &&
    snapshotBuildArray(app.queries, 'neutral build queries').length === 0 &&
    tasks.length === 0
  );
}

function neutralBuildRouteEntries(
  app: KovoApp,
  staticOutput: KovoNeutralBuild['staticOutput'] | undefined,
): unknown[] {
  const routes = snapshotBuildArray(app.routes, 'neutral build routes');
  const allDiagnostics = snapshotBuildArray(
    staticOutput?.diagnostics ?? [],
    'neutral build route diagnostics',
  );
  const routeDocuments = snapshotBuildArray(
    staticOutput?.routeDocuments ?? [],
    'neutral build route documents',
  );
  const entries: unknown[] = [];
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]!;
    const diagnostics: StaticExportDiagnostic[] = [];
    const staticPaths: string[] = [];
    for (let index = 0; index < allDiagnostics.length; index += 1) {
      const diagnostic = allDiagnostics[index]!;
      if (diagnostic.routePath === route.path) {
        commitBuildArrayValue(diagnostics, diagnostic, 'neutral build route diagnostic metadata');
      }
    }
    for (let index = 0; index < routeDocuments.length; index += 1) {
      const document = routeDocuments[index]!;
      if (document.routePath === route.path) {
        commitBuildArrayValue(
          staticPaths,
          document.path,
          'neutral build route static path metadata',
        );
      }
    }
    const policy =
      staticPaths.length === 0 ? 'dynamic' : diagnostics.length === 0 ? 'static' : 'mixed';

    commitBuildArrayValue(
      entries,
      {
        export: {
          ...(diagnostics.length === 0 ? {} : { diagnostics }),
          policy,
          ...(staticPaths.length === 0 ? {} : { paths: staticPaths }),
        },
        path: route.path,
      },
      'neutral build route entry metadata',
    );
  }
  return entries;
}

function neutralStaticExportAssets(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  manifestDistDir: string,
): StaticExportAssetInput[] {
  const source = snapshotBuildArray(assets, 'neutral static export assets');
  const pinned: StaticExportAssetInput[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const asset = source[index]!;
    commitBuildArrayValue(
      pinned,
      {
        path: asset.path,
        source: viteDistSourcePath(manifestDistDir, asset.file),
      },
      'neutral static export asset metadata',
    );
  }
  return pinned;
}

async function rmNeutralStaticOutput(staticDir: string): Promise<void> {
  await createFrameworkOutputFileSystemBoundary(staticDir).removeTree();
}

async function copyNeutralStaticAssets(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  clientDir: string,
  manifestDistDir: string | undefined,
): Promise<void> {
  if (manifestDistDir === undefined) return;
  const output = createFrameworkOutputFileSystemBoundary(clientDir);
  const pinnedAssets = snapshotBuildArray(assets, 'neutral static asset copy entries');

  for (let index = 0; index < pinnedAssets.length; index += 1) {
    const asset = pinnedAssets[index]!;
    const outputPath = neutralClientOutputPath(clientDir, asset.path);
    const relativePath = neutralPathRelative(clientDir, outputPath);
    await output.copyFile(viteDistSourcePath(manifestDistDir, asset.file), relativePath);
  }
}

async function writeNeutralPublicAssets(
  manifestDistDir: string | undefined,
  outDir: string,
): Promise<string | undefined> {
  if (manifestDistDir === undefined) return undefined;

  const previousOutput = createFrameworkOutputFileSystemBoundary(outDir);
  await previousOutput.removeTree();
  const source = createFrameworkOutputFileSystemBoundary(manifestDistDir);
  const output = createFrameworkOutputFileSystemBoundary(outDir);
  const copied = await copyNeutralPublicAssetEntries(source, output);
  if (!copied) return undefined;
  return outDir;
}

async function copyNeutralPublicAssetEntries(
  source: FrameworkOutputFileSystemBoundary,
  output: FrameworkOutputFileSystemBoundary,
  directory?: ConfinedFileSystemEntry,
): Promise<boolean> {
  const entries = snapshotBuildArray(
    directory === undefined ? await source.entries('.') : await source.entriesOf(directory),
    'neutral public asset directory entries',
  );
  let copied = false;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (skipNeutralPublicAsset(entry.relativePath, entry)) continue;

    if (entry.kind === 'directory') {
      copied = (await copyNeutralPublicAssetEntries(source, output, entry)) || copied;
      continue;
    }
    if (entry.kind !== 'file') {
      throw new Error(
        `KV229 neutral build refuses public asset '${entry.relativePath}' because symlinks and non-regular filesystem entries are not publishable. SPEC §9.5 static assets must be identity-bound files beneath the build output root.`,
      );
    }

    const bytes = await source.fileBytesOf(entry);
    await output.writeFile(entry.relativePath, bytes);
    copied = true;
  }

  return copied;
}

function skipNeutralPublicAsset(relativePath: string, entry: { name: string }): boolean {
  const normalized = securityStringReplaceAll(relativePath, buildSecurityPathSeparator(), '/');
  if (normalized === '.vite' || securityStringStartsWith(normalized, '.vite/')) return true;
  if (normalized === 'assets' || securityStringStartsWith(normalized, 'assets/')) return true;
  if (normalized === 'c' || securityStringStartsWith(normalized, 'c/')) return true;
  if (normalized === 'index.html') return true;
  return entry.name === '.DS_Store';
}

interface MaterializeNeutralStylesheetAssetsOptions {
  app: KovoApp;
  assets: readonly KovoNeutralBuild['staticAssets'][number][];
  buildStylesheetCss: readonly { css: string; href: string }[];
  manifestDistDir: string | undefined;
  rootDir: string;
  stylesheetSourceRoot: string | undefined;
}

async function materializeNeutralStylesheetAssets({
  app,
  assets,
  buildStylesheetCss,
  manifestDistDir,
  rootDir,
  stylesheetSourceRoot,
}: MaterializeNeutralStylesheetAssetsOptions): Promise<void> {
  const cssByPath = stylesheetCssByPath(app, assets, buildStylesheetCss);
  const viteCssBySourceFile = sourceFileByStylesheetAssetPath(assets);
  const localCssByPath = stylesheetSourceByPath(app, stylesheetSourceRoot);
  const stylesheetEntries: { assetPath: string; cssChunks: readonly string[] }[] = [];
  securityMapForEach(cssByPath, (cssChunks, assetPath) => {
    commitBuildArrayValue(
      stylesheetEntries,
      {
        assetPath,
        cssChunks: snapshotBuildArray(cssChunks, `neutral stylesheet ${assetPath} CSS chunks`),
      },
      'neutral stylesheet materialization entries',
    );
  });
  const pinnedEntries = snapshotBuildArray(
    stylesheetEntries,
    'pinned neutral stylesheet materialization entries',
  );
  const output = createFrameworkOutputFileSystemBoundary(rootDir);

  for (let index = 0; index < pinnedEntries.length; index += 1) {
    const { assetPath, cssChunks } = pinnedEntries[index]!;
    const outputPath = neutralClientOutputPath(rootDir, assetPath);
    // M2 (bugs-part4 L12-1): compute each stylesheet's content purely from the
    // *current* build's inputs (declared/critical CSS, build-owned CSS, and the
    // Vite-emitted CSS read from this build's Vite output dir). Reading the
    // previously-emitted on-disk stylesheet here folded the prior build's
    // already-merged output back in, so reusing the §14 retention output dir on a
    // 2nd+ build retained stale rules and duplicated current ones. Overwrite the
    // asset deterministically from current inputs instead.
    const viteSourceFile = securityMapGet(viteCssBySourceFile, assetPath);
    const viteCss =
      viteSourceFile === undefined || manifestDistDir === undefined
        ? ''
        : await readExistingStylesheet(viteDistSourcePath(manifestDistDir, viteSourceFile));
    const localSourceFile = securityMapGet(localCssByPath, assetPath);
    const localCss =
      viteCss || cssChunks.length > 0 || localSourceFile === undefined
        ? ''
        : await readRequiredStylesheet(localSourceFile, assetPath);
    const dedupedCss = dedupeCssChunks(
      concatenateNeutralBuildArrays(cssChunks, [localCss, viteCss], 'neutral stylesheet chunks'),
    );
    const mergedCss = securityArrayJoin(dedupedCss, '\n');
    if (!mergedCss) continue;

    await output.writeFile(
      neutralPathRelative(rootDir, outputPath),
      `${mergedCss}${securityStringEndsWith(mergedCss, '\n') ? '' : '\n'}`,
    );
  }
}

/**
 * Map each declared CSS stylesheet asset URL path to its Vite-emitted source
 * `file` (relative to the Vite output dir). The source file is a current-build
 * input, so reading it keeps stylesheet materialization idempotent across
 * rebuilds into a reused output dir (M2, SPEC.md §14 retention).
 */
function sourceFileByStylesheetAssetPath(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
): Map<string, string> {
  const sourceFileByPath = createSecurityMap<string, string>();
  const pinnedAssets = snapshotBuildArray(assets, 'neutral stylesheet source-file assets');
  for (let index = 0; index < pinnedAssets.length; index += 1) {
    const asset = pinnedAssets[index]!;
    if (!securityStringEndsWith(asset.path, '.css')) continue;
    securityMapSet(sourceFileByPath, asset.path, asset.file);
  }
  return sourceFileByPath;
}

function stylesheetCssByPath(
  app: KovoApp,
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  buildStylesheetCss: readonly { css: string; href: string }[],
): Map<string, string[]> {
  const cssByPath = createSecurityMap<string, string[]>();

  const appStylesheets = snapshotBuildArray(app.stylesheets, 'neutral app stylesheets');
  for (let index = 0; index < appStylesheets.length; index += 1) {
    addStylesheetDeclarationCss(cssByPath, appStylesheets[index]!);
  }
  const routes = snapshotBuildArray(app.routes, 'neutral stylesheet routes');
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const routeStylesheets = snapshotBuildArray(
      routes[routeIndex]!.stylesheets ?? [],
      `neutral route ${routeIndex} stylesheets`,
    );
    for (let index = 0; index < routeStylesheets.length; index += 1) {
      addStylesheetDeclarationCss(cssByPath, routeStylesheets[index]!);
    }
  }
  const pinnedAssets = snapshotBuildArray(assets, 'neutral stylesheet build assets');
  const cssAssetPaths: string[] = [];
  for (let index = 0; index < pinnedAssets.length; index += 1) {
    const assetPath = pinnedAssets[index]!.path;
    if (securityStringEndsWith(assetPath, '.css')) {
      commitBuildArrayValue(cssAssetPaths, assetPath, 'neutral stylesheet asset paths');
    }
  }
  const pinnedBuildStylesheetCss = snapshotBuildArray(
    buildStylesheetCss,
    'neutral build-owned stylesheet CSS',
  );
  for (let index = 0; index < pinnedBuildStylesheetCss.length; index += 1) {
    const asset = pinnedBuildStylesheetCss[index]!;
    addStylesheetCss(
      cssByPath,
      buildStylesheetCssHref(asset.href, cssByPath, cssAssetPaths),
      asset.css,
    );
  }

  return cssByPath;
}

function stylesheetSourceByPath(
  app: KovoApp,
  stylesheetSourceRoot: string | undefined,
): Map<string, string> {
  const sources = createSecurityMap<string, string>();
  const appStylesheets = snapshotBuildArray(app.stylesheets, 'neutral source app stylesheets');
  for (let index = 0; index < appStylesheets.length; index += 1) {
    addStylesheetSource(sources, appStylesheets[index]!, stylesheetSourceRoot);
  }
  const routes = snapshotBuildArray(app.routes, 'neutral source stylesheet routes');
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const routeStylesheets = snapshotBuildArray(
      routes[routeIndex]!.stylesheets ?? [],
      `neutral source route ${routeIndex} stylesheets`,
    );
    for (let index = 0; index < routeStylesheets.length; index += 1) {
      addStylesheetSource(sources, routeStylesheets[index]!, stylesheetSourceRoot);
    }
  }
  return sources;
}

function addStylesheetSource(
  sources: Map<string, string>,
  asset: string | StylesheetAsset,
  stylesheetSourceRoot: string | undefined,
): void {
  if (typeof asset === 'string') return;

  const assetPath = localStylesheetAssetPath(asset.href);
  if (!assetPath) return;
  const sourceFile =
    stylesheetSourceFile(asset) ??
    stylesheetSourceFileFromRoot(asset, stylesheetSourceRoot, assetPath);
  if (sourceFile === undefined) return;
  if (!securityMapHas(sources, assetPath)) securityMapSet(sources, assetPath, sourceFile);
}

function stylesheetSourceFileFromRoot(
  asset: StylesheetAsset,
  stylesheetSourceRoot: string | undefined,
  assetPath: string,
): string | undefined {
  const sourcePath = stylesheetSourcePath(asset);
  if (sourcePath === undefined || stylesheetSourceRoot === undefined) return undefined;
  const sourceFile = neutralPathResolve(stylesheetSourceRoot, sourcePath);
  const relativeToRoot = neutralPathRelative(stylesheetSourceRoot, sourceFile);
  if (
    relativeToRoot === '' ||
    securityStringStartsWith(relativeToRoot, '..') ||
    neutralPathIsAbsolute(relativeToRoot)
  ) {
    throw new Error(
      `KV229 neutral build cannot materialize stylesheet '${assetPath}' from local source '${sourcePath}' outside stylesheetSourceRoot '${stylesheetSourceRoot}'. SPEC §9.5 static export writes referenced static assets with route documents.`,
    );
  }
  return sourceFile;
}

function buildStylesheetCssHref(
  href: string,
  cssByPath: Map<string, string[]>,
  cssAssetPaths: readonly string[],
): string {
  const assetPath = localStylesheetAssetPath(href);
  if (assetPath && securityMapHas(cssByPath, assetPath)) return href;
  if (assetPath && assetPath !== '/assets/styles.css') return href;
  if (cssAssetPaths.length === 1 && cssAssetPaths[0] !== undefined) return cssAssetPaths[0];
  return href;
}

function addStylesheetDeclarationCss(
  cssByPath: Map<string, string[]>,
  asset: string | StylesheetAsset,
): void {
  if (typeof asset === 'string') return;
  const assetPath = localStylesheetAssetPath(asset.href);
  if (assetPath && !securityMapHas(cssByPath, assetPath)) {
    securityMapSet(cssByPath, assetPath, []);
  }
  addStylesheetCss(cssByPath, asset.href, asset.criticalCss);
}

function addStylesheetCss(
  cssByPath: Map<string, string[]>,
  href: string,
  css: string | undefined,
): void {
  if (!css) return;

  const assetPath = localStylesheetAssetPath(href);
  if (!assetPath) return;

  const chunks = securityMapGet(cssByPath, assetPath);
  if (chunks) {
    commitBuildArrayValue(chunks, css, `neutral stylesheet ${assetPath} CSS chunks`);
  } else {
    securityMapSet(cssByPath, assetPath, [css]);
  }
}

function localStylesheetAssetPath(href: string): string | null {
  try {
    const url = buildSecurityUrlSnapshot(href, 'https://kovo.local');
    if (url.origin !== 'https://kovo.local') return null;
    return url.pathname;
  } catch {
    return null;
  }
}

async function readExistingStylesheet(fileName: string): Promise<string> {
  try {
    return await readFile(fileName, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return '';
    throw error;
  }
}

async function readRequiredStylesheet(fileName: string, assetPath: string): Promise<string> {
  try {
    const sourceStat = await stat(fileName);
    if (!sourceStat.isFile()) throw new Error('not a file');
    return await readFile(fileName, 'utf8');
  } catch (error) {
    throw new Error(
      `KV229 neutral build cannot materialize stylesheet '${assetPath}' from local source '${fileName}'. SPEC §9.5 static export writes referenced static assets with route documents.`,
      { cause: error },
    );
  }
}

function dedupeCssChunks(chunks: readonly string[]): string[] {
  const source = snapshotBuildArray(chunks, 'neutral stylesheet CSS chunks');
  const deduped: string[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const chunk = source[index]!;
    const css = securityStringTrim(chunk);
    if (!css) continue;
    let seen = false;
    for (let seenIndex = 0; seenIndex < deduped.length; seenIndex += 1) {
      if (deduped[seenIndex] === css) {
        seen = true;
        break;
      }
    }
    if (!seen) commitBuildArrayValue(deduped, css, 'deduplicated neutral stylesheet CSS');
  }

  return deduped;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function neutralClientOutputPath(clientDir: string, urlPath: string): string {
  const relativePath = securityStringStartsWith(urlPath, '/')
    ? securityStringSlice(urlPath, 1)
    : urlPath;
  const outputPath = neutralPathResolve(clientDir, relativePath);
  const relativeToClient = neutralPathRelative(clientDir, outputPath);

  if (
    relativeToClient === '' ||
    securityStringStartsWith(relativeToClient, '..') ||
    neutralPathIsAbsolute(relativeToClient)
  ) {
    throw new Error(`Neutral build asset must stay within the client directory: ${urlPath}`);
  }

  return outputPath;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const parent = neutralPathDirname(filePath);
  const output = createFrameworkOutputFileSystemBoundary(parent);
  await output.writeFile(
    neutralPathRelative(parent, filePath),
    `${buildSecuritySourceLiteral(value)}\n`,
  );
}

async function writeJsonTo(
  output: FrameworkOutputFileSystemBoundary,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await output.writeFile(relativePath, `${buildSecuritySourceLiteral(value)}\n`);
}

function neutralPathDirname(value: string): string {
  return buildSecurityPathDirname(value);
}

function neutralPathIsAbsolute(value: string): boolean {
  return buildSecurityPathIsAbsolute(value);
}

function neutralPathJoin(...values: string[]): string {
  return witnessReflectApply(buildSecurityPathJoin, undefined, values);
}

function neutralPathRelative(from: string, to: string): string {
  return buildSecurityPathRelative(from, to);
}

function neutralPathResolve(...values: string[]): string {
  return witnessReflectApply(buildSecurityPathResolve, undefined, values);
}
