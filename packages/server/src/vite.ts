import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { registerHooks } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import type { DiagnosticCode } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
import type { KovoAppShellViteCompilerModuleDiagnosticReport } from './vite-dev.js';

const KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL = Symbol.for('kovo.build.queryShapeFacts');

/** Options for the public Kovo Vite plugin (SPEC.md §9.5). */
export interface KovoVitePluginOptions {
  /** Authored app module id to load in Vite dev; it must default-export a KovoApp. */
  app: string;
}

/** Minimal Vite dev-server surface used by the Kovo plugin adapter. */
interface KovoViteDevServer {
  config?: {
    root?: string;
  };
  /** Connect-compatible middleware stack owned by Vite. */
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  /** Load an SSR module through Vite's transform pipeline. */
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

/** Connect-compatible middleware installed by the Kovo Vite plugin. */
type KovoViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/** Optional post-configuration hook returned by a Vite plugin. */
type KovoVitePostHook = () => void | Promise<void>;

/** Opaque Vite plugin token returned by {@link kovo}; place it in a `vite.config.ts` plugins array. */
export interface KovoVitePlugin {
  /** Stable plugin name used by Vite diagnostics. */
  readonly name: 'kovo';
}

interface KovoViteRuntimePlugin extends KovoVitePlugin {
  buildStart?(): void | Promise<void>;
  configResolved?(config: KovoViteResolvedConfig): void | Promise<void>;
  configureServer?(
    server: KovoViteDevServer,
  ): void | KovoVitePostHook | Promise<void | KovoVitePostHook>;
  /** Run before Vite's JSX transform so the Kovo compiler sees authored TSX. */
  enforce?: 'pre';
  resolveId?(source: string, importer?: string): null | Promise<null | string> | string;
  load?(id: string): null | Promise<null | string> | string;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
}

interface KovoViteResolvedConfig {
  root?: string;
}

interface KovoViteHotUpdateContext {
  file: string;
  modules?: readonly unknown[];
  read(): Promise<string>;
  server: KovoViteDevServer;
}

interface KovoCompilerVitePlugin {
  configResolved?(config: KovoViteResolvedConfig): void | Promise<void>;
  configureServer?(server: KovoViteDevServer): void | Promise<void>;
  getCssAssetManifest?(options?: CssAssetManifestOptions): CssAssetManifest;
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
  load?(id: string): null | Promise<null | string> | string;
  resolveId?(source: string, importer?: string): null | Promise<null | string> | string;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
}

interface KovoAppShellViteDevIntegration {
  onModuleDiagnostics(report: unknown): void;
  plugin: KovoAppShellDevPlugin;
}

interface KovoAppShellDevPlugin {
  configureServer(server: KovoViteDevServer): void | KovoVitePostHook;
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
}

interface CssAssetManifestOptions {
  split?: {
    routes: readonly CssRouteSplitTarget[];
  };
}

interface CssAssetManifest {
  chunks?: CssSplitChunks;
}

interface CssRouteSplitTarget {
  fragmentTargets?: readonly string[];
  route: string;
  sourceFileNames: readonly string[];
}

interface CssSplitChunk {
  criticalCss?: string;
  href: string;
}

interface CssSplitChunks {
  base: readonly CssSplitChunk[];
  fragments: Readonly<Record<string, readonly CssSplitChunk[]>>;
  routes: Readonly<Record<string, readonly CssSplitChunk[]>>;
}

/**
 * Public Vite integration for authored Kovo apps (SPEC.md §9.5). The app entry
 * must default-export a KovoApp; generated route artifacts stay compiler-owned.
 */
export function kovo(options: KovoVitePluginOptions): KovoVitePlugin {
  const app = authoredAppEntry(options.app);
  const runtimeRegistryPublicId = `virtual:kovo-runtime-registry:${app}`;
  const runtimeRegistryResolvedId = `\0${runtimeRegistryPublicId}`;
  let root = process.cwd();
  let compilerPluginPromise: Promise<KovoCompilerVitePlugin> | undefined;
  let compilerQueryShapeFacts: readonly CompilerQueryShapeFact[] | undefined;
  let appShellPlugin: KovoAppShellDevPlugin | undefined;
  let onModuleDiagnostics: ((report: unknown) => void) | undefined;
  // SPEC.md §9.5: `serve` is the dev disposition (teaching, never fail-closed); any other
  // command is the fail-closed build path. Default to build so an unset command stays safe.
  let viteCommand: 'build' | 'serve' = 'build';
  let devDataPlaneDebounce: ReturnType<typeof setTimeout> | undefined;
  // Files for which the data-plane gate last surfaced dev teaching diagnostics, so a follow-up
  // re-evaluation can clear records for files that became clean (SPEC.md §9.5.1).
  let devDataPlaneReportedFiles = new Set<string>();

  // SPEC.md §11.4 / §10.2 / §10.3: re-run the project-level data-plane gate and surface its
  // findings as dev teaching diagnostics in the existing ledger. Never throws — dev must not
  // crash HMR. Records are keyed per file so a later clean run clears the prior teaching page.
  const runDevDataPlaneGate = async (): Promise<void> => {
    const emit = onModuleDiagnostics;
    if (!emit) return;
    let diagnostics: readonly DataPlaneDiagnostic[];
    try {
      diagnostics = await collectDataPlaneErrorDiagnostics(root, app);
    } catch {
      // A transient analyzer/parse failure must not take down the dev server.
      return;
    }

    const byFile = new Map<string, DataPlaneDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const bucket = byFile.get(diagnostic.fileName);
      if (bucket) bucket.push(diagnostic);
      else byFile.set(diagnostic.fileName, [diagnostic]);
    }

    const reportedNow = new Set<string>();
    for (const [fileName, fileDiagnostics] of byFile) {
      const absFileName = slashPath(resolve(root, fileName));
      reportedNow.add(absFileName);
      emit(dataPlaneLedgerReport(absFileName, fileDiagnostics));
    }
    for (const absFileName of devDataPlaneReportedFiles) {
      if (reportedNow.has(absFileName)) continue;
      // Clear the prior teaching record for a file that is now clean.
      emit({ diagnostics: [], fileName: absFileName, source: readSourceSafe(absFileName) });
    }
    devDataPlaneReportedFiles = reportedNow;
  };

