import {
  dirname as builtinDirname,
  isAbsolute as builtinIsAbsolute,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';
import { URL as BuiltinURL } from 'node:url';
import { runInNewContext as builtinRunInNewContext } from 'node:vm';

import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
  parseVersionedClientModuleTarget,
  versionedClientModuleRequestKey,
} from '@kovojs/core/internal/client-module-url';
import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';

import { snapshotCompileComponentOptions } from './compile-options.js';
import { canonicalJson } from './canonical-json.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerCreateWeakMap,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerMapDelete,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerNumberIsSafeInteger,
  compilerOwnDataValue,
  compilerPromiseIsPromise,
  compilerPromiseThen,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSetOwnDataProperty,
  compilerStringEndsWith,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerWeakMapGet,
  compilerWeakMapSet,
} from './compiler-security-intrinsics.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import { compileComponentModuleForFramework } from './framework-compile.js';
import {
  collectCssAssetManifest,
  snapshotCssAssetManifestOptions,
  type ComponentCssAsset,
  type CssAssetManifest,
  type CssAssetManifestOptions,
} from './css.js';
import {
  allComponentOptionObjectEntries,
  parseComponentModule,
  parseDiagnosticsForSourceFile,
} from './scan/parse.js';
import { queryExpressionFromBinding } from './scan/query-binding.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { rewriteClientModuleRuntimeImportsForBrowser } from './emit/client.js';
import { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
import {
  createCompilerSourceFileSystem,
  type CompilerSourceFileSystem,
} from './source-filesystem.js';
import type {
  HmrImpactClassification,
  HmrImpactMetadata,
  HmrImpactReason,
  CompileDependencyFootprint,
  PackageComponentPrefixFact,
  QueryShapeFact,
  RegistryFacts,
} from './types.js';
import { validateAuthoringSurface } from './validate/authoring-surface.js';

const dirname = builtinDirname;
const isAbsolute = builtinIsAbsolute;
const relative = builtinRelative;
const resolve = builtinResolve;
const runInNewContext = builtinRunInNewContext;
const URL = BuiltinURL;

/**
 * The Vite plugin object produced by createKovoVitePlugin (and the `kovoVitePlugin` barrel
 * helper): a `transform` hook that lowers authored component modules through the compiler
 * and a dev-server hook that serves emitted client islands. Public plugin contract an app
 * wires into its `vite.config` (SPEC.md §5.2).
 */
export interface KovoVitePlugin {
  configResolved?: (config: KovoViteResolvedConfig) => void;
  configureServer?: (server: KovoViteDevServer) => void;
  enforce?: 'pre';
  getClientModules?: () => readonly KovoViteCompiledClientModule[];
  handleHotUpdate?: (context: KovoViteHotUpdateContext) => Promise<readonly unknown[]>;
  getCssAssetManifest?: (options?: CssAssetManifestOptions) => CssAssetManifest;
  load?: (id: string) => null | Promise<null | string> | string;
  name: 'kovo';
  resolveId?: (source: string, importer?: string) => null | Promise<null | string> | string;
  watchChange?: (id: string, change: { event: 'create' | 'delete' | 'update' }) => void;
  transform: (
    source: string,
    id: string,
  ) =>
    | null
    | Promise<null | { code: string; map: null }>
    | {
        code: string;
        map: null;
      };
}

/** Compiler-emitted client module ready for production registration (SPEC.md §5.2.1). */
export interface KovoViteCompiledClientModule {
  path: string;
  renderPlanFingerprint?: string;
  source: string;
  version?: string;
}

/** @internal Callback the Vite plugin invokes per non-error compiler diagnostic. */
export type KovoViteDiagnosticReporter = (diagnostic: CompilerDiagnostic) => void;

/**
 * @internal Per-module diagnostic report (all diagnostics for one transformed file) passed
 * to a {@link KovoViteModuleDiagnosticReporter}. Plugin-internal reporting shape.
 */
export interface KovoViteModuleDiagnosticReport {
  diagnostics: readonly CompilerDiagnostic[];
  fileName: string;
  source: string;
}

/** @internal Callback the Vite plugin invokes with each module's diagnostic report. */
export type KovoViteModuleDiagnosticReporter = (report: KovoViteModuleDiagnosticReport) => void;

/** File-name/source predicate used to scope the Kovo Vite transform to authored app components. */
export type KovoViteModuleFilter =
  | RegExp
  | string
  | ((fileName: string, source: string) => boolean);

/** Registry facts passed to the compiler globally or selected per transformed file. */
export type KovoViteRegistryFactsSource =
  | RegistryFacts
  | ((fileName: string) => RegistryFacts | undefined);

/** Query-shape facts passed to the compiler globally or selected per transformed file. */
export type KovoViteQueryShapeFactsSource =
  | readonly QueryShapeFact[]
  | ((fileName: string) => readonly QueryShapeFact[] | undefined);

/**
 * Options for createKovoVitePlugin / the `kovoVitePlugin` helper: diagnostic callbacks and
 * the package component prefixes to thread into compilation. Public plugin configuration
 * surface (SPEC.md §5.2).
 */
export interface KovoVitePluginOptions {
  exclude?: readonly KovoViteModuleFilter[];
  include?: readonly KovoViteModuleFilter[];
  onDiagnostic?: KovoViteDiagnosticReporter;
  onModuleDiagnostics?: KovoViteModuleDiagnosticReporter;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  queryShapeFacts?: KovoViteQueryShapeFactsSource;
  registryFacts?: KovoViteRegistryFactsSource;
}

/**
 * @internal Minimal structural view of the Vite dev server the plugin's `configureServer`
 * hook needs (root config + middleware registration). Plugin-internal wiring type.
 */
export interface KovoViteDevServer {
  config?: {
    root?: string;
    server?: {
      fs?: {
        allow?: readonly string[];
      };
    };
  };
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  ssrLoadModule?: (id: string) => Promise<Record<string, unknown>>;
  ws?: KovoViteWebSocket;
}

/** @internal Minimal Vite resolved config shape needed by the plugin. */
export interface KovoViteResolvedConfig {
  command?: 'build' | 'serve';
  root?: string;
  server?: {
    fs?: {
      allow?: readonly string[];
    };
  };
}

/** @internal Connect-style middleware the plugin registers to serve emitted client islands. */
export type KovoViteMiddleware = (
  req: { url?: string },
  res: {
    end(body: string): void;
    setHeader(name: string, value: string): void;
    statusCode?: number;
  },
  next: () => void,
) => void;

/** @internal Minimal Vite websocket surface used for Kovo HMR events (SPEC.md §9.5.1). */
export interface KovoViteWebSocket {
  send(payload: KovoViteWebSocketPayload): void;
}

/** Websocket payloads emitted by the Kovo Vite plugin during dev HMR. */
export type KovoViteWebSocketPayload =
  | {
      data: KovoHmrEventPayload;
      event: KovoHmrEventName;
      type: 'custom';
    }
  | {
      type: 'full-reload';
    };

/** @internal Minimal structural Vite handleHotUpdate context. */
export interface KovoViteHotUpdateContext {
  file: string;
  modules?: readonly unknown[];
  read(): Promise<string>;
  server: KovoViteDevServer;
}

/** Stable Kovo custom HMR event names carried over Vite's websocket transport. */
export type KovoHmrEventName =
  | 'kovo:component-render'
  | 'kovo:diagnostics'
  | 'kovo:full-reload'
  | 'kovo:route-shell';

/** Payload shared by Kovo custom HMR events (SPEC.md §9.5.1). */
export interface KovoHmrEventPayload {
  component?: HmrImpactMetadata['component'];
  diagnostics?: HmrImpactMetadata['diagnostics'];
  impact: HmrImpactClassification['impact'];
  liveTargets?: readonly string[];
  newClientHref?: string;
  newFactHash?: string;
  oldClientHref?: string;
  oldFactHash?: string;
  reasons: readonly string[];
  sourceFile: string;
}

interface ViteCompileOptions {
  extraFiles?: readonly {
    readonly fileName: string;
    readonly source: string;
  }[];
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  queryShapeFacts?: readonly QueryShapeFact[];
  registryFacts?: RegistryFacts;
  source: string;
}

interface ViteCompileResult {
  clientExports?: readonly string[];
  cssAssets?: readonly ComponentCssAsset[];
  dependencyFootprint?: CompileDependencyFootprint;
  diagnostics?: readonly CompilerDiagnostic[];
  files: readonly {
    kind: string;
    source: string;
  }[];
  handlerExports?: readonly string[];
  hmrImpact?: HmrImpactMetadata | null;
  renderPlanFingerprint?: string | null;
}

interface ViteClientModuleVersion {
  href: string;
  keys: readonly string[];
  source: string;
}

interface ViteClientModuleHistory {
  current: ViteClientModuleVersion;
  previous?: ViteClientModuleVersion;
}

interface ViteDevFileState {
  clientHistory?: ViteClientModuleHistory;
  compiledClientModule?: KovoViteCompiledClientModule;
  cssAssets?: readonly ComponentCssAsset[];
  hmrImpact?: HmrImpactMetadata;
  lastTouched: number;
  sourceUnits: number;
}

interface ViteDevStateStore {
  buildMode: boolean;
  fileCount: number;
  files: Map<string, ViteDevFileState>;
  modules: Map<string, string>;
  owners: Map<string, string>;
  sourceUnits: number;
  touch: number;
}

interface ViteCompileMetadata {
  clientExports: readonly string[];
  cssAssets: readonly ComponentCssAsset[];
  handlerExports: readonly string[];
  hmrImpact: HmrImpactMetadata | null;
  renderPlanFingerprint: string | null;
}

type MaybePromise<T> = Promise<T> | T;
type ViteCompileComponentModule = (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>;

const KOVO_DEV_CLIENT_MODULE_FILE_LIMIT = 1024;
const KOVO_DEV_CLIENT_MODULE_SOURCE_UNIT_LIMIT = 16 * 1024 * 1024;

const FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES = compilerFreeze([
  'configResolved',
  'configureServer',
  'getClientModules',
  'getCssAssetManifest',
  'handleHotUpdate',
  'load',
  'name',
  'resolveId',
  'transform',
  'watchChange',
] as const);

interface FrameworkVitePluginAuthority {
  readonly identities: Readonly<Record<string, unknown>>;
  readonly sourceRootCoverage: '*' | string | null;
}

const frameworkVitePluginAuthorities = compilerCreateWeakMap<
  KovoVitePlugin,
  FrameworkVitePluginAuthority
>();

/**
 * Build a KovoVitePlugin bound to a given component-compile function, lowering authored
 * component modules through the compiler on `transform` and serving emitted client islands
 * in dev. The barrel-level `kovoVitePlugin` helper wraps this with the real
 * compileComponentModule; this lower-level factory exists so the compile step can be
 * substituted in tests (SPEC.md §5.2). Public plugin factory.
 */
export function createKovoVitePlugin(
  compileComponentModule: ViteCompileComponentModule,
  options: KovoVitePluginOptions = {},
): KovoVitePlugin {
  return createBoundKovoVitePlugin(compileComponentModule, snapshotKovoVitePluginOptions(options));
}

/** @internal Construct the plugin with the statically owned fresh compiler entry point. */
export function createFrameworkKovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  const optionsSnapshot = snapshotKovoVitePluginOptions(options);
  const plugin = createBoundKovoVitePlugin(compileComponentModuleForFramework, optionsSnapshot);
  const identities = compilerCreateNullRecord<unknown>();
  const identityPropertyCount = compilerArrayLength(
    FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES,
    'Framework Vite plugin identity properties',
  );
  for (let index = 0; index < identityPropertyCount; index += 1) {
    const property = compilerOwnDataValue(
      FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES,
      index,
      'Framework Vite plugin identity properties',
    ) as (typeof FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES)[number];
    compilerDefineOwnDataProperty(
      identities,
      property,
      compilerOwnDataValue(plugin, property, 'Framework Vite plugin'),
    );
  }
  compilerWeakMapSet(frameworkVitePluginAuthorities, plugin, {
    identities: compilerFreeze(identities),
    sourceRootCoverage: frameworkVitePluginSourceRootCoverage(optionsSnapshot),
  });

  // The app-shell owner may rely on this plugin having already transformed the complete authored
  // source directory. Freezing the genuine object closes the configResolved-to-transform gap: an
  // authored sibling plugin cannot replace a hook or move it out of `enforce: 'pre'` after the
  // private authority check (SPEC.md §2 / §5.2 / §6.6).
  return compilerFreeze(plugin);
}

/**
 * @internal True only for an unmodified framework-minted compiler plugin whose immutable filter
 * snapshot covers the complete requested authored source root without exclusions. This is a
 * read-only proof query: public custom-compiler factories never enter the private authority map.
 */
export function isFrameworkKovoVitePluginOwnerForSourceRoot(
  value: unknown,
  sourceRoot: string,
): value is KovoVitePlugin {
  if (typeof value !== 'object' || value === null) return false;
  const plugin = value as KovoVitePlugin;
  const authority = compilerWeakMapGet(frameworkVitePluginAuthorities, plugin);
  if (authority === undefined) return false;

  const identityPropertyCount = compilerArrayLength(
    FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES,
    'Framework Vite plugin identity properties',
  );
  for (let index = 0; index < identityPropertyCount; index += 1) {
    const property = compilerOwnDataValue(
      FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES,
      index,
      'Framework Vite plugin identity properties',
    ) as (typeof FRAMEWORK_VITE_PLUGIN_IDENTITY_PROPERTIES)[number];
    if (
      compilerOwnDataValue(plugin, property, 'Framework Vite plugin') !==
      compilerOwnDataValue(authority.identities, property, 'Framework Vite plugin authority')
    ) {
      return false;
    }
  }
  // `enforce` is the one intentionally accessor-backed field. Vite 8 writes its normalized
  // ordering value back onto plugin objects before `configResolved`; the frozen framework plugin
  // accepts that host-owned write through its sealed no-op setter while this getter keeps the
  // effective order pinned to `pre` (SPEC.md §2 / §5.2 / §6.6).
  if (plugin.enforce !== 'pre') return false;

  const normalizedSourceRoot = normalizeFrameworkViteSourceRoot(sourceRoot);
  if (normalizedSourceRoot === null) return false;
  if (authority.sourceRootCoverage === '*') return true;
  if (authority.sourceRootCoverage === null) return false;
  return (
    normalizedSourceRoot === authority.sourceRootCoverage ||
    compilerStringStartsWith(normalizedSourceRoot, `${authority.sourceRootCoverage}/`)
  );
}

function createBoundKovoVitePlugin(
  compileComponentModule: ViteCompileComponentModule,
  options: KovoVitePluginOptions,
): KovoVitePlugin {
  let devState = createViteDevStateStore(true);
  let root = process.cwd();
  let configurationEpoch = 0;
  let compileIssue = 0;
  let latestCompileIssueByFile = compilerCreateMap<string, number>();
  // SPEC §5.2's one-to-one client module mapping does not authorize Kovo to widen Vite's
  // configured source boundary. Pin the same roots before any remote dev-module request is served.
  let clientSourceFileSystems = viteClientSourceFileSystems(root);

  return {
    get enforce(): 'pre' {
      return 'pre';
    },
    // Vite 8 normalizes plugin metadata by assigning `enforce` back to the plugin object. Keep the
    // framework plugin freeze (and therefore every authority-bearing hook identity) while allowing
    // that host-owned assignment to complete; the getter above remains the sole effective value.
    set enforce(_normalizedEnforce: 'pre') {},
    configResolved(config) {
      configurationEpoch += 1;
      latestCompileIssueByFile = compilerCreateMap<string, number>();
      const buildMode =
        config.command === undefined ? devState.buildMode : config.command === 'build';
      devState = createViteDevStateStore(buildMode);
      root = config.root ?? root;
      clientSourceFileSystems = viteClientSourceFileSystems(root, config.server?.fs?.allow);
    },
    configureServer(server) {
      configurationEpoch += 1;
      latestCompileIssueByFile = compilerCreateMap<string, number>();
      devState = createViteDevStateStore(false);
      root = server.config?.root ?? root;
      clientSourceFileSystems = viteClientSourceFileSystems(root, server.config?.server?.fs?.allow);
      const serverConfigurationEpoch = configurationEpoch;
      const serverDevState = devState;
      server.middlewares.use((req, res, next) => {
        if (serverConfigurationEpoch !== configurationEpoch || serverDevState !== devState) {
          next();
          return;
        }
        const requestUrl = compilerOwnDataValue(req, 'url', 'Vite dev client request');
        const key = typeof requestUrl === 'string' ? devClientModuleKey(requestUrl) : null;
        if (serverConfigurationEpoch !== configurationEpoch || serverDevState !== devState) {
          next();
          return;
        }
        const source = key ? compilerMapGet(serverDevState.modules, key) : undefined;
        if (source === undefined) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(rewriteDevClientModuleRuntimeImports(source));
      });
    },
    getCssAssetManifest(manifestOptions = {}) {
      const manifestConfigurationEpoch = configurationEpoch;
      const manifestDevState = devState;
      const optionsSnapshot = snapshotCssAssetManifestOptions(manifestOptions);
      const isCurrent = () =>
        manifestConfigurationEpoch === configurationEpoch && manifestDevState === devState;
      if (!isCurrent()) {
        throw new Error('Kovo Vite configuration changed while CSS manifest options were read.');
      }
      const results: Array<{ cssAssets: readonly ComponentCssAsset[] }> = [];
      compilerMapForEach(manifestDevState.files, (state) => {
        if (state.cssAssets === undefined) return;
        compilerArrayAppend(
          results,
          { cssAssets: state.cssAssets },
          'Compiler packages/compiler/src/vite.ts collection',
        );
      });
      const manifest = collectCssAssetManifest(results, optionsSnapshot);
      if (!isCurrent()) {
        throw new Error('Kovo Vite configuration changed while CSS assets were collected.');
      }
      return manifest;
    },
    getClientModules() {
      const modules: KovoViteCompiledClientModule[] = [];
      compilerMapForEach(devState.files, (state) => {
        const module = state.compiledClientModule;
        if (module === undefined) return;
        let insertAt = compilerArrayLength(modules, 'Vite compiled client modules');
        while (insertAt > 0) {
          const previous = compilerOwnDataValue(
            modules,
            insertAt - 1,
            'Vite compiled client modules',
          ) as KovoViteCompiledClientModule;
          if (module.path >= previous.path) break;
          compilerSetOwnDataProperty(modules, insertAt, previous);
          insertAt -= 1;
        }
        compilerSetOwnDataProperty(modules, insertAt, module);
      });
      return compilerFreeze(modules);
    },
    name: 'kovo',
    resolveId(source: string, importer?: string): null | string {
      const resolvedId = resolveViteClientModuleId(source, importer, root, clientSourceFileSystems);
      if (resolvedId === null) return null;

      return resolvedId;
    },
    load(id: string): MaybePromise<null | string> {
      // Root/fs configuration is mutable across Vite lifecycle hooks. Pin the complete carrier at
      // invocation so a re-entrant configResolved call cannot retarget an in-flight async compile.
      const loadRoot = root;
      const loadSourceFileSystems = clientSourceFileSystems;
      const loadConfigurationEpoch = configurationEpoch;
      const loadDevState = devState;
      const clientFilePath = viteRequestFileName(id);
      if (!compilerStringEndsWith(clientFilePath, '.client.js')) return null;
      const loadFileName = viteComponentFileName(
        viteClientModuleSourceFilePath(clientFilePath),
        loadRoot,
      );
      compileIssue += 1;
      const loadCompileIssue = compileIssue;
      compilerMapSet(latestCompileIssueByFile, loadFileName, loadCompileIssue);
      const isCurrent = () =>
        loadConfigurationEpoch === configurationEpoch &&
        loadDevState === devState &&
        compilerMapGet(latestCompileIssueByFile, loadFileName) === loadCompileIssue;
      const finish = () => {
        if (compilerMapGet(latestCompileIssueByFile, loadFileName) === loadCompileIssue) {
          compilerMapDelete(latestCompileIssueByFile, loadFileName);
        }
      };
      let result: MaybePromise<null | string>;
      try {
        result = loadViteClientModule(
          compileComponentModule,
          options,
          loadRoot,
          loadSourceFileSystems,
          id,
          isCurrent,
        );
      } catch (error) {
        finish();
        throw error;
      }
      if (isPromiseLike(result)) {
        return compilerPromiseThen(
          result,
          (resolvedResult) => {
            finish();
            return resolvedResult;
          },
          (error) => {
            finish();
            throw error;
          },
        );
      }
      finish();
      return result;
    },
    transform(source: string, id: string) {
      // SPEC §2 / §5.2.1 / §6.1.1: compile identity must use one invocation-local root/fs carrier
      // across the asynchronous compiler boundary.
      const transformRoot = root;
      const transformSourceFileSystems = clientSourceFileSystems;
      const transformConfigurationEpoch = configurationEpoch;
      const transformDevState = devState;
      const fileName = viteComponentFileName(id, transformRoot);
      compileIssue += 1;
      const transformCompileIssue = compileIssue;
      compilerMapSet(latestCompileIssueByFile, fileName, transformCompileIssue);
      const isCurrent = () =>
        transformConfigurationEpoch === configurationEpoch &&
        transformDevState === devState &&
        compilerMapGet(latestCompileIssueByFile, fileName) === transformCompileIssue;
      const finish = () => {
        if (compilerMapGet(latestCompileIssueByFile, fileName) === transformCompileIssue) {
          compilerMapDelete(latestCompileIssueByFile, fileName);
        }
      };
      let result: MaybePromise<ViteCompileResult>;
      try {
        const isAuthoredSource = shouldTransformViteAuthoredSource(fileName, source, options);
        if (!isCurrent()) {
          finish();
          return null;
        }
        const isComponentSource = shouldTransformViteComponentSource(fileName, source, options);
        if (!isCurrent()) {
          finish();
          return null;
        }
        if (isAuthoredSource && !isComponentSource) {
          validateViteStandaloneAuthoringSurface(options, fileName, source);
        }
        if (!isCurrent()) {
          finish();
          return null;
        }
        const standaloneRegistrySource = isAuthoredSource
          ? lowerStandaloneSourceDerivedRegistryDeclarations({ fileName, source })
          : null;
        if (!isCurrent()) {
          finish();
          return null;
        }
        if (!isComponentSource) {
          const existing = compilerMapGet(transformDevState.files, fileName);
          if (existing !== undefined && isCurrent()) {
            removeViteDevFileState(transformDevState, fileName, existing);
          }
          finish();
          return standaloneRegistrySource === null
            ? null
            : { code: standaloneRegistrySource, map: null };
        }
        result = compileViteComponentModule(
          compileComponentModule,
          options,
          transformRoot,
          transformSourceFileSystems,
          fileName,
          source,
        );
      } catch (error) {
        finish();
        throw error;
      }
      if (isPromiseLike(result)) {
        return compilerPromiseThen(
          result,
          (resolvedResult) => {
            try {
              return transformViteCompileResult(
                transformDevState,
                options,
                fileName,
                source,
                resolvedResult,
                isCurrent,
              );
            } finally {
              finish();
            }
          },
          (error) => {
            finish();
            throw error;
          },
        );
      }

      try {
        return transformViteCompileResult(
          transformDevState,
          options,
          fileName,
          source,
          result,
          isCurrent,
        );
      } finally {
        finish();
      }
    },
    async handleHotUpdate(context) {
      // Capture before context.read(): the read itself is attacker/re-entry capable async code.
      const hotUpdateRoot = root;
      const hotUpdateSourceFileSystems = clientSourceFileSystems;
      const hotUpdateConfigurationEpoch = configurationEpoch;
      const hotUpdateDevState = devState;
      const fileName = viteComponentFileName(context.file, hotUpdateRoot);
      compileIssue += 1;
      const hotUpdateCompileIssue = compileIssue;
      compilerMapSet(latestCompileIssueByFile, fileName, hotUpdateCompileIssue);
      const isCurrent = () =>
        hotUpdateConfigurationEpoch === configurationEpoch &&
        hotUpdateDevState === devState &&
        compilerMapGet(latestCompileIssueByFile, fileName) === hotUpdateCompileIssue;
      try {
        const previousState = compilerMapGet(hotUpdateDevState.files, fileName);
        const previous = previousState?.hmrImpact ?? null;
        const source = await context.read();
        if (!isCurrent()) return [];
        const isAuthoredSource = shouldTransformViteAuthoredSource(fileName, source, options);
        if (!isCurrent()) return [];
        const isComponentSource = shouldTransformViteComponentSource(fileName, source, options);
        if (!isCurrent()) return [];
        if (isAuthoredSource && !isComponentSource) {
          validateViteStandaloneAuthoringSurface(options, fileName, source);
        }
        if (!isCurrent()) return [];
        if (!isComponentSource) {
          if (previousState !== undefined) {
            removeViteDevFileState(hotUpdateDevState, fileName, previousState);
            const classification = viteFullReload('topology');
            sendKovoHmrEvent(
              context.server,
              eventForHmrClassification(classification),
              previous,
              null,
              classification,
            );
            context.server.ws?.send({ type: 'full-reload' });
          }
          return context.modules ?? [];
        }

        const result = await compileViteComponentModule(
          compileComponentModule,
          options,
          hotUpdateRoot,
          hotUpdateSourceFileSystems,
          fileName,
          source,
        );
        if (!isCurrent()) return [];
        const emittedFiles = snapshotViteEmittedFiles(result);
        const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
        const metadata = snapshotViteCompileMetadata(result);
        const next = metadata.hmrImpact;
        if (!isCurrent()) return [];

        if (errorDiagnostics.length > 0) {
          sendKovoHmrEvent(context.server, 'kovo:diagnostics', previous, next, {
            impact: 'diagnosticError',
            reasons: ['diagnostics'],
          });
          return [];
        }

        recordViteCompileResult(hotUpdateDevState, fileName, metadata, emittedFiles);
        const classification = classifyViteHmrImpact(previous, next);
        const event = eventForHmrClassification(classification);
        sendKovoHmrEvent(context.server, event, previous, next, classification);
        if (classification.impact !== 'componentRefresh') {
          context.server.ws?.send({ type: 'full-reload' });
        }

        return [];
      } finally {
        if (compilerMapGet(latestCompileIssueByFile, fileName) === hotUpdateCompileIssue) {
          compilerMapDelete(latestCompileIssueByFile, fileName);
        }
      }
    },
    watchChange(id, change) {
      const event = compilerOwnDataValue(change, 'event', 'Vite watch change');
      if (event !== 'create' && event !== 'delete' && event !== 'update') {
        throw new TypeError('Vite watch change event must be create, delete, or update.');
      }
      const fileName = viteComponentFileName(id, root);
      // Every watch event advances the source revision. Only deletion removes retained output,
      // but create/update must still retire older transform/load/HMR settlements for this file.
      compileIssue += 1;
      compilerMapSet(latestCompileIssueByFile, fileName, compileIssue);
      if (event === 'delete') {
        const existing = compilerMapGet(devState.files, fileName);
        if (existing !== undefined) removeViteDevFileState(devState, fileName, existing);
      }
      compilerMapDelete(latestCompileIssueByFile, fileName);
    },
  };
}

function frameworkVitePluginSourceRootCoverage(
  options: KovoVitePluginOptions,
): '*' | string | null {
  // A genuine compiler implementation does not make authored graph context authoritative. The
  // app-shell's built-in owner obtains query/registry context from framework analyzers; therefore a
  // separately configured owner carrying app-supplied fact overrides is never eligible for
  // adoption (SPEC.md §2 / §5.2 / §6.6 honesty boundary).
  if (
    options.packageComponentPrefixes !== undefined ||
    options.queryShapeFacts !== undefined ||
    options.registryFacts !== undefined
  ) {
    return null;
  }
  if (options.exclude !== undefined) return null;
  if (options.include === undefined) return '*';
  if (compilerArrayLength(options.include, 'Kovo Vite include filters') !== 1) return null;
  const filter = compilerOwnDataValue(options.include, 0, 'Kovo Vite include filters');
  return typeof filter === 'string' ? normalizeFrameworkViteSourceRoot(filter) : null;
}

function normalizeFrameworkViteSourceRoot(value: string): string | null {
  if (typeof value !== 'string') return null;
  let normalized = slashPath(value);
  while (normalized.length > 0 && compilerStringEndsWith(normalized, '/')) {
    normalized = compilerStringSlice(normalized, 0, normalized.length - 1);
  }
  if (
    normalized.length === 0 ||
    compilerStringStartsWith(normalized, '/') ||
    normalized === '..' ||
    compilerStringStartsWith(normalized, '../') ||
    compilerStringIncludes(normalized, '/../')
  ) {
    return null;
  }
  return normalized;
}

function rewriteDevClientModuleRuntimeImports(source: string): string {
  // papercuts-super-6 A2: emitted client-island modules are served directly by this middleware,
  // bypassing Vite's normal import-rewrite transform. Rewrite the compiler-owned runtime barrel to
  // Vite's resolvable module-id URL so browsers can load the island module without an import map.
  return compilerStringReplaceAll(
    source,
    "from '@kovojs/browser/generated'",
    "from '/@id/@kovojs/browser/generated'",
  );
}

function transformViteCompileResult(
  devState: ViteDevStateStore,
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
  result: ViteCompileResult,
  shouldRetainResult: () => boolean,
): null | { code: string; map: null } {
  // A compile result is executable authority for the root and source revision that issued it.
  // Lifecycle or same-file invalidation must drop the settlement itself, not merely its cache state.
  if (!shouldRetainResult()) return null;
  const emittedFiles = snapshotViteEmittedFiles(result);
  if (!shouldRetainResult()) return null;
  const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
  if (!shouldRetainResult()) return null;
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
  const metadata = snapshotViteCompileMetadata(result);
  if (!shouldRetainResult()) return null;
  recordViteCompileResult(devState, fileName, metadata, emittedFiles);

  let serverSource: string | undefined;
  for (let index = 0; index < emittedFiles.length; index += 1) {
    if (emittedFiles[index]!.kind === 'server') {
      serverSource = emittedFiles[index]!.source;
      break;
    }
  }
  const code = executableViteServerSource(serverSource) ?? source;
  if (!shouldRetainResult()) return null;
  return { code, map: null };
}

function createViteDevStateStore(buildMode: boolean): ViteDevStateStore {
  return {
    buildMode,
    fileCount: 0,
    files: compilerCreateMap<string, ViteDevFileState>(),
    modules: compilerCreateMap<string, string>(),
    owners: compilerCreateMap<string, string>(),
    sourceUnits: 0,
    touch: 0,
  };
}

function executableViteServerSource(serverSource: string | undefined): string | undefined {
  if (serverSource === undefined) return undefined;
  const executableWrapper = compilerRegExpReplace(
    /^\s*export\s+function\s+renderSource\s*\(/m,
    serverSource,
    'function renderSource(',
  );
  if (executableWrapper === serverSource) return serverSource;

  try {
    const rendered = runInNewContext(
      `${executableWrapper}\n;renderSource();`,
      {},
      { timeout: 1000 },
    );
    return typeof rendered === 'string' && rendered.length > 0 ? rendered : serverSource;
  } catch {
    return serverSource;
  }
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return compilerPromiseIsPromise(value);
}

function shouldTransformViteComponentSource(
  fileName: string,
  source: string,
  options: KovoVitePluginOptions,
): boolean {
  if (!shouldTransformViteAuthoredSource(fileName, source, options)) return false;
  if (!compilerStringIncludes(source, 'component(')) return false;

  return true;
}

function shouldTransformViteAuthoredSource(
  fileName: string,
  source: string,
  options: KovoVitePluginOptions,
): boolean {
  if (!compilerRegExpTest(/\.[cm]?tsx?$/, fileName)) return false;
  if (matchesAnyViteFilter(options.exclude, fileName, source)) return false;
  if (options.include !== undefined && !matchesAnyViteFilter(options.include, fileName, source))
    return false;

  return true;
}

function validateViteStandaloneAuthoringSurface(
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
): void {
  const model = parseComponentModule(fileName, source);
  const parseDiagnostics = parseDiagnosticsForSourceFile(model.sourceFile, source);
  if (parseDiagnostics.length > 0) return;

  const diagnostics = validateAuthoringSurface({ fileName, source }, model);
  if (diagnostics.length === 0) return;

  const errorDiagnostics = reportViteDiagnostics(
    { diagnostics, files: [] },
    options,
    fileName,
    source,
  );
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
}

function matchesAnyViteFilter(
  filters: readonly KovoViteModuleFilter[] | undefined,
  fileName: string,
  source: string,
): boolean {
  if (filters === undefined) return false;
  const length = compilerArrayLength(filters, 'Kovo Vite module filters');
  for (let index = 0; index < length; index += 1) {
    const filter = compilerOwnDataValue(filters, index, 'Kovo Vite module filters');
    if (filter === undefined) {
      throw new TypeError(`Kovo Vite module filters[${index}] must be dense.`);
    }
    if (matchesViteFilter(filter as KovoViteModuleFilter, fileName, source)) return true;
  }
  return false;
}

function matchesViteFilter(
  filter: KovoViteModuleFilter,
  fileName: string,
  source: string,
): boolean {
  if (typeof filter === 'function') return filter(fileName, source);
  if (typeof filter !== 'string') return compilerRegExpTest(filter, fileName);

  let normalized = slashPath(filter);
  while (normalized.length > 0 && compilerStringEndsWith(normalized, '/')) {
    normalized = compilerStringSlice(normalized, 0, normalized.length - 1);
  }
  return fileName === normalized || compilerStringStartsWith(fileName, `${normalized}/`);
}

async function compileViteComponentModule(
  compileComponentModule: ViteCompileComponentModule,
  options: KovoVitePluginOptions,
  root: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
  fileName: string,
  source: string,
): Promise<ViteCompileResult> {
  const queryShapeFacts = componentLocalQueryShapeFacts(
    source,
    fileName,
    resolveViteQueryShapeFacts(options, fileName),
  );
  const registryFacts = resolveViteRegistryFacts(options, fileName);
  const extraFiles = viteFrameworkIdentityFilesWithinRoots(
    root,
    fileName,
    source,
    sourceFileSystems,
  );
  const compileOptions = snapshotCompileComponentOptions({
    ...(extraFiles.length === 0 ? {} : { extraFiles }),
    fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    packagePrefixDiscoveryRoot: root,
    ...(queryShapeFacts === undefined ? {} : { queryShapeFacts }),
    ...(registryFacts === undefined ? {} : { registryFacts }),
    source,
  });
  // Ambient package manifests contribute prefix facts during compilation. Resolve and compile from
  // the pinned carrier on every transform so an in-process manifest change is observed immediately
  // (SPEC §2 / §5.2.1 / §6.1.1).
  const result = compileComponentModule(compileOptions);
  return compilerPromiseIsPromise(result)
    ? await compilerPromiseThen(result, snapshotViteCompileResultForSettlement)
    : snapshotViteCompileResultForSettlement(result);
}

function snapshotViteCompileResultForSettlement(value: unknown): ViteCompileResult {
  if (typeof value !== 'object' || value === null || compilerArrayIsArray(value)) {
    throw new TypeError('Vite compile result must be an own object.');
  }
  const snapshot = compilerCreateNullRecord<unknown>();
  const files = compilerOwnDataValue(value, 'files', 'Vite compile result');
  if (files === undefined) throw new TypeError('Vite compile result.files is required.');
  compilerDefineOwnDataProperty(
    snapshot,
    'files',
    compilerSnapshotJsonValue(files, 'Vite compile result.files'),
  );
  const optionalProperties = [
    'clientExports',
    'cssAssets',
    'dependencyFootprint',
    'diagnostics',
    'handlerExports',
    'hmrImpact',
    'renderPlanFingerprint',
  ] as const;
  const propertyCount = compilerArrayLength(optionalProperties, 'Vite compile result properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      optionalProperties,
      index,
      'Vite compile result properties',
    ) as (typeof optionalProperties)[number];
    const propertyValue = compilerOwnDataValue(value, property, 'Vite compile result');
    if (propertyValue !== undefined) {
      compilerDefineOwnDataProperty(
        snapshot,
        property,
        compilerSnapshotJsonValue(propertyValue, `Vite compile result.${property}`),
      );
    }
  }
  return compilerFreeze(snapshot) as unknown as ViteCompileResult;
}

function snapshotKovoVitePluginOptions(value: KovoVitePluginOptions): KovoVitePluginOptions {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo Vite plugin options must be an object.');
  }
  const snapshot = compilerCreateNullRecord<unknown>();
  const exclude = compilerOwnDataValue(value, 'exclude', 'Kovo Vite plugin options');
  if (exclude !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'exclude',
      compilerFreeze(
        compilerSnapshotDenseArray(
          exclude as readonly KovoViteModuleFilter[],
          'Kovo Vite exclude filters',
        ),
      ),
    );
  }
  const include = compilerOwnDataValue(value, 'include', 'Kovo Vite plugin options');
  if (include !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'include',
      compilerFreeze(
        compilerSnapshotDenseArray(
          include as readonly KovoViteModuleFilter[],
          'Kovo Vite include filters',
        ),
      ),
    );
  }
  const onDiagnostic = compilerOwnDataValue(value, 'onDiagnostic', 'Kovo Vite plugin options');
  if (onDiagnostic !== undefined) {
    if (typeof onDiagnostic !== 'function') {
      throw new TypeError('Kovo Vite plugin options.onDiagnostic must be a function.');
    }
    compilerDefineOwnDataProperty(snapshot, 'onDiagnostic', onDiagnostic);
  }
  const onModuleDiagnostics = compilerOwnDataValue(
    value,
    'onModuleDiagnostics',
    'Kovo Vite plugin options',
  );
  if (onModuleDiagnostics !== undefined) {
    if (typeof onModuleDiagnostics !== 'function') {
      throw new TypeError('Kovo Vite plugin options.onModuleDiagnostics must be a function.');
    }
    compilerDefineOwnDataProperty(snapshot, 'onModuleDiagnostics', onModuleDiagnostics);
  }
  const packageComponentPrefixes = compilerOwnDataValue(
    value,
    'packageComponentPrefixes',
    'Kovo Vite plugin options',
  );
  if (packageComponentPrefixes !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'packageComponentPrefixes',
      compilerSnapshotJsonValue(
        packageComponentPrefixes as readonly PackageComponentPrefixFact[],
        'Kovo Vite package component prefixes',
      ),
    );
  }
  const queryShapeFacts = compilerOwnDataValue(
    value,
    'queryShapeFacts',
    'Kovo Vite plugin options',
  );
  if (queryShapeFacts !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'queryShapeFacts',
      typeof queryShapeFacts === 'function'
        ? queryShapeFacts
        : compilerSnapshotJsonValue(
            queryShapeFacts as readonly QueryShapeFact[],
            'Kovo Vite query-shape facts',
          ),
    );
  }
  const registryFacts = compilerOwnDataValue(value, 'registryFacts', 'Kovo Vite plugin options');
  if (registryFacts !== undefined) {
    compilerDefineOwnDataProperty(
      snapshot,
      'registryFacts',
      typeof registryFacts === 'function'
        ? registryFacts
        : compilerSnapshotJsonValue(registryFacts as RegistryFacts, 'Kovo Vite registry facts'),
    );
  }
  return compilerFreeze(snapshot) as KovoVitePluginOptions;
}

