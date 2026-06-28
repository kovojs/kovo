import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

const repoRoot = process.cwd();

function symlinkServerPackage(root: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
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
      expect(process.env.KOVO_TEST_STYLESHEET_HREF).toBe('/assets/site.css');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<link href="/assets/site.css">',
      );
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

      await expect(
        mainAsync([
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
        ]),
      ).resolves.toBe(0);

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