  // SPEC.md §11.4: re-run the whole-project gate at most once per debounce window when an app
  // data-plane source file changes — never on every per-file transform/HMR keystroke.
  const scheduleDevDataPlaneGate = (file: string): void => {
    if (viteCommand !== 'serve') return;
    if (!isDataPlaneSourceFile(file, app, root)) return;
    compilerQueryShapeFacts = undefined;
    if (devDataPlaneDebounce) clearTimeout(devDataPlaneDebounce);
    devDataPlaneDebounce = setTimeout(() => {
      void collectCompilerQueryShapeFacts(root, app)
        .then((facts) => {
          compilerQueryShapeFacts = facts;
        })
        .catch(() => {
          compilerQueryShapeFacts = [];
        });
      void runDevDataPlaneGate();
    }, DATA_PLANE_GATE_DEBOUNCE_MS);
    devDataPlaneDebounce.unref?.();
  };

  const compilerPlugin = () => {
    compilerPluginPromise ??= importKovoCompilerViteModule().then((module) => {
      if (typeof module.kovoVitePlugin !== 'function') {
        throw new Error('@kovojs/compiler/vite must export kovoVitePlugin.');
      }

      return module.kovoVitePlugin({
        include: [(fileName: string) => isAuthoredAppSourceFile(fileName, app, root)],
        onModuleDiagnostics(report: unknown) {
          onModuleDiagnostics?.(report);
        },
        queryShapeFacts() {
          return compilerQueryShapeFacts;
        },
      }) as KovoCompilerVitePlugin;
    });

    return compilerPluginPromise;
  };

  const routeTargets = async () => {
    const module = await importKovoCompilerPackageStylesModule();
    if (typeof module.extractAppRouteCssTargets !== 'function') {
      throw new Error('@kovojs/compiler/package-styles must export extractAppRouteCssTargets.');
    }

    const fileName = appEntryFileName(app, root);
    const result = module.extractAppRouteCssTargets({
      fileName,
      packagePrefixDiscoveryRoot: root,
      source: existsSync(fileName) ? readFileSync(fileName, 'utf8') : '',
    });

    return rootRelativeRouteTargets(
      result.routeTargets as readonly CssRouteSplitTarget[],
      dirname(fileName),
      root,
    );
  };

  const plugin: KovoViteRuntimePlugin = {
    enforce: 'pre',
    async configResolved(config) {
      root = config.root ?? root;
      viteCommand =
        (config as { command?: 'build' | 'serve' }).command === 'serve' ? 'serve' : 'build';
      compilerQueryShapeFacts = await collectCompilerQueryShapeFacts(root, app);
      const compiler = await compilerPlugin();
      await compiler.configResolved?.(config);
    },
    async buildStart() {
      // SPEC.md §11.4 (shared verification surface) / §10.2 / §10.3: run the data-plane safety
      // gates (KV422 SQL injection, KV410/KV411 opaque projection/read set, KV429 lost update)
      // once per project at the build hook, reusing the SAME `@kovojs/drizzle` analyzers the
      // `kovo` CLI uses (one source of truth, zero drift). Until now these gates ran ONLY via the
      // CLI over app source, so unsafe raw SQL shipped green through `vp build`.
      compilerQueryShapeFacts = await collectCompilerQueryShapeFacts(root, app);
      if (viteCommand === 'serve') {
        // Dev disposition: surface as teaching diagnostics in the ledger; never crash HMR.
        await runDevDataPlaneGate();
        return;
      }
      // Build disposition: fail-closed — any error-severity finding fails the build.
      const diagnostics = await collectDataPlaneErrorDiagnostics(root, app);
      if (diagnostics.length > 0) throw dataPlaneGateError(diagnostics);
    },
    async configureServer(server: KovoViteDevServer) {
      root = server.config?.root ?? root;
      const compiler = await compilerPlugin();
      await compiler.configureServer?.(server);
      const appRouteTargets = await routeTargets();
      const serverModule = await server.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
      const createDevIntegration = serverModule.createKovoAppShellViteDevIntegration;
      if (typeof createDevIntegration !== 'function') {
        throw new Error(
          '@kovojs/server/internal/app-shell-vite must export createKovoAppShellViteDevIntegration.',
        );
      }

      const integration = createDevIntegration({
        earlyHints: false,
        moduleId: app,
        stylesheetAssets: () =>
          stylesheetAssetsFromCssSplitChunks(
            compiler.getCssAssetManifest?.(
              appRouteTargets.length === 0 ? undefined : { split: { routes: appRouteTargets } },
            ).chunks,
          ),
      }) as KovoAppShellViteDevIntegration;

      onModuleDiagnostics =
        typeof integration.onModuleDiagnostics === 'function'
          ? integration.onModuleDiagnostics.bind(integration)
          : undefined;
      appShellPlugin = integration.plugin;

      return integration.plugin.configureServer(server);
    },
    async resolveId(source, importer) {
      if (source === runtimeRegistryPublicId) return runtimeRegistryResolvedId;
      return (await compilerPlugin()).resolveId?.(source, importer) ?? null;
    },
    async load(id) {
      if (id === runtimeRegistryResolvedId) {
        return serializeRuntimeRegistryModule(await collectRuntimeRegistry(root, app));
      }
      return (await compilerPlugin()).load?.(id) ?? null;
    },
    async transform(source, id) {
      const transformedSource = isAppEntryModuleId(id, app, root)
        ? insertAfterJsxImportSourcePragma(
            source,
            `import ${JSON.stringify(runtimeRegistryPublicId)};\n`,
          )
        : source;
      const transformed = await (await compilerPlugin()).transform?.(transformedSource, id);
      if (transformed !== null && transformed !== undefined) return transformed;
      if (transformedSource !== source) return { code: transformedSource, map: null };
      return null;
    },
    async handleHotUpdate(context) {
      // SPEC.md §9.5.1 / §11.4: an app data-plane file changed — re-run the project-level gate
      // (debounced) so dev teaching diagnostics stay current without per-keystroke analysis.
      scheduleDevDataPlaneGate(context.file);

      const appShellResult = await appShellPlugin?.handleHotUpdate?.(context);
      if (appShellResult !== undefined) return appShellResult;

      return (await compilerPlugin()).handleHotUpdate?.(context) ?? context.modules ?? [];
    },
    name: 'kovo',
  };
  return plugin;
}

let compilerSourceResolutionHooksRegistered = false;

function authoredAppEntry(app: string): string {
  if (typeof app !== 'string' || app.trim() === '') {
    throw new TypeError('kovo({ app }) requires an authored app entry module.');
  }
  const normalized = app.trim().split('?')[0]?.replaceAll('\\', '/') ?? '';
  if (normalized.includes('/generated/')) {
    throw new TypeError(
      'kovo({ app }) must point at an authored app entry, not an app-local generated artifact (SPEC.md §9.5).',
    );
  }
  return app.trim();
}

