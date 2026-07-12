import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';

import { resolvedFileSystemPath } from './vite-build-assets.js';
import type { KovoNeutralBuild } from './neutral-build.js';
import { sanitizeDiagnosticText, sanitizeDiagnosticUrl } from './logging.js';
import {
  staticHostHeaders,
  staticHostImmutableAssetPathPattern,
} from './static-host-header-policy.js';

const immutableAssetPathPattern = staticHostImmutableAssetPathPattern;

/**
 * Build-time preset descriptor consumed by `kovo build` and deployment tooling.
 *
 * @experimental
 */
export interface KovoPreset {
  /** Build-time capabilities this preset can actually host. */
  capabilities?: KovoPresetCapabilities;
  /** Emit platform-native output from an already-written neutral build. */
  emit?(build: KovoNeutralBuild, context: PresetContext): Promise<void> | void;
  /** Return target-specific diagnostics before output is emitted. */
  inspect?(
    build: KovoNeutralBuild,
    context: PresetInspectContext,
  ): Promise<readonly PresetDiagnostic[]> | readonly PresetDiagnostic[];
  /** Stable preset name, such as `node`, `vercel`, or `cloudflare`. */
  name: string;
}

/**
 * Deployment capabilities declared by a preset.
 *
 * @experimental
 */
export interface KovoPresetCapabilities {
  /** Durable task drainer available to run jobs enqueued by `request.schedule(...)` (SPEC §9.6). */
  jobRunner?: JobRunnerCapability;
}

/**
 * Preset-owned durable task runner capability (SPEC §9.6).
 *
 * @experimental
 */
export interface JobRunnerCapability {
  /** Concrete runner adapter owned by the preset. */
  adapter: 'node-in-process';
  /** Whether the artifact serves HTTP while draining jobs. */
  mode: 'serve-and-run';
}

/**
 * Context passed to a preset while it validates target-specific constraints.
 *
 * @experimental
 */
export interface PresetInspectContext {
  /** Environment variables the app declares or the build inferred, such as `DATABASE_URL`. */
  declaredEnv: readonly string[];
  /** Read the bundled request handler source when a preset needs target-specific inspection. */
  readServerHandlerSource?(): Promise<string | undefined> | string | undefined;
}

/**
 * Context passed to a preset while it transforms the neutral build output.
 *
 * @experimental
 */
export interface PresetContext extends PresetInspectContext {
  /** Build log sink supplied by the CLI or host integration. */
  log(message: string): void;
  /** Platform output directory for the preset. */
  outDir: string;
  /** Read the neutral build facts the preset is transforming. */
  readNeutral(): KovoNeutralBuild;
}

/**
 * A preset validation diagnostic reported before platform output is emitted.
 *
 * @experimental
 */
export interface PresetDiagnostic {
  /** Stable diagnostic code owned by the preset. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Whether the diagnostic blocks the build. */
  severity: 'error' | 'warning';
}

/**
 * Deployment-owned proof that the serving layer satisfies SPEC §14 for long-lived documents.
 *
 * Kovo can emit immutable `/c/__v/...` modules and token-tagged reads, but only the deploy layer
 * can prove prior builds stay reachable across redeploys. The window is configurable upward; SPEC
 * §14 makes 24 hours the minimum floor.
 *
 * @experimental
 */
export interface DeploySkewRetentionProof {
  /** Supported wall-clock deploy-skew window. Must be at least 24 hours. */
  hours: number;
  /** Prior immutable `/c/__v/...` client modules remain reachable for the window. */
  immutableClientModules: 'retained';
  /** Prior-token `/_q/<key>` reads remain reachable for the window. */
  priorTokenQueryReads: 'retained';
}

/**
 * Shared deploy-skew options accepted by built-in build presets.
 *
 * @experimental
 */
export interface DeploySkewPresetOptions {
  /** Serving-layer retention proof for SPEC §14 deploy-skew recovery. */
  retention?: DeploySkewRetentionProof;
}

/**
 * Options for the built-in Node/VPS preset.
 *
 * @experimental
 */
export interface NodePresetOptions extends DeploySkewPresetOptions {
  /** Whether the node preset emits a minimal Dockerfile next to `server.mjs`; defaults to true. */
  dockerfile?: boolean;
  /** Durable task runner mode; defaults to the in-process serve-and-run JobRunner. */
  jobRunner?: NodeJobRunnerOptions | false;
}

/**
 * Node preset durable task runner options (SPEC §9.6).
 *
 * @experimental
 */
export interface NodeJobRunnerOptions {
  /**
   * `serve-and-run` drains jobs inside the HTTP process. `runner-only` is reserved until the neutral
   * server bundle exposes a runner entrypoint; selecting it currently fails closed at build time.
   */
  mode?: 'serve-and-run' | 'runner-only';
}

/**
 * Options for the built-in Vercel preset.
 *
 * @experimental
 */
export interface VercelPresetOptions extends DeploySkewPresetOptions {
  /** Maximum Vercel Function duration in seconds. */
  maxDuration?: number;
  /** Vercel Function memory in MB. */
  memory?: number;
  /** Vercel regions for the Node function. */
  regions?: readonly string[];
}

/**
 * Options for the built-in Cloudflare Workers preset.
 *
 * @experimental
 */
export interface CloudflarePresetOptions extends DeploySkewPresetOptions {
  /** Worker compatibility date; defaults to the first date that supports `nodejs_compat` v2. */
  compatibilityDate?: string;
  /** Generated Worker name in `wrangler.toml`; defaults to `kovo-app`. */
  name?: string;
}

/**
 * Build-time project configuration loaded from `kovo.config.ts`.
 *
 * @experimental
 */
export interface KovoConfig {
  /** Platform preset used by `kovo build` when CLI/env overrides are absent. */
  preset?: KovoPreset;
}

/**
 * Type helper for authoring `kovo.config.ts` without changing runtime behavior.
 *
 * @experimental
 */
