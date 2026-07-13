import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';
import { runExportCommandStructured } from './commands/build-export.js';

const repoRoot = process.cwd();

function symlinkServerPackage(root: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
  symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
}

function appModuleSource(options: {
  readonly closed?: boolean;
  readonly exportKind?: 'default' | 'named';
  readonly prelude?: readonly string[];
  readonly route: string;
}): string {
  const closed = options.closed !== false;
  const exportPrefix = options.exportKind === 'named' ? 'export const app = ' : 'export default ';

  return [
    ...(closed ? ["import { createApp } from '@kovojs/server';"] : []),
    "import { trustedHtml } from '@kovojs/browser';",
    ...(options.prelude ?? []),
    ...(closed
      ? []
      : [
          'const modules = new Map();',
          'const versionedHref = (module) => `/c/__v/${encodeURIComponent(module.version)}/${module.path.slice("/c/".length)}`;',
        ]),
    `${exportPrefix}${closed ? 'createApp({' : '{'}`,
    ...(closed
      ? []
      : [
          '  clientModules: {',
          "    buildToken() { return 'test'; },",
          '    entries() { return [...modules.values()]; },',
          '    put(module) { const href = versionedHref(module); modules.set(new URL(href, "https://kovo.local").pathname, module); return href; },',
          '    resolve(href) {',
          '      const module = modules.get(new URL(href ?? "", "https://kovo.local").pathname);',
          "      return module ? { body: module.source, headers: { 'Content-Type': module.contentType ?? 'text/javascript; charset=utf-8' }, status: 200 } : { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 };",
          '    },',
          '  },',
        ]),
    '  diagnostics: [],',
    '  document: {},',
    '  endpoints: [],',
    '  errorShells: {},',
    '  liveTargetRenderers: [],',
    '  mutations: [],',
    '  mutationResponses: {},',
    '  queries: [],',
    `  routes: [${options.route}],`,
    '  stylesheets: [],',
    closed ? '});' : '};',
    '',
  ].join('\n');
}

