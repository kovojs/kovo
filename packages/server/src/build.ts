import './security-bootstrap.js';

import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';

import { resolvedFileSystemPath } from './vite-build-assets.js';
import {
  buildSecurityFunctionSource,
  buildSecuritySha256Hex,
  buildSecuritySourceLiteral,
} from './build-security-intrinsics.js';
import type { KovoNeutralBuild } from './neutral-build.js';
import {
  staticHostHeaders,
  staticHostImmutableAssetPathPatternFlags,
  staticHostImmutableAssetPathPatternSource,
} from './static-host-header-policy.js';

const immutableAssetPathPatternSourceLiteral = buildSecuritySourceLiteral(
  staticHostImmutableAssetPathPatternSource,
);
const immutableAssetPathPatternFlagsLiteral = buildSecuritySourceLiteral(
  staticHostImmutableAssetPathPatternFlags,
);
const clientModuleHeadersSource = buildSecuritySourceLiteral(staticHostHeaders('clientModule'));
const immutableAssetHeadersSource = buildSecuritySourceLiteral(staticHostHeaders('immutableAsset'));
const revalidatingAssetHeadersSource = buildSecuritySourceLiteral(
  staticHostHeaders('revalidatingAsset'),
);
const documentStaticHeadersSource = buildSecuritySourceLiteral(staticHostHeaders('document'));
const staticErrorHeadersSource = buildSecuritySourceLiteral(staticHostHeaders('errorDocument'));
const nativeExecFileSync = execFileSync;
const nodeExecutablePath = process.execPath;

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
  const nodeAdapterSource = nodeAdapterRuntimeSource();
  const serverSource = nodeServerSource();
  await writeGeneratedJavaScript(
    path.join(outDir, 'node-adapter.mjs'),
    nodeAdapterSource,
    'module',
  );
  await writeGeneratedJavaScript(path.join(outDir, 'server.mjs'), serverSource, 'module');
  await writeJson(path.join(outDir, 'kovo-artifact-integrity.json'), {
    algorithm: 'sha256',
    files: {
      'node-adapter.mjs': generatedArtifactDigest(nodeAdapterSource),
      'server.mjs': generatedArtifactDigest(serverSource),
    },
  });
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
  const nodeAdapterSource = nodeAdapterRuntimeSource();
  const functionSource = vercelFunctionSource();
  await writeGeneratedJavaScript(
    path.join(functionDir, 'node-adapter.mjs'),
    nodeAdapterSource,
    'module',
  );
  await writeGeneratedJavaScript(path.join(functionDir, 'index.cjs'), functionSource, 'commonjs');
  await writeJson(path.join(functionDir, 'kovo-artifact-integrity.json'), {
    algorithm: 'sha256',
    files: {
      'index.cjs': generatedArtifactDigest(functionSource),
      'node-adapter.mjs': generatedArtifactDigest(nodeAdapterSource),
    },
  });
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
  const workerSource = cloudflareWorkerSource();
  await writeGeneratedJavaScript(path.join(outDir, 'worker.mjs'), workerSource, 'module');
  await writeJson(path.join(outDir, 'kovo-artifact-integrity.json'), {
    algorithm: 'sha256',
    files: {
      'worker.mjs': generatedArtifactDigest(workerSource),
    },
  });
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
  await writeFile(filePath, `${buildSecuritySourceLiteral(value)}\n`, 'utf8');
}

type GeneratedJavaScriptFormat = 'commonjs' | 'module';

async function writeGeneratedJavaScript(
  filePath: string,
  source: string,
  format: GeneratedJavaScriptFormat,
): Promise<void> {
  try {
    nativeExecFileSync(nodeExecutablePath, ['--check', `--input-type=${format}`], {
      encoding: 'utf8',
      input: source,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new TypeError(`Kovo refused to emit invalid generated JavaScript for ${filePath}.`);
  }
  await writeFile(filePath, source, 'utf8');
}

function generatedArtifactDigest(source: string): string {
  return buildSecuritySha256Hex(source);
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
import { IncomingMessage, ServerResponse } from 'node:http';
import { Http2ServerRequest } from 'node:http2';
import { Socket } from 'node:net';

const NativeAbortController = globalThis.AbortController;
const NativeAbortSignal = globalThis.AbortSignal;
const NativeArray = globalThis.Array;
const NativeHeaders = globalThis.Headers;
const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeURL = globalThis.URL;
const NativeWeakMap = globalThis.WeakMap;
const nativeReflectApply = Reflect.apply;
const nativeArrayIsArray = NativeArray.isArray;
const nativeObjectCreate = Object.create;
const nativeObjectDefineProperty = Object.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = Object.getPrototypeOf;
const nativeObjectKeys = Object.keys;
const nativeWeakMapGet = NativeWeakMap.prototype.get;
const nativeWeakMapSet = NativeWeakMap.prototype.set;
const nativeAbortControllerGlobalDescriptor = nativeObjectGetOwnPropertyDescriptor(globalThis, 'AbortController');
const nativeAbortSignalGlobalDescriptor = nativeObjectGetOwnPropertyDescriptor(globalThis, 'AbortSignal');
const nativeHeadersGlobalDescriptor = nativeObjectGetOwnPropertyDescriptor(globalThis, 'Headers');
const nativeRequestGlobalDescriptor = nativeObjectGetOwnPropertyDescriptor(globalThis, 'Request');
const nativeUrlGlobalDescriptor = nativeObjectGetOwnPropertyDescriptor(globalThis, 'URL');
const nativeSetHas = Set.prototype.has;
const nativeHeadersAppend = NativeHeaders.prototype.append;
const nativeHeadersForEach = NativeHeaders.prototype.forEach;
const nativeHeadersGetSetCookie = NativeHeaders.prototype.getSetCookie;
const nativeHeadersSet = NativeHeaders.prototype.set;
const nativeResponseBodyGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'body').get;
const nativeResponseHeadersGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'headers').get;
const nativeResponseStatusGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'status').get;
const nativeResponseStatusTextGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'statusText').get;
const nativeReadableFromWeb = Readable.fromWeb;
const nativeReadableToWeb = Readable.toWeb;
const nativeAbortControllerAbort = stablePrototypeFunction(NativeAbortController.prototype, 'abort');
const nativeAbortControllerSignalGetter = stablePrototypeGetter(NativeAbortController.prototype, 'signal');
const nativeAbortSignalAbortedGetter = stablePrototypeGetter(NativeAbortSignal.prototype, 'aborted');
const nativeIncomingMessageHeadersGetter = stablePrototypeGetter(IncomingMessage.prototype, 'headers');
const nativeIncomingMessageOnce = stablePrototypeFunction(IncomingMessage.prototype, 'once');
const nativeIncomingMessageOff = stablePrototypeFunction(IncomingMessage.prototype, 'off');
const nativeIncomingMessageDestroy = stablePrototypeFunction(IncomingMessage.prototype, 'destroy');
const nativeIncomingMessageDestroyedGetter = stablePrototypeGetter(IncomingMessage.prototype, 'destroyed');
const nativeHttp2ServerRequestHeadersGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'headers');
const nativeHttp2ServerRequestMethodGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'method');
const nativeHttp2ServerRequestUrlGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'url');
const nativeHttp2ServerRequestHttpVersionGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'httpVersion');
const nativeHttp2ServerRequestSocketGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'socket');
const nativeHttp2ServerRequestCompleteGetter = stablePrototypeGetter(Http2ServerRequest.prototype, 'complete');
const nativeSocketOnce = stablePrototypeFunction(Socket.prototype, 'once');
const nativeSocketOff = stablePrototypeFunction(Socket.prototype, 'off');
const nativeSocketRemoteAddressGetter = stablePrototypeGetter(Socket.prototype, 'remoteAddress');
const nativeServerResponseDestroy = stablePrototypeFunction(ServerResponse.prototype, 'destroy');
const nativeServerResponseEnd = stablePrototypeFunction(ServerResponse.prototype, 'end');
const nativeServerResponseHeadersSentGetter = stablePrototypeGetter(ServerResponse.prototype, 'headersSent');
const nativeServerResponseOnce = stablePrototypeFunction(ServerResponse.prototype, 'once');
const nativeServerResponseWrite = stablePrototypeFunction(ServerResponse.prototype, 'write');
const nativeServerResponseWriteEarlyHints = stablePrototypeFunction(ServerResponse.prototype, 'writeEarlyHints');
const nativeServerResponseWriteHead = stablePrototypeFunction(ServerResponse.prototype, 'writeHead');
const nativeUrlHashGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'hash').get;
const nativeUrlHrefGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'href').get;
const nativeUrlOriginGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'origin').get;
const nativeUrlPathnameGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'pathname').get;
const nativeUrlSearchGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'search').get;
const nativeStringTrim = String.prototype.trim;
const bodylessMethods = new Set(['GET', 'HEAD']);
const requestTargetAnalysisOrigin = 'https://kovo.invalid';
const nodeRequestSnapshots = new NativeWeakMap();