export function defineConfig(config: KovoConfig): KovoConfig {
  return config;
}

/**
 * Create the built-in Node/VPS preset descriptor.
 *
 * The emitted output wraps the neutral `server/handler.mjs` Request-to-Response
 * contract in a Node `http` server and serves immutable `/c/*` plus hashed
 * `/assets/*` client files without Vite at request time.
 *
 * @experimental
 */
export function node(options: NodePresetOptions = {}): KovoPreset {
  const jobRunner = nodeJobRunnerCapability(options);
  return {
    ...(jobRunner === undefined ? {} : { capabilities: { jobRunner } }),
    emit(build, context) {
      return emitNodePreset(build, context, options);
    },
    inspect(build, context) {
      const retentionDiagnostics = clientModuleRetentionDiagnostics(build, 'node', options);
      const runnerDiagnostics = nodeJobRunnerDiagnostics(build, options, jobRunner, context);
      const appendNodeDiagnostics = (
        jobRunnerDiagnostics: readonly PresetDiagnostic[],
      ): readonly PresetDiagnostic[] =>
        nodePresetDiagnostics(build, [...retentionDiagnostics, ...jobRunnerDiagnostics]);
      if (isPromiseLike(runnerDiagnostics)) return runnerDiagnostics.then(appendNodeDiagnostics);
      return appendNodeDiagnostics(runnerDiagnostics);
    },
    name: 'node',
  };
}

/**
 * Create the built-in Vercel preset descriptor.
 *
 * The emitted output follows Vercel Build Output API v3: static client files
 * land under `.vercel/output/static`, and the request handler is wrapped as a
 * Node.js Vercel Function under `.vercel/output/functions/kovo.func`.
 *
 * @experimental
 */
export function vercel(options: VercelPresetOptions = {}): KovoPreset {
  return {
    emit(build, context) {
      return emitVercelPreset(build, context, options);
    },
    inspect(build, _context) {
      const diagnostics = [
        ...clientModuleRetentionDiagnostics(build, 'vercel', options),
        ...missingJobRunnerDiagnostics(build, 'vercel'),
      ];
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'vercel-missing-handler',
          message: 'The vercel preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      return diagnostics;
    },
    name: 'vercel',
  };
}

/**
 * Create the built-in Cloudflare Workers preset descriptor.
 *
 * The emitted output is a Wrangler project with a module Worker, static assets
 * binding, and `nodejs_compat` enabled for the current Node-first request path.
 *
 * @experimental
 */
export function cloudflare(options: CloudflarePresetOptions = {}): KovoPreset {
  return {
    emit(build, context) {
      return emitCloudflarePreset(build, context, options);
    },
    async inspect(build, context) {
      const diagnostics = [
        ...clientModuleRetentionDiagnostics(build, 'cloudflare', options),
        ...missingJobRunnerDiagnostics(build, 'cloudflare'),
      ];
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'cloudflare-missing-handler',
          message: 'The cloudflare preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      if (build.serverHandlerPath === undefined) return diagnostics;

      diagnostics.push(...(await cloudflareRuntimeDiagnostics(build, context)));
      return diagnostics;
    },
    name: 'cloudflare',
  };
}

async function emitNodePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: NodePresetOptions,
): Promise<void> {
  if (build.serverHandlerPath === undefined) {
    throw new Error('The node preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await cp(build.clientDir, path.join(outDir, 'client'), { recursive: true });
  if (build.publicAssetDir !== undefined) {
    await cp(build.publicAssetDir, path.join(outDir, 'static'), { recursive: true });
  }
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
  }
  await cp(build.serverDir, path.join(outDir, 'server'), { recursive: true });
  await writeFile(path.join(outDir, 'node-adapter.mjs'), nodeAdapterRuntimeSource(), 'utf8');
  await writeFile(path.join(outDir, 'server.mjs'), nodeServerSource(), 'utf8');
  await emitNodeRuntimePackage(outDir);

  if (options.dockerfile !== false) {
    await writeFile(path.join(outDir, 'Dockerfile'), nodeDockerfileSource(), 'utf8');
  }

  context.log(`Emitted Kovo node preset output to ${outDir}`);
}

async function emitVercelPreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: VercelPresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
    await writeJson(path.join(outDir, 'config.json'), vercelStaticBuildOutputConfig());
    context.log(`Emitted Kovo vercel static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The vercel preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  const functionDir = path.join(outDir, 'functions/kovo.func');
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'static'));
  await mkdir(functionDir, { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(functionDir, 'handler.mjs'));
  await writeFile(path.join(functionDir, 'node-adapter.mjs'), nodeAdapterRuntimeSource(), 'utf8');
  await writeFile(path.join(functionDir, 'index.cjs'), vercelFunctionSource(), 'utf8');
  await writeJson(path.join(functionDir, '.vc-config.json'), {
    handler: 'index.cjs',
    launcherType: 'Nodejs',
    ...(options.maxDuration === undefined ? {} : { maxDuration: options.maxDuration }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
    ...(options.regions === undefined ? {} : { regions: options.regions }),
    runtime: 'nodejs22.x',
    shouldAddHelpers: true,
  });
  await writeJson(path.join(outDir, 'config.json'), vercelBuildOutputConfig());

  context.log(`Emitted Kovo vercel preset output to ${outDir}`);
}

async function emitCloudflarePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: CloudflarePresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'client'), { recursive: true });
    await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');
    context.log(`Emitted Kovo cloudflare static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The cloudflare preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'client'));
  await mkdir(path.join(outDir, 'server'), { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(outDir, 'server/handler.mjs'));
  await writeFile(path.join(outDir, 'worker.mjs'), cloudflareWorkerSource(), 'utf8');
  await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');

  context.log(`Emitted Kovo cloudflare preset output to ${outDir}`);
}

