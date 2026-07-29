import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { build as viteBuild, type Plugin } from 'vite-plus';

import {
  approvedBuildSourcesVitePluginForTesting,
  preEvaluationAppSourceFilesForTesting,
} from './build-export.js';

describe('pre-evaluation app source closure', () => {
  it('retains static and dynamic entry imports while excluding an unimported 44-file catalog', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-entry-source-closure-')));
    const srcDir = join(root, 'src');
    const catalogDir = join(srcDir, 'components/ui');
    const appPath = join(srcDir, 'app.ts');
    const clientPath = join(srcDir, 'client.ts');
    const outDir = join(root, 'dist');
    try {
      mkdirSync(catalogDir, { recursive: true });
      writeFileSync(
        appPath,
        [
          "import { staticValue } from './app-static.js';",
          "export const dynamicValue = import('./app-dynamic.js');",
          'export const appValue = staticValue;',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(join(srcDir, 'app-static.ts'), 'export const staticValue = true;\n', 'utf8');
      writeFileSync(join(srcDir, 'app-dynamic.ts'), 'export const dynamicValue = true;\n', 'utf8');
      writeFileSync(
        clientPath,
        [
          "import { staticValue } from './client-static.js';",
          "export const dynamicValue = import('./client-dynamic.js');",
          'export const clientValue = staticValue;',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(join(srcDir, 'client-static.ts'), 'export const staticValue = true;\n', 'utf8');
      writeFileSync(
        join(srcDir, 'client-dynamic.ts'),
        'export const dynamicValue = true;\n',
        'utf8',
      );
      for (let index = 0; index < 44; index += 1) {
        writeFileSync(
          join(catalogDir, `component-${String(index).padStart(2, '0')}.tsx`),
          `export const Component${String(index)} = () => <div />;\n`,
          'utf8',
        );
      }

      const sourceFiles = preEvaluationAppSourceFilesForTesting(appPath, root, {
        fileName: 'index.html',
        source:
          '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
      });
      expect(sourceFiles.map((file) => file.fileName).sort()).toEqual([
        'src/app-dynamic.ts',
        'src/app-static.ts',
        'src/app.ts',
        'src/client-dynamic.ts',
        'src/client-static.ts',
        'src/client.ts',
      ]);
      expect(sourceFiles.some((file) => file.fileName.includes('/components/ui/'))).toBe(false);

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appPath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [approvedBuildSourcesVitePluginForTesting(appPath, root, sourceFiles)],
          root,
        }),
      ).resolves.toBeDefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a module edge introduced after the approved snapshot was sealed', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kovo-late-source-edge-')));
    const appPath = join(root, 'app.mjs');
    const latePath = join(root, 'late.mjs');
    const outDir = join(root, 'dist');
    const source = 'export const appValue = true;\n';
    const injectLateImport: Plugin = {
      name: 'test-inject-late-import',
      transform(code, id) {
        return id === appPath ? `${code}\nimport './late.mjs';\n` : null;
      },
    };
    try {
      writeFileSync(appPath, source, 'utf8');
      writeFileSync(latePath, 'globalThis.__KOVO_LATE_SOURCE__ = true;\n', 'utf8');

      await expect(
        viteBuild({
          build: { emptyOutDir: true, outDir, rollupOptions: { input: appPath }, ssr: true },
          configFile: false,
          logLevel: 'silent',
          plugins: [
            approvedBuildSourcesVitePluginForTesting(appPath, root, [
              { fileName: 'app.mjs', source },
            ]),
            injectLateImport,
          ],
          root,
        }),
      ).rejects.toThrow(/unapproved app source late\.mjs.*security preflight/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
