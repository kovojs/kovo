import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  writeKovoExampleProject,
  writeKovoProject,
  type CreateKovoDialect,
  type CreateKovoExampleName,
  type CreateKovoRetentionPosture,
} from './index.js';
import {
  boundedTestProcessCleanupBudgetMs,
  runBoundedTestProcess,
  type BoundedTestProcessOutcome,
} from './index.test-process-supervisor.mjs';
import {
  GENERATED_STARTER_CLI_SIGNAL_GRACE_MS as GENERATED_STARTER_SIGNAL_GRACE_MS,
  generatedStarterCliProcessTimeoutMs,
  generatedStarterFixtureSetupHeadroomMs,
  generatedStarterTestTimeoutMs,
  starterServerReadyTimeoutMs,
} from './index.test-deadlines.mjs';

// A generated application can spend over a minute compiling its initial development graph on a
// contended machine. Keep local feedback bounded at ninety seconds while giving the two-core hosted
// runner enough headroom to distinguish slow compilation from a server that never becomes ready.
export const STARTER_SERVER_READY_TIMEOUT_MS = starterServerReadyTimeoutMs();

// A valid production build reached roughly 5.5 minutes on a contended two-core hosted runner. The
// seven-minute ceiling leaves scheduling headroom while still bounding deadlock. This is test
// infrastructure, not a Kovo product-performance budget.
export const GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS = generatedStarterCliProcessTimeoutMs();
export const GENERATED_STARTER_CLI_SIGNAL_GRACE_MS = GENERATED_STARTER_SIGNAL_GRACE_MS;
export const GENERATED_STARTER_CLI_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS = generatedStarterFixtureSetupHeadroomMs();

export interface GeneratedStarterCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  signalGraceMs?: number;
  timeoutMs?: number;
}

export interface GeneratedStarterCommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

export type GeneratedStarterCommandOutcomeKind =
  | 'cleanup-error'
  | 'launch-error'
  | 'nonzero-exit'
  | 'output-overflow'
  | 'signal'
  | 'success'
  | 'timeout'
  | 'unknown-exit';

interface GeneratedStarterCommandFailureBase extends GeneratedStarterCommandResult {
  readonly outcome: Readonly<BoundedTestProcessOutcome>;
}

type GeneratedStarterCommandInfrastructureFailureKind = Exclude<
  GeneratedStarterCommandOutcomeKind,
  'nonzero-exit' | 'signal' | 'success'
>;

export type GeneratedStarterCommandFailure =
  | (GeneratedStarterCommandFailureBase & {
      readonly kind: GeneratedStarterCommandInfrastructureFailureKind;
    })
  | (GeneratedStarterCommandFailureBase & {
      readonly exitCode: number;
      readonly kind: 'nonzero-exit';
    })
  | (GeneratedStarterCommandFailureBase & {
      readonly kind: 'signal';
      readonly signal: string;
    });

export type GeneratedStarterCommandNonzeroExitFailure = Extract<
  GeneratedStarterCommandFailure,
  { readonly kind: 'nonzero-exit' }
>;

export interface GeneratedStarterCommandError extends Error, GeneratedStarterCommandResult {
  readonly failure: GeneratedStarterCommandFailure;
}

const generatedStarterCommandFailureByError = new WeakMap<Error, GeneratedStarterCommandFailure>();

/**
 * Keep Vitest's outer watchdog beyond every child deadline, forced-cleanup window, and server-ready
 * poll in a generated-starter proof. Fixture setup gets one aggregate supervised deadline, so its
 * hosted-runner headroom is enforceable even though the setup API remains synchronous.
 */
export function generatedStarterTestTimeout(options: {
  cliProcessCount: number;
  serverProcessCount?: number;
}): number {
  return generatedStarterTestTimeoutMs(options);
}

type StarterInstallMode = 'link-local' | 'packed' | 'symlink';
type StarterScaffoldMode = 'packed-bin' | 'source';

interface StarterAppOptions {
  dialect?: CreateKovoDialect;
  example?: CreateKovoExampleName;
  experimentalSqlite?: boolean;
  install?: StarterInstallMode;
  name: string;
  retention?: CreateKovoRetentionPosture;
  scaffold?: StarterScaffoldMode;
  tempParent?: string;
  tempPrefix?: string;
}

interface StarterAppInstall {
  mode: StarterInstallMode;
  tarballDir?: string;
}

export interface StarterTestApp {
  cleanup(): void;
  install: StarterAppInstall;
  root: string;
}

interface WorkspacePackage {
  dir: string;
  name: string;
}

interface PackedKovoPackages {
  overridesByName: Record<string, string>;
  tarballByName: Map<string, string>;
  tarballDir: string;
}

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  pnpm?: Record<string, unknown> & { overrides?: Record<string, string> };
  [key: string]: unknown;
};