export function nodeRequestToWebRequest(nodeRequest, options = {}, nodeResponse) {
  if (nodeResponse) pinNodeResponseTransport(nodeResponse);
  const pinnedNodeRequest = snapshotNodeRequest(nodeRequest);
  const pinnedOptions = snapshotNodeHandlerOptions(options);
  if (unsafeReservedMutationRequestTarget(pinnedNodeRequest.rawTarget)) {
    throw new TypeError('Reserved mutation request targets must use their canonical raw path.');
  }
  const method = pinnedNodeRequest.method;
  const headers = nodeHeadersToWebHeaders(pinnedNodeRequest.headers);
  const controller = new NativeAbortController();
  const signal = apply(nativeAbortControllerSignalGetter, controller, []);
  const abort = () => {
    if (!apply(nativeAbortSignalAbortedGetter, signal, [])) {
      apply(nativeAbortControllerAbort, controller, []);
    }
  };
  const socket = pinnedNodeRequest.socket;
  apply(nativeIncomingMessageOnce, nodeRequest, ['aborted', abort]);
  apply(nativeIncomingMessageOnce, nodeRequest, ['close', abort]);
  apply(nativeSocketOnce, socket, ['close', abort]);
  if (nodeResponse) {
    const cleanup = () => {
      apply(nativeIncomingMessageOff, nodeRequest, ['aborted', abort]);
      apply(nativeIncomingMessageOff, nodeRequest, ['close', abort]);
      apply(nativeSocketOff, socket, ['close', abort]);
    };
    apply(nativeServerResponseOnce, nodeResponse, ['close', cleanup]);
  }
  const init = {
    headers,
    method,
    signal,
    ...(apply(nativeSetHas, bodylessMethods, [method])
      ? {}
      : {
          body: apply(nativeReadableToWeb, Readable, [nodeRequest]),
          duplex: 'half',
        }),
  };

  const request = constructNativeRequest(nodeRequestUrl(pinnedNodeRequest, pinnedOptions), init);
  if (pinnedNodeRequest.peerAddress) {
    apply(nativeObjectDefineProperty, Object, [request, '__kovoPeerAddress', {
      configurable: true,
      value: pinnedNodeRequest.peerAddress,
    }]);
  }
  return request;
}

export function nodeRequestTransportMetadata(nodeRequest) {
  const pinned = snapshotNodeRequest(nodeRequest);
  return { httpVersion: pinned.httpVersion, method: pinned.method };
}

function snapshotNodeHandlerOptions(options) {
  const origin = optionalOwnDataProperty(options, 'origin');
  const trustedProxy = optionalOwnDataProperty(options, 'trustedProxy');
  if (origin !== undefined && typeof origin !== 'string' && typeof origin !== 'function') {
    throw new TypeError('Kovo Node adapter origin must be a string or function.');
  }
  if (trustedProxy !== undefined && typeof trustedProxy !== 'boolean') {
    throw new TypeError('Kovo Node adapter trustedProxy must be a boolean.');
  }
  return {
    ...(origin === undefined ? {} : { origin }),
    ...(trustedProxy === undefined ? {} : { trustedProxy }),
  };
}

function optionalOwnDataProperty(value, property) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [value, property]);
  if (own === undefined) return undefined;
  if (!('value' in own)) {
    throw new TypeError('Kovo Node adapter options must be own data properties.');
  }
  return own.value;
}

function snapshotNodeRequest(nodeRequest) {
  const existing = apply(nativeWeakMapGet, nodeRequestSnapshots, [nodeRequest]);
  if (existing !== undefined) return existing;
  const isHttp2 = hasPrototype(nodeRequest, Http2ServerRequest.prototype);
  const rawTarget = requestStringProperty(
    nodeRequest,
    'url',
    '/',
    isHttp2 ? nativeHttp2ServerRequestUrlGetter : undefined,
  );
  const method = requestStringProperty(
    nodeRequest,
    'method',
    'GET',
    isHttp2 ? nativeHttp2ServerRequestMethodGetter : undefined,
  );
  const httpVersion = requestStringProperty(
    nodeRequest,
    'httpVersion',
    '1.1',
    isHttp2 ? nativeHttp2ServerRequestHttpVersionGetter : undefined,
  );
  const socketDescriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeRequest, 'socket']);
  const socket =
    socketDescriptor === undefined && isHttp2
      ? apply(nativeHttp2ServerRequestSocketGetter, nodeRequest, [])
      : socketDescriptor !== undefined && 'value' in socketDescriptor
        ? socketDescriptor.value
        : undefined;
  if (!socket || typeof socket !== 'object') {
    throw new TypeError('Kovo Node adapter requires a native request socket.');
  }
  const peerDescriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [socket, 'remoteAddress']);
  const remoteAddress =
    peerDescriptor !== undefined
      ? 'value' in peerDescriptor
        ? peerDescriptor.value
        : undefined
      : hasPrototype(socket, Socket.prototype)
        ? apply(nativeSocketRemoteAddressGetter, socket, [])
        : undefined;
  if (remoteAddress !== undefined && typeof remoteAddress !== 'string') {
    throw new TypeError('Kovo Node adapter requires a string socket peer address.');
  }
  const peerAddress =
    typeof remoteAddress === 'string' ? apply(nativeStringTrim, remoteAddress, []) : undefined;
  const encryptedDescriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [socket, 'encrypted']);
  const snapshot = {
    carrier: nodeRequest,
    encrypted:
      encryptedDescriptor !== undefined &&
      'value' in encryptedDescriptor &&
      encryptedDescriptor.value === true,
    headers: snapshotNodeHeaders(nodeRequest),
    httpVersion,
    method,
    ...(peerAddress ? { peerAddress } : {}),
    rawTarget,
    socket,
  };
  apply(nativeWeakMapSet, nodeRequestSnapshots, [nodeRequest, snapshot]);
  return snapshot;
}

function requestStringProperty(value, property, fallback, nativeGetter) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [value, property]);
  const propertyValue =
    own === undefined && nativeGetter !== undefined
      ? apply(nativeGetter, value, [])
      : own !== undefined && 'value' in own
        ? own.value
        : undefined;
  if (propertyValue === undefined) return fallback;
  if (typeof propertyValue !== 'string') {
    throw new TypeError('Kovo Node adapter requires own string request properties.');
  }
  return propertyValue;
}

function constructNativeRequest(input, init) {
  const currentAbortController = apply(nativeObjectGetOwnPropertyDescriptor, Object, [globalThis, 'AbortController']);
  const currentAbortSignal = apply(nativeObjectGetOwnPropertyDescriptor, Object, [globalThis, 'AbortSignal']);
  const currentHeaders = apply(nativeObjectGetOwnPropertyDescriptor, Object, [globalThis, 'Headers']);
  const currentRequest = apply(nativeObjectGetOwnPropertyDescriptor, Object, [globalThis, 'Request']);
  const currentUrl = apply(nativeObjectGetOwnPropertyDescriptor, Object, [globalThis, 'URL']);
  if (!currentAbortController || !currentAbortSignal || !currentHeaders || !currentRequest || !currentUrl) {
    throw new TypeError('Kovo Node adapter web platform constructors are unavailable.');
  }
  try {
    apply(nativeObjectDefineProperty, Object, [globalThis, 'AbortController', nativeAbortControllerGlobalDescriptor]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'AbortSignal', nativeAbortSignalGlobalDescriptor]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'Headers', nativeHeadersGlobalDescriptor]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'Request', nativeRequestGlobalDescriptor]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'URL', nativeUrlGlobalDescriptor]);
    return new NativeRequest(input, init);
  } finally {
    apply(nativeObjectDefineProperty, Object, [globalThis, 'AbortController', currentAbortController]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'AbortSignal', currentAbortSignal]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'Headers', currentHeaders]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'Request', currentRequest]);
    apply(nativeObjectDefineProperty, Object, [globalThis, 'URL', currentUrl]);
  }
}

export function rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse) {
  pinNodeResponseTransport(nodeResponse);
  const pinnedNodeRequest = snapshotNodeRequest(nodeRequest);
  if (!unsafeReservedMutationRequestTarget(pinnedNodeRequest.rawTarget)) return false;
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
  if (nodeRequestComplete(nodeRequest) || nodeRequestDestroyed(nodeRequest) || nodeResponseDestroyed(nodeResponse)) return;

  const shouldKeepAlive = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeResponse, 'shouldKeepAlive']);
  if (shouldKeepAlive !== undefined && !('value' in shouldKeepAlive)) {
    throw new TypeError('Kovo Node adapter requires an own keep-alive state property.');
  }
  apply(nativeObjectDefineProperty, Object, [nodeResponse, 'shouldKeepAlive', {
    ...(shouldKeepAlive ?? { configurable: true, enumerable: true, writable: true }),
    value: false,
  }]);
  const closeIncompleteRequest = () => {
    if (!nodeRequestComplete(nodeRequest) && !nodeRequestDestroyed(nodeRequest)) {
      apply(nativeIncomingMessageDestroy, nodeRequest, []);
    }
  };
  apply(nativeServerResponseOnce, nodeResponse, ['finish', closeIncompleteRequest]);
  apply(nativeServerResponseOnce, nodeResponse, ['close', closeIncompleteRequest]);
}

function nodeRequestComplete(nodeRequest) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeRequest, 'complete']);
  if (own !== undefined) return 'value' in own && own.value === true;
  if (!hasPrototype(nodeRequest, Http2ServerRequest.prototype)) return false;
  return apply(nativeHttp2ServerRequestCompleteGetter, nodeRequest, []) === true;
}

function nodeRequestDestroyed(nodeRequest) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeRequest, 'destroyed']);
  if (own !== undefined) return 'value' in own && own.value === true;
  if (!hasPrototype(nodeRequest, IncomingMessage.prototype) && !hasPrototype(nodeRequest, Http2ServerRequest.prototype)) return false;
  return apply(nativeIncomingMessageDestroyedGetter, nodeRequest, []) === true;
}

