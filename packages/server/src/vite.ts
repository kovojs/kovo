// This entry is evaluated while Vite loads authored config/plugin modules. Capture the two proof
// engines it owns before the config body runs; the live SSR graph separately preloads the complete
// server profile before loading the app (SPEC §6.6 rule 6).
import '@kovojs/compiler/internal/security-bootstrap';
import { assertDataPlaneStaticAnalysisIntrinsics } from './internal/data-plane-static-analysis-intrinsics.ts';

assertDataPlaneStaticAnalysisIntrinsics();

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { extractAppRouteCssTargets } from '@kovojs/compiler/package-styles';
import type { QueryShapeFact as CompilerViteQueryShapeFact } from '@kovojs/compiler/internal';
import {
  isFrameworkKovoVitePluginOwnerForSourceRoot,
  kovoVitePlugin as createCompilerVitePlugin,
} from '@kovojs/compiler/vite';

import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
import { isParanoidSecurityAdvisoryCode } from '@kovojs/core/internal/security-markers';
/*
 * This value import is intentionally eager: authored Vite config can install node:module resolver
 * hooks, so a later dynamic import cannot own compiler/data-plane security truth (SPEC §2/§11.4).
 */
import {
  collectCompilerQueryShapeFacts as collectCompilerQueryShapeFactsAdapter,
  collectDataPlaneAnalysis as collectDataPlaneAnalysisAdapter,
  collectDataPlaneErrorDiagnostics as collectDataPlaneErrorDiagnosticsAdapter,
  collectRuntimeRegistryFacts as collectRuntimeRegistryFactsAdapter,
  isDataPlaneSourceFile,
  type DataPlaneDiagnostic,
  type DataPlaneRuntimeRegistryFacts as RuntimeRegistryFacts,
  type QueryShapeFact as DataPlaneQueryShapeFact,
} from './internal/data-plane-static-analysis.ts';
import { currentKovoBuildContext } from '@kovojs/server/internal/build-context';
import { serializeRuntimeRegistryWireModule } from '@kovojs/server/internal/runtime-registry-wire';
import {
  trustedViteSecurityProfileIntegrationSentinel,
  trustedViteSecurityProfileParanoidSentinel,
  trustedViteSecurityProfileSentinel,
} from './internal/vite-security-sentinel.ts';
import type { KovoAppShellViteCompilerModuleDiagnosticReport } from './vite-dev.js';
import {
  buildOwnDataProperty,
  buildSecurityPathDirname,
  buildSecurityPathIsAbsolute,
  buildSecurityPathRelative,
  buildSecurityPathResolve,
  buildSecuritySourceLiteral,
  commitBuildArrayValue,
  snapshotBuildArray,
} from './build-security-intrinsics.ts';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityRegExpExec,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.ts';