const packedWorkspacePackages: readonly WorkspacePackage[] = [
  { name: '@kovojs/core', dir: 'core' },
  { name: '@kovojs/style', dir: 'style' },
  { name: '@kovojs/browser', dir: 'browser' },
  { name: '@kovojs/server', dir: 'server' },
  { name: '@kovojs/drizzle', dir: 'drizzle' },
  { name: '@kovojs/headless-ui', dir: 'headless-ui' },
  { name: '@kovojs/icons', dir: 'icons' },
  { name: '@kovojs/ui', dir: 'ui' },
  { name: '@kovojs/better-auth', dir: 'better-auth' },
  { name: '@kovojs/verify', dir: 'verify' },
  { name: '@kovojs/test', dir: 'test' },
  { name: '@kovojs/compiler', dir: 'compiler' },
  { name: '@kovojs/cli', dir: 'cli' },
  { name: 'create-kovo', dir: 'create-kovo' },
];

let packedKovoPackageCache: PackedKovoPackages | undefined;
const packedKovoPackageManifest = 'packed-kovo-packages.json';
const packedStarterCiManifestProducer = 'scripts/ci-shards.mjs pack-starter';

export async function createStarterApp(options: StarterAppOptions): Promise<StarterTestApp> {
  const setupDeadlineAtMs = fixtureSetupDeadlineAtMs();
  const tempParent = options.tempParent ?? tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const parent = mkdtempSync(join(tempParent, options.tempPrefix ?? 'create-kovo-app-'));
  const root = join(parent, 'app');
  mkdirSync(root, { recursive: true });

  try {
    const scaffold = options.scaffold ?? 'source';
    const installMode = options.install ?? 'symlink';
    const packedPackages =
      scaffold === 'packed-bin' ? await packKovoWorkspacePackages(setupDeadlineAtMs) : undefined;

    if (scaffold === 'packed-bin') {
      await scaffoldWithPackedCreateKovo(root, options, packedPackages, setupDeadlineAtMs);
    } else if (options.example !== undefined) {
      writeKovoExampleProject(root, {
        disableGit: true,
        example: options.example,
        name: options.name,
        ...(options.retention === undefined ? {} : { retention: options.retention }),
      });
    } else {
      writeKovoProject(root, {
        ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
        disableGit: true,
        name: options.name,
        ...(options.retention === undefined ? {} : { retention: options.retention }),
      });
    }

    const install = await installStarterAppDependencies(
      root,
      installMode,
      packedPackages,
      setupDeadlineAtMs,
    );

    return {
      cleanup() {
        rmSync(parent, { force: true, recursive: true });
      },
      install,
      root,
    };
  } catch (error) {
    rmSync(parent, { force: true, recursive: true });
    throw error;
  }
}

export async function installStarterAppDependencies(
  root: string,
  mode: StarterInstallMode,
  packedPackages?: PackedKovoPackages,
  setupDeadlineAtMs = fixtureSetupDeadlineAtMs(),
): Promise<StarterAppInstall> {
  const installMode = resolveStarterInstallMode(mode);
  if (installMode === 'symlink') {
    linkWorkspaceStarterBuildDependencies(root);
    return { mode: installMode };
  }

  if (installMode === 'link-local') {
    await execStarterCommand(
      process.execPath,
      [join(process.cwd(), 'scripts/link-local-kovo.mjs'), root],
      {
        cwd: process.cwd(),
        setupDeadlineAtMs,
      },
    );
    await execStarterCommand('pnpm', ['install', '--ignore-workspace'], {
      cwd: root,
      env: starterInstallEnv(root),
      setupDeadlineAtMs,
    });
    return { mode: installMode };
  }

  const currentPackages = packedPackages ?? (await packKovoWorkspacePackages(setupDeadlineAtMs));
  rewriteKovoDependenciesToTarballs(root, currentPackages);
  await execStarterCommand('pnpm', ['install', '--ignore-workspace'], {
    cwd: root,
    env: starterInstallEnv(root),
    setupDeadlineAtMs,
  });
  return { mode: installMode, tarballDir: currentPackages.tarballDir };
}

/**
 * Keep generated source fixtures on source-linked packages by default. Starter CI can opt into
 * the same-run package artifact so repeated production builds exercise exact current dist bytes
 * instead of paying the TypeScript source-loader cost in every isolated proof worker.
 */
export function resolveStarterInstallMode(
  requested: StarterInstallMode,
  environment: NodeJS.ProcessEnv = process.env,
): StarterInstallMode {
  const currentBuildMode = environment.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES;
  if (currentBuildMode === undefined) return requested;
  if (currentBuildMode !== 'packed-current') {
    throw new TypeError(
      'KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES must be "packed-current" when set.',
    );
  }
  if (!environment.KOVO_PACKED_PACKAGES_DIR) {
    throw new TypeError(
      'Packed-current source fixtures require KOVO_PACKED_PACKAGES_DIR from the same CI run.',
    );
  }
  return 'packed';
}