function appEntryFileName(app: string, root: string): string {
  const clean = app.split(/[?#]/, 1)[0] ?? app;
  if (isAbsolute(clean)) return resolve(root, clean.slice(1));
  return resolve(root, clean);
}

function isAppEntryModuleId(id: string, app: string, root: string): boolean {
  const clean = id.split(/[?#]/, 1)[0] ?? id;
  return slashPath(resolve(root, clean)) === slashPath(appEntryFileName(app, root));
}

function insertAfterJsxImportSourcePragma(source: string, insertion: string): string {
  if (source.includes(insertion)) return source;
  const pragma = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  if (!pragma) return `${insertion}${source}`;
  return `${source.slice(0, pragma[0].length)}${insertion}${source.slice(pragma[0].length)}`;
}

function rootRelativeRouteTargets(
  targets: readonly CssRouteSplitTarget[],
  appDir: string,
  root: string,
): readonly CssRouteSplitTarget[] {
  const prefix = slashPath(relative(root, appDir));
  if (!prefix || prefix.startsWith('..')) return targets;

  return targets.map((target) => ({
    ...target,
    sourceFileNames: target.sourceFileNames.map((fileName) => `${prefix}/${fileName}`),
  }));
}

function isAuthoredAppSourceFile(fileName: string, app: string, root: string): boolean {
  const appDir = dirname(appEntryFileName(app, root));
  const relativeAppDir = slashPath(relative(root, appDir));
  if (!relativeAppDir || relativeAppDir.startsWith('..')) {
    return slashPath(fileName).startsWith(`${slashPath(appDir)}/`);
  }

  const normalized = slashPath(fileName);
  return normalized === relativeAppDir || normalized.startsWith(`${relativeAppDir}/`);
}

function stylesheetAssetsFromCssSplitChunks(chunks: CssSplitChunks | undefined):
  | {
      app: readonly StylesheetAsset[];
      fragments: Readonly<Record<string, readonly StylesheetAsset[]>>;
      routes: Readonly<Record<string, readonly StylesheetAsset[]>>;
    }
  | undefined {
  if (!chunks) return undefined;

  return {
    app: stylesheetAssetsFromCssSplitChunkList(chunks.base),
    fragments: Object.fromEntries(
      Object.entries(chunks.fragments).map(([fragment, assets]) => [
        fragment,
        stylesheetAssetsFromCssSplitChunkList(assets),
      ]),
    ),
    routes: Object.fromEntries(
      Object.entries(chunks.routes).map(([route, assets]) => [
        route,
        stylesheetAssetsFromCssSplitChunkList(assets),
      ]),
    ),
  };
}

function stylesheetAssetsFromCssSplitChunkList(
  chunks: readonly CssSplitChunk[],
): readonly StylesheetAsset[] {
  return chunks.flatMap((chunk) =>
    chunk.criticalCss ? [{ criticalCss: chunk.criticalCss, href: chunk.href }] : [],
  );
}

function slashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

async function importKovoCompilerViteModule(): Promise<Record<string, unknown>> {
  registerCompilerSourceResolutionHooks();
  try {
    return await importOptionalModule('@kovojs/compiler/vite');
  } catch (error) {
    const workspaceSource = new URL('../../compiler/src/vite-config.ts', import.meta.url);
    if (existsSync(workspaceSource)) return await importOptionalModule(workspaceSource.href);
    throw missingCompilerError(error);
  }
}

async function importKovoCompilerPackageStylesModule(): Promise<Record<string, unknown>> {
  registerCompilerSourceResolutionHooks();
  try {
    return await importOptionalModule('@kovojs/compiler/package-styles');
  } catch (error) {
    const workspaceSource = new URL('../../compiler/src/package-styles.ts', import.meta.url);
    if (existsSync(workspaceSource)) return await importOptionalModule(workspaceSource.href);
    throw missingCompilerError(error);
  }
}

async function importOptionalModule(specifier: string): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

function registerCompilerSourceResolutionHooks(): void {
  if (compilerSourceResolutionHooksRegistered) return;
  compilerSourceResolutionHooksRegistered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }

      return nextResolve(specifier, context);
    },
  });
}

function missingCompilerError(cause: unknown): Error {
  return new Error(
    'kovo({ app }) requires @kovojs/compiler to be installed so Vite can lower components and collect route CSS.',
    { cause },
  );
}

// ---------------------------------------------------------------------------
// Project-level data-plane safety gate (SPEC.md §11.4 / §10.2 / §10.3 / §9.5.1)
//
// The per-module component compiler runs on `transform`; the data-plane static analyzers
// (KV422 SQL injection, KV410/KV411 opaque projection/read set, KV429 lost update) are
// project-wide and therefore ran ONLY via the `kovo` CLI. Wiring them into the default Vite
// build (`buildStart`) closes that gap so unsafe raw SQL/IO cannot ship green. The analyzers
// here are the EXACT functions the CLI calls (`@kovojs/drizzle/internal/static`), so there is
// one source of truth and zero drift between `kovo` and `vp build`.
// ---------------------------------------------------------------------------

/** Debounce window for the dev-mode re-evaluation; one whole-project pass per burst of edits. */
const DATA_PLANE_GATE_DEBOUNCE_MS = 200;

/** Structural view of a `@kovojs/drizzle` `SourceFileInput` (only the fields the gate sets). */
interface DataPlaneSourceFile {
  fileName: string;
  source: string;
}

/** Normalized error-severity finding from the data-plane analyzers. */
interface DataPlaneDiagnostic {
  code: DiagnosticCode;
  fileName: string;
  line: number;
  message: string;
  site: string;
}

interface RuntimeQueryFactLike {
  reads: readonly string[];
  query: string;
}

type CompilerQueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | readonly CompilerQueryShape[]
  | {
      readonly [key: string]: CompilerQueryShape;
    }
  | {
      kind: 'nullable' | 'optional' | 'secret' | 'volatile-time';
      shape: CompilerQueryShape;
    }
  | {
      kind: 'table-row';
      shape: CompilerQueryShape;
      table: string;
    }
  | {
      kind: 'revealed';
      reveal: unknown;
      shape: CompilerQueryShape;
    };

interface CompilerQueryShapeFact {
  query: string;
  shape: CompilerQueryShape;
  source: string;
}

interface RuntimeQueryShapeFactLike {
  query: string;
  shape: unknown;
  source?: string;
  site?: string;
}

interface RuntimeMutationTouchSiteLike {
  crossTable?: true;
  domain: string;
  keys: null | string;
}

interface RuntimeRegistryFacts {
  mutationTouches: Readonly<Record<string, readonly RuntimeMutationTouchSiteLike[]>>;
  queryReads: readonly {
    domains: readonly string[];
    query: string;
  }[];
}

