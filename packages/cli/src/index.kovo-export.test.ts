import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  symlinkSync(
    join(repoRoot, 'packages/conformance-fixtures'),
    join(root, 'node_modules/@kovojs/conformance-fixtures'),
  );
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
    ...(closed ? ["import { defineKovo } from '@kovojs/server';"] : []),
    "import { trustedHtml } from '@kovojs/browser';",
    ...(options.prelude ?? []),
    ...(closed
      ? [
          '',
          "const kovo = defineKovo({ appId: '00000000-0000-4000-8000-000000000033', egress: { allowInternal: [] } });",
        ]
      : [
          'const modules = new Map();',
          'const versionedHref = (module) => `/c/__v/0000000000000000000000000000000000000000000000000000000000000000/${module.path.slice("/c/".length)}`;',
        ]),
    `${exportPrefix}${closed ? 'kovo.assemble({' : '{'}`,
    ...(closed
      ? [`  routes: [${options.route}],`]
      : [
          '  clientModules: {',
          "    buildToken() { return '0000000000000000000000000000000000000000000000000000000000000000'; },",
          '    entries() { return [...modules.values()]; },',
          '    put(module) { const stored = { path: module.path, source: module.source }; const href = versionedHref(stored); modules.set(new URL(href, "https://kovo.local").pathname, stored); return href; },',
          '    resolve(href) {',
          '      const module = modules.get(new URL(href ?? "", "https://kovo.local").pathname);',
          "      return module ? { body: module.source, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, status: 200 } : { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 };",
          '    },',
          '  },',
          '  diagnostics: [],',
          '  document: {},',
          '  endpoints: [],',
          '  errorShells: {},',
          // SPEC §9.1/§9.5: the deliberately open aggregate retains the compiler-owned field only
          // to remain structurally shape-valid for its KV229 rejection proof.
          '  liveTargetRenderers: [],',
          '  mutations: [],',
          '  queries: [],',
          `  routes: [${options.route}],`,
          '  stylesheets: [],',
        ]),
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
            "kovo.route('/', { access: kovo.publicAccess('static export CLI fixture'), page: () => trustedHtml('<main data-export-cli>CLI export</main>', { reason: 'static export CLI fixture' }) })",
        }),
        'utf8',
      );

      const exitCode = await mainAsync(['export', appPath, '--out', outDir]);
      expect(exitCode, stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      expect(output).toContain(
        `SUMMARY html=1 clientModules=1 assets=0 diagnostics=0 outDir=${JSON.stringify(outDir)}\n`,
      );
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-export-cli>CLI export</main>',
      );
      const artifactText = readUtf8Tree(outDir);
      expect(existsSync(join(outDir, '__kovo'))).toBe(false);
      expect(artifactText).not.toContain('/__kovo/client.js');
      expect(artifactText).not.toContain('Kovo Dataflow Devtool');
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
            "kovo.route('/', { access: kovo.publicAccess('structured static export fixture'), page: () => trustedHtml('<main data-export-structured>Structured export</main>', { reason: 'structured static export fixture' }) })",
        }),
        'utf8',
      );

      const result = await runExportCommandStructured({
        appModulePath: appPath,
        outDir,
      });

      expect('error' in result, 'error' in result ? result.error : undefined).toBe(false);
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
      expect(JSON.stringify(result.staticExport)).not.toContain('/__kovo/client.js');
      expect(JSON.stringify(result.staticExport)).not.toContain('Kovo Dataflow Devtool');
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
            "kovo.route('/', { access: kovo.publicAccess('TypeScript static export fixture'), page: () => trustedHtml('<main data-export-tsx>TSX export</main>', { reason: 'TypeScript static export fixture' }) })",
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
    // Vite canonicalizes /var to /private/var on macOS; make the authenticated source snapshot use
    // that same stable path so the source-derived query transform exercises the intended graph.
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'kovo-export-cli-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      symlinkServerPackage(root);
      writeFileSync(
        join(root, 'kovo.ts'),
        [
          "import { defineKovo } from '@kovojs/server';",
          '',
          "export const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000032', egress: { allowInternal: [] } });",
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'greeting.tsx'),
        [
          '/** @jsxImportSource @kovojs/server */',
          "import { component } from '@kovojs/core';",
          '',
          "import { app } from './kovo.js';",
          '',
          'export const greetingQuery = app.query({',
          "  access: app.publicAccess('static export component query'),",
          "  load: () => ({ message: 'Hello from query' }),",
          '});',
          '',
          'export const Greeting = component({',
          '  queries: { greeting: greetingQuery },',
          '  render({ greeting }) {',
          '    return <main data-component-query>{greeting.message}</main>;',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        appPath,
        [
          '/** @jsxImportSource @kovojs/server */',
          "import { Greeting, greetingQuery } from './greeting.js';",
          "import { app } from './kovo.js';",
          '',
          'export const greetingRoute = app.route("/", {',
          "  access: app.publicAccess('static export route'),",
          '  page: () => <Greeting />,',
          '});',
          '',
          'export default app.assemble({',
          '  queries: [greetingQuery],',
          '  routes: [greetingRoute],',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const exitCode = await mainAsync(['export', appPath, '--out', outDir]);
      expect(exitCode, stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      const html = readFileSync(join(outDir, 'index.html'), 'utf8');
      expect(html).toContain('<main data-component-query ');
      expect(html).toContain('>Hello from query</main>');
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
            "kovo.route('/docs/intro', { access: kovo.publicAccess('nested static export fixture'), page: () => trustedHtml('<main data-pretty-export>Intro</main>', { reason: 'nested static export fixture' }) })",
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

  // @kovo-security-certifies C13 static-export-diagnostic-origin-provenance
  it('ignores app-exported structural diagnostic lookalikes without blocking static output', async () => {
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
          route:
            "kovo.route('/', { access: kovo.publicAccess('diagnostic provenance fixture'), page: () => trustedHtml('<main>Home</main>', { reason: 'diagnostic provenance fixture' }) })",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html');
      expect(output).toContain('diagnostics=0');
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain('<main>Home</main>');
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
            "kovo.route('/', { access: kovo.publicAccess('manifest asset export fixture'), page: () => trustedHtml('<main data-export-cli><img src=\"/kovo-static-mark.svg\" alt=\"\"><a href=\"/static-note.txt\">note</a>CLI export</main>', { reason: 'manifest asset export fixture' }) })",
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
            "kovo.route('/', { access: kovo.publicAccess('referenced asset export fixture'), stylesheets: ['/assets/styles.css'], page: () => trustedHtml('<main data-export-cli>CLI export</main>', { reason: 'referenced asset export fixture' }) })",
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
            "kovo.route('/', { access: kovo.publicAccess('private tree export rejection fixture'), page: () => trustedHtml('<main><a href=\"/node_modules/huge-secret.bin\">secret</a><a href=\"/.git/config\">git</a></main>', { reason: 'private tree export rejection fixture' }) })",
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
            "kovo.route('/', { access: kovo.publicAccess('missing asset export fixture'), stylesheets: ['/assets/styles.css'], page: () => trustedHtml('<main data-export-cli>CLI export</main>', { reason: 'missing asset export fixture' }) })",
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
            "kovo.route('/', { access: kovo.publicAccess('dot-segment manifest fixture'), page: () => trustedHtml('<main data-export-cli>CLI export</main>', { reason: 'dot-segment manifest fixture' }) })",
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
      ).resolves.toBe(2);

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
            "kovo.route('/', { access: kovo.publicAccess('symlinked dist fixture'), page: () => trustedHtml('<main data-export-cli>CLI export</main>', { reason: 'symlinked dist fixture' }) })",
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
      ).resolves.toBe(2);

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

  it('rejects Vite public-root mutation authority before app evaluation', async () => {
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
          route:
            "kovo.route('/', { access: kovo.publicAccess('Vite root mutation rejection fixture'), page: () => trustedHtml('<main><img src=\"/victim.txt\"></main>', { reason: 'Vite root mutation rejection fixture' }) })",
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
      expect(output).toContain('ERROR KV448');
      expect(output).toContain('raw filesystem authority');
      expect(readFileSync(join(distDir, 'victim.txt'), 'utf8')).toBe('reviewed public asset');
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('outside secret');
      expect(existsSync(parkedDistDir)).toBe(false);
      expect(existsSync(join(outDir, 'victim.txt'))).toBe(false);
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

  it('rejects default public-root mutation authority before app evaluation', async () => {
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
          route:
            "kovo.route('/', { access: kovo.publicAccess('public root mutation rejection fixture'), page: () => trustedHtml('<main><img src=\"/victim.txt\"></main>', { reason: 'public root mutation rejection fixture' }) })",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('ERROR KV448');
      expect(output).toContain('raw filesystem authority');
      expect(readFileSync(join(root, 'victim.txt'), 'utf8')).toBe('reviewed public asset');
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('outside secret');
      expect(existsSync(parkedRoot)).toBe(false);
      expect(existsSync(join(outDir, 'victim.txt'))).toBe(false);
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
            "kovo.route('/', { access: kovo.publicAccess('selected static export fixture'), page: () => trustedHtml('<main data-exported>Home</main>', { reason: 'selected static export fixture' }) })",
            "kovo.route('/products/:id', { access: kovo.publicAccess('non-exportable dynamic route fixture'), page: () => trustedHtml('<main>Product</main>', { reason: 'non-exportable dynamic route fixture' }) })",
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

  it('rejects the removed ambient --stylesheet-env escape before app evaluation', async () => {
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
            "kovo.route('/', { access: kovo.publicAccess('removed stylesheet environment fixture'), page: () => trustedHtml(`<link href=\"${process.env.KOVO_TEST_STYLESHEET_HREF}\"><main>Home</main>`, { reason: 'removed stylesheet environment fixture' }) })",
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
      ).resolves.toBe(2);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'unknown export option "--stylesheet-env"',
      );
      expect(existsSync(join(outDir, 'index.html'))).toBe(false);
      expect(process.env.KOVO_TEST_STYLESHEET_HREF).toBeUndefined();
    } finally {
      delete process.env.KOVO_TEST_STYLESHEET_HREF;
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each(['mjs', 'tsx'] as const)(
    'rejects an uncensused %s dependency before its package initializer runs',
    async (extension) => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
      const appPath = join(root, `app.${extension}`);
      const packageRoot = join(root, 'node_modules/uncensused-initializer');
      const marker = join(root, 'initializer-ran');
      const outDir = join(root, 'dist');
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        symlinkServerPackage(root);
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({
            exports: './index.mjs',
            name: 'uncensused-initializer',
            type: 'module',
            version: '1.0.0',
          }),
          'utf8',
        );
        writeFileSync(
          join(packageRoot, 'index.mjs'),
          [
            "import { writeFileSync } from 'node:fs';",
            `writeFileSync(${JSON.stringify(marker)}, 'evaluated');`,
            "export const value = 'unsafe';",
          ].join('\n'),
          'utf8',
        );
        writeFileSync(
          appPath,
          appModuleSource({
            prelude: ["import { value } from 'uncensused-initializer';"],
            route:
              "kovo.route('/', { access: kovo.publicAccess('uncensused dependency fixture'), page: () => trustedHtml(`<main data-dependency>${value}</main>`, { reason: 'uncensused dependency fixture' }) })",
          }),
          'utf8',
        );

        const args =
          extension === 'tsx'
            ? ['export', '/app.tsx', '--vite', '--root', root, '--out', outDir]
            : ['export', appPath, '--out', outDir];
        await expect(mainAsync(args)).resolves.toBe(1);

        expect(stdout).not.toHaveBeenCalled();
        const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('ERROR KV448');
        expect(output).toContain('uncensused-initializer');
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(join(outDir, 'index.html'))).toBe(false);
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        rmSync(root, { force: true, recursive: true });
      }
    },
  );
});

function readUtf8Tree(root: string): string {
  const chunks: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) chunks.push(readUtf8Tree(path));
    else if (entry.isFile()) chunks.push(readFileSync(path, 'utf8'));
  }
  return chunks.join('\n');
}
