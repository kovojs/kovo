import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { registerHooks } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
import { isParanoidSecurityAdvisoryCode } from '@kovojs/core/internal/security-markers';
import type {
  DataPlaneDiagnostic,
  DataPlaneRuntimeRegistryFacts as RuntimeRegistryFacts,
  QueryShapeFact as CompilerQueryShapeFact,
} from '@kovojs/server/internal/data-plane-static-analysis';
import { currentKovoBuildContext } from '@kovojs/server/internal/build-context';
import { serializeRuntimeRegistryWireModule } from '@kovojs/server/internal/runtime-registry-wire';
import type { KovoAppShellViteCompilerModuleDiagnosticReport } from './vite-dev.js';

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
  const scheduleDevDataPlaneGate = async (file: string): Promise<void> => {
    if (viteCommand !== 'serve') return;
    const adapter = await importKovoDataPlaneStaticAnalysisModule();
    if (!adapter.isDataPlaneSourceFile(file, dirname(appEntryFileName(app, root)))) return;
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
      if (diagnostics.length > 0 && !paranoidDataPlaneDiagnosticsAreAdvisory(diagnostics)) {
        throw dataPlaneGateError(diagnostics);
      }
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
        return serializeRuntimeRegistryWireModule(await collectRuntimeRegistry(root, app));
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
      void scheduleDevDataPlaneGate(context.file).catch(() => {});

      const appShellResult = await appShellPlugin?.handleHotUpdate?.(context);
      if (appShellResult !== undefined) return appShellResult;

      return (await compilerPlugin()).handleHotUpdate?.(context) ?? context.modules ?? [];
    },
    name: 'kovo',
  };
  return plugin;
}

let compilerSourceResolutionHooksRegistered = false;
let dataPlaneStaticAnalysisModulePromise:
  | Promise<typeof import('@kovojs/server/internal/data-plane-static-analysis')>
  | undefined;

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

async function importKovoDataPlaneStaticAnalysisModule(): Promise<
  typeof import('@kovojs/server/internal/data-plane-static-analysis')
> {
  registerCompilerSourceResolutionHooks();
  dataPlaneStaticAnalysisModulePromise ??=
    import('@kovojs/server/internal/data-plane-static-analysis');
  return dataPlaneStaticAnalysisModulePromise;
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
// Vite dev/build and CLI build/export share resolver, cache, query-shape derivation,
// diagnostics, and the build-only query-shape bridge through the internal adapter.
// ---------------------------------------------------------------------------

/** Debounce window for the dev-mode re-evaluation; one whole-project pass per burst of edits. */
const DATA_PLANE_GATE_DEBOUNCE_MS = 200;

async function collectDataPlaneErrorDiagnostics(
  root: string,
  app: string,
): Promise<DataPlaneDiagnostic[]> {
  const adapter = await importKovoDataPlaneStaticAnalysisModule();
  return adapter.collectDataPlaneErrorDiagnostics({
    appSourceDir: dirname(appEntryFileName(app, root)),
    root,
  });
}

async function collectRuntimeRegistry(root: string, app: string): Promise<RuntimeRegistryFacts> {
  const adapter = await importKovoDataPlaneStaticAnalysisModule();
  return adapter.collectRuntimeRegistryFacts({
    appSourceDir: dirname(appEntryFileName(app, root)),
    root,
  });
}

async function collectCompilerQueryShapeFacts(
  root: string,
  app: string,
): Promise<readonly CompilerQueryShapeFact[]> {
  const adapter = await importKovoDataPlaneStaticAnalysisModule();
  if (currentKovoBuildContext()?.graphDerivation === true) {
    await adapter.collectDataPlaneAnalysis({
      appSourceDir: dirname(appEntryFileName(app, root)),
      root,
      skipStaticFacts: true,
    });
  }
  return adapter.collectCompilerQueryShapeFacts({
    appSourceDir: dirname(appEntryFileName(app, root)),
    root,
  });
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

function paranoidDataPlaneDiagnosticsAreAdvisory(
  diagnostics: readonly DataPlaneDiagnostic[],
): boolean {
  if (!isParanoidMode()) return false;
  return (
    diagnostics.length > 0 &&
    diagnostics.every((diagnostic) => isParanoidSecurityAdvisoryCode(diagnostic.code))
  );
}

function isParanoidMode(): boolean {
  const value = process.env.KOVO_PARANOID;
  return value === '1' || value === 'true';
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
