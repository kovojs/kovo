import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

export function linkStarterBuildDependencies(root: string): void {
  const nodeModules = join(root, 'node_modules');
  const nodeModulesBin = join(nodeModules, '.bin');
  mkdirSync(join(nodeModules, '@kovojs'), { recursive: true });
  mkdirSync(join(nodeModules, '@electric-sql'), { recursive: true });
  mkdirSync(join(nodeModules, '@types'), { recursive: true });
  mkdirSync(nodeModulesBin, { recursive: true });

  symlinkSync(join(resolveDependencyRoot('kovo'), 'src/bin.ts'), join(nodeModulesBin, 'kovo'));
  symlinkSync(join(resolveDependencyRoot('vite-plus'), 'bin/vp'), join(nodeModulesBin, 'vp'));
  symlinkSync(resolveDependencyRoot('@types/node'), join(nodeModules, '@types/node'));
  symlinkSync(
    resolveDependencyRoot('@types/better-sqlite3'),
    join(nodeModules, '@types/better-sqlite3'),
  );

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
  for (const pkg of [
    'better-auth',
    'better-sqlite3',
    'drizzle-orm',
    'kovo',
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

export async function fetchTextWhenReady(url: string, output: () => string): Promise<string> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
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
