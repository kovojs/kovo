import { existsSync as builtinExistsSync, readFileSync as builtinReadFileSync } from 'node:fs';
import {
  dirname as builtinDirname,
  isAbsolute as builtinIsAbsolute,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';
import { runInNewContext as builtinRunInNewContext } from 'node:vm';

import {
  clientModuleContentVersion,
  clientModuleHrefForSourceFile,
  parseVersionedClientModuleTarget,
  versionedClientModuleRequestKey,
} from '@kovojs/core/internal/client-module-url';
import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';

import { CompileCache, compileCacheKey, compileComponentCacheKeyInput } from './compile-cache.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import { canonicalJson } from './canonical-json.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerJsonParse,
  compilerMapDelete,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerNumberIsSafeInteger,
  compilerOwnDataValue,
  compilerPromiseThen,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerStringEndsWith,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import {
  collectCssAssetManifest,
  type ComponentCssAsset,
  type CssAssetManifest,
  type CssAssetManifestOptions,
} from './css.js';
import {
  persistentCompileCacheDir,
  readPersistentCompileCacheEntryForInput,
  writePersistentCompileCacheEntry,
} from './persistent-compile-cache.js';
import {
  allComponentOptionObjectEntries,
  parseComponentModule,
  parseDiagnosticsForSourceFile,
} from './scan/parse.js';
import { queryExpressionFromBinding } from './scan/query-binding.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { rewriteClientModuleRuntimeImportsForBrowser } from './emit/client.js';
import { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
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

const existsSync = builtinExistsSync;
const readFileSync = builtinReadFileSync;
const dirname = builtinDirname;
const isAbsolute = builtinIsAbsolute;
const relative = builtinRelative;
const resolve = builtinResolve;
const runInNewContext = builtinRunInNewContext;

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
  /** Disable in-memory and persistent compiler caches for cold correctness/perf probes. */
  cache?: boolean;
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
  };
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  ssrLoadModule?: (id: string) => Promise<Record<string, unknown>>;
  ws?: KovoViteWebSocket;
}

