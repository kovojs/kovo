import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isolateAuthoredDevPluginOptions,
  parseDevArgs,
  startKovoDevServer,
} from './commands/dev.js';

const repoRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  delete (globalThis as { __kovoDevCompilerIdsDistinct?: unknown }).__kovoDevCompilerIdsDistinct;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo dev', () => {
  it('parses the app/root and bounded listen overrides', () => {
    const parsed = parseDevArgs([
      './src/app.ts',
      '--root',
      './fixture',
      '--config',
      './vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      '4173',
      '--strict-port',
      '--mode',
      'test-dev',
    ]);

    expect(parsed).toEqual({
      ok: true,
      options: {
        appModulePath: join(repoRoot, 'fixture/src/app.ts'),
        configFile: join(repoRoot, 'fixture/vite.config.ts'),
        host: '127.0.0.1',
        mode: 'test-dev',
        port: 4173,
        root: join(repoRoot, 'fixture'),
        strictPort: true,
      },
    });
    expect(parseDevArgs(['./src/app.ts', '--port', '65536'])).toEqual({
      message:
        'kovo: dev --port must be an integer from 0 through 65535.\nusage: kovo dev <app-module> [--root <dir>] [--config <file>] [--host <host>] [--port <port>] [--strict-port] [--mode <mode>]',
      ok: false,
    });
  });

  it('isolates plugins without dispatching late map, iterator, or hook getters', () => {
    const rawPlugin = { name: 'selective-client-hook', resolveId: () => null };
    const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'map')!;
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    let collectionDispatches = 0;
    let isolated: unknown;
    try {
      Object.defineProperty(Array.prototype, 'map', {
        configurable: true,
        value() {
          collectionDispatches += 1;
          return [rawPlugin];
        },
        writable: true,
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value() {
          collectionDispatches += 1;
          throw new Error('selective iterator dispatched');
        },
        writable: true,
      });
      isolated = isolateAuthoredDevPluginOptions([rawPlugin]);
    } finally {
      Object.defineProperty(Array.prototype, 'map', mapDescriptor);
      Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
    }

    expect(collectionDispatches).toBe(0);
    expect(isolated).toHaveLength(1);
    expect((isolated as unknown[])[0]).not.toBe(rawPlugin);

    let getterExecutions = 0;
    const hook = {} as { handler: () => null };
    Object.defineProperty(hook, 'handler', {
      enumerable: true,
      get() {
        getterExecutions += 1;
        return () => null;
      },
    });
    expect(() =>
      isolateAuthoredDevPluginOptions([{ name: 'getter-hook', resolveId: hook }]),
    ).toThrow(
      /resolveId\.handler (?:changed while it was inspected|must be an own data property)/u,
    );
    expect(getterExecutions).toBe(0);
    expect(() =>
      isolateAuthoredDevPluginOptions([
        { name: 'future-hook', futureAuthorityHook: () => null } as never,
      ]),
    ).toThrow(/rejects authored Vite plugin property futureAuthorityHook/u);
  });

  it('captures the exact compiler graph before poison-first authored config evaluation', async () => {
    const root = devFixture('bootstrap-order');
    writeFileSync(
      join(root, 'vite.config.ts'),
      String.raw`
const probe = (await import('node:crypto')).createHash('sha256');
const prototype = Object.getPrototypeOf(probe);
const nativeUpdate = prototype.update;
const nativeApply = Reflect.apply;
prototype.update = function update(data, encoding) {
  const text = typeof data === 'string' ? data : '';
  const replacement = text.includes('"marker":"unsafe"')
    ? text.replace('"marker":"unsafe"', '"marker":"safe"')
    : data;
  return nativeApply(nativeUpdate, this, [replacement, encoding]);
};
try {
  const { compilerBuildId } = await import('@kovojs/compiler/internal');
  const safe = compilerBuildId({ sourceFingerprints: { marker: 'safe' } });
  const unsafe = compilerBuildId({ sourceFingerprints: { marker: 'unsafe' } });
  globalThis.__kovoDevCompilerIdsDistinct = safe !== unsafe;
} finally {
  prototype.update = nativeUpdate;
}
export default {
  build: { target: 'esnext' },
  fmt: { singleQuote: true },
  lint: { ignorePatterns: ['dist/**'] },
  run: { cache: { scripts: true } },
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  test: { include: ['src/**/*.test.ts'] },
};
`,
      'utf8',
    );

    const handle = await startKovoDevServer({
      appModulePath: join(root, 'src/app.ts'),
      configFile: join(root, 'vite.config.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    try {
      expect(
        (globalThis as { __kovoDevCompilerIdsDistinct?: unknown }).__kovoDevCompilerIdsDistinct,
      ).toBe(true);
      expect(handle.server.config.define).toEqual({});
      expect(handle.server.config.esbuild).not.toBe(false);
      expect(handle.server.config.experimental.bundledDev).toBe(false);
      expect(handle.server.config.oxc).not.toBe(false);
      expect(handle.server.config.rawAssetsInclude).toEqual([]);
      expect(handle.server.config.resolve.preserveSymlinks).toBe(false);
      expect(handle.server.config.environments.ssr.consumer).toBe('server');
      expect(handle.server.config.environments.ssr.dev.moduleRunnerTransform).toBe(true);
      expect(handle.server.config.environments.ssr.isBundled).toBe(false);
      expect(handle.server.config.environments.ssr.resolve.external).toEqual([]);
      expect(handle.server.config.ssr.external).toEqual([]);
      expect(handle.server.config.ssr.target).toBe('node');
      const origin = handle.server.resolvedUrls?.local[0];
      expect(origin).toBeTruthy();
      const response = await fetch(origin!);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('<main>Bootstrap safe</main>');
    } finally {
      await handle.close();
    }
  }, 30_000);

  it('ignores undeclared Vite config in the real default CLI path', async () => {
    const root = devFixture('undeclared-config');
    const marker = join(root, 'undeclared-config-ran.marker');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'executed', 'utf8');
throw new Error('undeclared Vite config executed');
`,
      'utf8',
    );

    const port = await reservePort();
    const child = spawnKovoDev(root, port);
    const output = collectChildOutput(child);
    try {
      const response = await fetchWhenReady(`http://127.0.0.1:${port}/`, output, 30_000);
      const body = await response.text();
      expect(response.status, output.combined()).toBe(200);
      expect(body).toContain('<main>Bootstrap safe</main>');
      expect(existsSync(marker)).toBe(false);
    } finally {
      await stopChild(child);
    }
  }, 40_000);

  it('rejects authored app-level hooks that retain root-config or live-server authority', async () => {
    const hookNames = [
      'buildApp',
      'applyToEnvironment',
      'config',
      'configEnvironment',
      'configResolved',
      'configurePreviewServer',
      'configureServer',
      'handleHotUpdate',
      'hotUpdate',
      'transformIndexHtml',
    ] as const;

    for (const hookName of hookNames) {
      const root = devFixture(`authority-hook-${hookName}`);
      writeFileSync(
        join(root, 'vite.config.ts'),
        `export default {
  plugins: [{
    name: 'attacker-${hookName}',
    ${hookName}() {},
  }],
};\n`,
        'utf8',
      );

      await expect(
        startKovoDevServer({
          appModulePath: join(root, 'src/app.ts'),
          configFile: join(root, 'vite.config.ts'),
          mode: 'development',
          root,
          strictPort: false,
        }),
      ).rejects.toThrow(
        `kovo dev rejects authored Vite plugin ${hookName}: supported plugins are client-environment transforms`,
      );
    }

    const root = devFixture('custom-ssr-environment');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `export default {
  environments: {
    ssr: {
      dev: {
        createEnvironment() {
          throw new Error('attacker SSR environment constructed');
        },
      },
    },
  },
};\n`,
      'utf8',
    );
    await expect(
      startKovoDevServer({
        appModulePath: join(root, 'src/app.ts'),
        configFile: join(root, 'vite.config.ts'),
        mode: 'development',
        root,
        strictPort: false,
      }),
    ).rejects.toThrow(/rejects authored Vite config key environments/u);

    const accessorRoot = devFixture('config-accessor');
    const marker = join(accessorRoot, 'config-getter-ran.marker');
    writeFileSync(
      join(accessorRoot, 'vite.config.ts'),
      `import { writeFileSync } from 'node:fs';
const config = {};
Object.defineProperty(config, 'resolve', {
  enumerable: true,
  get() {
    writeFileSync(${JSON.stringify(marker)}, 'getter executed', 'utf8');
    return { alias: { 'node:crypto': './attacker.ts' } };
  },
});
export default config;\n`,
      'utf8',
    );
    await expect(
      startKovoDevServer({
        appModulePath: join(accessorRoot, 'src/app.ts'),
        configFile: join(accessorRoot, 'vite.config.ts'),
        mode: 'development',
        root: accessorRoot,
        strictPort: false,
      }),
    ).rejects.toThrow(
      /Authored Vite config\.resolve (?:changed while it was inspected|must be an own data property)/u,
    );
    expect(existsSync(marker)).toBe(false);
  }, 40_000);

  it('fails closed before a poison-first plugin can replace a live lowerer collection method', async () => {
    const root = devFixture('lowerer-poison');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `Array.prototype.filter = function selectivelyOmitUnsafeLowering(values) {
  return values.filter((value) => !String(value).includes('dangerouslySetInnerHTML'));
};
export default { server: { host: '127.0.0.1', port: 0, strictPort: true } };\n`,
      'utf8',
    );

    await expect(
      startKovoDevServer({
        appModulePath: join(root, 'src/app.ts'),
        configFile: join(root, 'vite.config.ts'),
        mode: 'development',
        root,
        strictPort: false,
      }),
    ).rejects.toThrow(/filter|read only|Cannot assign/u);
  }, 30_000);

  it('rejects function-valued plugin apply hooks before Vite can expose mutable config', async () => {
    const root = devFixture('function-apply');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `export default {
  plugins: [{
    name: 'attacker-apply',
    apply(config) {
      config.plugins[0] = this;
      return true;
    },
  }],
};\n`,
      'utf8',
    );

    await expect(
      startKovoDevServer({
        appModulePath: join(root, 'src/app.ts'),
        configFile: join(root, 'vite.config.ts'),
        mode: 'development',
        root,
        strictPort: false,
      }),
    ).rejects.toThrow(/requires authored Vite plugin apply to be the static/u);
  }, 30_000);

  it('makes the real CLI reject all authored resolver authority', async () => {
    for (const [name, specifier] of [
      ['framework', '@kovojs/server/internal/app-shell-vite'],
      ['node-crypto', 'node:crypto'],
      ['transitive-vite', 'vite-plus'],
    ] as const) {
      const root = devFixture(`${name}-alias`);
      const attackerPath = join(root, 'attacker-integration.ts');
      writeAttackerIntegration(attackerPath);
      writeFileSync(
        join(root, 'vite.config.ts'),
        `export default {
  resolve: {
    alias: {
      ${JSON.stringify(specifier)}: ${JSON.stringify(attackerPath)},
    },
  },
};\n`,
        'utf8',
      );

      const child = spawnKovoDev(root, await reservePort(), true);
      const output = collectChildOutput(child);
      const status = await waitForChildExit(child, 30_000);

      expect(status).toBe(1);
      expect(output.stderr).toContain('kovo dev rejects authored Vite config key resolve');
      expect(output.combined()).not.toContain('ALIASED FRAMEWORK');
    }
  }, 40_000);

  it('keeps real CLI SSR loads outside authored resolve/load/transform hooks', async () => {
    const root = devFixture('plugin-graph-isolation');
    const attackerPath = join(root, 'attacker-integration.ts');
    writeAttackerIntegration(attackerPath);
    writeFileSync(
      join(root, 'vite.config.ts'),
      `const attackerSource = ${JSON.stringify(attackerIntegrationSource())};
const attackerPlugin = {
  name: 'attacker-ssr-module-hooks',
  resolveId(id) {
    if (id === '@kovojs/server/internal/app-shell-vite') return ${JSON.stringify(attackerPath)};
    return null;
  },
  load(id) {
    if (id.includes('/packages/server/src/vite-dev.')) return attackerSource;
    return null;
  },
  transform(code, id) {
    if (id.includes('/packages/server/src/vite-dev.') || id.includes('/internal/app-shell-vite.')) {
      return { code: attackerSource, map: null };
    }
    return null;
  },
};
const promisedPlugin = Promise.resolve(attackerPlugin);
Object.defineProperty(promisedPlugin, 'then', {
  configurable: true,
  value() {
    // A live .then() call would skip Kovo's isolating callback and hand Vite the raw SSR plugin.
    return Promise.resolve(attackerPlugin);
  },
});
export default {
  plugins: [promisedPlugin],
};\n`,
      'utf8',
    );

    const port = await reservePort();
    const child = spawnKovoDev(root, port, true);
    const output = collectChildOutput(child);
    try {
      const response = await fetchWhenReady(`http://127.0.0.1:${port}/`, output, 30_000);
      const body = await response.text();
      expect(response.status, output.combined()).toBe(200);
      expect(body).toContain('<main>Bootstrap safe</main>');
      expect(body).not.toContain('ALIASED FRAMEWORK');
    } finally {
      await stopChild(child);
    }
  }, 40_000);

  it('keeps first runtime entropy exact across real CLI process restarts', async () => {
    const root = devFixture('runtime-restart-entropy');
    writeFileSync(
      join(root, 'src/app.ts'),
      `import { createHmac } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createApp, mintCsrfToken, publicAccess, route } from '@kovojs/server';

const nativeApply = Reflect.apply;
const mutableCrypto = createRequire(import.meta.url)('node:crypto');
const nativeRandomBytes = mutableCrypto.randomBytes;
Reflect.set(mutableCrypto, 'randomBytes', function selectiveRandomBytes(size, callback) {
  const bytes = size === 16 ? Buffer.alloc(size, 0x6b) : nativeRandomBytes(size);
  if (typeof callback === 'function') {
    callback(null, bytes);
    return undefined;
  }
  return bytes;
});
syncBuiltinESMExports();

const probe = createHmac('sha256', 'probe-key');
const hmacPrototype = Object.getPrototypeOf(probe);
const nativeHmacUpdate = hmacPrototype.update;
let hmacCalls = 0;
hmacPrototype.update = function selectiveRuntimeHmac(data, encoding) {
  hmacCalls += 1;
  const text = typeof data === 'string' ? data : '';
  const size = typeof data === 'string' ? Buffer.byteLength(data) : (data?.byteLength ?? -1);
  const replacement = this !== probe && hmacCalls > 0 && size > 8 && text.includes('anonymous')
    ? 'attacker-controlled-binding'
    : data;
  return nativeApply(nativeHmacUpdate, this, [replacement, encoding]);
};

const nativeGetRandomValues = globalThis.crypto.getRandomValues;
Object.defineProperty(globalThis.crypto, 'getRandomValues', {
  configurable: true,
  value(array) {
    if (array?.byteLength === 16) {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0x6b);
      return array;
    }
    return nativeApply(nativeGetRandomValues, globalThis.crypto, [array]);
  },
});

const csrf = {
  field: 'csrf',
  secret: 'restart-entropy-secret-0123456789abcdef0123456789',
  sessionId() { return undefined; },
};

export default createApp({
  routes: [route('/', {
    access: publicAccess('C69 runtime process-restart proof'),
    page: () => mintCsrfToken(new Request('https://kovo.invalid/'), csrf, {
      audience: 'runtime-restart',
    }).token,
  })],
});
`,
      'utf8',
    );

    const tokens: string[] = [];
    for (let restart = 0; restart < 2; restart += 1) {
      const port = await reservePort();
      const child = spawnKovoDev(root, port);
      const output = collectChildOutput(child);
      try {
        const response = await fetchWhenReady(`http://127.0.0.1:${port}/`, output, 30_000);
        const body = await response.text();
        expect(response.status, output.combined()).toBe(200);
        const token = /v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.exec(body)?.[0];
        expect(token, body).toBeDefined();
        tokens.push(token!);
      } finally {
        await stopChild(child);
      }
    }

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  }, 60_000);
});

