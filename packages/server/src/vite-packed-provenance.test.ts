import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { compilerOwnedViteClientModuleRoleForPlugin, kovoVitePlugin } from '@kovojs/compiler/vite';
import {
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import { describe, expect, it } from 'vitest';

import {
  createKovoDevReadyReportObserver,
  DEV_READY_POST_BIND_BUDGET_MS,
  waitForKovoDevReadiness,
} from '../../../scripts/lib/dev-ready-probe-contract.mjs';

const repoRoot = process.cwd();

describe('installed packed Vite provenance', () => {
  it('serves two dev requests through the standalone compiler and live SSR graph', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-packed-vite-provenance-'));
    const tarballs = join(root, 'tarballs');
    const appRoot = join(root, 'app');
    mkdirSync(tarballs, { recursive: true });
    mkdirSync(join(appRoot, 'src'), { recursive: true });
    try {
      const packed = new Map(
        ['compiler', 'server', 'cli'].map((packageDirectory) => [
          packageDirectory,
          packPackage(packageDirectory, tarballs),
        ]),
      );
      materializePackedAppNodeModules(appRoot, packed);
      const fixtureSource = writePackedDevFixture(appRoot);
      const expectedClientModule = await compilePackedFixtureClientModule(fixtureSource, appRoot);
      const clientHref = versionedClientModuleHref(
        expectedClientModule.path,
        clientModuleRepresentationDigest(expectedClientModule.source),
      );

      const port = await reservePort();
      const cli = join(appRoot, 'node_modules/@kovojs/cli/dist/bin.mjs');
      const spawnedAt = performance.now();
      const child = spawn(
        process.execPath,
        [
          cli,
          'dev',
          './src/app.tsx',
          '--root',
          appRoot,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strict-port',
        ],
        {
          cwd: appRoot,
          env: { ...process.env, NODE_NO_WARNINGS: '1' },
          stdio: 'pipe',
        },
      );
      const localUrl = `http://127.0.0.1:${port}/`;
      const readyExpected = {
        appEntry: 'src/app.tsx',
        database: 'none configured',
        localUrl,
        mode: 'development',
      };
      const readyReportObserver = createKovoDevReadyReportObserver(child.stdout, readyExpected);
      const output = collectOutput(child);
      try {
        await waitForKovoDevReadiness({
          expected: readyExpected,
          label: 'Packed Vite provenance kovo dev',
          port,
          readOutput: () => ({ stderr: output.stderr, stdout: output.stdout }),
          readStatus: () => ({ exitCode: child.exitCode, signalCode: child.signalCode }),
          reportObserver: readyReportObserver,
          startedAt: spawnedAt,
        });
        const first = await fetchReadyPackedKovoDev(localUrl, child, output);
        const firstBody = await first.text();
        expect(first.status, `${firstBody}\n${output.combined()}`).toBe(200);
        expect(firstBody).toContain('data-testid="counter"');
        expect(firstBody).not.toContain('onClick');
        const browserHeaders = {
          Cookie: first.headers
            .getSetCookie()
            .map((value) => value.split(';', 1)[0])
            .join('; '),
        };
        expect(browserHeaders.Cookie).not.toBe('');
        const compiledApp = await fetch(
          `http://127.0.0.1:${port}/@fs${join(appRoot, 'src/app.tsx')}`,
          {
            headers: {
              ...browserHeaders,
              Accept: 'text/javascript',
              'Sec-Fetch-Dest': 'script',
            },
          },
        );
        const compiledAppSource = await compiledApp.text();
        expect(compiledApp.status, `${compiledAppSource}\n${output.combined()}`).toBe(200);
        expect(compiledAppSource).toContain('CounterIsland$button_click');

        const second = await fetch(`http://127.0.0.1:${port}/`, { headers: browserHeaders });
        const secondBody = await second.text();
        expect(second.status, `${secondBody}\n${output.combined()}`).toBe(200);
        expect(secondBody).toContain('data-testid="counter"');
        const immutableClient = await fetch(`http://127.0.0.1:${port}${clientHref}`, {
          headers: browserHeaders,
        });
        const immutableClientSource = await immutableClient.text();
        expect(immutableClient.status, `${immutableClientSource}\n${output.combined()}`).toBe(200);
        expect(immutableClientSource).toContain('CounterIsland$button_click');
        expect(output.combined()).not.toMatch(
          /unproven compiler-generated client-module path|installer was already claimed|handoff is not authentic/u,
        );
      } finally {
        await stopChild(child);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function packPackage(packageDirectory: string, tarballs: string): string {
  const before = new Set(readdirSync(tarballs));
  const result = spawnSync('pnpm', ['pack', '--pack-destination', tarballs], {
    cwd: join(repoRoot, 'packages', packageDirectory),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const created = readdirSync(tarballs).filter(
    (file) => file.endsWith('.tgz') && !before.has(file),
  );
  expect(created).toHaveLength(1);
  return join(tarballs, created[0]!);
}

function materializePackedAppNodeModules(
  appRoot: string,
  packed: ReadonlyMap<string, string>,
): void {
  const nodeModules = join(appRoot, 'node_modules');
  const kovoScope = join(nodeModules, '@kovojs');
  mkdirSync(kovoScope, { recursive: true });
  for (const [packageDirectory, tarball] of packed) {
    const target = join(kovoScope, packageDirectory);
    mkdirSync(target, { recursive: true });
    const extracted = spawnSync('tar', ['-xzf', tarball, '--strip-components=1', '-C', target], {
      encoding: 'utf8',
    });
    expect(extracted.status, `${extracted.stdout}\n${extracted.stderr}`).toBe(0);
  }

  for (const entry of readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory() || packed.has(entry.name)) continue;
    const packageRoot = join(repoRoot, 'packages', entry.name);
    const packageJson = join(packageRoot, 'package.json');
    if (!statSync(packageJson, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { name?: string };
    if (!manifest.name?.startsWith('@kovojs/')) continue;
    const target = join(kovoScope, basename(manifest.name));
    if (!statSync(target, { throwIfNoEntry: false })) {
      symlinkSync(packageRoot, target, 'dir');
    }
  }

  for (const packageDirectory of packed.keys()) {
    linkExternalNodeModules(
      join(repoRoot, 'packages', packageDirectory, 'node_modules'),
      nodeModules,
    );
  }
  linkExternalNodeModules(join(repoRoot, 'node_modules'), nodeModules);
}

function linkExternalNodeModules(source: string, target: string): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.pnpm' || entry.name === '@kovojs') continue;
    if (entry.name.startsWith('@')) {
      const targetScope = join(target, entry.name);
      mkdirSync(targetScope, { recursive: true });
      for (const scopedEntry of readdirSync(join(source, entry.name))) {
        linkNodeModuleIfAbsent(
          join(source, entry.name, scopedEntry),
          join(targetScope, scopedEntry),
        );
      }
      continue;
    }
    linkNodeModuleIfAbsent(join(source, entry.name), join(target, entry.name));
  }
}

function linkNodeModuleIfAbsent(source: string, target: string): void {
  if (!statSync(target, { throwIfNoEntry: false })) {
    symlinkSync(source, target, 'dir');
  }
}

function writePackedDevFixture(root: string): string {
  writeFileSync(
    join(root, 'package.json'),
    '{"name":"kovo-packed-vite-provenance","private":true,"type":"module"}\n',
    'utf8',
  );
  const source = [
    '/** @jsxImportSource @kovojs/server */',
    "import { defineKovo } from '@kovojs/server';",
    "import { component } from '@kovojs/core';",
    'export const CounterIsland = component({',
    '  render: () => (',
    '    <button data-testid="counter" type="button" onClick={() => null}>',
    '      Proof',
    '    </button>',
    '  ),',
    '});',
    "const app = defineKovo({ appId: '44444444-4444-4444-8444-444444444444' });",
    "const home = app.route('/', {",
    "  access: app.publicAccess('packed provenance fixture'),",
    '  page: () => <CounterIsland />,',
    '});',
    'export default app.assemble({ routes: [home] });',
    '',
  ].join('\n');
  writeFileSync(join(root, 'src/app.tsx'), source, 'utf8');
  return source;
}

async function compilePackedFixtureClientModule(
  source: string,
  root: string,
): Promise<{ path: string; source: string }> {
  const compiler = kovoVitePlugin();
  compiler.configResolved?.({ root });
  await compiler.transform?.(source, join(root, 'src/app.tsx'));
  const module = compiler
    .getClientModules?.()
    .find(
      (candidate) =>
        compilerOwnedViteClientModuleRoleForPlugin(compiler, candidate) === 'component-client',
    );
  if (module === undefined) {
    throw new Error('Packed Vite fixture did not compile a component client module.');
  }
  return module;
}

function collectOutput(child: ChildProcessWithoutNullStreams): {
  combined(): string;
  stderr: string;
  stdout: string;
} {
  const output = {
    combined: () => `${output.stdout}${output.stderr}`,
    stderr: '',
    stdout: '',
  };
  child.stdout.on('data', (chunk) => {
    output.stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr += String(chunk);
  });
  return output;
}

async function fetchReadyPackedKovoDev(
  url: string,
  child: ChildProcessWithoutNullStreams,
  output: { combined(): string },
): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(DEV_READY_POST_BIND_BUDGET_MS) });
  } catch (error) {
    const status =
      child.exitCode === null && child.signalCode === null
        ? 'still running'
        : `exit=${String(child.exitCode)} signal=${String(child.signalCode)}`;
    throw new Error(
      `Ready packed kovo dev did not serve ${url} within ${DEV_READY_POST_BIND_BUDGET_MS}ms ` +
        `(${status}): ${error instanceof Error ? error.message : String(error)}\n${output.combined()}`,
    );
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close();
        reject(new Error('Expected a TCP port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for packed kovo dev to exit.'));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