function nodeResponseDestroyed(nodeResponse) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeResponse, 'destroyed']);
  return own !== undefined && 'value' in own && own.value === true;
}

function unsafeReservedMutationRequestTarget(rawTarget) {
  if (typeof rawTarget !== 'string') return true;
  const absoluteForm = rawRequestTargetHasScheme(rawTarget);
  const pathname = rawNodeRequestTargetPathname(rawTarget);
  const comparablePathname = rawRequestTargetSlashPath(pathname);
  const rootedPathname = rootedRawRequestTargetPath(comparablePathname);
  let normalizedPathname;
  try {
    normalizedPathname = urlPathname(new NativeURL(rootedPathname, requestTargetAnalysisOrigin));
  } catch {
    return false;
  }
  if (!isReservedMutationPath(normalizedPathname)) return false;
  return absoluteForm || pathname !== normalizedPathname || rawRequestTargetHasBackslash(pathname) || rawRequestTargetHasEncodedPathControl(pathname);
}

function rawNodeRequestTargetPathname(rawTarget) {
  let end = rawTarget.length;
  for (let index = 0; index < rawTarget.length; index += 1) {
    const character = rawTarget[index];
    if (character === '?' || character === '#') {
      end = index;
      break;
    }
  }

  let scheme = -1;
  for (let index = 0; index + 2 < end; index += 1) {
    if (rawTarget[index] === ':' && rawTarget[index + 1] === '/' && rawTarget[index + 2] === '/') {
      scheme = index;
      break;
    }
  }
  if (scheme < 0) return rawRequestTargetRange(rawTarget, 0, end);

  let path = -1;
  for (let index = scheme + 3; index < end; index += 1) {
    if (rawTarget[index] === '/' || rawTarget[index] === '\\\\') {
      path = index;
      break;
    }
  }
  return path < 0 ? '/' : rawRequestTargetRange(rawTarget, path, end);
}

function rawRequestTargetRange(value, start, end) {
  let result = '';
  for (let index = start; index < end; index += 1) result += value[index];
  return result;
}

function rawRequestTargetHasScheme(value) {
  if (value.length < 2 || !isAsciiAlpha(value[0])) return false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === ':') return true;
    if (!isAsciiAlpha(character) && !(character >= '0' && character <= '9') && character !== '+' && character !== '-' && character !== '.') return false;
  }
  return false;
}

function isAsciiAlpha(character) {
  return character !== undefined && ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z'));
}

function rawRequestTargetSlashPath(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) result += value[index] === '\\\\' ? '/' : value[index];
  return result;
}

function rootedRawRequestTargetPath(value) {
  let first = 0;
  while (first < value.length && value[first] === '/') first += 1;
  return '/' + rawRequestTargetRange(value, first, value.length);
}

function isReservedMutationPath(value) {
  if (value === '/_m') return true;
  return value.length >= 4 && value[0] === '/' && value[1] === '_' && value[2] === 'm' && value[3] === '/';
}

function rawRequestTargetHasBackslash(value) {
  for (let index = 0; index < value.length; index += 1) if (value[index] === '\\\\') return true;
  return false;
}

function rawRequestTargetHasEncodedPathControl(value) {
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (value[index] !== '%') continue;
    const first = value[index + 1];
    const second = value[index + 2];
    if (first === '2' && (second === 'e' || second === 'E' || second === 'f' || second === 'F')) return true;
    if (first === '5' && (second === 'c' || second === 'C')) return true;
  }
  return false;
}

export async function writeWebResponseToNode(response, nodeResponse, method = 'GET', options = {}) {
  pinNodeResponseTransport(nodeResponse);
  // SPEC §6.6 rule 5: read the complete authored Response exactly once through boot-captured
  // accessors. The transport never consults its mutable prototype again after this snapshot.
  const pinnedResponse = snapshotWebResponse(response);
  const responseHeaders = pinnedResponse.headers;
  if (nodeResponse.shouldKeepAlive === false && options.httpVersion !== '2.0') {
    apply(nativeHeadersSet, responseHeaders, ['connection', 'close']);
  }
  const headers = responseHeadersToNodeHeaders(responseHeaders);

  nodeResponse.writeHead(pinnedResponse.status, pinnedResponse.statusText, headers);
  if (method === 'HEAD' || pinnedResponse.body === null) {
    nodeResponse.end();
    return;
  }

  await pipeline(apply(nativeReadableFromWeb, Readable, [pinnedResponse.body]), nodeResponse);
}

function snapshotWebResponse(response) {
  const sourceHeaders = apply(nativeResponseHeadersGetter, response, []);
  const headers = new NativeHeaders();
  apply(nativeHeadersForEach, sourceHeaders, [(value, name) => {
    if (name !== 'set-cookie') apply(nativeHeadersSet, headers, [name, value]);
  }]);
  const setCookies = apply(nativeHeadersGetSetCookie, sourceHeaders, []);
  for (let index = 0; index < setCookies.length; index += 1) {
    apply(nativeHeadersAppend, headers, ['set-cookie', setCookies[index]]);
  }
  return {
    body: apply(nativeResponseBodyGetter, response, []),
    headers,
    status: apply(nativeResponseStatusGetter, response, []),
    statusText: apply(nativeResponseStatusTextGetter, response, []),
  };
}

function nodeRequestUrl(nodeRequest, options) {
  const rawUrl = nodeRequest.rawTarget;
  const origin =
    typeof options.origin === 'function'
      ? options.origin(nodeRequest.carrier)
      : (options.origin ?? defaultOrigin(nodeRequest, options));

  const originUrl = new NativeURL(origin);
  const pinnedOrigin = urlOrigin(originUrl);
  if (pinnedOrigin === 'null') throw new TypeError('Node adapter origin must be hierarchical.');
  const absolute = rawRequestTargetHasScheme(rawUrl);
  const pathTarget = absolute
    ? new NativeURL(rawUrl)
    : new NativeURL(canonicalRelativeRequestTarget(rawUrl), requestTargetAnalysisOrigin);
  const pathname = urlPathname(pathTarget);
  const assembled = new NativeURL(
    pinnedOrigin + (pathname[0] === '/' ? '' : '/') + pathname + urlSearch(pathTarget) + urlHash(pathTarget),
  );
  return urlHref(assembled);
}

function canonicalRelativeRequestTarget(rawTarget) {
  if (rawTarget[0] !== '/' && rawTarget[0] !== '\\\\') return rawTarget;
  let first = 0;
  while (first < rawTarget.length && (rawTarget[first] === '/' || rawTarget[first] === '\\\\')) first += 1;
  return '/' + rawRequestTargetRange(rawTarget, first, rawTarget.length);
}

function apply(fn, receiver, args) {
  return nativeReflectApply(fn, receiver, args);
}

function stablePrototypeFunction(prototype, property) {
  let owner = prototype;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [owner, property]);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError('Kovo generated Node transport control is unavailable.');
      }
      return descriptor.value;
    }
    owner = apply(nativeObjectGetPrototypeOf, Object, [owner]);
  }
  throw new TypeError('Kovo generated Node transport control is unavailable.');
}

function stablePrototypeGetter(prototype, property) {
  let owner = prototype;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [owner, property]);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError('Kovo generated Node transport getter is unavailable.');
      }
      return descriptor.get;
    }
    owner = apply(nativeObjectGetPrototypeOf, Object, [owner]);
  }
  throw new TypeError('Kovo generated Node transport getter is unavailable.');
}

function pinNodeResponseTransport(nodeResponse) {
  pinNodeResponseMethod(nodeResponse, 'destroy', nativeServerResponseDestroy);
  pinNodeResponseMethod(nodeResponse, 'end', nativeServerResponseEnd);
  pinNodeResponseMethod(nodeResponse, 'write', nativeServerResponseWrite);
  pinNodeResponseMethod(nodeResponse, 'writeEarlyHints', nativeServerResponseWriteEarlyHints);
  pinNodeResponseMethod(nodeResponse, 'writeHead', nativeServerResponseWriteHead);
  if (apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeResponse, 'headersSent']) === undefined) {
    apply(nativeObjectDefineProperty, Object, [nodeResponse, 'headersSent', {
      configurable: true,
      get() { return apply(nativeServerResponseHeadersSentGetter, this, []); },
    }]);
  }
}

function pinNodeResponseMethod(nodeResponse, property, value) {
  if (apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeResponse, property]) !== undefined) {
    return;
  }
  apply(nativeObjectDefineProperty, Object, [nodeResponse, property, {
    configurable: true,
    value,
    writable: false,
  }]);
}

function urlHash(url) { return apply(nativeUrlHashGetter, url, []); }
function urlHref(url) { return apply(nativeUrlHrefGetter, url, []); }
function urlOrigin(url) { return apply(nativeUrlOriginGetter, url, []); }
function urlPathname(url) { return apply(nativeUrlPathnameGetter, url, []); }
function urlSearch(url) { return apply(nativeUrlSearchGetter, url, []); }

