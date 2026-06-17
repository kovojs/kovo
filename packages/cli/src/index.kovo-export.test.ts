import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

function appModuleSource(options: {
  readonly exportKind?: 'default' | 'named';
  readonly prelude?: readonly string[];
  readonly route: string;
}): string {
  return [
    ...(options.prelude ?? []),
    options.exportKind === 'named' ? 'export const app = {' : 'export default {',
    '  clientModules: {',
    "    buildToken() { return 'test'; },",
    "    put() { throw new Error('unused'); },",
    "    resolve() { return { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 }; },",
    '  },',
    '  diagnostics: [],',
    '  document: {},',
    '  endpoints: [],',
    '  errorShells: {},',
    '  mutations: [],',
    '  queries: [],',
    `  routes: [${options.route}],`,
    '};',
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
      writeFileSync(
        appPath,
        appModuleSource({
          route: "{ path: '/', page: () => '<main data-export-cli>CLI export</main>' }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nHTML /index.html status=200 bytes=');
      expect(output).toContain(
        `SUMMARY html=1 clientModules=0 diagnostics=0 outDir=${JSON.stringify(outDir)}\n`,
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

  it('exports nested routes as directory-index HTML by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        appPath,
        appModuleSource({
          route: "{ path: '/docs/intro', page: () => '<main data-pretty-export>Intro</main>' }",
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
      writeFileSync(
        appPath,
        appModuleSource({
          exportKind: 'named',
          route: "{ path: '/products/:id', page: () => '<main>Product</main>' }",
        }),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', join(root, 'dist')])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-export/v1\nERROR KV229 route=/products/:id');
      expect(output).toContain('staticPaths metadata');
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
          route: "{ path: '/', page: () => '<main>Home</main>' }",
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
});
