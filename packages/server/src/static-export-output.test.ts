import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createStaticExportOutputPlan,
  staticExportAssetArtifacts,
  staticExportOutputPlan,
  writeStaticExportOutput,
} from './static-export-output.js';

describe('server static export output boundary', () => {
  it('normalizes static assets and plans directory targets without writing', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-plan-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-assets-'));
    try {
      const cssSource = path.join(sourceDir, 'app.css');
      await writeFile(cssSource, 'body { color: black; }\n', 'utf8');
      const assets = staticExportAssetArtifacts([
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: pathToFileURL(cssSource),
        },
      ]);

      const plan = staticExportOutputPlan(
        {
          artifacts: [
            {
              body: '<!doctype html><main>Home</main>',
              headers: { 'content-type': 'text/html; charset=utf-8' },
              path: '/index.html',
              status: 200,
            },
          ],
          assets,
          clientModules: [
            {
              body: 'export const cart = "plan";',
              headers: { 'content-type': 'text/javascript; charset=utf-8' },
              href: '/c/__v/plan/cart.client.js',
              path: '/c/__v/plan/cart.client.js',
              status: 200,
            },
          ],
        },
        { outDir: pathToFileURL(outDir) },
      );

      expect(assets).toEqual([
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/app.css',
          source: cssSource,
          status: 200,
        },
      ]);
      expect(plan).toEqual([
        {
          kind: 'route-document',
          path: '/index.html',
          targetPath: path.join(outDir, 'index.html'),
        },
        {
          kind: 'client-module',
          path: '/c/__v/plan/cart.client.js',
          targetPath: path.join(outDir, 'c', '__v', 'plan', 'cart.client.js'),
        },
        {
          kind: 'static-asset',
          path: '/assets/app.css',
          targetPath: path.join(outDir, 'assets', 'app.css'),
        },
      ]);
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects unsafe and conflicting target paths before writes are built', () => {
    const base = {
      artifacts: [],
      assets: [],
      outDir: '/tmp/kovo-static-export-output',
    };

    expect(() =>
      createStaticExportOutputPlan({
        ...base,
        clientModules: [
          {
            body: 'export {};',
            headers: {},
            href: '/c/%2e%2e/client.js?v=bad',
            path: '/c/%2e%2e/client.js',
            status: 200,
          },
        ],
      }),
    ).toThrow(/unsafe client module path segment/);

    expect(() =>
      createStaticExportOutputPlan({
        ...base,
        artifacts: [
          {
            body: '<!doctype html>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [
          {
            headers: {},
            path: '/index.html',
            source: '/workspace/public/index.html',
            status: 200,
          },
        ],
        clientModules: [],
      }),
    ).toThrow(/conflicts with route document '\/index\.html'/);
  });

  it('rejects stale client-module output evidence outside versioned /c/ URLs', () => {
    const base = {
      artifacts: [],
      assets: [],
      outDir: '/tmp/kovo-static-export-output',
    };
    const moduleArtifact = {
      body: 'export {};',
      headers: {},
      status: 200,
    };

    expect(() =>
      createStaticExportOutputPlan({
        ...base,
        clientModules: [
          {
            ...moduleArtifact,
            href: '/assets/cart.client.js?v=cart',
            path: '/assets/cart.client.js',
          },
        ],
      }),
    ).toThrow(/immutable versioned \/c\/ module URLs/);

    expect(() =>
      createStaticExportOutputPlan({
        ...base,
        clientModules: [
          {
            ...moduleArtifact,
            href: '/c/cart.client.js?v=cart',
            path: '/c/other.client.js',
          },
        ],
      }),
    ).toThrow(/artifact path and href pathname must match/);

    expect(() =>
      createStaticExportOutputPlan({
        ...base,
        clientModules: [
          {
            ...moduleArtifact,
            href: '/c/cart.client.js',
            path: '/c/cart.client.js',
          },
        ],
      }),
    ).toThrow(/with a path or query version/);
  });

  it('validates static asset sources before writing any output files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-write-'));
    try {
      const plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [
          {
            headers: {},
            path: '/assets/missing.css',
            source: path.join(outDir, 'missing.css'),
            status: 200,
          },
        ],
        clientModules: [],
        outDir,
      });

      await expect(writeStaticExportOutput(plan)).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            routePath: '/assets/missing.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('rejects non-file URL static asset sources at the public artifact boundary', () => {
    expect(() =>
      staticExportAssetArtifacts([
        {
          path: '/assets/app.css',
          source: new URL('https://cdn.example.test/app.css'),
        },
      ]),
    ).toThrow(/Static asset sources must be filesystem paths or file: URLs/);
  });

  it('rejects non-file URL output directories at the public output-plan boundary', () => {
    expect(() =>
      createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [],
        outDir: new URL('https://static.example.test/export/'),
      }),
    ).toThrow(/SPEC §9\.5 static export output directories must be filesystem paths or file: URLs/);
  });

  it('prunes stale route documents on re-export while retaining versioned /c/ modules (C2)', async () => {
    // C2/SPEC §9.5: a route removed across rebuilds must stop serving stale 200 HTML. SPEC §14: prior
    // immutable versioned /c/__v/ modules MUST be retained for the deploy-skew window.
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-prune-'));
    try {
      const v1Plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home v1</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
          {
            body: '<!doctype html><main>Old</main>',
            headers: {},
            path: '/old/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [
          {
            body: 'export const v1 = true;',
            headers: {},
            href: '/c/__v/v1/app.client.js',
            path: '/c/__v/v1/app.client.js',
            status: 200,
          },
        ],
        outDir,
      });
      await writeStaticExportOutput(v1Plan);

      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain('Home v1');
      await expect(readFile(path.join(outDir, 'old', 'index.html'), 'utf8')).resolves.toContain(
        'Old',
      );
      await expect(
        readFile(path.join(outDir, 'c', '__v', 'v1', 'app.client.js'), 'utf8'),
      ).resolves.toContain('export const v1 = true;');

      // Re-export only `/` (the `/old` route was removed; the v1 client module is no longer referenced).
      const v2Plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home v2</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [],
        outDir,
      });
      await writeStaticExportOutput(v2Plan);

      // The removed route's stale document is gone; the surviving route holds v2.
      await expect(readFile(path.join(outDir, 'old', 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain('Home v2');
      // SPEC §14: the prior immutable versioned module is RETAINED across the rebuild.
      await expect(
        readFile(path.join(outDir, 'c', '__v', 'v1', 'app.client.js'), 'utf8'),
      ).resolves.toContain('export const v1 = true;');
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('validates final output targets before committing staged files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-commit-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-source-'));
    try {
      const cssSource = path.join(sourceDir, 'app.css');
      await writeFile(cssSource, 'body { color: black; }\n', 'utf8');
      await mkdir(path.join(outDir, 'assets', 'app.css'), { recursive: true });

      const plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [
          {
            headers: {},
            path: '/assets/app.css',
            source: cssSource,
            status: 200,
          },
        ],
        clientModules: [
          {
            body: 'export const app = true;',
            headers: {},
            href: '/c/app.client.js?v=app',
            path: '/c/app.client.js',
            status: 200,
          },
        ],
        outDir,
      });

      await expect(writeStaticExportOutput(plan)).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining("target '"),
            routePath: '/assets/app.css',
          },
        ],
      });
      await expect(readFile(path.join(outDir, 'index.html'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'c', 'app.client.js'))).rejects.toThrow();
      await expect(readFile(path.join(outDir, 'assets', 'app.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('rejects symlinked output parent directories with KV229 before writes escape the root', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-parent-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-source-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-outside-'));
    try {
      const cssSource = path.join(sourceDir, 'app.css');
      await writeFile(cssSource, 'body { color: black; }\n', 'utf8');
      await symlink(outsideDir, path.join(outDir, 'assets'), 'dir');

      const plan = createStaticExportOutputPlan({
        artifacts: [],
        assets: [
          {
            headers: {},
            path: '/assets/app.css',
            source: cssSource,
            status: 200,
          },
        ],
        clientModules: [],
        outDir,
      });

      await expect(writeStaticExportOutput(plan)).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining("output parent '"),
            routePath: '/assets/app.css',
          },
        ],
      });
      await expect(readFile(path.join(outsideDir, 'app.css'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('rejects a symlinked output root with KV229', async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-root-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-outside-'));
    const outDir = path.join(parentDir, 'dist');
    try {
      await symlink(outsideDir, outDir, 'dir');

      const plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [],
        outDir,
      });

      await expect(writeStaticExportOutput(plan)).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            message: expect.stringContaining("output root '"),
            routePath: outDir,
          },
        ],
      });
      await expect(readFile(path.join(outsideDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(parentDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('replaces only a symlinked file target during the staged rename commit', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-target-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-outside-'));
    try {
      const outsideTarget = path.join(outsideDir, 'index.html');
      await writeFile(outsideTarget, '<!doctype html><main>outside</main>', 'utf8');
      await symlink(outsideTarget, path.join(outDir, 'index.html'));

      const plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [],
        outDir,
      });

      await writeStaticExportOutput(plan);

      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain('Home');
      await expect(readFile(outsideTarget, 'utf8')).resolves.toContain('outside');
      await expect(lstat(path.join(outDir, 'index.html'))).resolves.toSatisfy((stats) =>
        stats.isFile(),
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('rejects parent swaps between target preflight and commit with KV229', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-swap-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-outside-'));
    try {
      await mkdir(path.join(outDir, 'assets'));

      const plan = createStaticExportOutputPlan({
        artifacts: [
          {
            body: '<!doctype html><main>Home</main>',
            headers: {},
            path: '/assets/index.html',
            status: 200,
          },
        ],
        assets: [],
        clientModules: [],
        outDir,
      });

      const mutablePlan = plan as unknown as {
        writes: {
          write(targetPath: string): Promise<void>;
        }[];
      };
      const originalWrite = mutablePlan.writes[0]!.write;
      mutablePlan.writes[0]!.write = async (targetPath) => {
        await originalWrite(targetPath);
        await rm(path.join(outDir, 'assets'), { force: true, recursive: true });
        await symlink(outsideDir, path.join(outDir, 'assets'), 'dir');
      };

      await expect(writeStaticExportOutput(plan)).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          {
            code: 'KV229',
            routePath: '/assets/index.html',
          },
        ],
      });
      await expect(readFile(path.join(outsideDir, 'index.html'))).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });

  it('does not follow symlinked directories while pruning stale route documents', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-prune-link-'));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-output-outside-'));
    try {
      await writeFile(path.join(outsideDir, 'index.html'), '<!doctype html><main>outside</main>');
      await symlink(outsideDir, path.join(outDir, 'old'), 'dir');

      const plan = createStaticExportOutputPlan({
        artifacts: [],
        assets: [],
        clientModules: [],
        outDir,
      });
      await writeStaticExportOutput(plan);

      await expect(readFile(path.join(outsideDir, 'index.html'), 'utf8')).resolves.toContain(
        'outside',
      );
      await expect(lstat(path.join(outDir, 'old'))).resolves.toSatisfy((stats) =>
        stats.isSymbolicLink(),
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(outsideDir, { force: true, recursive: true });
    }
  });
});