function defaultOrigin(nodeRequest, options) {
  // E2 (SPEC §9.5): under HTTP/2 the \`Host\` header is often absent — the authority lives in
  // the \`:authority\` pseudo-header instead. Fall back to it (then \`:scheme\`) so URL resolution
  // works for HTTP/2 requests, not just HTTP/1.1.
  const host = firstHeaderValue(nodeRequest.headers.host) ?? firstHeaderValue(nodeRequest.headers[':authority']) ?? '127.0.0.1';
  const forwardedProto = options.trustedProxy
    ? firstHeaderValue(nodeRequest.headers['x-forwarded-proto'])
    : undefined;
  const pseudoScheme = firstHeaderValue(nodeRequest.headers[':scheme']);
  const proto =
    forwardedProto ??
    pseudoScheme ??
    (nodeRequest.encrypted ? 'https' : 'http');

  return (proto === 'https' ? 'https' : 'http') + '://' + host;
}

function snapshotNodeHeaders(nodeRequest) {
  const own = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeRequest, 'headers']);
  let source;
  if (own !== undefined) {
    if (!('value' in own) || !own.value || typeof own.value !== 'object') {
      throw new TypeError('Kovo Node adapter requires an own header bag or native headers getter.');
    }
    source = own.value;
  } else {
    const headersGetter = hasPrototype(nodeRequest, IncomingMessage.prototype)
      ? nativeIncomingMessageHeadersGetter
      : hasPrototype(nodeRequest, Http2ServerRequest.prototype)
        ? nativeHttp2ServerRequestHeadersGetter
        : undefined;
    if (headersGetter === undefined) {
      throw new TypeError('Kovo Node adapter received an unsupported request carrier.');
    }
    source = apply(headersGetter, nodeRequest, []);
    if (!source || typeof source !== 'object') {
      throw new TypeError('Kovo Node adapter could not snapshot request headers.');
    }
  }
  const snapshot = apply(nativeObjectCreate, Object, [null]);
  const names = apply(nativeObjectKeys, Object, [source]);
  for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
    const name = apply(nativeObjectGetOwnPropertyDescriptor, Object, [names, nameIndex])?.value;
    if (typeof name !== 'string') throw new TypeError('Invalid Node header-name list.');
    const sourceDescriptor = apply(nativeObjectGetOwnPropertyDescriptor, Object, [source, name]);
    if (sourceDescriptor === undefined || !('value' in sourceDescriptor)) {
      throw new TypeError('Kovo Node adapter requires own header data properties.');
    }
    const value = sourceDescriptor.value;
    let copied;
    if (value === undefined || typeof value === 'string') {
      copied = value;
    } else if (apply(nativeArrayIsArray, NativeArray, [value])) {
      copied = [];
      for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
        const entry = apply(nativeObjectGetOwnPropertyDescriptor, Object, [value, valueIndex])?.value;
        if (typeof entry !== 'string') {
          throw new TypeError('Kovo Node adapter requires dense string header arrays.');
        }
        apply(nativeObjectDefineProperty, Object, [copied, valueIndex, {
          configurable: true,
          enumerable: true,
          value: entry,
          writable: true,
        }]);
      }
    } else {
      throw new TypeError('Kovo Node adapter requires string header values.');
    }
    apply(nativeObjectDefineProperty, Object, [snapshot, name, {
      enumerable: true,
      value: copied,
    }]);
  }
  return snapshot;
}

function nodeHeadersToWebHeaders(nodeHeaders) {
  const headers = new NativeHeaders();
  const names = apply(nativeObjectKeys, Object, [nodeHeaders]);
  for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
    const name = apply(nativeObjectGetOwnPropertyDescriptor, Object, [names, nameIndex])?.value;
    const value = apply(nativeObjectGetOwnPropertyDescriptor, Object, [nodeHeaders, name])?.value;
    if (value === undefined) continue;
    // E2 (SPEC §9.5): under Node's HTTP/2 compat API \`nodeRequest.headers\` carries pseudo-headers
    // (\`:path\`/\`:method\`/\`:authority\`/\`:scheme\`). The web \`Headers\` constructor throws on any
    // name starting with \`:\`, so copying them unfiltered 500'd every HTTP/2 request. Skip them
    // — they are addressed via \`nodeRequest.method\`/\`nodeRequest.url\`/the \`:authority\` URL fallback.
    if (name[0] === ':') continue;
    if (apply(nativeArrayIsArray, NativeArray, [value])) {
      for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
        const entry = apply(nativeObjectGetOwnPropertyDescriptor, Object, [value, valueIndex])?.value;
        if (typeof entry !== 'string') {
          throw new TypeError('Kovo Node adapter requires dense string header arrays.');
        }
        apply(nativeHeadersAppend, headers, [name, entry]);
      }
    } else {
      if (typeof value !== 'string') {
        throw new TypeError('Kovo Node adapter requires string header values.');
      }
      apply(nativeHeadersSet, headers, [name, value]);
    }
  }
  return headers;
}

function responseHeadersToNodeHeaders(headers) {
  // SPEC §9.4/§9.1.1: Node's writeHead accepts string[] for multi-value headers.
  // Headers.forEach combines set-cookie into one entry (comma-joined), so handle
  // it separately via getSetCookie() which preserves each cookie as a distinct value.
  const nodeHeaders = apply(nativeObjectCreate, Object, [null]);
  const setCookies = apply(nativeHeadersGetSetCookie, headers, []);
  if (setCookies.length > 0) {
    apply(nativeObjectDefineProperty, Object, [nodeHeaders, 'set-cookie', {
      enumerable: true,
      value: setCookies,
    }]);
  }
  apply(nativeHeadersForEach, headers, [(value, name) => {
    if (name === 'set-cookie') return;
    apply(nativeObjectDefineProperty, Object, [nodeHeaders, name, {
      enumerable: true,
      value,
    }]);
  }]);
  return nodeHeaders;
}

function firstHeaderValue(value) {
  if (!apply(nativeArrayIsArray, NativeArray, [value])) return value;
  const first = apply(nativeObjectGetOwnPropertyDescriptor, Object, [value, 0])?.value;
  return typeof first === 'string' ? first : undefined;
}

function hasPrototype(value, expected) {
  let current = value;
  for (let depth = 0; current !== null && depth < 16; depth += 1) {
    if (current === expected) return true;
    current = apply(nativeObjectGetPrototypeOf, Object, [current]);
  }
  return false;
}
`;
}

function vercelFunctionSource(): string {
  return `const NativeRegExp = globalThis.RegExp;
const nativeReflectApply = Reflect.apply;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeStringStartsWith = String.prototype.startsWith;
const immutableAssetPathPattern = new NativeRegExp(${immutableAssetPathPatternSourceLiteral}, ${immutableAssetPathPatternFlagsLiteral});
let handlerPromise;
let nodeAdapterPromise;

module.exports = async function kovoVercelFunction(nodeRequest, nodeResponse) {
  let closeIncompleteRequest;
  try {
    const {
      armIncompleteNodeRequestClose,
      nodeRequestToWebRequest,
      nodeRequestTransportMetadata,
      rejectUnsafeNodeMutationTarget,
      writeWebResponseToNode,
    } = await loadNodeAdapter();
    closeIncompleteRequest = armIncompleteNodeRequestClose;
    if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
    const transport = nodeRequestTransportMetadata(nodeRequest);
    const handler = await loadHandler();
    const request = nodeRequestToWebRequest(nodeRequest, {}, nodeResponse);
    const response = await handler(request);
    closeIncompleteRequest(nodeRequest, nodeResponse);
    await writeWebResponseToNode(response, nodeResponse, transport.method, {
      httpVersion: transport.httpVersion,
    });
  } catch {
    if (nodeResponse.headersSent) {
      nodeResponse.destroy();
    } else {
      closeIncompleteRequest?.(nodeRequest, nodeResponse);
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
function isImmutableStaticAssetPath(pathname) {
  return nativeReflectApply(nativeStringStartsWith, pathname, ['/c/']) ||
    nativeReflectApply(nativeRegExpExec, immutableAssetPathPattern, [pathname]) !== null;
}
`;
}

function cloudflareWorkerSource(): string {
  return `const NativeHeaders = globalThis.Headers;
const NativeObject = globalThis.Object;
const NativeRegExp = globalThis.RegExp;
const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeURL = globalThis.URL;
const nativeReflectApply = Reflect.apply;
const nativeHeadersAppend = NativeHeaders.prototype.append;
const nativeHeadersForEach = NativeHeaders.prototype.forEach;
const nativeHeadersGetSetCookie = NativeHeaders.prototype.getSetCookie;
const nativeHeadersSet = NativeHeaders.prototype.set;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeObjectKeys = NativeObject.keys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRequestMethodGetter = nativeObjectGetOwnPropertyDescriptor(NativeRequest.prototype, 'method').get;
const nativeRequestUrlGetter = nativeObjectGetOwnPropertyDescriptor(NativeRequest.prototype, 'url').get;
const nativeResponseBodyGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'body').get;
const nativeResponseHeadersGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'headers').get;
const nativeResponseStatusGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'status').get;
const nativeResponseStatusTextGetter = nativeObjectGetOwnPropertyDescriptor(NativeResponse.prototype, 'statusText').get;
const nativeStringStartsWith = String.prototype.startsWith;
const nativeUrlPathnameGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'pathname').get;
const immutableAssetPathPattern = new NativeRegExp(${immutableAssetPathPatternSourceLiteral}, ${immutableAssetPathPatternFlagsLiteral});
const clientModuleHeaders = ${clientModuleHeadersSource};
const immutableAssetHeaders = ${immutableAssetHeadersSource};
const revalidatingAssetHeaders = ${revalidatingAssetHeadersSource};
const documentStaticHeaders = ${documentStaticHeadersSource};
const staticErrorHeaders = ${staticErrorHeadersSource};
let handlerPromise;