/** @internal Minimal Vite resolved config shape needed by the plugin. */
export interface KovoViteResolvedConfig {
  root?: string;
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

type MaybePromise<T> = Promise<T> | T;

/**
 * Build a KovoVitePlugin bound to a given component-compile function, lowering authored
 * component modules through the compiler on `transform` and serving emitted client islands
 * in dev. The barrel-level `kovoVitePlugin` helper wraps this with the real
 * compileComponentModule; this lower-level factory exists so the compile step can be
 * substituted in tests (SPEC.md §5.2). Public plugin factory.
 */
export function createKovoVitePlugin(
  compileComponentModule: (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>,
  options: KovoVitePluginOptions = {},
): KovoVitePlugin {
  options = snapshotKovoVitePluginOptions(options);
  const compileCache = new CompileCache<ViteCompileResult>();
  const clientModules = compilerCreateMap<string, string>();
  const compiledClientModules = compilerCreateMap<string, KovoViteCompiledClientModule>();
  const cssAssetsByFileName = compilerCreateMap<string, readonly ComponentCssAsset[]>();
  const hmrImpacts = compilerCreateMap<string, HmrImpactMetadata>();
  let root = process.cwd();

  return {
    enforce: 'pre',
    configResolved(config) {
      root = config.root ?? root;
    },
    configureServer(server) {
      root = server.config?.root ?? root;
      server.middlewares.use((req, res, next) => {
        const key = devClientModuleKey(req.url);
        const source = key ? compilerMapGet(clientModules, key) : undefined;
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
      const results: Array<{ cssAssets: readonly ComponentCssAsset[] }> = [];
      compilerMapForEach(cssAssetsByFileName, (cssAssets) => {
        compilerArrayAppend(
          results,
          { cssAssets },
          'Compiler packages/compiler/src/vite.ts collection',
        );
      });
      return collectCssAssetManifest(results, manifestOptions);
    },
    getClientModules() {
      const modules: KovoViteCompiledClientModule[] = [];
      compilerMapForEach(compiledClientModules, (module) => {
        let insertAt = modules.length;
        while (insertAt > 0 && module.path < modules[insertAt - 1]!.path) {
          modules[insertAt] = modules[insertAt - 1]!;
          insertAt -= 1;
        }
        modules[insertAt] = module;
      });
      return modules;
    },
    name: 'kovo',
    resolveId(source: string, importer?: string): null | string {
      const resolvedId = resolveViteClientModuleId(source, importer, root);
      if (resolvedId === null) return null;

      return resolvedId;
    },
    load(id: string): MaybePromise<null | string> {
      return loadViteClientModule(compileComponentModule, compileCache, options, root, id);
    },
    transform(source: string, id: string) {
      const fileName = viteComponentFileName(id, root);
      const componentId = viteComponentIdentity(id, root);
      // SPEC §5.2 #3 (fixpoint / idempotency): a lowered live-region server module retains its
      // `component(...)` shape plus compiler-injected ABI imports (`@kovojs/server/internal/escape`,
      // `.../wire`). When two Kovo plugins are configured (e.g. an app's `kovo({ app })` plus an
      // explicit compiler plugin), the second plugin's `transform` receives the FIRST plugin's
      // emitted output; re-lowering it would re-flag those ABI imports as KV235 (app source importing
      // a non-public subpath). The transform is its own fixpoint: an emitted output must never be
      // re-lowered as app source. The registry is process-scoped, so it is shared across plugin
      // instances and cannot be forged from authored source.
      if (
        isKovoEmittedServerModuleReentry(componentId, source) ||
        isKovoEmittedServerModuleReentry(fileName, source)
      )
        return null;
      const isAuthoredSource = shouldTransformViteAuthoredSource(
        fileName,
        componentId,
        source,
        options,
      );
      const isComponentSource = shouldTransformViteComponentSource(
        fileName,
        componentId,
        source,
        options,
      );
      if (isAuthoredSource && !isComponentSource) {
        validateViteStandaloneAuthoringSurface(options, fileName, source);
      }
      const standaloneRegistrySource = isAuthoredSource
        ? lowerStandaloneSourceDerivedRegistryDeclarations({ fileName, source })
        : null;
      if (!isComponentSource) {
        return standaloneRegistrySource === null
          ? null
          : { code: standaloneRegistrySource, map: null };
      }
      rememberKovoCompiledComponent(componentId);
      rememberKovoCompiledComponent(fileName);
      const forgetComponentCompile = (): void => {
        forgetKovoCompiledComponent(componentId);
        forgetKovoCompiledComponent(fileName);
      };
      const result = compileCachedViteComponentModule(
        compileComponentModule,
        compileCache,
        options,
        root,
        fileName,
        source,
      );
      if (isPromiseLike(result)) {
        return compilerPromiseThen(
          result,
          (resolvedResult) => {
            try {
              return transformViteCompileResult(
                clientModules,
                compiledClientModules,
                cssAssetsByFileName,
                hmrImpacts,
                options,
                componentId,
                fileName,
                source,
                resolvedResult,
              );
            } catch (error) {
              forgetComponentCompile();
              throw error;
            }
          },
          (error: unknown) => {
            forgetComponentCompile();
            throw error;
          },
        );
      }

      try {
        return transformViteCompileResult(
          clientModules,
          compiledClientModules,
          cssAssetsByFileName,
          hmrImpacts,
          options,
          componentId,
          fileName,
          source,
          result,
        );
      } catch (error) {
        forgetComponentCompile();
        throw error;
      }
    },
    async handleHotUpdate(context) {
      const source = await context.read();
      const fileName = viteComponentFileName(context.file, root);
      const componentId = viteComponentIdentity(context.file, root);
      // SPEC §5.2 #3: the authored file changed, so drop its "cleanly compiled" mark — the edit must
      // be compiled fresh (and any newly-added ABI import re-flagged as KV235), not skipped as a
      // stale emitted-output re-entry.
      forgetKovoCompiledComponent(componentId);
      forgetKovoCompiledComponent(fileName);
      const isAuthoredSource = shouldTransformViteAuthoredSource(
        fileName,
        componentId,
        source,
        options,
      );
      const isComponentSource = shouldTransformViteComponentSource(
        fileName,
        componentId,
        source,
        options,
      );
      if (isAuthoredSource && !isComponentSource) {
        validateViteStandaloneAuthoringSurface(options, fileName, source);
      }
      if (!isComponentSource) return context.modules ?? [];

      const previous = compilerMapGet(hmrImpacts, fileName) ?? null;
      rememberKovoCompiledComponent(componentId);
      rememberKovoCompiledComponent(fileName);
      const forgetComponentCompile = (): void => {
        forgetKovoCompiledComponent(componentId);
        forgetKovoCompiledComponent(fileName);
      };
      let result: Awaited<ReturnType<typeof compileCachedViteComponentModule>>;
      try {
        result = await compileCachedViteComponentModule(
          compileComponentModule,
          compileCache,
          options,
          root,
          fileName,
          source,
        );
      } catch (error) {
        forgetComponentCompile();
        throw error;
      }
      const emittedFiles = snapshotViteEmittedFiles(result);
      const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
      const next = result.hmrImpact ?? null;

      if (errorDiagnostics.length > 0) {
        forgetComponentCompile();
        if (next) compilerMapSet(hmrImpacts, fileName, next);
        sendKovoHmrEvent(context.server, 'kovo:diagnostics', previous, next, {
          impact: 'diagnosticError',
          reasons: ['diagnostics'],
        });
        return [];
      }

      recordViteCompileResult(
        clientModules,
        compiledClientModules,
        cssAssetsByFileName,
        hmrImpacts,
        fileName,
        result,
        emittedFiles,
      );
      const classification = classifyViteHmrImpact(previous, next);
      const event = eventForHmrClassification(classification);
      sendKovoHmrEvent(context.server, event, previous, next, classification);
      if (classification.impact !== 'componentRefresh') {
        context.server.ws?.send({ type: 'full-reload' });
      }

      return [];
    },
  };
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

/**
 * SPEC §5.2 #3 (fixpoint / idempotency): the Kovo transform must never re-lower its own output. A
 * lowered live-region server module keeps its `component(...)` shape plus compiler-injected ABI
 * imports (`@kovojs/server/internal/escape`, `.../wire`); when two Kovo plugins are configured (an
 * app's `kovo({ app })` plus an explicit compiler plugin) the second plugin's `transform` receives
 * the FIRST plugin's emitted output (already type-stripped by Vite/esbuild, so byte-matching it is
 * not reliable). Re-lowering it would re-flag those ABI imports as KV235 (app source importing a
 * non-public subpath).
 *
 * The guard is by-construction safe (it cannot be used to bypass KV235 on authored source): a file
 * id is recorded as "cleanly compiled" ONLY after a successful authored compile, and a re-entry is
 * skipped ONLY when (a) the id is already recorded AND (b) the incoming source carries a compiler
 * ABI import — a combination that authored source cannot reach, because an authored ABI import makes
 * the FIRST compile fail KV235 (so the id is never recorded) and HMR re-edits clear the id
 * (`handleHotUpdate`) so an edit that adds an ABI import is compiled fresh and caught.
 *
 * The registry lives on `globalThis` (via `Symbol.for`) because the two Kovo plugins load this
 * module through different specifiers (`@kovojs/compiler/vite` vs a workspace relative path) and so
 * live in distinct ESM realms; only a globalThis singleton is shared across them.
 */
const KOVO_COMPILED_COMPONENT_IDS = Symbol.for('@kovojs/compiler:cleanlyCompiledComponentIds');

function kovoCompiledComponentIds(): Set<string> {
  const host = globalThis as { [KOVO_COMPILED_COMPONENT_IDS]?: Set<string> };
  return (host[KOVO_COMPILED_COMPONENT_IDS] ??= compilerCreateSet<string>());
}

function rememberKovoCompiledComponent(fileName: string): void {
  compilerSetAdd(kovoCompiledComponentIds(), fileName);
}

function forgetKovoCompiledComponent(fileName: string): void {
  compilerSetDelete(kovoCompiledComponentIds(), fileName);
}

/** A non-public Kovo ABI import (`@kovojs/<pkg>/internal|generated/…`) only emitted lowering has. */
const KOVO_ABI_IMPORT_PATTERN = /@kovojs\/[^"'\s/]+\/(?:internal|generated)\//;

function isKovoEmittedServerModuleReentry(fileName: string, source: string): boolean {
  return (
    compilerSetHas(kovoCompiledComponentIds(), fileName) &&
    compilerRegExpTest(KOVO_ABI_IMPORT_PATTERN, source)
  );
}

function transformViteCompileResult(
  clientModules: Map<string, string>,
  compiledClientModules: Map<string, KovoViteCompiledClientModule>,
  cssAssetsByFileName: Map<string, readonly ComponentCssAsset[]>,
  hmrImpacts: Map<string, HmrImpactMetadata>,
  options: KovoVitePluginOptions,
  componentId: string,
  fileName: string,
  source: string,
  result: ViteCompileResult,
): { code: string; map: null } {
  const emittedFiles = snapshotViteEmittedFiles(result);
  const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
  recordViteCompileResult(
    clientModules,
    compiledClientModules,
    cssAssetsByFileName,
    hmrImpacts,
    fileName,
    result,
    emittedFiles,
  );

  // SPEC §5.2 #3: this authored component compiled cleanly, so a later transform of its emitted
  // output (a second Kovo plugin instance) must be recognized as a re-entry and skipped.
  rememberKovoCompiledComponent(componentId);
  rememberKovoCompiledComponent(fileName);
  let serverSource: string | undefined;
  for (let index = 0; index < emittedFiles.length; index += 1) {
    if (emittedFiles[index]!.kind === 'server') {
      serverSource = emittedFiles[index]!.source;
      break;
    }
  }
  return { code: executableViteServerSource(serverSource) ?? source, map: null };
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
  return typeof (value as { then?: unknown }).then === 'function';
}

function shouldTransformViteComponentSource(
  fileName: string,
  componentId: string,
  source: string,
  options: KovoVitePluginOptions,
): boolean {
  if (!shouldTransformViteAuthoredSource(fileName, componentId, source, options)) return false;
  if (!compilerStringIncludes(source, 'component(')) return false;

  return true;
}

function shouldTransformViteAuthoredSource(
  fileName: string,
  componentId: string,
  source: string,
  options: KovoVitePluginOptions,
): boolean {
  if (!compilerRegExpTest(/\.[cm]?tsx?$/, fileName)) return false;
  if (isKovoFrameworkPackageSource(componentId)) return false;
  if (matchesAnyViteFilter(options.exclude, fileName, source)) return false;
  if (options.include !== undefined && !matchesAnyViteFilter(options.include, fileName, source))
    return false;

  return true;
}

const kovoFrameworkPackageSourceCache = compilerCreateMap<string, boolean>();

function isKovoFrameworkPackageSource(componentId: string): boolean {
  const normalized = slashPath(componentId);
  const match = compilerRegExpExec(/(^|\/)(.+\/packages\/[^/]+)\/src\//, normalized);
  const packageRoot = match?.[2];
  if (packageRoot === undefined) return false;

  const cached = compilerMapGet(kovoFrameworkPackageSourceCache, packageRoot);
  if (cached !== undefined) return cached;

  const packageJsonPath = `${packageRoot}/package.json`;
  let isFrameworkSource = false;
  try {
    if (existsSync(packageJsonPath)) {
      const parsed = compilerJsonParse(readFileSync(packageJsonPath, 'utf8'));
      const name = compilerOwnDataValue(parsed, 'name', 'Kovo framework package manifest');
      isFrameworkSource = typeof name === 'string' && compilerStringStartsWith(name, '@kovojs/');
    }
  } catch {
    isFrameworkSource = false;
  }

  compilerMapSet(kovoFrameworkPackageSourceCache, packageRoot, isFrameworkSource);
  return isFrameworkSource;
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

async function compileCachedViteComponentModule(
  compileComponentModule: (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>,
  cache: CompileCache<ViteCompileResult>,
  options: KovoVitePluginOptions,
  root: string,
  fileName: string,
  source: string,
): Promise<ViteCompileResult> {
  const queryShapeFacts = componentLocalQueryShapeFacts(
    source,
    fileName,
    resolveViteQueryShapeFacts(options, fileName),
  );
  const registryFacts = resolveViteRegistryFacts(options, fileName);
  const extraFiles = viteFrameworkIdentityFiles(root, fileName, source);
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
  if (options.cache === false) {
    return await compileComponentModule(compileOptions);
  }
  const cacheInput = compileComponentCacheKeyInput(compileOptions);
  const cacheDir = persistentCompileCacheDir(root);
  const persistent = await readPersistentCompileCacheEntryForInput<ViteCompileResult>(
    cacheDir,
    cacheInput,
  );
  if (persistent) return persistent;
  const result = await cache.getOrCreate(cacheInput, () => compileComponentModule(compileOptions));
  if (result.dependencyFootprint) {
    const cacheKey = compileCacheKey(
      compileComponentCacheKeyInput(compileOptions, result.dependencyFootprint),
    );
    await writePersistentCompileCacheEntry(cacheDir, {
      cacheKey,
      footprint: result.dependencyFootprint,
      result,
    });
  }
  return result;
}

function snapshotKovoVitePluginOptions(value: KovoVitePluginOptions): KovoVitePluginOptions {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo Vite plugin options must be an object.');
  }
  const snapshot = compilerCreateNullRecord<unknown>();
  const cache = compilerOwnDataValue(value, 'cache', 'Kovo Vite plugin options');
  if (cache !== undefined) {
    if (typeof cache !== 'boolean') {
      throw new TypeError('Kovo Vite plugin options.cache must be a boolean.');
    }
    compilerDefineOwnDataProperty(snapshot, 'cache', cache);
  }
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
  const collected = compilerCreateMap<string, { fileName: string; source: string }>();
  const visited = compilerCreateSet<string>();
  collectViteFrameworkIdentityFiles(root, fileName, source, collected, visited);
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
    const resolved = readViteRelativeSourceFile(root, fileName, specifier.specifier);
    if (!resolved) continue;
    if (!compilerMapGet(collected, resolved.fileName)) {
      compilerMapSet(collected, resolved.fileName, resolved);
    }
    collectViteFrameworkIdentityFiles(root, resolved.fileName, resolved.source, collected, visited);
  }
}

function readViteRelativeSourceFile(
  root: string,
  importerFileName: string,
  moduleSpecifier: string,
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
    if (!existsSync(candidate)) continue;
    const source = readFileSync(candidate, 'utf8');
    return { fileName: viteComponentFileName(candidate, root), source };
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
): null | string {
  const sourceFileName = viteRequestFileName(source);
  if (!compilerStringEndsWith(sourceFileName, '.client.js')) return null;
  const importerFileName = importer === undefined ? undefined : viteRequestFileName(importer);
  const candidate = isAbsolute(sourceFileName)
    ? sourceFileName
    : importerFileName
      ? resolve(dirname(importerFileName), sourceFileName)
      : resolve(root, trimLeadingSlashes(sourceFileName));
  if (!existsSync(viteClientModuleSourceFilePath(candidate))) return null;

  return candidate;
}

function loadViteClientModule(
  compileComponentModule: (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>,
  cache: CompileCache<ViteCompileResult>,
  options: KovoVitePluginOptions,
  root: string,
  id: string,
): MaybePromise<null | string> {
  const clientFilePath = viteRequestFileName(id);
  if (!compilerStringEndsWith(clientFilePath, '.client.js')) return null;

  const sourceFilePath = viteClientModuleSourceFilePath(clientFilePath);
  if (!existsSync(sourceFilePath)) return null;

  const fileName = viteComponentFileName(sourceFilePath, root);
  const componentId = viteComponentIdentity(sourceFilePath, root);
  const source = readFileSync(sourceFilePath, 'utf8');
  if (!shouldTransformViteComponentSource(fileName, componentId, source, options)) return null;

  const result = compileCachedViteComponentModule(
    compileComponentModule,
    cache,
    options,
    root,
    fileName,
    source,
  );
  if (isPromiseLike(result)) {
    return compilerPromiseThen(result, (resolvedResult) =>
      loadViteClientCompileResult(options, fileName, source, resolvedResult),
    );
  }

  return loadViteClientCompileResult(options, fileName, source, result);
}

function loadViteClientCompileResult(
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
  result: ViteCompileResult,
): null | string {
  const emittedFiles = snapshotViteEmittedFiles(result);
  const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));

  return viteClientSource(emittedFiles);
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

function recordViteCompileResult(
  clientModules: Map<string, string>,
  compiledClientModules: Map<string, KovoViteCompiledClientModule>,
  cssAssetsByFileName: Map<string, readonly ComponentCssAsset[]>,
  hmrImpacts: Map<string, HmrImpactMetadata>,
  fileName: string,
  result: ViteCompileResult,
  files: readonly { kind: string; source: string }[],
): void {
  let recordedCompiledClientModule = false;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (file.kind === 'client') {
      const href =
        result.hmrImpact?.clientHref ??
        clientModuleHrefForSourceFile(fileName, clientModuleContentVersion(file.source));
      compilerMapSet(clientModules, href, file.source);
      const productionSource = rewriteClientModuleRuntimeImportsForBrowser(file.source);

      const target = parseVersionedClientModuleTarget(href);
      if (target !== undefined) {
        compilerMapSet(clientModules, `${target.path}?v=${target.version}`, file.source);
      }

      if (result.hmrImpact?.clientHref === null || result.hmrImpact?.clientHref === undefined)
        continue;
      const url = new URL(href, 'https://kovo.local');
      const path = target?.path ?? url.pathname;
      const exportedClientMembers =
        (result.clientExports?.length ?? 0) + (result.handlerExports?.length ?? 0);
      if (exportedClientMembers === 0) continue;
      compilerMapSet(compiledClientModules, fileName, {
        path,
        ...(result.renderPlanFingerprint
          ? { renderPlanFingerprint: result.renderPlanFingerprint }
          : {}),
        source: productionSource,
        ...(target?.version === undefined ? {} : { version: target.version }),
      });
      recordedCompiledClientModule = true;
    }
  }
  if (!recordedCompiledClientModule) compilerMapDelete(compiledClientModules, fileName);

  if (result.cssAssets && result.cssAssets.length > 0) {
    compilerMapSet(cssAssetsByFileName, fileName, result.cssAssets);
  } else {
    compilerMapDelete(cssAssetsByFileName, fileName);
  }

  if (result.hmrImpact) compilerMapSet(hmrImpacts, fileName, result.hmrImpact);
  else compilerMapDelete(hmrImpacts, fileName);
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

function viteComponentIdentity(id: string, root: string): string {
  const rawFileName = viteRequestFileName(id);
  const fileName = compilerStringStartsWith(rawFileName, '/@fs/')
    ? compilerStringSlice(rawFileName, '/@fs'.length)
    : rawFileName;
  return slashPath(isAbsolute(fileName) ? fileName : resolve(root, fileName));
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