/** Structural shape of a `@kovojs/drizzle` touch-graph diagnostic (KV422/KV410/KV411). */
interface TouchGraphDiagnosticLike {
  code: string;
  message: string;
  severity?: string;
  site: string;
}

/** Structural shape of a `@kovojs/drizzle` KV429 lost-update (TOCTOU) fact. */
interface ToctouFactLike {
  column: string;
  name?: string;
  site: string;
  table: string;
}

/** Structural view of the `@kovojs/drizzle/internal/static` analyzer surface the gate reuses. */
interface KovoDrizzleStaticModule {
  analyzeSqlSafetyFromProject(options: {
    files: readonly DataPlaneSourceFile[];
  }): readonly TouchGraphDiagnosticLike[];
  diagnosticsForQueryFacts(facts: readonly unknown[]): readonly TouchGraphDiagnosticLike[];
  extractQueryFactsFromProject(options: {
    files: readonly DataPlaneSourceFile[];
  }): readonly unknown[];
  extractTouchGraphFromProject(options: { files: readonly DataPlaneSourceFile[] }): unknown;
  extractToctouFromProject(options: {
    files: readonly DataPlaneSourceFile[];
  }): readonly ToctouFactLike[];
  extractStaticBuildAnalysisFactsFromProject?(options: {
    files: readonly DataPlaneSourceFile[];
  }): StaticBuildAnalysisFactsLike;
  deriveMutationTouchRegistry(options: {
    mutations: readonly { mutation: string; touchGraphKey: string }[];
    touchGraph: unknown;
  }): Readonly<Record<string, readonly RuntimeMutationTouchSiteLike[]>>;
}

interface StaticBuildAnalysisFactsLike {
  queries: readonly unknown[];
  sqlSafetyDiagnostics: readonly TouchGraphDiagnosticLike[];
  toctouFacts: readonly ToctouFactLike[];
  touchGraph: unknown;
}

interface DataPlaneAnalysis {
  files: readonly DataPlaneSourceFile[];
  outputQueryShapeFacts: readonly CompilerQueryShapeFact[];
  staticFacts: StaticBuildAnalysisFactsLike;
}

const OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND = 'kovo.output-schema-query-shape';

interface OutputSchemaQueryShapeWorkerData {
  files: readonly DataPlaneSourceFile[];
  kind: typeof OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND;
}

/**
 * Load the project-level data-plane analyzers. Mirrors the compiler import: prefer the published
 * `@kovojs/drizzle/internal/static` entry, fall back to the in-repo source so the monorepo build
 * works before packages are packed.
 */
async function importKovoDrizzleStaticModule(): Promise<KovoDrizzleStaticModule> {
  registerCompilerSourceResolutionHooks();
  try {
    return (await importOptionalModule(
      '@kovojs/drizzle/internal/static',
    )) as unknown as KovoDrizzleStaticModule;
  } catch (error) {
    const workspaceSource = new URL('../../drizzle/src/static.ts', import.meta.url);
    if (existsSync(workspaceSource)) {
      return (await importOptionalModule(
        workspaceSource.href,
      )) as unknown as KovoDrizzleStaticModule;
    }
    throw missingDrizzleError(error);
  }
}

function missingDrizzleError(cause: unknown): Error {
  return new Error(
    'kovo({ app }) requires @kovojs/drizzle to be installed so Vite can run the data-plane safety gates (KV422/KV410/KV411/KV429).',
    { cause },
  );
}

/**
 * Run the project-level data-plane analyzers over the app source tree and return the
 * error-severity findings (SPEC.md §11.4). Empty when the source root is absent or clean.
 */
async function collectDataPlaneErrorDiagnostics(
  root: string,
  app: string,
): Promise<DataPlaneDiagnostic[]> {
  const analysis = await collectDataPlaneAnalysis(root, app);
  if (analysis.files.length === 0) return [];
  const raw: TouchGraphDiagnosticLike[] = [];

  // KV422 (SPEC.md §10.2/§11.2): request-derived/unproven data reaching executable SQL text.
  raw.push(...analysis.staticFacts.sqlSafetyDiagnostics);
  // KV410/KV411 (SPEC.md §10.1/§11.4): opaque query projection / exempt-table reads.
  // Included in the aggregate `sqlSafetyDiagnostics` above.
  // KV429 (SPEC.md §10.3/§11.1): every single-row unguarded atomic write fact is a blocking
  // lost-update error (matches `kovo check`'s graph emission, which pushes each fact as error).
  for (const fact of analysis.staticFacts.toctouFacts) {
    raw.push({
      code: 'KV429',
      message: `${diagnosticDefinitions.KV429.message} ${fact.name ?? '<anonymous>'} writes ${fact.table}.${fact.column} without a compare-and-set/version guard.`,
      severity: 'error',
      site: fact.site,
    });
  }

  return raw
    .filter((diagnostic): diagnostic is TouchGraphDiagnosticLike & { code: DiagnosticCode } => {
      // KV422/KV410/KV411/KV429 are error-severity; default to error when severity is absent.
      return (diagnostic.severity ?? 'error') === 'error';
    })
    .map((diagnostic) => {
      const { fileName, line } = parseDiagnosticSite(diagnostic.site);
      return {
        code: diagnostic.code,
        fileName,
        line,
        message: diagnostic.message,
        site: diagnostic.site,
      } satisfies DataPlaneDiagnostic;
    })
    .sort((left, right) => left.site.localeCompare(right.site));
}

async function collectRuntimeRegistry(root: string, app: string): Promise<RuntimeRegistryFacts> {
  const analysis = await collectDataPlaneAnalysis(root, app);
  if (analysis.files.length === 0) return { mutationTouches: {}, queryReads: [] };

  const drizzle = await importKovoDrizzleStaticModule();
  const queryReads = runtimeQueryReads(analysis.staticFacts.queries);
  const touchGraph = analysis.staticFacts.touchGraph;
  const touchGraphKeys =
    touchGraph && typeof touchGraph === 'object' && !Array.isArray(touchGraph)
      ? Object.keys(touchGraph)
      : [];
  const mutationTouches =
    touchGraphKeys.length === 0
      ? {}
      : drizzle.deriveMutationTouchRegistry({
          mutations: touchGraphKeys.sort().map((key) => ({
            mutation: key,
            touchGraphKey: key,
          })),
          touchGraph,
        });

  return { mutationTouches, queryReads };
}

