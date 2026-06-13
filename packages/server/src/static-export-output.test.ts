import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-output-plan-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-output-assets-'));
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
              href: '/c/cart.client.js?v=plan',
              path: '/c/cart.client.js',
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
          path: '/c/cart.client.js',
          targetPath: path.join(outDir, 'c', 'cart.client.js'),
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
      outDir: '/tmp/jiso-static-export-output',
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

  it('validates static asset sources before writing any output files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-output-write-'));
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
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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

  it('validates final output targets before committing staged files', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-output-commit-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'jiso-static-export-output-source-'));
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
        code: 'FW229',
        diagnostics: [
          {
            code: 'FW229',
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
});