/** @internal Collect project sibling files needed by framework-identity resolution. */
export function viteFrameworkIdentityFiles(
  root: string,
  fileName: string,
  source: string,
): readonly { readonly fileName: string; readonly source: string }[] {
  return viteFrameworkIdentityFilesWithinRoots(
    root,
    fileName,
    source,
    viteClientSourceFileSystems(root),
  );
}

function viteFrameworkIdentityFilesWithinRoots(
  root: string,
  fileName: string,
  source: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
): readonly { readonly fileName: string; readonly source: string }[] {
  const collected = compilerCreateMap<string, { fileName: string; source: string }>();
  const visited = compilerCreateSet<string>();
  collectViteFrameworkIdentityFiles(root, fileName, source, sourceFileSystems, collected, visited);
  const files: Array<{ fileName: string; source: string }> = [];
  compilerMapForEach(collected, (file) => {
    compilerArrayAppend(files, file, 'Compiler packages/compiler/src/vite.ts collection');
  });
  return files;
}

function collectViteFrameworkIdentityFiles(
  root: string,
  fileName: string,
  source: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
  collected: Map<string, { fileName: string; source: string }>,
  visited: Set<string>,
): void {
  const key = slashPath(fileName);
  if (compilerSetHas(visited, key)) return;
  compilerSetAdd(visited, key);

  const model = parseComponentModule(fileName, source);
  const specifierLength = compilerArrayLength(
    model.moduleSpecifiers,
    'Vite framework identity module specifiers',
  );
  for (let index = 0; index < specifierLength; index += 1) {
    const specifier = compilerOwnDataValue(
      model.moduleSpecifiers,
      index,
      'Vite framework identity module specifiers',
    ) as (typeof model.moduleSpecifiers)[number] | undefined;
    if (!specifier) {
      throw new TypeError(`Vite framework identity module specifiers[${index}] must be dense.`);
    }
    if (!isRelativeModuleSpecifier(specifier.specifier)) continue;
    const resolved = readViteRelativeSourceFile(
      root,
      fileName,
      specifier.specifier,
      sourceFileSystems,
    );
    if (!resolved) continue;
    if (!compilerMapGet(collected, resolved.fileName)) {
      compilerMapSet(collected, resolved.fileName, resolved);
    }
    collectViteFrameworkIdentityFiles(
      root,
      resolved.fileName,
      resolved.source,
      sourceFileSystems,
      collected,
      visited,
    );
  }
}

