import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as server from '@jiso/server';
import { describe, expect, it } from 'vitest';

import { createSiteDistApp } from './app-shell.mjs';

describe('site app-shell export adoption', () => {
  it('replays generated docs HTML through static export and copies versioned /c/ modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-'));
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');
    const outDir = path.join(root, 'dist-out');

    await mkdir(path.join(distDir, 'docs', 'installation'), { recursive: true });
    await mkdir(path.join(publicDir, 'c'), { recursive: true });
    await writeFile(
      path.join(distDir, 'index.html'),
      [
        '<!doctype html><html><body>',
        '<button on:click="/c/search.js#open">Search</button>',
        '<pre><code>&#x3C;button on:click="/c/example-only.js#copy">Copy&#x3C;/button></code></pre>',
        '</body></html>',
      ].join(''),
    );
    await writeFile(
      path.join(distDir, 'docs', 'installation', 'index.html'),
      '<!doctype html><html><body><h1>Installation</h1></body></html>',
    );
    await writeFile(
      path.join(publicDir, 'c', 'search.js'),
      'export function open() { document.body.dataset.search = "open"; }\n',
    );

    const app = await createSiteDistApp({ distDir, publicDir, server });
    const result = await server.exportStaticApp(app, { outDir });

    const exportedIndex = await readFile(path.join(outDir, 'index.html'), 'utf8');
    const exportedModule = await readFile(path.join(outDir, 'c', 'search.js'), 'utf8');

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      '/docs/installation.html',
      '/index.html',
    ]);
    expect(exportedIndex).toContain('<!doctype html>');
    expect(exportedIndex).not.toContain('<!doctype html><html lang=');
    expect(exportedIndex).toContain('/c/search.js?v=site-r7-');
    expect(exportedIndex).toContain('on:click="&#47;c/example-only.js#copy"');
    expect(result.clientModules).toHaveLength(1);
    expect(exportedModule).toBe(
      'export function open() { document.body.dataset.search = "open"; }\n',
    );
  });
});