export async function runStarterTypecheck(root: string): Promise<void> {
  const generatedRuntimeFiles = [
    ...(existsSync(join(root, 'src/_kovo/app-runtime-db-options.ts'))
      ? ['src/_kovo/app-runtime-db-options.ts']
      : []),
    'src/_kovo/app-runtime-db.ts',
  ];
  await runGeneratedStarterCommand(
    resolveStarterBin(root, 'tsc'),
    [
      '--ignoreConfig',
      '--noEmit',
      '--allowImportingTsExtensions',
      '--jsx',
      'react-jsx',
      '--jsxImportSource',
      '@kovojs/server',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2024',
      '--strict',
      '--skipLibCheck',
      '--exactOptionalPropertyTypes',
      '--noUncheckedIndexedAccess',
      '--types',
      'node',
      'src/schema.ts',
      'src/db.ts',
      ...generatedRuntimeFiles,
      'src/auth.ts',
      'src/kovo.ts',
      'src/queries.ts',
      'src/mutations.ts',
      'src/components/contacts.tsx',
      'src/components/auth-forms.tsx',
      'src/app.tsx',
    ],
    { cwd: root, env: withStarterBinOnPath(root) },
  );
}

export async function runStarterAppHttpTest(root: string): Promise<void> {
  await runGeneratedStarterCommand(resolveStarterBin(root, 'kovo'), ['build', './src/app.tsx'], {
    cwd: root,
    env: withStarterBinOnPath(root),
  });
  await runGeneratedStarterCommand(resolveStarterBin(root, 'kovo'), ['test', 'src/app.test.ts'], {
    cwd: root,
    env: withStarterBinOnPath(root),
  });
}

export async function runStarterCheck(root: string): Promise<void> {
  await runGeneratedStarterCommand(resolveStarterBin(root, 'kovo'), ['check'], {
    cwd: root,
    env: withStarterBinOnPath(root),
  });
}

/** Run a real generated-starter command with a fail-closed process-tree deadline. */
export async function runGeneratedStarterCommand(
  file: string,
  args: readonly string[],
  options: GeneratedStarterCommandOptions,
): Promise<GeneratedStarterCommandResult> {
  const timeoutMs = options.timeoutMs ?? GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS;
  const signalGraceMs = options.signalGraceMs ?? GENERATED_STARTER_CLI_SIGNAL_GRACE_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Generated-starter command timeoutMs must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(signalGraceMs) || signalGraceMs <= 0) {
    throw new TypeError('Generated-starter command signalGraceMs must be a positive safe integer.');
  }

  const outcome = await runBoundedTestProcess({
    args,
    command: file,
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    killGraceMs: signalGraceMs,
    maxOutputBytes: options.maxOutputBytes ?? GENERATED_STARTER_CLI_MAX_OUTPUT_BYTES,
    rootExitTimeoutMs: signalGraceMs,
    streamCloseTimeoutMs: signalGraceMs,
    supervisorTimeoutMs: timeoutMs,
    terminationGraceMs: signalGraceMs,
  });
  const result = commandOutput(outcome);
  const kind = classifyGeneratedStarterCommandOutcome(outcome);
  if (kind !== 'success') {
    const failure = generatedStarterCommandFailureFromOutcome(outcome, kind);
    throw generatedStarterCommandError(
      generatedStarterCommandFailureMessage(file, args, options, failure),
      failure,
    );
  }
  return result;
}

/**
 * Classify a supervised child outcome without inspecting diagnostic text. Infrastructure failures
 * take precedence over exit status so a timeout or cleanup failure can never masquerade as an
 * expected compiler rejection merely because its captured output contains the expected code.
 */
export function classifyGeneratedStarterCommandOutcome(
  outcome: Readonly<BoundedTestProcessOutcome>,
): GeneratedStarterCommandOutcomeKind {
  if (outcome.timedOut) return 'timeout';
  if (outcome.outputOverflowed) return 'output-overflow';
  if (outcome.cleanupError !== null) return 'cleanup-error';
  if (outcome.error !== null) return 'launch-error';
  if (outcome.signal !== null) return 'signal';
  if (Number.isSafeInteger(outcome.exitCode) && outcome.exitCode !== 0) return 'nonzero-exit';
  if (outcome.exitCode === 0) return 'success';
  return 'unknown-exit';
}

/** Return only authenticated failures created by runGeneratedStarterCommand. */
export function generatedStarterCommandFailure(
  error: unknown,
): GeneratedStarterCommandFailure | undefined {
  return error instanceof Error ? generatedStarterCommandFailureByError.get(error) : undefined;
}

export function isGeneratedStarterCommandNonzeroExitFailure(
  failure: GeneratedStarterCommandFailure,
): failure is GeneratedStarterCommandNonzeroExitFailure {
  return failure.kind === 'nonzero-exit';
}

/** Fail closed unless this exact runner produced an ordinary numeric nonzero exit. */
export function requireGeneratedStarterCommandNonzeroExitFailure(
  error: unknown,
): GeneratedStarterCommandNonzeroExitFailure {
  const failure = generatedStarterCommandFailure(error);
  if (failure === undefined || !isGeneratedStarterCommandNonzeroExitFailure(failure)) throw error;
  return failure;
}

