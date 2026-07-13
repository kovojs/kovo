import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runExportCommand } from './build-export.js';

const repoRoot = process.cwd();

function symlinkRuntimePackages(root: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
  symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
}

function appModuleSource(envName: string): string {
  return [
    "import { createApp } from '@kovojs/server';",
    "import { trustedHtml } from '@kovojs/browser';",
    'export default createApp({',
    '  diagnostics: [],',
    '  document: {},',
    '  endpoints: [],',
    '  errorShells: {},',
    '  mutations: [],',
    '  queries: [],',
    `  routes: [{ path: '/', page: () => trustedHtml(\`<link href="\${process.env.${envName}}"><main>Home</main>\`) }],`,
    '  stylesheets: [],',
    '});',
    '',
  ].join('\n');
}

function writeManifest(root: string, fileName: string): { distDir: string; manifestFile: string } {
  const distDir = join(root, `dist-${fileName.replaceAll('.', '-')}`);
  mkdirSync(join(distDir, '.vite'), { recursive: true });
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'assets', fileName), 'html{display:block}', 'utf8');
  const manifestFile = join(distDir, '.vite', 'manifest.json');
  writeFileSync(
    manifestFile,
    JSON.stringify({
      'src/app.ts': {
        css: [`assets/${fileName}`],
      },
    }),
    'utf8',
  );
  return { distDir, manifestFile };
}

describe('kovo build/export scoped context', () => {
  it('restores stylesheet env overlays across repeated exports in one process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-export-context-'));
    const appPath = join(root, 'app.mjs');
    const envName = 'KOVO_TEST_SCOPED_STYLESHEET';
    const previous = process.env[envName];

    try {
      symlinkRuntimePackages(root);
      writeFileSync(appPath, appModuleSource(envName), 'utf8');
      const firstManifest = writeManifest(root, 'first.css');
      const secondManifest = writeManifest(root, 'second.css');
      process.env[envName] = 'before-export';

      const first = await runExportCommand({
        appModulePath: appPath,
        distDir: firstManifest.distDir,
        manifestFile: firstManifest.manifestFile,
        outDir: join(root, 'out-first'),
        stylesheetEnv: envName,
      });
      const second = await runExportCommand({
        appModulePath: appPath,
        distDir: secondManifest.distDir,
        manifestFile: secondManifest.manifestFile,
        outDir: join(root, 'out-second'),
        stylesheetEnv: envName,
      });

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(process.env[envName]).toBe('before-export');
      expect(readFileSync(join(root, 'out-first/index.html'), 'utf8')).toContain(
        '<link href="/assets/first.css">',
      );
      expect(readFileSync(join(root, 'out-second/index.html'), 'utf8')).toContain(
        '<link href="/assets/second.css">',
      );
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
      rmSync(root, { force: true, recursive: true });
    }
  });
});
