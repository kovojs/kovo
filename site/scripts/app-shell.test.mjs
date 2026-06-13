import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as serverAppShellClientModules from '@jiso/server/app-shell/client-modules';
import * as serverAppShellCore from '@jiso/server/app-shell/core';
import * as serverAppShellStaticExport from '@jiso/server/app-shell/static-export';
import * as serverAppShellVite from '@jiso/server/app-shell/vite';
import { describe, expect, it } from 'vitest';

import { createSiteDistApp, siteDocumentRouteEntries } from './app-shell.mjs';
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
    await mkdir(path.join(distDir, 'stale'), { recursive: true });
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
      path.join(distDir, 'stale', 'index.html'),
      '<!doctype html><html><body><h1>Stale</h1></body></html>',
    );
    await writeFile(
      path.join(distDir, '.jiso-site-routes.json'),
      `${JSON.stringify({ routes: ['/docs/installation/', '/'] })}\n`,
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

    const serverApi = { ...serverAppShellClientModules, ...serverAppShellCore };
    expect(siteDocumentRouteEntries(distDir).map((entry) => entry.routePath)).toEqual([
      '/docs/installation',
      '/',
    ]);
    const app = await createSiteDistApp({ distDir, publicDir, server: serverApi });
    const handler = serverApi.createRequestHandler(app);
    const shellResponse = await handler(new Request('https://jiso.test/'));
    const shellHtml = await shellResponse.text();
    const searchModuleHref = shellHtml.match(/\/c\/search\.js\?v=site-r7-[a-f0-9]+/)?.[0];
    const themeModuleHref = shellHtml.match(/\/c\/theme\.js\?v=site-r7-[a-f0-9]+/)?.[0];
    const codeModuleHref = shellHtml.match(/\/c\/code\.js\?v=site-r7-[a-f0-9]+/)?.[0];

    expect(shellResponse.status).toBe(200);
    await expect(handler(new Request('https://jiso.test/stale'))).resolves.toMatchObject({
      status: 404,
    });
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

    const result = await serverAppShellStaticExport.exportStaticApp(app, { outDir });

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

  it('exports docs HTML when the public client module directory is absent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-no-client-modules-'));
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');
    const outDir = path.join(root, 'dist-out');

    await mkdir(path.join(distDir, 'docs', 'installation'), { recursive: true });
    await writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><h1>Home</h1></body></html>',
    );
    await writeFile(
      path.join(distDir, 'docs', 'installation', 'index.html'),
      '<!doctype html><html><body><h1>Installation</h1></body></html>',
    );
    await writeFile(
      path.join(distDir, '.jiso-site-routes.json'),
      `${JSON.stringify({ routes: ['/', '/docs/installation'] })}\n`,
    );

    const serverApi = { ...serverAppShellClientModules, ...serverAppShellCore };
    const app = await createSiteDistApp({ distDir, publicDir, server: serverApi });
    const result = await serverAppShellStaticExport.exportStaticApp(app, { outDir });

    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      '/index.html',
      '/docs/installation/index.html',
    ]);
    expect(result.clientModules).toEqual([]);
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '<h1>Home</h1>',
    );
    await expect(
      readFile(path.join(outDir, 'docs', 'installation', 'index.html'), 'utf8'),
    ).resolves.toContain('<h1>Installation</h1>');
  });

  it('rejects incomplete server APIs before docs routes bind to the app-shell boundary', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-server-api-'));
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');

    await mkdir(distDir, { recursive: true });
    await writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><h1>Home</h1></body></html>',
    );

    await expect(
      createSiteDistApp({
        distDir,
        publicDir,
        server: {
          createApp: serverAppShellCore.createApp,
          route: serverAppShellCore.route,
        },
      }),
    ).rejects.toThrow(
      'site app shell: server API must provide focused @jiso/server app-shell authoring exports. Missing exports: createMemoryVersionedClientModuleRegistry, respond. SPEC §9.5 docs export must replay through createApp(), route(), respond(), and the client-module registry.',
    );
  });

  it('loads the docs app shell and server package through Vite SSR for export', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-source-'));
    const cssDistDir = path.join(root, 'dist-css');
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');
    const outDir = path.join(root, 'dist-out');
    const loadedModuleIds = [];
    const combinedExportManifestFiles = [];
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
      path.join(distDir, '.jiso-site-routes.json'),
      `${JSON.stringify({ routes: ['/docs/installation/', '/'] })}\n`,
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
          if (id === '@jiso/server/app-shell/client-modules') {
            return serverAppShellClientModules;
          }
          if (id === '@jiso/server/app-shell/core') {
            return serverAppShellCore;
          }
          if (id === '@jiso/server/app-shell/static-export') {
            return serverAppShellStaticExport;
          }
          if (id === '@jiso/server/app-shell/vite') {
            return {
              ...serverAppShellVite,
              async jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile, options) {
                stylesheetManifestFiles.push(manifestFile);
                return await serverAppShellVite.jisoAppShellViteManifestStylesheetHrefFromFile(
                  manifestFile,
                  options,
                );
              },
              async exportJisoAppShellViteBuildWithManifestFromManifestFile(options) {
                combinedExportManifestFiles.push(options.manifestFile);
                return await serverAppShellVite.exportJisoAppShellViteBuildWithManifestFromManifestFile(
                  options,
                );
              },
            };
          }
          if (id === '@jiso/server/app-shell') {
            throw new Error('docs export must load focused app-shell subpaths');
          }
          if (id === '@jiso/server') {
            throw new Error('docs export must not load the root server package');
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
    expect(exportScript).toContain('exportJisoAppShellViteBuildWithManifestFromManifestFile');
    expect(exportScript).toContain('jisoAppShellViteManifestStylesheetHrefFromFile');
    expect(exportScript).not.toContain('assertStaticExportManifestMatchesResult');
    expect(exportScript).not.toContain(
      'staticExportManifestForJisoAppShellViteBuildFromManifestFile',
    );
    expect(exportScript).not.toContain('function formatStaticExportDiagnostic');
    expect(exportScript).not.toContain('function isStaticExportDiagnostic');
    expect(exportScript).not.toContain('jisoAppShellViteManifestStylesheetHrefsFromFile');
    await expect(
      readFile(path.join(siteRoot, 'scripts/app-shell.mjs'), 'utf8'),
    ).resolves.not.toContain('api/app-shell/index.mjs');
    expect(loadedModuleIds).toEqual([
      '/scripts/app-shell.mjs',
      '@jiso/server/app-shell/client-modules',
      '@jiso/server/app-shell/core',
      '@jiso/server/app-shell/static-export',
      '@jiso/server/app-shell/vite',
    ]);
    expect(stylesheetManifestFiles).toEqual([path.join(cssDistDir, '.vite/manifest.json')]);
    expect(combinedExportManifestFiles).toEqual([path.join(cssDistDir, '.vite/manifest.json')]);
    expect(result.artifacts.map((artifact) => artifact.path)).toEqual([
      '/docs/installation/index.html',
      '/index.html',
    ]);
    expect(result.manifest.routeDocuments.map((artifact) => artifact.path)).toEqual([
      '/docs/installation/index.html',
      '/index.html',
    ]);
    expect(result.assets.map((artifact) => artifact.path)).toEqual(['/assets/site.css']);
    expect(result.manifest.assets.map((artifact) => artifact.path)).toEqual(['/assets/site.css']);
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
      path.join(distDir, '.jiso-site-routes.json'),
      `${JSON.stringify({ routes: ['/docs/installation/', '/'] })}\n`,
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
        '--skip-gallery',
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

    expect(stdout).toBe(
      [
        'site-export/v1',
        'html=2',
        'client-modules=1',
        'assets=1',
        'manifest-html=2',
        'manifest-client-modules=1',
        'manifest-assets=1',
        'diagnostics=0',
        '',
      ].join('\n'),
    );
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '/assets/site.css',
    );
    await expect(readFile(path.join(outDir, 'index.html'), 'utf8')).resolves.toContain(
      '/c/search.js?v=site-r7-',
    );
    await expect(
      readFile(path.join(outDir, 'docs', 'installation', 'index.html'), 'utf8'),
    ).resolves.toContain('<h1>Installation</h1>');
    await expect(access(path.join(outDir, 'docs', 'installation.html'))).rejects.toThrow();
    await expect(readFile(path.join(outDir, 'c', 'search.js'), 'utf8')).resolves.toBe(
      'export function open() { document.body.dataset.search = "open"; }\n',
    );
    await expect(readFile(path.join(outDir, 'assets', 'site.css'), 'utf8')).resolves.toBe(
      '.docs{color:seagreen}\n',
    );
  });

  it('fails docs route-manifest mistakes before app-shell export replay', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jiso-site-export-manifest-'));
    const distDir = path.join(root, 'dist-source');
    const publicDir = path.join(root, 'public');

    await mkdir(distDir, { recursive: true });
    await mkdir(path.join(publicDir, 'c'), { recursive: true });
    await writeFile(
      path.join(distDir, '.jiso-site-routes.json'),
      `${JSON.stringify({ routes: ['/', '/missing'] })}\n`,
    );
    await writeFile(
      path.join(distDir, 'index.html'),
      '<!doctype html><html><body><h1>Home</h1></body></html>',
    );

    expect(() => siteDocumentRouteEntries(distDir)).toThrow(
      ".jiso-site-routes.json declares '/missing'",
    );
    await expect(
      createSiteDistApp({
        distDir,
        publicDir,
        server: { ...serverAppShellClientModules, ...serverAppShellCore },
      }),
    ).rejects.toThrow(".jiso-site-routes.json declares '/missing'");
  });
});
