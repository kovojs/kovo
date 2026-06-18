import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

const repoRoot = process.cwd();

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
      } finally {
        await close(server);
      }
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

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      cpSync(join(outDir, 'server'), runtimeDir, { recursive: true });
      writeProductionOnlyRuntimeNodeModules(runtimeDir);
      mkdirSync(join(runtimeDir, 'client/assets'), { recursive: true });
      writeFileSync(join(runtimeDir, 'client/assets/prod-proof.txt'), 'asset:prod\n', 'utf8');

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

        const assetResponse = await fetch(`${origin}/assets/prod-proof.txt`);
        await expect(assetResponse.text()).resolves.toBe('asset:prod\n');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(assetResponse.headers.get('content-type')).toBe('application/octet-stream');
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('loads kovo.config.ts preset before host auto-detection', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-config-'));
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      writeFileSync(join(root, 'app.mjs'), appModuleSource(), 'utf8');
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

  it('fails loudly for detected presets that do not have emitters yet', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', 'missing-app.mjs']),
      );

      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'kovo build preset vercel is not implemented yet',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('uses KOVO_PRESET before host auto-detection', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const exitCode = await withEnv({ CF_PAGES: '1', KOVO_PRESET: 'vercel' }, () =>
        mainAsync(['build', 'missing-app.mjs']),
      );

      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'kovo build preset vercel is not implemented yet',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

function appModuleSource(): string {
  return `
import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';

const cart = domain('cart');
const db = { count: 0 };
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

function writeProductionOnlyRuntimeNodeModules(runtimeDir: string): void {
  const packageRoot = join(runtimeDir, 'node_modules');
  const kovoRoot = join(packageRoot, '@kovojs');
  mkdirSync(kovoRoot, { recursive: true });

  for (const name of ['core', 'runtime', 'server']) {
    cpSync(join(repoRoot, 'packages', name), join(kovoRoot, name), {
      recursive: true,
    });
  }

  writeThrowingPackage(packageRoot, 'vite');
  writeThrowingPackage(packageRoot, 'vite-plus');
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