export default {
  async fetch(request, env) {
    const method = apply(nativeRequestMethodGetter, request, []);
    const requestUrl = apply(nativeRequestUrlGetter, request, []);
    const url = new NativeURL(requestUrl);
    const pathname = apply(nativeUrlPathnameGetter, url, []);
    const assets = ownDataValue(env, 'ASSETS');
    if (isBodylessMethod(method) && assets !== undefined) {
      const assetFetch = ownDataValue(assets, 'fetch');
      if (typeof assetFetch !== 'function') {
        throw new TypeError('Kovo Cloudflare ASSETS binding requires an own fetch method.');
      }
      const assetResponse = await apply(assetFetch, assets, [request]);
      const status = apply(nativeResponseStatusGetter, assetResponse, []);
      if (status !== 404) {
        const headers = cloneHeaders(apply(nativeResponseHeadersGetter, assetResponse, []));
        if (status >= 400) {
          applyHeaders(headers, staticErrorHeaders);
        } else if (stringStartsWith(pathname, '/c/')) {
          applyHeaders(headers, clientModuleHeaders);
        } else if (isImmutableStaticAssetPath(pathname)) {
          applyHeaders(headers, immutableAssetHeaders);
        } else if (stringStartsWith(pathname, '/assets/')) {
          applyHeaders(headers, revalidatingAssetHeaders);
        } else {
          applyHeaders(headers, documentStaticHeaders);
        }
        return new NativeResponse(apply(nativeResponseBodyGetter, assetResponse, []), {
          headers,
          status,
          statusText: apply(nativeResponseStatusTextGetter, assetResponse, []),
        });
      }
    }

    const handler = await loadHandler();
    return handler(request);
  },
};

function apply(fn, receiver, args) {
  return nativeReflectApply(fn, receiver, args);
}

function sameDataDescriptor(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return 'value' in left && 'value' in right &&
    apply(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable;
}

function ownDataValue(value, property) {
  const before = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  const after = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  if (!sameDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    return undefined;
  }
  return before.value;
}

async function importHandler() {
  const module = await import('./server/handler.mjs');
  return module.default;
}

function loadHandler() {
  handlerPromise ??= importHandler();
  return handlerPromise;
}

function cloneHeaders(source) {
  const headers = new NativeHeaders();
  const preserveSetCookie = typeof nativeHeadersGetSetCookie === 'function';
  apply(nativeHeadersForEach, source, [(value, name) => {
    if (!preserveSetCookie || name !== 'set-cookie') {
      apply(nativeHeadersSet, headers, [name, value]);
    }
  }]);
  if (preserveSetCookie) {
    const setCookies = apply(nativeHeadersGetSetCookie, source, []);
    for (let index = 0; index < setCookies.length; index += 1) {
      apply(nativeHeadersAppend, headers, ['set-cookie', setCookies[index]]);
    }
  }
  return headers;
}

function isBodylessMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function applyHeaders(headers, policy) {
  const names = apply(nativeObjectKeys, NativeObject, [policy]);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    apply(nativeHeadersSet, headers, [name, ownDataValue(policy, name)]);
  }
}

function stringStartsWith(value, prefix) {
  return apply(nativeStringStartsWith, value, [prefix]);
}

function isImmutableStaticAssetPath(pathname) {
  return stringStartsWith(pathname, '/c/') ||
    apply(nativeRegExpExec, immutableAssetPathPattern, [pathname]) !== null;
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
  return buildSecuritySourceLiteral(value);
}

/**
 * Closure-complete logging membrane embedded in generated Node output. The factory is evaluated
 * before the app handler is dynamically imported, so all controls are captured before evaluated
 * app code can replace shared-realm globals or prototypes (SPEC §6.6).
 */