function devFixture(name: string): string {
  const root = mkdtempSync(join(repoRoot, `.tmp-kovo-dev-${name}-`));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  for (const packageName of ['browser', 'compiler', 'core', 'drizzle', 'server', 'style']) {
    symlinkSync(
      join(repoRoot, `packages/${packageName}`),
      join(root, `node_modules/@kovojs/${packageName}`),
    );
  }
  writeFileSync(join(root, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8');
  writeFileSync(
    join(root, 'src/app.ts'),
    `import { createApp, publicAccess, route } from '@kovojs/server';

export default createApp({
  routes: [route('/', {
    access: publicAccess('bootstrap ordering fixture'),
    page: () => '<main>Bootstrap safe</main>',
  })],
});
`,
    'utf8',
  );
  return root;
}

function attackerIntegrationSource(): string {
  return `export function createKovoAppShellViteDevIntegration() {
  return {
    onModuleDiagnostics() {},
    plugin: {
      configureServer(server) {
        server.middlewares.use((_request, response) => {
          response.statusCode = 200;
          response.end('<main data-attacker>ALIASED FRAMEWORK</main>');
        });
      },
    },
  };
}
export async function dispatchKovoAppShellViteDevRequest(
  _server,
  _options,
  _request,
  response,
) {
  response.statusCode = 200;
  response.end('<main data-attacker>ALIASED FRAMEWORK</main>');
}
`;
}

function writeAttackerIntegration(fileName: string): void {
  writeFileSync(fileName, attackerIntegrationSource(), 'utf8');
}

function spawnKovoDev(
  root: string,
  port: number,
  explicitConfig = false,
): ChildProcessWithoutNullStreams {
  const args = ['dev', './src/app.ts', '--root', root];
  if (explicitConfig) {
    args[args.length] = '--config';
    args[args.length] = join(root, 'vite.config.ts');
  }
  args[args.length] = '--host';
  args[args.length] = '127.0.0.1';
  args[args.length] = '--port';
  args[args.length] = String(port);
  args[args.length] = '--strict-port';
  return spawn(join(repoRoot, 'packages/cli/src/bin.ts'), args, { cwd: root, env: process.env });
}

function collectChildOutput(child: ChildProcessWithoutNullStreams): {
  combined(): string;
  stderr: string;
  stdout: string;
} {
  const output = {
    combined: () => `${output.stdout}\n${output.stderr}`,
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

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Unable to reserve port.');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function fetchWhenReady(
  url: string,
  output: { combined(): string },
  timeoutMs: number,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${url}.\n${output.combined()}`);
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for kovo dev to exit.'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitForChildExit(child, 10_000);
}
