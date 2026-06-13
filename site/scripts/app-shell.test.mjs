import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as server from '@jiso/server';
import { describe, expect, it } from 'vitest';

import { createSiteDistApp } from './app-shell.mjs';
import { exportSiteStaticApp } from './export-static.mjs';

const execFileAsync = promisify(execFile);
const siteRoot = fileURLToPath(new URL('../', import.meta.url));

describe('site app-shell export adoption', () => {
  it('serves generated docs HTML through the app shell before static export copies modules', async () => {
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
        '<button on:click="/c/theme.js#toggle">Theme</button>',
        '<button class="code-copy" on:click="/c/code.js#copy">Copy</button>',
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
    await writeFile(
      path.join(publicDir, 'c', 'theme.js'),
      'export function toggle() { document.documentElement.dataset.theme = "dark"; }\n',
    );
    await writeFile(
      path.join(publicDir, 'c', 'code.js'),
      'export function copy() { document.body.dataset.copied = ""; }\n',
    );

    const app = await createSiteDistApp({ distDir, publicDir, server });
    const handler = server.createRequestHandler(app);
    const shellResponse = await handler(new Request('https://jiso.test/'));
    const shellHtml = await shellResponse.text();
    const searchModuleHref = shellHtml.match(/\/c\/search\.js\?v=site-r7-[a-f0-9]+/)?.[0];
    const themeModuleHref = shellHtml.match(/\/c\/theme\.js\?v=site-r7-[a-f0-9]+/)?.[0];
    const codeModuleHref = shellHtml.match(/\/c\/code\.js\?v=site-r7-[a-f0-9]+/)?.[0];

    expect(shellResponse.status).toBe(200);
    expect(shellHtml).not.toContain('<!doctype html><html lang=');
    expect(searchModuleHref).toBeTruthy();
    expect(themeModuleHref).toBeTruthy();
    expect(codeModuleHref).toBeTruthy();
    expect(shellHtml).toContain('on:click="&#47;c/example-only.js#copy"');
    await expect(
      handler(new Request(`https://jiso.test${searchModuleHref}`)).then((response) =>
        response.text(),
      ),
    ).resolves.toBe('export function open() { document.body.dataset.search = "open"; }\n');

    const result = await server.exportStaticApp(app, { outDir });

    const exportedIndex = await readFile(path.join(outDir, 'index.html'), 'utf8');
    const exportedInstallation = await readFile(
      path.join(outDir, 'docs', 'installation', 'index.html'),
      'utf8',
    );
    const exportedModule = await readFile(path.join(outDir, 'c', 'search.js'), 'utf8');
    const exportedThemeModule = await readFile(path.join(outDir, 'c', 'theme.js'), 'utf8');
    const exportedCodeModule = await readFile(path.join(outDir, 'c', 'code.js'), 'utf8');

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      '/docs/installation/index.html',
      '/index.html',
    ]);
    expect(exportedIndex).toContain('<!doctype html>');
    expect(exportedIndex).not.toContain('<!doctype html><html lang=');
    expect(exportedIndex).toContain('/c/search.js?v=site-r7-');
    expect(exportedIndex).toContain('/c/theme.js?v=site-r7-');
    expect(exportedIndex).toContain('/c/code.js?v=site-r7-');
    expect(exportedIndex).toContain('on:click="&#47;c/example-only.js#copy"');
    expect(exportedInstallation).toContain('<h1>Installation</h1>');
    expect(result.clientModules.map((artifact) => artifact.path)).toEqual([
      '/c/code.js',
      '/c/search.js',
      '/c/theme.js',
    ]);
    expect(exportedModule).toBe(
      'export function open() { document.body.dataset.search = "open"; }\n',
    );
    expect(exportedThemeModule).toBe(
      'export function toggle() { document.documentElement.dataset.theme = "dark"; }\n',
    );
    expect(exportedCodeModule).toBe(
      'export function copy() { document.body.dataset.copied = ""; }\n',
    );
  });

  it('loads the docs app shell and server package through Vite SSR for export', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-source-'));
    const cssDistDir = path.join(root, 'dist-css');
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');
    const outDir = path.join(root, 'dist-out');
    const loadedModuleIds = [];
    const stylesheetManifestFiles = [];
    const exportScript = await readFile(path.join(siteRoot, 'scripts/export-static.mjs'), 'utf8');

    await mkdir(path.join(cssDistDir, '.vite'), { recursive: true });
    await mkdir(path.join(cssDistDir, 'assets'), { recursive: true });
    await mkdir(path.join(distDir, 'docs', 'installation'), { recursive: true });
    await mkdir(path.join(publicDir, 'c'), { recursive: true });
    await writeFile(
      path.join(cssDistDir, '.vite', 'manifest.json'),
      JSON.stringify({
        'src/styles.css': {
          file: 'assets/site.css',
          isEntry: true,
          src: 'src/styles.css',
        },
      }),
    );
    await writeFile(path.join(cssDistDir, 'assets', 'site.css'), '.docs{color:rebeccapurple}\n');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><button on:click="/c/search.js#open">Search</button></body></html>',
    );
    await writeFile(
      path.join(distDir, 'docs', 'installation', 'index.html'),
      '<!doctype html><html><body><h1>Installation</h1></body></html>',
    );
    await writeFile(
      path.join(publicDir, 'c', 'search.js'),
      'export function open() { document.body.dataset.search = "open"; }\n',
    );

    const result = await exportSiteStaticApp({
      cssDistDir,
      createViteServer: async () => ({
        async close() {},
        async ssrLoadModule(id) {
          loadedModuleIds.push(id);
          if (id === '@jiso/server') {
            return {
              ...server,
              async jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile, options) {
                stylesheetManifestFiles.push(manifestFile);
                return await server.jisoAppShellViteManifestStylesheetHrefFromFile(
                  manifestFile,
                  options,
                );
              },
              async jisoAppShellViteManifestStylesheetHrefsFromFile() {
                throw new Error('docs export must use the server-owned singular stylesheet helper');
              },
            };
          }
          if (id === '/scripts/app-shell.mjs') return { createSiteDistApp };
          throw new Error(`unexpected SSR module ${id}`);
        },
      }),
      distDir,
      outDir,
      publicDir,
    });

    expect(exportScript).toContain('formatStaticExportDiagnostics');
    expect(exportScript).toContain('isStaticExportDiagnosticError');
    expect(exportScript).toContain('jisoAppShellViteManifestStylesheetHrefFromFile');
    expect(exportScript).not.toContain('function formatStaticExportDiagnostic');
    expect(exportScript).not.toContain('function isStaticExportDiagnostic');
    expect(exportScript).not.toContain('jisoAppShellViteManifestStylesheetHrefsFromFile');
    expect(loadedModuleIds).toEqual(['/scripts/app-shell.mjs', '@jiso/server']);
    expect(stylesheetManifestFiles).toEqual([path.join(cssDistDir, '.vite/manifest.json')]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      '/docs/installation/index.html',
      '/index.html',
    ]);
    expect(result.assets.map((artifact) => artifact.path)).toEqual(['/assets/site.css']);
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '/c/search.js?v=site-r7-',
    );
    await expect(readFile(path.join(outDir, 'assets', 'site.css'), 'utf8')).resolves.toBe(
      '.docs{color:rebeccapurple}\n',
    );
  });

  it('runs the docs site export command against the shell-backed static output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-command-'));
    const cssDistDir = path.join(root, 'dist-css');
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');
    const outDir = path.join(root, 'dist-out');

    await mkdir(path.join(cssDistDir, '.vite'), { recursive: true });
    await mkdir(path.join(cssDistDir, 'assets'), { recursive: true });
    await mkdir(path.join(distDir, 'docs', 'installation'), { recursive: true });
    await mkdir(path.join(publicDir, 'c'), { recursive: true });
    await writeFile(
      path.join(cssDistDir, '.vite', 'manifest.json'),
      JSON.stringify({
        'src/styles.css': {
          file: 'assets/site.css',
          isEntry: true,
          src: 'src/styles.css',
        },
      }),
    );
    await writeFile(path.join(cssDistDir, 'assets', 'site.css'), '.docs{color:seagreen}\n');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/assets/site.css"></head><body><button on:click="/c/search.js#open">Search</button></body></html>',
    );
    await writeFile(
      path.join(distDir, 'docs', 'installation', 'index.html'),
      '<!doctype html><html><body><h1>Installation</h1></body></html>',
    );
    await writeFile(
      path.join(publicDir, 'c', 'search.js'),
      'export function open() { document.body.dataset.search = "open"; }\n',
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        'scripts/export-static.mjs',
        '--skip-build',
        '--css-dist-dir',
        cssDistDir,
        '--dist-dir',
        distDir,
        '--public-dir',
        publicDir,
        '--out',
        outDir,
      ],
      { cwd: siteRoot },
    );

    expect(stdout).toBe('site-export/v1\nhtml=2\nclient-modules=1\nassets=1\ndiagnostics=0\n');
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '/assets/site.css',
    );
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '/c/search.js?v=site-r7-',
    );
    await expect(
      readFile(path.join(outDir, 'docs', 'installation', 'index.html'), 'utf8'),
    ).resolves.toContain('<h1>Installation</h1>');
    await expect(readFile(path.join(outDir, 'c', 'search.js'), 'utf8')).resolves.toBe(
      'export function open() { document.body.dataset.search = "open"; }\n',
    );
    await expect(readFile(path.join(outDir, 'assets', 'site.css'), 'utf8')).resolves.toBe(
      '.docs{color:seagreen}\n',
    );
  });
});