function readViteRelativeSourceFile(
  root: string,
  importerFileName: string,
  moduleSpecifier: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
): { fileName: string; source: string } | null {
  const importerPath = isAbsolute(importerFileName)
    ? importerFileName
    : resolve(root, importerFileName);
  const basePath = resolve(dirname(importerPath), moduleSpecifier);
  const candidates = viteSourceFileCandidates(basePath);
  const length = compilerArrayLength(candidates, 'Vite source-file candidates');
  for (let index = 0; index < length; index += 1) {
    const candidate = compilerOwnDataValue(candidates, index, 'Vite source-file candidates');
    if (typeof candidate !== 'string') {
      throw new TypeError(`Vite source-file candidates[${index}] must be a string.`);
    }
    const source = readViteClientSourceFile(sourceFileSystems, candidate);
    if (source !== null) return { fileName: viteComponentFileName(candidate, root), source };
  }
  return null;
}

function viteSourceFileCandidates(basePath: string): readonly string[] {
  const explicitExtension = viteSourceFileExtension(basePath);
  if (explicitExtension) {
    const withoutExtension = compilerStringSlice(basePath, 0, -explicitExtension.length);
    switch (explicitExtension) {
      case '.js':
        return [`${withoutExtension}.ts`, `${withoutExtension}.tsx`, basePath];
      case '.jsx':
        return [`${withoutExtension}.tsx`, `${withoutExtension}.ts`, basePath];
      case '.mjs':
        return [`${withoutExtension}.mts`, `${withoutExtension}.mtsx`, basePath];
      case '.cjs':
        return [`${withoutExtension}.cts`, `${withoutExtension}.ctsx`, basePath];
      default:
        return [basePath];
    }
  }
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.mtsx`,
    `${basePath}.cts`,
    `${basePath}.ctsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.mts`,
    `${basePath}/index.mtsx`,
    `${basePath}/index.cts`,
    `${basePath}/index.ctsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ];
}