function generatedNodeDiagnosticFactory(): (
  error: unknown,
  nodeRequest: {
    headers?: Record<string, string | readonly string[] | undefined>;
    method?: string;
    url?: string;
  },
  webRequestUrl?: string,
) => { error: unknown; method: string; url: string } {
  const NativeArray = globalThis.Array;
  const NativeBuffer = Buffer;
  const NativeError = globalThis.Error;
  const NativeObject = globalThis.Object;
  const NativeReflect = globalThis.Reflect;
  const NativeString = globalThis.String;
  const NativeURL = globalThis.URL;
  const NativeURLSearchParams = globalThis.URLSearchParams;
  const NativeWeakMap = globalThis.WeakMap;
  const nativeArrayIsArray = NativeArray.isArray;
  const nativeBufferFrom = NativeBuffer.from;
  const nativeBufferToString = NativeBuffer.prototype.toString;
  const nativeDecodeURIComponent = globalThis.decodeURIComponent;
  const nativeEncodeURIComponent = globalThis.encodeURIComponent;
  const nativeObjectCreate = NativeObject.create;
  const nativeObjectDefineProperty = NativeObject.defineProperty;
  const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
  const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
  const nativeObjectKeys = NativeObject.keys;
  const nativeObjectPrototype = NativeObject.prototype;
  const nativeReflectApply = NativeReflect.apply;
  const nativeReflectConstruct = NativeReflect.construct;
  const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
  const nativeStringFromCharCode = NativeString.fromCharCode;
  const nativeStringIndexOf = NativeString.prototype.indexOf;
  const nativeStringSlice = NativeString.prototype.slice;
  const nativeWeakMapGet = NativeWeakMap.prototype.get;
  const nativeWeakMapSet = NativeWeakMap.prototype.set;

  function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
    return nativeReflectApply(fn, receiver, args) as Return;
  }

  function descriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
    return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  }

  function getter(prototype: object, property: PropertyKey): Function | undefined {
    return descriptor(prototype, property)?.get;
  }

  const nativeUrlHashGetter = getter(NativeURL.prototype, 'hash');
  const nativeUrlHrefGetter = getter(NativeURL.prototype, 'href');
  const nativeUrlPathnameGetter = getter(NativeURL.prototype, 'pathname');
  const nativeUrlSearchGetter = getter(NativeURL.prototype, 'search');
  const nativeUrlSearchParamsGetter = getter(NativeURL.prototype, 'searchParams');
  const nativeUrlSearchParamsEntries = NativeURLSearchParams.prototype.entries;
  const nativeUrlSearchParamsKeys = NativeURLSearchParams.prototype.keys;
  let nativeUrlSearchParamsIteratorNext: Function | undefined;
  try {
    const probe = new NativeURLSearchParams('probe=value');
    const iterator = apply<IterableIterator<string>>(nativeUrlSearchParamsKeys, probe, []);
    nativeUrlSearchParamsIteratorNext = iterator.next;
  } catch {
    nativeUrlSearchParamsIteratorNext = undefined;
  }
  const errorStackGetter = descriptor(new NativeError('probe'), 'stack')?.get;

  function append<Value>(values: Value[], value: Value): void {
    apply(nativeObjectDefineProperty, NativeObject, [
      values,
      values.length,
      {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      },
    ]);
  }

  function controlsAreSound(): boolean {
    try {
      const record = { value: 'ok' };
      const weak = new NativeWeakMap<object, unknown>();
      apply(nativeWeakMapSet, weak, [record, record]);
      const parts = diagnosticUrlParts('/probe?code=secret&next=value#fragment');
      return (
        apply(nativeArrayIsArray, NativeArray, [[]]) === true &&
        apply(nativeArrayIsArray, NativeArray, [{}]) === false &&
        descriptor(record, 'value')?.value === 'ok' &&
        apply(nativeWeakMapGet, weak, [record]) === record &&
        apply(nativeStringIndexOf, 'safe token', ['token', 0]) === 5 &&
        apply(nativeStringSlice, 'safe token', [5]) === 'token' &&
        apply(nativeStringCharCodeAt, '\n', [0]) === 10 &&
        parts?.pathname === '/probe' &&
        parts.encodedQueryKeys[0] === 'code' &&
        parts.encodedQueryKeys[1] === 'next'
      );
    } catch {
      return false;
    }
  }

  function assertControls(): void {
    if (!controlsSound) {
      throw new TypeError('Generated Node diagnostic controls are unavailable.');
    }
  }

  function constructUrl(value: string): URL {
    return apply(nativeReflectConstruct, NativeReflect, [
      NativeURL,
      [value, 'https://kovo.invalid'],
    ]);
  }

  interface DiagnosticUrlParts {
    encodedQueryKeys: string[];
    entries: Array<readonly [string, string]>;
    hash: string;
    href: string;
    pathname: string;
    search: string;
  }

  function diagnosticUrlParts(value: string): DiagnosticUrlParts | undefined {
    try {
      if (
        nativeUrlHashGetter === undefined ||
        nativeUrlHrefGetter === undefined ||
        nativeUrlPathnameGetter === undefined ||
        nativeUrlSearchGetter === undefined ||
        nativeUrlSearchParamsGetter === undefined ||
        nativeUrlSearchParamsIteratorNext === undefined
      ) {
        return undefined;
      }
      const url = constructUrl(value);
      const searchParams = apply<URLSearchParams>(nativeUrlSearchParamsGetter, url, []);
      const keyIterator = apply<IterableIterator<string>>(
        nativeUrlSearchParamsKeys,
        searchParams,
        [],
      );
      const encodedQueryKeys: string[] = [];
      for (;;) {
        const result = apply<IteratorResult<string>>(
          nativeUrlSearchParamsIteratorNext,
          keyIterator,
          [],
        );
        if (result.done) break;
        append(encodedQueryKeys, apply(nativeEncodeURIComponent, undefined, [result.value]));
      }
      const entryIterator = apply<IterableIterator<[string, string]>>(
        nativeUrlSearchParamsEntries,
        searchParams,
        [],
      );
      const entries: Array<readonly [string, string]> = [];
      for (;;) {
        const result = apply<IteratorResult<[string, string]>>(
          nativeUrlSearchParamsIteratorNext,
          entryIterator,
          [],
        );
        if (result.done) break;
        append(entries, [result.value[0], result.value[1]]);
      }
      return {
        encodedQueryKeys,
        entries,
        hash: apply(nativeUrlHashGetter, url, []),
        href: apply(nativeUrlHrefGetter, url, []),
        pathname: apply(nativeUrlPathnameGetter, url, []),
        search: apply(nativeUrlSearchGetter, url, []),
      };
    } catch {
      return undefined;
    }
  }

  const controlsSound = controlsAreSound();

  function sanitizeUrl(value: string): string {
    assertControls();
    const parts = diagnosticUrlParts(value);
    if (parts === undefined) return '/';
    let query = '';
    for (let index = 0; index < parts.encodedQueryKeys.length; index += 1) {
      query += `${index === 0 ? '?' : '&'}${parts.encodedQueryKeys[index]}`;
    }
    return `${parts.pathname}${query}`;
  }

  function replaceAllLiteral(value: string, search: string, replacement: string): string {
    if (search === '') return value;
    let result = '';
    let cursor = 0;
    for (;;) {
      const match = apply<number>(nativeStringIndexOf, value, [search, cursor]);
      if (match < 0) return result + apply<string>(nativeStringSlice, value, [cursor]);
      result += apply<string>(nativeStringSlice, value, [cursor, match]) + replacement;
      cursor = match + search.length;
    }
  }

  function hasAbsoluteScheme(value: string): boolean {
    if (value.length < 2 || !asciiAlpha(charCode(value, 0))) return false;
    for (let index = 1; index < value.length; index += 1) {
      const code = charCode(value, index);
      if (code === 0x3a) return true;
      if (
        !asciiAlpha(code) &&
        !(code >= 0x30 && code <= 0x39) &&
        code !== 0x2b &&
        code !== 0x2d &&
        code !== 0x2e
      ) {
        return false;
      }
    }
    return false;
  }

  function sanitizeText(value: string, requestUrls: readonly string[]): string {
    let result = value;
    const replacements: Array<readonly [string, string]> = [];
    for (let index = 0; index < requestUrls.length; index += 1) {
      const requestUrl = requestUrls[index]!;
      const parts = diagnosticUrlParts(requestUrl);
      if (parts === undefined) continue;
      const safe = sanitizeUrl(requestUrl);
      insertReplacement(replacements, requestUrl, safe);
      insertReplacement(replacements, `${parts.pathname}${parts.search}${parts.hash}`, safe);
      if (hasAbsoluteScheme(requestUrl)) insertReplacement(replacements, parts.href, safe);
    }
    for (let index = 0; index < replacements.length; index += 1) {
      const replacement = replacements[index]!;
      if (replacement[0] !== '' && replacement[0] !== replacement[1]) {
        result = replaceAllLiteral(result, replacement[0], replacement[1]);
      }
    }
    return result;
  }

  function insertReplacement(
    replacements: Array<readonly [string, string]>,
    unsafe: string,
    safe: string,
  ): void {
    let index = replacements.length;
    while (index > 0 && replacements[index - 1]![0].length < unsafe.length) {
      replacements[index] = replacements[index - 1]!;
      index -= 1;
    }
    replacements[index] = [unsafe, safe];
  }

  function charCode(value: string, index: number): number {
    return apply(nativeStringCharCodeAt, value, [index]);
  }

  function asciiAlpha(code: number): boolean {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  }

  function asciiLower(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index += 1) {
      const code = charCode(value, index);
      result +=
        code >= 0x41 && code <= 0x5a
          ? apply<string>(nativeStringFromCharCode, NativeString, [code + 0x20])
          : apply<string>(nativeStringSlice, value, [index, index + 1]);
    }
    return result;
  }

  function normalizeName(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index += 1) {
      let code = charCode(value, index);
      if (code >= 0x41 && code <= 0x5a) code += 0x20;
      if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) {
        result += apply<string>(nativeStringFromCharCode, NativeString, [code]);
      }
    }
    return result;
  }

  const secretNameParts = [
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
  ];

  function nameCarriesSecret(value: string): boolean {
    const normalized = normalizeName(value);
    for (let index = 0; index < secretNameParts.length; index += 1) {
      if (apply<number>(nativeStringIndexOf, normalized, [secretNameParts[index]!, 0]) >= 0) {
        return true;
      }
    }
    return false;
  }

  function nameCarriesUrl(value: string): boolean {
    const normalized = normalizeName(value);
    const endings = ['location', 'referer', 'referrer', 'uri', 'url'];
    for (let index = 0; index < endings.length; index += 1) {
      const ending = endings[index]!;
      if (
        normalized.length >= ending.length &&
        apply<string>(nativeStringSlice, normalized, [normalized.length - ending.length]) === ending
      ) {
        return true;
      }
    }
    return false;
  }

  function trimRange(value: string, start: number, end: number): string {
    while (start < end && whitespace(charCode(value, start))) start += 1;
    while (end > start && whitespace(charCode(value, end - 1))) end -= 1;
    return apply(nativeStringSlice, value, [start, end]);
  }

  function whitespace(code: number): boolean {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }

  function cookieValues(value: string): string[] {
    const values: string[] = [];
    let start = 0;
    while (start <= value.length) {
      let end = apply<number>(nativeStringIndexOf, value, [';', start]);
      if (end < 0) end = value.length;
      const separator = apply<number>(nativeStringIndexOf, value, ['=', start]);
      if (separator >= start && separator < end) {
        const raw = trimRange(value, separator + 1, end);
        if (raw !== '') {
          append(values, raw);
          let unquoted = raw;
          if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
            unquoted = apply(nativeStringSlice, raw, [1, raw.length - 1]);
          }
          if (unquoted !== raw) append(values, unquoted);
          try {
            const decoded = apply<string>(nativeDecodeURIComponent, undefined, [unquoted]);
            if (decoded !== unquoted) append(values, decoded);
          } catch {}
        }
      }
      if (end === value.length) break;
      start = end + 1;
    }
    return values;
  }

  function authorizationValues(value: string): string[] {
    const values: string[] = [];
    let start = 0;
    while (start < value.length && whitespace(charCode(value, start))) start += 1;
    let separator = start;
    while (separator < value.length && !whitespace(charCode(value, separator))) separator += 1;
    const scheme = asciiLower(apply(nativeStringSlice, value, [start, separator]));
    const payload = trimRange(value, separator, value.length);
    if (payload === '') return values;
    append(values, payload);
    if (scheme === 'basic') {
      try {
        const buffer = apply<Buffer>(nativeBufferFrom, NativeBuffer, [payload, 'base64']);
        const decoded = apply<string>(nativeBufferToString, buffer, ['utf8']);
        append(values, decoded);
        const colon = apply<number>(nativeStringIndexOf, decoded, [':', 0]);
        if (colon >= 0) {
          append(values, apply(nativeStringSlice, decoded, [0, colon]));
          append(values, apply(nativeStringSlice, decoded, [colon + 1]));
        }
      } catch {}
    }
    return values;
  }

  function rawQueryValues(value: string): string[] {
    const values: string[] = [];
    const question = apply<number>(nativeStringIndexOf, value, ['?', 0]);
    if (question < 0) return values;
    let end = apply<number>(nativeStringIndexOf, value, ['#', question + 1]);
    if (end < 0) end = value.length;
    let start = question + 1;
    while (start <= end) {
      let pairEnd = apply<number>(nativeStringIndexOf, value, ['&', start]);
      if (pairEnd < 0 || pairEnd > end) pairEnd = end;
      const separator = apply<number>(nativeStringIndexOf, value, ['=', start]);
      if (separator >= start && separator < pairEnd) {
        let key = apply<string>(nativeStringSlice, value, [start, separator]);
        try {
          key = apply(nativeDecodeURIComponent, undefined, [replaceAllLiteral(key, '+', ' ')]);
        } catch {}
        if (nameCarriesSecret(key)) {
          const item = apply<string>(nativeStringSlice, value, [separator + 1, pairEnd]);
          if (item !== '') append(values, item);
        }
      }
      if (pairEnd === end) break;
      start = pairEnd + 1;
    }
    return values;
  }

  function diagnosticInputs(
    nodeRequest: {
      headers?: Record<string, string | readonly string[] | undefined>;
      url?: string;
    },
    webRequestUrl?: string,
  ): { secretValues: string[]; urls: string[] } {
    const urls: string[] = [];
    append(urls, typeof nodeRequest.url === 'string' ? nodeRequest.url : '/');
    if (typeof webRequestUrl === 'string') append(urls, webRequestUrl);
    const secretValues: string[] = [];
    const headers = nodeRequest.headers ?? {};
    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [headers]);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const name = keys[keyIndex]!;
      const headerDescriptor = descriptor(headers, name);
      if (headerDescriptor === undefined || !('value' in headerDescriptor)) continue;
      const rawValue = headerDescriptor.value;
      const values: Array<string | undefined> = apply(nativeArrayIsArray, NativeArray, [rawValue])
        ? rawValue
        : [rawValue];
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        const item = values[valueIndex];
        if (typeof item !== 'string' || item === '') continue;
        if (nameCarriesUrl(name)) append(urls, item);
        if (!nameCarriesSecret(name)) continue;
        append(secretValues, item);
        const authValues = authorizationValues(item);
        for (let index = 0; index < authValues.length; index += 1) {
          append(secretValues, authValues[index]!);
        }
        if (apply<number>(nativeStringIndexOf, normalizeName(name), ['cookie', 0]) >= 0) {
          const extracted = cookieValues(item);
          for (let index = 0; index < extracted.length; index += 1) {
            append(secretValues, extracted[index]!);
          }
        }
      }
    }
    for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
      const url = urls[urlIndex]!;
      const parts = diagnosticUrlParts(url);
      if (parts !== undefined) {
        for (let index = 0; index < parts.entries.length; index += 1) {
          const entry = parts.entries[index]!;
          if (nameCarriesSecret(entry[0]) && entry[1] !== '') append(secretValues, entry[1]);
        }
      }
      const rawValues = rawQueryValues(url);
      for (let index = 0; index < rawValues.length; index += 1) {
        append(secretValues, rawValues[index]!);
      }
    }
    return { secretValues, urls };
  }

  function neutralizeControls(value: string): string {
    let result = '';
    let cursor = 0;
    const hex = '0123456789abcdef';
    for (let index = 0; index < value.length; index += 1) {
      const code = charCode(value, index);
      if (!(code <= 0x1f || (code >= 0x7f && code <= 0x9f))) continue;
      result += apply<string>(nativeStringSlice, value, [cursor, index]) + '\\u';
      result += hex[(code >>> 12) & 0xf] + hex[(code >>> 8) & 0xf];
      result += hex[(code >>> 4) & 0xf] + hex[code & 0xf];
      cursor = index + 1;
    }
    return cursor === 0 ? value : result + apply<string>(nativeStringSlice, value, [cursor]);
  }

  function sanitizeString(
    value: string,
    inputs: { secretValues: string[]; urls: string[] },
  ): string {
    let sanitized = sanitizeText(value, inputs.urls);
    const values: string[] = [];
    for (let index = 0; index < inputs.secretValues.length; index += 1) {
      const item = inputs.secretValues[index]!;
      if (item === '') continue;
      let insertion = values.length;
      while (insertion > 0 && values[insertion - 1]!.length < item.length) {
        values[insertion] = values[insertion - 1]!;
        insertion -= 1;
      }
      values[insertion] = item;
    }
    for (let index = 0; index < values.length; index += 1) {
      sanitized = replaceAllLiteral(sanitized, values[index]!, '[redacted]');
    }
    return neutralizeControls(sanitized);
  }

  function safeErrorDetail(error: unknown): unknown {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return error;
    try {
      const stack = descriptor(error as object, 'stack');
      if (stack !== undefined && 'value' in stack && typeof stack.value === 'string') {
        return stack.value;
      }
      if (
        stack !== undefined &&
        !('value' in stack) &&
        stack.get === errorStackGetter &&
        typeof errorStackGetter === 'function'
      ) {
        const value = apply<unknown>(errorStackGetter, error, []);
        return typeof value === 'string' ? value : '[redacted]';
      }
      return error;
    } catch {
      return '[redacted]';
    }
  }

  function secretDisplayValue(value: object): boolean {
    try {
      const tag = descriptor(value, Symbol.toStringTag);
      return tag !== undefined && 'value' in tag && tag.value === 'Secret';
    } catch {
      return false;
    }
  }

  function scrub(
    value: unknown,
    inputs: { secretValues: string[]; urls: string[] },
    seen: WeakMap<object, unknown>,
  ): unknown {
    if (typeof value === 'string') return sanitizeString(value, inputs);
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    try {
      if (secretDisplayValue(value)) return '[secret]';
      const existing = apply<unknown>(nativeWeakMapGet, seen, [value]);
      if (existing !== undefined) return existing;
      const array = apply<boolean>(nativeArrayIsArray, NativeArray, [value]);
      const prototype = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [value]);
      if (!array && prototype !== nativeObjectPrototype && prototype !== null) return '[redacted]';
      const next = array
        ? []
        : apply<Record<string, unknown>>(nativeObjectCreate, NativeObject, [prototype]);
      apply(nativeWeakMapSet, seen, [value, next]);
      const keys = apply<string[]>(nativeObjectKeys, NativeObject, [value]);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        const itemDescriptor = descriptor(value, key);
        const item =
          itemDescriptor !== undefined && 'value' in itemDescriptor
            ? scrub(itemDescriptor.value, inputs, seen)
            : '[redacted]';
        apply(nativeObjectDefineProperty, NativeObject, [
          next,
          sanitizeString(key, inputs),
          {
            configurable: true,
            enumerable: true,
            value: item,
            writable: true,
          },
        ]);
      }
      return next;
    } catch {
      return '[redacted]';
    }
  }

  return (error, nodeRequest, webRequestUrl) => {
    assertControls();
    const inputs = diagnosticInputs(nodeRequest, webRequestUrl);
    const method =
      typeof nodeRequest.method === 'string'
        ? sanitizeString(nodeRequest.method, inputs)
        : 'UNKNOWN';
    const url = sanitizeUrl(typeof nodeRequest.url === 'string' ? nodeRequest.url : '/');
    const detail = safeErrorDetail(error);
    const record = { error: detail, method, url };
    return scrub(record, inputs, new NativeWeakMap<object, unknown>()) as {
      error: unknown;
      method: string;
      url: string;
    };
  };
}

