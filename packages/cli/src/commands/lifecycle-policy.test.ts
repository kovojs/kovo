import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { formatCommandResultDiagnostics } from '../shared.js';
import { runLifecyclePolicyCheck } from './lifecycle-policy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('framework-owned dependency lifecycle policy', () => {
  it.each(['postgres', 'sqlite'] as const)(
    'accepts the generated %s allowlist and preserves one result across formats',
    (dialect) => {
      const root = writeFixture(dialect);
      const result = runLifecyclePolicyCheck(root);

      expect(result).toMatchObject({
        exitCode: 0,
        output: expect.stringContaining(
          dialect === 'sqlite'
            ? 'allowed=@node-rs/argon2,better-sqlite3'
            : 'allowed=@node-rs/argon2',
        ),
      });
      expect(formatCommandResultDiagnostics(result, 'json', 'config')).toBe(
        '{"diagnostics":[],"version":"kovo-diagnostic/v1"}\n',
      );
    },
  );

  it.each([
    {
      mutate(manifest: FixtureManifest) {
        manifest.packageManager = 'pnpm@latest';
      },
      text: 'packageManager must remain exactly pnpm@10.12.1',
    },
    {
      mutate(manifest: FixtureManifest) {
        manifest.pnpm.onlyBuiltDependencies = ['esbuild'];
      },
      text: 'must equal the reviewed lifecycle build allowlist',
    },
    {
      mutate(manifest: FixtureManifest) {
        manifest.pnpm.overrides['@node-rs/argon2'] = '2.0.1';
      },
      text: 'requires a graph-wide override to 2.0.2',
    },
    {
      mutate(manifest: FixtureManifest) {
        manifest.pnpm.dangerouslyAllowAllBuilds = true;
      },
      text: 'dangerouslyAllowAllBuilds is outside the generated lifecycle policy',
    },
  ])('rejects a package policy weakening: $text', ({ mutate, text }) => {
    const root = writeFixture('postgres', mutate);
    const result = runLifecyclePolicyCheck(root);

    expect(result.exitCode).toBe(1);
    expect('output' in result ? result.output : '').toContain(text);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        category: 'config',
        code: 'KOVO_LIFECYCLE_POLICY',
        help: expect.stringContaining('kovo check lifecycle'),
        source: expect.objectContaining({ file: join(realpathSync(root), 'package.json') }),
      }),
    ]);
  });

  it('rejects npmrc and workspace overrides before dependency rebuild', () => {
    const root = writeFixture('postgres');
    writeFileSync(
      join(root, '.npmrc'),
      [
        'strict-dep-builds=false',
        'dangerously-allow-all-builds=false',
        'package-manager-strict-version=true',
        '',
      ].join('\n'),
    );
    let result = runLifecyclePolicyCheck(root);
    expect(result.exitCode).toBe(1);
    expect('output' in result ? result.output : '').toContain(
      'strict-dep-builds must be exactly true',
    );

    writeNpmrc(root);
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - esbuild\n');
    result = runLifecyclePolicyCheck(root);
    expect(result.exitCode).toBe(1);
    expect('output' in result ? result.output : '').toContain(
      'pnpm-workspace.yaml must not override generated lifecycle setting onlyBuiltDependencies',
    );
  });

  it('refuses to follow policy-file symlinks', () => {
    const root = writeFixture('postgres');
    const outside = join(tmpdir(), `kovo-lifecycle-outside-${String(process.pid)}.npmrc`);
    writeFileSync(outside, 'strict-dep-builds=true\n');
    rmSync(join(root, '.npmrc'));
    symlinkSync(outside, join(root, '.npmrc'));
    try {
      const result = runLifecyclePolicyCheck(root);
      expect(result.exitCode).toBe(1);
      expect('output' in result ? result.output : '').toContain(
        '.npmrc must be a regular file inside the project',
      );
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

interface FixtureManifest {
  dependencies: Record<string, string>;
  kovo: { lifecyclePolicy: 'strict-v1' };
  packageManager: string;
  pnpm: {
    dangerouslyAllowAllBuilds?: boolean;
    ignoredBuiltDependencies: string[];
    onlyBuiltDependencies: string[];
    overrides: Record<string, string>;
  };
}

function writeFixture(
  dialect: 'postgres' | 'sqlite',
  mutate?: (manifest: FixtureManifest) => void,
): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-lifecycle-policy-'));
  roots.push(root);
  const dependencies: Record<string, string> = { '@node-rs/argon2': '2.0.2' };
  const onlyBuiltDependencies = ['@node-rs/argon2'];
  const overrides: Record<string, string> = { '@node-rs/argon2': '2.0.2' };
  if (dialect === 'sqlite') {
    dependencies['better-sqlite3'] = '12.11.1';
    onlyBuiltDependencies.push('better-sqlite3');
    overrides['better-sqlite3'] = '12.11.1';
  }
  const manifest: FixtureManifest = {
    dependencies,
    kovo: { lifecyclePolicy: 'strict-v1' },
    packageManager: 'pnpm@10.12.1',
    pnpm: {
      ignoredBuiltDependencies: ['esbuild'],
      onlyBuiltDependencies,
      overrides,
    },
  };
  mutate?.(manifest);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeNpmrc(root);
  return root;
}

function writeNpmrc(root: string): void {
  writeFileSync(
    join(root, '.npmrc'),
    [
      'strict-dep-builds=true',
      'dangerously-allow-all-builds=false',
      'package-manager-strict-version=true',
      '',
    ].join('\n'),
  );
}
