import './security-bootstrap.js';

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';
import {
  createFrameworkOutputFileSystemBoundary,
  type ConfinedFileSystemEntry,
} from '@kovojs/core/internal/filesystem';

import { resolvedFileSystemPath } from './vite-build-assets.js';
import {
  buildOwnDataProperty,
  buildSecurityFunctionSource,
  buildSecurityPathJoin,
  buildSecuritySha256Hex,
  buildSecuritySourceLiteral,
  commitBuildArrayValue,
  freezeBuildSecurityValue,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import type { KovoNeutralBuild } from './neutral-build.js';
import { writeArtifactOutput, type ArtifactOutputEntry } from './output-staging.js';
import {
  createSecurityNullRecord,
  securityArrayJoin,
  securityArrayIsArray,
  securityIsPromise,
  securityJsonParse,
  securityNumberIsFinite,
  securityNumberIsInteger,
  securityObjectKeys,
  securityPromiseResolve,
  securityPromiseThen,
  securityRegExpTest,
  securityStringEndsWith,
  securityStringIncludes,
} from './response-security-intrinsics.js';
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
const frameworkRuntimeClientModulePathSuffix = kovoDeferredRuntimeModulePath.replace(/^\/c\//, '/');
const nativeExecFileSync = execFileSync;
const nodeExecutablePath = process.execPath;
const generatedJavaScriptValidationEnvironment = Object.freeze(
  Object.create(null),
) as NodeJS.ProcessEnv;

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
  /** Operator-selected project root used for project metadata and lockfile inputs. */
  projectRoot?: string;
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
  const pinnedOptions = snapshotNodePresetOptions(options);
  const jobRunner = nodeJobRunnerCapability(pinnedOptions);
  const constructionProjectRoot = resolvedFileSystemPath(process.cwd());
  const preset = createSecurityNullRecord() as unknown as KovoPreset;
  if (jobRunner !== undefined) {
    const capabilities = createSecurityNullRecord() as KovoPresetCapabilities;
    capabilities.jobRunner = jobRunner;
    preset.capabilities = freezeBuildSecurityValue(capabilities);
  }
  preset.emit = (build, context) =>
    emitNodePreset(build, context, pinnedOptions, constructionProjectRoot);
  preset.inspect = (build, context) => {
    const retentionDiagnostics = clientModuleRetentionDiagnostics(build, 'node', pinnedOptions);
    const runnerDiagnostics = nodeJobRunnerDiagnostics(build, pinnedOptions, jobRunner, context);
    const appendNodeDiagnostics = (
      jobRunnerDiagnostics: readonly PresetDiagnostic[],
    ): readonly PresetDiagnostic[] =>
      nodePresetDiagnostics(
        build,
        concatenatePresetDiagnostics(
          retentionDiagnostics,
          jobRunnerDiagnostics,
          'node preset diagnostics',
        ),
      );
    if (securityIsPromise(runnerDiagnostics)) {
      return securityPromiseThen(
        runnerDiagnostics as Promise<readonly PresetDiagnostic[]>,
        appendNodeDiagnostics,
      );
    }
    return appendNodeDiagnostics(runnerDiagnostics);
  };
  preset.name = 'node';
  return freezeBuildSecurityValue(preset) as KovoPreset;
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
  const pinnedOptions = snapshotVercelPresetOptions(options);
  const preset = createSecurityNullRecord() as unknown as KovoPreset;
  preset.emit = (build, context) => emitVercelPreset(build, context, pinnedOptions);
  preset.inspect = (build, _context) => {
    const diagnostics = concatenatePresetDiagnostics(
      clientModuleRetentionDiagnostics(build, 'vercel', pinnedOptions),
      missingJobRunnerDiagnostics(build, 'vercel'),
      'vercel preset diagnostics',
    );
    if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
      appendPresetDiagnostic(
        diagnostics,
        {
          code: 'vercel-missing-handler',
          message: 'The vercel preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        },
        'vercel missing-handler diagnostic',
      );
    }
    return diagnostics;
  };
  preset.name = 'vercel';
  return freezeBuildSecurityValue(preset) as KovoPreset;
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
  const pinnedOptions = snapshotCloudflarePresetOptions(options);
  const preset = createSecurityNullRecord() as unknown as KovoPreset;
  preset.emit = (build, context) => emitCloudflarePreset(build, context, pinnedOptions);
  preset.inspect = async (build, context) => {
    const diagnostics = concatenatePresetDiagnostics(
      clientModuleRetentionDiagnostics(build, 'cloudflare', pinnedOptions),
      missingJobRunnerDiagnostics(build, 'cloudflare'),
      'cloudflare preset diagnostics',
    );
    if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
      appendPresetDiagnostic(
        diagnostics,
        {
          code: 'cloudflare-missing-handler',
          message: 'The cloudflare preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        },
        'cloudflare missing-handler diagnostic',
      );
    }
    if (build.serverHandlerPath === undefined) return diagnostics;

    appendPresetDiagnostics(
      diagnostics,
      await cloudflareRuntimeDiagnostics(build, context),
      'cloudflare runtime diagnostics',
    );
    return diagnostics;
  };
  preset.name = 'cloudflare';
  return freezeBuildSecurityValue(preset) as KovoPreset;
}

async function emitNodePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: NodePresetOptions,
  constructionProjectRoot: string,
): Promise<void> {
  if (build.serverHandlerPath === undefined) {
    throw new Error('The node preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  const projectRoot = resolvedFileSystemPath(context.projectRoot ?? constructionProjectRoot);
  await writePresetDirectory(build.clientDir, outDir, 'client', 'node client');
  if (build.publicAssetDir !== undefined) {
    await writePresetDirectory(build.publicAssetDir, outDir, 'static', 'node public assets');
  }
  if (build.staticOutput !== undefined) {
    await writePresetDirectory(build.staticOutput.dir, outDir, 'static', 'node static output');
  }
  await writePresetDirectory(build.serverDir, outDir, 'server', 'node server');
  const nodeAdapterSource = nodeAdapterRuntimeSource();
  const serverSource = nodeServerSource();
  validateGeneratedJavaScript(path.join(outDir, 'node-adapter.mjs'), nodeAdapterSource, 'module');
  validateGeneratedJavaScript(path.join(outDir, 'server.mjs'), serverSource, 'module');
  const runtimeEntries = await nodeRuntimePackageEntries(outDir, projectRoot);
  const generatedEntries: ArtifactOutputEntry[] = [
    presetContentEntry(outDir, 'node-adapter.mjs', nodeAdapterSource, 'node adapter'),
    presetContentEntry(outDir, 'server.mjs', serverSource, 'node server entry'),
    presetJsonEntry(outDir, 'kovo-artifact-integrity.json', {
      algorithm: 'sha256',
      files: {
        'node-adapter.mjs': generatedArtifactDigest(nodeAdapterSource),
        'server.mjs': generatedArtifactDigest(serverSource),
      },
    }),
  ];
  const pinnedRuntimeEntries = snapshotBuildArray(runtimeEntries, 'node runtime package entries');
  for (let index = 0; index < pinnedRuntimeEntries.length; index += 1) {
    commitBuildArrayValue(
      generatedEntries,
      pinnedRuntimeEntries[index]!,
      'Node generated output entries',
    );
  }
  if (options.dockerfile !== false) {
    commitBuildArrayValue(
      generatedEntries,
      presetContentEntry(outDir, 'Dockerfile', nodeDockerfileSource(), 'node Dockerfile'),
      'Node generated output entries',
    );
  }
  await writePresetArtifacts(outDir, generatedEntries, 'node generated output');

  context.log(`Emitted Kovo node preset output to ${outDir}`);
}

async function emitVercelPreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: VercelPresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await writePresetDirectory(build.staticOutput.dir, outDir, 'static', 'vercel static output');
    await writePresetArtifacts(
      outDir,
      [presetJsonEntry(outDir, 'config.json', vercelStaticBuildOutputConfig())],
      'vercel static configuration',
    );
    context.log(`Emitted Kovo vercel static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The vercel preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await writePresetStaticFiles(build, outDir, 'static', 'vercel');
  const nodeAdapterSource = nodeAdapterRuntimeSource();
  const functionSource = vercelFunctionSource();
  validateGeneratedJavaScript(
    path.join(outDir, 'functions/kovo.func/node-adapter.mjs'),
    nodeAdapterSource,
    'module',
  );
  validateGeneratedJavaScript(
    path.join(outDir, 'functions/kovo.func/index.cjs'),
    functionSource,
    'commonjs',
  );
  await writePresetArtifacts(
    outDir,
    [
      presetSourceEntry(
        outDir,
        'functions/kovo.func/handler.mjs',
        build.serverHandlerPath,
        'vercel handler',
      ),
      presetContentEntry(
        outDir,
        'functions/kovo.func/node-adapter.mjs',
        nodeAdapterSource,
        'vercel node adapter',
      ),
      presetContentEntry(
        outDir,
        'functions/kovo.func/index.cjs',
        functionSource,
        'vercel function entry',
      ),
      presetJsonEntry(outDir, 'functions/kovo.func/kovo-artifact-integrity.json', {
        algorithm: 'sha256',
        files: {
          'index.cjs': generatedArtifactDigest(functionSource),
          'node-adapter.mjs': generatedArtifactDigest(nodeAdapterSource),
        },
      }),
      presetJsonEntry(outDir, 'functions/kovo.func/.vc-config.json', {
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        ...(options.maxDuration === undefined ? {} : { maxDuration: options.maxDuration }),
        ...(options.memory === undefined ? {} : { memory: options.memory }),
        ...(options.regions === undefined ? {} : { regions: options.regions }),
        runtime: 'nodejs22.x',
        shouldAddHelpers: true,
      }),
      presetJsonEntry(outDir, 'config.json', vercelBuildOutputConfig()),
    ],
    'vercel generated output',
  );

  context.log(`Emitted Kovo vercel preset output to ${outDir}`);
}

async function emitCloudflarePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: CloudflarePresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await writePresetDirectory(
      build.staticOutput.dir,
      outDir,
      'client',
      'cloudflare static output',
    );
    await writePresetArtifacts(
      outDir,
      [
        presetContentEntry(
          outDir,
          'wrangler.toml',
          wranglerTomlSource(options),
          'cloudflare configuration',
        ),
      ],
      'cloudflare static configuration',
    );
    context.log(`Emitted Kovo cloudflare static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The cloudflare preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await writePresetStaticFiles(build, outDir, 'client', 'cloudflare');
  const workerSource = cloudflareWorkerSource();
  validateGeneratedJavaScript(path.join(outDir, 'worker.mjs'), workerSource, 'module');
  await writePresetArtifacts(
    outDir,
    [
      presetSourceEntry(
        outDir,
        'server/handler.mjs',
        build.serverHandlerPath,
        'cloudflare handler',
      ),
      presetContentEntry(outDir, 'worker.mjs', workerSource, 'cloudflare worker'),
      presetJsonEntry(outDir, 'kovo-artifact-integrity.json', {
        algorithm: 'sha256',
        files: {
          'worker.mjs': generatedArtifactDigest(workerSource),
        },
      }),
      presetContentEntry(
        outDir,
        'wrangler.toml',
        wranglerTomlSource(options),
        'cloudflare configuration',
      ),
    ],
    'cloudflare generated output',
  );

  context.log(`Emitted Kovo cloudflare preset output to ${outDir}`);
}

async function writePresetStaticFiles(
  build: KovoNeutralBuild,
  outDir: string,
  targetDirectory: string,
  preset: string,
): Promise<void> {
  if (build.publicAssetDir !== undefined) {
    await writePresetDirectory(
      build.publicAssetDir,
      outDir,
      targetDirectory,
      `${preset} public assets`,
    );
  }
  if (build.staticOutput !== undefined) {
    await writePresetDirectory(
      build.staticOutput.dir,
      outDir,
      targetDirectory,
      `${preset} static output`,
    );
  }
  await writePresetDirectory(build.clientDir, outDir, targetDirectory, `${preset} client output`);
}

function clientModuleRetentionDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
  options: DeploySkewPresetOptions,
): PresetDiagnostic[] {
  // SPEC §6.6/§14: route evaluation precedes preset inspection. Pin the complete emitted-module
  // ledger and classify it with indexed traversal so app code cannot suppress KV417 via Array.filter.
  const clientModules = snapshotBuildArray(
    build.clientModules,
    'preset deploy-skew client modules',
  );
  let hasRetainedClientModule = false;
  for (let index = 0; index < clientModules.length; index += 1) {
    if (isFrameworkRuntimeClientModule(clientModules[index]!)) continue;
    hasRetainedClientModule = true;
    break;
  }
  if (!hasRetainedClientModule) return [];
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
    securityNumberIsFinite(retention.hours) &&
    retention.hours >= 24 &&
    retention.immutableClientModules === 'retained' &&
    retention.priorTokenQueryReads === 'retained'
  );
}