describe('kovo export', () => {
  it('loads an app module and writes static HTML artifacts through the server exporter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml('<main data-export-cli>CLI export</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      expect(output).toContain(
        `SUMMARY html=1 clientModules=1 assets=0 diagnostics=0 outDir=${JSON.stringify(outDir)}\n`,
      );
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-export-cli>CLI export</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns structured export artifacts before CLI text formatting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml('<main data-export-structured>Structured export</main>') }",
        }),
        'utf8',
      );

      const result = await runExportCommandStructured({
        appModulePath: appPath,
        outDir,
      });

      expect('error' in result).toBe(false);
      if ('error' in result) return;
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('SUMMARY html=1 clientModules=1 assets=0 diagnostics=0');
      expect(result.staticExport.artifacts).toHaveLength(1);
      expect(result.staticExport.artifacts[0]).toMatchObject({
        path: '/index.html',
        status: 200,
      });
      expect(result.staticExport.clientModules).toHaveLength(1);
      expect(result.staticExport.assets).toHaveLength(0);
      expect(result.staticExport.diagnostics).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('loads TypeScript app entries through Vite without an explicit --vite flag', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml('<main data-export-tsx>TSX export</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-export-tsx>TSX export</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exports Vite-loaded TSX component queries with the same server runtime instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        [
          '/** @jsxImportSource @kovojs/server */',
          "import { component } from '@kovojs/core';",
          "import { createApp, publicAccess, query, route } from '@kovojs/server';",
          '',
          "const greetingQuery = query('greeting', {",
          "  access: publicAccess('static export component query'),",
          "  load: () => ({ message: 'Hello from query' }),",
          '});',
          '',
          'const Greeting = component({',
          '  queries: { greeting: greetingQuery },',
          '  render({ greeting }) {',
          '    return <main data-component-query>{greeting.message}</main>;',
          '  },',
          '});',
          '',
          'export default createApp({',
          '  queries: [greetingQuery],',
          '  routes: [',
          '    route("/", {',
          "      access: publicAccess('static export route'),",
          '      page: () => <Greeting />,',
          '    }),',
          '  ],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      expect(html).toContain('<main data-component-query>Hello from query</main>');
      expect(html).not.toContain('Server Error');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exports nested routes as directory-index HTML by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/docs/intro', page: () => trustedHtml('<main data-pretty-export>Intro</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('HTML /docs/intro/index.html status=200 bytes=');
      expect(readFileSync(join(outDir, 'docs', 'intro', 'index.html'), 'utf8')).toContain(
        '<main data-pretty-export>Intro</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints KV229 diagnostics for non-exportable app modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          closed: false,
          exportKind: 'named',
          route: "{ path: '/products/:id', page: () => trustedHtml('<main>Product</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', join(root, 'dist')])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nERROR KV229 route=app');
      expect(output).toContain('requires a closed Kovo app aggregate');
      expect(output).toContain('SPEC §9.5 export replay must start from createApp()');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints compile diagnostics exported by app modules before writing static output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          exportKind: 'named',
          prelude: [
            'export const diagnostics = [{',
            "  code: 'KV201',",
            "  fileName: 'src/cart.tsx',",
            "  message: 'Closure captures unserializable value.',",
            "  help: 'Fixes: move the value into component/query state via ctx.',",
            '  start: { line: 4, column: 12 },',
            '}];',
          ],
          route: "{ path: '/', page: () => trustedHtml('<main>Home</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nERROR KV201 route=src/cart.tsx');
      expect(output).toContain('Static export refused error diagnostic KV201 at src/cart.tsx:4:12');
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('copies Vite manifest assets through the export command facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const distDir = join(root, 'vite-dist');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(distDir, '.vite'), { recursive: true });
      mkdirSync(join(distDir, 'assets'), { recursive: true });
      writeFileSync(join(distDir, 'assets', 'app.css'), 'body{color:red}', 'utf8');
      writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log("app")', 'utf8');
      writeFileSync(join(distDir, 'kovo-static-mark.svg'), '<svg viewBox="0 0 1 1"></svg>', 'utf8');
      writeFileSync(join(distDir, 'static-note.txt'), 'static note', 'utf8');
      writeFileSync(
        join(distDir, '.vite', 'manifest.json'),
        JSON.stringify({
          'src/main.ts': {
            css: ['assets/app.css'],
            file: 'assets/app.js',
          },
        }),
        'utf8',
      );
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            '{ path: \'/\', page: () => trustedHtml(\'<main data-export-cli><img src="/kovo-static-mark.svg" alt=""><a href="/static-note.txt">note</a>CLI export</main>\') }',
        }),
        'utf8',
      );

      await expect(
        mainAsync([
          'export',
          appPath,
          '--out',
          outDir,
          '--manifest',
          join(distDir, '.vite', 'manifest.json'),
          '--dist',
          distDir,
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('ASSET /assets/app.css status=200 bytes=');
      expect(output).toContain('ASSET /assets/app.js status=200 bytes=');
      expect(output).toContain('ASSET /kovo-static-mark.svg status=200 bytes=');
      expect(output).toContain('ASSET /static-note.txt status=200 bytes=');
      expect(output).toContain('SUMMARY html=1 clientModules=1 assets=4 diagnostics=0');
      expect(readFileSync(join(outDir, 'assets', 'app.css'), 'utf8')).toBe('body{color:red}');
      expect(readFileSync(join(outDir, 'assets', 'app.js'), 'utf8')).toBe('console.log("app")');
      expect(readFileSync(join(outDir, 'kovo-static-mark.svg'), 'utf8')).toBe(
        '<svg viewBox="0 0 1 1"></svg>',
      );
      expect(readFileSync(join(outDir, 'static-note.txt'), 'utf8')).toBe('static note');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('copies referenced public assets without requiring a Vite manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(root, 'assets'), { recursive: true });
      writeFileSync(join(root, 'assets', 'styles.css'), 'body{color:rebeccapurple}', 'utf8');
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', stylesheets: ['/assets/styles.css'], page: () => trustedHtml('<main data-export-cli>CLI export</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('ASSET /assets/styles.css status=200 bytes=');
      expect(output).toContain('SUMMARY html=1 clientModules=1 assets=1 diagnostics=0');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<link rel="stylesheet" href="/assets/styles.css"',
      );
      expect(readFileSync(join(outDir, 'assets', 'styles.css'), 'utf8')).toBe(
        'body{color:rebeccapurple}',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not stage or export private default-root trees', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(root, '.git'), { recursive: true });
      writeFileSync(join(root, '.git', 'config'), 'private repository metadata', 'utf8');
      const secretPath = join(root, 'node_modules', 'huge-secret.bin');
      writeFileSync(secretPath, '', 'utf8');
      truncateSync(secretPath, 513 * 1024 * 1024);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            '{ path: \'/\', page: () => trustedHtml(\'<main><a href="/node_modules/huge-secret.bin">secret</a><a href="/.git/config">git</a></main>\') }',
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('KV229');
      expect(output).toContain("source '");
      expect(output).not.toContain('public asset byte limit');
      expect(existsSync(join(outDir, 'node_modules', 'huge-secret.bin'))).toBe(false);
      expect(existsSync(join(outDir, '.git', 'config'))).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails loudly when bare export cannot resolve a referenced public asset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', stylesheets: ['/assets/styles.css'], page: () => trustedHtml('<main data-export-cli>CLI export</main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nERROR KV229 route=/assets/styles.css');
      expect(output).toContain(
        "cannot copy referenced public asset '/assets/styles.css' because source",
      );
      expect(output).toContain('SPEC §9.5 exports referenced static assets with route documents');
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects Vite manifest assets that escape --dist with dot segments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const distDir = join(root, 'vite-dist');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(distDir, '.vite'), { recursive: true });
      writeFileSync(join(root, 'secret.txt'), 'do-not-copy', 'utf8');
      writeFileSync(
        join(distDir, '.vite', 'manifest.json'),
        JSON.stringify({
          'src/main.ts': {
            file: '../secret.txt',
          },
        }),
        'utf8',
      );
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml('<main data-export-cli>CLI export</main>') }",
        }),
        'utf8',
      );

      await expect(
        mainAsync([
          'export',
          appPath,
          '--out',
          outDir,
          '--manifest',
          join(distDir, '.vite', 'manifest.json'),
          '--dist',
          distDir,
        ]),
      ).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo export --manifest asset must stay within --dist');
      expect(() => readFileSync(join(outDir, 'secret.txt'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a symlinked Vite dist root without publishing outside files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-export-dist-outside-'));
    const appPath = join(root, 'app.mjs');
    const distDir = join(root, 'vite-dist');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(outside, '.vite'), { recursive: true });
      mkdirSync(join(outside, 'assets'), { recursive: true });
      writeFileSync(join(outside, 'assets', 'leak.txt'), 'outside secret', 'utf8');
      writeFileSync(
        join(outside, '.vite', 'manifest.json'),
        JSON.stringify({ 'src/main.ts': { file: 'assets/leak.txt' } }),
        'utf8',
      );
      symlinkSync(outside, distDir, 'dir');
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml('<main data-export-cli>CLI export</main>') }",
        }),
        'utf8',
      );

      await expect(
        mainAsync([
          'export',
          appPath,
          '--out',
          outDir,
          '--manifest',
          join(distDir, '.vite', 'manifest.json'),
          '--dist',
          distDir,
        ]),
      ).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toMatch(/symbolic-link/u);
      expect(existsSync(join(outDir, 'assets/leak.txt'))).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('pins the Vite public asset root before app evaluation can replace it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-export-dist-substitute-'));
    const appPath = join(root, 'app.mjs');
    const distDir = join(root, 'vite-dist');
    const parkedDistDir = join(root, 'vite-dist-reviewed');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previousRoot = process.env.KOVO_TEST_EXPORT_DIST_ROOT;
    const previousParked = process.env.KOVO_TEST_EXPORT_DIST_PARKED;
    const previousOutside = process.env.KOVO_TEST_EXPORT_DIST_OUTSIDE;

    try {
      symlinkServerPackage(root);
      mkdirSync(join(distDir, '.vite'), { recursive: true });
      writeFileSync(join(distDir, '.vite', 'manifest.json'), '{}', 'utf8');
      writeFileSync(join(distDir, 'victim.txt'), 'reviewed public asset', 'utf8');
      writeFileSync(join(outside, 'victim.txt'), 'outside secret', 'utf8');
      process.env.KOVO_TEST_EXPORT_DIST_ROOT = distDir;
      process.env.KOVO_TEST_EXPORT_DIST_PARKED = parkedDistDir;
      process.env.KOVO_TEST_EXPORT_DIST_OUTSIDE = outside;
      writeFileSync(
        appPath,
        appModuleSource({
          prelude: [
            "import { renameSync } from 'node:fs';",
            'renameSync(process.env.KOVO_TEST_EXPORT_DIST_ROOT, process.env.KOVO_TEST_EXPORT_DIST_PARKED);',
            'renameSync(process.env.KOVO_TEST_EXPORT_DIST_OUTSIDE, process.env.KOVO_TEST_EXPORT_DIST_ROOT);',
          ],
          route: "{ path: '/', page: () => trustedHtml('<main><img src=\"/victim.txt\"></main>') }",
        }),
        'utf8',
      );

      await expect(
        mainAsync([
          'export',
          appPath,
          '--out',
          outDir,
          '--manifest',
          join(distDir, '.vite', 'manifest.json'),
          '--dist',
          distDir,
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(join(outDir, 'victim.txt'), 'utf8')).toBe('reviewed public asset');
      expect(readFileSync(join(outDir, 'victim.txt'), 'utf8')).not.toContain('outside secret');
    } finally {
      if (previousRoot === undefined) delete process.env.KOVO_TEST_EXPORT_DIST_ROOT;
      else process.env.KOVO_TEST_EXPORT_DIST_ROOT = previousRoot;
      if (previousParked === undefined) delete process.env.KOVO_TEST_EXPORT_DIST_PARKED;
      else process.env.KOVO_TEST_EXPORT_DIST_PARKED = previousParked;
      if (previousOutside === undefined) delete process.env.KOVO_TEST_EXPORT_DIST_OUTSIDE;
      else process.env.KOVO_TEST_EXPORT_DIST_OUTSIDE = previousOutside;
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('pins the default public asset root before app evaluation can replace it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-export-root-substitute-'));
    const exportRoot = mkdtempSync(join(tmpdir(), 'kovo-export-root-output-'));
    const parkedRoot = `${root}-reviewed`;
    const appPath = join(root, 'app.mjs');
    const outDir = join(exportRoot, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previousRoot = process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT;
    const previousParked = process.env.KOVO_TEST_EXPORT_PUBLIC_PARKED;
    const previousOutside = process.env.KOVO_TEST_EXPORT_PUBLIC_OUTSIDE;

    try {
      symlinkServerPackage(root);
      writeFileSync(join(root, 'victim.txt'), 'reviewed public asset', 'utf8');
      writeFileSync(join(outside, 'victim.txt'), 'outside secret', 'utf8');
      process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT = root;
      process.env.KOVO_TEST_EXPORT_PUBLIC_PARKED = parkedRoot;
      process.env.KOVO_TEST_EXPORT_PUBLIC_OUTSIDE = outside;
      writeFileSync(
        appPath,
        appModuleSource({
          prelude: [
            "import { renameSync } from 'node:fs';",
            'renameSync(process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT, process.env.KOVO_TEST_EXPORT_PUBLIC_PARKED);',
            'renameSync(process.env.KOVO_TEST_EXPORT_PUBLIC_OUTSIDE, process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT);',
          ],
          route: "{ path: '/', page: () => trustedHtml('<main><img src=\"/victim.txt\"></main>') }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(join(outDir, 'victim.txt'), 'utf8')).toBe('reviewed public asset');
      expect(readFileSync(join(outDir, 'victim.txt'), 'utf8')).not.toContain('outside secret');
    } finally {
      if (previousRoot === undefined) delete process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT;
      else process.env.KOVO_TEST_EXPORT_PUBLIC_ROOT = previousRoot;
      if (previousParked === undefined) delete process.env.KOVO_TEST_EXPORT_PUBLIC_PARKED;
      else process.env.KOVO_TEST_EXPORT_PUBLIC_PARKED = previousParked;
      if (previousOutside === undefined) delete process.env.KOVO_TEST_EXPORT_PUBLIC_OUTSIDE;
      else process.env.KOVO_TEST_EXPORT_PUBLIC_OUTSIDE = previousOutside;
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
      rmSync(parkedRoot, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
      rmSync(exportRoot, { force: true, recursive: true });
    }
  });

  it('exits zero for skip-mode KV229 warnings after writing selected artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        appPath,
        appModuleSource({
          route: [
            "{ path: '/', page: () => trustedHtml('<main data-exported>Home</main>') }",
            "{ path: '/products/:id', page: () => trustedHtml('<main>Product</main>') }",
          ].join(','),
        }),
        'utf8',
      );

      await expect(
        mainAsync(['export', appPath, '--out', outDir, '--skip-non-exportable']),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('HTML /index.html status=200 bytes=');
      expect(output).toContain('WARN KV229 route=/products/:id');
      expect(output).toContain('SUMMARY html=1 clientModules=1 assets=0 diagnostics=1');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-exported>Home</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('sets a stylesheet env var from exactly one manifest stylesheet before loading the app', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const distDir = join(root, 'vite-dist');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(join(distDir, '.vite'), { recursive: true });
      mkdirSync(join(distDir, 'assets'), { recursive: true });
      writeFileSync(join(distDir, 'assets', 'site.css'), 'html{display:block}', 'utf8');
      writeFileSync(
        join(distDir, '.vite', 'manifest.json'),
        JSON.stringify({
          'src/site.ts': {
            css: ['assets/site.css'],
          },
        }),
        'utf8',
      );
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            '{ path: \'/\', page: () => trustedHtml(`<link href="${process.env.KOVO_TEST_STYLESHEET_HREF}"><main>Home</main>`) }',
        }),
        'utf8',
      );
      delete process.env.KOVO_TEST_STYLESHEET_HREF;

      await expect(
        mainAsync([
          'export',
          appPath,
          '--out',
          outDir,
          '--manifest',
          join(distDir, '.vite', 'manifest.json'),
          '--dist',
          distDir,
          '--stylesheet-env',
          'KOVO_TEST_STYLESHEET_HREF',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<link href="/assets/site.css">',
      );
      expect(process.env.KOVO_TEST_STYLESHEET_HREF).toBeUndefined();
    } finally {
      delete process.env.KOVO_TEST_STYLESHEET_HREF;
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('loads TS app modules through Vite after resolving manifest stylesheet env', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const srcDir = join(root, 'src');
    const appPath = join(srcDir, 'app.ts');
    const distDir = join(root, 'vite-dist');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(join(distDir, '.vite'), { recursive: true });
      mkdirSync(join(distDir, 'assets'), { recursive: true });
      writeFileSync(join(distDir, 'assets', 'vite.css'), 'main{display:block}', 'utf8');
      writeFileSync(
        join(distDir, '.vite', 'manifest.json'),
        JSON.stringify({
          'src/app.ts': {
            css: ['assets/vite.css'],
          },
        }),
        'utf8',
      );
      writeFileSync(
        appPath,
        appModuleSource({
          route:
            "{ path: '/', page: () => trustedHtml(`<main data-vite-export>${process.env.KOVO_TEST_VITE_STYLESHEET}</main>`) }",
        }),
        'utf8',
      );
      delete process.env.KOVO_TEST_VITE_STYLESHEET;

      const exitCode = await mainAsync([
        'export',
        '/src/app.ts',
        '--vite',
        '--root',
        root,
        '--out',
        outDir,
        '--manifest',
        join(distDir, '.vite', 'manifest.json'),
        '--dist',
        distDir,
        '--stylesheet-env',
        'KOVO_TEST_VITE_STYLESHEET',
      ]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-vite-export>/assets/vite.css</main>',
      );
      expect(readFileSync(join(outDir, 'assets', 'vite.css'), 'utf8')).toBe('main{display:block}');
    } finally {
      delete process.env.KOVO_TEST_VITE_STYLESHEET;
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
