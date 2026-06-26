import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { registerHooks } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { DiagnosticCode } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
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

/** Vite plugin object returned by {@link kovo}; placed in a `vite.config.ts` plugins array. */
export interface KovoVitePlugin {
  configResolved?(config: KovoViteResolvedConfig): void | Promise<void>;
  /** Stable plugin name used by Vite diagnostics. */
  name: 'kovo';
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
  let root = process.cwd();
  let compilerPluginPromise: Promise<KovoCompilerVitePlugin> | undefined;
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
    if (devDataPlaneDebounce) clearTimeout(devDataPlaneDebounce);
    devDataPlaneDebounce = setTimeout(() => {
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

  return {
    async configResolved(config) {
      root = config.root ?? root;
      viteCommand =
        (config as { command?: 'build' | 'serve' }).command === 'serve' ? 'serve' : 'build';
      const compiler = await compilerPlugin();
      await compiler.configResolved?.(config);
    },
    async buildStart() {
      // SPEC.md §11.4 (shared verification surface) / §10.2 / §10.3: run the data-plane safety
      // gates (KV422 SQL injection, KV410/KV411 opaque projection/read set, KV429 lost update)
      // once per project at the build hook, reusing the SAME `@kovojs/drizzle` analyzers the
      // `kovo` CLI uses (one source of truth, zero drift). Until now these gates ran ONLY via the
      // CLI over app source, so unsafe raw SQL shipped green through `vp build`.
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
      return (await compilerPlugin()).resolveId?.(source, importer) ?? null;
    },
    async load(id) {
      return (await compilerPlugin()).load?.(id) ?? null;
    },
    async transform(source, id) {
      return (await compilerPlugin()).transform?.(source, id) ?? null;
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
  } as KovoVitePlugin;
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
  extractToctouFromProject(options: {
    files: readonly DataPlaneSourceFile[];
  }): readonly ToctouFactLike[];
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
  const sourceDir = dirname(appEntryFileName(app, root));
  const files = dataPlaneSourceFiles(sourceDir, root);
  if (files.length === 0) return [];

  const drizzle = await importKovoDrizzleStaticModule();
  const raw: TouchGraphDiagnosticLike[] = [];

  // KV422 (SPEC.md §10.2/§11.2): request-derived/unproven data reaching executable SQL text.
  raw.push(...drizzle.analyzeSqlSafetyFromProject({ files }));
  // KV410/KV411 (SPEC.md §10.1/§11.4): opaque query projection / exempt-table reads.
  raw.push(...drizzle.diagnosticsForQueryFacts(drizzle.extractQueryFactsFromProject({ files })));
  // KV429 (SPEC.md §10.3/§11.1): every single-row unguarded atomic write fact is a blocking
  // lost-update error (matches `kovo check`'s graph emission, which pushes each fact as error).
  for (const fact of drizzle.extractToctouFromProject({ files })) {
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
