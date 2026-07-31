import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  runBuildCommand,
  runExportCommandStructured,
  runSourceCheckCommand,
} from './build-export.js';

const repoRoot = process.cwd();

async function withCwd<Value>(cwd: string, operation: () => Promise<Value>): Promise<Value> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await operation();
  } finally {
    process.chdir(previousCwd);
  }
}

// Run 30612746165 exhausted the 30s default after 30.55s; the same three-command proof takes
// 21.79s locally. Keep roughly three hosted ceilings while retaining a finite regression bound.
describe('build/export single Vite runnable environment', { timeout: 90_000 }, () => {
  it('evaluates a current app contract through the production transforms and exports HTML', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-runnable-export-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
    for (const packageName of ['browser', 'core', 'server']) {
      symlinkSync(
        join(repoRoot, 'packages', packageName),
        join(root, 'node_modules/@kovojs', packageName),
      );
    }
    const appSource = `/** @jsxImportSource @kovojs/server */
import { defineKovo } from '@kovojs/server';

const app = defineKovo({
  appId: 'b24197b4-4400-407c-a23a-96fc41e234d1',
  document: { lang: 'en' },
});
const home = app.route('/', {
  access: app.publicAccess('runnable environment fixture'),
  page: () => <main data-kovo-runnable>Single graph</main>,
});

export default app.assemble({ routes: [home] });
`;
    writeFileSync(appPath, appSource, 'utf8');
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    );
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

    try {
      const security = {
        invocationCwd: root,
        invocationEnv: {},
        paranoidStaticAdvisory: false,
      } as const;
      const { checked, failed, result } = await withCwd(root, async () => {
        writeFileSync(
          appPath,
          appSource.replace(
            'export default app.assemble',
            `throw new Error('runner app evaluation failed closed');\nexport default app.assemble`,
          ),
          'utf8',
        );
        const failed = await runBuildCommand(
          {
            appModulePath: './app.tsx',
            cache: false,
            check: true,
            outDir: './failed-dist',
          },
          security,
        );
        writeFileSync(appPath, appSource, 'utf8');
        const checked = await runSourceCheckCommand(
          { appModulePath: './app.tsx', cache: false },
          security,
        );
        const result = await runExportCommandStructured(
          {
            appModulePath: './app.tsx',
            outDir: './dist',
            root: '.',
          },
          security,
        );
        return { checked, failed, result };
      });

      expect(failed.exitCode, 'error' in failed ? failed.error : failed.output).toBe(1);
      expect('error' in failed ? failed.error : '').toContain(
        'runner app evaluation failed closed',
      );
      expect(existsSync(join(root, 'failed-dist'))).toBe(false);
      expect(checked.exitCode, 'error' in checked ? checked.error : checked.output).toBe(0);
      expect('error' in result, 'error' in result ? result.error : undefined).toBe(false);
      if ('error' in result) return;
      expect(result.exitCode).toBe(0);
      expect(result.staticExport.diagnostics).toEqual([]);
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-kovo-runnable>Single graph</main>',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