async function collectCompilerQueryShapeFacts(
  root: string,
  app: string,
): Promise<readonly CompilerQueryShapeFact[]> {
  const buildSeed = seededBuildCompilerQueryShapeFacts();
  if (buildSeed !== undefined) return buildSeed;

  const analysis = await collectDataPlaneAnalysis(root, app);
  if (analysis.files.length === 0) return [];

  const drizzleFacts = compilerQueryShapeFacts(analysis.staticFacts.queries);
  const outputFactsByQuery = new Map(
    analysis.outputQueryShapeFacts.map((fact) => [fact.query, fact]),
  );
  const drizzleQueries = new Set(drizzleFacts.map((fact) => fact.query));
  const mergedDrizzleFacts = drizzleFacts.map((fact) =>
    mergeCompilerQueryShapeFact(fact, outputFactsByQuery.get(fact.query)),
  );
  const outputOnlyFacts = analysis.outputQueryShapeFacts.filter(
    (fact) => !drizzleQueries.has(fact.query),
  );
  return [...mergedDrizzleFacts, ...outputOnlyFacts].sort(
    (left, right) =>
      left.query.localeCompare(right.query) || left.source.localeCompare(right.source),
  );
}

function seededBuildCompilerQueryShapeFacts(): readonly CompilerQueryShapeFact[] | undefined {
  const value = (globalThis as Record<symbol, unknown>)[KOVO_BUILD_QUERY_SHAPE_FACTS_GLOBAL];
  if (value === undefined) return undefined;
  // `kovo build` already ran the authoritative static analysis. Reuse that build-only
  // seed for app-authored Vite configs so artifact compilation cannot silently fall
  // back to an empty query-shape set (SPEC §5.2 / §10.2).
  return Array.isArray(value) ? compilerQueryShapeFacts(value) : [];
}

function mergeCompilerQueryShapeFact(
  staticFact: CompilerQueryShapeFact,
  outputFact: CompilerQueryShapeFact | undefined,
): CompilerQueryShapeFact {
  if (!outputFact) return staticFact;
  const shape = mergeCompilerQueryShapes(staticFact.shape, outputFact.shape);
  return {
    ...staticFact,
    shape,
    source: `${staticFact.source}; output ${outputFact.source}`,
  };
}

function mergeCompilerQueryShapes(
  staticShape: CompilerQueryShape,
  outputShape: CompilerQueryShape,
): CompilerQueryShape {
  if (Array.isArray(staticShape) && Array.isArray(outputShape)) {
    const staticItem = staticShape[0];
    const outputItem = outputShape[0];
    return staticItem && outputItem
      ? [mergeCompilerQueryShapes(staticItem, outputItem)]
      : staticShape;
  }

  if (isPlainCompilerShapeObject(staticShape) && isPlainCompilerShapeObject(outputShape)) {
    const merged: Record<string, CompilerQueryShape> = { ...outputShape };
    for (const [key, value] of Object.entries(staticShape)) {
      const outputValue = outputShape[key];
      merged[key] = outputValue ? mergeCompilerQueryShapes(value, outputValue) : value;
    }
    return merged;
  }

  return staticShape;
}

function isPlainCompilerShapeObject(
  shape: CompilerQueryShape,
): shape is Record<string, CompilerQueryShape> {
  return typeof shape === 'object' && shape !== null && !Array.isArray(shape) && !('kind' in shape);
}

const dataPlaneAnalysisCache = new Map<string, Promise<DataPlaneAnalysis>>();

async function collectDataPlaneAnalysis(root: string, app: string): Promise<DataPlaneAnalysis> {
  // plans/fast-kovo-check2.md (#A dedup): while the `kovo` CLI is only loading app source through a
  // throwaway dev server to derive the build graph (KOVO_BUILD_GRAPH_DERIVATION=1), skip the
  // whole-project Drizzle data-plane analysis. The CLI runs the authoritative security analysis
  // itself in runKovoBuildCheckPreflight, but graph derivation still transforms authored components
  // and therefore still needs declared `output:` query-shape facts for §6.2/§10.2 binding
  // validation. Keep the expensive static pass skipped while retaining the cheap source scan.
  if (process.env.KOVO_BUILD_GRAPH_DERIVATION === '1') {
    const sourceDir = dirname(appEntryFileName(app, root));
    const files = dataPlaneSourceFiles(sourceDir, root);
    return {
      files,
      outputQueryShapeFacts: await outputSchemaQueryShapeFacts(files),
      staticFacts: { queries: [], sqlSafetyDiagnostics: [], toctouFacts: [], touchGraph: {} },
    };
  }
  const sourceDir = dirname(appEntryFileName(app, root));
  const files = dataPlaneSourceFiles(sourceDir, root);
  const key = dataPlaneAnalysisCacheKey(files);
  const cached = dataPlaneAnalysisCache.get(key);
  if (cached) return cached;
  const promise = createDataPlaneAnalysis(root, key, files);
  dataPlaneAnalysisCache.set(key, promise);
  return promise;
}

async function createDataPlaneAnalysis(
  root: string,
  cacheKey: string,
  files: readonly DataPlaneSourceFile[],
): Promise<DataPlaneAnalysis> {
  if (files.length === 0) {
    return {
      files,
      outputQueryShapeFacts: [],
      staticFacts: {
        queries: [],
        sqlSafetyDiagnostics: [],
        toctouFacts: [],
        touchGraph: {},
      },
    };
  }

  const cached = readCachedDataPlaneStaticFacts(root, cacheKey);
  if (cached) {
    return {
      files,
      outputQueryShapeFacts: await outputSchemaQueryShapeFacts(files),
      staticFacts: cached,
    };
  }

  const drizzle = await importKovoDrizzleStaticModule();
  const staticFacts =
    drizzle.extractStaticBuildAnalysisFactsFromProject?.({ files }) ??
    fallbackDataPlaneAnalysisFacts(drizzle, files);
  writeCachedDataPlaneStaticFacts(root, cacheKey, staticFacts);
  return {
    files,
    outputQueryShapeFacts: await outputSchemaQueryShapeFacts(files),
    staticFacts,
  };
}

function fallbackDataPlaneAnalysisFacts(
  drizzle: KovoDrizzleStaticModule,
  files: readonly DataPlaneSourceFile[],
): StaticBuildAnalysisFactsLike {
  const queries = drizzle.extractQueryFactsFromProject({ files });
  return {
    queries,
    sqlSafetyDiagnostics: [
      ...drizzle.analyzeSqlSafetyFromProject({ files }),
      ...drizzle.diagnosticsForQueryFacts(queries),
    ],
    toctouFacts: drizzle.extractToctouFromProject({ files }),
    touchGraph: drizzle.extractTouchGraphFromProject({ files }),
  };
}

const DATA_PLANE_ANALYSIS_CACHE_VERSION = '2026-06-28.fast-check.v1';