function nodeJobRunnerCapability(options: NodePresetOptions): JobRunnerCapability | undefined {
  if (options.jobRunner === false) return undefined;
  if (options.jobRunner?.mode === 'runner-only') return undefined;
  const capability = createSecurityNullRecord() as unknown as JobRunnerCapability;
  capability.adapter = 'node-in-process';
  capability.mode = 'serve-and-run';
  return freezeBuildSecurityValue(capability) as JobRunnerCapability;
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
  if (securityIsPromise(source)) {
    return securityPromiseThen(source as Promise<string | undefined>, (serverHandlerSource) =>
      durableTaskStoreDiagnostics(build, 'node', serverHandlerSource),
    );
  }
  if (isPromiseLike(source)) {
    return securityPromiseThen(securityPromiseResolve(source), (serverHandlerSource) =>
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
  const taskList = presetTaskList(build, 'node durable task-store diagnostics');
  if (taskList === undefined) return [];
  if (
    serverHandlerSource === undefined ||
    !serverHandlerUsesSqliteDurableIncompatibleStore(serverHandlerSource)
  ) {
    return [];
  }

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
  const taskList = presetTaskList(build, `${presetName} missing JobRunner diagnostics`);
  if (taskList === undefined) return [];
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
    appendPresetDiagnostic(
      diagnostics,
      {
        code: 'node-missing-handler',
        message: 'The node preset requires a neutral build with server/handler.mjs.',
        severity: 'error',
      },
      'node missing-handler diagnostic',
    );
  }
  return diagnostics;
}

function concatenatePresetDiagnostics(
  first: readonly PresetDiagnostic[],
  second: readonly PresetDiagnostic[],
  label: string,
): PresetDiagnostic[] {
  const diagnostics: PresetDiagnostic[] = [];
  appendPresetDiagnostics(diagnostics, first, `${label} first`);
  appendPresetDiagnostics(diagnostics, second, `${label} second`);
  return diagnostics;
}

function appendPresetDiagnostics(
  target: PresetDiagnostic[],
  source: readonly PresetDiagnostic[],
  label: string,
): void {
  const diagnostics = snapshotBuildArray(source, label);
  for (let index = 0; index < diagnostics.length; index += 1) {
    appendPresetDiagnostic(target, diagnostics[index]!, `${label} ${index}`);
  }
}

function appendPresetDiagnostic(
  target: PresetDiagnostic[],
  diagnostic: PresetDiagnostic,
  label: string,
): void {
  commitBuildArrayValue(target, diagnostic, label);
}

function presetTaskList(build: KovoNeutralBuild, label: string): string | undefined {
  const tasks = snapshotBuildArray(build.tasks, `${label} tasks`);
  if (tasks.length === 0) return undefined;

  let taskList = '';
  for (let index = 0; index < tasks.length; index += 1) {
    const key = tasks[index]!.key;
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`Kovo preset inspection found an invalid ${label} task key.`);
    }
    taskList += `${index === 0 ? '' : ', '}${key}`;
  }
  return taskList;
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
  return securityRegExpTest(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?:better-sqlite3|drizzle-orm\/better-sqlite3)["']/,
    source,
  );
}

