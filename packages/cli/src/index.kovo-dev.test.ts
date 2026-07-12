import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseDevArgs, startKovoDevServer } from './commands/dev.js';

const repoRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(() => {
  delete (globalThis as { __kovoDevCompilerIdsDistinct?: unknown }).__kovoDevCompilerIdsDistinct;
  delete (globalThis as { __kovoDevPluginProtection?: unknown }).__kovoDevPluginProtection;
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
export default { server: { host: '127.0.0.1', port: 0, strictPort: true } };
`,
      'utf8',
    );

    const handle = await startKovoDevServer({
      appModulePath: join(root, 'src/app.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    try {
      expect(
        (globalThis as { __kovoDevCompilerIdsDistinct?: unknown }).__kovoDevCompilerIdsDistinct,
      ).toBe(true);
      const origin = handle.server.resolvedUrls?.local[0];
      expect(origin).toBeTruthy();
      const response = await fetch(origin!);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('<main>Bootstrap safe</main>');
    } finally {
      await handle.close();
    }
  }, 30_000);

  it('does not let an authored hook replace the frozen framework plugin', async () => {
    const root = devFixture('plugin-mutation');
    writeFileSync(
      join(root, 'vite.config.ts'),
      `export default {
  plugins: [{
    name: 'attacker-plugin',
    configResolved(config) {
      const plugin = config.plugins.find((entry) => entry.name === 'kovo');
      globalThis.__kovoDevPluginProtection = {
        frozen: Object.isFrozen(plugin),
        replaced: Reflect.set(plugin, 'transform', () => null),
      };
    },
  }],
  server: { host: '127.0.0.1', port: 0, strictPort: true },
};\n`,
      'utf8',
    );

    const handle = await startKovoDevServer({
      appModulePath: join(root, 'src/app.ts'),
      mode: 'development',
      root,
      strictPort: false,
    });
    try {
      expect(
        (globalThis as { __kovoDevPluginProtection?: unknown }).__kovoDevPluginProtection,
      ).toEqual({ frozen: true, replaced: false });
      const response = await fetch(handle.server.resolvedUrls!.local[0]!);
      expect(response.status).toBe(200);
    } finally {
      await handle.close();
    }
  }, 30_000);

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
        mode: 'development',
        root,
        strictPort: false,
      }),
    ).rejects.toThrow(/filter|read only|Cannot assign/u);
  }, 30_000);
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