export function installedPackageJson(root: string, packageName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, 'node_modules', packageName, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
}

export function resolveStarterBin(root: string, name: string): string {
  const localBin = join(root, 'node_modules/.bin', name);
  if (existsSync(localBin)) return realpathSync(localBin);
  const packageJsonCandidates = [join(root, 'node_modules', name, 'package.json')];
  const pnpmStore = findPnpmStore(join(root, 'node_modules'));
  if (pnpmStore) {
    for (const entry of readdirSync(pnpmStore)) {
      packageJsonCandidates.push(join(pnpmStore, entry, 'node_modules', name, 'package.json'));
    }
  }
  for (const localPackageJson of packageJsonCandidates) {
    if (!existsSync(localPackageJson)) continue;
    const packageJson = JSON.parse(readFileSync(localPackageJson, 'utf8')) as {
      bin?: Record<string, string> | string;
    };
    const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[name];
    if (typeof bin === 'string') {
      const packageBin = join(dirname(localPackageJson), bin);
      if (existsSync(packageBin)) return realpathSync(packageBin);
    }
    // pnpm preserves the workspace-facing source bin in packed package metadata.
    // Published create-kovo tarballs omit src/ and carry the runnable artifact in dist/.
    if (name === 'create-kovo') {
      const packedBin = join(dirname(localPackageJson), 'dist/index.mjs');
      if (existsSync(packedBin)) return realpathSync(packedBin);
    }
  }
  return resolveBin(name);
}

export function withStarterBinOnPath(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [
      join(root, 'node_modules/.bin'),
      join(process.cwd(), 'node_modules/.bin'),
      process.env.PATH ?? '',
    ].join(':'),
  };
}

export async function linkStarterBuildDependencies(root: string): Promise<void> {
  if (resolveStarterInstallMode('symlink') === 'packed') {
    await installStarterAppDependencies(root, 'symlink');
    return;
  }
  linkWorkspaceStarterBuildDependencies(root);
}

