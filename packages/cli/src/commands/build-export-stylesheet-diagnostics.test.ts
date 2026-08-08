import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { kovoBuildStylesheetCssForTesting, runBuildCommand } from './build-export.js';

const repoRoot = process.cwd();

describe('production stylesheet extraction diagnostics', () => {
  it('rejects a package hash mismatch instead of returning partial app CSS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-stylesheet-diagnostics-'));
    const appPath = join(root, 'src/app.tsx');
    const packageDir = join(root, 'node_modules/@kovojs/ui');
    const appSource = [
      "import * as style from '@kovojs/style';",
      "export const partialStyles = style.create({ root: { color: 'partial-app-css' } });",
      '',
    ].join('\n');
    const packageSource = [
      "import * as style from '@kovojs/style';",
      "const base = style.create({ root: { color: 'untrusted-package-css' } });",
      'export const Button = () => <button {...style.attrs(base.root)}>Button</button>;',
      '',
    ].join('\n');

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(packageDir, 'src'), { recursive: true });
      writeFileSync(appPath, appSource, 'utf8');
      writeFileSync(join(packageDir, 'src/button.tsx'), packageSource, 'utf8');
      writeFileSync(
        join(packageDir, 'package.json'),
        JSON.stringify({
          exports: { './button': { default: './dist/button.mjs' } },
          kovo: {
            vendoredSource: true,
            vendoredSourceHashes: { button: `sha256-${'A'.repeat(43)}` },
          },
          name: '@kovojs/ui',
        }),
        'utf8',
      );

      await expect(kovoBuildStylesheetCssForTesting(appPath)).rejects.toThrow(
        /stylesheet extraction failed:[\s\S]*package @kovojs\/ui src\/button\.tsx:.*hash mismatch/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the last good output and removes staging after runBuildCommand sees a UI hash failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-stylesheet-transaction-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const packageDir = join(root, 'node_modules/@kovojs/ui');

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      for (const packageName of ['browser', 'core', 'server', 'style']) {
        symlinkSync(
          join(repoRoot, 'packages', packageName),
          join(root, 'node_modules/@kovojs', packageName),
        );
      }
      symlinkSync(join(repoRoot, 'node_modules/typescript'), join(root, 'node_modules/typescript'));
      mkdirSync(join(root, 'node_modules/@types'), { recursive: true });
      symlinkSync(
        join(repoRoot, 'node_modules/@types/node'),
        join(root, 'node_modules/@types/node'),
      );
      mkdirSync(join(packageDir, 'dist'), { recursive: true });
      cpSync(join(repoRoot, 'packages/ui/src'), join(packageDir, 'src'), { recursive: true });
      writeFileSync(join(packageDir, 'dist/button.mjs'), 'export const Button = () => null;\n');
      writeFileSync(
        join(packageDir, 'dist/button.d.mts'),
        'export declare const Button: () => null;\n',
      );
      const uiManifest = JSON.parse(
        readFileSync(join(repoRoot, 'packages/ui/package.json'), 'utf8'),
      ) as { kovo: { vendoredSourceHashes: Record<string, string> } };
      uiManifest.kovo.vendoredSourceHashes.button = `sha256-${'A'.repeat(43)}`;
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify(uiManifest), 'utf8');
      writeFileSync(
        appPath,
        `/** @jsxImportSource @kovojs/server */
import { defineKovo } from '@kovojs/server';
import { Button } from '@kovojs/ui/button';

void Button;
const app = defineKovo({
  appId: 'b24197b4-4400-407c-a23a-96fc41e234d1',
  document: { lang: 'en' },
});
const home = app.route('/', {
  access: app.publicAccess('stylesheet transaction fixture'),
  page: () => <main>Last good stays live</main>,
});

export default app.assemble({ routes: [home] });
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
        'utf8',
      );
      writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
      writeFileSync(
        join(root, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              jsx: 'react-jsx',
              jsxImportSource: '@kovojs/server',
              lib: ['ES2022', 'DOM'],
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              skipLibCheck: true,
              strict: true,
              target: 'ES2022',
              types: ['node'],
            },
            include: ['app.tsx'],
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      mkdirSync(outDir);
      writeFileSync(join(outDir, 'marker'), 'last-good\n', 'utf8');

      const result = await runBuildCommand(
        {
          appModulePath: './app.tsx',
          cache: false,
          check: false,
          outDir: './dist',
        },
        {
          invocationCwd: root,
          invocationEnv: { ...process.env },
          paranoidStaticAdvisory: false,
        },
      );
      const diagnostic = 'error' in result ? result.error : result.output;

      expect(result.exitCode).toBe(1);
      expect(diagnostic).toContain('hash mismatch');
      expect(readFileSync(join(outDir, 'marker'), 'utf8')).toBe('last-good\n');
      expect(readdirSync(outDir)).toEqual(['marker']);
      expect(existsSync(join(outDir, '.kovo'))).toBe(false);
      expect(readdirSync(root).filter((name) => name.startsWith('.kovo-build-stage-'))).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);
});

// O4/D4 (plans/good-perf.md): /assets/styles.css is a function of the app's
// imported components, not of the whole @kovojs/ui catalog (SPEC §13.1).
describe('production stylesheet import-graph pruning (O4/D4)', () => {
  function sha256(source: string): string {
    const normalized = source.endsWith('\n') ? source : `${source}\n`;
    return `sha256-${createHash('sha256').update(normalized).digest('base64url')}`;
  }

  function componentSource(color: string): string {
    return [
      "import * as style from '@kovojs/style';",
      `const base = style.create({ root: { color: '${color}' } });`,
      'export const Component = () => <div {...style.attrs(base.root)}>x</div>;',
      '',
    ].join('\n');
  }

  function writeVendoredUi(root: string): void {
    const packageDir = join(root, 'node_modules/@kovojs/ui');
    const button = componentSource('build-pruned-button');
    const combobox = componentSource('build-pruned-combobox');
    mkdirSync(join(packageDir, 'src'), { recursive: true });
    writeFileSync(join(packageDir, 'src/button.tsx'), button, 'utf8');
    writeFileSync(join(packageDir, 'src/combobox.tsx'), combobox, 'utf8');
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        exports: {
          './button': { default: './dist/button.mjs' },
          './combobox': { default: './dist/combobox.mjs' },
        },
        kovo: {
          vendoredSource: true,
          vendoredSourceHashes: { button: sha256(button), combobox: sha256(combobox) },
        },
        name: '@kovojs/ui',
      }),
      'utf8',
    );
  }

  it('emits only imported-component CSS, and no package CSS for zero imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-stylesheet-pruning-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeVendoredUi(root);
      const appPath = join(root, 'src/app.tsx');

      // Zero @kovojs/ui imports: no package CSS at all, so no /assets/styles.css
      // build chunk exists and an authored styles.css can materialize instead.
      writeFileSync(appPath, 'export const app = 1;\n', 'utf8');
      const zeroImports = await kovoBuildStylesheetCssForTesting(appPath);
      expect(zeroImports.stylesheetCss).toEqual([]);

      // One imported component: its CSS ships, the rest of the catalog does not.
      writeFileSync(appPath, "import '@kovojs/ui/button';\nexport const app = 1;\n", 'utf8');
      const oneImport = await kovoBuildStylesheetCssForTesting(appPath);
      const sheet = oneImport.stylesheetCss.find((entry) => entry.href === '/assets/styles.css');
      expect(sheet).toBeDefined();
      expect(sheet?.css).toContain('color:build-pruned-button');
      expect(sheet?.css).not.toContain('build-pruned-combobox');
      expect(sheet?.css).not.toContain('import graph unprovable');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  it('leads the sheet with a fallback comment when the import graph is unprovable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-build-stylesheet-pruning-fallback-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeVendoredUi(root);
      const appPath = join(root, 'src/app.tsx');
      writeFileSync(
        appPath,
        [
          "import '@kovojs/ui/button';",
          "export const load = (name: string) => import('@kovojs/ui/' + name);",
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await kovoBuildStylesheetCssForTesting(appPath);
      const sheet = result.stylesheetCss.find((entry) => entry.href === '/assets/styles.css');
      expect(sheet?.css).toContain(
        '/* kovo: full @kovojs/ui component CSS retained (import graph unprovable):',
      );
      // Fail SAFE: the whole catalog ships when the set cannot be proven.
      expect(sheet?.css).toContain('color:build-pruned-button');
      expect(sheet?.css).toContain('color:build-pruned-combobox');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);
});
