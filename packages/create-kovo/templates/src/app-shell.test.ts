import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertStaticExportManifestUsesDirectoryIndexDocuments,
  exportStaticApp,
  staticExportManifest,
} from '@kovojs/server/app-shell/static-export';
import { isKovoApp } from '@kovojs/server/app-shell/core';
import { createServer as createViteServer } from 'vite';
import { describe, expect, it } from 'vitest';

import app, { starterClientModuleHref, starterRequestHandler } from './app-shell.js';

const legacyCssTool = ['tail', 'windcss'].join('');
const templateRoot = fileURLToPath(new URL('..', import.meta.url));

describe('starter app shell', () => {
  it('exports a closed app aggregate for dynamic export tasks', () => {
    expect(isKovoApp(app)).toBe(true);
    expect(
      isKovoApp({
        ...app,
        clientModules: {
          resolve: () => ({ body: 'Not Found', headers: {}, status: 404 }),
        },
      }),
    ).toBe(false);
  });

  it('serves the home route and versioned client module through the request shell', async () => {
    // SPEC.md section 9.5 keeps route dispatch, document assembly, and /c/ modules
    // on the same app-shell request handler.
    const response = await starterRequestHandler(new Request('https://starter.test/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const documentBody = await response.text();
    expect(documentBody).toContain(`on:click="${starterClientModuleHref}#Starter$announce"`);
    expect(documentBody).toContain('data-session="guest"');
    expect(documentBody).toContain('Starter cart count: 0');

    const moduleResponse = await starterRequestHandler(
      new Request(`https://starter.test${starterClientModuleHref}`),
    );

    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toContain('export function Starter$announce');
  });

  it('exports the starter route by replaying the same request handler', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kovo-starter-export-'));

    try {
      const result = await exportStaticApp(app, { outDir });

      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/index.html']);
      expect(staticExportManifest(result).routeDocuments.map((artifact) => artifact.path)).toEqual([
        '/index.html',
      ]);
      expect(() =>
        assertStaticExportManifestUsesDirectoryIndexDocuments(staticExportManifest(result)),
      ).not.toThrow();
      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        starterClientModuleHref,
      ]);
      await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toContain(
        'Hello from Kovo',
      );
      await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toContain(
        'data-session="guest"',
      );
      await expect(readFile(join(outDir, 'c/starter.client.js'), 'utf8')).resolves.toContain(
        'Starter$announce',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it('serves app-shell documents and /c/ modules through the Vite dev middleware', async () => {
    const vite = await createViteServer({
      appType: 'custom',
      logLevel: 'error',
      root: templateRoot,
      server: { middlewareMode: true },
    });
    let devServerError: unknown;
    vite.middlewares.use(
      (
        error: unknown,
        _request: IncomingMessage,
        _response: ServerResponse,
        next: (error?: unknown) => void,
      ) => {
        devServerError = error;
        next(error);
      },
    );
    const httpServer = createHttpServer(vite.middlewares);

    try {
      const appShellModule = await vite.ssrLoadModule('/src/app-shell.ts');
      expect(appShellModule).toMatchObject({
        default: expect.objectContaining({ routes: [expect.objectContaining({ path: '/' })] }),
        starterRequestHandler: expect.any(Function),
      });
      expect(appShellModule).not.toHaveProperty('starterNodeHandler');

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', reject);
          resolve();
        });
      });

      const address = httpServer.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      const documentResponse = await fetch(`${origin}/`);
      const documentBody = await documentResponse.text();

      expect(documentResponse.status, formatDevServerFailure(documentBody, devServerError)).toBe(
        200,
      );
      expect(documentResponse.headers.get('content-type')).toContain('text/html');
      expect(documentBody).toContain(`on:click="${starterClientModuleHref}#Starter$announce"`);

      const moduleResponse = await fetch(`${origin}${starterClientModuleHref}`);
      const moduleBody = await moduleResponse.text();

      expect(moduleResponse.status, formatDevServerFailure(moduleBody, devServerError)).toBe(200);
      expect(moduleBody).toContain('export function Starter$announce');

      const headDocumentResponse = await fetch(`${origin}/`, { method: 'HEAD' });
      const headDocumentBody = await headDocumentResponse.text();

      expect(
        headDocumentResponse.status,
        formatDevServerFailure(headDocumentBody, devServerError),
      ).toBe(200);
      expect(headDocumentResponse.headers.get('content-type')).toContain('text/html');
      expect(headDocumentBody).toBe('');

      const headModuleResponse = await fetch(`${origin}${starterClientModuleHref}`, {
        method: 'HEAD',
      });
      const headModuleBody = await headModuleResponse.text();

      expect(
        headModuleResponse.status,
        formatDevServerFailure(headModuleBody, devServerError),
      ).toBe(200);
      expect(headModuleResponse.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(headModuleBody).toBe('');

      const sourceAssetResponse = await fetch(`${origin}/src/styles.css`);
      const sourceAssetBody = await sourceAssetResponse.text();

      expect(
        sourceAssetResponse.status,
        formatDevServerFailure(sourceAssetBody, devServerError),
      ).toBe(200);
      expect(sourceAssetBody).toContain('@layer kovo-starter-base');
      expect(sourceAssetBody).not.toContain(legacyCssTool);
    } finally {
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await vite.close();
    }
  });
});

function formatDevServerFailure(body: string, error: unknown): string {
  if (error instanceof Error) {
    return `${error.stack ?? error.message}\n\n${body}`;
  }

  return body;
}
