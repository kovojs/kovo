import { isAbsolute, relative } from 'node:path';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import type { CompilerDiagnostic } from './diagnostics.js';
import { classifyHmrImpact } from './hmr-impact.js';
import { clientModuleUrl, clientModuleVersion } from './lower/handlers.js';
import type {
  HmrImpactClassification,
  HmrImpactMetadata,
  PackageComponentPrefixFact,
} from './types.js';

/**
 * The Vite plugin object produced by createKovoVitePlugin (and the `kovoVitePlugin` barrel
 * helper): a `transform` hook that lowers authored component modules through the compiler
 * and a dev-server hook that serves emitted client islands. Public plugin contract an app
 * wires into its `vite.config` (SPEC.md §5.2).
 */
export interface KovoVitePlugin {
  configureServer?: (server: KovoViteDevServer) => void;
  handleHotUpdate?: (context: KovoViteHotUpdateContext) => Promise<readonly unknown[]>;
  name: 'kovo';
  transform: (
    source: string,
    id: string,
  ) => null | {
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

/**
 * Options for createKovoVitePlugin / the `kovoVitePlugin` helper: diagnostic callbacks and
 * the package component prefixes to thread into compilation. Public plugin configuration
 * surface (SPEC.md §5.2).
 */
export interface KovoVitePluginOptions {
  onDiagnostic?: KovoViteDiagnosticReporter;
  onModuleDiagnostics?: KovoViteModuleDiagnosticReporter;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
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
  ws?: KovoViteWebSocket;
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
  source: string;
}

interface ViteCompileResult {
  diagnostics?: readonly CompilerDiagnostic[];
  files: readonly {
    kind: string;
    source: string;
  }[];
  hmrImpact?: HmrImpactMetadata | null;
}

/**
 * Build a KovoVitePlugin bound to a given component-compile function, lowering authored
 * component modules through the compiler on `transform` and serving emitted client islands
 * in dev. The barrel-level `kovoVitePlugin` helper wraps this with the real
 * compileComponentModule; this lower-level factory exists so the compile step can be
 * substituted in tests (SPEC.md §5.2). Public plugin factory.
 */
export function createKovoVitePlugin(
  compileComponentModule: (options: ViteCompileOptions) => ViteCompileResult,
  options: KovoVitePluginOptions = {},
): KovoVitePlugin {
  const clientModules = new Map<string, string>();
  const hmrImpacts = new Map<string, HmrImpactMetadata>();
  let root = process.cwd();

  return {
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
    name: 'kovo',
    transform(source: string, id: string) {
      if (!isViteComponentSource(id, source)) return null;

      const fileName = viteComponentFileName(id, root);
      const result = compileViteComponentModule(compileComponentModule, options, root, fileName, source);
      const errorDiagnostics = reportViteDiagnostics(result, options, fileName, source);
      if (errorDiagnostics.length > 0) throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
      recordViteCompileResult(clientModules, hmrImpacts, fileName, result);

      return {
        code: result.files.find((file) => file.kind === 'server')?.source ?? source,
        map: null,
      };
    },
    async handleHotUpdate(context) {
      const source = await context.read();
      if (!isViteComponentSource(context.file, source)) return context.modules ?? [];

      const fileName = viteComponentFileName(context.file, root);
      const previous = hmrImpacts.get(fileName) ?? null;
      const result = compileViteComponentModule(compileComponentModule, options, root, fileName, source);
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

      recordViteCompileResult(clientModules, hmrImpacts, fileName, result);
      const classification = classifyHmrImpact(previous, next);
      const event = eventForHmrClassification(classification);
      sendKovoHmrEvent(context.server, event, previous, next, classification);
      if (classification.impact !== 'componentRefresh') {
        context.server.ws?.send({ type: 'full-reload' });
      }

      return [];
    },
  };
}

function isViteComponentSource(id: string, source: string): boolean {
  return /\.[cm]?tsx?$/.test(id) && source.includes('component(');
}

function compileViteComponentModule(
  compileComponentModule: (options: ViteCompileOptions) => ViteCompileResult,
  options: KovoVitePluginOptions,
  root: string,
  fileName: string,
  source: string,
): ViteCompileResult {
  return compileComponentModule({
    fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    packagePrefixDiscoveryRoot: root,
    source,
  });
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
  hmrImpacts: Map<string, HmrImpactMetadata>,
  fileName: string,
  result: ViteCompileResult,
): void {
  for (const file of result.files) {
    if (file.kind === 'client') {
      clientModules.set(clientModuleUrl(fileName, clientModuleVersion(file.source)), file.source);
    }
  }

  if (result.hmrImpact) hmrImpacts.set(fileName, result.hmrImpact);
  else hmrImpacts.delete(fileName);
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
  return diagnosticDefinitions[diagnostic.code].severity;
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

  const [path = '', query = ''] = url.split(/[?#]/, 2);
  const version = new URLSearchParams(query).get('v');
  if (!path.startsWith('/c/') || !version) return null;

  return `${path}?v=${version}`;
}
