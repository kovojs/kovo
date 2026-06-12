import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportStaticApp } from '@jiso/server';
import { describe, expect, it } from 'vitest';

import app, { starterClientModuleHref, starterRequestHandler } from './app-shell.js';

describe('starter app shell', () => {
  it('serves the home route and versioned client module through the request shell', async () => {
    // SPEC.md section 9.5 keeps route dispatch, document assembly, and /c/ modules
    // on the same app-shell request handler.
    const response = await starterRequestHandler(new Request('https://starter.test/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain(
      `on:click="${starterClientModuleHref}#Starter$announce"`,
    );

    const moduleResponse = await starterRequestHandler(
      new Request(`https://starter.test${starterClientModuleHref}`),
    );

    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toContain('export function Starter$announce');
  });

  it('exports the starter route by replaying the same request handler', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'jiso-starter-export-'));

    try {
      const result = await exportStaticApp(app, { outDir });

      expect(result.diagnostics).toEqual([]);
      expect(result.artifacts.map((artifact) => artifact.path)).toEqual(['/index.html']);
      expect(result.clientModules.map((artifact) => artifact.href)).toEqual([
        starterClientModuleHref,
      ]);
      await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toContain(
        'Hello from Jiso',
      );
      await expect(readFile(join(outDir, 'c/starter.client.js'), 'utf8')).resolves.toContain(
        'Starter$announce',
      );
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