async function copyPresetStaticFiles(build: KovoNeutralBuild, outDir: string): Promise<void> {
  if (build.publicAssetDir !== undefined) {
    await cp(build.publicAssetDir, outDir, { recursive: true });
  }
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, outDir, { recursive: true });
  }
  await cp(build.clientDir, outDir, { recursive: true });
}

function clientModuleRetentionDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
  options: DeploySkewPresetOptions,
): PresetDiagnostic[] {
  const retainedClientModules = build.clientModules.filter(
    (module) => !isFrameworkRuntimeClientModule(module),
  );
  if (retainedClientModules.length === 0) return [];
  if (deploySkewRetentionProofSatisfiesFloor(options.retention)) return [];

  return [
    {
      code: 'KV417',
      message: `The ${presetName} preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/... modules and prior-token /_q reads. Configure ${presetName}({ retention: { hours: 24, immutableClientModules: 'retained', priorTokenQueryReads: 'retained' } }) only when the serving layer retains prior build artifacts and query-read support for at least 24 hours, or use a preset/adapter that declares that support.`,
      severity: 'error',
    },
  ];
}

function deploySkewRetentionProofSatisfiesFloor(
  retention: DeploySkewRetentionProof | undefined,
): boolean {
  return (
    retention !== undefined &&
    Number.isFinite(retention.hours) &&
    retention.hours >= 24 &&
    retention.immutableClientModules === 'retained' &&
    retention.priorTokenQueryReads === 'retained'
  );
}

function nodeJobRunnerCapability(options: NodePresetOptions): JobRunnerCapability | undefined {
  if (options.jobRunner === false) return undefined;
  if (options.jobRunner?.mode === 'runner-only') return undefined;
  return { adapter: 'node-in-process', mode: 'serve-and-run' };
}

function nodeJobRunnerDiagnostics(
  build: KovoNeutralBuild,
  options: NodePresetOptions,
  capability: JobRunnerCapability | undefined,
  context: PresetInspectContext,
): Promise<readonly PresetDiagnostic[]> | readonly PresetDiagnostic[] {
  if (options.jobRunner && options.jobRunner.mode === 'runner-only') {
    return [
      {
        code: 'node-runner-only-unsupported',
        message:
          'The node preset runner-only JobRunner mode is not emitted yet because the neutral server bundle does not expose a standalone task-runner entrypoint. Use node() or node({ jobRunner: { mode: "serve-and-run" } }) for the in-process JobRunner, or deploy a supported external runner adapter when one is added.',
        severity: 'error',
      },
    ];
  }
  if (capability === undefined) return missingJobRunnerDiagnostics(build, 'node');
  const source = context.readServerHandlerSource?.();
  if (isPromiseLike(source)) {
    return source.then((serverHandlerSource) =>
      durableTaskStoreDiagnostics(build, 'node', serverHandlerSource),
    );
  }
  return durableTaskStoreDiagnostics(build, 'node', source);
}

function durableTaskStoreDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
  serverHandlerSource: string | undefined,
): PresetDiagnostic[] {
  if (build.tasks.length === 0) return [];
  if (
    serverHandlerSource === undefined ||
    !serverHandlerUsesSqliteDurableIncompatibleStore(serverHandlerSource)
  ) {
    return [];
  }

  const taskList = build.tasks.map((task) => task.key).join(', ');
  return [
    {
      code: 'KV446',
      message: `The ${presetName} preset's default JobRunner persists durable task(s) in the Postgres _kovo_jobs store, but this build registers durable task(s): ${taskList} and the server bundle uses SQLite/better-sqlite3. SPEC §9.6 requires the node JobRunner's Postgres durable-task store; use a Postgres-compatible app db for durable tasks or remove task()/request.schedule() until a supported SQLite durable queue adapter exists.`,
      severity: 'error',
    },
  ];
}

function missingJobRunnerDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
): PresetDiagnostic[] {
  if (build.tasks.length === 0) return [];
  const taskList = build.tasks.map((task) => task.key).join(', ');
  return [
    {
      code: 'KV445',
      message: `The ${presetName} preset declares no JobRunner capability but this build registers durable task(s): ${taskList}. SPEC §9.6 requires presets that support task()/request.schedule() to declare a real drainer; use the node preset's in-process JobRunner, or configure a preset/adapter with a cron-drain or external queue runner before deploying.`,
      severity: 'error',
    },
  ];
}

function nodePresetDiagnostics(
  build: KovoNeutralBuild,
  diagnostics: PresetDiagnostic[],
): readonly PresetDiagnostic[] {
  if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
    diagnostics.push({
      code: 'node-missing-handler',
      message: 'The node preset requires a neutral build with server/handler.mjs.',
      severity: 'error',
    });
  }
  return diagnostics;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function serverHandlerUsesSqliteDurableIncompatibleStore(source: string): boolean {
  return /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:better-sqlite3|drizzle-orm\/better-sqlite3)["']/.test(
    source,
  );
}