function linkWorkspaceStarterBuildDependencies(root: string): void {
  const nodeModules = join(root, 'node_modules');
  const nodeModulesBin = join(nodeModules, '.bin');
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  mkdirSync(join(nodeModules, '@electric-sql'), { recursive: true });
  mkdirSync(join(nodeModules, '@node-rs'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

  // SPEC §5.2.3: symlink-mode fixtures bypass a package-manager install, so copy the workspace
  // lock snapshot they actually resolve through. Packed/link-local modes produce their own lockfile.
  const lockfilePath = join(root, 'pnpm-lock.yaml');
  if (!existsSync(lockfilePath)) {
    writeFileSync(lockfilePath, readFileSync(join(process.cwd(), 'pnpm-lock.yaml')));
  }

  symlinkSync(join(resolveDependencyRoot('kovo'), 'src/bin.ts'), join(nodeModulesBin, 'kovo'));
  symlinkSync(join(resolveDependencyRoot('vite-plus'), 'bin/vp'), join(nodeModulesBin, 'vp'));
  symlinkSync(resolveDependencyRoot('@types/node'), join(nodeModules, '@types/node'));
  symlinkSync(
    resolveDependencyRoot('@types/better-sqlite3'),
    join(nodeModules, '@types/better-sqlite3'),
  );
  symlinkSync(resolveDependencyRoot('@types/pg'), join(nodeModules, '@types/pg'));

  for (const pkg of [
    '@kovojs/better-auth',
    '@kovojs/browser',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/test',
    '@kovojs/ui',
    '@kovojs/cli',
  ]) {
    symlinkSync(resolveDependencyRoot(pkg), join(nodeModules, pkg));
  }
  symlinkSync(
    resolveDependencyRoot('@electric-sql/pglite'),
    join(nodeModules, '@electric-sql/pglite'),
  );
  symlinkSync(resolveDependencyRoot('@node-rs/argon2'), join(nodeModules, '@node-rs/argon2'));
  for (const pkg of [
    'better-sqlite3',
    'drizzle-orm',
    'kovo',
    'pg',
    'pgsql-ast-parser',
    'typescript',
    'vite',
    'vitest',
    'vite-plus',
  ]) {
    symlinkSync(resolveDependencyRoot(pkg), join(nodeModules, pkg));
  }
}

export function mergeCookies(jar: Map<string, string>, setCookies: readonly string[]): void {
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function withRepoBinOnPath(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [join(process.cwd(), 'node_modules/.bin'), process.env.PATH ?? ''].join(':'),
  };
}

async function packKovoWorkspacePackages(setupDeadlineAtMs: number): Promise<PackedKovoPackages> {
  const envTarballDir = process.env.KOVO_PACKED_PACKAGES_DIR;
  const currentBuildMode = process.env.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES;
  if (currentBuildMode !== undefined && currentBuildMode !== 'packed-current') {
    throw new TypeError(
      'KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES must be "packed-current" when set.',
    );
  }
  if (currentBuildMode === 'packed-current') {
    if (!envTarballDir) {
      throw new TypeError(
        'Packed-current source fixtures require KOVO_PACKED_PACKAGES_DIR from the same CI run.',
      );
    }
    let currentPackages: PackedKovoPackages | undefined;
    try {
      currentPackages = readPackedKovoPackageManifest(envTarballDir, {
        generatedBy: packedStarterCiManifestProducer,
      });
    } catch (error) {
      throw new TypeError(
        `Packed-current source fixtures require a valid ${packedKovoPackageManifest} and every declared tarball; refusing to modify or repack the same-run artifact.`,
        { cause: error },
      );
    }
    if (!currentPackages) {
      throw new TypeError(
        `Packed-current source fixtures require a valid ${packedKovoPackageManifest} and every declared tarball; refusing to modify or repack the same-run artifact.`,
      );
    }
    packedKovoPackageCache = currentPackages;
    return currentPackages;
  }

  if (packedKovoPackageCache) return packedKovoPackageCache;

  if (envTarballDir) {
    const cached = readPackedKovoPackageManifest(envTarballDir);
    if (cached) {
      packedKovoPackageCache = cached;
      return packedKovoPackageCache;
    }
  }

  const tarballDir =
    envTarballDir ??
    join(process.cwd(), 'node_modules/.tmp', `create-kovo-packed-packages-${process.pid}`);
  rmSync(tarballDir, { force: true, recursive: true });
  mkdirSync(tarballDir, { recursive: true });

  const tarballByName = new Map<string, string>();
  for (const pkg of packedWorkspacePackages) {
    const packageRoot = join(process.cwd(), 'packages', pkg.dir);
    const before = new Set(readdirSync(tarballDir).filter((file) => file.endsWith('.tgz')));
    await execStarterCommand(
      'pnpm',
      ['--config.ignore-scripts=true', 'pack', '--pack-destination', tarballDir],
      {
        cwd: packageRoot,
        setupDeadlineAtMs,
      },
    );
    const created = readdirSync(tarballDir)
      .filter((file) => file.endsWith('.tgz') && !before.has(file))
      .sort();
    if (created.length !== 1) {
      throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}.`);
    }
    const tarballPath = realpathSync(join(tarballDir, created[0] ?? ''));
    await canonicalizePackedTarball(tarballPath, setupDeadlineAtMs);
    tarballByName.set(pkg.name, tarballPath);
  }

  const overridesByName: Record<string, string> = {};
  for (const pkg of packedWorkspacePackages) {
    const tarball = tarballByName.get(pkg.name);
    if (!tarball) throw new Error(`Missing packed tarball for ${pkg.name}.`);
    overridesByName[pkg.name] = fileSpec(process.cwd(), tarball);
  }

  packedKovoPackageCache = { overridesByName, tarballByName, tarballDir };
  writePackedKovoPackageManifest(packedKovoPackageCache);
  return packedKovoPackageCache;
}

async function canonicalizePackedTarball(
  tarballPath: string,
  setupDeadlineAtMs: number,
): Promise<void> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'scripts', 'lib', 'deterministic-tarball.mjs'),
  ).href;
  await execStarterCommand(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { canonicalizePackedTarball } from ${JSON.stringify(moduleUrl)}; canonicalizePackedTarball(process.argv[1]);`,
      tarballPath,
    ],
    {
      cwd: process.cwd(),
      setupDeadlineAtMs,
    },
  );
}

async function materializePackedPackage(
  tarballPath: string,
  destination: string,
  setupDeadlineAtMs: number,
): Promise<void> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'scripts', 'lib', 'deterministic-tarball.mjs'),
  ).href;
  await execStarterCommand(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        `import { validatedPackageTarballEntries } from ${JSON.stringify(moduleUrl)};`,
        `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';`,
        `import path from 'node:path';`,
        `const [tarballPath, destination] = process.argv.slice(1);`,
        `for (const entry of validatedPackageTarballEntries(readFileSync(tarballPath))) {`,
        `  const relativePath = entry.name.slice('package/'.length);`,
        `  const target = path.join(destination, ...relativePath.split('/'));`,
        `  mkdirSync(path.dirname(target), { recursive: true });`,
        `  writeFileSync(target, entry.data, { flag: 'wx', mode: entry.executable ? 0o755 : 0o644 });`,
        `}`,
      ].join('\n'),
      tarballPath,
      destination,
    ],
    {
      cwd: process.cwd(),
      setupDeadlineAtMs,
    },
  );
}

function readPackedKovoPackageManifest(
  tarballDir: string,
  options: { generatedBy?: string } = {},
): PackedKovoPackages | undefined {
  const manifestPath = join(tarballDir, packedKovoPackageManifest);
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    generatedBy?: string;
    tarballs?: Record<string, string>;
  };
  if (options.generatedBy !== undefined && manifest.generatedBy !== options.generatedBy) {
    return undefined;
  }
  const tarballByName = new Map<string, string>();
  const overridesByName: Record<string, string> = {};
  for (const pkg of packedWorkspacePackages) {
    const file = manifest.tarballs?.[pkg.name];
    if (!file || basename(file) !== file || !file.endsWith('.tgz')) return undefined;
    const tarball = join(tarballDir, file);
    if (!existsSync(tarball)) return undefined;
    const real = realpathSync(tarball);
    tarballByName.set(pkg.name, real);
    overridesByName[pkg.name] = fileSpec(process.cwd(), real);
  }
  return { overridesByName, tarballByName, tarballDir };
}

