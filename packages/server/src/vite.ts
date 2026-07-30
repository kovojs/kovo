// This entry is evaluated while Vite loads authored config/plugin modules. Capture the two proof
// engines it owns before the config body runs; the live SSR graph separately preloads the complete
// server profile before loading the app (SPEC §6.6 rule 6).
import '@kovojs/compiler/internal/security-bootstrap';
import { assertDataPlaneStaticAnalysisIntrinsics } from './internal/data-plane-static-analysis-intrinsics.ts';

assertDataPlaneStaticAnalysisIntrinsics();

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname as pathExtname } from 'node:path';

import {
  extractAppComponentCss,
  extractAppRouteCssTargets,
  extractPackageComponentCss,
} from '@kovojs/compiler/package-styles';
import {
  bindFrameworkKovoViteDevGenerationStage,
  compilerOwnedProjectMutationRegistryFactsFromFiles,
  collectCssAssetManifest,
  type ComponentCssAsset,
  type ProjectMutationRegistryFacts,
  type QueryShapeFact as CompilerViteQueryShapeFact,
} from '@kovojs/compiler/internal';
import {
  compilerOwnedViteClientModuleRoleForPlugin,
  compilerOwnedViteDiagnosticForPlugin,
  isFrameworkKovoVitePluginOwnerForSourceRoot,
  kovoVitePlugin as createCompilerVitePlugin,
} from '@kovojs/compiler/vite';

import type { DiagnosticDocumentDiagnostic } from './document-diagnostics.js';
import type { StylesheetAsset } from './hints.js';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  deriveRegisteredDiagnostic,
  isDiagnosticCode,
} from '@kovojs/core/internal/diagnostics';
import { isParanoidSecurityAdvisoryCode } from '@kovojs/core/internal/security-markers';
/*
 * This value import is intentionally eager: authored Vite config can install node:module resolver
 * hooks, so a later dynamic import cannot own compiler/data-plane security truth (SPEC §2/§11.4).
 */
import {
  collectCompilerQueryShapeFacts as collectCompilerQueryShapeFactsAdapter,
  collectDataPlaneAnalysis as collectDataPlaneAnalysisAdapter,
  collectDataPlaneDiagnostics as collectDataPlaneDiagnosticsAdapter,
  collectRuntimeRegistryFacts as collectRuntimeRegistryFactsAdapter,
  dataPlaneSourceFiles as dataPlaneSourceFilesAdapter,
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
  trustedViteSecurityProfileResponseCookiesSentinel,
  trustedViteSecurityProfileRunnerGenerationsSentinel,
  trustedViteSecurityProfileSentinel,
} from './internal/vite-security-sentinel.ts';
import type {
  KovoAppShellViteCompilerModuleDiagnosticReport,
  KovoViteDevRunnerGenerationBroker,
  KovoViteDevRunnerGenerationModules,
} from './vite-dev.js';
import {
  compilerDiagnosticBelongsToViteHandoff,
  createCompilerClientModuleViteHandoff,
  createCompilerClientModuleViteSnapshotPreparer,
} from './compiler-client-module-provenance-vite.js';
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
  securityNumberIsInteger,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringStartsWith,
  securityStringTrim,
} from './response-security-intrinsics.ts';

const viteClearTimeout = globalThis.clearTimeout;
const viteConsole = globalThis.console;
const viteConsoleWarn = viteConsole.warn;
const viteSetTimeout = globalThis.setTimeout;
const viteExistsSync = existsSync;
const vitePathExtname = pathExtname;
const viteReadFileSync = readFileSync;
const viteReflectApply = globalThis.Reflect.apply;
const viteMaximumSafeInteger = Number.MAX_SAFE_INTEGER;
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
  environments?: Readonly<{
    ssr?: {
      runner?: {
        clearCache(): void;
        import<T = Record<string, unknown>>(id: string): Promise<T>;
      };
    };
  }>;
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
  buildStart?(this: KovoViteBuildPluginContext): void | Promise<void>;
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
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[] | undefined>;
}

