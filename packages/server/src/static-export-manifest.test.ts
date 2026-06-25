import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { route } from './route.js';
import { exportStaticApp } from './static-export.js';
import {
  formatStaticExportDiagnostic,
  formatStaticExportDiagnostics,
  isStaticExportDiagnostic,
  isStaticExportDiagnosticError,
  StaticExportError,
} from './static-export-diagnostics.js';
import { staticExportOutputPlan } from './static-export-output.js';
import {
  assertStaticExportManifestMatchesResult,
  staticExportInventory,
  staticExportManifest,
} from './static-export-result.js';

const runtimeClientModulePath = /^\/c\/__v\/[^/]+\/kovo-runtime\.client\.js$/;
const runtimeClientModuleArtifact = expect.objectContaining({
  href: expect.stringMatching(runtimeClientModulePath),
  path: expect.stringMatching(runtimeClientModulePath),
  status: 200,
});
const runtimeClientModuleFile = expect.objectContaining({
  href: expect.stringMatching(runtimeClientModulePath),
  kind: 'client-module',
  path: expect.stringMatching(runtimeClientModulePath),
  status: 200,
});

describe('server static export', () => {
  it('summarizes dry-run route, client module, and asset inventory in write order', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "inventory";',
      version: 'cart-inventory',
    });
    const app = createApp({
      routes: [
        route('/', {
          modulepreloads: [cartHref],
          page: () => trustedHtml('<main>Home</main>'),
        }),
      ],
    });
    app.clientModules = registry;

    const result = await exportStaticApp(app, {
      assets: [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: '/workspace/dist/assets/app.css',
        },
      ],
    });

    expect(staticExportInventory(result)).toEqual([
      {
        headers: {
          'content-security-policy':
            "default-src 'self'; script-src 'self' 'sha256-r+dYbT4MW7b2daKYtHumwNfjFE4Vx7KzXxym5gJRNjI='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
          'content-type': 'text/html; charset=utf-8',
          link: `<${cartHref}>; rel=modulepreload`,
          'referrer-policy': 'strict-origin-when-cross-origin',
          'cross-origin-opener-policy': 'same-origin-allow-popups',
          'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          'x-frame-options': 'DENY',
          'x-content-type-options': 'nosniff',
        },
        kind: 'route-document',
        path: '/index.html',
        status: 200,
      },
      {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'cross-origin-resource-policy': 'same-origin',
          'content-type': 'text/javascript; charset=utf-8',
        },
        href: cartHref,
        kind: 'client-module',
        path: cartHref,
        status: 200,
      },
      runtimeClientModuleFile,
      {
        headers: { 'content-type': 'text/css; charset=utf-8' },
        kind: 'static-asset',
        path: '/assets/app.css',
        source: '/workspace/dist/assets/app.css',
        status: 200,
      },
    ]);
  });

  it('plans dry-run and write export targets through the same output planner', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-plan-'));
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'kovo-static-export-plan-assets-'));
    try {
      const registry = createMemoryVersionedClientModuleRegistry();
      const cartHref = registry.put({
        path: '/c/cart.client.js',
        source: 'export const cart = "output-plan";',
        version: 'cart-output-plan',
      });
      const cssSource = path.join(sourceDir, 'app.css');
      await writeFile(cssSource, 'main { display: block; }\n', 'utf8');
      const assets = [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/app.css',
          source: cssSource,
        },
      ];
      const app = createApp({
        routes: [
          route('/', {
            modulepreloads: [cartHref],
            page: () => trustedHtml('<main>Home</main>'),
          }),
        ],
      });
      app.clientModules = registry;

      const dryRun = await exportStaticApp(app, { assets });
      const dryRunPlan = staticExportOutputPlan(dryRun, { outDir: pathToFileURL(outDir) });
      const writeResult = await exportStaticApp(app, { assets, outDir });
      const writePlan = staticExportOutputPlan(writeResult, { outDir });

      expect(dryRunPlan).toEqual([
        {
          kind: 'route-document',
          path: '/index.html',
          targetPath: path.join(outDir, 'index.html'),
        },
        {
          kind: 'client-module',
          path: cartHref,
          targetPath: path.join(outDir, cartHref.replace(/^\//, '')),
        },
        {
          kind: 'client-module',
          path: expect.stringMatching(runtimeClientModulePath),
          targetPath: expect.stringMatching(
            new RegExp(
              `${outDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\]c[/\\\\]__v[/\\\\][^/\\\\]+[/\\\\]kovo-runtime\\.client\\.js$`,
            ),
          ),
        },
        {
          kind: 'static-asset',
          path: '/assets/app.css',
          targetPath: path.join(outDir, 'assets', 'app.css'),
        },
      ]);
      expect(writePlan).toEqual(dryRunPlan);
      await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toBe(
        writeResult.artifacts[0]?.body,
      );
      await expect(readFile(path.join(outDir, cartHref.replace(/^\//, '')), 'utf8')).resolves.toBe(
        'export const cart = "output-plan";',
      );
      const runtimePath = writeResult.clientModules.find((artifact) =>
        runtimeClientModulePath.test(artifact.path),
      )?.path;
      expect(runtimePath).toBeTruthy();
      await expect(
        readFile(path.join(outDir, runtimePath!.replace(/^\//, '')), 'utf8'),
      ).resolves.toContain('installKovoDeferredRuntime');
      await expect(readFile(path.join(outDir, 'assets', 'app.css'), 'utf8')).resolves.toBe(
        'main { display: block; }\n',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
      await rm(sourceDir, { force: true, recursive: true });
    }
  });

  it('builds a stable public static export manifest from directory-index output', async () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const cartHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "manifest";',
      version: 'cart-manifest',
    });
    const app = createApp({
      routes: [
        route('/', {
          modulepreloads: [cartHref],
          page: () => trustedHtml('<main>Home</main>'),
        }),
        route('/docs/intro', {
          stylesheets: ['/assets/docs.css'],
          page: () => trustedHtml('<main>Intro</main>'),
        }),
      ],
    });
    app.clientModules = registry;

    const result = await exportStaticApp(app, {
      assets: [
        {
          contentType: 'text/css; charset=utf-8',
          path: '/assets/docs.css',
          source: '/workspace/dist/assets/docs.css',
        },
      ],
    });

    const manifest = staticExportManifest(result);

    expect(manifest).toEqual({
      assets: [
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          path: '/assets/docs.css',
          source: '/workspace/dist/assets/docs.css',
          status: 200,
        },
      ],
      clientModules: [
        {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: cartHref,
          path: cartHref,
          status: 200,
        },
        runtimeClientModuleArtifact,
      ],
      files: [
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-r+dYbT4MW7b2daKYtHumwNfjFE4Vx7KzXxym5gJRNjI='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: `<${cartHref}>; rel=modulepreload`,
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          kind: 'route-document',
          path: '/index.html',
          status: 200,
        },
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-r+dYbT4MW7b2daKYtHumwNfjFE4Vx7KzXxym5gJRNjI='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/docs.css>; rel=preload; as=style',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          kind: 'route-document',
          path: '/docs/intro/index.html',
          status: 200,
        },
        {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
            'cross-origin-resource-policy': 'same-origin',
            'content-type': 'text/javascript; charset=utf-8',
          },
          href: cartHref,
          kind: 'client-module',
          path: cartHref,
          status: 200,
        },
        runtimeClientModuleFile,
        {
          headers: { 'content-type': 'text/css; charset=utf-8' },
          kind: 'static-asset',
          path: '/assets/docs.css',
          source: '/workspace/dist/assets/docs.css',
          status: 200,
        },
      ],
      routeDocuments: [
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-r+dYbT4MW7b2daKYtHumwNfjFE4Vx7KzXxym5gJRNjI='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: `<${cartHref}>; rel=modulepreload`,
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          path: '/index.html',
          status: 200,
        },
        {
          headers: {
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'sha256-r+dYbT4MW7b2daKYtHumwNfjFE4Vx7KzXxym5gJRNjI='; style-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types kovo",
            'content-type': 'text/html; charset=utf-8',
            link: '</assets/docs.css>; rel=preload; as=style',
            'referrer-policy': 'strict-origin-when-cross-origin',
            'cross-origin-opener-policy': 'same-origin-allow-popups',
            'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
          },
          path: '/docs/intro/index.html',
          status: 200,
        },
      ],
    });
    expect(() => assertStaticExportManifestMatchesResult(result, manifest)).not.toThrow();
    expect(() =>
      assertStaticExportManifestMatchesResult(result, {
        ...manifest,
        routeDocuments: manifest.routeDocuments.slice(1),
      }),
    ).toThrow(
      'Static export manifest does not match the written export result. Expected routeDocuments=2, clientModules=2, assets=1, files=5. Received routeDocuments=1, clientModules=2, assets=1, files=5.',
    );
  });

  it('formats static export diagnostics for starter and example export tasks', () => {
    const diagnostic = {
      code: 'KV229' as const,
      message: "KV229 static export cannot export guarded route '/admin'.\nServe dynamically.",
      routePath: '/admin',
    };
    const error = new StaticExportError([diagnostic]);

    expect(isStaticExportDiagnostic(diagnostic)).toBe(true);
    expect(isStaticExportDiagnostic({ ...diagnostic, message: 42 })).toBe(false);
    expect(isStaticExportDiagnosticError(error)).toBe(true);
    expect(isStaticExportDiagnosticError(new Error('plain'))).toBe(false);
    expect(formatStaticExportDiagnostic(diagnostic, 'ERROR')).toBe(
      "ERROR KV229 route=/admin KV229 static export cannot export guarded route '/admin'. Serve dynamically.",
    );
    expect(formatStaticExportDiagnostics([diagnostic], 'WARN')).toEqual([
      "WARN KV229 route=/admin KV229 static export cannot export guarded route '/admin'. Serve dynamically.",
    ]);
  });
});