function writePackedKovoPackageManifest(packages: PackedKovoPackages): void {
  writeFileSync(
    join(packages.tarballDir, packedKovoPackageManifest),
    `${JSON.stringify(
      {
        generatedBy: 'packages/create-kovo/src/index.test-support.ts',
        tarballs: Object.fromEntries(
          [...packages.tarballByName].map(([name, tarball]) => [name, basename(tarball)]),
        ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function scaffoldWithPackedCreateKovo(
  root: string,
  options: StarterAppOptions,
  packedPackages: PackedKovoPackages | undefined,
  setupDeadlineAtMs: number,
): Promise<void> {
  if (!packedPackages) {
    throw new Error('Packed create-kovo scaffold requires packed Kovo packages.');
  }

  const creatorRoot = mkdtempSync(join(dirname(root), 'create-kovo-bin-'));
  const createKovoTarball = packedPackages.tarballByName.get('create-kovo');
  if (!createKovoTarball) throw new Error('Missing packed create-kovo tarball.');
  const coreTarball = packedPackages.tarballByName.get('@kovojs/core');
  if (!coreTarball) throw new Error('Missing packed @kovojs/core tarball.');
  const packedCreateKovoRoot = join(creatorRoot, 'node_modules/create-kovo');
  await materializePackedPackage(createKovoTarball, packedCreateKovoRoot, setupDeadlineAtMs);
  await materializePackedPackage(
    coreTarball,
    join(creatorRoot, 'node_modules/@kovojs/core'),
    setupDeadlineAtMs,
  );

  const args = [root, '--name', options.name, '--disable-git'];
  if (options.example !== undefined) {
    args.push('--example', options.example);
  }
  if (options.retention !== undefined) {
    args.push('--retention', options.retention);
  }
  if (options.dialect === 'sqlite') {
    args.push('--sqlite');
    if (options.experimentalSqlite === true) {
      args.push('--experimental-sqlite');
    }
  } else if (options.dialect === 'postgres') {
    args.push('--postgres');
  }

  const packedCreateKovoBin = join(packedCreateKovoRoot, 'dist/index.mjs');
  if (!existsSync(packedCreateKovoBin)) {
    throw new Error('Packed create-kovo install did not materialize dist/index.mjs.');
  }
  await execStarterCommand(process.execPath, [packedCreateKovoBin, ...args], {
    cwd: dirname(root),
    env: withStarterBinOnPath(creatorRoot),
    setupDeadlineAtMs,
  });
}

function rewriteKovoDependenciesToTarballs(root: string, packedPackages: PackedKovoPackages): void {
  const packageJsonPath = join(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const dependencies = packageJson[field];
    if (!dependencies) continue;
    for (const pkg of packedWorkspacePackages) {
      if (!(pkg.name in dependencies)) continue;
      const tarball = packedPackages.tarballByName.get(pkg.name);
      if (!tarball) throw new Error(`Missing packed tarball for ${pkg.name}.`);
      dependencies[pkg.name] = fileSpec(root, tarball);
    }
  }
  packageJson.pnpm = {
    ...packageJson.pnpm,
    overrides: {
      ...packageJson.pnpm?.overrides,
      ...tarballOverridesForRoot(root, packedPackages),
    },
  };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

function tarballOverridesForRoot(
  root: string,
  packedPackages: PackedKovoPackages,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const pkg of packedWorkspacePackages) {
    const tarball = packedPackages.tarballByName.get(pkg.name);
    if (!tarball) throw new Error(`Missing packed tarball for ${pkg.name}.`);
    overrides[pkg.name] = fileSpec(root, tarball);
  }
  return overrides;
}

function fileSpec(root: string, tarballPath: string): string {
  void root;
  return pathToFileURL(tarballPath).href;
}

function starterInstallEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...withStarterBinOnPath(root),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
}

interface StarterSetupCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signalGraceMs?: number;
  setupDeadlineAtMs: number;
}

function fixtureSetupDeadlineAtMs(): number {
  return Date.now() + GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS;
}

export async function runGeneratedStarterFixtureSetupCommandForTest(
  file: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signalGraceMs?: number;
    timeoutMs: number;
  },
): Promise<void> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError('Generated-starter fixture timeoutMs must be a positive safe integer.');
  }
  await execStarterCommand(file, args, {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.signalGraceMs === undefined ? {} : { signalGraceMs: options.signalGraceMs }),
    setupDeadlineAtMs: Date.now() + options.timeoutMs,
  });
}

async function execStarterCommand(
  file: string,
  args: readonly string[],
  options: StarterSetupCommandOptions,
): Promise<void> {
  const signalGraceMs = options.signalGraceMs ?? GENERATED_STARTER_CLI_SIGNAL_GRACE_MS;
  if (!Number.isSafeInteger(signalGraceMs) || signalGraceMs <= 0) {
    throw new TypeError('Generated-starter fixture signalGraceMs must be a positive safe integer.');
  }
  const cleanupBudgetMs = boundedTestProcessCleanupBudgetMs({
    killGraceMs: signalGraceMs,
    rootExitTimeoutMs: signalGraceMs,
    streamCloseTimeoutMs: signalGraceMs,
    terminationGraceMs: signalGraceMs,
  });
  const remainingSetupMs = options.setupDeadlineAtMs - Date.now();
  const supervisorTimeoutMs = remainingSetupMs - cleanupBudgetMs;
  if (supervisorTimeoutMs <= 0) {
    throw new Error(
      `Generated-starter fixture setup exhausted its ${String(GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS)}ms aggregate deadline before command: ${[file, ...args].join(' ')}`,
    );
  }

  const outcome = await runBoundedTestProcess({
    args,
    command: file,
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    killGraceMs: signalGraceMs,
    maxOutputBytes: GENERATED_STARTER_CLI_MAX_OUTPUT_BYTES,
    rootExitTimeoutMs: signalGraceMs,
    streamCloseTimeoutMs: signalGraceMs,
    supervisorTimeoutMs,
    terminationGraceMs: signalGraceMs,
  });
  const kind = classifyGeneratedStarterCommandOutcome(outcome);
  if (kind !== 'success') {
    const failure = generatedStarterCommandFailureFromOutcome(outcome, kind);
    throw generatedStarterCommandError(
      generatedStarterFixtureSetupFailureMessage(file, args, supervisorTimeoutMs, failure),
      failure,
    );
  }
}

export async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (typeof address !== 'object' || address === null) {
    throw new Error('Unable to reserve a TCP port.');
  }
  return address.port;
}

export function collectOutput(process: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  process.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  process.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString('utf8');
}

export async function fetchTextWhenReady(
  url: string,
  output: () => string,
  init?: RequestInit,
): Promise<string> {
  const deadline = Date.now() + STARTER_SERVER_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      const body = await response.text();
      if (response.ok) return body;
      lastError = new Error(`HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out fetching ${url}: ${cause}\n${output()}`);
}

export async function stopProcess(
  childProcess: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (!childProcess || childHasExited(childProcess)) return;
  if (await signalProcessTreeAndWait(childProcess, 'SIGTERM', 5_000)) return;
  if (await signalProcessTreeAndWait(childProcess, 'SIGKILL', 5_000)) return;
  throw new Error('Timed out stopping process after SIGTERM and SIGKILL.');
}

function commandOutput(outcome: BoundedTestProcessOutcome): GeneratedStarterCommandResult {
  return { stderr: outcome.stderr, stdout: outcome.stdout };
}

function generatedStarterCommandFailureFromOutcome(
  outcome: BoundedTestProcessOutcome,
  kind: Exclude<GeneratedStarterCommandOutcomeKind, 'success'>,
): GeneratedStarterCommandFailure {
  const frozenOutcome = Object.freeze({ ...outcome });
  const base = {
    outcome: frozenOutcome,
    stderr: frozenOutcome.stderr,
    stdout: frozenOutcome.stdout,
  };
  if (kind === 'nonzero-exit') {
    const exitCode = frozenOutcome.exitCode;
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode) || exitCode === 0) {
      throw new Error('Internal generated-starter nonzero-exit classification drifted.');
    }
    return Object.freeze({ ...base, exitCode, kind });
  }
  if (kind === 'signal') {
    if (frozenOutcome.signal === null) {
      throw new Error('Internal generated-starter signal classification drifted.');
    }
    return Object.freeze({ ...base, kind, signal: frozenOutcome.signal });
  }
  return Object.freeze({ ...base, kind });
}

function generatedStarterCommandFailureMessage(
  file: string,
  args: readonly string[],
  options: GeneratedStarterCommandOptions,
  failure: GeneratedStarterCommandFailure,
): string {
  const command = [file, ...args].join(' ');
  switch (failure.kind) {
    case 'timeout':
      return `Command timed out after ${String(options.timeoutMs ?? GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS)}ms: ${command}`;
    case 'output-overflow':
      return `Command output exceeded the ${String(options.maxOutputBytes ?? GENERATED_STARTER_CLI_MAX_OUTPUT_BYTES)}-byte combined limit: ${command}`;
    case 'cleanup-error':
      return `Command process-tree cleanup failed: ${command}`;
    case 'launch-error':
      return `Command could not start: ${command}: ${failure.outcome.error ?? 'unknown launch error'}`;
    case 'nonzero-exit':
      return `Command failed (${String(failure.exitCode)}): ${command}`;
    case 'signal':
      return `Command failed (${failure.signal}): ${command}`;
    case 'unknown-exit':
      return `Command failed (unknown): ${command}`;
  }
}

function generatedStarterFixtureSetupFailureMessage(
  file: string,
  args: readonly string[],
  supervisorTimeoutMs: number,
  failure: GeneratedStarterCommandFailure,
): string {
  const command = [file, ...args].join(' ');
  switch (failure.kind) {
    case 'timeout':
      return `Generated-starter fixture setup command timed out after ${String(supervisorTimeoutMs)}ms inside its aggregate deadline: ${command}`;
    case 'output-overflow':
      return `Generated-starter fixture setup command output exceeded the ${String(GENERATED_STARTER_CLI_MAX_OUTPUT_BYTES)}-byte combined limit: ${command}`;
    case 'cleanup-error':
      return `Generated-starter fixture setup command cleanup failed: ${command}`;
    case 'launch-error':
      return `Generated-starter fixture setup command could not start: ${command}: ${failure.outcome.error ?? 'unknown launch error'}`;
    case 'nonzero-exit':
      return `Generated-starter fixture setup command failed (${String(failure.exitCode)}): ${command}`;
    case 'signal':
      return `Generated-starter fixture setup command failed (${failure.signal}): ${command}`;
    case 'unknown-exit':
      return `Generated-starter fixture setup command failed (unknown): ${command}`;
  }
}

function generatedStarterCommandError(
  message: string,
  failure: GeneratedStarterCommandFailure,
): GeneratedStarterCommandError {
  const details = [message, failure.stdout.trim(), failure.stderr.trim()];
  if (failure.outcome.cleanupError !== null) {
    details.push(
      `Process-tree cleanup failed: ${failure.outcome.cleanupError || 'unknown cleanup error'}`,
    );
  }
  const error = Object.assign(new Error(details.filter(Boolean).join('\n')), {
    failure,
    stderr: failure.stderr,
    stdout: failure.stdout,
  });
  generatedStarterCommandFailureByError.set(error, failure);
  return error;
}

function childHasExited(childProcess: ChildProcessWithoutNullStreams): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

async function signalProcessTreeAndWait(
  childProcess: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  if (childHasExited(childProcess)) return true;
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const settle = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      childProcess.off('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => settle(true);
    const timer = setTimeout(() => settle(childHasExited(childProcess)), timeoutMs);
    childProcess.once('exit', onExit);

    if (childHasExited(childProcess)) {
      settle(true);
      return;
    }
    try {
      killProcessTree(childProcess, signal);
    } catch (error) {
      clearTimeout(timer);
      childProcess.off('exit', onExit);
      reject(error);
      return;
    }
    if (childHasExited(childProcess)) settle(true);
  });
}

function killProcessTree(
  childProcess: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (childProcess.pid === undefined) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-childProcess.pid, signal);
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }
  childProcess.kill(signal);
}

export function resolveDependencyRoot(packageName: string): string {
  const workspacePackageRoot = resolveWorkspacePackageRoot(packageName);
  if (workspacePackageRoot) return workspacePackageRoot;

  const dependencyRoot = join(process.cwd(), 'node_modules');
  const linkedPackageJson = join(dependencyRoot, packageName, 'package.json');
  if (existsSync(linkedPackageJson)) {
    return realpathSync(dirname(linkedPackageJson));
  }

  const pnpmStore = findPnpmStore(dependencyRoot);
  if (pnpmStore) {
    const hoistedPackageJson = join(pnpmStore, 'node_modules', packageName, 'package.json');
    if (existsSync(hoistedPackageJson)) {
      return realpathSync(dirname(hoistedPackageJson));
    }

    for (const entry of readdirSync(pnpmStore)) {
      const packageJson = join(pnpmStore, entry, 'node_modules', packageName, 'package.json');
      if (existsSync(packageJson)) {
        return realpathSync(dirname(packageJson));
      }
    }
  }

  throw new Error(`Unable to resolve generated starter dependency: ${packageName}`);
}

function resolveWorkspacePackageRoot(packageName: string): string | undefined {
  if (packageName.startsWith('@kovojs/')) {
    const workspacePackageJson = join(
      process.cwd(),
      'packages',
      packageName.slice('@kovojs/'.length),
      'package.json',
    );
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }

  if (packageName === 'kovo') {
    const workspacePackageJson = join(process.cwd(), 'packages/cli/package.json');
    if (existsSync(workspacePackageJson)) {
      return realpathSync(dirname(workspacePackageJson));
    }
  }
  return undefined;
}

function findPnpmStore(start: string): string | undefined {
  let current = start;
  while (true) {
    for (const candidate of [join(current, '.pnpm'), join(current, 'node_modules/.pnpm')]) {
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveBin(name: string): string {
  let current = process.cwd();
  while (true) {
    for (const candidate of [
      join(current, 'node_modules/.bin', name),
      join(current, 'node_modules/.pnpm/node_modules/.bin', name),
    ]) {
      if (existsSync(candidate)) {
        return realpathSync(candidate);
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to resolve binary: ${name}`);
}