interface KovoViteBuildPluginContext {
  warn(message: string): void;
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
  getClientModules?(): readonly {
    path: string;
    renderPlanFingerprint?: string;
    source: string;
  }[];
  getCssAssetManifest?(options?: CssAssetManifestOptions): CssAssetManifest;
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[] | undefined>;
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
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[] | undefined>;
}

interface CssAssetManifestOptions {
  split?: {
    baseSourceFileNames?: readonly string[];
    routes: readonly CssRouteSplitTarget[];
  };
}

interface CssAssetManifest {
  chunks?: CssSplitChunks;
  stylesheets: readonly ComponentCssAsset[];
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

interface TrustedViteRunnerGenerationIntegration extends KovoViteDevRunnerGenerationModules {
  readonly runnerGenerations: KovoViteDevRunnerGenerationBroker;
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
    [trustedViteSecurityProfileResponseCookiesSentinel]?: unknown;
    [trustedViteSecurityProfileRunnerGenerationsSentinel]?: unknown;
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
  const trustedResponseCookies = buildOwnDataProperty(
    trustedOptions,
    trustedViteSecurityProfileResponseCookiesSentinel,
    'trusted Vite response cookies',
  );
  const trustedRunnerGenerations = buildOwnDataProperty(
    trustedOptions,
    trustedViteSecurityProfileRunnerGenerationsSentinel,
    'trusted Vite runner generations',
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
  const responseSetCookieValues =
    hasTrustedSecurityProfile &&
    trustedResponseCookies.present &&
    typeof trustedResponseCookies.value === 'function'
      ? (trustedResponseCookies.value as (response: ServerResponse) => readonly string[])
      : undefined;
  const runnerGenerationIntegration =
    hasTrustedSecurityProfile && trustedRunnerGenerations.present
      ? trustedViteRunnerGenerationIntegration(trustedRunnerGenerations.value)
      : undefined;
  const runnerGenerationStage =
    runnerGenerationIntegration === undefined
      ? undefined
      : buildOwnDataProperty(
          runnerGenerationIntegration.runnerGenerations,
          'stage',
          'trusted Vite runner generation stage',
        );
  if (
    runnerGenerationStage !== undefined &&
    (!runnerGenerationStage.present || typeof runnerGenerationStage.value !== 'function')
  ) {
    throw new TypeError('Trusted Vite runner generation broker must expose stage().');
  }
  const stageCompilerGeneration =
    runnerGenerationStage === undefined
      ? undefined
      : (token: object): Promise<void> =>
          viteReflectApply(
            runnerGenerationStage.value as (...args: never[]) => Promise<void>,
            runnerGenerationIntegration!.runnerGenerations,
            [token],
          ) as Promise<void>;
  const appProperty = buildOwnDataProperty(options, 'app', 'kovo({ app })');
  const app = authoredAppEntry(appProperty.present ? appProperty.value : undefined);
  const runtimeRegistryPublicId = `virtual:kovo-runtime-registry:${app}`;
  const runtimeRegistryResolvedId = `\0${runtimeRegistryPublicId}`;
  let root = process.cwd();
  let compilerPluginValue: KovoCompilerVitePlugin | undefined;
  let externalCompilerPlugin: KovoCompilerVitePlugin | undefined;
  let compilerQueryShapeFacts: readonly CompilerViteQueryShapeFact[] | undefined;
  let compilerProjectMutationFacts: ProjectMutationRegistryFacts | undefined;
  let appShellPlugin: KovoAppShellDevPlugin | undefined;
  let onModuleDiagnostics: ((report: unknown) => void) | undefined;
  let onServerModuleDiagnostics: ((report: unknown) => void) | undefined;
  let compilerErrorDiagnosticRevision = 0;
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
    const emit = onServerModuleDiagnostics;
    if (!emit) return;
    let diagnostics: readonly DataPlaneDiagnostic[];
    try {
      diagnostics = await collectDataPlaneDiagnostics(root, app);
    } catch {
      // A transient analyzer/parse failure must not take down the dev server.
      return;
    }
    logDevDataPlaneWarnings(diagnostics);

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
    if (devDataPlaneDebounce) viteClearTimeout(devDataPlaneDebounce);
    devDataPlaneDebounce = viteSetTimeout(() => {
      void runDevDataPlaneGate();
    }, DATA_PLANE_GATE_DEBOUNCE_MS);
    devDataPlaneDebounce.unref?.();
  };

