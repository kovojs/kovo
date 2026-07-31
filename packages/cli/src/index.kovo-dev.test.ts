import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request as nodeHttpRequest } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isolateAuthoredDevPluginOptions,
  parseDevArgs,
  type KovoDevOptions,
} from './commands/dev.js';
import type { KovoCommandSecurityDisposition } from './commands/security-disposition.js';

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
      '--debug',
    ]);

    expect(parsed).toEqual({
      ok: true,
      options: {
        appModulePath: join(repoRoot, 'fixture/src/app.ts'),
        configFile: join(repoRoot, 'fixture/vite.config.ts'),
        debug: true,
        host: '127.0.0.1',
        mode: 'test-dev',
        port: 4173,
        root: join(repoRoot, 'fixture'),
        strictPort: true,
      },
    });
    expect(parseDevArgs(['./src/app.ts', '--port', '65536'])).toEqual({
      message:
        'kovo: dev --port must be an integer from 0 through 65535.\nusage: kovo dev <app-module> [--root <dir>] [--config <file>] [--host <host>] [--port <port>] [--strict-port] [--mode <mode>] [--debug]',
      ok: false,
    });
  });

  it('resolves dev paths against the boot-pinned invocation cwd', () => {
    const outside = mkdtempSync(join(tmpdir(), 'kovo-dev-cwd-mutation-'));
    temporaryRoots.push(outside);
    const previousCwd = process.cwd();
    try {
      process.chdir(outside);
      expect(parseDevArgs(['./src/app.ts', '--root', './fixture'], repoRoot)).toEqual({
        ok: true,
        options: {
          appModulePath: join(repoRoot, 'fixture/src/app.ts'),
          debug: false,
          mode: 'development',
          root: join(repoRoot, 'fixture'),
          strictPort: false,
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
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

  it('ignores undeclared Vite config in the real default CLI path', async () => {
    const root = devFixture('undeclared-config', true);
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

      await waitForOutput(output, /Kovo dev ready in \d+ms/u, 5_000);
      expect(output.stdout).toContain(`  Local URL    http://127.0.0.1:${port}/`);
      expect(output.stdout).toContain(`  Network URL  http://127.0.0.1:${port}/ (loopback only)`);
      expect(output.stdout).toContain('  Mode         development');
      expect(output.stdout).toContain('  App          src/app.ts');
      expect(output.stdout).toContain('  Database     none configured');
      expect(output.stdout).toContain(`  Devtool      http://127.0.0.1:${port}/__kovo`);
      expect(output.stdout).not.toMatch(/(?:VITE|Local:|press h to show help)/u);

      const devtoolResponse = await fetch(`http://127.0.0.1:${port}/__kovo`);
      const devtoolHtml = await devtoolResponse.text();
      expect(devtoolResponse.status, `${devtoolHtml}\n${output.combined()}`).toBe(200);
      expect(devtoolResponse.headers.get('cache-control')).toBe('no-store');
      expect(devtoolResponse.headers.get('content-security-policy')).toContain(
        "default-src 'none'",
      );
      expect(devtoolHtml).toContain('<title>Kovo Dataflow Devtool</title>');
      expect(devtoolHtml).toContain('live closed app.assemble() runtime registry');
      expect(devtoolHtml).toContain('Coverage limitations');
      expect(devtoolHtml).toContain('data-node-id="mutation:app/add-inventory"');
      expect(devtoolHtml).toContain('data-node-id="domain:inventory"');
      expect(devtoolHtml).toContain('data-node-id="query:app/inventory-query"');
      expect(devtoolHtml).toContain('Optimistic coverage (SPEC §10.6)');
      expect(devtoolHtml).toContain('hand-written');
      expect(devtoolHtml).toContain('data-node-id="page:/"');
      expect(devtoolHtml).toContain('src="/__kovo/client.js"');

      const devtoolCookie = devtoolResponse.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
      expect(devtoolCookie).toMatch(/^Kovo-Dev-Auth=/u);
      const devtoolClientResponse = await fetch(`http://127.0.0.1:${port}/__kovo/client.js`, {
        headers: { Cookie: devtoolCookie },
      });
      const devtoolClientSource = await devtoolClientResponse.text();
      expect(devtoolClientResponse.status).toBe(200);
      expect(devtoolClientResponse.headers.get('cache-control')).toBe('no-store');
      expect(devtoolClientSource).toContain('const kovoDevtoolInit = function');
    } finally {
      await stopChild(child);
    }
    await expect(waitForPortClosed(port, 5_000)).resolves.toBeUndefined();
  }, 40_000);

  it('finishes fixed-port app activation before listen and reports within the post-bind budget', async () => {
    const root = devFixture('fixed-port-ready-order');
    const activationMarker = join(root, 'initial-activation.marker');
    writeFileSync(
      join(root, 'src/app.ts'),
      `import { writeFileSync } from 'node:fs';

import { defineKovo } from '@kovojs/server';

writeFileSync(${JSON.stringify(activationMarker)}, 'activation entered', 'utf8');
await new Promise<void>((resolve) => setTimeout(resolve, 2_000));

const app = defineKovo({
  appId: '22222222-2222-4222-8222-222222222222',
});
const homeRoute = app.route('/', {
  access: app.publicAccess('fixed-port readiness ordering fixture'),
  page: () => '<main>Activation complete</main>',
});
export default app.assemble({
  routes: [homeRoute],
});
`,
      'utf8',
    );

    const port = await reservePort();
    const child = spawnKovoDev(root, port);
    const output = collectChildOutput(child);
    try {
      await waitForFile(activationMarker, output, 30_000);
      expect(output.stdout).not.toMatch(/Kovo dev ready in \d+ms/u);
      await expect(tcpConnects(port)).resolves.toBe(false);

      await waitForTcpListener(port, child, output, 30_000);
      const listenedAt = Date.now();
      await waitForOutput(output, /Kovo dev ready in \d+ms/u, 5_000);
      expect(Date.now() - listenedAt).toBeLessThanOrEqual(5_000);

      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status, output.combined()).toBe(200);
      await expect(response.text()).resolves.toContain('Activation complete');
    } finally {
      await stopChild(child);
    }
  }, 50_000);

  it('honors boot-pinned HOST and PORT without evaluating undeclared config', async () => {
    const root = devFixture('pinned-listen-environment');
    const port = await reservePort();
    const invocationEnv = Object.freeze(
      Object.assign(Object.create(null) as NodeJS.ProcessEnv, {
        HOST: '127.0.0.1',
        PORT: String(port),
      }),
    );
    const result = await runKovoDevWorker(
      {
        appModulePath: join(root, 'src/app.ts'),
        mode: 'development',
        root,
        strictPort: false,
      },
      {
        invocationCwd: repoRoot,
        invocationEnv,
        paranoidStaticAdvisory: false,
      },
      `http://127.0.0.1:${port}/`,
    );
    expect(result, workerFailure(result)).toMatchObject({
      ok: true,
      response: { body: expect.stringContaining('<main>Bootstrap safe</main>'), status: 200 },
      server: { host: '127.0.0.1', port, strictPort: true },
    });
  }, 30_000);

  it('restores verbose Vite lifecycle output under --debug without hiding readiness', async () => {
    const root = devFixture('debug-output');
    writeFileSync(
      join(root, 'package.json'),
      '{"private":true,"type":"module","dependencies":{"better-sqlite3":"12.11.1"}}\n',
      'utf8',
    );
    const port = await reservePort();
    const child = spawnKovoDev(root, port, false, true);
    const output = collectChildOutput(child);
    try {
      const response = await fetchWhenReady(`http://127.0.0.1:${port}/`, output, 30_000);
      expect(response.status, output.combined()).toBe(200);
      await waitForOutput(output, /Kovo dev ready in \d+ms/u, 5_000);
      expect(output.combined()).toContain('Local:');
      expect(output.stdout).toContain('  Database     none configured');
    } finally {
      await stopChild(child);
    }
  }, 40_000);

  // @kovo-security-classifier-corpus dev-host-door
  // @kovo-security-certifies C13 dev-host-http-websocket-rebinding-closed
  it('closes the real HTTP and HMR websocket dev-host door against DNS rebinding', async () => {
    const root = devFixture('dev-host-door');
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'public/source-secret'), 'extensionless source secret', 'utf8');
    const defaultPosture = await runKovoDevWorker({
      appModulePath: join(root, 'src/app.ts'),
      mode: 'development',
      port: 0,
      root,
      strictPort: true,
    });
    expect.soft(defaultPosture, workerFailure(defaultPosture)).toMatchObject({
      ok: true,
      readyReport: expect.stringMatching(/Local URL\s+http:\/\/127\.0\.0\.1:(?!0\/)\d+\//u),
      server: { host: '127.0.0.1' },
    });

    const localhostPort = await reservePort('localhost');
    const localhostPosture = await runKovoDevWorker(
      {
        appModulePath: join(root, 'src/app.ts'),
        host: 'localhost',
        mode: 'development',
        port: localhostPort,
        root,
        strictPort: true,
      },
      undefined,
      `http://localhost:${localhostPort}/`,
    );
    expect.soft(localhostPosture, workerFailure(localhostPosture)).toMatchObject({
      ok: true,
      readyReport: expect.stringContaining(`Local URL    http://localhost:${localhostPort}/`),
      response: { body: expect.stringContaining('<main>Bootstrap safe</main>'), status: 200 },
      server: { host: 'localhost' },
    });

    const exposedPosture = await runKovoDevWorker({
      appModulePath: join(root, 'src/app.ts'),
      host: '0.0.0.0',
      mode: 'development',
      port: 0,
      root,
      strictPort: true,
    });
    expect.soft(exposedPosture).toMatchObject({
      error: expect.stringMatching(/exact loopback host/u),
      ok: false,
    });

    const port = await reservePort();
    const child = spawnKovoDev(root, port);
    const output = collectChildOutput(child);
    const authority = `127.0.0.1:${port}`;
    const origin = `http://${authority}`;
    try {
      const bootstrap = await fetchWhenReady(`${origin}/`, output, 30_000);
      const setCookie = bootstrap.headers.get('set-cookie');
      expect.soft(bootstrap.status, output.combined()).toBe(200);
      expect.soft(setCookie).toEqual(expect.stringMatching(/^Kovo-Dev-Auth=[A-Za-z0-9_-]+;/u));
      const cookie = setCookie?.split(';', 1)[0] ?? 'Kovo-Dev-Auth=missing';

      const crossOriginDocument = await rawDevHttpRequest({
        authority,
        origin: 'http://attacker.example',
        path: '/',
        port,
      });
      expect.soft(crossOriginDocument).toMatchObject({ status: 403 });
      expect.soft(crossOriginDocument.headers['set-cookie']).toBeUndefined();

      const crossOriginDevtool = await rawDevHttpRequest({
        authority,
        origin: 'http://attacker.example',
        path: '/__kovo',
        port,
      });
      expect.soft(crossOriginDevtool).toMatchObject({ status: 403 });

      const unauthenticatedSource = await rawDevHttpRequest({
        authority,
        origin,
        path: '/src/app.ts',
        port,
      });
      expect.soft(unauthenticatedSource).toMatchObject({ status: 401 });

      const reboundSource = await rawDevHttpRequest({
        authority,
        cookie,
        origin: 'http://attacker.example',
        path: '/src/app.ts',
        port,
      });
      expect.soft(reboundSource).toMatchObject({ status: 403 });

      const authenticatedSource = await rawDevHttpRequest({
        authority,
        cookie,
        origin,
        path: '/src/app.ts',
        port,
      });
      expect.soft(authenticatedSource.status).toBe(200);
      expect.soft(authenticatedSource.body).toContain('defineKovo');

      const unauthenticatedExtensionlessSource = await rawDevHttpRequest({
        authority,
        origin,
        path: '/source-secret',
        port,
      });
      expect.soft(unauthenticatedExtensionlessSource).toMatchObject({ status: 401 });
      const authenticatedExtensionlessSource = await rawDevHttpRequest({
        authority,
        cookie,
        origin,
        path: '/source-secret',
        port,
      });
      expect.soft(authenticatedExtensionlessSource).toMatchObject({
        body: 'extensionless source secret',
        status: 200,
      });

      const reboundHost = await rawDevHttpRequest({
        authority: `attacker.example:${port}`,
        cookie,
        origin: `http://attacker.example:${port}`,
        path: '/src/app.ts',
        port,
      });
      expect.soft(reboundHost).toMatchObject({ status: 403 });

      await expect(
        rawDevWebSocketHandshake({
          authority,
          cookie,
          origin: 'http://attacker.example',
          port,
        }),
      ).resolves.toBe(403);
      await expect(rawDevWebSocketHandshake({ authority, origin, port })).resolves.toBe(403);
      await expect(rawDevWebSocketHandshake({ authority, cookie, origin, port })).resolves.toBe(
        101,
      );
      await expect(
        rawDevWebSocketHandshake({
          authority,
          cookie,
          origin,
          path: `/?token=${cookie.slice(cookie.indexOf('=') + 1)}`,
          port,
          protocol: 'vite-hmr',
        }),
      ).resolves.toBe(101);
    } finally {
      await stopChild(child);
    }
  }, 75_000);

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

      const result = await runKovoDevWorker({
        appModulePath: join(root, 'src/app.ts'),
        configFile: join(root, 'vite.config.ts'),
        mode: 'development',
        root,
        strictPort: false,
      });
      expect(result).toMatchObject({
        error: expect.stringContaining(
          `kovo dev rejects authored Vite plugin ${hookName}: supported plugins are client-environment transforms`,
        ),
        ok: false,
      });
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
    const environmentResult = await runKovoDevWorker({
      appModulePath: join(root, 'src/app.ts'),
      configFile: join(root, 'vite.config.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    expect(environmentResult).toMatchObject({
      error: expect.stringMatching(/rejects authored Vite config key environments/u),
      ok: false,
    });

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
    const accessorResult = await runKovoDevWorker({
      appModulePath: join(accessorRoot, 'src/app.ts'),
      configFile: join(accessorRoot, 'vite.config.ts'),
      mode: 'development',
      root: accessorRoot,
      strictPort: false,
    });
    expect(accessorResult).toMatchObject({
      error: expect.stringMatching(
        /Authored Vite config\.resolve (?:changed while it was inspected|must be an own data property)/u,
      ),
      ok: false,
    });
    expect(existsSync(marker)).toBe(false);
    // This deliberately boots and rejects twelve independent authored Vite config graphs. Each
    // child has its own 30-second bound; keep the security cases serial, while allowing a fully
    // populated four-way CI shard enough aggregate wall-clock headroom.
  }, 180_000);

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

    const result = await runKovoDevWorker({
      appModulePath: join(root, 'src/app.ts'),
      configFile: join(root, 'vite.config.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    expect(result).toMatchObject({
      error: expect.stringMatching(/filter|read only|Cannot assign/u),
      ok: false,
    });
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

    const result = await runKovoDevWorker({
      appModulePath: join(root, 'src/app.ts'),
      configFile: join(root, 'vite.config.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    expect(result).toMatchObject({
      error: expect.stringMatching(/requires authored Vite plugin apply to be the static/u),
      ok: false,
    });
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

      expect(status).toBe(2);
      expect(output.stderr).toContain('kovo dev rejects authored Vite config key resolve');
      expect(output.combined()).not.toContain('ALIASED FRAMEWORK');
    }
    // This boots three independent real CLI processes serially. The fully populated four-way CI
    // shard can make the same assertions take ~40s even though each child stays within its bound.
  }, 90_000);

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
import { defineKovo } from '@kovojs/server'
import { mintCsrfToken } from '@kovojs/server/security';

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
Reflect.set(hmacPrototype, 'update', function selectiveRuntimeHmac(data, encoding) {
  hmacCalls += 1;
  const text = typeof data === 'string' ? data : '';
  const size = typeof data === 'string' ? Buffer.byteLength(data) : (data?.byteLength ?? -1);
  const replacement = this !== probe && hmacCalls > 0 && size > 8 && text.includes('anonymous')
    ? 'attacker-controlled-binding'
    : data;
  return nativeApply(nativeHmacUpdate, this, [replacement, encoding]);
});

const nativeGetRandomValues = globalThis.crypto.getRandomValues;
Reflect.defineProperty(globalThis.crypto, 'getRandomValues', {
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

export const app = defineKovo({
  appId: '33333333-3333-4333-8333-333333333333',
});
const entropyRoute = app.route('/', {
    access: app.publicAccess('C69 runtime process-restart proof'),
    page: () => mintCsrfToken(new Request('https://kovo.invalid/'), csrf, {
      audience: 'runtime-restart',
    }).token,
});
export default app.assemble({
  routes: [entropyRoute],
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

  it('atomically swaps a real app edit and keeps the last-good graph through failed evaluation', async () => {
    const root = devFixture('atomic-runner-hmr');
    const appFile = join(root, 'src/app.ts');
    const initialSource = readFileSync(appFile, 'utf8');
    const secondSource = initialSource.replace('Bootstrap safe', 'Atomic generation two');
    const recoveredSource = initialSource.replace('Bootstrap safe', 'Atomic generation three');
    const failedCandidateMarker = join(root, 'failed-candidate-entered.marker');
    const port = await reservePort();
    const child = spawnKovoDev(root, port);
    const output = collectChildOutput(child);
    const url = `http://127.0.0.1:${port}/`;

    try {
      await expect(fetchBodyContaining(url, 'Bootstrap safe', output, 30_000)).resolves.toContain(
        'Bootstrap safe',
      );

      writeFileSync(appFile, secondSource, 'utf8');
      await expect(
        fetchBodyContaining(url, 'Atomic generation two', output, 15_000),
      ).resolves.toContain('Atomic generation two');

      writeFileSync(
        appFile,
        `${secondSource}
import { writeFileSync as writeFailedCandidateMarker } from 'node:fs';
writeFailedCandidateMarker(${JSON.stringify(failedCandidateMarker)}, 'entered', 'utf8');
throw new Error('candidate evaluation failed');
`,
      );
      // SPEC §9.5.1: synchronize on actual candidate evaluation, then prove concurrent request
      // availability without turning Vite watcher settlement time into a throughput contract.
      await waitForFile(failedCandidateMarker, output, 15_000);
      const lastGoodResponses = await Promise.all(
        [0, 1, 2].map(async () => {
          const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          return { body: await response.text(), status: response.status };
        }),
      );
      for (const response of lastGoodResponses) {
        expect(response.status, `${response.body}\n${output.combined()}`).toBe(200);
        expect(response.body, output.combined()).toContain('Atomic generation two');
      }

      writeFileSync(appFile, recoveredSource, 'utf8');
      await expect(
        fetchBodyContaining(url, 'Atomic generation three', output, 15_000),
      ).resolves.toContain('Atomic generation three');
    } finally {
      await stopChild(child);
    }
  }, 60_000);
});

function devFixture(name: string, richGraph = false): string {
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
  writeFileSync(
    join(root, 'package.json'),
    '{"private":true,"type":"module","dependencies":{"@electric-sql/pglite":"0.5.1","pg":"8.22.0"}}\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'src/app.ts'),
    richGraph
      ? `import { defineKovo, domain, s } from '@kovojs/server';

export const app = defineKovo({
  appId: '22222222-2222-4222-8222-222222222222',
});
const inventoryDomain = domain('inventory');
export const inventoryQuery = app.query({
  access: app.publicAccess('devtool graph fixture'),
  load: () => ({ count: 0 }),
  output: s.object({ count: s.number() }),
  reads: [inventoryDomain],
});
const inventoryInput = s.object({ count: s.number() });
export const addInventory = app.mutation({
  access: app.publicAccess('devtool graph fixture'),
  handler: () => ({}),
  input: inventoryInput,
  optimistic: [inventoryQuery.optimistic(inventoryInput, (value) => value)],
  registry: { queries: [inventoryQuery], touches: [inventoryDomain] },
});
const homeRoute = app.route('/', {
  access: app.publicAccess('bootstrap ordering fixture'),
  page: () => '<main>Bootstrap safe</main>',
});

export default app.assemble({
  mutations: [addInventory],
  queries: [inventoryQuery],
  routes: [homeRoute],
});
`
      : `import { defineKovo } from '@kovojs/server';

export const app = defineKovo({
  appId: '22222222-2222-4222-8222-222222222222',
});
const homeRoute = app.route('/', {
  access: app.publicAccess('bootstrap ordering fixture'),
  page: () => '<main>Bootstrap safe</main>',
});
export default app.assemble({
  routes: [homeRoute],
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

type KovoDevWorkerResult =
  | { error: string; ok: false }
  | {
      ok: true;
      readyReport: string;
      response?: { body: string; status: number };
      server: { host?: boolean | string; port?: number; strictPort?: boolean };
    };

async function runKovoDevWorker(
  options: KovoDevOptions,
  security?: KovoCommandSecurityDisposition,
  probeUrl?: string,
): Promise<KovoDevWorkerResult> {
  const payload = Buffer.from(JSON.stringify({ options, probeUrl, security }), 'utf8').toString(
    'base64url',
  );
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      join(repoRoot, 'tests/kovo-dev-worker.mjs'),
      payload,
    ],
    { cwd: repoRoot, env: process.env },
  );
  const output = collectChildOutput(child);
  const status = await waitForChildExit(child, 30_000);
  const match = /kovo-dev-worker\/v1\n([^\n]+)\n/u.exec(output.stdout);
  if (status !== 0 || match?.[1] === undefined) {
    throw new Error(`Kovo dev worker failed with status ${status}.\n${output.combined()}`);
  }
  return JSON.parse(match[1]) as KovoDevWorkerResult;
}

function workerFailure(result: KovoDevWorkerResult): string | undefined {
  return result.ok ? undefined : result.error;
}

function spawnKovoDev(
  root: string,
  port: number,
  explicitConfig = false,
  debug = false,
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
  if (debug) args[args.length] = '--debug';
  return spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      join(repoRoot, 'packages/cli/src/bin.ts'),
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1' },
    },
  );
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

async function reservePort(host = '127.0.0.1'): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Unable to reserve port.');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

interface RawDevRequestOptions {
  authority: string;
  cookie?: string;
  origin?: string;
  path: string;
  port: number;
}

async function rawDevHttpRequest(options: RawDevRequestOptions): Promise<{
  body: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}> {
  return await new Promise((resolve, reject) => {
    const request = nodeHttpRequest(
      {
        headers: {
          Host: options.authority,
          ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
          ...(options.origin === undefined ? {} : { Origin: options.origin }),
        },
        host: '127.0.0.1',
        method: 'GET',
        path: options.path,
        port: options.port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once('error', reject);
    request.end();
  });
}

async function rawDevWebSocketHandshake(
  options: Omit<RawDevRequestOptions, 'path'> & {
    path?: string;
    protocol?: 'vite-hmr' | 'vite-ping';
  },
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: options.port });
    let settled = false;
    let response = '';
    const finish = (error: Error | undefined, status?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(status ?? 0);
    };
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for the HMR websocket handshake.\n${response}`));
    }, 5_000);
    socket.once('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      response += String(chunk);
      if (!response.includes('\r\n\r\n')) return;
      const match = /^HTTP\/1\.1 (\d{3})/u.exec(response);
      finish(
        match ? undefined : new Error(`Malformed websocket response.\n${response}`),
        match === null ? undefined : Number.parseInt(match[1]!, 10),
      );
    });
    socket.once('connect', () => {
      const headers = [
        `GET ${options.path ?? '/'} HTTP/1.1`,
        `Host: ${options.authority}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        `Sec-WebSocket-Protocol: ${options.protocol ?? 'vite-ping'}`,
        ...(options.origin === undefined ? [] : [`Origin: ${options.origin}`]),
        ...(options.cookie === undefined ? [] : [`Cookie: ${options.cookie}`]),
        '',
        '',
      ];
      socket.write(headers.join('\r\n'));
    });
  });
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

async function fetchBodyContaining(
  url: string,
  expected: string,
  output: { combined(): string },
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      latest = await response.text();
      if (response.status === 200 && latest.includes(expected)) return latest;
    } catch {
      // Startup and an in-progress watcher settlement are ordinary retry states.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${url} to contain ${JSON.stringify(expected)}.\n${latest}\n${output.combined()}`,
  );
}

async function waitForOutput(
  output: { combined(): string },
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(output.combined())) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for output ${pattern}.\n${output.combined()}`);
}

async function waitForFile(
  file: string,
  output: { combined(): string },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${file}.\n${output.combined()}`);
}

async function waitForTcpListener(
  port: number,
  child: ChildProcessWithoutNullStreams,
  output: { combined(): string },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`kovo dev exited before listening.\n${output.combined()}`);
    }
    if (await tcpConnects(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for kovo dev port ${port}.\n${output.combined()}`);
}

async function tcpConnects(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
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

async function waitForPortClosed(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for kovo dev port ${port} to close.`);
}