const viteClearTimeout = globalThis.clearTimeout;
const viteSetTimeout = globalThis.setTimeout;
const viteExistsSync = existsSync;
const viteReadFileSync = readFileSync;
const viteParanoidValue = process.env.KOVO_PARANOID;
const viteBootParanoidStaticAdvisory = viteParanoidValue === '1' || viteParanoidValue === 'true';

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
  plugins?: readonly unknown[];
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
  if (typeof options !== 'object' || options === null || securityArrayIsArray(options)) {
    throw new TypeError('kovo(...) requires an own-data options object.');
  }
  const trustedOptions = options as KovoVitePluginOptions & {
    [trustedViteSecurityProfileIntegrationSentinel]?: unknown;
    [trustedViteSecurityProfileParanoidSentinel]?: unknown;
    [trustedViteSecurityProfileSentinel]?: unknown;
  };
  const trustedProfile = buildOwnDataProperty(
    trustedOptions,
    trustedViteSecurityProfileSentinel,
    'trusted Vite security profile',
  );
  const trustedIntegration = buildOwnDataProperty(
    trustedOptions,
    trustedViteSecurityProfileIntegrationSentinel,
    'trusted Vite security profile integration',
  );
  const trustedParanoid = buildOwnDataProperty(
    trustedOptions,
    trustedViteSecurityProfileParanoidSentinel,
    'trusted Vite paranoid disposition',
  );
  const hasTrustedSecurityProfile =
    trustedProfile.present && trustedProfile.value === trustedViteSecurityProfileSentinel;
  const trustedCreateDevIntegration =
    hasTrustedSecurityProfile &&
    trustedIntegration.present &&
    typeof trustedIntegration.value === 'function'
      ? (trustedIntegration.value as typeof import('./vite-dev.js').createKovoAppShellViteDevIntegration)
      : undefined;
  const paranoidStaticAdvisory = hasTrustedSecurityProfile
    ? trustedParanoid.present && trustedParanoid.value === true
    : viteBootParanoidStaticAdvisory;
  const appProperty = buildOwnDataProperty(options, 'app', 'kovo({ app })');
  const app = authoredAppEntry(appProperty.present ? appProperty.value : undefined);
  const runtimeRegistryPublicId = `virtual:kovo-runtime-registry:${app}`;
  const runtimeRegistryResolvedId = `\0${runtimeRegistryPublicId}`;
  let root = process.cwd();
  let compilerPluginValue: KovoCompilerVitePlugin | undefined;
  let externalCompilerPlugin: KovoCompilerVitePlugin | undefined;
  let compilerQueryShapeFacts: readonly CompilerViteQueryShapeFact[] | undefined;
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
      const absFileName = slashPath(buildSecurityPathResolve(root, fileName));
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
    if (!isDataPlaneSourceFile(file, root)) {
      return;
    }
    compilerQueryShapeFacts = undefined;
    if (devDataPlaneDebounce) viteClearTimeout(devDataPlaneDebounce);
    devDataPlaneDebounce = viteSetTimeout(() => {
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

  const compilerPlugin = async (): Promise<KovoCompilerVitePlugin> => {
    if (externalCompilerPlugin !== undefined) return externalCompilerPlugin;
    compilerPluginValue ??= createCompilerVitePlugin({
      include: [(fileName: string) => isAuthoredAppSourceFile(fileName, app, root)],
      onModuleDiagnostics(report: unknown) {
        onModuleDiagnostics?.(report);
      },
      queryShapeFacts() {
        return compilerQueryShapeFacts;
      },
    }) as KovoCompilerVitePlugin;
    return compilerPluginValue;
  };

  const routeTargets = async () => {
    const fileName = appEntryFileName(app, root);
    const result = extractAppRouteCssTargets({
      fileName,
      packagePrefixDiscoveryRoot: root,
      source: viteExistsSync(fileName) ? viteReadFileSync(fileName, 'utf8') : '',
    });

    return rootRelativeRouteTargets(
      result.routeTargets as readonly CssRouteSplitTarget[],
      buildSecurityPathDirname(fileName),
      root,
    );
  };

  const plugin: KovoViteRuntimePlugin = {
    enforce: 'pre',
    async configResolved(config) {
      const rootProperty = buildOwnDataProperty(config, 'root', 'Vite resolved root');
      if (rootProperty.present) {
        if (typeof rootProperty.value !== 'string') {
          throw new TypeError('Vite resolved root must be a string.');
        }
        root = rootProperty.value;
      }
      const commandProperty = buildOwnDataProperty(config, 'command', 'Vite resolved command');
      viteCommand =
        commandProperty.present && commandProperty.value === 'serve' ? 'serve' : 'build';
      externalCompilerPlugin = configuredExternalCompilerPlugin(config, plugin, app, root);
      compilerQueryShapeFacts = snapshotBuildArray(
        await collectCompilerQueryShapeFacts(root, app),
        'compiler query-shape facts',
      );
      const compiler = await compilerPlugin();
      if (externalCompilerPlugin === undefined) await compiler.configResolved?.(config);
    },
    async buildStart() {
      // SPEC.md §11.4 (shared verification surface) / §10.2 / §10.3: run the data-plane safety
      // gates (KV422 SQL injection, KV410/KV411 opaque projection/read set, KV429 lost update)
      // once per project at the build hook, reusing the SAME `@kovojs/drizzle` analyzers the
      // `kovo` CLI uses (one source of truth, zero drift). Until now these gates ran ONLY via the
      // CLI over app source, so unsafe raw SQL shipped green through `vp build`.
      compilerQueryShapeFacts = snapshotBuildArray(
        await collectCompilerQueryShapeFacts(root, app),
        'compiler query-shape facts',
      );
      if (viteCommand === 'serve') {
        // Dev disposition: surface as teaching diagnostics in the ledger; never crash HMR.
        await runDevDataPlaneGate();
        return;
      }
      // Build disposition: fail-closed — any error-severity finding fails the build.
      const diagnostics = snapshotBuildArray(
        await collectDataPlaneErrorDiagnostics(root, app),
        'data-plane build diagnostics',
      );
      if (
        diagnostics.length > 0 &&
        !paranoidDataPlaneDiagnosticsAreAdvisory(diagnostics, paranoidStaticAdvisory)
      ) {
        throw dataPlaneGateError(diagnostics);
      }
    },
    async configureServer(server: KovoViteDevServer) {
      if (server.config !== undefined) {
        const rootProperty = buildOwnDataProperty(server.config, 'root', 'Vite dev-server root');
        if (rootProperty.present) {
          if (typeof rootProperty.value !== 'string') {
            throw new TypeError('Vite dev-server root must be a string.');
          }
          root = rootProperty.value;
        }
      }
      const compiler = await compilerPlugin();
      if (externalCompilerPlugin === undefined) await compiler.configureServer?.(server);
      const appRouteTargets = await routeTargets();
      let createDevIntegration: typeof import('./vite-dev.js').createKovoAppShellViteDevIntegration;
      if (trustedCreateDevIntegration !== undefined) {
        // SPEC §6.6 rule 6: the supported CLI selects this constructor from the trusted plugin
        // profile imported before authored config evaluation. Never resolve it through the live
        // Vite graph, whose alias/plugin hooks are caller-owned.
        createDevIntegration = trustedCreateDevIntegration;
      } else {
        // Direct `kovo()` wiring is a convenience integration, not the supported security runner.
        // Preserve its graph-local constructor so existing embeddings/tests retain module identity.
        const serverModule = await server.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
        const candidate = serverModule.createKovoAppShellViteDevIntegration;
        if (typeof candidate !== 'function') {
          throw new Error(
            '@kovojs/server/internal/app-shell-vite must export createKovoAppShellViteDevIntegration.',
          );
        }
        createDevIntegration =
          candidate as typeof import('./vite-dev.js').createKovoAppShellViteDevIntegration;
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
      if (externalCompilerPlugin !== undefined) return null;
      return (await compilerPlugin()).resolveId?.(source, importer) ?? null;
    },
    async load(id) {
      if (id === runtimeRegistryResolvedId) {
        return serializeRuntimeRegistryWireModule(await collectRuntimeRegistry(root, app));
      }
      if (externalCompilerPlugin !== undefined) return null;
      return (await compilerPlugin()).load?.(id) ?? null;
    },
    async transform(source, id) {
      const transformedSource = shouldInjectRuntimeRegistryImport(root, app, id)
        ? insertAfterJsxImportSourcePragma(
            source,
            `import ${buildSecuritySourceLiteral(runtimeRegistryPublicId)};\n`,
          )
        : source;
      if (externalCompilerPlugin !== undefined) {
        return transformedSource === source ? null : { code: transformedSource, map: null };
      }
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

      if (externalCompilerPlugin !== undefined) return context.modules ?? [];
      return (await compilerPlugin()).handleHotUpdate?.(context) ?? context.modules ?? [];
    },
    name: 'kovo',
  };
  return plugin;
}

/**
 * Adopt a separately configured compiler plugin instead of compiling its output a second time,
 * but only when the compiler's private authority proves immutable hooks, whole-app-directory
 * coverage, no excludes, and resolved ordering before this app-shell plugin. Structural lookalikes,
 * custom compiler factories, narrow filters, and later plugins retain the built-in fail-closed
 * compiler (SPEC §2/§5.2/§6.6).
 */
function configuredExternalCompilerPlugin(
  config: KovoViteResolvedConfig,
  appShellPlugin: KovoViteRuntimePlugin,
  app: string,
  root: string,
): KovoCompilerVitePlugin | undefined {
  const pluginsProperty = buildOwnDataProperty(config, 'plugins', 'Vite resolved plugins');
  if (!pluginsProperty.present) return undefined;
  const plugins = snapshotBuildArray(
    pluginsProperty.value as readonly unknown[],
    'Vite resolved plugins',
  );
  const sourceRoot = authoredAppSourceRoot(app, root);
  if (sourceRoot === undefined) return undefined;
  let appShellIndex = -1;
  for (let index = 0; index < plugins.length; index += 1) {
    if (plugins[index] !== appShellPlugin) continue;
    if (appShellIndex !== -1) {
      throw new TypeError('Kovo Vite integration must appear exactly once in resolved plugins.');
    }
    appShellIndex = index;
  }
  if (appShellIndex === -1) return undefined;

  let selected: KovoCompilerVitePlugin | undefined;
  for (let index = 0; index < appShellIndex; index += 1) {
    const candidate = plugins[index];
    if (!isFrameworkKovoVitePluginOwnerForSourceRoot(candidate, sourceRoot)) continue;
    if (selected !== undefined) {
      throw new TypeError('Kovo Vite integration received multiple compiler plugin owners.');
    }
    selected = candidate as KovoCompilerVitePlugin;
  }
  return selected;
}

function authoredAppSourceRoot(app: string, root: string): string | undefined {
  const appDir = buildSecurityPathDirname(appEntryFileName(app, root));
  const relativeAppDir = slashPath(buildSecurityPathRelative(root, appDir));
  if (!relativeAppDir || securityStringStartsWith(relativeAppDir, '..')) return undefined;
  return relativeAppDir;
}

function authoredAppEntry(app: unknown): string {
  if (typeof app !== 'string' || securityStringTrim(app) === '') {
    throw new TypeError('kovo({ app }) requires an authored app entry module.');
  }
  const trimmed = securityStringTrim(app);
  const normalized = slashPath(cleanModuleId(trimmed));
  if (securityStringIncludes(normalized, '/generated/')) {
    throw new TypeError(
      'kovo({ app }) must point at an authored app entry, not an app-local generated artifact (SPEC.md §9.5).',
    );
  }
  return trimmed;
}

function appEntryFileName(app: string, root: string): string {
  const clean = cleanModuleId(app);
  if (buildSecurityPathIsAbsolute(clean)) {
    return buildSecurityPathResolve(root, securityStringSlice(clean, 1));
  }
  return buildSecurityPathResolve(root, clean);
}

function isAppEntryModuleId(id: string, app: string, root: string): boolean {
  const clean = cleanModuleId(id);
  return (
    slashPath(buildSecurityPathResolve(root, clean)) === slashPath(appEntryFileName(app, root))
  );
}

function cleanModuleId(value: string): string {
  const query = securityStringIndexOf(value, '?');
  const hash = securityStringIndexOf(value, '#');
  let end = value.length;
  if (query !== -1 && query < end) end = query;
  if (hash !== -1 && hash < end) end = hash;
  return securityStringSlice(value, 0, end);
}

function shouldInjectRuntimeRegistryImport(root: string, app: string, id: string): boolean {
  if (!isAppEntryModuleId(id, app, root)) return false;
  // SPEC.md §11.4: CLI graph derivation has its own authoritative build/check graph and only
  // loads the app definition. The runtime registry module is serialized from that graph later.
  return currentKovoBuildContext()?.graphDerivation !== true;
}

function insertAfterJsxImportSourcePragma(source: string, insertion: string): string {
  if (securityStringIncludes(source, insertion)) return source;
  const pragma = securityRegExpExec(/^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/u, source);
  if (!pragma) return `${insertion}${source}`;
  return `${securityStringSlice(source, 0, pragma[0].length)}${insertion}${securityStringSlice(source, pragma[0].length)}`;
}

function rootRelativeRouteTargets(
  targets: readonly CssRouteSplitTarget[],
  appDir: string,
  root: string,
): readonly CssRouteSplitTarget[] {
  const prefix = slashPath(buildSecurityPathRelative(root, appDir));
  if (!prefix || securityStringStartsWith(prefix, '..')) return targets;

  const normalized: CssRouteSplitTarget[] = [];
  const targetSnapshot = snapshotBuildArray(targets, 'CSS route split targets');
  for (let targetIndex = 0; targetIndex < targetSnapshot.length; targetIndex += 1) {
    const target = targetSnapshot[targetIndex]!;
    const sourceFileNames: string[] = [];
    const sourceSnapshot = snapshotBuildArray(
      target.sourceFileNames,
      'CSS route split source files',
    );
    for (let fileIndex = 0; fileIndex < sourceSnapshot.length; fileIndex += 1) {
      commitBuildArrayValue(
        sourceFileNames,
        `${prefix}/${sourceSnapshot[fileIndex]!}`,
        'CSS route split source file',
      );
    }
    commitBuildArrayValue(normalized, { ...target, sourceFileNames }, 'CSS route split target');
  }
  return normalized;
}

function isAuthoredAppSourceFile(fileName: string, app: string, root: string): boolean {
  const appDir = buildSecurityPathDirname(appEntryFileName(app, root));
  const relativeAppDir = slashPath(buildSecurityPathRelative(root, appDir));
  if (!relativeAppDir || securityStringStartsWith(relativeAppDir, '..')) {
    return securityStringStartsWith(slashPath(fileName), `${slashPath(appDir)}/`);
  }

  const normalized = slashPath(fileName);
  return (
    normalized === relativeAppDir || securityStringStartsWith(normalized, `${relativeAppDir}/`)
  );
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
  return securityStringReplaceAll(value, '\\', '/');
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
  return collectDataPlaneErrorDiagnosticsAdapter({
    appSourceDir: buildSecurityPathDirname(appEntryFileName(app, root)),
    root,
  });
}

async function collectRuntimeRegistry(root: string, app: string): Promise<RuntimeRegistryFacts> {
  return collectRuntimeRegistryFactsAdapter({
    appSourceDir: buildSecurityPathDirname(appEntryFileName(app, root)),
    root,
  });
}

async function collectCompilerQueryShapeFacts(
  root: string,
  app: string,
): Promise<readonly CompilerViteQueryShapeFact[]> {
  if (currentKovoBuildContext()?.graphDerivation === true) {
    await collectDataPlaneAnalysisAdapter({
      appSourceDir: buildSecurityPathDirname(appEntryFileName(app, root)),
      root,
      skipStaticFacts: true,
    });
  }
  return compilerViteQueryShapeFacts(
    await collectCompilerQueryShapeFactsAdapter({
      appSourceDir: buildSecurityPathDirname(appEntryFileName(app, root)),
      root,
    }),
  );
}

function compilerViteQueryShapeFacts(
  facts: readonly DataPlaneQueryShapeFact[],
): readonly CompilerViteQueryShapeFact[] {
  // The data-plane adapter has already recursively validated every JSON query shape before this
  // package boundary. Snapshot the carrier once; the cast only reconciles the duplicated compiler/
  // core recursive TypeScript aliases and does not substitute for runtime validation.
  return snapshotBuildArray(
    facts,
    'compiler Vite query-shape facts',
  ) as readonly CompilerViteQueryShapeFact[];
}

/** The fail-closed build error thrown when the gate finds error-severity data-plane diagnostics. */
function dataPlaneGateError(diagnostics: readonly DataPlaneDiagnostic[]): Error {
  const findingLines: string[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    commitBuildArrayValue(
      findingLines,
      `  ERROR ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
      'data-plane diagnostic line',
    );
  }
  const lines = [
    `Kovo data-plane safety gate failed: ${diagnostics.length} error-severity diagnostic${
      diagnostics.length === 1 ? '' : 's'
    } (SPEC.md §11.4).`,
  ];
  for (let index = 0; index < findingLines.length; index += 1) {
    commitBuildArrayValue(lines, findingLines[index]!, 'data-plane gate error line');
  }
  commitBuildArrayValue(
    lines,
    'These by-construction findings mean request-derived data could reach SQL/IO unsafely. Fix them or use the audited escape hatch (sql`...`, staticSql`...`, trustedSql(...), compareAndSet) before building.',
    'data-plane gate help line',
  );
  return new Error(securityArrayJoin(lines, '\n'));
}

function paranoidDataPlaneDiagnosticsAreAdvisory(
  diagnostics: readonly DataPlaneDiagnostic[],
  paranoidStaticAdvisory: boolean,
): boolean {
  if (!paranoidStaticAdvisory) return false;
  if (diagnostics.length === 0) return false;
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    const code = buildOwnDataProperty(diagnostic, 'code', 'data-plane diagnostic code');
    if (
      !code.present ||
      typeof code.value !== 'string' ||
      !isParanoidSecurityAdvisoryCode(code.value)
    ) {
      return false;
    }
  }
  return true;
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
    return viteReadFileSync(absFileName, 'utf8');
  } catch {
    return '';
  }
}
