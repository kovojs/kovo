import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';

// C13-style forcing proof for SPEC §2 and plan 3 §3.5: exercise pnpm itself against local hostile
// package lifecycle scripts, then mutate each generated policy door independently.
describe('create-kovo dependency lifecycle-script policy', () => {
  it('fails closed on an unreviewed dependency while retaining exact reviewed native exceptions', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-lifecycle-policy-'));

    try {
      const generatedRoot = join(root, 'generated');
      writeKovoProject(generatedRoot, { disableGit: true, name: 'Lifecycle Policy Proof' });
      const generatedPackage = readPackageJson(join(generatedRoot, 'package.json'));
      const generatedNpmrc = readFileSync(join(generatedRoot, '.npmrc'), 'utf8');

      expect(generatedPackage.pnpm?.onlyBuiltDependencies).toEqual(['@node-rs/argon2']);

      const reviewedMarker = join(root, 'reviewed.marker');
      const ignoredMarker = join(root, 'ignored.marker');
      const hostileMarker = join(root, 'hostile.marker');
      const reviewedPackage = writeLifecyclePackage(
        root,
        'reviewed-package',
        '@node-rs/argon2',
        reviewedMarker,
      );
      const ignoredPackage = writeLifecyclePackage(
        root,
        'ignored-package',
        'esbuild',
        ignoredMarker,
      );
      const hostilePackage = writeLifecyclePackage(
        root,
        'hostile-package',
        'hostile-lifecycle',
        hostileMarker,
      );

      const reviewedInstall = writeInstallHarness(join(root, 'reviewed-install'), {
        dependencies: {
          '@node-rs/argon2': `file:${reviewedPackage}`,
          esbuild: `file:${ignoredPackage}`,
        },
        npmrc: generatedNpmrc,
        pnpm: generatedPackage.pnpm,
      });
      const reviewedResult = runOfflineInstall(reviewedInstall);
      expect(installOutput(reviewedResult)).toContain('Done');
      expect(reviewedResult.status).toBe(0);
      expect(existsSync(reviewedMarker)).toBe(true);
      expect(existsSync(ignoredMarker)).toBe(false);

      const hostileInstall = writeInstallHarness(join(root, 'hostile-install'), {
        dependencies: {
          '@node-rs/argon2': `file:${reviewedPackage}`,
          'hostile-lifecycle': `file:${hostilePackage}`,
        },
        npmrc: generatedNpmrc,
        pnpm: generatedPackage.pnpm,
      });
      const hostileResult = runOfflineInstall(hostileInstall);
      expect(hostileResult.status).not.toBe(0);
      expect(installOutput(hostileResult)).toMatch(/unreviewed build scripts|hostile-lifecycle/u);
      expect(existsSync(hostileMarker)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 20_000);

  it('emits an explicit strict policy and a closed reviewed/ignored package set', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-lifecycle-policy-shape-'));

    try {
      writeKovoProject(root, { disableGit: true, name: 'Lifecycle Policy Shape' });
      const packageJson = readPackageJson(join(root, 'package.json'));
      const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
      const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

      expect(npmrc).toContain('strict-dep-builds=true\n');
      expect(npmrc).toContain('dangerously-allow-all-builds=false\n');
      expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual(['@node-rs/argon2']);
      expect(packageJson.pnpm?.ignoredBuiltDependencies).toEqual(['esbuild']);
      expect(packageJson.pnpm?.overrides).toEqual({ '@node-rs/argon2': '2.0.2' });
      expect(packageJson.scripts?.['check:lifecycle-policy']).toBe(
        'node scripts/check-lifecycle-policy.mjs',
      );
      expect(workflow).toContain('- run: node scripts/check-lifecycle-policy.mjs');
      expect(workflow.indexOf('- run: node scripts/check-lifecycle-policy.mjs')).toBeLessThan(
        workflow.indexOf('- run: vp install --frozen-lockfile'),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('retains both exact reviewed native exceptions for the SQLite scaffold', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-lifecycle-policy-sqlite-'));

    try {
      const generatedRoot = join(root, 'generated');
      writeKovoProject(generatedRoot, {
        dialect: 'sqlite',
        disableGit: true,
        name: 'SQLite Lifecycle Policy',
      });
      const packageJson = readPackageJson(join(generatedRoot, 'package.json'));
      const npmrc = readFileSync(join(generatedRoot, '.npmrc'), 'utf8');
      const argonMarker = join(root, 'argon.marker');
      const sqliteMarker = join(root, 'sqlite.marker');
      const argonPackage = writeLifecyclePackage(
        root,
        'argon-package',
        '@node-rs/argon2',
        argonMarker,
      );
      const sqlitePackage = writeLifecyclePackage(
        root,
        'sqlite-package',
        'better-sqlite3',
        sqliteMarker,
      );

      expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual([
        '@node-rs/argon2',
        'better-sqlite3',
      ]);
      expect(packageJson.pnpm?.overrides).toEqual({
        '@node-rs/argon2': '2.0.2',
        'better-sqlite3': '12.11.1',
      });
      expect(() =>
        execFileSync(
          process.execPath,
          [join(generatedRoot, 'scripts/check-lifecycle-policy.mjs')],
          {
            cwd: generatedRoot,
            stdio: 'pipe',
          },
        ),
      ).not.toThrow();

      const installRoot = writeInstallHarness(join(root, 'sqlite-install'), {
        dependencies: {
          '@node-rs/argon2': `file:${argonPackage}`,
          'better-sqlite3': `file:${sqlitePackage}`,
        },
        npmrc,
        pnpm: packageJson.pnpm,
      });
      const result = runOfflineInstall(installRoot);
      expect(result.status, installOutput(result)).toBe(0);
      expect(existsSync(argonMarker)).toBe(true);
      expect(existsSync(sqliteMarker)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 20_000);

  it('rejects allow-all, reviewed-allowlist, and version-override weakening before install', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-lifecycle-policy-mutations-'));

    try {
      writeKovoProject(root, { disableGit: true, name: 'Lifecycle Policy Mutants' });
      const checker = join(root, 'scripts/check-lifecycle-policy.mjs');

      expect(() =>
        execFileSync(process.execPath, [checker], { cwd: root, stdio: 'pipe' }),
      ).not.toThrow();

      const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
      writeFileSync(
        join(root, '.npmrc'),
        npmrc.replace('dangerously-allow-all-builds=false', 'dangerously-allow-all-builds=true'),
        'utf8',
      );
      expectCheckerFailure(root, checker, /dangerously-allow-all-builds must be exactly false/u);

      writeFileSync(join(root, '.npmrc'), npmrc, 'utf8');
      const packageJsonPath = join(root, 'package.json');
      const packageJson = readPackageJson(packageJsonPath);
      packageJson.pnpm ??= {};
      packageJson.pnpm.onlyBuiltDependencies = [
        ...(packageJson.pnpm.onlyBuiltDependencies ?? []),
        'hostile-lifecycle',
      ];
      writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      expectCheckerFailure(root, checker, /reviewed lifecycle build allowlist/u);

      packageJson.pnpm.onlyBuiltDependencies = ['@node-rs/argon2'];
      packageJson.pnpm.overrides ??= {};
      packageJson.pnpm.overrides['@node-rs/argon2'] = '9.9.9';
      writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      expectCheckerFailure(root, checker, /graph-wide override to 2\.0\.2/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

interface GeneratedPackageJson {
  dependencies?: Record<string, string>;
  packageManager?: string;
  pnpm?: {
    ignoredBuiltDependencies?: string[];
    onlyBuiltDependencies?: string[];
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
}

function readPackageJson(path: string): GeneratedPackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as GeneratedPackageJson;
}

function writeLifecyclePackage(
  root: string,
  directory: string,
  name: string,
  marker: string,
): string {
  const packageRoot = join(root, directory);
  writeFileTree(packageRoot, {
    'install.mjs': [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(marker)}, 'executed', 'utf8');`,
      '',
    ].join('\n'),
    'package.json': `${JSON.stringify(
      {
        name,
        private: true,
        scripts: { install: 'node install.mjs' },
        version: '1.0.0',
      },
      null,
      2,
    )}\n`,
  });
  return packageRoot;
}

function writeInstallHarness(
  root: string,
  options: {
    dependencies: Record<string, string>;
    npmrc: string;
    pnpm: GeneratedPackageJson['pnpm'];
  },
): string {
  writeFileTree(root, {
    '.npmrc': options.npmrc,
    'package.json': `${JSON.stringify(
      {
        dependencies: options.dependencies,
        name: 'lifecycle-policy-harness',
        packageManager: 'pnpm@10.12.1',
        pnpm: {
          ignoredBuiltDependencies: options.pnpm?.ignoredBuiltDependencies,
          onlyBuiltDependencies: options.pnpm?.onlyBuiltDependencies,
        },
        private: true,
        version: '1.0.0',
      },
      null,
      2,
    )}\n`,
  });
  return root;
}

function writeFileTree(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(root, name), source, 'utf8');
  }
}

function runOfflineInstall(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['install', '--ignore-workspace', '--offline', '--store-dir', join(root, '.pnpm-store')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        NO_COLOR: '1',
      },
    },
  );
}

function installOutput(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function expectCheckerFailure(root: string, checker: string, pattern: RegExp): void {
  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(installOutput(result)).toMatch(pattern);
}