function viteSourceFileExtension(basePath: string): string | null {
  const extensions = [
    '.mtsx',
    '.ctsx',
    '.tsx',
    '.mts',
    '.cts',
    '.mjs',
    '.cjs',
    '.jsx',
    '.ts',
    '.js',
  ];
  for (let index = 0; index < extensions.length; index += 1) {
    if (compilerStringEndsWith(basePath, extensions[index]!)) return extensions[index]!;
  }
  return null;
}

function isRelativeModuleSpecifier(specifier: string): boolean {
  return compilerStringStartsWith(specifier, './') || compilerStringStartsWith(specifier, '../');
}

function resolveViteClientModuleId(
  source: string,
  importer: string | undefined,
  root: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
): null | string {
  const sourceFileName = viteRequestFileName(source);
  if (!compilerStringEndsWith(sourceFileName, '.client.js')) return null;
  const importerFileName = importer === undefined ? undefined : viteRequestFileName(importer);
  const candidate = isAbsolute(sourceFileName)
    ? sourceFileName
    : importerFileName
      ? resolve(dirname(importerFileName), sourceFileName)
      : resolve(root, trimLeadingSlashes(sourceFileName));
  if (
    !viteClientSourceFileIsAllowed(sourceFileSystems, viteClientModuleSourceFilePath(candidate))
  ) {
    return null;
  }

  return candidate;
}