  const compilerPlugin = async (): Promise<KovoCompilerVitePlugin> => {
    if (externalCompilerPlugin !== undefined) return externalCompilerPlugin;
    if (compilerPluginValue === undefined) {
      const created = createCompilerVitePlugin({
        include: [(fileName: string) => isAuthoredAppSourceFile(fileName, app, root)],
        onModuleDiagnostics(report: unknown) {
          onModuleDiagnostics?.(report);
        },
        queryShapeFacts() {
          return compilerQueryShapeFacts;
        },
        registryFacts() {
          return compilerProjectMutationFacts;
        },
      }) as KovoCompilerVitePlugin;
      if (stageCompilerGeneration !== undefined) {
        bindFrameworkKovoViteDevGenerationStage(created, stageCompilerGeneration);
      }
      compilerPluginValue = created;
    }
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
      compilerQueryShapeFacts = snapshotBuildArray(
        await collectCompilerQueryShapeFacts(root, app),
        'compiler query-shape facts',
      );
      compilerProjectMutationFacts = collectCompilerProjectMutationFacts(root, app);
      const configuredCompiler = configuredExternalCompilerPlugin(config, plugin, app, root);
      assertExternalCompilerHasNoDerivedFacts(
        configuredCompiler,
        compilerQueryShapeFacts,
        compilerProjectMutationFacts,
      );
      externalCompilerPlugin = configuredCompiler;
      if (externalCompilerPlugin !== undefined && stageCompilerGeneration !== undefined) {
        bindFrameworkKovoViteDevGenerationStage(externalCompilerPlugin, stageCompilerGeneration);
      }
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
      compilerProjectMutationFacts = collectCompilerProjectMutationFacts(root, app);
      assertExternalCompilerHasNoDerivedFacts(
        externalCompilerPlugin,
        compilerQueryShapeFacts,
        compilerProjectMutationFacts,
      );
      if (viteCommand === 'serve') {
        // Dev disposition: surface as teaching diagnostics in the ledger; never crash HMR.
        await runDevDataPlaneGate();
        return;
      }
      // Build disposition: warnings remain visible and non-blocking; only error-severity
      // findings fail closed (SPEC §11 diagnostic severity ownership).
      const diagnostics = snapshotBuildArray(
        await collectDataPlaneDiagnostics(root, app),
        'data-plane build diagnostics',
      );
      emitBuildDataPlaneWarnings(this, diagnostics);
      const errors = dataPlaneErrorDiagnostics(diagnostics);
      if (
        errors.length > 0 &&
        !paranoidDataPlaneDiagnosticsAreAdvisory(errors, paranoidStaticAdvisory)
      ) {
        throw dataPlaneGateError(errors);
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
      const compilerProvenanceHandoff = createCompilerClientModuleViteHandoff(
        (value) => compilerOwnedViteClientModuleRoleForPlugin(compiler, value),
        (value) => compilerOwnedViteDiagnosticForPlugin(compiler, value),
      );
      const prepareCompilerClientModules = createCompilerClientModuleViteSnapshotPreparer(
        compilerProvenanceHandoff,
        () => compiler.getClientModules?.() ?? [],
      );
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
        prepareCompilerClientModules,
        ...(responseSetCookieValues === undefined ? {} : { responseSetCookieValues }),
        ...(runnerGenerationIntegration === undefined
          ? {}
          : {
              runnerGenerationModules: runnerGenerationIntegration,
              runnerGenerations: runnerGenerationIntegration.runnerGenerations,
            }),
        stylesheetSourceRoot: buildSecurityPathDirname(appEntryFileName(app, root)),
        stylesheetAssets: () =>
          stylesheetAssetsFromCssSplitChunks(
            collectDevStylesheetManifest(compiler, app, root, appRouteTargets).chunks,
          ),
      }) as KovoAppShellViteDevIntegration;