function dataPlaneAnalysisCacheKey(files: readonly DataPlaneSourceFile[]): string {
  const hash = createHash('sha256');
  hash.update(`${DATA_PLANE_ANALYSIS_CACHE_VERSION}\0`);
  hash.update(dataPlaneAnalyzerFingerprint());
  for (const file of [...files].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  )) {
    hash.update('\0file\0');
    hash.update(file.fileName);
    hash.update('\0');
    hash.update(createHash('sha256').update(file.source).digest('hex'));
  }
  return hash.digest('hex');
}

function readCachedDataPlaneStaticFacts(
  root: string,
  key: string,
): StaticBuildAnalysisFactsLike | undefined {
  try {
    const parsed = JSON.parse(readFileSync(dataPlaneStaticFactsCachePath(root, key), 'utf8'));
    return isStaticBuildAnalysisFactsLike(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedDataPlaneStaticFacts(
  root: string,
  key: string,
  facts: StaticBuildAnalysisFactsLike,
): void {
  try {
    const cachePath = dataPlaneStaticFactsCachePath(root, key);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(facts)}\n`, 'utf8');
  } catch {
    // Cache writes are best-effort; the analyzer already ran for this source snapshot.
  }
}

function dataPlaneStaticFactsCachePath(root: string, key: string): string {
  return join(root, '.kovo/cache/static-build-analysis', `vite-${key}.json`);
}

function isStaticBuildAnalysisFactsLike(value: unknown): value is StaticBuildAnalysisFactsLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.queries) &&
    Array.isArray(record.sqlSafetyDiagnostics) &&
    Array.isArray(record.toctouFacts) &&
    typeof record.touchGraph === 'object' &&
    record.touchGraph !== null &&
    !Array.isArray(record.touchGraph)
  );
}

function dataPlaneAnalyzerFingerprint(): string {
  const resolved = resolveDataPlaneAnalyzerPath();
  const packageRoot = resolved ? nearestPackageRoot(dirname(resolved)) : undefined;
  const hash = createHash('sha256');
  hash.update(resolved ?? 'unresolved');
  if (packageRoot) {
    hash.update('\0pkg\0');
    hash.update(readFileIfExists(join(packageRoot, 'package.json')));
    const srcDir = join(packageRoot, 'src');
    if (existsSync(srcDir)) {
      for (const file of sourceFilePathsUnder(srcDir)) {
        hash.update('\0src\0');
        hash.update(relative(packageRoot, file).split(/[\\/]/).join('/'));
        hash.update('\0');
        hash.update(createHash('sha256').update(readFileIfExists(file)).digest('hex'));
      }
    }
  }
  return hash.digest('hex');
}

function resolveDataPlaneAnalyzerPath(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve('@kovojs/drizzle/internal/static');
  } catch {
    return undefined;
  }
}

function nearestPackageRoot(startDir: string): string | undefined {
  for (let current = startDir; ; current = dirname(current)) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
  }
}

function sourceFilePathsUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilePathsUnder(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function readFileIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function compilerQueryShapeFacts(
  queryFacts: readonly unknown[],
): readonly CompilerQueryShapeFact[] {
  return queryFacts
    .filter(
      (
        fact,
      ): fact is RuntimeQueryShapeFactLike & { shape: CompilerQueryShape } & (
          | { site: string }
          | { source: string }
        ) => {
        const candidate = fact as RuntimeQueryShapeFactLike;
        return (
          typeof candidate.query === 'string' &&
          (typeof candidate.site === 'string' || typeof candidate.source === 'string') &&
          isCompilerQueryShape(candidate.shape) &&
          isSubstantiveCompilerQueryShape(candidate.shape)
        );
      },
    )
    .map((fact) => ({
      query: fact.query,
      shape: fact.shape,
      source: fact.source ?? fact.site ?? '<unknown>',
    }))
    .sort(
      (left, right) =>
        left.query.localeCompare(right.query) || left.source.localeCompare(right.source),
    );
}

function runtimeQueryReads(queryFacts: readonly unknown[]): RuntimeRegistryFacts['queryReads'] {
  return queryFacts
    .filter((fact): fact is RuntimeQueryFactLike => {
      const candidate = fact as RuntimeQueryFactLike;
      return (
        typeof candidate.query === 'string' &&
        Array.isArray(candidate.reads) &&
        candidate.reads.every((domain) => typeof domain === 'string') &&
        candidate.reads.length > 0
      );
    })
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }))
    .sort((left, right) => left.query.localeCompare(right.query));
}

function isCompilerQueryShape(shape: unknown): shape is CompilerQueryShape {
  if (
    shape === 'array' ||
    shape === 'boolean' ||
    shape === 'number' ||
    shape === 'object' ||
    shape === 'string'
  ) {
    return true;
  }

  if (Array.isArray(shape)) return shape.every(isCompilerQueryShape);
  if (typeof shape !== 'object' || shape === null) return false;

  if ('kind' in shape) {
    const wrapper = shape as { kind?: unknown; shape?: unknown; table?: unknown };
    if (
      wrapper.kind === 'nullable' ||
      wrapper.kind === 'optional' ||
      wrapper.kind === 'secret' ||
      wrapper.kind === 'volatile-time'
    ) {
      return isCompilerQueryShape(wrapper.shape);
    }
    if (wrapper.kind === 'table-row') {
      return typeof wrapper.table === 'string' && isCompilerQueryShape(wrapper.shape);
    }
    if (wrapper.kind === 'revealed') return isCompilerQueryShape(wrapper.shape);
    return false;
  }

  return Object.values(shape).every(isCompilerQueryShape);
}

function isSubstantiveCompilerQueryShape(shape: CompilerQueryShape): boolean {
  if (typeof shape === 'string') return shape !== 'object';
  if (Array.isArray(shape)) return shape.some(isSubstantiveCompilerQueryShape);
  if ('kind' in shape) return isSubstantiveCompilerQueryShape(shape.shape);
  return Object.keys(shape).length > 0;
}

type TypeScriptModule = typeof import('typescript');

let loadedTypeScript: TypeScriptModule | undefined;

function typeScript(): TypeScriptModule {
  loadedTypeScript ??= createRequire(import.meta.url)('typescript') as TypeScriptModule;
  return loadedTypeScript;
}

if (!isMainThread && isOutputSchemaQueryShapeWorkerData(workerData)) {
  parentPort?.postMessage(outputSchemaQueryShapeFactsSerial(workerData.files));
}

/**
 * SPEC.md §4.8/§6.2/§10.2: non-Drizzle queries with declared `output` schemas still publish
 * typed query-shape facts so KV302 binding validation checks schema fields, not loader source text.
 */
const OUTPUT_SCHEMA_WORKER_MIN_FILES = 8;
const OUTPUT_SCHEMA_WORKER_MAX_COUNT = 4;

async function outputSchemaQueryShapeFacts(
  files: readonly DataPlaneSourceFile[],
): Promise<readonly CompilerQueryShapeFact[]> {
  if (!isMainThread || files.length < OUTPUT_SCHEMA_WORKER_MIN_FILES) {
    return outputSchemaQueryShapeFactsSerial(files);
  }

  const workerCount = Math.min(
    files.length,
    OUTPUT_SCHEMA_WORKER_MAX_COUNT,
    Math.max(1, availableParallelism() - 1),
  );
  if (workerCount <= 1) return outputSchemaQueryShapeFactsSerial(files);

  const chunks = Array.from({ length: workerCount }, () => [] as DataPlaneSourceFile[]);
  for (const [index, file] of files.entries()) {
    chunks[index % workerCount]!.push(file);
  }

  const facts = await Promise.all(
    chunks
      .filter((chunk) => chunk.length > 0)
      .map(async (chunk) => {
        try {
          return await outputSchemaQueryShapeFactsInWorker(chunk);
        } catch (error) {
          if (process.env.KOVO_TEST_REQUIRE_OUTPUT_SCHEMA_WORKER === '1') throw error;
          return outputSchemaQueryShapeFactsSerial(chunk);
        }
      }),
  );
  return facts.flat();
}

function outputSchemaQueryShapeFactsSerial(
  files: readonly DataPlaneSourceFile[],
): readonly CompilerQueryShapeFact[] {
  return files.flatMap((file) => outputSchemaQueryShapeFactsFromSource(file.fileName, file.source));
}

function outputSchemaQueryShapeFactsInWorker(
  files: readonly DataPlaneSourceFile[],
): Promise<readonly CompilerQueryShapeFact[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        files,
        kind: OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND,
      } satisfies OutputSchemaQueryShapeWorkerData,
    });
    worker.once('message', (message: unknown) => {
      settled = true;
      if (isCompilerQueryShapeFactArray(message)) {
        resolve(message);
      } else {
        reject(new Error('Kovo output-schema worker returned malformed query-shape facts.'));
      }
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) {
        reject(new Error(`Kovo output-schema worker exited before returning facts, code ${code}.`));
      }
    });
  });
}

function isOutputSchemaQueryShapeWorkerData(
  value: unknown,
): value is OutputSchemaQueryShapeWorkerData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === OUTPUT_SCHEMA_QUERY_SHAPE_WORKER_KIND &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isOutputSchemaWorkerSourceFile)
  );
}

function isOutputSchemaWorkerSourceFile(value: unknown): value is DataPlaneSourceFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.fileName === 'string' && typeof candidate.source === 'string';
}

function isCompilerQueryShapeFactArray(value: unknown): value is readonly CompilerQueryShapeFact[] {
  return Array.isArray(value) && value.every(isCompilerQueryShapeFact);
}

function isCompilerQueryShapeFact(value: unknown): value is CompilerQueryShapeFact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.query === 'string' &&
    typeof candidate.source === 'string' &&
    isCompilerQueryShape(candidate.shape)
  );
}

function outputSchemaQueryShapeFactsFromSource(
  fileName: string,
  source: string,
): readonly CompilerQueryShapeFact[] {
  const ts = typeScript();
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: CompilerQueryShapeFact[] = [];

  const visit = (node: import('typescript').Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fact = outputSchemaQueryShapeFactFromVariable(ts, sourceFile, node);
      if (fact) facts.push(fact);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return facts;
}

function outputSchemaQueryShapeFactFromVariable(
  ts: TypeScriptModule,
  sourceFile: import('typescript').SourceFile,
  node: import('typescript').VariableDeclaration,
): CompilerQueryShapeFact | null {
  const initializer = unwrapTsExpression(ts, node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isQueryCallee(ts, sourceFile, initializer.expression)) return null;

  const declaration = staticQueryDeclaration(ts, node, initializer);
  if (!declaration) return null;
  const output = objectPropertyExpression(ts, declaration.definition, 'output');
  if (!output) return null;
  const shape = compilerQueryShapeFromSchemaExpression(ts, output);
  if (!shape || !isSubstantiveCompilerQueryShape(shape)) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(output.getStart(sourceFile)).line + 1;
  return {
    query: declaration.query,
    shape,
    source: `${sourceFile.fileName}:${line}`,
  };
}

function staticQueryDeclaration(
  ts: TypeScriptModule,
  node: import('typescript').VariableDeclaration,
  call: import('typescript').CallExpression,
): { definition: import('typescript').ObjectLiteralExpression; query: string } | null {
  const [firstArgument, secondArgument] = call.arguments;
  if (
    firstArgument &&
    (ts.isStringLiteralLike(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    const definition = unwrapTsExpression(ts, secondArgument);
    return definition && ts.isObjectLiteralExpression(definition)
      ? { definition, query: firstArgument.text }
      : null;
  }

  const definition = unwrapTsExpression(ts, firstArgument);
  if (!definition || !ts.isObjectLiteralExpression(definition)) return null;
  if (!ts.isIdentifier(node.name) || !isExportedVariableDeclaration(ts, node)) return null;
  return { definition, query: node.name.text };
}

function compilerQueryShapeFromSchemaExpression(
  ts: TypeScriptModule,
  expression: import('typescript').Expression,
): CompilerQueryShape | null {
  const current = unwrapTsExpression(ts, expression);
  if (!current) return null;
  if (ts.isCallExpression(current)) {
    return compilerQueryShapeFromSchemaCall(ts, current);
  }
  if (ts.isPropertyAccessExpression(current)) {
    const receiverShape = compilerQueryShapeFromSchemaExpression(ts, current.expression);
    if (!receiverShape) return null;
    if (current.name.text === 'optional') return { kind: 'optional', shape: receiverShape };
    if (current.name.text === 'nullable' || current.name.text === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }
  return null;
}

function compilerQueryShapeFromSchemaCall(
  ts: TypeScriptModule,
  call: import('typescript').CallExpression,
): CompilerQueryShape | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;

  const receiver = callee.expression;
  const method = callee.name.text;
  const receiverShape = compilerQueryShapeFromSchemaExpression(ts, receiver);

  if (receiverShape) {
    if (method === 'optional') return { kind: 'optional', shape: receiverShape };
    if (method === 'nullable' || method === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }

  if (!ts.isIdentifier(receiver) || receiver.text !== 's') return null;
  switch (method) {
    case 'array': {
      const item = call.arguments[0];
      const itemShape = item ? compilerQueryShapeFromSchemaExpression(ts, item) : null;
      return [itemShape ?? 'object'];
    }
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'object': {
      const shapeArg = call.arguments[0];
      if (!shapeArg) return {};
      const object = unwrapTsExpression(ts, shapeArg);
      if (!object || !ts.isObjectLiteralExpression(object)) return 'object';
      return compilerQueryShapeFromSchemaObject(ts, object);
    }
    case 'string':
    case 'enum':
      return 'string';
    default:
      return null;
  }
}

function compilerQueryShapeFromSchemaObject(
  ts: TypeScriptModule,
  object: import('typescript').ObjectLiteralExpression,
): CompilerQueryShape {
  const shape: Record<string, CompilerQueryShape> = {};
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(ts, property.name);
    if (!name) continue;
    const child = compilerQueryShapeFromSchemaExpression(ts, property.initializer);
    if (child) shape[name] = child;
  }
  return shape;
}

function objectPropertyExpression(
  ts: TypeScriptModule,
  object: import('typescript').ObjectLiteralExpression,
  propertyName: string,
): import('typescript').Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(ts, property.name) === propertyName) return property.initializer;
  }
  return null;
}

function propertyNameText(
  ts: TypeScriptModule,
  name: import('typescript').PropertyName,
): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isQueryCallee(
  ts: TypeScriptModule,
  sourceFile: import('typescript').SourceFile,
  expression: import('typescript').Expression,
): boolean {
  const queryBindings = kovoServerQueryBindings(ts, sourceFile);
  if (ts.isIdentifier(expression)) return queryBindings.identifiers.has(expression.text);
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'query') {
    return (
      ts.isIdentifier(expression.expression) &&
      queryBindings.namespaces.has(expression.expression.text)
    );
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'elevated' &&
    isQueryCallee(ts, sourceFile, expression.expression)
  );
}

function kovoServerQueryBindings(
  ts: TypeScriptModule,
  sourceFile: import('typescript').SourceFile,
): { identifiers: Set<string>; namespaces: Set<string> } {
  const identifiers = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteralLike(moduleSpecifier) || moduleSpecifier.text !== '@kovojs/server') {
      continue;
    }
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'query') {
        identifiers.add(element.name.text);
      }
    }
  }

  return { identifiers, namespaces };
}

function isExportedVariableDeclaration(
  ts: TypeScriptModule,
  declaration: import('typescript').VariableDeclaration,
): boolean {
  let current: import('typescript').Node = declaration;
  while (current.parent) {
    current = current.parent;
    if (ts.isVariableStatement(current)) {
      return (
        current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false
      );
    }
  }
  return false;
}

function unwrapTsExpression(
  ts: TypeScriptModule,
  expression: import('typescript').Expression | undefined,
): import('typescript').Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function serializeRuntimeRegistryModule(registry: RuntimeRegistryFacts): string {
  return [
    `import { registerGeneratedMutationTouchRegistry, registerGeneratedQueryReadRegistry } from '@kovojs/server/internal/execution';`,
    `registerGeneratedQueryReadRegistry(${JSON.stringify(registry.queryReads)});`,
    `registerGeneratedMutationTouchRegistry(${JSON.stringify(registry.mutationTouches)});`,
    '',
  ].join('\n');
}

/** Split a `fileName:line` diagnostic site into its parts (line defaults to 1). */
function parseDiagnosticSite(site: string): { fileName: string; line: number } {
  const index = site.lastIndexOf(':');
  if (index < 0) return { fileName: site, line: 1 };
  const line = Number.parseInt(site.slice(index + 1), 10);
  return { fileName: site.slice(0, index), line: Number.isFinite(line) ? line : 1 };
}

/** The fail-closed build error thrown when the gate finds error-severity data-plane diagnostics. */
function dataPlaneGateError(diagnostics: readonly DataPlaneDiagnostic[]): Error {
  const findingLines = diagnostics.map(
    (diagnostic) => `  ERROR ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
  );
  return new Error(
    [
      `Kovo data-plane safety gate failed: ${diagnostics.length} error-severity diagnostic${
        diagnostics.length === 1 ? '' : 's'
      } (SPEC.md §11.4).`,
      ...findingLines,
      'These by-construction findings mean request-derived data could reach SQL/IO unsafely. Fix them or use the audited escape hatch (sql`...`, staticSql`...`, trustedSql(...), compareAndSet) before building.',
    ].join('\n'),
  );
}

/** Build a dev-ledger module-diagnostics report (teaching disposition) for one app file. */
function dataPlaneLedgerReport(
  absFileName: string,
  diagnostics: readonly DataPlaneDiagnostic[],
): KovoAppShellViteCompilerModuleDiagnosticReport {
  const documentDiagnostics: DiagnosticDocumentDiagnostic[] = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    fileName: absFileName,
    message: diagnostic.message,
    severity: 'error',
    start: { column: 1, line: diagnostic.line },
  }));
  return {
    diagnostics: documentDiagnostics,
    fileName: absFileName,
    source: readSourceSafe(absFileName),
  };
}