function loadViteClientModule(
  compileComponentModule: ViteCompileComponentModule,
  options: KovoVitePluginOptions,
  root: string,
  sourceFileSystems: readonly CompilerSourceFileSystem[],
  id: string,
  isCurrent: () => boolean,
): MaybePromise<null | string> {
  if (!isCurrent()) return null;
  const clientFilePath = viteRequestFileName(id);
  if (!compilerStringEndsWith(clientFilePath, '.client.js')) return null;

  const sourceFilePath = viteClientModuleSourceFilePath(clientFilePath);
  const source = readViteClientSourceFile(sourceFileSystems, sourceFilePath);
  if (!isCurrent()) return null;
  if (source === null) return null;

  const fileName = viteComponentFileName(sourceFilePath, root);
  if (!shouldTransformViteComponentSource(fileName, source, options)) return null;
  if (!isCurrent()) return null;

  const result = compileViteComponentModule(
    compileComponentModule,
    options,
    root,
    sourceFileSystems,
    fileName,
    source,
  );
  if (isPromiseLike(result)) {
    return compilerPromiseThen(result, (resolvedResult) =>
      loadViteClientCompileResult(options, fileName, source, resolvedResult, isCurrent),
    );
  }

  return loadViteClientCompileResult(options, fileName, source, result, isCurrent);
}

function loadViteClientCompileResult(
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
  result: ViteCompileResult,
  isCurrent: () => boolean,
): null | string {
  if (!isCurrent()) return null;
  const emittedFiles = snapshotViteEmittedFiles(result);
  if (!isCurrent()) return null;
  const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
  if (!isCurrent()) return null;
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));

  const clientSource = viteClientSource(emittedFiles);
  return isCurrent() ? clientSource : null;
}

function viteClientSource(files: readonly { kind: string; source: string }[]): null | string {
  for (let index = 0; index < files.length; index += 1) {
    if (files[index]!.kind === 'client') return files[index]!.source;
  }
  return null;
}

function viteClientModuleSourceFilePath(clientFilePath: string): string {
  return compilerRegExpReplace(/\.client\.js$/u, clientFilePath, '.tsx');
}

function viteClientSourceFileSystems(
  root: string,
  configuredRoots?: readonly string[],
): readonly CompilerSourceFileSystem[] {
  const roots =
    configuredRoots === undefined
      ? [root]
      : compilerSnapshotDenseArray(configuredRoots, 'Vite server.fs.allow roots');
  const fileSystems: CompilerSourceFileSystem[] = [];
  const length = compilerArrayLength(roots, 'Vite client source roots');
  for (let index = 0; index < length; index += 1) {
    const allowedRoot = compilerOwnDataValue(roots, index, 'Vite client source roots');
    if (typeof allowedRoot !== 'string') {
      throw new TypeError(`Vite server.fs.allow[${index}] must be a string.`);
    }
    const fileSystem = createCompilerSourceFileSystem(allowedRoot);
    if (fileSystem !== null) {
      compilerArrayAppend(
        fileSystems,
        fileSystem,
        'Compiler packages/compiler/src/vite.ts client source filesystems',
      );
    }
  }
  return compilerFreeze(fileSystems);
}

function viteClientSourceFileIsAllowed(
  fileSystems: readonly CompilerSourceFileSystem[],
  sourceFilePath: string,
): boolean {
  const length = compilerArrayLength(fileSystems, 'Vite client source filesystems');
  for (let index = 0; index < length; index += 1) {
    if (fileSystems[index]?.kind(sourceFilePath) === 'file') return true;
  }
  return false;
}

function readViteClientSourceFile(
  fileSystems: readonly CompilerSourceFileSystem[],
  sourceFilePath: string,
): string | null {
  const length = compilerArrayLength(fileSystems, 'Vite client source filesystems');
  for (let index = 0; index < length; index += 1) {
    const source = fileSystems[index]?.readFile(sourceFilePath);
    if (source !== null && source !== undefined) return source;
  }
  return null;
}

function resolveViteRegistryFacts(
  options: KovoVitePluginOptions,
  fileName: string,
): RegistryFacts | undefined {
  if (typeof options.registryFacts === 'function') return options.registryFacts(fileName);
  return options.registryFacts;
}

function resolveViteQueryShapeFacts(
  options: KovoVitePluginOptions,
  fileName: string,
): readonly QueryShapeFact[] | undefined {
  if (typeof options.queryShapeFacts === 'function') return options.queryShapeFacts(fileName);
  return options.queryShapeFacts;
}