function isFrameworkRuntimeClientModule(
  module: KovoNeutralBuild['clientModules'][number],
): boolean {
  return (
    securityStringEndsWith(module.path, frameworkRuntimeClientModulePathSuffix) &&
    module.version === kovoDeferredRuntimeModuleVersion
  );
}

type GeneratedJavaScriptFormat = 'commonjs' | 'module';

function validateGeneratedJavaScript(
  filePath: string,
  source: string,
  format: GeneratedJavaScriptFormat,
): void {
  try {
    nativeExecFileSync(nodeExecutablePath, ['--check', `--input-type=${format}`], {
      encoding: 'utf8',
      env: generatedJavaScriptValidationEnvironment,
      input: source,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new TypeError(`Kovo refused to emit invalid generated JavaScript for ${filePath}.`);
  }
}

function presetContentEntry(
  outDir: string,
  relativePath: string,
  content: string | Uint8Array,
  label: string,
): ArtifactOutputEntry {
  return {
    content,
    kind: 'deploy-preset',
    label,
    targetPath: buildSecurityPathJoin(outDir, relativePath),
  };
}

function presetSourceEntry(
  outDir: string,
  relativePath: string,
  sourcePath: string,
  label: string,
): ArtifactOutputEntry {
  return {
    kind: 'deploy-preset',
    label,
    sourcePath,
    targetPath: buildSecurityPathJoin(outDir, relativePath),
  };
}

function presetJsonEntry(
  outDir: string,
  relativePath: string,
  value: unknown,
): ArtifactOutputEntry {
  return presetContentEntry(
    outDir,
    relativePath,
    `${buildSecuritySourceLiteral(value)}\n`,
    relativePath,
  );
}

async function writePresetArtifacts(
  outDir: string,
  entries: readonly ArtifactOutputEntry[],
  label: string,
): Promise<void> {
  await writeArtifactOutput(outDir, entries, {
    stagingPrefix: '.kovo-preset-output-',
    diagnostics: {
      root: (root, reason) => new Error(`Kovo ${label} cannot use '${root}': ${reason}.`),
      target: (entry, reason) =>
        new Error(`Kovo ${label} cannot write '${entry.label}': ${reason}.`),
    },
  });
}

async function writePresetDirectory(
  sourceDir: string,
  outDir: string,
  targetDirectory: string,
  label: string,
): Promise<void> {
  const source = createFrameworkOutputFileSystemBoundary(sourceDir);
  await source.ensureDirectory();
  const entries: ArtifactOutputEntry[] = [];
  await appendPresetDirectoryEntries(
    source,
    await source.entries('.'),
    outDir,
    targetDirectory,
    label,
    entries,
  );
  await writePresetArtifacts(outDir, entries, label);
}

async function appendPresetDirectoryEntries(
  source: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  children: readonly ConfinedFileSystemEntry[],
  outDir: string,
  targetDirectory: string,
  label: string,
  entries: ArtifactOutputEntry[],
): Promise<void> {
  const snapshot = snapshotBuildArray(children, `${label} source directory entries`);
  for (let index = 0; index < snapshot.length; index += 1) {
    const entry = snapshot[index]!;
    if (entry.kind === 'directory') {
      await appendPresetDirectoryEntries(
        source,
        await source.entriesOf(entry),
        outDir,
        targetDirectory,
        label,
        entries,
      );
      continue;
    }
    if (entry.kind !== 'file') {
      throw new Error(`Kovo ${label} refuses non-regular source entry '${entry.relativePath}'.`);
    }
    commitBuildArrayValue(
      entries,
      presetContentEntry(
        outDir,
        buildSecurityPathJoin(targetDirectory, entry.relativePath),
        await source.fileBytesOf(entry),
        `${label} ${entry.relativePath}`,
      ),
      `${label} output entries`,
    );
  }
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
  const declaredEnv = snapshotBuildArray(
    context.declaredEnv,
    'cloudflare declared environment names',
  );
  let declaresDatabaseUrl = false;
  for (let index = 0; index < declaredEnv.length; index += 1) {
    if (declaredEnv[index] !== 'DATABASE_URL') continue;
    declaresDatabaseUrl = true;
    break;
  }
  if (declaresDatabaseUrl || securityStringIncludes(source, 'DATABASE_URL')) {
    appendPresetDiagnostic(
      diagnostics,
      {
        code: 'cloudflare-tcp-database',
        message:
          'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
        severity: 'warning',
      },
      'cloudflare TCP database diagnostic',
    );
  }

  const blockedModules = snapshotBuildArray(
    cloudflareBlockedNodeModules,
    'cloudflare blocked Node module classifiers',
  );
  for (let index = 0; index < blockedModules.length; index += 1) {
    const blocked = blockedModules[index]!;
    if (!serverHandlerImportsModule(source, blocked.pattern)) continue;
    appendPresetDiagnostic(
      diagnostics,
      {
        code: 'cloudflare-unsupported-node-api',
        message: `The cloudflare preset cannot run ${blocked.name}; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.`,
        severity: 'error',
      },
      `cloudflare blocked Node module diagnostic ${index}`,
    );
  }

  return diagnostics;
}

const cloudflareBlockedNodeModules = [
  {
    name: 'child_process',
    pattern:
      /\b(?:from\s*['"]child_process['"]|import\s*['"]child_process['"]|import\s*\(\s*['"]child_process['"]\s*\)|require\s*\(\s*['"]child_process['"]\s*\))/,
  },
  {
    name: 'cluster',
    pattern:
      /\b(?:from\s*['"]cluster['"]|import\s*['"]cluster['"]|import\s*\(\s*['"]cluster['"]\s*\)|require\s*\(\s*['"]cluster['"]\s*\))/,
  },
  {
    name: 'dgram',
    pattern:
      /\b(?:from\s*['"]dgram['"]|import\s*['"]dgram['"]|import\s*\(\s*['"]dgram['"]\s*\)|require\s*\(\s*['"]dgram['"]\s*\))/,
  },
  {
    name: 'node:child_process',
    pattern:
      /\b(?:from\s*['"]node:child_process['"]|import\s*['"]node:child_process['"]|import\s*\(\s*['"]node:child_process['"]\s*\)|require\s*\(\s*['"]node:child_process['"]\s*\))/,
  },
  {
    name: 'node:cluster',
    pattern:
      /\b(?:from\s*['"]node:cluster['"]|import\s*['"]node:cluster['"]|import\s*\(\s*['"]node:cluster['"]\s*\)|require\s*\(\s*['"]node:cluster['"]\s*\))/,
  },
  {
    name: 'node:dgram',
    pattern:
      /\b(?:from\s*['"]node:dgram['"]|import\s*['"]node:dgram['"]|import\s*\(\s*['"]node:dgram['"]\s*\)|require\s*\(\s*['"]node:dgram['"]\s*\))/,
  },
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

function serverHandlerImportsModule(source: string, modulePattern: RegExp): boolean {
  return securityRegExpTest(modulePattern, source);
}

function wranglerTomlSource(options: CloudflarePresetOptions): string {
  const name = options.name ?? 'kovo-app';
  const compatibilityDate = options.compatibilityDate ?? '2024-09-23';
  // SPEC §6.6: route evaluation precedes preset emission. Pin every reviewed line and compose the
  // authoritative Wrangler file through the boot-captured join control.
  const lines = snapshotBuildArray(
    [
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
    ],
    'Cloudflare Wrangler TOML lines',
  );
  return securityArrayJoin(lines, '\n');
}

function tomlString(value: string): string {
  return buildSecuritySourceLiteral(value);
}

function snapshotNodePresetOptions(options: NodePresetOptions): NodePresetOptions {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Node preset options must be an own-data object.');
  }
  const dockerfileProperty = buildOwnDataProperty(
    options,
    'dockerfile',
    'Node preset options.dockerfile',
  );
  if (
    dockerfileProperty.present &&
    dockerfileProperty.value !== undefined &&
    typeof dockerfileProperty.value !== 'boolean'
  ) {
    throw new TypeError('Node preset option dockerfile must be a boolean.');
  }
  const jobRunnerProperty = buildOwnDataProperty(
    options,
    'jobRunner',
    'Node preset options.jobRunner',
  );
  const retentionProperty = buildOwnDataProperty(
    options,
    'retention',
    'Node preset options.retention',
  );
  const jobRunner =
    !jobRunnerProperty.present || jobRunnerProperty.value === undefined
      ? undefined
      : snapshotNodeJobRunnerOptions(jobRunnerProperty.value);
  const retention =
    !retentionProperty.present || retentionProperty.value === undefined
      ? undefined
      : snapshotDeploySkewRetentionProof(retentionProperty.value, 'Node');
  const snapshot = createSecurityNullRecord() as NodePresetOptions;
  if (dockerfileProperty.present && dockerfileProperty.value !== undefined) {
    snapshot.dockerfile = dockerfileProperty.value as boolean;
  }
  if (jobRunner !== undefined) snapshot.jobRunner = jobRunner;
  if (retention !== undefined) snapshot.retention = retention;
  return snapshot;
}

function snapshotNodeJobRunnerOptions(value: unknown): NodeJobRunnerOptions | false {
  if (value === false) return false;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Node preset option jobRunner must be false or an own-data object.');
  }
  const modeProperty = buildOwnDataProperty(value, 'mode', 'Node preset options.jobRunner.mode');
  if (
    modeProperty.present &&
    modeProperty.value !== undefined &&
    modeProperty.value !== 'serve-and-run' &&
    modeProperty.value !== 'runner-only'
  ) {
    throw new TypeError('Node preset option jobRunner.mode must be serve-and-run or runner-only.');
  }
  const snapshot = createSecurityNullRecord() as NodeJobRunnerOptions;
  if (modeProperty.present && modeProperty.value !== undefined) {
    snapshot.mode = modeProperty.value as NonNullable<NodeJobRunnerOptions['mode']>;
  }
  return snapshot;
}

function snapshotVercelPresetOptions(options: VercelPresetOptions): VercelPresetOptions {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Vercel preset options must be an own-data object.');
  }
  const maxDuration = optionalVercelPresetNumber(options, 'maxDuration');
  const memory = optionalVercelPresetNumber(options, 'memory');
  const regionsProperty = buildOwnDataProperty(options, 'regions', 'Vercel preset options.regions');
  const retentionProperty = buildOwnDataProperty(
    options,
    'retention',
    'Vercel preset options.retention',
  );
  const regions =
    !regionsProperty.present || regionsProperty.value === undefined
      ? undefined
      : snapshotVercelRegions(regionsProperty.value);
  const retention =
    !retentionProperty.present || retentionProperty.value === undefined
      ? undefined
      : snapshotDeploySkewRetentionProof(retentionProperty.value, 'Vercel');
  const snapshot = createSecurityNullRecord() as VercelPresetOptions;
  if (maxDuration !== undefined) snapshot.maxDuration = maxDuration;
  if (memory !== undefined) snapshot.memory = memory;
  if (regions !== undefined) snapshot.regions = regions;
  if (retention !== undefined) snapshot.retention = retention;
  return snapshot;
}

function optionalVercelPresetNumber(
  options: object,
  property: 'maxDuration' | 'memory',
): number | undefined {
  const field = buildOwnDataProperty(options, property, `Vercel preset options.${property}`);
  if (!field.present || field.value === undefined) return undefined;
  if (
    typeof field.value !== 'number' ||
    !securityNumberIsFinite(field.value) ||
    !securityNumberIsInteger(field.value) ||
    field.value <= 0 ||
    field.value > 9_007_199_254_740_991
  ) {
    throw new TypeError(`Vercel preset option ${property} must be a positive safe integer.`);
  }
  return field.value;
}

function snapshotVercelRegions(value: unknown): readonly string[] {
  if (!securityArrayIsArray(value)) {
    throw new TypeError('Vercel preset option regions must be an array.');
  }
  const regions = snapshotBuildArray(value, 'Vercel preset regions');
  for (let index = 0; index < regions.length; index += 1) {
    if (typeof regions[index] !== 'string') {
      throw new TypeError(`Vercel preset option regions[${index}] must be a string.`);
    }
  }
  return regions as readonly string[];
}

function snapshotCloudflarePresetOptions(
  options: CloudflarePresetOptions,
): CloudflarePresetOptions {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Cloudflare preset options must be an own-data object.');
  }

  const compatibilityDate = optionalCloudflarePresetString(options, 'compatibilityDate');
  const name = optionalCloudflarePresetString(options, 'name');
  const retentionProperty = buildOwnDataProperty(
    options,
    'retention',
    'Cloudflare preset options.retention',
  );
  const retention =
    !retentionProperty.present || retentionProperty.value === undefined
      ? undefined
      : snapshotDeploySkewRetentionProof(retentionProperty.value, 'Cloudflare');
  const snapshot = createSecurityNullRecord() as CloudflarePresetOptions;
  if (compatibilityDate !== undefined) snapshot.compatibilityDate = compatibilityDate;
  if (name !== undefined) snapshot.name = name;
  if (retention !== undefined) snapshot.retention = retention;
  return snapshot;
}

function optionalCloudflarePresetString(
  options: object,
  property: 'compatibilityDate' | 'name',
): string | undefined {
  const field = buildOwnDataProperty(options, property, `Cloudflare preset options.${property}`);
  if (!field.present || field.value === undefined) return undefined;
  if (typeof field.value !== 'string') {
    throw new TypeError(`Cloudflare preset option ${property} must be a string.`);
  }
  return field.value;
}

function snapshotDeploySkewRetentionProof(
  value: unknown,
  presetName: string,
): DeploySkewRetentionProof {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${presetName} preset retention proof must be an own-data object.`);
  }
  const hours = buildOwnDataProperty(value, 'hours', `${presetName} retention proof.hours`);
  const immutableClientModules = buildOwnDataProperty(
    value,
    'immutableClientModules',
    `${presetName} retention proof.immutableClientModules`,
  );
  const priorTokenQueryReads = buildOwnDataProperty(
    value,
    'priorTokenQueryReads',
    `${presetName} retention proof.priorTokenQueryReads`,
  );
  if (
    !hours.present ||
    typeof hours.value !== 'number' ||
    !securityNumberIsFinite(hours.value) ||
    !securityNumberIsInteger(hours.value) ||
    hours.value < 0 ||
    hours.value > 9_007_199_254_740_991
  ) {
    throw new TypeError(
      `${presetName} preset retention proof hours must be a finite non-negative safe integer.`,
    );
  }
  if (!immutableClientModules.present || immutableClientModules.value !== 'retained') {
    throw new TypeError(
      `${presetName} preset retention proof immutableClientModules must be retained.`,
    );
  }
  if (!priorTokenQueryReads.present || priorTokenQueryReads.value !== 'retained') {
    throw new TypeError(
      `${presetName} preset retention proof priorTokenQueryReads must be retained.`,
    );
  }
  const snapshot = createSecurityNullRecord() as unknown as DeploySkewRetentionProof;
  snapshot.hours = hours.value;
  snapshot.immutableClientModules = immutableClientModules.value;
  snapshot.priorTokenQueryReads = priorTokenQueryReads.value;
  return snapshot;
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

  function defineArrayValue<Value>(values: Value[], index: number, value: Value): void {
    apply(nativeObjectDefineProperty, NativeObject, [
      values,
      index,
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
    append(replacements, [unsafe, safe]);
    while (index > 0 && replacements[index - 1]![0].length < unsafe.length) {
      defineArrayValue(replacements, index, replacements[index - 1]!);
      index -= 1;
    }
    defineArrayValue(replacements, index, [unsafe, safe]);
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
    for (let index = 0; index < value.length; index += 1) {
      const code = charCode(value, index);
      if (!(code <= 0x1f || (code >= 0x7f && code <= 0x9f))) continue;
      result += apply<string>(nativeStringSlice, value, [cursor, index]) + '\\u';
      result += hexDigit((code >>> 12) & 0xf) + hexDigit((code >>> 8) & 0xf);
      result += hexDigit((code >>> 4) & 0xf) + hexDigit(code & 0xf);
      cursor = index + 1;
    }
    return cursor === 0 ? value : result + apply<string>(nativeStringSlice, value, [cursor]);
  }

  function hexDigit(value: number): string {
    switch (value) {
      case 0:
        return '0';
      case 1:
        return '1';
      case 2:
        return '2';
      case 3:
        return '3';
      case 4:
        return '4';
      case 5:
        return '5';
      case 6:
        return '6';
      case 7:
        return '7';
      case 8:
        return '8';
      case 9:
        return '9';
      case 10:
        return 'a';
      case 11:
        return 'b';
      case 12:
        return 'c';
      case 13:
        return 'd';
      case 14:
        return 'e';
      case 15:
        return 'f';
      default:
        throw new TypeError('Kovo diagnostic sanitizer produced an invalid hexadecimal nibble.');
    }
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
      append(values, item);
      while (insertion > 0 && values[insertion - 1]!.length < item.length) {
        defineArrayValue(values, insertion, values[insertion - 1]!);
        insertion -= 1;
      }
      defineArrayValue(values, insertion, item);
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
import {
  close as importedCloseFileDescriptor,
  constants as fsConstants,
  fstat as importedStatFileDescriptor,
  open as importedOpenFileDescriptor,
  readFile as importedReadFileDescriptor,
  stat as importedStatFilePath,
} from 'node:fs';
import { realpath as importedRealpath } from 'node:fs/promises';
import { createServer as importedCreateServer, ServerResponse } from 'node:http';
import {
  basename as importedPathBasename,
  extname as importedPathExtname,
  isAbsolute as importedPathIsAbsolute,
  resolve as importedPathResolve,
  sep as importedPathSeparator,
} from 'node:path';
import {
  fileURLToPath as importedFileUrlToPath,
  pathToFileURL as importedPathToFileUrl,
} from 'node:url';
import {
  armIncompleteNodeRequestClose,
  nodeRequestToWebRequest,
  rejectUnsafeNodeMutationTarget,
  writeWebResponseToNode,
} from './node-adapter.mjs';

const NativeMap = globalThis.Map;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeRegExp = globalThis.RegExp;
const NativeRequest = globalThis.Request;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
// Node's built-in ESM exports are live bindings: authored handler code can replace the CommonJS
// export and call syncBuiltinESMExports(). Copy every later authority-bearing fs/path control into
// a boot-owned constant before the handler module is evaluated (SPEC §6.6 rule 6 / §10.6).
const closeFileDescriptor = importedCloseFileDescriptor;
const createNodeHttpServer = importedCreateServer;
const fileUrlToPath = importedFileUrlToPath;
const openFileDescriptor = importedOpenFileDescriptor;
const pathBasename = importedPathBasename;
const pathExtname = importedPathExtname;
const pathIsAbsolute = importedPathIsAbsolute;
const pathResolve = importedPathResolve;
const pathSeparator = importedPathSeparator;
const pathToFileUrl = importedPathToFileUrl;
const readFileDescriptor = importedReadFileDescriptor;
const realpath = importedRealpath;
const statFileDescriptor = importedStatFileDescriptor;
const statFilePath = importedStatFilePath;
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
const fsReadOnlyNoFollowFlags = fsConstants.O_RDONLY |
  (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);
const createNodeDiagnosticRecord = (${generatedNodeDiagnosticFactorySource})();

const clientRoot = pathResolve(fileUrlToPath(new NativeURL('.', import.meta.url)), 'client');
const staticRoot = pathResolve(fileUrlToPath(new NativeURL('.', import.meta.url)), 'static');
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
  const server = createNodeHttpServer(async (nodeRequest, nodeResponse) => {
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
  const expectedStat = await staticFilePathStat(resolved);
  if (!regularStaticFileStat(expectedStat)) return undefined;

  // SPEC §10.6: realpath/stat followed by readFile(path) reopens an attacker-swappable name.
  // Bind the canonical contained inode before opening, require the opened descriptor to retain
  // that exact identity (covering final-component and intermediate-directory swaps), and read only
  // through the descriptor. Post-read path/descriptor revalidation prevents returning bytes after
  // the canonical entry was replaced while the request was in flight.
  const fileDescriptor = await openStaticFileDescriptor(resolved);
  if (fileDescriptor === undefined) return undefined;
  try {
    const openedStat = await staticFileDescriptorStat(fileDescriptor);
    if (
      !regularStaticFileStat(openedStat) ||
      !sameStaticFileIdentity(expectedStat, openedStat) ||
      !(await staticPathRetainsIdentity(realRoot, resolved, expectedStat))
    ) {
      return undefined;
    }

    const body = await readStaticFileDescriptor(fileDescriptor);
    const completedStat = await staticFileDescriptorStat(fileDescriptor);
    if (
      !regularStaticFileStat(completedStat) ||
      !sameStaticFileIdentity(expectedStat, completedStat) ||
      !(await staticPathRetainsIdentity(realRoot, resolved, expectedStat))
    ) {
      return undefined;
    }

    const headers = ownDataValue(options, 'headers');
    const contentType = ownDataValue(options, 'contentType');
    return {
      body,
      contentDisposition: routeOutcomeContentDisposition(options, resolved),
      contentType,
      ...(headers === undefined ? {} : { headers }),
      routeResponse: true,
    };
  } finally {
    await closeStaticFileDescriptor(fileDescriptor);
  }
}

function openStaticFileDescriptor(path) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    openFileDescriptor(path, fsReadOnlyNoFollowFlags, (error, fileDescriptor) => {
      if (error) {
        if (isStaticFileMissError(error)) resolvePromise(undefined);
        else rejectPromise(error);
        return;
      }
      resolvePromise(fileDescriptor);
    });
  });
}

function staticFileDescriptorStat(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    statFileDescriptor(fileDescriptor, (error, fileStat) => {
      if (error) rejectPromise(error);
      else resolvePromise(fileStat);
    });
  });
}

function staticFilePathStat(path) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    statFilePath(path, (error, fileStat) => {
      if (error) {
        if (isStaticFileMissError(error)) resolvePromise(undefined);
        else rejectPromise(error);
        return;
      }
      resolvePromise(fileStat);
    });
  });
}

function readStaticFileDescriptor(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    readFileDescriptor(fileDescriptor, (error, body) => {
      if (error) rejectPromise(error);
      else resolvePromise(body);
    });
  });
}

function closeStaticFileDescriptor(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    closeFileDescriptor(fileDescriptor, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function regularStaticFileStat(fileStat) {
  if (fileStat === undefined) return false;
  const mode = ownDataValue(fileStat, 'mode');
  return typeof mode === 'number' && (mode & fsFileTypeMask) === fsRegularFileType;
}

function sameStaticFileIdentity(left, right) {
  const leftDevice = ownDataValue(left, 'dev');
  const leftInode = ownDataValue(left, 'ino');
  const rightDevice = ownDataValue(right, 'dev');
  const rightInode = ownDataValue(right, 'ino');
  return typeof leftDevice === 'number' &&
    typeof leftInode === 'number' &&
    leftDevice === rightDevice &&
    leftInode === rightInode;
}

async function staticPathRetainsIdentity(realRoot, resolved, expectedStat) {
  const currentResolved = await safeRealpath(resolved);
  if (
    currentResolved === undefined ||
    currentResolved !== resolved ||
    !containsPath(realRoot, currentResolved)
  ) {
    return false;
  }
  const currentStat = await staticFilePathStat(currentResolved);
  return regularStaticFileStat(currentStat) && sameStaticFileIdentity(expectedStat, currentStat);
}

function isStaticFileMissError(error) {
  const code = ownDataValue(error, 'code');
  // Darwin realpath can report EINVAL while an entry is atomically replaced by a symlink.
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EINVAL';
}

function rootedStaticCandidate(realRoot, requestedPath) {
  if (stringIncludes(requestedPath, '\\0') || pathIsAbsolute(requestedPath)) return undefined;
  const candidate = pathResolve(realRoot, requestedPath);
  return containsPath(realRoot, candidate) ? candidate : undefined;
}

function containsPath(root, target) {
  return target === root || stringStartsWith(target, root + pathSeparator);
}

async function safeRealpath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (isStaticFileMissError(error)) return undefined;
    throw error;
  }
}

function routeOutcomeContentDisposition(options, resolvedPath) {
  const disposition = ownDataValue(options, 'disposition') ?? 'attachment';
  const filename = ownDataValue(options, 'filename') ?? pathBasename(resolvedPath);
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
  switch (apply(nativeStringToLowerCase, pathExtname(filePath), [])) {
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

if (process.argv[1] && pathToFileUrl(process.argv[1]).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  // Import the app before opening the listener so framework boot invariants (including the
  // production database-authority floor from SPEC §10.3) fail closed at process startup.
  await loadHandler();
  createKovoNodeServer().listen(port, host, () => {
    console.log('Kovo node server listening on http://' + host + ':' + port);
  });
}
`;
}

function nodeDockerfileSource(): string {
  return `FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json ./
COPY --chown=node:node package-lock.json* npm-shrinkwrap.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --omit=dev --ignore-scripts; \
  elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --prod --frozen-lockfile --ignore-scripts; \
  elif [ -f yarn.lock ] && node -e "process.exit(JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).packageManager?.startsWith('yarn@1.') ? 0 : 1)"; then corepack yarn install --production --frozen-lockfile --ignore-scripts; \
  elif [ -f yarn.lock ]; then corepack yarn install --immutable --mode=skip-builds; \
  else echo 'Kovo node images require a package lockfile; refusing an unlocked production install.' >&2; exit 1; fi
COPY --chown=node:node . .
EXPOSE 3000
CMD ["node", "server.mjs"]
`;
}

async function nodeRuntimePackageEntries(
  outDir: string,
  projectRoot: string,
): Promise<ArtifactOutputEntry[]> {
  const source = await readPackageJsonForNodeRuntime(projectRoot);
  const runtimePackage = {
    dependencies: source.dependencies ?? {},
    ...(source.devDependencies === undefined ? {} : { devDependencies: source.devDependencies }),
    name: `${source.name ?? 'kovo-app'}-server`,
    ...(source.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: source.optionalDependencies }),
    private: true,
    scripts: { start: 'NODE_ENV=production node server.mjs' },
    type: 'module',
    ...(source.packageManager === undefined ? {} : { packageManager: source.packageManager }),
  };
  const entries: ArtifactOutputEntry[] = [
    presetContentEntry(
      outDir,
      'package.json',
      `${buildSecuritySourceLiteral(runtimePackage)}\n`,
      'node runtime package manifest',
    ),
  ];
  const lockfile = await runtimeLockfileEntry(outDir, projectRoot);
  if (lockfile !== undefined) {
    commitBuildArrayValue(entries, lockfile, 'Node runtime package output entries');
  }
  return entries;
}

interface NodeRuntimePackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
  packageManager?: string;
}

async function readPackageJsonForNodeRuntime(
  projectRoot: string,
): Promise<NodeRuntimePackageManifest> {
  let source: string;
  try {
    source = await readFile(buildSecurityPathJoin(projectRoot, 'package.json'), 'utf8');
  } catch {
    return {};
  }
  return snapshotNodeRuntimePackageManifest(securityJsonParse(source));
}

const runtimeLockfileNames = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

async function runtimeLockfileEntry(
  outDir: string,
  projectRoot: string,
): Promise<ArtifactOutputEntry | undefined> {
  const fileNames = snapshotBuildArray(runtimeLockfileNames, 'Node runtime lockfile candidates');
  const project = createFrameworkOutputFileSystemBoundary(projectRoot);
  await project.ensureDirectory();
  for (let index = 0; index < fileNames.length; index += 1) {
    const fileName = fileNames[index]!;
    try {
      const bytes = await project.fileBytes(fileName);
      if (bytes !== undefined) {
        return presetContentEntry(outDir, fileName, bytes, `node runtime ${fileName}`);
      }
    } catch {
      // Lockfiles are optional for the deploy artifact; package.json still gives Docker an install path.
    }
  }
  return undefined;
}

function snapshotNodeRuntimePackageManifest(value: unknown): NodeRuntimePackageManifest {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Node runtime package manifest must be an own-data object.');
  }
  const name = optionalNodeRuntimePackageString(value, 'name');
  const packageManager = optionalNodeRuntimePackageString(value, 'packageManager');
  const dependencies = optionalNodeRuntimeDependencies(value, 'dependencies');
  const devDependencies = optionalNodeRuntimeDependencies(value, 'devDependencies');
  const optionalDependencies = optionalNodeRuntimeDependencies(value, 'optionalDependencies');
  return {
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(devDependencies === undefined ? {} : { devDependencies }),
    ...(name === undefined ? {} : { name }),
    ...(optionalDependencies === undefined ? {} : { optionalDependencies }),
    ...(packageManager === undefined ? {} : { packageManager }),
  };
}

function optionalNodeRuntimeDependencies(
  value: object,
  property: 'dependencies' | 'devDependencies' | 'optionalDependencies',
): Record<string, string> | undefined {
  const field = buildOwnDataProperty(value, property, `Node runtime package manifest.${property}`);
  if (!field.present || field.value === undefined) return undefined;
  return snapshotNodeRuntimeDependencies(field.value);
}

function optionalNodeRuntimePackageString(
  value: object,
  property: 'name' | 'packageManager',
): string | undefined {
  const field = buildOwnDataProperty(value, property, `Node runtime package manifest.${property}`);
  if (!field.present || field.value === undefined) return undefined;
  if (typeof field.value !== 'string') {
    throw new TypeError(`Node runtime package manifest ${property} must be a string.`);
  }
  return field.value;
}

function snapshotNodeRuntimeDependencies(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Node runtime package dependencies must be an own-data object.');
  }
  const dependencies = createSecurityNullRecord<string>();
  const names = snapshotBuildArray(securityObjectKeys(value), 'Node runtime dependency names');
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const dependency = buildOwnDataProperty(value, name, `Node runtime package dependency ${name}`);
    if (!dependency.present || typeof dependency.value !== 'string') {
      throw new TypeError(`Node runtime package dependency ${name} must be a string.`);
    }
    dependencies[name] = dependency.value;
  }
  return dependencies;
}
