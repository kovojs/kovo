import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { CompileCache } from './compile-cache.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import {
  collectCssAssetManifest,
  type ComponentCssAsset,
  type CssAssetManifest,
  type CssAssetManifestOptions,
} from './css.js';
import type {
  HmrImpactClassification,
  HmrImpactMetadata,
  HmrImpactReason,
  PackageComponentPrefixFact,
  RegistryFacts,
} from './types.js';

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
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  registryFacts?: RegistryFacts;
  source: string;
}

interface ViteCompileResult {
  cssAssets?: readonly ComponentCssAsset[];
  diagnostics?: readonly CompilerDiagnostic[];
  files: readonly {
    kind: string;
    source: string;
  }[];
  hmrImpact?: HmrImpactMetadata | null;
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
  const compileCache = new CompileCache<ViteCompileResult>();
  const clientModules = new Map<string, string>();
  const cssAssetsByFileName = new Map<string, readonly ComponentCssAsset[]>();
  const hmrImpacts = new Map<string, HmrImpactMetadata>();
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
        const source = key ? clientModules.get(key) : undefined;
        if (source === undefined) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source);
      });
    },
    getCssAssetManifest(manifestOptions = {}) {
      return collectCssAssetManifest(
        [...cssAssetsByFileName.values()].map((cssAssets) => ({ cssAssets })),
        manifestOptions,
      );
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
      if (!shouldTransformViteComponentSource(fileName, source, options)) return null;

      const result = compileCachedViteComponentModule(
        compileComponentModule,
        compileCache,
        options,
        root,
        fileName,
        source,
      );
      if (isPromiseLike(result)) {
        return result.then((resolvedResult) =>
          transformViteCompileResult(
            clientModules,
            cssAssetsByFileName,
            hmrImpacts,
            options,
            fileName,
            source,
            resolvedResult,
          ),
        );
      }

      return transformViteCompileResult(
        clientModules,
        cssAssetsByFileName,
        hmrImpacts,
        options,
        fileName,
        source,
        result,
      );
    },
    async handleHotUpdate(context) {
      const source = await context.read();
      const fileName = viteComponentFileName(context.file, root);
      if (!shouldTransformViteComponentSource(fileName, source, options))
        return context.modules ?? [];

      const previous = hmrImpacts.get(fileName) ?? null;
      const result = await compileCachedViteComponentModule(
        compileComponentModule,
        compileCache,
        options,
        root,
        fileName,
        source,
      );
      const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
      const next = result.hmrImpact ?? null;

      if (errorDiagnostics.length > 0) {
        if (next) hmrImpacts.set(fileName, next);
        sendKovoHmrEvent(context.server, 'kovo:diagnostics', previous, next, {
          impact: 'diagnosticError',
          reasons: ['diagnostics'],
        });
        return [];
      }

      recordViteCompileResult(clientModules, cssAssetsByFileName, hmrImpacts, fileName, result);
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

function transformViteCompileResult(
  clientModules: Map<string, string>,
  cssAssetsByFileName: Map<string, readonly ComponentCssAsset[]>,
  hmrImpacts: Map<string, HmrImpactMetadata>,
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
  result: ViteCompileResult,
): { code: string; map: null } {
  const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
  if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
  recordViteCompileResult(clientModules, cssAssetsByFileName, hmrImpacts, fileName, result);

  return {
    code:
      executableViteServerSource(result.files.find((file) => file.kind === 'server')?.source) ??
      source,
    map: null,
  };
}

function executableViteServerSource(serverSource: string | undefined): string | undefined {
  if (serverSource === undefined) return undefined;
  const executableWrapper = serverSource.replace(
    /^\s*export\s+function\s+renderSource\s*\(/m,
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
  source: string,
  options: KovoVitePluginOptions,
): boolean {
  if (!/\.[cm]?tsx?$/.test(fileName) || !source.includes('component(')) return false;
  if (matchesAnyViteFilter(options.exclude, fileName, source)) return false;
  if (options.include !== undefined && !matchesAnyViteFilter(options.include, fileName, source))
    return false;

  return true;
}

function matchesAnyViteFilter(
  filters: readonly KovoViteModuleFilter[] | undefined,
  fileName: string,
  source: string,
): boolean {
  return filters?.some((filter) => matchesViteFilter(filter, fileName, source)) ?? false;
}

function matchesViteFilter(
  filter: KovoViteModuleFilter,
  fileName: string,
  source: string,
): boolean {
  if (typeof filter === 'function') return filter(fileName, source);
  if (typeof filter !== 'string') return filter.test(fileName);

  const normalized = slashPath(filter).replace(/\/+$/, '');
  return fileName === normalized || fileName.startsWith(`${normalized}/`);
}

function compileCachedViteComponentModule(
  compileComponentModule: (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>,
  cache: CompileCache<ViteCompileResult>,
  options: KovoVitePluginOptions,
  root: string,
  fileName: string,
  source: string,
): MaybePromise<ViteCompileResult> {
  const registryFacts = resolveViteRegistryFacts(options, fileName);
  return cache.getOrCreate(
    {
      fileName,
      packageComponentPrefixes: options.packageComponentPrefixes,
      registryFacts,
      root,
      source,
    },
    () =>
      compileViteComponentModule(
        compileComponentModule,
        options,
        root,
        fileName,
        source,
        registryFacts,
      ),
  );
}

function compileViteComponentModule(
  compileComponentModule: (options: ViteCompileOptions) => MaybePromise<ViteCompileResult>,
  options: KovoVitePluginOptions,
  root: string,
  fileName: string,
  source: string,
  registryFacts = resolveViteRegistryFacts(options, fileName),
): MaybePromise<ViteCompileResult> {
  return compileComponentModule({
    fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    packagePrefixDiscoveryRoot: root,
    ...(registryFacts === undefined ? {} : { registryFacts }),
    source,
  });
}

function resolveViteClientModuleId(
  source: string,
  importer: string | undefined,
  root: string,
): null | string {
  const sourceFileName = source.split(/[?#]/, 1)[0] ?? source;
  if (!sourceFileName.endsWith('.client.js')) return null;
  const importerFileName = importer?.split(/[?#]/, 1)[0];
  const candidate = isAbsolute(sourceFileName)
    ? sourceFileName
    : importerFileName
      ? resolve(dirname(importerFileName), sourceFileName)
      : resolve(root, sourceFileName.replace(/^\/+/, ''));
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
  const clientFilePath = id.split(/[?#]/, 1)[0] ?? id;
  if (!clientFilePath.endsWith('.client.js')) return null;

  const sourceFilePath = viteClientModuleSourceFilePath(clientFilePath);
  if (!existsSync(sourceFilePath)) return null;

  const fileName = viteComponentFileName(sourceFilePath, root);
  const source = readFileSync(sourceFilePath, 'utf8');
  if (!shouldTransformViteComponentSource(fileName, source, options)) return null;

  const result = compileCachedViteComponentModule(
    compileComponentModule,
    cache,
    options,
    root,
    fileName,
    source,
  );
  if (isPromiseLike(result)) {
    return result.then((resolvedResult) => viteClientSource(resolvedResult));
  }

  return viteClientSource(result);
}

function viteClientSource(result: ViteCompileResult): null | string {
  return result.files.find((file) => file.kind === 'client')?.source ?? null;
}

function viteClientModuleSourceFilePath(clientFilePath: string): string {
  return clientFilePath.replace(/\.client\.js$/, '.tsx');
}

function resolveViteRegistryFacts(
  options: KovoVitePluginOptions,
  fileName: string,
): RegistryFacts | undefined {
  if (typeof options.registryFacts === 'function') return options.registryFacts(fileName);
  return options.registryFacts;
}

function reportViteDiagnostics(
  result: ViteCompileResult,
  options: KovoVitePluginOptions,
  fileName: string,
  source: string,
): CompilerDiagnostic[] {
  const diagnostics = result.diagnostics ?? [];
  options.onModuleDiagnostics?.({ diagnostics, fileName, source });
  const errorDiagnostics = diagnostics.filter(
    (diagnostic) => diagnosticSeverity(diagnostic) === 'error',
  );

  for (const diagnostic of diagnostics) {
    if (diagnosticSeverity(diagnostic) !== 'error') options.onDiagnostic?.(diagnostic);
  }

  return errorDiagnostics;
}

function recordViteCompileResult(
  clientModules: Map<string, string>,
  cssAssetsByFileName: Map<string, readonly ComponentCssAsset[]>,
  hmrImpacts: Map<string, HmrImpactMetadata>,
  fileName: string,
  result: ViteCompileResult,
): void {
  for (const file of result.files) {
    if (file.kind === 'client') {
      clientModules.set(
        viteClientModuleUrl(fileName, viteClientModuleVersion(file.source)),
        file.source,
      );
    }
  }

  if (result.cssAssets && result.cssAssets.length > 0) {
    cssAssetsByFileName.set(fileName, result.cssAssets);
  } else {
    cssAssetsByFileName.delete(fileName);
  }

  if (result.hmrImpact) hmrImpacts.set(fileName, result.hmrImpact);
  else hmrImpacts.delete(fileName);
}

function classifyViteHmrImpact(
  previous: HmrImpactMetadata | null | undefined,
  next: HmrImpactMetadata | null | undefined,
): HmrImpactClassification {
  if (!previous || !next) return viteFullReload('missing-facts');
  if (next.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { impact: 'diagnosticError', reasons: ['diagnostics'] };
  }
  if (previous.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
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
  if (previous.queryUpdatePlanHash !== next.queryUpdatePlanHash) reasons.push('query-plan');
  if (previous.stylesheetAssetsHash !== next.stylesheetAssetsHash) reasons.push('style');
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
      liveTargets: (next?.liveTargetFacts ?? []).map((target) => target.target),
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
  const fileName = id.split(/[?#]/, 1)[0] ?? id;
  if (!isAbsolute(fileName)) return slashPath(fileName);

  const relativeFileName = relative(root, fileName);
  if (!relativeFileName.startsWith('..')) return slashPath(relativeFileName);

  return slashPath(fileName.replace(/^\/+/, ''));
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function devClientModuleKey(url: string | undefined): string | null {
  if (!url) return null;

  const parsed = new URL(url, 'https://kovo.local');
  if (parsed.pathname.startsWith('/c/__v/')) return parsed.pathname;

  const version = parsed.searchParams.get('v');
  if (!parsed.pathname.startsWith('/c/') || !version) return null;

  return `${parsed.pathname}?v=${version}`;
}

function viteClientModuleUrl(fileName: string, version?: string): string {
  const href = `/c/${replaceViteExtension(fileName, '.client.js').replace(/^\/+/, '')}`;
  if (!version) return href;

  return `/c/__v/${encodeURIComponent(version)}/${href.slice('/c/'.length)}`;
}

function replaceViteExtension(fileName: string, extension: string): string {
  return fileName.replace(/\.[cm]?[jt]sx?$/, extension);
}

function viteClientModuleVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}