function componentLocalQueryShapeFacts(
  source: string,
  fileName: string,
  facts: readonly QueryShapeFact[] | undefined,
): readonly QueryShapeFact[] | undefined {
  if (!facts || facts.length === 0) return facts;

  const factsByQuery = compilerCreateMap<string, QueryShapeFact>();
  const factLength = compilerArrayLength(facts, 'Vite query-shape facts');
  for (let index = 0; index < factLength; index += 1) {
    const fact = snapshotViteQueryShapeFact(facts, index);
    compilerMapSet(factsByQuery, fact.query, fact);
  }
  const model = parseComponentModule(fileName, source);
  const entries = allComponentOptionObjectEntries(model, 'queries');
  const entryLength = compilerArrayLength(entries, 'Vite component query entries');
  const aliasCandidates: QueryShapeFact[] = [];
  for (let index = 0; index < entryLength; index += 1) {
    const rawEntry = compilerOwnDataValue(entries, index, 'Vite component query entries');
    if (typeof rawEntry !== 'object' || rawEntry === null || compilerArrayIsArray(rawEntry)) {
      throw new TypeError(`Vite component query entries[${index}] must be an own object.`);
    }
    const key = compilerOwnDataValue(rawEntry, 'key', `Vite component query entries[${index}]`);
    const value = compilerOwnDataValue(rawEntry, 'value', `Vite component query entries[${index}]`);
    if (typeof key !== 'string') {
      throw new TypeError(`Vite component query entries[${index}].key must be a string.`);
    }
    const queryExpression = value
      ? queryExpressionFromBinding(value as Parameters<typeof queryExpressionFromBinding>[0])
      : null;
    if (!queryExpression || queryExpression === key || compilerMapGet(factsByQuery, key)) continue;
    const importedKey = importedQueryDerivedKey(model, fileName, queryExpression);
    const sourceFact =
      compilerMapGet(factsByQuery, queryExpression) ??
      compilerMapGet(factsByQuery, importedKey ?? '');
    if (!sourceFact) continue;
    compilerArrayAppend(
      aliasCandidates,
      {
        query: key,
        shape: sourceFact.shape,
        source: sourceFact.source,
      },
      'Compiler packages/compiler/src/vite.ts collection',
    );
  }
  const aliases = uniqueQueryShapeFacts(aliasCandidates);

  if (aliases.length === 0) return facts;
  const combined: QueryShapeFact[] = [];
  for (let index = 0; index < factLength; index += 1) {
    compilerArrayAppend(
      combined,
      snapshotViteQueryShapeFact(facts, index),
      'Compiler packages/compiler/src/vite.ts collection',
    );
  }
  const aliasLength = compilerArrayLength(aliases, 'Vite query-shape aliases');
  for (let index = 0; index < aliasLength; index += 1) {
    compilerArrayAppend(
      combined,
      snapshotViteQueryShapeFact(aliases, index),
      'Compiler packages/compiler/src/vite.ts collection',
    );
  }
  return combined;
}

function uniqueQueryShapeFacts(facts: readonly QueryShapeFact[]): QueryShapeFact[] {
  const seen = compilerCreateSet<string>();
  const unique: QueryShapeFact[] = [];
  const length = compilerArrayLength(facts, 'Vite query-shape alias candidates');
  for (let index = 0; index < length; index += 1) {
    const fact = snapshotViteQueryShapeFact(facts, index);
    const key = canonicalJson(fact);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(unique, fact, 'Compiler packages/compiler/src/vite.ts collection');
  }
  return unique;
}

function importedQueryDerivedKey(
  model: ReturnType<typeof parseComponentModule>,
  fileName: string,
  queryExpression: string,
): string | null {
  let entry: (typeof model.namedImports)[number] | undefined;
  const length = compilerArrayLength(model.namedImports, 'Vite query named imports');
  for (let index = 0; index < length; index += 1) {
    const candidate = compilerOwnDataValue(
      model.namedImports,
      index,
      'Vite query named imports',
    ) as (typeof model.namedImports)[number] | undefined;
    if (!candidate) throw new TypeError(`Vite query named imports[${index}] must be dense.`);
    if (
      candidate.localName === queryExpression &&
      compilerStringStartsWith(candidate.moduleSpecifier, '.')
    ) {
      entry = candidate;
      break;
    }
  }
  if (!entry) return null;

  return deriveRegistryIdentity(
    resolveImportedModuleFileName(fileName, entry.moduleSpecifier),
    entry.importedName,
  ).key;
}

function resolveImportedModuleFileName(fileName: string, moduleSpecifier: string): string {
  const extension = compilerRegExpTest(/\.[cm]?[tj]sx?$/, moduleSpecifier) ? '' : '.ts';
  return slashPath(resolve(dirname(fileName), `${moduleSpecifier}${extension}`));
}

function snapshotViteQueryShapeFact(
  facts: readonly QueryShapeFact[],
  index: number,
): QueryShapeFact {
  const raw = compilerOwnDataValue(facts, index, 'Vite query-shape facts');
  if (typeof raw !== 'object' || raw === null || compilerArrayIsArray(raw)) {
    throw new TypeError(`Vite query-shape facts[${index}] must be an own object.`);
  }
  const query = compilerOwnDataValue(raw, 'query', `Vite query-shape facts[${index}]`);
  const shape = compilerOwnDataValue(raw, 'shape', `Vite query-shape facts[${index}]`);
  const factSource = compilerOwnDataValue(raw, 'source', `Vite query-shape facts[${index}]`);
  if (typeof query !== 'string' || shape === undefined || typeof factSource !== 'string') {
    throw new TypeError(`Vite query-shape facts[${index}] has an invalid query, shape, or source.`);
  }
  return { query, shape: shape as QueryShapeFact['shape'], source: factSource };
}

function reportViteDiagnostics(
  result: ViteCompileResult,
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
): CompilerDiagnostic[] {
  const rawDiagnostics = compilerOwnDataValue(result, 'diagnostics', 'Vite compile result');
  if (rawDiagnostics !== undefined && !compilerArrayIsArray(rawDiagnostics)) {
    throw new TypeError('Kovo Vite compile diagnostics must be an array.');
  }
  const diagnostics = (rawDiagnostics ?? []) as CompilerDiagnostic[];
  const length = compilerArrayLength(diagnostics, 'Vite compile diagnostics');
  const snapshot: CompilerDiagnostic[] = [];
  const errorDiagnostics: CompilerDiagnostic[] = [];
  const nonErrorDiagnostics: CompilerDiagnostic[] = [];

  // SPEC §2/§5.2: app code executes in this realm, so an error diagnostic cannot pass through
  // a live Array.filter or callback after evaluation. Snapshot dense own entries/fields and finish
  // blocking classification before invoking any app-supplied observer.
  for (let index = 0; index < length; index += 1) {
    const rawDiagnostic = compilerOwnDataValue(diagnostics, index, 'Vite compile diagnostics');
    if (rawDiagnostic === undefined) {
      throw new TypeError(`Kovo Vite compile diagnostics[${index}] must be a dense own value.`);
    }
    const diagnostic = snapshotViteCompilerDiagnostic(rawDiagnostic, index);
    compilerArrayAppend(snapshot, diagnostic, 'Compiler packages/compiler/src/vite.ts collection');
    if (diagnosticSeverity(diagnostic) === 'error') {
      compilerArrayAppend(
        errorDiagnostics,
        diagnostic,
        'Compiler packages/compiler/src/vite.ts collection',
      );
    } else {
      compilerArrayAppend(
        nonErrorDiagnostics,
        diagnostic,
        'Compiler packages/compiler/src/vite.ts collection',
      );
    }
  }

  options.onModuleDiagnostics?.({
    diagnostics: cloneViteCompilerDiagnostics(snapshot),
    fileName,
    source,
  });
  for (let index = 0; index < nonErrorDiagnostics.length; index += 1) {
    options.onDiagnostic?.(cloneViteCompilerDiagnostic(nonErrorDiagnostics[index]!));
  }

  return errorDiagnostics;
}

function snapshotViteCompilerDiagnostic(value: unknown, index: number): CompilerDiagnostic {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`Kovo Vite compile diagnostics[${index}] must be an object.`);
  }
  const label = `Vite compile diagnostics[${index}]`;
  const code = compilerOwnDataValue(value, 'code', label);
  const fileName = compilerOwnDataValue(value, 'fileName', label);
  const help = compilerOwnDataValue(value, 'help', label);
  const length = compilerOwnDataValue(value, 'length', label);
  const message = compilerOwnDataValue(value, 'message', label);
  const severity = compilerOwnDataValue(value, 'severity', label);
  const rawStart = compilerOwnDataValue(value, 'start', label);
  if (
    !isDiagnosticCode(code) ||
    typeof fileName !== 'string' ||
    (help !== undefined && typeof help !== 'string') ||
    (length !== undefined &&
      (typeof length !== 'number' || !compilerNumberIsSafeInteger(length))) ||
    typeof message !== 'string' ||
    (severity !== 'error' && severity !== 'warn' && severity !== 'lint' && severity !== 'notice')
  ) {
    throw new TypeError(`${label} has malformed authority fields.`);
  }
  let start: CompilerDiagnostic['start'];
  if (rawStart !== undefined) {
    if (!rawStart || typeof rawStart !== 'object') {
      throw new TypeError(`${label}.start must be an own position record.`);
    }
    const column = compilerOwnDataValue(rawStart, 'column', `${label}.start`);
    const line = compilerOwnDataValue(rawStart, 'line', `${label}.start`);
    if (
      typeof column !== 'number' ||
      !compilerNumberIsSafeInteger(column) ||
      typeof line !== 'number' ||
      !compilerNumberIsSafeInteger(line)
    ) {
      throw new TypeError(`${label}.start has malformed line/column values.`);
    }
    start = { column, line };
  }
  return {
    code,
    fileName,
    ...(help === undefined ? {} : { help }),
    ...(length === undefined ? {} : { length }),
    message,
    severity,
    ...(start === undefined ? {} : { start }),
  };
}

function cloneViteCompilerDiagnostics(
  diagnostics: readonly CompilerDiagnostic[],
): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    compilerArrayAppend(
      result,
      cloneViteCompilerDiagnostic(diagnostics[index]!),
      'Compiler packages/compiler/src/vite.ts collection',
    );
  }
  return result;
}