      // oxlint-disable-next-line typescript/unbound-method -- Invoked with its integration receiver through pinned Reflect.apply.
      const integrationOnModuleDiagnostics = integration.onModuleDiagnostics;
      const serverModuleDiagnosticSink =
        typeof integrationOnModuleDiagnostics !== 'function'
          ? undefined
          : (report: unknown) =>
              viteReflectApply(integrationOnModuleDiagnostics, integration, [report]);
      onServerModuleDiagnostics = serverModuleDiagnosticSink;
      onModuleDiagnostics =
        serverModuleDiagnosticSink === undefined
          ? undefined
          : (report: unknown) => {
              const adopted = adoptCompilerViteModuleDiagnosticReport(
                report,
                compilerProvenanceHandoff,
              );
              for (let index = 0; index < adopted.diagnostics.length; index += 1) {
                if (adopted.diagnostics[index]?.severity !== 'error') continue;
                compilerErrorDiagnosticRevision += 1;
                break;
              }
              serverModuleDiagnosticSink(adopted);
            };
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
      const runtimeRegistrySource = shouldInjectRuntimeRegistryImport(root, app, id)
        ? insertAfterJsxImportSourcePragma(
            source,
            `import ${buildSecuritySourceLiteral(runtimeRegistryPublicId)};\n`,
          )
        : source;
      if (externalCompilerPlugin !== undefined) {
        return runtimeRegistrySource === source ? null : { code: runtimeRegistrySource, map: null };
      }
      // SPEC §5.2/§6.2.1: app-scoped receiver lowering authenticates the exact on-disk source
      // snapshot. Keep framework-generated imports outside that proof boundary and inject them
      // only after the compiler has returned its lowered source.
      const transformed = await (await compilerPlugin()).transform?.(source, id);
      if (transformed !== null && transformed !== undefined) {
        const code =
          runtimeRegistrySource === source
            ? transformed.code
            : insertAfterJsxImportSourcePragma(
                transformed.code,
                `import ${buildSecuritySourceLiteral(runtimeRegistryPublicId)};\n`,
              );
        return code === transformed.code ? transformed : { code, map: null };
      }
      if (runtimeRegistrySource !== source) return { code: runtimeRegistrySource, map: null };
      return null;
    },
    async handleHotUpdate(context) {
      // SPEC.md §9.5.1 / §11.4: an app data-plane file changed — re-run the project-level gate
      // (debounced) so dev teaching diagnostics stay current without per-keystroke analysis.
      void scheduleDevDataPlaneGate(context.file).catch(() => {});

      // SPEC §5.2 rule 10 / §6.3: imported mutation-form authority comes from a whole-project
      // source snapshot. Refresh it before the compiler handles this update so a removed or
      // redirected export cannot retain stale positive provenance through the next HMR transform.
      if (isDataPlaneSourceFile(context.file, root)) {
        compilerProjectMutationFacts = collectCompilerProjectMutationFacts(root, app);
        compilerQueryShapeFacts = snapshotBuildArray(
          await collectCompilerQueryShapeFacts(root, app),
          'compiler query-shape facts',
        );
        assertExternalCompilerHasNoDerivedFacts(
          externalCompilerPlugin,
          compilerQueryShapeFacts,
          compilerProjectMutationFacts,
        );
      }

      // App-shell HMR owns route-shell event selection, but it must not publish the update before
      // the compiler has staged the fresh, fully assembled runner generation (SPEC §6.2.1/§9.5.1).
      const errorRevisionBeforeCompile = compilerErrorDiagnosticRevision;
      const compilerResult =
        externalCompilerPlugin === undefined
          ? await (await compilerPlugin()).handleHotUpdate?.(context)
          : undefined;
      if (compilerErrorDiagnosticRevision !== errorRevisionBeforeCompile) {
        return compilerResult ?? [];
      }
      const appShellResult = await appShellPlugin?.handleHotUpdate?.(context);
      return appShellResult ?? compilerResult ?? context.modules ?? [];
    },
    name: 'kovo',
  };
  return plugin;
}