/** Read a file's source for diagnostic rendering; never throws (returns '' on failure). */
function readSourceSafe(absFileName: string): string {
  try {
    return readFileSync(absFileName, 'utf8');
  } catch {
    return '';
  }
}

/** Whether a changed file is an app data-plane source file the gate should re-evaluate. */
function isDataPlaneSourceFile(file: string, app: string, root: string): boolean {
  const normalized = slashPath(file.split(/[?#]/, 1)[0] ?? file);
  if (!/\.[cm]?tsx?$/.test(normalized)) return false;
  if (normalized.includes('.test.') || normalized.includes('.setup.')) return false;
  if (normalized.includes('/generated/')) return false;
  const sourceDir = slashPath(dirname(appEntryFileName(app, root)));
  return normalized === sourceDir || normalized.startsWith(`${sourceDir}/`);
}

/** Build the analyzer `SourceFileInput[]` for the app source tree (root-relative file names). */
function dataPlaneSourceFiles(sourceDir: string, root: string): DataPlaneSourceFile[] {
  if (!existsSync(sourceDir)) return [];
  return dataPlaneSourceFilePaths(sourceDir)
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      fileName: slashPath(relative(root, filePath)),
      source: readFileSync(filePath, 'utf8'),
    }));
}

/**
 * Recursively collect authored `.ts`/`.tsx` files under the app source tree. Generated artifacts
 * are framework-emitted (SPEC.md §5.2) and tests/setup files are excluded.
 */
function dataPlaneSourceFilePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') return [];
      return dataPlaneSourceFilePaths(path);
    }
    if (!/\.[cm]?tsx?$/.test(entry.name)) return [];
    if (entry.name.includes('.test.') || entry.name.includes('.setup.')) return [];
    return [path];
  });
}