function cloneViteCompilerDiagnostic(diagnostic: CompilerDiagnostic): CompilerDiagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.start === undefined ? {} : { start: { ...diagnostic.start } }),
  };
}

function snapshotViteEmittedFiles(result: ViteCompileResult): { kind: string; source: string }[] {
  const rawFiles = compilerOwnDataValue(result, 'files', 'Vite compile result');
  if (!compilerArrayIsArray(rawFiles)) {
    throw new TypeError('Kovo Vite compile files must be an array.');
  }
  const length = compilerArrayLength(rawFiles, 'Vite compile files');
  const files: { kind: string; source: string }[] = [];
  for (let index = 0; index < length; index += 1) {
    const file = compilerOwnDataValue(rawFiles, index, 'Vite compile files');
    if (!file || typeof file !== 'object') {
      throw new TypeError(`Kovo Vite compile files[${index}] must be an own record.`);
    }
    const kind = compilerOwnDataValue(file, 'kind', `Vite compile files[${index}]`);
    const source = compilerOwnDataValue(file, 'source', `Vite compile files[${index}]`);
    if (typeof kind !== 'string' || typeof source !== 'string') {
      throw new TypeError(
        `Kovo Vite compile files[${index}] must contain own kind/source strings.`,
      );
    }
    compilerArrayAppend(
      files,
      { kind, source },
      'Compiler packages/compiler/src/vite.ts collection',
    );
  }
  return files;
}

function snapshotViteCompileMetadata(result: ViteCompileResult): ViteCompileMetadata {
  const rawClientExports = compilerOwnDataValue(result, 'clientExports', 'Vite compile result');
  const rawCssAssets = compilerOwnDataValue(result, 'cssAssets', 'Vite compile result');
  const rawHandlerExports = compilerOwnDataValue(result, 'handlerExports', 'Vite compile result');
  const rawHmrImpact = compilerOwnDataValue(result, 'hmrImpact', 'Vite compile result');
  const rawRenderPlanFingerprint = compilerOwnDataValue(
    result,
    'renderPlanFingerprint',
    'Vite compile result',
  );
  if (rawCssAssets !== undefined && !compilerArrayIsArray(rawCssAssets)) {
    throw new TypeError('Kovo Vite compile cssAssets must be an array.');
  }
  if (
    rawHmrImpact !== undefined &&
    rawHmrImpact !== null &&
    (typeof rawHmrImpact !== 'object' || compilerArrayIsArray(rawHmrImpact))
  ) {
    throw new TypeError('Kovo Vite compile hmrImpact must be an object or null.');
  }
  if (
    rawRenderPlanFingerprint !== undefined &&
    rawRenderPlanFingerprint !== null &&
    typeof rawRenderPlanFingerprint !== 'string'
  ) {
    throw new TypeError('Kovo Vite compile renderPlanFingerprint must be a string or null.');
  }

  return {
    clientExports: snapshotViteStringList(rawClientExports, 'clientExports'),
    cssAssets:
      rawCssAssets === undefined
        ? []
        : (compilerSnapshotJsonValue(
            rawCssAssets,
            'Vite compile cssAssets',
          ) as unknown as ComponentCssAsset[]),
    handlerExports: snapshotViteStringList(rawHandlerExports, 'handlerExports'),
    hmrImpact:
      rawHmrImpact === undefined || rawHmrImpact === null
        ? null
        : (compilerSnapshotJsonValue(
            rawHmrImpact,
            'Vite compile hmrImpact',
          ) as unknown as HmrImpactMetadata),
    renderPlanFingerprint: rawRenderPlanFingerprint === undefined ? null : rawRenderPlanFingerprint,
  };
}

function snapshotViteStringList(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!compilerArrayIsArray(value)) {
    throw new TypeError(`Kovo Vite compile ${name} must be an array.`);
  }
  const length = compilerArrayLength(value, `Vite compile ${name}`);
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(value, index, `Vite compile ${name}`);
    if (typeof entry !== 'string') {
      throw new TypeError(`Kovo Vite compile ${name}[${index}] must be an own string.`);
    }
    compilerArrayAppend(result, entry, `Vite compile ${name}`);
  }
  return result;
}

function recordViteCompileResult(
  store: ViteDevStateStore,
  fileName: string,
  metadata: ViteCompileMetadata,
  files: readonly { kind: string; source: string }[],
): void {
  let clientSource: string | undefined;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (file.kind !== 'client') continue;
    if (clientSource !== undefined) {
      throw new TypeError(`Kovo Vite compile ${fileName} emitted more than one client module.`);
    }
    clientSource = file.source;
  }

  const existing = compilerMapGet(store.files, fileName);
  let clientHistory: ViteClientModuleHistory | undefined;
  let compiledClientModule: KovoViteCompiledClientModule | undefined;
  if (clientSource !== undefined) {
    const href =
      metadata.hmrImpact?.clientHref ??
      clientModuleHrefForSourceFile(fileName, clientModuleContentVersion(clientSource));
    clientHistory = nextViteClientModuleHistory(existing?.clientHistory, href, clientSource);
    const target = parseVersionedClientModuleTarget(href);
    if (
      metadata.hmrImpact?.clientHref !== null &&
      metadata.hmrImpact?.clientHref !== undefined &&
      metadata.clientExports.length + metadata.handlerExports.length > 0
    ) {
      compiledClientModule = compilerFreeze({
        path: target?.path ?? new URL(href, 'https://kovo.local').pathname,
        ...(metadata.renderPlanFingerprint
          ? { renderPlanFingerprint: metadata.renderPlanFingerprint }
          : {}),
        source: rewriteClientModuleRuntimeImportsForBrowser(clientSource),
        ...(target?.version === undefined ? {} : { version: target.version }),
      });
    }
  }

  const cssAssets = metadata.cssAssets.length === 0 ? undefined : metadata.cssAssets;
  const hmrImpact = metadata.hmrImpact ?? undefined;
  let sourceUnits = viteDevFileSourceUnits(
    fileName,
    clientHistory,
    compiledClientModule,
    cssAssets,
    hmrImpact,
  );
  if (
    sourceUnits > KOVO_DEV_CLIENT_MODULE_SOURCE_UNIT_LIMIT &&
    clientHistory?.previous !== undefined
  ) {
    clientHistory = { current: clientHistory.current };
    sourceUnits = viteDevFileSourceUnits(
      fileName,
      clientHistory,
      compiledClientModule,
      cssAssets,
      hmrImpact,
    );
  }
  if (sourceUnits > KOVO_DEV_CLIENT_MODULE_SOURCE_UNIT_LIMIT) {
    throw new RangeError('Kovo Vite state for one source file exceeds the bounded source limit.');
  }

  if (
    clientHistory === undefined &&
    compiledClientModule === undefined &&
    cssAssets === undefined &&
    hmrImpact === undefined
  ) {
    if (existing !== undefined) removeViteDevFileState(store, fileName, existing);
    return;
  }

  const projectedFileCount = store.fileCount - (existing === undefined ? 0 : 1) + 1;
  const projectedSourceUnits = store.sourceUnits - (existing?.sourceUnits ?? 0) + sourceUnits;
  if (
    store.buildMode &&
    (projectedFileCount > KOVO_DEV_CLIENT_MODULE_FILE_LIMIT ||
      projectedSourceUnits > KOVO_DEV_CLIENT_MODULE_SOURCE_UNIT_LIMIT)
  ) {
    throw new RangeError(
      'Kovo Vite build state exceeds its bounded file/source limit; refusing incomplete output.',
    );
  }

  if (existing !== undefined) removeViteDevFileState(store, fileName, existing);
  store.touch += 1;
  const state: ViteDevFileState = {
    ...(clientHistory === undefined ? {} : { clientHistory }),
    ...(compiledClientModule === undefined ? {} : { compiledClientModule }),
    ...(cssAssets === undefined ? {} : { cssAssets }),
    ...(hmrImpact === undefined ? {} : { hmrImpact }),
    lastTouched: store.touch,
    sourceUnits,
  };
  compilerMapSet(store.files, fileName, state);
  store.fileCount += 1;
  store.sourceUnits += sourceUnits;
  addViteClientModuleVersion(store, fileName, clientHistory?.previous);
  addViteClientModuleVersion(store, fileName, clientHistory?.current);

  if (!store.buildMode) evictViteDevState(store, fileName);
}

function nextViteClientModuleHistory(
  existing: ViteClientModuleHistory | undefined,
  href: string,
  source: string,
): ViteClientModuleHistory {
  const keys: string[] = [];
  compilerArrayAppend(keys, href, 'Kovo Vite client-module history keys');
  const target = parseVersionedClientModuleTarget(href);
  if (target !== undefined) {
    const queryKey = `${target.path}?v=${target.version}`;
    if (queryKey !== href) {
      compilerArrayAppend(keys, queryKey, 'Kovo Vite client-module history keys');
    }
  }
  let previous: ViteClientModuleVersion | undefined;
  if (existing !== undefined) {
    if (existing.current.href === href && existing.current.source === source) {
      previous = existing.previous;
    } else if (existing.current.href !== href) {
      previous = existing.current;
    }
  }
  const current = { href, keys, source };
  return { current, ...(previous === undefined ? {} : { previous }) };
}

function evictViteDevState(store: ViteDevStateStore, activeFileName: string): void {
  while (
    store.fileCount > KOVO_DEV_CLIENT_MODULE_FILE_LIMIT ||
    store.sourceUnits > KOVO_DEV_CLIENT_MODULE_SOURCE_UNIT_LIMIT
  ) {
    let oldestFileName: string | undefined;
    let oldestState: ViteDevFileState | undefined;
    compilerMapForEach(store.files, (candidate, candidateFileName) => {
      if (
        candidateFileName !== activeFileName &&
        (oldestState === undefined || candidate.lastTouched < oldestState.lastTouched)
      ) {
        oldestFileName = candidateFileName;
        oldestState = candidate;
      }
    });
    if (oldestFileName === undefined || oldestState === undefined) break;
    removeViteDevFileState(store, oldestFileName, oldestState);
  }
}