function trustedViteRunnerGenerationIntegration(
  value: unknown,
): TrustedViteRunnerGenerationIntegration {
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) {
    throw new TypeError('Trusted Vite runner generation integration must be an object.');
  }
  const read = (key: keyof TrustedViteRunnerGenerationIntegration): unknown => {
    const property = buildOwnDataProperty(value, key, `trusted Vite runner generation ${key}`);
    if (!property.present) {
      throw new TypeError(`Trusted Vite runner generation ${key} is required.`);
    }
    return property.value;
  };
  const runnerGenerations = read('runnerGenerations');
  if (typeof runnerGenerations !== 'object' || runnerGenerations === null) {
    throw new TypeError('Trusted Vite runner generation broker must be an object.');
  }
  const appShellModuleId = read('appShellModuleId');
  const nodeDataPlaneBootstrapModuleId = read('nodeDataPlaneBootstrapModuleId');
  const securityProfileModuleId = read('securityProfileModuleId');
  const serverRootModuleId = read('serverRootModuleId');
  if (
    typeof appShellModuleId !== 'string' ||
    typeof nodeDataPlaneBootstrapModuleId !== 'string' ||
    typeof securityProfileModuleId !== 'string' ||
    typeof serverRootModuleId !== 'string'
  ) {
    throw new TypeError('Trusted Vite runner generation module ids must be strings.');
  }
  return {
    appShellModuleId,
    nodeDataPlaneBootstrapModuleId,
    runnerGenerations: runnerGenerations as KovoViteDevRunnerGenerationBroker,
    securityProfileModuleId,
    serverRootModuleId,
  };
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

/**
 * A separately configured compiler is deliberately eligible for adoption only when the server
 * derives no project facts that would change compilation. The genuine-owner proof excludes
 * app-supplied fact overrides, but it cannot retrofit server-derived query/mutation authority into
 * an already-created plugin. Refuse that split ownership instead of silently compiling with an
 * incomplete fact universe (SPEC §5.2 rule 10 / §6.6).
 */
