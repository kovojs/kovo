import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runBuildCommand, runExportCommandStructured } from './build-export.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `kovo-${name}-`));
  roots.push(root);
  return root;
}

function repoFixture(name: string): string {
  const root = mkdtempSync(join(process.cwd(), `.tmp-kovo-${name}-`));
  roots.push(root);
  return root;
}

function security(root: string, invocationEnv: NodeJS.ProcessEnv = process.env) {
  return {
    invocationCwd: root,
    invocationEnv,
    paranoidStaticAdvisory: false,
  };
}

function runKovoProcess(root: string, args: readonly string[]) {
  return spawnSync(fileURLToPath(new URL('../bin.ts', import.meta.url)), args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  });
}

describe('build/export configuration versus finding exit contract', () => {
  it('returns 2 directly for missing build and export app inputs', async () => {
    const root = fixture('missing-app-exit');

    const build = await runBuildCommand(
      {
        appModulePath: './missing-app.tsx',
        cache: false,
        check: true,
        outDir: './dist',
      },
      security(root),
    );
    const exported = await runExportCommandStructured(
      {
        appModulePath: './missing-app.tsx',
        outDir: './static',
      },
      security(root),
    );

    expect(build).toMatchObject({ exitCode: 2 });
    expect('error' in build ? build.error : '').toContain('kovo build app module');
    expect(exported).toMatchObject({ exitCode: 2 });
    expect('error' in exported ? exported.error : '').toContain('kovo export app module');
  });

  it('returns 2 directly for invalid preset, config, output, and manifest inputs', async () => {
    const root = fixture('invalid-input-exit');
    const appPath = join(root, 'app.mjs');
    const outputFile = join(root, 'output-file');
    const manifestFile = join(root, 'manifest.json');
    writeFileSync(appPath, 'export default {};\n', 'utf8');
    writeFileSync(outputFile, 'not a directory\n', 'utf8');
    writeFileSync(manifestFile, '{ invalid json\n', 'utf8');

    const invalidPreset = await runBuildCommand(
      {
        appModulePath: appPath,
        cache: false,
        check: true,
        outDir: './dist',
        preset: 'unsupported' as 'node',
      },
      security(root),
    );
    expect(invalidPreset).toMatchObject({ exitCode: 2 });
    expect('error' in invalidPreset ? invalidPreset.error : '').toContain(
      'options.preset must be node, vercel, or cloudflare',
    );

    const invalidBuildOutput = await runBuildCommand(
      {
        appModulePath: appPath,
        cache: false,
        check: true,
        outDir: outputFile,
      },
      security(root),
    );
    expect(invalidBuildOutput).toMatchObject({ exitCode: 2 });
    expect('error' in invalidBuildOutput ? invalidBuildOutput.error : '').toContain(
      'kovo build --out must be a readable, non-symbolic-link directory',
    );

    mkdirSync(join(root, 'kovo.config.ts'));
    const invalidConfig = await runBuildCommand(
      {
        appModulePath: appPath,
        cache: false,
        check: true,
        outDir: './dist',
      },
      security(root),
    );
    expect(invalidConfig).toMatchObject({ exitCode: 2 });
    expect('error' in invalidConfig ? invalidConfig.error : '').toContain(
      'kovo build config must be a readable regular file',
    );
    rmSync(join(root, 'kovo.config.ts'), { force: true, recursive: true });

    const invalidExportOutput = await runExportCommandStructured(
      {
        appModulePath: appPath,
        outDir: outputFile,
      },
      security(root),
    );
    expect(invalidExportOutput).toMatchObject({ exitCode: 2 });
    expect('error' in invalidExportOutput ? invalidExportOutput.error : '').toContain(
      'kovo export --out must be a readable, non-symbolic-link directory',
    );

    const invalidManifest = await runExportCommandStructured(
      {
        appModulePath: appPath,
        manifestFile,
        outDir: './static',
      },
      security(root),
    );
    expect(invalidManifest).toMatchObject({ exitCode: 2 });
    expect('error' in invalidManifest ? invalidManifest.error : '').toContain(
      'Unable to read export manifest JSON',
    );
  });

  it('keeps an authored config security finding at exit 1', async () => {
    const root = repoFixture('config-security-finding-exit');
    writeFileSync(join(root, 'app.mjs'), 'export default {};\n', 'utf8');
    writeFileSync(join(root, 'kovo.config.mjs'), 'export default {\n', 'utf8');

    const result = await runBuildCommand(
      {
        appModulePath: './app.mjs',
        cache: false,
        check: true,
        outDir: './dist',
      },
      security(root),
    );

    expect(result.exitCode, 'error' in result ? result.error : result.output).toBe(1);
    expect('error' in result ? result.error : '').toContain('ERROR KV424');
  }, 60_000);

  it.each(['build', 'export'] as const)(
    'returns 2 from the real %s process for a missing app',
    (command) => {
      const root = fixture(`${command}-process-missing-app`);
      const result = runKovoProcess(root, [command, './missing-app.tsx', '--out', './dist']);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`kovo ${command} app module`);
    },
    70_000,
  );
});