function addViteClientModuleVersion(
  store: ViteDevStateStore,
  fileName: string,
  version: ViteClientModuleVersion | undefined,
): void {
  if (version === undefined) return;
  for (let index = 0; index < version.keys.length; index += 1) {
    const key = version.keys[index]!;
    compilerMapSet(store.modules, key, version.source);
    compilerMapSet(store.owners, key, fileName);
  }
}

function removeViteDevFileState(
  store: ViteDevStateStore,
  fileName: string,
  state: ViteDevFileState,
): void {
  removeViteClientModuleVersion(store, fileName, state.clientHistory?.current);
  removeViteClientModuleVersion(store, fileName, state.clientHistory?.previous);
  compilerMapDelete(store.files, fileName);
  store.fileCount -= 1;
  store.sourceUnits -= state.sourceUnits;
}

function removeViteClientModuleVersion(
  store: ViteDevStateStore,
  fileName: string,
  version: ViteClientModuleVersion | undefined,
): void {
  if (version === undefined) return;
  for (let index = 0; index < version.keys.length; index += 1) {
    const key = version.keys[index]!;
    if (compilerMapGet(store.owners, key) !== fileName) continue;
    compilerMapDelete(store.modules, key);
    compilerMapDelete(store.owners, key);
  }
}

function viteDevFileSourceUnits(
  fileName: string,
  history: ViteClientModuleHistory | undefined,
  compiledClientModule: KovoViteCompiledClientModule | undefined,
  cssAssets: readonly ComponentCssAsset[] | undefined,
  hmrImpact: HmrImpactMetadata | undefined,
): number {
  return (
    fileName.length +
    canonicalJson({
      ...(history === undefined ? {} : { clientHistory: history }),
      ...(compiledClientModule === undefined ? {} : { compiledClientModule }),
      ...(cssAssets === undefined ? {} : { cssAssets }),
      ...(hmrImpact === undefined ? {} : { hmrImpact }),
    }).length
  );
}

function classifyViteHmrImpact(
  previous: HmrImpactMetadata | null | undefined,
  next: HmrImpactMetadata | null | undefined,
): HmrImpactClassification {
  if (!previous || !next) return viteFullReload('missing-facts');
  if (hasErrorHmrDiagnostic(next.diagnostics)) {
    return { impact: 'diagnosticError', reasons: ['diagnostics'] };
  }
  if (hasErrorHmrDiagnostic(previous.diagnostics)) {
    return viteFullReload('diagnostics');
  }
  if (previous.sourceFileName !== next.sourceFileName) return viteFullReload('topology');
  if (previous.sourceKind !== next.sourceKind) return viteFullReload('topology');
  if (next.sourceKind === 'route-shell')
    return { impact: 'routeRefresh', reasons: ['route-shell'] };
  if (!previous.component || !next.component) return viteFullReload('missing-facts');
  if (
    previous.component.registryKey !== next.component.registryKey ||
    previous.component.domLeaf !== next.component.domLeaf
  ) {
    return viteFullReload('topology');
  }

  const reasons: HmrImpactReason[] = [];
  if (previous.queryUpdatePlanHash !== next.queryUpdatePlanHash)
    compilerArrayAppend(reasons, 'query-plan', 'Compiler packages/compiler/src/vite.ts collection');
  if (previous.stylesheetAssetsHash !== next.stylesheetAssetsHash)
    compilerArrayAppend(reasons, 'style', 'Compiler packages/compiler/src/vite.ts collection');
  if (reasons.length > 0) return { impact: 'routeRefresh', reasons };
  if (previous.liveTargetFactsHash !== next.liveTargetFactsHash) {
    return viteFullReload('live-target');
  }

  const hasRefreshableTarget = next.liveTargetFacts.length > 0;
  if (previous.renderOutputHash !== next.renderOutputHash) {
    return hasRefreshableTarget
      ? { impact: 'componentRefresh', reasons: ['render-output'] }
      : viteFullReload('missing-facts');
  }
  if (previous.clientHref !== next.clientHref) {
    return hasRefreshableTarget
      ? { impact: 'componentRefresh', reasons: ['handler-only'] }
      : viteFullReload('missing-facts');
  }
  if (previous.factHash !== next.factHash) return viteFullReload('topology');

  return { impact: 'componentRefresh', reasons: [] };
}

function hasErrorHmrDiagnostic(diagnostics: HmrImpactMetadata['diagnostics']): boolean {
  const length = compilerArrayLength(diagnostics, 'Vite HMR diagnostics');
  for (let index = 0; index < length; index += 1) {
    const diagnostic = compilerOwnDataValue(diagnostics, index, 'Vite HMR diagnostics');
    if (typeof diagnostic !== 'object' || diagnostic === null || compilerArrayIsArray(diagnostic)) {
      throw new TypeError(`Vite HMR diagnostics[${index}] must be an own object.`);
    }
    if (
      compilerOwnDataValue(diagnostic, 'severity', `Vite HMR diagnostics[${index}]`) === 'error'
    ) {
      return true;
    }
  }
  return false;
}

function viteFullReload(reason: HmrImpactReason): HmrImpactClassification {
  return { impact: 'fullReload', reasons: [reason] };
}

function eventForHmrClassification(classification: HmrImpactClassification): KovoHmrEventName {
  if (classification.impact === 'componentRefresh') return 'kovo:component-render';
  if (classification.impact === 'routeRefresh') return 'kovo:route-shell';
  if (classification.impact === 'diagnosticError') return 'kovo:diagnostics';

  return 'kovo:full-reload';
}

function sendKovoHmrEvent(
  server: KovoViteDevServer,
  event: KovoHmrEventName,
  previous: HmrImpactMetadata | null,
  next: HmrImpactMetadata | null,
  classification: HmrImpactClassification,
): void {
  server.ws?.send({
    data: {
      ...(next?.component === undefined ? {} : { component: next.component }),
      ...(next?.diagnostics === undefined ? {} : { diagnostics: next.diagnostics }),
      impact: classification.impact,
      liveTargets: viteHmrLiveTargets(next?.liveTargetFacts ?? []),
      ...(next?.clientHref ? { newClientHref: next.clientHref } : {}),
      ...(next?.factHash ? { newFactHash: next.factHash } : {}),
      ...(previous?.clientHref ? { oldClientHref: previous.clientHref } : {}),
      ...(previous?.factHash ? { oldFactHash: previous.factHash } : {}),
      reasons: classification.reasons,
      sourceFile: next?.sourceFileName ?? previous?.sourceFileName ?? '',
    },
    event,
    type: 'custom',
  });
}

function viteHmrLiveTargets(facts: HmrImpactMetadata['liveTargetFacts']): string[] {
  const targets: string[] = [];
  const length = compilerArrayLength(facts, 'Vite HMR live-target facts');
  for (let index = 0; index < length; index += 1) {
    const fact = compilerOwnDataValue(facts, index, 'Vite HMR live-target facts');
    if (typeof fact !== 'object' || fact === null || compilerArrayIsArray(fact)) {
      throw new TypeError(`Vite HMR live-target facts[${index}] must be an own object.`);
    }
    const target = compilerOwnDataValue(fact, 'target', `Vite HMR live-target facts[${index}]`);
    if (typeof target !== 'string') {
      throw new TypeError(`Vite HMR live-target facts[${index}].target must be a string.`);
    }
    compilerArrayAppend(targets, target, 'Compiler packages/compiler/src/vite.ts collection');
  }
  return targets;
}

function diagnosticSeverity(diagnostic: CompilerDiagnostic): CompilerDiagnostic['severity'] {
  return diagnostic.severity;
}

function viteDiagnosticErrorMessage(diagnostics: readonly CompilerDiagnostic[]): string {
  const plural = diagnostics.length === 1 ? '' : 's';

  // SPEC §5.2 hard rule 5: diagnostics are teaching errors, so Vite surfaces the
  // source site plus the compiler's lowering/fix help instead of a terse code.
  return [
    `Kovo Vite transform failed with ${diagnostics.length} error diagnostic${plural}.`,
    diagnostics.map(formatCompilerDiagnostic).join('\n\n'),
  ].join('\n\n');
}

function formatCompilerDiagnostic(diagnostic: CompilerDiagnostic): string {
  const help = diagnostic.help?.trim();
  if (!help) return `${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message}`;

  return [
    `${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message}`,
    ...help.split('\n').map((line) => `  help: ${line}`),
  ].join('\n');
}

function diagnosticSite(diagnostic: CompilerDiagnostic): string {
  const line = diagnostic.start?.line;
  const column = diagnostic.start?.column;
  if (line === undefined || column === undefined) return diagnostic.fileName;

  return `${diagnostic.fileName}:${line}:${column}`;
}

function viteComponentFileName(id: string, root: string): string {
  const rawFileName = viteRequestFileName(id);
  const fileName = compilerStringStartsWith(rawFileName, '/@fs/')
    ? compilerStringSlice(rawFileName, '/@fs'.length)
    : rawFileName;
  if (!isAbsolute(fileName)) return slashPath(fileName);

  const relativeFileName = relative(root, fileName);
  if (!compilerStringStartsWith(relativeFileName, '..')) return slashPath(relativeFileName);

  return slashPath(trimLeadingSlashes(fileName));
}

function slashPath(fileName: string): string {
  return compilerStringReplaceAll(fileName, '\\', '/');
}

function viteRequestFileName(value: string): string {
  const query = compilerStringIndexOf(value, '?');
  const fragment = compilerStringIndexOf(value, '#');
  const end = query < 0 ? fragment : fragment < 0 ? query : query < fragment ? query : fragment;
  return end < 0 ? value : compilerStringSlice(value, 0, end);
}

function trimLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && compilerStringSlice(value, start, start + 1) === '/') {
    start += 1;
  }
  return start === 0 ? value : compilerStringSlice(value, start);
}

function devClientModuleKey(url: string | undefined): string | null {
  if (!url) return null;

  try {
    return versionedClientModuleRequestKey(url) ?? null;
  } catch {
    return null;
  }
}
