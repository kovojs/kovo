import { execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

import { writeKovoProject, type CreateKovoDialect } from './index.js';

type StarterInstallMode = 'link-local' | 'packed' | 'symlink';
type StarterScaffoldMode = 'packed-bin' | 'source';

interface StarterAppOptions {
  dialect?: CreateKovoDialect;
  experimentalSqlite?: boolean;
  install?: StarterInstallMode;
  name: string;
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
  { name: '@kovojs/compiler', dir: 'compiler' },
  { name: '@kovojs/cli', dir: 'cli' },
  { name: 'create-kovo', dir: 'create-kovo' },
];

let packedKovoPackageCache: PackedKovoPackages | undefined;
const packedKovoPackageManifest = 'packed-kovo-packages.json';

export function createStarterApp(options: StarterAppOptions): StarterTestApp {
  const tempParent = options.tempParent ?? tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const parent = mkdtempSync(join(tempParent, options.tempPrefix ?? 'create-kovo-app-'));
  const root = join(parent, 'app');
  mkdirSync(root, { recursive: true });

  try {
    const scaffold = options.scaffold ?? 'source';
    const installMode = options.install ?? 'symlink';
    const packedPackages = scaffold === 'packed-bin' ? packKovoWorkspacePackages() : undefined;

    if (scaffold === 'packed-bin') {
      scaffoldWithPackedCreateKovo(root, options, packedPackages);
    } else {
      writeKovoProject(root, {
        ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
        disableGit: true,
        name: options.name,
      });
    }

    const install = installStarterAppDependencies(root, installMode, packedPackages);

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

export function installStarterAppDependencies(
  root: string,
  mode: StarterInstallMode,
  packedPackages = mode === 'packed' ? packKovoWorkspacePackages() : undefined,
): StarterAppInstall {
  if (mode === 'symlink') {
    linkStarterBuildDependencies(root);
    return { mode };
  }

  if (mode === 'link-local') {
    execStarterCommand(
      process.execPath,
      [join(process.cwd(), 'scripts/link-local-kovo.mjs'), root],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
      },
    );
    execStarterCommand('pnpm', ['install', '--ignore-workspace'], {
      cwd: root,
      env: starterInstallEnv(root),
      stdio: 'pipe',
    });
    return { mode };
  }

  if (!packedPackages) {
    throw new Error('Packed starter install requires packed Kovo packages.');
  }
  rewriteKovoDependenciesToTarballs(root, packedPackages);
  execStarterCommand('pnpm', ['install', '--ignore-workspace'], {
    cwd: root,
    env: starterInstallEnv(root),
    stdio: 'pipe',
  });
  return { mode, tarballDir: packedPackages.tarballDir };
}

export function runStarterTypecheck(root: string): void {
  const generatedRuntimeFiles = [
    ...(existsSync(join(root, 'src/_kovo/app-runtime-db-options.ts'))
      ? ['src/_kovo/app-runtime-db-options.ts']
      : []),
    'src/_kovo/app-runtime-db.ts',
  ];
  execFileSync(
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
      'src/queries.ts',
      'src/mutations.ts',
      'src/components/contacts.tsx',
      'src/components/auth-forms.tsx',
      'src/app.tsx',
    ],
    { cwd: root, env: withStarterBinOnPath(root), stdio: 'pipe' },
  );
}

export function runStarterVpCheck(root: string): void {
  execFileSync(resolveStarterBin(root, 'vp'), ['check'], {
    cwd: root,
    env: withStarterBinOnPath(root),
    stdio: 'inherit',
  });
}

export function installedPackageJson(root: string, packageName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, 'node_modules', packageName, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
}

export function resolveStarterBin(root: string, name: string): string {
  const localBin = join(root, 'node_modules/.bin', name);
  if (existsSync(localBin)) return realpathSync(localBin);
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

export function linkStarterBuildDependencies(root: string): void {
  const nodeModules = join(root, 'node_modules');
  const nodeModulesBin = join(nodeModules, '.bin');
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  mkdirSync(join(nodeModules, '@electric-sql'), { recursive: true });
  mkdirSync(join(nodeModules, '@node-rs'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

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
    'better-auth',
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

function packKovoWorkspacePackages(): PackedKovoPackages {
  if (packedKovoPackageCache) return packedKovoPackageCache;

  const envTarballDir = process.env.KOVO_PACKED_PACKAGES_DIR;
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
    execStarterCommand('pnpm', ['pack', '--pack-destination', tarballDir], {
      cwd: packageRoot,
      stdio: 'pipe',
    });
    const created = readdirSync(tarballDir)
      .filter((file) => file.endsWith('.tgz') && !before.has(file))
      .sort();
    if (created.length !== 1) {
      throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}.`);
    }
    tarballByName.set(pkg.name, realpathSync(join(tarballDir, created[0] ?? '')));
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

function readPackedKovoPackageManifest(tarballDir: string): PackedKovoPackages | undefined {
  const manifestPath = join(tarballDir, packedKovoPackageManifest);
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    tarballs?: Record<string, string>;
  };
  const tarballByName = new Map<string, string>();
  const overridesByName: Record<string, string> = {};
  for (const pkg of packedWorkspacePackages) {
    const file = manifest.tarballs?.[pkg.name];
    if (!file) return undefined;
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

function scaffoldWithPackedCreateKovo(
  root: string,
  options: StarterAppOptions,
  packedPackages: PackedKovoPackages | undefined,
): void {
  if (!packedPackages) {
    throw new Error('Packed create-kovo scaffold requires packed Kovo packages.');
  }

  const creatorRoot = mkdtempSync(join(dirname(root), 'create-kovo-bin-'));
  const createKovoTarball = packedPackages.tarballByName.get('create-kovo');
  if (!createKovoTarball) throw new Error('Missing packed create-kovo tarball.');

  writeFileSync(
    join(creatorRoot, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        devDependencies: {
          'create-kovo': fileSpec(creatorRoot, createKovoTarball),
        },
        pnpm: {
          overrides: tarballOverridesForRoot(creatorRoot, packedPackages),
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  execStarterCommand('pnpm', ['install', '--ignore-workspace'], {
    cwd: creatorRoot,
    env: starterInstallEnv(creatorRoot),
    stdio: 'pipe',
  });

  const args = [root, '--name', options.name, '--disable-git'];
  if (options.dialect === 'sqlite') {
    args.push('--sqlite');
    if (options.experimentalSqlite === true) {
      args.push('--experimental-sqlite');
    }
  } else if (options.dialect === 'postgres') {
    args.push('--postgres');
  }

  execStarterCommand(resolveStarterBin(creatorRoot, 'create-kovo'), args, {
    cwd: dirname(root),
    env: withStarterBinOnPath(creatorRoot),
    stdio: 'pipe',
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

function execStarterCommand(
  file: string,
  args: readonly string[],
  options: Parameters<typeof execFileSync>[2],
): void {
  try {
    execFileSync(file, args, { maxBuffer: 128 * 1024 * 1024, ...options });
  } catch (error) {
    throw new Error(
      [
        `Command failed: ${[file, ...args].join(' ')}`,
        formatCommandOutput(error, 'stdout'),
        formatCommandOutput(error, 'stderr'),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function formatCommandOutput(error: unknown, key: 'stderr' | 'stdout'): string {
  if (typeof error !== 'object' || error === null || !(key in error)) return '';
  const value = (error as Record<typeof key, unknown>)[key];
  if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
  if (typeof value === 'string') return value.trim();
  return '';
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
  const deadline = Date.now() + 60_000;
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
  if (!childProcess || childProcess.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      killProcessTree(childProcess, 'SIGKILL');
      reject(new Error('Timed out stopping process.'));
    }, 5_000);
    childProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    killProcessTree(childProcess, 'SIGTERM');
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