const generatedNodeDiagnosticFactorySource = buildSecurityFunctionSource(
  generatedNodeDiagnosticFactory,
);

function nodeServerSource(): string {
  return `import { Buffer } from 'node:buffer';
import { constants as fsConstants } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, ServerResponse } from 'node:http';
import { basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  armIncompleteNodeRequestClose,
  nodeRequestToWebRequest,
  rejectUnsafeNodeMutationTarget,
  writeWebResponseToNode,
} from './node-adapter.mjs';

const NativeMap = globalThis.Map;
const NativeObject = globalThis.Object;
const NativeRegExp = globalThis.RegExp;
const NativeRequest = globalThis.Request;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
const nativeReflectApply = Reflect.apply;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectKeys = NativeObject.keys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRequestUrlGetter = nativeObjectGetOwnPropertyDescriptor(NativeRequest.prototype, 'url').get;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeUrlPathnameGetter = nativeObjectGetOwnPropertyDescriptor(NativeURL.prototype, 'pathname').get;
const nativeBufferByteLength = Buffer.byteLength;
const nativeServerResponseDestroy = stablePrototypeFunction(ServerResponse.prototype, 'destroy');
const nativeServerResponseEnd = stablePrototypeFunction(ServerResponse.prototype, 'end');
const nativeServerResponseHeadersSentGetter = stablePrototypeGetter(ServerResponse.prototype, 'headersSent');
const nativeServerResponseWriteHead = stablePrototypeFunction(ServerResponse.prototype, 'writeHead');
const nativeConsoleError = console.error;
const immutableAssetPathPattern = new NativeRegExp(${immutableAssetPathPatternSourceLiteral}, ${immutableAssetPathPatternFlagsLiteral});
const fsFileTypeMask = fsConstants.S_IFMT;
const fsRegularFileType = fsConstants.S_IFREG;
const createNodeDiagnosticRecord = (${generatedNodeDiagnosticFactorySource})();

const clientRoot = resolve(fileURLToPath(new NativeURL('.', import.meta.url)), 'client');
const staticRoot = resolve(fileURLToPath(new NativeURL('.', import.meta.url)), 'static');
const clientModuleHeaders = ${clientModuleHeadersSource};
const immutableAssetHeaders = ${immutableAssetHeadersSource};
const revalidatingAssetHeaders = ${revalidatingAssetHeadersSource};
const documentStaticHeaders = ${documentStaticHeadersSource};
const staticErrorDocumentHeaders = ${staticErrorHeadersSource};
const headersTimeoutMs = 10_000;
const requestTimeoutMs = 30_000;
const rootedFileCapabilities = new NativeMap();
let handlerPromise;

function apply(fn, receiver, args) {
  return nativeReflectApply(fn, receiver, args);
}

function sameDataDescriptor(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return 'value' in left && 'value' in right &&
    apply(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable;
}

function ownDataValue(value, property) {
  const before = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  const after = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError('Kovo generated Node data changed while it was inspected.');
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError('Kovo generated Node data must use own data properties.');
  }
  return before.value;
}

function ownStringOr(value, property, fallback) {
  const found = ownDataValue(value, property);
  return typeof found === 'string' ? found : fallback;
}

function defineData(value, property, entry) {
  apply(nativeObjectDefineProperty, NativeObject, [value, property, {
    configurable: true,
    enumerable: true,
    value: entry,
    writable: true,
  }]);
}

function stringEndsWith(value, suffix) {
  return apply(nativeStringEndsWith, value, [suffix]);
}

function stringIncludes(value, search) {
  return apply(nativeStringIncludes, value, [search]);
}

function stringSlice(value, start) {
  return apply(nativeStringSlice, value, [start]);
}

function stringStartsWith(value, prefix) {
  return apply(nativeStringStartsWith, value, [prefix]);
}

function stablePrototypeFunction(prototype, property) {
  let owner = prototype;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [owner, property]);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError('Kovo generated Node transport control is unavailable.');
      }
      return descriptor.value;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new TypeError('Kovo generated Node transport control is unavailable.');
}

function stablePrototypeGetter(prototype, property) {
  let owner = prototype;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [owner, property]);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError('Kovo generated Node transport getter is unavailable.');
      }
      return descriptor.get;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new TypeError('Kovo generated Node transport getter is unavailable.');
}

async function importHandler() {
  const module = await import('./server/handler.mjs');
  return module.default;
}

function loadHandler() {
  handlerPromise ??= importHandler();
  return handlerPromise;
}

function isBodylessMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

export function createKovoNodeServer(options = {}) {
  const server = createServer(async (nodeRequest, nodeResponse) => {
    let diagnosticRequestUrl;
    try {
      if (rejectUnsafeNodeMutationTarget(nodeRequest, nodeResponse)) return;
      const method = ownStringOr(nodeRequest, 'method', 'GET');
      const rawTarget = ownStringOr(nodeRequest, 'url', '/');
      const httpVersion = ownStringOr(nodeRequest, 'httpVersion', '1.1');
      if (isBodylessMethod(method)) {
        armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      }
      if (await maybeServeStatic(rawTarget, method, nodeResponse)) return;

      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      diagnosticRequestUrl = apply(nativeRequestUrlGetter, request, []);
      const handler = await loadHandler();
      const response = await handler(request);
      armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
      await writeWebResponseToNode(response, nodeResponse, method, {
        httpVersion,
      });
    } catch (error) {
      logUnhandledNodeError(error, nodeRequest, diagnosticRequestUrl);
      if (apply(nativeServerResponseHeadersSentGetter, nodeResponse, [])) {
        apply(nativeServerResponseDestroy, nodeResponse, []);
      } else {
        armIncompleteNodeRequestClose(nodeRequest, nodeResponse);
        apply(nativeServerResponseWriteHead, nodeResponse, [500, {
          'content-type': 'text/plain; charset=utf-8',
        }]);
        apply(nativeServerResponseEnd, nodeResponse, ['Internal Server Error']);
      }
    }
  });
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  return server;
}

function logUnhandledNodeError(error, nodeRequest, webRequestUrl) {
  try {
    apply(nativeConsoleError, console, [
      '[kovo] unhandled node server error',
      createNodeDiagnosticRecord(error, nodeRequest, webRequestUrl),
    ]);
  } catch {
    try {
      apply(nativeConsoleError, console, ['[kovo] unhandled node server error', {
        method: 'UNKNOWN',
        url: '/',
        error: '[redacted]',
      }]);
    } catch {}
  }
}

async function maybeServeStatic(rawTarget, method, nodeResponse) {
  if (!isBodylessMethod(method)) return false;

  const pathname = staticPathname(rawTarget);
  if (pathname === undefined) return false;
  const clientModule = stringStartsWith(pathname, '/c/');
  const clientAsset = clientModule || stringStartsWith(pathname, '/assets/');
  const immutableAsset = clientAsset && isImmutableStaticAssetPath(pathname);
  let relativePath = clientAsset ? staticRelativePath(pathname) : routeDocumentPath(pathname);
  const root = clientAsset ? clientRoot : staticRoot;

  if (relativePath === undefined) {
    if (!clientAsset) return false;
    apply(nativeServerResponseWriteHead, nodeResponse, [403, staticErrorHeaders()]);
    apply(nativeServerResponseEnd, nodeResponse, ['Forbidden']);
    return true;
  }

  let outcome = await serveRootedStaticFile(root, relativePath, {
    ...(clientAsset
      ? clientModule
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
    apply(nativeServerResponseWriteHead, nodeResponse, [404, staticErrorHeaders()]);
    apply(nativeServerResponseEnd, nodeResponse, ['Not Found']);
    return true;
  }

  await writeRouteOutcomeToNode(outcome, nodeResponse, method);
  return true;
}

function staticPathname(rawTarget) {
  try {
    const parsed = new NativeURL(rawTarget, 'http://kovo.local');
    return apply(nativeUrlPathnameGetter, parsed, []);
  } catch {
    return undefined;
  }
}

function routeDocumentPath(pathname) {
  const cleanPathname = stringEndsWith(pathname, '/') ? pathname : pathname + '/';
  return staticRelativePath(cleanPathname + 'index.html');
}

function publicStaticPath(pathname) {
  if (
    pathname === '/_headers' ||
    pathname === '/kovo-static-manifest.json' ||
    stringEndsWith(pathname, '/') ||
    stringEndsWith(pathname, '/index.html')
  ) {
    return undefined;
  }
  return staticRelativePath(pathname);
}

function staticRelativePath(pathname) {
  try {
    return apply(nativeDecodeURIComponent, undefined, [stringSlice(pathname, 1)]);
  } catch {
    return undefined;
  }
}

async function serveRootedStaticFile(root, relativePath, headers) {
  if (stringIncludes(relativePath, '\\0')) return undefined;
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
  let capability = apply(nativeMapGet, rootedFileCapabilities, [root]);
  if (capability === undefined) {
    capability = (async () => {
      try {
        return await rootedStaticFiles(root);
      } catch (error) {
        if (isMissingStaticRootError(error)) return undefined;
        throw error;
      }
    })();
    apply(nativeMapSet, rootedFileCapabilities, [root, capability]);
  }
  return capability;
}

function isMissingStaticRootError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = ownDataValue(error, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function rootedStaticFiles(root) {
  const realRoot = await realpath(root);
  return apply(nativeObjectFreeze, NativeObject, [{
    root: realRoot,
    serve: (path, options) => serveRootedStaticFileBytes(realRoot, path, options),
  }]);
}

async function serveRootedStaticFileBytes(realRoot, requestedPath, options) {
  const candidate = rootedStaticCandidate(realRoot, requestedPath);
  if (candidate === undefined) return undefined;
  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(realRoot, resolved)) return undefined;
  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch (error) {
    if (isMissingStaticRootError(error)) return undefined;
    throw error;
  }
  const mode = ownDataValue(fileStat, 'mode');
  if (typeof mode !== 'number' || (mode & fsFileTypeMask) !== fsRegularFileType) return undefined;
  const headers = ownDataValue(options, 'headers');
  const contentType = ownDataValue(options, 'contentType');
  return {
    body: await readFile(resolved),
    contentDisposition: routeOutcomeContentDisposition(options, resolved),
    contentType,
    ...(headers === undefined ? {} : { headers }),
    routeResponse: true,
  };
}

function rootedStaticCandidate(realRoot, requestedPath) {
  if (stringIncludes(requestedPath, '\\0') || isAbsolute(requestedPath)) return undefined;
  const candidate = resolve(realRoot, requestedPath);
  return containsPath(realRoot, candidate) ? candidate : undefined;
}

function containsPath(root, target) {
  return target === root || stringStartsWith(target, root + sep);
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
  const disposition = ownDataValue(options, 'disposition') ?? 'attachment';
  const filename = ownDataValue(options, 'filename') ?? basename(resolvedPath);
  return filename
    ? disposition + '; filename="' + contentDispositionFilename(filename) + '"'
    : disposition;
}

function contentDispositionFilename(filename) {
  let safe = '';
  for (let index = 0; index < filename.length; index += 1) {
    const character = filename[index];
    safe += character === '\\r' || character === '\\n' || character === '"' ? '_' : character;
  }
  return safe;
}

async function writeRouteOutcomeToNode(outcome, nodeResponse, method) {
  const headers = safeRouteOutcomeHeaders(ownDataValue(outcome, 'headers'));
  defineData(headers, 'content-disposition', ownDataValue(outcome, 'contentDisposition'));
  defineData(headers, 'content-type', ownDataValue(outcome, 'contentType'));
  defineData(headers, 'x-content-type-options', 'nosniff');
  const body = ownDataValue(outcome, 'body');
  defineData(headers, 'content-length', apply(nativeBufferByteLength, Buffer, [body]));
  apply(nativeServerResponseWriteHead, nodeResponse, [200, headers]);
  if (method === 'HEAD') {
    apply(nativeServerResponseEnd, nodeResponse, []);
    return;
  }
  apply(nativeServerResponseEnd, nodeResponse, [body]);
}

function safeRouteOutcomeHeaders(headers) {
  const safeHeaders = apply(nativeObjectCreate, NativeObject, [null]);
  if (headers === undefined) return safeHeaders;
  const names = apply(nativeObjectKeys, NativeObject, [headers]);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const normalizedName = apply(nativeStringToLowerCase, name, []);
    if (apply(nativeSetHas, reservedRouteOutcomeHeaderNames, [normalizedName])) continue;
    defineData(safeHeaders, name, ownDataValue(headers, name));
  }
  return safeHeaders;
}

const reservedRouteOutcomeHeaderNames = new NativeSet([
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'set-cookie',
  'x-content-type-options',
]);

function contentType(filePath) {
  switch (apply(nativeStringToLowerCase, extname(filePath), [])) {
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
  return stringStartsWith(pathname, '/c/') ||
    apply(nativeRegExpExec, immutableAssetPathPattern, [pathname]) !== null;
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
    `${buildSecuritySourceLiteral(runtimePackage)}\n`,
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