function assertExternalCompilerHasNoDerivedFacts(
  compiler: KovoCompilerVitePlugin | undefined,
  queryShapeFacts: readonly CompilerViteQueryShapeFact[],
  projectMutationFacts: ProjectMutationRegistryFacts,
): void {
  if (compiler === undefined) return;
  const mutationBindings = snapshotBuildArray(
    projectMutationFacts.mutationBindings,
    'compiler project mutation bindings',
  );
  if (queryShapeFacts.length === 0 && mutationBindings.length === 0) return;

  throw new TypeError(
    securityArrayJoin(
      [
        'Kovo cannot adopt a separately configured compiler owner because the app shell derived project query or mutation facts that owner cannot receive safely (SPEC.md §5.2 rule 10 / §6.6).',
        `Derived facts: ${queryShapeFacts.length} query shape${queryShapeFacts.length === 1 ? '' : 's'}, ${mutationBindings.length} imported mutation binding${mutationBindings.length === 1 ? '' : 's'}.`,
        'Remove the separate @kovojs/compiler/vite plugin and let kovo({ app }) be the sole compiler owner. Do not copy these facts into authored Vite configuration; Kovo derives them from the pinned project source snapshot.',
      ],
      '\n',
    ),
  );
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

function collectDevStylesheetManifest(
  compiler: KovoCompilerVitePlugin,
  app: string,
  root: string,
  routeTargets: readonly CssRouteSplitTarget[],
): CssAssetManifest {
  const appEntry = appEntryFileName(app, root);
  const appDir = buildSecurityPathDirname(appEntry);
  const extractionOptions = {
    fileName: appEntry,
    packagePrefixDiscoveryRoot: root,
    source: viteExistsSync(appEntry) ? viteReadFileSync(appEntry, 'utf8') : '',
  };
  const appResult = extractAppComponentCss(extractionOptions);
  assertCompleteDevStylesheetExtraction('app', appResult.diagnostics);
  const packageResult = extractPackageComponentCss('@kovojs/ui', extractionOptions);
  assertCompleteDevStylesheetExtraction('@kovojs/ui', packageResult.diagnostics);

  const cssAssets: ComponentCssAsset[] = [];
  const compilerAssets = snapshotBuildArray(
    compiler.getCssAssetManifest?.().stylesheets ?? [],
    'Compiler dev stylesheet assets',
  );
  for (let index = 0; index < compilerAssets.length; index += 1) {
    commitBuildArrayValue(cssAssets, compilerAssets[index]!, 'Compiler dev stylesheet asset');
  }

  const sourcePrefix = slashPath(buildSecurityPathRelative(root, appDir));
  const appAssets = snapshotBuildArray(appResult.cssAssets, 'App dev stylesheet assets');
  for (let index = 0; index < appAssets.length; index += 1) {
    const asset = appAssets[index]!;
    const sourceFileName = sourcePrefix
      ? `${sourcePrefix}/${asset.sourceFileName}`
      : asset.sourceFileName;
    commitBuildArrayValue(
      cssAssets,
      {
        componentName: asset.componentName,
        ...(asset.criticalCss === undefined ? {} : { criticalCss: asset.criticalCss }),
        fragmentTargets: snapshotBuildArray(
          asset.fragmentTargets,
          'App dev stylesheet fragment targets',
        ),
        href: `/assets/${sourceFileName}`,
        ...(asset.preload === undefined ? {} : { preload: asset.preload }),
        sourceFileName,
        ...(asset.styleRuleUsages === undefined
          ? {}
          : {
              styleRuleUsages: snapshotBuildArray(
                asset.styleRuleUsages,
                'App dev stylesheet rule usages',
              ),
            }),
      },
      'App dev stylesheet asset',
    );
  }

  const baseSourceFileNames: string[] = [];
  const appEntryRelative = slashPath(buildSecurityPathRelative(appDir, appEntry));
  const appEntryExtension = vitePathExtname(appEntryRelative);
  const appEntryCss = `${
    sourcePrefix ? `${sourcePrefix}/` : ''
  }${securityStringSlice(appEntryRelative, 0, -appEntryExtension.length)}.css`;
  commitBuildArrayValue(baseSourceFileNames, appEntryCss, 'App entry dev stylesheet base asset');

  if (packageResult.css !== null) {
    const packageSourceFileName = '__kovo/ui.css';
    commitBuildArrayValue(
      cssAssets,
      {
        componentName: 'kovo-ui',
        criticalCss: packageResult.css,
        fragmentTargets: [],
        href: `/assets/${packageSourceFileName}`,
        sourceFileName: packageSourceFileName,
      },
      'Kovo UI dev stylesheet asset',
    );
    commitBuildArrayValue(
      baseSourceFileNames,
      packageSourceFileName,
      'Kovo UI dev stylesheet base asset',
    );
  }

  return collectCssAssetManifest(
    { cssAssets },
    {
      split: {
        baseSourceFileNames,
        routes: routeTargets,
      },
    },
  );
}

function assertCompleteDevStylesheetExtraction(
  owner: string,
  diagnostics: readonly { fileName: string; message: string }[],
): void {
  const snapshot = snapshotBuildArray(diagnostics, `${owner} dev stylesheet diagnostics`);
  if (snapshot.length === 0) return;
  const first = snapshot[0]!;
  throw new Error(
    `Kovo dev cannot serve a partially styled ${owner} surface: ${first.fileName}: ${first.message}`,
  );
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

async function collectDataPlaneDiagnostics(
  root: string,
  app: string,
): Promise<DataPlaneDiagnostic[]> {
  return collectDataPlaneDiagnosticsAdapter({
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

function collectCompilerProjectMutationFacts(
  root: string,
  app: string,
): ProjectMutationRegistryFacts {
  const appSourceDir = buildSecurityPathDirname(appEntryFileName(app, root));
  return compilerOwnedProjectMutationRegistryFactsFromFiles(
    dataPlaneSourceFilesAdapter(appSourceDir, root),
    root,
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
    assertRegisteredDiagnostic(diagnostic, `Data-plane gate diagnostics[${index}]`);
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
    assertRegisteredDiagnostic(diagnostic, `Paranoid data-plane diagnostics[${index}]`);
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

function dataPlaneErrorDiagnostics(
  diagnostics: readonly DataPlaneDiagnostic[],
): DataPlaneDiagnostic[] {
  const errors: DataPlaneDiagnostic[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    assertRegisteredDiagnostic(diagnostic, `Data-plane diagnostics[${index}]`);
    if (diagnostic.severity !== 'error') continue;
    commitBuildArrayValue(errors, diagnostic, 'data-plane error diagnostics');
  }
  return errors;
}

function emitBuildDataPlaneWarnings(
  context: KovoViteBuildPluginContext,
  diagnostics: readonly DataPlaneDiagnostic[],
): void {
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    assertRegisteredDiagnostic(diagnostic, `Data-plane build diagnostics[${index}]`);
    if (diagnostic.severity === 'error') continue;
    context.warn(dataPlaneWarningLine(diagnostic));
  }
}

function logDevDataPlaneWarnings(diagnostics: readonly DataPlaneDiagnostic[]): void {
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    assertRegisteredDiagnostic(diagnostic, `Data-plane dev diagnostics[${index}]`);
    if (diagnostic.severity === 'error') continue;
    viteReflectApply(viteConsoleWarn, viteConsole, [dataPlaneWarningLine(diagnostic)]);
  }
}

function dataPlaneWarningLine(diagnostic: DataPlaneDiagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`;
}

/**
 * Re-enroll exact standalone-compiler diagnostics in the server graph before the dev ledger sees
 * them. Structural copies never become registered diagnostics; the plugin-bound handoff must
 * authenticate each source record first.
 */
function adoptCompilerViteModuleDiagnosticReport(
  value: unknown,
  handoff: object,
): KovoAppShellViteCompilerModuleDiagnosticReport {
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) {
    throw new TypeError('Kovo Vite compiler module diagnostics must be an own-data object.');
  }
  const diagnosticsProperty = buildOwnDataProperty(
    value,
    'diagnostics',
    'Kovo Vite compiler module diagnostics',
  );
  const fileNameProperty = buildOwnDataProperty(
    value,
    'fileName',
    'Kovo Vite compiler module diagnostics',
  );
  const sourceProperty = buildOwnDataProperty(
    value,
    'source',
    'Kovo Vite compiler module diagnostics',
  );
  if (
    !diagnosticsProperty.present ||
    !fileNameProperty.present ||
    typeof fileNameProperty.value !== 'string' ||
    !sourceProperty.present ||
    typeof sourceProperty.value !== 'string'
  ) {
    throw new TypeError(
      'Kovo Vite compiler module diagnostics require own diagnostics/fileName/source fields.',
    );
  }
  const diagnostics = snapshotBuildArray(
    diagnosticsProperty.value as readonly unknown[],
    'Kovo Vite compiler module diagnostics',
  );
  const adopted: DiagnosticDocumentDiagnostic[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    commitBuildArrayValue(
      adopted,
      adoptCompilerViteDiagnostic(diagnostics[index], handoff, index),
      'Kovo Vite adopted compiler diagnostics',
    );
  }
  return {
    diagnostics: adopted,
    fileName: fileNameProperty.value,
    source: sourceProperty.value,
  };
}

function adoptCompilerViteDiagnostic(
  value: unknown,
  handoff: object,
  index: number,
): DiagnosticDocumentDiagnostic {
  compilerDiagnosticBelongsToViteHandoff(handoff, value);
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) {
    throw new TypeError(`Kovo Vite compiler diagnostics[${index}] must be an object.`);
  }
  const label = `Kovo Vite compiler diagnostics[${index}]`;
  const code = buildOwnDataProperty(value, 'code', label);
  const fileName = buildOwnDataProperty(value, 'fileName', label);
  const help = buildOwnDataProperty(value, 'help', label);
  const length = buildOwnDataProperty(value, 'length', label);
  const message = buildOwnDataProperty(value, 'message', label);
  const severity = buildOwnDataProperty(value, 'severity', label);
  const start = buildOwnDataProperty(value, 'start', label);
  if (
    !code.present ||
    !isDiagnosticCode(code.value) ||
    !fileName.present ||
    typeof fileName.value !== 'string' ||
    !message.present ||
    typeof message.value !== 'string' ||
    !severity.present ||
    (severity.value !== 'error' &&
      severity.value !== 'warn' &&
      severity.value !== 'lint' &&
      severity.value !== 'notice') ||
    (help.present && typeof help.value !== 'string') ||
    (length.present &&
      (!securityNumberIsInteger(length.value) ||
        (length.value as number) < 0 ||
        (length.value as number) > viteMaximumSafeInteger))
  ) {
    throw new TypeError(`${label} has malformed authority fields.`);
  }
  let startValue: { column: number; line: number } | undefined;
  if (start.present) {
    if (
      typeof start.value !== 'object' ||
      start.value === null ||
      securityArrayIsArray(start.value)
    ) {
      throw new TypeError(`${label}.start must be an own-data object.`);
    }
    const column = buildOwnDataProperty(start.value, 'column', `${label}.start`);
    const line = buildOwnDataProperty(start.value, 'line', `${label}.start`);
    if (
      !column.present ||
      !line.present ||
      !securityNumberIsInteger(column.value) ||
      !securityNumberIsInteger(line.value) ||
      (column.value as number) < 0 ||
      (line.value as number) < 0 ||
      (column.value as number) > viteMaximumSafeInteger ||
      (line.value as number) > viteMaximumSafeInteger
    ) {
      throw new TypeError(`${label}.start has malformed line/column values.`);
    }
    startValue = { column: column.value as number, line: line.value as number };
  }
  const adopted = createRegisteredDiagnostic(
    code.value,
    {
      fileName: fileName.value,
      ...(length.present ? { length: length.value as number } : {}),
      ...(startValue === undefined ? {} : { start: startValue }),
    },
    {
      ...(help.present ? { help: help.value as string } : {}),
      message: message.value,
    },
  );
  if (adopted.severity !== severity.value) {
    throw new TypeError(`${label} disagrees with the registered diagnostic severity.`);
  }
  return adopted;
}

/** Build a dev-ledger module-diagnostics report (teaching disposition) for one app file. */
function dataPlaneLedgerReport(
  absFileName: string,
  diagnostics: readonly DataPlaneDiagnostic[],
): KovoAppShellViteCompilerModuleDiagnosticReport {
  const documentDiagnostics: DiagnosticDocumentDiagnostic[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index]!;
    assertRegisteredDiagnostic(diagnostic, `Data-plane ledger diagnostics[${index}]`);
    commitBuildArrayValue(
      documentDiagnostics,
      deriveRegisteredDiagnostic(
        diagnostic,
        { fileName: absFileName, start: { column: 1, line: diagnostic.line } },
        { message: diagnostic.message },
      ),
      'data-plane document diagnostic',
    );
  }
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
