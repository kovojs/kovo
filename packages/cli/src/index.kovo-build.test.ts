import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

const repoRoot = process.cwd();
const dockerIt = process.env.KOVO_TEST_DOCKER === '1' && dockerAvailable() ? it : it.skip;

describe('kovo build', () => {
  it('bundles an app module and emits node preset output without Vite at request time', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir, '--preset', 'node']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-build/v1\nAPP module=');
      expect(output).toContain(`SUMMARY preset=node outDir=${JSON.stringify(outDir)}`);
      expect(readFileSync(join(outDir, '.kovo/server/handler.mjs'), 'utf8')).not.toContain('vite');

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '2' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const queryResponse = await fetch(`${origin}/_q/cart`);
        await expect(queryResponse.text()).resolves.toBe(
          '<kovo-query name="cart">{"count":2}</kovo-query>',
        );

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.status).toBe(200);
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(clientModuleResponse.headers.get('content-type')).toBe(
          'text/javascript; charset=utf-8',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const stylesheetResponse = await fetch(`${origin}${stylesheetPath}`);
        const stylesheetText = await stylesheetResponse.text();
        expect(stylesheetText).toContain('color:#639');
        expect(stylesheetResponse.status).toBe(200);
        expect(stylesheetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(stylesheetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('loads TypeScript app modules through the build-time Vite SSR path', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-ts-app-'));
    const appPath = join(root, 'app.ts');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, typescriptAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/typed`);
        await expect(document.text()).resolves.toContain('<main>Typed Cart 4</main>');
        expect(document.status).toBe(200);
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-collects compiled component CSS into the build stylesheet asset', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-app-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, staticStylesheetRouteComponentAppModuleSource(), 'utf8');
      writeStyledComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const stylesheet = readFileSync(join(outDir, '.kovo/client/assets/styles.css'), 'utf8');
      expect(stylesheet).toContain('auto-css-card');
      expect(stylesheet).toContain('color: teal');
      expect(readFileSync(join(outDir, '.kovo/client/assets/routes/index.css'), 'utf8')).toContain(
        'auto-css-card',
      );
      const routeDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      expect(routeDocument).toContain('data-kovo-critical-href="/assets/routes/index.css"');
      expect(routeDocument).toContain('<link rel="stylesheet" href="/assets/routes/index.css">');
      const viteStylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
      expect(readFileSync(join(outDir, '.kovo/client', viteStylesheetPath), 'utf8')).toContain(
        'main{color:#639}',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('links only reachable build CSS chunks for each static route', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-route-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, splitStylesheetRouteAppModuleSource(), 'utf8');
      writeSplitStyledComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      expect(readFileSync(join(outDir, '.kovo/client/assets/base.css'), 'utf8')).toContain(
        'shared-card',
      );
      expect(readFileSync(join(outDir, '.kovo/client/assets/routes/index.css'), 'utf8')).toContain(
        'home-panel',
      );
      expect(readFileSync(join(outDir, '.kovo/client/assets/routes/login.css'), 'utf8')).toContain(
        'login-panel',
      );
      const homeDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      expect(homeDocument).toContain('/assets/base.css');
      expect(homeDocument).toContain('/assets/routes/index.css');
      expect(homeDocument).not.toContain('/assets/routes/login.css');
      expect(homeDocument).toContain('data-kovo-critical-href="/assets/base.css"');
      expect(homeDocument).toContain('data-kovo-critical-href="/assets/routes/index.css"');
      expect(homeDocument).not.toContain('data-kovo-critical-href="/assets/routes/login.css"');
      const loginDocument = readFileSync(join(outDir, '.kovo/static/login/index.html'), 'utf8');
      expect(loginDocument).toContain('/assets/base.css');
      expect(loginDocument).toContain('/assets/routes/login.css');
      expect(loginDocument).not.toContain('/assets/routes/index.css');
      expect(loginDocument).toContain('data-kovo-critical-href="/assets/base.css"');
      expect(loginDocument).toContain('data-kovo-critical-href="/assets/routes/login.css"');
      expect(loginDocument).not.toContain('data-kovo-critical-href="/assets/routes/index.css"');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('boots emitted node preset output from production dependencies with dev-package guards', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-prod-deps-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const runtimeDir = join(root, 'runtime');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      cpSync(join(outDir, 'server'), runtimeDir, { recursive: true });
      writeProductionOnlyRuntimeNodeModules(runtimeDir);

      const handlerSource = readFileSync(join(runtimeDir, 'server/handler.mjs'), 'utf8');
      expect(handlerSource).not.toContain('vite');

      const serverModule = (await import(
        `${pathToFileURL(join(runtimeDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '3' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const updatedDocument = await fetch(`${origin}/cart`);
        await expect(updatedDocument.text()).resolves.toContain('<main>Cart 3</main>');
        expect(updatedDocument.status).toBe(200);

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.status).toBe(200);
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const assetResponse = await fetch(`${origin}${stylesheetPath}`);
        await expect(assetResponse.text()).resolves.toContain('color:#639');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  dockerIt(
    'builds and runs the generated node Dockerfile without node_modules in the output',
    async () => {
      const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-docker-'));
      const appPath = join(root, 'app.mjs');
      const outDir = join(root, 'dist');
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let containerId: string | undefined;
      let imageId: string | undefined;

      try {
        mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
        symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
        writeFileSync(appPath, appModuleSource(), 'utf8');
        writeClientEntry(root);

        const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
        const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(exitCode, errorOutput).toBe(0);
        expect(stderr).not.toHaveBeenCalled();
        expect(existsSync(join(outDir, 'server/Dockerfile'))).toBe(true);
        expect(existsSync(join(outDir, 'server/node_modules'))).toBe(false);

        imageId = dockerOutput(['build', '-q', join(outDir, 'server')])
          .trim()
          .split('\n')
          .at(-1);
        if (!imageId) throw new Error('Docker build did not return an image id.');
        containerId = dockerOutput(['run', '--rm', '-d', '-p', '127.0.0.1::3000', imageId]).trim();
        const origin = await dockerContainerOrigin(containerId);
        await waitForDockerRoute(origin);

        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '5' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const updatedDocument = await fetch(`${origin}/cart`);
        await expect(updatedDocument.text()).resolves.toContain('<main>Cart 5</main>');
        expect(updatedDocument.status).toBe(200);

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const assetResponse = await fetch(`${origin}${stylesheetPath}`);
        await expect(assetResponse.text()).resolves.toContain('color:#639');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        if (containerId) dockerCleanup(['rm', '-f', containerId]);
        if (imageId) dockerCleanup(['image', 'rm', '-f', imageId]);
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  it('loads kovo.config.ts preset before host auto-detection', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-config-'));
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(join(root, 'app.mjs'), appModuleSource(), 'utf8');
      writeClientEntry(root);
      writeFileSync(
        join(root, 'kovo.config.ts'),
        [
          "import { defineConfig, node } from '@kovojs/server/build';",
          'export default defineConfig({',
          '  preset: node({ dockerfile: false }),',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        withEnv({ VERCEL: '1' }, () => mainAsync(['build', './app.mjs', '--out', './dist'])),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'SUMMARY preset=node',
      );
      expect(() => readFileSync(join(outDir, 'server/Dockerfile'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('passes inferred DATABASE_URL env to configured presets', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-config-env-'));
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(join(root, 'app.mjs'), databaseEnvAppModuleSource(), 'utf8');
      writeClientEntry(root);
      writeFileSync(
        join(root, 'kovo.config.ts'),
        [
          "import { mkdir, writeFile } from 'node:fs/promises';",
          "import { defineConfig } from '@kovojs/server/build';",
          'export default defineConfig({',
          '  preset: {',
          "    name: 'node',",
          '    async emit(_build, context) {',
          '      await mkdir(context.outDir, { recursive: true });',
          "      await writeFile(context.outDir + '/declared-env.txt', context.declaredEnv.join(','), 'utf8');",
          '    },',
          '    inspect(_build, context) {',
          '      return [{',
          "        code: 'test-declared-env',",
          "        message: 'declared=' + context.declaredEnv.join(','),",
          "        severity: 'warning',",
          '      }];',
          '    },',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('WARN test-declared-env declared=DATABASE_URL');
      expect(readFileSync(join(outDir, 'server/declared-env.txt'), 'utf8')).toBe('DATABASE_URL');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Vercel and emits Build Output API files', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vercel-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=vercel');
      expect(output).toContain(`serverOutDir=${JSON.stringify(join(outDir, '.vercel/output'))}`);
      expect(readBuildJson(join(outDir, '.vercel/output/config.json'))).toEqual({
        routes: [
          {
            continue: true,
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
            src: '/(?:assets|c)/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      expect(
        readBuildJson(join(outDir, '.vercel/output/functions/kovo.func/.vc-config.json')),
      ).toEqual({
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        runtime: 'nodejs22.x',
        shouldAddHelpers: true,
      });
      expect(
        readFileSync(join(outDir, '.vercel/output/static/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).toBe('export const cartClient = true;');
      const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
      expect(
        readFileSync(join(outDir, '.vercel/output/static', stylesheetPath.slice(1)), 'utf8'),
      ).toContain('color:#639');
      expect(
        readFileSync(join(outDir, '.vercel/output/functions/kovo.func/handler.mjs'), 'utf8'),
      ).not.toContain('vite');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Vercel and emits pure static output for static-only apps', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vercel-static-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, staticAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=vercel');
      expect(readBuildJson(join(outDir, '.kovo/meta.json'))).toMatchObject({ staticOnly: true });
      expect(readFileSync(join(outDir, '.vercel/output/static/index.html'), 'utf8')).toContain(
        '<main>Static Home</main>',
      );
      expect(existsSync(join(outDir, '.vercel/output/functions/kovo.func/index.cjs'))).toBe(false);
      expect(readBuildJson(join(outDir, '.vercel/output/config.json'))).toEqual({ version: 3 });
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses KOVO_PRESET before host auto-detection', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ KOVO_PRESET: 'cloudflare', VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=cloudflare');
      expect(output).toContain(`serverOutDir=${JSON.stringify(join(outDir, 'cloudflare'))}`);
      expect(readFileSync(join(outDir, 'cloudflare/wrangler.toml'), 'utf8')).toContain(
        'compatibility_flags = ["nodejs_compat"]',
      );
      expect(readFileSync(join(outDir, 'cloudflare/worker.mjs'), 'utf8')).toContain(
        "import handler from './server/handler.mjs';",
      );
      expect(
        readFileSync(join(outDir, 'cloudflare/client/c/__v/cart-v1/cart.client.js'), 'utf8'),
      ).toBe('export const cartClient = true;');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Cloudflare Pages and emits Wrangler output', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-auto-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ CF_PAGES: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'SUMMARY preset=cloudflare',
      );
      expect(readFileSync(join(outDir, 'cloudflare/wrangler.toml'), 'utf8')).toContain(
        'run_worker_first = true',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints Cloudflare database guidance when the bundle references DATABASE_URL', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-db-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, databaseEnvAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync([
        'build',
        appPath,
        '--out',
        outDir,
        '--preset',
        'cloudflare',
      ]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain(
        'WARN cloudflare-tcp-database The cloudflare preset emits a Worker with nodejs_compat.',
      );
      expect(output).toContain('SUMMARY preset=cloudflare');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails Cloudflare builds that import unsupported Node runtime APIs', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-blocked-api-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(appPath, blockedCloudflareApiAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync([
        'build',
        appPath,
        '--out',
        outDir,
        '--preset',
        'cloudflare',
      ]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('ERROR cloudflare-unsupported-node-api');
      expect(existsSync(join(outDir, 'cloudflare/worker.mjs'))).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function appModuleSource(): string {
  return `
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  domain,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';

const cart = domain('cart');
const db = { count: 0 };
const clientModules = createMemoryVersionedClientModuleRegistry();
clientModules.put({
  path: '/c/cart.client.js',
  source: 'export const cartClient = true;',
  version: 'cart-v1',
});
const cartQuery = query('cart', {
  load: () => ({ count: db.count }),
  reads: [cart],
});
const addToCart = mutation('cart/add', {
  csrf: false,
  input: s.object({ quantity: s.number().int().min(1).default(1) }),
  registry: {
    queries: [cartQuery],
    touches: [cart],
  },
  handler(input) {
    db.count += input.quantity;
    return { count: db.count };
  },
});

export default createApp({
  clientModules,
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/cart', {
      page: () => '<main>Cart ' + db.count + '</main>',
    }),
  ],
});
`;
}

function staticAppModuleSource(): string {
  return `
import { createApp, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/', {
      page: () => '<main>Static Home</main>',
    }),
  ],
});
`;
}

function staticStylesheetRouteComponentAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { AutoCssCard } from './src/auto-css-card.js';

export default createApp({
  routes: [
    route('/', {
      page: () => <AutoCssCard />,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function splitStylesheetRouteAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { HomePanel } from './src/home-panel.js';
import { LoginPanel } from './src/login-panel.js';
import { SharedCard } from './src/shared-card.js';

export default createApp({
  routes: [
    route('/', {
      page: () => <><SharedCard /><HomePanel /></>,
    }),
    route('/login', {
      page: () => <><SharedCard /><LoginPanel /></>,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function databaseEnvAppModuleSource(): string {
  return `
import { createApp, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/db', {
      page: () => '<main>' + (process.env.DATABASE_URL ?? 'missing') + '</main>',
    }),
  ],
});
`;
}

function blockedCloudflareApiAppModuleSource(): string {
  return `
import { spawnSync } from 'node:child_process';
import { createApp, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/blocked', {
      page: () => {
        spawnSync('true');
        return '<main>Blocked</main>';
      },
    }),
  ],
});
`;
}

function writeClientEntry(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
    'utf8',
  );
  writeFileSync(
    join(root, 'src/client.ts'),
    "import './style.css';\nexport const client = true;\n",
    'utf8',
  );
  writeFileSync(join(root, 'src/style.css'), 'main { color: rebeccapurple; }\n', 'utf8');
}

function writeStyledComponentClientEntry(root: string): void {
  writeClientEntry(root);
  writeFileSync(
    join(root, 'src/client.ts'),
    "import './style.css';\nimport './auto-css-card.tsx';\nexport const client = true;\n",
    'utf8',
  );
  writeFileSync(
    join(root, 'src/auto-css-card.tsx'),
    `
import { component } from '@kovojs/core';

export const AutoCssCard = component({
  css: \`
    auto-css-card { color: teal; }
  \`,
  render: () => <auto-css-card>Auto CSS</auto-css-card>,
});
`,
    'utf8',
  );
}

function writeSplitStyledComponentClientEntry(root: string): void {
  writeClientEntry(root);
  writeFileSync(
    join(root, 'src/client.ts'),
    [
      "import './style.css';",
      "import './home-panel.tsx';",
      "import './login-panel.tsx';",
      "import './shared-card.tsx';",
      'export const client = true;',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/home-panel.tsx'),
    styledHostComponentSource('HomePanel', 'home-panel', 'crimson'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/login-panel.tsx'),
    styledHostComponentSource('LoginPanel', 'login-panel', 'goldenrod'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/shared-card.tsx'),
    styledHostComponentSource('SharedCard', 'shared-card', 'teal'),
    'utf8',
  );
}

function styledHostComponentSource(name: string, host: string, color: string): string {
  return `
import { component } from '@kovojs/core';

export const ${name} = component({
  css: \`
    ${host} { color: ${color}; }
  \`,
  render: () => <${host}>${name}</${host}>,
});
`;
}

function writeReactJsxRuntimeStub(root: string): void {
  const reactDir = join(root, 'node_modules/react');
  mkdirSync(reactDir, { recursive: true });
  writeFileSync(
    join(reactDir, 'package.json'),
    JSON.stringify({
      exports: {
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './jsx-runtime': './jsx-runtime.js',
      },
      name: 'react',
      type: 'module',
    }),
    'utf8',
  );
  const runtime = [
    'export function jsx() { return null; }',
    'export function jsxs() { return null; }',
    'export function jsxDEV() { return null; }',
    'export const Fragment = Symbol.for("react.fragment");',
    '',
  ].join('\n');
  writeFileSync(join(reactDir, 'jsx-dev-runtime.js'), runtime, 'utf8');
  writeFileSync(join(reactDir, 'jsx-runtime.js'), runtime, 'utf8');
}

function builtAssetPath(outDir: string, predicate: (path: string) => boolean): string {
  const manifest = JSON.parse(readFileSync(join(outDir, '.kovo/manifest.json'), 'utf8')) as {
    assets?: readonly { path: string }[];
  };
  const asset = manifest.assets?.find((entry) => predicate(entry.path));
  if (!asset) throw new Error(`Expected built asset in ${outDir}`);
  return asset.path;
}

function readBuildJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function typescriptAppModuleSource(): string {
  return `
import { createApp, domain, query, route } from '@kovojs/server';

const db: { count: number } = { count: 4 };
const typed = domain('typed');
const typedQuery = query('typed', {
  load: () => ({ count: db.count }),
  reads: [typed],
});

export default createApp({
  queries: [typedQuery],
  routes: [
    route('/typed', {
      page: () => '<main>Typed Cart ' + db.count + '</main>',
    }),
  ],
});
`;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected kovo build test server to listen on an ephemeral port.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dockerOutput(args: readonly string[]): string {
  return execFileSync('docker', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function dockerCleanup(args: readonly string[]): void {
  try {
    execFileSync('docker', [...args], { stdio: 'ignore' });
  } catch {
    // Cleanup is best-effort; the test failure above is more useful than a
    // secondary Docker cleanup error.
  }
}

async function dockerContainerOrigin(containerId: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const portOutput = dockerOutput(['port', containerId, '3000/tcp']).trim();
      const portLine = portOutput.split('\n').find(Boolean);
      if (portLine) return `http://${portLine.replace(/^0\.0\.0\.0:/, '127.0.0.1:')}`;
    } catch {
      // Docker can need a brief moment before port metadata is available.
    }
    await delay(100);
  }
  throw new Error(`Docker container ${containerId} did not expose port 3000.`);
}

async function waitForDockerRoute(origin: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/cart`);
      await response.arrayBuffer();
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Dockerized Kovo server did not become ready: ${String(lastError)}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeProductionOnlyRuntimeNodeModules(runtimeDir: string): void {
  const packageRoot = join(runtimeDir, 'node_modules');
  for (const packageName of [
    '@kovojs/core',
    '@kovojs/browser',
    '@kovojs/server',
    'vite',
    'vite-plus',
  ]) {
    writeThrowingPackage(packageRoot, packageName);
  }
}

function writeThrowingPackage(packageRoot: string, packageName: string): void {
  const packageDir = join(packageRoot, packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      exports: {
        '.': './index.mjs',
        './*': './index.mjs',
      },
      name: packageName,
      type: 'module',
      version: '0.0.0-dev-guard',
    }),
    'utf8',
  );
  writeFileSync(
    join(packageDir, 'index.mjs'),
    `throw new Error(${JSON.stringify(
      `${packageName} must not be imported by emitted kovo build output at request time`,
    )});\n`,
    'utf8',
  );
}

async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]] as const),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    return await run();
  } finally {
    process.chdir(previous);
  }
}