function isFrameworkRuntimeClientModule(
  module: KovoNeutralBuild['clientModules'][number],
): boolean {
  return (
    module.path.endsWith(kovoDeferredRuntimeModulePath.replace(/^\/c\//, '/')) &&
    module.version === kovoDeferredRuntimeModuleVersion
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function vercelBuildOutputConfig(): unknown {
  return {
    routes: [
      {
        continue: true,
        headers: staticHostHeaders('clientModule'),
        src: '/c/(.*)',
      },
      {
        continue: true,
        headers: staticHostHeaders('immutableAsset'),
        src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
      },
      {
        continue: true,
        headers: staticHostHeaders('revalidatingAsset'),
        src: '/assets/(.*)',
      },
      {
        continue: true,
        headers: staticHostHeaders('document'),
        src: '/(.*)',
      },
      { handle: 'filesystem' },
      { dest: '/kovo', src: '/(.*)' },
    ],
    version: 3,
  };
}

function vercelStaticBuildOutputConfig(): unknown {
  return {
    routes: [
      {
        continue: true,
        headers: staticHostHeaders('clientModule'),
        src: '/c/(.*)',
      },
      {
        continue: true,
        headers: staticHostHeaders('immutableAsset'),
        src: '/assets/(?:.*\\/)?[^/]*-[a-f0-9]{8,}(?:\\.[^/.]+)+',
      },
      {
        continue: true,
        headers: staticHostHeaders('revalidatingAsset'),
        src: '/assets/(.*)',
      },
      {
        continue: true,
        headers: staticHostHeaders('document'),
        src: '/(.*)',
      },
      { handle: 'filesystem' },
    ],
    version: 3,
  };
}

function nodeAdapterRuntimeSource(): string {
  return `import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const bodylessMethods = new Set(['GET', 'HEAD']);

export function nodeRequestToWebRequest(nodeRequest, options = {}, nodeResponse) {
  if (unsafeReservedMutationRequestTarget(nodeRequest.url ?? '/')) {
    throw new TypeError('Reserved mutation request targets must use their canonical raw path.');
  }
  const method = nodeRequest.method ?? 'GET';
  const headers = nodeHeadersToWebHeaders(nodeRequest);
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const socket = nodeRequest.socket;
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', abort);
  socket?.once('close', abort);
  if (nodeResponse) {
    const cleanup = () => {
      nodeRequest.off('aborted', abort);
      nodeRequest.off('close', abort);
      socket?.off('close', abort);
    };
    nodeResponse.once('close', cleanup);
  }
  const init = {
    headers,
    method,
    signal: controller.signal,
    ...(bodylessMethods.has(method)
      ? {}
      : {
          body: Readable.toWeb(nodeRequest),
          duplex: 'half',
        }),
  };

  const request = new Request(nodeRequestUrl(nodeRequest, options), init);
  const peerAddress = nodeRequest.socket?.remoteAddress?.trim();
  if (peerAddress) {
    Object.defineProperty(request, '__kovoPeerAddress', {
      configurable: true,
      value: peerAddress,
    });
  }
  return request;
}

export function rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse) {
  if (!unsafeReservedMutationRequestTarget(nodeRequest.url ?? '/')) return false;
  armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
  nodeResponse.writeHead(404, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  nodeResponse.end('Not Found');
  return true;
}

export function armIncompleteNodeRequestClose(nodeRequest, nodeResponse) {
  if (nodeRequest.complete || nodeRequest.destroyed || nodeResponse.destroyed) return;

  nodeResponse.shouldKeepAlive = false;
  const closeIncompleteRequest = () => {
    if (!nodeRequest.complete && !nodeRequest.destroyed) nodeRequest.destroy();
  };
  nodeResponse.once('finish', closeIncompleteRequest);
  nodeResponse.once('close', closeIncompleteRequest);
}

function unsafeReservedMutationRequestTarget(rawTarget) {
  const pathname = rawNodeRequestTargetPathname(rawTarget);
  const comparablePathname = pathname.replaceAll('\\\\', '/');
  if (!comparablePathname.startsWith('/_m/')) return false;
  if (/%(?:2e|2f|5c)/i.test(pathname)) return true;
  if (pathname.includes('\\\\')) return true;
  return comparablePathname
    .slice('/_m/'.length)
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
}

function rawNodeRequestTargetPathname(rawTarget) {
  const query = rawTarget.search(/[?#]/);
  const target = query < 0 ? rawTarget : rawTarget.slice(0, query);
  const scheme = target.indexOf('://');
  if (scheme < 0) return target;
  const slash = target.indexOf('/', scheme + 3);
  const backslash = target.indexOf('\\\\', scheme + 3);
  const path = slash < 0 ? backslash : backslash < 0 ? slash : Math.min(slash, backslash);
  return path < 0 ? '/' : target.slice(path);
}

export async function writeWebResponseToNode(response, nodeResponse, method = 'GET', options = {}) {
  const responseHeaders = new Headers(response.headers);
  if (nodeResponse.shouldKeepAlive === false && options.httpVersion !== '2.0') {
    responseHeaders.set('connection', 'close');
  }
  const headers = responseHeadersToNodeHeaders(responseHeaders);

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body), nodeResponse);
}

function nodeRequestUrl(nodeRequest, options) {
  const rawUrl = nodeRequest.url ?? '/';
  const origin =
    typeof options.origin === 'function'
      ? options.origin(nodeRequest)
      : (options.origin ?? defaultOrigin(nodeRequest, options));

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) {
    const absolute = new URL(rawUrl);
    return new URL(absolute.pathname + absolute.search + absolute.hash, origin).href;
  }

  const pathOnly = rawUrl.startsWith('//') ? '/' + rawUrl.replace(/^\\/+/, '') : rawUrl;
  return new URL(pathOnly, origin).href;
}

function defaultOrigin(nodeRequest, options) {
  // E2 (SPEC §9.5): under HTTP/2 the \`Host\` header is often absent — the authority lives in
  // the \`:authority\` pseudo-header instead. Fall back to it (then \`:scheme\`) so URL resolution
  // works for HTTP/2 requests, not just HTTP/1.1.
  const pseudoHeaders = nodeRequest.headers;
  const host = nodeRequest.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
  const forwardedProto = options.trustedProxy
    ? firstHeaderValue(nodeRequest.headers['x-forwarded-proto'])
    : undefined;
  const pseudoScheme = firstHeaderValue(pseudoHeaders[':scheme']);
  const proto =
    forwardedProto ??
    pseudoScheme ??
    (nodeRequest.socket && nodeRequest.socket.encrypted ? 'https' : 'http');

  return proto + '://' + host;
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    // E2 (SPEC §9.5): under Node's HTTP/2 compat API \`nodeRequest.headers\` carries pseudo-headers
    // (\`:path\`/\`:method\`/\`:authority\`/\`:scheme\`). The web \`Headers\` constructor throws on any
    // name starting with \`:\`, so copying them unfiltered 500'd every HTTP/2 request. Skip them
    // — they are addressed via \`nodeRequest.method\`/\`nodeRequest.url\`/the \`:authority\` URL fallback.
    if (name.startsWith(':')) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function responseHeadersToNodeHeaders(headers) {
  // SPEC §9.4/§9.1.1: Node's writeHead accepts string[] for multi-value headers.
  // Headers.forEach combines set-cookie into one entry (comma-joined), so handle
  // it separately via getSetCookie() which preserves each cookie as a distinct value.
  const nodeHeaders = {};
  const setCookies = headers.getSetCookie();
  if (setCookies.length > 0) nodeHeaders['set-cookie'] = setCookies;
  headers.forEach((value, name) => {
    if (name === 'set-cookie') return;
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
`;
}

function vercelFunctionSource(): string {
  return `let handlerPromise;
let nodeAdapterPromise;

module.exports = async function kovoVercelFunction(nodeRequest, nodeResponse) {
  try {
    const { nodeRequestToWebRequest, rejectUnsafeNodeMutationTarget, writeWebResponseToNode } =
      await loadNodeAdapter();
    if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
    const handler = await loadHandler();
    const request = nodeRequestToWebRequest(nodeRequest, {}, nodeResponse);
    const response = await handler(request);
    armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
    await writeWebResponseToNode(response, nodeResponse, request.method, {
      httpVersion: nodeRequest.httpVersion,
    });
  } catch {
    if (nodeResponse.headersSent) {
      nodeResponse.destroy();
    } else {
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      nodeResponse.end('Internal Server Error');
    }
  }
};

async function loadHandler() {
  handlerPromise ||= import('./handler.mjs').then((module) => module.default);
  return handlerPromise;
}

async function loadNodeAdapter() {
  nodeAdapterPromise ||= import('./node-adapter.mjs');
  return nodeAdapterPromise;
}
function armIncompleteNodeRequestClose(nodeRequest, nodeResponse) {
  if (nodeRequest.complete || nodeRequest.destroyed || nodeResponse.destroyed) return;
  nodeResponse.shouldKeepAlive = false;
  const closeIncompleteRequest = () => {
    if (!nodeRequest.complete && !nodeRequest.destroyed) nodeRequest.destroy();
  };
  nodeResponse.once('finish', closeIncompleteRequest);
  nodeResponse.once('close', closeIncompleteRequest);
}
function isImmutableStaticAssetPath(pathname) {
  return pathname.startsWith('/c/') || ${immutableAssetPathPattern}.test(pathname);
}
`;
}

function cloudflareWorkerSource(): string {
  return `import handler from './server/handler.mjs';

const clientModuleHeaders = ${JSON.stringify(staticHostHeaders('clientModule'))};
const immutableAssetHeaders = ${JSON.stringify(staticHostHeaders('immutableAsset'))};
const revalidatingAssetHeaders = ${JSON.stringify(staticHostHeaders('revalidatingAsset'))};
const documentStaticHeaders = ${JSON.stringify(staticHostHeaders('document'))};
const staticErrorHeaders = ${JSON.stringify(staticHostHeaders('errorDocument'))};
const bodylessMethods = new Set(['GET', 'HEAD']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (bodylessMethods.has(request.method) && env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        const headers = new Headers(assetResponse.headers);
        if (assetResponse.status >= 400) {
          applyHeaders(headers, staticErrorHeaders);
        } else if (url.pathname.startsWith('/c/')) {
          applyHeaders(headers, clientModuleHeaders);
        } else if (isImmutableStaticAssetPath(url.pathname)) {
          applyHeaders(headers, immutableAssetHeaders);
        } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/c/')) {
          applyHeaders(headers, revalidatingAssetHeaders);
        } else {
          applyHeaders(headers, documentStaticHeaders);
        }
        return new Response(assetResponse.body, {
          headers,
          status: assetResponse.status,
          statusText: assetResponse.statusText,
        });
      }
    }

    return handler(request);
  },
};

function applyHeaders(headers, policy) {
  for (const [name, value] of Object.entries(policy)) {
    headers.set(name, value);
  }
}
function isImmutableStaticAssetPath(pathname) {
  return pathname.startsWith('/c/') || ${immutableAssetPathPattern}.test(pathname);
}
`;
}

async function cloudflareRuntimeDiagnostics(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<readonly PresetDiagnostic[]> {
  const source = await serverHandlerSourceForInspection(build, context);
  if (source === undefined) return [];

  const diagnostics: PresetDiagnostic[] = [];
  if (context.declaredEnv.includes('DATABASE_URL') || source.includes('DATABASE_URL')) {
    diagnostics.push({
      code: 'cloudflare-tcp-database',
      message:
        'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
      severity: 'warning',
    });
  }

  for (const moduleName of cloudflareBlockedNodeModules) {
    if (serverHandlerImportsModule(source, moduleName)) {
      diagnostics.push({
        code: 'cloudflare-unsupported-node-api',
        message: `The cloudflare preset cannot run ${moduleName}; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.`,
        severity: 'error',
      });
    }
  }

  return diagnostics;
}

const cloudflareBlockedNodeModules = [
  'child_process',
  'cluster',
  'dgram',
  'node:child_process',
  'node:cluster',
  'node:dgram',
] as const;

async function serverHandlerSourceForInspection(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<string | undefined> {
  const contextSource = await context.readServerHandlerSource?.();
  if (contextSource !== undefined) return contextSource;
  if (build.serverHandlerPath === undefined) return undefined;
  return readFile(build.serverHandlerPath, 'utf8');
}

function serverHandlerImportsModule(source: string, moduleName: string): boolean {
  const quotedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modulePattern = new RegExp(
    [
      `\\bfrom\\s*['"]${quotedModule}['"]`,
      `\\bimport\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
      `\\brequire\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
    ].join('|'),
  );
  return modulePattern.test(source);
}

function wranglerTomlSource(options: CloudflarePresetOptions): string {
  const name = options.name ?? 'kovo-app';
  const compatibilityDate = options.compatibilityDate ?? '2024-09-23';
  return [
    `name = ${tomlString(name)}`,
    'main = "./worker.mjs"',
    `compatibility_date = ${tomlString(compatibilityDate)}`,
    'compatibility_flags = ["nodejs_compat"]',
    '',
    '[assets]',
    'directory = "./client"',
    'binding = "ASSETS"',
    'run_worker_first = true',
    '',
  ].join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function nodeServerSource(): string {
  return `import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  armIncompleteNodeRequestClose,
  nodeRequestToWebRequest,
  rejectUnsafeNodeMutationTarget,
  writeWebResponseToNode,
} from './node-adapter.mjs';
import handler from './server/handler.mjs';

const sanitizeDiagnosticUrl = (${sanitizeDiagnosticUrl.toString()});
const sanitizeDiagnosticText = (${sanitizeDiagnosticText.toString()});
const nativeErrorStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get;

const clientRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'client');
const staticRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'static');
const clientModuleHeaders = ${JSON.stringify(staticHostHeaders('clientModule'))};
const immutableAssetHeaders = ${JSON.stringify(staticHostHeaders('immutableAsset'))};
const revalidatingAssetHeaders = ${JSON.stringify(staticHostHeaders('revalidatingAsset'))};
const documentStaticHeaders = ${JSON.stringify(staticHostHeaders('document'))};
const staticErrorDocumentHeaders = ${JSON.stringify(staticHostHeaders('errorDocument'))};
const bodylessMethods = new Set(['GET', 'HEAD']);
const headersTimeoutMs = 10_000;
const requestTimeoutMs = 30_000;
const rootedFileCapabilities = new Map();

export function createKovoNodeServer(options = {}) {
  const server = createServer(async (nodeRequest, nodeResponse) => {
    let diagnosticRequestUrl;
    try {
      if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
      if (bodylessMethods.has(nodeRequest.method ?? 'GET')) {
        armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      }
      if (await maybeServeStatic(nodeRequest, nodeResponse)) return;

      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      diagnosticRequestUrl = request.url;
      const response = await handler(request);
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      await writeWebResponseToNode(response, nodeResponse, request.method, {
        httpVersion: nodeRequest.httpVersion,
      });
    } catch (error) {
      logUnhandledNodeError(error, nodeRequest, diagnosticRequestUrl);
      if (nodeResponse.headersSent) {
        nodeResponse.destroy();
      } else {
        armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
        nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        nodeResponse.end('Internal Server Error');
      }
    }
  });
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  return server;
}

function logUnhandledNodeError(error, nodeRequest, webRequestUrl) {
  try {
    const inputs = nodeDiagnosticInputs(nodeRequest, webRequestUrl);
    const method = nodeRequest.method ?? 'UNKNOWN';
    const url = sanitizeDiagnosticUrl(nodeRequest.url ?? '/');
    const detail = safeNodeDiagnosticErrorDetail(error);
    console.error(
      '[kovo] unhandled node server error',
      scrubConsoleValue({ method, url, error: detail }, inputs),
    );
  } catch {
    try {
      console.error('[kovo] unhandled node server error', {
        method: 'UNKNOWN',
        url: '/',
        error: '[redacted]',
      });
    } catch {}
  }
}

function nodeDiagnosticInputs(nodeRequest, webRequestUrl) {
  const urls = [nodeRequest.url ?? '/'];
  if (typeof webRequestUrl === 'string') urls.push(webRequestUrl);
  const secretValues = [];
  for (const url of urls) secretValues.push(...nodeDiagnosticUrlValues(url));

  for (const [name, rawValue] of Object.entries(nodeRequest.headers ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (typeof value !== 'string' || value === '') continue;
      if (nodeDiagnosticNameCarriesUrl(name)) urls.push(value);
      if (!nodeDiagnosticNameCarriesSecret(name)) continue;
      secretValues.push(value, ...nodeDiagnosticAuthorizationValues(value));
      if (normalizeNodeDiagnosticName(name).includes('cookie')) {
        secretValues.push(...nodeDiagnosticCookieValues(value));
      }
    }
  }

  for (const url of urls) secretValues.push(...nodeDiagnosticUrlValues(url));
  return {
    secretValues: [...new Set(secretValues.filter((value) => value !== ''))],
    urls: [...new Set(urls)],
  };
}

function normalizeNodeDiagnosticName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nodeDiagnosticNameCarriesSecret(value) {
  const normalized = normalizeNodeDiagnosticName(value);
  return [
    'access',
    'auth',
    'authorization',
    'cap',
    'code',
    'cookie',
    'credential',
    'csrf',
    'idem',
    'key',
    'password',
    'secret',
    'session',
    'signature',
    'state',
    'token',
  ].some((part) => normalized.includes(part));
}

function nodeDiagnosticNameCarriesUrl(value) {
  const normalized = normalizeNodeDiagnosticName(value);
  return (
    normalized.endsWith('location') ||
    normalized.endsWith('referer') ||
    normalized.endsWith('referrer') ||
    normalized.endsWith('uri') ||
    normalized.endsWith('url')
  );
}

function nodeDiagnosticCookieValues(value) {
  return value.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    const raw = part.slice(separator + 1).trim();
    if (raw === '') return [];
    const unquoted =
      raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replace(/\\\\(["\\\\])/g, '$1')
        : raw;
    try {
      return [...new Set([raw, unquoted, decodeURIComponent(unquoted)])];
    } catch {
      return [...new Set([raw, unquoted])];
    }
  });
}

function nodeDiagnosticAuthorizationValues(value) {
  const match = /^\\s*(basic|bearer|digest|negotiate)\\s+(.+)$/i.exec(value);
  if (!match || !match[1] || !match[2]) return [];
  const scheme = match[1].toLowerCase();
  const payload = match[2].trim();
  const values = [payload];
  if (scheme === 'basic') {
    try {
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      values.push(decoded);
      const separator = decoded.indexOf(':');
      if (separator >= 0) values.push(decoded.slice(0, separator), decoded.slice(separator + 1));
    } catch {}
  }
  if (scheme === 'digest') {
    for (const field of payload.matchAll(/(?:^|,)\\s*[^=,]+=(?:"([^"]*)"|([^,]*))/g)) {
      const fieldValue = (field[1] ?? field[2])?.trim();
      if (fieldValue) values.push(fieldValue);
    }
  }
  return [...new Set(values.filter((item) => item !== ''))];
}

function nodeDiagnosticUrlValues(value) {
  let parsed;
  try {
    parsed = new URL(value, 'https://kovo.invalid');
  } catch {
    return [];
  }
  const values = [...parsed.searchParams.entries()]
    .filter(([key]) => nodeDiagnosticNameCarriesSecret(key))
    .map(([, item]) => item)
    .filter((item) => item !== '');
  const rawValues = parsed.search
    .slice(1)
    .split('&')
    .flatMap((pair) => {
      const separator = pair.indexOf('=');
      if (separator < 0) return [];
      let key = pair.slice(0, separator);
      try {
        key = decodeURIComponent(key.replace(/\\+/g, ' '));
      } catch {}
      return nodeDiagnosticNameCarriesSecret(key) ? [pair.slice(separator + 1)] : [];
    })
    .filter((item) => item !== '');
  return [...values, ...rawValues];
}

function safeNodeDiagnosticErrorDetail(error) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return error;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
      return descriptor.value;
    }
    if (
      descriptor &&
      !('value' in descriptor) &&
      descriptor.get === nativeErrorStackGetter &&
      typeof nativeErrorStackGetter === 'function'
    ) {
      const stack = Reflect.apply(nativeErrorStackGetter, error, []);
      return typeof stack === 'string' ? stack : '[redacted]';
    }
    return error;
  } catch {
    return '[redacted]';
  }
}

function scrubConsoleValue(value, inputs, seen = new WeakMap()) {
  if (isSecretDisplayValue(value)) return '[secret]';
  if (typeof value === 'string') return sanitizeNodeDiagnosticString(value, inputs);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return seen.get(value);
  if (!Array.isArray(value) && !isPlainConsoleObject(value)) return '[redacted]';

  const next = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, next);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const sanitizedKey = sanitizeNodeDiagnosticString(key, inputs);
    const sanitized =
      'value' in descriptor
        ? scrubConsoleValue(descriptor.value, inputs, seen)
        : '[redacted]';
    Object.defineProperty(next, sanitizedKey, {
      configurable: true,
      enumerable: true,
      value: sanitized,
      writable: true,
    });
  }
  return next;
}

function sanitizeNodeDiagnosticString(value, inputs) {
  let sanitized = sanitizeDiagnosticText(value, inputs.urls, sanitizeDiagnosticUrl);
  for (const secretValue of [...inputs.secretValues].sort(
    (left, right) => right.length - left.length,
  )) {
    sanitized = sanitized.replaceAll(secretValue, '[redacted]');
  }
  return sanitized.replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, (char) =>
    '\\\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function isSecretDisplayValue(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, Symbol.toStringTag);
    return !!descriptor && 'value' in descriptor && descriptor.value === 'Secret';
  } catch {
    return false;
  }
}

function isPlainConsoleObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function maybeServeStatic(nodeRequest, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  if (!bodylessMethods.has(method)) return false;

  const pathname = staticPathname(nodeRequest);
  if (pathname === undefined) return false;
  const clientAsset = pathname.startsWith('/c/') || pathname.startsWith('/assets/');
  const immutableAsset = clientAsset && isImmutableStaticAssetPath(pathname);
  let relativePath = clientAsset ? staticRelativePath(pathname) : routeDocumentPath(pathname);
  const root = clientAsset ? clientRoot : staticRoot;

  if (relativePath === undefined) {
    if (!clientAsset) return false;
    nodeResponse.writeHead(403, staticErrorHeaders());
    nodeResponse.end('Forbidden');
    return true;
  }

  let outcome = await serveRootedStaticFile(root, relativePath, {
    ...(clientAsset
      ? pathname.startsWith('/c/')
        ? clientModuleHeaders
        : immutableAsset
          ? immutableAssetHeaders
          : revalidatingAssetHeaders
      : documentStaticHeaders),
  });
  if (!clientAsset && outcome === undefined) {
    relativePath = publicStaticPath(pathname);
    outcome =
      relativePath === undefined
        ? undefined
        : await serveRootedStaticFile(staticRoot, relativePath, revalidatingAssetHeaders);
  }
  if (outcome === undefined) {
    if (!clientAsset) return false;
    nodeResponse.writeHead(404, staticErrorHeaders());
    nodeResponse.end('Not Found');
    return true;
  }

  await writeRouteOutcomeToNode(outcome, nodeResponse, method);
  return true;
}

function staticPathname(nodeRequest) {
  try {
    return new URL(nodeRequest.url ?? '/', 'http://kovo.local').pathname;
  } catch {
    return undefined;
  }
}

function routeDocumentPath(pathname) {
  const cleanPathname = pathname.endsWith('/') ? pathname : pathname + '/';
  return staticRelativePath(cleanPathname + 'index.html');
}

function publicStaticPath(pathname) {
  if (
    pathname === '/_headers' ||
    pathname === '/kovo-static-manifest.json' ||
    pathname.endsWith('/') ||
    pathname.endsWith('/index.html')
  ) {
    return undefined;
  }
  return staticRelativePath(pathname);
}

function staticRelativePath(pathname) {
  try {
    return decodeURIComponent(pathname.slice(1));
  } catch {
    return undefined;
  }
}

async function serveRootedStaticFile(root, relativePath, headers) {
  if (relativePath.includes('\\0')) return undefined;
  const files = await rootedFileCapability(root);
  if (files === undefined) return undefined;
  return files.serve(relativePath, {
    contentType: contentType(relativePath),
    disposition: 'inline',
    headers,
    verifiedSafe: true,
  });
}

async function rootedFileCapability(root) {
  let capability = rootedFileCapabilities.get(root);
  if (capability === undefined) {
    capability = rootedStaticFiles(root).catch((error) => {
      if (isMissingStaticRootError(error)) return undefined;
      throw error;
    });
    rootedFileCapabilities.set(root, capability);
  }
  return capability;
}

function isMissingStaticRootError(error) {
  return (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

async function rootedStaticFiles(root) {
  const realRoot = await realpath(root);
  return Object.freeze({
    root: realRoot,
    serve: (path, options) => serveRootedStaticFileBytes(realRoot, path, options),
  });
}

async function serveRootedStaticFileBytes(realRoot, requestedPath, options) {
  const candidate = rootedStaticCandidate(realRoot, requestedPath);
  if (candidate === undefined) return undefined;
  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(realRoot, resolved)) return undefined;
  const fileStat = await stat(resolved).catch((error) => {
    if (isMissingStaticRootError(error)) return undefined;
    throw error;
  });
  if (fileStat === undefined || !fileStat.isFile()) return undefined;
  return {
    body: await readFile(resolved),
    contentDisposition: routeOutcomeContentDisposition(options, resolved),
    contentType: options.contentType,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    routeResponse: true,
  };
}

function rootedStaticCandidate(realRoot, requestedPath) {
  if (requestedPath.includes('\\0') || isAbsolute(requestedPath)) return undefined;
  const candidate = resolve(realRoot, requestedPath);
  return containsPath(realRoot, candidate) ? candidate : undefined;
}

function containsPath(root, target) {
  return target === root || target.startsWith(root + sep);
}

async function safeRealpath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissingStaticRootError(error)) return undefined;
    throw error;
  }
}

function routeOutcomeContentDisposition(options, resolvedPath) {
  const disposition = options.disposition ?? 'attachment';
  const filename = options.filename ?? basename(resolvedPath);
  return filename
    ? disposition + '; filename="' + contentDispositionFilename(filename) + '"'
    : disposition;
}

function contentDispositionFilename(filename) {
  return filename.replace(/[\\r\\n"]/g, '_');
}

async function writeRouteOutcomeToNode(outcome, nodeResponse, method) {
  const headers = {
    ...safeRouteOutcomeHeaders(outcome.headers),
    'content-disposition': outcome.contentDisposition,
    'content-type': outcome.contentType,
    'x-content-type-options': 'nosniff',
    ...(outcome.etag === undefined ? {} : { etag: outcome.etag }),
  };
  const contentLength = routeOutcomeContentLength(outcome.body);
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  nodeResponse.writeHead(200, headers);
  if (method === 'HEAD') {
    nodeResponse.end();
    return;
  }
  await writeRouteOutcomeBody(outcome.body, nodeResponse);
}

function safeRouteOutcomeHeaders(headers) {
  if (headers === undefined) return {};
  const safeHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (reservedRouteOutcomeHeaderNames.has(name.toLowerCase())) continue;
    safeHeaders[name] = value;
  }
  return safeHeaders;
}

const reservedRouteOutcomeHeaderNames = new Set([
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'set-cookie',
  'x-content-type-options',
]);

function routeOutcomeContentLength(body) {
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) return body.byteLength;
  return undefined;
}

async function writeRouteOutcomeBody(body, nodeResponse) {
  if (typeof body === 'string' || body instanceof Uint8Array) {
    nodeResponse.end(body);
    return;
  }
  if (body instanceof ArrayBuffer) {
    nodeResponse.end(Buffer.from(body));
    return;
  }
  await pipeline(Readable.fromWeb(body), nodeResponse);
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

function staticErrorHeaders() {
  return {
    'content-type': 'text/plain; charset=utf-8',
    ...staticErrorDocumentHeaders,
  };
}

function isImmutableStaticAssetPath(pathname) {
  return pathname.startsWith('/c/') || ${immutableAssetPathPattern}.test(pathname);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  createKovoNodeServer().listen(port, host, () => {
    console.log('Kovo node server listening on http://' + host + ':' + port);
  });
}
`;
}

function nodeDockerfileSource(): string {
  return `FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY package-lock.json* npm-shrinkwrap.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi
COPY . .
EXPOSE 3000
CMD ["node", "server.mjs"]
`;
}

async function emitNodeRuntimePackage(outDir: string): Promise<void> {
  const source = await readPackageJsonForNodeRuntime();
  const runtimePackage = {
    dependencies: source.dependencies ?? {},
    name: `${source.name ?? 'kovo-app'}-server`,
    private: true,
    scripts: { start: 'NODE_ENV=production node server.mjs' },
    type: 'module',
    ...(source.packageManager === undefined ? {} : { packageManager: source.packageManager }),
  };
  await writeFile(
    path.join(outDir, 'package.json'),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
  );
  await copyRuntimeLockfile(outDir);
}

async function readPackageJsonForNodeRuntime(): Promise<{
  dependencies?: Record<string, string>;
  name?: string;
  packageManager?: string;
}> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      name?: string;
      packageManager?: string;
    };
  } catch {
    return {};
  }
}

async function copyRuntimeLockfile(outDir: string): Promise<void> {
  for (const fileName of [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ]) {
    try {
      await copyFile(path.join(process.cwd(), fileName), path.join(outDir, fileName));
      return;
    } catch {
      // Lockfiles are optional for the deploy artifact; package.json still gives Docker an install path.
    }
  }
}
